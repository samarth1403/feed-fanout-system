import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FollowsService } from '../follows/follows.service.js';
import { KafkaService } from '../kafka/kafka.service.js';
import { RedisService } from '../redis/redis.service.js';

const POST_CREATED_TOPIC = 'post.created';
const FEED_FANOUT_CONSUMER_GROUP = 'feed-fanout-consumer';

type PostCreatedEvent = {
  postId: string;
  authorId: string;
  createdAt: string;
};

@Injectable()
export class FanoutConsumer implements OnModuleInit {
  private readonly logger = new Logger(FanoutConsumer.name);

  constructor(
    private readonly kafka: KafkaService,
    private readonly follows: FollowsService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafka.subscribe<PostCreatedEvent>(FEED_FANOUT_CONSUMER_GROUP, POST_CREATED_TOPIC, (event) =>
      this.handlePostCreated(event),
    );
  }

  private async handlePostCreated(event: PostCreatedEvent): Promise<void> {
    const { postId, authorId, createdAt } = event;
    // Redis sorted-set score must be numeric; the event carries createdAt as
    // an ISO string (per the post.created contract), so it's converted to
    // epoch ms here for the score, per architecture-context.md's
    // "score = post timestamp".
    const score = new Date(createdAt).getTime();

    let followerIds: string[];
    try {
      followerIds = await this.follows.getFollowerIds(authorId);
    } catch (error) {
      this.logger.error(`Failed to fan out post ${postId}: could not load followers for author ${authorId}`, error);
      return;
    }

    let fannedOutCount = 0;
    for (const followerId of followerIds) {
      try {
        await this.redis.zAdd(`feed:${followerId}`, score, postId);
        fannedOutCount += 1;
      } catch (error) {
        this.logger.error(`Failed to write post ${postId} to feed:${followerId}`, error);
      }
    }

    this.logger.log(`Fanned out post ${postId} to ${fannedOutCount}/${followerIds.length} followers`);
  }
}
