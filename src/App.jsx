import React, { useState, useReducer, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import {
  Menu, LogOut, Home, ShoppingCart, Package, Users, AlertCircle, CreditCard,
  UserCheck, TrendingUp, Plus, Filter, Eye, Edit2, Trash2, Calendar, DollarSign,
  Moon, Sun, ChevronDown, ChevronRight, Search, X, Command, Check, Bell
} from 'lucide-react';
import { VioraLogo, VioraMark } from './logo.jsx';
import LandingPage from './LandingPage.jsx';

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
    { id: 1, nombre: 'Sofia', contacto: '11 9876-5432', fechaInicio: '2023-12-01', clientesAsignados: 4, porcentajeComision: 50 },
    { id: 2, nombre: 'Mariano', contacto: '11 8765-4321', fechaInicio: '2023-12-15', clientesAsignados: 4, porcentajeComision: 50 },
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
  return {
    costoContenido: ov.contenido != null ? ov.contenido : (product?.costoContenido || 0),
    costoEnvase:    ov.envase    != null ? ov.envase    : (product?.costoEnvase    || 0),
    costoEtiqueta:  ov.etiqueta  != null ? ov.etiqueta  : (product?.costoEtiqueta  || 0),
    precioVenta:    precioVentaUnit,
  };
}

export function getProductUnitCost(product) {
  if (!product) return 0;
  return (product.costoContenido || 0) + (product.costoEnvase || 0) + (product.costoEtiqueta || 0);
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
  // Profit del laboratorio = (precioVenta - costos) * cantidad.
  // La comisión del mentor NO se descuenta acá porque es profit del mentor.
  // Usamos los valores efectivos (respetando overrides por orden).
  const eff = getOrderEffectiveUnit(order, product);
  const unitCost = eff.costoContenido + eff.costoEnvase + eff.costoEtiqueta;
  const cantidad = order?.cantidad || 0;
  return (eff.precioVenta - unitCost) * cantidad;
}

// Comisión del mentor = porcentaje (del mentor) × profit de la orden.
// Prioridad:
//  1. Si la orden tiene un presupuesto fijo asignado (order.mentorPresupuesto), ese gana.
//  2. Si se pasa mentor y product, usa mentor.porcentajeComision (default 50) × profit.
//  3. Si solo se pasa product, usa 50% del profit como fallback.
//  4. Sin product, último fallback: 50% del montoTotal.
export function getMentorCommission(order, product, mentor) {
  if (order?.mentorPresupuesto != null && order.mentorPresupuesto !== '') {
    return parseFloat(order.mentorPresupuesto) || 0;
  }
  if (product) {
    const profit = getOrderProfit(order, product);
    const pct = mentor?.porcentajeComision != null ? Number(mentor.porcentajeComision) : 50;
    return Math.max(0, profit * (pct / 100));
  }
  return (order?.montoTotal || 0) * 0.5;
}

// Resumen de cobros de una orden (plata que entra del cliente).
// Devuelve total, cobrado, saldo, cuotasPagadas y cuotasPlanificadas.
// order.cobros es un array de { monto, fecha, nota }.
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

// Rubros de pago por orden. "envase" se muestra como "Envase / Pote" en la UI
// porque son lo mismo según el flujo del laboratorio.
export const PAYMENT_RUBROS = ['contenido', 'envase', 'etiqueta', 'mentor'];

