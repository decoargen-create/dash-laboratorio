# Meta ADS Publisher — Setup

Endpoint: `/api/marketing/meta-ads-publisher`
Schedule: `0 1,7,13,19 * * *` UTC → **04, 10, 16, 22 ART** (4 ejecuciones/día).

Cada run:
1. Lee carpetas de Drive del mes corriente (autodetecta "Abril 2026" según hoy).
2. Detecta tandas nuevas (no listadas en el state KV y sin sufijo `PUBLICADO`).
3. Por cada tanda nueva publica una campaña Meta Ads (CBO Testeo) clonando el `object_story_spec` del último ad ACTIVE del mismo producto+tipo.
4. Renombra la carpeta Drive a `… PUBLICADO`.
5. Persiste IDs en Vercel KV.
6. Manda reporte a Discord (publique o no).

---

## 1. Generar Meta System User Token

1. Entrar a **Meta Business Manager** → **Configuración del negocio** → **Usuarios** → **Usuarios del sistema**.
2. Si no existe, crear uno con nombre `ads-publisher-cron` y rol **Admin**.
3. Asignar **Activos** al system user:
   - Cuenta publicitaria: `act_1081340700530914`
   - Página de Facebook: `851231051408666`
   - Pixel: `2470190366676204`
   - Cuenta de Instagram: `17841475096860247`
4. Botón **Generar token**, app de Meta Developer asociada al BM, marcar permisos:
   - `ads_management`
   - `business_management`
   - `pages_show_list`
   - `instagram_basic`
   - `read_insights`
5. **Token long-lived (~60 días)**. Guardarlo en `META_SYSTEM_ACCESS_TOKEN`.
6. ⏰ Setear recordatorio **a los 50 días** para regenerarlo (system user tokens NO refrescan solos).

---

## 2. Crear Google Service Account

1. **Google Cloud Console** → seleccionar proyecto (o crear uno).
2. **APIs & Services** → **Library** → habilitar **Google Drive API**.
3. **IAM & Admin** → **Service Accounts** → **+ Create Service Account**.
   - Nombre: `meta-ads-publisher`
   - Sin roles (no necesita IAM del proyecto, solo acceso al folder Drive).
4. En la SA creada → **Keys** → **Add Key** → **JSON** → descargar `sa.json`.
5. Compartir el folder root **"Campañas Claude Meta ADS"** (`1ozQ4Kz3QTgRkDJuKYvH5hqiz6WbAg0iV`) con el `client_email` del SA, rol **Editor** (necesita renombrar carpetas).
   - Drive UI → click derecho en el folder → **Compartir** → pegar el email del SA.
6. Convertir el JSON a una sola línea para meter en env var:
   ```bash
   jq -c . sa.json
   ```
   Copiar el output y pegarlo en `GOOGLE_SA_JSON`.

---

## 3. Configurar Vercel KV

1. Ir al proyecto en Vercel → **Storage** → **Create Database** → **KV**.
2. Nombre cualquiera (ej. `meta-ads-state`). Region: `iad1` (mismo que las functions).
3. **Connect to project** → marcar Production (y opcionalmente Preview/Dev).
4. Vercel inyecta automáticamente:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`
   - `KV_URL`

   No hace falta tocar nada más. La key `meta_ads_publisher:state` se crea sola en el primer run.

---

## 4. Cargar env vars en Vercel

**Project Settings → Environment Variables → Production** (también Preview si querés que el cron corra ahí).

| Variable | Valor |
|---|---|
| `META_SYSTEM_ACCESS_TOKEN` | (paso 1) |
| `META_AD_ACCOUNT_ID` | `act_1081340700530914` |
| `META_PAGE_ID` | `851231051408666` |
| `META_PIXEL_ID` | `2470190366676204` |
| `META_INSTAGRAM_USER_ID` | `17841475096860247` |
| `META_PRODUCT_LINK` | `https://cellu-arg.com/products/probioticos` |
| `GOOGLE_SA_JSON` | (paso 2, single line) |
| `DRIVE_ROOT_FOLDER_ID` | `1ozQ4Kz3QTgRkDJuKYvH5hqiz6WbAg0iV` |
| `META_PUBLISHER_DISCORD_WEBHOOK` | webhook URL |
| `IG_REFRESH_CRON_SECRET` | reusar el ya configurado, o `openssl rand -hex 32` |

`KV_REST_API_*` se inyectan solas (paso 3).

---

## 5. Pre-cargar el estado inicial (CRÍTICO antes del primer run)

> ⚠️ El publisher clona el `object_story_spec` del ad de referencia. La referencia se busca en el **log del state KV** (último ad con mismo `product` + `source` y `status: ACTIVE`). En la primera ejecución el log está vacío y todas las carpetas se van a skipear con motivo `no hay reference ad ACTIVE en el log`.

Para arrancar, hay que sembrar el state con los `ad_id` de las campañas que ya publicaste manualmente. Hoy (2026-04-26) ya hay dos: **Probiotico Videos** y **Probiotico Estaticos**.

Desde la UI de Vercel KV (o con `vercel env pull` + un script), setear la key `meta_ads_publisher:state` con este shape mínimo:

