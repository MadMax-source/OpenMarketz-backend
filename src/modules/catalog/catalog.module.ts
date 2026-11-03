import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { SellerProductsController } from './seller-products.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController, SellerProductsController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
