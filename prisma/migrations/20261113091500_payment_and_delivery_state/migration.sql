ALTER TABLE "PayoutAccount"
ADD COLUMN "paystackRecipientCode" TEXT;

CREATE UNIQUE INDEX "PayoutAccount_paystackRecipientCode_key"
ON "PayoutAccount"("paystackRecipientCode");

ALTER TABLE "Order"
ADD COLUMN "buyerConfirmedDeliveredAt" TIMESTAMP(3),
ADD COLUMN "adminConfirmedDeliveredAt" TIMESTAMP(3);

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "SellerStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "SavedPaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorizationCode" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "cardType" TEXT,
    "last4" TEXT NOT NULL,
    "expMonth" TEXT NOT NULL,
    "expYear" TEXT NOT NULL,
    "bank" TEXT,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "SavedPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedPaymentMethod_authorizationCode_key"
ON "SavedPaymentMethod"("authorizationCode");
CREATE INDEX "SavedPaymentMethod_userId_active_createdAt_idx"
ON "SavedPaymentMethod"("userId", "active", "createdAt");
ALTER TABLE "SavedPaymentMethod"
ADD CONSTRAINT "SavedPaymentMethod_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
