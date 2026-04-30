// Pipeline de generación de documentación de marketing.
//
// POST /api/marketing/generate
// Body: { productoUrl, productoNombre, descripcion, landingContent?: string }
//
// Ejecuta 4 pasos secuencialmente llamando a Claude:
//   1. Research Doc (Sonnet por profundidad)
//   2. Avatar Sheet (Haiku)
//   3. Offer Brief (Haiku)
//   4. Necessary Beliefs (Haiku)
//
// Responde con Server-Sent Events (SSE) para que el frontend muestre progreso
// en vivo. Cada paso emite un evento { type: 'step-start' | 'step-done', ... }.
//
// El landing page se scrapea internamente (reusando la lógica de
// scrape-product.js) a menos que el front ya mande el HTML.

import Anthropic from '@anthropic-ai/sdk';
import {
  RESEARCH_SYSTEM, AVATAR_SYSTEM, AVATAR_TEMPLATE,
  OFFER_BRIEF_SYSTEM, OFFER_BRIEF_TEMPLATE,
  BELIEFS_SYSTEM, PIPELINE_STEPS,
} from './_lib.js';
import { anthropicCost } from './_costs.js';

const MODEL_SONNET = 'claude-sonnet-4-5';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const FETCH_TIMEOUT_MS = 15000;

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

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// Scrapea la landing del producto si el front no mandó el HTML.
async function scrapeLanding(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ];
    for (const ua of uas) {
      try {
        const resp = await fetchWithTimeout(parsed.toString(), {
          headers: { 'User-Agent': ua, 'Accept': 'text/html', 'Accept-Language': 'es-AR,es;q=0.9,en;q=0.5' },
        });
        if (resp.ok) return await resp.text();
      } catch {}
    }
  } catch {}
  return null;
}

// Extrae meta tags del HTML.
function extractMeta(html, keys) {
  if (!html) return null;
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return m[1].trim();
    }
  }
  return null;
}

function extractTitleTag(html) {
  if (!html) return null;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

// Extrae texto "legible" del HTML para darle a Claude (sin scripts/styles/tags).
function stripHtml(html, limit = 12000) {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:br|p|h[1-6]|li|div|article|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, limit);
}

