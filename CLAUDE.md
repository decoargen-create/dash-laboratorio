# CLAUDE.md — Ecosistema Senyfull (SenyCalc + SenyFactura)

> **Nota sobre este repo**: este repositorio es `dash-laboratorio` (panel interno de marketing/laboratorio, ver README.md). Las apps SenyCalc y SenyFactura descriptas abajo NO viven acá — se deployan aparte en Netlify — pero comparten el mismo proyecto de Supabase. Desde acá lo relacionado es `src/DashboardSeny.jsx` y `api/seny-sheet.js`. En el Supabase compartido: las tablas de este repo son `marketing_*` / `profiles`; las de Senyfull son `senycalc_*` y `fact_*`. No cruzar.
>
> **SaaS SenyFactura (en construcción)**: la carpeta `senyfactura/` de este repo es el nuevo portal multi-cliente (Vite+React) donde cada cliente conecta sus tiendas + CUIT y factura sus ventas. Es un producto aparte del panel de marketing; se puede separar a su propio repo cuando se conecte a deploy. Ver `senyfactura/README.md`. Fase 1 (Auth + RLS por cliente + facturación manual A/B/C) y Fase 2 (facturación masiva automática: cola + motor `procesar-cola` + config auto/lote + cron cada 5 min) hechas y verificadas el 2026-07-11.

Contexto para Claude Code. Este documento resume la arquitectura, decisiones y pendientes de dos apps desarrolladas con Claude en claude.ai. El dueño es Lucas (Senydrop, Buenos Aires). Hablarle en español rioplatense informal.

## Qué hay construido

### 1. SenyCalc — Calculadora de rentabilidad ecommerce
- **Deploy**: https://delicate-pithivier-a428e2.netlify.app (Netlify Drop, manual)
- **Fuente**: carpeta `senycalc/` (Vite + React 18, sin TypeScript)
- Calcula rentabilidad por producto y por oferta (ej: 1 unidad vs 2x1), comparando **Monotributo vs Responsable Inscripto** con lógica de IVA argentina:
  - Cada costo (producto, insumos, envío, CPA, comisiones) tiene un flag de si viene con factura → suma crédito fiscal solo para RI
  - El costo del producto puede tener factura parcial (`ivaCostoPct`, típico 50%)
  - Comisiones separadas: Mercado Pago (con IVA) vs Shopify/Tienda Nube (sin IVA local)
  - "Beneficio fiscal" (`benefPct`, típico 50%): descuento sobre el IVA a abonar del RI. No aplica a sociedades ni a Mono
  - `% facturado` (`pctFact`): porción de la venta que se factura, solo afecta el débito fiscal del RI
  - Métricas clave: utilidad, margen, **CPA break-even (USD)** y **ROAS break-even** por régimen
- T.C. dólar: se trae automático de `https://dolarapi.com/v1/dolares/cripto` (venta), editable a mano
- Productos y ofertas persisten en Supabase (tablas `senycalc_productos`, `senycalc_ofertas`, columna `inputs` jsonb con todo el estado del formulario)

