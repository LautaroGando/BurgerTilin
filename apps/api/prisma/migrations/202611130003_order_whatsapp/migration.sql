CREATE TABLE "WhatsAppDelivery" (
    "orderId" TEXT NOT NULL PRIMARY KEY REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT
);

CREATE INDEX "WhatsAppDelivery_status_nextAttemptAt_idx" ON "WhatsAppDelivery"("status", "nextAttemptAt");
