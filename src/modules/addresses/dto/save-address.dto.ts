import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class SaveAddressDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsString()
  @Length(7, 24)
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(5, 200)
  googlePlaceId?: string;

  @IsOptional()
  @IsString()
  @Length(5, 191)
  line1?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  state?: string;

  @IsIn(['Home', 'Work', 'Other'])
  label!: string;

  @IsOptional()
  @IsString()
  @Length(0, 191)
  landmark?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
