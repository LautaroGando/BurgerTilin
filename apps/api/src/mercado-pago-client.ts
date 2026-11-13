import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const onlineMethod = {
  id: 'mercadopago_online',
  name: 'Mercado Pago',
  cash: false,
  receivable: false,
};
export const onlinePaymentWindow = 15 * 60_000;

export function reservedPaymentMethod(method: { id: string; name: string }) {
  return (
    method.id === onlineMethod.id ||
    method.name.trim().toLowerCase().replace(/\s+/g, '') === 'mercadopago'
  );
}

export function mercadoPagoConfig() {
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  const seller = process.env.MP_SELLER_ID?.trim();
  const origin = process.env.WEB_ORIGIN?.trim();
  const test = process.env.MP_TEST_MODE === 'true';
  const feeBps = Number(process.env.MP_FEE_BPS || '0');
  if (!accessToken || !seller || !origin || !/^\d+$/.test(seller)) return;
  if (test ? process.env.NODE_ENV === 'production' : !secret) return;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) return;
  try {
    const url = new URL(origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const allowed = test
      ? loopback && url.protocol === 'http:'
      : !loopback &&
        url.protocol === 'https:' &&
        url.hostname.includes('.') &&
        !url.hostname.endsWith('.localhost');
    if (allowed && url.origin === origin)
      return { accessToken, secret, seller, origin, feeBps, test };
  } catch {}
}

let verifiedSandbox: { token: string; seller: string } | undefined;
async function verifySandbox(token: string, seller: string) {
  if (verifiedSandbox?.token === token && verifiedSandbox.seller === seller) return;
  const response = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  const account = z
    .object({ id: z.union([z.number(), z.string()]), tags: z.array(z.string()) })
    .safeParse(await response.json());
  if (
    !response.ok ||
    !account.success ||
    String(account.data.id) !== seller ||
    !account.data.tags.includes('test_user')
  ) {
    throw new ServiceUnavailableException(
      'El modo de prueba requiere una cuenta de prueba de Mercado Pago.',
    );
  }
  verifiedSandbox = { token, seller };
}

export function validSignature(secret: string, id: string, requestId: string, signature: string) {
  if (typeof id !== 'string' || typeof requestId !== 'string' || typeof signature !== 'string')
    return false;
  const parts = new URLSearchParams(
    signature
      .split(',')
      .map((part) => part.trim())
      .join('&'),
  );
  const timestamp = parts.get('ts');
  const digest = parts.get('v1');
  if (
    !/^ORD[A-Z0-9]+$/i.test(id) ||
    !requestId ||
    !timestamp ||
    !/^\d{10,13}$/.test(timestamp) ||
    !digest ||
    !/^[0-9a-f]{64}$/i.test(digest)
  )
    return false;
  const expected = createHmac('sha256', secret)
    .update(`id:${id};request-id:${requestId};ts:${timestamp};`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(digest, 'hex'));
}

const providerOrder = z.object({
  id: z.string().regex(/^ORD[A-Z0-9]+$/i),
  external_reference: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  total_amount: z.string(),
  total_paid_amount: z.string().optional(),
  status: z.string(),
  status_detail: z.string().optional(),
  checkout_url: z.string().optional(),
  transactions: z
    .object({
      refunds: z
        .array(z.object({ id: z.string(), amount: z.string(), status: z.string() }))
        .optional(),
    })
    .optional(),
});

export function providerCents(value = '') {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export async function mercadoPagoRequest(path = '', body?: object, key?: string) {
  const config = mercadoPagoConfig();
  if (!config) throw new ServiceUnavailableException('Mercado Pago no está habilitado');
  try {
    if (config.test) await verifySandbox(config.accessToken, config.seller);
    const response = await fetch('https://api.mercadopago.com/v1/orders' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json', 'X-Idempotency-Key': key! } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const order = providerOrder.parse(await response.json());
    if (config.test !== /^ORDTST/i.test(order.id)) throw new Error('Entorno de cobro inesperado');
    return order;
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new BadGatewayException('Mercado Pago no respondió correctamente. Volvé a intentar.');
  }
}
