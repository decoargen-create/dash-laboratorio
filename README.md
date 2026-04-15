# Laboratorio Viora

Panel interno para la gestión del laboratorio: órdenes de producción, clientes, productos, comisiones de mentores y pagos a proveedores.

## Características

- **Dashboard** con resumen por período, listado editable de órdenes, filtros por fecha, estado, búsqueda libre y toggle de incidencias.
- **Pipeline de estados**: Pendiente Cotización → Cotizado → Abonado → En Producción → Listo para enviar → Despachado.
- **Panel de pagos por orden**: cuatro rubros editables (contenido, envase/pote, etiqueta, comisión mentor) con estado, monto, fecha, proveedor y nota.
- **Panel de cobros del cliente** con plan de cuotas y progreso.
- **CRM de clientes** con teléfono, domicilio de despacho, asignación de mentor y paneles expandibles con su historial de órdenes.
- **Catálogo de productos** con 3 costos por unidad + fórmula de ingredientes editable vía popover.
- **Sección Mentores** con ventas referidas y **porcentaje de comisión configurable** por mentor.
- **Comisiones** calculadas sobre el profit (no sobre el monto total).
- **Modo oscuro** con persistencia en `localStorage`.
- **Mini-forms** para crear clientes y productos al vuelo desde el registro de una venta.
- **Command palette** (⌘K / Ctrl+K) para navegar y ejecutar acciones rápido.
- **Chatbot con IA** (Claude Haiku 4.5) en landing y panel, con contexto del negocio.
- **Tool-use**: desde el chatbot del panel el admin puede pedir crear clientes, productos, órdenes, cambiar estados, registrar cobros o marcar incidencias — Claude ejecuta las acciones directamente.
- **PWA**: la app se instala como aplicación nativa (Android, iOS, Desktop) con manifest, service worker y cache de fuentes.
- **Export / Import CSV** + backup JSON completo de la base.
- **Landing pública** con animaciones y sección de productos.

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

Vite arranca en `http://localhost:5173` (o el próximo puerto libre). En modo dev, el plugin `apiDevPlugin` en `vite.config.js` mapea `/api/<nombre>` a `api/<nombre>.js`, así los endpoints del chatbot y de insights funcionan sin `vercel dev`.

## Build

```bash
npm run build       # genera dist/
npm run preview     # sirve dist/ para testing local
```

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

| Variable | Obligatoria | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (si querés IA) | Usada por `api/chat.js`, `api/insights.js`, `api/analytics.js` |
| `AUTH_SECRET` | Sí (si querés login por email) | Firma los tokens de magic link y sesión. Generar con `openssl rand -hex 32` |
| `AUTH_ADMIN_EMAILS` | Opcional | Lista CSV de emails que van a entrar como admin. El resto cae en rol 'mentor' |
| `AUTH_ALLOWED_EMAILS` | Opcional (recomendada) | Whitelist CSV. Si queda vacía, cualquier email puede pedir magic link |
| `APP_URL` | Opcional | URL pública del sitio para el link del email. Si no se setea, se usa el Origin |
| `RESEND_API_KEY` | Opcional | API key de Resend para enviar los emails. Sin ella, `api/auth` devuelve el link en la response (sólo dev/setup) |
| `AUTH_FROM` | Opcional | "From" de los emails. Default: `onboarding@resend.dev` |

El archivo `.env` está en `.gitignore` así que nunca se sube al repo.

## Login con magic link

El panel soporta login por email con magic link (sin password):

1. El usuario entra a `/acceso`, clickea "Ingresar con tu email".
2. `api/auth` genera un token firmado (HMAC-SHA256, TTL 15 min) y lo envía por Resend al email.
3. El link vuelve al mismo `/acceso?token=...`; el front lo canjea por una sesión firmada (TTL 7 días) que queda en `localStorage` bajo `viora-session`.
4. En los próximos boots, el front llama `POST /api/auth` con `action: 'me'` para validar la sesión antes de mostrar el panel.

El rol (admin / mentor) se resuelve server-side a partir de `AUTH_ADMIN_EMAILS`. Si `AUTH_ALLOWED_EMAILS` está seteado, los emails fuera de la lista reciben una respuesta "si está autorizado te mandamos el link" sin filtrar cuáles están adentro.

**Acceso demo**: si no querés configurar email (ej. para trabajar local), hay un botón "Acceso demo" en la pantalla de login que deja entrar con el selector de rol tradicional (admin con password `admin`, equipo Sofia / Mariano).

## Deploy a Vercel

El proyecto ya incluye un `vercel.json` con la configuración lista: framework Vite, serverless functions en `api/`, fallback SPA para rutas de React, y `maxDuration` extendida en los endpoints que llaman a Claude (streaming puede durar más de los 10 s default).

### Paso a paso

1. **Conectar el repo**: entrar a https://vercel.com/new, importar el repositorio de GitHub.
2. **Configuración**: Vercel detecta automáticamente Vite. No hace falta tocar build settings (los hereda de `vercel.json`).
3. **Variables de entorno**: en `Settings → Environment Variables`, agregar:
   - `ANTHROPIC_API_KEY` = tu key real (sacada de https://console.anthropic.com)
   Ponela en los 3 environments (Production, Preview, Development) para que funcione en branches.
4. **Deploy**: push a main o clickear *Deploy*. En 1 a 2 minutos queda live.

### Testing local del build de producción

```bash
npm run build
npm run preview
```

El `preview` **no** corre las serverless functions (para eso necesitás `vercel dev` con Vercel CLI). Para probar el chatbot en local, usá `npm run dev` que sí las mapea.

### Serverless functions

Los archivos en `api/*.js` son funciones Node de Vercel:

- `api/chat.js` — chatbot principal con streaming SSE y tool-use.
- `api/insights.js` — genera alertas críticas para el centro de notificaciones.
- `api/analytics.js` — reporte analítico con fortalezas, debilidades y recomendaciones.

Todos usan el SDK oficial `@anthropic-ai/sdk` y prompt caching para bajar costos.

## Chatbot con Claude

El panel y la landing incluyen un widget flotante. En modo **landing** responde preguntas comerciales. En modo **panel**:

- Recibe un snapshot del negocio (métricas, órdenes recientes, clientes, productos, mentores con sus IDs) para contestar con datos reales.
- Si el usuario es **admin**, habilita 6 tools para ejecutar acciones: `crear_cliente`, `crear_producto`, `crear_orden`, `cambiar_estado_orden`, `marcar_incidencia`, `registrar_cobro`. La ejecución real pasa por el reducer del front (fuente de verdad), el backend sólo orquesta.
- Para rol **equipo**: el chat es sólo consulta (sin tools).

## Instalar como PWA

En Chrome / Edge: ícono de instalar en la barra de direcciones. En iOS Safari: Compartir → Añadir a pantalla de inicio. En Android: se ofrece automáticamente al volver a visitar.

La app arranca directamente en `/acceso` cuando se abre como PWA (configurado en el manifest).

## Datos y persistencia

Todo el estado (products, clients, mentors, sales) vive en `localStorage` del navegador bajo la key `viora-state-v1`. Hay botones de export/import CSV por entidad en la sección **Datos**, y un botón de backup/restore JSON completo.

Para resetear a los datos de demo: menú de usuario (abajo a la izquierda) → "Reset demo data".

## Tecnologías

- React 18 + Vite 5
- Tailwind CSS 3
- Recharts
- Lucide React Icons
- Anthropic SDK (`@anthropic-ai/sdk`)
- `vite-plugin-pwa` (Workbox)
- Vercel Serverless Functions (Node)
