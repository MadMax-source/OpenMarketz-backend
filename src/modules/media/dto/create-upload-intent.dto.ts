import { MediaPurpose } from '@prisma/client';
import { IsEnum, IsString, Matches } from 'class-validator';

export class CreateUploadIntentDto {
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @IsString()
  @Matches(/^[a-zA-Z0-9/+.-]{3,100}$/)
  contentType!: string;
}
