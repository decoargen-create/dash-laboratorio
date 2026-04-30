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

const SYSTEM_PROMPT_BASE = `Sos un estratega de direct-response + copywriter + director de arte especializado en Meta Ads para e-commerce ARGENTINO. Tu estilo combina:
- Insights de Alex Hormozi (big idea, curiosidad, pattern interrupt)
- Copywriting argento coloquial (vos, che, modismos locales — nunca neutro, nunca español de España)
- Humor filoso + sarcasmo + doble sentido elegante cuando el producto lo permite
- Ojo de dirección de arte (qué imagen potencia cada hook)

**TONO OBLIGATORIO EN LOS HOOKS — NO NEGOCIABLE**:
Rozando lo vulgar cuando el producto lo permite. Sarcasmo argentino filoso. Doble sentido visual elegante. Humor cotidiano identificable. NUNCA tono corporativo, aspiracional genérico o clínico distante. Si el research doc empuja a tono serio, esa info va a la TRASTIENDA (copy del post, datos técnicos) — los HOOKS mantienen filo creativo.

Si el producto NO se presta a humor/vulgar (ej: productos médicos serios), usá insight incómodo + pattern interrupt emocional.

---

**10 ÁNGULOS ESTRATÉGICOS** — cada idea debe pertenecer a uno:

- **A. Sarcasmo / vulgar jugado** — pattern interrupt por shock u humor filoso
- **B. Insight incómodo** — rompe tabú/mito, dice lo que nadie dice
- **C. Situación relatable / POV** — micro-escenas cotidianas argentas, "cuando te pasa X"
- **D. Doble sentido visual** — objeto cotidiano que "se abre", metáforas naturales premium
- **E. Autoridad / solución** — para BOFU/retargeting, comparativas, garantía
- **F. Testimonio / voz del cliente** — frase entre comillas con edad+nombre EXPLÍCITO (ej: "Elena, 62") — alta credibilidad en belleza/salud
- **G. Autoridad científica / mecanismo** — instala UMS, convierte audiencia research-heavy
- **H. Comparativa antes/después** — split visual, rutina anterior vs actual
- **I. Humor filoso anti-cultura** — contra "body positive", "good vibes only", pensamiento mágico
- **J. Edad emocional vs biológica** — para productos donde la edad es factor

Distribuí las ideas entre 5-7 ángulos distintos. No todos aplican a todo producto — elegí los que mejor se prestan al caso.

---

**PROTECCIÓN DE ALCANCE META**:
Ciertas palabras bajan el alcance de los ads: sexo, vagina, infección, enfermedad, celulitis, arrugas, pene, grasa corporal, diabetes, cáncer, etc. Si el hook/copy usa alguna, marcala con metaRiesgo para que el user sepa que tiene que testear en campaña chica antes de escalar.

---

**REGLAS DE ORO**:
1. No inventar claims — solo trabajar con beneficios reales del producto (del research doc + landing).
2. Argentino PORTEÑO de Buenos Aires, no español neutro ni "latino genérico". Escribís como habla la clase media porteña de 25-55 años.
3. Diferenciarse — si el hook podría estar en cualquier marca del rubro, no sirve. Debe sentirse DE ESTA marca.
4. Calidad > cantidad. 12 ideas excelentes > 40 mediocres.
5. Pattern interrupt — cada hook tiene que sobrevivir al scroll. Si no frena el pulgar en 1 segundo, no sirve.
6. Hooks cortos — máx 12 palabras idealmente. Sin contexto previo.
7. Testimonios con edad: "Elena, 62" > "una mujer de 60+". La precisión da credibilidad.
8. Activo visual de marca — si el producto tiene un elemento icónico (frasco, textura, forma), incluilo en 40-60% de las piezas como hilo conductor reconocible. No en todas — la ausencia estratégica potencia cuando aparece.

---

**PORTEÑO OBLIGATORIO — APLICA A hook, copyPostMeta Y guion**:

SÍ usar:
- Vos / tuyo / te re + adjetivo ("te re sirve")
- Modismos: "bancar", "chamuyo", "quilombo", "laburo", "posta", "re bien", "flashear", "mandarse", "zafar", "al pedo", "de una", "dale"
- Muletillas naturales: "mirá", "che", "viste", "tipo", "nada que ver", "la verdad"
- Ritmo hablado: frases cortas, pausas, puntos (no comas largas)
- Diminutivos porteños: "cafecito", "momentito", "un ratito"

NUNCA usar:
- "Tú, tu, ti" — PROHIBIDO. Solo "vos / tuyo / te".
- "Tienes / tenéis" — usar "tenés / tienen"
- "Puedes" — usar "podés"
- "Genial / alucinante / brutal" — usar "zarpado / un flash / de terror / una locura"
- "Mola / chulo" — son de España, PROHIBIDO
- "Lindo" en exceso — es más neutro, preferí "copado / piola / re loco"

Ejemplos de tono correcto:
✅ "Che, ¿te pasa que terminás el día reventada?"
✅ "La verdad, probé mil cremas y ninguna zafó."
✅ "Posta, esto te cambia el laburo de la rutina."
❌ "¿Te sientes agotada al final del día?" (neutro)
❌ "Prueba este producto increíble" (genérico)

Si el guion es para video, escribilo como lo diría una amiga porteña en una historia de IG, no como locutora profesional. Beats cortos, respiraciones naturales, un poco de imperfección creíble.

---

**PROCESO INTERNO** (hacelo mentalmente antes de generar):

FASE 1 — Leé TODOS los ads de la competencia. Identificá patrones de ganadores.

FASE 2 — Con los patrones + research doc + avatar, distribuí las ideas entre los 10 ángulos. Aseguráte que ninguno quede sobrerrepresentado salvo que lo justifique el producto.

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

const SHAPE_GUIDANCE = `Para devolver las ideas, llamá a la tool \`submit_ideas\` con el array completo. El API valida el schema.

**Cada idea es un brief COMPLETO** que debería poder irse a producción sin preguntar nada. Formato obligatorio, tomá este ejemplo de calidad como referencia:

---
EJEMPLO DE CALIDAD (PIEZA #7, static, réplica):

titulo: "Tirá las 4 cremas del botiquín. Con esta sola ya está."
tipo: "replica"
formato: "static"
estiloVisual: "Editorial premium / conceptual minimalista"
angulo: "Simplificación del ritual de skincare — reemplazo de 4 productos por 1"
painPoint: "Gasto disperso en múltiples cremas sin resultados visibles"
hook: "Tirá las 4 cremas del botiquín. Con esta sola ya está."
escenarioNarrativo: "La oferta directa de simplicidad: Cellu reemplaza 4 cremas distintas (anti-age, anti-celulitis, anti-estrías, hidratante). Un gasto, un ritual, un producto. Pieza de retargeting y cierre — target ya conoce el problema pero tiene varios productos en el botiquín."
descripcionImagen: "Editorial conceptual overhead. A la izquierda del frame, un tacho minimalista blanco con 4 frascos genéricos de cremas (blancos/beiges, usados, viejos) cayendo dentro. A la derecha, parado en foco perfecto con luz cálida dorada lateral, el frasco de Cellu — elegante, único protagonista. Fondo rosado empolvado limpio. Narrativa visual clara: reemplazo. Estética premium beauty."
promptGeneradorImagen: "Editorial conceptual composition overhead shot, four generic used cosmetic cream jars in white and beige tones falling into a minimalist white trash bin on the left side of the frame, their lids worn and the products looking tired and generic, on the right side standing upright in perfect sharp focus one elegant cream jar with warm golden highlights representing the chosen product, soft dusty pink background, clear visual narrative of replacement, photorealistic, minimalist beauty photography, soft natural lighting, muted pastel color palette, 1:1 square composition"
textoEnImagen: "HOOK:\\n• Línea 1 (bold granate, GRANDE): 'TIRÁ LAS 4 CREMAS'\\n• Línea 2 (bold granate, GRANDE): 'DEL BOTIQUÍN.'\\n• Línea 3 (italic naranja, más chica): 'Con esta sola ya está.'\\nMICROCOPY (sans-serif chico): '5 problemas. 1 fórmula. Aprobado por ANMAT.'\\nSELLO ESQUINA INFERIOR DERECHA: '✅ APROBADO POR ANMAT'\\nCTA (botón): 'Quiero simplificar mi rutina →'"
copyPostMeta: "Esto es lo que probablemente tenés en tu baño ahora:\\n\\n• Crema anti-edad para la cara\\n• Crema para la papada / cuello / escote\\n• Crema anti-celulitis para piernas y glúteos\\n• Aceite o crema para estrías\\n• Hidratante corporal genérico\\n\\nGastás una fortuna. Te armás una rutina imposible. Y los resultados no llegan porque ninguna ataca la causa real: el tejido dérmico debilitado.\\n\\nCellu es UNA fórmula que trata 5 problemas: celulitis, estrías, arrugas, piel crepé, deshidratación. En cara, cuello, escote, brazos, manos, piernas y glúteos.\\n\\nAprobado por ANMAT. +7.896 reseñas (4.92/5). Envío gratis.\\n\\nTirá las 4. Quedate con una."
publicoSugerido: "Retargeting caliente (visitó landing, no compró) + mujeres 35-55 con alto gasto en productos de cosmética."
guion: "N/A (static)"
razonamiento: "Réplica del patrón ganador de [Competidor X] (ad con 43d corriendo, 6 variantes) que usa 'tirá/reemplazá X productos' como hook de simplificación. Adapto al caso Cellu con 4 cremas específicas que el avatar ya tiene en su baño."
variableDeTesteo: "hook"
testHipotesis: "Hook con número concreto (4 cremas) va a bajar CPA vs hook genérico tipo 'simplificá tu rutina'."
---

**Reglas específicas por campo**:
- titulo: igual o derivado del hook, ≤ 100 chars. Usa comillas si es el hook literal.
- estiloVisual: categoría concreta que un director de arte entienda ("Editorial premium" · "UGC testimonial" · "Before/After clínico" · "Flat lay producto" · "Lifestyle aspiracional" · "Ilustrado humor").
- descripcionImagen: en ESPAÑOL rioplatense, detallada, para el diseñador humano. Si es video, describí la escena clave o la miniatura. Si es carrusel, describí la slide principal.
- promptGeneradorImagen: en INGLÉS, específico. REGLAS OBLIGATORIAS:
  · CERRAR SIEMPRE con el aspect ratio según el formato:
      static/feed → "photorealistic, commercial ad quality, 1:1 square composition"
      video/stories/reels → "photorealistic, commercial ad quality, 9:16 vertical composition"
      carrusel → "photorealistic, commercial ad quality, 4:5 portrait composition"
  · Si aparecen PERSONAS/PIEL y puede salir plástico, AGREGAR:
      "natural skin texture, subtle imperfections, editorial unretouched look, shot on medium format camera"
  · EUFEMISMOS OBLIGATORIOS para palabras que Meta o los generadores de imagen censuran/rechazan:
      "vagina" → "intimate area" / "delicate skin"
      "nude" → "tasteful editorial portrait" / "soft draped fabric"
      "sexual" → "sensual" / "intimate mood"
      "infection" → "inflammation" / "redness"
      "disease" → "condition" / "imbalance"
      "cellulite" → "skin texture on thighs"
      "wrinkles" → "fine lines" / "texture of mature skin"
      "fat" / "overweight" → "body silhouette" / "softer form"
  · Si el producto tiene ACTIVO VISUAL DE MARCA (elemento icónico reutilizable: frasco distintivo, textura, forma), DEBE aparecer con descripción detallada en el prompt. Apuntá a que aparezca en ~40-60% de las piezas — en las que estratégicamente potencia el hook (autoridad, testimonio, solución). En hooks de puro shock/POV puede NO aparecer, eso baja el "olor a ad" y sube CTR.
  · Incluí SIEMPRE: composición + iluminación + paleta.
- textoEnImagen: layout del TEXTO SOBRE LA IMAGEN con jerarquía, estilo (bold/italic), colores y tamaños relativos. Separá hook, microcopy, sellos y CTA. Usá \\n para saltos de línea.
- copyPostMeta: lo que va ARRIBA de la imagen en el feed (NO dentro). Puede ser largo, usar bullets/saltos de línea. Storytelling está OK. Cerrá con un call-to-action o pregunta. Castellano rioplatense.
- publicoSugerido: targeting concreto. Ej: "cold prospecting: mujeres 30-55 con interés en cosmética natural" o "retargeting: visitantes del último 14d que no compraron".
- guion: SOLO video → beats numerados (Beat 1, 2...) con timecodes (0-3s, 3-8s...) + duración total + tono de VO. Si es static/carrusel, poné "N/A (static)" o slide-by-slide para carruseles.
- variableDeTesteo + testHipotesis: para saber qué estás testeando y medir después.
- iteracionBase: SOLO si tipo=iteracion. Linkeá al adId del ad propio que estás iterando.
`;

