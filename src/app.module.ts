import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module.js';
import { FollowsModule } from './follows/follows.module.js';
import { PostsModule } from './posts/posts.module.js';
import { FeedModule } from './feed/feed.module.js';
import { SearchModule } from './search/search.module.js';
import { CommonModule } from './common/common.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { KafkaModule } from './kafka/kafka.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    KafkaModule,
    RedisModule,
    ElasticsearchModule,
    UsersModule,
    FollowsModule,
    PostsModule,
    FeedModule,
    SearchModule,
    CommonModule,
  ],
})
export class AppModule {}
