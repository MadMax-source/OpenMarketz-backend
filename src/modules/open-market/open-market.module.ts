import { Module } from '@nestjs/common';
import { OpenMarketController } from './open-market.controller.js';
import { OpenMarketService } from './open-market.service.js';

@Module({
  controllers: [OpenMarketController],
  providers: [OpenMarketService],
})
export class OpenMarketModule {}
