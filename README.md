# OpenMarketz Backend

Standalone NestJS API project for OpenMarketz. This directory is separate from the Next.js frontend and has no frontend integration configured.

## Stack

- NestJS 12, TypeScript, REST API with Swagger
- PostgreSQL with Prisma 6
- Cloudinary signed-upload integration dependencies
- Paystack integration configuration
- Socket.IO dependencies for buyer/seller chat
- Resend dependency for email delivery

Authentication, buyer onboarding, seller applications and approval, Cloudinary media authorization, and product catalogue endpoints are implemented. Orders, Paystack payments, offers, messaging and other marketplace workflows remain scaffold modules; no escrow or pay-on-delivery flow is enabled.

## Requirements

- Node.js 24+
- pnpm (Corepack is available with Node.js)
- PostgreSQL 15+ (or Docker)

## Setup

```bash
corepack pnpm install
cp .env.example .env
```

Edit `.env` before starting. Generate distinct JWT secrets (at least 32 characters) and a 32-byte KYC encryption key encoded as 64 hex characters. Never commit `.env` or use development/test provider keys in production.

Generate suitable random values with Node.js:

```bash
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Use the first command separately for each JWT secret and the second for `KYC_ENCRYPTION_KEY`. The zero-filled KYC value in `.env.example` is a development placeholder and is explicitly rejected in production.

Start a local PostgreSQL database using Docker Compose:

```bash
docker compose up -d postgres
```

Generate Prisma Client, validate the schema, and create the initial local migration:

```bash
corepack pnpm db:generate
corepack pnpm db:validate
corepack pnpm db:migrate:dev
corepack pnpm db:seed
```

Start the API:

```bash
corepack pnpm start:dev
```

The process listens on `http://localhost:4000`. The liveness endpoint is `GET /api/v1/health`; Swagger is available at `http://localhost:4000/api/docs` outside production.

## Environment variables

| Key | Required for | Purpose |
|---|---|---|
| `NODE_ENV` | All environments | `development`, `test`, or `production` |
| `PORT` | All environments | API listen port |
| `API_PREFIX` | All environments | Versioned REST prefix |
| `FRONTEND_ORIGINS` | All environments | Comma-separated exact browser origins allowed by CORS |
| `DATABASE_URL` | Database use; required in production | PostgreSQL connection string used by Prisma |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Auth implementation; required in production | Separate signing secrets; generate secure random values |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Auth implementation | Access and refresh token lifetimes |
| `COOKIE_DOMAIN`, `COOKIE_SECURE` | Cookie auth | Session cookie scope and HTTPS setting |
| `KYC_ENCRYPTION_KEY` | KYC implementation; required in production | 32-byte encryption key represented as 64 hex characters |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Media upload implementation | Server-side Cloudinary signing credentials |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_CALLBACK_URL` | Payment implementation | Paystack transaction setup and return URL |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email delivery | Resend API key and verified sender |
| `REDIS_URL` | Optional future queue/WebSocket scaling | Redis connection string |
| `SENTRY_DSN` | Optional monitoring | Error reporting destination |

Use the provider's test credentials locally. Secrets belong only in the local `.env` or a deployment secret manager. KYC documents are uploaded to authenticated Cloudinary storage and exposed only to admins through short-lived download URLs; confirm storage and retention requirements before production use.

## Database commands

```bash
corepack pnpm db:generate
corepack pnpm db:validate
corepack pnpm db:migrate:dev --name describe_change
corepack pnpm db:migrate:deploy
corepack pnpm db:studio
```

Use development migrations only locally. Deploy reviewed, committed migrations with `db:migrate:deploy`.

## Modules

`src/modules` contains:

- Implemented: auth, users, seller applications/admin review, product catalogue, and signed Cloudinary uploads
- Scaffolded: cart, addresses, orders, Paystack payments, offers, Open Market requests, buyer/seller messaging, notifications, wishlists/gifting, reviews, and support tickets

`prisma/schema.prisma` contains the initial relational data model. Amounts are represented in integer kobo fields; API DTOs should serialize money as decimal NGN strings or safe integer kobo values, never floating-point amounts.

`GET /api/v1/health` is a liveness check only; it does not prove PostgreSQL or external providers are ready.

## Implemented API routes

The global API prefix is `/api/v1`. Public auth endpoints and catalogue browsing do not require an access token; other routes require a verified user's access token unless they use the refresh-token cookie or are explicitly admin-only.

| Method | Route | Access |
|---|---|---|
| `POST` | `/auth/signup` | Public |
| `POST` | `/auth/verify-email` | Public |
| `POST` | `/auth/resend-verification` | Public |
| `POST` | `/auth/login` | Public |
| `POST` | `/auth/refresh` | Refresh-token cookie |
| `POST` | `/auth/logout` | Authenticated |
| `POST` | `/auth/forgot-password` | Public |
| `POST` | `/auth/reset-password` | Public |
| `GET` | `/auth/me` | Authenticated |
| `GET` | `/auth/sessions` | Authenticated |
| `POST` | `/auth/sessions/revoke-others` | Authenticated |
| `GET` | `/users/me` | Authenticated |
| `PATCH` | `/users/me` | Authenticated |
| `POST` | `/seller/applications` | Authenticated buyer |
| `GET` | `/seller/applications/me` | Authenticated |
| `GET` | `/seller/dashboard` | Authenticated |
| `GET` | `/admin/seller-applications` | Admin |
| `GET` | `/admin/seller-applications/:applicationId/media/:mediaId/access` | Admin; private URL expires in 5 minutes |
| `PATCH` | `/admin/seller-applications/:id` | Admin; approve or reject |
| `POST` | `/media/upload-intents` | Authenticated |
| `POST` | `/media/finalize` | Authenticated |
| `GET` | `/catalog/categories` | Public |
| `GET` | `/catalog/products` | Public |
| `GET` | `/catalog/products/:slug` | Public |
| `GET` | `/seller/products` | Approved seller |
| `POST` | `/seller/products` | Approved seller |
| `PATCH` | `/seller/products/:id` | Product owner |
| `PATCH` | `/seller/products/:id/stock` | Product owner |
| `DELETE` | `/seller/products/:id` | Product owner |

Seed category data with `corepack pnpm db:seed`. Create the first admin by setting the `User.role` field to `ADMIN` through a trusted, audited database operation; there is intentionally no public admin-promotion endpoint. An approved application creates a verified store, but it does not verify its payout bank account or enable payments.

## Validation

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm lint
```

Before any live payment or seller payouts are enabled, confirm Paystack's supported marketplace funds flow and the applicable legal requirements. Do not describe the product as providing escrow until that arrangement is approved and implemented.
