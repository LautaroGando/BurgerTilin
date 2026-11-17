import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Db } from './db';
import { Catalog } from './catalog';
import { Orders, audit } from './orders';
import { atomic } from './transactions';
import { cents, phoneKey, productInput, productConfig, salesChannels, settingsInput } from './domain';
import { passwordHash } from './auth';
import { reservedPaymentMethod } from './mercado-pago-client';
@Injectable()
export class Operations {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Catalog) readonly catalog: Catalog,
    @Inject(Orders) readonly orders: Orders,
  ) {}
  async settings(raw: unknown, actor: string) {
    const data = settingsInput.parse(raw);
    for (const list of [data.channels, data.methods, data.zones])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        throw new BadRequestException('Hay identificadores duplicados');
    const fees = new Map(data.channels.map((c) => [c.id, c.feeBps]));
    if (fees.size !== salesChannels.length || salesChannels.some((c) => !fees.has(c.id)))
      throw new BadRequestException('Los canales de venta son Web, WhatsApp y Apps');
    data.channels = salesChannels.map((c) => ({ ...c, feeBps: fees.get(c.id)! }));
    return atomic(this.db, async (tx) => {
      const current = await this.catalog.settings(tx);
      if (
        data.methods.some(
          (method) =>
            reservedPaymentMethod(method) &&
            !current.methods.some((saved) => saved.id === method.id && saved.name === method.name),
        )
      )
        throw new BadRequestException(
          'Mercado Pago se habilita con la integración de cobro. Elegí otro nombre para los medios manuales.',
        );
      await tx.settings.upsert({ where: { id: 1 }, create: { id: 1, data }, update: { data } });
      await audit(tx, actor, 'SETTINGS', '1', data);
      this.orders.notify();
      return data;
    });
  }
  async quick(raw: unknown, actor: string) {
    const input = z
      .object({
        paused: z.boolean().optional(),
        delay: z.number().int().min(5).max(240).optional(),
      })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      const data = { ...(await this.catalog.settings(tx)), ...input };
      await tx.settings.upsert({ where: { id: 1 }, create: { id: 1, data }, update: { data } });
      await audit(tx, actor, 'QUICK_SETTINGS', '1', input);
      this.orders.notify();
      return data;
    });
  }
  async product(id: string | undefined, raw: unknown, actor: string) {
    const data = productInput.parse(raw);
    if (
      data.image.startsWith('/api/media/') &&
      !(await this.db.media.findUnique({
        where: { id: data.image.split('/').pop()!.slice(0, -5) },
      }))
    )
      throw new BadRequestException('La imagen no está en la biblioteca');
    if (data.published && (data.price === null || !data.description.trim()))
      throw new BadRequestException('Completá precio y descripción antes de publicar');
    if (
      data.published &&
      ['Combos', 'Promociones'].includes(data.category) &&
      !data.config.slots.length
    )
      throw new BadRequestException(
        'Completá los componentes del combo o promoción antes de publicar',
      );
    for (const list of [data.config.variants, data.config.extras, data.config.slots])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        throw new BadRequestException('Hay identificadores de opciones duplicados');
    return atomic(this.db, async (tx) => {
      await this.checkProductDependencies(tx, data.config, id);
      const p = id
        ? await tx.product.update({ where: { id, archivedAt: null }, data })
        : await tx.product.create({ data });
      await audit(tx, actor, 'PRODUCT', p.id, data);
      return p;
    });
  }
  private async checkProductDependencies(
    tx: Prisma.TransactionClient,
    config: z.infer<typeof productConfig>,
    id?: string,
  ) {
    const components = [...new Set(config.slots.flatMap((s) => s.choices.map((c) => c.productId)))];
    if (components.length) {
      const products = await tx.product.findMany({
        where: { id: { in: components }, archivedAt: null },
      });
      if (
        products.length !== components.length ||
        products.some((p) => p.id === id || productConfig.parse(p.config).slots.length)
      )
        throw new BadRequestException('Los combos deben usar productos simples activos');
    }
    const ingredients = [...new Set(ingredientIds(config))];
    if (ingredients.length) {
      const count = await tx.ingredient.count({
        where: { id: { in: ingredients }, archivedAt: null },
      });
      if (count !== ingredients.length)
        throw new BadRequestException('Revisá los insumos activos de las recetas');
    }
  }
  async archiveProduct(id: string, archived: boolean, actor: string) {
    return atomic(this.db, async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id } });
      if (Boolean(product.archivedAt) === archived) return { ok: true };
      if (archived) {
        const products = await tx.product.findMany({
          where: { archivedAt: null, id: { not: id } },
        });
        const combo = products.find((p) =>
          productConfig
            .parse(p.config)
            .slots.some((s) => s.choices.some((c) => c.productId === id)),
        );
        if (combo)
          throw new BadRequestException(
            `Quitá el producto de «${combo.name}» antes de archivarlo.`,
          );
      } else {
        await this.checkProductDependencies(tx, productConfig.parse(product.config), id);
      }
      await tx.product.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await audit(tx, actor, archived ? 'PRODUCT_ARCHIVED' : 'PRODUCT_RESTORED', id, {
        name: product.name,
      });
      return { ok: true };
    });
  }
  async soldOut(id: string, raw: unknown, actor: string) {
    const data = z.object({ soldOut: z.boolean() }).parse(raw);
    return atomic(this.db, async (tx) => {
      const p = await tx.product.update({ where: { id, archivedAt: null }, data });
      await audit(tx, actor, 'SOLD_OUT', id, data);
      return p;
    });
  }
  async prices(raw: unknown, actor: string) {
    const input = z
      .object({
        percent: z.number().min(-99).max(1000),
        ids: z.array(z.string()).min(1).max(500),
        confirm: z.boolean(),
        version: z.string().optional(),
      })
      .parse(raw);
    const products = await this.db.product.findMany({
      where: { id: { in: input.ids }, archivedAt: null },
    });
    const preview = products.map((p) => ({
      id: p.id,
      name: p.name,
      before: p.price,
      after: p.price === null ? null : Math.round(p.price * (1 + input.percent / 100)),
      version: p.updatedAt.toISOString(),
    }));
    const version = JSON.stringify(preview);
    if (!input.confirm) return { preview, version };
    if (input.version !== version)
      throw new BadRequestException('Los precios cambiaron; revisá otra vista previa');
    return atomic(this.db, async (tx) => {
      for (const p of preview) {
        const result = await tx.product.updateMany({
          where: { id: p.id, updatedAt: new Date(p.version), archivedAt: null },
          data: { price: p.after },
        });
        if (result.count !== 1)
          throw new BadRequestException('Los precios cambiaron; repetí la vista previa');
      }
      await audit(tx, actor, 'BULK_PRICES', 'products', preview);
      return { updated: preview.length };
    });
  }
  async ingredient(raw: unknown, actor: string, id?: string) {
    const input = z
      .object({
        name: z.string().min(1).max(100),
        unit: z.enum(['g', 'ml', 'unit']),
        minimum: z.number().int().min(0),
        strict: z.boolean(),
        cost: z.number().min(0).nullable(),
      })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      if (id) {
        const current = await tx.ingredient.findUniqueOrThrow({ where: { id, archivedAt: null } });
        if (current.unit !== input.unit)
          throw new BadRequestException('La unidad base no puede cambiar; creá otro insumo');
        if (input.strict && current.stock < current.reserved)
          throw new BadRequestException(
            'Recibí stock suficiente antes de activar el control estricto',
          );
      }
      const i = id
        ? await tx.ingredient.update({ where: { id }, data: input })
        : await tx.ingredient.create({ data: input });
      await audit(tx, actor, 'INGREDIENT', i.id, input);
      return i;
    });
  }
  async archiveIngredient(id: string, archived: boolean, actor: string) {
    return atomic(this.db, async (tx) => {
      const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id } });
      if (Boolean(ingredient.archivedAt) === archived) return { ok: true };
      if (archived) {
        if (ingredient.reserved > 0)
          throw new BadRequestException(
            'El insumo tiene reservas de pedidos. Resolvelas antes de archivarlo.',
          );
        const products = await tx.product.findMany({ where: { archivedAt: null } });
        const product = products.find((p) =>
          ingredientIds(productConfig.parse(p.config)).includes(id),
        );
        if (product)
          throw new BadRequestException(
            `Quitá el insumo de la receta, variantes o extras de «${product.name}» antes de archivarlo.`,
          );
      }
      await tx.ingredient.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await audit(tx, actor, archived ? 'INGREDIENT_ARCHIVED' : 'INGREDIENT_RESTORED', id, {
        name: ingredient.name,
      });
      return { ok: true };
    });
  }
  async stock(id: string, raw: unknown, actor: string) {
    const input = z
      .object({
        key: z.string().uuid(),
        quantity: z.number().positive(),
        unit: z.enum(['g', 'kg', 'ml', 'l', 'unit']),
        kind: z.enum(['PURCHASE', 'ADJUSTMENT', 'WASTE', 'RETURN']),
        direction: z.enum(['ADD', 'REMOVE']).default('ADD'),
        reason: z.string().min(3).max(300),
      })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      if (await tx.audit.findFirst({ where: { action: 'STOCK', entity: input.key } }))
        return { ok: true };
      const i = await tx.ingredient.findUniqueOrThrow({ where: { id, archivedAt: null } });
      const base = input.unit === 'kg' ? 'g' : input.unit === 'l' ? 'ml' : input.unit;
      if (base !== i.unit) throw new BadRequestException('Unidades incompatibles');
      const quantity = input.quantity * (['kg', 'l'].includes(input.unit) ? 1000 : 1);
      if (!Number.isSafeInteger(quantity))
        throw new BadRequestException('La unidad mínima es 1 g, 1 ml o 1 unidad');
      const signed = quantity * (input.kind === 'WASTE' || input.direction === 'REMOVE' ? -1 : 1);
      if (i.strict && i.stock + signed < i.reserved)
        throw new BadRequestException('Ese ajuste dejaría las reservas sin stock');
      await tx.ingredient.update({ where: { id }, data: { stock: { increment: signed } } });
      await tx.stockMovement.create({
        data: { ingredientId: id, quantity: signed, kind: input.kind, reason: input.reason },
      });
      await audit(tx, actor, 'STOCK', input.key, { ingredientId: id, ...input });
      return { ok: true };
    });
  }
  async inventory(archived = false) {
    const ingredients = await this.db.ingredient.findMany({
      where: { archivedAt: archived ? { not: null } : null },
      orderBy: { name: 'asc' },
    });
    if (archived) return { ingredients };
    const movements = await this.db.stockMovement.findMany({
      include: { ingredient: { select: { name: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
    return {
      ingredients,
      movements,
      replenishment: ingredients
        .filter((i) => i.stock - i.reserved < i.minimum)
        .map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          suggested: i.minimum - (i.stock - i.reserved),
        })),
    };
  }
  async user(raw: unknown, actor: string) {
    const input = z
      .object({
        email: z.email(),
        password: z.string().min(12).max(200),
        role: z.enum(['OWNER', 'CASHIER', 'KITCHEN']),
      })
      .parse(raw);
    return atomic(this.db, async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.email.toLowerCase() } }))
        throw new BadRequestException('Ya existe un usuario con ese correo');
      const u = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          password: passwordHash(input.password),
          role: input.role,
        },
      });
      await audit(tx, actor, 'CREATE_USER', u.id, { email: u.email, role: u.role });
      return { id: u.id, email: u.email, role: u.role };
    });
  }
  async findCustomers(raw: unknown) {
    const query = z.string().trim().min(2).max(100).parse(raw);
    const phone = phoneKey(query);
    const name = query.replace(/[\\%_]/g, '\\$&');
    const customers = await this.db.customer.findMany({
      where: {
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          ...(phone.length >= 2 ? [{ phone: { contains: phone } }] : []),
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 8,
      select: {
        id: true,
        name: true,
        phone: true,
        orders: {
          where: {
            fulfillment: 'DELIVERY',
            address: { not: '' },
            status: { notIn: ['CANCELLED', 'REJECTED'] },
            OR: [{ onlineCheckout: null }, { paymentStatus: { not: 'PENDING' } }],
          },
          orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
          take: 1,
          select: { address: true, zone: true },
        },
      },
    });
    return customers.map(({ orders, ...customer }) => ({
      ...customer,
      delivery: orders[0] ?? null,
    }));
  }
  async customerHistory(id: string) {
    const c = await this.db.customer.findUniqueOrThrow({
      where: { id },
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    return { ...c, orders: c.orders.map((o) => this.orders.redact(o)) };
  }
  async access(id: string, raw: unknown, actor: string) {
    const input = z
      .object({
        role: z.enum(['OWNER', 'CASHIER', 'KITCHEN']).optional(),
        active: z.boolean().optional(),
        password: z.string().min(12).max(200).optional(),
      })
      .parse(raw);
    if (id === actor)
      throw new BadRequestException(
        'Usá el cambio de contraseña propio. Otro dueño debe modificar tus permisos.',
      );
    return atomic(this.db, async (tx) => {
      const target = await tx.user.findUniqueOrThrow({ where: { id } });
      if (
        target.role === 'OWNER' &&
        target.active &&
        ((input.role && input.role !== 'OWNER') || input.active === false) &&
        (await tx.user.count({ where: { role: 'OWNER', active: true } })) <= 1
      )
        throw new BadRequestException('Debe quedar al menos un dueño activo');
      const { password, ...data } = input;
      const u = await tx.user.update({
        where: { id },
        data: { ...data, ...(password ? { password: passwordHash(password) } : {}) },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.pushDevice.deleteMany({ where: { userId: id } });
      await audit(tx, actor, 'UPDATE_ACCESS', id, {
        role: u.role,
        active: u.active,
        passwordChanged: !!password,
      });
      return { id: u.id, email: u.email, role: u.role, active: u.active };
    });
  }
}

function ingredientIds(config: z.infer<typeof productConfig>) {
  return [
    ...config.recipe,
    ...config.variants.flatMap((variant) => variant.recipe),
    ...config.extras.flatMap((extra) => extra.recipe),
  ].map((item) => item.ingredientId);
}
