import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateTicketDto {
  @IsOptional()
  @IsString()
  @Length(1, 191)
  orderId?: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(2, 80)
  topic!: string;

  @IsString()
  @Length(10, 5000)
  message!: string;
}
