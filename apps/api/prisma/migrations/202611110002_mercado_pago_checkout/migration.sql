CREATE TABLE "OnlineCheckout" (
    "orderId" TEXT NOT NULL,
    "providerId" TEXT,
    "checkoutUrl" TEXT,
    "checkedAt" TIMESTAMP(3),
    CONSTRAINT "OnlineCheckout_pkey" PRIMARY KEY ("orderId"),
    CONSTRAINT "OnlineCheckout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OnlineCheckout_providerId_key" ON "OnlineCheckout"("providerId");
CREATE INDEX "OnlineCheckout_checkedAt_idx" ON "OnlineCheckout"("checkedAt");
