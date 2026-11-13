# Ejecutar, desplegar y recuperar

## Desarrollo

Seguir el README. El frontend se sirve en 3000 y el backend en 4000. El backend escucha solo en loopback salvo configuración explícita. `API_INTERNAL_URL` se resuelve al iniciar/configurar Next: después de cambiarlo hay que reiniciar Next. No ejecutar `next build` mientras `next dev` usa la misma carpeta `.next`.

La base aislada creada durante el desarrollo usa 55432 y no reemplaza ningún servicio instalado. Para detenerla: `pg_ctl -D .local/pgdata stop -m fast`. No borrar `.local` sin respaldar primero lo que se quiera conservar. No copiar el clúster `trust` al servidor público.

## Producción con Docker

Se entregan Dockerfiles y un compose con PostgreSQL, API, Next y Caddy. Estos archivos se revisaron estáticamente; el daemon Docker estaba apagado y **no se ejecutó el despliegue Docker**. No hay un sitio público publicado.

1. Servidor Linux con Docker Compose, dominio con DNS apuntando al servidor y puertos 80/443 disponibles. Las bases no se publican a Internet.
2. Definir en un archivo de entorno fuera de Git: `POSTGRES_PASSWORD` fuerte, `DATABASE_URL` con host `db`, usuario `tilin`, base `burger_tilin`, contraseña codificada como URL, `WEB_ORIGIN=https://TU_DOMINIO` y `SITE_ADDRESS=TU_DOMINIO`. Los valores de ejemplo son marcadores, no credenciales.
3. `docker compose --env-file RUTA_ENV -f compose.production.yaml build`
4. `docker compose --env-file RUTA_ENV -f compose.production.yaml up -d db`
5. `docker compose --env-file RUTA_ENV -f compose.production.yaml run --rm api npm run db:migrate`
6. `docker compose --env-file RUTA_ENV -f compose.production.yaml run --rm api npm run db:seed`. El manifiesto de 29 borradores viaja con la API y las fotos con el frontend.
7. `docker compose --env-file RUTA_ENV -f compose.production.yaml run --rm -it api npm run setup`
8. `docker compose --env-file RUTA_ENV -f compose.production.yaml up -d`
9. Verificar `https://TU_DOMINIO/api/health`, login, pedido, SSE y cierre de caja con un pedido de validación identificado y luego anulado mediante su flujo normal.

Caddy termina TLS y envía API y SSE al backend; el resto a Next. `TRUST_PROXY=true` solo es correcto si la API no es accesible directamente y el proxy reemplaza las cabeceras del cliente. Para instalaciones nativas, usar un supervisor de procesos, `NODE_ENV=production`, HTTPS y el mismo origen en `WEB_ORIGIN`.

En actualizaciones: respaldar, construir versión nueva, aplicar migraciones con un solo proceso, reiniciar y comprobar salud. No revertir una migración destructivamente para bajar una versión; preparar una migración correctiva.

## Respaldos

Usar PostgreSQL 18 `pg_dump` / `pg_restore`. Los scripts leen `.env` desde `apps/api`; pasan la contraseña al proceso por entorno, sin incluirla en argumentos ni imprimirla.

```powershell
# Desde la raíz. PG_BIN es opcional si los binarios ya están en PATH.
$env:PG_BIN='C:/Program Files/PostgreSQL/18/bin'
npm run backup -w apps/api -- ../../backups/turno-2026-10-23.dump
```

Genera formato custom. No sobrescribe un archivo existente. Hacer un respaldo diario al cerrar y uno antes de migrar, con retención definida por el dueño (por ejemplo, diarios y semanales), guardados cifrados en otra máquina/proveedor. El planificador del servidor debe ejecutar el mismo comando y alertar ante salida distinta de cero. **No se configuró un planificador ni una copia externa sin destino/credenciales reales.** Las fotos se respaldan desde `apps/web/public/assets`; no están dentro del dump. Guardar también la versión de código y las variables en un gestor de secretos.

## Restauración segura

1. Crear una base PostgreSQL nueva y vacía. Nunca apuntar el script a la base activa.
2. Definir `DATABASE_URL` del proceso hacia esa nueva base; el script rechaza cualquier base con tablas públicas.
3. Ejecutar:

```powershell
$env:DATABASE_URL='postgresql://USUARIO:CONTRASENA@HOST:5432/burger_tilin_restore'
npm run restore -w apps/api -- ../../backups/turno-2026-10-23.dump
```

4. Verificar `/api/health`, número de pedidos/pagos/movimientos, último turno, acceso y un seguimiento privado. Comparar cantidades con el origen. Restaurar assets de la misma versión.
5. En una ventana de mantenimiento, detener escrituras y cambiar la aplicación a la base recuperada; conservar la anterior hasta validar. Los respaldos contienen datos de clientes y enlaces privados: restringir acceso y cifrar almacenamiento/transporte.

Para comprobar un backup se debe restaurar periódicamente: la existencia del archivo no demuestra recuperabilidad. Ver `VALIDACION.md` para el resultado del ensayo de desarrollo.

## Operación y límites de seguridad

SSE admite una instancia API. No activar múltiples réplicas sin bus compartido; el polling evita perder la lista, pero la alerta instantánea debe probarse tras escalar. Las sesiones duran 12 horas y se invalidan al cerrar sesión. No hay recuperación de contraseña por correo: el dueño administra accesos desde configuración; una recuperación de emergencia requiere intervención controlada en servidor. El historial sensible está disponible en `GET /api/admin/audit` exclusivamente para dueño. No registrar cuerpos de pedidos ni tokens de seguimiento en logs del proxy.


## Fotos y accesos
Los respaldos incluyen un archivo adicional .media.tar, que debe conservarse junto al dump. Para restaurar, definir UPLOAD_DIR hacia una carpeta nueva y vacía. En producción, el volumen uploads conserva las fotos entre despliegues. Ver IMAGENES-Y-PENDIENTES.md para instrucciones y límites actualizados.

