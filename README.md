# Burger Tilín

Aplicación transaccional para tienda, cocina y administración. Next.js + TypeScript, NestJS, Prisma y PostgreSQL. No hay ventas simuladas en la base del local.

Para alojar los dos servicios y Prisma Postgres en el mismo equipo de Vercel, seguí la [guía de despliegue en Vercel](docs/VERCEL.md).

Para llevar tus productos, fotos y configuración local a producción, seguí la [guía de traslado](docs/PUBLICAR.md).

## Inicio rápido

Requisitos: Node.js 24 LTS (mínimo 22.12), npm y PostgreSQL 18. Docker es opcional.

1. `npm ci`
2. Copiar `apps/api/.env.example` a `apps/api/.env` y definir `DATABASE_URL` para una base PostgreSQL propia. Copiar `apps/web/.env.example` a `apps/web/.env.local` si el backend usa otra dirección.
3. `npm run db:generate`
4. `npm run db:migrate`
5. `npm run db:seed` (importa las imágenes como borradores; no asigna precios, recetas ni horarios).
6. `npm run setup` (solicita correo y contraseña del dueño en tu terminal).
7. `npm run dev`

Tienda: <http://127.0.0.1:3000/menu> · Administrador: <http://127.0.0.1:3000/admin>.

Para usar Docker solo para la base, definir `POSTGRES_PASSWORD` en el entorno y ejecutar `docker compose up -d db`. La URL debe usar esa contraseña. No subir `.env` ni respaldos a Git.

En este equipo ya se importaron las imágenes de `Desktop/Documentos/BurgerTilin`. La base local aislada está en `.local/pgdata`, puerto **55432**, con `.env` local ignorado por Git. Se usó autenticación `trust` solo para pruebas en loopback; no usar ese clúster en producción. No se creó un dueño comercial ni se habilitó la tienda automáticamente.

Si esa base local está detenida, en PowerShell:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D .local/pgdata -l .local/postgres.log -o '-p 55432 -h 127.0.0.1' start
```

## Preparar el primer turno

1. Crear el dueño e ingresar. En **Configuración**, cargar dirección, WhatsApp, horarios, cierres, zonas y medios de pago.
2. En **Productos**, completar descripción y precio de los borradores y publicarlos. Los combos necesitan componentes explícitos: su nombre de archivo no confirma contenido.
3. Crear los insumos que interese controlar. Recibir stock y asignar recetas en g, ml o unidades; las compras admiten kg y litros. El control aproximado permite empezar sin relevar todo.
4. Abrir caja con el fondo inicial. Reanudar pedidos desde el tablero y activar/probar el sonido en el dispositivo que atenderá el turno.
5. Aceptar → cocinar → listo → entregar. Verificar los cobros desde el detalle. Cerrar caja contando el efectivo físico.

## Qué incluye

- **Etapa 1:** catálogo público con fotos reales; carrito, variantes, extras, exclusiones y combos con personalización por componente; retiro/delivery; pedido sin cuenta; seguimiento privado; tablero SSE y recuperación por consulta; alarma repetida mientras haya pedidos nuevos sin reconocer; cocina sin información financiera; impresión; venta rápida multicanal; pausa, demora y agotados.
- **Etapa 2:** recetas; reservas y consumo transaccionales; control estricto o aproximado; compras, ajustes, devoluciones explícitas y mermas; reposición; caja por turno; pagos divididos y pendientes; descuentos manuales en venta rápida; reembolsos; snapshots de importes, costos, comisiones y efecto en efectivo; historial, filtros y CSV para Excel; roles y auditoría.
- **Etapa 3:** resumen diario, ranking de productos, gastos y diferencias de caja; vigencia de promociones por fecha/hora/canal; precios por canal; actualización masiva con vista previa; historial de clientes y repetición validada; importación JSON compatible con claves externas; cuentas de plataformas y liquidaciones vinculadas que no duplican ventas.

## Configuración y límites explícitos

- **Mercado Pago:** Checkout Pro con Orders. Para recibir pagos en tu cuenta vendedora, seguí la [configuración y prueba de Mercado Pago](docs/MERCADO-PAGO.md). La tienda funciona con cobros manuales mientras la integración está desactivada.
- **WhatsApp/PedidosYa:** carga rápida manual e importación del formato propio documentado. No hay acceso automático a sus cuentas, inboxes o pedidos. La API pública de Courier no acredita acceso al marketplace de tu comercio.
- **Delivery:** zona seleccionada y habilitada, tarifa/mínimo validados en servidor; límites descriptivos de barrios. No hay geocodificación, polígonos, validación automática de pertenencia de una dirección ni GPS. La dirección puede consultarse en Google Maps; el repartidor es un nombre opcional.
- No se aceptan pedidos programados. Cierres excepcionales se aplican a todo el día civil local, incluso la continuación de un horario nocturno.
- Sonido con pestaña abierta y activación explícita; sin push con navegador cerrado. SSE es de una sola instancia API; hay polling de respaldo cada 15 s. Para escalar horizontalmente se necesita un bus compartido de eventos.
- Importaciones son por registro: muestran errores y permiten reintentos. No hacen importación histórica de totales ajenos: recalculan y crean pedidos operativos, con reservas, a precios actuales.
- Liquidaciones usan comisiones pactadas guardadas en la venta. Si el neto del extracto difiere, revisar la configuración/conciliación antes de confirmar; no se fuerza un ajuste silencioso.
- Los reembolsos son registros internos. La devolución efectiva por transferencia/tarjeta se hace en el proveedor y luego se registra acá. No emiten transferencias bancarias.
- Ventas/CSV limitan la vista a 5.000 registros e indican el límite; acotar fechas para exportar períodos grandes. Clientes muestra hasta 200 e historial de los últimos 30 pedidos.
- El costo es estimado con los costos vigentes al confirmar; no es contabilidad fiscal ni costo promedio de compras. Si falta receta o costo se indica incompleto. Compras de stock y pago al proveedor son movimientos separados.
- Fotos: subida desde el dispositivo y biblioteca reutilizable en Productos; almacenamiento persistente y respaldo conjunto. Accesos: gestión de usuarios, revocación de sesiones, cambio de contraseña y recuperación local del dueño. No hay facturación fiscal ni envío de comprobantes o recuperación por email. Ver [fotos y pendientes reales](docs/IMAGENES-Y-PENDIENTES.md).

## Validación

```powershell
npm run build
npm test
# La integración se habilita solo sobre una base cuyo nombre termina en _test:
$env:TEST_DATABASE_URL='postgresql://USUARIO:CONTRASENA@HOST:5432/burger_tilin_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npm run db:migrate
npm test
```

Sin `TEST_DATABASE_URL` las pruebas unitarias corren y la integración se marca omitida. La integración **vacía exclusivamente la base `_test`**, crea fixtures identificados como prueba y verifica circuito completo, combo con variantes/extras/exclusiones, concurrencia, cancelaciones, reintentos, pagos divididos, verificación repetida, reembolso repetido, liquidación repetida, importación repetida, cierre de caja y recuperación de pedidos vía API autenticada. También verifica acceso anónimo rechazado, seguimiento sin datos de contacto y endpoint SSE. El sonido real, impresión y cortes de red físicos requieren comprobación en el dispositivo de operación.

Ver [fotos y pendientes reales](docs/IMAGENES-Y-PENDIENTES.md), [arquitectura](docs/ARQUITECTURA.md), [despliegue y respaldos](docs/OPERACION.md), [formato de importación](docs/IMPORTACION.md) y [validación](docs/VALIDACION.md).
# BurgerTilin
