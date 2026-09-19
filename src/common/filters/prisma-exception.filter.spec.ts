import { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

function createHost(response: unknown): ArgumentsHost {
  return {
    getArgByIndex: (index: number) => (index === 1 ? response : undefined),
  } as unknown as ArgumentsHost;
}

function createApplicationRef() {
  return {
    isHeadersSent: vi.fn().mockReturnValue(false),
    reply: vi.fn(),
    end: vi.fn(),
  };
}

describe('PrismaExceptionFilter', () => {
  it('replies 503 with a clean message for a connectivity error', () => {
    const applicationRef = createApplicationRef();
    const filter = new PrismaExceptionFilter(applicationRef as never);
    const response = {};
    const error = new Prisma.PrismaClientKnownRequestError('Connection error', {
      code: 'ECONNREFUSED',
      clientVersion: '7.10.0',
    });

    filter.catch(error, createHost(response));

    expect(applicationRef.reply).toHaveBeenCalledWith(
      response,
      { message: 'Database is temporarily unavailable', error: 'Service Unavailable', statusCode: 503 },
      503,
    );
  });

  it('replies 503 for a connectivity error surfaced as PrismaClientInitializationError', () => {
    const applicationRef = createApplicationRef();
    const filter = new PrismaExceptionFilter(applicationRef as never);
    const response = {};
    const error = new Prisma.PrismaClientInitializationError('Can\'t reach database server', '7.10.0');

    filter.catch(error, createHost(response));

    expect(applicationRef.reply).toHaveBeenCalledWith(
      response,
      { message: 'Database is temporarily unavailable', error: 'Service Unavailable', statusCode: 503 },
      503,
    );
  });

  it('defers to default handling (generic 500) for a non-connectivity Prisma error', () => {
    const applicationRef = createApplicationRef();
    const filter = new PrismaExceptionFilter(applicationRef as never);
    const response = {};
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });

    filter.catch(error, createHost(response));

    expect(applicationRef.reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });
});
