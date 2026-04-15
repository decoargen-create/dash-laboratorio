# Laboratorio Viora

Panel interno para la gestión del laboratorio: órdenes de producción, clientes, productos, comisiones de mentores y pagos a proveedores.

## Características

- **Dashboard** con resumen por período, listado editable de órdenes, filtros por fecha, estado, búsqueda libre y toggle de incidencias.
- **Pipeline de estados**: Pendiente Cotización → Cotizado → Abonado → En Producción → Listo para enviar → Despachado.
- **Panel de pagos por orden**: cuatro rubros editables (contenido, envase/pote, etiqueta, comisión mentor) con estado, monto, fecha, proveedor y nota.
- **CRM de clientes** con teléfono, domicilio de despacho, asignación de mentor y paneles expandibles con su historial de órdenes.
- **Catálogo de productos** con 3 costos por unidad y detalle de clientes que pidieron cada producto.
- **Sección Mentores** con ventas referidas y comisiones.
- **Modo oscuro** con persistencia en `localStorage`.
- **Mini-forms** para crear clientes y productos al vuelo desde el registro de una venta.

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

## Tecnologías

- React 18
- Vite
- Tailwind CSS
- Recharts
- Lucide React Icons
