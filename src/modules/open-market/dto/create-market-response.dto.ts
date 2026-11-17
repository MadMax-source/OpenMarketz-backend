import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateMarketResponseDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  price!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  deliveryDays!: number;

  @IsString()
  @Length(5, 1000)
  note!: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  productId?: string;
}
