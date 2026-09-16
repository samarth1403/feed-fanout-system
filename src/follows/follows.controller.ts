import { Controller } from '@nestjs/common';
import { FollowsService } from './follows.service.js';

@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}
}
