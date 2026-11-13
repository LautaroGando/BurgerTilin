import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { Db } from '../src/db';
import { passwordHash } from '../src/auth';
async function main() {
  const db = new Db();
  const recover = process.argv.includes('--recover');
  let hidden = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!hidden) stdout.write(chunk);
      done();
    },
  });
  const prompt = createInterface({ input: stdin, output, terminal: true });
  try {
    if (!recover && (await db.user.count()))
      throw new Error('Ya existe un usuario. Usá Configuración > Accesos con un dueño.');
    const email = (await prompt.question('Correo del dueño: ')).trim().toLowerCase();
    const target = recover ? await db.user.findUnique({ where: { email } }) : null;
    if (recover && (!target || target.role !== 'OWNER'))
      throw new Error('La recuperación local requiere el correo de un dueño existente');
    console.log('La contraseña se solicita en este terminal local. No la compartas en el chat.');
    stdout.write('Contraseña nueva (12 o más caracteres; no se muestra): ');
    hidden = true;
    const password = await prompt.question('');
    hidden = false;
    stdout.write('\n');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12)
      throw new Error('Correo inválido o contraseña demasiado corta');
    if (recover && target) {
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: target.id },
          data: { password: passwordHash(password), active: true },
        });
        await tx.session.deleteMany({ where: { userId: target.id } });
        await tx.audit.create({
          data: { actor: 'servidor-local', action: 'RECOVER_OWNER', entity: target.id, data: {} },
        });
      });
    } else
      await db.user.create({ data: { email, password: passwordHash(password), role: 'OWNER' } });
    console.log(
      recover
        ? 'Acceso recuperado. Todas las sesiones anteriores se cerraron.'
        : 'Dueño creado. Ingresá en http://127.0.0.1:3000/admin',
    );
  } finally {
    prompt.close();
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
