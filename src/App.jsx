import React, { useState, useReducer, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';
import {
  Menu, LogOut, Home, ShoppingCart, Package, Users, AlertCircle, CreditCard,
  UserCheck, TrendingUp, Plus, Filter, Eye, Edit2, Trash2, Calendar, DollarSign,
  Moon, Sun, ChevronDown, ChevronRight
} from 'lucide-react';

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
    { id: 1, nombre: 'Sofia', contacto: '11 9876-5432', fechaInicio: '2023-12-01', clientesAsignados: 4 },
    { id: 2, nombre: 'Mariano', contacto: '11 8765-4321', fechaInicio: '2023-12-15', clientesAsignados: 4 },
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
    default:
      return state;
  }
}

// Helpers de cálculo de costos y profit
export function getProductUnitCost(product) {
  if (!product) return 0;
  return (product.costoContenido || 0) + (product.costoEnvase || 0) + (product.costoEtiqueta || 0);
}

export function getOrderCosts(order, product) {
  const unit = getProductUnitCost(product);
  const cantidad = order.cantidad || 0;
  return {
    contenidoUnit: product?.costoContenido || 0,
    envaseUnit: product?.costoEnvase || 0,
    etiquetaUnit: product?.costoEtiqueta || 0,
    costoUnit: unit,
    contenidoTotal: (product?.costoContenido || 0) * cantidad,
    envaseTotal: (product?.costoEnvase || 0) * cantidad,
    etiquetaTotal: (product?.costoEtiqueta || 0) * cantidad,
    costoTotal: unit * cantidad,
  };
}

export function getOrderProfit(order, product) {
  // Profit del laboratorio = (precioVenta - costos) * cantidad.
  // La comisión del mentor NO se descuenta acá porque es profit del mentor.
  const unitCost = getProductUnitCost(product);
  const precioVenta = product?.precioVenta || 0;
  const cantidad = order.cantidad || 0;
  return (precioVenta - unitCost) * cantidad;
}

export function getMentorCommission(order) {
  return (order.montoTotal || 0) * 0.5;
}

export default function DASHLaboratorio() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentSection, setCurrentSection] = useState('inicio');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNewSaleModal, setShowNewSaleModal] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [filterMentor, setFilterMentor] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
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

  // Handlers
  const handleLogin = (role, name) => {
    setCurrentUser({ role, name, id: role === 'admin' ? 'admin' : (name === 'Sofia' ? 1 : 2) });
    setCurrentSection('inicio');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentSection('inicio');
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
    return newClient;
  };

  const handleAddClient = (clientData) => {
    createClient(clientData);
    setShowNewClientModal(false);
  };

  const handleUpdateClient = (clientData) => {
    dispatch({ type: 'UPDATE_CLIENT', payload: clientData });
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
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-gradient-to-b from-pink-900 to-pink-800 text-white transition-all duration-300 flex flex-col`}>
        <div className="p-6 border-b border-pink-700">
          <h1 className={`${!sidebarOpen && 'hidden'} text-2xl font-bold bg-gradient-to-r from-pink-200 to-rose-200 bg-clip-text text-transparent`}>
            DASH
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-2">
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

        <div className="p-4 border-t border-pink-700 space-y-2">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-pink-700 transition"
          >
            <Menu size={20} />
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-lg hover:bg-pink-700 transition"
            title="Cerrar sesión"
          >
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 p-6 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">DASH Laboratorio</h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Bienvenido, {currentUser.name}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition"
              title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">{new Date().toLocaleDateString('es-ES')}</span>
          </div>
        </header>

        <div className="p-8">
          {/* Admin Views */}
          {currentUser.role === 'admin' && currentSection === 'inicio' && <InicioSection state={state} dispatch={dispatch} calculateMargin={calculateMargin} getMonthlySalesData={getMonthlySalesData} getCurrentMonthSales={getCurrentMonthSales} getPendingCommissions={getPendingCommissions} getActiveClients={getActiveClients} />}
          {currentUser.role === 'admin' && currentSection === 'ventas' && <VentasSection state={state} onAddSale={handleAddSale} onQuickAddClient={createClient} onQuickAddProduct={createProduct} showModal={showNewSaleModal} setShowModal={setShowNewSaleModal} />}
          {currentUser.role === 'admin' && currentSection === 'productos' && <ProductosSection state={state} onAddProduct={handleAddProduct} showModal={showNewProductModal} setShowModal={setShowNewProductModal} calculateMargin={calculateMargin} />}
          {currentUser.role === 'admin' && currentSection === 'clientes' && <ClientesSection state={state} onAddClient={handleAddClient} onUpdateClient={handleUpdateClient} showModal={showNewClientModal} setShowModal={setShowNewClientModal} />}
          {currentUser.role === 'admin' && currentSection === 'comisiones' && <ComisionesSection state={state} dispatch={dispatch} getMentorStats={getMentorStats} filterMentor={filterMentor} setFilterMentor={setFilterMentor} />}
          {currentUser.role === 'admin' && currentSection === 'mentores' && <MentoresSection state={state} getMentorStats={getMentorStats} />}

          {/* Mentor Views */}
          {currentUser.role === 'mentor' && currentSection === 'resumen' && <MentorResumenSection currentUser={currentUser} state={state} getMentorStats={getMentorStats} />}
          {currentUser.role === 'mentor' && currentSection === 'mis-comisiones' && <MentorComisionesSection currentUser={currentUser} state={state} filterMonth={filterMonth} setFilterMonth={setFilterMonth} />}
          {currentUser.role === 'mentor' && currentSection === 'mis-clientes' && <MentorClientesSection currentUser={currentUser} state={state} />}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon: Icon, label, section, currentSection, onSelect, sidebarOpen }) {
  const isActive = currentSection === section;
  return (
    <button
      onClick={() => onSelect(section)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
        isActive ? 'bg-pink-700 text-white' : 'text-pink-100 hover:bg-pink-700'
      }`}
    >
      <Icon size={20} />
      {sidebarOpen && <span className="text-sm">{label}</span>}
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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-900 to-rose-700 dark:from-pink-300 dark:to-rose-400 bg-clip-text text-transparent">
            DASH Laboratorio
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Cosmetics Business Dashboard</p>
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

