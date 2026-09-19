import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

type MockRedisClient = EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  zadd: ReturnType<typeof vi.fn>;
  zrange: ReturnType<typeof vi.fn>;
};

function createMockClient(): MockRedisClient {
  const emitter = new EventEmitter() as MockRedisClient;
  emitter.connect = vi.fn().mockResolvedValue(undefined);
  emitter.disconnect = vi.fn();
  emitter.zadd = vi.fn();
  emitter.zrange = vi.fn();
  return emitter;
}

let mockClient: MockRedisClient;

vi.mock('ioredis', () => ({
  // A plain function, not an arrow function: `new Redis(...)` in the
  // service under test requires something callable with `new`.
  Redis: vi.fn().mockImplementation(function (this: unknown) {
    return mockClient;
  }),
}));

// Imported after the mock so RedisService's `new Redis(...)` resolves to the mock above.
const { RedisService } = await import('./redis.service.js');

function createConfigMock(): ConfigService {
  return { getOrThrow: vi.fn().mockReturnValue('redis://localhost:6379') } as unknown as ConfigService;
}

describe('RedisService', () => {
  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('does not block or reject when Redis is unreachable at startup', async () => {
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new RedisService(createConfigMock());

    // onModuleInit is synchronous (fire-and-forget) precisely so bootstrap
    // never awaits the connection attempt; this also proves the rejected
    // connect() promise can't surface as an unhandled rejection.
    expect(() => service.onModuleInit()).not.toThrow();
    await new Promise(process.nextTick);
  });

  it('logs a success line when the client reaches ready, including on a later reconnect', () => {
    const service = new RedisService(createConfigMock());
    const logSpy = vi.spyOn((service as unknown as { logger: { log: unknown } }).logger as never, 'log');

    mockClient.emit('ready');
    mockClient.emit('ready');

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith('Connected to Redis');
  });

  it('logs connection errors via the Logger instead of an unhandled event warning', () => {
    const service = new RedisService(createConfigMock());
    const errorSpy = vi.spyOn((service as unknown as { logger: { error: unknown } }).logger as never, 'error');

    const error = new Error('connection refused');
    mockClient.emit('error', error);

    expect(errorSpy).toHaveBeenCalledWith('Redis client error', error);
  });

  it('disconnects the client on module destroy', () => {
    const service = new RedisService(createConfigMock());

    service.onModuleDestroy();

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('delegates zAdd and zRange to the underlying client', async () => {
    mockClient.zadd.mockResolvedValue(1);
    mockClient.zrange.mockResolvedValue(['post-1']);

    const service = new RedisService(createConfigMock());

    await expect(service.zAdd('feed:user-1', 123, 'post-1')).resolves.toBe(1);
    expect(mockClient.zadd).toHaveBeenCalledWith('feed:user-1', 123, 'post-1');

    await expect(service.zRange('feed:user-1', 0, -1)).resolves.toEqual(['post-1']);
    expect(mockClient.zrange).toHaveBeenCalledWith('feed:user-1', '0', '-1');
  });
});
