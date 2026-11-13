import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { Db } from './db';
import { audit } from './orders';
export const mediaDirectory = () => resolve(process.env.UPLOAD_DIR || '../../.local/uploads');
export const mediaUploadLimit = 4 * 1024 * 1024;
@Injectable()
export class MediaService {
  constructor(@Inject(Db) private db: Db) {}
  async list() {
    const originals = JSON.parse(
      await readFile(resolve(__dirname, '../prisma/catalog-assets.json'), 'utf8'),
    ) as { name: string; image: string; category: string }[];
    const uploaded = await this.db.media.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true },
    });
    return [
      ...uploaded.map((m) => ({
        id: m.id,
        name: m.name,
        image: `/api/media/${m.id}.webp`,
        category: 'Subidas',
      })),
      ...originals.map(({ name, image, category }) => ({ id: image, name, image, category })),
    ];
  }
  async upload(file: Express.Multer.File | undefined, actor: string) {
    if (!file || !file.buffer?.length)
      throw new BadRequestException('Elegí una imagen JPG, PNG o WebP');
    if (file.size > mediaUploadLimit) throw new BadRequestException('La foto debe pesar hasta 4 MB');
    const b = file.buffer;
    const signature =
      b.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
    if (!signature) throw new BadRequestException('El archivo no es una foto JPG, PNG o WebP');
    let output: Buffer, metadata: sharp.OutputInfo;
    try {
      const input = sharp(file.buffer, {
        limitInputPixels: 25000000,
        animated: false,
        failOn: 'warning',
      });
      const info = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(info.format || '') || (info.pages || 1) > 1)
        throw new Error('format');
      const result = await input
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer({ resolveWithObject: true });
      output = result.data;
      metadata = result.info;
    } catch {
      throw new BadRequestException(
        'La foto no es válida. Usá JPG, PNG o WebP de hasta 25 megapíxeles',
      );
    }
    const id = randomUUID();
    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.media.create({
        data: {
          id,
          name: file.originalname.replace(/[\x00-\x1f]/g, '').slice(0, 150),
          width: metadata.width,
          height: metadata.height,
          content: new Uint8Array(output),
        },
        omit: { content: true },
      });
      await audit(tx, actor, 'UPLOAD_IMAGE', id, { name: row.name });
      return row;
    });
    return { ...row, image: `/api/media/${id}.webp` };
  }
  async file(filename: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(filename)
    )
      throw new NotFoundException();
    const row = await this.db.media.findUnique({
      where: { id: filename.slice(0, -5) },
      select: { content: true },
    });
    if (!row) throw new NotFoundException();
    if (row.content) return Buffer.from(row.content);
    try {
      return await readFile(join(mediaDirectory(), filename));
    } catch {
      throw new NotFoundException('No encontramos esa foto en el almacenamiento');
    }
  }
}
