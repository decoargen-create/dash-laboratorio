# Meta App Review — Checklist

Lo que necesitás entregar a Meta para que apruebe los scopes `ads_management`, `business_management`, `pages_show_list`, `instagram_basic` y `read_insights` y permita onboarding abierto.

**Tiempo estimado**: 2-6 semanas calendario, generalmente con 1-2 rondas de "agregale tal cosa al video".

---

## 1. Pre-requisitos en la app Meta Developer

Entrar a `developers.facebook.com/apps/{{APP_ID}}` → **App Settings**.

- [ ] **App Icon**: PNG 1024×1024 (sin transparencia, fondo color sólido).
- [ ] **App Category**: "Business" (o la que aplique).
- [ ] **Privacy Policy URL**: `{{URL_PRODUCTO}}/legal/privacidad` — pública, sin login.
- [ ] **Terms of Service URL**: `{{URL_PRODUCTO}}/legal/tos` — pública, sin login.
- [ ] **Data Deletion Instructions URL**: `{{URL_PRODUCTO}}/legal/borrar-mis-datos` — pública. Explicá los 2 caminos (panel + Facebook callback).
- [ ] **Data Deletion Callback URL**: `{{URL_PRODUCTO}}/api/auth/meta-data-deletion` — endpoint live (ya implementado en este repo).
- [ ] **App Domains**: `{{HOST_DOMAIN}}`.
- [ ] **Site URL**: `{{URL_PRODUCTO}}`.
- [ ] **OAuth Redirect URIs**: `{{URL_PRODUCTO}}/api/meta/callback`.

## 2. Business Verification

- [ ] **Business Verification** del Business Manager dueño de la app (si todavía no lo verificaste). Pide:
  - Documento de habilitación legal del laboratorio (CUIT, constancia AFIP).
  - Comprobante de domicilio (factura de servicios reciente).
  - Sitio web del laboratorio funcional.
  - Email del dominio del laboratorio (no Gmail).

Tarda 1-3 días hábiles si los docs están bien.

## 3. App Review — request por scope

Por cada permiso/feature en **App Review → Permissions and Features**, click "Request":

### `ads_management`
- **Use case**: "Permite a usuarios de la plataforma `{{NOMBRE_PRODUCTO}}` automatizar la creación, gestión y reporting de campañas publicitarias en sus propias cuentas de Meta Ads, basados en archivos creativos que viven en su Google Drive personal. Cada usuario solo puede operar sobre las cuentas publicitarias a las que ya tiene acceso administrativo dentro de su Business Manager."
- **Demonstration video**: ver sección 4.
- **Step-by-step instructions for reviewer**: incluir credenciales de un usuario de prueba dedicado para que el reviewer pueda loguearse y ver el flow completo.

### `business_management`
- **Use case**: "Lectura de la lista de Business Managers y cuentas publicitarias del usuario para que pueda elegir cuál asociar a su automatización en el panel."

### `pages_show_list`
- **Use case**: "Lectura de la lista de Páginas asociadas al Business Manager del usuario para que pueda elegir cuál asociar a sus campañas (campo `page_id`)."

### `instagram_basic`
- **Use case**: "Identificación de la cuenta de Instagram Business vinculada a la Página, requerido por Meta para crear ads que aparezcan en placements de Instagram (Reels, Feed)."

### `read_insights`
- **Use case**: "Lectura de métricas de las campañas creadas por la plataforma para mostrar al usuario el rendimiento (CTR, ROAS, freq) directamente en el panel."

## 4. Demonstration Video

**Duración recomendada**: 3-5 minutos. **Idioma**: inglés (Meta lo prefiere, los reviewers son globales). Si no hablás inglés con fluidez, usá voiceover con script + subtítulos.

### Script sugerido

```
[0:00 - 0:30] Intro
- "Hi, this is a screencast of <NOMBRE_PRODUCTO>, a tool that helps
  small advertisers automate their Meta Ads campaign publishing
  workflow. Specifically, when they upload creatives to a Google
  Drive folder, the tool automatically detects new creatives and
  publishes them as Meta campaigns on a schedule."

[0:30 - 1:00] Mostrar landing y signup
- Ir a {{URL_PRODUCTO}}, mostrar la landing.
- Login como user de prueba.

[1:00 - 2:00] Conectar Meta
- Click "Connect Meta" en el panel.
- Mostrar consent screen de Meta — leer en voz los permisos pedidos
  y por qué cada uno.
- Volver al panel después del callback. Mostrar que aparece como
  "Connected" + email del user.

[2:00 - 2:45] Conectar Google Drive
- Click "Connect Google Drive".
- Mostrar consent screen de Google (drive scope).
- Volver al panel.

[2:45 - 4:00] Crear automation
- Form: cargar IDs de Meta (account, page, pixel, IG), elegir
  Drive folder root, agregar Discord webhook, presupuesto.
- Click "Save".
- Click "Test connection" → verde.
- Click "Run dry-run" → muestra qué se publicaría sin tocar Meta.

[4:00 - 4:45] Run real
- Click "Run now" (o esperar al próximo cron, en el video usar
  el botón manual).
- Ir a Meta Ads Manager → mostrar la campaña creada con sus ads.
- Mostrar en el panel el log de runs con timestamps + IDs.

[4:45 - 5:00] Outro
- "All these actions are tied to the user's own Meta account. The
  user is the advertiser; <NOMBRE_PRODUCTO> is the tool that
  executes their instructions. Thank you for reviewing."
```

**Subir el video** a YouTube (público o "unlisted" si no querés que lo encuentren) y pegar el link en el form de App Review.

## 5. Checklist final antes de submit

- [ ] App icon presente y razonable.
- [ ] Privacy Policy URL accesible sin login.
- [ ] ToS URL accesible sin login.
- [ ] Data Deletion Instructions URL accesible sin login.
- [ ] Data Deletion Callback URL responde 200 con `{ url, confirmation_code }` ante un POST con `signed_request` válido. Probar con curl:
  ```bash
  # Generar signed_request de prueba (requiere META_APP_SECRET):
  node -e "
    const crypto = require('crypto');
    const payload = Buffer.from(JSON.stringify({
      algorithm: 'HMAC-SHA256', user_id: '12345', issued_at: Date.now()/1000
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest('base64url');
    console.log(sig + '.' + payload);
  "
  # Pegar el output como signed_request en:
  curl -X POST {{URL_PRODUCTO}}/api/auth/meta-data-deletion \
    -d 'signed_request=<output>' \
    -H "Content-Type: application/x-www-form-urlencoded"
  ```
- [ ] OAuth flow funciona en producción (no solo en dev).
- [ ] User de prueba creado con AUTH_USERS y agregado como Tester en la app Meta.
- [ ] Video grabado, subido, link en el form.
- [ ] Cada permiso tiene su `Use case` escrito.
- [ ] Submit.

## 6. Después del submit

- Meta responde en 1-7 días hábiles con (a) approved, (b) rejected con feedback, o (c) "needs more info".
- Si rechazan: leer el feedback con calma — suelen pedir cosas específicas (más detalle en el video, agregar pasos, justificar mejor un scope). NO pelear, agregar lo que piden y resubmit.
- Una vez aprobada la app, la sacás de Development Mode → cualquier user puede loguearse sin estar pre-autorizado como Tester.

## 7. Mantenimiento post-aprobación

- **Tokens System User** (si los seguís usando para Cellu legacy): rotarlos cada 50 días.
- **Re-review**: si agregás scopes nuevos o cambiás materialmente el use case, hay que pedir re-review.
- **Compliance**: Meta hace audits periódicos. Mantener Privacy Policy y ToS actualizados.
