import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductCondition, ProductStatus } from '@prisma/client';
import { ProductVariantDto } from './product-variant.dto.js';

export class CreateProductDto {
  @IsString()
  @Length(4, 140)
  name!: string;

  @IsString()
  @Length(1, 100)
  brand!: string;

  @IsString()
  @Length(2, 80)
  categorySlug!: string;

  @IsInt()
  @Min(100)
  @Max(100_000_000_000)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(101)
  @Max(100_000_000_000)
  compareAt?: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock!: number;

  @IsString()
  @Length(30, 5000)
  description!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 180, { each: true })
  highlights!: string[];

  @IsOptional()
  @IsObject()
  specifications?: Record<string, string>;

  @IsEnum(ProductCondition)
  condition!: ProductCondition;

  @IsBoolean()
  freeDelivery!: boolean;

  @IsBoolean()
  negotiable!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000_000)
  minPrice?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  mediaIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @IsOptional()
  @IsString()
  @Length(1, 30)
  unitLabel?: string;

  @IsOptional()
  @IsIn([ProductStatus.DRAFT, ProductStatus.ACTIVE, ProductStatus.PAUSED])
  status?: ProductStatus;
}
