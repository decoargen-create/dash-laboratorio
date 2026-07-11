import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../supabase.js'
import { REGIMEN_LABEL } from '../lib/fmt.js'

export default function Empresas({ session }) {
  const [empresas, setEmpresas] = useState(null)
  const [form, setForm] = useState({ nombre: '', cuit: '', regimen: 'RI', punto_venta: 1 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [creando, setCreando] = useState(false)

  async function cargar() {
    const { data } = await supabase.from('fact_empresas').select('*').order('created_at')
    setEmpresas(data || [])
  }
  useEffect(() => { cargar() }, [])

  async function crear(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const cuit = form.cuit.replace(/\D/g, '')
      if (!/^\d{11}$/.test(cuit)) throw new Error('El CUIT debe tener 11 dígitos.')
      const { error } = await supabase.from('fact_empresas').insert({
        nombre: form.nombre.trim(),
        cuit,
        regimen: form.regimen,
        punto_venta: Number(form.punto_venta) || 1,
        activo: true,
        owner_id: session.user.id,
      })
      if (error) throw error
      setForm({ nombre: '', cuit: '', regimen: 'RI', punto_venta: 1 })
      setCreando(false)
      cargar()
    } catch (e2) {
      setErr(e2.message.includes('duplicate') ? 'Ya cargaste una empresa con ese CUIT.' : e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head row-between">
        <div>
          <h1 className="page-title">Mis empresas</h1>
          <p className="page-sub">Las razones sociales con las que emitís comprobantes en ARCA.</p>
        </div>
        {!creando && (
          <button className="btn btn-primary" onClick={() => setCreando(true)}><Plus size={16} /> Nueva empresa</button>
        )}
      </div>

      {creando && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <h3 className="section-title">Nueva empresa</h3>
          {err && <div className="msg msg-err">{err}</div>}
          <form onSubmit={crear}>
            <div className="grid grid-2">
              <div className="field">
                <label>Nombre / Razón social</label>
                <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Mi Comercio SRL" />
              </div>
              <div className="field">
                <label>CUIT</label>
                <input required value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} placeholder="30-12345678-9" />
              </div>
              <div className="field">
                <label>Régimen</label>
                <select value={form.regimen} onChange={(e) => setForm({ ...form, regimen: e.target.value })}>
                  <option value="RI">Responsable Inscripto (Factura A/B)</option>
                  <option value="MONO">Monotributo (Factura C)</option>
                </select>
              </div>
              <div className="field">
                <label>Punto de venta</label>
                <input type="number" min="1" value={form.punto_venta} onChange={(e) => setForm({ ...form, punto_venta: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar empresa'}</button>
              <button type="button" className="btn" onClick={() => { setCreando(false); setErr('') }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {empresas === null ? (
          <div className="empty">Cargando…</div>
        ) : empresas.length === 0 ? (
          <div className="empty">Todavía no cargaste ninguna empresa. Creá la primera para empezar a facturar.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Nombre</th><th>CUIT</th><th>Régimen</th><th className="num">Pto. venta</th></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.nombre}</td>
                  <td className="mono">{e.cuit}</td>
                  <td><span className="chip chip-gray">{REGIMEN_LABEL[e.regimen] || e.regimen}</span></td>
                  <td className="num mono">{String(e.punto_venta).padStart(4, '0')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
