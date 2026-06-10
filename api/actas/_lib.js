// Lógica compartida del módulo Consultoría:
//   - generarActa(): llama a Claude y devuelve el acta normalizada.
//   - parseTranscriptName(): saca cliente + fecha del nombre del archivo de Drive.
//   - runSync(): vigila la carpeta de Drive, genera las actas faltantes y las
//     guarda como JSON en una subcarpeta. Idempotente.

import Anthropic from '@anthropic-ai/sdk';
import {
  driveConfigured, getAccessToken, driveList, driveExportDoc,
  driveGetJson, driveCreateJson, driveEnsureFolder,
} from './_google.js';

export const ACTA_SYSTEM = `Sos el asistente de un consultor argentino de e-commerce (perfil operador, no gurú). Recibís la transcripción cruda de una reunión de consultoría con un cliente y devolvés un acta accionable que el consultor le va a reenviar al cliente.

REGLAS DE TONO:
- Español rioplatense, profesional pero cercano y directo. Nada de chamuyo motivacional ni lenguaje de gurú.
- Concreto y operativo. Cada tarea tiene que ser algo que alguien pueda agarrar y hacer.
- Inferí el responsable de cada tarea desde la transcripción (Cliente / Consultor / Equipo / Proveedor, o el nombre si aparece). Si no queda claro, poné "Cliente".
- Si no hay un plazo mencionado, poné "A definir".
- No inventes datos que no estén en la transcripción. Si algo es ambiguo, dejalo en notas_internas.

DEVOLVÉS ÚNICAMENTE un objeto JSON válido, sin markdown, sin backticks, sin texto antes ni después, con esta forma exacta:
{
  "resumen": "2 a 4 frases que resuman de qué se habló y a qué se llegó",
  "temas": ["tema tratado 1", "tema tratado 2"],
  "diagnostico": [{"titulo": "qué observamos", "detalle": "explicación corta y concreta"}],
  "tareas": [{"tarea": "acción concreta", "responsable": "Cliente|Consultor|Equipo|<nombre>", "prioridad": "Alta|Media|Baja", "plazo": "fecha o 'A definir'"}],
  "plan_accion": [{"paso": "título del paso ordenado", "detalle": "qué implica"}],
  "notas_internas": ["nota privada para el consultor que NO va al cliente"]
}`;

