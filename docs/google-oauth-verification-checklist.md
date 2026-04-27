# Google OAuth Verification — Checklist

Si tu app de Google OAuth tiene **menos de 100 usuarios** activos, Google permite el flow con un banner "App not verified" en el consent screen (los users tienen que clickear "Continuar de todos modos"). Funcional pero feo.

Si vas a pasar de 100 users, o querés sacar el banner antes, hay que **Verification**.

**Tiempo**: 1-2 semanas si los docs están bien (Google es más liviano que Meta).

---

## 1. Pre-requisitos

Entrar a `console.cloud.google.com` → seleccionar el proyecto donde está la app OAuth → **APIs & Services** → **OAuth consent screen**.

- [ ] **App name**: `{{NOMBRE_PRODUCTO}}` — el mismo que mostraría el consent.
- [ ] **User support email**: `{{CONTACTO_EMAIL}}` (visible en el consent).
- [ ] **App logo**: PNG 120×120 px, fondo cuadrado.
- [ ] **App domain**: 
  - Application home page: `{{URL_PRODUCTO}}`
  - Application privacy policy: `{{URL_PRODUCTO}}/legal/privacidad`
  - Application terms of service: `{{URL_PRODUCTO}}/legal/tos`
- [ ] **Authorized domains**: `{{HOST_DOMAIN}}` (sin protocolo, sin paths).
- [ ] **Developer contact information**: tu email.
- [ ] **Scopes**:
  - `openid`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `https://www.googleapis.com/auth/drive` ⚠️ **scope sensible** — requiere justificación.

## 2. Justificar el scope sensible (`drive`)

El scope `drive` da acceso completo a Drive del user. Google lo considera **Restricted Scope** y pide:

- [ ] **Justification**: "Our app reads and renames folders that the user owns within their Google Drive. The user explicitly designates a 'root folder' through our UI; we never browse outside that folder. Folders are read to detect new creative assets uploaded by the user, and renamed (appending ' PUBLICADO') to mark them as already processed."
- [ ] **Demonstration video**: similar al de Meta, mostrando:
  1. Login en `{{URL_PRODUCTO}}`.
  2. Click "Connect Google Drive" → consent screen → vuelta al panel.
  3. Crear una automation → seleccionar root folder en Drive.
  4. Mostrar en Drive que el folder se renombra a "PUBLICADO" después del run.
  5. Mostrar que NO accedemos a otros folders.

Si quisieras evitar el scope sensible, podrías usar `drive.file` (acceso solo a archivos abiertos vía Drive Picker). Esto NO requiere Verification y permite onboarding inmediato — pero requiere implementar Drive Picker en el frontend.

> **Recomendación**: arrancá con `drive.file` + Picker en producción. Solo si necesitás el scope full por alguna feature específica, pedís verification.

## 3. App Verification

Una vez completados pre-requisitos + justificación:

1. **Submit for verification** en OAuth consent screen.
2. Google responde por email en 3-7 días hábiles.
3. Pueden pedir más documentación (cómo guardás los tokens, cómo borrás datos, etc.).

## 4. Independent Security Assessment (CASA)

Si pedís un scope **Restricted** y proyectás **>100 users**, Google además requiere un **Cloud Application Security Assessment (CASA)** hecho por un tercero certificado. Costo: USD 5k-15k. Solo aplica para uso de producción a escala.

**Para arrancar con colegas (~10-20 users)**, NO necesitás CASA. Con `drive.file` + Picker tampoco. Para pasar de 100 con `drive` full, sí.

## 5. Mantenimiento

- **Re-verification**: si cambiás scopes o uses cases, hay que re-verificar.
- **Refresh tokens**: Google los rota silenciosamente. Si tu app no los usa por más de 6 meses, los invalida.
- **Privacy Policy y ToS**: tienen que estar siempre online y matchear lo que la app hace.

---

## Apéndice — Migrar de `drive` a `drive.file` (recomendado)

Si querés evitar Verification y CASA, hay que cambiar al scope `drive.file` y usar Drive Picker.

**Cambios en código**:
1. `lib/google/oauth.js`: cambiar `GOOGLE_SCOPES` de `'.../auth/drive'` a `'.../auth/drive.file'`.
2. UI: agregar Drive Picker (`https://developers.google.com/picker`) para que el user elija explícitamente el folder root.
3. Cuando el user selecciona el folder con Picker, queda autorizado para ese folder y todos sus descendientes.

**Limitaciones**:
- No podemos listar folders del user "a ciegas" desde el endpoint `/api/google/list-folders` (perdemos esa funcionalidad — el Picker la reemplaza).
- Si el user borra o saca permisos al folder, hay que reconectarse.

Con `drive.file`, Google aprueba sin Verification para hasta 100 users y sin CASA para >100. Es el camino menos friccionado.
