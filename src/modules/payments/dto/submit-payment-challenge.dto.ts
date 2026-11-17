import { IsIn, IsString, Length } from 'class-validator';

export class SubmitPaymentChallengeDto {
  @IsIn(['otp', 'pin', 'phone', 'birthday'])
  type!: 'otp' | 'pin' | 'phone' | 'birthday';

  @IsString()
  @Length(1, 100)
  value!: string;
}
