import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis(this.configService.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
    });
    // ioredis emits 'error' on every connection-level failure (including
    // each retry while Redis is down); without a listener it falls back to
    // its own unhandled-event console warning instead of this service's
    // Logger.
    this.client.on('error', (error) => this.logger.error('Redis client error', error));
    // 'ready' fires on the first successful connection and again after every
    // automatic reconnect, so one listener covers both cases.
    this.client.on('ready', () => this.logger.log('Connected to Redis'));
  }

  onModuleInit(): void {
    // Not awaited: Redis being unreachable at startup must not block Nest's
    // bootstrap or any request path that doesn't touch Redis (e.g.
    // POST /posts). ioredis's own retryStrategy (see the 'error'/'ready'
    // listeners above) keeps retrying the connection in the background
    // regardless of how this call's promise settles — the .catch here only
    // exists to prevent an unhandled-rejection warning from this one
    // explicit connect() call.
    this.client.connect().catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

  async zAdd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, String(start), String(stop));
  }
}