// Llama a Claude y devuelve el acta ya normalizada (nunca rompe por campo faltante).
export async function generarActa({ transcript, client, date, apiKey, model }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada');

  const userMsg = `Cliente: ${client || 'Sin especificar'}
Fecha: ${date || 'Sin especificar'}

TRANSCRIPCIÓN DE LA REUNIÓN:
"""
${transcript}
"""`;

  const anthropic = new Anthropic({ apiKey: key });
  const message = await anthropic.messages.create({
    model: model || 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: [{ type: 'text', text: ACTA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });

  const raw = (message.content || [])
    .filter(b => b?.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let acta;
  try { acta = JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { acta = JSON.parse(m[0]); } catch {} }
  }
  if (!acta || typeof acta !== 'object') {
    throw new Error('El modelo no devolvió un JSON válido');
  }

  return {
    resumen: typeof acta.resumen === 'string' ? acta.resumen : '',
    temas: Array.isArray(acta.temas) ? acta.temas : [],
    diagnostico: Array.isArray(acta.diagnostico) ? acta.diagnostico : [],
    tareas: Array.isArray(acta.tareas) ? acta.tareas : [],
    plan_accion: Array.isArray(acta.plan_accion) ? acta.plan_accion : [],
    notas_internas: Array.isArray(acta.notas_internas) ? acta.notas_internas : [],
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fechaEsAR(y, m, d) {
  const mes = MESES[Number(m) - 1] || '';
  return `${String(Number(d)).padStart(2, '0')} de ${mes} de ${y}`;
}

// Saca { client, date } del nombre de un archivo de transcripción de Meet.
// Devuelve null si NO es una consultoría 1-a-1 con cliente identificable
// (reuniones internas, revisiones generales o nombres con código de Meet).
export function parseTranscriptName(name) {
  if (!name) return null;
  if (/revisi[oó]n semanal|senydrop|general/i.test(name)) return null;

  let client = null;
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) {
    client = paren[1].trim();
  } else {
    const m = name.match(/1\s*a\s*1\s*[-–]\s*([^-–]+?)\s*[-–]/i);
    if (m) client = m[1].trim();
  }
  if (!client) return null;
  // Descartar cuando lo que hay entre paréntesis es una fecha/hora (reuniones
  // con código de Meet tipo "xmp-hfcp-pyd (2026-06-02 16:16 GMT-3)"), no un
  // cliente. Un nombre real no tiene un año ni "GMT", y tiene letras.
  if (/\d{4}/.test(client) || /gmt/i.test(client)) return null;
  if (!/[a-záéíóúñ]/i.test(client)) return null;
  // Códigos de Meet tipo xxx-xxxx-xxx.
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(client)) return null;

  let date = '';
  const d = name.match(/(\d{4})[/.-](\d{2})[/.-](\d{2})/);
  if (d) date = fechaEsAR(d[1], d[2], d[3]);
  return { client, date };
}

// Vigila la carpeta, genera las actas faltantes y devuelve todas las actas.
// maxGenerate acota cuántas genera por corrida (para no exceder el timeout).
// model: por defecto Haiku (rápido) para que cada generación entre cómoda en
// el límite de tiempo de la función; las actas manuales usan Sonnet.
export async function runSync({ maxGenerate = 5, model = 'claude-haiku-4-5-20251001' } = {}) {
  if (!driveConfigured()) {
    return { configured: false, error: 'Drive no está configurado (falta GOOGLE_SERVICE_ACCOUNT_JSON o DRIVE_TRANSCRIPTS_FOLDER_ID).' };
  }
  const folderId = process.env.DRIVE_TRANSCRIPTS_FOLDER_ID;
  const token = await getAccessToken();
  const outId = await driveEnsureFolder(token, folderId, 'Actas generadas (app)');

  // Transcripciones (Google Docs con "Transcript" en el nombre).
  const tr = await driveList(token, {
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and name contains 'Transcript' and trashed=false`,
    fields: 'files(id,name,createdTime,modifiedTime)',
    pageSize: 1000,
    orderBy: 'createdTime desc',
  });
  const candidates = (tr.files || [])
    .map(f => ({ ...f, meta: parseTranscriptName(f.name) }))
    .filter(f => f.meta);

  // Actas ya generadas.
  const ex = await driveList(token, {
    q: `'${outId}' in parents and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 1000,
  });
  const fileById = new Map();
  for (const f of ex.files || []) {
    const m = f.name.match(/^acta-(.+)\.json$/);
    if (m) fileById.set(m[1], f.id);
  }

  const pending = candidates.filter(f => !fileById.has(f.id));
  let generated = 0;
  const errors = [];
  for (const f of pending) {
    if (generated >= maxGenerate) break;
    try {
      const text = await driveExportDoc(token, f.id);
      const result = await generarActa({ transcript: text, client: f.meta.client, date: f.meta.date, model });
      const record = {
        transcriptId: f.id,
        transcriptName: f.name,
        client: f.meta.client,
        date: f.meta.date,
        createdAt: Date.now(),
        result,
      };
      const created = await driveCreateJson(token, outId, `acta-${f.id}.json`, record);
      fileById.set(f.id, created.id);
      generated++;
    } catch (e) {
      console.error('[actas] no pude generar para', f.name, '-', e?.message);
      if (errors.length < 3) errors.push(`${f.meta.client}: ${e?.message || e}`);
    }
  }

  // Leemos todas las actas (en paralelo) para devolverlas al panel.
  const entries = [...fileById.entries()];
  const actas = (await Promise.all(entries.map(async ([transcriptId, fileId]) => {
    try {
      const rec = await driveGetJson(token, fileId);
      return { id: transcriptId, fileId, ...rec };
    } catch { return null; }
  }))).filter(Boolean);

  return {
    configured: true,
    generated,
    totalClientes: candidates.length,
    pending: Math.max(0, pending.length - generated),
    actas,
    errors,
  };
}
