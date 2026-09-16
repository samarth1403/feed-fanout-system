import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Follow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateFollowDto } from './dto/create-follow.dto.js';

export interface FollowersSummary {
  followerCount: number;
  followerIds: string[];
}

@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  async createFollow(dto: CreateFollowDto): Promise<Follow> {
    const { followerId, followingId } = dto;

    if (followerId === followingId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const [follower, following] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: followerId } }),
      this.prisma.user.findUnique({ where: { id: followingId } }),
    ]);
    if (!follower) {
      throw new NotFoundException(`User ${followerId} not found`);
    }
    if (!following) {
      throw new NotFoundException(`User ${followingId} not found`);
    }

    try {
      const [follow] = await this.prisma.$transaction([
        this.prisma.follow.create({ data: { followerId, followingId } }),
        this.prisma.user.update({
          where: { id: followingId },
          data: { followerCount: { increment: 1 } },
        }),
      ]);
      return follow;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(`${followerId} already follows ${followingId}`);
      }
      throw error;
    }
  }

  async getFollowers(userId: string): Promise<FollowersSummary> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const followerIds = await this.getFollowerIds(userId);
    return { followerCount: user.followerCount, followerIds };
  }

  async getFollowerIds(userId: string): Promise<string[]> {
    const follows = await this.prisma.follow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
    });
    return follows.map((follow) => follow.followerId);
  }

  async getFollowingIds(userId: string): Promise<string[]> {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    return follows.map((follow) => follow.followingId);
  }
}
