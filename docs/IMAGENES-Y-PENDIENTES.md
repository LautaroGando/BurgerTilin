# Fotos y cierre de pendientes locales

## Fotos desde el administrador

Productos → Editar → Producto ofrece **Subir foto**, **Elegir de la biblioteca** y **Quitar foto del producto**. La biblioteca permite buscar las 29 fotos de productos originales y todas las subidas. Subir no publica ni modifica un producto por sí solo: se debe pulsar **Guardar producto**. Quitar desvincula la foto, sin borrar un archivo que pueda estar usado por otros productos.

Se aceptan JPG, PNG y WebP hasta 4 MB y 25 megapíxeles. El servidor verifica firma y contenido real, rechaza SVG/archivos falsos, corrige orientación, limita a 1600 px, convierte a WebP y elimina metadatos de la foto. La subida requiere dueño autenticado. Los archivos resultantes son públicos porque forman parte de la tienda; no subir comprobantes ni documentos privados.

`Media` guarda las fotos nuevas en PostgreSQL. Para las fotos previas, la API sigue leyendo `UPLOAD_DIR` o `.local/uploads`. Antes de migrar a Vercel, ejecutá `npm run db:embed-media -w apps/api` en la instalación de origen, con acceso a esos archivos, y generá un respaldo actualizado.

El respaldo genera `nombre.dump` y `nombre.dump.media.tar`. El primero contiene PostgreSQL, incluidas las fotos incorporadas a la base. El segundo contiene archivos de fotos de la instalación anterior. Guardá ambos cifrados fuera del servidor. Para restaurar con el script, usá una base nueva y una carpeta vacía para `UPLOAD_DIR`. El script valida las rutas del tar y rechaza enlaces o la sobrescritura de fotos. Los archivos originales del catálogo viajan con el código. El respaldo requiere `tar` y las herramientas de PostgreSQL en `PATH`.

## Otros pendientes completados

- Combos con etiquetas claras de cantidad y recargo en pesos, botón para empezar la estructura hamburguesas/papas/bebidas, y alternativas de cada parte. No se completan contenidos comerciales por deducción del nombre.
- Precios por canal con formularios en pesos y canales de promoción con casillas; no hace falta escribir JSON ni IDs.
- Configuración → Accesos permite listar, cambiar permisos, desactivar/reactivar y restablecer contraseñas de otros usuarios. Las sesiones se revocan. Otro dueño debe cambiar tus propios permisos; no se permite dejar el sistema sin un dueño activo.
- Cambio de contraseña propia con verificación de la actual y cierre de sesiones.
- Configuración → Historial de cambios muestra los últimos 100 registros de auditoría, solo para dueños.
- Recuperación de emergencia del dueño desde el servidor: `npm run account:recover -w apps/api`. Solicita correo de un dueño existente y contraseña nueva, la oculta en terminal, revoca sesiones y deja auditoría. Requiere acceso al servidor y a su base; no envía correos ni necesita un servicio de email.

## Verificación de esta ampliación

Pruebas HTTP contra PostgreSQL de pruebas: upload auténtico, biblioteca original/subida, servicio WebP público, archivo falso rechazado, anónimo rechazado y cocina sin permiso de subida. Una instancia nueva del servicio encuentra la foto guardada. Pruebas de desactivación verifican revocación de sesión y protección del dueño actual. Se ensayó backup con fotos y restauración en `burger_tilin_media_restore` y carpeta de fotos nueva. Pasaron tipos y compilación de API y frontend. Las pruebas no cambian el catálogo ni las cuentas comerciales existentes.

## Qué sigue dependiendo de configuración o trabajo externo

No equivale a declarar implementadas integraciones que no existen:

| Área                                 | Estado real                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mercado Pago                         | Checkout Pro con Orders implementado. Pendiente de configurar la cuenta vendedora y probar con el proveedor. Ver [Mercado Pago](MERCADO-PAGO.md). |
| WhatsApp/PedidosYa automáticos       | Sin acceso autorizado a cuentas/API; siguen carga manual e importación compatible.                                                                     |
| Backup externo automático            | Script local de backup/restauración con fotos implementado. Faltan destino externo, cifrado, retención y activar el planificador del servidor elegido. |
| Hosting público                      | Configuración Docker y proxy preparada; falta servidor/dominio. No se probó Docker con el daemon apagado.                                              |
| Validación geográfica de direcciones | Solo zona habilitada, tarifa y mínimo; no geocodificación ni verificación de pertenencia. Requiere definir los límites reales y una solución de mapas. |
| Sonido/impresora/red física          | Falta ensayo en el dispositivo operativo; no hay notificaciones con navegador cerrado.                                                                 |

Facturación fiscal, GPS y pedidos programados no forman parte de lo habilitado. No se agregaron para aumentar la carga de operación ni se simularon como disponibles.
