import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation.js';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { SellersModule } from './modules/sellers/sellers.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { OffersModule } from './modules/offers/offers.module.js';
import { OpenMarketModule } from './modules/open-market/open-market.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { WishlistsModule } from './modules/wishlists/wishlists.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { RealtimeThrottlerGuard } from './common/realtime-throttler.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    SellersModule,
    CatalogModule,
    MediaModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    OffersModule,
    OpenMarketModule,
    MessagingModule,
    WishlistsModule,
    NotificationsModule,
    SupportModule,
    ReviewsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RealtimeThrottlerGuard }],
})
export class AppModule {}
