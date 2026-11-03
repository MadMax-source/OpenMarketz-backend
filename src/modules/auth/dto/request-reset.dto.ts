import { IsEmail, MaxLength } from 'class-validator';

export class RequestResetDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
