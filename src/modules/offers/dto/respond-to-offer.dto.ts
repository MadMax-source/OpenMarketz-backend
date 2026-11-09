import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class RespondToOfferDto {
  @IsIn(['accept', 'decline', 'counter'])
  action!: 'accept' | 'decline' | 'counter';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000_000)
  counterPrice?: number;
}
