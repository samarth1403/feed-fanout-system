import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { isPrismaConnectionError } from './prisma-connection-error.js';

describe('isPrismaConnectionError', () => {
  it('returns true for PrismaClientInitializationError', () => {
    const error = new Prisma.PrismaClientInitializationError('Can\'t reach database server', '7.10.0');
    expect(isPrismaConnectionError(error)).toBe(true);
  });

  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'])(
    'returns true for a PrismaClientKnownRequestError with code %s',
    (code) => {
      const error = new Prisma.PrismaClientKnownRequestError('Connection error', {
        code,
        clientVersion: '7.10.0',
      });
      expect(isPrismaConnectionError(error)).toBe(true);
    },
  );

  it('returns false for a PrismaClientKnownRequestError with an unrelated code (e.g. unique constraint)', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    expect(isPrismaConnectionError(error)).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isPrismaConnectionError(new Error('something else'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isPrismaConnectionError('not an error')).toBe(false);
    expect(isPrismaConnectionError(undefined)).toBe(false);
  });
});
