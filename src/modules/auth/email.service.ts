import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class AuthEmailService {
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendCode(
    email: string,
    code: string,
    purpose: 'verify' | 'reset',
  ): Promise<void> {
    if (!this.resend) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Set RESEND_API_KEY before using account verification or password reset.',
      );
    }

    const isReset = purpose === 'reset';
    const { error } = await this.resend.emails.send({
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
      to: email,
      subject: isReset
        ? 'Reset your OpenMarketz password'
        : 'Verify your OpenMarketz email',
      text: isReset
        ? `Your password reset code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`
        : `Your OpenMarketz verification code is ${code}. It expires in 10 minutes.`,
    });

    if (error) {
      throw new ServiceUnavailableException(
        'We could not deliver the account email. Please try again shortly.',
      );
    }
  }
}
