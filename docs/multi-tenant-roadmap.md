# Multi-Tenant Roadmap — Meta Ads Publisher

Plan para abrir el publisher a colegas con onboarding self-service.

## Estado actual (single-tenant)

- `api/marketing/meta-ads-publisher.js` lee config de env vars (Cellu).
- KV key singleton `meta_ads_publisher:state`.
- Drive vía Service Account compartido a un solo folder.
- Cron único 4×/día.
- Auth del laboratorio: `AUTH_USERS` env var (admin-managed, sin signup).

## Estado objetivo (multi-tenant abierto)

- Cada colega se loguea, conecta su Meta y su Drive vía OAuth, configura una "automation" desde el panel, y queda corriendo.
- Una sola cron itera todas las automations enabled.
- State KV namespaceado por automation.
- UI con form, lista, log, toggles enable/disable.
- App de Meta con App Review aprobado para `ads_management`.
- App de Google con OAuth Drive verificada.

---

## Decisiones tomadas

| Decisión | Opción elegida | Por qué |
|---|---|---|
| Storage automations + state | Vercel KV | Ya está. Postgres sería más limpio para queries pero KV alcanza con índices manuales. Si escala mal, migramos. |
| Identidad de tenant | `username` o `email` de la session JWT existente | Cero cambios al auth actual. AUTH_USERS sigue funcionando para users admin. |
| Signup self-service | Magic link (ya existe en `api/auth.js`, con `AUTH_ALLOWED_EMAILS` vacía permite cualquiera) | Cero código nuevo de auth. La primera vez que un email pide link y verifica, se identifica como tenant nuevo. |
| Drive OAuth scope | `https://www.googleapis.com/auth/drive.file` + Drive Picker | Es el scope que Google aprueba sin verification para casos legítimos. El Picker forza al user a elegir folders explícitamente — Google lo prefiere. |
| Backwards-compat con Cellu | El handler legacy sigue corriendo si no hay automations en KV. Cellu se migra a una automation con `tenantId='cellu-legacy'` cuando esté listo. | No quiero romper el flujo actual durante el desarrollo. |
| Cron schedule | Mantener `0 1,7,13,19 * * *` (mismo) | El schedule per-tenant es overkill por ahora. Todos corren a las mismas 4 horas; el orchestrator divide tiempo. |
| Compliance | Templates en `docs/`, el laboratorio los completa con datos reales antes de submit | Yo no soy abogado. |

## Decisiones pendientes (necesito tu confirmación)

| Decisión | Opciones | Default si no decís |
|---|---|---|
| Quién paga los costos cuando lo usen colegas (KV ops, Vercel function-seconds, ancho de banda Drive download) | (A) tu Vercel/KV. (B) límites blandos (max N automations por user, max N runs/día). (C) límites duros con bloqueo. | (B) — pongo defaults razonables (max 5 automations por user, max 20 runs/día/user) configurables vía env vars. |
| Naming convention de campañas | (A) hardcoded "[CBO Testeo {Tipo}]". (B) template editable por user. | (B) — campo `campaign_name_template` en la automation, default igual al hardcoded. |
| Daily budget | (A) hardcoded 4000 cents. (B) configurable por user, en su moneda de cuenta. | (B) — campo `daily_budget_cents` configurable, default 4000. |
| Validación de Meta token | (A) test al guardar form. (B) test al primer run. (C) ambos. | (C) — feedback inmediato en form + retry resiliente al run. |
| Error reporting al user | (A) solo al webhook Discord del user. (B) también email de fallback. (C) panel "últimos errores" en la UI. | (C) — log paginado en la UI + Discord, sin email (Resend cobra). |

Si todas las opciones (B/C) están bien, no me digas nada y avanzo con eso.

---

## Sprints

### Sprint 1 — Backend multi-tenant (fundacional)

**Fase 2 — Publisher con config inyectable**
- `lib/meta-publisher/config.js` — normaliza config de env (legacy) o de un objeto `automation`.
- Refactor `processFolder`, helpers Meta/Drive/Discord para no leer `process.env.*` directamente.
- Acepta `tenantConfig` como input, sin romper el modo legacy.

**Fase 3 — Schema + CRUD automations**
- `lib/automations/store.js` — KV ops:
  - Keys: `automation:{id}` (objeto), `automations:by-user:{userId}` (set de IDs), `automations:enabled` (set de IDs).
  - `listEnabled()`, `listByUser(userId)`, `get(id)`, `create()`, `update()`, `delete()`, `toggleEnabled()`.
- `api/automations/[action].js` — CRUD endpoints, todos requieren cookie `viora-session`.
- Validation: el user solo ve/edita las suyas. Admin ve todas.

**Fase 4 — Cron orchestrator**
- Handler nuevo: itera `listEnabled()`, por cada automation carga config, run, save.
- State key: `meta_ads_publisher:state:{automationId}`.
- Time budget: `maxDuration / N` por automation, con margen.
- Errores aislados por automation; reporte agregado al admin webhook.
- Modo legacy: si `listEnabled()` está vacía, ejecuta single-tenant viejo (Cellu sigue funcionando).

### Sprint 2 — Google OAuth Drive

