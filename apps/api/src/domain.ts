import { DateTime } from 'luxon';
import { z } from 'zod';
export const TZ = 'America/Argentina/Buenos_Aires';
export const cents = z.number().int().min(0).max(100000000);
export const recipe = z
  .array(
    z.object({
      ingredientId: z.string(),
      quantity: z.number().int().positive(),
      removable: z.boolean().default(false),
    }),
  )
  .max(100);
export const productConfig = z.object({
  recipe: recipe.default([]),
  variants: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        delta: z.number().int().min(-100000000).max(100000000),
        recipe: recipe,
      }),
    )
    .default([]),
  extras: z
    .array(z.object({ id: z.string(), name: z.string(), price: cents, recipe: recipe }))
    .default([]),
  slots: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        quantity: z.number().int().min(1).max(20),
        choices: z
          .array(
            z.object({
              productId: z.string(),
              delta: z.number().int().min(-100000000).max(100000000),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
  channelPrices: z.record(z.string(), cents).default({}),
  promotion: z
    .object({
      from: z.string(),
      to: z.string(),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      channels: z.array(z.string()),
    })
    .optional(),
});
export const productInput = z.object({
  name: z.string().min(1).max(100),
  category: z.string().min(1).max(60),
  description: z.string().max(1200).default(''),
  image: z
    .string()
    .max(500)
    .refine(
      (v) => !v || (/^\/assets\/[\p{L}\p{N}_.% /()-]+$/u.test(v) && !v.includes('..')) || /^\/api\/media\/[0-9a-f-]{36}\.webp$/.test(v),
      'Elegí una imagen de la biblioteca o subí una foto',
    )
    .default(''),
  price: cents.nullable(),
  published: z.boolean().default(false),
  soldOut: z.boolean().default(false),
  favorite: z.boolean().default(false),
  config: productConfig,
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsInput = z.object({
  paused: z.boolean(),
  delay: z.number().int().min(5).max(240),
  whatsapp: z.string().regex(/^\d{0,15}$/),
  pickupAddress: z.string().max(300),
  schedule: z
    .array(z.object({ day: z.number().int().min(1).max(7), open: time, close: time }))
    .max(28),
  closures: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
  zones: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        fee: cents,
        minimum: cents,
        enabled: z.boolean(),
      }),
    )
    .max(100),
  methods: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        feeBps: z.number().int().min(0).max(10000),
        cash: z.boolean(),
        receivable: z.boolean().default(false),
        enabled: z.boolean(),
      }),
    )
    .max(20),
  channels: z
    .array(
      z.object({ id: z.string(), name: z.string(), feeBps: z.number().int().min(0).max(10000) }),
    )
    .max(30),
});
export type Settings = z.infer<typeof settingsInput>;
export const salesChannels = [
  { id: 'WEB', name: 'Web', feeBps: 0 },
  { id: 'WHATSAPP', name: 'WhatsApp', feeBps: 0 },
  { id: 'APPS', name: 'Apps', feeBps: 0 },
];
export const activeChannel = (channel: string) => (channel === 'PEDIDOSYA' ? 'APPS' : channel);
export const channelLabel = (channel: string) =>
  salesChannels.find((c) => c.id === activeChannel(channel))?.name ??
  (channel === 'COUNTER' ? 'Mostrador' : channel);
export const defaults: Settings = {
  paused: true,
  delay: 30,
  whatsapp: '',
  pickupAddress: '',
  schedule: [],
  closures: [],
  zones: [],
  methods: [
    { id: 'cash', name: 'Efectivo', feeBps: 0, cash: true, receivable: false, enabled: true },
    {
      id: 'transfer',
      name: 'Transferencia',
      feeBps: 0,
      cash: false,
      receivable: false,
      enabled: false,
    },
    {
      id: 'platform',
      name: 'A cobrar de plataforma',
      feeBps: 0,
      cash: false,
      receivable: true,
      enabled: false,
    },
  ],
  channels: salesChannels,
};
export function opening(settings: Settings, now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone: TZ });
  const intervals = [];
  for (let offset = -1; offset <= 8; offset++) {
    const day = local.startOf('day').plus({ days: offset });
    if (settings.closures.includes(day.toISODate()!)) continue;
    for (const s of settings.schedule.filter((s) => s.day === day.weekday)) {
      const [h, m] = s.open.split(':').map(Number),
        [ch, cm] = s.close.split(':').map(Number);
      const start = day.set({ hour: h, minute: m });
      let end = day.set({ hour: ch, minute: cm });
      if (end <= start) end = end.plus({ days: 1 });
      intervals.push({ start, end });
    }
  }
  const closedToday = settings.closures.includes(local.toISODate()!);
  return {
    open:
      !settings.paused && !closedToday && intervals.some((i) => i.start <= local && local < i.end),
    paused: settings.paused,
    nextOpen:
      intervals
        .filter((i) => i.start > local)
        .sort((a, b) => a.start.toMillis() - b.start.toMillis())[0]
        ?.start.toISO() || null,
  };
}
export const choiceInput = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  extras: z.array(z.string()).max(20).default([]),
  remove: z.array(z.string()).max(30).default([]),
});
export const lineInput = choiceInput.extend({
  quantity: z.number().int().min(1).max(30),
  components: z
    .array(z.object({ slotId: z.string(), choices: z.array(choiceInput).max(20) }))
    .max(20)
    .default([]),
  note: z.string().max(300).default(''),
});
export const orderInput = z.object({
  discount: cents.default(0),
  expectedTotal: cents.optional(),
  key: z.string().uuid(),
  channel: z.string().default('WEB'),
  fulfillment: z.enum(['PICKUP', 'DELIVERY']),
  name: z.string().min(1).max(100),
  phone: z.string().max(30).default(''),
  address: z.string().max(300).default(''),
  zone: z.string().default(''),
  notes: z.string().max(500).default(''),
  method: z.string(),
  items: z.array(lineInput).min(1).max(50),
});
export const transitions: Record<string, string[]> = {
  NEW: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DISPATCHED', 'DELIVERED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};
export function phoneKey(s: string) {
  const digits = s.replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function integerMoney(n: number) {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1000000000)
    throw new Error('Importe fuera de rango');
  return n;
}
