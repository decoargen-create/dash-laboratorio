// Helpers para calcular el costo real de cada llamada a Claude/Whisper
// según tokens/duración, y devolverlo al cliente para que lo loguée en
// GastosStack.

// Pricing de Claude Sonnet 4.6 (por 1M tokens):
//   input         $3.00
//   output        $15.00
//   cache write   $3.75  (1.25x)
//   cache read    $0.30  (1/10)
// Para Opus 4.7: 5 / 25 / 6.25 / 0.50 — ajustar si cambiamos de modelo.
export function anthropicCost(usage, model = 'claude-sonnet-4-6') {
  if (!usage) return 0;
  const isOpus = /opus/i.test(model);
  const PRICES = isOpus
    ? { input: 5, output: 25, write: 6.25, read: 0.50 }
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
