import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { CreateOfferDto } from './dto/create-offer.dto.js';
import { RespondToOfferDto } from './dto/respond-to-offer.dto.js';
import { OffersService } from './offers.service.js';

@ApiTags('Offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  listOffers(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.listOffers(user.id);
  }

  @Post()
  createOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateOfferDto,
  ) {
    return this.offers.createOffer(user.id, body);
  }

  @Patch(':id/respond')
  respondToOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: RespondToOfferDto,
  ) {
    return this.offers.respondToOffer(user.id, id, body);
  }
}
