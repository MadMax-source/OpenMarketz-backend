import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Public } from '../../common/public.decorator.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('products/:productId')
  listProductReviews(@Param('productId') productId: string) {
    return this.reviews.listProductReviews(productId);
  }

  @Post('products/:productId')
  @ApiBearerAuth()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
    @Body() body: CreateReviewDto,
  ) {
    return this.reviews.create(user.id, productId, body);
  }
}
