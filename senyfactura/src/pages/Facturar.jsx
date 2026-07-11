import { useEffect, useState } from 'react'
import { supabase, FUNCTIONS_URL } from '../supabase.js'
import { money, CBTE, fechaAfip } from '../lib/fmt.js'

// Condiciones IVA del receptor (tabla ARCA, las más comunes)
const COND_IVA = [
  { id: 5, label: 'Consumidor final' },
  { id: 1, label: 'Responsable Inscripto (Factura A)' },
  { id: 6, label: 'Monotributo' },
  { id: 4, label: 'Exento' },
]

export default function Facturar({ session, onDone }) {
  const [empresas, setEmpresas] = useState([])
  const [empresaId, setEmpresaId] = useState('')
  const [total, setTotal] = useState('')
  const [condIva, setCondIva] = useState(5)
  const [docNro, setDocNro] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [factura, setFactura] = useState(null)

  useEffect(() => {
    supabase.from('fact_empresas').select('*').order('created_at').then(({ data }) => {
      setEmpresas(data || [])
      if (data?.length) setEmpresaId(data[0].id)
    })
  }, [])

  const empresa = empresas.find((e) => e.id === empresaId)
  const esRI = empresa?.regimen === 'RI'
  const facturaA = esRI && Number(condIva) === 1
  const requiereCuit = facturaA

  async function emitir(e) {
    e.preventDefault()
    setErr(''); setFactura(null)
    if (requiereCuit && !/^\d{11}$/.test(docNro.replace(/\D/g, ''))) {
      setErr('Para Factura A necesitás el CUIT del receptor (11 dígitos).')
      return
    }
    setBusy(true)
    try {
      const { data: s } = await supabase.auth.getSession()
      const jwt = s.session?.access_token
      const body = {
        empresa_id: empresaId,
        total: Number(total),
        receptor_cond_iva: Number(condIva),
      }
      if (requiereCuit) { body.doc_tipo = 80; body.doc_nro = docNro.replace(/\D/g, '') }

      const r = await fetch(`${FUNCTIONS_URL}/facturar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
      })
      const out = await r.json()
      if (!r.ok || out.error) throw new Error(out.error || 'No se pudo emitir')
      setFactura(out.factura)
      setTotal(''); setDocNro('')
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  if (empresas.length === 0) {
    return (
      <>
        <div className="page-head"><h1 className="page-title">Facturar</h1></div>
        <div className="card"><div className="empty">Primero cargá una empresa en <b>Mis empresas</b> para poder emitir comprobantes.</div></div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Facturar</h1>
        <p className="page-sub">Emití un comprobante electrónico con CAE de ARCA.</p>
      </div>

      {factura && (
        <div className="card card-pad" style={{ marginBottom: 18, borderColor: 'var(--green-ink)' }}>
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="chip chip-green">Aprobada ✓</span>
              <h3 style={{ margin: '10px 0 2px' }}>{CBTE[factura.cbte_tipo]} · {String(factura.punto_venta).padStart(4, '0')}-{String(factura.cbte_nro).padStart(8, '0')}</h3>
              <p className="muted" style={{ margin: 0 }}>CAE <b className="mono">{factura.cae}</b> · vence {fechaAfip(factura.cae_vto)}</p>
            </div>
            <div className="right">
              <div className="stat-value">{money(factura.total)}</div>
              {factura.imp_iva > 0 && <div className="muted" style={{ fontSize: 12 }}>Neto {money(factura.imp_neto)} + IVA {money(factura.imp_iva)}</div>}
            </div>
          </div>
          <button className="btn" style={{ marginTop: 14 }} onClick={onDone}>Ver todos los comprobantes →</button>
        </div>
      )}

      <div className="card card-pad" style={{ maxWidth: 560 }}>
        {err && <div className="msg msg-err">{err}</div>}
        <form onSubmit={emitir}>
          <div className="field">
            <label>Empresa emisora</label>
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.regimen}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Total de la venta (IVA incluido)</label>
            <input type="number" step="0.01" min="0.01" required value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
          </div>

          <div className="field">
            <label>Condición IVA del receptor</label>
            <select value={condIva} onChange={(e) => setCondIva(e.target.value)}>
              {COND_IVA.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          {requiereCuit && (
            <div className="field">
              <label>CUIT del receptor</label>
              <input value={docNro} onChange={(e) => setDocNro(e.target.value)} placeholder="30-12345678-9" />
            </div>
          )}

          <div className="msg" style={{ background: '#f2f3f5', color: 'var(--ink-soft)' }}>
            Se va a emitir: <b>{comprobante(empresa, condIva)}</b>
            {empresa?.regimen === 'MONO' && <> — Monotributo siempre emite Factura C.</>}
          </div>

          <button className="btn btn-primary btn-lg" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Solicitando CAE a ARCA…' : 'Emitir comprobante'}
          </button>
        </form>
      </div>
    </>
  )
}

function comprobante(empresa, condIva) {
  if (!empresa) return '—'
  if (empresa.regimen === 'MONO') return 'Factura C'
  return Number(condIva) === 1 ? 'Factura A' : 'Factura B'
}
