import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Query param especial para reset: si entrás con ?reset=1 (o /acceso?reset=1)
// limpiamos TODO el localStorage y recargamos. Útil cuando el PWA quedó con
// state viejo incompatible y el user no puede llegar al botón de reset.
if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('reset') === '1') {
  try { localStorage.clear(); } catch {}
  // También intentamos desregistrar service workers así se toma el código fresh.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('reset');
  url.searchParams.set('r', Date.now().toString()); // cache buster en la URL
  window.location.replace(url.toString());
}

// ErrorBoundary global: si algún componente crashea, mostramos el error en
// pantalla en vez de una página en blanco. También ofrece un botón para
// limpiar localStorage en caso de state corrupto o incompatible.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { this.setState({ err, info }); console.error('[ErrorBoundary]', err, info); }
  render() {
    if (this.state.err) {
      const msg = this.state.err?.message || String(this.state.err);
      const stack = this.state.err?.stack || '';
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif',
          background: 'linear-gradient(135deg, #fdf2f8, #fff1f2)', color: '#1f2937',
        }}>
          <div style={{ maxWidth: 560, width: '100%', background: '#fff', borderRadius: 16,
            padding: 32, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            border: '1px solid #fce7f3' }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#9f1239' }}>Ups, hubo un error</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#4b5563' }}>
              La app no pudo arrancar. Probá limpiar los datos locales:
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  try { localStorage.clear(); } catch {}
                  if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
                  }
                  window.location.href = '/acceso';
                }}
                style={{
                  padding: '10px 18px', background: 'linear-gradient(135deg, #9f1239, #e11d48)',
                  color: 'white', border: 'none', borderRadius: 8, fontWeight: 600,
                  fontSize: 14, cursor: 'pointer',
                }}
              >
                Limpiar todo y reiniciar
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 18px', background: '#f3f4f6', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 8, fontWeight: 600,
                  fontSize: 14, cursor: 'pointer',
                }}
              >
                Reintentar
              </button>
            </div>
            <details style={{ marginTop: 24, fontSize: 12, color: '#6b7280' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Detalles técnicos</summary>
              <pre style={{
                marginTop: 8, padding: 12, background: '#f9fafb', borderRadius: 8,
                overflow: 'auto', maxHeight: 280, fontSize: 11, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{msg}{stack ? `\n\n${stack}` : ''}</pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
