import { Injectable, NotFoundException } from '@nestjs/common';
import { type Post } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePostDto } from './dto/create-post.dto.js';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPost(dto: CreatePostDto): Promise<Post> {
    const author = await this.prisma.user.findUnique({ where: { id: dto.authorId } });
    if (!author) {
      throw new NotFoundException(`User ${dto.authorId} not found`);
    }

    return this.prisma.post.create({
      data: { authorId: dto.authorId, content: dto.content },
    });
  }

  async findById(id: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Post ${id} not found`);
    }
    return post;
  }
}
