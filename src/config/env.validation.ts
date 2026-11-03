import Joi from 'joi';

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(4000),
  API_PREFIX: Joi.string().default('api/v1'),
  FRONTEND_ORIGINS: Joi.string().default('http://localhost:3000'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .empty(''),
  JWT_ACCESS_SECRET: Joi.string().min(32),
  JWT_REFRESH_SECRET: Joi.string().min(32),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('30d'),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  COOKIE_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  KYC_ENCRYPTION_KEY: Joi.string().hex().length(64).empty(''),
  CLOUDINARY_CLOUD_NAME: Joi.string().empty(''),
  CLOUDINARY_API_KEY: Joi.string().empty(''),
  CLOUDINARY_API_SECRET: Joi.string().empty(''),
  PAYSTACK_SECRET_KEY: Joi.string().empty(''),
  PAYSTACK_PUBLIC_KEY: Joi.string().empty(''),
  PAYSTACK_CALLBACK_URL: Joi.string().uri().empty(''),
  RESEND_API_KEY: Joi.string().empty(''),
  EMAIL_FROM: Joi.string().default('OpenMarketz <no-reply@example.com>'),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .empty(''),
  SENTRY_DSN: Joi.string().uri().empty(''),
})
  .with('CLOUDINARY_CLOUD_NAME', [
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ])
  .with('CLOUDINARY_API_KEY', [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_SECRET',
  ])
  .with('CLOUDINARY_API_SECRET', [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
  ])
  .with('PAYSTACK_SECRET_KEY', ['PAYSTACK_PUBLIC_KEY'])
  .with('PAYSTACK_PUBLIC_KEY', ['PAYSTACK_SECRET_KEY'])
  .unknown(true);

export function validateEnvironment(config: Record<string, unknown>) {
  const { error, value } = environmentSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
    convert: true,
  });

  if (error) {
    throw error;
  }

  if (value.NODE_ENV === 'production') {
    const required = [
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'KYC_ENCRYPTION_KEY',
    ] as const;
    const missing = required.filter((key) => !value[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required production environment values: ${missing.join(', ')}`,
      );
    }

    if (
      String(value.JWT_ACCESS_SECRET).length < 32 ||
      String(value.JWT_REFRESH_SECRET).length < 32
    ) {
      throw new Error('Production JWT secrets must be at least 32 characters.');
    }

    if (
      String(value.JWT_ACCESS_SECRET).startsWith('replace_with_') ||
      String(value.JWT_REFRESH_SECRET).startsWith('replace_with_') ||
      value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET ||
      value.KYC_ENCRYPTION_KEY === '0'.repeat(64)
    ) {
      throw new Error(
        'Replace the example secrets with independently generated production secrets.',
      );
    }

    if (value.COOKIE_SECURE !== true) {
      throw new Error('COOKIE_SECURE must be true in production.');
    }
  }

  if (
    String(value.FRONTEND_ORIGINS)
      .split(',')
      .some((origin) => origin.trim() === '*')
  ) {
    throw new Error('Wildcard CORS origins are not allowed.');
  }

  return value;
}
