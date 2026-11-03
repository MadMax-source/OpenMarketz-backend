import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @Matches(/^(?=.*[A-Z])(?=.*\d).{8,128}$/)
  newPassword!: string;
}
