import { useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { supabase } from '../supabase.js'

const PLATAFORMAS = [
  { key: 'tiendanube', nombre: 'Tienda Nube', estado: 'proximamente' },
  { key: 'shopify', nombre: 'Shopify', estado: 'proximamente' },
  { key: 'mercadolibre', nombre: 'Mercado Libre', estado: 'proximamente' },
]

export default function Tiendas() {
  const [tiendas, setTiendas] = useState(null)

  useEffect(() => {
    // Vista segura: no expone el access_token, solo si está conectada.
    supabase.from('fact_tiendas_pub').select('*').order('created_at')
      .then(({ data }) => setTiendas(data || []))
  }, [])

  const porPlataforma = (key) => (tiendas || []).filter((t) => t.plataforma === key)

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Tiendas</h1>
        <p className="page-sub">Conectá tus canales de venta para que los pedidos entren solos a facturar.</p>
      </div>

      <div className="grid grid-3">
        {PLATAFORMAS.map((p) => {
          const conectadas = porPlataforma(p.key)
          return (
            <div key={p.key} className="card card-pad">
              <div className="row-between">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="brand-logo" style={{ background: '#eff1f3', color: 'var(--ink)' }}><ShoppingBag size={16} /></div>
                  <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                </div>
                {conectadas.length > 0
                  ? <span className="chip chip-green">{conectadas.length} conectada{conectadas.length > 1 ? 's' : ''}</span>
                  : <span className="chip chip-gray">Sin conectar</span>}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: '12px 0 14px' }}>
                {conectadas.length > 0
                  ? conectadas.map((t) => t.nombre).join(', ')
                  : 'Conectá tu cuenta para importar y facturar tus ventas automáticamente.'}
              </p>
              <button className="btn" disabled title="Integración en desarrollo" style={{ width: '100%' }}>
                Conectar (próximamente)
              </button>
            </div>
          )
        })}
      </div>

      <div className="msg" style={{ background: '#f2f3f5', color: 'var(--ink-soft)', marginTop: 18 }}>
        Las integraciones automáticas se están construyendo. Por ahora podés facturar de forma manual desde <b>Facturar</b>.
      </div>
    </>
  )
}
