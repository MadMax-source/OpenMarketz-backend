import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';

@Module({
  imports: [RealtimeModule],
  controllers: [MessagingController],
  providers: [MessagingService],
})
export class MessagingModule {}
