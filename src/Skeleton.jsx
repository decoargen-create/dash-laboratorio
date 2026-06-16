// Skeleton loaders — shimmer animation para loading states. Mucho más
// profesional que "Cargando…" texto plano.

import React from 'react';

// Skeleton genérico — cualquier shape via className. Usa la clase
// global `shimmer-skeleton` (definida en index.css) que tiene un
// gradient diagonal en loop infinito — más rico que el sweep simple.
export function Skeleton({ className = '', style }) {
  return (
    <div
      className={`shimmer-skeleton rounded ${className}`}
      style={style}
    />
  );
}

// Skeleton para un thumb cuadrado de galería / inspiración.
export function SkeletonThumb({ size = 'aspect-square' }) {
  return (
    <Skeleton className={`${size} rounded-lg`} />
  );
}

// Skeleton para una row de lista (avatar + título + meta).
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-2.5 p-2">
      <Skeleton className="w-7 h-7 rounded-full shrink-0" />
      <Skeleton className="w-14 h-14 rounded shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2 w-1/2" />
        <Skeleton className="h-2 w-1/3" />
      </div>
    </div>
  );
}

// Grid de N skeleton thumbs para loading de galería.
export function SkeletonGrid({ count = 8, cols = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' }) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonThumb key={i} />
      ))}
    </div>
  );
}
