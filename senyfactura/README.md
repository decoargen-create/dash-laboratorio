# SenyFactura — Plataforma SaaS de facturación electrónica

Portal multi-cliente donde cada usuario conecta sus canales de venta (Mercado Libre,
Shopify, Tienda Nube) + su CUIT de ARCA y factura sus ventas. Emite Factura A, B y C
con CAE real vía Afip SDK.

> Comparte el proyecto de Supabase `qlnfgjsjibwrkzgmwdgl` con el resto del ecosistema
> Senyfull. El aislamiento entre clientes lo garantiza **RLS por `owner_id = auth.uid()`**.

## Stack
- Vite + React 18 (sin TypeScript), CSS propio (sistema visual Seny, sin Tailwind)
- Supabase: Auth (email + password), Postgres con RLS, Edge Functions
- Facturación: edge function `facturar` → Afip SDK → ARCA (entorno `dev` por ahora)

## Correr local
```bash
cd senyfactura
npm install
npm run dev      # http://localhost:5174
npm run build    # genera dist/
```

## Arquitectura multi-cliente

Cada tabla `fact_*` tiene `owner_id uuid → auth.users`. Políticas RLS:
- **anon** (clave pública): acceso permisivo → la SenyFactura vieja single-tenant sigue viva.
- **authenticated** (usuarios del SaaS): solo ven/escriben filas con `owner_id = auth.uid()`.

Verificado: un usuario solo ve sus empresas; no puede insertar a nombre de otro (with_check).

La edge function `facturar` corre con service role (saltea RLS) pero:
- Lee el JWT del que llama y valida que sea dueño de la empresa (403 si no).
- Estampa `owner_id` en la factura, heredado de la empresa.

Los `access_token` de las tiendas nunca se exponen al cliente: se leen solo desde las
edge functions (service role). El front usa la vista `fact_tiendas_pub` (sin token, con
flag `conectada`).

## Estado
Fase 1 (cimientos):
- [x] Auth (registro / login) con aislamiento RLS por cliente
- [x] Alta de empresas (CUIT, régimen, punto de venta)
- [x] Facturación manual (A / B / C) con CAE, contra la edge function `facturar`
- [x] Listado de comprobantes emitidos

Fase 2 (facturación masiva automática — verificada 2026-07-11):
- [x] Cola `fact_pedidos` + bandeja "Ventas a facturar" con botón de facturación en lote
- [x] Motor `procesar-cola`: agarra pendientes, resuelve empresa, factura con freno y reintentos
- [x] Config por cliente (`fact_config`): modo **automático** vs **lote**, empresa/IVA por defecto
- [x] Cron cada 5 min (pg_cron) que factura solo a los clientes en modo automático

Fase 3 (integración Mercado Libre — código listo, falta configurar la app de ML):
- [x] Conexión por OAuth (`ml-connect` → ML → `ml-callback`), tokens guardados por cliente
- [x] Webhook `ml-webhook`: recibe la venta, refresca token si venció, y si está paga la mete en la cola
- [x] Botón "Conectar" en la pantalla Tiendas
- [ ] **Pendiente Lucas**: crear la app en Mercado Libre y cargar credenciales (ver abajo)
- [ ] Tienda Nube / Shopify: onboarding OAuth (hoy los webhooks existen pero cargan tokens a mano)
- [ ] Certificado ARCA por cliente para pasar a producción
- [ ] PDF con QR de ARCA + envío por mail

## Conectar Mercado Libre (setup, una sola vez)

1. Entrar a https://developers.mercadolibre.com.ar/ → **Crear aplicación**.
2. En **Redirect URI** poner exactamente:
   `https://qlnfgjsjibwrkzgmwdgl.supabase.co/functions/v1/ml-callback`
3. En **Notificaciones/Webhooks**, callback URL:
   `https://qlnfgjsjibwrkzgmwdgl.supabase.co/functions/v1/ml-webhook`
   y suscribir el topic **`orders_v2`**.
4. Copiar el **App ID (Client ID)** y el **Secret Key (Client Secret)** y guardarlos en Vault:
   ```sql
   select vault.create_secret('EL_CLIENT_ID', 'ML_CLIENT_ID');
   select vault.create_secret('EL_CLIENT_SECRET', 'ML_CLIENT_SECRET');
   ```
   (La edge function los lee vía la RPC `get_ml_creds()`, solo para service_role.)

Listo eso, el cliente entra a **Tiendas → Conectar** y autoriza su cuenta. Las ventas pagadas
caen solas en **Ventas a facturar**.

## Motor de facturación masiva

```
Venta pagada → (webhook) → fact_pedidos [pendiente] → procesar-cola → facturar → CAE → [facturado]
```

`procesar-cola` (edge function, verify_jwt off) se invoca de dos formas:
- **Cron** (header `x-cron-secret`, secreto en Vault): factura los pendientes de los clientes en modo `auto`.
- **App** (`Authorization` con el JWT del usuario): factura los pendientes de ESE cliente (botón "Facturar N pendientes").

Procesa de a `LOTE=50` con `PAUSA_MS=400` entre facturas (freno para ARCA) y hasta `MAX_INTENTOS=5`.
Resuelve la empresa de cada pedido así: `pedido.empresa_id` → tienda (plataforma+store_id) → `fact_config.empresa_default_id`.
Corre con service role; `facturar` confía en las llamadas con la service key (saltea el chequeo de dueño, que sí aplica a usuarios).

## Pendiente para producción
Hoy factura en **entorno de prueba de ARCA** (CUIT de test, `AFIP_ENV=dev`). Para real,
cada cliente necesita su propio certificado digital de ARCA cargado en Afip SDK, y setear
`AFIP_ENV=prod`. Ver el CLAUDE.md raíz para el detalle del backend compartido.
