import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { MessagingService } from './messaging.service.js';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.messaging.listConversations(user.id);
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateConversationDto,
  ) {
    return this.messaging.createConversation(user.id, body.productId);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() body: CreateMessageDto,
  ) {
    return this.messaging.sendMessage(user.id, conversationId, body);
  }

  @Patch('conversations/:id/read')
  markConversationRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
  ) {
    return this.messaging.markRead(user.id, conversationId);
  }
}
