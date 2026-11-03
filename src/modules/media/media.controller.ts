import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import { FinalizeUploadDto } from './dto/finalize-upload.dto.js';
import { CloudinaryService } from './cloudinary.service.js';

@ApiTags('Media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  @Post('upload-intents')
  createUploadIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateUploadIntentDto,
  ) {
    return this.cloudinary.createUploadIntent(user.id, body);
  }

  @Post('finalize')
  finalizeUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: FinalizeUploadDto,
  ) {
    return this.cloudinary.finalizeUpload(user.id, body.purpose, body.publicId);
  }
}
