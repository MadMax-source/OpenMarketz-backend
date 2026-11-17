import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateMarketRequestDto {
  @IsString()
  @Length(1, 80)
  categorySlug!: string;

  @IsString()
  @Length(5, 120)
  title!: string;

  @IsString()
  @Length(20, 2000)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  budgetMin!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  budgetMax!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity = 1;

  @IsString()
  @Length(2, 120)
  location!: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsIn(['new', 'used', 'any'])
  condition?: 'new' | 'used' | 'any';

  @IsOptional()
  @IsString()
  @Length(1, 191)
  imageMediaId?: string;
}
