import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Follow } from '../generated/prisma/client.js';
import { CreateFollowDto } from './dto/create-follow.dto.js';
import { FollowersSummary, FollowsService } from './follows.service.js';

@Controller()
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post('follows')
  createFollow(@Body() dto: CreateFollowDto): Promise<Follow> {
    return this.followsService.createFollow(dto);
  }

  @Get('users/:id/followers')
  getFollowers(@Param('id') id: string): Promise<FollowersSummary> {
    return this.followsService.getFollowers(id);
  }
}