### 2. SenyFactura — Facturación electrónica ARCA multi-CUIT
- **Deploy**: https://unrivaled-paletas-8a7fa5.netlify.app (Netlify Drop, manual)
- **Fuente**: carpeta `senyfactura/` (mismo stack)
- Flujo: pedidos pagados de Tienda Nube/Shopify entran por webhook a una cola → se facturan con un click (o manual) → CAE de ARCA vía **Afip SDK** (https://docs.afipsdk.com)
- Regla de comprobante: empresa RI → Factura B (cbte_tipo 6, IVA 21% discriminado, neto = total/1.21) o **Factura A (cbte_tipo 1) si el receptor es RI** (body con `receptor_cond_iva: 1` + `doc_tipo: 80` + `doc_nro` = CUIT del receptor, validado 11 dígitos); empresa MONO → Factura C (cbte_tipo 11, todo neto, sin array Iva) siempre, nunca A/B
- `CondicionIVAReceptorId` sale de `receptor_cond_iva` (default 5, consumidor final); DocTipo 96 (DNI) si TN trae identificación, sino 99. Las 3 (A, B y C) probadas OK en dev con CAE el 2026-07-11
- **Modo actual: `dev`** (entorno de prueba de ARCA, usa CUIT de prueba 20409378472 y PtoVta 1). Pasa a real configurando el secret `AFIP_ENV=prod`

## Backend compartido (Supabase)

- Proyecto: `qlnfgjsjibwrkzgmwdgl` (URL https://qlnfgjsjibwrkzgmwdgl.supabase.co)
- Clave pública en `src/supabase.js` de cada app (publishable key, es pública por diseño)
- **OJO**: el proyecto también contiene tablas de OTRO sistema (marketing_*, profiles, etc.). No tocarlas. Las nuestras tienen prefijo `senycalc_` y `fact_`.

### Tablas
- `senycalc_productos` (nombre unique, inputs jsonb) / `senycalc_ofertas` (producto, nombre, inputs jsonb)
- `fact_empresas`: nombre, cuit (unique), regimen ('RI'|'MONO'), punto_venta
- `fact_tiendas`: empresa_id, plataforma ('tiendanube'|'shopify'), store_id, access_token — **SIN política RLS para anon** (los tokens solo los leen las edge functions con service role). Los tokens se cargan a mano desde el panel de Supabase.
- `fact_pedidos`: cola. unique(plataforma, store_id, pedido_num). estado: pendiente|facturado|omitido|error
- `fact_facturas`: cbte_tipo, punto_venta, cbte_nro, cae, cae_vto, imp_neto, imp_iva, environment ('dev'|'prod'), respuesta jsonb
- RLS: **multi-cliente desde 2026-07-11**. Cada tabla `fact_*` tiene `owner_id uuid → auth.users`. Políticas: permisivas para `anon` (app vieja single-tenant sigue viva con la clave pública) + scopeadas por `owner_id = auth.uid()` para `authenticated` (el SaaS nuevo). Verificado: aislamiento entre clientes + with_check contra suplantación. `fact_tiendas` sigue server-only (tokens); el front lee la vista `fact_tiendas_pub` (sin token, con flag `conectada`).

### Motor de facturación masiva (SaaS, 2026-07-11)
- `fact_config` (owner_id pk): `modo` ('auto'|'lote'), `empresa_default_id`, `cond_iva_default`. RLS por dueño.
- `fact_pedidos` sumó `receptor_cond_iva`, `intentos`, `ultimo_intento`.
- Edge function `procesar-cola` (verify_jwt off): motor. Cron (header `x-cron-secret` desde Vault) factura pendientes de clientes en modo `auto`; app (JWT de usuario) factura los del cliente (botón lote). Lote de 50, pausa 400ms, máx 5 intentos. Resuelve empresa: pedido → tienda → config default. Llama a `facturar` con la service key (que ahora confía en llamadas service-role y saltea el chequeo de dueño).
- Cron `pg_cron` `senyfactura-procesar-cola` cada 5 min (invoca procesar-cola vía `net.http_post` con el secreto de Vault). Secreto `CRON_SECRET` en Vault + RPC `get_cron_secret()` (service_role).
- Probado OK el 2026-07-11: 3 pedidos en cola (2 B + 1 A) facturados en masa con CAE en una corrida del motor.

### Edge Functions (deployadas)
- `facturar` (verify_jwt on): recibe `{pedido_id, empresa_id?}` o manual `{empresa_id, total}`. Llama Afip SDK: POST /api/v1/afip/auth → FECompUltimoAutorizado → FECAESolicitar. Guarda factura y actualiza pedido. Secrets que usa: `AFIP_SDK_TOKEN`, `AFIP_ENV` (default 'dev'). **El token de Afip SDK vive en Supabase Vault** (secret `AFIP_SDK_TOKEN`): la función lo lee vía RPC `public.get_afip_token()` (security definer, execute solo para service_role) como fallback si el env var no está seteado. Probada OK en dev el 2026-07-11: Factura C y B aprobadas con CAE (ver `fact_facturas` environment='dev'). La extensión `pg_net` está habilitada (sirve para invocar functions desde SQL).
- `tn-webhook` (verify_jwt off): recibe `{store_id, event, id}` de Tienda Nube, busca el pedido por API de TN (header `Authentication: bearer TOKEN` + User-Agent obligatorio) usando el token de `fact_tiendas`, upsertea en la cola solo si payment_status = paid
- `shopify-webhook` (verify_jwt off): recibe el pedido completo (topic orders/paid), identifica tienda por header `x-shopify-shop-domain`, valida HMAC si existe el secret `SHOPIFY_WEBHOOK_SECRET`
- **Mercado Libre (SaaS, 2026-07-11, código listo, falta que Lucas cree la app de ML)**: `ml-connect` (arranca OAuth, devuelve URL de autorización; guarda nonce en `ml_oauth_state`), `ml-callback` (canjea code por access/refresh token, guarda la tienda en `fact_tiendas`), `ml-webhook` (topic `orders_v2`: refresca token si venció, trae la orden, y si está paga la upsertea en `fact_pedidos`). `fact_tiendas` sumó `refresh_token` y `token_expira`. Credenciales `ML_CLIENT_ID`/`ML_CLIENT_SECRET` en Vault vía RPC `get_ml_creds()`. Redirect URI: `.../functions/v1/ml-callback`; webhook: `.../functions/v1/ml-webhook`.

## Diseño (sistema visual Seny)
Basado en el panel interno Senyfull: fondo #F6F7F8, tarjetas blancas borde #E7E9ED radius 12-14px, **amarillo #F7C325** como acento (botones primarios con texto oscuro, barrita vertical amarilla antes de títulos de sección), tabs tipo pill (activa negra), chips de estado soft (verde/amarillo/rojo), tipografías Archivo (títulos) + Inter (texto) + IBM Plex Mono (números, tabular). Verde/rojo reservados para semántica de plata. Todo el CSS está en `src/styles.css` (compartido entre ambas apps, mantener sincronizado).

## Convenciones
- Todo en español rioplatense (UI y mensajes)
- Formato moneda: `toLocaleString('es-AR')`, prefijos "$" y "U$"
- Los formularios guardan el estado completo en columnas `inputs` jsonb (permite recalcular ofertas viejas con lógica nueva)

## Pendientes (roadmap acordado)
1. **Setup deploy automático**: repo GitHub + Netlify conectado (hoy es drag & drop manual del dist/)
2. ~~SenyFactura: configurar `AFIP_SDK_TOKEN`, probar factura dev~~ ✅ hecho (2026-07-11, token en Vault). Falta: rotar el token antes de prod y setear `AFIP_ENV=prod`
3. Webhooks: registrar en TN (evento order/paid → https://qlnfgjsjibwrkzgmwdgl.supabase.co/functions/v1/tn-webhook) y Shopify (orders/paid → .../shopify-webhook); cargar tokens en `fact_tiendas`
4. PDF de factura con QR de ARCA + envío por mail al cliente
5. Notas de crédito (devoluciones), reporte mensual de IVA/ventas
6. Auth (Supabase Auth) para ambas apps antes de compartirlas fuera del equipo
7. SenyCalc: posible integración Meta Ads para comparar CPA real vs break-even; comparador de ofertas lado a lado; PWA instalable

## Cómo correr local
```
cd senyfactura   # o senycalc
npm install
npm run dev      # se ve en http://localhost:5173 con hot reload
npm run build    # genera dist/ para deploy
```
