import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class CreateWishlistDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsString()
  @Length(2, 40)
  occasion!: string;

  @IsOptional()
  @IsDateString()
  eventDate?: string;
}
