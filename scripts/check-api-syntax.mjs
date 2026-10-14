// Chequeo de sintaxis de TODOS los .js de api/ — corre dentro de `npm test`.
//
// Por qué existe: Vite solo compila src/; la carpeta api/ (serverless de
// Vercel) no pasa por ningún parser en el build local. Un archivo roto ahí
// (p. ej. marcadores de conflicto de un merge) pasaba build + tests en verde
// y recién explotaba EN PRODUCCIÓN, tirando abajo todos los endpoints.
// Pasó una vez (14/10/2026, api/meta/[action].js) — nunca más.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;

function archivosJs(dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...archivosJs(p));
    else if (/\.(js|mjs)$/.test(nombre)) out.push(p);
  }
  return out;
}

let fallas = 0;
for (const archivo of archivosJs(join(raiz, 'api'))) {
  // Marcadores de conflicto: los detectamos aparte porque el mensaje de
  // SyntaxError de node es críptico; este es inconfundible.
  const contenido = readFileSync(archivo, 'utf8');
  if (/^(<{7} |>{7} )/m.test(contenido)) {
    console.error(`  ❌ ${archivo}: tiene MARCADORES DE CONFLICTO de git sin resolver`);
    fallas++;
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', archivo], { stdio: 'pipe' });
  } catch (e) {
    console.error(`  ❌ ${archivo}: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' · ')}`);
    fallas++;
  }
}

if (fallas > 0) {
  console.error(`\nSINTAXIS API: ${fallas} archivo(s) rotos — NO deployar.`);
  process.exit(1);
}
console.log('SINTAXIS API: todos los archivos de api/ parsean OK ✅');
