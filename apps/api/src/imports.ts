import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hash } from './auth';
import { Db } from './db';
import { Catalog } from './catalog';
import { Orders } from './orders';
import { activeChannel, orderInput, lineInput } from './domain';
const file = z.object({
  format: z.literal('burger-tilin/v1'),
  channel: z.string(),
  records: z
    .array(
      z.object({
        externalId: z.string().min(1).max(100),
        order: orderInput.omit({ key: true, channel: true }),
      }),
    )
    .min(1)
    .max(100),
  confirm: z.boolean().default(false),
});
function importKey(channel: string, id: string) {
  const h = hash(`burger-tilin-import:${channel}:${id}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
@Injectable()
export class Imports {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Catalog) private catalog: Catalog,
    @Inject(Orders) private orders: Orders,
  ) {}
  async run(raw: unknown, actor: string) {
    const data = file.parse(raw);
    if (data.channel === 'WEB') throw new BadRequestException('Usá un canal externo para importar');
    const channel = activeChannel(data.channel);
    const settings = await this.catalog.settings();
    if (!settings.channels.some((c) => c.id === channel))
      throw new BadRequestException('Canal inexistente');
    const results = [];
    for (const record of data.records) {
      // Preserve the original key and request body for PedidosYa imports made before Apps.
      const prefix = 'pedidosya:';
      const pedidosYa = data.channel === 'APPS' && record.externalId.startsWith(prefix);
      const originalChannel = pedidosYa ? 'PEDIDOSYA' : data.channel;
      const externalId = pedidosYa ? record.externalId.slice(prefix.length) : record.externalId;
      const key = importKey(originalChannel, externalId);
      try {
        if (data.confirm) {
          const result = await this.orders.create(
            { ...record.order, key, channel: originalChannel },
            actor,
          );
          results.push({ externalId: record.externalId, ok: true, ...result });
        } else {
          const existing = await this.db.order.findUnique({ where: { key } });
          if (existing) {
            results.push({
              externalId: record.externalId,
              ok: true,
              duplicate: true,
              number: existing.number,
            });
            continue;
          }
          const quote = await this.catalog.compile(
            this.db,
            record.order.items,
            channel,
            false,
          );
          results.push({ externalId: record.externalId, ok: true, subtotal: quote.subtotal });
        }
      } catch (e: any) {
        results.push({ externalId: record.externalId, ok: false, error: e.message });
      }
    }
    return { confirmed: data.confirm, results };
  }
  async repeat(id: string) {
    const order = await this.db.order.findUniqueOrThrow({ where: { id } });
    const products = await this.db.product.findMany({ where: { archivedAt: null } });
    const map = new Map(products.map((p) => [p.id, p]));
    const choice = (snapshot: any) => {
      const p = map.get(snapshot.productId);
      if (!p) throw new BadRequestException('Un producto ya no existe');
      const c: any = p.config;
      const variant = snapshot.variant
        ? c.variants?.find((v: any) =>
            snapshot.variantId ? v.id === snapshot.variantId : v.name === snapshot.variant,
          )
        : null;
      if (snapshot.variant && !variant)
        throw new BadRequestException('Una variante ya no está disponible');
      const extras =
        snapshot.extraIds ||
        (snapshot.extras || []).map((name: string) => {
          const e = c.extras?.find((e: any) => e.name === name);
          if (!e) throw new BadRequestException('Un extra ya no está disponible');
          return e.id;
        });
      if (snapshot.remove?.length && !snapshot.removeIds)
        throw new BadRequestException(
          'Revisá las exclusiones de este pedido antiguo en Venta rápida',
        );
      return { productId: p.id, variantId: variant?.id, extras, remove: snapshot.removeIds || [] };
    };
    const items = (order.items as any[]).map((i) => {
      const parent = map.get(i.productId);
      const c: any = parent?.config;
      if (!c) throw new BadRequestException('Producto inexistente');
      return {
        ...choice(i),
        quantity: i.quantity,
        note: i.note || '',
        components: (c.slots || []).map((s: any) => ({
          slotId: s.id,
          choices: (i.components || [])
            .filter((x: any) => (x.slotId ? x.slotId === s.id : x.slot === s.name))
            .map(choice),
        })),
      };
    });
    const parsed = z.array(lineInput).parse(items);
    const settings = await this.catalog.settings();
    const originalChannel = activeChannel(order.channel);
    const channel = settings.channels.some((c) => c.id === originalChannel)
      ? originalChannel
      : 'WHATSAPP';
    const quote = await this.catalog.compile(this.db, parsed, channel, false);
    return {
      channel,
      name: order.customerName,
      phone: order.phone,
      fulfillment: order.fulfillment,
      address: order.address,
      zone: order.zone,
      notes: order.notes,
      items: parsed,
      quote: { items: quote.items, subtotal: quote.subtotal },
    };
  }
}
