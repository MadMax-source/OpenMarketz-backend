import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Public } from '../../common/public.decorator.js';
import { CreateMarketRequestDto } from './dto/create-market-request.dto.js';
import { CreateMarketResponseDto } from './dto/create-market-response.dto.js';
import { OpenMarketService } from './open-market.service.js';

@ApiTags('Open Market')
@Controller('open-market')
export class OpenMarketController {
  constructor(private readonly market: OpenMarketService) {}

  @Public()
  @Get('requests')
  listRequests() {
    return this.market.listRequests();
  }

  @Get('requests/mine')
  @ApiBearerAuth()
  listMyRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.market.listMyRequests(user.id);
  }

  @Public()
  @Get('requests/:id')
  getRequest(@Param('id') id: string) {
    return this.market.getRequest(id);
  }

  @Get('responses/mine')
  @ApiBearerAuth()
  listMyResponses(@CurrentUser() user: AuthenticatedUser) {
    return this.market.listMyResponses(user.id);
  }

  @Get('responses/:id')
  @ApiBearerAuth()
  getResponse(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.market.getResponse(user.id, id);
  }

  @Get('requests/:id/responses')
  @ApiBearerAuth()
  listResponses(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.market.listResponses(user.id, id);
  }

  @Post('requests')
  @ApiBearerAuth()
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMarketRequestDto,
  ) {
    return this.market.createRequest(user.id, body);
  }

  @Post('requests/:id/responses')
  @ApiBearerAuth()
  createResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CreateMarketResponseDto,
  ) {
    return this.market.createResponse(user.id, id, body);
  }

  @Patch('responses/:id/accept')
  @ApiBearerAuth()
  acceptResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.market.acceptResponse(user.id, id);
  }

  @Patch('responses/:id/decline')
  @ApiBearerAuth()
  declineResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.market.declineResponse(user.id, id);
  }
}
