import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Public } from '../../common/public.decorator.js';
import { AuthService } from './auth.service.js';
import { EmailCodeDto } from './dto/email-code.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RequestResetDto } from './dto/request-reset.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

const REFRESH_COOKIE = 'openmarketz_session';
type RequestMetadata = Pick<Request, 'headers' | 'ip'>;

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a buyer account and send email verification',
  })
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendVerification(@Body() body: RequestResetDto) {
    return this.auth.resendVerification(body.email);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyEmail(
    @Body() body: EmailCodeDto,
    @Req() request: RequestMetadata,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyEmail(body, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Req() request: RequestMetadata,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.refresh(
      this.readCookie(request, REFRESH_COOKIE),
      this.metadata(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return this.auth.logout(user.sessionId);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  forgotPassword(@Body() body: RequestResetDto) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body);
  }

  @Get('me')
  @ApiBearerAuth()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.id);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active sessions for the current account' })
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.revokeOtherSessions(user.id, user.sessionId);
  }

  private metadata(request: RequestMetadata) {
    const userAgent = request.headers['user-agent'];
    return {
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      ipAddress: request.ip,
    };
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private cookieOptions() {
    const domain = this.config.get<string>('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE', false),
      sameSite: 'strict' as const,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.cookie;
    if (!header) return undefined;
    const pair = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    return pair ? pair.slice(name.length + 1) : undefined;
  }
}
