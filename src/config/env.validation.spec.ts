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
