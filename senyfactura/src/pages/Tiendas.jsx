import { useEffect, useState } from 'react'
import { ShoppingBag, ExternalLink } from 'lucide-react'
import { supabase, FUNCTIONS_URL } from '../supabase.js'

const PLATAFORMAS = [
  { key: 'mercadolibre', nombre: 'Mercado Libre', conectable: true, emoji: '🛍️' },
  { key: 'shopify', nombre: 'Shopify', conectable: false, emoji: '🛒' },
  { key: 'tiendanube', nombre: 'Tienda Nube', conectable: false, emoji: '🏪' },
]

export default function Tiendas() {
  const [tiendas, setTiendas] = useState(null)
  const [conectando, setConectando] = useState('')
  const [err, setErr] = useState('')

  async function cargar() {
    const { data } = await supabase.from('fact_tiendas_pub').select('*').order('created_at')
    setTiendas(data || [])
  }
  useEffect(() => { cargar() }, [])

  async function conectarML() {
    setErr(''); setConectando('mercadolibre')
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/ml-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token}` },
        body: '{}',
      })
      const out = await r.json()
      if (!r.ok || !out.url) throw new Error(out.error || 'No se pudo iniciar la conexión')
      // Abrir la autorización de Mercado Libre en otra pestaña
      window.open(out.url, '_blank', 'noopener')
    } catch (e) {
      setErr(e.message)
    } finally {
      setConectando('')
    }
  }

  const porPlataforma = (key) => (tiendas || []).filter((t) => t.plataforma === key)

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Tiendas</h1>
        <p className="page-sub">Conectá tus canales de venta para que los pedidos entren solos a facturar.</p>
      </div>

      {err && <div className="msg msg-err">{err}</div>}

      <div className="grid grid-3">
        {PLATAFORMAS.map((p) => {
          const conectadas = porPlataforma(p.key)
          const yaConectada = conectadas.length > 0
          return (
            <div key={p.key} className="card card-pad">
              <div className="row-between">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="brand-logo" style={{ background: 'var(--gray-bg)', color: 'var(--ink)' }}>{p.emoji}</div>
                  <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                </div>
                {yaConectada
                  ? <span className="chip chip-green">{conectadas.length} conectada{conectadas.length > 1 ? 's' : ''}</span>
                  : <span className="chip chip-gray">Sin conectar</span>}
              </div>

              <p className="muted" style={{ fontSize: 13, margin: '12px 0 14px', minHeight: 34 }}>
                {yaConectada
                  ? conectadas.map((t) => t.nombre.replace('Mercado Libre — ', '')).join(', ')
                  : 'Conectá tu cuenta para importar y facturar tus ventas automáticamente.'}
              </p>

              {p.conectable ? (
                <button className="btn btn-primary" style={{ width: '100%' }} disabled={conectando === p.key} onClick={conectarML}>
                  {conectando === p.key ? 'Abriendo…' : yaConectada ? 'Reconectar' : 'Conectar'}
                  {conectando !== p.key && <ExternalLink size={15} />}
                </button>
              ) : (
                <button className="btn" disabled style={{ width: '100%' }}>Conectar (próximamente)</button>
              )}
            </div>
          )
        })}
      </div>

      <div className="note" style={{ marginTop: 18 }}>
        Cuando conectás Mercado Libre, tus ventas pagadas entran solas a <b>Ventas a facturar</b>. Según tu
        <b> Configuración</b>, se facturan automáticamente o cuando vos apretás el botón.
      </div>
    </>
  )
}
