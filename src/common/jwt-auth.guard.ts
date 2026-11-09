import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

type AccessClaims = {
  sub: string;
  sid: string;
  type: 'access';
};

type AuthenticatedRequest = Request & {
  user?: { id: string; email: string; role: string; sessionId: string };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === 'ws') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(
        authorization.slice('Bearer '.length),
        { secret: process.env.JWT_ACCESS_SECRET },
      );
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    }

    if (
      claims.type !== 'access' ||
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string'
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: UserStatus.ACTIVE, emailVerifiedAt: { not: null } },
      },
      select: {
        id: true,
        user: { select: { id: true, email: true, role: true } },
      },
    });

    if (!session) {
      throw new UnauthorizedException('This session is no longer active.');
    }

    request.user = {
      ...session.user,
      sessionId: session.id,
    };
    return true;
  }
}
