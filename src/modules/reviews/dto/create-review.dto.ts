import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @Length(1, 191)
  orderItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  body?: string;
}
