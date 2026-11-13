import type { Order, Payment } from '@prisma/client';

export const isSale = (order: Pick<Order, 'status'>) =>
  order.status !== 'CANCELLED' && order.status !== 'REJECTED';

type Sale = Pick<
  Order,
  | 'status'
  | 'subtotal'
  | 'shipping'
  | 'discount'
  | 'commission'
  | 'consumed'
  | 'ingredientCost'
  | 'total'
> & {
  payments: Pick<Payment, 'status' | 'amount' | 'fee' | 'receivable' | 'settlementId'>[];
};

export function salesTotals(
  records: Sale[],
  collected: number,
  expenses: number,
  cashDifferences: number,
) {
  const valid = records.filter(isSale);
  const payments = records
    .flatMap((order) => order.payments)
    .filter((p) => p.status === 'CONFIRMED');
  const gross = valid.reduce((sum, order) => sum + order.subtotal + order.shipping, 0);
  const discount = valid.reduce((sum, order) => sum + order.discount, 0);
  const refunds = -payments.reduce((sum, p) => sum + Math.min(p.amount, 0), 0);
  const revenueRefunds = -valid
    .flatMap((order) => order.payments)
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + Math.min(p.amount, 0), 0);
  const fees =
    valid.reduce((sum, order) => sum + order.commission, 0) +
    payments.reduce((sum, p) => sum + p.fee, 0);
  const costed = records.filter((order) => order.consumed || isSale(order));
  const cost = costed.reduce((sum, order) => sum + (order.ingredientCost ?? 0), 0);
  const net = gross - discount - revenueRefunds - fees;

  let pendingSettlement = 0;
  for (const order of records) {
    for (const payment of order.payments) {
      if (payment.status !== 'CONFIRMED' || !payment.receivable || payment.settlementId) continue;
      const channelFee =
        payment.amount > 0
          ? Math.round((order.commission * payment.amount) / Math.max(1, order.total))
          : 0;
      pendingSettlement += payment.amount - payment.fee - channelFee;
    }
  }

  return {
    orders: valid.length,
    gross,
    discount,
    refunds,
    fees,
    net,
    collected,
    cost,
    margin: net - cost,
    expenses,
    afterExpenses: net - cost - expenses,
    cashDifferences,
    pendingSettlement,
    incompleteCosts: costed.some((order) => order.ingredientCost === null),
    average: valid.length ? Math.round((gross - discount) / valid.length) : 0,
    pending: valid
      .flatMap((order) => order.payments)
      .filter((p) => p.status === 'PENDING')
      .reduce((sum, p) => sum + p.amount, 0),
  };
}