**Fase 5 — Drive OAuth + token storage + Picker**
- App de Google Cloud (config: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`).
- `lib/google/oauth.js` — connect/callback/refresh token helpers.
- `api/google/[action].js` — connect, callback, disconnect, me, list-folders.
- KV: `google_token:{userId}` con `{access_token, refresh_token, expires_at, scopes}`.
- Refactor `lib/meta-publisher/drive.js`:
  - `getDriveClient({ userId, fallbackToServiceAccount })` busca token del user, refresh si vence.
  - Mantiene fallback al SA viejo para Cellu legacy.

### Sprint 3 — UI

**Fase 6 — AutomatizacionesTab**
- Componente nuevo `src/AutomatizacionesTab.jsx` (lazy load).
- Conexiones:
  - "Conectar Meta" → `/api/meta/connect`.
  - "Conectar Drive" → `/api/google/connect`.
- Form de creación con dropdowns:
  - Ad account: `/api/meta/ad-accounts` ya existe.
  - IG account: `/api/meta/ig-accounts` ya existe.
  - Drive root folder: Drive Picker (lib JS de Google) o `/api/google/list-folders`.
  - Discord webhook: input text con validación de URL.
  - Naming template, daily budget, schedule (read-only por ahora).
- Lista de mis automations + enable/disable + delete.
- "Run dry-run" botón → `/api/automations/run-dry-run?id=X` → muestra qué publicaría sin tocar Meta.
- Log paginado de runs (desde el state KV).
- Tab nuevo en App.jsx (1 línea de cambio).

### Sprint 4 — Compliance (en paralelo, mientras se codea Sprint 1-3)

**Fase 7 — Templates + endpoint delete-account**
- `docs/privacy-policy-template.md` — template de privacy policy con marcadores `{{LABORATORIO_NOMBRE}}`, `{{CONTACTO_EMAIL}}`, etc.
- `docs/terms-of-service-template.md` — idem.
- `docs/meta-app-review-checklist.md` — qué tiene que entregar el laboratorio a Meta.
- `docs/google-oauth-verification-checklist.md` — idem para Google.
- `api/auth/delete-account.js` — endpoint nuevo: borra user + todas sus automations + tokens Google + state KV. Requerido por Meta.
- `api/auth/data-deletion-callback.js` — endpoint que Meta llama cuando un user pide data deletion desde Facebook. Recibe `signed_request`, valida HMAC con `META_APP_SECRET`, dispara la misma lógica que delete-account.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Meta App Review rechaza scopes | Hacemos screencast de 4 min mostrando flow real de un colega configurando + corriendo. Justificamos cada scope textualmente. Backup plan: ofrecer modo "Tester only" hasta que pase review. |
| Google bloquea OAuth por verification | Usamos `drive.file` que tiene tolerancia de hasta 100 users sin verification. Si supera, banner "App not verified" hasta verificarlo (~2 semanas). |
| Cron timeout (5 min) si hay muchos tenants | Time budget por tenant. Si > 8 tenants y media tarda 30s, quedan 240s usables → 8 tenants OK. Si pasa, dividimos cron en 2 (`0 1,13` y `0 7,19` cada uno con la mitad). |
| KV rate limits / costos | KV free tier: 30k commands/mes. Por run de cron: ~5 commands/tenant. 4 runs/día × 30 días = 120 runs/mes/tenant. Con 50 tenants = 30k/mes — al límite. Si superamos, upgrade KV o migrate a Postgres. |
| Meta token de un user expira (60 días) y el cron falla silencioso | Endpoint cron envía a Discord del user "tu token expiró, reconectá Meta". Marca la automation como `error`. Email/notification opcional (más adelante). |
| User borra el folder Drive o cambia permisos | Run falla, reporta a Discord, marca `last_run_status: error` y skipea hasta próximo run. |
| Reference ad de un user se borra | Misma lógica: skip + warning en Discord. |
| User nuevo sin reference ad inicial | UI lo guía: "publica tu primera campaña a mano, después pegá el ad_id acá". O: feature futura "primer publicación: subir manualmente el spec base". |

---

## Timeline estimado

| Sprint | Días de código | Calendario realista |
|---|---|---|
| Sprint 1 — Backend multi-tenant | 2 | 3-4 días |
| Sprint 2 — Google OAuth | 1.5 | 2-3 días |
| Sprint 3 — UI | 2.5 | 4-5 días |
| Sprint 4 — Compliance (paralelo) | 1 | + 2-4 semanas calendario para reviews |
| **Total código** | **~7 días** | **~2 semanas** |
| **Total a producción abierta** | — | **~5-7 semanas** (incluye Meta App Review + Google Verification) |

Mientras se espera Meta App Review (4-6 semanas), el sistema funciona en modo "Testers only": vos invitás colegas como Testers del BM y ellos pueden usarlo sin restricciones. Eso te permite iterar UX con usuarios reales antes de abrir.

---

## Modo legacy ↔ multi-tenant

Durante todo el desarrollo, el cron sigue ejecutando Cellu single-tenant si no hay automations en KV. Apenas se cree la primera, el cron pasa a iterar tenants. Para migrar Cellu a una automation, vamos a:

1. Crear una automation con `tenantId='cellu-legacy'`, copiando los IDs de las env vars actuales.
2. Renombrar la KV key existente: `meta_ads_publisher:state` → `meta_ads_publisher:state:cellu-legacy`.
3. Confirmar 1 run completo desde la nueva ruta.
4. Borrar las env vars hardcoded (`META_AD_ACCOUNT_ID`, etc.) — quedan solo las globales (`META_APP_ID`, `META_APP_SECRET`, `IG_REFRESH_CRON_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, etc.).
