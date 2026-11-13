ALTER TABLE "Payment" ADD COLUMN "confirmedAt" TIMESTAMP(3);
UPDATE "Payment" SET "confirmedAt" = "createdAt" WHERE "status" = 'CONFIRMED';
