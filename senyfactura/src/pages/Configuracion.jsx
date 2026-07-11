import { useEffect, useState } from 'react'
import { Zap, ListChecks } from 'lucide-react'
import { supabase } from '../supabase.js'

export default function Configuracion({ session }) {
  const [empresas, setEmpresas] = useState([])
  const [cfg, setCfg] = useState({ modo: 'lote', empresa_default_id: '', cond_iva_default: 5 })
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    (async () => {
      const [{ data: emps }, { data: c }] = await Promise.all([
        supabase.from('fact_empresas').select('id, nombre').order('created_at'),
        supabase.from('fact_config').select('*').maybeSingle(),
      ])
      setEmpresas(emps || [])
      if (c) setCfg({ modo: c.modo, empresa_default_id: c.empresa_default_id || '', cond_iva_default: c.cond_iva_default })
      setCargando(false)
    })()
  }, [])

  async function guardar() {
    setGuardando(true); setOk(false)
    const { error } = await supabase.from('fact_config').upsert({
      owner_id: session.user.id,
      modo: cfg.modo,
      empresa_default_id: cfg.empresa_default_id || null,
      cond_iva_default: Number(cfg.cond_iva_default),
      updated_at: new Date().toISOString(),
    })
    setGuardando(false)
    if (!error) { setOk(true); setTimeout(() => setOk(false), 2500) }
  }

  if (cargando) return <div className="empty">Cargando…</div>

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Configuración</h1>
        <p className="page-sub">Cómo querés que SenyFactura facture tus ventas.</p>
      </div>

      <div className="card card-pad" style={{ maxWidth: 640, marginBottom: 16 }}>
        <h3 className="section-title">Modo de facturación</h3>
        <div className="grid grid-2">
          <ModoCard
            activo={cfg.modo === 'auto'} onClick={() => setCfg({ ...cfg, modo: 'auto' })}
            icon={<Zap size={18} />} titulo="Automático"
            desc="Apenas entra una venta pagada, se factura sola. Cero laburo." />
          <ModoCard
            activo={cfg.modo === 'lote'} onClick={() => setCfg({ ...cfg, modo: 'lote' })}
            icon={<ListChecks size={18} />} titulo="Revisar y facturar en lote"
            desc="Las ventas se acumulan y las facturás todas juntas con un botón." />
        </div>
      </div>

      <div className="card card-pad" style={{ maxWidth: 640 }}>
        <h3 className="section-title">Valores por defecto</h3>
        <div className="field">
          <label>Empresa con la que facturar (si el pedido no trae una)</label>
          <select value={cfg.empresa_default_id} onChange={(e) => setCfg({ ...cfg, empresa_default_id: e.target.value })}>
            <option value="">— Sin empresa por defecto —</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Condición IVA por defecto del comprador</label>
          <select value={cfg.cond_iva_default} onChange={(e) => setCfg({ ...cfg, cond_iva_default: e.target.value })}>
            <option value={5}>Consumidor final</option>
            <option value={1}>Responsable Inscripto</option>
            <option value={6}>Monotributo</option>
            <option value={4}>Exento</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button className="btn btn-primary" disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Guardar configuración'}
          </button>
          {ok && <span className="chip chip-green">Guardado ✓</span>}
        </div>
      </div>
    </>
  )
}

function ModoCard({ activo, onClick, icon, titulo, desc }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', padding: 16, borderRadius: 11, cursor: 'pointer',
        border: `1.5px solid ${activo ? 'var(--yellow)' : 'var(--border)'}`,
        background: activo ? 'rgba(247,195,37,.08)' : 'var(--card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6 }}>
        {icon} {titulo}
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>{desc}</div>
    </button>
  )
}
