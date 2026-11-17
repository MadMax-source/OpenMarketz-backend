import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Public } from '../../common/public.decorator.js';
import { Roles } from '../../common/roles.decorator.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ReplyTicketDto } from './dto/reply-ticket.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';
import { SupportService } from './support.service.js';

type OptionalUserRequest = Request & { user?: AuthenticatedUser };

@ApiTags('Support')
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Public()
  create(@Req() request: OptionalUserRequest, @Body() body: CreateTicketDto) {
    return this.support.create(request.user?.id, body);
  }

  @Get()
  @ApiBearerAuth()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listMine(user.id);
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  listAll() {
    return this.support.listAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.support.get(user, id);
  }

  @Post(':id/replies')
  @ApiBearerAuth()
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ReplyTicketDto,
  ) {
    return this.support.reply(user, id, body);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() body: UpdateTicketDto) {
    return this.support.updateStatus(id, body.status);
  }
}
