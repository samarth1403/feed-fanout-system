import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { User } from '../generated/prisma/client.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  createUser(@Body() dto: CreateUserDto): Promise<User> {
    return this.usersService.createUser(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<User> {
    return this.usersService.findById(id);
  }
}
