import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

const PRODUCER_EVENTS = { CONNECT: 'producer.connect', DISCONNECT: 'producer.disconnect' };

type MockProducer = {
  events: typeof PRODUCER_EVENTS;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: (eventName: string) => void;
};

type MockConsumer = {
  connect: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function createMockProducer(): MockProducer {
  const listeners = new Map<string, Array<() => void>>();
  return {
    events: PRODUCER_EVENTS,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((eventName: string, listener: () => void) => {
      const existing = listeners.get(eventName) ?? [];
      existing.push(listener);
      listeners.set(eventName, existing);
    }),
    emit: (eventName: string) => {
      (listeners.get(eventName) ?? []).forEach((listener) => listener());
    },
  };
}

function createMockConsumer(): MockConsumer {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

let mockProducer: MockProducer;
let mockConsumer: MockConsumer;

// Matches kafkajs's real `logLevel` enum values (types/index.d.ts) — kept in
// sync manually since 'kafkajs' is mocked wholesale below, so KafkaService's
// own `import { logLevel } from 'kafkajs'` resolves to this, not the real one.
const KAFKA_LOG_LEVEL = { NOTHING: 0, ERROR: 1, WARN: 2, INFO: 4, DEBUG: 5 };

vi.mock('kafkajs', () => ({
  // A plain function, not an arrow function: `new Kafka(...)` in the
  // service under test requires something callable with `new`.
  Kafka: vi.fn().mockImplementation(function (this: unknown) {
    return {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };
  }),
  logLevel: KAFKA_LOG_LEVEL,
}));

// Imported after the mock so KafkaService's `new Kafka(...)` resolves to the mock above.
const { KafkaService, kafkaLogCreator } = await import('./kafka.service.js');

function createConfigMock(): ConfigService {
  return { getOrThrow: vi.fn().mockReturnValue('localhost:9092') } as unknown as ConfigService;
}

describe('KafkaService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockProducer = createMockProducer();
    mockConsumer = createMockConsumer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('producer connection (onModuleInit)', () => {
    it('does not block or throw when Kafka is unreachable at startup', () => {
      mockProducer.connect.mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new KafkaService(createConfigMock());

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('keeps retrying in the background until the producer connects, with no app restart', async () => {
      mockProducer.connect
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(undefined);

      const service = new KafkaService(createConfigMock());
      service.onModuleInit();

      expect(mockProducer.connect).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockProducer.connect).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockProducer.connect).toHaveBeenCalledTimes(3);

      // Retry loop stops once connected — no further attempts scheduled.
      await vi.advanceTimersByTimeAsync(20000);
      expect(mockProducer.connect).toHaveBeenCalledTimes(3);
    });

    it('logs success via the producer CONNECT event, including on a later reconnect', () => {
      const service = new KafkaService(createConfigMock());
      const logSpy = vi.spyOn((service as unknown as { logger: { log: unknown } }).logger as never, 'log');

      mockProducer.emit(PRODUCER_EVENTS.CONNECT);
      mockProducer.emit(PRODUCER_EVENTS.CONNECT);

      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith('Connected to Kafka');
    });

    it('stops retrying once onModuleDestroy has been called', async () => {
      mockProducer.connect.mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new KafkaService(createConfigMock());
      service.onModuleInit();
      await vi.advanceTimersByTimeAsync(5000);
      const callsBeforeShutdown = mockProducer.connect.mock.calls.length;

      await service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(20000);

      expect(mockProducer.connect).toHaveBeenCalledTimes(callsBeforeShutdown);
    });
  });

  describe('subscribe', () => {
    it('resolves immediately without waiting for the consumer to actually connect', async () => {
      let resolveConnect!: () => void;
      mockConsumer.connect.mockReturnValue(new Promise<void>((resolve) => (resolveConnect = resolve)));

      const service = new KafkaService(createConfigMock());
      await expect(service.subscribe('group-1', 'topic-1', vi.fn())).resolves.toBeUndefined();

      resolveConnect();
    });

    it('connects, subscribes, and runs the consumer for the given topic', async () => {
      const service = new KafkaService(createConfigMock());
      const onMessage = vi.fn();

      await service.subscribe('group-1', 'topic-1', onMessage);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
      expect(mockConsumer.subscribe).toHaveBeenCalledWith({ topic: 'topic-1', fromBeginning: false });
      expect(mockConsumer.run).toHaveBeenCalledTimes(1);
    });

    it('forwards each parsed message to the handler', async () => {
      const service = new KafkaService(createConfigMock());
      const onMessage = vi.fn();

      await service.subscribe('group-1', 'topic-1', onMessage);
      await vi.advanceTimersByTimeAsync(0);

      const { eachMessage } = mockConsumer.run.mock.calls[0][0];
      await eachMessage({ message: { value: Buffer.from(JSON.stringify({ postId: 'post-1' })) } });

      expect(onMessage).toHaveBeenCalledWith({ postId: 'post-1' });
    });

    it('keeps retrying until the consumer starts running, with no app restart', async () => {
      mockConsumer.connect.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(undefined);

      const service = new KafkaService(createConfigMock());
      await service.subscribe('group-1', 'topic-1', vi.fn());
      await vi.advanceTimersByTimeAsync(0);

      expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
      expect(mockConsumer.run).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(mockConsumer.connect).toHaveBeenCalledTimes(2);
      expect(mockConsumer.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('kafkaLogCreator', () => {
    const log = kafkaLogCreator();

    it('suppresses kafkajs\'s own per-attempt Connection and BrokerPool logs', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      log({
        namespace: 'Connection',
        level: KAFKA_LOG_LEVEL.ERROR,
        label: 'ERROR',
        log: { timestamp: '2026-09-18T00:00:00.000Z', logger: 'kafkajs', message: 'Connection error: ' },
      });
      log({
        namespace: 'BrokerPool',
        level: KAFKA_LOG_LEVEL.ERROR,
        label: 'ERROR',
        log: {
          timestamp: '2026-09-18T00:00:00.000Z',
          logger: 'kafkajs',
          message: 'Failed to connect to seed broker, trying another broker from the list: Connection error: ',
          retryCount: 0,
          retryTime: 316,
        },
      });

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('passes through other namespaces unchanged, in kafkajs\'s default console format', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      log({
        namespace: 'Consumer',
        level: KAFKA_LOG_LEVEL.ERROR,
        label: 'ERROR',
        log: {
          timestamp: '2026-09-18T00:00:00.000Z',
          logger: 'kafkajs',
          message: 'Crash: KafkaJSNumberOfRetriesExceeded: Connection error: ',
          groupId: 'feed-fanout-consumer',
          retryCount: 5,
        },
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(payload).toMatchObject({
        level: 'ERROR',
        message: '[Consumer] Crash: KafkaJSNumberOfRetriesExceeded: Connection error: ',
        groupId: 'feed-fanout-consumer',
        retryCount: 5,
      });
    });

    it('dispatches non-error levels to the matching console method', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

      log({
        namespace: 'ConsumerGroup',
        level: KAFKA_LOG_LEVEL.INFO,
        label: 'INFO',
        log: { timestamp: '2026-09-18T00:00:00.000Z', logger: 'kafkajs', message: 'Consumer has joined the group' },
      });

      expect(infoSpy).toHaveBeenCalledTimes(1);
    });
  });
});
