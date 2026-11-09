import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { Resend } from 'resend';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly emailMode: string;
  private readonly resend: Resend | null;
  private readonly consoleMode: boolean;
  private readonly gmailUser: string | undefined;
  private readonly gmailTransport: ReturnType<typeof createTransport> | null;

  constructor(private readonly config: ConfigService) {
    this.emailMode = this.config.get<string>('AUTH_EMAIL_MODE', 'resend');
    this.consoleMode =
      this.emailMode === 'console' &&
      this.config.get<string>('NODE_ENV') === 'development';
    this.gmailUser = this.config.get<string>('GMAIL_USER');
    const gmailPassword = this.config.get<string>('GMAIL_APP_PASSWORD');
    this.gmailTransport =
      this.emailMode === 'gmail' && this.gmailUser && gmailPassword
        ? createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user: this.gmailUser, pass: gmailPassword },
          })
        : null;
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend =
      this.emailMode === 'resend' && apiKey ? new Resend(apiKey) : null;
  }

  async sendCode(
    email: string,
    code: string,
    purpose: 'verify' | 'reset',
  ): Promise<void> {
    if (this.consoleMode) {
      this.logger.warn(`Development ${purpose} code for ${email}: ${code}`);
      return;
    }

    if (this.emailMode === 'gmail') {
      if (this.config.get<string>('NODE_ENV') !== 'development') {
        throw new ServiceUnavailableException(
          'Gmail SMTP delivery is only allowed in development.',
        );
      }
      if (!this.gmailUser || !this.gmailTransport) {
        throw new ServiceUnavailableException(
          'Set GMAIL_USER and GMAIL_APP_PASSWORD to use Gmail SMTP.',
        );
      }

      const { subject, text, html } = this.message(code, purpose);
      try {
        await this.gmailTransport.sendMail({
          from: `OpenMarketz <${this.gmailUser}>`,
          to: email,
          subject,
          text,
          html,
        });
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : 'Unknown SMTP error';
        this.logger.error(`Gmail SMTP delivery failed: ${detail}`);
        throw new ServiceUnavailableException(
          'We could not deliver the account email. Please check the Gmail SMTP settings.',
        );
      }
      return;
    }

    if (!this.resend) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Set RESEND_API_KEY before using account verification or password reset.',
      );
    }

    const { subject, text, html } = this.message(code, purpose);
    const { error } = await this.resend.emails.send({
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
      to: email,
      subject,
      text,
      html,
    });

    if (error) {
      throw new ServiceUnavailableException(
        'We could not deliver the account email. Please try again shortly.',
      );
    }
  }

  private message(code: string, purpose: 'verify' | 'reset') {
    const isReset = purpose === 'reset';
    const action = isReset ? 'reset your password' : 'verify your email';
    const subject = isReset
      ? 'Reset your OpenMarketz password'
      : 'Verify your OpenMarketz email';
    const text = isReset
      ? `Your OpenMarketz password reset code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`
      : `Your OpenMarketz email verification code is ${code}. It expires in 10 minutes.`;

    return {
      subject,
      text,
      html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#17212b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:#163b35;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.2px;">
                OpenMarketz
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 12px;">
                <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#17212b;">${isReset ? 'Reset your password' : 'Verify your email'}</h1>
                <p style="margin:0;font-size:16px;line-height:1.6;color:#4b5965;">Use the code below to ${action}. It expires in 10 minutes.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px;">
                <div style="display:inline-block;padding:16px 24px;border:1px solid #dce5e2;border-radius:10px;background:#f7faf9;color:#163b35;font-size:32px;font-weight:700;letter-spacing:8px;">${code}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;font-size:14px;line-height:1.6;color:#65727c;">
                If you didn’t request this, you can safely ignore this email.
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#87929a;">OpenMarketz account security</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    };
  }
}
