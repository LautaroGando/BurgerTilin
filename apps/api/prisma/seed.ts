import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../src/db';
import { defaults } from '../src/domain';
import { passwordHash } from '../src/auth';
const db = new Db();
async function seed() {
  await db.settings.upsert({ where: { id: 1 }, create: { id: 1, data: defaults }, update: {} });
  const assets = JSON.parse(readFileSync(resolve(__dirname, 'catalog-assets.json'), 'utf8')) as {
    name: string;
    category: string;
    image: string;
    seed?: boolean;
  }[];
  for (const { name, category, image, seed } of assets) {
    if (seed === false) continue;
    if (await db.product.findFirst({ where: { image } })) continue;
    await db.product.create({
      data: {
        name,
        category,
        image,
        price: null,
        published: false,
        config: { recipe: [], variants: [], extras: [], slots: [], channelPrices: {} },
      },
    });
  }
  if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    if (process.env.OWNER_PASSWORD.length < 12)
      throw new Error('OWNER_PASSWORD debe tener al menos 12 caracteres');
    await db.user.upsert({
      where: { email: process.env.OWNER_EMAIL.toLowerCase() },
      create: {
        email: process.env.OWNER_EMAIL.toLowerCase(),
        password: passwordHash(process.env.OWNER_PASSWORD),
        role: 'OWNER',
      },
      update: {},
    });
  }
  console.log(
    'Catálogo importado como borradores. No se modificaron productos ni usuarios existentes.',
  );
}
seed().finally(() => db.$disconnect());
