import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Post, type User } from '../generated/prisma/client.js';
import { KafkaService } from '../kafka/kafka.service.js';
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

function createKafkaMock() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  } as unknown as KafkaService;
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
  let kafka: ReturnType<typeof createKafkaMock>;
  let service: PostsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    kafka = createKafkaMock();
    service = new PostsService(prisma, kafka);
  });

  describe('createPost', () => {
    it('throws NotFoundException when authorId does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        service.createPost({ authorId: 'missing-user', content: 'hello' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.post.create).not.toHaveBeenCalled();
      expect(kafka.publish).not.toHaveBeenCalled();
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

    it('publishes a post.created event with the expected payload', async () => {
      const post = makePost();
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser());
      vi.mocked(prisma.post.create).mockResolvedValue(post);

      await service.createPost({ authorId: 'user-1', content: 'hello world' });

      expect(kafka.publish).toHaveBeenCalledWith('post.created', {
        postId: post.id,
        authorId: post.authorId,
        createdAt: post.createdAt.toISOString(),
      });
    });

    it('still returns the created post when the Kafka publish fails', async () => {
      const post = makePost();
      vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser());
      vi.mocked(prisma.post.create).mockResolvedValue(post);
      vi.mocked(kafka.publish).mockRejectedValue(new Error('broker unreachable'));

      await expect(
        service.createPost({ authorId: 'user-1', content: 'hello world' }),
      ).resolves.toEqual(post);
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
