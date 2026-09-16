import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FollowsController } from './follows.controller.js';
import { FollowsService } from './follows.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [FollowsController],
  providers: [FollowsService],
})
export class FollowsModule {}
