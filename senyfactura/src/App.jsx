import { useEffect, useState } from 'react'
import { Inbox, FileText, Receipt, Building2, Store, Settings, LogOut } from 'lucide-react'
import { supabase } from './supabase.js'
import Auth from './Auth.jsx'
import Ventas from './pages/Ventas.jsx'
import Facturar from './pages/Facturar.jsx'
import Facturas from './pages/Facturas.jsx'
import Empresas from './pages/Empresas.jsx'
import Tiendas from './pages/Tiendas.jsx'
import Configuracion from './pages/Configuracion.jsx'

const NAV = [
  { key: 'ventas', label: 'Ventas a facturar', icon: Inbox },
  { key: 'facturar', label: 'Facturar manual', icon: FileText },
  { key: 'facturas', label: 'Comprobantes', icon: Receipt },
  { key: 'empresas', label: 'Mis empresas', icon: Building2 },
  { key: 'tiendas', label: 'Tiendas', icon: Store },
  { key: 'config', label: 'Configuración', icon: Settings },
]

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = cargando
  const [page, setPage] = useState('ventas')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="auth-wrap muted">Cargando…</div>
  if (!session) return <Auth />

  const email = session.user.email || ''
  const inicial = email[0]?.toUpperCase() || 'U'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">S</div>
          <div className="brand-name">SenyFactura</div>
        </div>
        {NAV.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => setPage(key)}>
            <Icon size={17} /> {label}
          </button>
        ))}
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-avatar">{inicial}</div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
            </div>
          </div>
          <button className="nav-item" onClick={() => supabase.auth.signOut()}>
            <LogOut size={17} /> Salir
          </button>
        </div>
      </aside>

      <main className="main">
        {page === 'ventas' && <Ventas session={session} />}
        {page === 'facturar' && <Facturar session={session} onDone={() => setPage('facturas')} />}
        {page === 'facturas' && <Facturas session={session} />}
        {page === 'empresas' && <Empresas session={session} />}
        {page === 'tiendas' && <Tiendas session={session} />}
        {page === 'config' && <Configuracion session={session} />}
      </main>
    </div>
  )
}
