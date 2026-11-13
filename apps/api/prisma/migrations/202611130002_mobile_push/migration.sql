CREATE TABLE "PushIdentity" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL
);

CREATE TABLE "PushDevice" (
    "endpoint" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL
);

CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

CREATE TABLE "PushDelivery" (
    "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "endpoint" TEXT NOT NULL REFERENCES "PushDevice"("endpoint") ON DELETE CASCADE ON UPDATE CASCADE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    PRIMARY KEY ("orderId", "endpoint")
);

CREATE INDEX "PushDelivery_sentAt_nextAttemptAt_idx" ON "PushDelivery"("sentAt", "nextAttemptAt");
