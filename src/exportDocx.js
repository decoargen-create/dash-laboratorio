// Export de briefs de creativos a .docx profesional.
// Se usa el paquete `docx` (side-effect-free, client-side) para armar un
// Word formateado con portada, resumen, y una sección por cada idea.
//
// Consume las mismas ideas del store (bandejaStore) que el exporter .md.
// Diferencia: el .docx tiene headings con estilos de Word, tipografía
// consistente, y es lo que un coordinador de producción pega en un deck.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  PageBreak, BorderStyle, ShadingType, Table, TableRow, TableCell,
  WidthType,
} from 'docx';
import { TIPO_META } from './bandejaStore.js';

// Helpers para reducir boilerplate de docx.
const PALETA = {
  primario: '7C3AED', // púrpura — matches brand
  acento: 'DB2777',   // fucsia/pink
  muted: '6B7280',    // gray-500
  oscuro: '111827',   // gray-900
  claro: 'F3F4F6',    // gray-100
  codeBg: 'F9FAFB',   // gray-50
  codeBorder: 'E5E7EB', // gray-200
};

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, color: PALETA.primario, size: 36 })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    children: [new TextRun({ text, bold: true, color: PALETA.oscuro, size: 28 })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, color: PALETA.acento, size: 22 })],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.LEFT,
    children: [new TextRun({ text: String(text || ''), size: 22, color: opts.color || PALETA.oscuro })],
  });
}

function labelValue(label, value) {
  if (!value) return null;
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22, color: PALETA.muted }),
      new TextRun({ text: String(value), size: 22, color: PALETA.oscuro }),
    ],
  });
}

// Bloque de texto "código" — para prompts Nano Banana y texto que va dentro
// de la imagen. Mono + shading claro + borde sutil.
function codeBlock(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    shading: { type: ShadingType.CLEAR, fill: PALETA.codeBg },
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PALETA.codeBorder },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PALETA.codeBorder },
      left: { style: BorderStyle.SINGLE, size: 4, color: PALETA.codeBorder },
      right: { style: BorderStyle.SINGLE, size: 4, color: PALETA.codeBorder },
    },
    children: [
      new TextRun({
        text: String(text || ''),
        font: 'Consolas',
        size: 20,
        color: PALETA.oscuro,
      }),
    ],
  });
}

// Quote block para hook.
function quote(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    indent: { left: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 16, color: PALETA.acento } },
    children: [new TextRun({ text: String(text || ''), italics: true, size: 26, color: PALETA.oscuro })],
  });
}

// Tabla de specs rápido — tipo, formato, ángulo, público.
function specsTable(idea) {
  const tipo = TIPO_META[idea.tipo] || TIPO_META.desde_cero;
  const rows = [
    ['Tipo', `${tipo.emoji || ''} ${tipo.label || idea.tipo}`],
    ['Formato', idea.formato || '—'],
    ['Estilo visual', idea.estiloVisual || '—'],
    ['Ángulo', idea.angulo || '—'],
    ['Pain point', idea.painPoint || '—'],
    ['Campaña', idea.tipoCampaña || '—'],
    ['Variable de testeo', idea.variableDeTesteo || '—'],
  ].filter(r => r[1] && r[1] !== '—' && r[1] !== ' ');

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: PALETA.claro },
          children: [new Paragraph({
            children: [new TextRun({ text: label, bold: true, size: 20, color: PALETA.muted })],
          })],
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: String(value), size: 22, color: PALETA.oscuro })],
          })],
        }),
      ],
    })),
  });
}

