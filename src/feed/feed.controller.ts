import { Controller } from '@nestjs/common';
import { FeedService } from './feed.service.js';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}
}
