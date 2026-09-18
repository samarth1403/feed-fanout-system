import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowsService } from '../follows/follows.service.js';
import { KafkaService } from '../kafka/kafka.service.js';
import { RedisService } from '../redis/redis.service.js';
import { FanoutConsumer } from './fanout-consumer.js';

type PostCreatedEvent = {
  postId: string;
  authorId: string;
  createdAt: string;
};

function createKafkaMock() {
  return {
    subscribe: vi.fn(),
  } as unknown as KafkaService;
}

function createFollowsMock() {
  return {
    getFollowerIds: vi.fn(),
  } as unknown as FollowsService;
}

function createRedisMock() {
  return {
    zAdd: vi.fn(),
  } as unknown as RedisService;
}

const event: PostCreatedEvent = {
  postId: 'post-1',
  authorId: 'author-1',
  createdAt: '2026-09-17T12:00:00.000Z',
};

describe('FanoutConsumer', () => {
  let kafka: ReturnType<typeof createKafkaMock>;
  let follows: ReturnType<typeof createFollowsMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let consumer: FanoutConsumer;

  beforeEach(() => {
    kafka = createKafkaMock();
    follows = createFollowsMock();
    redis = createRedisMock();
    consumer = new FanoutConsumer(kafka, follows, redis);
  });

  // Extracts the per-message handler passed to `KafkaService.subscribe` so
  // tests can invoke it directly, the way KafkaJS would on message receipt.
  async function getSubscribedHandler(): Promise<(event: PostCreatedEvent) => Promise<void>> {
    await consumer.onModuleInit();
    const call = (kafka.subscribe as ReturnType<typeof vi.fn>).mock.calls[0];
    return call[2] as (event: PostCreatedEvent) => Promise<void>;
  }

  it('subscribes to post.created on the feed-fanout-consumer group on module init', async () => {
    await consumer.onModuleInit();

    expect(kafka.subscribe).toHaveBeenCalledWith('feed-fanout-consumer', 'post.created', expect.any(Function));
  });

  it('fans out the post to every follower via RedisService.zAdd', async () => {
    (follows.getFollowerIds as ReturnType<typeof vi.fn>).mockResolvedValue(['follower-1', 'follower-2']);
    (redis.zAdd as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const handler = await getSubscribedHandler();
    await handler(event);

    expect(follows.getFollowerIds).toHaveBeenCalledWith('author-1');
    expect(redis.zAdd).toHaveBeenCalledTimes(2);
    expect(redis.zAdd).toHaveBeenCalledWith('feed:follower-1', new Date(event.createdAt).getTime(), 'post-1');
    expect(redis.zAdd).toHaveBeenCalledWith('feed:follower-2', new Date(event.createdAt).getTime(), 'post-1');
  });

  it('produces zero Redis writes for an author with no followers, without throwing', async () => {
    (follows.getFollowerIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const handler = await getSubscribedHandler();
    await expect(handler(event)).resolves.toBeUndefined();

    expect(redis.zAdd).not.toHaveBeenCalled();
  });

  it('logs and swallows the error when the follower lookup fails, without writing to Redis', async () => {
    (follows.getFollowerIds as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    const handler = await getSubscribedHandler();
    await expect(handler(event)).resolves.toBeUndefined();

    expect(redis.zAdd).not.toHaveBeenCalled();
  });

  it('continues fanning out to remaining followers when one Redis write fails', async () => {
    (follows.getFollowerIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'follower-1',
      'follower-2',
      'follower-3',
    ]);
    (redis.zAdd as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('redis write failed'))
      .mockResolvedValueOnce(1);

    const handler = await getSubscribedHandler();
    await expect(handler(event)).resolves.toBeUndefined();

    expect(redis.zAdd).toHaveBeenCalledTimes(3);
  });

  it('does not create duplicate entries when the same message is reprocessed', async () => {
    (follows.getFollowerIds as ReturnType<typeof vi.fn>).mockResolvedValue(['follower-1']);
    (redis.zAdd as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const handler = await getSubscribedHandler();
    await handler(event);
    await handler(event);

    // zAdd is a set-member upsert (per its own semantics) — asserting it's
    // called identically both times documents that reprocessing sends the
    // same idempotent write, not a duplicate-producing one.
    expect(redis.zAdd).toHaveBeenNthCalledWith(1, 'feed:follower-1', new Date(event.createdAt).getTime(), 'post-1');
    expect(redis.zAdd).toHaveBeenNthCalledWith(2, 'feed:follower-1', new Date(event.createdAt).getTime(), 'post-1');
  });
});