```json
{
  "published_folders": [],
  "log": [
    {
      "run_at": "2026-04-26T12:00:00.000Z",
      "folder_id": "<folder_id de la tanda Probiotico Videos PUBLICADO>",
      "folder_name": "Probiotico Videos 26/4 PUBLICADO",
      "product": "Probiotico",
      "source": "Videos",
      "campaign_id": "<campaign_id real>",
      "adset_id": "<adset_id real>",
      "ad_ids": ["<ad_id real>"],
      "ad_details": [],
      "status": "ACTIVE"
    },
    {
      "run_at": "2026-04-26T12:00:00.000Z",
      "folder_id": "<folder_id Probiotico Estaticos PUBLICADO>",
      "folder_name": "Probiotico Estaticos 26/4 PUBLICADO",
      "product": "Probiotico",
      "source": "Estaticos",
      "campaign_id": "<campaign_id real>",
      "adset_id": "<adset_id real>",
      "ad_ids": ["<ad_id real>"],
      "ad_details": [],
      "status": "ACTIVE"
    }
  ],
  "last_run": null,
  "last_run_status": null
}
```

Cómo cargarlo: desde el dashboard de Vercel KV → **Browse Data** → key `meta_ads_publisher:state` → JSON. O con `npx @vercel/cli` y un script local que use `@vercel/kv`.

> ℹ️ `published_folders` puede dejarse vacío: las dos carpetas ya tienen sufijo `PUBLICADO` en Drive, así que no se van a re-publicar. La idempotencia funciona por nombre además de por ID.

> 🆕 Cuando aparezca un producto nuevo (Cepillo, Crema, Gomitas, …), hay que **publicarlo manualmente la primera vez** y luego sembrar la entry en `log`. Sin reference, el publisher no sabe qué `object_story_spec` clonar.

---

## 6. Deploy

```bash
npm install                # resuelve googleapis + @vercel/kv en lock
git add .
git commit -m "feat: meta ads publisher cron"
git push
```

Vercel auto-deploya. La primera vez instala las nuevas deps (~30 MB extra, googleapis es grande pero está dentro de los límites de Vercel functions).

---

## 7. Test manual

```bash
curl -X GET \
  -H "Authorization: Bearer $IG_REFRESH_CRON_SECRET" \
  https://laboratorio-viora.vercel.app/api/marketing/meta-ads-publisher
```

Response esperada (sin novedades):
```json
{ "ok": true, "published": 0, "skipped": [...], "candidates": 0 }
```

Si publicó algo, viene `published: N` con el detalle de cada campaña creada. Discord recibe el reporte al toque.

---

## 8. Verificar primer run automático

- Vercel Dashboard → **Deployments** → función `api/marketing/meta-ads-publisher` → **Logs** (filtrar últimas 24h).
- Vercel Dashboard → **Cron** → entrada `/api/marketing/meta-ads-publisher` → últimas ejecuciones (status code, duración).
- Discord: tiene que llegar mensaje a las 04, 10, 16 y 22 ART. Si no llega, problema de webhook o el endpoint tiró 5xx (revisar logs).

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| 401 al llamar manual | secret no matchea o no seteado | verificar `IG_REFRESH_CRON_SECRET` en Vercel |
| `Folder del mes no encontrado` | la carpeta `{Mes} {Año}` no existe en el root o el SA no tiene acceso | crear la carpeta del mes y compartirla con el SA |
| Todas las candidatas con `no hay reference ad ACTIVE en el log` | state KV vacío o sin entries del producto correspondiente | seguir paso 5 |
| `Reference ad <id> ilegible` | el ad de referencia se pausó o se borró en Meta | publicar uno nuevo a mano y actualizar el log |
| `Video … no llegó a 'ready' a tiempo` | video grande / Meta tarda en procesar | warning, NO error fatal — el ad se crea igual y suele activarse en minutos |
| `Image upload sin hash` | Meta rechazó la imagen (tamaño, formato) | logs de Vercel con el `fbtraceId` y reintentar |
| Cron no dispara | está deshabilitado en Vercel free tier o el path no matchea | confirmar plan Pro y `vercel.json` deployado |
| KV `loadState falló` | KV no linkeado al proyecto | repetir paso 3 |
| `daily_budget` distinto a 4000 | la cuenta usa otra moneda | el código asume USD ($40 = 4000 ¢). Si la cuenta cambia a ARS, ajustar `DAILY_BUDGET_CENTS` en el endpoint |

---

## Convenciones de nombres (no inventar)

- **Campaign**: `{Producto} {d/M} [CBO Testeo Videos]` o `[CBO Testeo Estaticos]`
- **Adset**: nombre exacto de la carpeta Drive de la tanda
- **Ad (Videos)**: nombre del archivo sin extensión
- **Ad (Estáticos)**: `Estatico {d/M} {N}` donde N viene de `Copia de N.png`
- **start_time**: día siguiente del run a las 05:00 ART
- **daily_budget**: 4000 centavos = $40 USD
- **Idempotencia**: folder Drive con `PUBLICADO` en el nombre **NUNCA** se re-procesa
