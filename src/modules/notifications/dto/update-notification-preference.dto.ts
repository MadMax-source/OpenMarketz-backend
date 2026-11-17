import { NotificationType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}
