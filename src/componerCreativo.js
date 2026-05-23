// Compositor del creativo. La IA genera el fondo + escena + producto SIN
// texto; acá dibujamos el titular, un subcopy y el botón de CTA por código.
// Así el texto del aviso sale siempre nítido y exacto.

// Defaults de CTA por etapa de funnel, cuando la idea no trae un CTA propio.
const TIPO_CAMPAÑA_CTA = {
  TOFU: 'Conocé más',
  MOFU: 'Descubrí cómo',
  BOFU: 'Comprar ahora',
  retargeting: 'Volvé a verlo',
  social_proof: 'Ver opiniones',
  branding: 'Conocer la marca',
};

// Sanea un string: descarta prefijos tipo "button verde:" / "Botón:" /
// cualquier "Algo:" que el generador a veces inserta antes del CTA real.
function limpiarPrefijos(s) {
  let out = String(s || '').trim();
  out = out.replace(/^(?:button|botón|boton|bot[oó]n verde|cta)\s*[^:\n]*:\s*/i, '');
  // Cualquier prefijo "X:" corto adicional.
  if (/^[^:\n]{1,40}:\s/.test(out)) out = out.replace(/^[^:\n]{1,40}:\s+/, '');
  return out.replace(/^["']|["']$/g, '').trim();
}

// Extrae el texto del botón de la idea. Prefiere el contenido ENTRE COMILLAS
// después de "CTA:" (el generador suele escribir 'CTA: button verde:
// "Texto →"' y nuestra regex anterior se quedaba con "button verde:").
// Si no hay comillas, descarta prefijos. Si no hay nada, cae a un default
// por etapa de campaña.
export function extraerCTA(idea) {
  const t = idea?.textoEnImagen || '';
  let m = t.match(/CTA[\s:][^"\n]*"([^"\n]+)"/i);
  if (!m) m = t.match(/CTA[\s:][^'\n]*'([^'\n]+)'/i);
  if (m) {
    const s = limpiarPrefijos(m[1]).replace(/[→>"'\s]+$/, '').trim();
    if (s) return s.slice(0, 60);
  }
  // Sin comillas — tomamos toda la línea y limpiamos prefijos.
  const line = t.match(/CTA[:\s]+([^\n]+)/i);
  if (line) {
    const s = limpiarPrefijos(line[1]).replace(/[→>"'\s]+$/, '').trim();
    if (s && s.length >= 3) return s.slice(0, 60);
  }
  return TIPO_CAMPAÑA_CTA[idea?.tipoCampaña] || 'Quiero saber más';
}

// Extrae un subcopy/microcopy corto para reforzar el titular.
export function extraerSubcopy(idea) {
  const t = idea?.textoEnImagen || '';
  let m = t.match(/(?:MICROCOPY|SUBCOPY|MICRO|SUB|SUBTITULO|SUBTÍTULO)[\s:][^"\n]*"([^"\n]+)"/i);
  if (!m) m = t.match(/(?:MICROCOPY|SUBCOPY|MICRO|SUB|SUBTITULO|SUBTÍTULO)[\s:]+([^\n]+)/i);
  if (m) {
    const s = limpiarPrefijos(m[1]).slice(0, 110).trim();
    if (s) return s;
  }
  return '';
}

// Si el hook es largo (>50 chars), lo dividimos en titular punchy + segundo
// pedazo más chico como subcopy. Cortamos en el primer punto/punto y coma
// que deje un titular razonable (entre 20 y 55 chars).
function splitHook(hook) {
  const s = String(hook || '').trim();
  if (!s) return { headline: '', auto: '' };
  if (s.length <= 50) return { headline: s, auto: '' };
  const m = s.match(/^(.{18,58}?)[.;!?]\s+(.+)$/);
  if (m) return { headline: m[1].trim().replace(/[,;]+$/, ''), auto: m[2].trim() };
  return { headline: s, auto: '' };
}

// Devuelve { headline, subcopy } para componer sobre la imagen. Si la idea
// trae un subcopy explícito en textoEnImagen, lo usamos; si no, splitteamos
// el hook automáticamente.
export function extraerHeadlineYSubcopy(idea) {
  const hookCompleto = (idea?.hook || idea?.titulo || '').trim();
  const explicito = extraerSubcopy(idea);
  if (explicito) return { headline: hookCompleto, subcopy: explicito };
  const sp = splitHook(hookCompleto);
  return { headline: sp.headline, subcopy: sp.auto };
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

// Compone titular + subcopy + botón + (opcional) badge y estrellas sobre
// la imagen base. Devuelve un data URL PNG. Si algo falla, devuelve la base
// sin tocar.
export async function componerCreativo(baseDataUrl, {
  headline = '', subcopy = '', cta = '', colorCta = '#b8895a',
  badgeText = '', rating = 0, reviews = 0,
} = {}) {
  try {
    await Promise.all([
      document.fonts.load('800 80px Montserrat'),
      document.fonts.load('700 40px Montserrat'),
      document.fonts.load('500 30px Montserrat'),
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

        // --- Estrellas + reseñas (apenas arriba del titular) ---
        let starsBlockH = 0;
        if (rating > 0) {
          const sFont = Math.round(W * 0.032);
          const fullStars = Math.max(0, Math.min(5, Math.round(rating)));
          const starsTxt = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);
          const reviewsTxt = reviews > 0 ? `  ${reviews.toLocaleString('es-AR')}+ reseñas` : '';

          // medir total para el scrim
          ctx.font = `700 ${sFont * 1.3}px Montserrat, system-ui, sans-serif`;
          const starsW = ctx.measureText(starsTxt).width;
          ctx.font = `700 ${sFont}px Montserrat, system-ui, sans-serif`;
          const revsW = ctx.measureText(reviewsTxt).width;
          const totalW = starsW + revsW;
          // scrim chico detrás
          ctx.fillStyle = 'rgba(255,255,252,0.85)';
          ctx.fillRect(0, 0, totalW + pad * 2, sFont * 2.4);
          // stars dorados
          ctx.fillStyle = '#f59e0b';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.font = `700 ${sFont * 1.3}px Montserrat, system-ui, sans-serif`;
          ctx.fillText(starsTxt, pad, pad + sFont * 1.1);
          if (reviewsTxt) {
            ctx.fillStyle = '#374151';
            ctx.font = `700 ${sFont}px Montserrat, system-ui, sans-serif`;
            ctx.fillText(reviewsTxt, pad + starsW, pad + sFont * 1.1);
          }
          starsBlockH = sFont * 1.8;
        }

        // --- Titular (zona superior, debajo de las estrellas si las hay) ---
        let yCursor = pad + starsBlockH;
        let headlineBlockH = 0;
        if (headline) {
          const maxW = W - pad * 2;
          let fontSize = Math.round(W * 0.082);
          let lines = [];
          const minSize = Math.round(W * 0.042);
          for (; fontSize >= minSize; fontSize -= 2) {
            ctx.font = `800 ${fontSize}px Montserrat, system-ui, sans-serif`;
            lines = wrap(ctx, headline, maxW);
            if (lines.length <= 3) break;
          }
          const lineH = fontSize * 1.12;
          headlineBlockH = lineH * lines.length;

          // Scrim para legibilidad — abarca desde 0 (incluye estrellas) hasta
          // debajo del titular.
          const scrimH = starsBlockH + headlineBlockH + pad + (subcopy ? Math.round(W * 0.06) : 0);
          const grad = ctx.createLinearGradient(0, 0, 0, scrimH);
          grad.addColorStop(0, 'rgba(255,255,252,0.88)');
          grad.addColorStop(0.7, 'rgba(255,255,252,0.55)');
          grad.addColorStop(1, 'rgba(255,255,252,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, scrimH);

          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.lineJoin = 'round';
          let y = yCursor + fontSize;
          for (const line of lines) {
            ctx.font = `800 ${fontSize}px Montserrat, system-ui, sans-serif`;
            ctx.lineWidth = Math.max(3, fontSize * 0.08);
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.strokeText(line, pad, y);
            ctx.fillStyle = '#1f2430';
            ctx.fillText(line, pad, y);
            y += lineH;
          }
          yCursor = y;
        }

        // --- Subcopy (debajo del titular) ---
        if (subcopy) {
          const subFont = Math.round(W * 0.034);
          const maxW = W - pad * 2;
          ctx.font = `600 ${subFont}px Montserrat, system-ui, sans-serif`;
          const subLines = wrap(ctx, subcopy, maxW).slice(0, 2);
          const lineH = subFont * 1.22;
          let y = yCursor + subFont * 0.3;
          for (const line of subLines) {
            ctx.lineWidth = Math.max(2, subFont * 0.07);
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.strokeText(line, pad, y);
            ctx.fillStyle = '#3a3f4f';
            ctx.fillText(line, pad, y);
            y += lineH;
          }
        }

        // --- Badge / sello (esquina superior derecha) ---
        if (badgeText && badgeText.trim()) {
          const r = Math.round(W * 0.10);
          const cx = W - pad - r;
          const cy = pad + r;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-0.18);
          // sombra
          ctx.shadowColor = 'rgba(0,0,0,0.28)';
          ctx.shadowBlur = r * 0.45;
          ctx.shadowOffsetY = r * 0.12;
          // círculo principal
          ctx.fillStyle = '#dc2626';
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          // borde dorado
          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = r * 0.06;
          ctx.stroke();
          // texto centrado, auto-fit
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const text = String(badgeText).trim().toUpperCase();
          let fs = Math.round(r * 0.4);
          ctx.font = `900 ${fs}px Montserrat, system-ui, sans-serif`;
          while (ctx.measureText(text).width > r * 1.55 && fs > Math.round(r * 0.18)) {
            fs -= 1;
            ctx.font = `900 ${fs}px Montserrat, system-ui, sans-serif`;
          }
          // si entra en una línea
          ctx.fillText(text, 0, 0);
          ctx.restore();
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
