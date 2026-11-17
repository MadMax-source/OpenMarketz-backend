import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Public } from '../../common/public.decorator.js';
import { CreateWishlistDto } from './dto/create-wishlist.dto.js';
import { CreateGiftContributionDto } from './dto/create-gift-contribution.dto.js';
import { UpdateWishlistDto } from './dto/update-wishlist.dto.js';
import { WishlistsService } from './wishlists.service.js';

@ApiTags('Wishlists')
@Controller('wishlists')
export class WishlistsController {
  constructor(private readonly wishlists: WishlistsService) {}

  @Get()
  @ApiBearerAuth()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.wishlists.list(user.id);
  }

  @Post()
  @ApiBearerAuth()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateWishlistDto,
  ) {
    return this.wishlists.create(user.id, body);
  }

  @Put(':id')
  @ApiBearerAuth()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateWishlistDto,
  ) {
    return this.wishlists.update(user.id, id, body);
  }

  @Delete(':id')
  @ApiBearerAuth()
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.wishlists.remove(user.id, id);
  }

  @Post(':id/items/:productId')
  @ApiBearerAuth()
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.wishlists.addItem(user.id, id, productId);
  }

  @Delete(':id/items/:productId')
  @ApiBearerAuth()
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.wishlists.removeItem(user.id, id, productId);
  }

  @Post(':id/share')
  @ApiBearerAuth()
  createShare(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.wishlists.createShare(user.id, id);
  }

  @Delete(':id/share')
  @ApiBearerAuth()
  revokeShare(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.wishlists.revokeShare(user.id, id);
  }

  @Public()
  @Get('shared/:token')
  getShared(@Param('token') token: string) {
    return this.wishlists.getShared(token);
  }

  @Public()
  @Post('shared/:token/contributions')
  createContribution(
    @Param('token') token: string,
    @Body() body: CreateGiftContributionDto,
  ) {
    return this.wishlists.createContribution(token, body);
  }
}
