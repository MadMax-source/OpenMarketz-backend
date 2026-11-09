CREATE INDEX "Conversation_productId_idx" ON "Conversation"("productId");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
