import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, type SupportTicketStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ReplyTicketDto } from './dto/reply-ticket.dto.js';

const ticketInclude = {
  replies: {
    where: { internal: false },
    include: { sender: { select: { firstName: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string | undefined, input: CreateTicketDto) {
    let orderId: string | undefined;
    if (input.orderId && userId) {
      const order = await this.prisma.order.findFirst({
        where: {
          buyerId: userId,
          OR: [{ id: input.orderId }, { orderNumber: input.orderId }],
        },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Order not found.');
      orderId = order.id;
    } else if (input.orderId) {
      throw new ForbiddenException(
        'Sign in before attaching an order to a support ticket.',
      );
    }
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber: `OMZ-SUP-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
        requesterId: userId,
        orderId,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        topic: input.topic.trim(),
        message: input.message.trim(),
      },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        topic: true,
        createdAt: true,
      },
    });
    if (userId) {
      await this.notifications.create(
        userId,
        'SUPPORT',
        `Support ticket ${ticket.ticketNumber} opened`,
        'Your support request has been received.',
        '/support',
      );
    }
    return ticket;
  }

  listMine(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { requesterId: userId },
      select: {
        id: true,
        ticketNumber: true,
        topic: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  listAll() {
    return this.prisma.supportTicket.findMany({
      select: {
        id: true,
        ticketNumber: true,
        name: true,
        email: true,
        topic: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
    });
  }

  async get(user: AuthenticatedUser, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: ticketInclude,
    });
    if (!ticket) throw new NotFoundException('Support ticket not found.');
    if (ticket.requesterId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You cannot view this support ticket.');
    }
    return ticket;
  }

  async reply(user: AuthenticatedUser, id: string, input: ReplyTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, requesterId: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found.');
    if (ticket.requesterId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You cannot reply to this support ticket.');
    }
    const message = await this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: user.id,
          body: input.body.trim(),
        },
        include: { sender: { select: { firstName: true, role: true } } },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          status: user.role === UserRole.ADMIN ? 'IN_PROGRESS' : 'OPEN',
        },
      });
      return message;
    });
    if (user.role === UserRole.ADMIN && ticket.requesterId) {
      await this.notifications.create(
        ticket.requesterId,
        'SUPPORT',
        'Support replied to your ticket',
        input.body.trim().slice(0, 180),
        '/support',
      );
    }
    return message;
  }

  async updateStatus(id: string, status: SupportTicketStatus) {
    const result = await this.prisma.supportTicket.updateMany({
      where: { id },
      data: { status },
    });
    if (result.count !== 1)
      throw new NotFoundException('Support ticket not found.');
    return this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });
  }
}
