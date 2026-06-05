// Endpoint del módulo Consultoría. Recibe la transcripción cruda de una
// reunión de consultoría y devuelve un acta accionable en JSON, lista para
// reenviar al cliente.
//
//   POST { transcript, client, date }
//   → { resumen, temas[], diagnostico[], tareas[], plan_accion[], notas_internas[] }
//
// La API key vive sólo en el server (process.env.ANTHROPIC_API_KEY): el
// frontend pega a /api/acta, nunca a Anthropic directo. La generación vive en
// api/actas/_lib.js (compartida con el sync automático desde Drive).

import { generarActa } from './actas/_lib.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const body = await readBody(req);
  const { transcript, client, date } = body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 40) {
    return respondJSON(res, 400, { error: 'Falta la transcripción (mínimo ~40 caracteres de texto real).' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada en el servidor.' });
  }

  try {
    const acta = await generarActa({ transcript, client, date });
    return respondJSON(res, 200, acta);
  } catch (err) {
    console.error('acta: error generando:', err?.message || err);
    return respondJSON(res, 500, { error: `No pude generar el acta: ${err?.message || 'error de la API de Claude'}` });
  }
}
