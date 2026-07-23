// Sanitización de prompts para minimizar rechazos del safety filter de
// gpt-image-2 / dall-e. Compartido entre todos los endpoints que generan
// imágenes (crear-creativo-referencial, generate-creative, etc.).
//
// OpenAI no permite desactivar el filter completamente — 'moderation: low'
// es el setting más permisivo. Esta capa de swaps es la defensa extra.

// Heurística: si el producto tiene palabras gatillo de wellness/cuidado
// íntimo, arrancamos directo en modo agresivo de sanitización.
export function isHighRiskCategory(producto) {
  const haystack = [
    producto?.nombre || '',
    producto?.descripcion || '',
    String(producto?.research || producto?.docs?.research || ''),
  ].join(' ').toLowerCase();
  const triggers = [
    /íntim[oa]/, /intimate/, /vagina/, /vulva/, /menstru/, /period/,
    /flora/, /probioti/, /candidi/, /fem(in)?(a|e)/, /mujer/, /woman/,
    /antibio/, /infecci/, /sangra/, /bleed/, /pee/, /pis/, /orina/,
    /sex/, /sexual/, /erecci/, /testoster/,
  ];
  return triggers.some(re => re.test(haystack));
}

// También aplica si el TEXTO en sí mismo tiene triggers — usado cuando no
// tenemos producto (ej. /api/marketing/generate-creative que recibe idea
// pero no producto).
export function isHighRiskText(text) {
  if (!text) return false;
  const haystack = String(text).toLowerCase();
  const triggers = [
    /íntim[oa]/, /intimate/, /vagina/, /vulva/, /menstru/, /period/,
    /flora íntima/, /probióti.*íntim/, /candidi/, /infecci[oó]n.*íntim/,
    /antibio/, /sangr/, /bleed/, /sex/, /sexual/, /erecci/, /testoster/,
  ];
  return triggers.some(re => re.test(haystack));
}

