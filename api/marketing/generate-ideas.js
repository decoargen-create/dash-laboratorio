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

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT_BASE = `Sos director creativo senior de DTC cosméticos en Argentina. Tu trabajo es generar ideas de creativos accionables para Meta Ads. Tus ideas no son genéricas: son específicas al producto, al avatar y al contexto de la competencia.

**CALIDAD > CANTIDAD.** Si solo tenés contexto sólido para generar 12 ideas excelentes, devolvé 12. Nunca rellenes con ideas mediocres para alcanzar un número. Una mediocre pinta mal la bandeja entera.

**DIVERSIDAD DE HOOKS — muy importante.** Antes de finalizar la respuesta, revisá todos los hooks que propusiste. Si dos hooks arrancan con el mismo template ("¿Cansada de X?", "¿Sabías que X?", "Dejá de X"), reescribí uno. Repetir estructuras en 2+ ideas las vuelve intercambiables y pierde el valor de diversificar ángulos. Mezclá arquetipos:
- Pregunta retórica
- Dato o estadística shocking
- Confesión / storytelling en 1ra persona
- Comparación antes/después
- Autoridad / "Me dijo el dermatólogo"
- Micro-agresión / provocación
- Instrucción / "Tenés que saber esto"
- Curiosidad / "No te vas a creer lo que pasó"

Una buena batería tiene al menos 4 arquetipos de hook distintos.

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
  lines.push(`**MIX DE FORMATO**: apuntá a ~${sPct}% static y ~${vPct}% video sobre el total. Podés incluir algún carrusel si el concepto lo pide.`);
  lines.push('');
  return lines.join('\n');
}

const SHAPE_COMUN = `Por cada idea devolvé este shape EXACTO:

{
  "titulo": "string corto y concreto, ≤ 80 chars",
  "tipo": "replica" | "iteracion" | "diferenciacion" | "desde_cero",
  "angulo": "el ángulo emocional o estratégico",
  "painPoint": "el pain específico que toca",
  "hook": "primer frame o primeras 3 líneas que paran el scroll",
  "copy": "copy completo sugerido (2-5 oraciones)",
  "guion": "VIDEO: guión con beats numerados, ej: 'Beat 1 (0-3s): ... · Beat 2 (3-8s): ...'. Incluí duración total (15s/30s/60s) y tono de VO. STATIC: descripción de layout (headline arriba/centro, imagen hero, subcopy, CTA), paleta, mood y composición. CARRUSEL: slide-by-slide con hook en slide 1 y CTA en la última.",
  "formato": "video" | "static" | "carrusel",
  "razonamiento": "1-2 oraciones: por qué esta idea, qué la hace fuerte",
  "iteracionBase": "OBLIGATORIO solo si tipo='iteracion': { adId, adNombre, razon — con métrica concreta que justifica la iteración }",
  "variableDeTesteo": "OBLIGATORIO — qué se está testeando puntual vs un baseline (importa para aprender qué funcionó después). Valores válidos: 'hook' | 'visual' | 'cta' | 'formato' | 'angulo' | 'audience' | 'prueba_social' | 'oferta' | 'mix' (mix = varios a la vez).",
  "testHipotesis": "OBLIGATORIO — hipótesis medible, ej: 'el hook con dato numérico va a bajar CPA vs el hook emocional genérico' o 'el formato carrusel va a tener más thumb-stop que el video en frío'"
}

**IMPORTANTE sobre variableDeTesteo**: para iteraciones, identificá qué UNA cosa estás cambiando vs el ad base (si cambiás hook Y visual a la vez, poné "mix"). Para réplicas/diferenciaciones, identificá cuál es la palanca central de la idea. Esto permite al user armar A/B coherentes y aprender qué funciona.

El campo "guion" es CRÍTICO — tiene que darle al diseñador/editor toda la info que necesita para producir sin preguntar nada.

DEVOLVÉ ÚNICAMENTE el array JSON (empezá con "[" y terminá con "]"). Sin texto antes ni después. Sin \`\`\`json wrappers.`;

