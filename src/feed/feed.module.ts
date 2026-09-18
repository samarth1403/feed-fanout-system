import { Module } from '@nestjs/common';
import { FollowsModule } from '../follows/follows.module.js';
import { KafkaModule } from '../kafka/kafka.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { FanoutConsumer } from './fanout-consumer.js';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [KafkaModule, RedisModule, FollowsModule],
  controllers: [FeedController],
  providers: [FeedService, FanoutConsumer],
})
export class FeedModule {}
