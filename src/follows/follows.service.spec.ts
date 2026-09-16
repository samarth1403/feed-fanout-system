import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type Follow, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FollowsService } from './follows.service.js';

function createPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    follow: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaService;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'alice',
    followerCount: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

const follow: Follow = { followerId: 'follower-1', followingId: 'following-1' };

describe('FollowsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: FollowsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new FollowsService(prisma);
  });

  describe('createFollow', () => {
    it('throws BadRequestException when following yourself', async () => {
      await expect(
        service.createFollow({ followerId: 'user-1', followingId: 'user-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when followerId does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(
        makeUser({ id: 'following-1' }),
      );

      await expect(
        service.createFollow({ followerId: 'follower-1', followingId: 'following-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when followingId does not exist', async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(makeUser({ id: 'follower-1' }))
        .mockResolvedValueOnce(null);

      await expect(
        service.createFollow({ followerId: 'follower-1', followingId: 'following-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates the follow and increments followerCount in one transaction', async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(makeUser({ id: 'follower-1' }))
        .mockResolvedValueOnce(makeUser({ id: 'following-1' }));
      vi.mocked(prisma.$transaction).mockResolvedValue([follow, makeUser({ id: 'following-1' })]);

      await expect(
        service.createFollow({ followerId: 'follower-1', followingId: 'following-1' }),
      ).resolves.toEqual(follow);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException on a duplicate follow', async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(makeUser({ id: 'follower-1' }))
        .mockResolvedValueOnce(makeUser({ id: 'following-1' }));
      vi.mocked(prisma.$transaction).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      );

      await expect(
        service.createFollow({ followerId: 'follower-1', followingId: 'following-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getFollowerIds / getFollowingIds', () => {
    it('returns follower ids for a user', async () => {
      vi.mocked(prisma.follow.findMany).mockResolvedValue([
        { followerId: 'a' },
        { followerId: 'b' },
      ] as Follow[]);

      await expect(service.getFollowerIds('user-1')).resolves.toEqual(['a', 'b']);
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followingId: 'user-1' },
        select: { followerId: true },
      });
    });

    it('returns following ids for a user', async () => {
      vi.mocked(prisma.follow.findMany).mockResolvedValue([
        { followingId: 'c' },
        { followingId: 'd' },
      ] as Follow[]);

      await expect(service.getFollowingIds('user-1')).resolves.toEqual(['c', 'd']);
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followerId: 'user-1' },
        select: { followingId: true },
      });
    });

    it('returns an empty array when a user has no followers', async () => {
      vi.mocked(prisma.follow.findMany).mockResolvedValue([]);

      await expect(service.getFollowerIds('user-1')).resolves.toEqual([]);
    });

    it('returns an empty array when a user is not following anyone', async () => {
      vi.mocked(prisma.follow.findMany).mockResolvedValue([]);

      await expect(service.getFollowingIds('user-1')).resolves.toEqual([]);
    });

    it('resolves correct results against a shared follow graph (a follows b and c)', async () => {
      const graph: Follow[] = [
        { followerId: 'a', followingId: 'b' },
        { followerId: 'a', followingId: 'c' },
      ];
      vi.mocked(prisma.follow.findMany).mockImplementation(
        (async (args: { where: { followingId?: string; followerId?: string } }) => {
          if (args.where.followingId !== undefined) {
            return graph
              .filter((row) => row.followingId === args.where.followingId)
              .map((row) => ({ followerId: row.followerId }));
          }
          return graph
            .filter((row) => row.followerId === args.where.followerId)
            .map((row) => ({ followingId: row.followingId }));
        }) as unknown as typeof prisma.follow.findMany,
      );

      await expect(service.getFollowerIds('b')).resolves.toEqual(['a']);
      await expect(service.getFollowingIds('b')).resolves.toEqual([]);
      await expect(service.getFollowerIds('c')).resolves.toEqual(['a']);
      await expect(service.getFollowingIds('c')).resolves.toEqual([]);
      await expect(service.getFollowingIds('a')).resolves.toEqual(['b', 'c']);
      await expect(service.getFollowerIds('a')).resolves.toEqual([]);
    });
  });

  describe('getFollowers', () => {
    it('returns follower count and ids', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser({ followerCount: 2 }));
      vi.mocked(prisma.follow.findMany).mockResolvedValue([
        { followerId: 'a' },
        { followerId: 'b' },
      ] as Follow[]);

      await expect(service.getFollowers('user-1')).resolves.toEqual({
        followerCount: 2,
        followerIds: ['a', 'b'],
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(service.getFollowers('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
