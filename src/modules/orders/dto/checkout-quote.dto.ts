import { IsIn, IsString, Length } from 'class-validator';

export class CheckoutQuoteDto {
  @IsString()
  @Length(1, 191)
  addressId!: string;

  @IsIn(['standard', 'express', 'pickup'])
  deliveryMethod!: 'standard' | 'express' | 'pickup';
}
