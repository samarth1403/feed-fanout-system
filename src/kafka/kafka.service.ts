import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, Producer } from 'kafkajs';

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

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'feed-fanout',
      brokers: [this.configService.getOrThrow<string>('KAFKA_BROKER')],
    });
    // idempotent producer protects against duplicate publishes if the producer
    // itself retries a send internally, per feature-spec 04
    this.producer = this.kafka.producer({ idempotent: true });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Connected to Kafka');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
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
}
