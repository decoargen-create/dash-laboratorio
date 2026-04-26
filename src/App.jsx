import React, { useState, useReducer, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import {
  Menu, LogOut, Home, ShoppingCart, Package, Users, AlertCircle, CreditCard,
  UserCheck, TrendingUp, Plus, Filter, Eye, Edit2, Trash2, Calendar, DollarSign,
  Moon, Sun, ChevronDown, ChevronRight, Search, X, Command, Check, Bell,
  AlignJustify, LayoutGrid, Columns3, Sparkles, Bot, Zap, Activity, FileText, Settings, Loader2, Calculator, Copy, Save, RotateCcw, Target, Play, Inbox, BarChart3, Instagram
} from 'lucide-react';
import { VioraLogo, VioraMark } from './logo.jsx';
import LandingPage from './LandingPage.jsx';
import BocetosSection from './Bocetos.jsx';
import MarketingSection from './Marketing.jsx';
import CompetenciaSection from './Competencia.jsx';
import GastosStackSection from './GastosStack.jsx';
import MetaConnectBanner from './MetaConnectBanner.jsx';
import ArranqueSection from './Arranque.jsx';
import BandejaSection from './Bandeja.jsx';
import MetaAdsSection from './MetaAdsSection.jsx';
import AutoIGSection from './AutoIG.jsx';
import InspiracionSection from './InspiracionSection.jsx';
import { PipelineRunProvider } from './PipelineRunContext.jsx';
import PipelineRunOverlay from './PipelineRunOverlay.jsx';
import { generateCSV, downloadCSV, parseCSV, toNumber, toBool } from './csv.js';
import { loadVioraState, saveVioraState, clearVioraState, createBackup } from './vioraStorage.js';

// Estados del pipeline de producción de una orden
export const ORDER_STATES = [
  'consulta-recibida',
  'cotizacion-enviada',
  'esperando-respuesta',
  'aprobado',
  'abonado',
  'en-produccion',
  'listo-enviar',
  'despachado',
];

export const ORDER_STATE_LABELS = {
  'consulta-recibida': 'Consulta recibida',
  'cotizacion-enviada': 'Cotización enviada',
  'esperando-respuesta': 'Esperando respuesta',
  'aprobado': 'Aprobado',
  'abonado': 'Abonado',
  'en-produccion': 'En Producción',
  'listo-enviar': 'Listo para enviar',
  'despachado': 'Despachado',
};

// Clases tailwind para el chip de estado
export const ORDER_STATE_STYLES = {
  'consulta-recibida': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  'cotizacion-enviada': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'esperando-respuesta': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  'aprobado': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  'abonado': 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  'en-produccion': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'listo-enviar': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'despachado': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

// Estado inicial vacío — la app arranca en cero para que cargues tu data real
// (productos, clientes, mentores, órdenes) desde el primer uso.
//
// Si querés datos de demo para testear la UI, mirá DEMO_STATE abajo y usá
// el botón "Cargar datos de demo" en el menú de usuario.
const INITIAL_STATE = {
  products: [],
  clients: [],
  mentors: [],
  sales: [],
};

// Datos demo opcionales. No se cargan por default. Se pueden inyectar desde
// el menú de usuario para explorar la app con data ya lista.
const DEMO_STATE = {
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
    { id: 10, fecha: '2024-03-22', clienteId: 7, productoId: 1, cantidad: 100, montoTotal: 45000, mentorId: 1, estadoComision: 'pendiente', estado: 'aprobado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 11, fecha: '2024-04-02', clienteId: 3, productoId: 2, cantidad: 100, montoTotal: 65000, mentorId: 1, estadoComision: 'pendiente', estado: 'consulta-recibida', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 12, fecha: '2024-04-05', clienteId: 6, productoId: 4, cantidad: 200, montoTotal: 64000, mentorId: 2, estadoComision: 'pendiente', estado: 'abonado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 13, fecha: '2024-04-08', clienteId: 2, productoId: 5, cantidad: 100, montoTotal: 42000, mentorId: 2, estadoComision: 'pendiente', estado: 'en-produccion', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 14, fecha: '2024-04-10', clienteId: 8, productoId: 3, cantidad: 150, montoTotal: 82500, mentorId: 2, estadoComision: 'pendiente', estado: 'aprobado', tieneIncidencia: false, incidenciaDetalle: '' },
    { id: 15, fecha: '2024-04-12', clienteId: 4, productoId: 1, cantidad: 250, montoTotal: 112500, mentorId: 2, estadoComision: 'pendiente', estado: 'consulta-recibida', tieneIncidencia: false, incidenciaDetalle: '' },
  ],
};

function appReducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      // Reemplaza el state con uno cargado desde IndexedDB (boot).
      // Hace merge con el state actual por si en el medio se modificó algo
      // (poco probable porque el render espera a hydrated, pero defensivo).
      return { ...state, ...action.payload };
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
    case 'ADD_MENTOR':
      return { ...state, mentors: [...state.mentors, action.payload] };
    case 'REMOVE_MENTOR':
      // Al borrar un partner, lo desasignamos de las órdenes/clientes para
      // no dejar referencias colgadas (mentorId a un partner que no existe).
      return {
        ...state,
        mentors: state.mentors.filter(m => m.id !== action.payload.id),
        sales: state.sales.map(s => s.mentorId === action.payload.id ? { ...s, mentorId: null } : s),
        clients: state.clients.map(c => c.mentorId === action.payload.id ? { ...c, mentorId: null } : c),
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
      return {
        ...state,
        sales: state.sales.map(s => s.id === action.payload.id ? { ...s, ...action.payload.patch } : s)
      };
    }
    case 'DELETE_ORDER': {
      return {
        ...state,
        sales: state.sales.filter(s => s.id !== action.payload.id)
      };
    }
    case 'ADD_ORDER_NOTE': {
      const { orderId, nota } = action.payload;
      return {
        ...state,
        sales: state.sales.map(s => s.id !== orderId ? s : {
          ...s,
          notas: [...(s.notas || []), { texto: nota, fecha: new Date().toISOString().split('T')[0] }],
        }),
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
  // Este es el "profit antes de descontar comisión del partner".
  // Para el profit real que queda para el lab, usar getLabRealProfit.
  const eff = getOrderEffectiveUnit(order, product);
  const unitCost = eff.costoContenido + eff.costoEnvase + eff.costoEtiqueta;
  const cantidad = order?.cantidad || 0;
  return (eff.precioVenta - unitCost) * cantidad;
}

// Costo INFORMADO al partner/cliente (por unidad). Puede ser distinto al
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
// Base para calcular la comisión del partner: es justo que ellos cobren
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

// Comisión del partner = porcentaje × profit INFORMADO (sobre costoInformado).
// Prioridad:
//  1. Si se pasa mentor y product, usa mentor.porcentajeComision (default 50)
//     × profit informado (sobre costoInformado del producto/orden).
//  2. Sin mentor/product, último fallback: 50% del montoTotal.
export function getMentorCommission(order, product, mentor) {
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
// Balance global de un partner: cuánto generó en comisiones (acumulado de
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
  mentor: 'Comisión partner',
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
// v2: bumpeada cuando pasamos el INITIAL_STATE a vacío (antes tenía data demo).
// Al cambiar la key, los usuarios con data en v1 arrancan limpios tras el
// deploy. Si tenés data importante en v1, exportala desde la sección Datos
// antes de actualizar, o borrá manualmente viora-state-v1 de localStorage.
const STATE_STORAGE_KEY = 'viora-state-v2';

function loadPersistedState() {
  if (typeof window === 'undefined') return INITIAL_STATE;
  try {
    const stored = localStorage.getItem(STATE_STORAGE_KEY);
    if (!stored) return INITIAL_STATE;
    const parsed = JSON.parse(stored);
    // Validación mínima de forma — si falta algún array clave, arranca de cero.
    if (!parsed || typeof parsed !== 'object') return INITIAL_STATE;
    // Migrate old estado values to new pipeline stages
    const STATE_MIGRATION = {
      'pendiente-cotizacion': 'consulta-recibida',
      'cotizado': 'aprobado',
    };
    const rawSales = Array.isArray(parsed.sales) ? parsed.sales : INITIAL_STATE.sales;
    const migratedSales = rawSales.map(s => {
      const migrated = STATE_MIGRATION[s.estado];
      return migrated ? { ...s, estado: migrated } : s;
    });
    return {
      products: Array.isArray(parsed.products) ? parsed.products : INITIAL_STATE.products,
      clients: Array.isArray(parsed.clients) ? parsed.clients : INITIAL_STATE.clients,
      mentors: Array.isArray(parsed.mentors) ? parsed.mentors : INITIAL_STATE.mentors,
      sales: migratedSales,
    };
  } catch {
    return INITIAL_STATE;
  }
}

// Definición de plataformas disponibles en el dashboard. Cada una tiene su
// propio look (sidebar gradient + acento) y sus datos aislados.
// Para agregar una nueva plataforma: sumala acá + agregá su sidebar en el
// render del AppShell (bloque condicional por currentPlatform).
const PLATFORMS = [
  {
    id: 'viora',
    name: 'Laboratorio Viora',
    shortName: 'Viora',
    initials: 'LV',
    // Tailwind clases para el gradient del sidebar.
    sidebarGradient: 'from-[#4a0f22] via-pink-900 to-[#3f0c1e]',
    // Clase del "badge" cuadrado en el switcher.
    badgeBg: 'bg-gradient-to-br from-pink-600 to-rose-500',
    badgeText: 'text-white',
    defaultSection: 'inicio',
  },
  {
    id: 'senydrop',
    name: 'Senydrop',
    shortName: 'Senydrop',
    initials: 'SD',
    sidebarGradient: 'from-gray-900 via-gray-800 to-black',
    badgeBg: 'bg-[#FFD33D]',
    badgeText: 'text-gray-900',
    defaultSection: 'seny-productos',
  },
  {
    id: 'metaads',
    name: 'Meta Ads',
    shortName: 'Meta Ads',
    initials: 'MA',
    sidebarGradient: 'from-[#0668E1] via-[#1877F2] to-[#0053A0]',
    badgeBg: 'bg-gradient-to-br from-[#0668E1] to-[#1877F2]',
    badgeText: 'text-white',
    defaultSection: 'meta-inicio',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    shortName: 'Marketing',
    initials: 'MK',
    sidebarGradient: 'from-purple-900 via-purple-700 to-violet-800',
    badgeBg: 'bg-gradient-to-br from-purple-600 to-violet-500',
    badgeText: 'text-white',
    defaultSection: 'mk-arranque',
  },
];

function getPlatform(id) {
  return PLATFORMS.find(p => p.id === id) || PLATFORMS[0];
}

// Switcher al tope del sidebar. Muestra la plataforma activa y, al hacer click,
// abre un dropdown para cambiar de plataforma.
function PlatformSwitcher({ currentPlatform, onSwitch, sidebarOpen }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const platform = getPlatform(currentPlatform);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/10 transition-colors ${!sidebarOpen ? 'justify-center' : ''}`}
        title={!sidebarOpen ? platform.name : 'Cambiar de plataforma'}
      >
        <div className={`shrink-0 w-9 h-9 rounded-lg ${platform.badgeBg} ${platform.badgeText} flex items-center justify-center font-bold text-xs shadow-md`}>
          {platform.initials}
        </div>
        {sidebarOpen && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[10px] font-semibold text-white/50 uppercase tracking-wider leading-none">Plataforma</div>
              <div className="text-sm font-bold text-white truncate leading-tight mt-0.5">{platform.shortName}</div>
            </div>
            <ChevronDown size={14} className={`text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div className={`absolute z-50 mt-2 ${sidebarOpen ? 'left-0 right-0' : 'left-full ml-2 w-56'} bg-gray-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden`}>
          <div className="px-3 py-2 text-[10px] font-bold text-white/40 uppercase tracking-wider border-b border-white/5">
            Plataformas
          </div>
          {PLATFORMS.map(p => {
            const isActive = p.id === currentPlatform;
            return (
              <button
                key={p.id}
                onClick={() => { onSwitch(p.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition ${isActive ? 'bg-white/5' : 'hover:bg-white/5'}`}
              >
                <div className={`shrink-0 w-7 h-7 rounded-md ${p.badgeBg} ${p.badgeText} flex items-center justify-center font-bold text-[10px]`}>
                  {p.initials}
                </div>
                <span className="flex-1 text-sm font-medium text-white truncate">{p.name}</span>
                {isActive && <Check size={14} className="text-white/60" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Calculadora de proyección: simula órdenes sin tocar los datos reales.
// Podés elegir producto + partner del estado actual o armar custom, cambiar
// cantidad, precio venta, costo informado, % comisión, fulfillment y extras.
// Ve en vivo ganancia informada, comisión, profit real, margen. Guardás
// escenarios en localStorage para compararlos side-by-side.
function CalculadoraSection({ state, addToast }) {
  const STORAGE_KEY = 'viora-calc-escenarios-v1';
  const DEFAULT_FORM = {
    productoId: '',
    cantidad: 100,
    costoRealUnit: 0,          // costo real por unidad
    precioVentaUnit: 0,
    costoInfUnit: 0,           // costo informado al partner por unidad
    mentorId: '',
    pctPartner: 50,
    fulfillmentTotal: 0,       // costo fulfillment total (no per unit)
    extrasTotal: 0,            // otros costos fijos (envío, impuestos, etc)
  };

  const [form, setForm] = useState(DEFAULT_FORM);
  const [escenarios, setEscenarios] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [nombreEscenario, setNombreEscenario] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(escenarios)); } catch {}
  }, [escenarios]);

  // Auto-rellena los valores del producto seleccionado. El user después
  // puede tocarlos libremente (simulación).
  const handleProductoChange = (productoId) => {
    const p = state.products.find(x => x.id === Number(productoId));
    if (!p) { setForm(prev => ({ ...prev, productoId })); return; }
    const costoUnit = getProductUnitCost(p);
    const costoInfUnit = p.costoInformado ?? p.costoSinDesglosar ?? costoUnit;
    setForm(prev => ({
      ...prev,
      productoId,
      costoRealUnit: costoUnit,
      precioVentaUnit: p.precioVenta || 0,
      costoInfUnit: costoInfUnit || 0,
    }));
  };

  const handleMentorChange = (mentorId) => {
    const m = state.mentors.find(x => x.id === Number(mentorId));
    setForm(prev => ({
      ...prev,
      mentorId,
      pctPartner: m?.porcentajeComision ?? prev.pctPartner,
    }));
  };

  // Cálculos en vivo.
  const calc = useMemo(() => {
    const cantidad = Number(form.cantidad) || 0;
    const costoRealUnit = Number(form.costoRealUnit) || 0;
    const precioVentaUnit = Number(form.precioVentaUnit) || 0;
    const costoInfUnit = Number(form.costoInfUnit) || 0;
    const pctPartner = Number(form.pctPartner) || 0;
    const fulfillmentTotal = Number(form.fulfillmentTotal) || 0;
    const extrasTotal = Number(form.extrasTotal) || 0;

    const precioVentaTotal = precioVentaUnit * cantidad;
    const costoRealTotal = costoRealUnit * cantidad;
    const costoInfTotal = costoInfUnit * cantidad;
    const gananciaInformada = Math.max(0, precioVentaTotal - costoInfTotal);
    const comisionPartner = form.mentorId || pctPartner > 0
      ? Math.round(gananciaInformada * (pctPartner / 100))
      : 0;
    const profitReal = precioVentaTotal - costoRealTotal - comisionPartner - fulfillmentTotal - extrasTotal;
    const margenPct = precioVentaTotal > 0 ? (profitReal / precioVentaTotal) * 100 : 0;
    const profitPerUnit = cantidad > 0 ? profitReal / cantidad : 0;

    return {
      cantidad, costoRealUnit, precioVentaUnit, costoInfUnit, pctPartner,
      fulfillmentTotal, extrasTotal,
      precioVentaTotal, costoRealTotal, costoInfTotal,
      gananciaInformada, comisionPartner, profitReal, margenPct, profitPerUnit,
    };
  }, [form]);

  const handleGuardar = () => {
    const nombre = nombreEscenario.trim() || `Escenario ${escenarios.length + 1}`;
    const producto = state.products.find(p => p.id === Number(form.productoId));
    const mentor = state.mentors.find(m => m.id === Number(form.mentorId));
    const snapshot = {
      id: Date.now(),
      nombre,
      createdAt: new Date().toISOString(),
      form: { ...form },
      calc: { ...calc },
      productoNombre: producto?.nombre || 'Personalizado',
      mentorNombre: mentor?.nombre || (form.pctPartner > 0 ? `${form.pctPartner}% custom` : 'Sin partner'),
    };
    setEscenarios(prev => [snapshot, ...prev].slice(0, 10));
    setNombreEscenario('');
    addToast?.({ type: 'success', message: `Escenario "${nombre}" guardado` });
  };

  const handleDelete = (id) => {
    setEscenarios(prev => prev.filter(e => e.id !== id));
  };

  const handleLoad = (e) => {
    setForm(e.form);
    setNombreEscenario(e.nombre);
    addToast?.({ type: 'success', message: `Escenario "${e.nombre}" cargado` });
  };

  const handleReset = () => {
    setForm(DEFAULT_FORM);
    setNombreEscenario('');
  };

  const f = (n) => `$${Math.round(n || 0).toLocaleString('es-AR')}`;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-600 to-rose-500 flex items-center justify-center">
            <Calculator size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Calculadora de proyección</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Simulá órdenes sin tocar tus datos reales. Cargá escenarios para comparar.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Columna inputs */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Producto</label>
              <select
                value={form.productoId}
                onChange={(e) => handleProductoChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="">— Personalizado —</option>
                {state.products.map(p => <option key={p.id} value={p.id}>{p.nombre} · ${p.precioVenta}/u</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Cantidad</label>
                <input type="number" min="1" value={form.cantidad}
                  onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Precio venta /u</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" value={form.precioVentaUnit}
                    onChange={(e) => setForm({ ...form, precioVentaUnit: e.target.value })}
                    className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Costo real /u</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" value={form.costoRealUnit}
                    onChange={(e) => setForm({ ...form, costoRealUnit: e.target.value })}
                    className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Costo informado /u</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" value={form.costoInfUnit}
                    onChange={(e) => setForm({ ...form, costoInfUnit: e.target.value })}
                    className="w-full pl-6 pr-3 py-2 border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Partner</label>
                <select
                  value={form.mentorId}
                  onChange={(e) => handleMentorChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                  <option value="">Sin partner</option>
                  {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">% Comisión</label>
                <div className="relative">
                  <input type="number" min="0" max="100" step="0.5" value={form.pctPartner}
                    onChange={(e) => setForm({ ...form, pctPartner: e.target.value })}
                    className="w-full pr-7 pl-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Fulfillment (total)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" value={form.fulfillmentTotal}
                    onChange={(e) => setForm({ ...form, fulfillmentTotal: e.target.value })}
                    className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">Extras (total)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" value={form.extrasTotal}
                    onChange={(e) => setForm({ ...form, extrasTotal: e.target.value })}
                    className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <input
                type="text"
                value={nombreEscenario}
                onChange={(e) => setNombreEscenario(e.target.value)}
                placeholder="Nombre del escenario (opcional)"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
              <button onClick={handleGuardar}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-pink-900 rounded-lg hover:bg-pink-800 transition">
                <Save size={14} /> Guardar
              </button>
              <button onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition"
                title="Resetear">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          {/* Columna resultados */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <ResultadoCard label="Precio venta" value={f(calc.precioVentaTotal)} sub={`${f(calc.precioVentaUnit)}/u × ${calc.cantidad}`} color="gray" />
              <ResultadoCard label="Costo real" value={f(calc.costoRealTotal)} sub={`${f(calc.costoRealUnit)}/u`} color="gray" />
              <ResultadoCard label="Costo informado" value={f(calc.costoInfTotal)} sub={`${f(calc.costoInfUnit)}/u`} color="amber" />
              <ResultadoCard label="Ganancia informada" value={f(calc.gananciaInformada)} sub="PV − costo informado" color="sky" />
              <ResultadoCard label={`Comisión partner (${calc.pctPartner}%)`} value={f(calc.comisionPartner)} sub="sobre ganancia informada" color="emerald" />
              <ResultadoCard label="Extras + fulfillment" value={f(calc.fulfillmentTotal + calc.extrasTotal)} sub="costos adicionales" color="gray" />
            </div>
            <div className={`p-4 rounded-xl border-2 ${calc.profitReal >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700' : 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Profit real</span>
                <span className={`text-xs font-bold ${calc.margenPct >= 20 ? 'text-emerald-700 dark:text-emerald-300' : calc.margenPct >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
                  margen {calc.margenPct.toFixed(1)}%
                </span>
              </div>
              <p className={`text-2xl font-bold ${calc.profitReal >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {f(calc.profitReal)}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                {f(calc.profitPerUnit)}/u · fórmula: PV − costo real − comisión − extras
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Escenarios guardados */}
      {escenarios.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-4">
            Escenarios guardados ({escenarios.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="text-left py-2 px-2">Nombre</th>
                  <th className="text-left py-2 px-2">Producto / Partner</th>
                  <th className="text-right py-2 px-2">Cant.</th>
                  <th className="text-right py-2 px-2">PV total</th>
                  <th className="text-right py-2 px-2">Comisión</th>
                  <th className="text-right py-2 px-2">Profit</th>
                  <th className="text-right py-2 px-2">Margen</th>
                  <th className="text-right py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {escenarios.map(e => (
                  <tr key={e.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                    <td className="py-2 px-2 font-semibold text-gray-900 dark:text-gray-100">{e.nombre}</td>
                    <td className="py-2 px-2 text-xs text-gray-600 dark:text-gray-300">{e.productoNombre} · {e.mentorNombre}</td>
                    <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200 tabular-nums">{e.calc.cantidad}</td>
                    <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200 tabular-nums">{f(e.calc.precioVentaTotal)}</td>
                    <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{f(e.calc.comisionPartner)}</td>
                    <td className={`py-2 px-2 text-right font-bold tabular-nums ${e.calc.profitReal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{f(e.calc.profitReal)}</td>
                    <td className="py-2 px-2 text-right text-xs text-gray-500 dark:text-gray-400 tabular-nums">{e.calc.margenPct.toFixed(1)}%</td>
                    <td className="py-2 px-2 text-right">
                      <button onClick={() => handleLoad(e)} className="p-1 text-gray-500 hover:text-pink-600 transition" title="Cargar"><Copy size={12} /></button>
                      <button onClick={() => handleDelete(e.id)} className="p-1 text-gray-500 hover:text-red-600 transition" title="Borrar"><Trash2 size={12} /></button>
                    </td>
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

function ResultadoCard({ label, value, sub, color }) {
  const colors = {
    gray: 'bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200',
    sky: 'bg-sky-50 dark:bg-sky-900/20 text-sky-900 dark:text-sky-200',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200',
  };
  return (
    <div className={`p-3 rounded-lg ${colors[color] || colors.gray}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-0.5">{label}</p>
      <p className="text-base font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

// Placeholder de la plataforma Meta Ads. Arranca con las 4 sub-secciones
// como stubs para que se vean en la UI. La sub-sección "Conexión" ya es
// funcional (OAuth real con Meta Graph API).
function MetaAdsPlaceholder({ section }) {
  if (section === 'meta-config') return <MetaConexionSection />;
  const titles = {
    'meta-inicio': 'Meta Ads — Inicio',
    'meta-campanas': 'Campañas',
    'meta-metricas': 'Métricas y Reportes',
  };
  const descs = {
    'meta-inicio': 'Panel principal con las métricas clave del día de tus campañas activas.',
    'meta-campanas': 'Listado y creación de campañas, ad sets y creatividades.',
    'meta-metricas': 'Reportes de performance: CPM, CTR, conversiones, ROAS por período.',
  };
  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-gradient-to-br from-[#E7F3FF] to-white border border-[#1877F2]/20 rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white font-bold">
            MA
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{titles[section] || 'Meta Ads'}</h2>
            <p className="text-sm text-gray-600 mt-0.5">{descs[section] || 'Plataforma en construcción.'}</p>
          </div>
        </div>
        <div className="mt-6 p-4 bg-white border border-dashed border-gray-300 rounded-xl">
          <p className="text-sm font-semibold text-gray-700 mb-1">🚧 Próximamente</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Primero hay que conectar la cuenta de Meta. Andá a <span className="font-semibold">Conexión Meta</span> en el sidebar.
          </p>
        </div>
      </div>
    </div>
  );
}

// Sección de conexión con Meta: OAuth flow. Llama /api/meta/me al montar
// para chequear si ya hay sesión activa, ofrece botón Conectar (redirect a
// /api/meta/connect) o muestra datos del usuario conectado con botón
// Desconectar.
function MetaConexionSection() {
  const [state, setState] = useState({ loading: true, connected: false, user: null, expiresAt: null });
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState(null);

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const r = await fetch('/api/meta/me');
      const data = await r.json();
      setState({ loading: false, connected: !!data.connected, user: data.user || null, expiresAt: data.expiresAt || null });
    } catch (err) {
      setState({ loading: false, connected: false, user: null, expiresAt: null, error: err.message });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Si el callback redirigió con ?meta=connected o ?meta=error, detectamos el
  // mensaje, limpiamos el query param y refrescamos el estado.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('meta')) {
      const status = params.get('meta');
      const reason = params.get('reason');
      if (status === 'error' && reason) setConnectError(reason);
      else setConnectError(null);
      params.delete('meta');
      params.delete('reason');
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      refresh();
    }
  }, [refresh]);

  const handleConnect = () => {
    setBusy(true);
    // Redirigimos al endpoint que a su vez redirige a Meta. No usamos fetch
    // porque el flow OAuth requiere redirección completa del browser.
    window.location.href = `/api/meta/connect?returnTo=${encodeURIComponent('/acceso')}`;
  };

  const handleDisconnect = async () => {
    if (!window.confirm('¿Desconectar tu cuenta de Meta? Podés volver a conectarla cuando quieras.')) return;
    setBusy(true);
    try {
      await fetch('/api/meta/disconnect', { method: 'POST' });
      await refresh();
    } finally { setBusy(false); }
  };

  if (state.loading) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-gray-500" />
          <span className="text-sm text-gray-600">Verificando conexión con Meta…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="bg-gradient-to-br from-[#E7F3FF] to-white border border-[#1877F2]/20 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0668E1] to-[#1877F2] flex items-center justify-center text-white font-bold">MA</div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Conexión con Meta</h2>
            <p className="text-sm text-gray-600 mt-0.5">Conectá tu cuenta para poder leer y gestionar campañas vía Marketing API.</p>
          </div>
        </div>

        {state.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-emerald-200">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <Check size={20} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">Conectado como {state.user?.name || 'usuario Meta'}</p>
                <p className="text-xs text-gray-500">
                  ID: <code className="font-mono">{state.user?.id || '—'}</code>
                  {state.expiresAt && <> · Expira {new Date(state.expiresAt).toLocaleDateString('es-AR')}</>}
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition disabled:opacity-50"
              >
                <LogOut size={14} /> Desconectar
              </button>
            </div>
            <div className="p-4 bg-white border border-dashed border-gray-300 rounded-xl">
              <p className="text-sm font-semibold text-gray-700 mb-1">✅ Listo para usar</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Andá a <span className="font-semibold">Campañas</span> para elegir una de tus cuentas publicitarias y empezar a trabajar.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {connectError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-900">No se pudo conectar</p>
                  <p className="text-xs text-red-700 mt-0.5 break-words">{connectError}</p>
                </div>
                <button
                  onClick={() => setConnectError(null)}
                  className="text-red-400 hover:text-red-600 transition"
                  aria-label="Cerrar"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <button
              onClick={handleConnect}
              disabled={busy}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-bold text-white bg-gradient-to-br from-[#0668E1] to-[#1877F2] rounded-lg hover:from-[#0556BE] hover:to-[#1668D8] shadow-sm transition disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              Conectar con Meta
            </button>
            <div className="p-4 bg-white border border-dashed border-gray-300 rounded-xl">
              <p className="text-sm font-semibold text-gray-700 mb-2">Qué permisos se piden</p>
              <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
                <li><code className="font-mono">ads_read</code>, <code className="font-mono">ads_management</code> — lectura y gestión de campañas</li>
                <li><code className="font-mono">business_management</code> — listar cuentas publicitarias</li>
                <li><code className="font-mono">pages_show_list</code> — listar las páginas de Facebook que administrás</li>
              </ul>
              <p className="text-xs text-gray-500 mt-3">
                El token se guarda en una cookie HttpOnly del servidor (no accesible por JavaScript). Para revocar acceso podés venir acá y desconectar, o ir a Meta → Configuración → Apps.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Pill flotante que muestra el progreso del análisis de marketing en curso.
// Se renderiza arriba a la derecha del main cuando hay un bgAnalysis activo.
// Siempre visible (incluso si navegás a otra plataforma/sección) para poder
// ver progreso y cancelar en un click.
function BgAnalysisPill({ analysis, onView, onCancel, onDismiss }) {
  if (!analysis) return null;
  const { productoNombre, currentStep, stepStatus, elapsedSec, status, errorMsg } = analysis;

  // Misma definición de STEPS que Marketing.jsx para el contador de progreso.
  const TOTAL = 5;
  const doneCount = Object.values(stepStatus || {}).filter(v => v === 'done').length;
  const pct = Math.round((doneCount / TOTAL) * 100);
  const mm = String(Math.floor((elapsedSec || 0) / 60)).padStart(2, '0');
  const ss = String((elapsedSec || 0) % 60).padStart(2, '0');

  const stepLabels = {
    research: 'Research Doc',
    avatar: 'Avatar Sheet',
    offerBrief: 'Offer Brief',
    beliefs: 'Creencias',
    resumenEjecutivo: 'Resumen ejecutivo',
  };
  const currentLabel = stepLabels[currentStep] || (status === 'done' ? 'Completado' : status === 'error' ? 'Error' : status === 'cancelled' ? 'Cancelado' : 'Preparando…');

  const isRunning = status === 'running';
  const isDone = status === 'done';
  const isError = status === 'error';
  const isCancelled = status === 'cancelled';

  const borderColor = isError ? 'border-red-400 dark:border-red-600' :
                      isDone ? 'border-emerald-400 dark:border-emerald-600' :
                      isCancelled ? 'border-gray-300 dark:border-gray-600' :
                      'border-purple-400 dark:border-purple-600';

  return (
    <div className={`fixed top-4 right-4 z-50 w-80 bg-white dark:bg-gray-800 border-2 ${borderColor} rounded-xl shadow-2xl overflow-hidden animate-fade-in-up`}>
      <div className="p-3">
        <div className="flex items-start gap-2 mb-2">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-violet-500 flex items-center justify-center">
            {isRunning ? <Loader2 size={14} className="text-white animate-spin" /> :
             isDone ? <Check size={14} className="text-white" /> :
             isError ? <AlertCircle size={14} className="text-white" /> :
             <Sparkles size={14} className="text-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider leading-none">Marketing · Análisis</p>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate mt-0.5">{productoNombre}</p>
          </div>
          {(isDone || isError || isCancelled) && (
            <button onClick={onDismiss} className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition" title="Cerrar">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300 mb-1.5">
          <span className="font-semibold">{currentLabel}</span>
          <span className="tabular-nums">{mm}:{ss} · {pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isError ? 'bg-red-500' : isCancelled ? 'bg-gray-400' : 'bg-gradient-to-r from-purple-600 to-violet-500'}`}
            style={{ width: `${isDone ? 100 : pct}%` }}
          />
        </div>
        {isError && errorMsg && (
          <p className="text-[11px] text-red-600 dark:text-red-300 mt-2 line-clamp-2">{errorMsg}</p>
        )}
        <div className="flex items-center gap-1.5 mt-3">
          <button
            onClick={onView}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold text-white bg-gradient-to-br from-purple-600 to-violet-500 hover:from-purple-700 hover:to-violet-600 rounded-md transition"
          >
            Ver detalle
          </button>
          {isRunning && (
            <button
              onClick={() => { if (window.confirm('¿Cancelar el análisis en curso?')) onCancel(); }}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 rounded-md transition"
              title="Cancelar"
            >
              <X size={11} /> Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AppShell({ onExit }) {
  // Arrancamos con INITIAL_STATE y luego hidratamos desde IndexedDB. Eso
  // protege los datos de Viora de cualquier `localStorage.clear()` que el
  // módulo Marketing pueda hacer al resetear su propio state.
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hidratación inicial — async porque IndexedDB.
  useEffect(() => {
    let alive = true;
    loadVioraState()
      .then(loaded => {
        if (!alive) return;
        if (loaded && typeof loaded === 'object') {
          // Migración de estados viejos (pre-pipeline actual).
          const STATE_MIGRATION = {
            'pendiente-cotizacion': 'consulta-recibida',
            'cotizado': 'aprobado',
          };
          const rawSales = Array.isArray(loaded.sales) ? loaded.sales : INITIAL_STATE.sales;
          const sales = rawSales.map(s => STATE_MIGRATION[s.estado] ? { ...s, estado: STATE_MIGRATION[s.estado] } : s);
          dispatch({
            type: 'HYDRATE',
            payload: {
              products: Array.isArray(loaded.products) ? loaded.products : INITIAL_STATE.products,
              clients: Array.isArray(loaded.clients) ? loaded.clients : INITIAL_STATE.clients,
              mentors: Array.isArray(loaded.mentors) ? loaded.mentors : INITIAL_STATE.mentors,
              sales,
            },
          });
        }
        setHydrated(true);
      })
      .catch(err => {
        console.warn('[viora] hydrate falló, arranco con INITIAL_STATE:', err?.message);
        setHydrated(true);
      });
    return () => { alive = false; };
  }, []);

  // Persistimos el state en IndexedDB cada vez que cambia, debounced 200ms
  // para no saturar con cada keystroke. Solo después de hydrated para no
  // sobreescribir lo cargado con el INITIAL_STATE inicial.
  useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(() => {
      saveVioraState(state).catch(err => console.warn('[viora] save falló:', err?.message));
    }, 200);
    return () => clearTimeout(id);
  }, [state, hydrated]);

  // Backup automático cada hora — red de seguridad ante state corrupto.
  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => {
      createBackup(state).catch(() => {});
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [state, hydrated]);
  const [currentUser, setCurrentUser] = useState(null);
  // Plataforma actual (switcher en el tope del sidebar). Cada plataforma tiene
  // su propio sidebar (logo, colores, secciones) y sus datos aislados.
  const [currentPlatform, setCurrentPlatform] = useState(() => {
    try { return localStorage.getItem('viora-current-platform') || 'viora'; } catch { return 'viora'; }
  });
  useEffect(() => {
    try { localStorage.setItem('viora-current-platform', currentPlatform); } catch {}
  }, [currentPlatform]);
  const [currentSection, setCurrentSection] = useState(() => {
    try { return localStorage.getItem('viora-last-section') || 'inicio'; } catch { return 'inicio'; }
  });
  useEffect(() => {
    try { localStorage.setItem('viora-last-section', currentSection); } catch {}
  }, [currentSection]);
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

  const addToast = (toast) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, ...toast }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), toast.duration || 3500);
  };

  // --------- Background analysis del módulo Marketing ---------
  // Vive a nivel del AppShell (no dentro de MarketingSection) para que siga
  // corriendo cuando el user navega a otra sección / plataforma. La pill
  // flotante se renderiza en el main para que sea visible desde cualquier
  // contexto.
  const [bgAnalysis, setBgAnalysis] = useState(null);
  // bgAnalysis = {
  //   productoNombre, productoUrl, startedAt, currentStep, stepStatus,
  //   liveOutputs, elapsedSec, tickerIdx, infoMsg, errorMsg,
  //   ogImage, descripcion, status: 'running' | 'done' | 'error' | 'cancelled'
  // }
  const bgAbortRef = useRef(null);
  const bgTickerRef = useRef(null);

  const runMarketingAnalysis = async ({ productoNombre, productoUrl, onComplete }) => {
    if (bgAnalysis && bgAnalysis.status === 'running') {
      addToast({ type: 'error', message: 'Ya hay un análisis en curso. Cancelá ese primero.' });
      return;
    }
    const controller = new AbortController();
    bgAbortRef.current = controller;

    const startedAt = Date.now();
    setBgAnalysis({
      productoNombre, productoUrl, startedAt,
      currentStep: null, stepStatus: {}, liveOutputs: {},
      elapsedSec: 0, tickerIdx: 0,
      infoMsg: '', errorMsg: '',
      ogImage: null, descripcion: '',
      status: 'running',
    });

    // Ticker de tiempo + rotación de bullets.
    if (bgTickerRef.current) clearInterval(bgTickerRef.current);
    bgTickerRef.current = setInterval(() => {
      setBgAnalysis(prev => {
        if (!prev || prev.status !== 'running') return prev;
        const elapsed = Math.round((Date.now() - prev.startedAt) / 1000);
        return { ...prev, elapsedSec: elapsed, tickerIdx: (prev.tickerIdx + 1) % 10 };
      });
    }, 1000);

    try {
      const resp = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoUrl, productoNombre }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const outputs = { research: '', avatar: '', offerBrief: '', beliefs: '', resumenEjecutivo: '' };
      let ogImage = null;
      let descripcion = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.substring(5).trim();
          if (!payload) continue;
          let ev;
          try { ev = JSON.parse(payload); } catch { continue; }

          if (ev.type === 'info') {
            setBgAnalysis(prev => prev ? { ...prev, infoMsg: ev.message || '' } : prev);
          } else if (ev.type === 'og-image') {
            ogImage = ev.url || null;
            setBgAnalysis(prev => prev ? { ...prev, ogImage: ev.url || null } : prev);
          } else if (ev.type === 'step-start') {
            setBgAnalysis(prev => prev ? {
              ...prev, currentStep: ev.key,
              stepStatus: { ...prev.stepStatus, [ev.key]: 'running' },
            } : prev);
          } else if (ev.type === 'step-done') {
            outputs[ev.key] = ev.content || '';
            setBgAnalysis(prev => prev ? {
              ...prev,
              stepStatus: { ...prev.stepStatus, [ev.key]: 'done' },
              liveOutputs: { ...prev.liveOutputs, [ev.key]: ev.content || '' },
            } : prev);
          } else if (ev.type === 'complete') {
            descripcion = ev.descripcion || '';
            const finalOutputs = ev.outputs || outputs;
            const finalOgImage = ev.ogImage || ogImage;
            setBgAnalysis(prev => prev ? { ...prev, status: 'done', descripcion } : prev);
            // Callback: Marketing.jsx lo usa para agregar el producto a la lista.
            if (onComplete) onComplete({
              productoNombre, productoUrl,
              docs: finalOutputs,
              descripcion,
              ogImage: finalOgImage,
              resumenEjecutivo: finalOutputs.resumenEjecutivo || '',
            });
            addToast({ type: 'success', message: `"${productoNombre}" — documentación lista` });
          } else if (ev.type === 'error') {
            setBgAnalysis(prev => prev ? { ...prev, status: 'error', errorMsg: ev.error || 'Error desconocido' } : prev);
            addToast({ type: 'error', message: ev.error || 'Error en el análisis' });
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setBgAnalysis(prev => prev ? { ...prev, status: 'cancelled' } : prev);
        addToast({ type: 'info', message: 'Análisis cancelado' });
      } else {
        setBgAnalysis(prev => prev ? { ...prev, status: 'error', errorMsg: err.message } : prev);
        addToast({ type: 'error', message: err.message });
      }
    } finally {
      if (bgTickerRef.current) { clearInterval(bgTickerRef.current); bgTickerRef.current = null; }
      bgAbortRef.current = null;
    }
  };

  const cancelMarketingAnalysis = () => {
    if (bgAbortRef.current) bgAbortRef.current.abort();
  };

  const dismissBgAnalysis = () => {
    setBgAnalysis(null);
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
          let resp;
          try {
            resp = await fetch('/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'verify', token: linkToken }),
            });
          } catch {
            clearTokenFromUrl();
            return; // sin red, dejar que se muestre el login
          }
          clearTokenFromUrl();
          if (!resp.ok) {
            addToast?.({ type: 'error', message: 'El link de acceso es inválido o expiró', duration: 6000 });
            return;
          }
          const data = await resp.json().catch(() => null);
          if (data?.ok && data.session && data.user) {
            localStorage.setItem('viora-session', data.session);
            if (!cancelled) {
              const u = data.user;
              setCurrentUser({
                role: u.role,
                name: u.name,
                email: u.email || null,
                username: u.username || null,
                id: u.role === 'admin' ? 'admin' : (u.mentorId || u.email || u.username || u.name),
              });
              setCurrentSection('inicio');
              addToast?.({ type: 'success', message: `Bienvenido, ${u.name}` });
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
            // Sesión inválida / expirada / usuario borrado → limpiar y
            // dejar que el LoginScreen se muestre.
            localStorage.removeItem('viora-session');
            if (!cancelled) setCurrentUser(null);
            return;
          }
          const data = await resp.json().catch(() => null);
          if (!data?.ok || !data.user) {
            localStorage.removeItem('viora-session');
            if (!cancelled) setCurrentUser(null);
            return;
          }
          if (!cancelled) {
            const u = data.user;
            // Matcheamos id del partner por nombre si aplica
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
      estado: 'consulta-recibida',
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

  const handleAddMentor = (mentorData) => {
    const maxId = state.mentors.reduce((m, x) => Math.max(m, x.id), 0);
    const newMentor = {
      id: maxId + 1,
      porcentajeComision: 50,
      pagosRecibidos: [],
      fechaInicio: new Date().toISOString().split('T')[0],
      ...mentorData,
    };
    dispatch({ type: 'ADD_MENTOR', payload: newMentor });
    addToast({ type: 'success', message: `Partner "${newMentor.nombre}" creado` });
    return newMentor;
  };

  const handleRemoveMentor = (id) => {
    const mentor = state.mentors.find(m => m.id === id);
    if (!mentor) return;
    dispatch({ type: 'REMOVE_MENTOR', payload: { id } });
    addToast({ type: 'warning', message: `Partner "${mentor.nombre}" eliminado` });
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

  const calculateMargin = (costo, precio) => {
    if (!precio || precio <= 0) return 0;
    return Math.round(((precio - costo) / precio) * 100);
  };

  const getMonthlySalesData = () => {
    const months = {};
    state.sales.forEach(sale => {
      const month = (sale.fecha || '').substring(0, 7);
      if (!month) return;
      months[month] = (months[month] || 0) + (sale.montoTotal || 0);
    });
    return Object.entries(months)
      .sort()
      .map(([month, total]) => ({ month: new Date(month + '-01').toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }), total }));
  };

  const getCurrentMonthSales = () => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    return state.sales
      .filter(s => (s.fecha || '').startsWith(currentMonth))
      .reduce((sum, s) => sum + (s.montoTotal || 0), 0);
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

  // Mientras hidratamos desde IndexedDB no renderizamos la app — sino
  // mostraríamos un flash de INITIAL_STATE (con datos demo) antes del
  // estado real. Es ~50ms en máquinas modernas.
  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Cargando datos…
        </div>
      </div>
    );
  }

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
      {/* Sidebar — desktop: lateral fijo. Mobile: overlay deslizante.
          El gradient cambia según la plataforma activa. */}
      <aside className={`
        ${effectiveSidebarOpen ? 'w-64' : 'w-20'}
        relative bg-gradient-to-b ${getPlatform(currentPlatform).sidebarGradient} text-white shadow-2xl
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

        {/* Platform switcher + logo */}
        <div className="relative p-3 pt-4">
          <PlatformSwitcher
            currentPlatform={currentPlatform}
            onSwitch={(id) => {
              setCurrentPlatform(id);
              const p = getPlatform(id);
              setCurrentSection(p.defaultSection);
              setMobileMenuOpen(false);
            }}
            sidebarOpen={sidebarOpen}
          />
        </div>

        {/* Divisor sutil */}
        <div aria-hidden="true" className="mx-4 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <nav className="relative flex-1 p-3 space-y-1 overflow-y-auto">
          {currentUser.role === 'admin' && currentPlatform === 'viora' && (
            <>
              <NavItem icon={Home} label="Inicio" section="inicio" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Package} label="Productos" section="productos" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Users} label="Clientes" section="clientes" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={CreditCard} label="Comisiones" section="comisiones" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Calculator} label="Calculadora" section="calculadora" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Package} label="Datos" section="datos" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          )}
          {currentUser.role === 'admin' && currentPlatform === 'senydrop' && (
            <>
              <NavItem icon={FileText} label="Productos" section="seny-productos" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          )}
          {currentUser.role === 'admin' && currentPlatform === 'metaads' && (
            <>
              <NavItem icon={Home} label="Inicio" section="meta-inicio" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Zap} label="Campañas" section="meta-campanas" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Activity} label="Métricas" section="meta-metricas" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Settings} label="Conexión Meta" section="meta-config" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          )}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && (
            <>
              {/* Sidebar simplificado: Marketing (= productos) + Meta Ads
                  (aparte por pedido) + Gastos. Bandeja, Inspiración,
                  Competencia y Creativos viven como tabs adentro de cada
                  producto en Arranque. */}
              <NavItem icon={Play} label="Marketing" section="mk-arranque" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={BarChart3} label="Meta Ads" section="mk-meta-ads" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Instagram} label="Automatización IG" section="mk-auto-ig" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={DollarSign} label="Gastos del stack" section="mk-gastos" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          )}
          {currentUser.role !== 'admin' && (
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
        {/* Pill flotante del análisis en bg: visible desde cualquier sección
            cuando hay un análisis en curso. Click "Ver" → te lleva a Marketing. */}
        {bgAnalysis && (
          <BgAnalysisPill
            analysis={bgAnalysis}
            onView={() => { setCurrentPlatform('marketing'); setCurrentSection('mk-docs'); }}
            onCancel={cancelMarketingAnalysis}
            onDismiss={dismissBgAnalysis}
          />
        )}
        <StickyHeader
          title={getSectionTitle(currentUser, currentSection)}
          subtitle={`Bienvenido, ${currentUser.name}`}
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
          onOpenCommand={() => setCmdOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <div key={currentSection} className="p-4 md:p-8 animate-fade-in-up">
          {/* Admin Views */}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'inicio' && <InicioSection state={state} dispatch={dispatch} onAddSale={handleAddSale} onQuickAddClient={createClient} onQuickAddProduct={createProduct} addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'productos' && <ProductosSection state={state} onAddProduct={handleAddProduct} showModal={showNewProductModal} setShowModal={setShowNewProductModal} calculateMargin={calculateMargin} />}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'clientes' && <ClientesSection state={state} onAddClient={handleAddClient} onUpdateClient={handleUpdateClient} showModal={showNewClientModal} setShowModal={setShowNewClientModal} />}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'comisiones' && <ComisionesSection state={state} dispatch={dispatch} onUpdateMentor={handleUpdateMentor} onAddMentor={handleAddMentor} onRemoveMentor={handleRemoveMentor} getMentorStats={getMentorStats} filterMentor={filterMentor} setFilterMentor={setFilterMentor} />}
          {/* La sección "Equipo" (mentores) se unificó adentro de Comisiones */}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'mentores' && <ComisionesSection state={state} dispatch={dispatch} onUpdateMentor={handleUpdateMentor} onAddMentor={handleAddMentor} onRemoveMentor={handleRemoveMentor} getMentorStats={getMentorStats} filterMentor={filterMentor} setFilterMentor={setFilterMentor} />}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'calculadora' && <CalculadoraSection state={state} addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'viora' && currentSection === 'datos' && <DatosSection state={state} dispatch={dispatch} addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'senydrop' && currentSection === 'seny-productos' && <BocetosSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'metaads' && <MetaAdsPlaceholder section={currentSection} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && (
            <MetaConnectBanner returnTo={`/acceso?section=${currentSection}`} />
          )}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-arranque' && <ArranqueSection addToast={addToast} onGoToSection={setCurrentSection} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-bandeja' && <BandejaSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-competencia' && <CompetenciaSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-meta-ads' && <MetaAdsSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-auto-ig' && <AutoIGSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-inspiracion' && <InspiracionSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-gastos' && <GastosStackSection addToast={addToast} />}
          {currentUser.role === 'admin' && currentPlatform === 'marketing' && currentSection === 'mk-docs' && (
            <MarketingSection
              addToast={addToast}
              bgAnalysis={bgAnalysis}
              onStart={runMarketingAnalysis}
              onCancel={cancelMarketingAnalysis}
              onDismiss={dismissBgAnalysis}
            />
          )}

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
    </div>
  );
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
  const [loginMode, setLoginMode] = useState('login');
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem('viora-last-user') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [rememberUser, setRememberUser] = useState(true);
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
      localStorage.setItem('viora-session', data.session);
      if (rememberUser) {
        try { localStorage.setItem('viora-last-user', username.trim()); } catch {}
      } else {
        try { localStorage.removeItem('viora-last-user'); } catch {}
      }
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
              autoFocus={!username}
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
              autoFocus={!!username}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={rememberUser} onChange={(e) => setRememberUser(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-pink-600 focus:ring-pink-500" />
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Recordar usuario</span>
            </label>
            {loginError && <p className="text-xs text-red-600 dark:text-red-400">{loginError}</p>}
            <button
              onClick={doLogin}
              disabled={loggingIn}
              className="w-full py-2.5 mt-2 bg-gradient-to-r from-pink-900 to-rose-700 text-white rounded-lg hover:shadow-lg transition font-semibold disabled:opacity-60"
            >
              {loggingIn ? 'Ingresando…' : 'Ingresar'}
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
function InicioSection({ state, dispatch, onAddSale, onQuickAddClient, onQuickAddProduct, addToast }) {
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
  // Modal para consulta rápida
  const [showQuickConsultaModal, setShowQuickConsultaModal] = useState(false);
  // Modal para editar orden
  const [editingOrder, setEditingOrder] = useState(null);

  // Órdenes filtradas según el estado actual de los filtros
  const filteredOrders = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return state.sales.filter(order => {
      if (filters.dateFrom && (order.fecha || '') < filters.dateFrom) return false;
      if (filters.dateTo && (order.fecha || '') > filters.dateTo) return false;
      if (filters.states.size > 0 && !filters.states.has(order.estado || 'consulta-recibida')) return false;
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
          ORDER_STATE_LABELS[order.estado || 'consulta-recibida'],
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
    const mentor = order.mentorId ? state.mentors.find(m => m.id === order.mentorId) : null;
    return acc + getLabRealProfit(order, product, mentor);
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowQuickConsultaModal(true)}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-pink-300 dark:border-pink-700 text-pink-700 dark:text-pink-300 px-4 py-2.5 rounded-xl shadow hover:shadow-lg hover:scale-[1.02] active:scale-100 transition font-semibold text-sm"
            title="Registrar una consulta rápida con datos mínimos"
          >
            <Plus size={18} /> Consulta rápida
          </button>
          <button
            onClick={() => setShowNewOrderModal(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-pink-700 to-rose-600 text-white px-5 py-2.5 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-100 transition font-semibold text-sm"
            title="Registrar una nueva orden"
          >
            <Plus size={18} /> Nueva orden
          </button>
        </div>
      </div>

      {/* Pipeline visual bar: pills con conteo por estado */}
      <div className="flex flex-wrap gap-2">
        {ORDER_STATES.map(s => {
          const count = state.sales.filter(o => (o.estado || 'consulta-recibida') === s).length;
          const isActive = filters.states.size === 1 && filters.states.has(s);
          return (
            <button
              key={s}
              onClick={() => {
                setFilters(f => {
                  const next = new Set();
                  if (!(f.states.size === 1 && f.states.has(s))) next.add(s);
                  return { ...f, states: next };
                });
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${isActive ? ORDER_STATE_STYLES[s] + ' ring-2 ring-offset-1 ring-pink-500 dark:ring-offset-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:opacity-80'}`}
            >
              {ORDER_STATE_LABELS[s]} <span className="ml-1 opacity-70">{count}</span>
            </button>
          );
        })}
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

      {showQuickConsultaModal && (
        <QuickConsultaModal
          state={state}
          onSubmit={(data) => {
            onAddSale?.(data);
            setShowQuickConsultaModal(false);
          }}
          onQuickAddClient={onQuickAddClient}
          onClose={() => setShowQuickConsultaModal(false)}
        />
      )}

      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          state={state}
          onSave={(patch) => {
            dispatch({ type: 'UPDATE_ORDER', payload: { id: editingOrder.id, patch } });
            setEditingOrder(null);
            addToast?.({ type: 'success', message: `Orden #${editingOrder.id} actualizada` });
          }}
          onClose={() => setEditingOrder(null)}
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
          tooltip="Click para filtrar: solo órdenes con comisión del partner pendiente"
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

      <OrdersList orders={filteredOrders} state={state} dispatch={dispatch} onEditOrder={setEditingOrder} />
    </div>
  );
}

// Barra de filtros del dashboard: búsqueda, rango de fechas con presets,
// estados múltiples del pipeline y toggle "sólo con incidencia".
function FilterBar({ filters, onChange, totalShown, totalAll }) {
  const [expanded, setExpanded] = useState(false);
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
    const d = new Date(today);
    if (preset === '7') { d.setDate(d.getDate() - 7); update({ dateFrom: fmt(d), dateTo: todayStr }); return; }
    if (preset === '30') { d.setDate(d.getDate() - 30); update({ dateFrom: fmt(d), dateTo: todayStr }); return; }
    if (preset === 'thisMonth') { const s = new Date(today.getFullYear(), today.getMonth(), 1); update({ dateFrom: fmt(s), dateTo: todayStr }); return; }
  };

  const clearAll = () => onChange({
    dateFrom: '', dateTo: '', states: new Set(), onlyIncidencia: false, search: '', focus: null,
  });

  const anyActive = filters.dateFrom || filters.dateTo || filters.states.size > 0 || filters.onlyIncidencia || filters.search || filters.focus;
  const filterCount = (filters.dateFrom ? 1 : 0) + (filters.states.size) + (filters.onlyIncidencia ? 1 : 0) + (filters.focus ? 1 : 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 space-y-2">
      {/* Siempre visible: búsqueda + toggle filtros + conteo */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Buscar..."
            className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
          {filters.search && (
            <button onClick={() => update({ search: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <X size={12} />
            </button>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
            expanded || anyActive
              ? 'border-pink-500 text-pink-700 dark:text-pink-300 bg-pink-50 dark:bg-pink-900/20'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <Filter size={12} />
          Filtros{filterCount > 0 ? ` (${filterCount})` : ''}
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {anyActive && (
          <button onClick={clearAll} className="text-[11px] text-pink-700 dark:text-pink-300 hover:underline font-semibold whitespace-nowrap">
            Limpiar
          </button>
        )}
        <span className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {totalShown}/{totalAll}
        </span>
      </div>

      {/* Expandible: rango + estado */}
      {expanded && (
        <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700 animate-fade-in">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase">Rango:</span>
            {[
              { k: 'today', label: 'Hoy' },
              { k: '7', label: '7 días' },
              { k: '30', label: '30 días' },
              { k: 'thisMonth', label: 'Este mes' },
              { k: 'all', label: 'Todo' },
            ].map(p => (
              <button key={p.k} onClick={() => applyPreset(p.k)}
                className="px-2 py-0.5 text-[11px] rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                {p.label}
              </button>
            ))}
            <input type="date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })}
              className="px-2 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg" />
            <span className="text-gray-400 text-[10px]">→</span>
            <input type="date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })}
              className="px-2 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase">Estado:</span>
            {ORDER_STATES.map(s => {
              const active = filters.states.has(s);
              return (
                <button key={s} onClick={() => toggleState(s)}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full transition ${
                    active ? `${ORDER_STATE_STYLES[s]} ring-1 ring-pink-500` : `${ORDER_STATE_STYLES[s]} opacity-40 hover:opacity-80`
                  }`}>
                  {ORDER_STATE_LABELS[s]}
                </button>
              );
            })}
            <label className="inline-flex items-center gap-1 ml-1 cursor-pointer">
              <input type="checkbox" checked={filters.onlyIncidencia} onChange={(e) => update({ onlyIncidencia: e.target.checked })}
                className="h-3 w-3 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500" />
              <span className="text-[10px] font-semibold text-red-700 dark:text-red-300">Incidencias</span>
            </label>
          </div>
        </div>
      )}
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
  { key: 'costoInf',  label: 'C. Informado', default: true, required: false },
  { key: 'comision',  label: 'Com. partner', default: true, required: false },
  { key: 'profit',    label: 'Profit',    default: true,  required: false },
  { key: 'estado',    label: 'Estado',    default: true,  required: false },
  { key: 'cobro',     label: 'Cobro',     default: true,  required: false },
  { key: 'incidencia', label: 'Incidencia', default: true, required: false },
];

const ORDERS_DEFAULT_VISIBLE = ORDERS_COLUMNS.filter(c => c.default).map(c => c.key);

function OrdersList({ state, dispatch, orders, onEditOrder }) {
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
      if (stored) {
        const savedSet = new Set(JSON.parse(stored));
        // Merge: si hay columnas nuevas con default=true que no estaban
        // en el set guardado, agregarlas automáticamente.
        ORDERS_DEFAULT_VISIBLE.forEach(k => savedSet.add(k));
        return savedSet;
      }
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
              {isColVisible('mentor') && <th className="px-4 py-3 font-semibold" title="Persona del partner que refirió al cliente (opcional)">Equipo</th>}
              {isColVisible('cantidad') && <th className="px-4 py-3 font-semibold text-right" title="Unidades a producir. Doble click en la celda para editar.">Cant.</th>}
              {isColVisible('costo') && <th className="px-4 py-3 font-semibold text-right" title="Costo total: contenido + envase + etiqueta. Click en la celda para ver el desglose o cambiar a modo 'sin discriminar'.">Costo</th>}
              {isColVisible('precio') && <th className="px-4 py-3 font-semibold text-right" title="Precio cobrado al cliente. Doble click en la celda para editar.">Precio venta</th>}
              {isColVisible('costoInf') && <th className="px-4 py-3 font-semibold text-right" title="Costo informado al partner para esta orden. Su comisión se calcula sobre (venta − este costo).">C. Informado</th>}
              {isColVisible('comision') && <th className="px-4 py-3 font-semibold text-right" title="Comisión que se le paga al partner (% de ganancia sobre costo informado)">Com. partner</th>}
              {isColVisible('profit') && <th className="px-4 py-3 font-semibold text-right" title="Profit real del laboratorio = precio venta − costo − comisión del partner.">Profit</th>}
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
              const mentorId = order.mentorId;
              const hasMentor = !!mentorId;
              const mentor = hasMentor ? state.mentors.find(m => m.id === mentorId) : null;
              const commissionTotal = hasMentor ? getMentorCommission(order, product, mentor) : 0;
              const commissionUnit = hasMentor && (order.cantidad || 0) > 0 ? (commissionTotal / (order.cantidad || 1)) : 0;
              // Profit real del laboratorio: precio venta − costo − comisión del partner.
              const profitTotal = getLabRealProfit(order, product, mentor);
              const profitUnit = (order.cantidad || 0) > 0 ? (profitTotal / order.cantidad) : 0;
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
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => toggleExpand(order.id)}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                        title={isOpen ? 'Ocultar pagos' : 'Ver pagos de esta orden'}
                        aria-label="Expandir fila"
                      >
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      {onEditOrder && (
                        <button
                          onClick={() => onEditOrder(order)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-pink-600 dark:text-gray-500 dark:hover:text-pink-400 transition"
                          title="Editar orden"
                          aria-label="Editar orden"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm(`¿Borrar la orden #${order.id} de ${getClientName(order.clienteId)}? Esta acción no se puede deshacer.`)) {
                            dispatch({ type: 'DELETE_ORDER', payload: { id: order.id } });
                          }
                        }}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 transition"
                        title="Eliminar orden"
                        aria-label="Eliminar orden"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
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
                  {isColVisible('costoInf') && (
                    <td className="px-4 py-3 text-right text-amber-700 dark:text-amber-300 tabular-nums">
                      {hasMentor ? fmtMoney(getInformedCostUnit(order, product) * (order.cantidad || 0)) : <span className="text-gray-400 dark:text-gray-500">—</span>}
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
                        value={order.estado || 'consulta-recibida'}
                        onChange={(e) => handleStateChange(order.id, e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-500 ${ORDER_STATE_STYLES[order.estado || 'consulta-recibida']}`}
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
                        dispatch={dispatch}
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
        const estado = order.estado || 'consulta-recibida';
        const isTotal = viewMode === 'total';
        const cantidad = order.cantidad || 0;
        const precioVentaUnit = product?.precioVenta || 0;
        const precioVentaTotal = (order.montoTotal != null ? order.montoTotal : precioVentaUnit * cantidad);
        const commissionTotal = mentor ? getMentorCommission(order, product, mentor) : 0;
        const profitTotal = getLabRealProfit(order, product, mentor);
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
    const s = o.estado || 'consulta-recibida';
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
                          value={order.estado || 'consulta-recibida'}
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
  const [formData, setFormData] = useState({ clienteId: '', productoId: '', cantidad: 1, mentorId: '', costoInformado: '', montoTotal: '' });
  const [showClientQuickModal, setShowClientQuickModal] = useState(false);
  const [showProductQuickModal, setShowProductQuickModal] = useState(false);

  const productoSel = state.products.find(p => p.id === parseInt(formData.productoId));
  const mentorSel = state.mentors.find(m => m.id === parseInt(formData.mentorId));
  const cantidadNum = parseInt(formData.cantidad) || 0;

  // Auto-calcular monto total sugerido
  const montoSugerido = productoSel ? productoSel.precioVenta * cantidadNum : 0;
  const montoTotal = parseFloat(formData.montoTotal) || montoSugerido;

  // Auto-sugerir costo informado del producto (POR UNIDAD — el form acepta
  // valor por unidad y se guarda tal cual, sin dividir por cantidad).
  const costoInfProducto = productoSel?.costoInformado ?? productoSel?.costoSinDesglosar ?? getProductUnitCost(productoSel);
  const costoInfSugerido = costoInfProducto || 0;

  // Cálculos de preview para el partner (comisión sobre TOTALES).
  const costoInfParsed = parseFloat(formData.costoInformado) || costoInfSugerido;
  const costoInfTotal = costoInfParsed * cantidadNum;
  const gananciaInformada = Math.max(0, montoTotal - costoInfTotal);
  const pctPartner = mentorSel?.porcentajeComision ?? 50;
  const comisionPartner = Math.round(gananciaInformada * (pctPartner / 100));

  // Auto-fill costo informado cuando cambia producto/cantidad/partner
  const [costoTouched, setCostoTouched] = useState(false);
  useEffect(() => {
    if (!costoTouched && formData.mentorId) {
      setFormData(prev => ({ ...prev, costoInformado: costoInfSugerido > 0 ? String(Math.round(costoInfSugerido)) : '' }));
    }
  }, [formData.mentorId, formData.productoId, formData.cantidad, costoInfSugerido, costoTouched]);

  // Auto-fill monto total cuando cambia producto/cantidad
  const [montoTouched, setMontoTouched] = useState(false);
  useEffect(() => {
    if (!montoTouched && montoSugerido > 0) {
      setFormData(prev => ({ ...prev, montoTotal: String(montoSugerido) }));
    }
  }, [formData.productoId, formData.cantidad, montoSugerido, montoTouched]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const producto = state.products.find(p => p.id === parseInt(formData.productoId));
    if (!producto) return;
    const cantidad = parseInt(formData.cantidad) || 1;
    const mentorId = formData.mentorId ? parseInt(formData.mentorId) : null;
    const newSale = {
      fecha: new Date().toISOString().split('T')[0],
      clienteId: parseInt(formData.clienteId),
      productoId: parseInt(formData.productoId),
      cantidad,
      montoTotal: parseFloat(formData.montoTotal) || (producto.precioVenta * cantidad),
      mentorId,
      // costoInformado se guarda POR UNIDAD (el form ya muestra/acepta por unidad).
      costoInformado: mentorId && formData.costoInformado ? parseFloat(formData.costoInformado) : null,
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
    setCostoTouched(false);
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
          openQuickClient={() => setShowClientQuickModal(true)}
          openQuickProduct={() => setShowProductQuickModal(true)}
          costoTouched={costoTouched}
          setCostoTouched={setCostoTouched}
          montoTouched={montoTouched}
          setMontoTouched={setMontoTouched}
          gananciaInformada={gananciaInformada}
          comisionPartner={comisionPartner}
          pctPartner={pctPartner}
          mentorSel={mentorSel}
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
function NewSaleFormContent({ state, formData, setFormData, handleSubmit, openQuickClient, openQuickProduct, costoTouched, setCostoTouched, montoTouched, setMontoTouched, gananciaInformada, comisionPartner, pctPartner, mentorSel }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <FormLabel required>Cliente</FormLabel>
        <div className="flex gap-2">
          <select value={formData.clienteId} onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500" required>
            <option value="">Seleccionar Cliente</option>
            {state.clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <button type="button" onClick={openQuickClient}
            className="inline-flex items-center gap-1 px-3 py-2 border border-pink-600 text-pink-700 dark:text-pink-300 dark:border-pink-500 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm font-semibold whitespace-nowrap">
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      <div>
        <FormLabel required>Producto</FormLabel>
        <div className="flex gap-2">
          <select value={formData.productoId} onChange={(e) => setFormData({ ...formData, productoId: e.target.value })}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500" required>
            <option value="">Seleccionar Producto</option>
            {state.products.map(p => <option key={p.id} value={p.id}>{p.nombre} — ${p.precioVenta?.toLocaleString()}/u</option>)}
          </select>
          <button type="button" onClick={openQuickProduct}
            className="inline-flex items-center gap-1 px-3 py-2 border border-pink-600 text-pink-700 dark:text-pink-300 dark:border-pink-500 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm font-semibold whitespace-nowrap">
            <Plus size={16} /> Nuevo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FormLabel required tip="Unidades a producir.">Cantidad</FormLabel>
          <input type="number" min="1" value={formData.cantidad}
            onChange={(e) => setFormData({ ...formData, cantidad: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500" required />
        </div>
        <div>
          <FormLabel required tip="Total que paga el cliente (precio × cantidad). Se auto-calcula pero podés editarlo.">Monto total</FormLabel>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input type="number" min="0" value={formData.montoTotal}
              onChange={(e) => { setFormData({ ...formData, montoTotal: e.target.value }); setMontoTouched(true); }}
              className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500" required />
          </div>
        </div>
      </div>

      <div>
        <FormLabel tip="Si la orden fue referida por un partner, seleccionalo. Se le calcula comisión automáticamente.">Partner asignado</FormLabel>
        <select value={formData.mentorId} onChange={(e) => { setFormData({ ...formData, mentorId: e.target.value }); setCostoTouched(false); }}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500">
          <option value="">Sin partner</option>
          {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre} ({m.porcentajeComision ?? 50}%)</option>)}
        </select>
      </div>

      {formData.mentorId && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 space-y-3">
          <div>
            <FormLabel tip="Costo POR UNIDAD que el partner cree que tiene el producto. Se multiplica por la cantidad para calcular la comisión: (precio venta total − costo informado × unidades) × %.">
              Costo informado al partner (por unidad)
              {cantidadNum > 0 && costoInfParsed > 0 && (
                <span className="ml-2 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                  = ${Math.round(costoInfParsed).toLocaleString()} × {cantidadNum} u = ${Math.round(costoInfTotal).toLocaleString()} total
                </span>
              )}
            </FormLabel>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input type="number" min="0" value={formData.costoInformado}
                onChange={(e) => { setFormData({ ...formData, costoInformado: e.target.value }); setCostoTouched(true); }}
                placeholder="Costo por unidad que ve el partner"
                className="w-full pl-6 pr-3 py-2 border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>
          {/* Preview del cálculo */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 rounded bg-white dark:bg-gray-800">
              <p className="text-gray-500 dark:text-gray-400">Ganancia informada</p>
              <p className="font-bold text-sky-600 dark:text-sky-400">{fmtMoney(gananciaInformada)}</p>
            </div>
            <div className="p-2 rounded bg-white dark:bg-gray-800">
              <p className="text-gray-500 dark:text-gray-400">Comisión ({pctPartner}%)</p>
              <p className="font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(comisionPartner)}</p>
            </div>
            <div className="p-2 rounded bg-white dark:bg-gray-800">
              <p className="text-gray-500 dark:text-gray-400">El partner ve</p>
              <p className="font-bold text-amber-600 dark:text-amber-400">{fmtMoney(comisionPartner)} para él</p>
            </div>
          </div>
        </div>
      )}

      <button type="submit" className="w-full bg-pink-900 text-white py-2.5 rounded-lg hover:bg-pink-800 transition font-semibold">
        Registrar Orden
      </button>
    </form>
  );
}

// Modal de consulta rápida: datos mínimos para registrar una consulta recibida.
function QuickConsultaModal({ state, onSubmit, onQuickAddClient, onClose }) {
  const [clientName, setClientName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [productoId, setProductoId] = useState('');
  const [nota, setNota] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const filteredClients = useMemo(() => {
    const q = clientName.trim().toLowerCase();
    if (!q) return state.clients.slice(0, 8);
    return state.clients.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 8);
  }, [clientName, state.clients]);

  const handleSelectClient = (client) => {
    setSelectedClientId(String(client.id));
    setClientName(client.nombre);
    setShowSuggestions(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    let clienteId = selectedClientId ? parseInt(selectedClientId) : null;
    // If typed a name that doesn't match any existing client, create one
    if (!clienteId && clientName.trim()) {
      const newClient = onQuickAddClient({ nombre: clientName.trim() });
      clienteId = newClient.id;
    }
    if (!clienteId) return;
    const data = {
      fecha: new Date().toISOString().split('T')[0],
      clienteId,
      productoId: productoId ? parseInt(productoId) : null,
      cantidad: 0,
      montoTotal: 0,
      mentorId: state.clients.find(c => c.id === clienteId)?.mentorId || null,
      estado: 'consulta-recibida',
      notas: nota.trim() ? [{ texto: nota.trim(), fecha: new Date().toISOString().split('T')[0] }] : [],
    };
    onSubmit(data);
  };

  return (
    <Modal title="Consulta rápida" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <FormLabel required>Cliente</FormLabel>
          <input
            ref={inputRef}
            type="text"
            value={clientName}
            onChange={(e) => { setClientName(e.target.value); setSelectedClientId(''); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Nombre del cliente (existente o nuevo)"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
            autoFocus
          />
          {showSuggestions && filteredClients.length > 0 && (
            <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredClients.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectClient(c)}
                  className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                >
                  {c.nombre}
                </button>
              ))}
              {clientName.trim() && !state.clients.some(c => c.nombre.toLowerCase() === clientName.trim().toLowerCase()) && (
                <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700">
                  Se creará el cliente "{clientName.trim()}" al guardar
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <FormLabel>Producto</FormLabel>
          <select
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          >
            <option value="">Sin definir todavía</option>
            {state.products.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        <div>
          <FormLabel>Nota</FormLabel>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Algún detalle de la consulta (opcional)"
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 resize-y"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
        >
          Registrar consulta
        </button>
      </form>
    </Modal>
  );
}

// Modal para editar una orden existente.
function EditOrderModal({ order, state, onSave, onClose }) {
  // costoInformado se guarda y edita POR UNIDAD.
  const costoInfGuardado = order.costoInformado != null
    ? String(Math.round(order.costoInformado))
    : '';
  const [formData, setFormData] = useState({
    fecha: order.fecha || '',
    clienteId: String(order.clienteId || ''),
    productoId: String(order.productoId || ''),
    cantidad: order.cantidad || 0,
    montoTotal: order.montoTotal || 0,
    mentorId: order.mentorId ? String(order.mentorId) : '',
    estado: order.estado || 'consulta-recibida',
    costoInformado: costoInfGuardado,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const cant = parseInt(formData.cantidad) || 1;
    const patch = {
      fecha: formData.fecha,
      clienteId: parseInt(formData.clienteId) || order.clienteId,
      productoId: parseInt(formData.productoId) || order.productoId,
      cantidad: cant,
      montoTotal: parseFloat(formData.montoTotal) || 0,
      mentorId: formData.mentorId ? parseInt(formData.mentorId) : null,
      estado: formData.estado,
      // costoInformado ya es POR UNIDAD — el form lo muestra y acepta así.
      costoInformado: formData.mentorId && formData.costoInformado !== ''
        ? parseFloat(formData.costoInformado)
        : null,
    };
    onSave(patch);
  };

  return (
    <Modal title={`Editar orden #${order.id}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <FormLabel>Estado</FormLabel>
          <select
            value={formData.estado}
            onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
            className={`w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 font-semibold ${ORDER_STATE_STYLES[formData.estado]}`}
          >
            {ORDER_STATES.map(s => <option key={s} value={s}>{ORDER_STATE_LABELS[s]}</option>)}
          </select>
        </div>

        <div>
          <FormLabel>Fecha</FormLabel>
          <input
            type="date"
            value={formData.fecha}
            onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
        </div>

        <div>
          <FormLabel required>Cliente</FormLabel>
          <select
            value={formData.clienteId}
            onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
          >
            <option value="">Seleccionar Cliente</option>
            {state.clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        <div>
          <FormLabel required>Producto</FormLabel>
          <select
            value={formData.productoId}
            onChange={(e) => setFormData({ ...formData, productoId: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
          >
            <option value="">Seleccionar Producto</option>
            {state.products.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FormLabel>Cantidad</FormLabel>
            <input
              type="number"
              min="0"
              value={formData.cantidad}
              onChange={(e) => setFormData({ ...formData, cantidad: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
          <div>
            <FormLabel>Monto total</FormLabel>
            <input
              type="number"
              min="0"
              value={formData.montoTotal}
              onChange={(e) => setFormData({ ...formData, montoTotal: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
        </div>

        <div>
          <FormLabel>Partner asignado</FormLabel>
          <select
            value={formData.mentorId}
            onChange={(e) => setFormData({ ...formData, mentorId: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          >
            <option value="">Sin mentor</option>
            {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </div>

        {formData.mentorId && (
          <div>
            <FormLabel tip="Costo POR UNIDAD que se le informa al partner. Se multiplica por la cantidad para calcular la comisión.">Costo informado al partner (por unidad)</FormLabel>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">$</span>
              <input
                type="number"
                min="0"
                value={formData.costoInformado}
                onChange={(e) => setFormData({ ...formData, costoInformado: e.target.value })}
                placeholder="Vacío = usa el costo informado del producto"
                className="w-full pl-6 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
        >
          Guardar cambios
        </button>
      </form>
    </Modal>
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
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">${(Number(sale.montoTotal) || 0).toLocaleString()}</td>
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
  // costoInformado es lo que le informamos al partner (puede ser distinto al real).
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

            {/* Costo informado al partner (opcional). Si está seteado, el mentor
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
                    Lo que el mentor ve como "costo del producto". La comisión del partner se calcula sobre este valor, no sobre el costo real.
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
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">${unitCost.toLocaleString()}</span>
                  {product.costoInformado != null && product.costoInformado !== '' && parseFloat(product.costoInformado) !== unitCost && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Informado: ${parseFloat(product.costoInformado).toLocaleString()}
                    </span>
                  )}
                </div>
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
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    <span>{fmtMoney(unitCost)}</span>
                    {product.costoInformado != null && product.costoInformado !== '' && parseFloat(product.costoInformado) !== unitCost && (
                      <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        Inf: ${parseFloat(product.costoInformado).toLocaleString()}
                      </span>
                    )}
                  </td>
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
                {product.costoInformado != null && product.costoInformado !== '' && parseFloat(product.costoInformado) !== unitCost && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">Inf: {fmtMoney(parseFloat(product.costoInformado))}</p>
                )}
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
  const emptyForm = { nombre: '', telefono: '', domicilio: '', mentorId: '', totalCompras: '', unidadesProducidas: '', fulfillment: false, fulfillmentCosto: '' };
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
      fulfillment: !!client.fulfillment,
      fulfillmentCosto: client.fulfillmentCosto != null ? String(client.fulfillmentCosto) : '',
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
      fulfillment: !!formData.fulfillment,
      fulfillmentCosto: formData.fulfillment && formData.fulfillmentCosto !== '' ? parseFloat(formData.fulfillmentCosto) || 0 : null,
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
            <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/50">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.fulfillment}
                  onChange={(e) => setFormData({ ...formData, fulfillment: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-sky-600 focus:ring-sky-500"
                />
                <div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Hacemos fulfillment</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Activalo si nosotros gestionamos el envío/despacho de este cliente.</p>
                </div>
              </label>
              {formData.fulfillment && (
                <div className="mt-3">
                  <FormLabel tip="Valor que cobramos al cliente por el fulfillment (por envío/orden). Se puede usar para calcular costos operativos.">
                    Costo de fulfillment
                  </FormLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      value={formData.fulfillmentCosto}
                      onChange={(e) => setFormData({ ...formData, fulfillmentCosto: e.target.value })}
                      placeholder="Valor por envío"
                      className="w-full pl-6 pr-3 py-2 border border-sky-300 dark:border-sky-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>
              )}
            </div>
            <div>
              <FormLabel tip="Partner que refirió al cliente. Cobrará comisión sobre sus ventas según el % configurado en Comisiones.">Partner asignado</FormLabel>
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

function ComisionesSection({ state, dispatch, onUpdateMentor, onAddMentor, onRemoveMentor, getMentorStats, filterMentor, setFilterMentor }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const [showNewMentorModal, setShowNewMentorModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [inviteLinks, setInviteLinks] = useState({}); // { [mentorId]: link }
  const [inviteLoading, setInviteLoading] = useState(null);

  const generateInviteLink = async (mentor) => {
    setInviteLoading(mentor.id);
    try {
      const resp = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_invite', mentorId: mentor.id, mentorName: mentor.nombre }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.ok && data.link) {
        setInviteLinks(prev => ({ ...prev, [mentor.id]: data.link }));
      }
    } catch {}
    setInviteLoading(null);
  };

  const copyLink = (link) => {
    navigator.clipboard?.writeText(link).catch(() => {});
  };

  const handlePercentChange = (mentorId, value) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(0, Math.min(100, parsed));
    onUpdateMentor?.({ id: mentorId, porcentajeComision: clamped });
  };

  const handleNameChange = (mentorId, value) => {
    onUpdateMentor?.({ id: mentorId, nombre: value });
  };

  const handleContactoChange = (mentorId, value) => {
    onUpdateMentor?.({ id: mentorId, contacto: value });
  };

  const updateMentorPagos = (mentorId, nuevosPagos) => {
    onUpdateMentor?.({ id: mentorId, pagosRecibidos: nuevosPagos });
  };

  const filteredMentors = state.mentors.filter(m => !filterMentor || m.id === parseInt(filterMentor));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Comisiones y Partners</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Gestioná los mentores, sus porcentajes y los pagos recibidos.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterMentor}
            onChange={(e) => setFilterMentor(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          >
            <option value="">Todos los partners</option>
            {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          {onAddMentor && (
            <button
              onClick={() => setShowNewMentorModal(true)}
              className="inline-flex items-center gap-2 bg-pink-900 text-white px-4 py-2 rounded-lg hover:bg-pink-800 transition font-semibold text-sm"
            >
              <Plus size={16} /> Nuevo partner
            </button>
          )}
        </div>
      </div>

      {showNewMentorModal && (
        <NewMentorModal
          onClose={() => setShowNewMentorModal(false)}
          onCreate={(data) => { onAddMentor?.(data); setShowNewMentorModal(false); }}
        />
      )}

      {confirmDelete != null && (
        <Modal
          title="¿Eliminar partner?"
          onClose={() => setConfirmDelete(null)}
        >
          <div className="space-y-4 text-sm text-gray-700 dark:text-gray-200">
            <p>Esta acción elimina al partner y desasigna sus órdenes y clientes. Los pagos registrados a este partner se pierden.</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Si solo querés pausarlo, cambiá su % de comisión a 0 en vez de eliminarlo.</p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={() => { onRemoveMentor?.(confirmDelete); setConfirmDelete(null); }}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold"
              >
                Eliminar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {state.mentors.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-12 text-center border border-dashed border-gray-300 dark:border-gray-700">
          <UserCheck size={36} className="mx-auto mb-3 text-gray-400" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1">No hay partners todavía</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Agregá el primer partner para empezar a referir órdenes y cobrar comisiones.</p>
          <button
            onClick={() => setShowNewMentorModal(true)}
            className="inline-flex items-center gap-2 bg-pink-900 text-white px-4 py-2 rounded-lg hover:bg-pink-800 transition font-semibold text-sm"
          >
            <Plus size={16} /> Nuevo partner
          </button>
        </div>
      )}

      {/* Editor de mentores: nombre, contacto, % comisión, y stats */}
      {state.mentors.length > 0 && (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Partners</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">El % de comisión se aplica sobre el <span className="font-semibold">profit informado</span> de cada orden.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {state.mentors.map(mentor => {
            const pct = mentor.porcentajeComision ?? 50;
            const stats = getMentorStats(mentor.id);
            const mentorClients = state.clients.filter(c => c.mentorId === mentor.id);
            return (
              <div
                key={mentor.id}
                className="group p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 hover:border-pink-300 dark:hover:border-pink-600 transition-colors space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold flex items-center justify-center shrink-0 shadow-sm">
                    {(mentor.nombre || 'M').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      type="text"
                      value={mentor.nombre || ''}
                      onChange={(e) => handleNameChange(mentor.id, e.target.value)}
                      className="w-full px-2 py-1 text-sm font-semibold border border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-transparent text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 focus:bg-white dark:focus:bg-gray-800"
                    />
                    <input
                      type="text"
                      value={mentor.contacto || ''}
                      onChange={(e) => handleContactoChange(mentor.id, e.target.value)}
                      placeholder="Contacto (WhatsApp, email…)"
                      className="w-full px-2 py-1 text-[11px] text-gray-600 dark:text-gray-400 border border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-transparent rounded focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 focus:bg-white dark:focus:bg-gray-800"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => generateInviteLink(mentor)}
                      disabled={inviteLoading === mentor.id}
                      className="px-2 py-1 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition"
                      title="Generar link de acceso para este partner"
                    >
                      {inviteLoading === mentor.id ? '...' : '🔗 Link de acceso'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(mentor.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition"
                      title="Eliminar partner"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {inviteLinks[mentor.id] && (
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800 space-y-1">
                    <p className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">Link de acceso generado — mandáselo por WhatsApp:</p>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        readOnly
                        value={inviteLinks[mentor.id]}
                        className="flex-1 px-2 py-1 text-[10px] font-mono bg-white dark:bg-gray-800 border border-emerald-300 dark:border-emerald-700 rounded text-gray-800 dark:text-gray-200"
                        onClick={(e) => e.target.select()}
                      />
                      <button
                        onClick={() => copyLink(inviteLinks[mentor.id])}
                        className="px-2 py-1 text-[10px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
                    <div>Ventas referidas: <span className="font-bold text-gray-900 dark:text-gray-100">{fmtMoney(stats.totalSales)}</span></div>
                    <div>Clientes: <span className="font-bold text-gray-900 dark:text-gray-100">{mentorClients.length}</span></div>
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
              </div>
            );
          })}
        </div>
      </div>
      )}

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
        { key: 'costoInformado', label: 'costoInformado' },
        { key: 'cuotasPlanificadas', label: 'cuotasPlanificadas' },
        { key: 'cobros', label: 'cobros', serialize: (s) => JSON.stringify(s.cobros || []) },
        { key: 'pagos', label: 'pagos', serialize: (s) => JSON.stringify(s.pagos || {}) },
        { key: 'costsOverride', label: 'costsOverride', serialize: (s) => JSON.stringify(s.costsOverride || {}) },
        { key: 'notas', label: 'notas', serialize: (s) => JSON.stringify(s.notas || []) },
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
        estado: row.estado || 'consulta-recibida',
        tieneIncidencia: toBool(row.tieneIncidencia),
        incidenciaDetalle: row.incidenciaDetalle || '',
        costoInformado: row.costoInformado ? toNumber(row.costoInformado) : null,
        cuotasPlanificadas: row.cuotasPlanificadas ? toNumber(row.cuotasPlanificadas) : 0,
        cobros: (() => { try { return JSON.parse(row.cobros || '[]'); } catch { return []; } })(),
        pagos: (() => { try { return JSON.parse(row.pagos || '{}'); } catch { return {}; } })(),
        costsOverride: (() => { try { return JSON.parse(row.costsOverride || '{}'); } catch { return {}; } })(),
        notas: (() => { try { return JSON.parse(row.notas || '[]'); } catch { return []; } })(),
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

function PartnersSection({ state, getMentorStats }) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Perfiles de Partners</h2>

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

  const misOrdenes = state.sales.filter(s => s.mentorId === currentUser.id);
  const misClientes = state.clients.filter(c => c.mentorId === currentUser.id);
  const mesActual = misOrdenes
    .filter(s => (s.fecha || '').startsWith(new Date().toISOString().substring(0, 7)))
    .reduce((sum, s) => {
      const p = state.products.find(pp => pp.id === s.productoId);
      return sum + getMentorCommission(s, p, mentor);
    }, 0);
  const totalProfitInformado = misOrdenes.reduce((sum, s) => {
    const p = state.products.find(pp => pp.id === s.productoId);
    return sum + getOrderInformedProfit(s, p);
  }, 0);

  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="text-center p-6 bg-gradient-to-r from-pink-50 to-rose-50 dark:from-pink-900/30 dark:to-rose-900/30 rounded-xl">
        <h2 className="text-2xl font-bold text-pink-900 dark:text-pink-200">Hola, {currentUser.name}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Tu resumen como partner — actualizado en vivo.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={DollarSign} label="Comisiones generadas" value={fmtMoney(balance.generado)} color="from-emerald-500 to-teal-500" delay={0} />
        <StatCard icon={CreditCard} label="Te queda cobrar" value={fmtMoney(Math.max(0, balance.saldo))} color="from-amber-500 to-orange-500" delay={80} />
        <StatCard icon={TrendingUp} label="Comisión este mes" value={fmtMoney(mesActual)} color="from-purple-500 to-pink-500" delay={160} />
        <StatCard icon={Users} label="Clientes referidos" value={misClientes.length} color="from-sky-500 to-blue-500" delay={240} />
      </div>

      {/* Resumen financiero */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Tu resumen financiero</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Profit total</p>
            <p className="text-lg font-bold text-sky-600 dark:text-sky-400 tabular-nums">{fmtMoney(totalProfitInformado)}</p>
            <p className="text-[10px] text-gray-400">Sobre {misOrdenes.length} órdenes</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Tu comisión ({mentor?.porcentajeComision ?? 50}%)</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(balance.generado)}</p>
            <p className="text-[10px] text-gray-400">Ya cobraste {fmtMoney(balance.cobrado)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Cobro pendiente</p>
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmtMoney(Math.max(0, balance.saldo))}</p>
            <div className="w-full h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-1">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, balance.porcentaje)}%` }} />
            </div>
          </div>
        </div>
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
              <th className="px-4 py-3 font-semibold text-right">Costo</th>
              <th className="px-4 py-3 font-semibold text-right">Precio venta</th>
              <th className="px-4 py-3 font-semibold text-right">Ganancia</th>
              <th className="px-4 py-3 font-semibold text-right">Tu comisión</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {visibles.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no tenés órdenes referidas.</td></tr>
            )}
            {visibles.map(order => {
              const product = state.products.find(p => p.id === order.productoId);
              const comision = getMentorCommission(order, product, mentor);
              const costoInfUnit = getInformedCostUnit(order, product);
              const profitInformado = getOrderInformedProfit(order, product);
              const estado = order.estado || 'consulta-recibida';
              return (
                <tr key={order.id} className={`${order.tieneIncidencia ? 'bg-red-50/40 dark:bg-red-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">{order.fecha}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{getClientName(order.clienteId)}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{getProductName(order.productoId)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{order.cantidad}</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{fmtMoney(costoInfUnit * (order.cantidad || 0))}</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(order.montoTotal || 0)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-sky-600 dark:text-sky-400 tabular-nums">{fmtMoney(profitInformado)}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(comision)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ORDER_STATE_STYLES[estado]}`}>
                      {ORDER_STATE_LABELS[estado]}
                    </span>
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
  // Balance en vivo calculado sobre TODAS las órdenes del partner y sus
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

      {/* Historial de pagos recibidos (read-only para el partner) */}
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
  const months = [...new Set(mentorSales.map(s => (s.fecha || '').substring(0, 7)).filter(Boolean))].sort().reverse();

  const getClientName = (clienteId) => state.clients.find(c => c.id === clienteId)?.nombre || '-';
  const getProductName = (productoId) => state.products.find(p => p.id === productoId)?.nombre || '-';

  const filteredSales = filterMonth ? mentorSales.filter(s => (s.fecha || '').startsWith(filterMonth)) : mentorSales;

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
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    Sin órdenes en este período.
                  </td>
                </tr>
              ) : filteredSales.map(sale => {
                const monto = Number(sale.montoTotal) || 0;
                return (
                  <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{sale.fecha || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getClientName(sale.clienteId)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{getProductName(sale.productoId)}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-gray-100">${monto.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm font-bold text-green-600">${(monto * 0.5).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm"><Badge text={sale.estadoComision} type={sale.estadoComision === 'pagada' ? 'success' : 'warning'} /></td>
                  </tr>
                );
              })}
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
                  const estado = order.estado || 'consulta-recibida';
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
  const buttonRef = useRef(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const isFlat = order?.costoSinDesglosar != null && order.costoSinDesglosar !== '';
  const cantidad = order?.cantidad || 1;

  const totalShown = isTotal ? costs.costoTotal : costs.costoUnit;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPos({
        top: rect.top - 8,
        left: Math.max(8, rect.right - 320),
      });
    }
    setOpen(v => !v);
  };

  const switchToDesglose = () => onClearFlat();
  const switchToFlat = () => {
    onSetFlat(costs.costoUnit || 0);
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
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
          className="fixed z-[100] w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3 animate-scale-in"
          style={{ top: popoverPos.top, left: popoverPos.left, transform: 'translateY(-100%)' }}
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

// Editor del modo "sin discriminar": un único input. El valor visible es
// total o unitario según `isTotal`; internamente se guarda SIEMPRE unitario
// (para que cambiar la cantidad no rompa los cálculos).
//
// Sutileza importante: el `draft` que ve el user representa lo TIPEADO en
// la unidad activa (total si isTotal, unitario si no). Cuando el user tipea
// "4400" en modo Total con cantidad 500, internamente guardamos 8.8 unitario
// — pero el field sigue mostrando "4400" mientras edita.
//
// Bug histórico: una versión anterior usaba el valueUnit como draft inicial
// y refrescaba el draft cada vez que cambiaba valueUnit, lo cual disparaba
// una cascada (cada keystroke se re-dividía por la cantidad). Ahora el draft
// es la fuente de verdad mientras el user edita y solo se sincroniza al
// blur o cuando el valueUnit cambia desde afuera estando inactivo.
function FlatCostEditor({ valueUnit, cantidad, isTotal, onChange }) {
  const cant = cantidad > 0 ? cantidad : 1;
  const display = isTotal ? (valueUnit || 0) * cant : (valueUnit || 0);
  const [draft, setDraft] = useState(() => formatNum(display));
  const [editing, setEditing] = useState(false);

  // Sincronizamos el draft con el valor externo solo si el user NO está
  // editando — sino le rompemos lo que viene tipeando.
  useEffect(() => {
    if (!editing) setDraft(formatNum(display));
  }, [display, editing]);

  const handleChange = (raw) => {
    setDraft(raw);
    const v = parseFloat(raw);
    if (Number.isNaN(v)) return;
    onChange(isTotal ? v / cant : v);
  };

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
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full pl-6 pr-2 py-2 text-sm font-semibold text-right border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-gray-900 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 tabular-nums"
        />
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 leading-tight">
        Usá esto cuando el proveedor te pasa el precio final con todo (envase + etiqueta + contenido) sin detalle.
        El cálculo del profit usa este número como costo total.
      </p>
      {!isTotal && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Total ×{cant}: <span className="font-semibold">${Math.round((valueUnit || 0) * cant).toLocaleString()}</span></p>
      )}
    </div>
  );
}

// Helper local: convertir un número a string sin notación científica para no
// asustar al user con "8.4e-6" en el input.
function formatNum(n) {
  if (n == null || Number.isNaN(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  // toFixed(6) y limpiamos los ceros finales sin perder precisión razonable.
  const s = Number(n).toFixed(6).replace(/\.?0+$/, '');
  return s || '0';
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
        <span className="text-amber-500">*</span>
      ) : (
        <span className="font-normal text-gray-400 dark:text-gray-500 lowercase">(opcional)</span>
      )}
      {tip && <InfoTip text={tip} />}
    </label>
  );
}

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[9px] font-bold cursor-help select-none hover:bg-amber-200 dark:hover:bg-amber-700 hover:text-gray-700 dark:hover:text-gray-100 transition"
        aria-label={text}
      >
        ?
      </button>
      {open && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[11px] leading-relaxed shadow-xl pointer-events-none animate-fade-in">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </span>
      )}
    </span>
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
function OrderExpansion({ order, cobrosSummary, payments, mentorNombre, onCobrosChange, onPaymentChange, onIncidenciaChange, dispatch }) {
  const [tab, setTab] = useState('cobros');
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  // Mini-stats para el botón de cada tab (preview de su contenido)
  const saldoPendiente = cobrosSummary.saldo > 0 ? cobrosSummary.saldo : 0;
  const aPagarTotal = ['contenido', 'envase', 'etiqueta', 'mentor']
    .filter(k => k !== 'mentor' || order.mentorId)
    .reduce((sum, k) => sum + (payments[k]?.estado === 'pendiente' ? (payments[k]?.monto || 0) : 0), 0);
  const notasCount = (order.notas || []).length;

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
          onClick={() => setTab('notas')}
          className={`flex-1 px-4 py-2.5 text-left transition border-l border-gray-200 dark:border-gray-700 ${tab === 'notas' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-b-2 border-indigo-500' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b-2 border-transparent'}`}
        >
          <p className={`text-xs font-bold uppercase tracking-wider ${tab === 'notas' ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>Notas</p>
          <p className={`text-sm font-semibold ${notasCount > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-500'}`}>
            {notasCount > 0 ? `${notasCount} nota${notasCount !== 1 ? 's' : ''}` : 'Sin notas'}
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
            {order.tieneIncidencia ? 'Activa' : 'Sin incidencias'}
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
        {tab === 'notas' && (
          <NotasPanel order={order} dispatch={dispatch} />
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
// Panel de notas por orden. Lista existentes (más reciente primero) y permite agregar.
function NotasPanel({ order, dispatch }) {
  const [draft, setDraft] = useState('');
  const notas = Array.isArray(order.notas) ? order.notas : [];
  const sorted = [...notas].reverse();

  const addNota = () => {
    const texto = draft.trim();
    if (!texto) return;
    dispatch({ type: 'ADD_ORDER_NOTE', payload: { orderId: order.id, nota: texto } });
    setDraft('');
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Notas de la orden</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">Anotaciones internas sobre esta orden.</p>
      </div>
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribir una nota..."
          rows={2}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNota(); } }}
        />
        <button
          type="button"
          onClick={addNota}
          disabled={!draft.trim()}
          className="self-end px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg font-semibold text-sm transition"
        >
          Agregar nota
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic text-center py-4">Sin notas todavía.</p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {sorted.map((nota, i) => (
            <div key={i} className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{nota.fecha}</p>
              <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{nota.texto}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const { total, cobrado, saldo, porcentaje } = summary;
  const saldada = saldo <= 0 && total > 0;

  // Form para registrar un nuevo cobro
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevoConcepto, setNuevoConcepto] = useState('Seña');
  const CONCEPTOS = ['Seña', 'Adelanto', 'Saldo', 'Pago único'];

  const addCobro = () => {
    const monto = parseFloat(nuevoMonto);
    if (!monto || monto <= 0) return;
    const nuevo = {
      concepto: nuevoConcepto,
      monto,
      fecha: new Date().toISOString().split('T')[0],
      nota: '',
    };
    onChange({ cobros: [...cobros, nuevo] });
    setNuevoMonto('');
  };

  const removeCobro = (index) => {
    onChange({ cobros: cobros.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Cobros del cliente</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">Cuánto abonó y cuánto falta.</p>
      </div>

      {/* Big number: Total cobrado de $Y */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-600 dark:text-gray-400">Total cobrado</p>
        <p className="text-2xl font-bold tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">{fmtMoney(cobrado)}</span>
          <span className="text-gray-400 dark:text-gray-500 font-normal"> de </span>
          <span className="text-gray-900 dark:text-gray-100">{fmtMoney(total)}</span>
        </p>
        {/* Progress bar */}
        <div className="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-2">
          <div
            className={`h-full transition-all rounded-full ${saldada ? 'bg-emerald-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-600'}`}
            style={{ width: `${Math.min(100, porcentaje)}%` }}
          />
        </div>
        <p className={`text-xs font-semibold mt-1 ${saldada ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {saldada ? 'Saldada' : `${porcentaje}% — faltan ${fmtMoney(saldo)}`}
        </p>
      </div>

      {/* Form to register a new cobro */}
      {!saldada && (
        <div className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Monto</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                value={nuevoMonto}
                onChange={(e) => setNuevoMonto(e.target.value)}
                placeholder={String(Math.round(saldo))}
                className="w-full pl-6 pr-2 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCobro(); } }}
              />
            </div>
          </div>
          <div className="min-w-[130px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Concepto</label>
            <select
              value={nuevoConcepto}
              onChange={(e) => setNuevoConcepto(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {CONCEPTOS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={addCobro}
            disabled={!nuevoMonto || parseFloat(nuevoMonto) <= 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg font-semibold text-sm transition"
          >
            Registrar cobro
          </button>
        </div>
      )}

      {/* List of cobros */}
      {cobros.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/60">
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Concepto</th>
                <th className="px-3 py-2 font-semibold text-right">Monto</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {cobros.map((cobro, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{cobro.fecha || '-'}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">{cobro.concepto || `Pago ${i + 1}`}</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(cobro.monto)}</td>
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

        {/* Comisión del partner — siempre se muestra si hay mentor asignado */}
        <PaymentCard
          label={rubroMentor.label}
          data={payments.mentor || {}}
          onChange={(patch) => onChange('mentor', patch)}
          disabled={!order.mentorId}
          disabledLabel="sin partner"
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

// Modal para crear un partner nuevo desde la sección de Comisiones.
function NewMentorModal({ onClose, onCreate }) {
  const [data, setData] = useState({ nombre: '', contacto: '', porcentajeComision: 50 });
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!data.nombre.trim()) return;
    onCreate({
      nombre: data.nombre.trim(),
      contacto: data.contacto.trim(),
      porcentajeComision: Math.max(0, Math.min(100, parseFloat(data.porcentajeComision) || 50)),
    });
  };
  return (
    <Modal title="Nuevo partner" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <FormLabel required>Nombre</FormLabel>
          <input
            type="text"
            autoFocus
            value={data.nombre}
            onChange={(e) => setData({ ...data, nombre: e.target.value })}
            placeholder="Nombre del partner"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
          />
        </div>
        <div>
          <FormLabel tip="Teléfono, email o lo que quieras para ubicarlo. Opcional.">Contacto</FormLabel>
          <input
            type="text"
            value={data.contacto}
            onChange={(e) => setData({ ...data, contacto: e.target.value })}
            placeholder="Ej. 11 1234-5678 o email"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
        </div>
        <div>
          <FormLabel required tip="Sobre el profit informado de cada orden. Podés editarlo después.">Comisión (%)</FormLabel>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={data.porcentajeComision}
            onChange={(e) => setData({ ...data, porcentajeComision: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            required
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
            Crear mentor
          </button>
        </div>
      </form>
    </Modal>
  );
}

function QuickClientModal({ mentors, onClose, onCreate }) {
  const [data, setData] = useState({ nombre: '', telefono: '', mentorId: '', domicilio: '' });

  // ESC para volver al form de orden sin perder lo tipeado.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
            title="Volver al formulario"
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
            <FormLabel tip="Si el cliente vino referido por un partner, asignalo para que se calcule su comisión sobre las ventas.">Partner asignado</FormLabel>
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
              Volver
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

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
            title="Volver al formulario"
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
              Volver
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
    comisiones: 'Comisiones y Partners',
    mentores: 'Comisiones y Partners', // fallback: sección vieja cae al mismo lugar
    calculadora: 'Calculadora de Proyección',
    datos: 'Datos (Export / Import)',
    'seny-productos': 'Productos · Senydrop',
    'meta-inicio': 'Meta Ads · Inicio',
    'meta-campanas': 'Meta Ads · Campañas',
    'meta-metricas': 'Meta Ads · Métricas',
    'meta-config': 'Meta Ads · Conexión',
    'mk-arranque': 'Marketing · Arranque',
    'mk-bandeja': 'Marketing · Bandeja de ideas',
    'mk-docs': 'Marketing · Documentación de producto',
    'mk-competencia': 'Marketing · Competencia',
    'mk-meta-ads': 'Marketing · Meta Ads',
    'mk-auto-ig': 'Marketing · Automatización IG',
    'mk-inspiracion': 'Marketing · Inspiración',
    'mk-gastos': 'Marketing · Gastos del stack',
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

  const ordenesActivas = sales.filter(o => (o.estado || 'consulta-recibida') !== 'despachado').length;
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

  // Profit real del lab: (precio venta − costo − comisión del partner) × cantidad.
  const profitTotal = sales.reduce((acc, o) => {
    const product = products.find(p => p.id === o.productoId);
    const mentor = o.mentorId ? mentors.find(m => m.id === o.mentorId) : null;
    return acc + getLabRealProfit(o, product, mentor);
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
              onClick={async () => {
                if (window.confirm('¿Borrar todos los datos cargados? Esta acción no se puede deshacer. Si tenés info importante, exportá primero desde la sección Datos.')) {
                  try { await clearVioraState(); } catch {}
                  // Limpiamos también la key legacy de localStorage por si quedó.
                  try { localStorage.removeItem(STATE_STORAGE_KEY); } catch {}
                  window.location.reload();
                }
              }}
              className="w-full mt-2 flex items-center gap-2 text-xs text-white/50 hover:text-red-300 transition"
              title="Borra todas las órdenes, clientes, productos y pagos cargados"
            >
              <Trash2 size={12} />
              Vaciar todos los datos
            </button>
            <button
              onClick={async () => {
                if (window.confirm('¿Cargar datos de ejemplo? Esto reemplaza lo que tengas cargado por los datos demo (5 productos, 8 clientes, 2 mentores, 15 órdenes).')) {
                  try { await saveVioraState(DEMO_STATE); } catch {}
                  window.location.reload();
                }
              }}
              className="w-full mt-2 flex items-center gap-2 text-xs text-white/40 hover:text-amber-300 transition"
              title="Reemplaza los datos cargados por los de demo (útil para probar la app)"
            >
              <Package size={12} />
              Cargar datos de demo
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

function StickyHeader({ title, subtitle, darkMode, toggleDarkMode, onOpenCommand, onOpenMobileMenu, bgTasks = [] }) {
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
      { id: 'go-productos', group: 'Ir a', label: 'Productos', icon: Package, shortcut: 'G P', run: () => onNavigate('productos') },
      { id: 'go-clientes', group: 'Ir a', label: 'Clientes', icon: Users, shortcut: 'G C', run: () => onNavigate('clientes') },
      { id: 'go-comisiones', group: 'Ir a', label: 'Comisiones y Partners', icon: CreditCard, shortcut: 'G $', run: () => onNavigate('comisiones') },
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
    return (
      <PipelineRunProvider>
        <AppShell onExit={() => navigate('/')} />
        <PipelineRunOverlay />
      </PipelineRunProvider>
    );
  }
  return <LandingPage onAccess={() => navigate('/acceso')} />;
}
