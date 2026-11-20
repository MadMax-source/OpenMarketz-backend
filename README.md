# OpenMarketz Backend

Standalone NestJS API project for OpenMarketz. The Next.js frontend connects to this API using `NEXT_PUBLIC_API_URL`.

## Stack

- NestJS 12, TypeScript, REST API with Swagger
- PostgreSQL with Prisma 6
- Cloudinary signed-upload integration dependencies
- Paystack integration configuration
- Socket.IO dependencies for buyer/seller chat
- Resend dependency for email delivery

The API includes authenticated cart and address management, Google Places lookup, inventory-reserving checkout, Paystack payment initialization/verification/webhooks, saved Paystack authorizations, seller settlement controls, order history and delivery confirmations, Open Market requests and responses, wishlists and gifts, reviews, notifications, and support tickets. Upload intents sign only parameters accepted by Cloudinary's upload API; purpose-specific file-size limits are enforced by the browser and rechecked against Cloudinary's asset metadata during finalization.

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

For protected endpoints in Swagger, sign in or verify your email first, then click **Authorize** and enter the returned `accessToken`. The refresh-token cookie alone does not authorize these endpoints.

For local signup and password-reset testing, set `AUTH_EMAIL_MODE=gmail` and provide `GMAIL_USER` plus a Google App Password in `.env` to send to real inboxes through Gmail SMTP. Create the App Password in your Google Account after enabling 2-Step Verification; do not use your regular Gmail password. Gmail mode is development-only and cannot be used in production. Alternatively, `AUTH_EMAIL_MODE=console` prints codes in the API terminal. For production delivery, use `AUTH_EMAIL_MODE=resend` with a verified sender domain.

## Environment variables

