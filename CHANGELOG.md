# Changelog — Marketing platform

Branch: `claude/enable-dark-mode-SaMgT` · 25 commits sobre `main`.

## TL;DR

Se construyó un pipeline end-to-end para intelligence creativa de DTC:

1. **Cargás producto + competidores** (sugerencia automática disponible).
2. **Conectás tu cuenta publicitaria de Meta** y la IA identifica cuáles ads
   son del producto analizado.
3. **Corrés el pipeline** → scrape de competencia, detección de ganadores con
   Vision + Whisper, detector de fatigue en tus propios ads, y generación
   de un listado continuo de renovaciones creativas.
4. **Cada idea viene con procedencia clara** (réplica de ganador / iteración
   de tu ad fatigando / diferenciación blue ocean / desde cero), variable a
   testear e hipótesis medible.
5. **Marcás las ideas que lanzás** y el sistema trae su performance real para
   contrastar hipótesis — cerrando el loop de aprendizaje.
6. **Todo se exporta** como brief .md listo para el diseñador/editor.

Stack: React 18 + Vite · Vercel Serverless · Claude Sonnet 4.6 (Vision + tool
use + adaptive thinking) · OpenAI Whisper · Apify (Meta Ad Library) · Meta
Marketing API.

---

## Nuevas secciones en la UI de Marketing

### Arranque (default al entrar)

Onboarding unificado en 4 cards que se van marcando verdes:

1. **Tu producto** — nombre + landing URL + descripción + **stage del prospect**
   (problem-aware / solution-aware / product-aware). El stage calibra el tipo
   de hook que va a generar la IA. Si el producto fue documentado (research
   doc + avatar + offer brief vía sección Documentación), se muestra un badge
   verde de confirmación. Si no, un warning con link directo a Documentación.
2. **Tu cuenta publicitaria (opcional)** — si Meta está conectado, lista tus
   cuentas activas. Al elegir una, carga los ads con insights 14d + fatigue
   detection automática. Botón **"Identificar ads del producto con IA"** que
   usa Claude para tagear cuáles son del producto actual (confidence high /
   medium / low con razón).
3. **Competidores** — lista manual con botón "Agregar a mano" y botón
   **"Sugerir con IA"** que busca en Meta Ad Library por keyword del producto
   y devuelve top-12 páginas con más ads activos + máx días corriendo.
4. **Correr pipeline** — botón grande + config colapsable:
   - Límite diario de ideas (default 15, reset medianoche Argentina).
   - Slider static/video con sugerencia automática basada en el promedio de
     tu competencia ("entre tus 5 competidores, 42% usa video → usar ese mix").
   - Primera corrida (bandeja vacía) genera hasta 40 con piso de calidad.

Durante el pipeline se muestra un **stepper en vivo en rioplatense**:

> 🚀 Arrancando · vamos a analizar 6 competidores
> 🔍 Buscando ads de Skinfinity · 23 ads, 4 ganadores
> 🧠 Analizando ganadores de Skinfinity · 3/3 analizados
> 💡 Generando ideas nuevas con IA · 14 ideas agregadas
> ✅ Listo · tenés análisis fresco + ideas nuevas en la Bandeja

Cada paso con ✓ verde al completar, spinner al correr, tiempo por paso.
Cancelable (respeta la iteración actual, no corta en medio de un fetch).

**Nudge diario**: si pasaron >24h del último pipeline run exitoso, banner
al tope con "Hace X horas que no corrés el pipeline. Lo ideal es correrlo
1 vez por día..." + botón "Correr ahora". No es cron automático — es un
prompt pasivo que respeta que el pipeline consume créditos.

### Bandeja de ideas

Listado continuo que se puebla automáticamente con cada corrida. Cada idea
es taggeada con su **procedencia** y **tipo**:

- 🔵 **Réplica** — inspirada en un ganador de la competencia.
- 🟡 **Iteración** — variación de un ad propio (con adId del base + razón
  específica de por qué iterarlo, ej: "CTR -28% últimos 14d con freq 4.2").
- 🟢 **Diferenciación** — ángulo blue ocean que ningún competidor usa.
- ✨ **Desde cero** — ángulo original basado en el avatar.

**Estados**: pendiente / en uso / usada / archivada. Counters arriba.
Filtros por tipo + estado + búsqueda por texto. Sort automático: pendientes
primero, recientes primero.

Por idea se muestra:

