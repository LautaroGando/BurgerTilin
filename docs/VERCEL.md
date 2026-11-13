# Burger Tilín en Vercel

El proyecto contiene dos servicios con el mismo dominio. Next.js sirve el menú y la administración. NestJS atiende `/api` y usa Prisma ORM con Prisma Postgres. Las fotos subidas se guardan en la base y los pedidos del tablero se consultan cada cuatro segundos en Vercel.

1. Creá una base Prisma Postgres separada en Storage del equipo Código Total. Conservá `burger-tilin-db` para la web anterior.
2. Conectá la base nueva al proyecto y elegí el entorno correspondiente. La app usa `DATABASE_URL_POOLED` y recurre a `DATABASE_URL` si falta la conexión con pool. Si ya configuraste las variables con prefijo `TILIN_`, esas tienen prioridad. Usá la conexión directa como `DATABASE_URL` para ejecutar Prisma Migrate desde una terminal de confianza.
3. Seguí la [guía de preparación y traslado](PUBLICAR.md) para exportar la configuración local, el acceso y las fotos en un respaldo. Restauralo en una base vacía.
4. Publicá primero una vista previa. Verificá `/api/health`, `/menu`, inicio de sesión, catálogo, subida de fotos, caja y llegada de pedidos.
5. Para cobros de prueba, seguí [Mercado Pago](MERCADO-PAGO.md). `WEB_ORIGIN` debe ser el dominio HTTPS del despliegue correspondiente. Generá `CRON_SECRET` y guardalo como variable privada del servidor. Vercel llama cada minuto al endpoint de conciliación configurado en `vercel.json`.
6. Para producción comercial usá Vercel Pro. Con el ensayo aprobado, publicá la versión nueva en el proyecto que sirve `www.burgertilin.com`. Configurá en su entorno Production las credenciales renovadas y el webhook de producción. Conservá la versión anterior para poder revertir si falla el cambio de dominio o una comprobación.

Una vista previa técnica sin credenciales puede publicarse con una copia de `vercel.json` que omita `crons`. Vercel Hobby limita la frecuencia de cron y el uso comercial.

[Servicios de Vercel](https://vercel.com/kb/guide/vercel-services) · [Prisma Postgres en Vercel](https://www.prisma.io/docs/guides/postgres/vercel) · [Límites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)
