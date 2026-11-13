import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';
import { DateTime } from 'luxon';
import { TZ } from '../src/domain';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  const source = new URL(process.env.DATABASE_URL);
  const host = source.hostname.replace(/^\[|\]$/g, '');
  const sourceName = decodeURIComponent(source.pathname.slice(1));
  if (
    !['localhost', '127.0.0.1', '::1'].includes(host) ||
    /(?:_test|_restore|_demo)/i.test(sourceName)
  )
    throw new Error('Usá la base local de trabajo para exportar a producción.');

  const timestamp = DateTime.now().setZone(TZ).toFormat('yyyy-LL-dd-HH-mm-ss');
  const output = resolve(
    process.argv[2] || '../../.local/produccion/burger-tilin-' + timestamp + '.dump',
  );
  if (existsSync(output)) throw new Error('Ese respaldo ya existe. Elegí otro nombre.');
  if (!output.endsWith('.dump')) throw new Error('El nombre del archivo debe terminar en .dump');
  mkdirSync(dirname(output), { recursive: true });

  const ownerPath = resolve('../../.local/owner-production.sql');
  const owner = existsSync(ownerPath) ? readFileSync(ownerPath, 'utf8') : '';
  const suffix = randomBytes(5).toString('hex');
  const staging = 'burger_tilin_release_' + suffix;
  const snapshot = output + '.' + suffix + '.source';
  const archive = output + '.' + suffix + '.partial';
  const copy = new URL(source);
  copy.pathname = '/' + staging;
  const postgresBin =
    process.env.PG_BIN ||
    (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  const postgres = (binary: 'pg_dump' | 'pg_restore', database: string, args: string[]) => {
    const name = process.platform === 'win32' ? binary + '.exe' : binary;
    execFileSync(postgresBin ? resolve(postgresBin, name) : name, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PGHOST: host,
        PGPORT: source.port || '5432',
        PGUSER: decodeURIComponent(source.username),
        PGPASSWORD: decodeURIComponent(source.password),
        PGDATABASE: database,
        PGSSLMODE: source.searchParams.get('sslmode') ?? 'prefer',
      },
    });
  };

  const admin = new Client({ connectionString: source.href });
  await admin.connect();
  let created = false;
  try {
    postgres('pg_dump', sourceName, [
      '--format=custom',
      '--exclude-table-data=public."Session"',
      '--file',
      snapshot,
    ]);
    await admin.query('CREATE DATABASE "' + staging + '"');
    created = true;
    postgres('pg_restore', staging, [
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '--single-transaction',
      '--dbname',
      staging,
      snapshot,
    ]);

    const db = new Client({ connectionString: copy.href });
    await db.connect();
    try {
      const result = await db.query<{
        products: number;
        published: number;
        orders: number;
        sessions: number;
        sandbox: boolean;
        legacy: boolean;
      }>(`
        SELECT
          (SELECT count(*)::int FROM "Product") AS products,
          (SELECT count(*)::int FROM "Product" WHERE published) AS published,
          (SELECT count(*)::int FROM "Order") AS orders,
          (SELECT count(*)::int FROM "Session") AS sessions,
          EXISTS (SELECT 1 FROM "OnlineCheckout" WHERE "providerId" LIKE 'ORDTST%')
            OR EXISTS (SELECT 1 FROM "Product" WHERE category = 'Prueba de Mercado Pago' AND name = 'Producto de prueba') AS sandbox,
          EXISTS (SELECT 1 FROM "Media" WHERE content IS NULL) AS legacy
      `);
      const counts = result.rows[0];
      if (counts.sandbox) throw new Error('Se encontraron datos de prueba en la copia.');
      if (counts.sessions) throw new Error('No se pudieron excluir las sesiones de acceso.');
      if (counts.legacy) {
        execFileSync(
          process.execPath,
          [require.resolve('tsx/cli'), resolve('scripts/embed-media.ts')],
          {
            stdio: 'inherit',
            env: { ...process.env, DATABASE_URL: copy.href, VERCEL: '0' },
          },
        );
      }
      if (owner) await db.query(owner);
      const { rows } = await db.query<{ ready: boolean }>(`
        SELECT EXISTS (SELECT 1 FROM "User" WHERE role = 'OWNER' AND active)
          AND NOT EXISTS (SELECT 1 FROM "Media" WHERE content IS NULL)
          AND EXISTS (SELECT 1 FROM "Settings" WHERE id = 1) AS ready
      `);
      if (!rows[0].ready)
        throw new Error('La copia necesita un dueño activo, la configuración y todas las fotos.');
      postgres('pg_dump', staging, [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--file',
        archive,
      ]);
      if (existsSync(output)) throw new Error('Ese respaldo ya existe. Elegí otro nombre.');
      renameSync(archive, output);
      console.log('Respaldo listo: ' + output);
      console.log(
        counts.products +
          ' productos, ' +
          counts.published +
          ' publicados y ' +
          counts.orders +
          ' pedidos.',
      );
    } finally {
      await db.end();
    }
  } finally {
    try {
      if (created) await admin.query('DROP DATABASE "' + staging + '"');
    } finally {
      await admin.end();
      rmSync(snapshot, { force: true });
      rmSync(archive, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.code ? 'No se pudo exportar la base. Código: ' + error.code : error.message);
  process.exitCode = 1;
});
