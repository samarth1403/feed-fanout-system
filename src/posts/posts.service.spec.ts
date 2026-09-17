import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Post, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PostsService } from './posts.service.js';

function createPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
    },
    post: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
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

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    authorId: 'user-1',
    content: 'hello world',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PostsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: PostsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new PostsService(prisma);
  });

  describe('createPost', () => {
    it('throws NotFoundException when authorId does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        service.createPost({ authorId: 'missing-user', content: 'hello' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('creates and returns the post when the author exists', async () => {
      const post = makePost();
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser());
      vi.mocked(prisma.post.create).mockResolvedValue(post);

      await expect(
        service.createPost({ authorId: 'user-1', content: 'hello world' }),
      ).resolves.toEqual(post);
      expect(prisma.post.create).toHaveBeenCalledWith({
        data: { authorId: 'user-1', content: 'hello world' },
      });
    });
  });

  describe('findById', () => {
    it('returns the post when found', async () => {
      const post = makePost();
      vi.mocked(prisma.post.findUnique).mockResolvedValue(post);

      await expect(service.findById('post-1')).resolves.toEqual(post);
    });

    it('throws NotFoundException when missing', async () => {
      vi.mocked(prisma.post.findUnique).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
