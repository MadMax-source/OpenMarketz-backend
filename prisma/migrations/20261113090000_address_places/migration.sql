ALTER TABLE "Address"
ADD COLUMN "googlePlaceId" TEXT,
ADD COLUMN "area" TEXT,
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

CREATE INDEX "Address_googlePlaceId_idx" ON "Address"("googlePlaceId");