| Key                                                                    | Required for                                | Purpose                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | All environments                            | `development`, `test`, or `production`                                                       |
| `PORT`                                                                 | All environments                            | API listen port                                                                              |
| `API_PREFIX`                                                           | All environments                            | Versioned REST prefix                                                                        |
| `FRONTEND_ORIGINS`                                                     | All environments                            | Comma-separated exact browser origins allowed by CORS                                        |
| `DATABASE_URL`                                                         | Database use; required in production        | PostgreSQL connection string used by Prisma                                                  |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                              | Auth implementation; required in production | Separate signing secrets; generate secure random values                                      |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`                                    | Auth implementation                         | Access and refresh token lifetimes                                                           |
| `COOKIE_DOMAIN`, `COOKIE_SECURE`                                       | Cookie auth                                 | Session cookie scope and HTTPS setting                                                       |
| `KYC_ENCRYPTION_KEY`                                                   | KYC implementation; required in production  | 32-byte encryption key represented as 64 hex characters                                      |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Media upload implementation                 | Server-side Cloudinary signing credentials                                                   |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_CALLBACK_URL`                          | Payment implementation                      | Server-side Paystack transaction setup and browser return URL; a public key is not needed for hosted checkout |
| `PENDING_ORDER_TTL_MINUTES`                                            | Pending checkout expiry                     | Minutes before an unpaid order expires (5–1440; defaults to 30)                              |
| `GOOGLE_MAPS_API_KEY`                                                 | Address search                               | Server-side Google Places API (New) key; restrict it to Places API and keep it out of frontend variables |
| `AUTH_EMAIL_MODE`                                                      | Email delivery                              | `console`, development-only `gmail`, or `resend`                                             |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`                                     | Gmail SMTP delivery                         | Gmail address and Google App Password; only used in development when `AUTH_EMAIL_MODE=gmail` |
| `RESEND_API_KEY`, `EMAIL_FROM`                                         | Resend email delivery                       | Resend API key and verified sender domain; used when `AUTH_EMAIL_MODE=resend`                |
| `TERMII_API_KEY`, `TERMII_SENDER_ID`                                   | SMS notifications                           | Termii credentials; SMS is sent only when the user enables it for that notification type     |
| `REDIS_URL`                                                            | Optional future queue/WebSocket scaling     | Redis connection string                                                                      |
| `SENTRY_DSN`                                                           | Optional monitoring                         | Error reporting destination                                                                  |

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

## Commerce behavior

- Checkout recalculates product prices, stock, platform fee, and delivery fee on the server. Amounts are integer NGN values in API responses and kobo in the database.
- Delivery is zone-priced in Abuja/FCT (APO starts at ₦1,000; more distant zones cost more). Other Nigerian states currently use a ₦3,500 standard delivery fee; express is 1.5× standard and pickup is free. Rates are in `OrdersService.getDeliveryFeeKobo`.
- Paystack redirects back to `PAYSTACK_CALLBACK_URL`; configure that URL to the frontend checkout success page. Payment verification is server-to-server and webhook signatures are checked against the raw request body.
- Saved cards are Paystack authorization references only. The API does not collect or persist card numbers or CVV.
- An accepted Open Market offer can be checked out as a standard order with a server-calculated delivery/service quote and Paystack payment. Linked product stock is reserved during checkout.
- Unpaid orders expire after `PENDING_ORDER_TTL_MINUTES` (30 by default). The API periodically cancels expired orders and releases reserved stock. A late successful Paystack charge is sent for refund and tracked as `REFUND_PENDING`; verify the refund in Paystack before treating it as settled.
- Notification events are persisted in-app by default. Email and SMS are opt-in per notification category; email uses `RESEND_API_KEY` and SMS uses Termii. Delivery failures are logged and do not undo the in-app event.
- Support conversations are persisted as ticket replies and admins can review/respond through the admin support inbox. The customer chat refreshes periodically; it is not a realtime agent connection.
- Seller payouts require a configured Paystack transfer balance, verified payout account, and admin settlement confirmation. Transfers should be monitored and reconciled operationally.

## Modules

`src/modules` contains:

- Implemented: auth, users, seller applications/admin review, product catalogue, signed Cloudinary uploads, offers, buyer/seller messaging, cart, addresses, orders, Paystack, Open Market, notifications, wishlists/gifts, reviews, and support tickets

`prisma/schema.prisma` contains the relational data model. Money is stored in integer kobo fields; offer API request and response amounts use whole NGN values to match the product catalogue API.

`GET /api/v1/health` is a liveness check only; it does not prove PostgreSQL or external providers are ready.

## Implemented API routes

The global API prefix is `/api/v1`. Public auth endpoints and catalogue browsing do not require an access token; other routes require a verified user's access token unless they use the refresh-token cookie or are explicitly admin-only.

| Method   | Route                                                             | Access                                                                        |
| -------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST`   | `/auth/signup`                                                    | Public                                                                        |
| `POST`   | `/auth/verify-email`                                              | Public                                                                        |
| `POST`   | `/auth/resend-verification`                                       | Public                                                                        |
| `POST`   | `/auth/login`                                                     | Public                                                                        |
| `POST`   | `/auth/refresh`                                                   | Refresh-token cookie                                                          |
| `POST`   | `/auth/logout`                                                    | Authenticated                                                                 |
| `POST`   | `/auth/forgot-password`                                           | Public                                                                        |
| `POST`   | `/auth/reset-password`                                            | Public                                                                        |
| `GET`    | `/auth/me`                                                        | Authenticated                                                                 |
| `GET`    | `/auth/sessions`                                                  | Authenticated                                                                 |
| `POST`   | `/auth/sessions/revoke-others`                                    | Authenticated                                                                 |
| `GET`    | `/users/me`                                                       | Authenticated                                                                 |
| `PATCH`  | `/users/me`                                                       | Authenticated                                                                 |
| `POST`   | `/seller/applications`                                            | Authenticated buyer                                                           |
| `GET`    | `/seller/applications/me`                                         | Authenticated                                                                 |
| `GET`    | `/seller/dashboard`                                               | Authenticated                                                                 |
| `GET`    | `/admin/seller-applications`                                      | Admin                                                                         |
| `GET`    | `/admin/seller-applications/:applicationId/media/:mediaId/access` | Admin; private URL expires in 5 minutes                                       |
| `PATCH`  | `/admin/seller-applications/:id`                                  | Admin; approve or reject                                                      |
| `POST`   | `/media/upload-intents`                                           | Authenticated                                                                 |
| `POST`   | `/media/finalize`                                                 | Authenticated                                                                 |
| `GET`    | `/catalog/categories`                                             | Public                                                                        |
| `GET`    | `/catalog/products`                                               | Public                                                                        |
| `GET`    | `/catalog/products/:slug`                                         | Public                                                                        |
| `GET`    | `/seller/products`                                                | Approved seller                                                               |
| `POST`   | `/seller/products`                                                | Approved seller                                                               |
| `PATCH`  | `/seller/products/:id`                                            | Product owner                                                                 |
| `PATCH`  | `/seller/products/:id/stock`                                      | Product owner                                                                 |
| `DELETE` | `/seller/products/:id`                                            | Product owner                                                                 |
| `GET`    | `/offers`                                                         | Authenticated buyer or seller; returns offers involving the current user      |
| `POST`   | `/offers`                                                         | Authenticated buyer; creates an offer and adds it to the product conversation |
| `PATCH`  | `/offers/:id/respond`                                             | Offer buyer or seller; accept, decline, or seller counter-offer               |
| `GET`    | `/messages/conversations`                                         | Authenticated conversation participant                                        |
| `POST`   | `/messages/conversations`                                         | Authenticated buyer; opens or reuses a product conversation                   |
| `POST`   | `/messages/conversations/:id/messages`                            | Authenticated conversation participant                                        |
| `PATCH`  | `/messages/conversations/:id/read`                                | Authenticated conversation participant                                        |
| `GET`    | `/orders/seller`                                                  | Authenticated seller                                                          |
| `GET`    | `/orders/open-market/:responseId/quote`                           | Accepted-offer buyer                                                          |
| `POST`   | `/orders/open-market/:responseId/checkout`                        | Accepted-offer buyer; creates order and initializes Paystack                  |
| `PATCH`  | `/orders/:id/shipment`                                            | Seller for an order item; records fulfilment and hub                           |
| `GET`    | `/open-market/responses/:id`                                      | Accepted-offer buyer or seller                                                |
| `POST`   | `/payments/:reference/challenge`                                  | Authenticated buyer; submits a Paystack OTP/PIN/phone/birthday challenge       |
| `POST`   | `/support/tickets`                                                | Public; creates a support ticket                                              |
| `GET`    | `/support/tickets`                                                | Authenticated requester; ticket history                                       |
| `GET`    | `/support/tickets/admin`                                          | Admin support inbox                                                           |
| `GET`    | `/support/tickets/:id`                                            | Ticket requester or admin; history and replies                               |
| `POST`   | `/support/tickets/:id/replies`                                    | Ticket requester or admin                                                     |
| `PATCH`  | `/support/tickets/:id/status`                                     | Admin                                                                         |