// Helpers SSE.
function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
function sseEnd(res) { res.end(); }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY no configurada' }));
    return;
  }

  const body = await readBody(req);
  const { productoUrl, productoNombre, descripcion: descripcionManual, landingContent, memoria } = body || {};
  if (!productoNombre || typeof productoNombre !== 'string') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Falta productoNombre' }));
    return;
  }

  // Setup SSE.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const client = new Anthropic({ apiKey });

  // Resultados de cada paso — se acumulan y pasan al siguiente.
  const outputs = { research: '', avatar: '', offerBrief: '', beliefs: '', resumenEjecutivo: '' };
  let descripcion = (descripcionManual && typeof descripcionManual === 'string') ? descripcionManual.trim() : '';
  let ogImage = null;
  // Acumulador del costo total — emitido en el evento `complete` y también
  // por step para que el cliente pueda mostrar gasto en vivo. Antes este
  // endpoint no devolvía cost → la primera corrida del pipeline (que es la
  // más cara: research Sonnet + 4 calls Haiku) salía con $0.0000 en el
  // display y en runHistory subestimaba el gasto en ~50-70%.
  let totalAnthropic = 0;
  const trackStepCost = (usage, model, key, label) => {
    const c = anthropicCost(usage, model);
    totalAnthropic += c;
    sseWrite(res, { type: 'step-cost', key, label, cost: { anthropic: c, total: c } });
    return c;
  };

  try {
    // ------ Pre-paso: scrape de la landing ------
    let landingText = landingContent && typeof landingContent === 'string' ? landingContent : '';
    let landingHtml = '';
    if (!landingText && productoUrl) {
      sseWrite(res, { type: 'info', message: 'Scrapeando landing page…' });
      landingHtml = await scrapeLanding(productoUrl) || '';
      landingText = stripHtml(landingHtml, 12000);
      ogImage = extractMeta(landingHtml, ['og:image', 'og:image:secure_url', 'twitter:image']);
      const ogDesc = extractMeta(landingHtml, ['og:description', 'twitter:description', 'description']);
      if (!descripcion && ogDesc) descripcion = ogDesc; // seed inicial si no vino
      sseWrite(res, { type: 'info', message: landingText ? `Landing obtenida (${landingText.length} chars)` : 'No se pudo acceder a la landing' });
      if (ogImage) sseWrite(res, { type: 'og-image', url: ogImage });
    }

    // Auto-generar descripción si todavía no la tenemos (ni manual ni og:desc).
    // Usamos una mini-llamada a Haiku para sacarla del contexto scrapeado.
    if (!descripcion && (landingText || productoNombre)) {
      sseWrite(res, { type: 'info', message: 'Generando descripción automática del producto…' });
      try {
        const descResp = await client.messages.create({
          model: MODEL_HAIKU,
          max_tokens: 256,
          system: [{ type: 'text', text: 'Sos un asistente que resume productos de ecommerce. Recibís el nombre y un fragmento de la landing. Devolvés una sola oración describiendo qué vende el producto y a quién va dirigido. Tono neutro, castellano rioplatense, máximo 240 caracteres. Sin intro, sin preámbulo.' }],
          messages: [{ role: 'user', content: `Nombre: ${productoNombre}\n\nLanding:\n${landingText.slice(0, 3000) || '(sin landing)'}` }],
        });
        descripcion = descResp.content?.[0]?.type === 'text' ? descResp.content[0].text.trim() : '';
        trackStepCost(descResp.usage, MODEL_HAIKU, 'descripcion-auto', 'Descripción auto');
        if (descripcion) sseWrite(res, { type: 'info', message: `Descripción: ${descripcion.slice(0, 120)}${descripcion.length > 120 ? '…' : ''}` });
      } catch (err) {
        console.error('auto-descripcion error:', err?.message);
      }
    }

    const memoriaBlock = memoria && typeof memoria === 'object'
      ? `\n---MEMORIA ACUMULADA DEL PRODUCTO (usá esta info como contexto previo)---\n${JSON.stringify(memoria, null, 2)}\n---FIN MEMORIA---\n`
      : '';

    const productContext = `
Nombre del producto: ${productoNombre}
URL: ${productoUrl || '(no suministrada)'}
Descripción: ${descripcion || '(no disponible)'}
${landingText ? `\n---LANDING PAGE (texto extraído)---\n${landingText}\n---FIN LANDING---\n` : ''}${memoriaBlock}
`.trim();

    // ------ Paso 1: Research ------
    sseWrite(res, { type: 'step-start', key: 'research', label: 'Research Doc' });
    const researchResp = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 8192,
      system: [{ type: 'text', text: RESEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Producto a investigar:\n\n${productContext}\n\nGenerá el DOCUMENTO DE RESEARCH siguiendo la estructura de 12 secciones. Mínimo 2500 palabras. En castellano rioplatense.`,
      }],
    });
    outputs.research = researchResp.content?.[0]?.type === 'text' ? researchResp.content[0].text : '';
    trackStepCost(researchResp.usage, MODEL_SONNET, 'research', 'Research Doc');
    sseWrite(res, { type: 'step-done', key: 'research', label: 'Research Doc', content: outputs.research });

    // ------ Paso 2: Avatar ------
    sseWrite(res, { type: 'step-start', key: 'avatar', label: 'Avatar Sheet' });
    const avatarResp = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 4096,
      system: [{ type: 'text', text: AVATAR_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Research doc del producto:\n\n${outputs.research}\n\n---TEMPLATE DE AVATAR SHEET A COMPLETAR---\n\n${AVATAR_TEMPLATE}\n\nCompletá cada sección del template con información específica basada en el research. Devolvé el markdown completo.`,
      }],
    });
    outputs.avatar = avatarResp.content?.[0]?.type === 'text' ? avatarResp.content[0].text : '';
    trackStepCost(avatarResp.usage, MODEL_HAIKU, 'avatar', 'Avatar Sheet');
    sseWrite(res, { type: 'step-done', key: 'avatar', label: 'Avatar Sheet', content: outputs.avatar });

    // ------ Paso 3: Offer Brief ------
    sseWrite(res, { type: 'step-start', key: 'offerBrief', label: 'Offer Brief' });
    const offerResp = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 4096,
      system: [{ type: 'text', text: OFFER_BRIEF_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Research doc:\n\n${outputs.research}\n\n---AVATAR SHEET---\n\n${outputs.avatar}\n\n---TEMPLATE DE OFFER BRIEF---\n\n${OFFER_BRIEF_TEMPLATE}\n\nCompletá cada sección del offer brief. Dedicale pensamiento a Big Idea, UMP/UMS, Headlines y Belief Chains.`,
      }],
    });
    outputs.offerBrief = offerResp.content?.[0]?.type === 'text' ? offerResp.content[0].text : '';
    trackStepCost(offerResp.usage, MODEL_HAIKU, 'offerBrief', 'Offer Brief');
    sseWrite(res, { type: 'step-done', key: 'offerBrief', label: 'Offer Brief', content: outputs.offerBrief });

    // ------ Paso 4: Beliefs ------
    sseWrite(res, { type: 'step-start', key: 'beliefs', label: 'Creencias necesarias' });
    const beliefsResp = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 2048,
      system: [{ type: 'text', text: BELIEFS_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Research doc:\n\n${outputs.research}\n\n---AVATAR---\n\n${outputs.avatar}\n\n---OFFER BRIEF---\n\n${outputs.offerBrief}\n\nGenerá las 6 creencias necesarias.`,
      }],
    });
    outputs.beliefs = beliefsResp.content?.[0]?.type === 'text' ? beliefsResp.content[0].text : '';
    trackStepCost(beliefsResp.usage, MODEL_HAIKU, 'beliefs', 'Creencias necesarias');
    sseWrite(res, { type: 'step-done', key: 'beliefs', label: 'Creencias necesarias', content: outputs.beliefs });

    // ------ Paso 5 (bonus): Resumen ejecutivo ------
    // Síntesis 2-3 líneas de TODO lo generado, para mostrar en la cabecera
    // del expediente del producto. Útil para contextos futuros (ej: al
    // regenerar con memoria, este resumen es el "ancla" rápida).
    sseWrite(res, { type: 'step-start', key: 'resumenEjecutivo', label: 'Resumen ejecutivo' });
    try {
      const resumenResp = await client.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 512,
        system: [{ type: 'text', text: 'Sos un estratega de marketing. Recibís 4 documentos de un producto (research, avatar, offer brief, creencias). Devolvés un RESUMEN EJECUTIVO de 2-3 oraciones (máx 500 chars) que capture: qué vende el producto, a quién va dirigido, y el ángulo estratégico central (Big Idea). Castellano rioplatense. Sin preámbulo, sin markdown.' }],
        messages: [{ role: 'user', content: `RESEARCH:\n${outputs.research.slice(0, 3000)}\n\nAVATAR:\n${outputs.avatar.slice(0, 1500)}\n\nOFFER BRIEF:\n${outputs.offerBrief.slice(0, 1500)}\n\nCREENCIAS:\n${outputs.beliefs.slice(0, 800)}` }],
      });
      outputs.resumenEjecutivo = resumenResp.content?.[0]?.type === 'text' ? resumenResp.content[0].text.trim() : '';
      trackStepCost(resumenResp.usage, MODEL_HAIKU, 'resumenEjecutivo', 'Resumen ejecutivo');
    } catch (err) {
      console.error('resumen-ejecutivo error:', err?.message);
    }
    sseWrite(res, { type: 'step-done', key: 'resumenEjecutivo', label: 'Resumen ejecutivo', content: outputs.resumenEjecutivo });

    // ------ Fin ------
    sseWrite(res, {
      type: 'complete',
      outputs,
      descripcion,
      ogImage,
      // Cost total del run de docs — el cliente lo suma a `runCost`
      // (display en vivo) y `acumuladoLocal` (persistido en runHistory).
      cost: { anthropic: Math.round(totalAnthropic * 10000) / 10000, total: Math.round(totalAnthropic * 10000) / 10000 },
    });
    sseEnd(res);
  } catch (err) {
    console.error('marketing/generate error:', err);
    sseWrite(res, { type: 'error', error: err?.message || 'Error desconocido' });
    sseEnd(res);
  }
}
