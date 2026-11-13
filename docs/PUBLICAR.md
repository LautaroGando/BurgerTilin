# Preparar Burger Tilín en local y publicar

## 1. Dejá el local configurado

Entrá al [administrador local](http://127.0.0.1:3000/admin). Guardá ahí los productos, precios, promociones, fotos, horarios, zonas, tarifas y medios de pago que quieras usar. Los cambios del administrador se guardan en PostgreSQL.

## 2. Sacá una copia definitiva

Desde la carpeta del proyecto, ejecutá `npm run production:export` después de guardar tus últimos cambios. El comando genera un archivo `.dump` con fecha y hora en `.local/produccion`. Incluye catálogo, fotos subidas, configuración, usuarios e historial real disponible. Aplica el acceso de dueño preparado en `.local/owner-production.sql` cuando ese archivo está presente. Las sesiones de acceso quedan fuera de la copia. Las fotos originales del catálogo se publican con el código de la web.

Guardá el archivo de forma privada. Contiene datos del negocio y credenciales derivadas. Generá otro respaldo si editás el local después de exportarlo.

## 3. Restaurá la copia en Prisma Postgres

Usá una base vacía. Si la base actual sirve otra versión de la tienda, conservá su respaldo y prepará el destino antes del cambio de sitio. Para el traslado, copiá la **conexión directa** de Prisma Postgres. La aplicación usa la conexión con pool después del despliegue.

Desde PowerShell, en la carpeta del proyecto, cambiá el nombre del archivo por el de tu último respaldo:

```powershell
$tilinDump = (Resolve-Path '.local/produccion/burger-tilin-listo.dump').Path
$env:PG_BIN = 'C:/Program Files/PostgreSQL/18/bin'
$tilinConnection = Read-Host -Prompt 'Pegá la conexión directa de la base de destino' -AsSecureString
try {
  $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $tilinConnection).Password
  npm run restore -w apps/api -- "$tilinDump"
  if ($LASTEXITCODE -ne 0) { throw 'La restauración falló' }
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  $tilinConnection.Dispose()
  Remove-Variable tilinConnection
}
```

La restauración exige una base vacía e incluye las migraciones que ya estaban aplicadas al exportar. Si el código que vas a publicar trae migraciones posteriores, ejecutá `npm run db:migrate` con la conexión directa del destino.

## 4. Publicá y comprobá el circuito

Publicá la web y la API usando el [procedimiento de Vercel](VERCEL.md). Comprobá el acceso de dueño, el menú en `/menu`, los precios, los horarios, la tarifa de delivery y el tablero. Activá el pago con la [guía de Mercado Pago](MERCADO-PAGO.md). El ensayo de cobro real se hace después de configurar las credenciales productivas y el aviso de pago.
