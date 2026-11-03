import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  lastName?: string;

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

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  gender?: string;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  avatarMediaId?: string;
}
