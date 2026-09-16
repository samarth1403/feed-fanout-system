import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new Client({
      node: this.configService.getOrThrow<string>('ELASTICSEARCH_URL'),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();
    this.logger.log('Connected to Elasticsearch');
  }

  async index(index: string, document: Record<string, unknown>): Promise<void> {
    await this.client.index({ index, document });
  }

  async search(index: string, query: Record<string, unknown>) {
    return this.client.search({ index, query });
  }
}
