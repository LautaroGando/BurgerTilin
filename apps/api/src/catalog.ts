import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { Db } from './db';
import { defaults, productConfig, choiceInput, lineInput, Settings, TZ } from './domain';
type Tx = Prisma.TransactionClient;
export type Consumption = Map<string, number>;
@Injectable()
export class Catalog {
  constructor(@Inject(Db) readonly db: Db) {}
  async settings(tx: Tx | Db = this.db): Promise<Settings> {
    return ((await tx.settings.findUnique({ where: { id: 1 } }))?.data as Settings) || defaults;
  }
  async compile(
    tx: Tx | Db,
    lines: z.infer<typeof lineInput>[],
    channel: string,
    publicOrder: boolean,
  ) {
    const products = await tx.product.findMany({ where: { archivedAt: null } });
    const map = new Map(products.map((p) => [p.id, p]));
    const consumption: Consumption = new Map();
    const removedIngredients = new Set<string>();
    let subtotal = 0,
      missingRecipe = false;
    const add = (id: string, q: number) => consumption.set(id, (consumption.get(id) || 0) + q);
    function selectExtras(config: z.infer<typeof productConfig>, ids: string[], quantity: number) {
      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      const names: string[] = [];
      let price = 0;
      for (const [id, count] of counts) {
        const extra = config.extras.find((option) => option.id === id);
        if (!extra) throw new BadRequestException('Extra inválido');
        for (const ingredient of extra.recipe)
          add(ingredient.ingredientId, ingredient.quantity * count * quantity);
        names.push(count === 1 ? extra.name : `${count} × ${extra.name}`);
        price += extra.price * count;
      }
      return { names, price };
    }
    function consumeRecipe(
      recipe: z.infer<typeof productConfig>['recipe'],
      remove: string[],
      quantity: number,
    ) {
      const omitted = new Set(remove);
      if (omitted.size !== remove.length) throw new BadRequestException('Modificación duplicada');
      for (const id of omitted) {
        if (!recipe.some((ingredient) => ingredient.ingredientId === id && ingredient.removable))
          throw new BadRequestException('No se puede quitar ese ingrediente');
        removedIngredients.add(id);
      }
      for (const ingredient of recipe)
        if (!omitted.has(ingredient.ingredientId))
          add(ingredient.ingredientId, ingredient.quantity * quantity);
    }
    function available(p: Product) {
      if (!p.published || p.soldOut || p.price === null)
        throw new BadRequestException(`${p.name}: no disponible`);
      const config = productConfig.parse(p.config);
      const promo = config.promotion;
      if (promo) {
        const now = DateTime.now().setZone(TZ);
        const date = now.toISODate()!,
          time = now.toFormat('HH:mm');
        const inHours =
          promo.start <= promo.end
            ? time >= promo.start && time < promo.end
            : time >= promo.start || time < promo.end;
        if (
          date < promo.from ||
          date > promo.to ||
          !inHours ||
          (promo.channels.length && !promo.channels.includes(channel))
        )
          throw new BadRequestException(`${p.name}: promoción fuera de vigencia`);
      }
      return config;
    }
    function single(choice: z.infer<typeof choiceInput>, factor: number) {
      const p = map.get(choice.productId);
      if (!p) throw new BadRequestException('Producto inexistente');
      const c = available(p);
      if (c.slots.length) throw new BadRequestException('Un componente no puede ser otro combo');
      const variant = choice.variantId
        ? c.variants.find((v) => v.id === choice.variantId)
        : undefined;
      if (choice.variantId && !variant) throw new BadRequestException('Variante inválida');
      const recipe = variant?.recipe || c.recipe;
      if (!recipe.length) missingRecipe = true;
      consumeRecipe(recipe, choice.remove, factor);
      const extras = selectExtras(c, choice.extras, factor);
      const base = c.channelPrices[channel] ?? p.price!;
      return {
        productId: p.id,
        name: p.name,
        variant: variant?.name || '',
        variantId: variant?.id || '',
        extraIds: choice.extras,
        removeIds: choice.remove,
        extras: extras.names,
        remove: choice.remove,
        unitPrice: base + (variant?.delta || 0) + extras.price,
      };
    }
    const items = lines.map((line) => {
      const p = map.get(line.productId);
      if (!p) throw new BadRequestException('Producto inexistente');
      const c = available(p);
      let unitPrice: number;
      let detail: any;
      let components: any[] = [];
      if (c.slots.length) {
        if (line.variantId)
          throw new BadRequestException('Elegí las variantes dentro de cada componente del combo');
        if (
          line.components.length !== c.slots.length ||
          new Set(line.components.map((s) => s.slotId)).size !== c.slots.length
        )
          throw new BadRequestException('Completá los componentes del combo');
        const extras = selectExtras(c, line.extras, line.quantity);
        unitPrice = (c.channelPrices[channel] ?? p.price!) + extras.price;
        for (const slot of c.slots) {
          const selected = line.components.find((s) => s.slotId === slot.id);
          if (!selected || selected.choices.length !== slot.quantity)
            throw new BadRequestException(`Completá ${slot.name}`);
          for (const choice of selected.choices) {
            const allowed = slot.choices.find((x) => x.productId === choice.productId);
            if (!allowed) throw new BadRequestException('Cambio no permitido');
            const item = single(choice, line.quantity);
            const cp = map.get(choice.productId)!;
            const cc = productConfig.parse(cp.config);
            const extraPrice = item.unitPrice - (cc.channelPrices[channel] ?? cp.price!);
            unitPrice += allowed.delta + extraPrice;
            components.push({ ...item, slot: slot.name, slotId: slot.id });
          }
        }
        consumeRecipe(c.recipe, line.remove, line.quantity);
        detail = {
          productId: p.id,
          name: p.name,
          variant: '',
          extraIds: line.extras,
          removeIds: line.remove,
          extras: extras.names,
          remove: line.remove,
        };
      } else {
        if (line.components.length) throw new BadRequestException('Componentes inválidos');
        detail = single(line, line.quantity);
        unitPrice = detail.unitPrice;
      }
      if (unitPrice < 0 || !Number.isSafeInteger(unitPrice))
        throw new BadRequestException('La configuración produce un precio inválido');
      subtotal += unitPrice * line.quantity;
      return { ...detail, components, unitPrice, quantity: line.quantity, note: line.note };
    });
    const ingredientIds = new Set([...consumption.keys(), ...removedIngredients]);
    const ingredients = await tx.ingredient.findMany({
      where: { id: { in: [...ingredientIds] }, archivedAt: null },
    });
    if (ingredients.length !== ingredientIds.size)
      throw new BadRequestException('La receta tiene insumos inexistentes');
    let cost = 0,
      complete = true;
    const names = new Map(ingredients.map((i) => [i.id, i.name]));
    for (const item of items) {
      item.remove = item.remove.map((id: string) => names.get(id) || id);
      for (const sub of item.components)
        sub.remove = sub.remove.map((id: string) => names.get(id) || id);
    }
    for (const ingredient of ingredients) {
      const needed = consumption.get(ingredient.id);
      if (needed === undefined) continue;
      if (ingredient.strict && ingredient.stock - ingredient.reserved < needed)
        throw new BadRequestException(`Sin stock suficiente: ${ingredient.name}`);
      if (ingredient.cost === null) complete = false;
      else cost += Number(ingredient.cost) * needed;
    }
    // A missing recipe is explicitly an unknown cost, never a zero-cost burger.
    if (!consumption.size || missingRecipe) complete = false;
    return { items, subtotal, consumption, ingredientCost: complete ? Math.round(cost) : null };
  }
  async list(publicView: boolean, archived = false) {
    const products = await this.db.product.findMany({
      where: {
        archivedAt: archived ? { not: null } : null,
        ...(publicView ? { published: true } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    const ingredients = await this.db.ingredient.findMany({ where: { archivedAt: null } });
    const stock = new Map(ingredients.map((i) => [i.id, i]));
    const byId = new Map(products.map((p) => [p.id, p]));
    const available = (p: Product, seen = new Set<string>()): boolean => {
      if (seen.has(p.id) || p.soldOut || !p.published || p.price === null) return false;
      const next = new Set(seen).add(p.id);
      const c = productConfig.parse(p.config);
      const check = (r: z.infer<typeof productConfig>['recipe']) =>
        r.every((x) => {
          const i = stock.get(x.ingredientId);
          return i && (!i.strict || i.stock - i.reserved >= x.quantity);
        });
      return (
        (c.variants.length ? c.variants.some((v) => check(v.recipe)) : check(c.recipe)) &&
        c.slots.every((s) =>
          s.choices.some((ch) => {
            const component = byId.get(ch.productId);
            return !!component && available(component, next);
          }),
        )
      );
    };
    return products.map((p) => {
      const c = productConfig.parse(p.config);
      return {
        ...p,
        available: available(p),
        config: publicView
          ? {
              ...c,
              channelPrices: {},
              recipe: c.recipe
                .filter((r) => r.removable)
                .map((r) => ({
                  ingredientId: r.ingredientId,
                  name: stock.get(r.ingredientId)?.name,
                  removable: true,
                })),
              variants: c.variants.map((v) => ({
                ...v,
                recipe: v.recipe
                  .filter((r) => r.removable)
                  .map((r) => ({
                    ingredientId: r.ingredientId,
                    name: stock.get(r.ingredientId)?.name,
                    removable: true,
                  })),
              })),
              extras: c.extras.map((e) => ({ ...e, recipe: [] })),
            }
          : c,
      };
    });
  }
}
