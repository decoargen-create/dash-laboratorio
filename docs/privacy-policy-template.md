# Política de Privacidad — `{{LABORATORIO_NOMBRE}}`

> **Template.** Reemplazá los marcadores `{{...}}` con tus datos reales antes de publicar. Esta versión cubre los datos que el panel maneja hoy. Si agregás funcionalidades, actualizá la sección correspondiente.

**Última actualización**: `{{FECHA_ULTIMA_ACTUALIZACION}}`

## 1. Quiénes somos

`{{LABORATORIO_NOMBRE}}`, con sede en `{{DIRECCION}}`, es el responsable del tratamiento de tus datos personales en relación con el uso de la plataforma `{{NOMBRE_PRODUCTO}}` (el "Servicio"), accesible en `{{URL_PRODUCTO}}`.

Para consultas sobre privacidad o ejercer tus derechos: `{{CONTACTO_EMAIL}}`.

## 2. Qué datos recolectamos

### 2.1. Datos que vos nos das directamente
- **Cuenta**: nombre de usuario, dirección de email, contraseña (almacenada como hash PBKDF2-SHA256, nunca en texto plano).
- **Configuración de automatizaciones**: IDs de tu cuenta publicitaria de Meta, Página de Facebook, Pixel, cuenta de Instagram, URL de producto, URL de webhook de Discord, presupuesto diario, plantilla de nombre de campaña.

### 2.2. Datos que obtenemos cuando conectás Meta
- **Access token long-lived** de tu sistema (~60 días) — guardado encriptado en reposo en Vercel KV.
- **ID de usuario de Facebook** y nombre público asociado al token.
- **Permisos** otorgados: `ads_management`, `business_management`, `pages_show_list`, `instagram_basic`, `read_insights`. Lo usamos exclusivamente para crear/leer campañas, anuncios y métricas de TUS cuentas publicitarias.

### 2.3. Datos que obtenemos cuando conectás Google
- **Access token y refresh token** de OAuth — guardados encriptados en Vercel KV.
- **Email y nombre** asociados a tu cuenta Google (de `userinfo`).
- **Permisos** otorgados: `drive` (leer + renombrar carpetas que contengan tus creativos), `openid email profile`. NO accedemos a otros servicios de Google.

### 2.4. Datos generados por el uso del Servicio
- **Logs de ejecución** de cada corrida del cron: timestamps, IDs de campañas/adsets/ads creados, errores. Retenidos por 90 días.
- **Logs de Vercel** (request/response, sin payloads sensibles): retenidos según la política de Vercel (default 1 día en Hobby, configurable en Pro).
- **Estado del publisher** (carpetas Drive ya publicadas, referencia del último ad usado para clonar): persistido en Vercel KV.

## 3. Para qué usamos tus datos

| Propósito | Datos involucrados | Base legal |
|---|---|---|
| Operar tu cuenta y autenticarte | Username, email, hash de contraseña | Cumplimiento de contrato |
| Ejecutar tus automatizaciones (publicar campañas) | Tokens Meta + Google, IDs configurados | Cumplimiento de contrato |
| Notificarte resultados (Discord webhook) | URL de webhook + datos del run | Cumplimiento de contrato |
| Diagnóstico y soporte | Logs de errores | Interés legítimo |
| Cumplir con obligaciones legales (data deletion, etc.) | Toda la información | Obligación legal |

**No vendemos ni compartimos** tus datos con terceros con fines comerciales. **No usamos** tus datos para entrenar modelos de IA. **No** rastreamos tu actividad fuera del Servicio.

## 4. Con quién compartimos datos

