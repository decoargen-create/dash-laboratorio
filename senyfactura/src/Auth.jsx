import { useState } from 'react'
import { supabase } from './supabase.js'

export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr(''); setOk(''); setBusy(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setOk('Cuenta creada. Si pide confirmación, revisá tu mail; sino ya podés entrar.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e2) {
      setErr(traducir(e2.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card card-pad">
        <div className="auth-brand">
          <div className="brand-logo">S</div>
          <div className="brand-name">SenyFactura</div>
        </div>

        <div className="tabs">
          <button className={`tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Ingresar</button>
          <button className={`tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => setMode('signup')}>Crear cuenta</button>
        </div>

        {err && <div className="msg msg-err">{err}</div>}
        {ok && <div className="msg msg-ok">{ok}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Un momento…' : mode === 'signup' ? 'Crear mi cuenta' : 'Ingresar'}
          </button>
        </form>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          Facturá tus ventas de Mercado Libre, Shopify y Tienda Nube en un solo lugar.
        </p>
      </div>
    </div>
  )
}

function traducir(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'Email o contraseña incorrectos.'
  if (m.includes('already registered')) return 'Ese email ya tiene cuenta. Probá ingresar.'
  if (m.includes('password')) return 'La contraseña debe tener al menos 6 caracteres.'
  return msg
}
