import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Roles } from '../../common/roles.decorator.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { CheckoutQuoteDto } from './dto/checkout-quote.dto.js';
import { UpdateShipmentDto } from './dto/update-shipment.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('checkout')
  checkout(@CurrentUser() user: AuthenticatedUser, @Body() body: CheckoutDto) {
    return this.orders.checkout(user.id, body);
  }

  @Get('quote')
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CheckoutQuoteDto,
  ) {
    return this.orders.quote(user.id, query);
  }

  @Get('open-market/:responseId/quote')
  quoteMarketResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('responseId') responseId: string,
    @Query() query: CheckoutQuoteDto,
  ) {
    return this.orders.quoteMarketResponse(user.id, responseId, query);
  }

  @Post('open-market/:responseId/checkout')
  checkoutMarketResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('responseId') responseId: string,
    @Body() body: CheckoutDto,
  ) {
    return this.orders.checkoutMarketResponse(user.id, responseId, body);
  }

  @Get()
  listBuyerOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listBuyerOrders(user.id);
  }

  @Get('seller')
  listSellerOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listSellerOrders(user.id);
  }

  @Get(':id')
  getOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.getOrder(user, id);
  }

  @Patch(':id/shipment')
  updateShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateShipmentDto,
  ) {
    return this.orders.updateShipment(user.id, id, body);
  }

  @Patch(':id/admin-delivered')
  @Roles(UserRole.ADMIN)
  markDelivered(@Param('id') id: string) {
    return this.orders.markDeliveredByAdmin(id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.cancelUnpaidOrder(user.id, id);
  }

  @Post(':id/confirm-delivery')
  confirmBuyerDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.orders.confirmBuyerDelivery(user.id, id);
  }

  @Post(':id/admin-confirm-delivery')
  @Roles(UserRole.ADMIN)
  confirmAdminDelivery(@Param('id') id: string) {
    return this.orders.confirmAdminDelivery(id);
  }
}
