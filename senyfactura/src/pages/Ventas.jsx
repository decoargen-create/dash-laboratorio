import { useEffect, useState, useCallback } from 'react'
import { Zap, RefreshCw } from 'lucide-react'
import { supabase, FUNCTIONS_URL } from '../supabase.js'
import { money } from '../lib/fmt.js'

const PLAT_LABEL = { mercadolibre: 'Mercado Libre', shopify: 'Shopify', tiendanube: 'Tienda Nube' }
const ESTADO_CHIP = {
  pendiente: ['chip-amber', 'Pendiente'],
  facturado: ['chip-green', 'Facturado'],
  error: ['chip-red', 'Error'],
  omitido: ['chip-gray', 'Omitido'],
}

export default function Ventas() {
  const [pedidos, setPedidos] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [procesando, setProcesando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [err, setErr] = useState('')

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('fact_pedidos').select('*').order('created_at', { ascending: false })
    setPedidos(data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const pendientes = (pedidos || []).filter((p) => p.estado === 'pendiente' || p.estado === 'error')
  const visibles = filtro === 'todos' ? (pedidos || []) : (pedidos || []).filter((p) => p.estado === filtro)

  async function facturarTodo() {
    setErr(''); setResultado(null); setProcesando(true)
    try {
      const { data: s } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/procesar-cola`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token}` },
        body: '{}',
      })
      const out = await r.json()
      if (!r.ok || out.error) throw new Error(out.error || 'No se pudo procesar la cola')
      setResultado(out)
      await cargar()
    } catch (e) {
      setErr(e.message)
    } finally {
      setProcesando(false)
    }
  }

  return (
    <>
      <div className="page-head row-between">
        <div>
          <h1 className="page-title">Ventas a facturar</h1>
          <p className="page-sub">Los pedidos que entran de tus tiendas caen acá para facturarse.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={cargar} title="Actualizar"><RefreshCw size={16} /></button>
          <button className="btn btn-primary" disabled={procesando || pendientes.length === 0} onClick={facturarTodo}>
            <Zap size={16} /> {procesando ? 'Facturando…' : `Facturar ${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {err && <div className="msg msg-err">{err}</div>}
      {resultado && (
        <div className="msg msg-ok">
          Listo: <b>{resultado.facturados}</b> facturada{resultado.facturados === 1 ? '' : 's'}
          {resultado.errores > 0 && <>, <b>{resultado.errores}</b> con error</>}.
        </div>
      )}

      <div className="tabs" style={{ maxWidth: 420, marginBottom: 16 }}>
        {[['todos', 'Todas'], ['pendiente', 'Pendientes'], ['facturado', 'Facturadas'], ['error', 'Con error']].map(([k, label]) => (
          <button key={k} className={`tab ${filtro === k ? 'active' : ''}`} onClick={() => setFiltro(k)}>{label}</button>
        ))}
      </div>

      <div className="card">
        {pedidos === null ? (
          <div className="empty">Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="empty">
            {filtro === 'todos'
              ? 'Todavía no entraron ventas. Cuando conectes tus tiendas, los pedidos pagados aparecen acá para facturarse.'
              : 'No hay ventas en este estado.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Pedido</th><th>Canal</th><th>Cliente</th><th className="num">Total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const [chip, label] = ESTADO_CHIP[p.estado] || ['chip-gray', p.estado]
                return (
                  <tr key={p.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>#{p.pedido_num}</td>
                    <td>{PLAT_LABEL[p.plataforma] || p.plataforma}</td>
                    <td>{p.cliente || <span className="muted">—</span>}</td>
                    <td className="num mono">{money(p.total)}</td>
                    <td>
                      <span className={`chip ${chip}`}>{label}</span>
                      {p.estado === 'error' && p.error_msg && (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 3, maxWidth: 280 }}>{p.error_msg}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
