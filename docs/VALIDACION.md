# Validación de entrega

Fecha: 23 de octubre de 2026. Windows, Node 24.21, PostgreSQL 18.6 local. Se usó una base aislada `burger_tilin_test`; sus fixtures nunca se cargaron en la base del local.

## Comprobado automáticamente

`npm run build` compila NestJS y genera el frontend Next.js de producción. `npm test` con `TEST_DATABASE_URL` ejecuta tres pruebas unitarias y un escenario de integración que contiene las siguientes comprobaciones:

- Horarios de Buenos Aires que continúan después de medianoche, cierre excepcional, pausa y próxima apertura.
- Precio recalculado en servidor y rechazo de totales esperados desactualizados y descuentos públicos no autorizados.
- Combo con dos componentes personalizados independientemente: una variante doble con extra y otra con ingrediente excluido; consumo y precio exactos.
- Mismo pedido y clave devuelve el mismo número; cambiar el contenido de la clave produce conflicto.
- Cinco pedidos concurrentes para dos unidades: exactamente dos confirmados. Sin reservas excedidas.
- Cancelación antes de cocinar libera reserva; después de cocinar mantiene stock consumido y anota merma.
- Transición hasta entregado y seguimiento privado sin contacto; token incorrecto rechazado.
- Pago dividido efectivo/transferencia; transferencia pendiente hasta verificación; reintentos de cobro y verificación no duplican registros.
- Reembolso repetido no crea una segunda salida.
- Liquidación repetida no duplica ingresos ni ventas; se cancela la cuenta pendiente.
- Importación repetida conserva el pedido; repetición de compra cotiza precios actuales.
- Apertura/cierre con efectivo esperado 5.400 centavos, contado 5.350 y diferencia -50, sobre fixtures pequeños identificados como prueba.
- Acceso administrador anónimo rechazado; sesión autenticada recupera todos los pedidos pendientes; cocina omite importes/contactos; conexión SSE devuelve el evento real de actualización.

`npm audit` informó cero vulnerabilidades tras actualizar dependencias de desarrollo. Los importes de prueba son datos de tests, no precios comerciales sugeridos.

## Comprobado en navegador

- Tienda y acceso, tablero autenticado, cambio de estado y modo cocina en el entorno aislado.
- Compra pública completa: abrir combo, elegir doble, extra y exclusión por separado, carrito, datos mínimos de retiro y confirmación. El servidor guardó el pedido y se abrió su seguimiento privado con número, total y pago pendiente.
- Comprobación visual del tablero a un ancho de aproximadamente 1.000 px. Los layouts tienen reglas para celular/tablet, pero no se verificaron físicamente todos los tamaños o dispositivos.
- Se restauró la conexión de la vista previa al terminar a la base comercial: 29 borradores, cero pedidos y cero usuarios. La tienda queda pausada hasta completar datos y crear el dueño.

## Respaldo

Se ejecutaron `pg_dump` y el script de restauración en una base nueva `burger_tilin_restore_20261023`. Conteos comparados: 29 productos, 0 pedidos, 0 usuarios en origen y destino. Se comprobó la restauración del catálogo/configuración inicial; no equivale a un simulacro de recuperación de una operación comercial en marcha. El dump está en `backups/` y está excluido de Git. Antes de operar se debe definir destino externo, cifrado, retención y programación.

## No se presenta como probado

Docker y hosting público, cobro real de Mercado Pago con cuenta vendedora, sonido audible en un equipo de cocina, impresión física, cortes reales de red y recuperación tras reiniciar hardware. La recuperación lógica/SSE se verificó con API y la UI tiene polling/reconexión. Las pruebas locales de Checkout Pro usan respuestas controladas del proveedor.
