import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

type MockClient = {
  ping: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  index: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
};

function createMockClient(): MockClient {
  return {
    ping: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    index: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue({ hits: { hits: [] } }),
  };
}

let mockClient: MockClient;

vi.mock('@elastic/elasticsearch', () => ({
  // A plain function, not an arrow function: `new Client(...)` in the
  // service under test requires something callable with `new`.
  Client: vi.fn().mockImplementation(function (this: unknown) {
    return mockClient;
  }),
}));

// Imported after the mock so ElasticsearchService's `new Client(...)` resolves to the mock above.
const { ElasticsearchService } = await import('./elasticsearch.service.js');

function createConfigMock(): ConfigService {
  return { getOrThrow: vi.fn().mockReturnValue('http://localhost:9200') } as unknown as ConfigService;
}

describe('ElasticsearchService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not block or throw when Elasticsearch is unreachable at startup', () => {
    mockClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new ElasticsearchService(createConfigMock());

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('keeps retrying in the background until ping succeeds, with no app restart', async () => {
    mockClient.ping
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);

    const service = new ElasticsearchService(createConfigMock());
    service.onModuleInit();

    expect(mockClient.ping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockClient.ping).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockClient.ping).toHaveBeenCalledTimes(3);

    // Retry loop stops once connected — no further attempts scheduled.
    await vi.advanceTimersByTimeAsync(20000);
    expect(mockClient.ping).toHaveBeenCalledTimes(3);
  });

  it('logs success once ping resolves', async () => {
    const service = new ElasticsearchService(createConfigMock());
    const logSpy = vi.spyOn((service as unknown as { logger: { log: unknown } }).logger as never, 'log');

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(logSpy).toHaveBeenCalledWith('Connected to Elasticsearch');
  });

  it('logs connection errors without throwing', async () => {
    mockClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new ElasticsearchService(createConfigMock());
    const errorSpy = vi.spyOn((service as unknown as { logger: { error: unknown } }).logger as never, 'error');

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to connect to Elasticsearch; retrying shortly',
      expect.any(Error),
    );
  });

  it('stops retrying once onModuleDestroy has been called', async () => {
    mockClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new ElasticsearchService(createConfigMock());
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(5000);
    const callsBeforeShutdown = mockClient.ping.mock.calls.length;

    await service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(20000);

    expect(mockClient.ping).toHaveBeenCalledTimes(callsBeforeShutdown);
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('delegates index and search to the underlying client', async () => {
    const service = new ElasticsearchService(createConfigMock());

    await service.index('posts', { postId: 'post-1' });
    expect(mockClient.index).toHaveBeenCalledWith({ index: 'posts', document: { postId: 'post-1' } });

    await service.search('posts', { match: { content: 'hello' } });
    expect(mockClient.search).toHaveBeenCalledWith({ index: 'posts', query: { match: { content: 'hello' } } });
  });
});
