import {
  BadGatewayException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { z } from 'zod';
import { Db } from './db';
import { OrderWhatsApp, queueOrderWhatsApp } from './order-whatsapp';

const lifetime = 10 * 60_000;
const batchSize = 20;

export const pushEndpoint = z
  .string()
  .max(1024)
  .refine((endpoint) => {
    try {
      const url = new URL(endpoint);
      const provider =
        /^(?:fcm\.googleapis\.com|android\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com)$/;
      return (
        url.protocol === 'https:' &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        provider.test(url.hostname)
      );
    } catch {
      return false;
    }
  }, 'El servicio de notificaciones de este navegador no es compatible.');

const subscription = z.object({
  endpoint: pushEndpoint,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(?:==)?$/),
  }),
});

export async function queueOrderAlerts(tx: Prisma.TransactionClient, orderId: string) {
  const whatsappQueued = await queueOrderWhatsApp(tx, orderId);
  const devices = await tx.pushDevice.findMany({
    where: { user: { active: true } },
    select: { endpoint: true },
  });
  if (!devices.length) return whatsappQueued;
  await tx.pushDelivery.createMany({
    data: devices.map(({ endpoint }) => ({ orderId, endpoint })),
    skipDuplicates: true,
  });
  return true;
}

@Injectable()
export class OrderPush implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderPush.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(Db) private db: Db,
    @Inject(OrderWhatsApp) private whatsapp: OrderWhatsApp,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL !== '1') this.timer = setInterval(() => void this.deliver(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async publicKey() {
    const identity = await this.db.pushIdentity.findUnique({ where: { id: 1 } });
    if (identity) return { publicKey: identity.publicKey };
    const keys = await this.db.pushIdentity
      .upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, ...generateVAPIDKeys() },
      })
      .catch(async (error) => {
        if (error.code !== 'P2002') throw error;
        return this.db.pushIdentity.findUniqueOrThrow({ where: { id: 1 } });
      });
    return { publicKey: keys.publicKey };
  }

  async save(userId: string, raw: unknown) {
    const { endpoint, keys } = subscription.parse(raw);
    const data = { userId, ...keys };
    await this.db.$transaction(async (tx) => {
      await tx.pushDelivery.deleteMany({
        where: { endpoint, device: { userId: { not: userId } } },
      });
      await tx.pushDevice.upsert({
        where: { endpoint },
        update: data,
        create: { endpoint, ...data },
      });
    });
    return { ok: true };
  }

  async remove(userId: string, endpoint: string) {
    await this.db.pushDevice.deleteMany({ where: { endpoint, userId } });
    return { ok: true };
  }

  async test(userId: string, endpoint: string) {
    const device = await this.db.pushDevice.findFirst({ where: { endpoint, userId } });
    if (!device) throw new NotFoundException('Activá los avisos en este dispositivo.');
    const identity = await this.db.pushIdentity.findUniqueOrThrow({ where: { id: 1 } });
    try {
      await this.send(
        device,
        identity,
        'Aviso de prueba',
        'Ya podés recibir avisos de pedidos de Burger Tilín.',
        'test',
      );
    } catch (error) {
      if (this.expired(error)) {
        await this.remove(userId, endpoint);
        throw new NotFoundException('Venció la suscripción. Volvé a activar los avisos.');
      }
      throw new BadGatewayException('No pudimos enviar el aviso de prueba. Probá de nuevo.');
    }
    return { ok: true };
  }

  private expired(error: unknown) {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    return status === 404 || status === 410;
  }

  private send(
    device: { endpoint: string; p256dh: string; auth: string },
    identity: { publicKey: string; privateKey: string },
    title: string,
    body: string,
    tag: string,
  ) {
    const { endpoint, p256dh, auth } = device;
    pushEndpoint.parse(endpoint);
    return sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify({ title, body, tag }),
      {
        vapidDetails: { ...identity, subject: 'https://burgertilin.com' },
        TTL: 180,
        urgency: 'high',
        topic: tag,
        timeout: 3500,
      },
    );
  }

  async deliver(orderId?: string) {
    await Promise.all([this.deliverPush(orderId), this.whatsapp.deliver(orderId)]);
  }

  private async deliverPush(orderId?: string) {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - lifetime);
      if (!orderId) {
        await this.db.pushDelivery.deleteMany({
          where: { OR: [{ nextAttemptAt: { lt: cutoff } }, { order: { status: { not: 'NEW' } } }] },
        });
      }
      const due = await this.db.pushDelivery.findMany({
        where: {
          orderId,
          sentAt: null,
          attempts: { lt: 5 },
          nextAttemptAt: { gte: cutoff, lte: now },
          order: { status: 'NEW', archivedAt: null },
          device: { user: { active: true } },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: batchSize,
        include: { order: { select: { number: true } }, device: true },
      });
      if (!due.length) return;
      const identity = await this.db.pushIdentity.findUniqueOrThrow({ where: { id: 1 } });
      await Promise.all(
        due.map(async (delivery) => {
          const { orderId, endpoint, attempts } = delivery;
          const where = { orderId, endpoint };
          const claim = await this.db.pushDelivery.updateMany({
            where: {
              ...where,
              attempts,
              sentAt: null,
              order: { status: 'NEW', archivedAt: null },
              device: { userId: delivery.device.userId, user: { active: true } },
            },
            data: {
              attempts: { increment: 1 },
              nextAttemptAt: new Date(now.getTime() + 15_000 * 2 ** attempts),
            },
          });
          if (!claim.count) return;
          const { number } = delivery.order;
          try {
            await this.send(
              delivery.device,
              identity,
              'Nuevo pedido en Burger Tilín',
              `Abrí el admin para ver el pedido #${number}.`,
              `pedido-${number}`,
            );
            await this.db.pushDelivery.updateMany({ where, data: { sentAt: new Date() } });
          } catch (error) {
            if (this.expired(error)) {
              const { userId, p256dh, auth } = delivery.device;
              await this.db.pushDevice.deleteMany({ where: { endpoint, userId, p256dh, auth } });
            } else {
              this.logger.warn(
                'No se pudo enviar un aviso de pedido. Se reintentará desde la cola.',
              );
            }
          }
        }),
      );
    } catch {
      // A push failure must not turn a committed sale or payment into a failed request.
      this.logger.warn('No se pudo procesar la cola de avisos de pedidos.');
    }
  }
}
