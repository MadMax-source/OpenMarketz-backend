import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { CartService } from './cart.service.js';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  getCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.getCart(user.id);
  }

  @Put('items')
  upsertItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateCartItemDto,
  ) {
    return this.cart.upsertItem(user.id, body);
  }

  @Delete('items/:id')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') itemId: string,
  ) {
    return this.cart.removeItem(user.id, itemId);
  }

  @Delete()
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.clear(user.id);
  }
}
