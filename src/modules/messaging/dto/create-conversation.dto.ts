import { IsString, Length } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @Length(1, 191)
  productId!: string;
}
