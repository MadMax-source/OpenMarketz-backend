import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(2, 60)
  firstName!: string;

  @IsString()
  @Length(2, 60)
  lastName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(/^(?=.*[A-Z])(?=.*\d).{8,128}$/, {
    message:
      'Password must be at least 8 characters and contain an uppercase letter and a number.',
  })
  password!: string;

  @IsOptional()
  @IsString()
  @Length(7, 24)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 3)
  country?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  region?: string;

  @IsDateString()
  birthDate!: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  gender?: string;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}
