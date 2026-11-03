import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewSellerApplicationDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
