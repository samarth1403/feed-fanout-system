import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

function createPrismaMock() {
  return {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  } as unknown as PrismaService;
}

const user: User = {
  id: 'user-1',
  username: 'alice',
  followerCount: 0,
  createdAt: new Date(),
};

describe('UsersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: UsersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UsersService(prisma);
  });

  describe('createUser', () => {
    it('creates and returns the user', async () => {
      vi.mocked(prisma.user.create).mockResolvedValue(user);

      await expect(service.createUser({ username: 'alice' })).resolves.toEqual(user);
      expect(prisma.user.create).toHaveBeenCalledWith({ data: { username: 'alice' } });
    });

    it('throws BadRequestException on duplicate username', async () => {
      vi.mocked(prisma.user.create).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      );

      await expect(service.createUser({ username: 'alice' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

      await expect(service.findById('user-1')).resolves.toEqual(user);
    });

    it('throws NotFoundException when missing', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
