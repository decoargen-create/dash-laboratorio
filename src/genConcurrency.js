// Semáforo global de llamadas de generación de imagen.
//
// POR QUÉ: el bulk de Inspiración corre un pool de ADS, y cada ad dispara
// nVar fetches a /api/marketing/crear-creativo-referencial. El techo real no
// es "cuántos ads" sino "cuántos fetches simultáneos" — pasado cierto punto
// OpenAI empieza a devolver 429 y el retry con backoff (15s/30s) come más
// tiempo del que ganamos. Este semáforo pone ese techo en un solo lugar, y
// además cubre el caso de un "Crear creativo" individual disparado mientras
// un bulk está corriendo (antes se sumaban sin que nadie los contara).
//
// NO afecta la calidad: es puro scheduling. Cada request sigue yendo con el
// mismo quality/size/plan que iba antes.

// 18 fetches en vuelo. Sube el throughput ~3x contra el pool viejo (que con
// 6 variantes por ad quedaba en 1 ad a la vez = 5-6 fetches) sin entrar en
// zona de rate-limit. Si en la práctica ves 429s en los logs, bajalo.
let LIMIT = 18;
let active = 0;
const queue = [];

function pump() {
  while (active < LIMIT && queue.length > 0) {
    const { fn, resolve, reject } = queue.shift();
    active++;
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => { active--; pump(); });
  }
}

// Corre fn() cuando haya slot libre. IMPORTANTE: fn NO se invoca hasta tener
// slot — así el AbortController de 330s que vive adentro del fetch empieza a
// contar recién cuando la request sale de verdad, y no se come el timeout
// esperando en la cola (ese era el bug de "cascada de timeouts" del pool
// fire-all-at-once).
export function withGenSlot(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

export function getGenConcurrency() {
  return { limit: LIMIT, active, queued: queue.length };
}

export function setGenConcurrency(n) {
  LIMIT = Math.max(1, Math.min(40, Number(n) || LIMIT));
  pump();
}

// Techo de fetches simultáneos — el bulk lo usa para dimensionar su pool de
// ads (POOL = LIMIT / variantes por ad) y así no encolar nunca.
export const TARGET_INFLIGHT = 18;
