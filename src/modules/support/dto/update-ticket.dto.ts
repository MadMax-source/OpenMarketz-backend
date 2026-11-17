import { SupportTicketStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateTicketDto {
  @IsEnum(SupportTicketStatus)
  status!: SupportTicketStatus;
}
