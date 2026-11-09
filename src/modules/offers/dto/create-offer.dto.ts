import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateOfferDto {
  @IsString()
  @Length(1, 191)
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000_000)
  offerPrice!: number;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  message?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  mediaId?: string;
}
