import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const svgPath = '/home/user/dash-laboratorio/public/adslab-favicon.svg';
const svgBuf = fs.readFileSync(svgPath);

const targets = [
  { name: 'adslab-pwa-192.png', size: 192 },
  { name: 'adslab-pwa-512.png', size: 512 },
  { name: 'adslab-apple-touch.png', size: 180 },
];

for (const t of targets) {
  const outPath = path.join('/home/user/dash-laboratorio/public', t.name);
  await sharp(svgBuf, { density: 600 })
    .resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  const stat = fs.statSync(outPath);
  console.log(`✓ ${t.name} (${t.size}px) — ${(stat.size/1024).toFixed(1)}KB`);
}
