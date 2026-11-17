import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateCartItemDto {
  @IsString()
  @Length(1, 191)
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;

  @IsOptional()
  @IsObject()
  options?: Record<string, string>;
}