function InicioSection({ state, dispatch, getCurrentMonthSales, getPendingCommissions, getActiveClients, getMonthlySalesData }) {
  const monthlySales = getMonthlySalesData();
  const currentMonthSales = getCurrentMonthSales();
  const pendingCommissions = getPendingCommissions();
  const activeClients = getActiveClients();

  // Totales del listado
  const totalProfit = state.sales.reduce((acc, order) => {
    const product = state.products.find(p => p.id === order.productoId);
    return acc + getOrderProfit(order, product);
  }, 0);
  const ordersConIncidencia = state.sales.filter(s => s.tieneIncidencia).length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard icon={DollarSign} label="Ventas del Mes" value={`$${currentMonthSales.toLocaleString()}`} color="from-pink-500 to-rose-500" />
        <StatCard icon={TrendingUp} label="Profit Total" value={`$${totalProfit.toLocaleString()}`} color="from-emerald-500 to-teal-500" />
        <StatCard icon={CreditCard} label="Comisiones Pendientes" value={`$${pendingCommissions.toLocaleString()}`} color="from-amber-500 to-orange-500" />
        <StatCard icon={AlertCircle} label="Incidencias" value={ordersConIncidencia} color="from-red-500 to-pink-500" />
      </div>

      <OrdersList state={state} dispatch={dispatch} />

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Ventas Últimos 6 Meses</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={monthlySales}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total" stroke="#be185d" strokeWidth={3} name="Total Ventas ($)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Listado de órdenes con toggle total/unidad, edición de estado e incidencia
function OrdersList({ state, dispatch }) {
  const [viewMode, setViewMode] = useState('total'); // 'total' | 'unidad'
  const [incidenciaDraft, setIncidenciaDraft] = useState({}); // { [orderId]: texto }

  const handleStateChange = (orderId, nuevoEstado) => {
    dispatch({ type: 'UPDATE_ORDER_STATE', payload: { orderId, estado: nuevoEstado } });
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
            {state.sales.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Todavía no hay órdenes cargadas.</td></tr>
            )}
            {state.sales.map(order => {
              const product = getProduct(order.productoId);
              const costs = getOrderCosts(order, product);
              const profitTotal = getOrderProfit(order, product);
              const profitUnit = product ? (product.precioVenta - getProductUnitCost(product)) : 0;
              const mentorId = order.mentorId;
              const hasMentor = !!mentorId;
              const commissionTotal = hasMentor ? getMentorCommission(order) : 0;
              const commissionUnit = hasMentor ? (product ? product.precioVenta * 0.5 : 0) : 0;
              const precioVentaUnit = product?.precioVenta || 0;
              const precioVentaTotal = precioVentaUnit * (order.cantidad || 0);

              const isTotal = viewMode === 'total';
              return (
                <tr key={order.id} className={`transition ${order.tieneIncidencia ? 'bg-red-50/40 dark:bg-red-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">{order.fecha}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{getClientName(order.clienteId)}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{product?.nombre || '-'}</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{order.cantidad}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{fmtMoney(isTotal ? costs.contenidoTotal : costs.contenidoUnit)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{fmtMoney(isTotal ? costs.envaseTotal : costs.envaseUnit)}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{fmtMoney(isTotal ? costs.etiquetaTotal : costs.etiquetaUnit)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(isTotal ? precioVentaTotal : precioVentaUnit)}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className={`bg-gradient-to-br ${color} text-white rounded-xl shadow-lg p-6`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-90">{label}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
        </div>
        <Icon size={32} className="opacity-50" />
      </div>
    </div>
  );
}

function VentasSection({ state, onAddSale, onQuickAddClient, onQuickAddProduct, showModal, setShowModal }) {
  const [formData, setFormData] = useState({ clienteId: '', productoId: '', cantidad: 1, mentorId: '' });
  const [showClientQuickModal, setShowClientQuickModal] = useState(false);
  const [showProductQuickModal, setShowProductQuickModal] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const producto = state.products.find(p => p.id === parseInt(formData.productoId));
    if (!producto) return;
    const cantidad = parseInt(formData.cantidad) || 1;
    const newSale = {
      fecha: new Date().toISOString().split('T')[0],
      clienteId: parseInt(formData.clienteId),
      productoId: parseInt(formData.productoId),
      cantidad,
      montoTotal: producto.precioVenta * cantidad,
      mentorId: formData.mentorId ? parseInt(formData.mentorId) : null,
    };
    onAddSale(newSale);
    setFormData({ clienteId: '', productoId: '', cantidad: 1, mentorId: '' });
  };

  const handleQuickClientCreated = (clientData) => {
    const newClient = onQuickAddClient(clientData);
    // auto-select the new client, and pre-fill mentor if the client has one
    setFormData(prev => ({
      ...prev,
      clienteId: String(newClient.id),
      mentorId: newClient.mentorId ? String(newClient.mentorId) : prev.mentorId,
    }));
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

            <select
              value={formData.mentorId}
              onChange={(e) => setFormData({ ...formData, mentorId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            >
              <option value="">Sin mentor (opcional)</option>
              {state.mentors.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>

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

function ComisionesSection({ state, dispatch, getMentorStats, filterMentor, setFilterMentor }) {
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
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
          >
            ×
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
