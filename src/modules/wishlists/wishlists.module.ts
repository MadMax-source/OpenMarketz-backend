import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WishlistsController } from './wishlists.controller.js';
import { WishlistsService } from './wishlists.service.js';

@Module({
  imports: [OrdersModule, PaymentsModule],
  controllers: [WishlistsController],
  providers: [WishlistsService],
})
export class WishlistsModule {}
