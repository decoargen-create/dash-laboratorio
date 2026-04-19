// Generador multi-tipo de ideas creativas.
//
// POST /api/marketing/generate-ideas
// Body: {
//   producto: { nombre, descripcion, landingUrl, research?, avatar?, offerBrief? },
//   competidoresAnalisis: [
//     { competidorNombre, adId, adHeadline, adBody, analysis: {...} },
//     ...
//   ],
//   ideasExistentes: [ { titulo, angulo, tipo }, ... ],  // para que no repita
//   propiosAds?: [ { headline, body, metrics } ]  // (opcional, futuro)
// }
//
// Output: {
//   ideas: [
//     { titulo, tipo, angulo, painPoint, hook, copy, guion, formato, razonamiento },
//     ...
//   ],
//   generatedAt, model
// }
//
// Estrategia: un solo request a Claude Sonnet que devuelve 10 ideas
// clasificadas en 3 tipos (replica / diferenciacion / desde_cero).
// Iteracion requiere data de los propios ads (Meta insights) — lo agregamos
// cuando esté conectado el pull de insights.

import Anthropic from '@anthropic-ai/sdk';
import { anthropicCost } from './_costs.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT_BASE = `Sos director creativo senior de DTC cosméticos en ARGENTINA. Tu idioma es castellano RIOPLATENSE (vos, tuteo, modismos argentinos). NUNCA español de España, NUNCA neutro. Todo el copy, guiones y hooks tienen que sonar como si los hubiera escrito un publicista de Buenos Aires.

Tu proceso para generar ideas es en 2 fases:

**FASE 1 — PATTERN MINING** (hacelo mentalmente antes de generar):
Leé TODOS los ads de la competencia que te paso (pueden ser cientos). Identificá los PATRONES que se repiten entre los ganadores:
- ¿Qué hooks están usando los que llevan 20+ días? (estructura, no texto literal)
- ¿Qué ángulos emocionales repiten 2+ competidores? (→ patrón validado)
- ¿Qué formatos dominan entre los winners fuertes? (video/static/carrusel)
- ¿Qué objeciones están atajando en el copy?
- ¿Qué ofertas/ganchos monetarios usan?
Estos patrones son ORO — están validados con plata real de los competidores.

**FASE 2 — GENERACIÓN**:
Con los patrones identificados + el research doc del producto + el avatar:
- Para RÉPLICAS: tomá un patrón ganador y adaptalo a la marca del user. Referenciá en "razonamiento" qué patrón/competidor te inspiró.
- Para DIFERENCIACIÓN: buscá ángulos que NADIE en toda la lista está usando. Si 5 competidores repiten "testimonial antes/después", ESO está saturado — buscá lo contrario.
- Para DESDE CERO: salí del contexto competitivo y usá puro avatar + beliefs.

**CALIDAD > CANTIDAD.** Cada idea tiene que ser producible: el equipo agarra el guión/layout y puede ir directo a producción sin preguntar nada.

**DIVERSIDAD DE HOOKS — regla dura.** Revisá todos los hooks antes de finalizar. NO repetir el mismo template en 2+ ideas. Mezclá:
- Pregunta retórica · Dato shocking · Storytelling 1ra persona · Antes/después
- Autoridad ("mi dermatólogo me dijo") · Provocación · Instrucción · Curiosidad
Mínimo 4 arquetipos distintos en una batería.

