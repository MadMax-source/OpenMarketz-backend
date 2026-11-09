import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSellerApplicationDto {
  @IsString()
  @Length(2, 100)
  brandName!: string;

  @IsString()
  @Matches(/^[a-z0-9-]{3,30}$/)
  handle!: string;

  @IsString()
  @Length(40, 2000)
  description!: string;

  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  categories!: string[];

  @IsIn(['individual', 'registered'])
  businessType!: 'individual' | 'registered';

  @IsOptional()
  @IsString()
  @Length(5, 40)
  registrationNumber?: string;

  @IsString()
  @Length(7, 24)
  businessPhone!: string;

  @IsEmail()
  @MaxLength(254)
  businessEmail!: string;

  @IsString()
  @Length(2, 3)
  country!: string;

  @IsString()
  @Length(2, 80)
  region!: string;

  @IsString()
  @Length(2, 80)
  city!: string;

  @IsString()
  @Length(8, 200)
  address!: string;

  @IsString()
  @Length(4, 120)
  ownerName!: string;

  @IsDateString()
  ownerBirthDate!: string;

  @IsString()
  @Length(2, 40)
  idType!: string;

  @IsString()
  @Length(4, 80)
  idNumber!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  bankCode?: string;

  @IsString()
  @Length(2, 100)
  bankName!: string;

  @IsString()
  @Matches(/^\d{8,20}$/)
  accountNumber!: string;

  @IsString()
  @Length(3, 120)
  accountName!: string;

  @IsString()
  @Length(1, 100)
  logoMediaId!: string;

  @IsString()
  @Length(1, 100)
  bannerMediaId!: string;

  @IsString()
  @Length(1, 100)
  idDocumentMediaId!: string;

  @IsString()
  @Length(1, 100)
  selfieMediaId!: string;
}
