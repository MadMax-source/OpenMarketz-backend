CREATE TYPE "SellerSettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

CREATE TABLE "SellerSettlement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "reference" TEXT NOT NULL,
    "transferCode" TEXT,
    "status" "SellerSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerSettlement_reference_key" ON "SellerSettlement"("reference");
CREATE UNIQUE INDEX "SellerSettlement_orderId_sellerId_key"
ON "SellerSettlement"("orderId", "sellerId");
CREATE INDEX "SellerSettlement_status_createdAt_idx"
ON "SellerSettlement"("status", "createdAt");

ALTER TABLE "SellerSettlement"
ADD CONSTRAINT "SellerSettlement_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerSettlement"
ADD CONSTRAINT "SellerSettlement_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "SellerStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