`;

function buildTypeMix(targetCount, hasPropios) {
  if (hasPropios) {
    const replica = Math.max(1, Math.round(targetCount * 0.30));
    const iteracion = Math.max(1, Math.round(targetCount * 0.30));
    const diferenciacion = Math.max(1, Math.round(targetCount * 0.20));
    const desde_cero = Math.max(1, targetCount - replica - iteracion - diferenciacion);
    return { replica, iteracion, diferenciacion, desde_cero };
  }
  const replica = Math.max(1, Math.round(targetCount * 0.30));
  const diferenciacion = Math.max(1, Math.round(targetCount * 0.30));
  const desde_cero = Math.max(1, targetCount - replica - diferenciacion);
  return { replica, iteracion: 0, diferenciacion, desde_cero };
}

function buildMixSection(mix, formatoMix, targetCount) {
  const vPct = Math.round((formatoMix.video ?? 0.4) * 100);
  const sPct = Math.round((formatoMix.static ?? 0.6) * 100);
  const lines = [];
  lines.push(`**Target: hasta ${targetCount} ideas**, distribuidas aproximadamente así (respetá la calidad — podés devolver menos):`);
  lines.push('');
  if (mix.replica > 0) {
    lines.push(`- ~${mix.replica} tipo "replica": tomá los ángulos más fuertes de la competencia y adaptalos al producto. NO copies literal — extraé el patrón (estructura, trigger, formato) y aplícalo. En "razonamiento" indicá qué ganador te inspiró.`);
    lines.push('');
  }
  if (mix.iteracion > 0) {
    lines.push(`- ~${mix.iteracion} tipo "iteracion": variaciones de tus ads propios que mejor performan (CTR alto, spend sostenido). Cambiá hook, headline, prueba social o formato. Mantené lo que funciona, variá lo que puede estar fatigando. En "razonamiento" indicá qué ad base iterás y por qué.`);
    lines.push('');
  }
  if (mix.diferenciacion > 0) {
    lines.push(`- ~${mix.diferenciacion} tipo "diferenciacion": ángulos que NINGÚN competidor está usando. Blue ocean. Si 5 competidores repiten un ángulo, está saturado — buscá lo que falta. En "razonamiento" explicá por qué nadie lo hizo.`);
    lines.push('');
  }
  if (mix.desde_cero > 0) {
    lines.push(`- ~${mix.desde_cero} tipo "desde_cero": ángulos originales basados en producto + avatar. Diversificá pain points, triggers y beneficios.`);
    lines.push('');
  }
  lines.push(`**MIX DE FORMATO — OBLIGATORIO**: MÍNIMO ${Math.round(sPct * targetCount / 100)} ideas STATIC y MÍNIMO ${Math.round(vPct * targetCount / 100)} ideas VIDEO del total de ${targetCount}. Si la competencia es 90% video, VOS igual generás ${sPct}% static PORQUE ESO PIDIÓ EL USER. Para statics, describí layout + composición + paleta + mood. Podés incluir carruseles dentro del cupo de statics.`);
  lines.push('');
  return lines.join('\n');
}

const SHAPE_GUIDANCE = `Para devolver las ideas, llamá a la tool \`submit_ideas\` con el array completo. El API valida el schema — no vas a poder devolver basura.

**Puntos críticos del contenido**:
- variableDeTesteo: para iteraciones, identificá qué UNA cosa cambiás vs el ad base (si cambiás hook Y visual, poné "mix"). Para réplicas/diferenciaciones, la palanca central de la idea.
- testHipotesis: medible y accionable. Ej: "el hook con dato numérico va a bajar CPA vs el hook emocional genérico".
- iteracionBase: SOLO para ideas tipo "iteracion". Debe referenciar el adId exacto de un ad propio + razón con métrica concreta que justifique iterarlo.
- guion: CRÍTICO. Tiene que darle al diseñador/editor toda la info para producir sin preguntar. Video: beats numerados + duración + VO. Static: layout + paleta + mood. Carrusel: slide-by-slide.
`;

function buildSystemPrompt({ hasPropios, targetCount, formatoMix }) {
  const mix = buildTypeMix(targetCount, hasPropios);
  return SYSTEM_PROMPT_BASE + buildMixSection(mix, formatoMix, targetCount) + SHAPE_GUIDANCE;
}

// Tool schema para structured output. Forzamos a Claude a llamar esta tool
// y el API valida que matchee el schema. Adiós a parsear JSON frágil.
const SUBMIT_IDEAS_TOOL = {
  name: 'submit_ideas',
  description: 'Envía el array completo de ideas creativas generadas.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        description: 'Array de ideas. Respetá la calidad: si tenés contexto para 12 ideas buenas devolvé 12, no fuerces a 40.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Título corto, ≤ 100 chars.' },
            tipo: { type: 'string', enum: ['replica', 'iteracion', 'diferenciacion', 'desde_cero'] },
            angulo: { type: 'string' },
            painPoint: { type: 'string' },
            hook: { type: 'string', description: 'Primer frame / primeras 3 líneas. Diversificá arquetipos entre ideas.' },
            copy: { type: 'string' },
            guion: { type: 'string', description: 'Detallado según formato (video/static/carrusel).' },
            formato: { type: 'string', enum: ['video', 'static', 'carrusel'] },
            razonamiento: { type: 'string' },
            variableDeTesteo: {
              type: 'string',
              enum: ['hook', 'visual', 'cta', 'formato', 'angulo', 'audience', 'prueba_social', 'oferta', 'mix'],
            },
            testHipotesis: { type: 'string' },
            iteracionBase: {
              type: 'object',
              description: 'OBLIGATORIO solo si tipo=iteracion.',
              properties: {
                adId: { type: 'string' },
                adNombre: { type: 'string' },
                razon: { type: 'string' },
              },
            },
          },
          required: ['titulo', 'tipo', 'angulo', 'hook', 'copy', 'formato', 'razonamiento', 'variableDeTesteo', 'testHipotesis'],
        },
      },
    },
    required: ['ideas'],
  },
};

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respondJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

