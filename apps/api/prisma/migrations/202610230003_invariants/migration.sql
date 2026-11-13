-- Database-level guardrails supplement serializable application transactions.
CREATE UNIQUE INDEX "Shift_single_open" ON "Shift" ((true)) WHERE "closedAt" IS NULL;
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_reservations_nonnegative" CHECK ("reserved" >= 0);
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_strict_availability" CHECK (NOT "strict" OR "stock" >= "reserved");
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_nonnegative" CHECK ("total" >= 0);