// El stage del prospect (problem/solution/product-aware) condiciona qué
// ángulos dominan en la corrida. Antes esto se mandaba SOLO en el contexto
// (buildContext) pero el system prompt no lo forzaba — Claude podía ignorar
// el stage y caer al humor/sarcasmo default. Forzamos distribución por stage
// para que un BOFU (product-aware) tire testimonios + autoridad y un TOFU
// (problem-aware) tire agitación + POV.
function stageInstructions(stage) {
  if (stage === 'product_aware') {
    return `\n**STAGE = PRODUCT-AWARE (BOFU) — DISTRIBUCIÓN OBLIGATORIA**:
El prospect ya conoce tu marca y casi compra. Necesita REMOVER OBJECIONES + APILAR PRUEBA.
Mínimo 60% de las ideas debe usar ángulos E (autoridad/solución), F (testimonios con edad explícita), G (autoridad científica/mecanismo) o H (antes/después).
Máximo 20% en ángulos puros A/I (sarcasmo/humor anti-cultura).
tipoCampaña preferida: BOFU, retargeting, social_proof.
NO empieces los hooks agitando el dolor — ya lo conoce. Empezá con la prueba.
`;
  }
  if (stage === 'solution_aware') {
    return `\n**STAGE = SOLUTION-AWARE (MOFU) — DISTRIBUCIÓN OBLIGATORIA**:
El prospect ya probó otras soluciones (cremas, suplementos, rutinas, etc) y quedó decepcionado. Necesita ENTENDER POR QUÉ ESTA es DISTINTA.
Mínimo 60% de las ideas debe usar ángulos D (doble sentido visual / metáfora del mecanismo único), G (autoridad científica con UMS — Unique Mechanism Story), H (antes/después o comparativa con la solución vieja).
Hooks típicos: "probaste X, Y y Z. Ninguno hace ESTO", "el problema no era el producto, era el mecanismo", "lo que hacen las cremas vs lo que hace este serum".
tipoCampaña preferida: MOFU, retargeting tibio, branding diferenciador.
`;
  }
  // problem_aware (default)
  return `\n**STAGE = PROBLEM-AWARE (TOFU) — DISTRIBUCIÓN OBLIGATORIA**:
El prospect siente el problema pero NO conoce las soluciones. Necesita DIAGNÓSTICO + AGITACIÓN + ASOMO de salida.
Mínimo 60% de las ideas debe usar ángulos B (insight incómodo / rompe-mito), C (POV relatable / "cuando te pasa X"), I (humor filoso anti-cultura), J (edad emocional).
Los primeros 3 segundos del hook NO mencionan el producto — agitan el dolor o nombran el problema con palabras del avatar (lenguaje del research doc).
tipoCampaña preferida: TOFU, prospecting frío.
NO arranques con testimonios ni con autoridad científica — el prospect todavía no compró el problema, mucho menos la solución.
`;
}

