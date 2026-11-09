import { IsOptional, IsString, Length } from 'class-validator';

export class CreateMessageDto {
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  text?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  mediaId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  offerId?: string;
}
