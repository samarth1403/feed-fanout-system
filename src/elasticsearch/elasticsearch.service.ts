import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

// Elasticsearch's client is stateless HTTP per request (unlike ioredis/
// kafkajs, which hold a persistent connection that itself needs
// reconnecting) — so once the server is reachable again, index()/search()
// calls just succeed on their own. The only thing that needs its own retry
// loop is the initial health check below, so bootstrap never blocks on it
// and there's still a clear "Connected"/"still down" signal in the logs.
const ELASTICSEARCH_RECONNECT_RETRY_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class ElasticsearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client: Client;
  private shuttingDown = false;

  constructor(private readonly configService: ConfigService) {
    this.client = new Client({
      node: this.configService.getOrThrow<string>('ELASTICSEARCH_URL'),
    });
  }

  onModuleInit(): void {
    // Not awaited: Elasticsearch being unreachable at startup must not
    // block Nest's bootstrap or any request path that doesn't touch it
    // (e.g. POST /posts, GET /users).
    void this.pingWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await this.client.close();
  }

  private async pingWithRetry(): Promise<void> {
    while (!this.shuttingDown) {
      try {
        await this.client.ping();
        this.logger.log('Connected to Elasticsearch');
        return;
      } catch (error) {
        this.logger.error('Failed to connect to Elasticsearch; retrying shortly', error);
        await sleep(ELASTICSEARCH_RECONNECT_RETRY_DELAY_MS);
      }
    }
  }

  async index(index: string, document: Record<string, unknown>): Promise<void> {
    await this.client.index({ index, document });
  }

  async search(index: string, query: Record<string, unknown>) {
    return this.client.search({ index, query });
  }
}
