# Guía: App de Meta + App Review para AdsLab (plataforma pública)

Objetivo: que **cualquier usuario** de AdsLab pueda hacer "Conectar con
Facebook" y ver sus campañas/métricas. Para eso Meta exige una app con
**Advanced Access** al permiso `ads_read`, lo que requiere **verificación
del negocio + App Review**.

El código ya está listo (OAuth multi-usuario, tokens cifrados, páginas de
privacidad y eliminación de datos). Esta guía cubre el trámite externo.

---

## Fase 0 — Quién puede hacerlo

Cualquier cuenta de Facebook **sin restricción de developer** (la del
titular está bloqueada → usar la de un socio de confianza mientras se
apela). La app después se asocia al Business Manager de la empresa y se
pueden agregar más admins.

## Fase 1 — Crear la app (10 min)

1. Entrar a https://developers.facebook.com → **My Apps → Create App**.
2. Tipo: **Business**. Nombre: `AdsLab` (o similar; no puede contener "FB"/"Meta").
3. En "Business portfolio", asociarla al Business Manager de la empresa
   (Natural VYA cosmetica) — esto es lo que después se verifica.
4. En el dashboard de la app → **App settings → Basic**:
   - App domains: `adslab-studio.vercel.app` (o el dominio final)
   - Privacy Policy URL: `https://adslab-studio.vercel.app/privacidad.html`
   - User data deletion → Data deletion instructions URL:
     `https://adslab-studio.vercel.app/eliminar-datos.html`
   - Category: Business and pages
   - Icon 1024×1024 (logo de AdsLab)
5. **Add product → Facebook Login for Business** → Settings:
   - Valid OAuth Redirect URIs: `https://adslab-studio.vercel.app/api/meta/callback`
   - Client OAuth login: ON · Web OAuth login: ON
6. Copiar **App ID** y **App Secret** (Settings → Basic).

## Fase 2 — Cargar credenciales en Vercel (5 min)

En Vercel → proyecto → Settings → Environment Variables (Production):

```
META_APP_ID     = <App ID>
META_APP_SECRET = <App Secret>
```

(`AUTH_SECRET` ya debería existir; si no, generar uno: `openssl rand -hex 32`.)

Redeploy. A partir de acá el botón **"Conectar con Facebook"** aparece
solo en AdsLab → Meta Ads.

## Fase 3 — Probar en modo desarrollo (mismo día)

Con la app en modo desarrollo, SOLO cuentas con rol en la app pueden
conectar. Para probar y para los primeros colegas conocidos:

1. App dashboard → **App roles → Roles → Add People → Tester** →
   invitar por usuario de Facebook.
2. La persona acepta la invitación en developers.facebook.com/requests.
3. Ya puede usar "Conectar con Facebook" en AdsLab.

Esto sirve como beta privada mientras corre el review.

## Fase 4 — Verificación del negocio (1-5 días)

Business Manager → **Configuración del negocio → Centro de seguridad →
Verificación del negocio**. Piden:

- Razón social + documentación legal (constancia de CUIT/inscripción,
  que coincida EXACTO con el nombre del BM)
- Dominio web del negocio (sirve el de la plataforma)
- Teléfono/email verificable de la empresa

## Fase 5 — App Review de `ads_read` (5-14 días, a veces 1-2 idas y vueltas)

App dashboard → **App Review → Permissions and Features** → buscar
`ads_read` → **Request Advanced Access**. El formulario pide:

**1. "Tell us how you'll use this permission"** — texto sugerido (adaptar):

> AdsLab is a free marketing analytics platform. Users connect their own
> Meta ad accounts via Facebook Login to view their advertising campaigns
> and performance metrics (impressions, clicks, spend, CTR) inside a
> single dashboard, alongside the creative work they produce in the
> platform. We only READ campaign and ad-level insights of the ad
> accounts each user already owns or manages. We do not create, modify
> or publish ads. Access tokens are stored encrypted (AES-256-GCM)
> server-side and are never exposed to the browser. Users can disconnect
> at any time from the platform (token deleted immediately) or via our
> data deletion instructions page.

**2. Screencast (video de ~1-2 min)** mostrando el flujo real:
   - Login en AdsLab con un usuario de prueba
   - Ir a la sección Meta Ads → click "Conectar con Facebook"
   - Consent screen de Meta → aceptar
   - Volver a AdsLab → elegir cuenta → ver campañas y métricas
   - Mostrar el botón "Desconectar"
   - Grabar con la app en modo desarrollo usando una cuenta Tester.

**3. Instrucciones de prueba para el reviewer**: crearles un usuario demo
   de AdsLab (email+pass) y escribir los pasos (login → Meta Ads →
   Conectar con Facebook → ver campañas). El reviewer usa SU cuenta de
   Meta de prueba.

**Consejos para que apruebe a la primera:**
- Pedir SOLO `ads_read` (ya configurado así en el código). Cada permiso
  extra = más preguntas.
- Que el screencast muestre exactamente lo que dice el texto — ni más ni
  menos.
- La privacy policy y data deletion URLs deben cargar sin login (ya
  están: `/privacidad.html`, `/eliminar-datos.html`).
- Si rebota, leen literal: responder el punto exacto que marcan y
  re-someter (48-72h el re-review).

## Fase 6 — Live mode

Aprobado el review: App dashboard → toggle **App Mode: Live**. Desde ese
momento **cualquier usuario de AdsLab** puede conectar su Meta sin rol en
la app. Fin del trámite.

---

## Resumen de tiempos realistas

| Fase | Tiempo |
|---|---|
| Crear app + credenciales + probar con testers | 1 día |
| Verificación del negocio | 1-5 días |
| App Review (`ads_read`) | 5-14 días (+ posibles idas y vueltas) |
| **Total** | **~2-4 semanas** |

## Roadmap posterior (opcional)

- `ads_management` (crear/subir ads desde AdsLab en nombre de terceros):
  review separado, mucho más exigente. Encararlo solo cuando la feature
  exista y haya usuarios pidiéndola.
- Mientras corre el review, los usuarios "conocidos" entran como Testers
  (Fase 3) sin esperar nada.
