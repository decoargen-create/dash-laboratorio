// EmptyState reutilizable — patrón consistente para "sin items todavía".
// Icon + título + descripción + CTA principal opcional.
// Usado en: Galería sin items, Inspiración sin brands, Bandeja sin ideas, etc.

import React from 'react';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,   // { label, onClick, icon }
  secondaryAction, // { label, onClick }
  variant = 'soft', // 'soft' (dashed border) | 'ghost' (sin border)
}) {
  const containerCls = variant === 'soft'
    ? 'border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50/40 dark:bg-gray-900/30'
    : '';

  return (
    <div className={`text-center py-12 px-6 ${containerCls} animate-fade-in-up`}>
      {Icon && (
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 mb-4 text-gray-400 dark:text-gray-500">
          <Icon size={28} />
        </div>
      )}
      <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 max-w-md mx-auto leading-relaxed">{description}</p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="mt-4 inline-flex items-center gap-2">
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-gradient-to-br from-brand-500 to-brand-600 rounded-lg hover:from-brand-600 hover:to-brand-700 shadow-sm hover:shadow transition-all duration-200 hover:scale-105"
            >
              {primaryAction.icon && <primaryAction.icon size={12} />}
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
