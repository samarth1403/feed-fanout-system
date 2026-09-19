import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, logLevel as KafkaLogLevel, LogEntry, Producer } from 'kafkajs';

// kafkajs's RequestQueue reschedules its idle check as `throttledUntil - Date.now()`,
// which is negative whenever there's no broker-side throttling (throttledUntil defaults
// to -1) — kafkajs (unmaintained since 2023) never guards against that, so Node emits
// this warning every cycle. Harmless (Node just clamps the delay to 1ms). A `process.on
// ('warning', ...)` listener does not stop Node's default stderr print — both fire
// regardless — so this patches `emitWarning` itself to drop only this one warning type.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const name = typeof warning === 'string' ? args[0] : warning.name;
  if (name === 'TimeoutNegativeWarning') return;
  return (originalEmitWarning as (...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;

// kafkajs's own connect() retrier is bounded (5 attempts, exponential
// backoff, then it rejects for good) rather than retrying forever the way
// ioredis does — so getting "keeps trying until Kafka becomes reachable,
// no app restart needed" requires wrapping it in our own unbounded loop.
// This is only for the initial-connection cold-start case; once a producer
// or consumer has connected successfully once, kafkajs's own per-request
// broker handling already recovers transparently from a later outage (see
// feature-spec 04's verification notes), so no ongoing retry is needed
// past that point.
const KAFKA_RECONNECT_RETRY_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// kafkajs's default console logger repeats "[Connection] Connection error"
// and "[BrokerPool] Failed to connect to seed broker" once per internal
// sub-attempt of its own bounded connect retrier (see
// node_modules/kafkajs/src/network/connection.js and
// .../cluster/brokerPool.js) — redundant once KafkaService's own retry loop
// above already logs one attempt/failure summary per outer attempt. A
// logLevel cutoff can't isolate just these two: kafkajs logs other,
// non-redundant things at the same ERROR level (e.g. a running consumer's
// own crash/restart messages), so this filters by namespace instead and
// otherwise reproduces kafkajs's default console format unchanged.
const SUPPRESSED_KAFKA_LOG_NAMESPACES = new Set(['Connection', 'BrokerPool']);

export function kafkaLogCreator() {
  return (entry: LogEntry) => {
    if (SUPPRESSED_KAFKA_LOG_NAMESPACES.has(entry.namespace)) return;

    const { message, ...extra } = entry.log;
    const prefix = entry.namespace ? `[${entry.namespace}] ` : '';
    const payload = JSON.stringify({ level: entry.label, ...extra, message: `${prefix}${message}` });

    switch (entry.level) {
      case KafkaLogLevel.ERROR:
        console.error(payload);
        return;
      case KafkaLogLevel.WARN:
        console.warn(payload);
        return;
      case KafkaLogLevel.INFO:
        console.info(payload);
        return;
      case KafkaLogLevel.DEBUG:
        console.log(payload);
        return;
    }
  };
}

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumers: Consumer[] = [];
  private shuttingDown = false;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'feed-fanout',
      brokers: [this.configService.getOrThrow<string>('KAFKA_BROKER')],
      logCreator: kafkaLogCreator,
      // This is the *client-level* retry — how many times kafkajs retries
      // establishing a broker connection before giving up on that attempt.
      // It's what actually governs the 20+ second POST /posts delay when
      // Kafka is down: a failed producer.send() doesn't just consult the
      // producer's own retry option — kafkajs's sendMessages() first tries
      // to reconnect the cluster via this same client-level retrier before
      // giving up (confirmed by reading
      // node_modules/kafkajs/src/producer/sendMessages.js and
      // .../cluster/brokerPool.js, and by an isolated timing test against a
      // stopped Kafka container: ~10s per send() with the default retries:5,
      // ~5ms with retries:0). It's also what connectProducerWithRetry/
      // runConsumerWithRetry below wrap — dropping it to 0 doesn't change
      // their retry-forever behavior or 5s spacing, it just makes each
      // individual attempt fail immediately instead of burning ~10s on its
      // own internal sub-retries first.
      retry: { retries: 0 },
    });
    // idempotent producer protects against duplicate publishes if the producer
    // itself retries a send internally, per feature-spec 04.
    //
    // retry.retries here is NOT independent of the client-level retry above:
    // kafka.producer() merges it in as this producer's own base default
    // (`{ ...clientRetry, ...producerRetry }`, in
    // node_modules/kafkajs/src/index.js's producer() method) — so without an
    // explicit override, this producer would silently inherit retries: 0 from
    // the client, and kafkajs hard-rejects that combination for an idempotent
    // producer at construction time ("Idempotent producer must allow retries
    // to protect against transient errors" — hit this directly while
    // verifying live). 1 is the lowest value kafkajs accepts here. It's a
    // separate concern from the client-level 0 above: this governs the outer
    // retry of the whole send() operation for a genuinely retriable error
    // (e.g. a leader election in progress) where retrying the send itself is
    // the right response; the "Kafka is unreachable" case is a
    // KafkaJSNumberOfRetriesExceeded from the client-level retrier, which
    // kafkajs treats as non-retriable regardless of this setting, so it
    // still fails fast — confirmed via the same isolated test.
    this.producer = this.kafka.producer({ idempotent: true, retry: { retries: 1 } });
    // Fires on every successful connect() call, including a later one from
    // the retry loop below, so one listener covers both first-connect and
    // cold-start-recovery logging.
    this.producer.on(this.producer.events.CONNECT, () => this.logger.log('Connected to Kafka'));
  }

  onModuleInit(): void {
    // Not awaited: Kafka being unreachable at startup must not block Nest's
    // bootstrap or any request path that doesn't touch Kafka (e.g.
    // GET /users).
    void this.connectProducerWithRetry();
  }

  private async connectProducerWithRetry(): Promise<void> {
    while (!this.shuttingDown) {
      try {
        await this.producer.connect();
        return;
      } catch (error) {
        this.logger.error('Failed to connect to Kafka producer; retrying shortly', error);
        await sleep(KAFKA_RECONNECT_RETRY_DELAY_MS);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await this.producer.disconnect();
    await Promise.all(this.consumers.map((consumer) => consumer.disconnect()));
  }

  async publish<T extends Record<string, unknown>>(topic: string, message: T): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ value: JSON.stringify(message) }],
      // KafkaJS's `acks` is numeric, not the string 'all' — -1 requests
      // acknowledgment from every in-sync replica (the durability the spec
      // calls "acks: 'all'"), and is also required alongside idempotent: true
      acks: -1,
    });
  }

  createConsumer(groupId: string): Consumer {
    return this.kafka.consumer({ groupId });
  }

  // Generic subscribe helper: connects a consumer, subscribes it to a topic,
  // and forwards each parsed message to the caller's handler. Owns the
  // connect/subscribe/run wiring only — what a topic's payload means and
  // what to do with it is entirely up to the caller.
  //
  // Callers (e.g. FanoutConsumer.onModuleInit) await this, so — same
  // reasoning as the producer above — it must not block on Kafka actually
  // being reachable: it resolves once the consumer is registered for
  // shutdown and its connect/subscribe/run attempt has been scheduled in
  // the background, not once that attempt has succeeded.
  async subscribe<T>(groupId: string, topic: string, onMessage: (payload: T) => Promise<void>): Promise<void> {
    const consumer = this.createConsumer(groupId);
    this.consumers.push(consumer);
    void this.runConsumerWithRetry(consumer, groupId, topic, onMessage);
  }

  private async runConsumerWithRetry<T>(
    consumer: Consumer,
    groupId: string,
    topic: string,
    onMessage: (payload: T) => Promise<void>,
  ): Promise<void> {
    while (!this.shuttingDown) {
      try {
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: false });
        await consumer.run({
          eachMessage: async ({ message }) => {
            if (!message.value) return;
            const payload = JSON.parse(message.value.toString()) as T;
            await onMessage(payload);
          },
        });
        this.logger.log(`Consumer ${groupId} subscribed to ${topic}`);
        return;
      } catch (error) {
        this.logger.error(`Failed to start consumer ${groupId} for topic ${topic}; retrying shortly`, error);
        await sleep(KAFKA_RECONNECT_RETRY_DELAY_MS);
      }
    }
  }
}
