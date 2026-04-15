// Genera los íconos PWA 192x192 y 512x512 a partir del SVG del favicon.
// Se corre manualmente con: node scripts/generate-pwa-icons.mjs
// No hace falta re-ejecutarlo a menos que cambie el logo.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PUBLIC = resolve(process.cwd(), 'public');

// SVG fuente: el favicon con la V dorada en fondo negro redondeado.
// Levantamos el tamaño del viewBox a 512 para que el render sea nítido.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9c99d"/>
      <stop offset=".5" stop-color="#b8895a"/>
      <stop offset="1" stop-color="#d6b084"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="92" fill="#0d0d0d"/>
  <text x="256" y="378" text-anchor="middle" font-family="'Brush Script MT', 'Snell Roundhand', cursive" font-size="410" font-style="italic" fill="url(#g)">V</text>
</svg>`;

async function main() {
  const svgBuffer = Buffer.from(svg, 'utf-8');
  for (const size of [192, 512]) {
    const out = resolve(PUBLIC, `viora-pwa-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`✓ ${out}`);
  }
  console.log('Listo. Los íconos están en public/.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
