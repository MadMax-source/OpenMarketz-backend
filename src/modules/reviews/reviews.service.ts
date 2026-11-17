import { ConflictException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async listProductReviews(productId: string) {
    const items = await this.prisma.review.findMany({
      where: { productId, published: true },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: items.map((review) => ({
        id: review.id,
        rating: review.rating,
        body: review.body,
        createdAt: review.createdAt,
        reviewer: `${review.user.firstName} ${review.user.lastName.slice(0, 1)}.`,
      })),
    };
  }

  async create(userId: string, productId: string, input: CreateReviewDto) {
    const orderItem = await this.prisma.orderItem.findFirst({
      where: {
        id: input.orderItemId,
        productId,
        order: { buyerId: userId, status: OrderStatus.DELIVERED },
      },
      select: { id: true, sellerId: true },
    });
    if (!orderItem) {
      throw new ConflictException(
        'Reviews are available only for products in delivered orders.',
      );
    }

    try {
      const review = await this.prisma.$transaction(async (tx) => {
        const created = await tx.review.create({
          data: {
            userId,
            productId,
            sellerId: orderItem.sellerId,
            orderItemId: orderItem.id,
            rating: input.rating,
            body: input.body?.trim() || null,
            published: true,
          },
        });
        const [productStats, sellerStats] = await Promise.all([
          tx.review.aggregate({
            where: { productId, published: true },
            _avg: { rating: true },
            _count: { _all: true },
          }),
          tx.review.aggregate({
            where: { sellerId: orderItem.sellerId, published: true },
            _avg: { rating: true },
            _count: { _all: true },
          }),
        ]);
        await Promise.all([
          tx.product.update({
            where: { id: productId },
            data: {
              averageRating: new Prisma.Decimal(productStats._avg.rating ?? 0),
              reviewCount: productStats._count._all,
            },
          }),
          tx.sellerStore.update({
            where: { id: orderItem.sellerId },
            data: {
              rating: new Prisma.Decimal(sellerStats._avg.rating ?? 0),
              reviewCount: sellerStats._count._all,
            },
          }),
        ]);
        return created;
      });
      return review;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You have already reviewed this purchased item.',
        );
      }
      throw error;
    }
  }
}
