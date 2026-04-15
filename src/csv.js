// Utilidades simples de CSV para export/import. No uso una lib para
// mantener el bundle chico. Maneja:
// - Escape de comillas, comas y newlines en strings.
// - Valores numéricos, booleanos y strings.
// - Parseo tolerante con separador coma y quote char '"'.

// Convierte un valor a su representación CSV (escapando si hace falta).
function csvEscape(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const str = String(value);
  // Si contiene coma, comilla o newline → envolver en "" y escapar "
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Genera un string CSV dado un array de objetos y un arreglo de columnas
// { key, label, serialize? }. serialize es opcional — si se pasa, se usa
// en lugar del valor directo (útil para flatten de objetos anidados).
export function generateCSV(rows, columns) {
  const header = columns.map(c => csvEscape(c.label ?? c.key)).join(',');
  const lines = rows.map(row => {
    return columns.map(c => {
      const raw = c.serialize ? c.serialize(row) : row[c.key];
      return csvEscape(raw);
    }).join(',');
  });
  return [header, ...lines].join('\n');
}

// Descarga un string como un archivo .csv. Solo funciona en browser.
export function downloadCSV(filename, csvContent) {
  if (typeof window === 'undefined') return;
  // BOM para que Excel detecte correctamente UTF-8 (con tildes y ñ)
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Parser básico de CSV. Maneja strings con comillas escapadas y separador
// por coma. No soporta todos los edge cases de RFC 4180 pero cubre los
// casos comunes (incluyendo los archivos que genera Excel).
export function parseCSV(text) {
  if (!text) return { header: [], rows: [] };
  const lines = [];
  let current = '';
  let inQuotes = false;
  // Primero dividimos en líneas respetando comillas
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; current += ch; }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current) lines.push(current);
      current = '';
      // Saltar \r\n como un solo terminador
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) return { header: [], rows: [] };

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  // Remover BOM del primer caracter si existe
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const header = parseLine(headerLine).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = values[idx] ?? '';
    });
    return obj;
  });
  return { header, rows };
}

// Helper: convierte un string tipo "123" o "1.5" a número, retorna fallback si falla
export function toNumber(str, fallback = 0) {
  if (str == null || str === '') return fallback;
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isNaN(n) ? fallback : n;
}

// Helper: convierte "true"/"1"/"sí"/"si" a true
export function toBool(str) {
  if (typeof str === 'boolean') return str;
  if (str == null) return false;
  const s = String(str).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'sí' || s === 'si' || s === 'yes';
}