// Serializamos el contexto en un string estructurado y legible para Claude.
function buildContext({ producto, competidoresAnalisis, allCompAds, ideasExistentes, propiosAds }) {
  const parts = [];

  parts.push('## PRODUCTO PROPIO');
  parts.push(`Nombre: ${producto?.nombre || '(sin nombre)'}`);
  if (producto?.landingUrl) parts.push(`Landing: ${producto.landingUrl}`);
  if (producto?.descripcion) parts.push(`Descripción: ${producto.descripcion}`);
  if (producto?.resumenEjecutivo) parts.push(`\nResumen ejecutivo: ${producto.resumenEjecutivo}`);

  // Stage del prospect — determina el tipo de hook a usar.
  const stageLabels = {
    problem_aware: 'PROBLEM-AWARE — el prospect sabe que tiene el problema pero no conoce las soluciones. Los hooks deben AGITAR EL DOLOR y después dejar entrever que hay una salida. Evitar hablar del producto en los primeros 3 segundos.',
    solution_aware: 'SOLUTION-AWARE — el prospect ya conoce tipos de solución (serum, mascarillas, etc) pero no tu marca. Los hooks deben DIFERENCIARTE de las soluciones existentes: "vos probaste X, Y y Z, y acá hay un enfoque distinto".',
    product_aware: 'PRODUCT-AWARE — el prospect ya te conoce, falta decidir. Los hooks deben APILAR PRUEBA (testimonios, autoridad, data) y remover objeciones específicas.',
  };
  const stage = producto?.stage || 'problem_aware';
  parts.push(`\n**STAGE DEL PROSPECT: ${stage}**`);
  parts.push(stageLabels[stage] || stageLabels.problem_aware);

  // Research docs (Marketing.jsx los guarda en producto.docs.{research,avatar,offerBrief,beliefs})
  // Fallback a campos planos por si vienen por otro path. Pasamos el texto
  // COMPLETO — Sonnet 4.6 tiene 1M de contexto, cortar a snippets tira
  // información crítica del avatar.
  const docs = producto?.docs || {};
  const research = docs.research || producto?.research;
  const avatar = docs.avatar || producto?.avatar;
  const offerBrief = docs.offerBrief || producto?.offerBrief;
  const beliefs = docs.beliefs || producto?.beliefs;

  if (research) {
    parts.push(`\n### Research Doc (investigación profunda del avatar)\n${research}`);
  }
  if (avatar) {
    parts.push(`\n### Avatar Sheet (perfil del cliente ideal con quotes en 1ra persona)\n${avatar}`);
  }
  if (offerBrief) {
    parts.push(`\n### Offer Brief (Big Idea, UMP/UMS, objections, belief chains)\n${offerBrief}`);
  }
  if (beliefs) {
    parts.push(`\n### Creencias necesarias (las 6 "Yo creo que..." que el prospect debe adoptar antes de comprar)\n${beliefs}\n\nIMPORTANTE: cada idea debería empujar una de estas creencias. En "razonamiento" indicá cuál creencia apalanca.`);
  }

  if (!research && !avatar && !offerBrief && !beliefs) {
    parts.push(`\n⚠️ SIN RESEARCH DOC. Las ideas van a ser más genéricas. Correr el pipeline de Documentación antes daría ideas mucho más ancladas al avatar real.`);
  }

  // === SECCIÓN 1: TODOS los ads de la competencia (copy crudo) ===
  // El generador recibe CADA ad que scrapeamos — no filtramos nada.
  // Esto le da la visión completa del mercado para detectar patrones.
  if (allCompAds?.length) {
    // Agrupar por competidor para que el contexto sea legible.
    const byComp = {};
    for (const ad of allCompAds) {
      const key = ad.competidor || 'Desconocido';
      if (!byComp[key]) byComp[key] = [];
      byComp[key].push(ad);
    }

    parts.push('\n## TODOS LOS ADS DE LA COMPETENCIA (copy crudo para pattern mining)');
    parts.push(`Total: ${allCompAds.length} ads de ${Object.keys(byComp).length} competidores.`);
    parts.push(`**Tu trabajo**: leer TODOS estos ads, identificar los PATRONES que se repiten entre los ganadores (hooks, ángulos, estructura, formatos), y usarlos para generar ideas. No te limites a los 10 primeros — mirá toda la lista.`);
    parts.push('');

    for (const [compName, ads] of Object.entries(byComp)) {
      const winners = ads.filter(a => a.isWinner);
      const videoCount = ads.filter(a => a.formato === 'video').length;
      const staticCount = ads.length - videoCount;
      const maxDays = Math.max(...ads.map(a => a.daysRunning || 0), 0);
      parts.push(`\n### ${compName} (${ads.length} ads · ${winners.length} ganadores · ${staticCount} static/${videoCount} video · máx ${maxDays}d corriendo)`);

      // Winners primero, después los demás
      const sorted = [...ads].sort((a, b) => (b.score || 0) - (a.score || 0));
      for (const ad of sorted) {
        const winBadge = ad.winnerTier === 'strong' ? '🏆🔥' : ad.isWinner ? '🏆' : '';
        const body = ad.body ? ad.body.slice(0, 200) : '(sin copy)';
        parts.push(`- ${winBadge} [${ad.formato}·${ad.daysRunning}d·score${ad.score}${ad.variantes > 0 ? `·${ad.variantes}var` : ''}] ${ad.headline ? ad.headline + ' — ' : ''}${body}`);
      }
    }
  }

  // === SECCIÓN 2: Análisis PROFUNDOS (los top con Vision + Whisper) ===
  if (competidoresAnalisis?.length) {
    parts.push('\n## ANÁLISIS PROFUNDOS (Vision + Whisper) — los ganadores más fuertes');
    parts.push(`${competidoresAnalisis.length} ads analizados en profundidad. Estos son los insights estructurados:`);
    competidoresAnalisis.forEach((c, i) => {
      parts.push(`\n### ${i + 1}. ${c.competidorNombre || 'Competidor'} — ad ${c.adId || ''}`);
      if (c.adHeadline) parts.push(`Headline: ${c.adHeadline}`);
      if (c.adBody) parts.push(`Body: ${String(c.adBody).slice(0, 400)}`);
      const a = c.analysis || {};
      if (a.angle) parts.push(`Ángulo: ${a.angle}`);
      if (Array.isArray(a.hooks)) parts.push(`Hooks: ${a.hooks.join(' | ')}`);
      if (Array.isArray(a.triggers)) parts.push(`Triggers: ${a.triggers.join(', ')}`);
      if (a.audience) parts.push(`Audience: ${a.audience}`);
      if (a.why_it_works) parts.push(`Por qué funciona: ${a.why_it_works}`);
      if (Array.isArray(a.copy_patterns)) parts.push(`Patrones de copy: ${a.copy_patterns.join(' | ')}`);
      if (Array.isArray(a.objections)) parts.push(`Objeciones que aborda: ${a.objections.join(' | ')}`);
    });
  } else if (!allCompAds?.length) {
    parts.push('\n## COMPETENCIA');
    parts.push('(Sin datos de competencia todavía. Generá ideas basadas solo en el research doc del producto.)');
  }

  if (propiosAds?.length) {
    // Ordenar fatigando primero (priorizar iteración de los que lo necesitan).
    const orderedAds = [...propiosAds].sort((a, b) => {
      const prioridad = { dying: 0, fatiguing: 1, warming: 2, healthy: 3, new: 4 };
      return (prioridad[a.fatigue?.status] ?? 5) - (prioridad[b.fatigue?.status] ?? 5);
    });

    const fatigando = orderedAds.filter(a => ['dying', 'fatiguing'].includes(a.fatigue?.status));
    const sanos = orderedAds.filter(a => !['dying', 'fatiguing'].includes(a.fatigue?.status));

    parts.push('\n## TUS PROPIOS ADS ACTIVOS (para generar iteraciones)');
    parts.push(`Cada ad viene con su estado de fatigue y métricas 7d + 7d previos. PRIORIZÁ iterar los que están 🔻 FATIGANDO o 💀 MURIENDO — son los que más necesitan renovación. Los saludables podés tomarlos como base si su estructura/ángulo anduvo bien para escalar.`);

    // Helper para formatear las métricas de un ad de forma compacta pero rica.
    const fmtMetrics = (ins) => {
      const parts_m = [
        `CTR ${(ins.ctr || 0).toFixed(2)}%`,
        `ROAS ${(ins.roas || 0).toFixed(2)}`,
        `CPA $${(ins.cpa || 0).toFixed(2)}`,
        `${ins.purchases || 0} compras`,
        `freq ${(ins.frequency || 0).toFixed(1)}`,
      ];
      if ((ins.thumbStopRate || 0) > 0) {
        parts_m.push(`thumb-stop ${ins.thumbStopRate.toFixed(1)}%`);
      }
      return parts_m.join(' · ');
    };

    if (fatigando.length > 0) {
      parts.push(`\n### 🔻 Fatigando / muriendo (${fatigando.length}) — prioridad alta para iterar`);
      fatigando.forEach((ad, i) => {
        const ins = ad.insights || {};
        const fat = ad.fatigue || {};
        parts.push(`\n**${i + 1}. ${ad.name || ad.creative?.title || 'Sin nombre'}** [adId: ${ad.id}]`);
        if (ad.creative?.title) parts.push(`Título: ${ad.creative.title}`);
        if (ad.creative?.body) parts.push(`Body: ${String(ad.creative.body).slice(0, 300)}`);
        parts.push(`Estado: ${fat.status === 'dying' ? '💀 muriendo' : '🔻 fatigando'} — ${fat.reason}`);
        parts.push(`14d actuales: ${fmtMetrics(ins)}`);
      });
    }

    if (sanos.length > 0) {
      parts.push(`\n### ✅ Saludables (${sanos.length}) — se pueden iterar para escalar`);
      sanos.slice(0, 8).forEach((ad, i) => {
        const ins = ad.insights || {};
        const fat = ad.fatigue || {};
        parts.push(`\n**${fatigando.length + i + 1}. ${ad.name || ad.creative?.title || 'Sin nombre'}** [adId: ${ad.id}]`);
        if (ad.creative?.title) parts.push(`Título: ${ad.creative.title}`);
        parts.push(`Estado: ${fat.status === 'healthy' ? '✅ saludable' : fat.status === 'warming' ? '📈 escalando' : '🆕 nuevo'} — ${fat.reason || ''}`);
        parts.push(`14d: ${fmtMetrics(ins)}`);
      });
    }

    parts.push(`\n**PARA IDEAS TIPO "iteracion"**, incluí en el shape estos campos extra:`);
    parts.push(`  - "iteracionBase": { "adId": "<id del ad base>", "adNombre": "<nombre>", "razon": "<qué estás cambiando y por qué, referenciando métrica concreta>" }`);
    parts.push(`Ejemplo de razon: "El ad base tiene CTR -28% últimos 7d con freq 4.2 — audiencia quemada con ese hook. Cambiamos a hook de dolor específico + mismo formato."`);
  }

  if (ideasExistentes?.length) {
    parts.push('\n## IDEAS YA EN LA BANDEJA (NO repitas, generá nuevas)');
    ideasExistentes.slice(0, 30).forEach(i => {
      parts.push(`- [${i.tipo}] ${i.titulo}${i.angulo ? ' — ' + String(i.angulo).slice(0, 100) : ''}`);
    });
  }

  parts.push('\n## INSTRUCCIÓN');
  parts.push('Generá 10 ideas nuevas siguiendo el formato JSON pedido en el system prompt. Empezá directo con "[".');

  return parts.join('\n');
}

