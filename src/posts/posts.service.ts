import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Post } from '../generated/prisma/client.js';
import { KafkaService } from '../kafka/kafka.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePostDto } from './dto/create-post.dto.js';

const POST_CREATED_TOPIC = 'post.created';

type PostCreatedEvent = {
  postId: string;
  authorId: string;
  createdAt: string;
};

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  async createPost(dto: CreatePostDto): Promise<Post> {
    const author = await this.prisma.user.findUnique({ where: { id: dto.authorId } });
    if (!author) {
      throw new NotFoundException(`User ${dto.authorId} not found`);
    }

    const post = await this.prisma.post.create({
      data: { authorId: dto.authorId, content: dto.content },
    });

    await this.publishPostCreated(post);

    return post;
  }

  // Postgres write and Kafka publish are not one atomic operation (spec 04):
  // a publish failure is caught and logged here, never thrown, and never
  // rolls back or blocks the already-committed post.
  private async publishPostCreated(post: Post): Promise<void> {
    const event: PostCreatedEvent = {
      postId: post.id,
      authorId: post.authorId,
      createdAt: post.createdAt.toISOString(),
    };

    try {
      await this.kafka.publish(POST_CREATED_TOPIC, event);
    } catch (error) {
      this.logger.error(`Failed to publish post.created event for post ${post.id}`, error);
    }
  }

  async findById(id: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Post ${id} not found`);
    }
    return post;
  }
}
