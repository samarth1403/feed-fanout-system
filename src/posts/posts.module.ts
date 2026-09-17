import { Module } from '@nestjs/common';
import { KafkaModule } from '../kafka/kafka.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  imports: [PrismaModule, KafkaModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
