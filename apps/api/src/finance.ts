import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { Catalog } from './catalog';
import { Orders, audit } from './orders';
import { atomic } from './transactions';
import { cents, channelLabel, csvCell, TZ } from './domain';
import { DateTime } from 'luxon';
import { onlineMethod } from './mercado-pago-client';
import { isSale, salesTotals } from './sales-metrics';
export const paymentInput = z.object({
  key: z.string().uuid(),
  payments: z
    .array(z.object({ method: z.string(), amount: cents, verified: z.boolean() }))
    .min(1)
    .max(10),
});
export const filterInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  channel: z.string().optional(),
  status: z.string().optional(),
  method: z.string().optional(),
  shift: z.string().optional(),
  archived: z.enum(['true']).optional(),
});
@Injectable()
export class Finance {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Catalog) readonly catalog: Catalog,
    @Inject(Orders) readonly orders: Orders,
  ) {}
  async pay(id: string, raw: unknown, actor: string) {
    const input = paymentInput.parse(raw);
    const result = await atomic(this.db, async (tx) => {
      const previous = await tx.payment.findUnique({ where: { key: input.key + ':0' } });
      if (previous) {
        if (previous.orderId !== id)
          throw new BadRequestException('Clave utilizada por otra venta');
        return { ok: true };
      }
      const o = await tx.order.findUnique({ where: { id }, include: { payments: true } });
      if (!o) throw new NotFoundException();
      if (o.payments.some((p) => p.method === onlineMethod.id))
        throw new BadRequestException('El cobro se verifica automáticamente con Mercado Pago');
      if (['CANCELLED', 'REJECTED'].includes(o.status))
        throw new BadRequestException('La venta está anulada');
      if (o.payments.some((p) => p.status === 'CONFIRMED'))
        throw new BadRequestException('La venta ya tiene un cobro confirmado');
      if (input.payments.reduce((a, p) => a + p.amount, 0) !== o.total)
        throw new BadRequestException('Los pagos deben sumar el total');
      const settings = await this.catalog.settings(tx);
      const shift = await tx.shift.findFirst({ where: { closedAt: null } });
      if (!shift) throw new BadRequestException('Abrí una caja para registrar cobros');
      await tx.payment.updateMany({
        where: { orderId: id, status: 'PENDING' },
        data: { status: 'REPLACED' },
      });
      let allVerified = true;
      for (const [index, p] of input.payments.entries()) {
        const method = settings.methods.find((m) => m.id === p.method && m.enabled);
        if (!method) throw new BadRequestException('Medio de pago inválido');
        if (!p.verified) allVerified = false;
        await tx.payment.create({
          data: {
            key: `${input.key}:${index}`,
            orderId: id,
            method: method.id,
            cash: method.cash,
            receivable: method.receivable || false,
            amount: p.amount,
            fee: Math.round((p.amount * method.feeBps) / 10000),
            status: p.verified ? 'CONFIRMED' : 'PENDING',
            confirmedAt: p.verified ? new Date() : null,
            shiftId: p.verified ? shift.id : null,
          },
        });
      }
      await tx.order.update({
        where: { id },
        data: { paymentStatus: allVerified ? 'PAID' : 'PENDING' },
      });
      await audit(tx, actor, 'PAYMENTS', id, input);
      return { ok: true };
    });
    this.orders.notify();
    return result;
  }
  async verify(paymentId: string, actor: string) {
    await atomic(this.db, async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status === 'CONFIRMED') return;
      if (p.method === onlineMethod.id)
        throw new BadRequestException('El cobro se verifica automáticamente con Mercado Pago');
      if (p.status !== 'PENDING') throw new BadRequestException('El pago no está pendiente');
      const shift = await tx.shift.findFirst({ where: { closedAt: null } });
      if (!shift) throw new BadRequestException('Abrí una caja');
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), shiftId: shift.id },
      });
      const pending = await tx.payment.count({ where: { orderId: p.orderId, status: 'PENDING' } });
      await tx.order.update({
        where: { id: p.orderId },
        data: { paymentStatus: pending ? 'PENDING' : 'PAID' },
      });
      await audit(tx, actor, 'VERIFY_PAYMENT', paymentId, {});
    });
    this.orders.notify();
    return { ok: true };
  }
  async refund(id: string, raw: unknown, actor: string) {
    const input = z
      .object({ key: z.string().uuid(), paymentId: z.string(), reason: z.string().min(3).max(300) })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      const p = await tx.payment.findUnique({ where: { id: input.paymentId } });
      if (!p || p.orderId !== id || p.status !== 'CONFIRMED' || p.amount <= 0)
        throw new BadRequestException('Elegí un cobro confirmado');
      if (p.method === onlineMethod.id)
        throw new BadRequestException('Hacé el reembolso desde tu cuenta de Mercado Pago');
      if (await tx.payment.findUnique({ where: { key: `refund:${p.id}` } })) return { ok: true };
      const shift = await tx.shift.findFirst({ where: { closedAt: null } });
      if (!shift) throw new BadRequestException('Abrí una caja');
      await tx.payment.create({
        data: {
          key: `refund:${p.id}`,
          orderId: id,
          method: p.method,
          cash: p.cash,
          receivable: p.receivable,
          amount: -p.amount,
          fee: 0,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          shiftId: shift.id,
        },
      });
      const o = await tx.order.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      const refunded = -o.payments.filter((p) => p.amount < 0).reduce((a, p) => a + p.amount, 0);
      await tx.order.update({
        where: { id },
        data: { paymentStatus: refunded >= o.total ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
      await audit(tx, actor, 'REFUND', id, input);
      return { ok: true };
    });
  }
  async shift() {
    const s = await this.db.shift.findFirst({
      where: { closedAt: null },
      include: { payments: { where: { status: 'CONFIRMED' } }, entries: true, settlements: true },
    });
    if (!s) return null;
    const expected =
      s.opening +
      s.payments.filter((p) => p.cash && !p.receivable).reduce((a, p) => a + p.amount, 0) +
      s.entries.filter((e) => e.cash).reduce((a, e) => a + e.amount, 0) +
      s.settlements.filter((e) => e.cash).reduce((a, e) => a + e.amount, 0);
    return { ...s, expected };
  }
  async open(raw: unknown, actor: string) {
    const input = z.object({ opening: cents }).parse(raw);
    return atomic(this.db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(70401)`;
      if (await tx.shift.findFirst({ where: { closedAt: null } }))
        throw new BadRequestException('Ya hay una caja abierta');
      const s = await tx.shift.create({ data: input });
      await audit(tx, actor, 'OPEN_SHIFT', s.id, input);
      return s;
    });
  }
  async close(raw: unknown, actor: string) {
    const input = z.object({ counted: cents, shiftId: z.string().min(1).optional() }).parse(raw);
    return atomic(this.db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(70401)`;
      const s = await tx.shift.findFirst({
        where: input.shiftId ? { id: input.shiftId } : { closedAt: null },
        include: { payments: { where: { status: 'CONFIRMED' } }, entries: true, settlements: true },
      });
      if (!s) throw new BadRequestException('No hay caja abierta');
      if (s.closedAt) {
        if (s.counted !== input.counted)
          throw new ConflictException('Esta caja ya se cerró con otro importe contado.');
        const { payments, entries, settlements, ...closed } = s;
        return closed;
      }
      const expected =
        s.opening +
        s.payments.filter((p) => p.cash && !p.receivable).reduce((a, p) => a + p.amount, 0) +
        s.entries.filter((e) => e.cash).reduce((a, e) => a + e.amount, 0) +
        s.settlements.filter((e) => e.cash).reduce((a, e) => a + e.amount, 0);
      const result = await tx.shift.update({
        where: { id: s.id },
        data: {
          closedAt: new Date(),
          counted: input.counted,
          expected,
          difference: input.counted - expected,
        },
      });
      await audit(tx, actor, 'CLOSE_SHIFT', s.id, { expected, counted: input.counted });
      return result;
    });
  }
  async entry(raw: unknown, actor: string) {
    const input = z
      .object({
        key: z.string().uuid(),
        amount: z
          .number()
          .int()
          .min(-100000000)
          .max(100000000)
          .refine((v) => v !== 0),
        category: z.enum(['EXPENSE', 'WITHDRAWAL', 'INCOME']),
        method: z.string(),
        note: z.string().min(3).max(300),
      })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      const existing = await tx.cashEntry.findUnique({ where: { key: input.key } });
      if (existing) return existing;
      const s = await tx.shift.findFirst({ where: { closedAt: null } });
      if (!s) throw new BadRequestException('Abrí una caja');
      const settings = await this.catalog.settings(tx);
      const method = settings.methods.find(
        (m) => m.id === input.method && m.enabled && !m.receivable,
      );
      if (!method) throw new BadRequestException('Medio inválido');
      if (['EXPENSE', 'WITHDRAWAL'].includes(input.category) && input.amount > 0)
        throw new BadRequestException('El egreso debe ser negativo');
      const e = await tx.cashEntry.create({ data: { ...input, cash: method.cash, shiftId: s.id } });
      await audit(tx, actor, 'CASH_ENTRY', e.id, input);
      return e;
    });
  }
  where(raw: unknown) {
    const f = filterInput.parse(raw);
    let start: Date | undefined, end: Date | undefined;
    if (f.from) {
      const d = DateTime.fromISO(f.from, { zone: TZ });
      if (!d.isValid) throw new BadRequestException('Fecha inválida');
      start = d.startOf('day').toJSDate();
    }
    if (f.to) {
      const d = DateTime.fromISO(f.to, { zone: TZ });
      if (!d.isValid) throw new BadRequestException('Fecha inválida');
      end = d.plus({ days: 1 }).startOf('day').toJSDate();
    }
    return {
      createdAt: { gte: start, lt: end },
      OR: [
        { onlineCheckout: null },
        { paymentStatus: { not: 'PENDING' } },
        { status: 'CANCELLED' as const },
      ],
      ...(f.channel
        ? { channel: f.channel === 'APPS' ? { in: ['APPS', 'PEDIDOSYA'] } : f.channel }
        : {}),
      ...(f.status
        ? {
            status: z
              .enum([
                'NEW',
                'ACCEPTED',
                'PREPARING',
                'READY',
                'DISPATCHED',
                'DELIVERED',
                'REJECTED',
                'CANCELLED',
              ])
              .parse(f.status),
          }
        : {}),
      ...(f.method ? { payments: { some: { method: f.method } } } : {}),
      ...(f.shift ? { shiftId: f.shift } : {}),
    };
  }
  private async salesMovements(where: ReturnType<Finance['where']>) {
    const method = where.payments?.some.method;
    const [payments, settlements, expenses, differences] = await Promise.all([
      this.db.payment.findMany({
        where: {
          status: 'CONFIRMED',
          receivable: false,
          confirmedAt: where.createdAt,
          ...(method ? { method } : {}),
          order: {
            ...(where.channel ? { channel: where.channel } : {}),
            ...(where.status ? { status: where.status } : {}),
          },
          ...(where.shiftId ? { shiftId: where.shiftId } : {}),
        },
        select: { amount: true, confirmedAt: true },
      }),
      this.db.settlement.findMany({
        where: {
          createdAt: where.createdAt,
          ...(where.channel ? { channel: where.channel } : {}),
          ...(method ? { method } : {}),
        },
        select: { amount: true, createdAt: true },
      }),
      this.db.cashEntry.aggregate({
        where: { category: 'EXPENSE', createdAt: where.createdAt },
        _sum: { amount: true },
      }),
      this.db.shift.aggregate({
        where: { closedAt: { ...where.createdAt, not: null } },
        _sum: { difference: true },
      }),
    ]);
    return {
      received: [
        ...payments.map((p) => ({ amount: p.amount, at: p.confirmedAt })),
        ...settlements.map((s) => ({ amount: s.amount, at: s.createdAt })),
      ],
      expenses: -(expenses._sum.amount ?? 0),
      cashDifferences: differences._sum.difference ?? 0,
    };
  }

  async sales(raw: unknown) {
    const where = this.where(raw);
    const { archived } = filterInput.parse(raw);
    const [visible, records, { received, expenses, cashDifferences }] = await Promise.all([
      this.db.order.findMany({
        where: { ...where, archivedAt: archived ? { not: null } : null },
        include: { payments: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.db.order.findMany({
        where,
        include: { payments: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.salesMovements(where),
    ]);
    return {
      orders: visible.map((order) => this.orders.redact(order)),
      truncated: visible.length === 5000 || records.length === 5000,
      totals: salesTotals(
        records,
        received.reduce((sum, p) => sum + p.amount, 0),
        expenses,
        cashDifferences,
      ),
    };
  }

  async archiveSale(id: string, archived: boolean, actor: string) {
    return atomic(this.db, async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id } });
      if (Boolean(order.archivedAt) === archived) return { ok: true };
      if (archived && !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(order.status))
        throw new BadRequestException('El pedido sigue activo. Finalizalo antes de archivarlo.');
      await tx.order.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      await audit(tx, actor, archived ? 'SALE_ARCHIVED' : 'SALE_RESTORED', id, {
        number: order.number,
      });
      return { ok: true };
    });
  }

  async performance(raw: unknown) {
    const { period, date } = z
      .object({
        period: z.enum(['day', 'week', 'month', 'year', 'history']).default('day'),
        date: z.iso.date().optional(),
      })
      .parse(raw);
    const today = DateTime.now().setZone(TZ).startOf('day');
    const anchor = date ? DateTime.fromISO(date, { zone: TZ }) : today;
    if (!anchor.isValid || anchor > today)
      throw new BadRequestException('Elegí una fecha hasta hoy');
    const start = period === 'history' ? null : anchor.startOf(period);
    const end =
      period === 'history' ? today : DateTime.min(anchor.endOf(period).startOf('day'), today);
    const where = this.where({ from: start?.toISODate(), to: end.toISODate() });
    const [records, { received, expenses, cashDifferences }] = await Promise.all([
      this.db.order.findMany({
        where,
        select: {
          status: true,
          subtotal: true,
          shipping: true,
          discount: true,
          commission: true,
          consumed: true,
          ingredientCost: true,
          total: true,
          createdAt: true,
          items: true,
          payments: {
            select: { status: true, amount: true, fee: true, receivable: true, settlementId: true },
          },
        },
      }),
      this.salesMovements(where),
    ]);

    const unit =
      period === 'day'
        ? 'hour'
        : period === 'year'
          ? 'month'
          : period === 'history'
            ? 'year'
            : 'day';
    const format =
      unit === 'hour' ? 'HH:mm' : unit === 'month' ? 'LLL' : unit === 'year' ? 'yyyy' : 'dd/LL';
    const buckets = new Map<
      number,
      { label: string; sales: number; collected: number; orders: number }
    >();
    const bucket = (at: DateTime) => {
      const slot = at.startOf(unit).setLocale('es-AR');
      const key = slot.toMillis();
      const existing = buckets.get(key);
      if (existing) return existing;
      const entry = { label: slot.toFormat(format), sales: 0, collected: 0, orders: 0 };
      buckets.set(key, entry);
      return entry;
    };
    const popular = new Map<string, number>();
    for (const order of records.filter(isSale)) {
      const point = bucket(DateTime.fromJSDate(order.createdAt, { zone: TZ }));
      point.orders++;
      point.sales += order.subtotal + order.shipping - order.discount;
      if (!Array.isArray(order.items)) continue;
      for (const item of order.items) {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          typeof item.name !== 'string' ||
          typeof item.quantity !== 'number'
        )
          continue;
        popular.set(item.name, (popular.get(item.name) ?? 0) + item.quantity);
      }
    }
    for (const payment of received) {
      if (payment.at)
        bucket(DateTime.fromJSDate(payment.at, { zone: TZ })).collected += payment.amount;
    }
    const first =
      start ??
      (buckets.size ? DateTime.fromMillis(Math.min(...buckets.keys()), { zone: TZ }) : null);
    if (first) {
      for (let at = first; at <= end.endOf('day'); at = at.plus({ [unit]: 1 })) bucket(at);
    }

    return {
      from: first?.toISODate() ?? null,
      to: end.toISODate(),
      points: [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([time, point]) => ({ time, ...point })),
      popular: [...popular.entries()].sort(([, a], [, b]) => b - a).slice(0, 8),
      totals: salesTotals(
        records,
        received.reduce((sum, p) => sum + p.amount, 0),
        expenses,
        cashDifferences,
      ),
    };
  }
  async receivables() {
    const payments = await this.db.payment.findMany({
      where: { receivable: true, status: 'CONFIRMED', settlementId: null },
      include: {
        order: { select: { number: true, channel: true, total: true, commission: true } },
      },
    });
    return payments.map((p) => ({
      ...p,
      net:
        p.amount -
        p.fee -
        (p.amount > 0
          ? Math.round((p.order.commission * p.amount) / Math.max(1, p.order.total))
          : 0),
    }));
  }
  async settle(raw: unknown, actor: string) {
    const input = z
      .object({
        key: z.string().uuid(),
        paymentIds: z.array(z.string()).min(1).max(500),
        method: z.string(),
        reference: z.string().min(3).max(200),
        amount: cents,
      })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      const prior = await tx.settlement.findUnique({ where: { key: input.key } });
      if (prior) return prior;
      const payments = await tx.payment.findMany({
        where: {
          id: { in: input.paymentIds },
          status: 'CONFIRMED',
          receivable: true,
          settlementId: null,
        },
        include: { order: true },
      });
      if (payments.length !== new Set(input.paymentIds).size || !payments.length)
        throw new BadRequestException('La selección incluye pagos ya liquidados o inválidos');
      if (new Set(payments.map((p) => p.order.channel)).size !== 1)
        throw new BadRequestException('Liquidá un canal a la vez');
      const expected = payments.reduce(
        (a, p) =>
          a +
          p.amount -
          p.fee -
          (p.amount > 0
            ? Math.round((p.order.commission * p.amount) / Math.max(1, p.order.total))
            : 0),
        0,
      );
      if (input.amount !== expected)
        throw new BadRequestException(
          `El neto esperado es ${(expected / 100).toFixed(2)} ARS. Revisá las comisiones y la liquidación.`,
        );
      const settings = await this.catalog.settings(tx),
        method = settings.methods.find((m) => m.id === input.method && m.enabled && !m.receivable);
      if (!method) throw new BadRequestException('Medio de ingreso inválido');
      const shift = await tx.shift.findFirst({ where: { closedAt: null } });
      if (!shift) throw new BadRequestException('Abrí una caja');
      const settlement = await tx.settlement.create({
        data: {
          key: input.key,
          channel: payments[0].order.channel,
          amount: input.amount,
          method: method.id,
          cash: method.cash,
          reference: input.reference,
          shiftId: shift.id,
        },
      });
      await tx.payment.updateMany({
        where: { id: { in: input.paymentIds } },
        data: { settlementId: settlement.id },
      });
      await audit(tx, actor, 'SETTLEMENT', settlement.id, input);
      return settlement;
    });
  }
  async csv(raw: unknown) {
    const { orders } = await this.sales(raw);
    const rows = [
      ['Pedido', 'Fecha y hora', 'Cliente', 'Canal', 'Total ARS', 'Pago', 'Estado'],
      ...orders.map((o) => [
        o.number,
        DateTime.fromJSDate(o.createdAt).setZone(TZ).toFormat('dd/MM/yyyy HH:mm'),
        o.customerName,
        channelLabel(o.channel),
        (o.total / 100).toFixed(2).replace('.', ','),
        o.paymentStatus,
        o.status,
      ]),
    ];
    return '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  }
}
