import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthEmailService } from './email.service.js';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail })),
}));

describe('AuthEmailService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sendMail.mockReset();
  });

  it('prints verification codes in development console mode', async () => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const service = new AuthEmailService(
      new ConfigService({
        NODE_ENV: 'development',
        AUTH_EMAIL_MODE: 'console',
      }),
    );

    await service.sendCode('buyer@example.com', '123456', 'verify');

    expect(warning).toHaveBeenCalledWith(
      'Development verify code for buyer@example.com: 123456',
    );
  });

  it('does not enable console delivery outside development', async () => {
    const service = new AuthEmailService(
      new ConfigService({
        NODE_ENV: 'test',
        AUTH_EMAIL_MODE: 'console',
      }),
    );

    await expect(
      service.sendCode('buyer@example.com', '123456', 'verify'),
    ).rejects.toThrow('Email delivery is not configured.');
  });

  it('sends verification codes through Gmail SMTP in development', async () => {
    const service = new AuthEmailService(
      new ConfigService({
        NODE_ENV: 'development',
        AUTH_EMAIL_MODE: 'gmail',
        GMAIL_USER: 'sender@gmail.com',
        GMAIL_APP_PASSWORD: 'app-password',
      }),
    );

    await service.sendCode('buyer@example.com', '123456', 'verify');

    const sentEmail = sendMail.mock.calls[0][0];
    expect(sentEmail).toMatchObject({
      from: 'OpenMarketz <sender@gmail.com>',
      to: 'buyer@example.com',
      subject: 'Verify your OpenMarketz email',
      text: 'Your OpenMarketz email verification code is 123456. It expires in 10 minutes.',
    });
    expect(sentEmail.html).toContain('<!doctype html>');
    expect(sentEmail.html).toContain('123456');
    expect(sentEmail.html).toContain('OpenMarketz');
  });
});
