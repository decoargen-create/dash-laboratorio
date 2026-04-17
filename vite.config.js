import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

// Plugin de Vite que, en modo dev, mapea /api/<nombre> al archivo api/<nombre>.js
// Así el chatbot funciona con `npm run dev` sin necesitar `vercel dev`.
// En build de producción, Vercel detecta automáticamente la carpeta api/
// y la expone como serverless functions, ignorando este plugin.
function apiDevPlugin(env) {
  return {
    name: 'api-dev',
    configureServer(server) {
      // Exponemos las env vars del .env al process.env para los handlers.
      // Así `process.env.ANTHROPIC_API_KEY` funciona en dev como en prod.
      for (const k of Object.keys(env)) {
        if (k.startsWith('VITE_')) continue
        if (process.env[k] == null) process.env[k] = env[k]
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const urlPath = req.url.split('?')[0]
        const name = urlPath.replace(/^\/api\//, '').replace(/\/$/, '')
        const filePath = path.resolve(process.cwd(), 'api', `${name}.js`)
        if (!fs.existsSync(filePath)) return next()

        try {
          // Leemos el body antes de invocar al handler.
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString('utf-8')
          req.body = raw ? (safeJSON(raw) ?? raw) : undefined

          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          const handler = mod.default
          if (typeof handler !== 'function') {
            res.statusCode = 500
            res.end('API handler inválido')
            return
          }
          await handler(req, res)
        } catch (err) {
          console.error('[api-dev]', err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(err?.message || err) }))
          } else {
            res.end()
          }
        }
      })
    },
  }
}

function safeJSON(str) {
  try { return JSON.parse(str) } catch { return null }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      apiDevPlugin(env),
      VitePWA({
        registerType: 'autoUpdate',
        // Excluimos /api/* del service worker para que los endpoints siempre
        // vayan a la red (no tiene sentido cachear respuestas de Claude).
        workbox: {
          navigateFallbackDenylist: [/^\/api\//],
          // Los WASM y modelos de @imgly/background-removal son gigantes y se
          // cargan bajo demanda (dynamic import + fetch a CDN) — no tiene
          // sentido meterlos en el precache del PWA.
          globIgnores: ['**/ort-wasm-*.wasm'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB de margen
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        manifest: {
          name: 'Laboratorio Viora',
          short_name: 'Viora',
          description: 'Panel de gestión del Laboratorio Viora — órdenes, clientes, producción, comisiones y pagos.',
          theme_color: '#4a0f22',
          background_color: '#0d0d0d',
          display: 'standalone',
          orientation: 'portrait-primary',
          lang: 'es-AR',
          start_url: '/acceso',
          icons: [
            { src: '/viora-favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/viora-pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/viora-pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
      }),
    ],
  }
})
