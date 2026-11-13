# Arquitectura y decisiones

Monorepo npm con dos procesos y una base. `apps/web` ofrece UI Next.js App Router; `/api/*` se dirige al servidor NestJS. `apps/api` concentra reglas y persistencia. PostgreSQL es la fuente de verdad; no hay almacenamiento operativo en el navegador ni datos simulados de respaldo. La sesión usa cookie HttpOnly y SameSite Strict, hashes scrypt para contraseñas y SHA-256 para tokens de sesión. Los enlaces de seguimiento tienen 256 bits aleatorios y no exponen teléfono, nombre ni domicilio.

NestJS se divide en catálogo/precios, pedidos, finanzas, operaciones, importación y autenticación. Se conserva un despliegue de API único para SSE. El código de presentación se divide por experiencia: tienda, tablero, gestión y operaciones financieras. Las reglas puras de horarios y unidades se testean por separado.

## Pantallas

Públicas: menú, personalización, carrito/compra y seguimiento privado. Administración: Pedidos (entrada), Cocina, Venta rápida, Ventas, Productos, Inventario, Caja del turno, Clientes, Resumen y Configuración. Caja y cocina reciben permisos diferentes; las validaciones de permiso también viven en el servidor.

## Reglas e invariantes

- Dinero en centavos enteros. Costo unitario en decimal de seis posiciones (centavos por g/ml/unidad). Se redondea una vez al guardar el costo total del pedido. El precio nunca viene del cliente; `expectedTotal` solo detecta cambios desde que se armó el carrito.
- Cada pedido conserva snapshots de sus ítems, modificaciones, precios, costo, tarifa de envío y comisión. Cada pago conserva su comisión y si afecta efectivo o es una cuenta a cobrar de plataforma. Cambiar configuración no cambia los registros anteriores.
- Un combo tiene precio comercial, grupos de selección y componentes existentes. Se expande para calcular consumo; jamás genera stock independiente. El packaging puede estar en la receta del combo. Se prohíbe anidar combos.
- Al confirmar se suman reservas. Al preparar se disminuyen stock y reservas en una transacción. Antes de preparar, anular libera la reserva. Después de preparar no se repone automáticamente: se registra una anotación de merma de cantidad cero porque el consumo ya se descontó. Una devolución física se registra explícitamente.
- Transacciones Serializable con reintento completo ante conflictos. Índice único de clave de pedido, pago y liquidación; índice parcial para una sola caja abierta. Restricción SQL impide reservas negativas o stock estricto inferior a lo reservado.
- Confirmación al cliente solo después del commit. SSE se emite después del commit en pedidos/pagos. La reconexión consulta la lista activa completa; no depende de eventos en memoria para recuperar pedidos.
- Estado operativo separado del pago. Transferencia pendiente hasta verificación humana. Cobrar una plataforma genera cuenta pendiente; liquidarla vincula pagos y registra un ingreso de dinero, sin volver a crear venta.
- Un rechazo/cancelación no borra la venta ni hace un reembolso implícito. El detalle conserva pagos, auditoría e inventario relacionados. Una comisión ya cobrada no se presume reintegrada.
- El resumen agrupa ventas por fecha del pedido y muestra cobros por fecha de confirmación; las liquidaciones, gastos y diferencias se toman por fecha de movimiento. No es un mayor contable de flujo de fondos: para conciliar efectivo se usa el turno.

## Decisiones para ahorrar trabajo

Catálogo inicial en borradores a partir de las imágenes; configuración progresiva de recetas; favoritos y búsqueda en venta rápida; estado siguiente como acción principal; datos de contacto fuera de cocina; pausa y demora en el tablero; agotados en una sola acción; historial automático por teléfono normalizado; liquidaciones y exportación desde el sistema.

Los únicos datos predeterminados comerciales son identificadores y nombres de canales/medios habituales. Comisiones en cero significan "sin comisión configurada" y deben revisarse. No se inventaron recetas, precios, contactos, zona geográfica ni horarios a partir de fotos.

## Versiones y fuentes oficiales consultadas

- Next.js 16.4.2 / React 19.3.1, publicaciones verificadas en npm. Se leyeron además las guías incluidas en `node_modules/next/dist/docs` de layouts, componentes y orígenes de desarrollo. [Instalación](https://nextjs.org/docs/app/getting-started/installation).
- NestJS 11.2.7 para una línea estable CommonJS compatible con herramientas elegidas. NestJS 12 ya existe; no se mezclan sus convenciones ESM con este servidor. [SSE](https://docs.nestjs.com/techniques/server-sent-events), [migraciones](https://docs.nestjs.com/migration-guide).
- Prisma 7.10.1 estable, con adapter-pg. No se eligió Prisma 8, que npm publicaba como release candidate. [Driver PostgreSQL v7](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).
- PostgreSQL 18. [Aislamiento de transacciones](https://www.postgresql.org/docs/18/transaction-iso.html).
- [Mercado Pago Webhooks](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications): se valida la firma y se consulta la orden al proveedor. La [configuración de Mercado Pago](MERCADO-PAGO.md) detalla la activación.
- [Portal de Courier PedidosYa](https://developers.pedidosya.com/): acceso comercial no acreditado; no se promete importación de pedidos de marketplace.

