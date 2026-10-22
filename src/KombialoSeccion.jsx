import React from 'react';
import PulpoKombi from './PulpoKombi.jsx';

// Secciones del menú de Kombialo que todavía no viven en esta plataforma
// (Finanzas, Kombi, Costos y las de Anuncios que son de ellos). Están en el
// menú para ver cómo queda la integración (prototipo E): al tocarlas se
// muestra qué hace cada una en Kombialo, sin funcionalidad.
export const SECCIONES_KOMBIALO = {
  'kb-rentabilidad':    { titulo: 'Rentabilidad', grupo: 'Finanzas', desc: 'Tu ganancia real por día: ventas menos costos de producto, envío, comisiones, impuestos y pauta.' },
  'kb-estadisticas':    { titulo: 'Estadísticas', grupo: 'Finanzas', desc: 'Ventas por hora, por canal y por producto, con la tendencia de cada uno.' },
  'kb-externa':         { titulo: 'Facturación externa', grupo: 'Finanzas', desc: 'Las ventas que no pasan por la tienda, para que sumen a la ganancia.' },
  'kb-clientes':        { titulo: 'Clientes', grupo: 'Finanzas', desc: 'Quién te compra, cuánto y cada cuánto.' },
  'kb-stock':           { titulo: 'Stock', grupo: 'Finanzas', desc: 'Cuántos días de stock te quedan por producto y qué reponer ya.' },
  'kb-bandeja':         { titulo: 'Bandeja', grupo: 'Kombi', desc: 'WhatsApp, Instagram, Facebook, email y el chat de tu web en una sola bandeja, con Kombi respondiendo.' },
  'kb-automatizaciones':{ titulo: 'Automatizaciones', grupo: 'Kombi', desc: 'Flujos, campañas de difusión y audiencias.' },
  'kb-canales':         { titulo: 'Canales', grupo: 'Kombi', desc: 'Los canales por donde Kombi atiende a tus clientes.' },
  'kb-configurar':      { titulo: 'Configurar', grupo: 'Kombi', desc: 'Identidad, conocimiento, escenarios y reglas de Kombi.' },
  'kb-ads-productos':   { titulo: 'Productos', grupo: 'Anuncios', desc: 'Los productos de tu tienda listos para anunciar.' },
  'kb-ads-copys':       { titulo: 'Copys', grupo: 'Anuncios', desc: 'Textos para tus anuncios.' },
  'kb-ads-carga':       { titulo: 'Nueva carga', grupo: 'Anuncios', desc: 'Subir anuncios nuevos a Meta.' },
  'kb-ads-admin':       { titulo: 'Administrador', grupo: 'Anuncios', desc: 'Tus campañas de Meta, con la ganancia real de cada una.' },
  'kb-ads-auto':        { titulo: 'Automatizaciones', grupo: 'Anuncios', desc: 'Reglas automáticas sobre tus campañas.' },
  'kb-costos':          { titulo: 'Costos', grupo: null, desc: 'Lo que te cuesta cada producto y los gastos fijos del negocio.' },
};

export default function KombialoSeccion({ seccion }) {
  const s = SECCIONES_KOMBIALO[seccion];
  if (!s) return null;
  return (
    <div className="p-4 md:p-8">
      <div className="max-w-xl mx-auto mt-6 md:mt-12 rounded-2xl border border-[rgba(160,160,220,0.1)] p-8 text-center flex flex-col items-center gap-3"
        style={{ background: 'linear-gradient(180deg, #171726, #12121c)' }}>
        <PulpoKombi size={80} />
        <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-gray-400">{s.grupo ? `${s.grupo} · ` : ''}Kombialo</p>
        <h2 className="text-2xl font-extrabold tracking-tight text-gray-100">{s.titulo}</h2>
        <p className="text-sm text-gray-400 leading-relaxed max-w-md">{s.desc}</p>
        <p className="text-xs text-gray-500 mt-2">Esta sección vive en Kombialo. Cuando se unan las dos plataformas, la vas a ver acá.</p>
      </div>
    </div>
  );
}