// "hongos", "infección", "candidiasis", "yeast" son safety-risk para el
// filtro de imágenes SOLO en contexto íntimo/genital (candidiasis vaginal).
// En un producto DERMATOLÓGICO (pies, uñas, piel, cuero cabelludo) son
// términos benignos y legítimos — swapearlos rompe el copy del creativo:
// "hongos en las uñas" salía como "desequilibrio en las uñas" (bug del Kit
// Inicial VYA / antihongos de uñas). Este helper decide si el contexto es
// benigno (dermatológico y NO íntimo) → en ese caso se preservan esos términos.
export function fungalTermsAreBenign(producto) {
  const haystack = [
    producto?.nombre || '',
    producto?.descripcion || '',
    String(producto?.research || producto?.docs?.research || ''),
  ].join(' ').toLowerCase();
  // Íntimo/genital gana: ahí "hongos" = candidiasis y SÍ hay que sanitizar.
  if (/\b([íi]ntim[oa]|vaginal|vulva|genital|candidiasis|c[áa]ndida|flujo vaginal|higiene [íi]ntima|feminine wellness|zona [íi]ntima|flora [íi]ntima|flora vaginal)\b/.test(haystack)) {
    return false;
  }
  // Dermatológico: pies, uñas, piel, cuero cabelludo → término benigno.
  return /\b(pies?|pie|u[ñn]as?|talones?|tal[óo]n|onicomicosis|pie de atleta|athlete'?s?\s*foot|dermat|piel|cutis|cuero cabelludo|scalp|caspa|nail|toe|foot|feet)\b/.test(haystack);
}

export function sanitizePromptForSafety(text, aggressive = false, opts = {}) {
  if (!text) return text;
  // keepFungalTerms=true (producto dermatológico) → NO tocamos hongos/
  // infección/candidiasis/yeast; en un antihongos de uñas/pies son legítimos.
  const keepFungalTerms = opts.keepFungalTerms === true;

  // Swaps universales — riesgo de safety en CUALQUIER contexto (anatomía
  // explícita, desnudez, claims médicos fuertes). Siempre se aplican.
  const swaps = [
    // Anatomía clínica → genérica
    [/\bvaginales?\b/gi, 'íntimo'],
    [/\bvagina\b/gi, 'zona íntima'],
    [/\bvulvas?\b/gi, 'zona íntima'],
    [/\bgenitales?\b/gi, 'íntimo'],
    [/\bsexuales?\b/gi, 'íntimo'],
    [/\bpechos?\b/gi, 'busto'],
    [/\bsenos?\b/gi, 'busto'],
    // Procesos clínicos → suaves
    [/\bmenstruales?\b/gi, 'mensual'],
    [/\bmenstruaci[óo]n\b/gi, 'ciclo'],
    [/\bsangrado\b/gi, 'flujo'],
    [/\bantibioticos?\b/gi, 'fórmula natural'],
    // Claims médicos fuertes → genéricos
    [/\bcura(n|r|do|s)?\b/gi, 'mejor$1'],
    [/\btrata(n|r|do|miento)?\b/gi, 'cuid$1'],
    [/\bdolor(es)?\b/gi, 'molestia$1'],
    [/\bsangre\b/gi, 'flujo'],
    [/\benferma|enferme(dad|s)\b/gi, 'condición'],
    // Inglés
    [/\bvagina(l)?\b/gi, 'intimate$1'],
    [/\bvulva\b/gi, 'intimate area'],
    [/\bgenital\b/gi, 'intimate'],
    [/\bbreasts?\b/gi, 'bust'],
    [/\bnaked\b/gi, ''],
    [/\bnude\b/gi, ''],
    [/\bantibiotics?\b/gi, 'natural formula'],
    [/\bbleed(ing)?\b/gi, 'flow$1'],
  ];

  // Swaps SOLO-íntimo: en dermatológico (pies/uñas/piel) estos términos son
  // legítimos, así que se preservan cuando keepFungalTerms.
  if (!keepFungalTerms) {
    swaps.push(
      [/\binfeccion(es)?\b/gi, 'molestia$1'],
      [/\bhongos?\b/gi, 'desequilibrio'],
      [/\bcandidiasis\b/gi, 'desequilibrio'],
      [/\bbacterian?a?s?\b/gi, 'microbiota'],
      [/\bclamidia\b/gi, 'desequilibrio'],
      [/\bcistitis\b/gi, 'molestia'],
      [/\binfection(s)?\b/gi, 'discomfort$1'],
      [/\byeast\b/gi, 'imbalance'],
    );
  }

  if (aggressive) {
    swaps.push(
      [/\b(antes|despu[ée]s)\s+y\s+despu[ée]s\b/gi, 'transformación'],
      [/\bbefore\s*(\/|and|\&)\s*after\b/gi, 'transformation'],
      [/\bíntim[oa]s?\b/gi, 'personal'],
      [/\bintimate\b/gi, 'personal'],
      [/\bzona personal\b/gi, 'cuidado personal'],
      [/\b(sin|sin más)\s+olor\b/gi, 'fresca'],
      [/\bodor\b/gi, 'freshness'],
    );
  }
  let out = text;
  for (const [re, rep] of swaps) out = out.replace(re, rep);
  return out;
}

// Detecta si un error de OpenAI es por safety filter.
export function isSafetyError(msg, code) {
  return /safety system|content policy|rejected by the safety|violates.*policy|moderation/i.test(msg || '') ||
         code === 'content_policy_violation' ||
         code === 'moderation_blocked';
}

// Convierte un error de OpenAI a mensaje accionable para el frontend.
export function friendlyOpenAIError(msg, code, status, model = 'gpt-image-2') {
  if (isSafetyError(msg, code)) {
    return `OpenAI rechazó por safety filter. Probá reescribir el hook/copy del ad o cambiar el ángulo (claims clínicos fuertes, palabras gatillo, etc. disparan el filter).`;
  }
  if (/insufficient_quota|exceeded.*quota|billing|payment/i.test(msg) || code === 'insufficient_quota') {
    return `OpenAI sin saldo. Cargá crédito en https://platform.openai.com/settings/organization/billing/overview`;
  }
  if (/invalid.*api.*key|incorrect.*api.*key/i.test(msg) || code === 'invalid_api_key') {
    return `OPENAI_API_KEY inválida en el servidor. Avisale al admin para que la rote.`;
  }
  if (/model.*(not.*(found|exist)|invalid)|the model.*does not exist/i.test(msg) || code === 'model_not_found') {
    return `El modelo ${model} no está disponible en tu cuenta de OpenAI.`;
  }
  if (status >= 500) {
    return `OpenAI con problemas (HTTP ${status}). Reintentá en 30-60s.`;
  }
  return `OpenAI rechazó: ${msg}`;
}
