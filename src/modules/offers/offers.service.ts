import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationKind,
  MediaPurpose,
  OfferStatus,
  ProductStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { CreateOfferDto } from './dto/create-offer.dto.js';
import { RespondToOfferDto } from './dto/respond-to-offer.dto.js';

const offerInclude = {
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
      seller: {
        select: {
          id: true,
          ownerId: true,
          slug: true,
          name: true,
        },
      },
    },
  },
  buyer: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProductOfferInclude;

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async listOffers(userId: string) {
    const offers = await this.prisma.productOffer.findMany({
      where: {
        OR: [{ buyerId: userId }, { seller: { ownerId: userId } }],
      },
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
    });
    const messages = await this.prisma.message.findMany({
      where: {
        offerId: { in: offers.map((offer) => offer.id) },
        mediaId: { not: null },
      },
      select: {
        offerId: true,
        media: { select: { secureUrl: true, durationSeconds: true } },
      },
    });
    const voiceNotes = new Map(
      messages
        .filter((message) => message.offerId && message.media?.secureUrl)
        .map((message) => [
          message.offerId!,
          {
            url: message.media!.secureUrl!,
            duration: Number(message.media!.durationSeconds ?? 0),
          },
        ]),
    );

    return {
      items: offers.map((offer) =>
        this.toOffer(offer, voiceNotes.get(offer.id)),
      ),
    };
  }

  async createOffer(userId: string, input: CreateOfferDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: input.productId,
        status: ProductStatus.ACTIVE,
        seller: { active: true },
      },
      select: {
        id: true,
        priceKobo: true,
        stock: true,
        negotiable: true,
        sellerId: true,
        seller: { select: { ownerId: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.seller.ownerId === userId) {
      throw new ForbiddenException(
        'You cannot make an offer on your own product.',
      );
    }
    if (!product.negotiable) {
      throw new BadRequestException('This product is not open to offers.');
    }
    if (input.quantity > product.stock) {
      throw new BadRequestException('The requested quantity is not available.');
    }

    const listPriceKobo = product.priceKobo;
    const offerPriceKobo = BigInt(input.offerPrice) * 100n;
    const message = input.message?.trim() || null;
    if (input.mediaId) {
      const media = await this.prisma.mediaAsset.findFirst({
        where: {
          id: input.mediaId,
          ownerId: userId,
          purpose: MediaPurpose.MESSAGE,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!media) {
        throw new ForbiddenException('Upload a valid offer voice note first.');
      }
    }

    const createdResult = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productOffer.create({
        data: {
          buyerId: userId,
          sellerId: product.sellerId,
          productId: product.id,
          quantity: input.quantity,
          listPriceKobo,
          offerPriceKobo,
          message,
        },
      });

      const conversation = await this.findOrCreateConversation(
        tx,
        userId,
        product.seller.ownerId,
        product.id,
      );
      await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          text: message,
          mediaId: input.mediaId,
          offerId: created.id,
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      const offer = await tx.productOffer.findUniqueOrThrow({
        where: { id: created.id },
        include: offerInclude,
      });
      return { offer, conversationId: conversation.id };
    });

    const offer = this.toOffer(createdResult.offer);
    this.realtime.publishConversationAvailable(
      [userId, product.seller.ownerId],
      createdResult.conversationId,
    );
    this.realtime.publishOffer(createdResult.conversationId, offer);
    return offer;
  }

  async respondToOffer(
    userId: string,
    offerId: string,
    input: RespondToOfferDto,
  ) {
    const existing = await this.prisma.productOffer.findUnique({
      where: { id: offerId },
      include: { seller: { select: { ownerId: true } } },
    });
    if (!existing) throw new NotFoundException('Offer not found.');

    const isSeller = existing.seller.ownerId === userId;
    const isBuyer = existing.buyerId === userId;
    if (!isSeller && !isBuyer) {
      throw new ForbiddenException('You cannot respond to this offer.');
    }
    if (isSeller && existing.status !== OfferStatus.PENDING) {
      throw new ConflictException(
        'This offer is no longer awaiting a seller response.',
      );
    }
    if (isBuyer && existing.status !== OfferStatus.COUNTERED) {
      throw new ConflictException(
        'There is no seller counter-offer to respond to.',
      );
    }
    if (
      input.action === 'counter' &&
      (!isSeller || input.counterPrice === undefined)
    ) {
      throw new BadRequestException('A counter-offer price is required.');
    }
    if (input.action !== 'counter' && input.counterPrice !== undefined) {
      throw new BadRequestException(
        'A counter-offer price is only valid for a counter action.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ProductOfferUpdateInput = {
        respondedAt: new Date(),
      };
      if (input.action === 'counter') {
        data.status = OfferStatus.COUNTERED;
        data.counterPriceKobo = BigInt(input.counterPrice!) * 100n;
      } else if (input.action === 'decline') {
        data.status = OfferStatus.DECLINED;
      } else if (isBuyer) {
        data.status = OfferStatus.ACCEPTED;
        data.offerPriceKobo =
          existing.counterPriceKobo ?? existing.offerPriceKobo;
      } else {
        data.status = OfferStatus.ACCEPTED;
      }

      const update = await tx.productOffer.updateMany({
        where: { id: offerId, status: existing.status },
        data,
      });
      if (update.count !== 1) {
        throw new ConflictException('This offer has already been updated.');
      }
      const offer = await tx.productOffer.findUniqueOrThrow({
        where: { id: offerId },
        include: offerInclude,
      });
      const conversation = await this.findOrCreateConversation(
        tx,
        existing.buyerId,
        existing.seller.ownerId,
        existing.productId,
      );
      const responseText =
        input.action === 'counter'
          ? `Seller counter-offered ₦${input.counterPrice!.toLocaleString('en-NG')}.`
          : input.action === 'accept'
            ? isSeller
              ? 'Seller accepted your offer.'
              : 'Buyer accepted the counter-offer.'
            : isSeller
              ? 'Seller declined your offer.'
              : 'Buyer declined the counter-offer.';
      await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          text: responseText,
          offerId,
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
      return { offer, conversationId: conversation.id };
    });

    const offer = this.toOffer(updated.offer);
    this.realtime.publishOffer(updated.conversationId, offer);
    return offer;
  }

  private async findOrCreateConversation(
    tx: Prisma.TransactionClient,
    buyerId: string,
    sellerOwnerId: string,
    productId: string,
  ) {
    const existing = await tx.conversation.findFirst({
      where: {
        kind: ConversationKind.PRODUCT,
        productId,
        participants: { some: { userId: buyerId } },
        AND: [{ participants: { some: { userId: sellerOwnerId } } }],
      },
      select: { id: true },
    });
    if (existing) return existing;

    return tx.conversation.create({
      data: {
        kind: ConversationKind.PRODUCT,
        productId,
        participants: {
          create: [{ userId: buyerId }, { userId: sellerOwnerId }],
        },
      },
      select: { id: true },
    });
  }

  private toOffer(
    offer: Prisma.ProductOfferGetPayload<{ include: typeof offerInclude }>,
    voiceNote?: { url: string; duration: number },
  ) {
    return {
      id: offer.id,
      buyerId: offer.buyerId,
      buyer: {
        id: offer.buyer.id,
        name: `${offer.buyer.firstName} ${offer.buyer.lastName}`.trim(),
      },
      sellerId: offer.sellerId,
      productId: offer.productId,
      product: {
        id: offer.product.id,
        slug: offer.product.slug,
        name: offer.product.name,
        image: offer.product.media[0]?.media.secureUrl ?? undefined,
      },
      sellerName: offer.product.seller.name,
      quantity: offer.quantity,
      listPrice: Number(offer.listPriceKobo) / 100,
      offerPrice: Number(offer.offerPriceKobo) / 100,
      counterPrice: offer.counterPriceKobo
        ? Number(offer.counterPriceKobo) / 100
        : undefined,
      message: offer.message ?? undefined,
      voiceNote,
      status: offer.status.toLowerCase(),
      createdAt: offer.createdAt,
      respondedAt: offer.respondedAt ?? undefined,
    };
  }
}
