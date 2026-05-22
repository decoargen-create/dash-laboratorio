// Compositor del creativo. La IA genera el fondo + escena + producto SIN
// texto; acá dibujamos el titular y el botón de CTA por código. Así el
// texto del aviso sale siempre nítido y exacto — nunca alucinado por la IA.

// Extrae el texto del botón del layout que escribió el generador
// (idea.textoEnImagen suele tener una línea "CTA: ...").
export function extraerCTA(textoEnImagen) {
  if (!textoEnImagen) return '';
  const m = String(textoEnImagen).match(/CTA[:\s]*["']?([^"'\n]+)["']?/i);
  if (!m) return '';
  return m[1].trim().replace(/\s+/g, ' ').replace(/[→>\s]+$/, '').slice(0, 60);
}

function wrap(ctx, text, maxW) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Compone titular + CTA sobre la imagen base. Devuelve un data URL PNG.
// Si algo falla, devuelve la imagen base sin tocar.
export async function componerCreativo(baseDataUrl, { headline = '', cta = '', colorCta = '#b8895a' } = {}) {
  try {
    await Promise.all([
      document.fonts.load('800 80px Montserrat'),
      document.fonts.load('700 40px Montserrat'),
    ]);
  } catch { /* la fuente cae a system-ui */ }

  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(baseDataUrl);
    img.onload = () => {
      try {
        const W = img.naturalWidth || 1024;
        const H = img.naturalHeight || 1024;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        const pad = Math.round(W * 0.06);

        // --- Titular (zona superior) ---
        if (headline) {
          const maxW = W - pad * 2;
          let fontSize = Math.round(W * 0.088);
          let lines = [];
          const minSize = Math.round(W * 0.044);
          for (; fontSize >= minSize; fontSize -= 2) {
            ctx.font = `800 ${fontSize}px Montserrat, system-ui, sans-serif`;
            lines = wrap(ctx, headline, maxW);
            if (lines.length <= 3) break;
          }
          const lineH = fontSize * 1.14;
          const blockH = lineH * lines.length + pad;

          // Scrim degradado para que el titular se lea sobre cualquier fondo.
          const grad = ctx.createLinearGradient(0, 0, 0, blockH);
          grad.addColorStop(0, 'rgba(255,255,252,0.86)');
          grad.addColorStop(0.7, 'rgba(255,255,252,0.55)');
          grad.addColorStop(1, 'rgba(255,255,252,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, blockH);

          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.lineJoin = 'round';
          let y = pad + fontSize;
          for (const line of lines) {
            ctx.font = `800 ${fontSize}px Montserrat, system-ui, sans-serif`;
            ctx.lineWidth = Math.max(3, fontSize * 0.08);
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.strokeText(line, pad, y);
            ctx.fillStyle = '#1f2430';
            ctx.fillText(line, pad, y);
            y += lineH;
          }
        }

        // --- Botón CTA (zona inferior) ---
        if (cta) {
          const ctaFont = Math.round(W * 0.039);
          ctx.font = `700 ${ctaFont}px Montserrat, system-ui, sans-serif`;
          const textW = ctx.measureText(cta).width;
          const padX = W * 0.055;
          const btnW = Math.min(W - pad * 2, textW + padX * 2);
          const btnH = Math.round(ctaFont * 2.7);
          const btnX = (W - btnW) / 2;
          const btnY = H - pad - btnH;

          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.28)';
          ctx.shadowBlur = btnH * 0.32;
          ctx.shadowOffsetY = btnH * 0.12;
          ctx.fillStyle = colorCta || '#b8895a';
          roundRect(ctx, btnX, btnY, btnW, btnH, btnH / 2);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `700 ${ctaFont}px Montserrat, system-ui, sans-serif`;
          ctx.fillText(`${cta}  →`, W / 2, btnY + btnH / 2 + ctaFont * 0.06);
        }

        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(baseDataUrl);
      }
    };
    img.src = baseDataUrl;
  });
}
