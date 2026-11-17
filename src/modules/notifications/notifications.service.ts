import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { Resend } from 'resend';
import { PrismaService } from '../../database/prisma.service.js';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async list(userId: string) {
    const [items, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  async markRead(userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (result.count !== 1)
      throw new NotFoundException('Notification not found.');
    return { success: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { type: 'asc' },
    });
  }

  updatePreference(userId: string, input: UpdateNotificationPreferenceDto) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: input.type } },
      create: {
        userId,
        type: input.type,
        inApp: input.inApp ?? true,
        email: input.email ?? false,
        sms: input.sms ?? false,
      },
      update: {
        inApp: input.inApp,
        email: input.email,
        sms: input.sms,
      },
    });
  }

  async create(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    href?: string,
  ) {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
      select: { inApp: true, email: true, sms: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true },
    });
    if (!user) return null;
    const notification =
      preference?.inApp === false
        ? null
        : await this.prisma.notification.create({
            data: { userId, type, title, body, href },
          });
    if (preference?.email) await this.sendEmail(user.email, title, body, href);
    if (preference?.sms && user.phone)
      await this.sendSms(user.phone, title, body);
    return notification;
  }

  private async sendEmail(
    to: string,
    title: string,
    body: string,
    href?: string,
  ) {
    if (!this.resend) {
      this.logger.warn(
        `Email notification for ${to} was skipped: RESEND_API_KEY is not configured.`,
      );
      return;
    }
    try {
      const { error } = await this.resend.emails.send({
        from: this.config.getOrThrow<string>('EMAIL_FROM'),
        to,
        subject: title,
        text: `${body}${href ? `\n\nView: ${href}` : ''}`,
      });
      if (error)
        this.logger.error(
          `Email notification delivery failed for ${to}: ${error.message}`,
        );
    } catch (error) {
      this.logger.error(`Email notification delivery failed for ${to}.`, error);
    }
  }

  private async sendSms(to: string, title: string, body: string) {
    const apiKey = this.config.get<string>('TERMII_API_KEY');
    const senderId = this.config.get<string>('TERMII_SENDER_ID');
    if (!apiKey || !senderId) {
      this.logger.warn(
        `SMS notification for ${to} was skipped: TERMII_API_KEY and TERMII_SENDER_ID are not configured.`,
      );
      return;
    }
    try {
      const response = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          to,
          from: senderId,
          sms: `${title}: ${body}`,
          type: 'plain',
          channel: 'generic',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.logger.error(
          `SMS notification delivery failed for ${to} with status ${response.status}.`,
        );
      }
    } catch (error) {
      this.logger.error(`SMS notification delivery failed for ${to}.`, error);
    }
  }
}
