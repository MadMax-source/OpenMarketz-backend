import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokenType, UserStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../../database/prisma.service.js';
import { EmailCodeDto } from './dto/email-code.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { AuthEmailService } from './email.service.js';

const scrypt = promisify(scryptCallback);
const CODE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TokenPair = { accessToken: string; refreshToken: string };
type RefreshClaims = { sub: string; sid: string; type: 'refresh' };

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  country: true,
  region: true,
  birthDate: true,
  gender: true,
  emailVerifiedAt: true,
  role: true,
  marketingOptIn: true,
  twoFactorEnabled: true,
  avatarMedia: { select: { id: true, secureUrl: true } },
  sellerApplication: { select: { id: true, brandName: true, status: true } },
  store: { select: { id: true, slug: true, name: true, verified: true } },
  createdAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: AuthEmailService,
  ) {}

  async register(input: RegisterDto): Promise<{ message: string }> {
    const email = input.email.trim().toLowerCase();
    const birthDate = new Date(input.birthDate);
    if (!Number.isFinite(birthDate.getTime()) || this.age(birthDate) < 16) {
      throw new ForbiddenException(
        'You must be at least 16 to create an account.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await this.hashPassword(input.password);
    const code = this.newCode();
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone?.trim(),
        country: input.country?.toUpperCase() ?? 'NG',
        region: input.region?.trim(),
        birthDate,
        gender: input.gender,
        marketingOptIn: input.marketingOptIn ?? false,
        authTokens: {
          create: {
            type: AuthTokenType.EMAIL_VERIFICATION,
            tokenHash: this.hashCode(AuthTokenType.EMAIL_VERIFICATION, code),
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
          },
        },
      },
      select: { id: true },
    });

    try {
      await this.email.sendCode(email, code, 'verify');
    } catch (error) {
      await this.prisma.authToken.deleteMany({
        where: {
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          consumedAt: null,
        },
      });
      throw error;
    }

    return {
      message: 'Account created. Check your email for the verification code.',
    };
  }

  async resendVerification(emailInput: string): Promise<{ message: string }> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) {
      return {
        message:
          'If the account exists and still needs verification, a code will be sent.',
      };
    }

    const code = this.newCode();
    await this.replaceCode(user.id, AuthTokenType.EMAIL_VERIFICATION, code);
    await this.email.sendCode(email, code, 'verify');
    return { message: 'A new verification code has been sent.' };
  }

  async verifyEmail(
    input: EmailCodeDto,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        'The verification code is invalid or expired.',
      );
    }
    if (user.emailVerifiedAt) {
      throw new ConflictException('This email address is already verified.');
    }

    const tokenHash = this.hashCode(
      AuthTokenType.EMAIL_VERIFICATION,
      input.code,
    );
    const token = await this.prisma.authToken.findFirst({
      where: {
        userId: user.id,
        type: AuthTokenType.EMAIL_VERIFICATION,
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      select: { id: true },
    });
    if (!token) {
      await this.prisma.authToken.updateMany({
        where: {
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          consumedAt: null,
        },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException(
        'The verification code is invalid or expired.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.authToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    return this.createSession(user.id, metadata);
  }

  async login(
    input: LoginDto,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        emailVerifiedAt: true,
      },
    });
    if (
      !user ||
      !(await this.verifyPassword(input.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Incorrect email or password.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is currently unavailable.');
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        'Verify your email address before signing in. You can request a new verification code.',
      );
    }
    return this.createSession(user.id, metadata);
  }

  async refresh(
    refreshToken: string | undefined,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    if (!refreshToken) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    let claims: RefreshClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshClaims>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    }
    if (
      claims.type !== 'refresh' ||
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string'
    ) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        refreshTokenHash: this.hashOpaqueToken(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: UserStatus.ACTIVE, emailVerifiedAt: { not: null } },
      },
      select: { id: true, userId: true },
    });
    if (!session) {
      throw new UnauthorizedException('This session is no longer active.');
    }

    const pair = await this.issueTokens(session.userId, session.id);
    const rotated = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: this.hashOpaqueToken(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        refreshTokenHash: this.hashOpaqueToken(pair.refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        lastUsedAt: new Date(),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    });
    if (!rotated.count) {
      throw new UnauthorizedException(
        'This refresh token has already been used.',
      );
    }
    return pair;
  }

  async logout(sessionId: string): Promise<{ message: string }> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'You have been signed out.' };
  }

  async listSessions(userId: string) {
    return this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<{ message: string }> {
    await this.prisma.authSession.updateMany({
      where: {
        userId,
        id: { not: currentSessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return { message: 'Other sessions have been signed out.' };
  }

  async requestPasswordReset(emailInput: string): Promise<{ message: string }> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      return {
        message:
          'If an active account exists for that email, a reset code will be sent.',
      };
    }

    const code = this.newCode();
    await this.replaceCode(user.id, AuthTokenType.PASSWORD_RESET, code);
    await this.email.sendCode(email, code, 'reset');
    return { message: 'A password reset code has been sent.' };
  }

  async resetPassword(input: ResetPasswordDto): Promise<{ message: string }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException('The reset code is invalid or expired.');
    }

    const token = await this.prisma.authToken.findFirst({
      where: {
        userId: user.id,
        type: AuthTokenType.PASSWORD_RESET,
        tokenHash: this.hashCode(AuthTokenType.PASSWORD_RESET, input.code),
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      select: { id: true },
    });
    if (!token) {
      await this.prisma.authToken.updateMany({
        where: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          consumedAt: null,
        },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('The reset code is invalid or expired.');
    }

    const passwordHash = await this.hashPassword(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.authToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password updated. Sign in with your new password.' };
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: safeUserSelect,
    });
  }

  private async createSession(
    userId: string,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const sessionId = randomBytes(24).toString('base64url');
    const pair = await this.issueTokens(userId, sessionId);
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash: this.hashOpaqueToken(pair.refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    });
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      user: await this.getProfile(userId),
    };
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
  ): Promise<TokenPair> {
    const accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, type: 'access' },
      {
        secret: accessSecret,
        expiresIn: this.config.get<string>(
          'JWT_ACCESS_TTL',
          '15m',
        ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, type: 'refresh' },
      {
        secret: refreshSecret,
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_TTL',
          '30d',
        ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
    return { accessToken, refreshToken };
  }

  private async replaceCode(
    userId: string,
    type: AuthTokenType,
    code: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId, type, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authToken.create({
        data: {
          userId,
          type,
          tokenHash: this.hashCode(type, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
    ]);
  }

  private newCode(): string {
    return randomInt(100_000, 1_000_000).toString();
  }

  private hashCode(type: AuthTokenType, code: string): string {
    return createHash('sha256').update(`${type}:${code}`).digest('hex');
  }

  private hashOpaqueToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  private async verifyPassword(
    password: string,
    stored: string,
  ): Promise<boolean> {
    const [algorithm, saltEncoded, hashEncoded] = stored.split('$');
    if (algorithm !== 'scrypt' || !saltEncoded || !hashEncoded) return false;
    const expected = Buffer.from(hashEncoded, 'base64url');
    const actual = (await scrypt(
      password,
      Buffer.from(saltEncoded, 'base64url'),
      expected.length,
    )) as Buffer;
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private age(birthDate: Date): number {
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    if (
      today.getUTCMonth() < birthDate.getUTCMonth() ||
      (today.getUTCMonth() === birthDate.getUTCMonth() &&
        today.getUTCDate() < birthDate.getUTCDate())
    ) {
      age -= 1;
    }
    return age;
  }
}
