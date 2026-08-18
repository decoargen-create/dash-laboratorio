// Tests de la LÓGICA pura de Producción. Importan el CÓDIGO REAL que se shipea
// (src/produccionCalc.js + api/produccion/_naming.js), no una copia — así si
// alguien cambia un cálculo o la nomenclatura, estos tests lo agarran.
//
// Corré con:  node tests/logic.test.mjs   (o  npm test)
// No prueba UI ni red; prueba que los cálculos/nomenclatura den lo esperado.

import {
  PAGO_POR_PRODUCTO, VIDEOS_POR_PRODUCTO, DEFAULT_BONUS_TRAMOS,
  bonusObjetivo, pagoProductoDeCfg, bonusDeCfg,
  numerarDuplicados, resumenVideosPorProducto,
} from '../src/produccionCalc.js';
import {
  clean, abreviarProducto, shortId, cardFolderName, finalFileName,
  nombreBase, nombrePublicado,
} from '../api/produccion/_naming.js';

let pass = 0, fail = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n       esperado: ${e}\n       obtuve:   ${g}`); }
};

// ─────────── PAGO POR PERSONA ───────────
console.log('\nPAGO POR PERSONA:');
eq('sin config → default $42k', pagoProductoDeCfg(null), PAGO_POR_PRODUCTO);
eq('Poncio $40k', pagoProductoDeCfg({ pagoProducto: 40000 }), 40000);
eq('bono default con 5 completos = 36k', bonusDeCfg(null, 5), 36000);
eq('bono default con 2 = 0', bonusDeCfg(null, 2), 0);
eq('bonusObjetivo escalonado (3→24k, 4→30k, 5→36k)', [bonusObjetivo(3), bonusObjetivo(4), bonusObjetivo(5)], [24000, 30000, 36000]);
eq('Poncio SIN bono (tramos vacíos) = 0', bonusDeCfg({ pagoProducto: 40000, bonusTramos: [] }, 5), 0);
eq('Panchito bono tramos: 4 completos = 30k', bonusDeCfg({ pagoProducto: 42000, bonusTramos: DEFAULT_BONUS_TRAMOS }, 4), 30000);
eq('tramos propios: cada 2 → $10k, con 3 = 10k', bonusDeCfg({ bonusTramos: [{ min: 2, monto: 10000 }] }, 3), 10000);
// Ganado del mes: Poncio 3 completos (40k) sin bono vs Panchito 4 (42k) + 30k
eq('Poncio ganado (3 compl, sin bono)', 3 * pagoProductoDeCfg({ pagoProducto: 40000 }) + bonusDeCfg({ pagoProducto: 40000, bonusTramos: [] }, 3), 120000);
eq('Panchito ganado (4 compl + bono)', 4 * pagoProductoDeCfg({ pagoProducto: 42000 }) + bonusDeCfg({ pagoProducto: 42000, bonusTramos: DEFAULT_BONUS_TRAMOS }, 4), 198000);

// ─────────── NUMERAR DUPLICADOS ───────────
console.log('\nNUMERAR DUPLICADOS:');
const dupCards = [
  { id: 'a', productoNombre: 'Cepillo', weekKey: '2026-08-17', createdAt: '2026-08-17T10:00' },
  { id: 'b', productoNombre: 'Cepillo', weekKey: '2026-08-17', createdAt: '2026-08-17T11:00' },
  { id: 'c', productoNombre: 'Colageno', weekKey: '2026-08-17', createdAt: '2026-08-17T10:00' },
];
eq('2 Cepillo misma semana → #1 y #2', numerarDuplicados(dupCards), { a: 1, b: 2 });
eq('producto único NO se numera', numerarDuplicados([{ id: 'x', productoNombre: 'Solo', weekKey: '2026-08-17' }]), {});

// ─────────── RESUMEN VIDEOS POR PRODUCTO ───────────
console.log('\nVIDEOS POR PRODUCTO:');
const vpCards = [
  { productoNombre: 'Cepillo Drenaje Linfatico', archivos: [{}] },   // 1 video
  { productoNombre: 'Cepillo Drenaje Linfatico', archivos: [] },     // 0 video
];
eq('2 tarjetas Cepillo: 1/18 faltan 17', resumenVideosPorProducto(vpCards)[0], { producto: 'Cepillo Drenaje Linfatico', subidos: 1, target: 2 * VIDEOS_POR_PRODUCTO, tarjetas: 2, faltan: 2 * VIDEOS_POR_PRODUCTO - 1 });

// ─────────── NOMENCLATURA DRIVE ───────────
console.log('\nNOMENCLATURA DRIVE:');
eq('abreviar "Cepillo Drenaje Linfatico" → CDL', abreviarProducto('Cepillo Drenaje Linfatico'), 'CDL');
eq('abreviar salta conectores "Crema de la Noche" → CN', abreviarProducto('Crema de la Noche'), 'CN');
eq('abreviar 1 palabra "Colageno" → Colageno', abreviarProducto('Colageno'), 'Colageno');
eq('shortId prodasig-…-vdagn → vdagn', shortId('prodasig-1787025026325-vdagn'), 'vdagn');
eq('cardFolder sem 17-8 · vdagn', cardFolderName('2026-08-17', 'prodasig-x-vdagn'), 'sem 17-8 · vdagn');
eq('clean saca caracteres inválidos', clean('Ana/Bea:1'), 'Ana Bea 1');
// finalFileName con reloj inyectado (17:05:30 UTC = 14:05:30 AR) → determinista
const fixed = new Date('2026-08-17T17:05:30Z');
eq('finalFileName "Fran - 2026-08-17 14.05.30 - CDL.mp4"', finalFileName('clip.MP4', 'Cepillo Drenaje Linfatico', 'Fran', fixed), 'Fran - 2026-08-17 14.05.30 - CDL.mp4');

// ─────────── RENOMBRE PUBLICADO (idempotente) ───────────
console.log('\nRENOMBRE PUBLICADO:');
eq('agregar PUBLICADO', nombrePublicado('sem 17-8 · vdagn', true), 'sem 17-8 · vdagn — PUBLICADO');
eq('sacar PUBLICADO', nombrePublicado('sem 17-8 · vdagn — PUBLICADO', false), 'sem 17-8 · vdagn');
eq('re-publicar NO duplica sufijo', nombrePublicado('sem 17-8 · vdagn — PUBLICADO', true), 'sem 17-8 · vdagn — PUBLICADO');
eq('nombreBase saca el sufijo', nombreBase('sem 17-8 · vdagn — PUBLICADO'), 'sem 17-8 · vdagn');

// ─────────── RESUMEN ───────────
console.log(`\n${'─'.repeat(40)}\nRESULTADO: ${pass} ✅   ${fail} ❌\n`);
process.exit(fail === 0 ? 0 : 1);
