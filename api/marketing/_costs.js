// Helpers para calcular el costo real de cada llamada a Claude/Whisper
// según tokens/duración, y devolverlo al cliente para que lo loguée en
// GastosStack.

// Pricing de Claude por 1M tokens. Haiku 4.5 es ~3x más barato que Sonnet —
// distinguir el modelo importa cuando un endpoint usa varios (ej:
// /api/marketing/generate hace 1 llamada con Sonnet + 4 con Haiku).
//   Sonnet 4.5/4.6:  input $3.00  · output $15.00 · write $3.75  · read $0.30
//   Haiku  4.5:      input $1.00  · output $5.00  · write $1.25  · read $0.10
//   Opus   4.7:      input $5.00  · output $25.00 · write $6.25  · read $0.50
export function anthropicCost(usage, model = 'claude-sonnet-4-6') {
  if (!usage) return 0;
  const isOpus = /opus/i.test(model);
  const isHaiku = /haiku/i.test(model);
  const PRICES = isOpus
    ? { input: 5, output: 25, write: 6.25, read: 0.50 }
    : isHaiku
      ? { input: 1, output: 5, write: 1.25, read: 0.10 }
      : { input: 3, output: 15, write: 3.75, read: 0.30 };
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const write = Number(usage.cache_creation_input_tokens || 0);
  const read = Number(usage.cache_read_input_tokens || 0);
  const cost = (input * PRICES.input + output * PRICES.output + write * PRICES.write + read * PRICES.read) / 1_000_000;
  return Math.round(cost * 10000) / 10000; // 4 decimales
}

// Pricing de OpenAI Whisper: $0.006 por minuto de audio transcrito.
export function whisperCost(durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const minutes = durationSeconds / 60;
  return Math.round(minutes * 0.006 * 10000) / 10000;
}

// Pricing de gpt-image-2 (token-based, similar a gpt-image-1):
//   text input:   $5  / 1M tokens
//   image input:  $10 / 1M tokens (relevante para /v1/images/edits con refs)
//   image output: $40 / 1M tokens
//
// Si la response de OpenAI incluye `usage` con counts, calculamos REAL.
// Si no, fallback a tabla por size+quality (educated guess basado en cuántos
// tokens genera cada combinación).
export function gptImageCost(usageOrEstimate, opts = {}) {
  // Caso A — calculamos REAL desde `usage` de la response de OpenAI.
  if (usageOrEstimate && typeof usageOrEstimate === 'object' && (usageOrEstimate.input_tokens != null || usageOrEstimate.output_tokens != null)) {
    const u = usageOrEstimate;
    const textIn  = Number(u.input_tokens_details?.text_tokens || 0);
    const imageIn = Number(u.input_tokens_details?.image_tokens || 0);
    const outTok  = Number(u.output_tokens || 0);
    // Fallback si no vinieron los details: estimamos que TODO el input es image.
    const totalIn = Number(u.input_tokens || 0);
    const imageInEff = imageIn || Math.max(0, totalIn - textIn);
    const cost = (textIn * 5 + imageInEff * 10 + outTok * 40) / 1_000_000;
    return Math.round(cost * 10000) / 10000;
  }
  // Caso B — estimación por size + quality. Basado en token counts conocidos
  // de gpt-image-1 escalados por pixel ratio para 2048×2048 (~4x el de 1024).
  // Incluye ~2 input images chicas + texto típico de ~1500 tokens.
  const size = opts.size || '1024x1024';
  const quality = opts.quality || 'high';
  // Output tokens aproximados según size + quality.
  const OUT_TOKENS = {
    'low':    { '1024x1024': 272,  '1024x1536': 408,  '1536x1024': 408,  '2048x2048': 1088 },
    'medium': { '1024x1024': 1056, '1024x1536': 1584, '1536x1024': 1584, '2048x2048': 4224 },
    'high':   { '1024x1024': 4160, '1024x1536': 6240, '1536x1024': 6240, '2048x2048': 16640 },
  };
  const out = OUT_TOKENS[quality]?.[size] ?? OUT_TOKENS.high['1024x1024'];
  const textIn  = 1500;
  const imageIn = 1280; // 2 refs típicas a ~640 cada una
  const cost = (textIn * 5 + imageIn * 10 + out * 40) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}
