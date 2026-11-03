import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { CreateSellerApplicationDto } from './dto/create-seller-application.dto.js';
import { SellersService } from './sellers.service.js';

@ApiTags('Seller onboarding')
@ApiBearerAuth()
@Controller('seller')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  @Post('applications')
  submitApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSellerApplicationDto,
  ) {
    return this.sellers.submitApplication(user.id, body);
  }

  @Get('applications/me')
  getMyApplication(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.getMyApplication(user.id);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.getSellerDashboard(user.id);
  }
}
