import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Db } from './db';

const env = z.object({
  WHATSAPP_ORDER_TOKEN: z.string().trim().min(1),
  WHATSAPP_ORDER_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
  WHATSAPP_ORDER_RECIPIENT: z.string().regex(/^[1-9]\d{7,14}$/),
  WHATSAPP_ORDER_TEMPLATE: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .default('tilin_nuevo_pedido'),
  WHATSAPP_ORDER_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2}(?:_[A-Z]{2})?$/)
    .default('es_AR'),
});
const acceptedMessage = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });
const lifetime = 10 * 60_000;
const maxAttempts = 3;

function config() {
  const parsed = env.safeParse(process.env);
  return parsed.success ? parsed.data : undefined;
}

export async function queueOrderWhatsApp(tx: Prisma.TransactionClient, orderId: string) {
  const settings = config();
  if (!settings) return false;
  await tx.whatsAppDelivery.createMany({
    data: [{ orderId, recipient: settings.WHATSAPP_ORDER_RECIPIENT }],
    skipDuplicates: true,
  });
  return true;
}

@Injectable()
export class OrderWhatsApp {
  private readonly logger = new Logger(OrderWhatsApp.name);

  constructor(@Inject(Db) private db: Db) {}

  async deliver(orderId?: string) {
    const settings = config();
    if (!settings) return;
    try {
      const now = new Date();
      const due = {
        status: 'PENDING',
        recipient: settings.WHATSAPP_ORDER_RECIPIENT,
        createdAt: { gte: new Date(now.getTime() - lifetime) },
        nextAttemptAt: { lte: now },
        order: { channel: 'WEB', status: 'NEW' as const, archivedAt: null },
      };
      const messages = await this.db.whatsAppDelivery.findMany({
        where: { ...due, orderId },
        orderBy: { nextAttemptAt: 'asc' },
        take: 10,
        include: { order: { select: { number: true } } },
      });
      await Promise.all(
        messages.map(async (message) => {
          const where = { orderId: message.orderId };
          // Keep ambiguous sends out of automatic retries. Meta may already have accepted them.
          const claim = await this.db.whatsAppDelivery.updateMany({
            where: { ...due, ...where, attempts: message.attempts },
            data: { status: 'UNCERTAIN', attempts: { increment: 1 } },
          });
          if (!claim.count) return;
          try {
            const response = await fetch(
              `https://graph.facebook.com/v27.0/${settings.WHATSAPP_ORDER_PHONE_NUMBER_ID}/messages`,
              {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(3500),
                headers: {
                  Authorization: `Bearer ${settings.WHATSAPP_ORDER_TOKEN}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  messaging_product: 'whatsapp',
                  to: message.recipient,
                  type: 'template',
                  template: {
                    name: settings.WHATSAPP_ORDER_TEMPLATE,
                    language: { code: settings.WHATSAPP_ORDER_LANGUAGE },
                    components: [
                      {
                        type: 'body',
                        parameters: [{ type: 'text', text: String(message.order.number) }],
                      },
                    ],
                  },
                }),
              },
            );
            if (response.ok) {
              const result = acceptedMessage.parse(await response.json());
              await this.db.whatsAppDelivery.updateMany({
                where,
                data: { status: 'ACCEPTED', providerMessageId: result.messages[0].id },
              });
              return;
            }
            if (response.status === 429 && message.attempts + 1 < maxAttempts) {
              await this.db.whatsAppDelivery.updateMany({
                where,
                data: {
                  status: 'PENDING',
                  nextAttemptAt: new Date(now.getTime() + 60_000 * (message.attempts + 1)),
                },
              });
            } else if (response.status < 500) {
              await this.db.whatsAppDelivery.updateMany({ where, data: { status: 'FAILED' } });
            }
            this.logger.warn(
              `Meta rechazó o no confirmó el aviso del pedido #${message.order.number} (HTTP ${response.status}).`,
            );
          } catch {
            this.logger.warn(
              `No se pudo confirmar el aviso por WhatsApp del pedido #${message.order.number}.`,
            );
          }
        }),
      );
    } catch {
      this.logger.warn('No se pudo procesar la cola de avisos por WhatsApp.');
    }
  }
}
