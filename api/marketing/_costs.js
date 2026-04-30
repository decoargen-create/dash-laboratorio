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