// Parsea chars de un JSON parcial en streaming y extrae los objetos completos
// del array "ideas":[]. Usa un contador de profundidad tolerante a strings
// con llaves/corchetes escapados, para detectar cada `{...}` que cierra a
// depth 0 (respecto al interior del array).
function extractNewIdeas(buffer, alreadyEmitted) {
  const m = buffer.match(/"ideas"\s*:\s*\[/);
  if (!m) return [];
  const arrayStart = m.index + m[0].length;

  let depth = 0;
  let inString = false;
  let escape = false;
  let itemStart = -1;
  const items = [];

  for (let i = arrayStart; i < buffer.length; i++) {
    const c = buffer[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') {
      if (depth === 0) itemStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && itemStart >= 0) {
        items.push(buffer.slice(itemStart, i + 1));
        itemStart = -1;
      }
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      if (depth === 0) break;
      depth--;
    }
  }

  return items.slice(alreadyEmitted).map(s => {
    try { return JSON.parse(s); } catch { return null; }
  }).filter(Boolean);
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Limpia/valida una idea antes de emitirla al cliente.
function sanitizeIdea(i) {
  const tiposValidos = new Set(['replica', 'iteracion', 'diferenciacion', 'desde_cero']);
  const variablesValidas = new Set(['hook', 'visual', 'cta', 'formato', 'angulo', 'audience', 'prueba_social', 'oferta', 'mix']);
  if (!i || typeof i.titulo !== 'string' || !tiposValidos.has(i.tipo)) return null;
  const base = {
    titulo: String(i.titulo).slice(0, 150),
    tipo: i.tipo,
    angulo: String(i.angulo || '').slice(0, 500),
    painPoint: String(i.painPoint || '').slice(0, 500),
    hook: String(i.hook || '').slice(0, 500),
    copy: String(i.copy || '').slice(0, 1500),
    guion: String(i.guion || '').slice(0, 3000),
    formato: ['video', 'static', 'carrusel'].includes(i.formato) ? i.formato : 'static',
    razonamiento: String(i.razonamiento || '').slice(0, 500),
    variableDeTesteo: variablesValidas.has(i.variableDeTesteo) ? i.variableDeTesteo : 'mix',
    testHipotesis: String(i.testHipotesis || '').slice(0, 500),
  };
  if (i.tipo === 'iteracion' && i.iteracionBase) {
    base.iteracionBase = {
      adId: String(i.iteracionBase.adId || '').slice(0, 100),
      adNombre: String(i.iteracionBase.adNombre || '').slice(0, 200),
      razon: String(i.iteracionBase.razon || '').slice(0, 500),
    };
  }
  return base;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respondJSON(res, 405, { error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return respondJSON(res, 500, { error: 'ANTHROPIC_API_KEY no configurada' });
  }

  const body = await readBody(req);
  const {
    producto,
    competidoresAnalisis = [],
    allCompAds = [],
    ideasExistentes = [],
    propiosAds = [],
    targetCount = 15,
    formatoMix = { static: 0.6, video: 0.4 },
  } = body || {};

  if (!producto || !producto.nombre) {
    return respondJSON(res, 400, { error: 'Falta producto.nombre en el body' });
  }

  const clampedTarget = Math.max(1, Math.min(40, Number(targetCount) || 15));
  const maxTokens = Math.min(16000, 500 + clampedTarget * 500);

  const client = new Anthropic({ apiKey: anthropicKey });
  const hasPropios = Array.isArray(propiosAds) && propiosAds.length > 0;
  const userContent = buildContext({ producto, competidoresAnalisis, allCompAds, ideasExistentes, propiosAds });
  const systemPrompt = buildSystemPrompt({
    hasPropios,
    targetCount: clampedTarget,
    formatoMix: {
      static: Number(formatoMix?.static) || 0.6,
      video: Number(formatoMix?.video) || 0.4,
    },
  });

  // Stream SSE: emitimos cada idea apenas Claude termina de escribirla.
  // El cliente puede empujarla a la Bandeja en tiempo real y mostrarla
  // en el stepper sin esperar a la respuesta completa.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx/proxy: no bufferear

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      tools: [SUBMIT_IDEAS_TOOL],
      tool_choice: { type: 'tool', name: 'submit_ideas' },
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: userContent },
      ],
    });

    let partialBuffer = '';
    let emittedCount = 0;

    for await (const event of stream) {
      // input_json_delta llega a medida que Claude va escribiendo el JSON
      // de la tool call. Acumulamos y extraemos ideas completas apenas
      // se cierran los {...}.
      if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        partialBuffer += event.delta.partial_json || '';
        const newIdeas = extractNewIdeas(partialBuffer, emittedCount);
        for (const rawIdea of newIdeas) {
          const clean = sanitizeIdea(rawIdea);
          if (clean) {
            sseWrite(res, { type: 'idea', idea: clean });
            emittedCount++;
          }
        }
      }
    }

    const finalMsg = await stream.finalMessage();
    const cost = { anthropic: anthropicCost(finalMsg.usage, MODEL) };

    sseWrite(res, {
      type: 'complete',
      count: emittedCount,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      cost,
    });
    res.end();
  } catch (err) {
    console.error('generate-ideas error:', err);
    sseWrite(res, { type: 'error', error: err.message || 'Error generando ideas' });
    res.end();
  }
}