- Badges: tipo, estado, competidor/ad origen, variable a testear
  (🎣 hook / 🎨 visual / 🖱️ CTA / 🔀 formato / 📐 ángulo / 👥 audience /
  👤 prueba social / 💰 oferta / 🎛️ mix), y si el hook es similar a otra
  idea (flag ⚠ hook similar).
- Al expandir: ángulo, hook (destacado), pain point, copy sugerido, guión
  colapsado, bloque "¿Por qué iterar este ad?" (para iteraciones), bloque
  "Hipótesis a validar", notas editables inline, y — si la marcaste como
  lanzada con un adId real — bloque fucsia "🚀 Lanzada en Meta" con
  CTR / ROAS / CPA / thumb-stop rate / impressions / compras (ROAS con
  semáforo: ≥2 verde, ≥1 amber, <1 rojo).

**Export bulk a Markdown**: seleccionás ideas con checkbox, click
"Exportar brief .md" y descargás un archivo organizado por tipo con todo
lo que necesita el diseñador/editor para producir — título, origen,
ángulo, hook, pain point, copy, guión, variable a testear, hipótesis,
notas y link al ad original si aplica.

---

## Intelligence de competencia (Fase 2)

### Análisis profundo de ads ganadores

**Endpoint** `POST /api/marketing/deep-analyze` — toma un ad ganador y
devuelve insights estructurados:

- **Claude Vision** sobre la primera imagen del ad (pasa la URL directa,
  sin re-download en la serverless function).
- **Whisper (OpenAI)** sobre el primer video si existe. Chequea tamaño via
  HEAD antes de bajar (límite 25 MB de la API de Whisper). Los URLs de Meta
  CDN expiran en ~24h, por eso el análisis conviene hacerlo ASAP.
- **Claude Sonnet 4.6** con adaptive thinking sintetiza body + headline +
  transcripción + visual en JSON: `hooks`, `angle`, `triggers`, `audience`,
  `offers`, `cta`, `objections`, `copy_patterns`, `visual`, `why_it_works`.

**UI**:

- Botón "Profundizar" (violeta con ✨) en cada winner card de Competencia.
- Cache por adId dentro del competidor (`comp.adsAnalysis[adId]`) → persiste
  en localStorage, no re-analiza si ya lo hiciste.
- Si ya se analizó, badge "Analizado" que abre el modal cacheado.
- Modal con thumbnail del ad + body excerpt + badge del estado de
  transcripción + cada sección de insight + botón "Re-analizar" para forzar
  refresh.

### Criterio de ganadores mejorado

El criterio del user se mantiene: `daysRunning >= 17` OR `variantes >= 2`.
Pero el scoring interno distingue:

- **Winner fuerte** (🏆🔥 gradient amber): cumple ambos criterios O tiene
  ≥4 variantes. Señal fortísima que están escalando activamente.
- **Winner confirmado** (🏆 emerald): cumple al menos uno.

**Peso de variantes escalado**:

| Variantes | Puntos al score |
|---|---|
| 1 | +10 |
| 2-3 | +30 |
| 4+ | +60 |

Pocos competidores llegan a 4+ variantes si no están seguros del ganador.
El score anterior trataba 2 y 4 variantes como iguales.

### Sugerencia automática de competidores

**Endpoint** `POST /api/marketing/suggest-competitors` — dado un
`searchKeyword` (derivado del producto), busca en Meta Ad Library vía Apify,
agrupa los ads por `pageId` y devuelve top-12 páginas con más ads activos
+ su max `daysRunning`. En la UI aparecen como tarjetas con thumbnail +
nombre + N ads activos + máx días corriendo + botón "Agregar" + link al ad
de ejemplo. Filtra sugerencias que ya están en la lista.

---

## Intelligence de tus propios ads (Meta)

### Meta connect unificado

