import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './env.validation.js';

describe('validateEnvironment', () => {
  it('supplies development defaults', () => {
    const config = validateEnvironment({});

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.API_PREFIX).toBe('api/v1');
  });

  it('accepts empty optional provider settings in the example environment', () => {
    expect(() =>
      validateEnvironment({
        CLOUDINARY_CLOUD_NAME: '',
        CLOUDINARY_API_KEY: '',
        CLOUDINARY_API_SECRET: '',
        PAYSTACK_SECRET_KEY: '',
        PAYSTACK_PUBLIC_KEY: '',
        RESEND_API_KEY: '',
        REDIS_URL: '',
        SENTRY_DSN: '',
      }),
    ).not.toThrow();
  });

  it('allows console email delivery only in development', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'development',
        AUTH_EMAIL_MODE: 'console',
      }).AUTH_EMAIL_MODE,
    ).toBe('console');

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        AUTH_EMAIL_MODE: 'console',
      }),
    ).toThrow('Console email delivery is only allowed in development.');
  });

  it('requires Gmail SMTP credentials and rejects it in production', () => {
    expect(() =>
      validateEnvironment({
        AUTH_EMAIL_MODE: 'gmail',
        GMAIL_USER: 'buyer@example.com',
      }),
    ).toThrow(
      'GMAIL_USER and GMAIL_APP_PASSWORD are required when AUTH_EMAIL_MODE=gmail.',
    );

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        AUTH_EMAIL_MODE: 'gmail',
        GMAIL_USER: 'buyer@example.com',
        GMAIL_APP_PASSWORD: 'app-password',
      }),
    ).toThrow('Gmail SMTP delivery is only allowed in development.');
  });

  it('rejects wildcard CORS origins', () => {
    expect(() =>
      validateEnvironment({ FRONTEND_ORIGINS: 'http://localhost:3000,*' }),
    ).toThrow('Wildcard CORS origins are not allowed.');
  });

  it('requires non-placeholder secrets for production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://market:secret@localhost:5432/openmarketz?schema=public',
        JWT_ACCESS_SECRET:
          'replace_with_random_access_secret_at_least_32_chars',
        JWT_REFRESH_SECRET:
          'replace_with_different_random_refresh_secret_32_chars',
        KYC_ENCRYPTION_KEY: '0'.repeat(64),
        COOKIE_SECURE: true,
      }),
    ).toThrow(
      'Replace the example secrets with independently generated production secrets.',
    );
  });
});
