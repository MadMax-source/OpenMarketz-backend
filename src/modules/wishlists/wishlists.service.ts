import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CreateGiftContributionDto } from './dto/create-gift-contribution.dto.js';
import { CreateWishlistDto } from './dto/create-wishlist.dto.js';
import { UpdateWishlistDto } from './dto/update-wishlist.dto.js';

const wishlistInclude = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          priceKobo: true,
          stock: true,
          media: {
            orderBy: { sortOrder: 'asc' as const },
            take: 1,
            select: { media: { select: { secureUrl: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.WishlistInclude;

@Injectable()
export class WishlistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  async list(ownerId: string) {
    const wishlists = await this.prisma.wishlist.findMany({
      where: { ownerId },
      include: {
        ...wishlistInclude,
        gifts: {
          where: { status: 'PAID' },
          include: {
            payment: { select: { reference: true } },
            items: {
              select: { productId: true, quantity: true, amountKobo: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return wishlists.map((wishlist) => ({
      ...this.serializeWishlist(wishlist),
      gifts: wishlist.gifts.map((gift) => ({
        giverName: gift.anonymous ? null : gift.giverName,
        anonymous: gift.anonymous,
        message: gift.message,
        reference: gift.payment.reference,
        createdAt: gift.createdAt,
        items: gift.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          amount: Number(item.amountKobo / 100n),
        })),
      })),
    }));
  }

  async create(ownerId: string, input: CreateWishlistDto) {
    const wishlist = await this.prisma.wishlist.create({
      data: {
        ownerId,
        name: input.name.trim(),
        note: input.note?.trim() ?? '',
        occasion: input.occasion.trim(),
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
      },
      include: wishlistInclude,
    });
    return this.serializeWishlist(wishlist);
  }

  async update(ownerId: string, id: string, input: UpdateWishlistDto) {
    const result = await this.prisma.wishlist.updateMany({
      where: { id, ownerId },
      data: {
        name: input.name?.trim(),
        note: input.note?.trim(),
        occasion: input.occasion?.trim(),
        eventDate: input.eventDate ? new Date(input.eventDate) : undefined,
      },
    });
    if (!result.count) throw new NotFoundException('Wishlist not found.');
    const wishlist = await this.prisma.wishlist.findUniqueOrThrow({
      where: { id },
      include: wishlistInclude,
    });
    return this.serializeWishlist(wishlist);
  }

  async remove(ownerId: string, id: string) {
    const result = await this.prisma.wishlist.deleteMany({
      where: { id, ownerId },
    });
    if (!result.count) throw new NotFoundException('Wishlist not found.');
    return { success: true };
  }

  async addItem(ownerId: string, wishlistId: string, productId: string) {
    await this.requireWishlist(ownerId, wishlistId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.ACTIVE },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Active product not found.');
    try {
      await this.prisma.wishlistItem.create({
        data: { wishlistId, addedById: ownerId, productId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This product is already on the wishlist.');
      }
      throw error;
    }
    const wishlist = await this.prisma.wishlist.findUniqueOrThrow({
      where: { id: wishlistId },
      include: wishlistInclude,
    });
    return this.serializeWishlist(wishlist);
  }

  async removeItem(ownerId: string, wishlistId: string, productId: string) {
    await this.requireWishlist(ownerId, wishlistId);
    const result = await this.prisma.wishlistItem.deleteMany({
      where: { wishlistId, productId },
    });
    if (!result.count) throw new NotFoundException('Wishlist item not found.');
    return { success: true };
  }

  async createShare(ownerId: string, id: string) {
    await this.requireWishlist(ownerId, id);
    const token = randomBytes(32).toString('base64url');
    await this.prisma.wishlist.update({
      where: { id },
      data: {
        visibility: 'SHARED',
        shareTokenHash: this.hash(token),
      },
    });
    return { token };
  }

  async revokeShare(ownerId: string, id: string) {
    const result = await this.prisma.wishlist.updateMany({
      where: { id, ownerId },
      data: { visibility: 'PRIVATE', shareTokenHash: null },
    });
    if (!result.count) throw new NotFoundException('Wishlist not found.');
    return { success: true };
  }

  async getShared(token: string) {
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) {
      throw new NotFoundException('Shared wishlist not found.');
    }
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { shareTokenHash: this.hash(token) },
      include: {
        ...wishlistInclude,
        owner: { select: { firstName: true, region: true } },
        gifts: {
          where: { status: 'PAID' },
          select: { items: { select: { productId: true } } },
        },
      },
    });
    if (!wishlist || wishlist.visibility !== 'SHARED') {
      throw new NotFoundException('Shared wishlist not found.');
    }
    return {
      id: wishlist.id,
      name: wishlist.name,
      note: wishlist.note,
      occasion: wishlist.occasion,
      eventDate: wishlist.eventDate,
      owner: wishlist.owner,
      giftedProductIds: [
        ...new Set(
          wishlist.gifts.flatMap((gift) =>
            gift.items.map((item) => item.productId),
          ),
        ),
      ],
      items: wishlist.items.map((item) => ({
        id: item.id,
        product: {
          ...item.product,
          price: Number(item.product.priceKobo / 100n),
          priceKobo: undefined,
          image: item.product.media[0]?.media.secureUrl ?? null,
        },
      })),
    };
  }

  async createContribution(token: string, input: CreateGiftContributionDto) {
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) {
      throw new NotFoundException('Shared wishlist not found.');
    }
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { shareTokenHash: this.hash(token) },
      include: {
        items: {
          include: {
            product: {
              include: { seller: { select: { id: true, active: true } } },
            },
          },
        },
        owner: {
          select: {
            id: true,
            addresses: { where: { isDefault: true }, take: 1 },
          },
        },
      },
    });
    if (!wishlist || wishlist.visibility !== 'SHARED') {
      throw new NotFoundException('Shared wishlist not found.');
    }
    const address = wishlist.owner.addresses[0];
    if (!address) {
      throw new ConflictException(
        'The wishlist owner has not added a delivery address yet.',
      );
    }

    const itemData: Prisma.OrderItemCreateWithoutOrderInput[] = [];
    const giftItems: {
      productId: string;
      quantity: number;
      amountKobo: bigint;
    }[] = [];
    let subtotalKobo = 0n;
    for (const gift of input.items) {
      const listItem = wishlist.items.find(
        (item) => item.productId === gift.productId,
      );
      if (
        !listItem ||
        listItem.product.status !== ProductStatus.ACTIVE ||
        !listItem.product.seller.active
      ) {
        throw new BadRequestException(
          'Gifts can only include active items on this wishlist.',
        );
      }
      if (gift.quantity > listItem.product.stock) {
        throw new ConflictException(
          `${listItem.product.name} is not available in that quantity.`,
        );
      }
      const amountKobo = listItem.product.priceKobo * BigInt(gift.quantity);
      subtotalKobo += amountKobo;
      giftItems.push({
        productId: gift.productId,
        quantity: gift.quantity,
        amountKobo,
      });
      itemData.push({
        product: { connect: { id: listItem.product.id } },
        seller: { connect: { id: listItem.product.seller.id } },
        productName: listItem.product.name,
        productSlug: listItem.product.slug,
        quantity: gift.quantity,
        unitPriceKobo: listItem.product.priceKobo,
        options: {},
      });
    }
    const deliveryFeeKobo = this.orders.getDeliveryFeeKobo(
      address.state,
      address.area ?? address.city,
      'standard',
    );
    const serviceFeeKobo = (subtotalKobo * 150n + 5_000n) / 10_000n;
    const totalKobo = subtotalKobo + deliveryFeeKobo + serviceFeeKobo;

    const created = await this.prisma.$transaction(async (tx) => {
      for (const item of giftItems) {
        const reserved = await tx.product.updateMany({
          where: {
            id: item.productId,
            status: ProductStatus.ACTIVE,
            stock: { gte: item.quantity },
          },
          data: { stock: { decrement: item.quantity } },
        });
        if (reserved.count !== 1) {
          throw new ConflictException(
            'A wishlist item is no longer available.',
          );
        }
      }
      const order = await tx.order.create({
        data: {
          orderNumber: `OMZ-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
          buyerId: wishlist.owner.id,
          addressId: address.id,
          currency: 'NGN',
          subtotalKobo,
          deliveryFeeKobo,
          serviceFeeKobo,
          totalKobo,
          status: 'PENDING_PAYMENT',
          deliveryMethod: 'standard',
          addressSnapshot: {
            fullName: address.fullName,
            phone: address.phone,
            line1: address.line1,
            city: address.city,
            state: address.state,
            country: address.country,
            landmark: address.landmark,
            latitude: address.latitude,
            longitude: address.longitude,
          },
          items: { create: itemData },
        },
        select: { id: true },
      });
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: PaymentProvider.PAYSTACK,
          reference: `omz_gift_${randomUUID().replaceAll('-', '')}`,
          amountKobo: totalKobo,
          status: PaymentStatus.INITIALIZED,
          payerEmail: input.email.trim().toLowerCase(),
          metadata: { gift: true, wishlistId: wishlist.id },
        },
        select: { id: true },
      });
      await tx.giftContribution.create({
        data: {
          wishlistId: wishlist.id,
          orderId: order.id,
          paymentId: payment.id,
          giverName: input.anonymous ? null : input.giverName?.trim() || null,
          giverEmail: input.email.trim().toLowerCase(),
          anonymous: input.anonymous ?? false,
          message: input.message?.trim() || null,
          status: 'PENDING',
          items: {
            create: giftItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              amountKobo: item.amountKobo,
            })),
          },
        },
      });
      return { orderId: order.id, paymentId: payment.id };
    });

    try {
      const payment = await this.payments.initializeExistingPayment(
        wishlist.owner.id,
        created.paymentId,
        input.email.trim().toLowerCase(),
      );
      return { orderId: created.orderId, payment };
    } catch (error) {
      await this.cancelGiftOrder(created.orderId);
      throw error;
    }
  }

  private async requireWishlist(ownerId: string, id: string) {
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    if (!wishlist) throw new NotFoundException('Wishlist not found.');
    if (wishlist.ownerId !== ownerId)
      throw new ForbiddenException('You cannot edit this wishlist.');
    return wishlist;
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private serializeWishlist(
    wishlist: Prisma.WishlistGetPayload<{ include: typeof wishlistInclude }>,
  ) {
    return {
      ...wishlist,
      items: wishlist.items.map((item) => ({
        ...item,
        product: {
          ...item.product,
          price: Number(item.product.priceKobo / 100n),
          priceKobo: undefined,
          image: item.product.media[0]?.media.secureUrl ?? null,
        },
      })),
    };
  }

  private async cancelGiftOrder(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, status: 'PENDING_PAYMENT' },
        include: { items: true },
      });
      if (!order) return;
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await tx.giftContribution.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.INITIALIZED },
        data: { status: PaymentStatus.FAILED },
      });
      for (const item of order.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    });
  }
}
