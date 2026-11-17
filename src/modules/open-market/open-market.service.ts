import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MarketRequestStatus,
  MarketResponseStatus,
  ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateMarketRequestDto } from './dto/create-market-request.dto.js';
import { CreateMarketResponseDto } from './dto/create-market-response.dto.js';

@Injectable()
export class OpenMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listRequests() {
    const items = await this.prisma.marketRequest.findMany({
      where: { status: MarketRequestStatus.OPEN },
      include: {
        category: { select: { slug: true, name: true } },
        buyer: { select: { firstName: true, lastName: true } },
        imageMedia: { select: { secureUrl: true } },
        _count: { select: { responses: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: items.map((request) => this.toRequest(request)) };
  }

  async listMyRequests(userId: string) {
    const items = await this.prisma.marketRequest.findMany({
      where: { buyerId: userId },
      include: {
        category: { select: { slug: true, name: true } },
        buyer: { select: { firstName: true, lastName: true } },
        imageMedia: { select: { secureUrl: true } },
        _count: { select: { responses: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: items.map((request) => this.toRequest(request)) };
  }

  async getRequest(id: string) {
    const request = await this.prisma.marketRequest.findUnique({
      where: { id },
      include: {
        category: { select: { slug: true, name: true } },
        buyer: { select: { firstName: true, lastName: true } },
        imageMedia: { select: { secureUrl: true } },
        _count: { select: { responses: true } },
      },
    });
    if (!request) throw new NotFoundException('Request not found.');
    return this.toRequest(request);
  }

  async createRequest(userId: string, input: CreateMarketRequestDto) {
    if (input.budgetMax < input.budgetMin) {
      throw new BadRequestException(
        'Maximum budget must be at least the minimum budget.',
      );
    }
    const category = await this.prisma.category.findFirst({
      where: { slug: input.categorySlug.toLowerCase(), active: true },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Choose an active category.');
    if (input.imageMediaId) {
      const image = await this.prisma.mediaAsset.findFirst({
        where: {
          id: input.imageMediaId,
          ownerId: userId,
          purpose: 'MARKET_REQUEST',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!image)
        throw new BadRequestException(
          'Upload a valid reference photo before posting.',
        );
    }
    const request = await this.prisma.marketRequest.create({
      data: {
        buyerId: userId,
        categoryId: category.id,
        title: input.title.trim(),
        description: input.description.trim(),
        budgetMinKobo: BigInt(input.budgetMin) * 100n,
        budgetMaxKobo: BigInt(input.budgetMax) * 100n,
        quantity: input.quantity,
        location: input.location.trim(),
        neededBy: input.neededBy ? new Date(input.neededBy) : null,
        condition:
          input.condition === 'new'
            ? 'BRAND_NEW'
            : input.condition === 'used'
              ? 'LOCALLY_USED'
              : null,
        imageMediaId: input.imageMediaId,
      },
      include: {
        category: { select: { slug: true, name: true } },
        buyer: { select: { firstName: true, lastName: true } },
        imageMedia: { select: { secureUrl: true } },
        _count: { select: { responses: true } },
      },
    });
    return this.toRequest(request);
  }

  async listResponses(userId: string, requestId: string) {
    const request = await this.prisma.marketRequest.findUnique({
      where: { id: requestId },
      select: { id: true, buyerId: true },
    });
    if (!request) throw new NotFoundException('Request not found.');
    const isOwner = request.buyerId === userId;
    const seller = await this.prisma.sellerStore.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!isOwner && !seller)
      throw new ForbiddenException(
        'You cannot view responses for this request.',
      );
    const items = await this.prisma.marketResponse.findMany({
      where: {
        requestId,
        ...(isOwner ? {} : { sellerId: seller!.id }),
      },
      include: {
        seller: {
          select: {
            id: true,
            slug: true,
            name: true,
            verified: true,
            rating: true,
          },
        },
        product: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { priceKobo: 'asc' },
    });
    return {
      items: items.map((response) => ({
        id: response.id,
        requestId: response.requestId,
        sellerId: response.seller.id,
        isMine: response.seller.id === seller?.id,
        price: Number(response.priceKobo / 100n),
        deliveryDays: response.deliveryDays,
        note: response.note,
        status: response.status,
        seller: response.seller,
        product: response.product,
        createdAt: response.createdAt,
      })),
    };
  }

  async listMyResponses(userId: string) {
    const seller = await this.prisma.sellerStore.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!seller) return { items: [] };
    const items = await this.prisma.marketResponse.findMany({
      where: { sellerId: seller.id },
      include: {
        seller: {
          select: {
            id: true,
            slug: true,
            name: true,
            verified: true,
            rating: true,
          },
        },
        product: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: items.map((response) => ({
        id: response.id,
        requestId: response.requestId,
        sellerId: response.sellerId,
        isMine: true,
        price: Number(response.priceKobo / 100n),
        deliveryDays: response.deliveryDays,
        note: response.note,
        status: response.status,
        seller: response.seller,
        productId: response.productId,
        product: response.product,
        createdAt: response.createdAt,
      })),
    };
  }

  async getResponse(userId: string, responseId: string) {
    const response = await this.prisma.marketResponse.findUnique({
      where: { id: responseId },
      include: {
        request: {
          include: {
            category: { select: { slug: true, name: true } },
            buyer: { select: { firstName: true, lastName: true } },
            imageMedia: { select: { secureUrl: true } },
            _count: { select: { responses: true } },
          },
        },
        seller: {
          select: {
            id: true,
            slug: true,
            name: true,
            verified: true,
            rating: true,
          },
        },
        product: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!response) throw new NotFoundException('Seller response not found.');
    if (
      response.request.buyerId !== userId &&
      response.sellerUserId !== userId
    ) {
      throw new ForbiddenException('You cannot view this offer.');
    }
    return {
      id: response.id,
      requestId: response.requestId,
      sellerId: response.sellerId,
      isMine: response.sellerUserId === userId,
      price: Number(response.priceKobo / 100n),
      deliveryDays: response.deliveryDays,
      note: response.note,
      status: response.status,
      seller: response.seller,
      productId: response.productId,
      product: response.product,
      createdAt: response.createdAt,
      request: this.toRequest(response.request),
    };
  }

  async createResponse(
    userId: string,
    requestId: string,
    input: CreateMarketResponseDto,
  ) {
    const request = await this.prisma.marketRequest.findUnique({
      where: { id: requestId },
      select: { id: true, buyerId: true, title: true, status: true },
    });
    if (!request) throw new NotFoundException('Request not found.');
    if (request.buyerId === userId)
      throw new ForbiddenException('You cannot respond to your own request.');
    if (request.status !== MarketRequestStatus.OPEN)
      throw new ConflictException('This request is closed.');
    const store = await this.prisma.sellerStore.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!store)
      throw new ForbiddenException('An approved seller account is required.');
    if (input.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: input.productId,
          sellerId: store.id,
          status: ProductStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!product)
        throw new BadRequestException('Choose one of your active products.');
    }
    const created = await this.prisma.marketResponse.create({
      data: {
        requestId,
        sellerId: store.id,
        sellerUserId: userId,
        productId: input.productId,
        priceKobo: BigInt(input.price) * 100n,
        deliveryDays: input.deliveryDays,
        note: input.note.trim(),
      },
      include: {
        seller: {
          select: {
            id: true,
            slug: true,
            name: true,
            verified: true,
            rating: true,
          },
        },
        product: { select: { id: true, slug: true, name: true } },
      },
    });
    await this.notifications.create(
      request.buyerId,
      'MARKET_REQUEST',
      'A seller made an offer',
      `A seller responded to “${request.title}”.`,
      `/open-market/requests/${requestId}`,
    );
    return {
      id: created.id,
      requestId: created.requestId,
      sellerId: created.sellerId,
      seller: created.seller,
      price: Number(created.priceKobo / 100n),
      deliveryDays: created.deliveryDays,
      note: created.note,
      productId: created.productId,
      product: created.product,
      status: created.status,
      createdAt: created.createdAt,
    };
  }

  async acceptResponse(userId: string, responseId: string) {
    const response = await this.prisma.marketResponse.findUnique({
      where: { id: responseId },
      include: {
        request: { select: { buyerId: true, title: true, status: true } },
      },
    });
    if (!response) throw new NotFoundException('Seller response not found.');
    if (response.request.buyerId !== userId)
      throw new ForbiddenException(
        'Only the request owner can accept a response.',
      );
    if (
      response.request.status !== MarketRequestStatus.OPEN ||
      response.status !== MarketResponseStatus.PENDING
    ) {
      throw new ConflictException('This response is no longer available.');
    }
    await this.prisma.$transaction(async (tx) => {
      const requestUpdate = await tx.marketRequest.updateMany({
        where: { id: response.requestId, status: MarketRequestStatus.OPEN },
        data: { status: MarketRequestStatus.ACCEPTED },
      });
      if (requestUpdate.count !== 1)
        throw new ConflictException('Another response was accepted first.');
      const accepted = await tx.marketResponse.updateMany({
        where: { id: responseId, status: MarketResponseStatus.PENDING },
        data: { status: MarketResponseStatus.ACCEPTED },
      });
      if (accepted.count !== 1)
        throw new ConflictException('This response has already changed.');
      await tx.marketResponse.updateMany({
        where: {
          requestId: response.requestId,
          id: { not: responseId },
          status: MarketResponseStatus.PENDING,
        },
        data: { status: MarketResponseStatus.DECLINED },
      });
    });
    await Promise.all([
      this.notifications.create(
        response.sellerUserId,
        'MARKET_REQUEST',
        'Your offer was accepted',
        `Your offer for “${response.request.title}” was accepted. The buyer can now check out.`,
        `/open-market/requests/${response.requestId}`,
      ),
      this.notifications.create(
        userId,
        'MARKET_REQUEST',
        'Offer accepted',
        `You accepted an offer for “${response.request.title}”. Continue to checkout to pay securely.`,
        `/open-market/checkout/${response.id}`,
      ),
    ]);
    return { success: true };
  }

  async declineResponse(userId: string, responseId: string) {
    const response = await this.prisma.marketResponse.findUnique({
      where: { id: responseId },
      include: { request: { select: { buyerId: true, title: true } } },
    });
    if (!response) throw new NotFoundException('Seller response not found.');
    if (response.request.buyerId !== userId)
      throw new ForbiddenException(
        'Only the request owner can decline a response.',
      );
    const result = await this.prisma.marketResponse.updateMany({
      where: { id: responseId, status: MarketResponseStatus.PENDING },
      data: { status: MarketResponseStatus.DECLINED },
    });
    if (!result.count)
      throw new ConflictException('This response is no longer pending.');
    await this.notifications.create(
      response.sellerUserId,
      'MARKET_REQUEST',
      'Your offer was declined',
      `Your offer for “${response.request.title}” was declined.`,
      `/open-market/requests/${response.requestId}`,
    );
    return { success: true };
  }

  private toRequest(request: {
    id: string;
    title: string;
    description: string;
    budgetMinKobo: bigint;
    budgetMaxKobo: bigint;
    quantity: number;
    location: string;
    status: MarketRequestStatus;
    neededBy: Date | null;
    createdAt: Date;
    category: { slug: string; name: string };
    buyerId: string;
    buyer: { firstName: string; lastName: string };
    condition: string | null;
    imageMedia: { secureUrl: string | null } | null;
    _count: { responses: number };
  }) {
    return {
      id: request.id,
      buyerId: request.buyerId,
      title: request.title,
      description: request.description,
      budgetMin: Number(request.budgetMinKobo / 100n),
      budgetMax: Number(request.budgetMaxKobo / 100n),
      quantity: request.quantity,
      location: request.location,
      status: request.status,
      neededBy: request.neededBy,
      createdAt: request.createdAt,
      category: request.category,
      condition:
        request.condition === 'BRAND_NEW'
          ? 'new'
          : request.condition
            ? 'used'
            : 'any',
      image: request.imageMedia?.secureUrl ?? undefined,
      buyerName: `${request.buyer.firstName} ${request.buyer.lastName.slice(0, 1)}.`,
      responseCount: request._count.responses,
    };
  }
}
