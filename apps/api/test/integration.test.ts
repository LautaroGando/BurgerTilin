import 'dotenv/config';
import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { Db } from '../src/db';
import { Catalog } from '../src/catalog';
import { Orders } from '../src/orders';
import { Finance } from '../src/finance';
import { defaults, Settings } from '../src/domain';
import { passwordHash } from '../src/auth';
const enabled = process.env.TEST_DATABASE_URL;
if (enabled) {
  if (!new URL(enabled).pathname.endsWith('_test'))
    throw new Error('La base de pruebas debe terminar en _test');
  process.env.DATABASE_URL = enabled;
}
const db = enabled ? new Db() : null;
after(async () => {
  await db?.$disconnect();
});
test(
  'PostgreSQL: circuito completo, combos, concurrencia, pagos y cancelaciones',
  { skip: !enabled },
  async () => {
    const d = db!;
    const c = new Catalog(d),
      o = new Orders(d, c),
      f = new Finance(d, c, o);
    // Only isolated *_test database is reset.
    await d.$executeRawUnsafe(
      'TRUNCATE TABLE "Audit", "CashEntry", "Payment", "Reservation", "StockMovement", "Order", "Customer", "Shift", "Ingredient", "Product", "Session", "User", "Settings" RESTART IDENTITY CASCADE',
    );
    const settings: Settings = {
      ...defaults,
      paused: false,
      schedule: Array.from({ length: 7 }, (_, i) => ({
        day: i + 1,
        open: '00:00',
        close: '00:00',
      })),
      methods: [
        ...defaults.methods.map((m) => ({ ...m, enabled: true })),
        { id: 'card', name: 'Tarjeta', enabled: true, feeBps: 100, cash: false, receivable: false },
        {
          id: 'mp-manual',
          name: 'Mercado Pago',
          enabled: true,
          feeBps: 0,
          cash: false,
          receivable: false,
        },
      ],
    };
    await d.settings.create({ data: { id: 1, data: settings } });
    const ingredient = await d.ingredient.create({
      data: {
        name: 'Insumo de prueba',
        unit: 'unit',
        stock: 5,
        strict: true,
        cost: 100,
        minimum: 1,
      },
    });
    const recipe = [{ ingredientId: ingredient.id, quantity: 1, removable: true }];
    const p = await d.product.create({
      data: {
        name: 'Producto de prueba',
        category: 'Pruebas',
        description: 'Fixture de prueba aislado',
        price: 1000,
        published: true,
        config: {
          recipe,
          variants: [
            { id: 'double', name: 'Doble', delta: 300, recipe: [{ ...recipe[0], quantity: 2 }] },
          ],
          extras: [{ id: 'extra', name: 'Extra', price: 200, recipe }],
          slots: [],
          channelPrices: { APPS: 1200 },
        },
      },
    });
    const comboIngredient = await d.ingredient.create({
      data: { name: 'Insumo extra del combo', unit: 'unit', stock: 5, strict: true, cost: 80 },
    });
    const removableIngredient = await d.ingredient.create({
      data: { name: 'Panceta de prueba', unit: 'unit', stock: 4, strict: true, cost: 60 },
    });
    const combo = await d.product.create({
      data: {
        name: 'Combo de prueba',
        category: 'Pruebas',
        price: 2000,
        published: true,
        config: {
          recipe: [
            { ingredientId: comboIngredient.id, quantity: 1 },
            { ingredientId: removableIngredient.id, quantity: 1, removable: true },
          ],
          extras: [
            {
              id: 'combo-extra',
              name: 'Extra del combo',
              price: 300,
              recipe: [{ ingredientId: comboIngredient.id, quantity: 2 }],
            },
          ],
          slots: [
            {
              id: 'burgers',
              name: 'Hamburguesas',
              quantity: 2,
              choices: [{ productId: p.id, delta: 0 }],
            },
          ],
        },
      },
    });
    const input = (items: any[] = [{ productId: p.id, quantity: 1 }]) => ({
      key: randomUUID(),
      fulfillment: 'PICKUP',
      name: 'Prueba',
      phone: '+541112345678',
      method: 'cash',
      items,
    });
    const request = input([
      {
        productId: combo.id,
        quantity: 1,
        extras: ['combo-extra', 'combo-extra'],
        remove: [removableIngredient.id],
        components: [
          {
            slotId: 'burgers',
            choices: [
              { productId: p.id, variantId: 'double', extras: ['extra'], remove: [] },
              { productId: p.id, remove: [ingredient.id] },
            ],
          },
        ],
      },
    ]);
    await assert.rejects(() => o.create({ ...input(), expectedTotal: 1 }));
    await assert.rejects(() => o.create({ ...input(), discount: 1 }));
    await assert.rejects(
      () => o.create({ ...input(), method: 'mp-manual' }),
      /Medio de pago no habilitado/,
    );
    await assert.rejects(
      () => o.create(input([{ ...request.items[0], extras: ['extra'] }])),
      /Extra inválido/,
    );
    await assert.rejects(
      () => o.create(input([{ ...request.items[0], remove: [comboIngredient.id] }])),
      /No se puede quitar ese ingrediente/,
    );
    await assert.rejects(
      () =>
        o.create(
          input([{ ...request.items[0], extras: ['combo-extra', 'combo-extra', 'combo-extra'] }]),
        ),
      /Sin stock suficiente: Insumo extra del combo/,
    );
    const created = await o.create(request);
    assert.equal(created.total, 3100);
    const snapshot = (await o.tracking(created.tracking)).items as {
      extras: string[];
      extraIds: string[];
      remove: string[];
      removeIds: string[];
      components: { extras: string[] }[];
    }[];
    assert.deepEqual(snapshot[0].extras, ['2 × Extra del combo']);
    assert.deepEqual(snapshot[0].extraIds, ['combo-extra', 'combo-extra']);
    assert.deepEqual(snapshot[0].remove, ['Panceta de prueba']);
    assert.deepEqual(snapshot[0].removeIds, [removableIngredient.id]);
    assert.deepEqual(snapshot[0].components[0].extras, ['Extra']);
    assert.equal(
      (await d.ingredient.findUniqueOrThrow({ where: { id: comboIngredient.id } })).reserved,
      5,
    );
    assert.equal(
      (await d.ingredient.findUniqueOrThrow({ where: { id: removableIngredient.id } })).reserved,
      0,
    );
    assert.equal(
      (await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).reserved,
      3,
    );
    const same = await o.create(request);
    assert.equal(same.id, created.id);
    assert.equal(await d.order.count(), 1);
    await assert.rejects(() => o.create({ ...request, name: 'Otro' }));
    await o.change(created.id, 'ACCEPTED', 'test');
    await o.change(created.id, 'PREPARING', 'test');
    let stock = await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
    assert.equal(stock.stock, 2);
    assert.equal(stock.reserved, 0);
    const extraStock = await d.ingredient.findUniqueOrThrow({ where: { id: comboIngredient.id } });
    assert.equal(extraStock.stock, 0);
    assert.equal(extraStock.reserved, 0);
    assert.equal(
      (await d.ingredient.findUniqueOrThrow({ where: { id: removableIngredient.id } })).stock,
      4,
    );
    await o.change(created.id, 'CANCELLED', 'test');
    stock = await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
    assert.equal(stock.stock, 2);
    assert.equal(await d.stockMovement.count({ where: { kind: 'WASTE_AFTER_COOKING' } }), 2);
    const trials = await Promise.allSettled(Array.from({ length: 5 }, () => o.create(input())));
    const successes = trials.filter(
      (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
    );
    assert.equal(successes.length, 2);
    assert.equal(
      (await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).reserved,
      2,
    );
    await o.change(successes[0].value.id, 'CANCELLED', 'test');
    assert.equal(
      (await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).reserved,
      1,
    );
    const sale = successes[1].value;
    const shift = await f.open({ opening: 5000 }, 'test');
    const payments = {
      key: randomUUID(),
      payments: [
        { method: 'cash', amount: 400, verified: true },
        { method: 'transfer', amount: 600, verified: false },
      ],
    };
    await f.pay(sale.id, payments, 'test');
    await f.pay(sale.id, payments, 'test');
    assert.equal(await d.payment.count({ where: { orderId: sale.id, status: 'CONFIRMED' } }), 1);
    assert.equal(
      (await d.order.findUniqueOrThrow({ where: { id: sale.id } })).paymentStatus,
      'PENDING',
    );
    const pending = await d.payment.findFirstOrThrow({
      where: { orderId: sale.id, status: 'PENDING' },
    });
    await f.verify(pending.id, 'test');
    await f.verify(pending.id, 'test');
    assert.equal(
      (await d.order.findUniqueOrThrow({ where: { id: sale.id } })).paymentStatus,
      'PAID',
    );
    await o.change(sale.id, 'ACCEPTED', 'test');
    await o.change(sale.id, 'PREPARING', 'test');
    await o.change(sale.id, 'READY', 'test');
    await o.change(sale.id, 'DELIVERED', 'test');
    const tracking = await o.tracking(sale.tracking);
    assert.equal(tracking.status, 'DELIVERED');
    assert.equal('phone' in tracking, false);
    await assert.rejects(() => o.tracking('bad'));
    const closed = await f.close({ counted: 5350 }, 'test');
    assert.equal(closed.expected, 5400);
    assert.equal(closed.difference, -50);
    assert.equal(closed.id, shift.id);
    // Platform collection cancels a receivable; it never creates a second sale.
    await d.ingredient.update({ where: { id: ingredient.id }, data: { stock: 20 } });
    await f.open({ opening: 0 }, 'test');
    const platform = await o.create({ ...input(), channel: 'APPS', method: 'platform' }, 'test');
    await f.pay(
      platform.id,
      { key: randomUUID(), payments: [{ method: 'platform', amount: 1200, verified: true }] },
      'test',
    );
    const before = await f.sales({});
    const receivable = (await f.receivables()).find((p) => p.orderId === platform.id)!;
    assert.ok(receivable);
    const settleRequest = {
      key: randomUUID(),
      paymentIds: [receivable.id],
      amount: 1200,
      method: 'transfer',
      reference: 'Liquidación de prueba',
    };
    await f.settle(settleRequest, 'test');
    await f.settle(settleRequest, 'test');
    const after = await f.sales({});
    assert.equal(after.totals.gross, before.totals.gross);
    assert.equal(after.totals.collected - before.totals.collected, 1200);
    assert.equal((await f.receivables()).length, 0);
    assert.equal((await f.sales({ channel: 'APPS' })).orders[0]?.id, platform.id);
    await d.order.update({ where: { id: platform.id }, data: { channel: 'PEDIDOSYA' } });
    assert.equal((await f.sales({ channel: 'APPS' })).orders[0]?.id, platform.id);
    assert.match(await f.csv({ channel: 'APPS' }), /;"Apps";/);
    const payment = await d.payment.findFirstOrThrow({
      where: { orderId: sale.id, method: 'cash', amount: 400 },
    });
    const refund = { key: randomUUID(), paymentId: payment.id, reason: 'Prueba de devolución' };
    await f.refund(sale.id, refund, 'test');
    await f.refund(sale.id, refund, 'test');
    assert.equal(await d.payment.count({ where: { key: `refund:${payment.id}` } }), 1);
    const { Imports } = await import('../src/imports');
    const imports = new Imports(d, c, o);
    const file = {
      format: 'burger-tilin/v1',
      channel: 'WHATSAPP',
      confirm: true,
      records: [
        { externalId: 'test-import-1', order: { ...input(), channel: undefined, key: undefined } },
      ],
    };
    const first = await imports.run(file, 'test'),
      again = await imports.run(file, 'test');
    assert.equal(first.results[0].id, again.results[0].id);
    const legacyFile = { ...file, channel: 'PEDIDOSYA' };
    const legacyImport = await imports.run(legacyFile, 'test');
    const appsImport = await imports.run(
      {
        ...file,
        channel: 'APPS',
        records: [{ ...file.records[0], externalId: 'pedidosya:test-import-1' }],
      },
      'test',
    );
    assert.ok(legacyImport.results[0].id);
    assert.equal(appsImport.results[0].id, legacyImport.results[0].id);
    assert.equal(
      (await d.order.findUniqueOrThrow({ where: { id: appsImport.results[0].id } })).channel,
      'APPS',
    );
    const repeat = await imports.repeat(sale.id);
    assert.equal(repeat.quote.subtotal, 1000);
    const recovering = await o.create(input());
    assert.ok((await o.active()).some((x) => x.id === recovering.id));
    const actor = await d.user.create({
      data: {
        email: 'test@example.test',
        password: passwordHash('test-only-password'),
        role: 'OWNER',
      },
    });
    const kitchen = await o.active(true);
    for (const order of kitchen) {
      assert.equal('total' in order, false);
      assert.equal('phone' in order, false);
    }
    // HTTP auth boundary and SSE: reconnect starts with authoritative GET, not replayed memory.
    const { bootstrap } = await import('../src/main');
    const app = await bootstrap(0);
    try {
      const server = app.getHttpServer();
      const url = `http://127.0.0.1:${server.address().port}/api`;
      assert.equal((await fetch(url + '/admin/orders')).status, 401);
      const login = await fetch(url + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: actor.email, password: 'test-only-password' }),
      });
      assert.equal(login.status, 201);
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const adminProducts = await (
        await fetch(url + '/admin/products', { headers: { cookie } })
      ).json();
      const adminProduct = adminProducts.find((product: { id: string }) => product.id === p.id);
      assert.deepEqual(adminProduct.config.recipe[0], { ...recipe[0], name: ingredient.name });
      assert.deepEqual(adminProduct.config.variants[0].recipe[0], {
        ...recipe[0],
        quantity: 2,
        name: ingredient.name,
      });
      const publicMenu = await (await fetch(url + '/catalog')).json();
      const publicCombo = publicMenu.products.find(
        (product: { id: string }) => product.id === combo.id,
      );
      assert.deepEqual(publicCombo.config.recipe, [
        { ingredientId: removableIngredient.id, name: removableIngredient.name, removable: true },
      ]);
      const { OrderPush } = await import('../src/order-push');
      const orderPush = app.get(OrderPush);
      const sent: string[] = [];
      const transport = orderPush as unknown as { send: (...args: unknown[]) => Promise<void> };
      let failPush = false;
      transport.send = async (_device, _key, _title, _body, tag) => {
        if (failPush) throw new Error('Proveedor de prueba no disponible');
        sent.push(String(tag));
      };
      const pushHeaders = { cookie, 'Content-Type': 'application/json' };
      const keyUrl = url + '/admin/push/key';
      assert.equal((await fetch(keyUrl)).status, 401);
      const [key1, key2] = await Promise.all([fetch(keyUrl, { headers: { cookie } }), fetch(keyUrl, { headers: { cookie } })]);
      assert.equal(key1.status, 200);
      const identity = await key1.json();
      assert.deepEqual(await key2.json(), identity);
      assert.deepEqual(Object.keys(identity), ['publicKey']);
      const device = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/fixture',
        keys: { p256dh: identity.publicKey, auth: 'A'.repeat(22) },
      };
      const pushRequest = (path: string, body: unknown) => fetch(url + '/admin/push/' + path, {
        method: 'POST', headers: pushHeaders, body: JSON.stringify(body),
      });
      assert.equal((await pushRequest('device', { ...device, endpoint: 'https://fcm.googleapis.com.evil.test/send' })).status, 400);
      assert.equal((await pushRequest('device', device)).status, 201);
      assert.equal((await pushRequest('test', { endpoint: device.endpoint })).status, 201);
      assert.deepEqual(sent, ['test']);
      const readShift = () => fetch(url + '/admin/shift', { headers: { cookie } });
      const closeShift = (shiftId: string, counted: number) =>
        fetch(url + '/admin/shift/close', {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ shiftId, counted }),
        });
      const current = await (await readShift()).json();
      const closedResponse = await closeShift(current.id, 200);
      assert.equal(closedResponse.status, 201);
      const closedShift = await closedResponse.json();
      assert.equal(closedShift.difference, 200 - current.expected);
      const noShift = await readShift();
      assert.equal(noShift.status, 200);
      assert.equal(await noShift.json(), null);
      const nextShift = await f.open({ opening: 0 }, actor.id);
      assert.deepEqual(await (await closeShift(current.id, 200)).json(), closedShift);
      assert.equal((await closeShift(current.id, 300)).status, 409);
      assert.equal((await (await readShift()).json()).id, nextShift.id);
      assert.equal(
        await d.audit.count({ where: { action: 'CLOSE_SHIFT', entity: current.id } }),
        1,
      );
      const sharp = (await import('sharp')).default;
      const png = await sharp({
        create: { width: 48, height: 32, channels: 3, background: '#ffaa00' },
      })
        .png()
        .toBuffer();
      const form = () => {
        const body = new FormData();
        body.append('file', new Blob([png], { type: 'image/png' }), 'foto-prueba.png');
        return body;
      };
      assert.equal(
        (await fetch(url + '/admin/media', { method: 'POST', body: form() })).status,
        401,
      );
      const uploaded = await fetch(url + '/admin/media', {
        method: 'POST',
        headers: { cookie },
        body: form(),
      });
      assert.equal(uploaded.status, 201);
      const media = await uploaded.json();
      assert.equal(media.width, 48);
      const photo = await fetch(`http://127.0.0.1:${server.address().port}${media.image}`);
      assert.equal(photo.status, 200);
      assert.ok(photo.headers.get('content-type')?.includes('image/webp'));
      assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).format, 'webp');
      const library = await (await fetch(url + '/admin/media', { headers: { cookie } })).json();
      const savePhoto = await fetch(url + '/admin/products/' + p.id, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, image: media.image }),
      });
      assert.equal(savePhoto.status, 200);
      assert.equal((await d.product.findUniqueOrThrow({ where: { id: p.id } })).image, media.image);
      const oversized = new FormData();
      oversized.append(
        'file',
        new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: 'image/png' }),
        'grande.png',
      );
      assert.equal(
        (
          await fetch(url + '/admin/media', {
            method: 'POST',
            headers: { cookie },
            body: oversized,
          })
        ).status,
        413,
      );
      assert.ok(library.some((m: any) => m.image === media.image));
      assert.ok(library.some((m: any) => m.image.startsWith('/assets/')));
      const invalid = new FormData();
      invalid.append(
        'file',
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/png' }),
        'falsa.png',
      );
      assert.equal(
        (await fetch(url + '/admin/media', { method: 'POST', headers: { cookie }, body: invalid }))
          .status,
        400,
      );
      const { MediaService } = await import('../src/media');
      assert.ok((await new MediaService(d).list()).some((m) => m.image === media.image));
      const kitchenUser = await d.user.create({
        data: {
          email: 'kitchen@example.test',
          password: passwordHash('test-kitchen-password'),
          role: 'KITCHEN',
        },
      });
      const kitchenLogin = await fetch(url + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: kitchenUser.email, password: 'test-kitchen-password' }),
      });
      const kitchenCookie = kitchenLogin.headers.get('set-cookie')!.split(';')[0];
      assert.equal(
        (
          await fetch(url + '/admin/media', {
            method: 'POST',
            headers: { cookie: kitchenCookie },
            body: form(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + '/admin/users/' + kitchenUser.id, {
            method: 'PATCH',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false }),
          })
        ).status,
        200,
      );
      assert.equal(
        (await fetch(url + '/auth/me', { headers: { cookie: kitchenCookie } })).status,
        401,
      );
      assert.equal(
        (
          await fetch(url + '/admin/users/' + actor.id, {
            method: 'PATCH',
            headers: { cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false }),
          })
        ).status,
        400,
      );
      const active = await fetch(url + '/admin/orders', { headers: { cookie } });
      assert.equal(active.status, 200);
      assert.deepEqual(await active.json(), JSON.parse(JSON.stringify(await o.active(false))));
      const datedOrder = await d.order.create({
        data: {
          key: randomUUID(),
          requestHash: 'performance',
          trackingHash: randomUUID(),
          trackingSecret: randomUUID(),
          status: 'DELIVERED',
          paymentStatus: 'PAID',
          channel: 'WEB',
          fulfillment: 'PICKUP',
          customerName: 'Prueba de rendimiento',
          phone: '',
          items: [{ name: 'Producto de rendimiento', quantity: 2 }],
          subtotal: 14000,
          discount: 1500,
          total: 12500,
          estimatedMinutes: 30,
          createdAt: new Date('2024-05-01T02:30:00.000Z'),
          payments: {
            create: {
              key: randomUUID(),
              method: 'cash',
              amount: 12500,
              fee: 0,
              status: 'CONFIRMED',
              confirmedAt: new Date('2024-05-01T03:15:00.000Z'),
            },
          },
        },
      });
      const performance = async (period: string, date?: string) => {
        const query = new URLSearchParams({ period, ...(date ? { date } : {}) });
        const result = await fetch(url + '/admin/performance?' + query, { headers: { cookie } });
        assert.equal(result.status, 200);
        return result.json();
      };
      assert.equal((await fetch(url + '/admin/performance')).status, 401);
      const orderDay = await performance('day', '2024-04-30');
      const paymentDay = await performance('day', '2024-05-01');
      assert.equal(orderDay.points.length, 24);
      assert.equal(orderDay.points[23].sales, datedOrder.total);
      assert.equal(orderDay.totals.collected, 0);
      assert.deepEqual(orderDay.popular, [['Producto de rendimiento', 2]]);
      assert.equal(paymentDay.points[0].collected, datedOrder.total);
      assert.equal(paymentDay.totals.orders, 0);
      const week = await performance('week', '2024-05-01');
      assert.equal(week.from, '2024-04-29');
      assert.equal(week.points.length, 7);
      assert.equal(week.points[1].orders, 1);
      assert.equal(week.points[2].collected, datedOrder.total);
      assert.equal((await performance('month', '2024-04-30')).points.length, 30);
      assert.equal((await performance('year', '2024-05-01')).points.length, 12);
      assert.equal((await performance('history')).points[0].label, '2024');
      const paymentEnv = {
        MP_ACCESS_TOKEN: 'test-token',
        MP_WEBHOOK_SECRET: 'test-secret',
        MP_SELLER_ID: '123456',
        WEB_ORIGIN: 'https://tilin.example.test',
        WHATSAPP_ORDER_TOKEN: 'whatsapp-test-token',
        WHATSAPP_ORDER_PHONE_NUMBER_ID: '12345',
        WHATSAPP_ORDER_RECIPIENT: '5491100000000',
        WHATSAPP_ORDER_TEMPLATE: 'tilin_nuevo_pedido',
        WHATSAPP_ORDER_LANGUAGE: 'es_AR',
      };
      const originalEnv = Object.entries(paymentEnv).map(
        ([key]) => [key, process.env[key]] as const,
      );
      const originalFetch = globalThis.fetch;
      const remoteId = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
      const remote = {
        id: remoteId,
        user_id: '123456',
        currency: 'ARS',
        external_reference: '',
        total_amount: '10.00',
        total_paid_amount: '0.00',
        status: 'created',
        status_detail: 'created',
        checkout_url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=' + remoteId,
        transactions: { refunds: [] as Array<{ id: string; amount: string; status: string }> },
      };
      const onlineOrder = { ...input(), method: 'mercadopago_online' };
      let creations = 0;
      let checks = 0;
      const whatsappOrders: string[] = [];
      let whatsappRateLimited = false;
      Object.assign(process.env, paymentEnv);
      globalThis.fetch = async (resource, options) => {
        const target = String(resource);
        if (target === 'https://graph.facebook.com/v27.0/12345/messages') {
          assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer whatsapp-test-token');
          const message = JSON.parse(String(options?.body));
          assert.equal(message.to, '5491100000000');
          assert.equal(message.template.name, 'tilin_nuevo_pedido');
          assert.deepEqual(Object.keys(message).sort(), ['messaging_product', 'template', 'to', 'type']);
          whatsappOrders.push(message.template.components[0].parameters[0].text);
          if (whatsappRateLimited) return new Response(null, { status: 429 });
          return Response.json({ messages: [{ id: 'wamid.test' }] });
        }
        if (!target.startsWith('https://api.mercadopago.com/'))
          return originalFetch(resource, options);
        assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-token');
        if (options?.method === 'POST') {
          creations++;
          const body = JSON.parse(String(options.body));
          assert.equal(target, 'https://api.mercadopago.com/v1/orders');
          assert.equal(new Headers(options.headers).get('X-Idempotency-Key'), onlineOrder.key);
          assert.equal(body.total_amount, '10.00');
          assert.equal(body.config.online.auto_return, 'all');
          assert.match(
            body.config.online.success_url,
            /^https:\/\/tilin\.example\.test\/seguimiento\/[^?]+\?mp=retorno$/,
          );
          assert.equal(body.config.online.failure_url, body.config.online.success_url);
          assert.equal(body.config.online.pending_url, body.config.online.success_url);
          if (creations === 1) return new Response(null, { status: 503 });
          remote.external_reference = body.external_reference;
        } else {
          checks++;
          assert.equal(target, 'https://api.mercadopago.com/v1/orders/' + remoteId);
        }
        return Response.json(remote);
      };
      try {
        const place = () =>
          fetch(url + '/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(onlineOrder),
          });
        const catalog = await (await fetch(url + '/catalog')).json();
        assert.deepEqual(
          catalog.settings.methods.filter(
            (method: { name: string }) => method.name === 'Mercado Pago',
          ),
          [{ id: 'mercadopago_online', name: 'Mercado Pago' }],
        );
        const create = await place();
        assert.equal(create.status, 201);
        const pending = await create.json();
        assert.equal(pending.checkoutUrl, null);
        assert.equal((await o.tracking(pending.tracking)).paymentStatus, 'PENDING');
        assert.deepEqual(whatsappOrders, []);
        assert.equal(await d.pushDelivery.count({ where: { orderId: pending.id } }), 0);
        const retry = await fetch(url + `/tracking/${pending.tracking}/mercado-pago`, {
          method: 'POST',
        });
        assert.equal((await retry.json()).checkoutUrl, remote.checkout_url);
        assert.equal((await (await place()).json()).id, pending.id);
        assert.equal(creations, 2);
        assert.equal(
          (await o.active()).some((item) => item.id === pending.id),
          false,
        );
        assert.equal(
          (await f.sales({})).orders.some((item) => item.id === pending.id),
          false,
        );
        await assert.rejects(o.change(pending.id, 'ACCEPTED', actor.id));
        const initial = await d.payment.findFirstOrThrow({ where: { orderId: pending.id } });
        await assert.rejects(f.verify(initial.id, actor.id));
        const ts = String(Date.now());
        const requestId = 'signed-request';
        const signature = createHmac('sha256', paymentEnv.MP_WEBHOOK_SECRET)
          .update(`id:${remoteId};request-id:${requestId};ts:${ts};`)
          .digest('hex');
        const webhook = (digest = signature) =>
          fetch(url + '/webhooks/mercado-pago?data.id=' + remoteId, {
            method: 'POST',
            headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${digest}` },
          });
        assert.equal((await webhook('0'.repeat(64))).status, 401);
        remote.status = 'processed';
        remote.status_detail = 'accredited';
        remote.total_paid_amount = '9.00';
        assert.equal((await webhook()).status, 502);
        assert.equal((await o.tracking(pending.tracking)).paymentStatus, 'PENDING');
        remote.total_paid_amount = '10.00';
        const verify = () =>
          fetch(url + `/tracking/${pending.tracking}/mercado-pago/verificar`, {
            method: 'POST',
          });
        const returned = await verify();
        assert.equal(returned.status, 201);
        assert.equal((await returned.json()).paymentStatus, 'PAID');
        assert.equal((await (await verify()).json()).paymentStatus, 'PAID');
        assert.equal(checks, 2);
        assert.equal((await webhook()).status, 201);
        assert.equal((await webhook()).status, 201);
        assert.equal((await o.tracking(pending.tracking)).paymentStatus, 'PAID');
        assert.deepEqual(whatsappOrders, [String(pending.number)]);
        assert.equal((await d.whatsAppDelivery.findUniqueOrThrow({ where: { orderId: pending.id } })).status, 'ACCEPTED');
        assert.equal(sent.filter((tag) => tag === 'pedido-' + pending.number).length, 1);
        assert.equal(await d.pushDelivery.count({ where: { orderId: pending.id, sentAt: { not: null } } }), 1);
        assert.ok((await o.active()).some((item) => item.id === pending.id));
        const mpSales = await f.sales({ method: 'mercadopago_online' });
        assert.deepEqual(
          mpSales.orders.map((order) => order.id),
          [pending.id],
        );
        assert.equal(mpSales.totals.collected, 1000);
        assert.equal(
          await d.payment.count({ where: { orderId: pending.id, status: 'CONFIRMED' } }),
          1,
        );
        assert.equal(
          await d.audit.count({ where: { entity: pending.id, action: 'MP_PAYMENT' } }),
          1,
        );
        remote.status = 'refunded';
        remote.status_detail = 'refunded';
        remote.transactions.refunds.push({ id: 'REF1234', amount: '10.00', status: 'processed' });
        assert.equal((await webhook()).status, 201);
        assert.equal((await webhook()).status, 201);
        const refunded = await o.tracking(pending.tracking);
        assert.equal(refunded.paymentStatus, 'REFUNDED');
        assert.equal(refunded.status, 'CANCELLED');
        assert.equal(await d.payment.count({ where: { orderId: pending.id, amount: -1000 } }), 1);
        assert.equal(
          await d.reservation.count({ where: { orderId: pending.id, released: false } }),
          0,
        );
        const cash = input();
        whatsappRateLimited = true;
        const cashResponse = await fetch(url + '/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cash),
        });
        assert.equal(cashResponse.status, 201);
        const order = await cashResponse.json();
        const where = { orderId: order.id };
        assert.equal((await d.whatsAppDelivery.findUniqueOrThrow({ where })).status, 'PENDING');
        await d.whatsAppDelivery.update({ where, data: { nextAttemptAt: new Date() } });
        whatsappRateLimited = false;
        await Promise.all([orderPush.deliver(order.id), orderPush.deliver(order.id)]);
        assert.equal((await d.whatsAppDelivery.findUniqueOrThrow({ where })).status, 'ACCEPTED');
        assert.deepEqual(whatsappOrders, [String(pending.number), String(order.number), String(order.number)]);
      } finally {
        globalThis.fetch = originalFetch;
        for (const [key, value] of originalEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      const controller = new AbortController();
      const event = await fetch(url + '/admin/events', {
        headers: { cookie },
        signal: controller.signal,
      });
      assert.equal(event.status, 200);
      assert.ok(event.headers.get('content-type')?.includes('text/event-stream'));
      const reader = event.body!.getReader();
      const deadline = setTimeout(() => controller.abort(), 3000);
      app.get(Orders).notify();
      let streamText = '';
      while (!streamText.includes('"refresh":true')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        streamText += new TextDecoder().decode(chunk.value);
      }
      clearTimeout(deadline);
      assert.ok(streamText.includes('"refresh":true'));
      controller.abort();
      const archive = (resource: string, archived: boolean, session?: string) =>
        fetch(url + `/admin/${resource}/archive`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(session ? { cookie: session } : {}) },
          body: JSON.stringify({ archived }),
        });
      const sales = await f.sales({});
      assert.equal((await archive(`sales/${sale.id}`, true)).status, 401);
      assert.equal((await archive(`sales/${sale.id}`, true, cookie)).status, 200);
      const visibleSales = await f.sales({});
      assert.deepEqual(visibleSales.totals, sales.totals);
      assert.ok(!visibleSales.orders.some((order) => order.id === sale.id));
      assert.ok((await f.sales({ archived: 'true' })).orders.some((order) => order.id === sale.id));
      assert.equal((await o.tracking(sale.tracking)).status, 'DELIVERED');
      assert.equal((await archive(`sales/${sale.id}`, false, cookie)).status, 200);
      assert.ok((await f.sales({})).orders.some((order) => order.id === sale.id));

      assert.equal((await archive(`products/${p.id}`, true, cookie)).status, 400);
      assert.equal((await archive(`ingredients/${comboIngredient.id}`, true, cookie)).status, 400);
      assert.equal((await archive(`products/${combo.id}`, true, cookie)).status, 200);
      assert.ok(!(await c.list({ publicView: true })).some((product) => product.id === combo.id));
      assert.ok((await c.list({ publicView: false, archived: true })).some((product) => product.id === combo.id));
      const ingredientTarget = await d.ingredient.create({
        data: { name: 'Insumo para archivar', unit: 'unit', stock: 7 },
      });
      assert.equal((await archive(`ingredients/${ingredientTarget.id}`, true, cookie)).status, 200);
      const inventory = await (
        await fetch(url + '/admin/inventory', { headers: { cookie } })
      ).json();
      assert.ok(
        !inventory.ingredients.some((item: { id: string }) => item.id === ingredientTarget.id),
      );
      assert.equal(
        (await archive(`ingredients/${ingredientTarget.id}`, false, cookie)).status,
        200,
      );
      assert.equal(
        (await d.ingredient.findUniqueOrThrow({ where: { id: ingredientTarget.id } })).stock,
        7,
      );
      assert.equal((await archive(`products/${combo.id}`, false, cookie)).status, 200);
      assert.ok((await c.list({ publicView: true })).some((product) => product.id === combo.id));
      const cashOrder = input();
      const placeCash = () => fetch(url + '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashOrder),
      });
      failPush = true;
      const cashResponse = await placeCash();
      assert.equal(cashResponse.status, 201);
      const newCashOrder = await cashResponse.json();
      assert.equal((await (await placeCash()).json()).id, newCashOrder.id);
      const deliveryKey = { orderId_endpoint: { orderId: newCashOrder.id, endpoint: device.endpoint } };
      assert.equal((await d.pushDelivery.findUniqueOrThrow({ where: deliveryKey })).sentAt, null);
      await d.pushDelivery.update({ where: deliveryKey, data: { nextAttemptAt: new Date() } });
      failPush = false;
      await Promise.all([orderPush.deliver(newCashOrder.id), orderPush.deliver(newCashOrder.id)]);
      assert.equal(sent.filter((tag) => tag === 'pedido-' + newCashOrder.number).length, 1);

      const quickSaleUrl = url + '/admin/orders/quick-apps-sale';
      const saleRequest = {
        key: randomUUID(),
        method: 'cash',
        items: [{ productId: p.id, quantity: 1 }],
        expectedTotal: 1200,
      };
      const quickSale = (body: unknown, authenticated = true) =>
        fetch(quickSaleUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authenticated ? { cookie } : {}) },
          body: JSON.stringify(body),
        });
      assert.equal((await quickSale(saleRequest, false)).status, 401);
      assert.equal((await quickSale({ ...saleRequest, method: 'platform' })).status, 400);
      const quickResponse = await quickSale(saleRequest);
      assert.equal(quickResponse.status, 201, await quickResponse.clone().text());
      const quickResult = await quickResponse.json();
      assert.equal((await (await quickSale(saleRequest)).json()).id, quickResult.id);
      const quickOrder = await d.order.findUniqueOrThrow({
        where: { id: quickResult.id },
        include: { payments: true },
      });
      assert.equal(quickOrder.channel, 'APPS');
      assert.equal(quickOrder.fulfillment, 'PLATFORM');
      assert.equal(quickOrder.customerName, '');
      assert.equal(quickOrder.customerId, null);
      assert.equal(quickOrder.shipping, 0);
      assert.equal(quickOrder.payments[0].method, 'cash');
      assert.equal(quickOrder.payments[0].status, 'PENDING');
      const stockBefore = await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
      for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED']) {
        await o.change(quickOrder.id, status, actor.id);
      }
      const deleteSale = (id: string, session?: string) =>
        fetch(url + `/admin/sales/${id}`, {
          method: 'DELETE',
          headers: session ? { cookie: session } : {},
        });
      assert.equal((await deleteSale(quickOrder.id)).status, 401);
      assert.equal((await deleteSale(quickOrder.id, cookie)).status, 400);
      assert.equal((await archive(`sales/${quickOrder.id}`, true, cookie)).status, 200);
      assert.equal((await archive(`sales/${sale.id}`, true, cookie)).status, 200);
      assert.equal((await deleteSale(sale.id, cookie)).status, 400);
      const totalsBefore = (await f.sales({})).totals;
      assert.equal((await deleteSale(quickOrder.id, cookie)).status, 200);
      assert.equal((await deleteSale(quickOrder.id, cookie)).status, 200);
      assert.equal((await quickSale(saleRequest)).status, 409);
      const totalsAfter = (await f.sales({})).totals;
      assert.equal(totalsAfter.orders, totalsBefore.orders - 1);
      assert.equal(totalsAfter.gross, totalsBefore.gross - quickOrder.total);
      assert.equal(totalsAfter.collected, totalsBefore.collected);
      assert.equal(await d.order.findUnique({ where: { id: quickOrder.id } }), null);
      assert.equal(await d.stockMovement.count({ where: { orderId: quickOrder.id } }), 0);
      assert.equal(await d.audit.count({ where: { entity: quickOrder.id, action: 'SALE_DELETED' } }), 1);
      const stockAfter = await d.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
      assert.equal(stockAfter.stock, stockBefore.stock);
      assert.equal(stockAfter.reserved, stockBefore.reserved - 1);

      const transferResponse = await quickSale({
        ...saleRequest,
        key: randomUUID(),
        name: ' Facundo ',
        method: 'transfer',
      });
      assert.equal(transferResponse.status, 201, await transferResponse.clone().text());
      const transferOrder = await d.order.findUniqueOrThrow({
        where: { id: (await transferResponse.json()).id },
        include: { payments: true },
      });
      assert.equal(transferOrder.customerName, 'Facundo');
      assert.equal(transferOrder.payments[0].method, 'transfer');
      assert.equal(transferOrder.payments[0].status, 'PENDING');

      const savedCustomer = await d.customer.create({
        data: { name: 'Cliente Frecuente', phone: '5491198765432' },
      });
      for (const [minutes, status, fulfillment, address] of [
        [1, 'DELIVERED', 'DELIVERY', 'Calle de prueba 123'],
        [2, 'CANCELLED', 'DELIVERY', 'Dirección cancelada 456'],
        [3, 'DELIVERED', 'PICKUP', 'Dirección de retiro 789'],
      ] as const) {
        await d.order.create({
          data: {
            key: randomUUID(),
            requestHash: 'customer-lookup',
            trackingHash: randomUUID(),
            trackingSecret: randomUUID(),
            status,
            channel: 'WEB',
            fulfillment,
            customerId: savedCustomer.id,
            customerName: savedCustomer.name,
            phone: savedCustomer.phone,
            address,
            zone: 'zona-prueba',
            items: [],
            subtotal: 1200,
            total: 1200,
            estimatedMinutes: 30,
            createdAt: new Date(Date.UTC(2024, 0, 1, 0, minutes)),
          },
        });
      }
      const lookup = url + '/admin/customers/lookup?';
      assert.equal((await fetch(lookup + 'q=Frecuente')).status, 401);
      for (const term of ['frecuente', '+54 9 11 9876-5432']) {
        const response = await fetch(lookup + new URLSearchParams({ q: term }), {
          headers: { cookie },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), [
          { ...savedCustomer, delivery: { address: 'Calle de prueba 123', zone: 'zona-prueba' } },
        ]);
      }

      const changePassword = await fetch(url + '/auth/password', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: 'test-only-password', password: 'test-only-password-new' }),
      });
      assert.equal(changePassword.status, 201);
      assert.equal((await fetch(url + '/auth/me', { headers: { cookie } })).status, 401);
      assert.equal(await d.pushDevice.count({ where: { userId: actor.id } }), 0);
    } finally {
      await app.close();
    }
  },
);
