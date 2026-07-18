// Detector de "cruce de categoría": compara el dominio del PRODUCTO
// (íntimo, pies, cara, etc.) con el dominio del AD que se va a usar como
// referencia. Si no matchean, avisamos al user ANTES de generar — así no
// gasta tokens en un creativo que va a salir hablando de otra cosa.
//
// Es una heurística de keywords, no un clasificador perfecto. Diseñada para
// MINIMIZAR falsos positivos: solo avisa cuando ambos lados tienen señal
// clara y CONTRADICTORIA. Si el ad no tiene texto suficiente o el dominio es
// ambiguo, no avisa (mejor callar que molestar de más).

// Cada dominio: label legible + regex de keywords fuertes.
const DOMAINS = [
  { key: 'intimo',   label: 'salud íntima / vaginal', re: /\b([íi]ntim[oa]s?|vaginal(es)?|flora [íi]ntima|flora vaginal|ph [íi]ntimo|ph vaginal|candidiasis|c[áa]ndida|flujo vaginal|zona [íi]ntima|higiene [íi]ntima|vulvar)\b/gi },
  { key: 'pies',     label: 'pies / talones',          re: /\b(pies?|talones?|tal[óo]n|planta del pie|pedicur|podolog|pie de atleta)\b/gi },
  { key: 'unas',     label: 'uñas',                    re: /\b(u[ñn]as?|onicomicosis|hongo de u[ñn]a)\b/gi },
  { key: 'cara',     label: 'cara / piel facial',      re: /\b(cara|rostro|facial|arrugas?|antiarrugas|cutis|poros|manchas? (de|en) la (cara|piel)|ojeras)\b/gi },
  { key: 'pelo',     label: 'cabello / cuero cabelludo', re: /\b(pelo|cabello|capilar|caspa|alopecia|calvicie|cuero cabelludo)\b/gi },
  { key: 'dientes',  label: 'dientes / sonrisa',       re: /\b(dientes?|dental|sonrisa|blanqueamiento dental|encías?)\b/gi },
  { key: 'articular', label: 'dolor / articulaciones', re: /\b(articulaciones?|rodillas?|dolor de espalda|lumbar|cervical|artritis|artrosis)\b/gi },
];

// Cuenta hits por dominio y devuelve el dominio dominante (o null si ninguno
// tiene señal clara). Requiere al menos 2 hits para considerarlo dominante,
// salvo que sea el único con señal.
function classifyText(text) {
  const t = (text || '').toString().toLowerCase();
  if (t.length < 8) return null;
  const scores = [];
  for (const d of DOMAINS) {
    const matches = t.match(d.re);
    const count = matches ? matches.length : 0;
    if (count > 0) scores.push({ key: d.key, label: d.label, count });
  }
  if (scores.length === 0) return null;
  scores.sort((a, b) => b.count - a.count);
  // Si el top tiene ventaja clara (o es el único), lo devolvemos.
  if (scores.length === 1 || scores[0].count > scores[1].count) {
    return scores[0];
  }
  // Empate entre 2+ dominios → ambiguo, no clasificamos.
  return null;
}

// Dominio del producto — desde nombre + descripción + research + avatar.
export function getProductDomain(producto) {
  const text = [
    producto?.nombre || '',
    producto?.descripcion || '',
    String(producto?.research || producto?.docs?.research || '').slice(0, 2000),
    String(producto?.avatar || producto?.docs?.avatar || '').slice(0, 1000),
  ].join(' ');
  return classifyText(text);
}

// Dominio de un ad — desde su headline + body.
export function getAdDomain(ad) {
  const text = [ad?.headline || '', ad?.body || ''].join(' ');
  return classifyText(text);
}

// Compara producto vs ad. Devuelve { mismatch, productDomain, adDomain }.
// mismatch=true solo si AMBOS tienen dominio claro Y son distintos.
export function checkAdProductMismatch(producto, ad) {
  const productDomain = getProductDomain(producto);
  const adDomain = getAdDomain(ad);
  const mismatch = !!(productDomain && adDomain && productDomain.key !== adDomain.key);
  return { mismatch, productDomain, adDomain };
}

// Para chequeo agregado (bulk): dado un producto + lista de ads, cuántos
// mismatchean y cuál es el dominio ajeno más común. Para un aviso único.
export function summarizeMismatch(producto, ads) {
  const productDomain = getProductDomain(producto);
  if (!productDomain) return { productDomain: null, mismatchCount: 0, total: ads?.length || 0, topOtherDomain: null };
  let mismatchCount = 0;
  const otherCounts = {};
  for (const ad of (ads || [])) {
    const adDomain = getAdDomain(ad);
    if (adDomain && adDomain.key !== productDomain.key) {
      mismatchCount++;
      otherCounts[adDomain.label] = (otherCounts[adDomain.label] || 0) + 1;
    }
  }
  const topOtherDomain = Object.entries(otherCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { productDomain, mismatchCount, total: ads?.length || 0, topOtherDomain };
}