function fechaHoy() {
  return new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Construye y descarga el .docx con las ideas dadas.
// producto: opcional, si lo pasamos agregamos el nombre en la portada.
export async function exportBriefDocx(ideas, producto = null) {
  if (!ideas || ideas.length === 0) {
    throw new Error('No hay ideas para exportar');
  }

  const byTipo = ideas.reduce((acc, i) => {
    (acc[i.tipo] = acc[i.tipo] || []).push(i);
    return acc;
  }, {});

  const children = [];

  // Portada
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 240 },
      children: [new TextRun({ text: 'Brief de creativos', bold: true, size: 64, color: PALETA.primario })],
    }),
  );
  if (producto?.nombre) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: producto.nombre, bold: true, size: 36, color: PALETA.oscuro })],
      }),
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: fechaHoy(), size: 24, color: PALETA.muted })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 2400 },
      children: [new TextRun({ text: `${ideas.length} piezas · ${Object.keys(byTipo).length} tipos`, size: 22, color: PALETA.muted })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // Índice por tipo
  children.push(h1('Índice'));
  const ordenTipos = ['replica', 'iteracion', 'diferenciacion', 'desde_cero'];
  let piezaGlobalIdx = 0;
  for (const tipo of ordenTipos) {
    const group = byTipo[tipo];
    if (!group || group.length === 0) continue;
    const meta = TIPO_META[tipo] || TIPO_META.desde_cero;
    children.push(h3(`${meta.emoji || ''} ${meta.label} — ${group.length} piezas`));
    if (meta.descripcion) children.push(p(meta.descripcion, { color: PALETA.muted }));
    group.forEach((idea) => {
      piezaGlobalIdx++;
      children.push(p(`PIEZA #${piezaGlobalIdx} — ${idea.titulo}`));
    });
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Piezas detalladas
  piezaGlobalIdx = 0;
  for (const tipo of ordenTipos) {
    const group = byTipo[tipo];
    if (!group || group.length === 0) continue;
    const meta = TIPO_META[tipo] || TIPO_META.desde_cero;
    children.push(h1(`${meta.emoji || ''} ${meta.label}`));
    if (meta.descripcion) children.push(p(meta.descripcion, { color: PALETA.muted }));

    group.forEach((idea) => {
      piezaGlobalIdx++;
      children.push(h2(`PIEZA #${piezaGlobalIdx} — ${idea.titulo}`));

      // Specs table
      children.push(specsTable(idea));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '' })] }));

      // Origen
      if (idea.origen?.competidorNombre) {
        const partes = [idea.origen.competidorNombre];
        if (idea.origen.daysRunning) partes.push(`${idea.origen.daysRunning}d corriendo`);
        const origen = labelValue('Origen', partes.join(' · '));
        if (origen) children.push(origen);
      }

      if (idea.origen?.razonamiento) {
        const raz = labelValue('Razonamiento', idea.origen.razonamiento);
        if (raz) children.push(raz);
      }

      if (idea.testHipotesis) {
        const hip = labelValue('Hipótesis a validar', idea.testHipotesis);
        if (hip) children.push(hip);
      }

      if (idea.metaRiesgo?.tieneRiesgo) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            shading: { type: ShadingType.CLEAR, fill: 'FEF3C7' },
            children: [
              new TextRun({ text: '⚠ Meta risk: ', bold: true, color: '92400E', size: 22 }),
              new TextRun({ text: String(idea.metaRiesgo.palabrasRiesgosas || 'Revisar'), color: '92400E', size: 22 }),
              ...(idea.metaRiesgo.sugerencia
                ? [new TextRun({ text: ` — ${idea.metaRiesgo.sugerencia}`, italics: true, color: '78350F', size: 22 })]
                : []),
            ],
          }),
        );
      }

      // Escenario narrativo
      if (idea.escenarioNarrativo) {
        children.push(h3('📖 Escenario narrativo'));
        children.push(p(idea.escenarioNarrativo));
      }

      // Hook
      if (idea.hook) {
        children.push(h3('🎯 Hook'));
        children.push(quote(idea.hook));
      }

      // Descripción imagen
      if (idea.descripcionImagen) {
        children.push(h3('🖼 Descripción de la imagen (para el diseñador)'));
        children.push(p(idea.descripcionImagen));
      }

      // Prompt Nano Banana
      if (idea.promptGeneradorImagen) {
        children.push(h3('🤖 Prompt Nano Banana / Midjourney (inglés)'));
        children.push(codeBlock(idea.promptGeneradorImagen));
      }

      // Texto en imagen
      if (idea.textoEnImagen) {
        children.push(h3('✍️ Texto que va DENTRO de la imagen'));
        children.push(codeBlock(idea.textoEnImagen));
      }

      // Copy post Meta
      if (idea.copyPostMeta) {
        children.push(h3('📱 Copy del post en Meta (arriba del creativo)'));
        children.push(p(idea.copyPostMeta));
      }

      // Guión (video)
      if (idea.guion && !/^n\/?a/i.test(idea.guion.trim())) {
        children.push(h3(idea.formato === 'video' ? '🎬 Guión (beats + VO)' : '🎬 Guión'));
        children.push(codeBlock(idea.guion));
      }

      // Público sugerido
      if (idea.publicoSugerido) {
        children.push(h3('🎯 Público sugerido'));
        children.push(p(idea.publicoSugerido));
      }

      // Notas
      if (idea.notas) {
        children.push(h3('📝 Notas internas'));
        children.push(p(idea.notas));
      }

      // Link ad original
      if (idea.origen?.adSnapshotUrl) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: 'Ad original: ', bold: true, size: 20, color: PALETA.muted }),
              new TextRun({ text: idea.origen.adSnapshotUrl, size: 20, color: PALETA.primario, underline: {} }),
            ],
          }),
        );
      }

      children.push(new Paragraph({ children: [new PageBreak()] }));
    });
  }

  const doc = new Document({
    creator: 'Viora Laboratorio',
    title: producto?.nombre ? `Brief de creativos — ${producto.nombre}` : 'Brief de creativos',
    description: 'Briefs generados por el pipeline de Viora',
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = producto?.nombre
    ? String(producto.nombre).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    : 'creativos';
  a.href = url;
  a.download = `brief-${slug}-${stamp}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
