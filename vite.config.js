import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
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
    plugins: [react(), apiDevPlugin(env)],
  }
})