function buildSystemPrompt({ hasPropios, targetCount, formatoMix }) {
  const mix = buildTypeMix(targetCount, hasPropios);
  return SYSTEM_PROMPT_BASE + buildMixSection(mix, formatoMix, targetCount) + SHAPE_COMUN;
}

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
function buildContext({ producto, competidoresAnalisis, ideasExistentes, propiosAds }) {
  const parts = [];

  parts.push('## PRODUCTO PROPIO');
  parts.push(`Nombre: ${producto?.nombre || '(sin nombre)'}`);
  if (producto?.landingUrl) parts.push(`Landing: ${producto.landingUrl}`);
  if (producto?.descripcion) parts.push(`Descripción: ${producto.descripcion}`);
  if (producto?.resumenEjecutivo) parts.push(`\nResumen ejecutivo: ${producto.resumenEjecutivo}`);

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

  parts.push('\n## COMPETENCIA — ANÁLISIS DE GANADORES');
  if (!competidoresAnalisis?.length) {
    parts.push('(Sin análisis de competencia todavía. Igual generá ideas pero marcá que las "replica" son genéricas.)');
  } else {
    competidoresAnalisis.slice(0, 8).forEach((c, i) => {
      parts.push(`\n### ${i + 1}. ${c.competidorNombre || 'Competidor'} — ad ${c.adId || ''}`);
      if (c.adHeadline) parts.push(`Headline: ${c.adHeadline}`);
      if (c.adBody) parts.push(`Body: ${String(c.adBody).slice(0, 400)}`);
      const a = c.analysis || {};
      if (a.angle) parts.push(`Ángulo: ${a.angle}`);
      if (Array.isArray(a.hooks)) parts.push(`Hooks: ${a.hooks.join(' | ')}`);
      if (Array.isArray(a.triggers)) parts.push(`Triggers: ${a.triggers.join(', ')}`);
      if (a.audience) parts.push(`Audience: ${a.audience}`);
      if (a.why_it_works) parts.push(`Por qué funciona: ${a.why_it_works}`);
    });
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
    ideasExistentes = [],
    propiosAds = [],
    targetCount = 15,
    formatoMix = { static: 0.6, video: 0.4 },
  } = body || {};

  if (!producto || !producto.nombre) {
    return respondJSON(res, 400, { error: 'Falta producto.nombre en el body' });
  }

  // Clamp: entre 1 y 40 para no quemar tokens indefinidamente.
  const clampedTarget = Math.max(1, Math.min(40, Number(targetCount) || 15));

  // Max tokens dinámico: ~500 tokens por idea como margen (hooks, guiones de
  // video son los más caros). 16K tokens cubren 30+ ideas con comodidad.
  const maxTokens = Math.min(16000, 500 + clampedTarget * 500);

  const client = new Anthropic({ apiKey: anthropicKey });
  const hasPropios = Array.isArray(propiosAds) && propiosAds.length > 0;
  const userContent = buildContext({ producto, competidoresAnalisis, ideasExistentes, propiosAds });
  const systemPrompt = buildSystemPrompt({
    hasPropios,
    targetCount: clampedTarget,
    formatoMix: {
      static: Number(formatoMix?.static) || 0.6,
      video: Number(formatoMix?.video) || 0.4,
    },
  });

  try {
    // Adaptive thinking: Sonnet 4.6 soporta que Claude decida cuánto pensar
    // según la complejidad. Para generación creativa ancla mucho mejor las
    // ideas al research/contexto, a costo de ~15-30s más de latencia.
    // Streaming evita timeout HTTP en requests largos con thinking.
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: userContent },
      ],
    });
    const resp = await stream.finalMessage();

    const textBlock = resp.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('Claude no devolvió texto');

    let jsonStr = textBlock.text.trim();
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) jsonStr = match[1];
    // Si viene envuelto en "ideas": [...] lo desenvolvemos.
    if (jsonStr.startsWith('{')) {
      try {
        const obj = JSON.parse(jsonStr);
        if (Array.isArray(obj.ideas)) jsonStr = JSON.stringify(obj.ideas);
      } catch {}
    }

    let ideas;
    try {
      ideas = JSON.parse(jsonStr);
    } catch (err) {
      throw new Error(`JSON inválido del modelo: ${err.message}. Primeros 200 chars: ${jsonStr.slice(0, 200)}`);
    }
    if (!Array.isArray(ideas)) {
      throw new Error('La respuesta no es un array');
    }

    // Filtrado defensivo: solo ideas con titulo + tipo válido.
    const tiposValidos = new Set(['replica', 'iteracion', 'diferenciacion', 'desde_cero']);
    const variablesValidas = new Set(['hook', 'visual', 'cta', 'formato', 'angulo', 'audience', 'prueba_social', 'oferta', 'mix']);
    const clean = ideas
      .filter(i => i && typeof i.titulo === 'string' && tiposValidos.has(i.tipo))
      .map(i => {
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
        // Para iteraciones, capturamos el link al ad base con la razón concreta.
        if (i.tipo === 'iteracion' && i.iteracionBase) {
          base.iteracionBase = {
            adId: String(i.iteracionBase.adId || '').slice(0, 100),
            adNombre: String(i.iteracionBase.adNombre || '').slice(0, 200),
            razon: String(i.iteracionBase.razon || '').slice(0, 500),
          };
        }
        return base;
      });

    return respondJSON(res, 200, {
      ideas: clean,
      count: clean.length,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      usage: resp.usage,
    });
  } catch (err) {
    console.error('generate-ideas error:', err);
    return respondJSON(res, 502, { error: err.message || 'Error generando ideas' });
  }
}
