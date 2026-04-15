import React, { useState, useReducer, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import {
  Menu, LogOut, Home, ShoppingCart, Package, Users, AlertCircle, CreditCard,
  UserCheck, TrendingUp, Plus, Filter, Eye, Edit2, Trash2, Calendar, DollarSign,
  Moon, Sun, ChevronDown, ChevronRight, Search, X, Command, Check, Bell,
  AlignJustify, LayoutGrid, Columns3
} from 'lucide-react';
import { VioraLogo, VioraMark } from './logo.jsx';
import LandingPage from './LandingPage.jsx';
import ChatbotWidget from './ChatbotWidget.jsx';
import { generateCSV, downloadCSV, parseCSV, toNumber, toBool } from './csv.js';

// Estados del pipeline de producción de una orden
export const ORDER_STATES = [
  'pendiente-cotizacion',
  'cotizado',
  'abonado',
  'en-produccion',
  'listo-enviar',
  'despachado',
];

export const ORDER_STATE_LABELS = {
  'pendiente-cotizacion': 'Pendiente Cotización',
  'cotizado': 'Cotizado',
  'abonado': 'Abonado',
  'en-produccion': 'En Producción',
  'listo-enviar': 'Listo para enviar',
  'despachado': 'Despachado',
};

// Clases tailwind para el chip de estado
export const ORDER_STATE_STYLES = {
  'pendiente-cotizacion': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  'cotizado': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'abonado': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  'en-produccion': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'listo-enviar': 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  'despachado': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

// Sample data
const INITIAL_STATE = {
  products: [
    { id: 1, nombre: 'Crema Hidratante', descripcion: 'Crema hidratante intensiva', costoContenido: 70, costoEnvase: 35, costoEtiqueta: 15, precioVenta: 450 },
    { id: 2, nombre: 'Sérum Vitamina C', descripcion: 'Sérum antioxidante', costoContenido: 110, costoEnvase: 50, costoEtiqueta: 20, precioVenta: 650 },
    { id: 3, nombre: 'Contorno de Ojos', descripcion: 'Contorno iluminador', costoContenido: 85, costoEnvase: 45, costoEtiqueta: 20, precioVenta: 550 },
    { id: 4, nombre: 'Limpiador Facial', descripcion: 'Limpiador suave', costoContenido: 50, costoEnvase: 30, costoEtiqueta: 10, precioVenta: 320 },
    { id: 5, nombre: 'Mascarilla Nutritiva', descripcion: 'Mascarilla reparadora', costoContenido: 65, costoEnvase: 30, costoEtiqueta: 15, precioVenta: 420 },
  ],
  clients: [
    { id: 1, nombre: 'Martina González', telefono: '11 2345-6789', domicilio: 'Av. Corrientes 1234, CABA', mentorId: 1, fechaAlta: '2024-01-15', totalCompras: 3, unidadesProducidas: 350 },
    { id: 2, nombre: 'Valentina López', telefono: '11 3000-1122', domicilio: 'Belgrano 456, Vicente López', mentorId: 2, fechaAlta: '2024-02-20', totalCompras: 5, unidadesProducidas: 600 },
    { id: 3, nombre: 'Carolina Fernández', telefono: '11 3456-7890', domicilio: 'San Martín 789, San Isidro', mentorId: 1, fechaAlta: '2024-01-10', totalCompras: 2, unidadesProducidas: 300 },
    { id: 4, nombre: 'Paula Rodríguez', telefono: '11 3111-2233', domicilio: 'Av. Rivadavia 2500, CABA', mentorId: 2, fechaAlta: '2024-03-05', totalCompras: 4, unidadesProducidas: 550 },
    { id: 5, nombre: 'Daniela Martínez', telefono: '11 4567-8901', domicilio: 'Sarmiento 345, Quilmes', mentorId: 1, fechaAlta: '2024-02-25', totalCompras: 1, unidadesProducidas: 300 },
    { id: 6, nombre: 'Sofía Pérez', telefono: '11 3444-5566', domicilio: 'Libertador 1800, CABA', mentorId: 2, fechaAlta: '2024-03-10', totalCompras: 6, unidadesProducidas: 900 },
    { id: 7, nombre: 'Lucía Sánchez', telefono: '11 5678-9012', domicilio: 'Mitre 567, Morón', mentorId: 1, fechaAlta: '2024-01-20', totalCompras: 2, unidadesProducidas: 200 },
    { id: 8, nombre: 'Isabel Gómez', telefono: '11 3666-7788', domicilio: 'Cabildo 900, CABA', mentorId: 2, fechaAlta: '2024-02-28', totalCompras: 3, unidadesProducidas: 400 },
  ],
  mentors: [
    { id: 1, nombre: 'Sofia', contacto: '11 9876-5432', fechaInicio: '2023-12-01', clientesAsignados: 4, porcentajeComision: 50, pagosRecibidos: [] },
    { id: 2, nombre: 'Mariano', contacto: '11 8765-4321', fechaInicio: '2023-12-15', clientesAsignados: 4, porcentajeComision: 50, pagosRecibidos: [] },
  ],
  sales: [
    { id: 1, fecha: '2024-02-15', clienteId: 1, productoId: 1, cantidad: 100, montoTotal: 45000, mentorId: 1, estadoComision: 'pagada', estado: 'despachado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 2, fecha: '2024-02-18', clienteId: 2, productoId: 2, cantidad: 150, montoTotal: 97500, mentorId: 2, estadoComision: 'pagada', estado: 'despachado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 3, fecha: '2024-02-22', clienteId: 3, productoId: 3, cantidad: 200, montoTotal: 110000, mentorId: 1, estadoComision: 'pendiente', estado: 'en-produccion', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 4, fecha: '2024-03-01', clienteId: 4, productoId: 1, cantidad: 100, montoTotal: 45000, mentorId: 2, estadoComision: 'pagada', estado: 'despachado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 5, fecha: '2024-03-05', clienteId: 5, productoId: 4, cantidad: 300, montoTotal: 96000, mentorId: 1, estadoComision: 'pendiente', estado: 'en-produccion', tieneIncidencia: true, incidenciaDetalle: 'Demora con proveedor de envases' },
    { id: 6, fecha: '2024-03-08', clienteId: 2, productoId: 1, cantidad: 100, montoTotal: 45000, mentorId: 2, estadoComision: 'pendiente', estado: 'abonado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 7, fecha: '2024-03-12', clienteId: 6, productoId: 2, cantidad: 150, montoTotal: 97500, mentorId: 2, estadoComision: 'pagada', estado: 'despachado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 8, fecha: '2024-03-15', clienteId: 1, productoId: 5, cantidad: 200, montoTotal: 84000, mentorId: 1, estadoComision: 'pendiente', estado: 'listo-enviar', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 9, fecha: '2024-03-18', clienteId: 4, productoId: 3, cantidad: 100, montoTotal: 55000, mentorId: 2, estadoComision: 'pagada', estado: 'despachado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 10, fecha: '2024-03-22', clienteId: 7, productoId: 1, cantidad: 100, montoTotal: 45000, mentorId: 1, estadoComision: 'pendiente', estado: 'cotizado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 11, fecha: '2024-04-02', clienteId: 3, productoId: 2, cantidad: 100, montoTotal: 65000, mentorId: 1, estadoComision: 'pendiente', estado: 'pendiente-cotizacion', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 12, fecha: '2024-04-05', clienteId: 6, productoId: 4, cantidad: 200, montoTotal: 64000, mentorId: 2, estadoComision: 'pendiente', estado: 'abonado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 13, fecha: '2024-04-08', clienteId: 2, productoId: 5, cantidad: 100, montoTotal: 42000, mentorId: 2, estadoComision: 'pendiente', estado: 'en-produccion', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 14, fecha: '2024-04-10', clienteId: 8, productoId: 3, cantidad: 150, montoTotal: 82500, mentorId: 2, estadoComision: 'pendiente', estado: 'cotizado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 15, fecha: '2024-04-12', clienteId: 4, productoId: 1, cantidad: 250, montoTotal: 112500, mentorId: 2, estadoComision: 'pendiente', estado: 'pendiente-cotizacion', tieneIncidencia: false, incidenciaDetalle: '' },
  ],
};

function appReducer(state, action) {
  switch (action.type) {
    case 'ADD_SALE':
      return { ...state, sales: [...state.sales, action.payload] };
    case 'ADD_CLIENT':
      return { ...state, clients: [...state.clients, action.payload] };
    case 'UPDATE_CLIENT':
      return {
        ...state,
        clients: state.clients.map(c => c.id === action.payload.id ? { ...c, ...action.payload } : c)
      };
    case 'UPDATE_MENTOR':
      return {
        ...state,
        mentors: state.mentors.map(m => m.id === action.payload.id ? { ...m, ...action.payload } : m)
      };
    case 'UPDATE_PRODUCT': {
      // payload: { id, patch: {...} }
      const { id, patch } = action.payload;
      return {
        ...state,
        products: state.products.map(p => p.id === id ? { ...p, ...patch } : p)
      };
    }
    case 'ADD_PRODUCT':
      return { ...state, products: [...state.products, action.payload] };
    case 'PAY_COMMISSIONS':
      return {
        ...state,
        sales: state.sales.map(s => action.payload.includes(s.id) ? { ...s, estadoComision: 'pagada' } : s)
      };
    case 'UPDATE_ORDER_STATE':
      return {
        ...state,
        sales: state.sales.map(s => s.id === action.payload.orderId ? { ...s, estado: action.payload.estado } : s)
      };
    case 'UPDATE_ORDER_INCIDENCIA':
      return {
        ...state,
        sales: state.sales.map(s => s.id === action.payload.orderId
          ? { ...s, tieneIncidencia: action.payload.tieneIncidencia, incidenciaDetalle: action.payload.incidenciaDetalle }
          : s)
      };
    case 'UPDATE_ORDER_PAYMENT': {
      const { orderId, rubro, data } = action.payload;
      return {
        ...state,
        sales: state.sales.map(s => {
          if (s.id !== orderId) return s;
          const existing = s.pagos || {};
          const merged = { ...existing, [rubro]: { ...(existing[rubro] || {}), ...data } };
          const updated = { ...s, pagos: merged };
          // Sincronizo estadoComision cuando se toca el rubro mentor para que
          // la sección Comisiones (que lee estadoComision) siga consistente.
          if (rubro === 'mentor' && data.estado !== undefined) {
            updated.estadoComision = data.estado === 'pagado' ? 'pagada' : 'pendiente';
          }
          return updated;
        })
      };
    }
    case 'BULK_REPLACE': {
      // payload: { entity: 'products' | 'clients' | 'mentors' | 'sales', data: [...] }
      // Reemplaza el array completo de una entidad. Usado por el import CSV
      // cuando el user elige 'Reemplazar todo'.
      const { entity, data } = action.payload;
      if (!['products', 'clients', 'mentors', 'sales'].includes(entity)) return state;
      return { ...state, [entity]: Array.isArray(data) ? data : [] };
    }
    case 'BULK_MERGE': {
      // payload: { entity, data } — agrega las filas nuevas al array existente
      // (concatenando). Usado por el import cuando el user elige 'Agregar al final'.
      const { entity, data } = action.payload;
      if (!['products', 'clients', 'mentors', 'sales'].includes(entity)) return state;
      const existing = state[entity] || [];
      const maxId = existing.reduce((m, it) => Math.max(m, it.id || 0), 0);
      const reIdd = (Array.isArray(data) ? data : []).map((row, i) => ({
        ...row,
        id: maxId + i + 1,
      }));
      return { ...state, [entity]: [...existing, ...reIdd] };
    }
    case 'UPDATE_ORDER': {
      // Acción genérica: patchea cualquier campo de una orden por id.
      // payload: { id, patch: {...} }
      return {
        ...state,
        sales: state.sales.map(s => s.id === action.payload.id ? { ...s, ...action.payload.patch } : s)
      };
    }
    default:
      return state;
  }
}

// Helpers de cálculo de costos y profit

// Devuelve los valores UNITARIOS efectivos de una orden. Si la orden tiene
// costsOverride, esos valores ganan; si no, caen a los del producto base.
// El precio de venta unitario se deriva de montoTotal/cantidad si hay montoTotal
// (porque ese es el precio realmente cobrado/cotizado), y fallback al producto.
export function getOrderEffectiveUnit(order, product) {
  const ov = order?.costsOverride || {};
  const cantidad = order?.cantidad || 1;
  const precioVentaUnit = order?.montoTotal != null && cantidad > 0
    ? (order.montoTotal / cantidad)
    : (product?.precioVenta || 0);

  // Modo "sin discriminar": si la orden tiene costoSinDesglosar (override
  // por orden) o el producto lo tiene como default, ese único número
  // pisa el desglose contenido/envase/etiqueta. Útil cuando el proveedor
  // pasa el costo final con todo y no tenemos breakdown.
  const flatOrder = order?.costoSinDesglosar;
  const flatProduct = product?.costoSinDesglosar;
  const flat = flatOrder != null && flatOrder !== ''
    ? parseFloat(flatOrder)
    : (flatProduct != null && flatProduct !== '' ? parseFloat(flatProduct) : null);
  if (flat != null && !Number.isNaN(flat) && flat >= 0) {
    return {
      costoContenido: flat,
      costoEnvase: 0,
      costoEtiqueta: 0,
      precioVenta: precioVentaUnit,
      isFlat: true,
    };
  }

  return {
    // Si la orden pisó el costo de contenido (override por orden), ese gana.
    // Si no, usamos el costo calculado por la fórmula del producto
    // (que cae a costoContenido plano si no hay fórmula).
    costoContenido: ov.contenido != null ? ov.contenido : getContenidoUnitCost(product),
    costoEnvase:    ov.envase    != null ? ov.envase    : (product?.costoEnvase    || 0),
    costoEtiqueta:  ov.etiqueta  != null ? ov.etiqueta  : (product?.costoEtiqueta  || 0),
    precioVenta:    precioVentaUnit,
    isFlat: false,
  };
}

// Costo unitario del contenido. Si el producto tiene fórmula (lista de
// ingredientes con { nombre, costo }), se usa la suma de esos costos.
// Si no hay fórmula, cae al campo plano costoContenido.
export function getContenidoUnitCost(product) {
  if (!product) return 0;
  if (Array.isArray(product.formula) && product.formula.length > 0) {
    return product.formula.reduce((s, i) => s + (parseFloat(i?.costo) || 0), 0);
  }
  return product.costoContenido || 0;
}

export function getProductUnitCost(product) {
  if (!product) return 0;
  return getContenidoUnitCost(product) + (product.costoEnvase || 0) + (product.costoEtiqueta || 0);
}

export function getOrderCosts(order, product) {
  const eff = getOrderEffectiveUnit(order, product);
  const unit = eff.costoContenido + eff.costoEnvase + eff.costoEtiqueta;
  const cantidad = order?.cantidad || 0;
  return {
    contenidoUnit: eff.costoContenido,
    envaseUnit: eff.costoEnvase,
    etiquetaUnit: eff.costoEtiqueta,
    costoUnit: unit,
    contenidoTotal: eff.costoContenido * cantidad,
    envaseTotal: eff.costoEnvase * cantidad,
    etiquetaTotal: eff.costoEtiqueta * cantidad,
    costoTotal: unit * cantidad,
  };
}

export function getOrderProfit(order, product) {
  // Profit CRUDO sobre el costo INTERNO real.
  // Este es el "profit antes de descontar comisión del mentor".
  // Para el profit real que queda para el lab, usar getLabRealProfit.
  const eff = getOrderEffectiveUnit(order, product);
  const unitCost = eff.costoContenido + eff.costoEnvase + eff.costoEtiqueta;
  const cantidad = order?.cantidad || 0;
  return (eff.precioVenta - unitCost) * cantidad;
}

// Costo INFORMADO al mentor/cliente (por unidad). Puede ser distinto al
// costo real cuando el lab no quiere que el mentor vea el costo verdadero.
//
// Prioridad:
//   1. order.costoInformado (override por orden)
//   2. product.costoInformado (default del producto)
//   3. Fallback: el costo INTERNO real (compatible con productos que no
//      tienen costo informado cargado).
export function getInformedCostUnit(order, product) {
  const orderOverride = order?.costoInformado;
  if (orderOverride != null && orderOverride !== '') {
    const n = parseFloat(orderOverride);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const prodInformed = product?.costoInformado;
  if (prodInformed != null && prodInformed !== '') {
    const n = parseFloat(prodInformed);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const eff = getOrderEffectiveUnit(order, product);
  return eff.costoContenido + eff.costoEnvase + eff.costoEtiqueta;
}

// Profit SOBRE EL COSTO INFORMADO (el que "ve" el mentor).
// Base para calcular la comisión del mentor: es justo que ellos cobren
// sobre lo que ellos creen que cuesta, no sobre lo que realmente cuesta.
export function getOrderInformedProfit(order, product) {
  const eff = getOrderEffectiveUnit(order, product);
  const informedUnit = getInformedCostUnit(order, product);
  const cantidad = order?.cantidad || 0;
  return Math.max(0, (eff.precioVenta - informedUnit) * cantidad);
}

// Profit REAL del laboratorio (lo que nos queda en el bolsillo):
//   profitInterno - comisiónMentor
// donde profitInterno es sobre el costo REAL, y la comisión sale del
// profit informado (lo que ve el mentor).
export function getLabRealProfit(order, product, mentor) {
  const profitInterno = getOrderProfit(order, product);
  if (!order?.mentorId || !mentor) return profitInterno;
  const mentorCommission = getMentorCommission(order, product, mentor);
  return profitInterno - mentorCommission;
}

// Comisión del mentor = porcentaje × profit INFORMADO (sobre costoInformado).
// Prioridad:
//  1. Si la orden tiene un presupuesto fijo asignado (order.mentorPresupuesto), ese gana.
//  2. Si se pasa mentor y product, usa mentor.porcentajeComision (default 50)
//     × profit informado (sobre costoInformado del producto/orden).
//  3. Sin mentor/product, último fallback: 50% del montoTotal.
export function getMentorCommission(order, product, mentor) {
  if (order?.mentorPresupuesto != null && order.mentorPresupuesto !== '') {
    return parseFloat(order.mentorPresupuesto) || 0;
  }
  if (product) {
    const profit = getOrderInformedProfit(order, product);
    const pct = mentor?.porcentajeComision != null ? Number(mentor.porcentajeComision) : 50;
    return Math.max(0, profit * (pct / 100));
  }
  return (order?.montoTotal || 0) * 0.5;
}

// Resumen de cobros de una orden (plata que entra del cliente).
// Devuelve total, cobrado, saldo, cuotasPagadas y cuotasPlanificadas.
// order.cobros es un array de { monto, fecha, nota }.
// Balance global de un mentor: cuánto generó en comisiones (acumulado de
// todas sus órdenes) vs cuánto ya se le pagó (suma de pagosRecibidos).
// Devuelve también el saldo pendiente y el % cobrado.
export function getMentorBalance(mentor, allSales, allProducts) {
  if (!mentor) return { generado: 0, cobrado: 0, saldo: 0, porcentaje: 0, ordenes: 0, pagos: [] };
  const misOrdenes = allSales.filter(o => o.mentorId === mentor.id);
  const generado = misOrdenes.reduce((s, o) => {
    const p = allProducts.find(pp => pp.id === o.productoId);
    return s + getMentorCommission(o, p, mentor);
  }, 0);
  const pagos = Array.isArray(mentor.pagosRecibidos) ? mentor.pagosRecibidos : [];
  const cobrado = pagos.reduce((s, p) => s + (parseFloat(p?.monto) || 0), 0);
  const saldo = generado - cobrado;
  const porcentaje = generado > 0 ? Math.round((cobrado / generado) * 100) : 0;
  return { generado, cobrado, saldo, porcentaje, ordenes: misOrdenes.length, pagos };
}

export function getOrderCobrosSummary(order) {
  const total = order?.montoTotal || 0;
  const cobros = Array.isArray(order?.cobros) ? order.cobros : [];
  const cobrado = cobros.reduce((s, c) => s + (parseFloat(c?.monto) || 0), 0);
  const saldo = total - cobrado;
  const cuotasPagadas = cobros.length;
  const cuotasPlanificadas = order?.cuotasPlanificadas || 0;
  const porcentaje = total > 0 ? Math.round((cobrado / total) * 100) : 0;
  return { total, cobrado, saldo, cuotasPagadas, cuotasPlanificadas, porcentaje, cobros };
}

// Pool de frases motivadoras pensadas para el día a día de una admin que
// gestiona un laboratorio artesanal de cosmética: detalle, paciencia, marcas
// chicas, cuidado del cliente, consistencia. Rotan por día del año.
export const DAILY_QUOTES = [
  'Cuidar los detalles es respetar a quien los va a usar.',
  'Una fórmula es un acto de cuidado.',
  'Hacer bien las cosas pequeñas es hacer grandes las grandes.',
  'Lo artesanal no se apura.',
  'El margen más grande está en la calidad.',
  'Un cliente feliz vuelve — y trae otro.',
  'Producir con cariño es producir con visión.',
  'Cada pote es una oportunidad.',
  'La paciencia da intereses.',
  'La mejor receta: lo justo de cada ingrediente.',
  'Vender es fácil. Fidelizar es el arte.',
  'La belleza está en los procesos, no en el apuro.',
  'Lo que se mide, se mejora.',
  'Primero calidad, después volumen — nunca al revés.',
  'Un buen laboratorio se mide en sus repeticiones.',
  'El detalle es lo que deja huella.',
  'Lo simple, bien hecho, siempre gana.',
  'Hoy es el único día que podemos hacer mejor que ayer.',
  'Las marcas chicas empiezan con fórmulas bien pensadas.',
  'Los clientes confían donde sienten el cuidado.',
  'La consistencia es un superpoder.',
  'Rápido y bien: dos palabras que pueden convivir.',
  'Las cosas hechas con amor escalan diferente.',
  'Un número bien cargado salva una decisión después.',
  'Lotes chicos, ideas grandes.',
  'La disciplina es la forma silenciosa de amar lo que hacés.',
  'El margen viene del orden.',
  'Poner un límite hoy es respetar tu trabajo mañana.',
  'No hay detalle chico cuando va con tu marca.',
  'Tus clientes eligen tu marca por lo que no se ve.',
  'Un día a la vez. Una orden a la vez.',
  'Lo bueno lleva tiempo — y esa es su garantía.',
  'La calidad es la mejor propaganda.',
  'Cuidá al cliente como si fuera el primero.',
  'El mejor anuncio es un producto que funciona.',
  'La paciencia también es una habilidad.',
  'Lo hecho a conciencia se nota.',
  'Cada fórmula es una historia.',
  'El lujo está en el detalle.',
  'La constancia vence lo que la inspiración no alcanza.',
];

// Devuelve la frase del día. Usa el día del año como índice para que sea
// consistente durante todo el día y rote cada 24h.
export function getDailyQuote(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
}

// Rubros de pago por orden. "envase" se muestra como "Envase / Pote" en la UI
// porque son lo mismo según el flujo del laboratorio.
export const PAYMENT_RUBROS = ['contenido', 'envase', 'etiqueta', 'mentor'];

export const PAYMENT_RUBRO_LABELS = {
  contenido: 'Contenido',
  envase: 'Envase / Pote',
  etiqueta: 'Etiqueta',
  mentor: 'Comisión equipo',
};

// Devuelve los 4 rubros de pago de una orden con valores calculados por defecto.
// Si la orden tiene datos guardados en order.pagos, se mergean sobre los defaults.
// El rubro 'mentor' lee su estado desde estadoComision si no hay override.
export function getOrderPayments(order, product, mentor) {
  const costs = getOrderCosts(order, product);
  const defaults = {
    contenido: { estado: 'pendiente', monto: costs.contenidoTotal, fecha: '', proveedor: '', nota: '' },
    envase:    { estado: 'pendiente', monto: costs.envaseTotal,    fecha: '', proveedor: '', nota: '' },
    etiqueta:  { estado: 'pendiente', monto: costs.etiquetaTotal,  fecha: '', proveedor: '', nota: '' },
    mentor:    { estado: order.estadoComision === 'pagada' ? 'pagado' : 'pendiente', monto: getMentorCommission(order, product, mentor), fecha: '', proveedor: '', nota: '' },
  };
  const stored = order.pagos || {};
  return {
    contenido: { ...defaults.contenido, ...(stored.contenido || {}) },
    envase:    { ...defaults.envase,    ...(stored.envase    || {}) },
    etiqueta:  { ...defaults.etiqueta,  ...(stored.etiqueta  || {}) },
    mentor:    { ...defaults.mentor,    ...(stored.mentor    || {}) },
  };
}

// Clave única del state persistido. Si cambia la forma del state en el
// futuro, bumpear el número acá invalida la cache y se recrea desde
// INITIAL_STATE.
const STATE_STORAGE_KEY = 'viora-state-v1';

function loadPersistedState() {
  if (typeof window === 'undefined') return INITIAL_STATE;
  try {
    const stored = localStorage.getItem(STATE_STORAGE_KEY);
    if (!stored) return INITIAL_STATE;
    const parsed = JSON.parse(stored);
    // Validación mínima de forma — si falta algún array clave, arranca de cero.
    if (!parsed || typeof parsed !== 'object') return INITIAL_STATE;
    return {
      products: Array.isArray(parsed.products) ? parsed.products : INITIAL_STATE.products,
      clients: Array.isArray(parsed.clients) ? parsed.clients : INITIAL_STATE.clients,
      mentors: Array.isArray(parsed.mentors) ? parsed.mentors : INITIAL_STATE.mentors,
      sales: Array.isArray(parsed.sales) ? parsed.sales : INITIAL_STATE.sales,
    };
  } catch {
    return INITIAL_STATE;
  }
}

function AppShell({ onExit }) {
  const [state, dispatch] = useReducer(appReducer, undefined, loadPersistedState);

  // Persistimos el state en localStorage cada vez que cambia. Si falla
  // (quota llena, modo privado), silenciamos el error — no queremos
  // que una falla de persistencia rompa la app.
  useEffect(() => {
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[persist] no pude guardar state', err);
    }
  }, [state]);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentSection, setCurrentSection] = useState('inicio');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Estado del menú mobile (sidebar como overlay deslizante en pantallas chicas).
  // En desktop el sidebar siempre está visible (gestionado por sidebarOpen + Tailwind md:).
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNewSaleModal, setShowNewSaleModal] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [filterMentor, setFilterMentor] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Analytics IA: el state vive en el shell para que los reportes sigan
  // corriendo aunque el usuario navegue a otra sección.
  const [analyticsState, setAnalyticsState] = useState({
    report: null, loading: false, error: '', lastFetch: 0,
  });
  const fetchAnalytics = async (snapshot) => {
    setAnalyticsState(s => ({ ...s, loading: true, error: '' }));
    try {
      const res = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setAnalyticsState({ report: data, loading: false, error: '', lastFetch: Date.now() });
      addToast({ type: 'success', message: 'Reporte de IA listo' });
    } catch (err) {
      setAnalyticsState(s => ({ ...s, loading: false, error: err.message || 'No pude generar el reporte.' }));
    }
  };

  const addToast = (toast) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, ...toast }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), toast.duration || 3500);
  };
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('dash-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('dash-dark-mode', String(darkMode));
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode(prev => !prev);

  // Atajo global Cmd+K / Ctrl+K para abrir la command palette
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Bootstrap de sesión al montar:
  // 1. Si en la URL viene ?token=... (callback del magic link), canjeamos
  //    por un session token y logueamos al usuario.
  // 2. Si no, chequeamos localStorage para ver si hay session previa válida.
  // Usa /api/auth que vive en api/auth.js (Vercel serverless + middleware dev).
  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const linkToken = url.searchParams.get('token');
    const storedSession = localStorage.getItem('viora-session');

    const clearTokenFromUrl = () => {
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    };

    (async () => {
      try {
        if (linkToken) {
          const resp = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'verify', token: linkToken }),
          });
          clearTokenFromUrl();
          if (!resp.ok) {
            addToast({ type: 'error', message: 'El link de acceso es inválido o expiró', duration: 6000 });
            return;
          }
          const data = await resp.json();
          if (data?.ok && data.session && data.user) {
            localStorage.setItem('viora-session', data.session);
            if (!cancelled) {
              setCurrentUser({ role: data.user.role, name: data.user.name, email: data.user.email, id: data.user.role === 'admin' ? 'admin' : data.user.email });
              setCurrentSection('inicio');
              addToast({ type: 'success', message: `Bienvenido, ${data.user.name}` });
            }
            return;
          }
        }
        if (storedSession) {
          const resp = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'me', session: storedSession }),
          });
          if (!resp.ok) {
            localStorage.removeItem('viora-session');
            return;
          }
          const data = await resp.json();
          if (data?.ok && data.user && !cancelled) {
            const u = data.user;
            // Matcheamos id del mentor por nombre si aplica
            let id = u.username || u.email || u.name;
            if (u.role === 'admin') {
              id = 'admin';
            }
            setCurrentUser({
              role: u.role,
              name: u.name,
              email: u.email || null,
              username: u.username || null,
              id,
            });
            setCurrentSection('inicio');
          }
        }
      } catch (err) {
        // Si /api/auth no está configurado (sin AUTH_SECRET), ignoramos
        // silenciosamente y dejamos que use el login demo.
        console.warn('[auth] bootstrap falló:', err?.message || err);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handlers
  const handleLogin = (role, name) => {
    setCurrentUser({ role, name, id: role === 'admin' ? 'admin' : (name === 'Sofia' ? 1 : 2) });
    setCurrentSection('inicio');
  };

  // Usado por LoginScreen después de un login exitoso contra /api/auth.
  // Recibe el user que devuelve el backend (con username/email + name + role).
  const handleSessionAuth = (user) => {
    // id: si es admin usamos 'admin', si es mentor intentamos matchear con los
    // mentores cargados por nombre (fallback al username).
    let id = user.username || user.email || user.name;
    if (user.role === 'admin') {
      id = 'admin';
    } else {
      const matched = state.mentors.find(m => m.nombre.toLowerCase() === (user.name || '').toLowerCase());
      if (matched) id = matched.id;
    }
    setCurrentUser({
      role: user.role,
      name: user.name,
      email: user.email || null,
      username: user.username || null,
      id,
    });
    setCurrentSection('inicio');
    addToast({ type: 'success', message: `Bienvenido, ${user.name}` });
  };

  const handleLogout = () => {
    // Limpiamos la sesión de magic link también, por si el user vino por ahí.
    localStorage.removeItem('viora-session');
    setCurrentUser(null);
    setCurrentSection('inicio');
    // Al cerrar sesión, volvemos a la landing pública si el parent lo soporta.
    if (typeof onExit === 'function') onExit();
  };

  const handleAddSale = (saleData) => {
    const maxId = state.sales.reduce((m, s) => Math.max(m, s.id), 0);
    const newSale = {
      id: maxId + 1,
      estado: 'pendiente-cotizacion',
      tieneIncidencia: false,
      incidenciaDetalle: '',
      estadoComision: 'pendiente',
      ...saleData,
    };
    dispatch({ type: 'ADD_SALE', payload: newSale });
    setShowNewSaleModal(false);
    addToast({ type: 'success', message: 'Orden registrada' });
  };

  const createClient = (clientData) => {
    const maxId = state.clients.reduce((m, c) => Math.max(m, c.id), 0);
    const newClient = {
      id: maxId + 1,
      totalCompras: 0,
      unidadesProducidas: 0,
      fechaAlta: new Date().toISOString().split('T')[0],
      ...clientData,
    };
    dispatch({ type: 'ADD_CLIENT', payload: newClient });
    addToast({ type: 'success', message: `Cliente "${newClient.nombre}" creado` });
    return newClient;
  };

  const handleAddClient = (clientData) => {
    createClient(clientData);
    setShowNewClientModal(false);
  };

  const handleUpdateClient = (clientData) => {
    dispatch({ type: 'UPDATE_CLIENT', payload: clientData });
  };

  const handleUpdateMentor = (mentorData) => {
    dispatch({ type: 'UPDATE_MENTOR', payload: mentorData });
  };

  const createProduct = (productData) => {
    const maxId = state.products.reduce((m, p) => Math.max(m, p.id), 0);
    const newProduct = {
      id: maxId + 1,
      descripcion: '',
      costoContenido: 0,
      costoEnvase: 0,
      costoEtiqueta: 0,
      ...productData,
    };
    dispatch({ type: 'ADD_PRODUCT', payload: newProduct });
    addToast({ type: 'success', message: `Producto "${newProduct.nombre}" creado` });
    return newProduct;
  };

  const handleAddProduct = (productData) => {
    createProduct(productData);
    setShowNewProductModal(false);
  };

  // Ejecutor de tools del chatbot. Claude pide acciones por nombre + input;
  // acá mapeamos cada tool a la reducer action correspondiente y devolvemos
  // un resultado legible que el widget reenvía al backend como tool_result.
  // Todos los casos validan input mínimo y devuelven { ok, ... } o { ok:false, error }.
  const executeChatbotTool = (name, input) => {
    try {
      switch (name) {
        case 'crear_cliente': {
          if (!input?.nombre) return { ok: false, error: 'Falta el nombre' };
          const cli = createClient({
            nombre: input.nombre,
            telefono: input.telefono || '',
            domicilio: input.domicilio || '',
            mentorId: input.mentorId != null ? input.mentorId : null,
          });
          return { ok: true, cliente: { id: cli.id, nombre: cli.nombre } };
        }
        case 'crear_producto': {
          if (!input?.nombre) return { ok: false, error: 'Falta el nombre' };
          if (input.precioVenta == null) return { ok: false, error: 'Falta precioVenta' };
          const p = createProduct({
            nombre: input.nombre,
            descripcion: input.descripcion || '',
            costoContenido: Number(input.costoContenido) || 0,
            costoEnvase: Number(input.costoEnvase) || 0,
            costoEtiqueta: Number(input.costoEtiqueta) || 0,
            precioVenta: Number(input.precioVenta) || 0,
          });
          return { ok: true, producto: { id: p.id, nombre: p.nombre, precioVenta: p.precioVenta } };
        }
        case 'crear_orden': {
          const { clienteId, productoId, cantidad, montoTotal } = input || {};
          if (clienteId == null || productoId == null || cantidad == null || montoTotal == null) {
            return { ok: false, error: 'Faltan campos obligatorios (clienteId, productoId, cantidad, montoTotal)' };
          }
          const cliente = state.clients.find(c => c.id === clienteId);
          const producto = state.products.find(p => p.id === productoId);
          if (!cliente) return { ok: false, error: `No existe cliente con id ${clienteId}` };
          if (!producto) return { ok: false, error: `No existe producto con id ${productoId}` };
          const maxId = state.sales.reduce((m, s) => Math.max(m, s.id), 0);
          const fallbackMentor = input.mentorId != null ? input.mentorId : (cliente.mentorId ?? null);
          const newSale = {
            id: maxId + 1,
            fecha: input.fecha || new Date().toISOString().split('T')[0],
            clienteId,
            productoId,
            cantidad: Number(cantidad),
            montoTotal: Number(montoTotal),
            mentorId: fallbackMentor,
            estado: input.estado || 'pendiente-cotizacion',
            estadoComision: 'pendiente',
            tieneIncidencia: false,
            incidenciaDetalle: '',
          };
          dispatch({ type: 'ADD_SALE', payload: newSale });
          addToast({ type: 'success', message: `Orden #${newSale.id} creada por el chatbot` });
          return {
            ok: true,
            orden: {
              id: newSale.id,
              cliente: cliente.nombre,
              producto: producto.nombre,
              cantidad: newSale.cantidad,
              montoTotal: newSale.montoTotal,
              estado: newSale.estado,
            },
          };
        }
        case 'cambiar_estado_orden': {
          const { orderId, estado } = input || {};
          if (orderId == null || !estado) return { ok: false, error: 'Faltan orderId o estado' };
          if (!ORDER_STATES.includes(estado)) return { ok: false, error: `Estado inválido: ${estado}` };
          const exists = state.sales.some(s => s.id === orderId);
          if (!exists) return { ok: false, error: `No existe orden #${orderId}` };
          dispatch({ type: 'UPDATE_ORDER_STATE', payload: { orderId, estado } });
          addToast({ type: 'success', message: `Orden #${orderId} → ${ORDER_STATE_LABELS[estado]}` });
          return { ok: true, orderId, nuevoEstado: estado };
        }
        case 'marcar_incidencia': {
          const { orderId, tieneIncidencia, incidenciaDetalle } = input || {};
          if (orderId == null || tieneIncidencia == null) return { ok: false, error: 'Faltan orderId o tieneIncidencia' };
          const exists = state.sales.some(s => s.id === orderId);
          if (!exists) return { ok: false, error: `No existe orden #${orderId}` };
          dispatch({
            type: 'UPDATE_ORDER_INCIDENCIA',
            payload: {
              orderId,
              tieneIncidencia: !!tieneIncidencia,
              incidenciaDetalle: tieneIncidencia ? (incidenciaDetalle || '') : '',
            },
          });
          addToast({ type: tieneIncidencia ? 'warning' : 'success', message: tieneIncidencia ? `Orden #${orderId} marcada con incidencia` : `Incidencia de orden #${orderId} resuelta` });
          return { ok: true, orderId, tieneIncidencia: !!tieneIncidencia };
        }
        case 'registrar_cobro': {
          const { orderId, rubro, estado, monto, fecha } = input || {};
          if (orderId == null || !rubro || !estado) return { ok: false, error: 'Faltan orderId, rubro o estado' };
          const RUBROS = ['cliente', 'mentor', 'contenido', 'envase', 'etiqueta'];
          if (!RUBROS.includes(rubro)) return { ok: false, error: `Rubro inválido: ${rubro}` };
          if (!['pagado', 'pendiente'].includes(estado)) return { ok: false, error: `Estado inválido: ${estado}` };
          const exists = state.sales.some(s => s.id === orderId);
          if (!exists) return { ok: false, error: `No existe orden #${orderId}` };
          const data = { estado };
          if (monto != null) data.monto = Number(monto);
          if (fecha) data.fecha = fecha;
          dispatch({ type: 'UPDATE_ORDER_PAYMENT', payload: { orderId, rubro, data } });
          addToast({ type: 'success', message: `Cobro ${rubro} de #${orderId} → ${estado}` });
          return { ok: true, orderId, rubro, estado };
        }
        default:
          return { ok: false, error: `Tool desconocida: ${name}` };
      }
    } catch (err) {
      return { ok: false, error: err?.message || 'Error ejecutando la tool' };
    }
  };

  const calculateMargin = (costo, precio) => {
    if (!precio || precio <= 0) return 0;
    return Math.round(((precio - costo) / precio) * 100);
  };

  const getMonthlySalesData = () => {
    const months = {};
    state.sales.forEach(sale => {
      const month = sale.fecha.substring(0, 7);
      months[month] = (months[month] || 0) + sale.montoTotal;
    });
    return Object.entries(months)
      .sort()
      .map(([month, total]) => ({ month: new Date(month + '-01').toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }), total }));
  };

  const getCurrentMonthSales = () => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    return state.sales.filter(s => s.fecha.startsWith(currentMonth)).reduce((sum, s) => sum + s.montoTotal, 0);
  };

  const getPendingCommissions = () => {
    return state.sales
      .filter(s => s.estadoComision === 'pendiente')
      .reduce((sum, s) => sum + (s.montoTotal * 0.5), 0);
  };

  const getActiveClients = () => state.clients.length;

  const getMentorStats = (mentorId) => {
    const mentorSales = state.sales.filter(s => s.mentorId === mentorId);
    const totalSales = mentorSales.reduce((sum, s) => sum + s.montoTotal, 0);
    const totalCommission = totalSales * 0.5;
    const paidCommission = mentorSales.filter(s => s.estadoComision === 'pagada').reduce((sum, s) => sum + (s.montoTotal * 0.5), 0);
    const pendingCommission = totalCommission - paidCommission;
    return { totalSales, totalCommission, paidCommission, pendingCommission };
  };

  // Cuando se cambia de sección o de usuario, cerramos el menú mobile
  // automáticamente (UX esperada al navegar). Va ANTES del early return
  // para no violar las rules of hooks de React.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentSection]);

  if (!currentUser) {
    // Renderizamos también el ToastContainer para que los avisos del
    // bootstrap de auth (link inválido, link enviado) sean visibles.
    return (
      <>
        <LoginScreen onLogin={handleLogin} onSessionAuth={handleSessionAuth} darkMode={darkMode} toggleDarkMode={toggleDarkMode} />
        <ToastContainer toasts={toasts} />
      </>
    );
  }

  // En mobile el sidebar es siempre "abierto" cuando se muestra (no tiene
  // sentido el modo colapsado en un overlay). Forzamos sidebarOpen=true
  // visualmente cuando se abre el menú mobile.
  const effectiveSidebarOpen = mobileMenuOpen ? true : sidebarOpen;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Backdrop oscuro detrás del sidebar mobile */}
      {mobileMenuOpen && (
        <div
          aria-hidden="true"
          onClick={() => setMobileMenuOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in"
        />
      )}
      {/* Sidebar — desktop: lateral fijo. Mobile: overlay deslizante */}
      <aside className={`
        ${effectiveSidebarOpen ? 'w-64' : 'w-20'}
        relative bg-gradient-to-b from-[#4a0f22] via-pink-900 to-[#3f0c1e] text-white shadow-2xl
        transition-all duration-500 ease-out flex flex-col
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-72
        max-md:transform max-md:transition-transform
        ${mobileMenuOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
      `}>
        {/* Patrón decorativo sutil */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,_white_1px,_transparent_0)] [background-size:16px_16px]"
        />

        {/* Botón de colapsar: flota en el borde derecho del sidebar, anclado
            al divisor del logo para no chocarse con el header sticky del main.
            z-50 > z-30 del header para estar siempre visible. */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-[90px] z-50 w-6 h-6 rounded-full bg-pink-900 border border-pink-700 text-white hover:bg-pink-800 hover:scale-110 transition-all duration-200 flex items-center justify-center shadow-lg opacity-70 hover:opacity-100"
          aria-label={sidebarOpen ? 'Colapsar sidebar' : 'Expandir sidebar'}
          title={sidebarOpen ? 'Colapsar' : 'Expandir'}
        >
          <ChevronRight size={14} className={`transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : 'rotate-0'}`} />
        </button>

        {/* Logo */}
        <div className="relative p-4 flex items-center justify-center min-h-[90px]">
          {sidebarOpen ? <VioraLogo variant="light" size="sm" /> : <VioraMark size={36} />}
        </div>

        {/* Divisor dorado sutil */}
        <div aria-hidden="true" className="mx-4 h-px bg-gradient-to-r from-transparent via-amber-300/30 to-transparent" />

        <nav className="relative flex-1 p-3 space-y-1 overflow-y-auto">
          {currentUser.role === 'admin' ? (
            <>
              <NavItem icon={Home} label="Inicio" section="inicio" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={TrendingUp} label="Ventas" section="ventas" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Package} label="Productos" section="productos" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Users} label="Clientes" section="clientes" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={CreditCard} label="Comisiones" section="comisiones" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={UserCheck} label="Equipo" section="mentores" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Sparkles} label="Analytics IA" section="analytics" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Package} label="Datos" section="datos" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          ) : (
            <>
              <NavItem icon={Home} label="Inicio" section="inicio" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={TrendingUp} label="Mis Órdenes" section="mis-ordenes" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={CreditCard} label="Mi Balance" section="resumen" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Users} label="Mis Clientes" section="mis-clientes" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          )}
        </nav>

        {/* Footer: pill de usuario con menú personalizado */}
        <div className="relative p-3">
          <div aria-hidden="true" className="mx-1 h-px mb-3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <UserMenu
            currentUser={currentUser}
            sidebarOpen={sidebarOpen}
            state={state}
            onLogout={handleLogout}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative">
        <StickyHeader
          title={getSectionTitle(currentUser, currentSection)}
          subtitle={`Bienvenido, ${currentUser.name}`}
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
          onOpenCommand={() => setCmdOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          notificationsSnapshot={currentUser.role === 'admin' ? buildPanelChatContext(state, currentUser) : null}
          bgTasks={analyticsState.loading ? ['Generando reporte IA…'] : []}
        />

        <div key={currentSection} className="p-4 md:p-8 animate-fade-in-up">
          {/* Admin Views */}
          {currentUser.role === 'admin' && currentSection === 'inicio' && <InicioSection state={state} dispatch={dispatch} onAddSale={handleAddSale} onQuickAddClient={createClient} onQuickAddProduct={createProduct} />}
          {currentUser.role === 'admin' && currentSection === 'ventas' && <VentasSection state={state} onAddSale={handleAddSale} onQuickAddClient={createClient} onQuickAddProduct={createProduct} showModal={showNewSaleModal} setShowModal={setShowNewSaleModal} />}
          {currentUser.role === 'admin' && currentSection === 'productos' && <ProductosSection state={state} onAddProduct={handleAddProduct} showModal={showNewProductModal} setShowModal={setShowNewProductModal} calculateMargin={calculateMargin} />}
          {currentUser.role === 'admin' && currentSection === 'clientes' && <ClientesSection state={state} onAddClient={handleAddClient} onUpdateClient={handleUpdateClient} showModal={showNewClientModal} setShowModal={setShowNewClientModal} />}
          {currentUser.role === 'admin' && currentSection === 'comisiones' && <ComisionesSection state={state} dispatch={dispatch} onUpdateMentor={handleUpdateMentor} getMentorStats={getMentorStats} filterMentor={filterMentor} setFilterMentor={setFilterMentor} />}
          {currentUser.role === 'admin' && currentSection === 'mentores' && <MentoresSection state={state} getMentorStats={getMentorStats} />}
          {currentUser.role === 'admin' && currentSection === 'analytics' && <AnalyticsSection state={state} currentUser={currentUser} analyticsState={analyticsState} onFetch={fetchAnalytics} />}
          {currentUser.role === 'admin' && currentSection === 'datos' && <DatosSection state={state} dispatch={dispatch} addToast={addToast} />}

          {/* Mentor Views */}
          {currentUser.role === 'mentor' && currentSection === 'inicio' && <EquipoInicioSection currentUser={currentUser} state={state} />}
          {currentUser.role === 'mentor' && currentSection === 'mis-ordenes' && <EquipoOrdenesSection currentUser={currentUser} state={state} />}
          {currentUser.role === 'mentor' && currentSection === 'resumen' && <MentorResumenSection currentUser={currentUser} state={state} getMentorStats={getMentorStats} />}
          {currentUser.role === 'mentor' && currentSection === 'mis-clientes' && <MentorClientesSection currentUser={currentUser} state={state} />}
        </div>
      </main>

      {/* Command palette global */}
      {cmdOpen && (
        <CommandPalette
          state={state}
          currentUser={currentUser}
          onClose={() => setCmdOpen(false)}
          onNavigate={(section) => { setCurrentSection(section); setCmdOpen(false); }}
          onNewSale={() => { setCurrentSection('ventas'); setShowNewSaleModal(true); setCmdOpen(false); }}
          onNewClient={() => { setCurrentSection('clientes'); setShowNewClientModal(true); setCmdOpen(false); }}
          onNewProduct={() => { setCurrentSection('productos'); setShowNewProductModal(true); setCmdOpen(false); }}
          onToggleTheme={() => { toggleDarkMode(); setCmdOpen(false); }}
          onLogout={() => { handleLogout(); setCmdOpen(false); }}
        />
      )}

      {/* Toast container */}
      <ToastContainer toasts={toasts} />

      {/* Chatbot con contexto del negocio.
          Sólo admin tiene tool-use (crear/editar); equipo usa el chat en modo consulta. */}
      <ChatbotWidget
        mode="panel"
        context={buildPanelChatContext(state, currentUser)}
        onExecuteTool={currentUser.role === 'admin' ? executeChatbotTool : null}
      />
    </div>
  );
}

