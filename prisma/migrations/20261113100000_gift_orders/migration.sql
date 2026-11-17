ALTER TABLE "Payment"
ADD COLUMN "payerEmail" TEXT;

ALTER TABLE "GiftContribution"
ADD COLUMN "orderId" TEXT,
ADD COLUMN "giverEmail" TEXT;

ALTER TABLE "GiftContributionItem"
ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "GiftContribution_orderId_key"
ON "GiftContribution"("orderId");

ALTER TABLE "GiftContribution"
ADD CONSTRAINT "GiftContribution_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
