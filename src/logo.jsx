import React from 'react';

// Logo del Laboratorio Viora recreado como SVG inline.
// - variant: 'default' (claro) para fondos claros, 'light' para fondos oscuros
//   (el texto principal pasa a blanco y el label "LABORATORIO" a crema).
// - size: 'sm' | 'md' | 'lg' controla alto/ancho del bloque.
export function VioraLogo({ variant = 'default', size = 'md', className = '' }) {
  const sizes = {
    sm: { w: 140, h: 70 },
    md: { w: 260, h: 140 },
    lg: { w: 360, h: 190 },
    xl: { w: 480, h: 250 },
  };
  const { w, h } = sizes[size] || sizes.md;
  const arcGradientId = `viora-arc-${variant}-${size}`;
  const starGradientId = `viora-star-${variant}-${size}`;
  const textMain = variant === 'light' ? '#ffffff' : '#111111';
  const textLabel = variant === 'light' ? '#f5e9d6' : '#6b4a2a';
  return (
    <svg
      viewBox="0 0 400 200"
      className={className}
      width={w}
      height={h}
      role="img"
      aria-label="Laboratorio Viora"
    >
      <defs>
        <linearGradient id={arcGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#e9c99d" />
          <stop offset="40%" stopColor="#c39866" />
          <stop offset="70%" stopColor="#b8895a" />
          <stop offset="100%" stopColor="#e9c99d" />
        </linearGradient>
        <linearGradient id={starGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e9c99d" />
          <stop offset="100%" stopColor="#b8895a" />
        </linearGradient>
      </defs>
      {/* Arco elíptico dorado (casi completo, con una sutil apertura a la derecha) */}
      <ellipse
        cx="200" cy="100" rx="170" ry="68"
        fill="none"
        stroke={`url(#${arcGradientId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeDasharray="820 40"
        strokeDashoffset="-45"
      />
      {/* Estrellas decorativas arriba a la derecha */}
      <g fill={`url(#${starGradientId})`}>
        <path d="M 350 38 L 352 48 L 362 50 L 352 52 L 350 62 L 348 52 L 338 50 L 348 48 Z" />
        <path d="M 372 58 L 373.5 63 L 378.5 64 L 373.5 65 L 372 70 L 370.5 65 L 365.5 64 L 370.5 63 Z" />
        <path d="M 360 70 L 361 74 L 365 75 L 361 76 L 360 80 L 359 76 L 355 75 L 359 74 Z" />
      </g>
      {/* "LABORATORIO" */}
      <text
        x="200" y="76" textAnchor="middle"
        fontFamily="'Montserrat', 'Helvetica Neue', Arial, sans-serif"
        fontSize="18"
        fontWeight="500"
        letterSpacing="5.5"
        fill={textLabel}
      >
        LABORATORIO
      </text>
      {/* "Viora" cursivo */}
      <text
        x="200" y="150" textAnchor="middle"
        fontFamily="'Allura', 'Brush Script MT', 'Segoe Script', cursive"
        fontSize="110"
        fontStyle="italic"
        fill={textMain}
      >
        Viora
      </text>
    </svg>
  );
}

// Monograma super-compacto (sólo la "V" dorada cursiva) para espacios estrechos
// como el sidebar colapsado o el favicon.
export function VioraMark({ className = '', size = 40 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label="Viora">
      <defs>
        <linearGradient id="viora-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9c99d" />
          <stop offset=".5" stopColor="#b8895a" />
          <stop offset="1" stopColor="#d6b084" />
        </linearGradient>
      </defs>
      <text
        x="50" y="78" textAnchor="middle"
        fontFamily="'Allura', 'Brush Script MT', cursive"
        fontSize="90"
        fontStyle="italic"
        fill="url(#viora-mark-g)"
      >
        V
      </text>
    </svg>
  );
}
