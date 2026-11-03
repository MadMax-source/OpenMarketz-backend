import { IsArray, IsString, Length } from 'class-validator';

export class ProductVariantDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  options!: string[];
}
