import { MediaPurpose } from '@prisma/client';
import { IsEnum, IsString, Length } from 'class-validator';

export class FinalizeUploadDto {
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @IsString()
  @Length(10, 300)
  publicId!: string;
}
