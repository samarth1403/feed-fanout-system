import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PrismaExceptionFilter } from './filters/prisma-exception.filter.js';

@Module({
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class CommonModule {}
