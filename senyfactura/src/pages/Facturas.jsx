import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { money, CBTE, fechaAfip } from '../lib/fmt.js'

export default function Facturas() {
  const [facturas, setFacturas] = useState(null)

  useEffect(() => {
    supabase.from('fact_facturas').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setFacturas(data || []))
  }, [])

  const totalFacturado = (facturas || []).reduce((a, f) => a + Number(f.total), 0)

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Comprobantes</h1>
        <p className="page-sub">Todo lo que facturaste, con su CAE de ARCA.</p>
      </div>

      {facturas && facturas.length > 0 && (
        <div className="grid grid-3" style={{ marginBottom: 18 }}>
          <div className="card card-pad"><div className="stat-label">Comprobantes</div><div className="stat-value">{facturas.length}</div></div>
          <div className="card card-pad"><div className="stat-label">Total facturado</div><div className="stat-value">{money(totalFacturado)}</div></div>
          <div className="card card-pad"><div className="stat-label">Entorno</div><div className="stat-value" style={{ fontSize: 18 }}>{facturas[0]?.environment === 'prod' ? 'Producción' : 'Prueba (dev)'}</div></div>
        </div>
      )}

      <div className="card">
        {facturas === null ? (
          <div className="empty">Cargando…</div>
        ) : facturas.length === 0 ? (
          <div className="empty">Todavía no emitiste comprobantes. Andá a <b>Facturar</b> para hacer el primero.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Comprobante</th><th>Fecha</th><th>CAE</th>
                <th className="num">Neto</th><th className="num">IVA</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>
                    {CBTE[f.cbte_tipo] || `Tipo ${f.cbte_tipo}`}
                    <div className="muted mono" style={{ fontSize: 12, fontWeight: 400 }}>
                      {String(f.punto_venta).padStart(4, '0')}-{String(f.cbte_nro).padStart(8, '0')}
                    </div>
                  </td>
                  <td className="mono">{new Date(f.created_at).toLocaleDateString('es-AR')}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{f.cae}<div className="muted">vto {fechaAfip(f.cae_vto)}</div></td>
                  <td className="num mono">{money(f.imp_neto)}</td>
                  <td className="num mono">{f.imp_iva > 0 ? money(f.imp_iva) : '—'}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{money(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