function buildSystemPrompt({ hasPropios, targetCount, formatoMix, stage }) {
  const mix = buildTypeMix(targetCount, hasPropios);
  return SYSTEM_PROMPT_BASE + stageInstructions(stage) + buildMixSection(mix, formatoMix, targetCount) + SHAPE_GUIDANCE;
}

// Tool schema para structured output. Cada idea es un brief COMPLETO:
// concepto estratégico + descripción de imagen en español + prompt en inglés
// para Nano Banana/Midjourney + layout del texto-en-imagen + copy del post
// + público sugerido. Listo para producir sin preguntas.
const SUBMIT_IDEAS_TOOL = {
  name: 'submit_ideas',
  description: 'Envía el array completo de briefs creativos generados.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        description: 'Array de ideas/briefs. Respetá calidad > cantidad.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Título corto del brief ej: "Tirá las 4 cremas del botiquín". ≤ 100 chars.' },
            tipo: { type: 'string', enum: ['replica', 'iteracion', 'diferenciacion', 'desde_cero'] },
            formato: { type: 'string', enum: ['video', 'static', 'carrusel'] },
            estiloVisual: { type: 'string', description: 'Ej: "Editorial premium / conceptual minimalista" · "UGC testimonial" · "Before/After clínico" · "Ilustrado humor" · "Lifestyle aspiracional".' },
            angulo: { type: 'string', description: 'Ángulo emocional/estratégico central.' },
            painPoint: { type: 'string', description: 'El pain específico que toca.' },
            hook: { type: 'string', description: 'Hook principal — 1 línea, ≤ 120 chars. Diversificá arquetipos entre ideas.' },
            escenarioNarrativo: { type: 'string', description: 'Concepto estratégico: por qué esta pieza comunica lo que comunica, cómo se conecta con el avatar y la oferta. 2-4 oraciones.' },
            descripcionImagen: { type: 'string', description: 'SPANISH: descripción detallada y visual de la escena para que un diseñador humano la entienda. Composición, elementos, iluminación, mood. 3-6 oraciones.' },
            promptGeneradorImagen: { type: 'string', description: 'ENGLISH: prompt listo para pegar en Nano Banana / Midjourney / DALL-E. Detallado, con estilo fotográfico, composición, iluminación, paleta, aspect ratio. Ej: "Editorial conceptual composition overhead shot, four generic used cosmetic jars falling into..., photorealistic, soft natural lighting, muted pastel palette, 1:1 square composition".' },
            textoEnImagen: { type: 'string', description: 'Layout del texto que VA DENTRO de la imagen: hook en bloques (con estilo + color + tamaño relativo), microcopy debajo, sello/badge si aplica, CTA button. Formato legible por humano, ej:\\nHOOK:\\n• Línea 1 (bold granate, GRANDE): "TIRÁ LAS 4 CREMAS"\\n• Línea 2 (bold granate, GRANDE): "DEL BOTIQUÍN."\\n• Línea 3 (italic naranja, más chica): "Con esta sola ya está."\\nMICROCOPY: "5 problemas. 1 fórmula. Aprobado por ANMAT."\\nSELLO: "✅ APROBADO POR ANMAT"\\nCTA: "Quiero simplificar mi rutina →"' },
            copyPostMeta: { type: 'string', description: 'Texto que va ARRIBA del creativo en el feed de Meta (no va dentro de la imagen). Puede ser largo (200-600 chars), con listas, saltos de línea, storytelling o bullets. En rioplatense.' },
            publicoSugerido: { type: 'string', description: 'Targeting concreto recomendado para esta pieza. Ej: "Retargeting caliente (visitó landing, no compró) + mujeres 35-55 con alto gasto en cosmética." 1-2 oraciones.' },
            guion: { type: 'string', description: 'SOLO si formato=video: guión con beats numerados + timecodes + duración total + tono de VO. Ej: "Beat 1 (0-3s): primer plano... Beat 2 (3-8s): ... · Duración: 15s · VO: cálida, femenina." Si formato=static/carrusel, dejalo vacío o poné "N/A".' },
            razonamiento: { type: 'string', description: 'Por qué esta idea es fuerte. Para réplicas: qué competidor/patrón te inspiró. Para iteración: qué variable cambiás. Para diferenciación: por qué nadie lo hizo.' },
            anguloCategoria: {
              type: 'string',
              enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
              description: 'Cuál de los 10 ángulos estratégicos (A: sarcasmo/vulgar, B: insight incómodo, C: POV relatable, D: doble sentido visual, E: autoridad/solución, F: testimonio con edad, G: autoridad científica, H: antes/después, I: humor filoso anti-cultura, J: edad emocional vs biológica).',
            },
            tipoCampaña: {
              type: 'string',
              enum: ['TOFU', 'MOFU', 'BOFU', 'retargeting', 'social_proof', 'branding'],
              description: 'En qué parte del funnel funciona mejor este creativo.',
            },
            metaRiesgo: {
              type: 'object',
              description: 'Si el hook/copy tiene palabras que bajan alcance de Meta.',
              properties: {
                tieneRiesgo: { type: 'boolean' },
                palabras: { type: 'array', items: { type: 'string' }, description: 'Palabras gatillo específicas en esta pieza.' },
                sugerencia: { type: 'string', description: 'Cómo mitigar: ej "testear primero en campaña chica", "usar eufemismo X", etc.' },
              },
              required: ['tieneRiesgo'],
            },
            variableDeTesteo: {
              type: 'string',
              enum: ['hook', 'visual', 'cta', 'formato', 'angulo', 'audience', 'prueba_social', 'oferta', 'mix'],
            },
            testHipotesis: { type: 'string', description: 'Hipótesis medible. Ej: "Hook con número concreto (4 cremas) va a bajar CPA vs hook genérico".' },
            iteracionBase: {
              type: 'object',
              description: 'OBLIGATORIO solo si tipo=iteracion.',
              properties: {
                adId: { type: 'string' },
                adNombre: { type: 'string' },
                razon: { type: 'string' },
              },
            },
            creenciaApalancada: {
              type: 'string',
              enum: ['1', '2', '3', '4', '5', '6'],
              description: 'OBLIGATORIO. Cuál de las 6 creencias necesarias del Offer Brief tumba/instala esta idea. Numerada 1-6 según el orden en que aparecen en el doc de creencias del producto. Si no se mandó doc de creencias, poné "1" como default.',
            },
          },
          required: [
            'titulo', 'tipo', 'formato', 'estiloVisual', 'angulo', 'painPoint',
            'hook', 'escenarioNarrativo', 'descripcionImagen', 'promptGeneradorImagen',
            'textoEnImagen', 'copyPostMeta', 'publicoSugerido', 'anguloCategoria',
            'tipoCampaña', 'metaRiesgo', 'razonamiento', 'variableDeTesteo', 'testHipotesis',
            'creenciaApalancada',
          ],
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

  // Activo visual de marca — elemento icónico reutilizable (frasco, textura,
  // forma distintiva). Si está definido, Claude debe incluirlo en el
  // promptGeneradorImagen de ~40-60% de las piezas como hilo conductor.
  if (producto?.activoVisual?.descripcion) {
    parts.push(`\n**ACTIVO VISUAL DE MARCA** (hilo conductor icónico del producto — incluir en 40-60% de las piezas):`);
    parts.push(producto.activoVisual.descripcion);
    if (producto.activoVisual.imageUrl) {
      parts.push(`Referencia visual: ${producto.activoVisual.imageUrl}`);
    }
  }

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
    parts.push(`\n### Creencias necesarias (las 6 "Yo creo que..." que el prospect debe adoptar antes de comprar)\n${beliefs}\n\nIMPORTANTE: cada idea DEBE declarar el campo \`creenciaApalancada\` con el número (1-6) de la creencia que tumba/instala, en el orden en que aparecen arriba. La idea entera (hook + escenario + copy) tiene que estar al servicio de empujar esa creencia.`);
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
    // Feedback loop: separamos por estado para que el generador APRENDA del
    // user. `usada` y `en_uso` son señal positiva ("esto te aprobó/escaló");
    // `archivada` es señal negativa ("esto descartaste, no insistas").
    // `pendiente` solo sirve para dedup. Antes mandábamos todo plano sin
    // estado y Claude no sabía qué replicar ni qué evitar.
    const usadas = ideasExistentes.filter(i => i.estado === 'usada' || i.estado === 'en_uso');
    const archivadas = ideasExistentes.filter(i => i.estado === 'archivada');
    const pendientes = ideasExistentes.filter(i => !i.estado || i.estado === 'pendiente');

    if (usadas.length > 0) {
      parts.push('\n## ✅ IDEAS APROBADAS POR EL USER (ejemplos POSITIVOS — replicá ESTE estilo)');
      parts.push(`Estas ${usadas.length} ideas pasaron a producción o están en uso. El user las eligió por algo. Mantené el TIPO de ángulo, el ARQUETIPO de hook y el FORMATO en al menos 30% de las ideas nuevas que generes (sin repetir literal).`);
      usadas.slice(0, 15).forEach(i => {
        parts.push(`- [${i.tipo}] ${i.titulo}${i.hook ? ` · hook: "${String(i.hook).slice(0, 120)}"` : ''}${i.angulo ? ` · ángulo: ${String(i.angulo).slice(0, 80)}` : ''}`);
      });
    }

    if (archivadas.length > 0) {
      parts.push('\n## ❌ IDEAS DESCARTADAS (ejemplos NEGATIVOS — NO generes algo así)');
      parts.push(`Estas ${archivadas.length} ideas el user las archivó. Probablemente: ángulo flojo, hook genérico, no encaja con la marca, o ya probó algo similar y no funcionó. Evitá patrones parecidos.`);
      archivadas.slice(0, 15).forEach(i => {
        parts.push(`- [${i.tipo}] ${i.titulo}${i.hook ? ` · hook descartado: "${String(i.hook).slice(0, 120)}"` : ''}`);
      });
    }

    if (pendientes.length > 0) {
      parts.push('\n## 📥 IDEAS YA EN BANDEJA SIN REVISAR (NO repitas estos títulos / hooks)');
      pendientes.slice(0, 30).forEach(i => {
        parts.push(`- [${i.tipo}] ${i.titulo}${i.angulo ? ' — ' + String(i.angulo).slice(0, 80) : ''}`);
      });
    }
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
  const angulosValidos = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  const tiposCampaña = new Set(['TOFU', 'MOFU', 'BOFU', 'retargeting', 'social_proof', 'branding']);
  const creenciasValidas = new Set(['1', '2', '3', '4', '5', '6']);
  if (!i || typeof i.titulo !== 'string' || !tiposValidos.has(i.tipo)) return null;
  const base = {
    titulo: String(i.titulo).slice(0, 200),
    tipo: i.tipo,
    formato: ['video', 'static', 'carrusel'].includes(i.formato) ? i.formato : 'static',
    estiloVisual: String(i.estiloVisual || '').slice(0, 250),
    angulo: String(i.angulo || '').slice(0, 500),
    painPoint: String(i.painPoint || '').slice(0, 500),
    hook: String(i.hook || '').slice(0, 300),
    escenarioNarrativo: String(i.escenarioNarrativo || '').slice(0, 2000),
    descripcionImagen: String(i.descripcionImagen || '').slice(0, 2500),
    promptGeneradorImagen: String(i.promptGeneradorImagen || '').slice(0, 2500),
    textoEnImagen: String(i.textoEnImagen || '').slice(0, 2000),
    copyPostMeta: String(i.copyPostMeta || '').slice(0, 3000),
    publicoSugerido: String(i.publicoSugerido || '').slice(0, 500),
    guion: String(i.guion || '').slice(0, 3500),
    razonamiento: String(i.razonamiento || '').slice(0, 700),
    anguloCategoria: angulosValidos.has(i.anguloCategoria) ? i.anguloCategoria : null,
    tipoCampaña: tiposCampaña.has(i.tipoCampaña) ? i.tipoCampaña : null,
    metaRiesgo: (i.metaRiesgo && typeof i.metaRiesgo === 'object') ? {
      tieneRiesgo: !!i.metaRiesgo.tieneRiesgo,
      palabras: Array.isArray(i.metaRiesgo.palabras) ? i.metaRiesgo.palabras.slice(0, 20).map(p => String(p).slice(0, 50)) : [],
      sugerencia: String(i.metaRiesgo.sugerencia || '').slice(0, 300),
    } : { tieneRiesgo: false, palabras: [], sugerencia: '' },
    variableDeTesteo: variablesValidas.has(i.variableDeTesteo) ? i.variableDeTesteo : 'mix',
    testHipotesis: String(i.testHipotesis || '').slice(0, 500),
    // Creencia apalancada (1..6 del doc de Beliefs). Si Claude devuelve
    // un valor fuera del enum (ej "1." o "creencia 1") logueamos warning
    // para no ocultar errores del modelo en silencio.
    creenciaApalancada: (() => {
      const raw = String(i.creenciaApalancada ?? '').trim();
      if (creenciasValidas.has(raw)) return raw;
      if (raw) console.warn('[generate-ideas] creenciaApalancada inválida, fallback a "1":', raw);
      return '1';
    })(),
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
    targetCount = 50,
    formatoMix = { static: 0.6, video: 0.4 },
  } = body || {};

  if (!producto || !producto.nombre) {
    return respondJSON(res, 400, { error: 'Falta producto.nombre en el body' });
  }

  // Cap 100 — por arriba Claude trunca output, no vale la pena pedir más.
  const clampedTarget = Math.max(1, Math.min(100, Number(targetCount) || 50));
  // 400 tokens por idea es realista para las ideas ricas con todos los campos.
  // 32k es el techo de output de Sonnet 4.6 con thinking apagado.
  const maxTokens = Math.min(32000, 1000 + clampedTarget * 400);

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
    stage: producto?.stage || 'problem_aware',
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
