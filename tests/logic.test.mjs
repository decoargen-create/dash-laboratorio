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
  columnaEfectiva, AUTO_ARCHIVE_MS,
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
console.log('\nVIDEOS + TARJETAS POR PRODUCTO:');
const vpCards = [
  { productoNombre: 'Cepillo Drenaje Linfatico', estado: 'porhacer', archivos: [{}] },   // 1 video, no entregada
  { productoNombre: 'Cepillo Drenaje Linfatico', estado: 'porhacer', archivos: [] },      // 0 video, no entregada
];
eq('2 tarjetas Cepillo: 1/18 videos, 0/2 entregadas', resumenVideosPorProducto(vpCards)[0], { producto: 'Cepillo Drenaje Linfatico', subidos: 1, target: 2 * VIDEOS_POR_PRODUCTO, tarjetas: 2, entregadas: 0, faltan: 2 * VIDEOS_POR_PRODUCTO - 1, pendientes: 2 });
// Entregadas = publicadas; pendientes = el resto (aprobado todavía "falta entregar")
const kit = [
  { productoNombre: 'Kit Inicial', estado: 'publicado', archivos: [] },
  { productoNombre: 'Kit Inicial', estado: 'aprobado', archivos: [] },
  { productoNombre: 'Kit Inicial', estado: 'porhacer', archivos: [] },
];
eq('Kit Inicial: 3 tarjetas, 1 entregada, 2 pendientes', (({ tarjetas, entregadas, pendientes }) => ({ tarjetas, entregadas, pendientes }))(resumenVideosPorProducto(kit)[0]), { tarjetas: 3, entregadas: 1, pendientes: 2 });
// Archivado también cuenta como entregada
eq('archivado cuenta como entregada', resumenVideosPorProducto([{ productoNombre: 'X', estado: 'archivado', archivos: [] }])[0].entregadas, 1);

// ─────────── AUTO-ARCHIVO (publicado +48h) ───────────
console.log('\nAUTO-ARCHIVO:');
const now = 1_000_000_000_000;
const pubHace = (ms) => ({ estado: 'publicado', historial: [{ tipo: 'estado', to: 'publicado', ts: new Date(now - ms).toISOString() }] });
eq('publicado hace 10h → sigue en publicado', columnaEfectiva(pubHace(10 * 3600e3), now), 'publicado');
eq('publicado hace 49h → archivado', columnaEfectiva(pubHace(49 * 3600e3), now), 'archivado');
eq('justo en 48h → todavía publicado (no supera)', columnaEfectiva(pubHace(AUTO_ARCHIVE_MS), now), 'publicado');
eq('estado archivado → archivado', columnaEfectiva({ estado: 'archivado' }, now), 'archivado');
eq('en revisión → revisión (no lo toca)', columnaEfectiva({ estado: 'revision' }, now), 'revision');

// ─────────── NOMENCLATURA DRIVE ───────────
console.log('\nNOMENCLATURA DRIVE:');
eq('abreviar "Cepillo Drenaje Linfatico" → CDL', abreviarProducto('Cepillo Drenaje Linfatico'), 'CDL');
eq('abreviar salta conectores "Crema de la Noche" → CN', abreviarProducto('Crema de la Noche'), 'CN');
eq('abreviar 1 palabra "Colageno" → Colageno', abreviarProducto('Colageno'), 'Colageno');
eq('shortId prodasig-…-vdagn → vdagn', shortId('prodasig-1787025026325-vdagn'), 'vdagn');
eq('cardFolder "Cepillo Facial [Francisco][13-8]"', cardFolderName('Cepillo Facial', 'Francisco', '2026-08-13'), 'Cepillo Facial [Francisco][13-8]');
eq('cardFolder sin persona → [Equipo]', cardFolderName('Colageno', '', '2026-08-05'), 'Colageno [Equipo][5-8]');
eq('clean saca caracteres inválidos', clean('Ana/Bea:1'), 'Ana Bea 1');
// finalFileName con reloj inyectado (17:05:30 UTC = 14:05:30 AR) → determinista
const fixed = new Date('2026-08-17T17:05:30Z');
eq('finalFileName "Fran - 2026-08-17 14.05.30 - CDL.mp4"', finalFileName('clip.MP4', 'Cepillo Drenaje Linfatico', 'Fran', fixed), 'Fran - 2026-08-17 14.05.30 - CDL.mp4');

// ─────────── RENOMBRE PUBLICADO (idempotente, sin guion) ───────────
console.log('\nRENOMBRE PUBLICADO:');
const cf = 'Cepillo Facial [Francisco][13-8]';
eq('agregar PUBLICADO', nombrePublicado(cf, true), `${cf} PUBLICADO`);
eq('sacar PUBLICADO', nombrePublicado(`${cf} PUBLICADO`, false), cf);
eq('re-publicar NO duplica sufijo', nombrePublicado(`${cf} PUBLICADO`, true), `${cf} PUBLICADO`);
eq('nombreBase saca convención vieja "— PUBLICADO"', nombreBase(`${cf} — PUBLICADO`), cf);

// ─────────── RESUMEN ───────────
console.log(`\n${'─'.repeat(40)}\nRESULTADO: ${pass} ✅   ${fail} ❌\n`);
process.exit(fail === 0 ? 0 : 1);
