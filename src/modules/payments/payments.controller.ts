import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import { Public } from '../../common/public.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { PaymentsService } from './payments.service.js';
import { SavePayoutAccountDto } from './dto/save-payout-account.dto.js';
import { SubmitPaymentOtpDto } from './dto/submit-payment-otp.dto.js';
import { SubmitPaymentChallengeDto } from './dto/submit-payment-challenge.dto.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('methods')
  @ApiBearerAuth()
  listSavedMethods(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.listSavedMethods(user.id);
  }

  @Delete('methods/:id')
  @ApiBearerAuth()
  removeSavedMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.payments.removeSavedMethod(user.id, id);
  }

  @Get('seller/payout-banks')
  @ApiBearerAuth()
  listPayoutBanks() {
    return this.payments.listPayoutBanks();
  }

  @Post('seller/payout-account')
  @ApiBearerAuth()
  saveSellerPayoutAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SavePayoutAccountDto,
  ) {
    return this.payments.saveSellerPayoutAccount(user.id, body);
  }

  @Get(':reference/verify')
  @Public()
  verify(@Param('reference') reference: string) {
    return this.payments.verifyReference(reference);
  }

  @Post(':reference/otp')
  @ApiBearerAuth()
  submitOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body() body: SubmitPaymentOtpDto,
  ) {
    return this.payments.submitOtp(user.id, reference, body.otp);
  }

  @Post(':reference/challenge')
  @ApiBearerAuth()
  submitChallenge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reference') reference: string,
    @Body() body: SubmitPaymentChallengeDto,
  ) {
    return this.payments.submitChallenge(
      user.id,
      reference,
      body.type,
      body.value,
    );
  }

  @Post('paystack/webhook')
  @Public()
  webhook(
    @Req() request: RawBodyRequest,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    return this.payments.verifyWebhook(request.rawBody, signature);
  }
}
