import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @Length(1, 191)
  addressId!: string;

  @IsOptional()
  @IsIn(['standard', 'express', 'pickup'])
  deliveryMethod?: 'standard' | 'express' | 'pickup';

  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  savedPaymentMethodId?: string;
}