// Construye el snapshot de contexto para el chatbot en el panel. No queremos
// mandar todo el estado, sino un resumen compacto que Claude pueda usar para
// contestar preguntas de negocio sin que el prompt se vuelva enorme.
function buildPanelChatContext(state, currentUser) {
  const ordenesPorEstado = {};
  state.sales.forEach(o => {
    const k = ORDER_STATE_LABELS[o.estado || 'pendiente-cotizacion'] || o.estado || 'sin estado';
    ordenesPorEstado[k] = (ordenesPorEstado[k] || 0) + 1;
  });

  const ventasPeriodo = state.sales.reduce((s, o) => s + (o.montoTotal || 0), 0);
  const profitPeriodo = state.sales.reduce((s, o) => {
    const p = state.products.find(p => p.id === o.productoId);
    return s + getOrderProfit(o, p);
  }, 0);
  const comisionesPendientes = state.sales
    .filter(o => o.mentorId && o.estadoComision !== 'pagada')
    .reduce((s, o) => {
      const p = state.products.find(p => p.id === o.productoId);
      const m = state.mentors.find(m => m.id === o.mentorId);
      return s + getMentorCommission(o, p, m);
    }, 0);
  const pagosProveedoresPendientes = state.sales.reduce((acc, o) => {
    const p = state.products.find(p => p.id === o.productoId);
    const m = state.mentors.find(m => m.id === o.mentorId);
    const pagos = getOrderPayments(o, p, m);
    return acc
      + (pagos.contenido.estado === 'pendiente' ? (pagos.contenido.monto || 0) : 0)
      + (pagos.envase.estado === 'pendiente' ? (pagos.envase.monto || 0) : 0)
      + (pagos.etiqueta.estado === 'pendiente' ? (pagos.etiqueta.monto || 0) : 0);
  }, 0);
  const incidencias = state.sales.filter(s => s.tieneIncidencia).length;

  // Mandamos las últimas 8 para que el chatbot pueda referenciarlas por id
  // al ejecutar tools (cambiar estado, registrar cobro, etc).
  const ultimasOrdenes = state.sales
    .slice()
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    .slice(0, 8)
    .map(o => {
      const cliente = state.clients.find(c => c.id === o.clienteId);
      const producto = state.products.find(p => p.id === o.productoId);
      return {
        id: o.id,
        fecha: o.fecha,
        cliente: cliente?.nombre || '-',
        producto: producto?.nombre || '-',
        cantidad: o.cantidad || 0,
        monto: o.montoTotal || 0,
        estado: ORDER_STATE_LABELS[o.estado || 'pendiente-cotizacion'] || '-',
        incidencia: !!o.tieneIncidencia,
      };
    });

  return {
    usuario: currentUser ? { name: currentUser.name, role: currentUser.role } : null,
    metricas: {
      ordenesTotal: state.sales.length,
      ventasPeriodo,
      profitPeriodo,
      comisionesPendientes,
      pagosProveedoresPendientes,
      incidencias,
    },
    ordenesPorEstado,
    ultimasOrdenes,
    // Incluimos id en clientes/productos/mentores para que Claude pueda
    // armar correctamente los tool calls (crear_orden, registrar_cobro, etc).
    clientes: state.clients.map(c => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, domicilio: c.domicilio })),
    productos: state.products.map(p => ({ id: p.id, nombre: p.nombre, precio: p.precioVenta })),
    mentores: state.mentors.map(m => ({ id: m.id, nombre: m.nombre, porcentaje: m.porcentajeComision ?? 50 })),
  };
}

