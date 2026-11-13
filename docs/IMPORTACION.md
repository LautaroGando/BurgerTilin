# Importación compatible Burger Tilín v1

En Ventas → Importar archivo. Es un formato propio JSON, no un formato atribuido a PedidosYa o WhatsApp. Hace falta transformar un archivo de origen solo si realmente contiene los datos necesarios. No hay extracción automática de conversaciones.

```json
{
  "format": "burger-tilin/v1",
  "channel": "WHATSAPP",
  "records": [
    {
      "externalId": "ID_ESTABLE_DEL_ORIGEN",
      "order": {
        "fulfillment": "PICKUP",
        "name": "NOMBRE_REAL",
        "phone": "TELEFONO_REAL",
        "method": "cash",
        "items": [
          {
            "productId": "ID_REAL_DEL_PRODUCTO_PUBLICADO",
            "quantity": 1,
            "extras": [],
            "remove": [],
            "components": [],
            "note": ""
          }
        ]
      }
    }
  ]
}
```

Los IDs de productos, variantes, extras e ingredientes se obtienen del catálogo administrador (`GET /api/admin/products`). Para combos, cada entrada `components` tiene `slotId` y `choices` con un objeto por componente individual. Cada `choice` puede tener `productId`, `variantId`, `extras` y `remove` (IDs de ingredientes removibles). Para delivery, agregar `zone` con el ID habilitado y `address` real.

Usá `WHATSAPP` para WhatsApp y `APPS` para PedidosYa, Rappi o Mercado Pago. En Apps, anteponé la plataforma al identificador externo, por ejemplo `pedidosya:123`, `rappi:123` o `mercadopago:123`. Los archivos anteriores con canal `PEDIDOSYA` conservan compatibilidad y comparten la clave de deduplicación con los IDs prefijados con `pedidosya:`.

Máximo 100 registros y 500 KB por archivo. Primero validar/vista previa y después confirmar. El servidor vuelve a validar todo al crear: un preview no reserva stock. En errores parciales, reintentar el mismo archivo conserva las ventas ya guardadas. La clave deriva de `channel + externalId`; cambiar el contenido de un ID ya importado produce conflicto y no crea otro pedido. Para una corrección, anular/ajustar el registro original mediante el flujo normal; no inventar un ID nuevo para la misma venta.

Esta importación registra pedidos a precios y comisiones actuales y reserva inventario. No usar para reconstruir un histórico ya cobrado o consumido sin una migración específica que respete snapshots y conciliación.
