import { ArgumentsHost, Catch, Logger, ServiceUnavailableException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../../generated/prisma/client.js';
import { isPrismaConnectionError } from '../../prisma/prisma-connection-error.js';

// Catches Prisma errors application-wide so a Postgres outage surfaces as a
// deliberate 503, not an unhandled 500 — Postgres is the source of truth
// (per architecture-context.md), so a write or read still fails when it's
// unreachable, only the failure's shape changes. Errors a service already
// translates itself (e.g. P2002 -> BadRequestException in
// UsersService/FollowsService) never reach this filter — those are caught
// and re-thrown as an HttpException before the method returns, so this only
// ever sees what nothing more specific has already handled.
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientInitializationError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientInitializationError,
    host: ArgumentsHost,
  ): void {
    if (!isPrismaConnectionError(exception)) {
      // Not a connectivity issue (some other, currently-unhandled Prisma
      // error code) — defer to Nest's own default handling rather than
      // inventing new behavior for a case outside this fix's scope.
      super.catch(exception, host);
      return;
    }

    this.logger.error('Postgres is unreachable', exception);
    super.catch(new ServiceUnavailableException('Database is temporarily unavailable'), host);
  }
}
