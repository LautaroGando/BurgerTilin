import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Db } from '../src/db';
import { mediaDirectory } from '../src/media';

const db = new Db();
async function embed() {
  const rows = await db.media.findMany({ where: { content: null }, select: { id: true } });
  let copied = 0;
  for (const { id } of rows) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('ID de foto inválido');
    const image = await readFile(join(mediaDirectory(), `${id}.webp`));
    if (image.subarray(0, 4).toString() !== 'RIFF' || image.subarray(8, 12).toString() !== 'WEBP')
      throw new Error(`La foto ${id} no es WebP`);
    const result = await db.media.updateMany({
      where: { id, content: null },
      data: { content: new Uint8Array(image) },
    });
    copied += result.count;
  }
  console.log(`${copied} fotos incorporadas al respaldo de PostgreSQL.`);
}
embed().catch((error) => {
  console.error(error instanceof Error ? error.message : 'No se pudieron copiar las fotos');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
