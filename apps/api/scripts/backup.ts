import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { Client } from 'pg';
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(mode) || !file)
    throw new Error('Uso: backup.ts backup|restore RUTA.dump');
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Falta DATABASE_URL');
  const url = new URL(raw),
    path = resolve(file);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  if (url.searchParams.get('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode')!;
  const media = resolve(process.env.UPLOAD_DIR || '../../.local/uploads'),
    archive = path + '.media.tar';
  const tar = (args: string[]) => {
    const result = spawnSync('tar', args, { env, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('No se pudo procesar el archivo de fotos');
    return result.stdout;
  };
  if (mode === 'restore' && existsSync(archive)) {
    if (existsSync(media) && readdirSync(media).length)
      throw new Error('UPLOAD_DIR debe apuntar a una carpeta vacía para restaurar fotos');
    const entries = tar(['-tf', archive]).trim().split(/\r?\n/);
    if (entries.some((name) => !/^\.\/?$/.test(name) && !/^\.\/[0-9a-f-]{36}\.webp$/.test(name)))
      throw new Error('El archivo de fotos contiene rutas no permitidas');
    if (
      tar(['-tvf', archive])
        .trim()
        .split(/\r?\n/)
        .some((line) => !['-', 'd'].includes(line[0]))
    )
      throw new Error('El respaldo contiene enlaces no permitidos');
  }
  if (mode === 'restore') {
    if (!existsSync(path)) throw new Error('No existe el respaldo');
    const db = new Client({ connectionString: raw });
    await db.connect();
    try {
      const result = await db.query(
        "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'",
      );
      if (result.rows[0].n !== 0)
        throw new Error(
          'La restauración requiere una base NUEVA y VACÍA. No se sobrescribe el local.',
        );
    } finally {
      await db.end();
    }
  } else {
    if (existsSync(path) || existsSync(archive))
      throw new Error('El archivo ya existe: elegí otro nombre');
    mkdirSync(dirname(path), { recursive: true });
  }
  const binary = mode === 'backup' ? 'pg_dump' : 'pg_restore';
  const executable = process.env.PG_BIN
    ? resolve(process.env.PG_BIN, binary + (process.platform === 'win32' ? '.exe' : ''))
    : binary;
  const args =
    mode === 'backup'
      ? ['--format=custom', '--file', path]
      : [
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          '--single-transaction',
          '--dbname',
          env.PGDATABASE!,
          path,
        ];
  const result = spawnSync(executable, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${binary} terminó con error; no se confirmó la operación`);
  if (mode === 'backup') {
    mkdirSync(media, { recursive: true });
    tar(['-cf', archive, '-C', media, '.']);
  } else if (existsSync(archive)) {
    mkdirSync(media, { recursive: true });
    tar(['-xf', archive, '-C', media]);
  } else {
    const db = new Client({ connectionString: raw });
    await db.connect();
    try {
      const {
        rows: [mediaColumn],
      } = await db.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Media' AND column_name = 'content'
        ) AS embedded
      `);
      const missing =
        !mediaColumn.embedded ||
        (
          await db.query(
            'SELECT EXISTS (SELECT 1 FROM public."Media" WHERE content IS NULL) AS missing',
          )
        ).rows[0].missing;
      if (missing)
        console.warn('El respaldo puede requerir las fotos del almacenamiento anterior.');
    } finally {
      await db.end();
    }
  }
  console.log(
    mode === 'backup'
      ? `Respaldo creado: ${path}`
      : 'Restauración completada. Verificá health, cantidades de registros y un pedido antes de cambiar la URL del local.',
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
