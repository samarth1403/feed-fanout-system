import { Prisma } from '../generated/prisma/client.js';

// Node/pg network-level failure codes that mean Postgres itself is
// unreachable, as opposed to e.g. a constraint violation or bad query.
// What actually surfaces depends on where in the request lifecycle the
// failure happens: a mid-query failure comes through as a
// PrismaClientKnownRequestError wrapping the underlying driver error —
// its `code` is the raw pg/Node error code (e.g. 'ECONNREFUSED'), not one
// of Prisma's own P-prefixed codes, confirmed live against this project's
// @prisma/adapter-pg setup — while a failure during query-engine
// initialization surfaces as PrismaClientInitializationError instead.
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND']);

export function isPrismaConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    typeof error.code === 'string' &&
    CONNECTION_ERROR_CODES.has(error.code)
  );
}
