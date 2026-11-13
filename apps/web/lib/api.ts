export async function api(path: string, body?: unknown, method?: string) {
  const response = await fetch('/api/' + path, {
    method: method || (body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => undefined);
  if (response.ok && data !== undefined) return data;
  const message = data?.message || 'El servidor no devolvió una respuesta válida. Volvé a intentar.';
  throw Object.assign(new Error(message), { status: response.status });
}
export const money = (c: number | null | undefined) =>
  c === null || c === undefined
    ? 'Sin definir'
    : new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(c / 100);
export const date = (d: string) =>
  new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d));
export const statusNames: Record<string, string> = {
  NEW: 'Nuevo',
  ACCEPTED: 'Aceptado',
  PREPARING: 'En preparación',
  READY: 'Listo',
  DISPATCHED: 'En reparto',
  DELIVERED: 'Entregado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
  PENDING: 'Pendiente',
  PAID: 'Cobrado',
  REFUNDED: 'Reembolsado',
  PARTIALLY_REFUNDED: 'Reembolso parcial',
  CONFIRMED: 'Confirmado',
  REPLACED: 'Reemplazado',
};
const channelNames: Record<string, string> = {
  WEB: 'Web',
  WHATSAPP: 'WhatsApp',
  APPS: 'Apps',
  PEDIDOSYA: 'Apps',
  COUNTER: 'Mostrador',
};
export const channelLabel = (channel: string) => channelNames[channel] ?? channel;
export const emptyConfig = { recipe: [], variants: [], extras: [], slots: [], channelPrices: {} };
export type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  image: string;
  price: number | null;
  published: boolean;
  soldOut: boolean;
  favorite: boolean;
  available: boolean;
  config: any;
};
export type CartLine = {
  productId: string;
  quantity: number;
  variantId?: string;
  extras: string[];
  remove: string[];
  components: { slotId: string; choices: any[] }[];
  note: string;
  label: string;
  displayPrice: number;
};
