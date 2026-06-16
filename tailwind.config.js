/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta de marca — definida como variables CSS para poder
        // re-tematizarla en runtime desde el panel de Apariencia (el user
        // elige el color de acento de toda la app). Los valores default
        // (dorado Viora) viven en index.css :root. Los colores SEMÁNTICOS
        // (emerald=éxito, red=error, amber=warning) se mantienen aparte.
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.95)', opacity: '0.7' },
          '50%': { transform: 'scale(1.05)', opacity: '0.4' },
          '100%': { transform: 'scale(0.95)', opacity: '0.7' },
        },
        'glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(195, 152, 102, 0.4)' },
          '50%': { boxShadow: '0 0 16px 4px rgba(195, 152, 102, 0.1)' },
        },
        // Mesh gradient drift — el fondo decorativo "respira" lentamente.
        // 30s para que sea casi imperceptible pero le da sensación de vida.
        'mesh-drift': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(2%, -3%) scale(1.05)' },
          '66%': { transform: 'translate(-2%, 2%) scale(0.97)' },
        },
        // Counter pop — para los contadores animados al cargar.
        'counter-pop': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.92)' },
          '60%': { opacity: '1', transform: 'translateY(-2px) scale(1.04)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Section enter — page transition al cambiar de sección.
        'section-enter': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in-down': 'fade-in-down 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'shimmer': 'shimmer 2.5s linear infinite',
        'pulse-ring': 'pulse-ring 2.5s ease-in-out infinite',
        'glow': 'glow 3s ease-in-out infinite',
        'mesh-drift': 'mesh-drift 30s ease-in-out infinite',
        'counter-pop': 'counter-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'section-enter': 'section-enter 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        // Glow del brand para CTAs (acento fluorescente sutil).
        'brand-glow': '0 0 0 1px rgb(var(--brand-500) / 0.4), 0 8px 24px -4px rgb(var(--brand-500) / 0.35)',
        'brand-glow-lg': '0 0 0 1px rgb(var(--brand-500) / 0.5), 0 12px 40px -8px rgb(var(--brand-500) / 0.5)',
      },
    },
  },
  plugins: [],
}