function NavItem({ icon: Icon, label, section, currentSection, onSelect, sidebarOpen }) {
  const isActive = currentSection === section;
  return (
    <button
      onClick={() => onSelect(section)}
      title={!sidebarOpen ? label : undefined}
      className={`group relative w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 ${
        isActive
          ? 'bg-gradient-to-r from-pink-600/80 to-rose-500/60 text-white shadow-lg shadow-pink-900/40'
          : 'text-pink-100/80 hover:text-white hover:bg-white/5'
      }`}
    >
      {/* Indicador lateral animado sobre el activo */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-gradient-to-b from-amber-200 to-amber-400 transition-all duration-300 ${
          isActive ? 'h-6 opacity-100' : 'h-0 opacity-0'
        }`}
      />
      <Icon size={19} className={`shrink-0 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
      {sidebarOpen && <span className="text-sm font-medium whitespace-nowrap">{label}</span>}
      {/* Tooltip en modo colapsado */}
      {!sidebarOpen && (
        <span className="pointer-events-none absolute left-full ml-3 px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap bg-gray-900 text-white opacity-0 group-hover:opacity-100 translate-x-[-6px] group-hover:translate-x-0 transition-all duration-150 z-50 shadow-lg">
          {label}
        </span>
      )}
    </button>
  );
}

function LoginScreen({ onLogin, onSessionAuth, darkMode, toggleDarkMode }) {
  // loginMode: 'login' (user+pass, default) | 'email' | 'email-sent'
  const [loginMode, setLoginMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Magic link (opcional, secundario)
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendResult, setSendResult] = useState(null);

  const doLogin = async () => {
    setLoginError('');
    if (!username.trim() || !password) {
      setLoginError('Completá usuario y contraseña');
      return;
    }
    setLoggingIn(true);
    try {
      const resp = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: username.trim(), password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) {
        setLoginError(data?.error || 'Usuario o contraseña inválidos');
        return;
      }
      // Guardamos la session y avisamos al parent
      localStorage.setItem('viora-session', data.session);
      if (typeof onSessionAuth === 'function') {
        onSessionAuth(data.user);
      } else {
        // Fallback: llamar onLogin con los datos equivalentes
        onLogin(data.user.role, data.user.name);
      }
    } catch (err) {
      setLoginError('No pude conectar con el servidor.');
    } finally {
      setLoggingIn(false);
    }
  };

  const sendMagicLink = async () => {
    setSendError('');
    const trimmed = email.trim();
    if (!trimmed) { setSendError('Ingresá tu email'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) { setSendError('Email con formato inválido'); return; }
    setSending(true);
    try {
      const resp = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', email: trimmed }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setSendError(data?.error || `Error ${resp.status}`);
      } else {
        setSendResult({ emailSent: !!data.emailSent, devLink: data.devLink, hidden: !!data.hidden });
        setLoginMode('email-sent');
      }
    } catch (err) {
      setSendError('No pude conectar con el servidor.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-rose-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4 relative">
      <button
        onClick={toggleDarkMode}
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 shadow transition"
        title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        aria-label="Toggle dark mode"
      >
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-8 flex flex-col items-center">
          <VioraLogo size="md" variant={darkMode ? 'light' : 'default'} />
          <p className="text-gray-600 dark:text-gray-400 mt-1 text-xs tracking-widest uppercase">Panel de gestión</p>
        </div>

        {loginMode === 'login' && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Usuario</label>
            <input
              type="text"
              autoFocus
              autoComplete="username"
              placeholder="usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mt-3">Contraseña</label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            {loginError && <p className="text-xs text-red-600 dark:text-red-400">{loginError}</p>}
            <button
              onClick={doLogin}
              disabled={loggingIn}
              className="w-full py-2.5 mt-2 bg-gradient-to-r from-pink-900 to-rose-700 text-white rounded-lg hover:shadow-lg transition font-semibold disabled:opacity-60"
            >
              {loggingIn ? 'Ingresando…' : 'Ingresar'}
            </button>
            <button
              onClick={() => setLoginMode('email')}
              className="w-full pt-3 text-[11px] text-gray-500 dark:text-gray-400 hover:text-pink-700 dark:hover:text-pink-300 transition border-t border-gray-100 dark:border-gray-700"
            >
              ¿Preferís ingresar con email? →
            </button>
          </div>
        )}

        {loginMode === 'email' && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Tu email</label>
            <input
              type="email"
              autoFocus
              placeholder="nombre@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendMagicLink(); }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            {sendError && <p className="text-xs text-red-600 dark:text-red-400">{sendError}</p>}
            <button
              onClick={sendMagicLink}
              disabled={sending}
              className="w-full py-2 bg-pink-900 dark:bg-pink-700 text-white rounded-lg hover:bg-pink-800 dark:hover:bg-pink-600 transition disabled:opacity-60"
            >
              {sending ? 'Enviando…' : 'Enviarme el link'}
            </button>
            <button
              onClick={() => setLoginMode('login')}
              className="w-full py-2 text-pink-900 dark:text-pink-300 border border-pink-900 dark:border-pink-300 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm"
            >
              Volver al login con usuario
            </button>
          </div>
        )}

        {loginMode === 'email-sent' && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
              {sendResult?.hidden ? (
                <>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Si el email está autorizado, vas a recibir un link de acceso en pocos segundos.</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">El link expira en 15 minutos.</p>
                </>
              ) : sendResult?.emailSent ? (
                <>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Listo, te mandamos el link a <span className="font-mono">{email}</span>.</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Revisá tu bandeja (y el spam). El link expira en 15 minutos.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Modo setup: no hay proveedor de email configurado.</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">Usá este link para entrar ahora (expira en 15 minutos):</p>
                  {sendResult?.devLink && (
                    <a
                      href={sendResult.devLink}
                      className="block mt-2 px-3 py-2 bg-white dark:bg-gray-800 rounded border border-emerald-300 dark:border-emerald-700 text-[11px] font-mono text-emerald-900 dark:text-emerald-200 break-all hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition"
                    >
                      {sendResult.devLink}
                    </a>
                  )}
                </>
              )}
            </div>
            <button
              onClick={() => { setLoginMode('login'); setSendResult(null); setEmail(''); }}
              className="w-full py-2 text-pink-900 dark:text-pink-300 border border-pink-900 dark:border-pink-300 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm"
            >
              Volver
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InicioSection({ state, dispatch, onAddSale, onQuickAddClient, onQuickAddProduct }) {
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    states: new Set(), // vacío = todos
    onlyIncidencia: false,
    search: '',
    focus: null, // null | 'comisionesPendientes' | 'pagosProveedoresPendientes' | 'saldoPendiente'
  });
  // Modal para crear orden sin salir de Inicio.
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);

  // Órdenes filtradas según el estado actual de los filtros
  const filteredOrders = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return state.sales.filter(order => {
      if (filters.dateFrom && (order.fecha || '') < filters.dateFrom) return false;
      if (filters.dateTo && (order.fecha || '') > filters.dateTo) return false;
      if (filters.states.size > 0 && !filters.states.has(order.estado || 'pendiente-cotizacion')) return false;
      if (filters.onlyIncidencia && !order.tieneIncidencia) return false;
      // Foco: filtros rápidos disparados al clickear un stat card.
      if (filters.focus === 'comisionesPendientes') {
        if (!order.mentorId || order.estadoComision === 'pagada') return false;
      }
      if (filters.focus === 'pagosProveedoresPendientes') {
        const product = state.products.find(p => p.id === order.productoId);
        const mentor = state.mentors.find(m => m.id === order.mentorId);
        const pagos = getOrderPayments(order, product, mentor);
        const hayPendiente = ['contenido', 'envase', 'etiqueta']
          .some(k => pagos[k]?.estado === 'pendiente' && (pagos[k]?.monto || 0) > 0);
        if (!hayPendiente) return false;
      }
      if (filters.focus === 'saldoPendiente') {
        const totalCobrado = Array.isArray(order.cobros)
          ? order.cobros.reduce((s, c) => s + (parseFloat(c?.monto) || 0), 0)
          : 0;
        const saldo = (order.montoTotal || 0) - totalCobrado;
        if (saldo <= 0) return false;
      }
      if (q) {
        const client = state.clients.find(c => c.id === order.clienteId);
        const product = state.products.find(p => p.id === order.productoId);
        const mentor = state.mentors.find(m => m.id === order.mentorId);
        const haystack = [
          client?.nombre, client?.telefono, client?.domicilio,
          product?.nombre, product?.descripcion,
          mentor?.nombre,
          order.fecha, order.incidenciaDetalle,
          ORDER_STATE_LABELS[order.estado || 'pendiente-cotizacion'],
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [state.sales, state.clients, state.products, state.mentors, filters]);

  // Stats del período (reflejan el filtro)
  const ventasPeriodo = filteredOrders.reduce((s, o) => s + (o.montoTotal || 0), 0);
  const totalProfit = filteredOrders.reduce((acc, order) => {
    const product = state.products.find(p => p.id === order.productoId);
    return acc + getOrderProfit(order, product);
  }, 0);
  const pendingCommissionsPeriodo = filteredOrders
    .filter(o => o.mentorId && o.estadoComision !== 'pagada')
    .reduce((s, o) => {
      const product = state.products.find(p => p.id === o.productoId);
      const mentor = state.mentors.find(m => m.id === o.mentorId);
      return s + getMentorCommission(o, product, mentor);
    }, 0);
  const totalPagosProveedoresPendientes = filteredOrders.reduce((acc, order) => {
    const product = state.products.find(p => p.id === order.productoId);
    const mentor = state.mentors.find(m => m.id === order.mentorId);
    const pagos = getOrderPayments(order, product, mentor);
    return acc
      + (pagos.contenido.estado === 'pendiente' ? (pagos.contenido.monto || 0) : 0)
      + (pagos.envase.estado === 'pendiente' ? (pagos.envase.monto || 0) : 0)
      + (pagos.etiqueta.estado === 'pendiente' ? (pagos.etiqueta.monto || 0) : 0);
  }, 0);
  const ordersConIncidencia = filteredOrders.filter(s => s.tieneIncidencia).length;

  // Serie mensual del chart también respeta el filtro
  const monthlyChart = useMemo(() => {
    const months = {};
    filteredOrders.forEach(o => {
      const m = (o.fecha || '').substring(0, 7);
      if (!m) return;
      months[m] = (months[m] || 0) + (o.montoTotal || 0);
    });
    return Object.entries(months)
      .sort()
      .map(([m, total]) => ({
        month: new Date(m + '-01').toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
        total,
      }));
  }, [filteredOrders]);

  return (
    <div className="space-y-8">
      {/* Botón principal de "Nueva orden" — destacado arriba de todo para que
          sea lo primero que ves al entrar. Abre un modal con el form completo
          sin tener que navegar a Ventas. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DailyQuoteBanner />
        <button
          onClick={() => setShowNewOrderModal(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-pink-700 to-rose-600 text-white px-5 py-2.5 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-100 transition font-semibold text-sm"
          title="Registrar una nueva orden"
        >
          <Plus size={18} /> Nueva orden
        </button>
      </div>

      {showNewOrderModal && (
        <NewSaleModal
          state={state}
          onAddSale={(data) => { onAddSale?.(data); setShowNewOrderModal(false); }}
          onQuickAddClient={onQuickAddClient}
          onQuickAddProduct={onQuickAddProduct}
          onClose={() => setShowNewOrderModal(false)}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        <StatCard
          icon={DollarSign}
          label="Ventas del Período"
          value={`$${Math.round(ventasPeriodo).toLocaleString()}`}
          color="from-pink-500 to-rose-500"
          delay={0}
          active={filters.focus === 'saldoPendiente'}
          tooltip="Click para filtrar: solo órdenes con saldo pendiente de cobro"
          onClick={() => setFilters(f => ({ ...f, focus: f.focus === 'saldoPendiente' ? null : 'saldoPendiente' }))}
        />
        <StatCard
          icon={TrendingUp}
          label="Profit del Período"
          value={`$${Math.round(totalProfit).toLocaleString()}`}
          color="from-emerald-500 to-teal-500"
          delay={80}
          tooltip="Click para limpiar filtros y ver todas las órdenes"
          onClick={() => setFilters(f => ({ ...f, focus: null, onlyIncidencia: false, states: new Set(), search: '' }))}
        />
        <StatCard
          icon={CreditCard}
          label="Comisiones Pendientes"
          value={`$${Math.round(pendingCommissionsPeriodo).toLocaleString()}`}
          color="from-amber-500 to-orange-500"
          delay={160}
          active={filters.focus === 'comisionesPendientes'}
          tooltip="Click para filtrar: solo órdenes con comisión del mentor pendiente"
          onClick={() => setFilters(f => ({ ...f, focus: f.focus === 'comisionesPendientes' ? null : 'comisionesPendientes' }))}
        />
        <StatCard
          icon={Package}
          label="A pagar Proveedores"
          value={`$${Math.round(totalPagosProveedoresPendientes).toLocaleString()}`}
          color="from-sky-500 to-blue-500"
          delay={240}
          active={filters.focus === 'pagosProveedoresPendientes'}
          tooltip="Click para filtrar: solo órdenes con pagos pendientes a proveedores"
          onClick={() => setFilters(f => ({ ...f, focus: f.focus === 'pagosProveedoresPendientes' ? null : 'pagosProveedoresPendientes' }))}
        />
        <StatCard
          icon={AlertCircle}
          label="Incidencias"
          value={ordersConIncidencia}
          color="from-red-500 to-pink-500"
          delay={320}
          active={filters.onlyIncidencia}
          tooltip="Click para filtrar: solo órdenes con incidencia activa"
          onClick={() => setFilters(f => ({ ...f, onlyIncidencia: !f.onlyIncidencia }))}
        />
      </div>

      <FilterBar filters={filters} onChange={setFilters} totalShown={filteredOrders.length} totalAll={state.sales.length} />

      <OrdersList orders={filteredOrders} state={state} dispatch={dispatch} />

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Ventas por mes (período seleccionado)</h3>
        {monthlyChart.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-8">No hay datos para el rango y filtros actuales.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="total" stroke="#be185d" strokeWidth={3} name="Total Ventas ($)" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Barra de filtros del dashboard: búsqueda, rango de fechas con presets,
// estados múltiples del pipeline y toggle "sólo con incidencia".
function FilterBar({ filters, onChange, totalShown, totalAll }) {
  const update = (patch) => onChange({ ...filters, ...patch });

  const toggleState = (key) => {
    const next = new Set(filters.states);
    if (next.has(key)) next.delete(key); else next.add(key);
    update({ states: next });
  };

  const applyPreset = (preset) => {
    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
    const todayStr = fmt(today);
    if (preset === 'all') { update({ dateFrom: '', dateTo: '' }); return; }
    if (preset === 'today') { update({ dateFrom: todayStr, dateTo: todayStr }); return; }
    if (preset === 'yesterday') {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const yStr = fmt(y);
      update({ dateFrom: yStr, dateTo: yStr });
      return;
    }
    const d = new Date(today);
    if (preset === '7') { d.setDate(d.getDate() - 7); update({ dateFrom: fmt(d), dateTo: todayStr }); return; }
    if (preset === '30') { d.setDate(d.getDate() - 30); update({ dateFrom: fmt(d), dateTo: todayStr }); return; }
    if (preset === '90') { d.setDate(d.getDate() - 90); update({ dateFrom: fmt(d), dateTo: todayStr }); return; }
    if (preset === 'thisMonth') { const s = new Date(today.getFullYear(), today.getMonth(), 1); update({ dateFrom: fmt(s), dateTo: todayStr }); return; }
    if (preset === 'thisYear') { const s = new Date(today.getFullYear(), 0, 1); update({ dateFrom: fmt(s), dateTo: todayStr }); return; }
  };

  const clearAll = () => onChange({
    dateFrom: '', dateTo: '', states: new Set(), onlyIncidencia: false, search: '', focus: null,
  });

  const anyActive = filters.dateFrom || filters.dateTo || filters.states.size > 0 || filters.onlyIncidencia || filters.search || filters.focus;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Buscar por cliente, producto, mentor, estado..."
            className="w-full pl-9 pr-9 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
          {filters.search && (
            <button
              onClick={() => update({ search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update({ dateFrom: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            title="Desde"
          />
          <span className="text-gray-500 dark:text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => update({ dateTo: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            title="Hasta"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mr-1">Rango:</span>
        {[
          { k: 'today', label: 'Hoy' },
          { k: 'yesterday', label: 'Ayer' },
          { k: '7', label: 'Últ. 7 días' },
          { k: '30', label: 'Últ. 30 días' },
          { k: '90', label: 'Últ. 90 días' },
          { k: 'thisMonth', label: 'Este mes' },
          { k: 'thisYear', label: 'Este año' },
          { k: 'all', label: 'Todo' },
        ].map(p => (
          <button
            key={p.k}
            onClick={() => applyPreset(p.k)}
            className="px-3 py-1 text-xs rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mr-1">Estado:</span>
        {ORDER_STATES.map(s => {
          const active = filters.states.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleState(s)}
              className={`px-3 py-1 text-xs font-semibold rounded-full transition border ${
                active
                  ? `${ORDER_STATE_STYLES[s]} border-transparent ring-2 ring-pink-500`
                  : `${ORDER_STATE_STYLES[s]} border-transparent opacity-50 hover:opacity-100`
              }`}
            >
              {ORDER_STATE_LABELS[s]}
            </button>
          );
        })}
        <label className="inline-flex items-center gap-2 ml-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.onlyIncidencia}
            onChange={(e) => update({ onlyIncidencia: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500"
          />
          <span className="text-xs font-semibold text-red-700 dark:text-red-300">Sólo con incidencia</span>
        </label>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-700">
        <span>Mostrando <span className="font-bold text-gray-900 dark:text-gray-100">{totalShown}</span> de {totalAll} órdenes</span>
        {anyActive && (
          <button onClick={clearAll} className="text-pink-700 dark:text-pink-300 hover:underline font-semibold">
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}

// Listado de órdenes con toggle total/unidad, edición de estado e incidencia
// Definición de columnas disponibles del listado de órdenes.
// `key` es el id estable; `label` lo que ve el user; `default` si se muestra
// al arrancar; `required` si no se puede ocultar (ej: cliente y producto).
const ORDERS_COLUMNS = [
  { key: 'fecha',     label: 'Fecha',     default: true,  required: false },
  { key: 'cliente',   label: 'Cliente',   default: true,  required: true },
  { key: 'producto',  label: 'Producto',  default: true,  required: true },
  { key: 'mentor',    label: 'Equipo',    default: true,  required: false },
  { key: 'cantidad',  label: 'Cant.',     default: true,  required: false },
  { key: 'costo',     label: 'Costo',     default: true,  required: false },
  { key: 'precio',    label: 'Precio venta', default: true, required: false },
  { key: 'comision',  label: 'Com. equipo', default: true, required: false },
  { key: 'profit',    label: 'Profit',    default: true,  required: false },
  { key: 'estado',    label: 'Estado',    default: true,  required: false },
  { key: 'cobro',     label: 'Cobro',     default: true,  required: false },
  { key: 'incidencia', label: 'Incidencia', default: true, required: false },
];

const ORDERS_DEFAULT_VISIBLE = ORDERS_COLUMNS.filter(c => c.default).map(c => c.key);

function OrdersList({ state, dispatch, orders }) {
  const [viewMode, setViewMode] = useState('total'); // 'total' | 'unidad'
  const [incidenciaDraft, setIncidenciaDraft] = useState({}); // { [orderId]: texto }
  const [expanded, setExpanded] = useState(() => new Set());
  // Vista del listado: 'table' | 'cards' | 'kanban'. Persistida en localStorage.
  const [layout, setLayout] = useState(() => {
    if (typeof window === 'undefined') return 'table';
    return localStorage.getItem('viora-layout-orders') || 'table';
  });
  useEffect(() => {
    try { localStorage.setItem('viora-layout-orders', layout); } catch {}
  }, [layout]);

  // Columnas visibles del listado: configurables y persistidas. Las required
  // siempre se incluyen aunque el user las desactive (defensiva).
  const [visibleCols, setVisibleCols] = useState(() => {
    if (typeof window === 'undefined') return new Set(ORDERS_DEFAULT_VISIBLE);
    try {
      const stored = localStorage.getItem('viora-cols-orders');
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    return new Set(ORDERS_DEFAULT_VISIBLE);
  });
  useEffect(() => {
    try { localStorage.setItem('viora-cols-orders', JSON.stringify(Array.from(visibleCols))); } catch {}
  }, [visibleCols]);
  const isColVisible = (key) => {
    const def = ORDERS_COLUMNS.find(c => c.key === key);
    if (def?.required) return true;
    return visibleCols.has(key);
  };
  const ordersToRender = orders ?? state.sales;

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStateChange = (orderId, nuevoEstado) => {
    dispatch({ type: 'UPDATE_ORDER_STATE', payload: { orderId, estado: nuevoEstado } });
  };

  const handlePaymentChange = (orderId, rubro, data) => {
    dispatch({ type: 'UPDATE_ORDER_PAYMENT', payload: { orderId, rubro, data } });
  };

  // Edición inline de una columna de costo. Guarda el valor UNITARIO en
  // order.costsOverride.{key} aunque el usuario haya escrito un total.
  const handleCostEdit = (order, key, newValue, isTotal) => {
    const cantidad = order.cantidad || 1;
    const unitValue = isTotal ? (newValue / cantidad) : newValue;
    const existing = order.costsOverride || {};
    dispatch({
      type: 'UPDATE_ORDER',
      payload: {
        id: order.id,
        patch: { costsOverride: { ...existing, [key]: unitValue } },
      },
    });
  };

  // Edición inline de precio de venta: actualiza montoTotal de la orden.
  // Si el usuario edita en modo unidad, se multiplica por la cantidad.
  const handlePriceEdit = (order, newValue, isTotal) => {
    const cantidad = order.cantidad || 1;
    const newMonto = isTotal ? newValue : newValue * cantidad;
    dispatch({ type: 'UPDATE_ORDER', payload: { id: order.id, patch: { montoTotal: newMonto } } });
  };

  // Edición inline de cantidad: cambia order.cantidad y re-escala montoTotal
  // asumiendo que se mantiene el precio unitario actual (montoTotal / cantidad anterior).
  const handleCantidadEdit = (order, newQty) => {
    const qty = Math.max(1, Math.round(newQty));
    const prevQty = order.cantidad || 1;
    const unitPrice = prevQty > 0 ? (order.montoTotal || 0) / prevQty : 0;
    dispatch({
      type: 'UPDATE_ORDER',
      payload: { id: order.id, patch: { cantidad: qty, montoTotal: Math.round(unitPrice * qty) } },
    });
  };

  // Cobros del cliente: se reemplaza el array completo y el plan de cuotas.
  const handleCobrosChange = (order, patch) => {
    dispatch({ type: 'UPDATE_ORDER', payload: { id: order.id, patch } });
  };

  const handleToggleIncidencia = (order) => {
    const enabling = !order.tieneIncidencia;
    dispatch({
      type: 'UPDATE_ORDER_INCIDENCIA',
      payload: {
        orderId: order.id,
        tieneIncidencia: enabling,
        incidenciaDetalle: enabling ? (incidenciaDraft[order.id] ?? order.incidenciaDetalle ?? '') : '',
      },
    });
  };

  const handleIncidenciaDetalleChange = (order, text) => {
    setIncidenciaDraft(prev => ({ ...prev, [order.id]: text }));
    if (order.tieneIncidencia) {
      dispatch({
        type: 'UPDATE_ORDER_INCIDENCIA',
        payload: { orderId: order.id, tieneIncidencia: true, incidenciaDetalle: text },
      });
    }
  };

  const getClientName = (id) => state.clients.find(c => c.id === id)?.nombre || '-';
  const getMentorName = (id) => state.mentors.find(m => m.id === id)?.nombre || '-';
  const getProduct = (id) => state.products.find(p => p.id === id);

  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Órdenes</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {layout === 'kanban' ? 'Vista kanban agrupada por estado' : `Mostrando valores ${viewMode === 'total' ? 'totales por orden' : 'por unidad'}`}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <LayoutSwitcher
            value={layout}
            onChange={setLayout}
            options={[
              { key: 'table', icon: AlignJustify, label: 'Tabla' },
              { key: 'cards', icon: LayoutGrid, label: 'Cards' },
              { key: 'kanban', icon: Columns3, label: 'Kanban' },
            ]}
          />
          {layout === 'table' && (
            <ColumnPicker
              available={ORDERS_COLUMNS}
              visible={visibleCols}
              onChange={setVisibleCols}
              defaultKeys={ORDERS_DEFAULT_VISIBLE}
            />
          )}
          {layout !== 'kanban' && (
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-1 bg-gray-50 dark:bg-gray-900">
              <button
                type="button"
                onClick={() => setViewMode('total')}
                className={`px-3 py-1.5 text-sm rounded-md transition ${viewMode === 'total' ? 'bg-pink-600 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
              >
                Total
              </button>
              <button
                type="button"
                onClick={() => setViewMode('unidad')}
                className={`px-3 py-1.5 text-sm rounded-md transition ${viewMode === 'unidad' ? 'bg-pink-600 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
              >
                Por unidad
              </button>
            </div>
          )}
        </div>
      </div>

      {layout === 'cards' && (
        <OrdersCardView
          orders={ordersToRender}
          state={state}
          viewMode={viewMode}
          onStateChange={handleStateChange}
          expanded={expanded}
          toggleExpand={toggleExpand}
          handleCobrosChange={handleCobrosChange}
          handlePaymentChange={handlePaymentChange}
          getClientName={getClientName}
          getMentorName={getMentorName}
          getProduct={getProduct}
        />
      )}
      {layout === 'kanban' && (
        <OrdersKanbanView
          orders={ordersToRender}
          state={state}
          onStateChange={handleStateChange}
          getClientName={getClientName}
          getMentorName={getMentorName}
          getProduct={getProduct}
        />
      )}
      {layout === 'table' && (
      <div className="overflow-x-auto orders-table-scroll">
        <table className="w-full text-xs md:text-sm orders-compact-table">
          <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
            <tr className="text-left text-gray-700 dark:text-gray-200">
              <th className="px-2 py-3 w-8"></th>
              {isColVisible('fecha') && <th className="px-4 py-3 font-semibold" title="Fecha de creación de la orden">Fecha</th>}
              {isColVisible('cliente') && <th className="px-4 py-3 font-semibold" title="Cliente que solicitó la orden">Cliente</th>}
              {isColVisible('producto') && <th className="px-4 py-3 font-semibold" title="Producto producido">Producto</th>}
              {isColVisible('mentor') && <th className="px-4 py-3 font-semibold" title="Persona del equipo que refirió al cliente (opcional)">Equipo</th>}
              {isColVisible('cantidad') && <th className="px-4 py-3 font-semibold text-right" title="Unidades a producir. Doble click en la celda para editar.">Cant.</th>}
              {isColVisible('costo') && <th className="px-4 py-3 font-semibold text-right" title="Costo total: contenido + envase + etiqueta. Click en la celda para ver el desglose o cambiar a modo 'sin discriminar'.">Costo</th>}
              {isColVisible('precio') && <th className="px-4 py-3 font-semibold text-right" title="Precio cobrado al cliente. Doble click en la celda para editar.">Precio venta</th>}
              {isColVisible('comision') && <th className="px-4 py-3 font-semibold text-right" title="Comisión que se le paga al equipo (% del profit, configurable en Comisiones)">Com. equipo</th>}
              {isColVisible('profit') && <th className="px-4 py-3 font-semibold text-right" title="Profit del laboratorio = precio venta − costo. NO descuenta la comisión del equipo.">Profit</th>}
              {isColVisible('estado') && <th className="px-4 py-3 font-semibold" title="Estado del pipeline: Pendiente cotización → Cotizado → Abonado → En producción → Listo para enviar → Despachado">Estado</th>}
              {isColVisible('cobro') && <th className="px-4 py-3 font-semibold text-center" title="Progreso de cobro al cliente. Click para ver detalle o registrar pagos.">Cobro</th>}
              {isColVisible('incidencia') && <th className="px-4 py-3 font-semibold" title="Marcá esta orden con incidencia si hay alguna demora o problema.">Incidencia</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {ordersToRender.length === 0 && (
              <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">No hay órdenes que coincidan con los filtros.</td></tr>
            )}
            {ordersToRender.map(order => {
              const product = getProduct(order.productoId);
              const costs = getOrderCosts(order, product);
              const profitTotal = getOrderProfit(order, product);
              const profitUnit = product ? (product.precioVenta - getProductUnitCost(product)) : 0;
              const mentorId = order.mentorId;
              const hasMentor = !!mentorId;
              const mentor = hasMentor ? state.mentors.find(m => m.id === mentorId) : null;
              const commissionTotal = hasMentor ? getMentorCommission(order, product, mentor) : 0;
              const commissionUnit = hasMentor && (order.cantidad || 0) > 0 ? (commissionTotal / (order.cantidad || 1)) : 0;
              const precioVentaUnit = product?.precioVenta || 0;
              const precioVentaTotal = precioVentaUnit * (order.cantidad || 0);

              const isTotal = viewMode === 'total';
              const isOpen = expanded.has(order.id);
              const payments = isOpen ? getOrderPayments(order, product, mentor) : null;
              const cobrosSummary = isOpen ? getOrderCobrosSummary(order) : null;
              // Resumen siempre para mostrar la celda compacta de Cobro
              const cobrosQuick = getOrderCobrosSummary(order);
              return (
                <React.Fragment key={order.id}>
                <tr className={`transition ${order.tieneIncidencia ? 'bg-red-50/40 dark:bg-red-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  <td className="px-2 py-3 text-center">
                    <button
                      onClick={() => toggleExpand(order.id)}
                      className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                      title={isOpen ? 'Ocultar pagos' : 'Ver pagos de esta orden'}
                      aria-label="Expandir fila"
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </td>
                  {isColVisible('fecha') && <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">{order.fecha}</td>}
                  {isColVisible('cliente') && <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{getClientName(order.clienteId)}</td>}
                  {isColVisible('producto') && <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{product?.nombre || '-'}</td>}
                  {isColVisible('mentor') && (
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {hasMentor ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold text-[10px] flex items-center justify-center">
                            {(mentor?.nombre || 'M').charAt(0).toUpperCase()}
                          </span>
                          <span className="text-sm">{mentor?.nombre}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                      )}
                    </td>
                  )}
                  {isColVisible('cantidad') && (
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">
                      <EditableCell
                        value={order.cantidad}
                        onSave={(v) => handleCantidadEdit(order, v)}
                        prefix=""
                        title="Doble click para editar cantidad"
                      />
                    </td>
                  )}
                  {isColVisible('costo') && (
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                      <CostBreakdownCell
                        order={order}
                        product={product}
                        costs={costs}
                        isTotal={isTotal}
                        onUpdateProduct={(patch) => dispatch({ type: 'UPDATE_PRODUCT', payload: { id: product?.id, patch } })}
                        onOverrideContenido={(v) => handleCostEdit(order, 'contenido', v, isTotal)}
                        onOverrideEnvase={(v) => handleCostEdit(order, 'envase', v, isTotal)}
                        onOverrideEtiqueta={(v) => handleCostEdit(order, 'etiqueta', v, isTotal)}
                        onSetFlat={(v) => dispatch({ type: 'UPDATE_ORDER', payload: { id: order.id, patch: { costoSinDesglosar: v } } })}
                        onClearFlat={() => dispatch({ type: 'UPDATE_ORDER', payload: { id: order.id, patch: { costoSinDesglosar: null } } })}
                      />
                    </td>
                  )}
                  {isColVisible('precio') && (
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                      <EditableCell
                        value={isTotal ? precioVentaTotal : precioVentaUnit}
                        onSave={(v) => handlePriceEdit(order, v, isTotal)}
                        prefix="$"
                      />
                    </td>
                  )}
                  {isColVisible('comision') && (
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                      {hasMentor ? fmtMoney(isTotal ? commissionTotal : commissionUnit) : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                  )}
                  {isColVisible('profit') && (
                    <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(isTotal ? profitTotal : profitUnit)}</td>
                  )}
                  {isColVisible('estado') && (
                    <td className="px-4 py-3">
                      <select
                        value={order.estado || 'pendiente-cotizacion'}
                        onChange={(e) => handleStateChange(order.id, e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-500 ${ORDER_STATE_STYLES[order.estado || 'pendiente-cotizacion']}`}
                      >
                        {ORDER_STATES.map(s => (
                          <option key={s} value={s} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">{ORDER_STATE_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {isColVisible('cobro') && (
                    <td className="px-4 py-3">
                      <CobroMiniCell
                        summary={cobrosQuick}
                        onClick={() => toggleExpand(order.id)}
                      />
                    </td>
                  )}
                  {isColVisible('incidencia') && (
                    <td className="px-3 py-2 min-w-[180px]">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={!!order.tieneIncidencia}
                          onChange={() => handleToggleIncidencia(order)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500"
                          title="Marcar incidencia"
                        />
                        <input
                          type="text"
                          value={incidenciaDraft[order.id] ?? order.incidenciaDetalle ?? ''}
                          onChange={(e) => handleIncidenciaDetalleChange(order, e.target.value)}
                          placeholder={order.tieneIncidencia ? 'Motivo...' : 'Motivo (tildá para activar)'}
                          className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>
                    </td>
                  )}
                </tr>
                {isOpen && payments && cobrosSummary && (
                  <tr className="bg-gray-50 dark:bg-gray-900/40">
                    <td colSpan={13} className="px-4 md:px-6 py-3">
                      <OrderExpansion
                        order={order}
                        cobrosSummary={cobrosSummary}
                        payments={payments}
                        mentorNombre={hasMentor ? getMentorName(mentorId) : null}
                        onCobrosChange={(patch) => handleCobrosChange(order, patch)}
                        onPaymentChange={(rubro, data) => handlePaymentChange(order.id, rubro, data)}
                        onIncidenciaChange={(patch) => dispatch({ type: 'UPDATE_ORDER_INCIDENCIA', payload: { orderId: order.id, ...patch } })}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// Switcher visual para elegir vista (tabla / cards / kanban / etc).
// Recibe `value`, `onChange` y un array de `{ key, icon, label }`.
// Picker de columnas visibles. Botón con ícono Filter que abre un dropdown
// con checkboxes para cada columna disponible. Tiene botón "Restablecer"
// para volver al default. Las columnas marcadas como required no pueden
// ocultarse (ej: cliente y producto en órdenes).
function ColumnPicker({ available, visible, onChange, defaultKeys }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (key) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };

  const reset = () => onChange(new Set(defaultKeys));

  const customCount = available.filter(c => !c.required).length;
  const visibleCustomCount = available.filter(c => !c.required && visible.has(c.key)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Mostrar / ocultar columnas"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-pink-400 dark:hover:border-pink-500 transition"
      >
        <Filter size={14} />
        <span className="hidden sm:inline">Columnas</span>
        <span className="text-[10px] font-bold px-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tabular-nums">
          {visibleCustomCount}/{customCount}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-2 animate-scale-in" style={{ transformOrigin: 'top right' }}>
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Columnas visibles</p>
            <button
              onClick={reset}
              className="text-[11px] text-pink-700 dark:text-pink-300 hover:underline font-semibold"
              title="Restablecer al default"
            >
              Restablecer
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {available.map(col => {
              const checked = col.required || visible.has(col.key);
              return (
                <label
                  key={col.key}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition cursor-pointer ${col.required ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={col.required}
                    onChange={() => toggle(col.key)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-pink-600 focus:ring-pink-500"
                  />
                  <span className="flex-1 text-gray-800 dark:text-gray-200">{col.label}</span>
                  {col.required && <span className="text-[9px] uppercase text-gray-400">fija</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LayoutSwitcher({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-1 bg-gray-50 dark:bg-gray-900">
      {options.map(opt => {
        const Icon = opt.icon;
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            title={opt.label}
            className={`p-1.5 rounded-md transition ${
              active
                ? 'bg-pink-600 text-white shadow'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

// Vista de cards para el listado de órdenes. Cada card muestra lo esencial
// con estado destacado, mentor, cantidad, precio y progreso de cobro.
// Click en la card expande el panel de detalle (cobros + pagos).
function OrdersCardView({ orders, state, viewMode, onStateChange, expanded, toggleExpand, handleCobrosChange, handlePaymentChange, getClientName, getMentorName, getProduct }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  if (!orders || orders.length === 0) {
    return <div className="p-10 text-center text-gray-500 dark:text-gray-400">No hay órdenes que coincidan con los filtros.</div>;
  }
  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {orders.map(order => {
        const product = getProduct(order.productoId);
        const mentor = order.mentorId ? state.mentors.find(m => m.id === order.mentorId) : null;
        const estado = order.estado || 'pendiente-cotizacion';
        const isTotal = viewMode === 'total';
        const cantidad = order.cantidad || 0;
        const precioVentaUnit = product?.precioVenta || 0;
        const precioVentaTotal = (order.montoTotal != null ? order.montoTotal : precioVentaUnit * cantidad);
        const profitTotal = getOrderProfit(order, product);
        const commissionTotal = mentor ? getMentorCommission(order, product, mentor) : 0;
        const cobros = getOrderCobrosSummary(order);
        const isOpen = expanded.has(order.id);
        return (
          <div
            key={order.id}
            className={`relative rounded-xl border p-4 flex flex-col gap-2 transition-all hover:shadow-lg ${
              order.tieneIncidencia
                ? 'bg-red-50/40 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
            }`}
          >
            {order.tieneIncidencia && (
              <span className="absolute top-2 right-2 text-[10px] font-bold text-red-600 dark:text-red-400" title={order.incidenciaDetalle || 'Incidencia'}>⚠</span>
            )}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{order.fecha}</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{getClientName(order.clienteId)}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{product?.nombre || '-'} · {cantidad} u.</p>
              </div>
              <select
                value={estado}
                onChange={(e) => onStateChange(order.id, e.target.value)}
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-500 ${ORDER_STATE_STYLES[estado]}`}
              >
                {ORDER_STATES.map(s => (
                  <option key={s} value={s} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">{ORDER_STATE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100 dark:border-gray-700">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Precio venta</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(isTotal ? precioVentaTotal : precioVentaUnit)}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Profit</p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(isTotal ? profitTotal : (cantidad > 0 ? profitTotal / cantidad : 0))}</p>
              </div>
              {mentor && (
                <>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Mentor</p>
                    <p className="text-gray-900 dark:text-gray-100 truncate">{mentor.nombre}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Com.</p>
                    <p className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(isTotal ? commissionTotal : (cantidad > 0 ? commissionTotal / cantidad : 0))}</p>
                  </div>
                </>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] mt-1">
                <span className="text-gray-500 dark:text-gray-400">Cobrado</span>
                <span className={`font-semibold tabular-nums ${cobros.saldo <= 0 && cobros.total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {cobros.saldo <= 0 && cobros.total > 0 ? 'Saldada' : `${cobros.porcentaje}%`}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-1">
                <div
                  className={`h-full transition-all ${cobros.saldo <= 0 && cobros.total > 0 ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
                  style={{ width: `${Math.min(100, cobros.porcentaje)}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggleExpand(order.id)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-pink-700 dark:text-pink-300 hover:underline self-start"
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {isOpen ? 'Ocultar detalle' : 'Ver cobros y pagos'}
            </button>
            {isOpen && product && (
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-4">
                <CobrosPanel
                  order={order}
                  summary={cobros}
                  onChange={(patch) => handleCobrosChange(order, patch)}
                />
                <PaymentsPanel
                  order={order}
                  payments={getOrderPayments(order, product, mentor)}
                  mentorNombre={mentor?.nombre || null}
                  onChange={(rubro, data) => handlePaymentChange(order.id, rubro, data)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Vista kanban agrupada por estado del pipeline. Cada columna es un estado
// y cada card una orden minimalista. Cambiar el estado desde el dropdown
// "mueve" la orden a otra columna.
function OrdersKanbanView({ orders, state, onStateChange, getClientName, getMentorName, getProduct }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const byState = ORDER_STATES.reduce((acc, s) => { acc[s] = []; return acc; }, {});
  orders.forEach(o => {
    const s = o.estado || 'pendiente-cotizacion';
    if (!byState[s]) byState[s] = [];
    byState[s].push(o);
  });
  return (
    <div className="p-4 overflow-x-auto">
      <div className="flex gap-3 min-w-max">
        {ORDER_STATES.map(s => {
          const ordersInState = byState[s] || [];
          const total = ordersInState.reduce((sum, o) => sum + (o.montoTotal || 0), 0);
          return (
            <div key={s} className="w-72 shrink-0 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ORDER_STATE_STYLES[s]}`}>
                  {ORDER_STATE_LABELS[s]}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold">
                  {ordersInState.length} · {fmtMoney(total)}
                </span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {ordersInState.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">Vacío</p>
                ) : (
                  ordersInState.map(order => {
                    const product = getProduct(order.productoId);
                    const cobros = getOrderCobrosSummary(order);
                    return (
                      <div
                        key={order.id}
                        className={`rounded-lg p-2.5 shadow-sm border text-xs ${
                          order.tieneIncidencia
                            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{getClientName(order.clienteId)}</p>
                            <p className="text-gray-500 dark:text-gray-400 truncate">{product?.nombre || '-'} · {order.cantidad}u</p>
                          </div>
                          {order.tieneIncidencia && <span className="text-red-600 dark:text-red-400" title={order.incidenciaDetalle || 'Incidencia'}>⚠</span>}
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                          <span className="text-gray-500 dark:text-gray-400">{order.fecha}</span>
                          <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(order.montoTotal || 0)}</span>
                        </div>
                        <div className="mt-1.5 w-full h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div
                            className={`h-full transition-all ${cobros.saldo <= 0 && cobros.total > 0 ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
                            style={{ width: `${Math.min(100, cobros.porcentaje)}%` }}
                          />
                        </div>
                        <select
                          value={order.estado || 'pendiente-cotizacion'}
                          onChange={(e) => onStateChange(order.id, e.target.value)}
                          className="mt-2 w-full text-[10px] font-semibold px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-300 cursor-pointer focus:outline-none focus:ring-1 focus:ring-pink-500"
                          title="Mover a otro estado"
                        >
                          {ORDER_STATES.map(st => (
                            <option key={st} value={st} className="bg-white dark:bg-gray-800">{ORDER_STATE_LABELS[st]}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Banner con frase del día y saludo — algo cálido arriba del dashboard.
// La frase rota una vez por día (usando día del año como semilla).
function DailyQuoteBanner() {
  const now = new Date();
  const hour = now.getHours();
  const saludo = hour < 6 ? 'Buena madrugada'
    : hour < 12 ? 'Buen día'
    : hour < 20 ? 'Buenas tardes'
    : 'Buenas noches';
  const fecha = now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const frase = getDailyQuote(now);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200/50 dark:border-amber-700/30 bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 dark:from-gray-900 dark:via-gray-800/50 dark:to-gray-900 p-5 animate-fade-in-up">
      {/* Decoración dorada sutil */}
      <div
        aria-hidden="true"
        className="absolute -right-12 -top-12 w-40 h-40 rounded-full bg-gradient-to-br from-amber-200/40 to-rose-200/20 dark:from-amber-500/10 dark:to-rose-500/10 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="absolute -left-16 -bottom-16 w-48 h-48 rounded-full bg-gradient-to-tr from-rose-200/30 to-amber-100/20 dark:from-rose-500/10 dark:to-amber-500/5 blur-2xl"
      />
      <div className="relative flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-[#4a0f22] flex items-center justify-center shadow">
          <Sparkles size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-amber-700 dark:text-amber-300 font-semibold">
            {saludo} · <span className="capitalize">{fecha}</span>
          </p>
          <p className="mt-1 text-lg md:text-xl font-light italic text-gray-800 dark:text-gray-100 leading-snug" style={{ fontFamily: "'Allura', 'Brush Script MT', cursive" }}>
            “{frase}”
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, delay = 0, onClick, active = false, tooltip = null }) {
  // Si el value es una cadena con formato $X.XXX, intentamos animarlo.
  // Si no, lo mostramos tal cual (soporta números crudos también).
  const numeric = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[^\d.-]/g, ''));
  const hasNumber = !Number.isNaN(numeric);
  const animated = useCountUp(hasNumber ? numeric : 0, 900);
  const prefix = typeof value === 'string' && value.startsWith('$') ? '$' : '';
  const displayValue = hasNumber
    ? `${prefix}${Math.round(animated).toLocaleString()}`
    : value;

  // Ajustamos el font-size al largo del string para que siempre entre
  // en el ancho de la card sin truncarse. Mapeo empírico simple.
  const valueLength = String(displayValue).length;
  const valueSizeClass = valueLength >= 13
    ? 'text-base md:text-lg'
    : valueLength >= 11
      ? 'text-lg md:text-xl'
      : valueLength >= 9
        ? 'text-xl md:text-2xl'
        : 'text-2xl md:text-3xl';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      title={tooltip || undefined}
      type={onClick ? 'button' : undefined}
      className={`group relative text-left bg-gradient-to-br ${color} text-white rounded-2xl shadow-lg p-5 overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl animate-fade-in-up ${
        onClick ? 'cursor-pointer' : ''
      } ${active ? 'ring-2 ring-white/70 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-900 scale-[1.02]' : ''}`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      {/* Efecto shimmer sutil sobre gradiente */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:200%_100%] animate-shimmer"
      />
      {/* Halo glass atrás del ícono */}
      <div aria-hidden="true" className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/20 blur-2xl" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
          <p className={`${valueSizeClass} font-bold mt-1.5 tabular-nums break-words leading-tight`}>{displayValue}</p>
        </div>
        <div className="shrink-0 p-1.5 rounded-xl bg-white/10 backdrop-blur-sm">
          <Icon size={18} className="opacity-90" />
        </div>
      </div>
      {active && (
        <p className="relative text-[10px] uppercase tracking-wider font-bold mt-2 opacity-90">Filtrando ·</p>
      )}
    </Wrapper>
  );
}

// Modal reutilizable para registrar una nueva venta/orden. Se usa desde
// VentasSection y desde InicioSection para dejar la creación a un click
// sin tener que navegar a otra sección.
function NewSaleModal({ state, onAddSale, onQuickAddClient, onQuickAddProduct, onClose }) {
  const [formData, setFormData] = useState({ clienteId: '', productoId: '', cantidad: 1, mentorId: '', mentorPresupuesto: '' });
  const [showClientQuickModal, setShowClientQuickModal] = useState(false);
  const [showProductQuickModal, setShowProductQuickModal] = useState(false);

  // Cálculos derivados para sugerir el presupuesto del mentor al cargar la venta.
  const productoSel = state.products.find(p => p.id === parseInt(formData.productoId));
  const cantidadNum = parseInt(formData.cantidad) || 0;
  const profitSugerido = productoSel ? (productoSel.precioVenta - getProductUnitCost(productoSel)) * cantidadNum : 0;
  const mentorSugerido = Math.max(0, Math.round(profitSugerido * 0.5));

  const [presupuestoTouched, setPresupuestoTouched] = useState(false);
  useEffect(() => {
    if (!presupuestoTouched) {
      setFormData(prev => ({ ...prev, mentorPresupuesto: prev.mentorId ? String(mentorSugerido) : '' }));
    }
  }, [formData.mentorId, formData.productoId, formData.cantidad, mentorSugerido, presupuestoTouched]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const producto = state.products.find(p => p.id === parseInt(formData.productoId));
    if (!producto) return;
    const cantidad = parseInt(formData.cantidad) || 1;
    const mentorId = formData.mentorId ? parseInt(formData.mentorId) : null;
    const presupuestoParsed = formData.mentorPresupuesto === ''
      ? null
      : parseFloat(formData.mentorPresupuesto);
    const newSale = {
      fecha: new Date().toISOString().split('T')[0],
      clienteId: parseInt(formData.clienteId),
      productoId: parseInt(formData.productoId),
      cantidad,
      montoTotal: producto.precioVenta * cantidad,
      mentorId,
      mentorPresupuesto: mentorId && presupuestoParsed != null && !Number.isNaN(presupuestoParsed)
        ? presupuestoParsed
        : null,
    };
    onAddSale(newSale);
  };

  const handleQuickClientCreated = (clientData) => {
    const newClient = onQuickAddClient(clientData);
    setFormData(prev => ({
      ...prev,
      clienteId: String(newClient.id),
      mentorId: newClient.mentorId ? String(newClient.mentorId) : prev.mentorId,
    }));
    setPresupuestoTouched(false);
    setShowClientQuickModal(false);
  };

  const handleQuickProductCreated = (productData) => {
    const newProduct = onQuickAddProduct(productData);
    setFormData(prev => ({ ...prev, productoId: String(newProduct.id) }));
    setShowProductQuickModal(false);
  };

  return (
    <>
      <Modal title="Registrar Nueva Orden" onClose={onClose}>
        <NewSaleFormContent
          state={state}
          formData={formData}
          setFormData={setFormData}
          handleSubmit={handleSubmit}
          mentorSugerido={mentorSugerido}
          presupuestoTouched={presupuestoTouched}
          setPresupuestoTouched={setPresupuestoTouched}
          openQuickClient={() => setShowClientQuickModal(true)}
          openQuickProduct={() => setShowProductQuickModal(true)}
        />
      </Modal>

      {showClientQuickModal && (
        <QuickClientModal
          mentors={state.mentors}
          onClose={() => setShowClientQuickModal(false)}
          onCreate={handleQuickClientCreated}
        />
      )}

      {showProductQuickModal && (
        <QuickProductModal
          onClose={() => setShowProductQuickModal(false)}
          onCreate={handleQuickProductCreated}
        />
      )}
    </>
  );
}

// Solo los campos del form — extraído para no duplicar el JSX.
function NewSaleFormContent({ state, formData, setFormData, handleSubmit, mentorSugerido, presupuestoTouched, setPresupuestoTouched, openQuickClient, openQuickProduct }) {
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <FormLabel required>Cliente</FormLabel>
        <div className="flex gap-2">
          <select
            value={formData.clienteId}
            onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
          >
            <option value="">Seleccionar Cliente</option>
            {state.clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button
            type="button"
            onClick={openQuickClient}
            className="inline-flex items-center gap-1 px-3 py-2 border border-pink-600 text-pink-700 dark:text-pink-300 dark:border-pink-500 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm font-semibold whitespace-nowrap"
            title="Crear un nuevo cliente sin salir de esta pantalla"
          >
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      <div>
        <FormLabel required>Producto</FormLabel>
        <div className="flex gap-2">
          <select
            value={formData.productoId}
            onChange={(e) => setFormData({ ...formData, productoId: e.target.value })}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
          >
            <option value="">Seleccionar Producto</option>
            {state.products.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <button
            type="button"
            onClick={openQuickProduct}
            className="inline-flex items-center gap-1 px-3 py-2 border border-pink-600 text-pink-700 dark:text-pink-300 dark:border-pink-500 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm font-semibold whitespace-nowrap"
            title="Crear un nuevo producto sin salir de esta pantalla"
          >
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      <div>
        <FormLabel required tip="Mínimo 100 unidades por producción.">Cantidad</FormLabel>
        <input
          type="number"
          min="1"
          value={formData.cantidad}
          onChange={(e) => setFormData({ ...formData, cantidad: e.target.value })}
          placeholder="Cantidad"
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          required
        />
      </div>

      <div>
        <FormLabel tip="Si hay mentor, cobrará comisión sobre el profit (%) o el presupuesto fijo que pongas abajo.">Mentor asignado</FormLabel>
        <select
          value={formData.mentorId}
          onChange={(e) => { setFormData({ ...formData, mentorId: e.target.value }); setPresupuestoTouched(false); }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
        >
          <option value="">Sin mentor</option>
          {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>

      {formData.mentorId && (
        <div>
          <FormLabel tip="Monto FIJO que se paga al mentor por esta orden. Si lo dejás vacío, usa el % configurado en Comisiones.">
            Presupuesto para el mentor
            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
              · sugerido ${mentorSugerido.toLocaleString()}
            </span>
          </FormLabel>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">$</span>
              <input
                type="number"
                min="0"
                value={formData.mentorPresupuesto}
                onChange={(e) => { setFormData({ ...formData, mentorPresupuesto: e.target.value }); setPresupuestoTouched(true); }}
                placeholder={String(mentorSugerido)}
                className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            {presupuestoTouched && (
              <button
                type="button"
                onClick={() => { setFormData({ ...formData, mentorPresupuesto: String(mentorSugerido) }); setPresupuestoTouched(false); }}
                className="text-xs text-pink-700 dark:text-pink-300 hover:underline font-semibold whitespace-nowrap"
                title="Restaurar al 50% sugerido"
              >
                Usar 50%
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Este será el monto fijo que se le paga al mentor por esta orden.</p>
        </div>
      )}

      <button
        type="submit"
        className="w-full bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
      >
        Registrar Orden
      </button>
    </form>
  );
}

function VentasSection({ state, onAddSale, onQuickAddClient, onQuickAddProduct, showModal, setShowModal }) {
  const getClientName = (clienteId) => state.clients.find(c => c.id === clienteId)?.nombre || '-';
  const getProductName = (productoId) => state.products.find(p => p.id === productoId)?.nombre || '-';
  const getMentorName = (mentorId) => state.mentors.find(m => m.id === mentorId)?.nombre || '-';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestión de Ventas</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-pink-900 text-white px-6 py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
        >
          <Plus size={20} /> Nueva Orden
        </button>
      </div>

      {showModal && (
        <NewSaleModal
          state={state}
          onAddSale={(data) => { onAddSale(data); setShowModal(false); }}
          onQuickAddClient={onQuickAddClient}
          onQuickAddProduct={onQuickAddProduct}
          onClose={() => setShowModal(false)}
        />
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Fecha</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Cliente</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Producto</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Cantidad</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Monto Total</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Mentor</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Comisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {state.sales.map(sale => (
                <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{sale.fecha}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getClientName(sale.clienteId)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getProductName(sale.productoId)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{sale.cantidad}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">${sale.montoTotal.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getMentorName(sale.mentorId)}</td>
                  <td className="px-6 py-4 text-sm"><Badge text={sale.estadoComision} type={sale.estadoComision === 'pagada' ? 'success' : 'warning'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProductosSection({ state, onAddProduct, showModal, setShowModal, calculateMargin }) {
  // modoCosto: 'total' (un único número) | 'desglose' (contenido/envase/etiqueta).
  // La mayoría de los casos usa 'total' porque el proveedor entrega todo junto.
  // costoInformado es lo que le informamos al mentor (puede ser distinto al real).
  const [formData, setFormData] = useState({
    nombre: '', descripcion: '',
    modoCosto: 'total',
    costoTotal: '',
    costoContenido: '', costoEnvase: '', costoEtiqueta: '',
    usaCostoInformado: false,
    costoInformado: '',
    precioVenta: '',
  });
  const [expanded, setExpanded] = useState(() => new Set());
  const [layout, setLayout] = useState(() => {
    if (typeof window === 'undefined') return 'cards';
    return localStorage.getItem('viora-layout-products') || 'cards';
  });
  useEffect(() => {
    try { localStorage.setItem('viora-layout-products', layout); } catch {}
  }, [layout]);

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getClientById = (id) => state.clients.find(c => c.id === id);

  // Estadísticas de relación producto → clientes y órdenes
  const getProductStats = (productId) => {
    const orders = state.sales.filter(s => s.productoId === productId);
    const totalUnidades = orders.reduce((sum, o) => sum + (o.cantidad || 0), 0);
    const totalFacturado = orders.reduce((sum, o) => sum + (o.montoTotal || 0), 0);
    // Clientes que lo pidieron (con su cantidad total comprada de este producto)
    const byClient = new Map();
    orders.forEach(o => {
      const prev = byClient.get(o.clienteId) || { clienteId: o.clienteId, ordenes: 0, unidades: 0 };
      prev.ordenes += 1;
      prev.unidades += (o.cantidad || 0);
      byClient.set(o.clienteId, prev);
    });
    const clientesBreakdown = Array.from(byClient.values())
      .sort((a, b) => b.unidades - a.unidades);
    return { orders, totalUnidades, totalFacturado, clientesBreakdown };
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      nombre: formData.nombre,
      descripcion: formData.descripcion,
      precioVenta: parseInt(formData.precioVenta) || 0,
    };
    if (formData.modoCosto === 'total') {
      // Modo simple: un único número. Se guarda en costoSinDesglosar y los
      // 3 campos desglosados se dejan en 0 (no se usan en los cálculos).
      payload.costoSinDesglosar = parseFloat(formData.costoTotal) || 0;
      payload.costoContenido = 0;
      payload.costoEnvase = 0;
      payload.costoEtiqueta = 0;
    } else {
      // Modo desglose: los 3 campos separados, costoSinDesglosar queda null.
      payload.costoContenido = parseInt(formData.costoContenido) || 0;
      payload.costoEnvase = parseInt(formData.costoEnvase) || 0;
      payload.costoEtiqueta = parseInt(formData.costoEtiqueta) || 0;
      payload.costoSinDesglosar = null;
    }
    // Costo informado: si no se activó el toggle, queda null (= el mentor ve
    // el costo interno real). Si se activó, guardamos el valor.
    payload.costoInformado = formData.usaCostoInformado
      ? (parseFloat(formData.costoInformado) || 0)
      : null;
    onAddProduct(payload);
    setFormData({
      nombre: '', descripcion: '',
      modoCosto: 'total',
      costoTotal: '',
      costoContenido: '', costoEnvase: '', costoEtiqueta: '',
      usaCostoInformado: false,
      costoInformado: '',
      precioVenta: '',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Catálogo de Productos</h2>
        <div className="flex items-center gap-2">
          <LayoutSwitcher
            value={layout}
            onChange={setLayout}
            options={[
              { key: 'cards', icon: LayoutGrid, label: 'Cards' },
              { key: 'table', icon: AlignJustify, label: 'Tabla' },
              { key: 'compact', icon: Menu, label: 'Compacta' },
            ]}
          />
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-pink-900 text-white px-4 py-2 rounded-lg hover:bg-pink-800 transition font-semibold text-sm"
          >
            <Plus size={18} /> Nuevo Producto
          </button>
        </div>
      </div>

      {showModal && (
        <Modal title="Agregar Nuevo Producto" onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <FormLabel required tip="Cómo aparece en el catálogo y en los listados.">Nombre</FormLabel>
              <input
                type="text"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Nombre del producto"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>
            <div>
              <FormLabel tip="Ej: 'Crema hidratante para piel seca'. Sirve para distinguir entre productos similares.">Descripción</FormLabel>
              <input
                type="text"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                placeholder="Descripción"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            <div>
              <FormLabel required tip="Lo que te cuesta producir una unidad. Si querés, podés desglosarlo en contenido / envase / etiqueta; pero en la mayoría de los casos alcanza con un solo número.">
                Costo del producto (por unidad)
              </FormLabel>

              {/* Tabs: costo total vs desglosado */}
              <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg mb-3">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, modoCosto: 'total' })}
                  className={`flex-1 py-1.5 text-xs rounded-md transition font-semibold ${
                    formData.modoCosto === 'total'
                      ? 'bg-white dark:bg-gray-800 text-pink-900 dark:text-pink-300 shadow'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  Costo total
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, modoCosto: 'desglose' })}
                  className={`flex-1 py-1.5 text-xs rounded-md transition font-semibold ${
                    formData.modoCosto === 'desglose'
                      ? 'bg-white dark:bg-gray-800 text-pink-900 dark:text-pink-300 shadow'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  Desglosado
                </button>
              </div>

              {formData.modoCosto === 'total' ? (
                <input
                  type="number"
                  step="0.01"
                  value={formData.costoTotal}
                  onChange={(e) => setFormData({ ...formData, costoTotal: e.target.value })}
                  placeholder="Ej. 120"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Contenido</label>
                    <input
                      type="number"
                      value={formData.costoContenido}
                      onChange={(e) => setFormData({ ...formData, costoContenido: e.target.value })}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Envase / pote</label>
                    <input
                      type="number"
                      value={formData.costoEnvase}
                      onChange={(e) => setFormData({ ...formData, costoEnvase: e.target.value })}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Etiqueta</label>
                    <input
                      type="number"
                      value={formData.costoEtiqueta}
                      onChange={(e) => setFormData({ ...formData, costoEtiqueta: e.target.value })}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Costo informado al mentor (opcional). Si está seteado, el mentor
                ve ESTE valor en lugar del costo real y su comisión se calcula
                sobre (precio - costoInformado). */}
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.usaCostoInformado}
                  onChange={(e) => setFormData({ ...formData, usaCostoInformado: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded accent-pink-600"
                />
                <div className="flex-1">
                  <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">Costo informado distinto al real</span>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300/80 mt-0.5">
                    Lo que el mentor ve como "costo del producto". La comisión del mentor se calcula sobre este valor, no sobre el costo real.
                  </p>
                </div>
              </label>
              {formData.usaCostoInformado && (
                <input
                  type="number"
                  step="0.01"
                  value={formData.costoInformado}
                  onChange={(e) => setFormData({ ...formData, costoInformado: e.target.value })}
                  placeholder="Costo informado por unidad"
                  className="w-full mt-2 px-3 py-2 border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              )}
            </div>
            <div>
              <FormLabel required tip="El precio por unidad que le cobrás al cliente.">Precio de venta unitario</FormLabel>
              <input
                type="number"
                value={formData.precioVenta}
                onChange={(e) => setFormData({ ...formData, precioVenta: e.target.value })}
                placeholder="0"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
            >
              Agregar Producto
            </button>
          </form>
        </Modal>
      )}

      {layout === 'table' && (
        <ProductosTableView
          products={state.products}
          sales={state.sales}
          clients={state.clients}
          calculateMargin={calculateMargin}
          expanded={expanded}
          toggleExpand={toggleExpand}
        />
      )}
      {layout === 'compact' && (
        <ProductosCompactView
          products={state.products}
          sales={state.sales}
          calculateMargin={calculateMargin}
        />
      )}
      {layout === 'cards' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {state.products.map(product => {
          const unitCost = getProductUnitCost(product);
          const isOpen = expanded.has(product.id);
          const stats = isOpen ? getProductStats(product.id) : null;
          return (
          <div key={product.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 hover:shadow-xl transition">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{product.nombre}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{product.descripcion || <span className="italic text-gray-400 dark:text-gray-500">Sin descripción</span>}</p>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Contenido:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">${product.costoContenido?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Envase:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">${product.costoEnvase?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Etiqueta:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">${product.costoEtiqueta?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2">
                <span className="text-gray-600 dark:text-gray-400 font-semibold">Costo total unitario:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">${unitCost.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Precio Venta:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">${product.precioVenta?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Margen:</span>
                <span className="font-semibold text-green-600 dark:text-green-400">{calculateMargin(unitCost, product.precioVenta)}%</span>
              </div>
            </div>
            <button
              onClick={() => toggleExpand(product.id)}
              className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/30 transition rounded-md py-2 border border-pink-200 dark:border-pink-800"
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {isOpen ? 'Ocultar clientes' : 'Ver clientes que lo pidieron'}
            </button>
            {isOpen && stats && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md p-2">
                    <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Órdenes</p>
                    <p className="font-bold text-gray-900 dark:text-gray-100">{stats.orders.length}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md p-2">
                    <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Unid. producidas</p>
                    <p className="font-bold text-gray-900 dark:text-gray-100">{stats.totalUnidades.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md p-2">
                    <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Facturado</p>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">${Math.round(stats.totalFacturado).toLocaleString()}</p>
                  </div>
                </div>
                {stats.clientesBreakdown.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic text-center">Aún nadie pidió este producto.</p>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Clientes que lo pidieron</p>
                    <ul className="space-y-1">
                      {stats.clientesBreakdown.map(row => {
                        const client = getClientById(row.clienteId);
                        return (
                          <li key={row.clienteId} className="flex justify-between text-xs border-b border-gray-100 dark:border-gray-700 pb-1 last:border-0">
                            <span className="text-gray-900 dark:text-gray-100">{client?.nombre || 'Cliente eliminado'}</span>
                            <span className="text-gray-600 dark:text-gray-400">{row.unidades.toLocaleString()} u · {row.ordenes} {row.ordenes === 1 ? 'orden' : 'órdenes'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// Vista tabla del catálogo de productos. Muestra los 3 costos desglosados,
// precio venta, margen y cantidad de órdenes históricas por producto.
function ProductosTableView({ products, sales, clients, calculateMargin, expanded, toggleExpand }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const countOrders = (productId) => sales.filter(s => s.productoId === productId).length;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
            <tr className="text-left text-gray-700 dark:text-gray-200">
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Descripción</th>
              <th className="px-4 py-3 font-semibold text-right">Contenido</th>
              <th className="px-4 py-3 font-semibold text-right">Envase</th>
              <th className="px-4 py-3 font-semibold text-right">Etiqueta</th>
              <th className="px-4 py-3 font-semibold text-right">Costo total</th>
              <th className="px-4 py-3 font-semibold text-right">Precio venta</th>
              <th className="px-4 py-3 font-semibold text-right">Margen</th>
              <th className="px-4 py-3 font-semibold text-right">Órdenes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {products.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no hay productos cargados.</td></tr>
            )}
            {products.map(product => {
              const unitCost = getProductUnitCost(product);
              const margen = calculateMargin(unitCost, product.precioVenta);
              const ordenes = countOrders(product.id);
              return (
                <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{product.nombre}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-xs truncate">{product.descripcion || <span className="italic text-gray-400 dark:text-gray-500">Sin descripción</span>}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(getContenidoUnitCost(product))}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(product.costoEnvase || 0)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(product.costoEtiqueta || 0)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(unitCost)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(product.precioVenta)}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{margen}%</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{ordenes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Vista compacta: una línea por producto con solo lo esencial.
// Buena para catálogos grandes donde querés scanear rápido.
function ProductosCompactView({ products, sales, calculateMargin }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const countOrders = (productId) => sales.filter(s => s.productoId === productId).length;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
      {products.length === 0 && (
        <div className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no hay productos cargados.</div>
      )}
      {products.map(product => {
        const unitCost = getProductUnitCost(product);
        const margen = calculateMargin(unitCost, product.precioVenta);
        const ordenes = countOrders(product.id);
        return (
          <div key={product.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{product.nombre}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{product.descripcion || <span className="italic">Sin descripción</span>}</p>
            </div>
            <div className="flex items-center gap-4 text-xs tabular-nums shrink-0">
              <div className="text-right">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Costo</p>
                <p className="font-semibold text-gray-700 dark:text-gray-300">{fmtMoney(unitCost)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Precio</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(product.precioVenta)}</p>
              </div>
              <div className="text-right min-w-[48px]">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Margen</p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400">{margen}%</p>
              </div>
              <div className="text-right min-w-[52px]">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Órdenes</p>
                <p className="font-semibold text-gray-700 dark:text-gray-300">{ordenes}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClientesSection({ state, onAddClient, onUpdateClient, showModal, setShowModal }) {
  const emptyForm = { nombre: '', telefono: '', domicilio: '', mentorId: '', totalCompras: '', unidadesProducidas: '' };
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [layout, setLayout] = useState(() => {
    if (typeof window === 'undefined') return 'table';
    return localStorage.getItem('viora-layout-clients') || 'table';
  });
  useEffect(() => {
    try { localStorage.setItem('viora-layout-clients', layout); } catch {}
  }, [layout]);

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getClientOrders = (clientId) => state.sales.filter(s => s.clienteId === clientId);
  const getProductById = (id) => state.products.find(p => p.id === id);

  const getClientStats = (clientId) => {
    const orders = getClientOrders(clientId);
    const totalFacturado = orders.reduce((sum, o) => sum + (o.montoTotal || 0), 0);
    const totalUnidades = orders.reduce((sum, o) => sum + (o.cantidad || 0), 0);
    // Producto más pedido (por cantidad de órdenes)
    const countByProduct = {};
    orders.forEach(o => { countByProduct[o.productoId] = (countByProduct[o.productoId] || 0) + 1; });
    let topProductoId = null;
    let topCount = 0;
    Object.entries(countByProduct).forEach(([pid, c]) => {
      if (c > topCount) { topCount = c; topProductoId = parseInt(pid); }
    });
    return {
      orders,
      totalFacturado,
      totalUnidades,
      topProducto: topProductoId ? getProductById(topProductoId) : null,
      ordenesCount: orders.length,
    };
  };

  const openNew = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEdit = (client) => {
    setEditingId(client.id);
    setFormData({
      nombre: client.nombre || '',
      telefono: client.telefono || '',
      domicilio: client.domicilio || '',
      mentorId: client.mentorId ? String(client.mentorId) : '',
      totalCompras: String(client.totalCompras ?? ''),
      unidadesProducidas: String(client.unidadesProducidas ?? ''),
    });
    setShowModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      nombre: formData.nombre.trim(),
      telefono: formData.telefono.trim(),
      domicilio: formData.domicilio.trim(),
      mentorId: formData.mentorId ? parseInt(formData.mentorId) : null,
      totalCompras: formData.totalCompras === '' ? 0 : parseInt(formData.totalCompras) || 0,
      unidadesProducidas: formData.unidadesProducidas === '' ? 0 : parseInt(formData.unidadesProducidas) || 0,
    };
    if (editingId) {
      onUpdateClient({ id: editingId, ...payload });
    } else {
      onAddClient({ ...payload, fechaAlta: new Date().toISOString().split('T')[0] });
    }
    setFormData(emptyForm);
    setEditingId(null);
    setShowModal(false);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditingId(null);
    setFormData(emptyForm);
  };

  const getMentorName = (mentorId) => state.mentors.find(m => m.id === mentorId)?.nombre || '-';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Base de Clientes</h2>
        <div className="flex items-center gap-2">
          <LayoutSwitcher
            value={layout}
            onChange={setLayout}
            options={[
              { key: 'table', icon: AlignJustify, label: 'Tabla' },
              { key: 'cards', icon: LayoutGrid, label: 'Cards' },
              { key: 'compact', icon: Menu, label: 'Compacta' },
            ]}
          />
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-pink-900 text-white px-4 py-2 rounded-lg hover:bg-pink-800 transition font-semibold text-sm"
          >
            <Plus size={18} /> Nuevo Cliente
          </button>
        </div>
      </div>

      {showModal && (
        <Modal title={editingId ? 'Editar Cliente' : 'Agregar Nuevo Cliente'} onClose={handleClose}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <FormLabel required>Nombre completo</FormLabel>
              <input
                type="text"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Nombre y apellido"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>
            <div>
              <FormLabel required tip="Es el único canal de contacto del cliente. Poné el número con código de área.">Teléfono</FormLabel>
              <input
                type="text"
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                placeholder="11 1234-5678"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>
            <div>
              <FormLabel tip="Dirección a la que se despachan las órdenes de este cliente.">Domicilio de despacho</FormLabel>
              <input
                type="text"
                value={formData.domicilio}
                onChange={(e) => setFormData({ ...formData, domicilio: e.target.value })}
                placeholder="Calle 123, Localidad"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            <div>
              <FormLabel tip="Mentor que refirió al cliente. Cobrará comisión sobre sus ventas según el % configurado en Comisiones.">Mentor asignado</FormLabel>
              <select
                value={formData.mentorId}
                onChange={(e) => setFormData({ ...formData, mentorId: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="">Sin mentor</option>
                {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FormLabel tip="Contador manual. Te sirve si arrancás con un cliente que ya tenía historia previa.">Órdenes pedidas</FormLabel>
                <input
                  type="number"
                  min="0"
                  value={formData.totalCompras}
                  onChange={(e) => setFormData({ ...formData, totalCompras: e.target.value })}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
              <div>
                <FormLabel tip="Total de unidades fabricadas históricamente para este cliente (manual).">Unidades producidas</FormLabel>
                <input
                  type="number"
                  min="0"
                  value={formData.unidadesProducidas}
                  onChange={(e) => setFormData({ ...formData, unidadesProducidas: e.target.value })}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
            >
              {editingId ? 'Guardar cambios' : 'Agregar Cliente'}
            </button>
          </form>
        </Modal>
      )}

      {layout === 'cards' && (
        <ClientesCardView
          clients={state.clients}
          mentors={state.mentors}
          sales={state.sales}
          onEdit={openEdit}
          getMentorName={getMentorName}
        />
      )}
      {layout === 'compact' && (
        <ClientesCompactView
          clients={state.clients}
          sales={state.sales}
          onEdit={openEdit}
          getMentorName={getMentorName}
        />
      )}
      {layout === 'table' && (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-3 w-8"></th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Nombre</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Teléfono</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Domicilio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Mentor</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Fecha Alta</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Órdenes</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Unid. Producidas</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {state.clients.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no hay clientes.</td></tr>
              )}
              {state.clients.map(client => {
                const isOpen = expanded.has(client.id);
                const stats = isOpen ? getClientStats(client.id) : null;
                return (
                  <React.Fragment key={client.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                      <td className="px-2 py-3 text-center">
                        <button
                          onClick={() => toggleExpand(client.id)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                          title={isOpen ? 'Ocultar detalle' : 'Ver órdenes del cliente'}
                          aria-label="Expandir fila"
                        >
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{client.nombre}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{client.telefono || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{client.domicilio || <span className="text-gray-400 dark:text-gray-500">Sin datos</span>}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{getMentorName(client.mentorId)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{client.fechaAlta}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">{client.totalCompras ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">{(client.unidadesProducidas ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <button
                          onClick={() => openEdit(client)}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/30 transition"
                          title="Editar cliente"
                        >
                          <Edit2 size={14} /> Editar
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-pink-50/40 dark:bg-pink-900/10">
                        <td colSpan={9} className="px-6 py-4">
                          <ClientDetailPanel stats={stats} products={state.products} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

function ComisionesSection({ state, dispatch, onUpdateMentor, getMentorStats, filterMentor, setFilterMentor }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  const handlePercentChange = (mentorId, value) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(0, Math.min(100, parsed));
    onUpdateMentor?.({ id: mentorId, porcentajeComision: clamped });
  };

  // Manejo de pagos recibidos por mentor — reemplaza al flujo "Liquidar todo".
  // Cada mentor tiene su propio array persistido en mentor.pagosRecibidos.
  const updateMentorPagos = (mentorId, nuevosPagos) => {
    onUpdateMentor?.({ id: mentorId, pagosRecibidos: nuevosPagos });
  };

  const filteredMentors = state.mentors.filter(m => !filterMentor || m.id === parseInt(filterMentor));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestión de Comisiones</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Cuánto genera cada mentor, cuánto se le pagó, cuánto le queda.</p>
        </div>
        <select
          value={filterMentor}
          onChange={(e) => setFilterMentor(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
        >
          <option value="">Todos los mentores</option>
          {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>

      {/* Porcentaje de comisión por mentor (editable inline) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Porcentaje de comisión por mentor</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Se aplica sobre el <span className="font-semibold">profit</span> de cada orden. Podés pisarlo por orden al registrarla.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {state.mentors.map(mentor => {
            const pct = mentor.porcentajeComision ?? 50;
            return (
              <div
                key={mentor.id}
                className="group flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 hover:border-pink-300 dark:hover:border-pink-600 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold flex items-center justify-center shrink-0 shadow-sm">
                  {(mentor.nombre || 'M').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{mentor.nombre}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Comisión sobre profit</p>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={pct}
                    onChange={(e) => handlePercentChange(mentor.id, e.target.value)}
                    className="w-16 px-2 py-1.5 text-sm font-bold text-right border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-pink-500 tabular-nums"
                  />
                  <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Balance + historial de pagos por mentor */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {filteredMentors.map(mentor => (
          <MentorBalanceCard
            key={mentor.id}
            mentor={mentor}
            balance={getMentorBalance(mentor, state.sales, state.products)}
            onChangePagos={(next) => updateMentorPagos(mentor.id, next)}
          />
        ))}
      </div>
    </div>
  );
}

// Card por mentor con balance en vivo + historial editable de pagos
// recibidos. Reemplaza el antiguo flujo de "Liquidar" todas las comisiones
// pendientes de una. Ahora la admin anota pagos parciales con fecha y nota.
function MentorBalanceCard({ mentor, balance, onChangePagos }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const pagos = Array.isArray(mentor.pagosRecibidos) ? mentor.pagosRecibidos : [];
  const saldada = balance.saldo <= 0 && balance.generado > 0;

  const updatePago = (index, patch) => {
    const next = pagos.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChangePagos(next);
  };

  const addPago = () => {
    const monto = balance.saldo > 0 ? Math.round(balance.saldo) : 0;
    onChangePagos([
      ...pagos,
      { monto, fecha: new Date().toISOString().split('T')[0], nota: '' },
    ]);
  };

  const removePago = (index) => {
    onChangePagos(pagos.filter((_, i) => i !== index));
  };

  const saldarTodo = () => {
    if (balance.saldo <= 0) return;
    onChangePagos([
      ...pagos,
      { monto: Math.round(balance.saldo), fecha: new Date().toISOString().split('T')[0], nota: 'Saldo total' },
    ]);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold text-lg flex items-center justify-center shrink-0 shadow">
          {(mentor.nombre || 'M').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{mentor.nombre}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{balance.ordenes} {balance.ordenes === 1 ? 'orden referida' : 'órdenes referidas'} · comisión {mentor.porcentajeComision ?? 50}%</p>
        </div>
        {saldada && (
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">SALDADO ✓</span>
        )}
      </div>

      {/* 3 cards de balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Generado</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(balance.generado)}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
          <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Pagado</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmtMoney(balance.cobrado)}</p>
        </div>
        <div className={`rounded-lg p-3 border ${saldada ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
          <p className={`text-[10px] uppercase tracking-wider ${saldada ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>Le queda</p>
          <p className={`text-lg font-bold tabular-nums ${saldada ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {saldada ? '—' : fmtMoney(balance.saldo)}
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500"
          style={{ width: `${Math.min(100, balance.porcentaje)}%` }}
        />
      </div>
      <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">{balance.porcentaje}% pagado</p>

      {/* Historial de pagos */}
      <div className="bg-gray-50/60 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span>Historial de pagos {pagos.length > 0 && `(${pagos.length})`}</span>
          {balance.saldo > 0 && pagos.length > 0 && (
            <button
              type="button"
              onClick={saldarTodo}
              className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 hover:underline normal-case tracking-normal"
            >
              Saldar total
            </button>
          )}
        </div>
        {pagos.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500 dark:text-gray-400 italic text-center">Sin pagos registrados. Tocá "Registrar pago" para anotar el primero.</p>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {pagos.map((pago, i) => (
              <div key={i} className="px-3 py-2 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                  <Check size={12} className="text-emerald-700 dark:text-emerald-300" />
                </div>
                <div className="relative w-28 shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    value={pago.monto ?? ''}
                    onChange={(e) => updatePago(i, { monto: parseFloat(e.target.value) || 0 })}
                    className="w-full pl-5 pr-2 py-1 text-xs text-right border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 tabular-nums"
                  />
                </div>
                <input
                  type="date"
                  value={pago.fecha || ''}
                  onChange={(e) => updatePago(i, { fecha: e.target.value })}
                  className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  value={pago.nota || ''}
                  onChange={(e) => updatePago(i, { nota: e.target.value })}
                  placeholder="transfer, efectivo..."
                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => removePago(i)}
                  className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                  title="Eliminar este pago"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={addPago}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition shadow"
      >
        <Plus size={16} /> Registrar pago
      </button>
    </div>
  );
}

// Sección de analytics con IA. Llama a /api/analytics que pasa el snapshot
// del negocio a Claude y devuelve un reporte estructurado con: resumen
// ejecutivo, tiempos de entrega por nicho, fortalezas, debilidades y
// recomendaciones accionables.
// Sección de gestión de datos: export/import CSV por entidad. Sirve para
// sacar una copia de seguridad, pasar datos a Excel, o migrar desde otro
// sistema importando CSV con el formato esperado.
function DatosSection({ state, dispatch, addToast }) {
  // Definición de las 4 entidades y cómo se serializan/deserializan.
  // Si en el futuro cambia el schema de una entidad, hay que actualizar
  // acá las columnas y el parser.
  const ENTITIES = [
    {
      key: 'products',
      label: 'Productos',
      icon: Package,
      columns: [
        { key: 'id', label: 'id' },
        { key: 'nombre', label: 'nombre' },
        { key: 'descripcion', label: 'descripcion' },
        { key: 'costoContenido', label: 'costoContenido' },
        { key: 'costoEnvase', label: 'costoEnvase' },
        { key: 'costoEtiqueta', label: 'costoEtiqueta' },
        { key: 'precioVenta', label: 'precioVenta' },
        { key: 'costoSinDesglosar', label: 'costoSinDesglosar' },
        { key: 'formula', label: 'formula', serialize: (p) => JSON.stringify(p.formula || []) },
      ],
      parseRow: (row) => ({
        nombre: row.nombre || '',
        descripcion: row.descripcion || '',
        costoContenido: toNumber(row.costoContenido),
        costoEnvase: toNumber(row.costoEnvase),
        costoEtiqueta: toNumber(row.costoEtiqueta),
        precioVenta: toNumber(row.precioVenta),
        costoSinDesglosar: row.costoSinDesglosar ? toNumber(row.costoSinDesglosar) : null,
        formula: (() => { try { return JSON.parse(row.formula || '[]'); } catch { return []; } })(),
      }),
    },
    {
      key: 'clients',
      label: 'Clientes',
      icon: Users,
      columns: [
        { key: 'id', label: 'id' },
        { key: 'nombre', label: 'nombre' },
        { key: 'telefono', label: 'telefono' },
        { key: 'domicilio', label: 'domicilio' },
        { key: 'mentorId', label: 'mentorId' },
        { key: 'fechaAlta', label: 'fechaAlta' },
        { key: 'totalCompras', label: 'totalCompras' },
        { key: 'unidadesProducidas', label: 'unidadesProducidas' },
      ],
      parseRow: (row) => ({
        nombre: row.nombre || '',
        telefono: row.telefono || '',
        domicilio: row.domicilio || '',
        mentorId: row.mentorId ? toNumber(row.mentorId) : null,
        fechaAlta: row.fechaAlta || new Date().toISOString().split('T')[0],
        totalCompras: toNumber(row.totalCompras),
        unidadesProducidas: toNumber(row.unidadesProducidas),
      }),
    },
    {
      key: 'mentors',
      label: 'Equipo',
      icon: UserCheck,
      columns: [
        { key: 'id', label: 'id' },
        { key: 'nombre', label: 'nombre' },
        { key: 'contacto', label: 'contacto' },
        { key: 'fechaInicio', label: 'fechaInicio' },
        { key: 'porcentajeComision', label: 'porcentajeComision' },
        { key: 'pagosRecibidos', label: 'pagosRecibidos', serialize: (m) => JSON.stringify(m.pagosRecibidos || []) },
      ],
      parseRow: (row) => ({
        nombre: row.nombre || '',
        contacto: row.contacto || '',
        fechaInicio: row.fechaInicio || new Date().toISOString().split('T')[0],
        porcentajeComision: row.porcentajeComision ? toNumber(row.porcentajeComision) : 50,
        pagosRecibidos: (() => { try { return JSON.parse(row.pagosRecibidos || '[]'); } catch { return []; } })(),
      }),
    },
    {
      key: 'sales',
      label: 'Órdenes',
      icon: TrendingUp,
      columns: [
        { key: 'id', label: 'id' },
        { key: 'fecha', label: 'fecha' },
        { key: 'clienteId', label: 'clienteId' },
        { key: 'productoId', label: 'productoId' },
        { key: 'cantidad', label: 'cantidad' },
        { key: 'montoTotal', label: 'montoTotal' },
        { key: 'mentorId', label: 'mentorId' },
        { key: 'estado', label: 'estado' },
        { key: 'tieneIncidencia', label: 'tieneIncidencia' },
        { key: 'incidenciaDetalle', label: 'incidenciaDetalle' },
        { key: 'mentorPresupuesto', label: 'mentorPresupuesto' },
        { key: 'cuotasPlanificadas', label: 'cuotasPlanificadas' },
        { key: 'cobros', label: 'cobros', serialize: (s) => JSON.stringify(s.cobros || []) },
        { key: 'pagos', label: 'pagos', serialize: (s) => JSON.stringify(s.pagos || {}) },
        { key: 'costsOverride', label: 'costsOverride', serialize: (s) => JSON.stringify(s.costsOverride || {}) },
        { key: 'costoSinDesglosar', label: 'costoSinDesglosar' },
        { key: 'estadoComision', label: 'estadoComision' },
      ],
      parseRow: (row) => ({
        fecha: row.fecha || new Date().toISOString().split('T')[0],
        clienteId: toNumber(row.clienteId),
        productoId: toNumber(row.productoId),
        cantidad: toNumber(row.cantidad, 1),
        montoTotal: toNumber(row.montoTotal),
        mentorId: row.mentorId ? toNumber(row.mentorId) : null,
        estado: row.estado || 'pendiente-cotizacion',
        tieneIncidencia: toBool(row.tieneIncidencia),
        incidenciaDetalle: row.incidenciaDetalle || '',
        mentorPresupuesto: row.mentorPresupuesto ? toNumber(row.mentorPresupuesto) : null,
        cuotasPlanificadas: row.cuotasPlanificadas ? toNumber(row.cuotasPlanificadas) : 0,
        cobros: (() => { try { return JSON.parse(row.cobros || '[]'); } catch { return []; } })(),
        pagos: (() => { try { return JSON.parse(row.pagos || '{}'); } catch { return {}; } })(),
        costsOverride: (() => { try { return JSON.parse(row.costsOverride || '{}'); } catch { return {}; } })(),
        costoSinDesglosar: row.costoSinDesglosar ? toNumber(row.costoSinDesglosar) : null,
        estadoComision: row.estadoComision || 'pendiente',
      }),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Datos</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Exportar e importar datos en formato CSV. Sirve para backup o migración.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ENTITIES.map(ent => (
          <EntityDataCard key={ent.key} entity={ent} state={state} dispatch={dispatch} addToast={addToast} />
        ))}
      </div>

      {/* Bonus: Export de TODO de una (zip conceptual: todos los CSV juntos en 1 archivo) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Backup completo</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Exportá todos los datos en un solo archivo JSON. Ideal para guardar o mover a otra máquina.</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `viora-backup-${new Date().toISOString().split('T')[0]}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              addToast?.({ type: 'success', message: 'Backup generado' });
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-pink-900 text-white hover:bg-pink-800 transition"
          >
            <Package size={16} /> Exportar backup completo (JSON)
          </button>
          <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-pink-900 text-pink-900 dark:text-pink-300 dark:border-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/30 transition cursor-pointer">
            <Package size={16} /> Restaurar desde backup
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  try {
                    const parsed = JSON.parse(ev.target.result);
                    if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');
                    if (!window.confirm('¿Restaurar desde backup? Se reemplazarán todos los datos actuales.')) return;
                    ['products', 'clients', 'mentors', 'sales'].forEach(key => {
                      if (Array.isArray(parsed[key])) {
                        dispatch({ type: 'BULK_REPLACE', payload: { entity: key, data: parsed[key] } });
                      }
                    });
                    addToast?.({ type: 'success', message: 'Backup restaurado' });
                  } catch (err) {
                    addToast?.({ type: 'error', message: `Error: ${err.message}` });
                  }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

// Card individual de export/import para una entidad específica.
function EntityDataCard({ entity, state, dispatch, addToast }) {
  const data = state[entity.key] || [];
  const Icon = entity.icon;

  const handleExport = () => {
    const csv = generateCSV(data, entity.columns);
    const filename = `viora-${entity.key}-${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(filename, csv);
    addToast?.({ type: 'success', message: `${entity.label} exportados (${data.length} filas)` });
  };

  const handleImport = (mode) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const parsed = parseCSV(text);
        if (parsed.rows.length === 0) throw new Error('El archivo no tiene filas');
        const items = parsed.rows.map(entity.parseRow).filter(x => x.nombre || x.fecha || x.clienteId); // filtra vacíos

        if (mode === 'replace') {
          if (!window.confirm(`¿Reemplazar los ${data.length} ${entity.label.toLowerCase()} actuales por ${items.length} del CSV?`)) return;
          // Re-IDdamos desde 1
          const reIdd = items.map((it, i) => ({ ...it, id: i + 1 }));
          dispatch({ type: 'BULK_REPLACE', payload: { entity: entity.key, data: reIdd } });
          addToast?.({ type: 'success', message: `${items.length} ${entity.label.toLowerCase()} importados (reemplazo)` });
        } else {
          dispatch({ type: 'BULK_MERGE', payload: { entity: entity.key, data: items } });
          addToast?.({ type: 'success', message: `${items.length} ${entity.label.toLowerCase()} agregados` });
        }
      } catch (err) {
        addToast?.({ type: 'error', message: `Error: ${err.message}` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 flex items-center justify-center">
            <Icon size={18} />
          </div>
          <div>
            <p className="text-base font-bold text-gray-900 dark:text-gray-100">{entity.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{data.length} {data.length === 1 ? 'fila' : 'filas'}</p>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <button
          onClick={handleExport}
          disabled={data.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Exportar CSV
        </button>
        <div className="grid grid-cols-2 gap-2">
          <label className="inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition cursor-pointer" title="Agrega las filas del CSV al final del dataset actual">
            + Agregar
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImport('merge')} />
          </label>
          <label className="inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold rounded-md border border-amber-600 text-amber-700 dark:text-amber-300 dark:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition cursor-pointer" title="Reemplaza TODO el dataset por las filas del CSV">
            ↻ Reemplazar
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImport('replace')} />
          </label>
        </div>
      </div>
    </div>
  );
}

function AnalyticsSection({ state, currentUser, analyticsState, onFetch }) {
  // El estado vive en el AppShell para que el reporte siga generándose
  // aunque el usuario navegue a otra sección.
  const { report, loading, error, lastFetch } = analyticsState;

  // Snapshot enriquecido para analytics (incluye más histórico que el del chatbot)
  const snapshot = {
    fecha_del_analisis: new Date().toISOString().split('T')[0],
    productos: state.products.map(p => ({
      nombre: p.nombre,
      precio_venta: p.precioVenta,
      costo_total_unitario: getProductUnitCost(p),
    })),
    mentores: state.mentors.map(m => ({
      nombre: m.nombre,
      porcentaje_comision: m.porcentajeComision ?? 50,
    })),
    ordenes: state.sales.map(o => {
      const p = state.products.find(pp => pp.id === o.productoId);
      const c = state.clients.find(cc => cc.id === o.clienteId);
      const m = state.mentors.find(mm => mm.id === o.mentorId);
      return {
        fecha: o.fecha,
        cliente: c?.nombre || '-',
        producto: p?.nombre || '-',
        cantidad: o.cantidad,
        monto_total: o.montoTotal,
        estado: ORDER_STATE_LABELS[o.estado || 'pendiente-cotizacion'],
        incidencia: o.tieneIncidencia ? (o.incidenciaDetalle || 'sin detalle') : null,
        mentor: m?.nombre || null,
      };
    }),
  };

  const fetchReport = () => onFetch?.(snapshot);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Sparkles size={22} className="text-amber-500" />
            Analytics con IA
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Reporte generado por Claude analizando el histórico de órdenes, productos y equipo.
          </p>
        </div>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-pink-900 text-white font-semibold text-sm hover:bg-pink-800 transition disabled:opacity-50"
        >
          {loading ? <Sparkles size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {loading ? 'Analizando...' : (report ? 'Refrescar reporte' : 'Generar reporte')}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!report && !loading && !error && (
        <div className="p-12 rounded-2xl bg-gradient-to-br from-rose-50 to-amber-50 dark:from-gray-800 dark:to-gray-900 border border-rose-100 dark:border-gray-700 text-center">
          <Sparkles size={36} className="mx-auto mb-3 text-amber-500" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Generá tu primer reporte</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Claude analiza tus órdenes, productos y equipo, y devuelve un reporte con
            tiempos de entrega por nicho, fortalezas, debilidades y recomendaciones concretas.
          </p>
          <button
            onClick={fetchReport}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 text-white font-semibold text-sm hover:shadow-lg transition"
          >
            <Sparkles size={16} /> Generar reporte ahora
          </button>
        </div>
      )}

      {loading && !report && (
        <div className="p-12 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-center">
          <Sparkles size={36} className="mx-auto mb-3 text-amber-500 animate-pulse" />
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">Analizando datos…</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Claude está procesando tu histórico. Suele tardar unos segundos.</p>
        </div>
      )}

      {report && (
        <>
          {/* Resumen ejecutivo */}
          {report.resumenEjecutivo && (
            <div className="p-5 rounded-2xl bg-gradient-to-r from-pink-50 to-rose-50 dark:from-gray-800 dark:to-gray-900 border border-rose-100 dark:border-gray-700">
              <p className="text-[10px] uppercase tracking-widest font-bold text-amber-700 dark:text-amber-300 mb-2">Resumen ejecutivo</p>
              <p className="text-base text-gray-800 dark:text-gray-200 leading-relaxed">{report.resumenEjecutivo}</p>
            </div>
          )}

          {/* Tiempos */}
          {report.tiempos && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Tiempos de entrega</h3>
                {report.tiempos.promedioGeneralDias != null && (
                  <span className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {report.tiempos.promedioGeneralDias} días
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-normal ml-1">prom.</span>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(report.tiempos.porNicho || []).map((n, i) => (
                  <div key={i} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-baseline justify-between mb-1">
                      <p className="font-bold text-gray-900 dark:text-gray-100">{n.nicho}</p>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">{n.ordenes} órd.</span>
                    </div>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {n.diasPromedio != null ? `${n.diasPromedio}` : '—'}
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-normal ml-1">{n.diasPromedio != null ? 'días' : 'sin datos'}</span>
                    </p>
                    {n.comentario && <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-snug">{n.comentario}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fortalezas + Debilidades en 2 columnas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.fortalezas?.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-5">
                <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300 mb-3 uppercase tracking-wider">✓ Fortalezas</h3>
                <ul className="space-y-2">
                  {report.fortalezas.map((f, i) => (
                    <li key={i} className="text-sm text-gray-800 dark:text-gray-200 flex items-start gap-2">
                      <span className="mt-1 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.debilidades?.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
                <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-3 uppercase tracking-wider">! A mejorar</h3>
                <ul className="space-y-2">
                  {report.debilidades.map((d, i) => (
                    <li key={i} className="text-sm text-gray-800 dark:text-gray-200 flex items-start gap-2">
                      <span className="mt-1 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Recomendaciones */}
          {report.recomendaciones?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Recomendaciones accionables</h3>
              <div className="space-y-3">
                {report.recomendaciones.map((r, i) => {
                  const impactColor = r.impacto === 'alto'
                    ? 'border-l-red-500 bg-red-50/40 dark:bg-red-900/10'
                    : r.impacto === 'medio'
                      ? 'border-l-amber-500 bg-amber-50/40 dark:bg-amber-900/10'
                      : 'border-l-blue-400 bg-blue-50/40 dark:bg-blue-900/10';
                  return (
                    <div key={i} className={`border-l-4 pl-4 py-2 ${impactColor}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold text-gray-900 dark:text-gray-100">{r.titulo}</p>
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/70 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400">
                          impacto {r.impacto}
                        </span>
                      </div>
                      {r.detalle && <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{r.detalle}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {lastFetch > 0 && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500">
              Reporte generado hace {Math.round((Date.now() - lastFetch) / 1000)}s
            </p>
          )}
        </>
      )}
    </div>
  );
}

function MentoresSection({ state, getMentorStats }) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Perfiles de Mentores</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {state.mentors.map(mentor => {
          const stats = getMentorStats(mentor.id);
          const mentorClients = state.clients.filter(c => c.mentorId === mentor.id);
          return (
            <div key={mentor.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 hover:shadow-xl transition">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{mentor.nombre}</h3>
              <div className="space-y-3 text-sm mb-6 border-b border-gray-200 dark:border-gray-700 pb-4">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Contacto:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{mentor.contacto}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Desde:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{mentor.fechaInicio}</span>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Ventas Referidas:</span>
                  <span className="font-bold text-blue-600 text-lg">${stats.totalSales.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Comisión Total:</span>
                  <span className="font-bold text-purple-600 text-lg">${stats.totalCommission.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Clientes Asignados:</span>
                  <span className="font-bold text-pink-600 text-lg">{mentorClients.length}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mentor Views
// Vista de inicio para el rol equipo (antes mentor): es un resumen del lab
// pero recortado — no muestra costos ni profit (información sensible que
// queda sólo para la admin). Sí ve sus comisiones, sus clientes, sus
// órdenes y los KPIs operativos generales.
function EquipoInicioSection({ currentUser, state }) {
  const mentor = state.mentors.find(m => m.id === currentUser.id);
  const balance = mentor
    ? getMentorBalance(mentor, state.sales, state.products)
    : { generado: 0, cobrado: 0, saldo: 0, porcentaje: 0, ordenes: 0, pagos: [] };

  // Stats del lab que SÍ puede ver: número total de órdenes activas,
  // sus órdenes referidas, lo que generó este mes, y las incidencias
  // del lab (igual que la admin, son operativas).
  const totalOrdenesActivas = state.sales.filter(o => (o.estado || 'pendiente-cotizacion') !== 'despachado').length;
  const incidenciasLab = state.sales.filter(s => s.tieneIncidencia).length;
  const mesActual = state.sales
    .filter(s => s.mentorId === currentUser.id && (s.fecha || '').startsWith(new Date().toISOString().substring(0, 7)))
    .reduce((sum, s) => {
      const p = state.products.find(pp => pp.id === s.productoId);
      return sum + getMentorCommission(s, p, mentor);
    }, 0);

  return (
    <div className="space-y-8">
      <DailyQuoteBanner />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Generado total" value={`$${Math.round(balance.generado).toLocaleString()}`} color="from-emerald-500 to-teal-500" delay={0} />
        <StatCard icon={CreditCard} label="Te queda cobrar" value={`$${Math.max(0, Math.round(balance.saldo)).toLocaleString()}`} color="from-amber-500 to-orange-500" delay={80} />
        <StatCard icon={TrendingUp} label="Comisión este mes" value={`$${Math.round(mesActual).toLocaleString()}`} color="from-purple-500 to-pink-500" delay={160} />
        <StatCard icon={AlertCircle} label="Incidencias del lab" value={incidenciasLab} color="from-red-500 to-pink-500" delay={240} />
      </div>

      <EquipoOrdenesView state={state} mentorId={currentUser.id} compact />
    </div>
  );
}

// Sección dedicada de "Mis Órdenes" para el rol equipo. Muestra la tabla
// completa de las órdenes referidas por la persona, sin columnas sensibles
// (costos / profit). Read-only.
function EquipoOrdenesSection({ currentUser, state }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Mis Órdenes</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Las órdenes que referiste, con su estado actual y tu comisión.</p>
      </div>
      <EquipoOrdenesView state={state} mentorId={currentUser.id} />
    </div>
  );
}

// Componente compartido: tabla read-only de órdenes de un equipo (mentor).
// Sin columnas de costos ni profit. Sólo info que le concierne.
// Si compact=true, limita a las 8 últimas y sin paginación.
function EquipoOrdenesView({ state, mentorId, compact = false }) {
  const mentor = state.mentors.find(m => m.id === mentorId);
  const ordenes = state.sales
    .filter(s => s.mentorId === mentorId)
    .slice()
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const visibles = compact ? ordenes.slice(0, 8) : ordenes;

  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const getClientName = (id) => state.clients.find(c => c.id === id)?.nombre || '-';
  const getProductName = (id) => state.products.find(p => p.id === id)?.nombre || '-';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      {compact && (
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Mis órdenes recientes</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Mostrando las {Math.min(8, ordenes.length)} más recientes de un total de {ordenes.length}.</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
            <tr className="text-left text-gray-700 dark:text-gray-200">
              <th className="px-4 py-3 font-semibold">Fecha</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold text-right">Cant.</th>
              <th className="px-4 py-3 font-semibold text-right">Monto venta</th>
              <th className="px-4 py-3 font-semibold text-right">Tu comisión</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Cobro cliente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {visibles.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no tenés órdenes referidas.</td></tr>
            )}
            {visibles.map(order => {
              const product = state.products.find(p => p.id === order.productoId);
              const comision = getMentorCommission(order, product, mentor);
              const cobros = getOrderCobrosSummary(order);
              const estado = order.estado || 'pendiente-cotizacion';
              const saldada = cobros.saldo <= 0 && cobros.total > 0;
              return (
                <tr key={order.id} className={`${order.tieneIncidencia ? 'bg-red-50/40 dark:bg-red-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">{order.fecha}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{getClientName(order.clienteId)}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{getProductName(order.productoId)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{order.cantidad}</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(order.montoTotal || 0)}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(comision)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ORDER_STATE_STYLES[estado]}`}>
                      {ORDER_STATE_LABELS[estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-bold tabular-nums shrink-0 ${saldada ? 'text-emerald-600 dark:text-emerald-400' : cobros.cobrado > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-500'}`}>
                        {saldada ? '✓' : `${cobros.porcentaje}%`}
                      </span>
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className={`h-full ${saldada ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
                          style={{ width: `${Math.min(100, cobros.porcentaje)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MentorResumenSection({ currentUser, state, getMentorStats }) {
  const mentor = state.mentors.find(m => m.id === currentUser.id);
  // Balance en vivo calculado sobre TODAS las órdenes del mentor y sus
  // pagos recibidos. Se actualiza al segundo cada vez que la admin agrega
  // un pago desde la sección de Comisiones o una orden nueva.
  const balance = mentor ? getMentorBalance(mentor, state.sales, state.products) : { generado: 0, cobrado: 0, saldo: 0, ordenes: 0, porcentaje: 0, pagos: [] };
  const mesActual = state.sales
    .filter(s => s.mentorId === currentUser.id && (s.fecha || '').startsWith(new Date().toISOString().substring(0, 7)))
    .reduce((sum, s) => {
      const p = state.products.find(pp => pp.id === s.productoId);
      return sum + getMentorCommission(s, p, mentor);
    }, 0);

  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  return (
    <div className="space-y-8">
      <div className="text-center mb-8 p-6 bg-gradient-to-r from-pink-100 to-rose-100 dark:from-pink-900/40 dark:to-rose-900/40 rounded-xl">
        <h2 className="text-3xl font-bold text-pink-900 dark:text-pink-200">Hola, {currentUser.name}</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Tu resumen de comisiones — actualizado en vivo.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard icon={DollarSign} label="Generado total" value={`$${balance.generado.toLocaleString()}`} color="from-emerald-500 to-teal-500" delay={0} />
        <StatCard icon={CreditCard} label="Ya cobraste" value={`$${balance.cobrado.toLocaleString()}`} color="from-blue-500 to-cyan-500" delay={80} />
        <StatCard icon={AlertCircle} label="Te queda cobrar" value={`$${Math.max(0, balance.saldo).toLocaleString()}`} color="from-amber-500 to-orange-500" delay={160} />
        <StatCard icon={TrendingUp} label="Este mes" value={`$${mesActual.toLocaleString()}`} color="from-purple-500 to-pink-500" delay={240} />
      </div>

      {/* Progress bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Progreso de cobros</h3>
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{balance.porcentaje}% cobrado</span>
        </div>
        <div className="w-full h-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500"
            style={{ width: `${Math.min(100, balance.porcentaje)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {balance.ordenes} {balance.ordenes === 1 ? 'orden referida' : 'órdenes referidas'} · porcentaje de comisión: {mentor?.porcentajeComision ?? 50}% del profit
        </p>
      </div>

      {/* Historial de pagos recibidos (read-only para el mentor) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Historial de pagos recibidos</h3>
        {balance.pagos.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-6">Todavía no tenés pagos registrados. Consultá con la admin.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 bg-white dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold text-right">Monto</th>
                  <th className="px-3 py-2 font-semibold">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {balance.pagos
                  .slice()
                  .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
                  .map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">{p.fecha || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(p.monto)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{p.nota || <span className="italic text-gray-400 dark:text-gray-500">—</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MentorComisionesSection({ currentUser, state, filterMonth, setFilterMonth }) {
  const mentorSales = state.sales.filter(s => s.mentorId === currentUser.id);
  const months = [...new Set(mentorSales.map(s => s.fecha.substring(0, 7)))].sort().reverse();

  const getClientName = (clienteId) => state.clients.find(c => c.id === clienteId)?.nombre || '-';
  const getProductName = (productoId) => state.products.find(p => p.id === productoId)?.nombre || '-';

  const filteredSales = filterMonth ? mentorSales.filter(s => s.fecha.startsWith(filterMonth)) : mentorSales;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Mis Comisiones</h2>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Filtrar por Mes</label>
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
        >
          <option value="">Todos</option>
          {months.map(month => (
            <option key={month} value={month}>
              {new Date(month + '-01').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Fecha</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Cliente</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Producto</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Monto Venta</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Tu Comisión (50%)</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredSales.map(sale => (
                <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{sale.fecha}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getClientName(sale.clienteId)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getProductName(sale.productoId)}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">${sale.montoTotal.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm font-bold text-green-600">${(sale.montoTotal * 0.5).toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm"><Badge text={sale.estadoComision} type={sale.estadoComision === 'pagada' ? 'success' : 'warning'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MentorClientesSection({ currentUser, state }) {
  const mentorClients = state.clients.filter(c => c.mentorId === currentUser.id);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Mis Clientes</h2>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Nombre</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Teléfono</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Domicilio</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Total Compras</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {mentorClients.map(client => (
                <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{client.nombre}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{client.telefono || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{client.domicilio || '-'}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">{client.totalCompras ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

// Vista cards de clientes: grid con avatar + datos + mini-stats de órdenes.
function ClientesCardView({ clients, mentors, sales, onEdit, getMentorName }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {clients.length === 0 && (
        <div className="col-span-full px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no hay clientes.</div>
      )}
      {clients.map(client => {
        const clientSales = sales.filter(s => s.clienteId === client.id);
        const totalFacturado = clientSales.reduce((s, o) => s + (o.montoTotal || 0), 0);
        const initial = (client.nombre || 'C').charAt(0).toUpperCase();
        return (
          <div key={client.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 hover:shadow-xl transition">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-200 to-rose-300 dark:from-pink-700 dark:to-rose-800 text-pink-900 dark:text-pink-100 font-bold flex items-center justify-center shrink-0 shadow">
                {initial}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{client.nombre}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{client.telefono || 'Sin teléfono'}</p>
              </div>
              <button
                onClick={() => onEdit(client)}
                className="p-1.5 rounded-md text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/30 transition"
                title="Editar cliente"
              >
                <Edit2 size={14} />
              </button>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Domicilio</span>
                <span className="text-gray-700 dark:text-gray-300 text-right truncate">{client.domicilio || <span className="italic text-gray-400 dark:text-gray-500">sin datos</span>}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Mentor</span>
                <span className="text-gray-700 dark:text-gray-300 text-right truncate">{getMentorName(client.mentorId)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Desde</span>
                <span className="text-gray-700 dark:text-gray-300 text-right">{client.fechaAlta}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Órdenes</p>
                <p className="font-bold text-gray-900 dark:text-gray-100">{clientSales.length || (client.totalCompras ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Unidades</p>
                <p className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{(client.unidadesProducidas ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Facturado</p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums text-xs">{fmtMoney(totalFacturado)}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Vista compacta de clientes: una línea por cliente con lo esencial.
function ClientesCompactView({ clients, sales, onEdit, getMentorName }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
      {clients.length === 0 && (
        <div className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no hay clientes.</div>
      )}
      {clients.map(client => {
        const countOrders = sales.filter(s => s.clienteId === client.id).length;
        const initial = (client.nombre || 'C').charAt(0).toUpperCase();
        return (
          <div key={client.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-200 to-rose-300 dark:from-pink-700 dark:to-rose-800 text-pink-900 dark:text-pink-100 text-xs font-bold flex items-center justify-center shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{client.nombre}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {client.telefono || '—'} · {client.domicilio || 'Sin domicilio'} · {getMentorName(client.mentorId)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{countOrders || (client.totalCompras ?? 0)} órd.</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">{(client.unidadesProducidas ?? 0).toLocaleString()} u.</p>
            </div>
            <button
              onClick={() => onEdit(client)}
              className="p-1.5 rounded-md text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/30 transition"
              title="Editar cliente"
            >
              <Edit2 size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Panel expandible que muestra el detalle de un cliente: sus órdenes con producto,
// total facturado, producto más pedido. Se abre desde ClientesSection con el chevron.
function ClientDetailPanel({ stats, products }) {
  if (!stats) return null;
  const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;
  const getProductName = (id) => products.find(p => p.id === id)?.nombre || '-';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Órdenes registradas</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{stats.ordenesCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Total facturado</p>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(stats.totalFacturado)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Unidades pedidas</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{stats.totalUnidades.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">Producto más pedido</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{stats.topProducto?.nombre || '—'}</p>
        </div>
      </div>
      {stats.orders.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">Este cliente todavía no tiene órdenes registradas.</p>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/60 sticky top-0 z-10">
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 font-semibold text-right">Cant.</th>
                <th className="px-3 py-2 font-semibold text-right">Monto</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 font-semibold">Incidencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {stats.orders
                .slice()
                .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
                .map(order => {
                  const estado = order.estado || 'pendiente-cotizacion';
                  return (
                    <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{order.fecha}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{getProductName(order.productoId)}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{order.cantidad}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(order.montoTotal || 0)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ORDER_STATE_STYLES[estado]}`}>{ORDER_STATE_LABELS[estado]}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {order.tieneIncidencia
                          ? <span className="text-red-600 dark:text-red-400 font-semibold">⚠ {order.incidenciaDetalle || 'Sin detalle'}</span>
                          : <span className="text-gray-400 dark:text-gray-500">—</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Mini-form reutilizable para crear clientes desde otros módulos (ej. al registrar una venta).
// Campos requeridos: nombre + teléfono. Mentor y domicilio son opcionales.
// Panel de pagos que se abre dentro de una orden del dashboard. Muestra 4 rubros
// (contenido / envase-pote / etiqueta / mentor) con estado, monto, fecha, proveedor
// y nota editables. El cambio en cualquier campo dispatchea UPDATE_ORDER_PAYMENT.
// Celda editable inline: doble-click → se convierte en input numérico.
// Enter/Tab/blur confirma con onSave(number); Esc cancela.
// Props:
//   value: número actual
//   onSave: (nuevoValor: number) => void
//   className: clases extra para el modo display
//   prefix, suffix: texto decorativo (ej. '$')
//   align: 'left' | 'right'
//   disabled: si true, no edita
// Celda para el costo de Contenido (la "fórmula") con un popover de ingredientes.
// Muestra el monto como texto + un ícono (+/lupa) que al click abre un popover
// donde se pueden agregar/editar/eliminar ingredientes con su costo unitario.
// Si el producto no tiene formula[], muestra costoContenido plano y permite
// empezar a armar la fórmula desde ahí.
// Celda unificada de costo de orden. Reemplaza las 3 columnas separadas
// (Fórmula / Envase / Etiqueta) por una sola "Costo" que abre un popover
// con 2 modos:
//   1) Desglosado: edita fórmula + envase + etiqueta por separado
//   2) Sin discriminar: un único monto plano (cuando el proveedor pasó
//      el costo final con todo y no tenemos breakdown).
// El toggle entre modos es por orden — cada orden puede decidir.
function CostBreakdownCell({ order, product, costs, isTotal, onUpdateProduct, onOverrideContenido, onOverrideEnvase, onOverrideEtiqueta, onSetFlat, onClearFlat }) {
  const [open, setOpen] = useState(false);
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const popoverRef = useRef(null);

  const isFlat = order?.costoSinDesglosar != null && order.costoSinDesglosar !== '';
  const cantidad = order?.cantidad || 1;

  // Total mostrado en la celda (suma de los 3 costos, o el flat si está activo)
  const totalShown = isTotal ? costs.costoTotal : costs.costoUnit;

  // Cierre por click fuera + Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const switchToDesglose = () => onClearFlat();
  const switchToFlat = () => {
    // Si pasamos a flat, sembramos el valor con el total actual del desglose
    onSetFlat(costs.costoUnit || 0);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-pink-50 dark:hover:bg-pink-900/20 transition ${isFlat ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
        title={isFlat ? 'Costo sin discriminar — click para ver/editar' : 'Click para ver el desglose'}
      >
        <span>{fmtMoney(totalShown)}</span>
        <ChevronDown size={12} className={`transition-transform text-gray-400 dark:text-gray-500 ${open ? 'rotate-180 text-pink-600 dark:text-pink-400' : 'group-hover:text-pink-600 dark:group-hover:text-pink-400'}`} />
        {isFlat && (
          <span className="text-[9px] font-bold px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">flat</span>
        )}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-1 z-40 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3 animate-scale-in"
          style={{ transformOrigin: 'top right' }}
        >
          {/* Header con toggle de modo */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-gray-100">Costo de la orden</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">Total {isTotal ? `(×${cantidad})` : 'unitario'}: <span className="font-semibold text-gray-700 dark:text-gray-200">{fmtMoney(totalShown)}</span></p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400" aria-label="Cerrar">
              <X size={14} />
            </button>
          </div>

          {/* Toggle desglosado vs sin discriminar */}
          <div className="inline-flex w-full rounded-md border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-900 mb-3">
            <button
              type="button"
              onClick={switchToDesglose}
              className={`flex-1 px-2 py-1 text-[10px] font-semibold rounded transition ${!isFlat ? 'bg-pink-600 text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
              title="Editar fórmula, envase y etiqueta por separado"
            >
              Desglosado
            </button>
            <button
              type="button"
              onClick={switchToFlat}
              className={`flex-1 px-2 py-1 text-[10px] font-semibold rounded transition ${isFlat ? 'bg-amber-600 text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
              title="El proveedor te pasó el costo final con todo, sin detalle"
            >
              Sin discriminar
            </button>
          </div>

          {/* Contenido según modo */}
          {isFlat ? (
            <FlatCostEditor
              valueUnit={parseFloat(order.costoSinDesglosar) || 0}
              cantidad={cantidad}
              isTotal={isTotal}
              onChange={(v) => onSetFlat(v)}
            />
          ) : (
            <DesgloseEditor
              order={order}
              product={product}
              costs={costs}
              isTotal={isTotal}
              onUpdateProduct={onUpdateProduct}
              onOverrideContenido={onOverrideContenido}
              onOverrideEnvase={onOverrideEnvase}
              onOverrideEtiqueta={onOverrideEtiqueta}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Editor del modo "sin discriminar": un único input con el costo total
// unitario. El valor que se guarda es siempre unitario; si el toggle del
// listado está en modo Total, se convierte al guardar.
function FlatCostEditor({ valueUnit, cantidad, isTotal, onChange }) {
  const [draft, setDraft] = useState(String(valueUnit || 0));
  useEffect(() => { setDraft(String(valueUnit || 0)); }, [valueUnit]);

  const commit = (raw) => {
    const v = parseFloat(raw);
    if (Number.isNaN(v)) return;
    // Si estamos en modo Total, dividimos por cantidad para guardar unitario
    onChange(isTotal ? v / cantidad : v);
  };

  const display = isTotal ? valueUnit * cantidad : valueUnit;

  return (
    <div>
      <label className="block text-[10px] uppercase text-gray-500 dark:text-gray-400 mb-1">
        Costo {isTotal ? 'total' : 'unitario'} sin desglosar
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
        <input
          type="number"
          min="0"
          step="any"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
          className="w-full pl-6 pr-2 py-2 text-sm font-semibold text-right border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-gray-900 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 tabular-nums"
        />
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 leading-tight">
        Usá esto cuando el proveedor te pasa el precio final con todo (envase + etiqueta + contenido) sin detalle.
        El cálculo del profit usa este número como costo total.
      </p>
      {!isTotal && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Total ×{cantidad}: <span className="font-semibold">${Math.round(display).toLocaleString()}</span></p>
      )}
    </div>
  );
}

// Editor del modo "desglosado": ingredientes (fórmula del producto) +
// envase + etiqueta. Refactor de lo que era FormulaCell pero unificado
// para los 3 rubros.
function DesgloseEditor({ order, product, costs, isTotal, onUpdateProduct, onOverrideContenido, onOverrideEnvase, onOverrideEtiqueta }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const cantidad = order?.cantidad || 1;
  const formula = product?.formula || [];
  const hasFormula = formula.length > 0;
  const unitFormula = formula.reduce((s, i) => s + (parseFloat(i?.costo) || 0), 0);

  const updateFormula = (nextFormula) => {
    onUpdateProduct?.({ formula: nextFormula });
  };
  const updateItem = (idx, patch) => updateFormula(formula.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => updateFormula([...formula, { nombre: '', costo: 0 }]);
  const removeItem = (idx) => updateFormula(formula.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {/* Fórmula / contenido */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400">Fórmula (contenido)</p>
          <span className="text-[10px] tabular-nums text-gray-700 dark:text-gray-300 font-semibold">{fmtMoney(isTotal ? unitFormula * cantidad : unitFormula)}</span>
        </div>
        <div className="space-y-1">
          {formula.length === 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 italic px-1">Sin ingredientes. Tocá '+ Ingrediente' o usá el modo 'Sin discriminar'.</p>
          )}
          {formula.map((it, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <input
                type="text"
                value={it.nombre || ''}
                onChange={(e) => updateItem(idx, { nombre: e.target.value })}
                placeholder="Ingrediente"
                className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
              <div className="relative shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={it.costo ?? 0}
                  onChange={(e) => updateItem(idx, { costo: parseFloat(e.target.value) || 0 })}
                  className="w-20 pl-5 pr-1.5 py-1 text-xs text-right border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 tabular-nums"
                />
              </div>
              <button type="button" onClick={() => removeItem(idx)} className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 shrink-0" title="Eliminar ingrediente">
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/20 rounded">
          <Plus size={10} /> Ingrediente
        </button>
      </div>

      {/* Envase y Etiqueta */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        <div>
          <label className="block text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">Envase / Pote</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="any"
              value={isTotal ? costs.envaseTotal : costs.envaseUnit}
              onChange={(e) => onOverrideEnvase(parseFloat(e.target.value) || 0)}
              className="w-full pl-5 pr-2 py-1 text-xs text-right border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 tabular-nums"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">Etiqueta</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="any"
              value={isTotal ? costs.etiquetaTotal : costs.etiquetaUnit}
              onChange={(e) => onOverrideEtiqueta(parseFloat(e.target.value) || 0)}
              className="w-full pl-5 pr-2 py-1 text-xs text-right border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 tabular-nums"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FormulaCell({ product, displayValue, isTotal, cantidad, onUpdateProduct, onOverrideTotal }) {
  const [open, setOpen] = useState(false);
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const hasFormula = Array.isArray(product?.formula) && product.formula.length > 0;

  // Cerrar al click fuera
  const popoverRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const formula = product?.formula || [];
  const unitSum = formula.reduce((s, i) => s + (parseFloat(i?.costo) || 0), 0);

  const updateFormula = (nextFormula) => {
    onUpdateProduct?.({ formula: nextFormula });
  };

  const updateItem = (idx, patch) => {
    const next = formula.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    updateFormula(next);
  };
  const addItem = () => {
    updateFormula([...formula, { nombre: '', costo: 0 }]);
  };
  const removeItem = (idx) => {
    updateFormula(formula.filter((_, i) => i !== idx));
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-pink-50 dark:hover:bg-pink-900/20 transition ${hasFormula ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
        title={hasFormula ? 'Ver / editar fórmula' : 'Armar fórmula'}
      >
        <span>{fmtMoney(displayValue)}</span>
        <ChevronDown size={12} className={`transition-transform text-gray-400 dark:text-gray-500 ${open ? 'rotate-180 text-pink-600 dark:text-pink-400' : 'group-hover:text-pink-600 dark:group-hover:text-pink-400'}`} />
        {hasFormula && (
          <span className="text-[9px] font-bold px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            {formula.length}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-1 z-40 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3 animate-scale-in"
          style={{ transformOrigin: 'top right' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-gray-100">Fórmula de {product?.nombre || 'producto'}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">Costo unitario: <span className="font-semibold text-gray-700 dark:text-gray-200">{fmtMoney(unitSum)}</span></p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>

          <div className="max-h-[40vh] overflow-y-auto space-y-1.5 py-1">
            {formula.length === 0 && !hasFormula && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 italic text-center py-3">
                Sin fórmula cargada. Agregá ingredientes para armar el costo de contenido.
              </p>
            )}
            {formula.map((it, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={it.nombre || ''}
                  onChange={(e) => updateItem(idx, { nombre: e.target.value })}
                  placeholder="Ingrediente"
                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
                <div className="relative shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={it.costo ?? 0}
                    onChange={(e) => updateItem(idx, { costo: parseFloat(e.target.value) || 0 })}
                    className="w-24 pl-5 pr-1.5 py-1 text-xs text-right border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 shrink-0"
                  title="Eliminar ingrediente"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="pt-2 mt-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md text-pink-700 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-900/20"
            >
              <Plus size={12} /> Ingrediente
            </button>
            <div className="text-[10px] text-right">
              <div className="text-gray-500 dark:text-gray-400">Total {isTotal ? `(×${cantidad})` : 'unitario'}:</div>
              <div className="font-bold text-gray-900 dark:text-gray-100">{fmtMoney(isTotal ? unitSum * cantidad : unitSum)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Celda compacta que muestra el estado de cobro de la orden (total/cobrado/saldo)
// con una mini-barra de progreso. Click expande la orden para editar cobros.
function CobroMiniCell({ summary, onClick }) {
  if (!summary) return null;
  const { total, cobrado, saldo, porcentaje } = summary;
  const saldada = saldo <= 0 && total > 0;
  const labelColor = saldada
    ? 'text-emerald-600 dark:text-emerald-400'
    : cobrado > 0
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-gray-500 dark:text-gray-500';
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex flex-col items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
      title={`Cobrado: ${fmtMoney(cobrado)} / Total: ${fmtMoney(total)}`}
    >
      <div className={`text-[11px] font-bold tabular-nums ${labelColor}`}>
        {saldada ? 'Saldada' : (cobrado > 0 ? `${porcentaje}%` : 'Pendiente')}
      </div>
      <div className="w-full h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${saldada ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
          style={{ width: `${Math.min(100, porcentaje)}%` }}
        />
      </div>
    </button>
  );
}

// Label unificado para formularios. Props:
//   children: el texto del label
//   required: si es true, suma un asterisco dorado
//   tip: string con ayuda contextual; renderiza un ícono `?` con tooltip
// Cuando no es required, muestra sufijo "(opcional)" en gris para que quede
// explícito para la persona que carga el formulario.
function FormLabel({ children, required = false, tip = null }) {
  return (
    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 inline-flex items-center gap-1">
      <span>{children}</span>
      {required ? (
        <span className="text-amber-500" title="Campo obligatorio">*</span>
      ) : (
        <span className="font-normal text-gray-400 dark:text-gray-500 lowercase">(opcional)</span>
      )}
      {tip && (
        <span
          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[9px] cursor-help select-none hover:bg-amber-200 dark:hover:bg-amber-700 hover:text-gray-700 dark:hover:text-gray-100 transition"
          title={tip}
          aria-label={tip}
        >
          ?
        </span>
      )}
    </label>
  );
}

function EditableCell({ value, onSave, className = '', prefix = '', suffix = '', align = 'right', disabled = false, placeholder = '—', title = 'Doble click para editar' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const start = () => {
    if (disabled) return;
    setDraft(value == null ? '' : String(Math.round(value * 100) / 100));
    setEditing(true);
  };

  const commit = () => {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed) && parsed !== value) {
      onSave(parsed);
    }
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        className={`w-24 px-1 py-0.5 text-xs border border-pink-500 dark:border-pink-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded focus:outline-none text-${align}`}
        step="any"
      />
    );
  }

  const formatted = value == null ? placeholder : Math.round(value).toLocaleString();
  return (
    <span
      onDoubleClick={start}
      title={disabled ? undefined : title}
      className={`${disabled ? '' : 'cursor-text hover:bg-pink-50 dark:hover:bg-pink-900/20 rounded px-1'} ${className}`}
    >
      {prefix}{formatted}{suffix}
    </span>
  );
}

// Panel de cobros del cliente: plan de cuotas, lista de cobros recibidos,
// cálculo automático de saldo pendiente. Plata que ENTRA del cliente.
// Wrapper compacto para la expansión de una orden. Muestra Cobros y Pagos
// como tabs en lugar de apilados (mucho menos vertical, más práctico).
// El tab default es 'cobros' porque suele ser lo primero que la admin
// quiere consultar al expandir una orden (cuánto cobré / falta cobrar).
function OrderExpansion({ order, cobrosSummary, payments, mentorNombre, onCobrosChange, onPaymentChange, onIncidenciaChange }) {
  const [tab, setTab] = useState('cobros');
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  // Mini-stats para el botón de cada tab (preview de su contenido)
  const saldoPendiente = cobrosSummary.saldo > 0 ? cobrosSummary.saldo : 0;
  const aPagarTotal = ['contenido', 'envase', 'etiqueta', 'mentor']
    .filter(k => k !== 'mentor' || order.mentorId)
    .reduce((sum, k) => sum + (payments[k]?.estado === 'pendiente' ? (payments[k]?.monto || 0) : 0), 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Tabs compactos */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setTab('cobros')}
          className={`flex-1 px-4 py-2.5 text-left transition ${tab === 'cobros' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-b-2 border-emerald-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b-2 border-transparent'}`}
        >
          <p className={`text-xs font-bold uppercase tracking-wider ${tab === 'cobros' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}`}>Cobros del cliente</p>
          <p className={`text-sm font-semibold tabular-nums ${saldoPendiente > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {saldoPendiente > 0 ? `${fmtMoney(saldoPendiente)} pendiente` : 'Saldada ✓'}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setTab('pagos')}
          className={`flex-1 px-4 py-2.5 text-left transition border-l border-gray-200 dark:border-gray-700 ${tab === 'pagos' ? 'bg-sky-50 dark:bg-sky-900/20 border-b-2 border-sky-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b-2 border-transparent'}`}
        >
          <p className={`text-xs font-bold uppercase tracking-wider ${tab === 'pagos' ? 'text-sky-700 dark:text-sky-300' : 'text-gray-500 dark:text-gray-400'}`}>Pagos a proveedores y equipo</p>
          <p className={`text-sm font-semibold tabular-nums ${aPagarTotal > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {aPagarTotal > 0 ? `${fmtMoney(aPagarTotal)} a pagar` : 'Todo pagado ✓'}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setTab('incidencia')}
          className={`flex-1 px-4 py-2.5 text-left transition border-l border-gray-200 dark:border-gray-700 ${tab === 'incidencia' ? 'bg-red-50 dark:bg-red-900/20 border-b-2 border-red-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b-2 border-transparent'}`}
        >
          <p className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${tab === 'incidencia' ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}>
            <AlertCircle size={12} /> Incidencia
          </p>
          <p className={`text-sm font-semibold ${order.tieneIncidencia ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-500'}`}>
            {order.tieneIncidencia ? 'Activa ⚠' : 'Sin incidencias'}
          </p>
        </button>
      </div>

      <div className="p-4">
        {tab === 'cobros' && (
          <CobrosPanel order={order} summary={cobrosSummary} onChange={onCobrosChange} />
        )}
        {tab === 'pagos' && (
          <PaymentsPanel order={order} payments={payments} mentorNombre={mentorNombre} onChange={onPaymentChange} />
        )}
        {tab === 'incidencia' && (
          <IncidenciaPanel order={order} onChange={onIncidenciaChange} />
        )}
      </div>
    </div>
  );
}

// Panel de incidencias: textarea con el motivo y botón toggle para activar/resolver.
// Si hay incidencia activa, el panel se ve en rojo. Al resolver, se limpia el motivo.
function IncidenciaPanel({ order, onChange }) {
  const [draft, setDraft] = useState(order.incidenciaDetalle || '');
  useEffect(() => {
    setDraft(order.incidenciaDetalle || '');
  }, [order.id, order.incidenciaDetalle]);

  const activa = !!order.tieneIncidencia;

  const toggle = () => {
    if (activa) {
      // Desactivar: confirmamos con el usuario y limpiamos el motivo.
      onChange?.({ tieneIncidencia: false, incidenciaDetalle: '' });
    } else {
      onChange?.({ tieneIncidencia: true, incidenciaDetalle: draft });
    }
  };

  const saveDetalle = () => {
    if (activa) {
      onChange?.({ tieneIncidencia: true, incidenciaDetalle: draft });
    }
  };

  return (
    <div className="space-y-3">
      <div className={`p-3 rounded-lg border-2 ${activa ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700'}`}>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
          {activa ? '⚠ Esta orden tiene una incidencia activa' : 'Esta orden no tiene incidencias registradas.'}
        </p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Marcá una incidencia si hay un problema que bloquea o demora el avance (ej. falta de stock, demora de proveedor, observación del cliente). Aparece en el listado y en las notificaciones.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Motivo</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveDetalle}
          placeholder="Ej. Proveedor demoró el envío de envases. ETA nueva: 15/05."
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-y"
        />
        {activa && draft !== (order.incidenciaDetalle || '') && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Se guarda cuando salís del campo.</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={toggle}
          className={`flex-1 py-2 rounded-lg font-semibold text-sm transition ${
            activa
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow'
              : 'bg-red-600 hover:bg-red-700 text-white shadow'
          }`}
        >
          {activa ? '✓ Resolver incidencia' : '⚠ Marcar incidencia'}
        </button>
      </div>
    </div>
  );
}

function CobrosPanel({ order, summary, onChange }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const cobros = summary.cobros;
  const { total, cobrado, saldo, porcentaje, cuotasPlanificadas, cuotasPagadas } = summary;
  // Vista detalle: por defecto colapsado para que el panel se sienta simple.
  // Sólo se expande si el usuario lo pide explícitamente.
  const [showDetalle, setShowDetalle] = useState(false);

  // Atajo rápido: si el usuario cambia directo el total cobrado, consolidamos
  // el cambio en el primer cobro (ajustamos el monto) o agregamos uno si no
  // había ninguno. Sirve para el 90% de los casos donde el cliente abonó una
  // seña y el resto después.
  const setCobradoTotalQuick = (nuevoCobrado) => {
    const clean = Math.max(0, parseFloat(nuevoCobrado) || 0);
    // Si no hay cobros → creamos uno con ese monto
    if (!cobros || cobros.length === 0) {
      onChange({ cobros: [{
        concepto: clean >= total ? 'Pago único' : 'Seña',
        monto: clean,
        fecha: new Date().toISOString().split('T')[0],
        nota: '',
      }] });
      return;
    }
    // Si hay 1 solo cobro → actualizamos su monto
    if (cobros.length === 1) {
      onChange({ cobros: [{ ...cobros[0], monto: clean }] });
      return;
    }
    // Si hay varios → ajustamos el último para que la suma cierre
    const sinUltimo = cobros.slice(0, -1).reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
    const diffUltimo = Math.max(0, clean - sinUltimo);
    const next = [...cobros];
    next[next.length - 1] = { ...next[next.length - 1], monto: diffUltimo };
    onChange({ cobros: next });
  };

  // Sugiere un concepto inteligente según la posición y el plan pactado.
  // - 1 solo pago acordado → "Pago único"
  // - Primer pago → "Seña"
  // - Último pago del plan → "Saldo"
  // - Los del medio → "Adelanto N"
  // - Si no hay plan, se deja en blanco y el usuario escribe lo que quiera.
  const sugerirConcepto = (index, totalPagosPrevios) => {
    const pos = index + 1; // 1-indexed
    if (cuotasPlanificadas === 1) return 'Pago único';
    if (cuotasPlanificadas > 1) {
      if (pos === 1) return 'Seña';
      if (pos === cuotasPlanificadas) return 'Saldo';
      return `Adelanto ${pos - 1}`;
    }
    // Sin plan: seña para el primero, saldo si coincide que salda todo
    if (totalPagosPrevios === 0) return 'Seña';
    return '';
  };

  const updateCobro = (index, patch) => {
    const next = cobros.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange({ cobros: next });
  };

  const addCobro = () => {
    // Sugerimos como monto: saldo / (pagos planificados - pagados) si hay plan,
    // o el saldo completo si no.
    let sugerido = saldo;
    if (cuotasPlanificadas > 0) {
      const faltan = Math.max(1, cuotasPlanificadas - cuotasPagadas);
      sugerido = saldo / faltan;
    }
    const nuevo = {
      concepto: sugerirConcepto(cobros.length, cobros.length),
      monto: sugerido > 0 ? Math.round(sugerido) : 0,
      fecha: new Date().toISOString().split('T')[0],
      nota: '',
    };
    onChange({ cobros: [...cobros, nuevo] });
  };

  const removeCobro = (index) => {
    onChange({ cobros: cobros.filter((_, i) => i !== index) });
  };

  const setPlan = (n) => {
    const parsed = parseInt(n);
    onChange({ cuotasPlanificadas: Number.isNaN(parsed) ? 0 : Math.max(0, parsed) });
  };

  const saldada = saldo <= 0 && total > 0;

  // Para cada cobro calculamos el concepto efectivo: si el usuario lo escribió
  // en concepto, usa eso; si no, cae al sugerido por posición.
  const displayConcepto = (cobro, i) => {
    if (cobro.concepto && cobro.concepto.trim()) return cobro.concepto;
    return sugerirConcepto(i, i);
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Cobros del cliente</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">Cuánto abonó y cuánto falta.</p>
      </div>

      {/* Vista simple: 3 números grandes (Total / Cobrado editable / Falta abonar) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Total venta</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(total)}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
          <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Cobrado</p>
          <div className="flex items-baseline gap-0.5">
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">$</span>
            <input
              type="number"
              min="0"
              value={cobrado || ''}
              onChange={(e) => setCobradoTotalQuick(e.target.value)}
              placeholder="0"
              className="flex-1 min-w-0 bg-transparent text-lg font-bold text-emerald-700 dark:text-emerald-300 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded px-0.5"
              title="Cuánto te abonó el cliente en total hasta ahora"
            />
          </div>
        </div>
        <div className={`rounded-lg p-3 border ${saldada ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
          <p className={`text-[10px] uppercase tracking-wider ${saldada ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>Falta abonar</p>
          <p className={`text-lg font-bold tabular-nums ${saldada ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{saldada ? 'Saldada ✓' : fmtMoney(saldo)}</p>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
          style={{ width: `${Math.min(100, porcentaje)}%` }}
        />
      </div>

      {/* Toggle para ver el detalle de pagos (seña + adelantos + saldo discriminados) */}
      <button
        type="button"
        onClick={() => setShowDetalle(v => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition"
      >
        {showDetalle ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {showDetalle ? 'Ocultar detalle' : `Ver detalle de pagos${cobros.length > 0 ? ` (${cobros.length})` : ''}`}
      </button>

      {!showDetalle ? null : (
      <>
      <div className="flex items-center gap-2 text-xs pt-2">
        <label className="text-gray-500 dark:text-gray-400">Pagos acordados:</label>
        <input
          type="number"
          min="0"
          value={cuotasPlanificadas || ''}
          onChange={(e) => setPlan(e.target.value)}
          placeholder="0"
          className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500"
          title="Cuántos pagos acordaste con el cliente (ej. 2 = seña + saldo). 0 = sin plan definido."
        />
        <span className="text-gray-500 dark:text-gray-400">{cuotasPlanificadas > 0 ? (cuotasPlanificadas === 1 ? 'pago' : 'pagos') : 'sin plan'}</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-700/60 sticky top-0 z-10">
            <tr className="text-left text-gray-600 dark:text-gray-300">
              <th className="px-3 py-2 font-semibold w-32">Concepto</th>
              <th className="px-3 py-2 font-semibold text-right">Monto</th>
              <th className="px-3 py-2 font-semibold">Fecha</th>
              <th className="px-3 py-2 font-semibold">Nota</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {cobros.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400 italic">Sin cobros registrados. Tocá “Registrar cobro” para empezar.</td></tr>
            )}
            {cobros.map((cobro, i) => (
              <tr key={i}>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={cobro.concepto ?? ''}
                    onChange={(e) => updateCobro(i, { concepto: e.target.value })}
                    placeholder={sugerirConcepto(i, i) || `Pago ${i + 1}`}
                    className="w-full px-2 py-1 text-xs font-semibold text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    title="Seña, Adelanto, Saldo, o lo que quieras poner"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    value={cobro.monto ?? ''}
                    onChange={(e) => updateCobro(i, { monto: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-28 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    value={cobro.fecha || ''}
                    onChange={(e) => updateCobro(i, { fecha: e.target.value })}
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={cobro.nota || ''}
                    onChange={(e) => updateCobro(i, { nota: e.target.value })}
                    placeholder="transfer, efectivo, MP..."
                    className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => removeCobro(i)}
                    className="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                    title="Eliminar este cobro"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addCobro}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition"
      >
        <Plus size={14} /> Registrar cobro
      </button>
      </>
      )}
    </div>
  );
}

function PaymentsPanel({ order, payments, mentorNombre, onChange }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  // Modo de despliegue: 'simple' (1 card producción) | 'desglose' (3 cards).
  // Default: simple. En la mayoría de los casos el proveedor entrega todo
  // junto y no hace falta discriminar. Se persiste en la orden para que al
  // volver a abrir el panel quede igual.
  const initialMode = order.paymentsMode || (order.costoSinDesglosar != null ? 'simple' : (
    // Si la orden ya tiene datos en los 3 rubros → asumimos desglose
    (payments.envase?.monto || payments.etiqueta?.monto) ? 'desglose' : 'simple'
  ));
  const [mode, setMode] = useState(initialMode);

  const totalPagado = Object.values(payments)
    .filter(p => p.estado === 'pagado')
    .reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
  const totalPendiente = Object.values(payments)
    .filter(p => p.estado === 'pendiente')
    .reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);

  // En modo simple, el pago de "producción" se guarda en el rubro 'contenido'
  // (histórico por compatibilidad), y los otros 2 se ponen en 0 pagado.
  const rubrosDesglose = [
    { key: 'contenido', label: 'Contenido' },
    { key: 'envase',    label: 'Envase / Pote' },
    { key: 'etiqueta',  label: 'Etiqueta' },
  ];
  const rubroMentor = { key: 'mentor', label: mentorNombre ? `Comisión — ${mentorNombre}` : 'Comisión mentor' };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pagos de esta orden</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">Tildá "Pagado" cuando se haya abonado.</p>
        </div>
        <div className="flex gap-3 text-xs">
          <div className="text-right">
            <p className="text-gray-500 dark:text-gray-400">Pendiente</p>
            <p className="font-bold text-amber-600 dark:text-amber-400">{fmtMoney(totalPendiente)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 dark:text-gray-400">Pagado</p>
            <p className="font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(totalPagado)}</p>
          </div>
        </div>
      </div>

      {/* Tabs modo simple / desglose */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg max-w-xs">
        <button
          type="button"
          onClick={() => setMode('simple')}
          className={`flex-1 py-1 px-2 text-[11px] rounded-md transition font-semibold ${
            mode === 'simple'
              ? 'bg-white dark:bg-gray-800 text-pink-900 dark:text-pink-300 shadow'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Todo junto
        </button>
        <button
          type="button"
          onClick={() => setMode('desglose')}
          className={`flex-1 py-1 px-2 text-[11px] rounded-md transition font-semibold ${
            mode === 'desglose'
              ? 'bg-white dark:bg-gray-800 text-pink-900 dark:text-pink-300 shadow'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Desglosado
        </button>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${mode === 'simple' ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
        {/* Modo simple: 1 sola card "Producción total" */}
        {mode === 'simple' && (
          <PaymentCard
            label="Producción (todo junto)"
            data={payments.contenido || {}}
            onChange={(patch) => onChange('contenido', patch)}
          />
        )}

        {/* Modo desglose: 3 cards separadas */}
        {mode === 'desglose' && rubrosDesglose.map(rubro => (
          <PaymentCard
            key={rubro.key}
            label={rubro.label}
            data={payments[rubro.key] || {}}
            onChange={(patch) => onChange(rubro.key, patch)}
          />
        ))}

        {/* Comisión del mentor — siempre se muestra si hay mentor asignado */}
        <PaymentCard
          label={rubroMentor.label}
          data={payments.mentor || {}}
          onChange={(patch) => onChange('mentor', patch)}
          disabled={!order.mentorId}
          disabledLabel="sin mentor"
          variant="mentor"
        />
      </div>
    </div>
  );
}

// Card individual para un rubro de pago. Simplificada: solo monto, fecha
// y toggle pagado/pendiente. Sin proveedor ni nota (ruido innecesario).
function PaymentCard({ label, data, onChange, disabled = false, disabledLabel = null, variant = 'default' }) {
  const paid = data.estado === 'pagado';
  const bg = disabled
    ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60'
    : paid
      ? (variant === 'mentor'
          ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
          : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800')
      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${bg}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{label}</span>
        {disabled ? (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 italic">{disabledLabel}</span>
        ) : (
          <label className="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => onChange({ estado: e.target.checked ? 'pagado' : 'pendiente' })}
              className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500"
            />
            <span className={`text-[10px] font-semibold uppercase ${paid ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
              {paid ? 'Pagado' : 'Pendiente'}
            </span>
          </label>
        )}
      </div>
      <div>
        <label className="block text-[10px] uppercase text-gray-500 dark:text-gray-400 mb-0.5">Monto</label>
        <input
          type="number"
          disabled={disabled}
          value={data.monto ?? ''}
          onChange={(e) => onChange({ monto: parseFloat(e.target.value) || 0 })}
          placeholder="0"
          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:cursor-not-allowed"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase text-gray-500 dark:text-gray-400 mb-0.5">Fecha pago</label>
        <input
          type="date"
          disabled={disabled}
          value={data.fecha || ''}
          onChange={(e) => onChange({ fecha: e.target.value })}
          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

function QuickClientModal({ mentors, onClose, onCreate }) {
  const [data, setData] = useState({ nombre: '', telefono: '', mentorId: '', domicilio: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate({
      nombre: data.nombre.trim(),
      telefono: data.telefono.trim(),
      domicilio: data.domicilio.trim(),
      mentorId: data.mentorId ? parseInt(data.mentorId) : null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-xl shadow-2xl p-5 sm:p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Nuevo Cliente</h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
            title="Cancelar"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FormLabel required>Nombre completo</FormLabel>
            <input
              type="text"
              value={data.nombre}
              onChange={(e) => setData({ ...data, nombre: e.target.value })}
              placeholder="Nombre y apellido"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              autoFocus
              required
            />
          </div>
          <div>
            <FormLabel required tip="Es el único canal de contacto que guardamos. Poné el número con código de área.">Teléfono</FormLabel>
            <input
              type="text"
              value={data.telefono}
              onChange={(e) => setData({ ...data, telefono: e.target.value })}
              placeholder="11 1234-5678"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />
          </div>
          <div>
            <FormLabel tip="Si el cliente vino referido por un mentor, asignalo para que se calcule su comisión sobre las ventas.">Mentor asignado</FormLabel>
            <select
              value={data.mentorId}
              onChange={(e) => setData({ ...data, mentorId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            >
              <option value="">Sin mentor</option>
              {mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>
          <div>
            <FormLabel tip="Dirección donde se despachan las órdenes. Después la podés completar desde el módulo de Clientes.">Domicilio de despacho</FormLabel>
            <input
              type="text"
              value={data.domicilio}
              onChange={(e) => setData({ ...data, domicilio: e.target.value })}
              placeholder="Calle 123, Localidad"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
            >
              Crear cliente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Mini-form reutilizable para crear productos desde otros módulos (ej. al registrar una venta).
// Campos requeridos: nombre + precioVenta. Descripción y costos son opcionales (default 0) y
// pueden completarse después desde el módulo de Productos.
function QuickProductModal({ onClose, onCreate }) {
  const [data, setData] = useState({
    nombre: '', descripcion: '', precioVenta: '',
    costoTotal: '',
    modoCosto: 'total',
    costoContenido: '', costoEnvase: '', costoEtiqueta: '',
  });
  const [showCosts, setShowCosts] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      nombre: data.nombre.trim(),
      descripcion: data.descripcion.trim(),
      precioVenta: parseInt(data.precioVenta) || 0,
    };
    if (data.modoCosto === 'total') {
      payload.costoSinDesglosar = parseFloat(data.costoTotal) || 0;
      payload.costoContenido = 0;
      payload.costoEnvase = 0;
      payload.costoEtiqueta = 0;
    } else {
      payload.costoContenido = parseInt(data.costoContenido) || 0;
      payload.costoEnvase = parseInt(data.costoEnvase) || 0;
      payload.costoEtiqueta = parseInt(data.costoEtiqueta) || 0;
      payload.costoSinDesglosar = null;
    }
    onCreate(payload);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-xl shadow-2xl p-5 sm:p-8 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Nuevo Producto</h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
            title="Cancelar"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FormLabel required tip="Cómo aparece en el catálogo y en los listados.">Nombre</FormLabel>
            <input
              type="text"
              value={data.nombre}
              onChange={(e) => setData({ ...data, nombre: e.target.value })}
              placeholder="Nombre del producto"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              autoFocus
              required
            />
          </div>
          <div>
            <FormLabel required tip="El precio por unidad que le cobrás al cliente.">Precio de venta unitario</FormLabel>
            <input
              type="number"
              min="0"
              value={data.precioVenta}
              onChange={(e) => setData({ ...data, precioVenta: e.target.value })}
              placeholder="0"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />
          </div>
          <div>
            <FormLabel tip="Ej: 'Crema hidratante para piel seca'. Sirve para distinguir entre productos similares.">Descripción</FormLabel>
            <input
              type="text"
              value={data.descripcion}
              onChange={(e) => setData({ ...data, descripcion: e.target.value })}
              placeholder="Breve descripción"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCosts(s => !s)}
            className="text-xs font-semibold text-pink-700 dark:text-pink-300 hover:underline"
          >
            {showCosts ? '− Ocultar costo' : '+ Cargar costo ahora (opcional)'}
          </button>
          {showCosts && (
            <div>
              <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg mb-2">
                <button
                  type="button"
                  onClick={() => setData({ ...data, modoCosto: 'total' })}
                  className={`flex-1 py-1 text-[11px] rounded-md transition font-semibold ${
                    data.modoCosto === 'total'
                      ? 'bg-white dark:bg-gray-800 text-pink-900 dark:text-pink-300 shadow'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  Costo total
                </button>
                <button
                  type="button"
                  onClick={() => setData({ ...data, modoCosto: 'desglose' })}
                  className={`flex-1 py-1 text-[11px] rounded-md transition font-semibold ${
                    data.modoCosto === 'desglose'
                      ? 'bg-white dark:bg-gray-800 text-pink-900 dark:text-pink-300 shadow'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  Desglosado
                </button>
              </div>
              {data.modoCosto === 'total' ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={data.costoTotal}
                  onChange={(e) => setData({ ...data, costoTotal: e.target.value })}
                  placeholder="Costo total por unidad"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min="0"
                    value={data.costoContenido}
                    onChange={(e) => setData({ ...data, costoContenido: e.target.value })}
                    placeholder="Contenido"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <input
                    type="number"
                    min="0"
                    value={data.costoEnvase}
                    onChange={(e) => setData({ ...data, costoEnvase: e.target.value })}
                    placeholder="Envase"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <input
                    type="number"
                    min="0"
                    value={data.costoEtiqueta}
                    onChange={(e) => setData({ ...data, costoEtiqueta: e.target.value })}
                    placeholder="Etiqueta"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Podés completarlo después desde el listado de productos.</p>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
            >
              Crear producto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Utility Components
function Modal({ title, onClose, children }) {
  // Cerrar con Escape. Click afuera NO cierra — evita perder datos por un
  // click accidental. Para cerrar hay que usar el botón X o apretar Esc.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-8 w-full max-w-md max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700 animate-scale-in"
      >
        <div className="flex justify-between items-center mb-5 sm:mb-6">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 transition-all duration-200 hover:rotate-90"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Badge({ text, type }) {
  const types = {
    success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${types[type]}`}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
}


// ============================================================================
// MODERN UX PRIMITIVES
// ============================================================================

// Título dinámico según la sección que está viendo el usuario.
function getSectionTitle(user, section) {
  const admin = {
    inicio: 'Dashboard',
    ventas: 'Ventas',
    productos: 'Productos',
    clientes: 'Clientes',
    comisiones: 'Comisiones',
    mentores: 'Equipo',
    analytics: 'Analytics con IA',
    datos: 'Datos (Export / Import)',
  };
  const mentor = {
    inicio: 'Inicio',
    'mis-ordenes': 'Mis Órdenes',
    resumen: 'Mi Balance',
    'mis-clientes': 'Mis Clientes',
  };
  return (user?.role === 'admin' ? admin[section] : mentor[section]) || 'Laboratorio Viora';
}

// Header sticky que agrega blur + border al hacer scroll. Incluye el botón
// del command palette con el keyboard hint (Cmd+K), toggle de tema y fecha.
// Pill de usuario con menú desplegable al click. Incluye:
// - saludo dinámico por horario del día (buen día / buenas tardes / buenas noches)
// - reloj en vivo (HH:mm, refrescado cada 60s) + fecha
// - mini-stats útiles (órdenes pendientes, incidencias, ventas del día)
// - nombre de display editable, persistido en localStorage
// - línea motivacional según el estado del negocio
// - botón de cerrar sesión al final
function UserMenu({ currentUser, sidebarOpen, state, onLogout }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const storageKey = `viora-pref-displayName-${currentUser.role}-${currentUser.id}`;
  const [displayName, setDisplayName] = useState(() => {
    try { return localStorage.getItem(storageKey) || currentUser.name || ''; } catch { return currentUser.name || ''; }
  });
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const menuRef = useRef(null);
  const nameInputRef = useRef(null);

  // Reloj en vivo (refresca cada 30 segundos)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Persistir nombre
  useEffect(() => {
    try { localStorage.setItem(storageKey, displayName); } catch {}
  }, [displayName, storageKey]);

  // Cerrar al click fuera o Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (editingName) setTimeout(() => nameInputRef.current?.select(), 30);
  }, [editingName]);

  // Saludo según la hora
  const hour = now.getHours();
  const greeting = hour < 6 ? 'Buena madrugada'
    : hour < 12 ? 'Buen día'
    : hour < 20 ? 'Buenas tardes'
    : 'Buenas noches';

  // Formatos
  const clock = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const dayName = now.toLocaleDateString('es-AR', { weekday: 'long' });
  const fullDate = now.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });

  // Mini-stats alineadas al workflow de una administradora que toma pedidos,
  // cobra, costea y paga: qué órdenes están activas, cuánta plata tiene por
  // cobrar del cliente y cuánta tiene que pagar (mentores + proveedores).
  const sales = state?.sales || [];
  const products = state?.products || [];
  const mentors = state?.mentors || [];

  const ordenesActivas = sales.filter(o => (o.estado || 'pendiente-cotizacion') !== 'despachado').length;
  const incidencias = sales.filter(s => s.tieneIncidencia).length;

  const aCobrar = sales.reduce((acc, o) => {
    const total = o.montoTotal || 0;
    const cobrado = Array.isArray(o.cobros)
      ? o.cobros.reduce((s, c) => s + (parseFloat(c?.monto) || 0), 0)
      : 0;
    return acc + Math.max(0, total - cobrado);
  }, 0);

  const aPagar = sales.reduce((acc, o) => {
    const product = products.find(p => p.id === o.productoId);
    const mentor = mentors.find(m => m.id === o.mentorId);
    const pagos = getOrderPayments(o, product, mentor);
    let pend = 0;
    ['contenido', 'envase', 'etiqueta'].forEach(k => {
      if (pagos[k]?.estado === 'pendiente') pend += pagos[k].monto || 0;
    });
    if (o.mentorId && pagos.mentor?.estado === 'pendiente') pend += pagos.mentor.monto || 0;
    return acc + pend;
  }, 0);

  // Profit acumulado: (precio venta - costos unitarios) × cantidad, por orden.
  // No descuenta comisión del mentor (ese es profit del mentor, no del lab).
  const profitTotal = sales.reduce((acc, o) => {
    const product = products.find(p => p.id === o.productoId);
    return acc + getOrderProfit(o, product);
  }, 0);

  // Línea motivacional según la situación
  const moodLine = incidencias > 0
    ? `Hay ${incidencias} ${incidencias === 1 ? 'incidencia' : 'incidencias'} sin resolver — ojo ahí.`
    : ordenesActivas === 0
      ? 'Todo despachado. Día limpio 🌟'
      : ordenesActivas > 10
        ? `Semana cargada (${ordenesActivas} órdenes activas). A full.`
        : `${ordenesActivas} ${ordenesActivas === 1 ? 'orden activa' : 'órdenes activas'}. Buen ritmo.`;

  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString('es-AR')}`;
  const initial = (displayName || currentUser.name || 'U').charAt(0).toUpperCase();

  const saveName = () => {
    const cleaned = draftName.trim();
    setDisplayName(cleaned || currentUser.name || '');
    setEditingName(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger: el pill en sí */}
      {sidebarOpen ? (
        <button
          onClick={() => setOpen(v => !v)}
          className={`w-full flex items-center gap-2 p-2 rounded-xl transition-colors duration-200 ${
            open ? 'bg-white/10' : 'bg-white/5 hover:bg-white/10'
          }`}
        >
          <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold flex items-center justify-center shrink-0 shadow">
            {initial}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#4a0f22]" aria-label="En línea" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold truncate text-white">{displayName || currentUser.name}</p>
            <p className="text-[10px] uppercase tracking-wider text-pink-200/70 flex items-center gap-1.5">
              <span>{currentUser.role}</span>
              <span className="text-pink-200/40">·</span>
              <span className="tabular-nums">{clock}</span>
            </p>
          </div>
          <ChevronDown size={14} className={`text-pink-100/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex flex-col items-center"
          title={`${displayName} (${currentUser.role})`}
        >
          <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold flex items-center justify-center shadow">
            {initial}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#4a0f22]" />
          </div>
        </button>
      )}

      {/* Dropdown del menú */}
      {open && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 z-40 bg-gray-900/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-scale-in"
          style={{ transformOrigin: 'bottom center', minWidth: sidebarOpen ? undefined : '16rem', left: sidebarOpen ? undefined : '100%', marginLeft: sidebarOpen ? undefined : '0.5rem', right: sidebarOpen ? undefined : 'auto' }}
        >
          {/* Header del menú */}
          <div className="p-4 bg-gradient-to-br from-pink-900/40 to-[#4a0f22]/40 border-b border-white/10">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold text-lg flex items-center justify-center shadow shrink-0">
                {initial}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-amber-300">{greeting},</p>
                {editingName ? (
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                      if (e.key === 'Escape') { setEditingName(false); setDraftName(displayName); }
                    }}
                    className="w-full bg-white/10 text-white text-base font-bold px-2 py-0.5 rounded border border-amber-300/40 focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                    placeholder="Tu nombre"
                  />
                ) : (
                  <p
                    onClick={() => { setDraftName(displayName); setEditingName(true); }}
                    className="text-base font-bold text-white truncate cursor-pointer hover:text-amber-200 transition"
                    title="Click para cambiar tu nombre de display"
                  >
                    {displayName || currentUser.name}
                  </p>
                )}
                <p className="text-[11px] text-pink-200/70 capitalize">{dayName}, {fullDate} · <span className="tabular-nums">{clock}</span></p>
              </div>
            </div>
            <p className="text-xs text-white/70 mt-3 leading-snug">{moodLine}</p>
          </div>

          {/* Mini-stats: los números que más le importan a la admin día a día */}
          <div className="grid grid-cols-2 gap-px bg-white/5">
            <StatMini label="Activas" value={ordenesActivas} accent={incidencias > 0 ? 'amber' : 'neutral'} />
            <StatMini label="Profit" value={fmtMoney(profitTotal)} accent="emerald" small />
            <StatMini label="A cobrar" value={fmtMoney(aCobrar)} accent="emerald" small />
            <StatMini label="A pagar" value={fmtMoney(aPagar)} accent={aPagar > 0 ? 'red' : 'neutral'} small />
          </div>

          {/* Preferencia: nombre */}
          <div className="p-3 border-t border-white/10">
            <button
              onClick={() => { setDraftName(displayName); setEditingName(true); }}
              className="w-full flex items-center gap-2 text-xs text-white/70 hover:text-white transition"
            >
              <Edit2 size={12} />
              Cambiar mi nombre de display
            </button>
            <button
              onClick={() => {
                if (window.confirm('¿Borrar todos los datos cargados y volver al estado de demo? Esta acción no se puede deshacer.')) {
                  try { localStorage.removeItem('viora-state-v1'); } catch {}
                  window.location.reload();
                }
              }}
              className="w-full mt-2 flex items-center gap-2 text-xs text-white/50 hover:text-red-300 transition"
              title="Borra todas las órdenes, clientes, productos y pagos cargados"
            >
              <Trash2 size={12} />
              Resetear datos a demo
            </button>
          </div>

          {/* Logout */}
          <button
            onClick={() => { onLogout(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-4 py-3 border-t border-white/10 text-pink-200/90 hover:bg-red-500/20 hover:text-white transition text-sm font-medium"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

function StatMini({ label, value, accent = 'neutral', small = false }) {
  const color = accent === 'amber'
    ? 'text-amber-300'
    : accent === 'red'
      ? 'text-red-400'
      : accent === 'emerald'
        ? 'text-emerald-400'
        : 'text-white/80';
  return (
    <div className="bg-gray-900 dark:bg-gray-950 py-2.5 text-center">
      <p className={`${small ? 'text-xs' : 'text-base'} font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-white/50 mt-0.5">{label}</p>
    </div>
  );
}

// Centro de notificaciones con IA: una campanita en el header. Al click,
// llama a /api/insights con un snapshot del negocio y Claude devuelve
// alertas accionables (demoras, saldos grandes, mentores sin pagar).
// Cachea localmente para no quemar API si se abre seguido.
function NotificationsBell({ snapshot }) {
  const [open, setOpen] = useState(false);
  const [alertas, setAlertas] = useState(null); // null = no cargado, [] = sin alertas
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastFetch, setLastFetch] = useState(0);
  const ref = useRef(null);

  // Cierre por click afuera
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const fetchInsights = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setAlertas(Array.isArray(data.alertas) ? data.alertas : []);
      setLastFetch(Date.now());
    } catch (err) {
      setError(err.message || 'No pude obtener alertas.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch al abrir si no hay datos o cache es viejo (>5min)
  useEffect(() => {
    if (!open) return;
    const cacheAge = Date.now() - lastFetch;
    if (alertas == null || cacheAge > 5 * 60 * 1000) fetchInsights();
  }, [open]);

  const count = alertas ? alertas.length : 0;
  const hasAlta = alertas?.some(a => a.prioridad === 'alta');

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
        title="Alertas e insights del negocio"
        aria-label="Notificaciones"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full ${hasAlta ? 'bg-red-500' : 'bg-amber-500'} text-white text-[10px] font-bold flex items-center justify-center shadow`}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[min(420px,calc(100vw-2rem))] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-scale-in" style={{ transformOrigin: 'top right' }}>
          <div className="p-4 bg-gradient-to-r from-pink-50 to-rose-50 dark:from-gray-800 dark:to-gray-900 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Alertas con IA</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Generadas por Claude · Estado actual</p>
              </div>
            </div>
            <button
              onClick={fetchInsights}
              disabled={loading}
              className="p-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-white/80 dark:hover:bg-gray-700 transition disabled:opacity-50"
              title="Refrescar alertas"
            >
              <Search size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && alertas == null && (
              <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                <Sparkles size={24} className="mx-auto mb-2 text-amber-500 animate-pulse" />
                Analizando el estado del negocio…
              </div>
            )}
            {error && (
              <div className="m-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
            {!loading && alertas != null && alertas.length === 0 && !error && (
              <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                <Check size={24} className="mx-auto mb-2 text-emerald-500" />
                Todo en orden. Sin alertas para hoy.
              </div>
            )}
            {alertas && alertas.length > 0 && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {alertas.map((a, i) => (
                  <AlertItem key={i} alerta={a} />
                ))}
              </div>
            )}
          </div>
          {lastFetch > 0 && (
            <div className="px-4 py-2 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 text-center">
              Última actualización: hace {Math.round((Date.now() - lastFetch) / 1000)}s
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertItem({ alerta }) {
  const styles = {
    alta: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-l-red-500', icon: 'text-red-600 dark:text-red-400', label: 'ALTA' },
    media: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-l-amber-500', icon: 'text-amber-600 dark:text-amber-400', label: 'MEDIA' },
    baja: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-l-blue-400', icon: 'text-blue-600 dark:text-blue-400', label: 'INFO' },
  };
  const s = styles[alerta.prioridad] || styles.baja;
  return (
    <div className={`px-4 py-3 ${s.bg} border-l-4 ${s.border}`}>
      <div className="flex items-start gap-2">
        <AlertCircle size={14} className={`mt-0.5 ${s.icon} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{alerta.titulo}</p>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${s.icon} bg-white/60 dark:bg-gray-900/40`}>{s.label}</span>
          </div>
          {alerta.detalle && <p className="text-xs text-gray-600 dark:text-gray-300 leading-snug">{alerta.detalle}</p>}
        </div>
      </div>
    </div>
  );
}

function StickyHeader({ title, subtitle, darkMode, toggleDarkMode, onOpenCommand, onOpenMobileMenu, notificationsSnapshot, bgTasks = [] }) {
  const [scrolled, setScrolled] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4 || (document.querySelector('main')?.scrollTop ?? 0) > 4);
    const main = document.querySelector('main');
    main?.addEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll);
    return () => {
      main?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 px-4 md:px-8 py-4 md:py-5 flex justify-between items-center gap-3 transition-all duration-300 ${
        scrolled
          ? 'backdrop-blur-xl bg-white/70 dark:bg-gray-900/70 border-b border-gray-200/60 dark:border-gray-700/60 shadow-sm'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {onOpenMobileMenu && (
          <button
            onClick={onOpenMobileMenu}
            className="md:hidden p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
            aria-label="Abrir menú"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-tight truncate">{title}</h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm truncate">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenCommand}
          className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-pink-300 dark:hover:border-pink-600 hover:text-gray-900 dark:hover:text-gray-100 transition-all duration-200 hover:shadow group"
          title="Abrir command palette"
        >
          <Search size={13} className="group-hover:scale-110 transition-transform" />
          <span>Buscar…</span>
          <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
            {isMac ? '⌘' : 'Ctrl'} K
          </kbd>
        </button>
        <button
          onClick={onOpenCommand}
          className="sm:hidden p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition shrink-0"
          aria-label="Buscar"
        >
          <Search size={18} />
        </button>
        {bgTasks.length > 0 && (
          <div
            className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 text-[11px] rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 animate-pulse"
            title={bgTasks.join(', ')}
          >
            <Sparkles size={12} className="animate-spin" />
            <span>{bgTasks[0]}{bgTasks.length > 1 ? ` +${bgTasks.length - 1}` : ''}</span>
          </div>
        )}
        {notificationsSnapshot && (
          <NotificationsBell snapshot={notificationsSnapshot} />
        )}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-all duration-200 hover:scale-105 active:scale-95 shrink-0"
          title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          aria-label="Toggle dark mode"
        >
          <div className="relative w-5 h-5">
            <Sun size={20} className={`absolute inset-0 transition-all duration-500 ${darkMode ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'}`} />
            <Moon size={20} className={`absolute inset-0 transition-all duration-500 ${darkMode ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`} />
          </div>
        </button>
      </div>
    </header>
  );
}

// Hook: cuenta animada de 0 → target en `duration` ms con easing suave.
export function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const start = prevTarget.current;
    const end = Number(target) || 0;
    if (start === end) { setValue(end); return; }
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const elapsed = t - t0;
      const p = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(start + (end - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevTarget.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// Command palette estilo spotlight/raycast. Filtra comandos por texto y
// permite navegación con flechas + Enter para ejecutar.
function CommandPalette({ state, currentUser, onClose, onNavigate, onNewSale, onNewClient, onNewProduct, onToggleTheme, onLogout }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Armamos la lista de comandos disponibles según el rol
  const baseCmds = [];
  if (currentUser?.role === 'admin') {
    baseCmds.push(
      { id: 'go-inicio', group: 'Ir a', label: 'Dashboard / Inicio', icon: Home, shortcut: 'G I', run: () => onNavigate('inicio') },
      { id: 'go-ventas', group: 'Ir a', label: 'Ventas', icon: TrendingUp, shortcut: 'G V', run: () => onNavigate('ventas') },
      { id: 'go-productos', group: 'Ir a', label: 'Productos', icon: Package, shortcut: 'G P', run: () => onNavigate('productos') },
      { id: 'go-clientes', group: 'Ir a', label: 'Clientes', icon: Users, shortcut: 'G C', run: () => onNavigate('clientes') },
      { id: 'go-comisiones', group: 'Ir a', label: 'Comisiones', icon: CreditCard, shortcut: 'G $', run: () => onNavigate('comisiones') },
      { id: 'go-mentores', group: 'Ir a', label: 'Mentores', icon: UserCheck, shortcut: 'G M', run: () => onNavigate('mentores') },
      { id: 'new-sale', group: 'Acciones', label: 'Nueva venta', icon: Plus, shortcut: 'N V', run: onNewSale },
      { id: 'new-client', group: 'Acciones', label: 'Nuevo cliente', icon: Plus, shortcut: 'N C', run: onNewClient },
      { id: 'new-product', group: 'Acciones', label: 'Nuevo producto', icon: Plus, shortcut: 'N P', run: onNewProduct },
    );
  } else {
    baseCmds.push(
      { id: 'go-resumen', group: 'Ir a', label: 'Mi Resumen', icon: Home, run: () => onNavigate('resumen') },
      { id: 'go-mis-comisiones', group: 'Ir a', label: 'Mis Comisiones', icon: CreditCard, run: () => onNavigate('mis-comisiones') },
      { id: 'go-mis-clientes', group: 'Ir a', label: 'Mis Clientes', icon: Users, run: () => onNavigate('mis-clientes') },
    );
  }
  baseCmds.push(
    { id: 'toggle-theme', group: 'Preferencias', label: 'Alternar modo claro/oscuro', icon: Moon, run: onToggleTheme },
    { id: 'logout', group: 'Sesión', label: 'Cerrar sesión', icon: LogOut, run: onLogout },
  );

  // Resultados dinámicos por texto: además de los comandos base, matcheamos
  // clientes y productos por nombre y al seleccionar navegamos a la sección.
  const dynamicCmds = [];
  const q = query.trim().toLowerCase();
  if (q && currentUser?.role === 'admin') {
    state.clients.slice(0, 6).filter(c => c.nombre?.toLowerCase().includes(q)).forEach(c => {
      dynamicCmds.push({
        id: `client-${c.id}`,
        group: 'Clientes',
        label: c.nombre,
        meta: c.telefono || '',
        icon: Users,
        run: () => onNavigate('clientes'),
      });
    });
    state.products.slice(0, 6).filter(p => p.nombre?.toLowerCase().includes(q)).forEach(p => {
      dynamicCmds.push({
        id: `product-${p.id}`,
        group: 'Productos',
        label: p.nombre,
        meta: `$${(p.precioVenta || 0).toLocaleString()}`,
        icon: Package,
        run: () => onNavigate('productos'),
      });
    });
  }

  const allCmds = [...baseCmds, ...dynamicCmds];
  const filtered = q
    ? allCmds.filter(c => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
    : allCmds;

  useEffect(() => { setCursor(0); }, [query]);

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(filtered.length - 1, c + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); filtered[cursor]?.run?.(); }
  };

  // Agrupamos por "group" manteniendo el orden de aparición
  const groups = [];
  const byGroup = new Map();
  filtered.forEach((cmd, idx) => {
    if (!byGroup.has(cmd.group)) { byGroup.set(cmd.group, []); groups.push(cmd.group); }
    byGroup.get(cmd.group).push({ ...cmd, _globalIdx: idx });
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
      onClick={onClose}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-scale-in"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Search size={18} className="text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Buscar comandos, clientes, productos..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">
              Sin resultados para "<span className="font-semibold">{query}</span>"
            </div>
          ) : (
            groups.map(g => (
              <div key={g} className="mb-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">{g}</div>
                {byGroup.get(g).map((cmd) => {
                  const Icon = cmd.icon;
                  const isActive = cmd._globalIdx === cursor;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => cmd.run?.()}
                      onMouseEnter={() => setCursor(cmd._globalIdx)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-100 ${
                        isActive
                          ? 'bg-pink-50 dark:bg-pink-900/30 text-pink-900 dark:text-pink-100'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {Icon && <Icon size={16} className={isActive ? 'text-pink-600 dark:text-pink-300' : 'text-gray-400 dark:text-gray-500'} />}
                      <span className="flex-1 text-sm font-medium">{cmd.label}</span>
                      {cmd.meta && <span className="text-xs text-gray-400 dark:text-gray-500">{cmd.meta}</span>}
                      {cmd.shortcut && !cmd.meta && (
                        <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{cmd.shortcut}</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><kbd className="font-mono">↑↓</kbd> navegar</span>
            <span className="inline-flex items-center gap-1"><kbd className="font-mono">↵</kbd> ejecutar</span>
          </div>
          <span>Laboratorio Viora</span>
        </div>
      </div>
    </div>
  );
}

// Container de toasts fijado abajo a la derecha. Cada toast desliza desde
// la derecha con animación y se auto-destruye.
function ToastContainer({ toasts }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto animate-slide-in-right flex items-start gap-3 min-w-[260px] max-w-sm px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-md ${
            t.type === 'success'
              ? 'bg-emerald-50/95 dark:bg-emerald-900/70 border-emerald-200 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100'
              : t.type === 'error'
                ? 'bg-red-50/95 dark:bg-red-900/70 border-red-200 dark:border-red-700 text-red-900 dark:text-red-100'
                : 'bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
          }`}
        >
          <div className={`shrink-0 rounded-full p-1 ${
            t.type === 'success' ? 'bg-emerald-200/60 dark:bg-emerald-800/60' : t.type === 'error' ? 'bg-red-200/60 dark:bg-red-800/60' : 'bg-gray-200/60 dark:bg-gray-700/60'
          }`}>
            {t.type === 'success' ? <Check size={14} /> : t.type === 'error' ? <X size={14} /> : <Bell size={14} />}
          </div>
          <div className="flex-1 text-sm font-medium">{t.message}</div>
        </div>
      ))}
    </div>
  );
}

// Router minimal: decide entre la landing pública (/) y el panel de gestión (/acceso)
// en base a window.location.pathname. Sin dependencia de react-router para mantener
// el bundle chico. Escucha popstate y expone navigate() vía history.pushState.
export default function App() {
  const [path, setPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to) => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== to) {
      window.history.pushState({}, '', to);
    }
    setPath(to);
    window.scrollTo({ top: 0 });
  };

  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized === '/acceso') {
    return <AppShell onExit={() => navigate('/')} />;
  }
  return <LandingPage onAccess={() => navigate('/acceso')} />;
}
