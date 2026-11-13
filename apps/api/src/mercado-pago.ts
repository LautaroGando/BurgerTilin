import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Db } from './db';
import { hash } from './auth';
import { audit, Orders } from './orders';
import { atomic } from './transactions';
import { OrderPush, queueOrderAlerts } from './order-push';
import {
  mercadoPagoConfig,
  mercadoPagoRequest,
  onlineMethod,
  onlinePaymentWindow,
  providerCents,
  validSignature,
} from './mercado-pago-client';

const actor = 'mercado-pago';
type ProviderOrder = Awaited<ReturnType<typeof mercadoPagoRequest>>;

@Injectable()
export class MercadoPago implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MercadoPago.name);
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    @Inject(Db) private db: Db,
    @Inject(Orders) private orders: Orders,
    @Inject(OrderPush) private push: OrderPush,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL !== '1' && mercadoPagoConfig())
      this.timer = setInterval(() => void this.reconcilePending(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async start(token: string) {
    const config = mercadoPagoConfig();
    if (!config) throw new ServiceUnavailableException('Mercado Pago no está habilitado');
    const order = await this.db.order.findUnique({
      where: { trackingHash: hash(token) },
      include: { onlineCheckout: true },
    });
    if (!order?.onlineCheckout) throw new NotFoundException('No encontramos ese cobro');
    if (order.status !== 'NEW' || order.paymentStatus !== 'PENDING')
      throw new BadRequestException('Este pedido ya no tiene un pago pendiente');
    if (Date.now() - order.createdAt.getTime() >= onlinePaymentWindow)
      throw new BadRequestException(
        'Venció el tiempo para pagar. Volvé al menú para hacer otro pedido.',
      );
    if (order.onlineCheckout.checkoutUrl) return { checkoutUrl: order.onlineCheckout.checkoutUrl };

    const amount = (order.total / 100).toFixed(2);
    const returnUrl = `${config.origin}/seguimiento/${token}?mp=retorno`;
    const remote = await mercadoPagoRequest(
      '',
      {
        type: 'online',
        processing_mode: 'manual',
        capture_mode: 'automatic_async',
        external_reference: order.id,
        total_amount: amount,
        expiration_time: 'PT15M',
        items: [
          { title: `Burger Tilín · Pedido #${order.number}`, quantity: 1, unit_price: amount },
        ],
        config: {
          online: {
            success_url: returnUrl,
            pending_url: returnUrl,
            failure_url: returnUrl,
            auto_return: 'all',
          },
        },
      },
      order.key,
    );
    const checkoutUrl = this.checkoutUrl(remote.checkout_url);
    if (!checkoutUrl || !this.matches(remote, order))
      throw new BadGatewayException('No pudimos validar el enlace de Mercado Pago');
    const saved = await this.db.onlineCheckout.updateMany({
      where: {
        orderId: order.id,
        OR: [{ providerId: null }, { providerId: remote.id }],
        order: { status: 'NEW', paymentStatus: 'PENDING' },
      },
      data: { providerId: remote.id, checkoutUrl },
    });
    if (!saved.count) throw new BadRequestException('Este pedido ya no tiene un pago pendiente');
    return { checkoutUrl };
  }

  async webhook(id: string, requestId: string, signature: string) {
    const config = mercadoPagoConfig();
    if (!config?.secret)
      throw new ServiceUnavailableException('El webhook de Mercado Pago no está habilitado');
    if (!validSignature(config.secret, id, requestId, signature))
      throw new UnauthorizedException('Firma de Mercado Pago inválida');
    await this.sync(await this.readRemote(id));
    return { ok: true };
  }

  async refresh(token: string) {
    if (mercadoPagoConfig()) {
      const checkout = await this.db.onlineCheckout.findFirst({
        where: { order: { trackingHash: hash(token), status: 'NEW', paymentStatus: 'PENDING' } },
        select: { orderId: true, providerId: true },
      });
      if (checkout?.providerId && (await this.claimCheck(checkout.orderId, 10_000))) {
        await this.sync(await this.readRemote(checkout.providerId));
      }
    }
    return this.orders.tracking(token);
  }

  private async claimCheck(orderId: string, interval: number) {
    const now = new Date();
    const result = await this.db.onlineCheckout.updateMany({
      where: {
        orderId,
        order: { status: 'NEW', paymentStatus: 'PENDING' },
        OR: [{ checkedAt: null }, { checkedAt: { lte: new Date(now.getTime() - interval) } }],
      },
      data: { checkedAt: now },
    });
    return result.count > 0;
  }

  private async readRemote(id: string) {
    const remote = await mercadoPagoRequest('/' + encodeURIComponent(id));
    if (remote.id !== id)
      throw new BadGatewayException('La orden recibida no coincide con el cobro');
    return remote;
  }

  private checkoutUrl(value?: string) {
    if (!value) return;
    try {
      const url = new URL(value);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        [
          'www.mercadopago.com.ar',
          'mercadopago.com.ar',
          'www.mercadopago.com',
          'mercadopago.com',
        ].includes(url.hostname) &&
        url.pathname.startsWith('/checkout/')
      )
        return url.href;
    } catch {}
  }

  private matches(remote: ProviderOrder, local: { id: string; total: number }) {
    return (
      remote.external_reference === local.id &&
      String(remote.user_id) === mercadoPagoConfig()?.seller &&
      remote.currency === 'ARS' &&
      providerCents(remote.total_amount) === local.total
    );
  }

  private async sync(remote: ProviderOrder) {
    const changed = await atomic(this.db, async (tx) => {
      const checkout = await tx.onlineCheckout.findUnique({
        where: { providerId: remote.id },
        include: { order: true },
      });
      if (!checkout) return false;
      const order = checkout.order;
      if (!this.matches(remote, order))
        throw new BadGatewayException('El cobro no coincide con el pedido');
      const payment = await tx.payment.findUniqueOrThrow({
        where: { key: `${order.key}:initial` },
      });
      if (
        ['canceled', 'cancelled', 'expired'].includes(remote.status) ||
        (remote.status === 'failed' && remote.status_detail === 'expired')
      ) {
        if (order.status !== 'NEW' || payment.status !== 'PENDING') return false;
        await this.orders.changeInTransaction(tx, order.id, 'CANCELLED', actor);
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'REPLACED' } });
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'CANCELLED' } });
        return true;
      }
      const approved = remote.status === 'processed' && remote.status_detail === 'accredited';
      const refunded =
        remote.status === 'refunded' || remote.status_detail === 'partially_refunded';
      if (!approved && !refunded) return false;
      const refunds = [
        ...new Map(
          (remote.transactions?.refunds ?? [])
            .filter((item) => item.status === 'processed')
            .map((item) => [item.id, item]),
        ).values(),
      ];
      const refundTotal = refunds.reduce((sum, item) => sum + (providerCents(item.amount) ?? 0), 0);
      const paid = providerCents(remote.total_paid_amount);
      if (
        approved
          ? paid !== order.total
          : !refundTotal ||
            refundTotal > order.total ||
            (paid !== order.total && (paid ?? -1) + refundTotal !== order.total)
      )
        throw new BadGatewayException('El importe acreditado no coincide con el pedido');
      const shift = await tx.shift.findFirst({ where: { closedAt: null }, select: { id: true } });
      let updated = false;
      if (payment.status === 'PENDING') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), shiftId: shift?.id },
        });
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
        await audit(tx, actor, 'MP_PAYMENT', order.id, {
          providerId: remote.id,
          amount: order.total,
        });
        updated = true;
      }
      if (!refunds.length) {
        if (updated && order.status === 'NEW' && order.channel === 'WEB' && await queueOrderAlerts(tx, order.id)) {
          return order.id;
        }
        return updated;
      }
      for (const item of refunds) {
        const amount = providerCents(item.amount);
        if (!amount) continue;
        const key = `mp-refund:${item.id}`;
        if (await tx.payment.findUnique({ where: { key } })) continue;
        await tx.payment.create({
          data: {
            key,
            orderId: order.id,
            method: onlineMethod.id,
            amount: -amount,
            fee: 0,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            shiftId: shift?.id,
          },
        });
        await audit(tx, actor, 'MP_REFUND', order.id, { id: item.id, amount });
        updated = true;
      }
      if (!updated) return false;
      const refundsSum = await tx.payment.aggregate({
        where: {
          orderId: order.id,
          method: onlineMethod.id,
          amount: { lt: 0 },
          status: 'CONFIRMED',
        },
        _sum: { amount: true },
      });
      const full = -(refundsSum._sum.amount ?? 0) >= order.total;
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      });
      if (full && order.status === 'NEW')
        await this.orders.changeInTransaction(tx, order.id, 'CANCELLED', actor);
      return true;
    });
    if (changed) this.orders.notify();
    if (typeof changed === 'string') await this.push.deliver(changed);
  }

  async reconcilePending() {
    if (this.checking) return;
    this.checking = true;
    try {
      const now = new Date();
      const expiry = new Date(now.getTime() - onlinePaymentWindow);
      const pending = await this.db.onlineCheckout.findMany({
        where: {
          order: { status: 'NEW', paymentStatus: 'PENDING' },
          AND: [
            { OR: [{ providerId: { not: null } }, { order: { createdAt: { lte: expiry } } }] },
            { OR: [{ checkedAt: null }, { checkedAt: { lte: new Date(now.getTime() - 60_000) } }] },
          ],
        },
        include: { order: { select: { createdAt: true } } },
        take: 20,
        orderBy: { checkedAt: { sort: 'asc', nulls: 'first' } },
      });
      await Promise.allSettled(
        pending.map(async (item) => {
          if (!(await this.claimCheck(item.orderId, 60_000))) return;
          if (!item.providerId) {
            await atomic(this.db, async (tx) => {
              const current = await tx.onlineCheckout.findUnique({
                where: { orderId: item.orderId },
                include: { order: true },
              });
              if (
                !current ||
                current.providerId ||
                current.order.status !== 'NEW' ||
                current.order.paymentStatus !== 'PENDING'
              )
                return;
              await this.orders.changeInTransaction(tx, item.orderId, 'CANCELLED', actor);
              await tx.payment.updateMany({
                where: { orderId: item.orderId, status: 'PENDING' },
                data: { status: 'REPLACED' },
              });
              await tx.order.update({
                where: { id: item.orderId },
                data: { paymentStatus: 'CANCELLED' },
              });
            });
            return;
          }
          const path = '/' + encodeURIComponent(item.providerId);
          const remote = await this.readRemote(item.providerId);
          if (
            item.order.createdAt <= expiry &&
            ['created', 'failed'].includes(remote.status) &&
            remote.status_detail !== 'expired'
          ) {
            const key = createHash('sha256')
              .update(`mp-cancel:${item.providerId}`)
              .digest('hex')
              .slice(0, 32);
            await mercadoPagoRequest(path + '/cancel', {}, key);
            await this.sync(await this.readRemote(item.providerId));
          } else await this.sync(remote);
        }),
      ).then((results) => {
        if (results.some((result) => result.status === 'rejected'))
          this.logger.warn('Algunos cobros pendientes se volverán a consultar.');
      });
    } catch {
      this.logger.warn('No se pudieron consultar los cobros pendientes.');
    } finally {
      this.checking = false;
    }
  }
}