export const PAYMENT_RUBRO_LABELS = {
  contenido: 'Contenido',
  envase: 'Envase / Pote',
  etiqueta: 'Etiqueta',
  mentor: 'Comisión mentor',
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

function AppShell({ onExit }) {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentSection, setCurrentSection] = useState('inicio');
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  // Handlers
  const handleLogin = (role, name) => {
    setCurrentUser({ role, name, id: role === 'admin' ? 'admin' : (name === 'Sofia' ? 1 : 2) });
    setCurrentSection('inicio');
  };

  const handleLogout = () => {
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

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} darkMode={darkMode} toggleDarkMode={toggleDarkMode} />;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} relative bg-gradient-to-b from-[#4a0f22] via-pink-900 to-[#3f0c1e] text-white transition-all duration-500 ease-out flex flex-col shadow-2xl`}>
        {/* Patrón decorativo sutil */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,_white_1px,_transparent_0)] [background-size:16px_16px]"
        />

        {/* Botón de colapsar: flota en el borde derecho del sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-20 z-20 w-6 h-6 rounded-full bg-pink-900 border border-pink-700 text-white hover:bg-pink-800 hover:scale-110 transition-all duration-200 flex items-center justify-center shadow-lg"
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
              <NavItem icon={UserCheck} label="Mentores" section="mentores" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          ) : (
            <>
              <NavItem icon={Home} label="Mi Resumen" section="resumen" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={CreditCard} label="Mis Comisiones" section="mis-comisiones" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
              <NavItem icon={Users} label="Mis Clientes" section="mis-clientes" currentSection={currentSection} onSelect={setCurrentSection} sidebarOpen={sidebarOpen} />
            </>
          )}
        </nav>

        {/* Footer: pill de usuario + botón de logout alineados prolijo */}
        <div className="relative p-3">
          <div aria-hidden="true" className="mx-1 h-px mb-3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          {sidebarOpen ? (
            <div className="flex items-center gap-2 p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors duration-200">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold flex items-center justify-center shrink-0 shadow">
                {(currentUser.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{currentUser.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-pink-200/70">{currentUser.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-pink-100/70 hover:text-white hover:bg-white/10 transition-all duration-200 hover:rotate-12"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-[#4a0f22] font-bold flex items-center justify-center shadow"
                title={currentUser.name}
              >
                {(currentUser.name || 'U').charAt(0).toUpperCase()}
              </div>
              <button
                onClick={handleLogout}
                className="group w-10 h-10 rounded-lg flex items-center justify-center text-pink-100/70 hover:text-white hover:bg-white/10 transition-all duration-200"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogOut size={16} className="group-hover:rotate-12 transition-transform duration-200" />
              </button>
            </div>
          )}
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
        />

        <div key={currentSection} className="p-8 animate-fade-in-up">
          {/* Admin Views */}
          {currentUser.role === 'admin' && currentSection === 'inicio' && <InicioSection state={state} dispatch={dispatch} />}
          {currentUser.role === 'admin' && currentSection === 'ventas' && <VentasSection state={state} onAddSale={handleAddSale} onQuickAddClient={createClient} onQuickAddProduct={createProduct} showModal={showNewSaleModal} setShowModal={setShowNewSaleModal} />}
          {currentUser.role === 'admin' && currentSection === 'productos' && <ProductosSection state={state} onAddProduct={handleAddProduct} showModal={showNewProductModal} setShowModal={setShowNewProductModal} calculateMargin={calculateMargin} />}
          {currentUser.role === 'admin' && currentSection === 'clientes' && <ClientesSection state={state} onAddClient={handleAddClient} onUpdateClient={handleUpdateClient} showModal={showNewClientModal} setShowModal={setShowNewClientModal} />}
          {currentUser.role === 'admin' && currentSection === 'comisiones' && <ComisionesSection state={state} dispatch={dispatch} onUpdateMentor={handleUpdateMentor} getMentorStats={getMentorStats} filterMentor={filterMentor} setFilterMentor={setFilterMentor} />}
          {currentUser.role === 'admin' && currentSection === 'mentores' && <MentoresSection state={state} getMentorStats={getMentorStats} />}

          {/* Mentor Views */}
          {currentUser.role === 'mentor' && currentSection === 'resumen' && <MentorResumenSection currentUser={currentUser} state={state} getMentorStats={getMentorStats} />}
          {currentUser.role === 'mentor' && currentSection === 'mis-comisiones' && <MentorComisionesSection currentUser={currentUser} state={state} filterMonth={filterMonth} setFilterMonth={setFilterMonth} />}
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

function LoginScreen({ onLogin, darkMode, toggleDarkMode }) {
  const [loginMode, setLoginMode] = useState('select');
  const [selectedRole, setSelectedRole] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');

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

        {loginMode === 'select' && (
          <div className="space-y-4">
            <button
              onClick={() => { setSelectedRole('admin'); setLoginMode('admin-login'); }}
              className="w-full py-3 px-4 bg-gradient-to-r from-pink-900 to-rose-700 text-white rounded-lg hover:shadow-lg transition font-semibold"
            >
              Administrador
            </button>
            <button
              onClick={() => { setSelectedRole('mentor'); setLoginMode('mentor-select'); }}
              className="w-full py-3 px-4 bg-gradient-to-r from-pink-600 to-rose-500 text-white rounded-lg hover:shadow-lg transition font-semibold"
            >
              Mentor
            </button>
          </div>
        )}

        {loginMode === 'admin-login' && (
          <div className="space-y-4">
            <input
              type="password"
              placeholder="Contraseña"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            <button
              onClick={() => adminPassword === 'admin' ? onLogin('admin', 'Administrador') : alert('Contraseña incorrecta')}
              className="w-full py-2 bg-pink-900 dark:bg-pink-700 text-white rounded-lg hover:bg-pink-800 dark:hover:bg-pink-600 transition"
            >
              Ingresar
            </button>
            <button
              onClick={() => setLoginMode('select')}
              className="w-full py-2 text-pink-900 dark:text-pink-300 border border-pink-900 dark:border-pink-300 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition"
            >
              Volver
            </button>
          </div>
        )}

        {loginMode === 'mentor-select' && (
          <div className="space-y-4">
            <button
              onClick={() => onLogin('mentor', 'Sofia')}
              className="w-full py-3 px-4 bg-pink-600 text-white rounded-lg hover:shadow-lg transition font-semibold"
            >
              Sofia
            </button>
            <button
              onClick={() => onLogin('mentor', 'Mariano')}
              className="w-full py-3 px-4 bg-rose-600 text-white rounded-lg hover:shadow-lg transition font-semibold"
            >
              Mariano
            </button>
            <button
              onClick={() => setLoginMode('select')}
              className="w-full py-2 text-pink-900 dark:text-pink-300 border border-pink-900 dark:border-pink-300 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition"
            >
              Volver
            </button>
          </div>
        )}

        <div className="mt-8 p-4 bg-pink-50 dark:bg-pink-900/30 rounded-lg text-sm text-gray-700 dark:text-gray-300">
          <p className="font-semibold mb-2">Demo Credentials:</p>
          <p>Admin: password "admin"</p>
          <p>Mentors: Sofia / Mariano</p>
        </div>
      </div>
    </div>
  );
}

function InicioSection({ state, dispatch }) {
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    states: new Set(), // vacío = todos
    onlyIncidencia: false,
    search: '',
  });

  // Órdenes filtradas según el estado actual de los filtros
  const filteredOrders = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return state.sales.filter(order => {
      if (filters.dateFrom && (order.fecha || '') < filters.dateFrom) return false;
      if (filters.dateTo && (order.fecha || '') > filters.dateTo) return false;
      if (filters.states.size > 0 && !filters.states.has(order.estado || 'pendiente-cotizacion')) return false;
      if (filters.onlyIncidencia && !order.tieneIncidencia) return false;
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard icon={DollarSign} label="Ventas del Período" value={`$${Math.round(ventasPeriodo).toLocaleString()}`} color="from-pink-500 to-rose-500" delay={0} />
        <StatCard icon={TrendingUp} label="Profit del Período" value={`$${Math.round(totalProfit).toLocaleString()}`} color="from-emerald-500 to-teal-500" delay={80} />
        <StatCard icon={CreditCard} label="Comisiones Pendientes" value={`$${Math.round(pendingCommissionsPeriodo).toLocaleString()}`} color="from-amber-500 to-orange-500" delay={160} />
        <StatCard icon={Package} label="A pagar Proveedores" value={`$${Math.round(totalPagosProveedoresPendientes).toLocaleString()}`} color="from-sky-500 to-blue-500" delay={240} />
        <StatCard icon={AlertCircle} label="Incidencias" value={ordersConIncidencia} color="from-red-500 to-pink-500" delay={320} />
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
    dateFrom: '', dateTo: '', states: new Set(), onlyIncidencia: false, search: '',
  });

  const anyActive = filters.dateFrom || filters.dateTo || filters.states.size > 0 || filters.onlyIncidencia || filters.search;

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
function OrdersList({ state, dispatch, orders }) {
  const [viewMode, setViewMode] = useState('total'); // 'total' | 'unidad'
  const [incidenciaDraft, setIncidenciaDraft] = useState({}); // { [orderId]: texto }
  const [expanded, setExpanded] = useState(() => new Set());
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Mostrando valores {viewMode === 'total' ? 'totales por orden' : 'por unidad'}</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 p-1 bg-gray-50 dark:bg-gray-900 self-start sm:self-auto">
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
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
            <tr className="text-left text-gray-700 dark:text-gray-200">
              <th className="px-2 py-3 w-8"></th>
              <th className="px-4 py-3 font-semibold">Fecha</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold text-right">Cant.</th>
              <th className="px-4 py-3 font-semibold text-right">Contenido</th>
              <th className="px-4 py-3 font-semibold text-right">Envase</th>
              <th className="px-4 py-3 font-semibold text-right">Etiqueta</th>
              <th className="px-4 py-3 font-semibold text-right">Precio venta</th>
              <th className="px-4 py-3 font-semibold text-right">Com. Mentor</th>
              <th className="px-4 py-3 font-semibold text-right">Profit</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Incidencia</th>
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
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">{order.fecha}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{getClientName(order.clienteId)}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{product?.nombre || '-'}</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">
                    <EditableCell
                      value={order.cantidad}
                      onSave={(v) => handleCantidadEdit(order, v)}
                      prefix=""
                      title="Doble click para editar cantidad"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    <EditableCell
                      value={isTotal ? costs.contenidoTotal : costs.contenidoUnit}
                      onSave={(v) => handleCostEdit(order, 'contenido', v, isTotal)}
                      prefix="$"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    <EditableCell
                      value={isTotal ? costs.envaseTotal : costs.envaseUnit}
                      onSave={(v) => handleCostEdit(order, 'envase', v, isTotal)}
                      prefix="$"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    <EditableCell
                      value={isTotal ? costs.etiquetaTotal : costs.etiquetaUnit}
                      onSave={(v) => handleCostEdit(order, 'etiqueta', v, isTotal)}
                      prefix="$"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                    <EditableCell
                      value={isTotal ? precioVentaTotal : precioVentaUnit}
                      onSave={(v) => handlePriceEdit(order, v, isTotal)}
                      prefix="$"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    {hasMentor ? fmtMoney(isTotal ? commissionTotal : commissionUnit) : <span className="text-gray-400 dark:text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(isTotal ? profitTotal : profitUnit)}</td>
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
                  <td className="px-4 py-3 min-w-[220px]">
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
                </tr>
                {isOpen && payments && cobrosSummary && (
                  <tr className="bg-gray-50 dark:bg-gray-900/40">
                    <td colSpan={13} className="px-6 py-4 space-y-6">
                      <CobrosPanel
                        order={order}
                        summary={cobrosSummary}
                        onChange={(patch) => handleCobrosChange(order, patch)}
                      />
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                        <PaymentsPanel
                          order={order}
                          payments={payments}
                          mentorNombre={hasMentor ? getMentorName(mentorId) : null}
                          onChange={(rubro, data) => handlePaymentChange(order.id, rubro, data)}
                        />
                      </div>
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
  );
}

function StatCard({ icon: Icon, label, value, color, delay = 0 }) {
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

  return (
    <div
      className={`group relative bg-gradient-to-br ${color} text-white rounded-2xl shadow-lg p-6 overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl animate-fade-in-up`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      {/* Efecto shimmer sutil sobre gradiente */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:200%_100%] animate-shimmer"
      />
      {/* Halo glass atrás del ícono */}
      <div aria-hidden="true" className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/20 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider font-semibold opacity-80">{label}</p>
          <p className="text-2xl md:text-3xl font-bold mt-2 truncate tabular-nums">{displayValue}</p>
        </div>
        <div className="shrink-0 p-2 rounded-xl bg-white/10 backdrop-blur-sm">
          <Icon size={22} className="opacity-90" />
        </div>
      </div>
    </div>
  );
}

function VentasSection({ state, onAddSale, onQuickAddClient, onQuickAddProduct, showModal, setShowModal }) {
  const [formData, setFormData] = useState({ clienteId: '', productoId: '', cantidad: 1, mentorId: '', mentorPresupuesto: '' });
  const [showClientQuickModal, setShowClientQuickModal] = useState(false);
  const [showProductQuickModal, setShowProductQuickModal] = useState(false);

  // Cálculos derivados para sugerir el presupuesto del mentor al cargar la venta.
  // La comisión se calcula como 50% del profit (precioVenta - costos) * cantidad.
  const productoSel = state.products.find(p => p.id === parseInt(formData.productoId));
  const cantidadNum = parseInt(formData.cantidad) || 0;
  const profitSugerido = productoSel ? (productoSel.precioVenta - getProductUnitCost(productoSel)) * cantidadNum : 0;
  const mentorSugerido = Math.max(0, Math.round(profitSugerido * 0.5));

  // Cuando cambia el mentor, producto o cantidad, y el usuario no tocó el
  // presupuesto manualmente, reseteamos el valor sugerido (50% de la venta).
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
      // Solo guardamos el presupuesto si hay mentor asignado y un valor numérico.
      mentorPresupuesto: mentorId && presupuestoParsed != null && !Number.isNaN(presupuestoParsed)
        ? presupuestoParsed
        : null,
    };
    onAddSale(newSale);
    setFormData({ clienteId: '', productoId: '', cantidad: 1, mentorId: '', mentorPresupuesto: '' });
    setPresupuestoTouched(false);
  };

  const handleQuickClientCreated = (clientData) => {
    const newClient = onQuickAddClient(clientData);
    // auto-select the new client, and pre-fill mentor if the client has one
    setFormData(prev => ({
      ...prev,
      clienteId: String(newClient.id),
      mentorId: newClient.mentorId ? String(newClient.mentorId) : prev.mentorId,
    }));
    setPresupuestoTouched(false); // dejar que se recalcule el 50% sugerido
    setShowClientQuickModal(false);
  };

  const handleQuickProductCreated = (productData) => {
    const newProduct = onQuickAddProduct(productData);
    setFormData(prev => ({ ...prev, productoId: String(newProduct.id) }));
    setShowProductQuickModal(false);
  };

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
          <Plus size={20} /> Nueva Venta
        </button>
      </div>

      {showModal && (
        <Modal title="Registrar Nueva Venta" onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Cliente</label>
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
                  onClick={() => setShowClientQuickModal(true)}
                  className="inline-flex items-center gap-1 px-3 py-2 border border-pink-600 text-pink-700 dark:text-pink-300 dark:border-pink-500 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm font-semibold whitespace-nowrap"
                  title="Crear un nuevo cliente sin salir de esta pantalla"
                >
                  <Plus size={16} /> Nuevo
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Producto</label>
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
                  onClick={() => setShowProductQuickModal(true)}
                  className="inline-flex items-center gap-1 px-3 py-2 border border-pink-600 text-pink-700 dark:text-pink-300 dark:border-pink-500 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/30 transition text-sm font-semibold whitespace-nowrap"
                  title="Crear un nuevo producto sin salir de esta pantalla"
                >
                  <Plus size={16} /> Nuevo
                </button>
              </div>
            </div>

            <input
              type="number"
              min="1"
              value={formData.cantidad}
              onChange={(e) => setFormData({ ...formData, cantidad: e.target.value })}
              placeholder="Cantidad"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Mentor asignado</label>
              <select
                value={formData.mentorId}
                onChange={(e) => { setFormData({ ...formData, mentorId: e.target.value }); setPresupuestoTouched(false); }}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="">Sin mentor (opcional)</option>
                {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>

            {formData.mentorId && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  Presupuesto para el mentor
                  <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">
                    (sugerido 50% del profit: ${mentorSugerido.toLocaleString()})
                  </span>
                </label>
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
              Registrar Venta
            </button>
          </form>
        </Modal>
      )}

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

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
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
  const [formData, setFormData] = useState({
    nombre: '', descripcion: '',
    costoContenido: '', costoEnvase: '', costoEtiqueta: '',
    precioVenta: '',
  });
  const [expanded, setExpanded] = useState(() => new Set());

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
    onAddProduct({
      nombre: formData.nombre,
      descripcion: formData.descripcion,
      costoContenido: parseInt(formData.costoContenido) || 0,
      costoEnvase: parseInt(formData.costoEnvase) || 0,
      costoEtiqueta: parseInt(formData.costoEtiqueta) || 0,
      precioVenta: parseInt(formData.precioVenta) || 0,
    });
    setFormData({ nombre: '', descripcion: '', costoContenido: '', costoEnvase: '', costoEtiqueta: '', precioVenta: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Catálogo de Productos</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-pink-900 text-white px-6 py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
        >
          <Plus size={20} /> Nuevo Producto
        </button>
      </div>

      {showModal && (
        <Modal title="Agregar Nuevo Producto" onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={formData.nombre}
              onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              placeholder="Nombre del producto"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />
            <input
              type="text"
              value={formData.descripcion}
              onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
              placeholder="Descripción"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={formData.costoContenido}
                onChange={(e) => setFormData({ ...formData, costoContenido: e.target.value })}
                placeholder="Contenido"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
              <input
                type="number"
                value={formData.costoEnvase}
                onChange={(e) => setFormData({ ...formData, costoEnvase: e.target.value })}
                placeholder="Envase"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
              <input
                type="number"
                value={formData.costoEtiqueta}
                onChange={(e) => setFormData({ ...formData, costoEtiqueta: e.target.value })}
                placeholder="Etiqueta"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">Costos unitarios: contenido, envase, etiqueta</p>
            <input
              type="number"
              value={formData.precioVenta}
              onChange={(e) => setFormData({ ...formData, precioVenta: e.target.value })}
              placeholder="Precio Venta unitario"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />
            <button
              type="submit"
              className="w-full bg-pink-900 text-white py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
            >
              Agregar Producto
            </button>
          </form>
        </Modal>
      )}

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
    </div>
  );
}

function ClientesSection({ state, onAddClient, onUpdateClient, showModal, setShowModal }) {
  const emptyForm = { nombre: '', telefono: '', domicilio: '', mentorId: '', totalCompras: '', unidadesProducidas: '' };
  const [formData, setFormData] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Base de Clientes</h2>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-pink-900 text-white px-6 py-2 rounded-lg hover:bg-pink-800 transition font-semibold"
        >
          <Plus size={20} /> Nuevo Cliente
        </button>
      </div>

      {showModal && (
        <Modal title={editingId ? 'Editar Cliente' : 'Agregar Nuevo Cliente'} onClose={handleClose}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Nombre completo</label>
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
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Teléfono</label>
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
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Domicilio de despacho</label>
              <input
                type="text"
                value={formData.domicilio}
                onChange={(e) => setFormData({ ...formData, domicilio: e.target.value })}
                placeholder="Calle 123, Localidad"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Mentor asignado</label>
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
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Órdenes pedidas</label>
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
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Unidades producidas</label>
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

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
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
    </div>
  );
}

function ComisionesSection({ state, dispatch, onUpdateMentor, getMentorStats, filterMentor, setFilterMentor }) {
  const [selectedMentors, setSelectedMentors] = useState([]);

  const handlePayCommissions = () => {
    const salesToPay = state.sales.filter(s => {
      if (filterMentor && s.mentorId !== parseInt(filterMentor)) return false;
      return s.estadoComision === 'pendiente' && (selectedMentors.length === 0 || selectedMentors.includes(s.mentorId));
    });

    if (salesToPay.length === 0) {
      alert('No hay comisiones pendientes para liquidar');
      return;
    }

    if (window.confirm(`¿Liquidar ${salesToPay.length} comisiones pendientes?`)) {
      dispatch({ type: 'PAY_COMMISSIONS', payload: salesToPay.map(s => s.id) });
      setSelectedMentors([]);
    }
  };

  const handlePercentChange = (mentorId, value) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(0, Math.min(100, parsed));
    onUpdateMentor?.({ id: mentorId, porcentajeComision: clamped });
  };

  const filteredMentors = state.mentors.filter(m => !filterMentor || m.id === parseInt(filterMentor));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestión de Comisiones</h2>
        <button
          onClick={handlePayCommissions}
          className="flex items-center gap-2 bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition font-semibold"
        >
          <CreditCard size={20} /> Liquidar
        </button>
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

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Filtrar por Mentor</label>
        <select
          value={filterMentor}
          onChange={(e) => setFilterMentor(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
        >
          <option value="">Todos</option>
          {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredMentors.map(mentor => {
          const stats = getMentorStats(mentor.id);
          return (
            <div key={mentor.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{mentor.nombre}</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Ventas Totales:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">${stats.totalSales.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Comisión Generada:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">${stats.totalCommission.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Comisión Pagada:</span>
                  <span className="font-semibold text-green-600">${stats.paidCommission.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-3">
                  <span className="text-gray-600 dark:text-gray-400 font-semibold">Comisión Pendiente:</span>
                  <span className="font-bold text-amber-600">${stats.pendingCommission.toLocaleString()}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Detalle de Ventas y Comisiones</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">Fecha</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">Mentor</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">Monto Venta</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">Comisión (50%)</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {state.sales
                .filter(s => !filterMentor || s.mentorId === parseInt(filterMentor))
                .map(sale => {
                  const mentor = state.mentors.find(m => m.id === sale.mentorId);
                  return (
                    <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{sale.fecha}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{mentor?.nombre}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">${sale.montoTotal.toLocaleString()}</td>
                      <td className="px-4 py-2 font-semibold text-gray-900 dark:text-gray-100">${(sale.montoTotal * 0.5).toLocaleString()}</td>
                      <td className="px-4 py-2"><Badge text={sale.estadoComision} type={sale.estadoComision === 'pagada' ? 'success' : 'warning'} /></td>
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
function MentorResumenSection({ currentUser, state, getMentorStats }) {
  const stats = getMentorStats(currentUser.id);
  const totalGanado = stats.totalCommission;
  const pendiente = stats.pendingCommission;
  const pagado = stats.paidCommission;
  const mesActualSales = state.sales
    .filter(s => s.mentorId === currentUser.id && s.fecha.startsWith(new Date().toISOString().substring(0, 7)))
    .reduce((sum, s) => sum + (s.montoTotal * 0.5), 0);

  return (
    <div className="space-y-8">
      <div className="text-center mb-8 p-6 bg-gradient-to-r from-pink-100 to-rose-100 dark:from-pink-900/40 dark:to-rose-900/40 rounded-xl">
        <h2 className="text-3xl font-bold text-pink-900 dark:text-pink-200">Bienvenido, {currentUser.name}</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Panel de mentores - Vista de lectura</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard icon={DollarSign} label="Ganado Total" value={`$${totalGanado.toLocaleString()}`} color="from-green-500 to-emerald-500" />
        <StatCard icon={AlertCircle} label="Pendiente de Cobro" value={`$${pendiente.toLocaleString()}`} color="from-amber-500 to-orange-500" />
        <StatCard icon={CreditCard} label="Pagado" value={`$${pagado.toLocaleString()}`} color="from-blue-500 to-cyan-500" />
        <StatCard icon={TrendingUp} label="Mes Actual" value={`$${mesActualSales.toLocaleString()}`} color="from-purple-500 to-pink-500" />
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
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
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
            <thead className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
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
            <thead className="bg-gray-50 dark:bg-gray-700/60">
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
function CobrosPanel({ order, summary, onChange }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const cobros = summary.cobros;
  const { total, cobrado, saldo, porcentaje, cuotasPlanificadas, cuotasPagadas } = summary;

  const updateCobro = (index, patch) => {
    const next = cobros.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange({ cobros: next });
  };

  const addCobro = () => {
    // Sugerimos como monto: saldo / (cuotas planificadas - pagadas) si hay plan,
    // o el saldo completo si no.
    let sugerido = saldo;
    if (cuotasPlanificadas > 0) {
      const faltan = Math.max(1, cuotasPlanificadas - cuotasPagadas);
      sugerido = saldo / faltan;
    }
    const nuevo = {
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Cobros del cliente</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">Plata que entra del cliente por esta orden.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-gray-500 dark:text-gray-400">Plan:</label>
          <input
            type="number"
            min="0"
            value={cuotasPlanificadas || ''}
            onChange={(e) => setPlan(e.target.value)}
            placeholder="0"
            className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500"
            title="Cuántas cuotas acordaste con el cliente (0 = sin plan)"
          />
          <span className="text-gray-500 dark:text-gray-400">{cuotasPlanificadas > 0 ? `cuotas` : 'sin plan'}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Total venta</p>
          <p className="font-bold text-gray-900 dark:text-gray-100">{fmtMoney(total)}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
          <p className="text-[10px] uppercase text-emerald-700 dark:text-emerald-300">Cobrado</p>
          <p className="font-bold text-emerald-700 dark:text-emerald-300">{fmtMoney(cobrado)}</p>
        </div>
        <div className={`rounded-lg p-3 border ${saldada ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
          <p className={`text-[10px] uppercase ${saldada ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>Saldo</p>
          <p className={`font-bold ${saldada ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{saldada ? 'Saldada' : fmtMoney(saldo)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Cuotas</p>
          <p className="font-bold text-gray-900 dark:text-gray-100">
            {cuotasPagadas}{cuotasPlanificadas > 0 ? ` / ${cuotasPlanificadas}` : ''}
          </p>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
          style={{ width: `${Math.min(100, porcentaje)}%` }}
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-700/60">
            <tr className="text-left text-gray-600 dark:text-gray-300">
              <th className="px-3 py-2 font-semibold w-12">Cuota</th>
              <th className="px-3 py-2 font-semibold text-right">Monto</th>
              <th className="px-3 py-2 font-semibold">Fecha</th>
              <th className="px-3 py-2 font-semibold">Nota</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {cobros.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500 dark:text-gray-400 italic">Sin cobros registrados.</td></tr>
            )}
            {cobros.map((cobro, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 font-semibold">
                  {i + 1}{cuotasPlanificadas > 0 ? ` / ${cuotasPlanificadas}` : ''}
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
                    placeholder="ej: seña, transfer..."
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
    </div>
  );
}

function PaymentsPanel({ order, payments, mentorNombre, onChange }) {
  const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const totalPagado = Object.values(payments)
    .filter(p => p.estado === 'pagado')
    .reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
  const totalPendiente = Object.values(payments)
    .filter(p => p.estado === 'pendiente')
    .reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);

  const rubros = [
    { key: 'contenido', label: 'Contenido' },
    { key: 'envase',    label: 'Envase / Pote' },
    { key: 'etiqueta',  label: 'Etiqueta' },
    { key: 'mentor',    label: mentorNombre ? `Comisión — ${mentorNombre}` : 'Comisión mentor' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pagos de esta orden</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">Tildá "Pagado" cuando se haya abonado y completá los datos.</p>
        </div>
        <div className="flex gap-4 text-xs">
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {rubros.map(rubro => {
          const data = payments[rubro.key];
          const isMentorSinAsignar = rubro.key === 'mentor' && !order.mentorId;
          const paid = data.estado === 'pagado';
          return (
            <div
              key={rubro.key}
              className={`rounded-lg border p-3 space-y-2 ${
                isMentorSinAsignar
                  ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60'
                  : paid
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{rubro.label}</span>
                {isMentorSinAsignar ? (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 italic">sin mentor</span>
                ) : (
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={paid}
                      onChange={(e) => onChange(rubro.key, { estado: e.target.checked ? 'pagado' : 'pendiente' })}
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
                  disabled={isMentorSinAsignar}
                  value={data.monto ?? ''}
                  onChange={(e) => onChange(rubro.key, { monto: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 dark:text-gray-400 mb-0.5">Fecha pago</label>
                <input
                  type="date"
                  disabled={isMentorSinAsignar}
                  value={data.fecha || ''}
                  onChange={(e) => onChange(rubro.key, { fecha: e.target.value })}
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 dark:text-gray-400 mb-0.5">Proveedor</label>
                <input
                  type="text"
                  disabled={isMentorSinAsignar}
                  value={data.proveedor || ''}
                  onChange={(e) => onChange(rubro.key, { proveedor: e.target.value })}
                  placeholder={rubro.key === 'mentor' ? 'Mentor' : 'Nombre del proveedor'}
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 dark:text-gray-400 mb-0.5">Nota</label>
                <input
                  type="text"
                  disabled={isMentorSinAsignar}
                  value={data.nota || ''}
                  onChange={(e) => onChange(rubro.key, { nota: e.target.value })}
                  placeholder="Opcional"
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          );
        })}
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
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md">
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Nombre completo *</label>
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Teléfono *</label>
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Mentor asignado (opcional)</label>
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Domicilio de despacho (opcional)</label>
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
    costoContenido: '', costoEnvase: '', costoEtiqueta: '',
  });
  const [showCosts, setShowCosts] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate({
      nombre: data.nombre.trim(),
      descripcion: data.descripcion.trim(),
      precioVenta: parseInt(data.precioVenta) || 0,
      costoContenido: parseInt(data.costoContenido) || 0,
      costoEnvase: parseInt(data.costoEnvase) || 0,
      costoEtiqueta: parseInt(data.costoEtiqueta) || 0,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md">
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Nombre *</label>
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Precio de venta unitario *</label>
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Descripción (opcional)</label>
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
            {showCosts ? '− Ocultar costos' : '+ Cargar costos ahora (opcional)'}
          </button>
          {showCosts && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Costos unitarios (contenido / envase / etiqueta)</label>
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
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Si los dejás vacíos se guardan en 0 y los completás después.</p>
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
  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-100 dark:border-gray-700 animate-scale-in"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h3>
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
    mentores: 'Mentores',
  };
  const mentor = {
    resumen: 'Mi Resumen',
    'mis-comisiones': 'Mis Comisiones',
    'mis-clientes': 'Mis Clientes',
  };
  return (user?.role === 'admin' ? admin[section] : mentor[section]) || 'Laboratorio Viora';
}

// Header sticky que agrega blur + border al hacer scroll. Incluye el botón
// del command palette con el keyboard hint (Cmd+K), toggle de tema y fecha.
function StickyHeader({ title, subtitle, darkMode, toggleDarkMode, onOpenCommand }) {
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
      className={`sticky top-0 z-30 px-8 py-5 flex justify-between items-center transition-all duration-300 ${
        scrolled
          ? 'backdrop-blur-xl bg-white/70 dark:bg-gray-900/70 border-b border-gray-200/60 dark:border-gray-700/60 shadow-sm'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{title}</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
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
          onClick={toggleDarkMode}
          className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-all duration-200 hover:scale-105 active:scale-95"
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