El banner de conexión con Meta vive ahora en el header de la plataforma
Marketing (visible en todas las secciones). Antes estaba solo en
Competencia. Tiene 3 estados: loading, conectado (pill verde con el nombre
del user), desconectado (CTA prominente explicando el valor: "leer tus
campañas activas y cruzarlas con la competencia"). `returnTo` dinámico
para volver a la misma sección post-OAuth.

### Selector de cuenta publicitaria

**Endpoints nuevos en el dispatcher `api/meta/[action].js`**:

- `GET /api/meta/ad-accounts` — lista cuentas publicitarias activas
  (`account_status=1`) con id, name, currency, timezone, business.
- `GET /api/meta/ads-with-insights?account_id=act_XXX` — trae ads activos
  con creative + 2 rangos de insights (recent + previous) + fatigue
  computada + campaign + adset targeting.

El user puede tener múltiples cuentas publicitarias. El selector en la
card Meta de Arranque deja elegir cuál usar para el producto actual.

### Matcher IA de ads del producto

**Endpoint** `POST /api/marketing/match-product-ads` — dado el producto
+ lista de ads de la cuenta, Claude identifica cuáles son DEL producto
actual (no otros productos de la misma marca). Devuelve matches con
confidence + razón:

- **high**: nombre del producto aparece literal en title/body/name.
- **medium**: overlap claro de keywords, ingredientes, contexto.
- **low**: match ambiguo pero plausible.
- Los que no matchean quedan fuera (no se incluyen).

Badge por ad en la UI con tooltip de la razón. Contador en el header de
la card Meta ("✓ 7 del producto"). Re-match automático ofrecido si
cambiaste el producto después.

### Detector de fatigue

**Fatigue status por ad** (computado al leer insights):

| Status | Criterio |
|---|---|
| 💀 **dying** | CTR cayó >40% O (>20% + freq overloaded) |
| 🔻 **fatiguing** | CTR cayó >20% O ROAS cayó >30% (audience decay) |
| 📈 **warming** | CTR bajó 5-20% pero spend subió (escala normal) |
| ✅ **healthy** | CTR estable o subiendo |
| 🆕 **new** | Datos insuficientes (<1000 imp en algún período) |

**Ajustes clave vs primera implementación:**

- **Ventana 14d vs 14d previos** (días -28 a -14), no 7d vs 7d. En DTC los
  creativos viven 60-90 días, 7d es ruido.
- **Mínimo 1.000 impressions por período** para ser estadísticamente
  significativo (antes: 100 — cualquier variación era ruido).
- **Freq threshold depende del audience segment**:
  - Prospecting (cold): quema con freq >4.
  - Retargeting (warm): tolera freq >6 (la audiencia ya te conoce).
- **Audience decay**: si ROAS cae >30% con CTR estable, se flaggea
  igual — detecta que los que clickean ya no compran.
- **`audienceSegment`** inferido del targeting (`custom_audiences` → warm).

### Loop de aprendizaje

**Flow**: marcás una idea como "usada" → prompt te pide el adId con el que
la lanzaste → se guarda en `idea.launchedAsAdId` → botón "Traer métricas"
en la card expandida → endpoint `/api/meta/ad-performance?ad_id=X` trae
lifetime + last_14d insights → se muestra grid 2×3 con CTR / ROAS / CPA /
thumb-stop / impressions / compras con semáforo en ROAS.

Esto cierra el loop: hipótesis original ("hook con dato numérico baja CPA
vs hook genérico") vs resultado real ("CPA bajó de $8 a $5 en 14d"). Sienta
base para agregaciones futuras ("iteraciones tienen ROAS promedio 2.3 vs
diferenciaciones 1.5 — la palanca de iteración es la que más está
funcionando").

---

## Generador multi-tipo de ideas creativas

**Endpoint** `POST /api/marketing/generate-ideas` — recibe todo el contexto
acumulado (producto + docs + análisis de ganadores + ideas existentes +
ads propios con fatigue) y devuelve ideas clasificadas en 4 tipos con
distribución dinámica según haya o no ads propios matcheados:

| Sin ads propios | Con ads propios |
|---|---|
| 30% réplica | 30% réplica |
| 30% diferenciación | 30% iteración |
| 40% desde cero | 20% diferenciación |
| | 20% desde cero |

**Shape obligatorio de cada idea** (validado via tool use, ver abajo):

- `titulo`, `tipo`, `angulo`, `painPoint`, `hook`, `copy`, `guion`, `formato`
- `razonamiento` — por qué esta idea es fuerte.
- `variableDeTesteo` — enum de 9 valores (hook / visual / cta / formato /
  angulo / audience / prueba_social / oferta / mix). Qué UNA cosa se está
  variando vs el baseline. Permite armar A/B coherentes.
- `testHipotesis` — hipótesis medible y accionable. Ej: *"el formato carrusel
  va a tener más thumb-stop que el video en cold"*.
- `iteracionBase` (solo iteraciones) — `{ adId, adNombre, razon }` con
  métrica concreta. Ej: *"CTR -28% con freq 4.2 — cambiamos hook manteniendo
  formato"*.

**Guión por formato** (el campo más detallado, es lo que el
diseñador/editor usa para producir sin preguntar):

- **Video**: beats numerados con timecodes ("Beat 1 (0-3s): primer plano
  del rostro con caption X..."), duración total (15s/30s/60s), tono de VO.
- **Static**: descripción de layout (headline arriba/centro, imagen hero,
  subcopy, CTA), paleta, mood, composición.
- **Carrusel**: slide-by-slide con hook en slide 1 y CTA en la última.

### Cantidad y mix configurable

- **Primera corrida** (bandeja vacía): sin cap duro, hasta 40 con piso de
  calidad ("CALIDAD > CANTIDAD" en el prompt — si solo tenés contexto
  sólido para 12 ideas, devolvé 12).
- **Corridas siguientes**: cap al límite diario configurable (default 15,
  reset medianoche Argentina).
- **Mix static/video** configurable con slider. Sugerencia automática basada
  en el promedio de la competencia analizada: *"Dato de tu competencia:
  entre 5 competidores con ads, 42% usa video (123 ads analizados)"* +
  botón "Usar mix de la competencia".

### Priorización de iteraciones sobre fatigando

El generator ordena los ads propios con fatigando/muriendo primero. El
system prompt los separa en 2 secciones (fatigando vs sanos) para que
Claude entienda prioridades — ver el bloque de razón de iteración en la
Bandeja.

### Diversidad de hooks

Se pide explícitamente variar arquetipos (pregunta retórica / dato
shocking / storytelling 1ra persona / antes-después / autoridad / micro-
agresión / instrucción / curiosidad) — mínimo 4 arquetipos distintos en
una batería. Safety net client-side: flag `hookDuplicado` si dos ideas
comparten las primeras 3 palabras significativas normalizadas. Badge
⚠ "hook similar" en la UI — no bloquea, el user decide.

### Adaptive thinking + tool use

- **`thinking: { type: 'adaptive' }`** habilitado — Claude razona sobre qué
  patrón de competencia aplicar, qué belief chain empujar, qué ad iterar.
  Mejora calidad a costo de ~15-30s más de latencia.
- **Tool use** con `tool_choice` forzado a `submit_ideas`. El API de
  Anthropic valida el schema (tipos, enums, required) — Claude no puede
  devolver JSON malformado. Antes parseábamos texto con regex para sacar
  `` ```json `` wrappers, se caía cada tanto.

### Modelo

`claude-sonnet-4-6` (con adaptive thinking). `max_tokens` dinámico:
500 + targetCount × 500, tope 16.000.

---

## Fixes críticos

### Bug: el generator nunca leía el research doc

Marketing.jsx guarda los docs en `producto.docs.{research, avatar,
offerBrief, beliefs, resumenEjecutivo}`. El endpoint buscaba en
`producto.research` (path plano). Resultado: todas las ideas se generaban
**ciegas** al avatar aunque el user hubiera corrido el pipeline de
Documentación. Fix: lee de `docs.*` con fallback al path plano, y pasa el
**texto completo** (no un snippet de 2.000 chars — Sonnet 4.6 tiene 1M de
contexto, cortar tira información crítica).

Ahora también incluye `beliefs` (antes ignorado por completo): cada idea
apalanca una de las 6 creencias del método E5. UI: badge verde "Research
doc cargado" o warning amber con link a Documentación si falta.

### Bug: `costoMensual` de GastosStack ignoraba el estimado mensual

Cuando se creaba un servicio variable sin llenar "gasto real", el
`handleAdd` guardaba `gastoVariable=0` y después `costoMensual` lo tomaba
literal, ignorando `estimadoMensual`. Fix: si `gastoVariable` es 0 o
vacío, cae al estimado (que era la intención original).

### Dark mode flash prevention

Script inline en `index.html` que lee localStorage (o `prefers-color-scheme`
del sistema si no hay preferencia guardada) y aplica la clase `dark` al
`<html>` antes de que React monte. Elimina el parpadeo de tema claro que
se veía brevemente al cargar cuando el user estaba en modo oscuro.

---

## Módulo Gastos del stack (Marketing → Gastos)

Dashboard interno para monitorear servicios/APIs + suscripciones. Todo
persiste en localStorage (`viora-stack-costs-v1`).

- 5 servicios pre-cargados: Vercel, Anthropic Claude, OpenAI Whisper,
  Apify, Meta Ads.
- 5 categorías: hosting, IA/APIs, scraping, publicidad, otros.
- 3 tipos: fijo, variable, trial.
- Resumen de totales (fijo mensual / variable mensual / total mensual /
  total anual) + desglose por categoría con %.
- CRUD con edición inline. Links directos al billing dashboard de cada
  servicio. Conversión USD→ARS (tipo de cambio ~1.500).

---

## Endpoints nuevos y modificados

### API Marketing

| Método | Ruta | Función | `maxDuration` |
|---|---|---|---|
| POST | `/api/marketing/apify-ingest` | Scrapea Meta Ad Library via Apify (existente, sin cambios) | 300s |
| POST | `/api/marketing/deep-analyze` | Claude Vision + Whisper + síntesis (Fase 2) | 240s |
| POST | `/api/marketing/generate-ideas` | Generador multi-tipo con tool use + thinking | 180s |
| POST | `/api/marketing/match-product-ads` | Matcher IA de ads propios al producto | 60s |
| POST | `/api/marketing/suggest-competitors` | Sugerencia automática de competidores | 180s |

### API Meta (dispatcher `api/meta/[action].js`)

Se consolidaron 2 nuevas acciones + una tercera para performance individual:

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/meta/ad-accounts` | Lista cuentas publicitarias activas |
| GET | `/api/meta/ads-with-insights?account_id=...` | Ads con creative + 2 ventanas de insights + fatigue computada |
| GET | `/api/meta/ad-performance?ad_id=...` | Lifetime + last_14d insights de UN ad (loop de aprendizaje) |

**Métricas extraídas** por `parseInsights`:

- Básicas: `impressions`, `clicks`, `ctr`, `spend`, `cpc`, `cpm`, `reach`,
  `frequency`, `purchases`, `revenue`.
- Derivadas (calculadas nosotros): `roas` = revenue/spend, `cpa` =
  spend/purchases, `thumbStopRate` = video_3_sec_watched / impressions.

### API Meta OAuth (existentes, sin cambios)

`/api/meta/connect`, `/api/meta/callback`, `/api/meta/me`,
`/api/meta/disconnect` — todas en el mismo dispatcher.

### API existentes reusadas sin cambios

`/api/scrape-product`, `/api/marketing/generate` (pipeline de docs),
`/api/marketing/creatives`, `/api/agent-refine`.

---

## Componentes y archivos del frontend

### Componentes nuevos

| Archivo | Descripción |
|---|---|
| `src/Arranque.jsx` | Onboarding unificado + stepper rioplatense + runner del pipeline. |
| `src/Bandeja.jsx` | Listado continuo de ideas con filtros, checklist, export MD, performance real. |
| `src/GastosStack.jsx` | Dashboard de costos del stack. |
| `src/MetaConnectBanner.jsx` | Banner de conexión Meta para el header de Marketing. |
| `src/bandejaStore.js` | Store + helpers: `addIdea` con dedupe, `addGeneratedIdeas`, `ideaFromDeepAnalysis`, `countIdeasGeneratedToday`, `hookSignature`, catálogos TIPO_META / ESTADO_META / VARIABLE_META. |

### Componentes modificados

- `src/App.jsx` — sidebar reordenado en Marketing (Arranque → Bandeja →
  Competencia → Documentación → Gastos), render de MetaConnectBanner
  arriba de todas las secciones de Marketing, imports + title mappings.
- `src/Competencia.jsx` — botón "Profundizar" con modal de análisis
  defensivo, push automático de idea tipo "replica" a la Bandeja tras
  cada deep-analyze, badges Winner tiered, widget Meta removido
  (centralizado en el header).

### LocalStorage keys

| Key | Contenido |
|---|---|
| `dash-dark-mode` | Preferencia dark/light (existente). |
| `viora-marketing-productos-v1` | Productos + research docs (existente). |
| `viora-marketing-competidores-v1` | Competidores + ads scrapeados + adsAnalysis (modificado — se agregó adsAnalysis). |
| `viora-marketing-meta-account-v1` | Cuenta publicitaria seleccionada + ads cargados + productMatch. |
| `viora-marketing-bandeja-v1` | Lista de ideas. |
| `viora-marketing-gen-config-v1` | Config del generador (límite diario, mix static/video). |
| `viora-marketing-last-pipeline-run-v1` | Timestamp del último run exitoso (para el nudge diario). |
| `viora-stack-costs-v1` | Servicios y costos del stack. |

---

## Requisitos de configuración

### Env vars en Vercel

| Variable | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (deep-analyze, generator, matcher, chat, agentes). |
| `OPENAI_API_KEY` | Whisper (transcripción de videos en deep-analyze). |
| `APIFY_TOKEN` | Scraping de Meta Ad Library (apify-ingest, suggest-competitors). |
| `APIFY_ACTOR_ID` | Opcional — default `apify/facebook-ads-scraper`. |
| `META_APP_ID` / `META_APP_SECRET` | OAuth con Meta para leer insights. |
| `AUTH_SECRET` / `AUTH_USERS` | Login (existente). |

Endpoint `/api/diag` chequea el estado de cada env var + formato esperado
y te da un summary en JSON para debug sin abrir consola de Vercel.

### Modelo usado

`claude-sonnet-4-6` en deep-analyze, generate-ideas y match-product-ads.
Prompt caching activo en system prompts (`cache_control: ephemeral`).
Adaptive thinking en los 2 endpoints creativos.

---

## Commits (25 total, en orden cronológico)

```
969b7ac dark mode: aplicar tema antes del render para evitar flash
4abfa16 add src/GastosStack.jsx (standalone)
f374022 feat: Marketing · integrar GastosStack en sidebar + fix fallback estimado
03b4dca feat: Marketing · Fase 2 — análisis profundo de ads ganadores
6e7bd38 polish: Modal de análisis profundo — preview + fallbacks defensivos
269b76c feat: Marketing · Meta connect unificado en el header
3af947d feat: Marketing · Arranque (onboarding unificado + stepper rioplatense)
ba5112c feat: Marketing · Bandeja de ideas (lista continua de renovaciones)
25cae64 feat: Marketing · generador multi-tipo de ideas creativas
68128c8 feat: Meta · selector de cuenta publicitaria + lectura de ads activos
ced3f7a feat: Marketing · matcher IA de ads propios + generación de iteraciones
3255086 feat: Marketing · sugerencia automática de competidores
f980df1 feat: Bandeja · export de brief a Markdown con multi-select
0669808 feat: Generador · sin cap fijo + límite diario + mix calibrado con competencia
e89d2ba feat: detector de fatigue + iteraciones contextualizadas + nudge diario
0dc34b3 fix: generador ahora sí lee el research doc del producto
af41eaa fix: fatigue detection robusto — ventana 14d/28d + ROAS + CPA + thumb-stop
6252448 feat: activar adaptive thinking en generator + deep-analyze
3ba3a39 feat: cada idea declara variable de testeo + hipótesis medible
586b05e feat: loop de aprendizaje — Bandeja → ad lanzado → performance real
900776f feat: scoring de ganadores con tier + peso extra para 4+ variantes
836f78c feat: lectura a nivel campaign + fatigue ajustada por audience segment
255e574 feat: diversidad de hooks — instrucción fuerte + flag cliente
43a7a49 feat: stage del producto (problem/solution/product-aware) para hooks
1b4b1be refactor: generator con tool use para structured output garantizado
```

## Auditoría expert-review aplicada (13 mejoras)

Al final del desarrollo se hizo un pase de auditoría crítica desde 3
sombreros (marketing DTC, testing, Meta Ads expert) que identificó 15
mejoras. Se aplicaron 13 en commits dedicados:

- **Crítico**: research doc no se estaba usando (path mal), fatigue con
  ventana muy corta, sin ROAS/CPA calculados, sin thumb-stop rate.
- **Alto valor**: variable de testeo + hipótesis por idea, loop de
  aprendizaje Bandeja→launched→performance, stage del producto,
  diversidad de hooks, scoring con tier, audience segment en fatigue.
- **Robustez**: adaptive thinking, tool use para structured output.

Ver commits `0dc34b3` en adelante para detalle de cada uno.

---

## Qué queda para siguientes iteraciones

- **Cron automático** del pipeline (hoy es nudge pasivo cuando pasan >24h).
- **Agregaciones de performance** en la Bandeja: "iteraciones tienen ROAS
  promedio 2.3 vs diferenciaciones 1.5 — la palanca está funcionando".
- **Feedback al generator**: usar la performance real de ideas lanzadas
  para recalibrar el próximo batch ("las réplicas del competidor X dieron
  CTR por debajo del esperado, considerá otro approach").
- **Generación de imagen** (Midjourney/DALL-E/Nano Banana) para static ads
  — hoy solo describimos el layout, no lo generamos.
- **Lectura por objetivo de campaña**: hoy leemos `objective` pero no lo
  usamos para ajustar benchmarks. Un ad de `OUTCOME_TRAFFIC` vs
  `OUTCOME_SALES` tiene expectativas muy distintas.
- **Detector de hook rate decay por creative**: el thumb-stop rate ya lo
  traemos, falta trendarlo.
