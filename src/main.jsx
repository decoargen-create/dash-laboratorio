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
// pantalla en vez de una página en blanco. Exponemos el stack trace inline
// (visible sin expandir) y un botón para copiarlo al portapapeles para
// debug rápido. También ofrece "Limpiar localStorage" — Viora vive en
// IndexedDB así que ese reset no afecta los datos productivos.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null, copied: false };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { this.setState({ err, info }); console.error('[ErrorBoundary]', err, info); }
  copyError = () => {
    const msg = this.state.err?.message || String(this.state.err);
    const stack = this.state.err?.stack || '';
    const componentStack = this.state.info?.componentStack || '';
    const text = `${msg}\n\nStack:\n${stack}\n\nComponent stack:${componentStack}`;
    navigator.clipboard?.writeText(text).then(
      () => { this.setState({ copied: true }); setTimeout(() => this.setState({ copied: false }), 2000); },
      () => {}
    );
  };
  render() {
    if (this.state.err) {
      const msg = this.state.err?.message || String(this.state.err);
      const stack = this.state.err?.stack || '';
      const componentStack = this.state.info?.componentStack || '';
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif',
          background: 'linear-gradient(135deg, #fdf2f8, #fff1f2)', color: '#1f2937',
        }}>
          <div style={{ maxWidth: 720, width: '100%', background: '#fff', borderRadius: 16,
            padding: 32, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            border: '1px solid #fce7f3' }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#9f1239' }}>Ups, hubo un error</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#4b5563' }}>
              La app crasheó. El stack trace está abajo — copialo y pasámelo para que pueda arreglarlo.
            </p>
            <div style={{
              marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 8, fontSize: 12, color: '#7f1d1d', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              wordBreak: 'break-word', whiteSpace: 'pre-wrap',
            }}>
              <strong>{msg}</strong>
            </div>
            <pre style={{
              marginTop: 8, padding: 12, background: '#f9fafb', borderRadius: 8,
              overflow: 'auto', maxHeight: 280, fontSize: 11, whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', color: '#374151',
              border: '1px solid #e5e7eb',
            }}>{stack}{componentStack ? `\n\nComponent stack:${componentStack}` : ''}</pre>
            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={this.copyError}
                style={{
                  padding: '10px 18px', background: this.state.copied ? '#10b981' : '#1f2937',
                  color: 'white', border: 'none', borderRadius: 8, fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                {this.state.copied ? '✓ Copiado' : '📋 Copiar error'}
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '10px 18px', background: '#f3f4f6', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 8, fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Reintentar
              </button>
              <button
                onClick={() => {
                  // Limpiamos solo localStorage. Viora vive en IndexedDB y no se toca.
                  try { localStorage.clear(); } catch {}
                  if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
                  }
                  window.location.href = '/acceso';
                }}
                style={{
                  padding: '10px 18px', background: 'linear-gradient(135deg, #9f1239, #e11d48)',
                  color: 'white', border: 'none', borderRadius: 8, fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                }}
                title="Borra solo el state de Marketing/Senydrop. Los datos de Lab Viora viven en IndexedDB y no se tocan."
              >
                Limpiar dev y reiniciar
              </button>
            </div>
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
