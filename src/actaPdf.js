// Generación del PDF del acta con la MISMA estética que se ve en pantalla
// (papel de trabajo crema). Capturamos un nodo construido a medida con
// html2canvas y lo paginamos a A4 con jsPDF. Las dependencias se cargan
// dinámicamente para no engordar el bundle inicial.

const CREAM = '#F6F2E9';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prioColor(prioridad) {
  const p = String(prioridad || '').toLowerCase();
  if (p.startsWith('alta')) return '#C4533A';
  if (p.startsWith('baja')) return '#3E6B4F';
  return '#B7791F';
}

// Arma el documento como nodo DOM, reutilizando las clases cs-* ya inyectadas
// por el componente. Honra `sections` (qué secciones incluir). Las notas
// internas NUNCA se incluyen — el PDF es para el cliente.
function buildActaNode({ client, date, result, sections }) {
  const s = sections || {};
  const wrap = document.createElement('div');
  // consultoria-root aporta las variables de color, la tipografía base y el
  // fondo crema. Ancho fijo para una caja A4 prolija.
  wrap.className = 'consultoria-root';
  wrap.style.width = '780px';
  wrap.style.maxWidth = 'none';
  wrap.style.margin = '0';

  const parts = [];
  parts.push(`
    <header class="cs-doc-head">
      <p class="cs-kicker">mottaecom · consultoría</p>
      <h2 class="cs-serif cs-doc-title">Acta de reunión — ${esc(client || 'Cliente')}</h2>
      <p class="cs-mono" style="font-size:13px;color:#5C574C">${esc(date || '')}</p>
    </header>`);

  if (s.resumen && (result.resumen || (result.temas && result.temas.length))) {
    parts.push(`<section class="cs-section"><h3 class="cs-section-title">Resumen</h3>`);
    if (result.resumen) parts.push(`<p style="font-size:15.5px">${esc(result.resumen)}</p>`);
    if (result.temas && result.temas.length) {
      parts.push(`<div style="margin-top:14px">${result.temas.map(t => `<span class="cs-chip">${esc(t)}</span>`).join('')}</div>`);
    }
    parts.push(`</section>`);
  }

  if (s.diagnostico && result.diagnostico && result.diagnostico.length) {
    parts.push(`<section class="cs-section"><h3 class="cs-section-title">Lo que vimos</h3>`);
    parts.push(result.diagnostico.map(d => `
      <div class="cs-diag">
        <div class="cs-diag-title">${esc(d.titulo)}</div>
        <div class="cs-diag-detail">${esc(d.detalle)}</div>
      </div>`).join(''));
    parts.push(`</section>`);
  }

  if (s.tareas && result.tareas && result.tareas.length) {
    parts.push(`<section class="cs-section"><h3 class="cs-section-title">Tareas y pendientes</h3>`);
    parts.push(result.tareas.map(t => `
      <div class="cs-task">
        <span class="cs-pill" style="background:${prioColor(t.prioridad)}">${esc(t.prioridad || 'Media')}</span>
        <div class="cs-task-body">
          <div class="cs-task-text">${esc(t.tarea)}</div>
          <div class="cs-task-meta">${esc(t.responsable || 'Cliente')} · ${esc(t.plazo || 'A definir')}</div>
        </div>
      </div>`).join(''));
    parts.push(`</section>`);
  }

  if (s.plan && result.plan_accion && result.plan_accion.length) {
    parts.push(`<section class="cs-section"><h3 class="cs-section-title">Plan de acción</h3>`);
    parts.push(result.plan_accion.map((p, i) => `
      <div class="cs-step">
        <span class="cs-step-num">${String(i + 1).padStart(2, '0')}</span>
        <div>
          <div class="cs-step-title">${esc(p.paso)}</div>
          <div class="cs-step-detail">${esc(p.detalle)}</div>
        </div>
      </div>`).join(''));
    parts.push(`</section>`);
  }

  wrap.innerHTML = parts.join('');
  return wrap;
}

export async function descargarActaPDF({ client, date, result, sections, filename }) {
  const [jspdfMod, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const jsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const html2canvas = html2canvasMod.default;

  const node = buildActaNode({ client, date, result, sections });
  // Fuera de pantalla pero renderizado (html2canvas necesita layout real).
  node.style.position = 'fixed';
  node.style.left = '-10000px';
  node.style.top = '0';
  node.style.zIndex = '-1';
  document.body.appendChild(node);

  try {
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch {}
    }
    const canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: CREAM,
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();   // 210mm
    const pageH = pdf.internal.pageSize.getHeight();   // 297mm
    const pxPerMm = canvas.width / pageW;
    const pageHpx = Math.floor(pageH * pxPerMm);

    let offset = 0;
    let page = 0;
    while (offset < canvas.height) {
      const sliceHpx = Math.min(pageHpx, canvas.height - offset);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHpx;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = CREAM;
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, offset, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);
      const img = pageCanvas.toDataURL('image/jpeg', 0.95);
      const sliceHmm = sliceHpx / pxPerMm;
      if (page > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, pageW, sliceHmm);
      offset += sliceHpx;
      page++;
    }

    pdf.save(filename || `Acta ${client || 'cliente'}.pdf`);
  } finally {
    document.body.removeChild(node);
  }
}