Offer creation accepts `{ "productId": "...", "quantity": 1, "offerPrice": 12000, "message": "..." }`, with optional `mediaId` for a previously uploaded voice note. Respond with `{ "action": "accept" }`, `{ "action": "decline" }`, or `{ "action": "counter", "counterPrice": 12500 }`. Countered offers can then be accepted or declined by the buyer. All offer and messaging routes require a verified user's access token. Message attachments must first be uploaded and finalized with the `MESSAGE` media purpose, then referenced by `mediaId`; arbitrary external media URLs are not accepted.

### Realtime messaging and offers

The Socket.IO gateway uses the backend origin and the default `/socket.io` path (not the `/api/v1` REST prefix). Connect with the current access token in the Socket.IO `auth` payload as `{ "token": "<access-token>" }`. The gateway verifies the token and active session, joins the authenticated user's `user:<userId>` room, and only joins a `conversation:<conversationId>` room after the participant sends `conversation:join` with `{ "conversationId": "..." }`.

The gateway emits `message:new` (persisted message plus `conversationId`), `offer:updated` (persisted offer), `conversation:available` (conversation ID to both participants), and `conversation:read` (conversation ID, reader, and read time). REST remains the source of truth for reads and mutations; clients should load initial state and recover after disconnects through the REST endpoints. Set `FRONTEND_ORIGINS` to the exact comma-separated frontend origins in each deployment so browser Socket.IO connections pass CORS checks.

Seed category data with `corepack pnpm db:seed`. Create the first admin by setting the `User.role` field to `ADMIN` through a trusted, audited database operation; there is intentionally no public admin-promotion endpoint. An approved application creates a verified store, but it does not verify its payout bank account or enable payments.

## Validation

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm lint
```

Before any live payment or seller payouts are enabled, confirm Paystack's supported marketplace funds flow and the applicable legal requirements. Do not describe the product as providing escrow until that arrangement is approved and implemented.
