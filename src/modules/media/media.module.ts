import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { CloudinaryService } from './cloudinary.service.js';

@Module({
  controllers: [MediaController],
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class MediaModule {}
