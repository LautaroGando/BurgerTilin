# Cobrar con Mercado Pago

La tienda usa Checkout Pro con Orders. El comprador paga en Mercado Pago y vuelve automáticamente al seguimiento privado de Burger Tilín, incluso si el pago queda pendiente o es rechazado. La cuenta que recibe el cobro es la cuenta vendedora asociada al Access Token.

El botón Mercado Pago aparece en la tienda cuando la API tiene configurada la integración. Los medios manuales se gestionan aparte en el administrador. Si la pasarela no entrega el enlace, el seguimiento muestra el pago pendiente y ofrece reintentar sobre el mismo pedido.

## Prueba local

1. Usá una base local de prueba para que el pedido del ensayo quede separado de tus ventas.
2. En el entorno de la API configurá `MP_TEST_MODE=true`, el `MP_ACCESS_TOKEN` de prueba, el `MP_SELLER_ID` de esa cuenta y `WEB_ORIGIN=http://127.0.0.1:3000`. Abrí la tienda con la misma dirección. El webhook es opcional en localhost. La API comprueba que las credenciales pertenezcan a una cuenta de prueba.
3. Hacé una [compra de prueba con tarjeta](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/integration-test/test-purchase-with-card?scope=prod) en incógnito. Al volver al seguimiento, la tienda consulta el estado a Mercado Pago. Comprobá que el pedido aparezca una sola vez en el tablero después de que se acredite el pago de prueba.

## Activar cobros reales

1. Entrá a [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app) con la cuenta argentina que va a recibir el dinero. Elegí tu aplicación de Checkout Pro, entrá a **Credenciales → Producción** y activá el ambiente productivo si todavía está pendiente. Copiá el **Access Token** productivo. Si lo compartiste, renová el par de credenciales desde **Más opciones → Renovar** antes de cargarlo. Checkout Pro redirige al sitio de Mercado Pago y esta tienda solo usa el Access Token en el servidor. [Activación oficial](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/go-to-production?scope=prod) · [Renovación de credenciales](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-payments/best-practices/credentials-best-practices/secure-credentials?scope=prod)
2. En la misma aplicación entrá a **Webhooks → Producción**. Pegá `https://www.burgertilin.com/api/webhooks/mercado-pago`, marcá **Order (Mercado Pago)**, guardá y copiá la **Firma secreta**. La firma se obtiene en esta pantalla. Si la compartiste, restablecela y usá la nueva. Si publicás con otro dominio, usá ese dominio tanto acá como en `WEB_ORIGIN`. [Configuración oficial](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications?scope=prod)
3. Cargá estas variables en **Vercel → Settings → Environment Variables**, seleccionando **Production**. Marcá el token, la firma y `CRON_SECRET` como **Sensitive**. Guardá los valores directamente en Vercel. [Variables de entorno](https://vercel.com/docs/environment-variables/managing-environment-variables)

| Variable            | Valor                                                               |
| ------------------- | ------------------------------------------------------------------- |
| `MP_ACCESS_TOKEN`   | Access Token de producción                                          |
| `MP_WEBHOOK_SECRET` | Firma secreta de Webhooks                                           |
| `MP_SELLER_ID`      | ID numérico de tu cuenta vendedora                                  |
| `WEB_ORIGIN`        | `https://www.burgertilin.com`                                       |
| `MP_TEST_MODE`      | `false`                                                             |
| `CRON_SECRET`       | Una clave aleatoria para la consulta automática de pagos pendientes |

Si te falta el ID de vendedor, podés consultarlo con el Access Token productivo. Este comando funciona en Windows PowerShell 5.1 y PowerShell 7. Oculta el token al pegarlo y muestra solo el ID. [Autenticación de Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/mp-point/resources/credentials)

```powershell
$tilinMpToken = Read-Host -Prompt 'Pegá el Access Token productivo' -AsSecureString
try {
  $tilinMpCredential = [System.Net.NetworkCredential]::new('', $tilinMpToken)
  (Invoke-RestMethod 'https://api.mercadolibre.com/users/me' -Headers @{
    Authorization = "Bearer $($tilinMpCredential.Password)"
  }).id
} finally {
  $tilinMpToken.Dispose()
  Remove-Variable tilinMpToken, tilinMpCredential -ErrorAction SilentlyContinue
}
```

Para generar `CRON_SECRET`, ejecutá `node -p "require('node:crypto').randomBytes(32).toString('hex')"` y copiá el resultado a la variable.

4. Publicá un nuevo despliegue de producción para que tome las variables. Revisá **Configuración → Medios de pago** en el administrador. En el checkout público tiene que aparecer **Mercado Pago**. Desde el panel del proveedor, usá **Simular notificación** para comprobar la URL y la firma con una orden accesible para esa aplicación.
5. Hacé un pedido controlado desde la tienda publicada con una cuenta compradora. Verificá que el seguimiento muestre **Cobrado**, que aparezca un solo pedido en cocina y que el cobro figure en la cuenta vendedora.

El servidor verifica la orden directamente con Mercado Pago al recibir una notificación y cuando el comprador abre el seguimiento. Comprueba el vendedor, la moneda, la referencia y el importe antes de registrar un cobro. Mientras el pago está pendiente, se reserva el stock y el pedido queda fuera de cocina. La ventana de pago es de 15 minutos. Los pagos que siguen en revisión conservan la reserva hasta que Mercado Pago confirme su resolución.

Registrá los reembolsos de estos cobros desde tu cuenta vendedora. El webhook refleja los reembolsos confirmados en el registro local. El efectivo de caja excluye estos cobros. `MP_FEE_BPS` es una estimación de comisión para los reportes (100 equivale al 1 %). Para la comisión real, usá la liquidación de Mercado Pago.

[Crear una orden de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order) · [Configurar notificaciones firmadas](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications)
