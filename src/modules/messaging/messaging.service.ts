import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationKind,
  MediaPurpose,
  ProductStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { CreateMessageDto } from './dto/create-message.dto.js';

const conversationInclude = {
  participants: {
    select: {
      userId: true,
      lastReadAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  product: {
    select: {
      id: true,
      slug: true,
      name: true,
      priceKobo: true,
      seller: { select: { id: true, ownerId: true, name: true } },
      media: {
        orderBy: { sortOrder: 'asc' as const },
        take: 1,
        select: { media: { select: { secureUrl: true } } },
      },
    },
  },
  messages: {
    orderBy: { sentAt: 'asc' as const },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      media: { select: { secureUrl: true, resourceType: true } },
    },
  },
} satisfies Prisma.ConversationInclude;

type ConversationRecord = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async listConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: conversationInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return conversations.map((conversation) =>
      this.toConversation(conversation, userId),
    );
  }

  async createConversation(userId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: ProductStatus.ACTIVE,
        seller: { active: true },
      },
      select: { id: true, seller: { select: { ownerId: true } } },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.seller.ownerId === userId) {
      throw new ForbiddenException(
        'You cannot start a conversation with yourself.',
      );
    }

    const conversation = await this.findOrCreateConversation(
      userId,
      product.seller.ownerId,
      product.id,
    );
    this.realtime.publishConversationAvailable(
      [userId, product.seller.ownerId],
      conversation.id,
    );
    return this.toConversation(conversation, userId);
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    input: CreateMessageDto,
  ) {
    const text = input.text?.trim() || null;
    if (!text && !input.mediaId && !input.offerId) {
      throw new BadRequestException(
        'A message, attachment, or offer is required.',
      );
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId } },
      },
      include: {
        participants: {
          select: { userId: true },
        },
        product: {
          select: { id: true, seller: { select: { ownerId: true } } },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

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
        throw new ForbiddenException(
          'Upload a valid message attachment first.',
        );
      }
    }

    if (input.offerId) {
      const offer = await this.prisma.productOffer.findFirst({
        where: {
          id: input.offerId,
          productId: conversation.product?.id,
          OR: [{ buyerId: userId }, { seller: { ownerId: userId } }],
        },
        select: {
          id: true,
          buyerId: true,
          seller: { select: { ownerId: true } },
        },
      });
      const participantIds = new Set(
        conversation.participants.map((participant) => participant.userId),
      );
      if (
        !offer ||
        !participantIds.has(offer.buyerId) ||
        !participantIds.has(offer.seller.ownerId)
      ) {
        throw new ForbiddenException(
          'The offer does not belong to this conversation.',
        );
      }
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          text,
          mediaId: input.mediaId,
          offerId: input.offerId,
        },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
          media: { select: { secureUrl: true, resourceType: true } },
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    const response = this.toMessage(
      message,
      conversation.product?.seller.ownerId,
    );
    this.realtime.publishMessage(conversationId, response);
    return response;
  }

  async markRead(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId },
      select: { id: true },
    });
    if (!participant) throw new NotFoundException('Conversation not found.');

    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });
    this.realtime.publishRead(conversationId, userId);
    return { success: true };
  }

  private async findOrCreateConversation(
    userId: string,
    sellerOwnerId: string,
    productId: string,
  ) {
    const where: Prisma.ConversationWhereInput = {
      kind: ConversationKind.PRODUCT,
      productId,
      participants: { some: { userId } },
      AND: [{ participants: { some: { userId: sellerOwnerId } } }],
    };
    const existing = await this.prisma.conversation.findFirst({
      where,
      include: conversationInclude,
    });
    if (existing) return existing;

    const created = await this.prisma.conversation.create({
      data: {
        kind: ConversationKind.PRODUCT,
        productId,
        participants: {
          create: [{ userId }, { userId: sellerOwnerId }],
        },
      },
      include: conversationInclude,
    });
    return created;
  }

  private toConversation(conversation: ConversationRecord, userId: string) {
    const currentParticipant = conversation.participants.find(
      (participant) => participant.userId === userId,
    );
    const seller = conversation.product?.seller;
    const otherParticipant = conversation.participants.find(
      (participant) => participant.userId !== userId,
    );
    const unread = conversation.messages.filter(
      (message) =>
        message.senderId !== userId &&
        (!currentParticipant?.lastReadAt ||
          message.sentAt > currentParticipant.lastReadAt),
    ).length;

    return {
      id: conversation.id,
      kind: conversation.kind.toLowerCase(),
      productId: conversation.productId,
      product: conversation.product
        ? {
            id: conversation.product.id,
            slug: conversation.product.slug,
            name: conversation.product.name,
            price: Number(conversation.product.priceKobo) / 100,
            image: conversation.product.media[0]?.media.secureUrl ?? null,
          }
        : null,
      sellerId: seller?.id,
      seller: seller ? { id: seller.id, name: seller.name } : null,
      otherParticipant: otherParticipant
        ? {
            id: otherParticipant.userId,
            name: `${otherParticipant.user.firstName} ${otherParticipant.user.lastName}`.trim(),
          }
        : null,
      unread,
      messages: conversation.messages.map((message) =>
        this.toMessage(message, seller?.ownerId),
      ),
      updatedAt: conversation.updatedAt,
    };
  }

  private toMessage(
    message: {
      id: string;
      senderId: string;
      text: string | null;
      offerId: string | null;
      sentAt: Date;
      sender: { firstName: string; lastName: string };
      media: { secureUrl: string | null; resourceType: string } | null;
    },
    sellerOwnerId?: string,
  ) {
    const mediaUrl = message.media?.secureUrl ?? undefined;
    return {
      id: message.id,
      senderId: message.senderId,
      senderName:
        `${message.sender.firstName} ${message.sender.lastName}`.trim(),
      from: message.senderId === sellerOwnerId ? 'seller' : 'buyer',
      text: message.text ?? undefined,
      offerId: message.offerId ?? undefined,
      mediaUrl,
      mediaResourceType: message.media?.resourceType,
      at: message.sentAt,
    };
  }
}
