import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, OrderStatus } from '@prisma/client';
import { Subject } from 'rxjs';
import { z } from 'zod';
import { Db } from './db';
import { Catalog } from './catalog';
import { hash } from './auth';
import { activeChannel, opening, orderInput, phoneKey, transitions, integerMoney } from './domain';
import { atomic } from './transactions';
import { OrderPush, queueOrderPush } from './order-push';
import {
  mercadoPagoConfig,
  onlineMethod,
  onlinePaymentWindow,
  reservedPaymentMethod,
} from './mercado-pago-client';
export const orderInclude = { payments: true, reservations: true, onlineCheckout: true } as const;
export const audit = (
  tx: Prisma.TransactionClient,
  actor: string,
  action: string,
  entity: string,
  data: unknown,
) => tx.audit.create({ data: { actor, action, entity, data: data as Prisma.InputJsonValue } });
@Injectable()
export class Orders {
  readonly events = new Subject<{ data: string }>();
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Catalog) readonly catalog: Catalog,
    @Inject(OrderPush) private push?: OrderPush,
  ) {}
  notify() {
    this.events.next({ data: JSON.stringify({ refresh: true, at: Date.now() }) });
  }
  async create(raw: unknown, actor?: string) {
    const input = orderInput.parse(raw);
    if (!actor && input.channel !== 'WEB') throw new BadRequestException('Canal inválido');
    if (!actor && input.discount) throw new BadRequestException('Descuento no autorizado');
    const requestHash = hash(JSON.stringify(input));
    const { order, queued } = await atomic(this.db, async (tx) => {
      const existing = await tx.order.findUnique({ where: { key: input.key } });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException('La clave ya pertenece a otro pedido');
        return { order: existing, queued: false };
      }
      const settings = await this.catalog.settings(tx);
      if (!actor && !opening(settings).open)
        throw new BadRequestException('El local no está recibiendo pedidos');
      const channel = settings.channels.find((c) => c.id === activeChannel(input.channel));
      if (!channel) throw new BadRequestException('Canal no habilitado');
      const online = input.method === onlineMethod.id;
      const onlineConfig = online && !actor ? mercadoPagoConfig() : undefined;
      const method = online
        ? onlineConfig && { ...onlineMethod, feeBps: onlineConfig.feeBps }
        : settings.methods.find(
            (m) =>
              m.id === input.method &&
              m.enabled &&
              (actor || (!m.receivable && !reservedPaymentMethod(m))),
          );
      if (!method) throw new BadRequestException('Medio de pago no habilitado');
      const phone = phoneKey(input.phone);
      if (!actor && (phone.length < 8 || phone.length > 15))
        throw new BadRequestException('Revisá tu teléfono con código de país y área');
      let shipping = 0;
      const quote = await this.catalog.compile(tx, input.items, channel.id, !actor);
      if (input.fulfillment === 'DELIVERY') {
        const zone = settings.zones.find((z) => z.id === input.zone && z.enabled);
        if (!zone) throw new BadRequestException('Elegí una zona de entrega habilitada');
        if (input.address.trim().length < 5 || phone.length < 8)
          throw new BadRequestException('Completá dirección y teléfono');
        if (quote.subtotal < zone.minimum)
          throw new BadRequestException('El pedido no alcanza el mínimo de tu zona');
        shipping = zone.fee;
      }
      if (input.discount > quote.subtotal)
        throw new BadRequestException('El descuento supera el importe de productos');
      const total = integerMoney(quote.subtotal + shipping - input.discount);
      if (online && !total) throw new BadRequestException('Elegí otro medio para un pedido de $0');
      if (input.expectedTotal !== undefined && input.expectedTotal !== total)
        throw new BadRequestException(
          'El precio cambió. Revisá el catálogo y volvé a armar el pedido con los valores actuales.',
        );
      const secret = randomBytes(32).toString('base64url');
      const customer = phone
        ? await tx.customer.upsert({
            where: { phone },
            update: { name: input.name },
            create: { phone, name: input.name },
          })
        : null;
      const shift = await tx.shift.findFirst({ where: { closedAt: null } });
      const created = await tx.order.create({
        data: {
          key: input.key,
          requestHash,
          trackingHash: hash(secret),
          trackingSecret: secret,
          channel: channel.id,
          fulfillment: input.fulfillment,
          customerId: customer?.id,
          customerName: input.name,
          phone,
          address: input.address,
          zone: input.zone,
          notes: input.notes,
          items: quote.items,
          subtotal: quote.subtotal,
          discount: input.discount,
          shipping,
          total,
          commission: Math.round((total * channel.feeBps) / 10000),
          ingredientCost: quote.ingredientCost,
          estimatedMinutes: settings.delay,
          shiftId: shift?.id,
          ...(online ? { onlineCheckout: { create: {} } } : {}),
          payments: {
            create: {
              key: `${input.key}:initial`,
              method: method.id,
              cash: method.cash,
              receivable: method.receivable || false,
              amount: total,
              fee: Math.round((total * method.feeBps) / 10000),
              status: 'PENDING',
            },
          },
        },
      });
      for (const [ingredientId, quantity] of [...quote.consumption].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        await tx.ingredient.update({
          where: { id: ingredientId },
          data: { reserved: { increment: quantity } },
        });
        await tx.reservation.create({ data: { orderId: created.id, ingredientId, quantity } });
      }
      await audit(tx, actor || 'cliente', 'ORDER_CREATED', created.id, {
        channel: channel.id,
        total,
      });
      const queued = Boolean(!actor && !online && this.push && await queueOrderPush(tx, created.id));
      return { order: created, queued };
    });
    this.notify();
    if (queued) await this.push?.deliver(order.id);
    return {
      id: order.id,
      number: order.number,
      total: order.total,
      tracking: order.trackingSecret,
    };
  }
  async change(id: string, status: string, actor: string) {
    const result = await atomic(this.db, (tx) => this.changeInTransaction(tx, id, status, actor));
    this.notify();
    return { id: result.id, status: result.status };
  }
  async changeInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    status: string,
    actor: string,
  ) {
    const o = await tx.order.findUnique({ where: { id }, include: orderInclude });
    if (!o) throw new NotFoundException();
    if (o.status === status) return o;
    if (o.onlineCheckout && o.paymentStatus === 'PENDING' && actor !== 'mercado-pago')
      throw new BadRequestException('El pago de Mercado Pago sigue pendiente');
    if (
      o.onlineCheckout &&
      o.paymentStatus === 'REFUNDED' &&
      ['ACCEPTED', 'PREPARING'].includes(status)
    )
      throw new BadRequestException('Mercado Pago devolvió el cobro de este pedido');
    if (!transitions[o.status]?.includes(status))
      throw new BadRequestException('Ese cambio de estado no está permitido');
    if (status === 'DISPATCHED' && o.fulfillment !== 'DELIVERY')
      throw new BadRequestException('El pedido es para retirar');
    if (status === 'DELIVERED' && o.fulfillment === 'DELIVERY' && o.status !== 'DISPATCHED')
      throw new BadRequestException('Primero marcá el pedido en reparto');
    if (
      status === 'PREPARING' ||
      ((status === 'CANCELLED' || status === 'REJECTED') && !o.consumed)
    ) {
      for (const r of o.reservations
        .filter((r) => !r.released)
        .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
        await tx.ingredient.update({
          where: { id: r.ingredientId },
          data: {
            reserved: { decrement: r.quantity },
            ...(status === 'PREPARING' ? { stock: { decrement: r.quantity } } : {}),
          },
        });
        if (status === 'PREPARING')
          await tx.stockMovement.create({
            data: {
              ingredientId: r.ingredientId,
              quantity: -r.quantity,
              kind: 'CONSUMPTION',
              reason: `Pedido #${o.number}`,
              orderId: id,
            },
          });
        await tx.reservation.update({ where: { id: r.id }, data: { released: true } });
      }
    }
    if (status === 'CANCELLED' && o.consumed) {
      for (const r of o.reservations)
        await tx.stockMovement.create({
          data: {
            ingredientId: r.ingredientId,
            quantity: 0,
            kind: 'WASTE_AFTER_COOKING',
            reason: `Merma de ${r.quantity}; ya descontada al cocinar`,
            orderId: id,
          },
        });
    }
    await audit(tx, actor, 'ORDER_STATUS', id, {
      from: o.status,
      to: status,
      waste: status === 'CANCELLED' && o.consumed,
    });
    return tx.order.update({
      where: { id },
      data: {
        status: status as OrderStatus,
        acknowledgedAt: o.acknowledgedAt || new Date(),
        consumed: o.consumed || status === 'PREPARING',
      },
    });
  }
  async tracking(token: string) {
    const o = await this.db.order.findUnique({
      where: { trackingHash: hash(token) },
      include: { onlineCheckout: { select: { providerId: true } } },
    });
    if (!o) throw new NotFoundException('No encontramos ese pedido');
    return {
      number: o.number,
      status: o.status,
      paymentStatus: o.paymentStatus,
      onlinePayment: !!o.onlineCheckout,
      onlineCheckoutStarted: Boolean(o.onlineCheckout?.providerId),
      canPayOnline:
        Boolean(o.onlineCheckout) &&
        o.status === 'NEW' &&
        o.paymentStatus === 'PENDING' &&
        Date.now() - o.createdAt.getTime() < onlinePaymentWindow,
      fulfillment: o.fulfillment,
      items: o.items,
      total: o.total,
      createdAt: o.createdAt,
      estimatedMinutes: o.estimatedMinutes,
    };
  }
  async active(kitchen = false) {
    const orders = await this.db.order.findMany({
      where: {
        status: { in: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'DISPATCHED'] },
        OR: [{ onlineCheckout: null }, { paymentStatus: { not: 'PENDING' } }],
      },
      orderBy: { createdAt: 'asc' },
      include: { payments: true },
    });
    return orders.map((o) =>
      kitchen
        ? {
            id: o.id,
            number: o.number,
            status: o.status,
            fulfillment: o.fulfillment,
            items: o.items,
            notes: o.notes,
            createdAt: o.createdAt,
            estimatedMinutes: o.estimatedMinutes,
            acknowledgedAt: o.acknowledgedAt,
          }
        : this.redact(o),
    );
  }
  redact(o: any) {
    const {
      trackingSecret,
      trackingHash,
      requestHash,
      key,
      reservations,
      onlineCheckout,
      ...safe
    } = o;
    return safe;
  }
  async acknowledge(id: string, actor: string) {
    await atomic(this.db, async (tx) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (!o.acknowledgedAt) {
        await tx.order.update({ where: { id }, data: { acknowledgedAt: new Date() } });
        await audit(tx, actor, 'ACKNOWLEDGE', id, {});
      }
    });
    this.notify();
    return { ok: true };
  }
}
