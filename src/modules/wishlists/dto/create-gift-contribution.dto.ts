import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class GiftItemDto {
  @IsString()
  @Length(1, 191)
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class CreateGiftContributionDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  giverName?: string;

  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  message?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GiftItemDto)
  items!: GiftItemDto[];
}
