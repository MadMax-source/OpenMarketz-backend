import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class UpdateWishlistDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  occasion?: string;

  @IsOptional()
  @IsDateString()
  eventDate?: string;
}
