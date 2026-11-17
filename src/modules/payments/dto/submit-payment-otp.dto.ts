import { IsString, Matches } from 'class-validator';

export class SubmitPaymentOtpDto {
  @IsString()
  @Matches(/^\d{4,8}$/)
  otp!: string;
}
