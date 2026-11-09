import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service.js';

type AccessClaims = { sub: string; sid: string; type: 'access' };
type AuthenticatedSocket = Socket & { data: { userId?: string } };

@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => {
      const allowedOrigins = (
        process.env.FRONTEND_ORIGINS ?? 'http://localhost:3000'
      )
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection<AuthenticatedSocket>, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.getToken(client);
      if (!token) throw new Error('Missing access token.');
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (
        claims.type !== 'access' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string'
      ) {
        throw new Error('Invalid access token.');
      }

      const session = await this.prisma.authSession.findFirst({
        where: {
          id: claims.sid,
          userId: claims.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: {
            status: UserStatus.ACTIVE,
            emailVerifiedAt: { not: null },
          },
        },
        select: { userId: true },
      });
      if (!session) throw new Error('Inactive session.');

      client.data.userId = session.userId;
      await client.join(this.userRoom(session.userId));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    delete client.data.userId;
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { conversationId?: unknown },
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId;
    const conversationId = payload?.conversationId;
    if (!userId || typeof conversationId !== 'string' || !conversationId) {
      return { ok: false };
    }

    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { userId, conversationId },
      select: { id: true },
    });
    if (!participant) return { ok: false };

    await client.join(this.conversationRoom(conversationId));
    return { ok: true };
  }

  publishMessage(
    conversationId: string,
    message: Record<string, unknown>,
  ): void {
    this.server
      .to(this.conversationRoom(conversationId))
      .emit('message:new', { ...message, conversationId });
  }

  publishOffer(conversationId: string, offer: unknown): void {
    this.server
      .to(this.conversationRoom(conversationId))
      .emit('offer:updated', offer);
  }

  publishConversationAvailable(
    userIds: string[],
    conversationId: string,
  ): void {
    for (const userId of new Set(userIds)) {
      this.server
        .to(this.userRoom(userId))
        .emit('conversation:available', { conversationId });
    }
  }

  publishRead(conversationId: string, userId: string): void {
    this.server
      .to(this.conversationRoom(conversationId))
      .emit('conversation:read', {
        conversationId,
        userId,
        readAt: new Date(),
      });
  }

  private getToken(client: AuthenticatedSocket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string') return authToken;

    const authorization = client.handshake.headers.authorization;
    return authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private conversationRoom(conversationId: string): string {
    return `conversation:${conversationId}`;
  }
}