- **Vercel** (proveedor de hosting + KV): procesa los datos según [Privacy Policy de Vercel](https://vercel.com/legal/privacy-policy).
- **Meta** (cuando ejecutamos tus automatizaciones): los IDs y access tokens viajan a `graph.facebook.com` para crear campañas en TU cuenta.
- **Google** (cuando ejecutamos tus automatizaciones): el access token viaja a `googleapis.com` para acceder a TU Drive.
- **Discord** (cuando reportamos un run): el contenido del reporte viaja al webhook URL que vos configuraste.

No transferimos datos a terceros fuera de los necesarios para operar el Servicio.

## 5. Dónde se almacenan tus datos

Vercel KV (Upstash Redis) en la región `{{REGION_VERCEL}}` (default `iad1` — Virginia, EEUU). Si esto requiere transferencia internacional para tu jurisdicción, las cláusulas contractuales tipo de Vercel cubren la transferencia.

## 6. Cuánto tiempo guardamos tus datos

| Tipo | Retención |
|---|---|
| Cuenta + automatizaciones + tokens | Mientras la cuenta esté activa |
| Logs de ejecución | 90 días desde el run |
| Logs Vercel | Según política Vercel |
| Datos eliminados por solicitud | Borrado inmediato (idempotente) |

## 7. Tus derechos

Podés ejercer en cualquier momento, gratis:

- **Acceso**: pedir copia de tus datos (`{{CONTACTO_EMAIL}}`).
- **Rectificación**: corregir datos incorrectos desde el panel.
- **Supresión**: borrar tu cuenta + todos los datos asociados desde el panel ("Borrar cuenta") o vía `POST /api/auth/delete-account`. Borrado completo, idempotente, irreversible.
- **Oposición / limitación**: deshabilitar automations sin borrar la cuenta.
- **Portabilidad**: solicitar export JSON de tus datos a `{{CONTACTO_EMAIL}}`.
- **Retiro de consentimiento**: revocar conexión Meta o Google desde `myaccount.google.com/permissions` y `facebook.com/settings/?tab=applications`.

## 8. Cómo borrar tus datos

### 8.1. Desde el panel
1. Login en `{{URL_PRODUCTO}}/acceso`.
2. Sección "Mi cuenta" → "Borrar cuenta".
3. Confirmar.

El sistema borra:
- Todas tus automatizaciones y su histórico de runs.
- Tus tokens de Meta y Google (revocando en Google's side).
- Tus mappings internos.

Tu entry en `AUTH_USERS` (lista de usuarios habilitados) la administra el laboratorio manualmente — escribinos a `{{CONTACTO_EMAIL}}` si querés que también te demos de baja del login.

### 8.2. Desde Facebook (Data Deletion Request)
1. Entrar a `facebook.com/settings/?tab=applications`.
2. Buscar `{{NOMBRE_APP_META}}` → "Eliminar".
3. Click en "Enviar solicitud de eliminación de datos".

Meta nos envía un callback firmado HMAC y nosotros borramos tus datos automáticamente. Te devolvemos un `confirmation_code` que podés citar al soporte.

### 8.3. Desde Google
1. Entrar a `myaccount.google.com/permissions`.
2. Buscar `{{NOMBRE_APP_GOOGLE}}` → "Quitar acceso".

Esto invalida nuestro refresh_token. Nuestro sistema detecta `invalid_grant` en el próximo run y borra el record de KV automáticamente.

## 9. Seguridad

- HTTPS obligatorio en todas las comunicaciones.
- Contraseñas hasheadas con PBKDF2-SHA256 (100k iter).
- Sessions JWT-like firmadas con HMAC-SHA256, 7 días de validez.
- Tokens OAuth almacenados en Vercel KV (encriptado en reposo).
- Validación HMAC en todos los webhooks (Meta data deletion).
- Sin secrets ni tokens en logs de Vercel.

## 10. Cookies

El Servicio usa una cookie HttpOnly `viora-meta-session` para mantener tu sesión Meta conectada en el panel (después del flow OAuth). No usamos cookies de tracking ni de terceros.

## 11. Menores

El Servicio no está dirigido a menores de 18 años. Si descubrís que un menor tiene cuenta, escribinos a `{{CONTACTO_EMAIL}}` y la borramos.

## 12. Cambios a esta política

Si modificamos esta política de forma material, te avisamos por email al menos 15 días antes del cambio. Versiones anteriores quedan disponibles en `{{URL_PRODUCTO}}/legal/privacidad/historial`.

## 13. Contacto

Cualquier consulta o reclamo: **`{{CONTACTO_EMAIL}}`** o por correo a `{{DIRECCION}}`.

---

**Jurisdicción**: este Servicio se rige por las leyes de la República Argentina. La autoridad de control es la Agencia de Acceso a la Información Pública (AAIP) — `argentina.gob.ar/aaip`.
