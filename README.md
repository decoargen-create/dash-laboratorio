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
- **Chatbot con IA** (Claude) en landing y panel, con contexto del negocio.
- **Landing pública** minimalista con animaciones.

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Chatbot con Claude

El panel y la landing incluyen un widget flotante de chat que consume la API
de Anthropic (Claude) vía una serverless function en `api/chat.js`.

Para que funcione necesitás una API key de Anthropic:

1. Entrá a https://console.anthropic.com y creá una.
2. Configurala como variable de entorno `ANTHROPIC_API_KEY`.
   - **Local**: copiá `.env.example` a `.env` y pegala ahí.
   - **Vercel**: andá a Project Settings → Environment Variables y agregala.
3. En local corré `npm run dev` normalmente — el middleware de Vite mapea
   `/api/chat` a `api/chat.js`. En Vercel se deploya como serverless function
   automáticamente.

El chatbot usa prompt caching para bajar costos en conversaciones largas y
recibe un snapshot del estado del negocio (órdenes, clientes, métricas) para
responder con datos reales.

## Tecnologías

- React 18
- Vite
- Tailwind CSS
- Recharts
- Lucide React Icons
