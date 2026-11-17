import { IsString, Length, Matches } from 'class-validator';

export class SavePayoutAccountDto {
  @IsString()
  @Length(1, 24)
  bankCode!: string;

  @IsString()
  @Length(2, 100)
  bankName!: string;

  @IsString()
  @Matches(/^\d{8,20}$/)
  accountNumber!: string;
}
