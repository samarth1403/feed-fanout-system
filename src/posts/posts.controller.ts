import { Body, Controller, Get, Param, Post as HttpPost } from '@nestjs/common';
import { Post } from '../generated/prisma/client.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import { PostsService } from './posts.service.js';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  createPost(@Body() dto: CreatePostDto): Promise<Post> {
    return this.postsService.createPost(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<Post> {
    return this.postsService.findById(id);
  }
}
