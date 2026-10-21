import React from 'react';

// Kombi, el pulpo de Kombialo: la cara de la IA. Mismos trazos que
// PulpoKombi.tsx de Kombialo (estado "parpadea": tentáculos que se mecen,
// cuerpo que flota y ojos que parpadean). `chico` = versión de 3 tentáculos
// para menos de 40 px. `quieto` congela el movimiento (botones, íconos).
// Solo anima transform/opacity y se apaga con prefers-reduced-motion.
const TENT_GRANDE = [
  'M30 68 C26 82 20 88 16 98',
  'M45 72 C43 86 40 92 38 101',
  'M60 74 C60 88 60 94 60 102',
  'M75 72 C77 86 80 92 82 101',
  'M90 68 C94 82 100 88 104 98',
];
const TENT_CHICO = [TENT_GRANDE[0], TENT_GRANDE[2], TENT_GRANDE[4]];

const CSS = `
.kb-pk .kb-pk-t{animation:kbPkSway 3.2s ease-in-out infinite;transform-origin:60px 70px;transform-box:view-box}
.kb-pk .kb-pk-c{animation:kbPkFloat 3.8s ease-in-out infinite;transform-box:view-box}
.kb-pk .kb-pk-o{animation:kbPkBlink 5s ease-in-out infinite;transform-origin:60px 50px;transform-box:view-box}
.kb-pk.kb-pk-quieto *{animation:none!important}
@keyframes kbPkSway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes kbPkFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes kbPkBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@media (prefers-reduced-motion:reduce){.kb-pk *{animation:none!important}}
`;

export default function PulpoKombi({ size = 92, chico, quieto = false, color = '#009ffd', pupila = '#12121c', className = '', title = 'Kombi' }) {
  const esChico = chico ?? size < 40;
  const tentaculos = esChico ? TENT_CHICO : TENT_GRANDE;
  const sw = esChico ? 10 : 9;
  const ojo = esChico ? { rx: 11, ry: 12, r: 5 } : { rx: 10, ry: 11, r: 4.6 };
  return (
    <>
      <style>{CSS}</style>
      <svg
        viewBox="0 0 120 108"
        width={size}
        height={Math.round(size * 0.9)}
        role="img"
        aria-label={title}
        className={`kb-pk ${quieto ? 'kb-pk-quieto' : ''} ${className}`}
        style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
      >
        <g className="kb-pk-c">
          <g className="kb-pk-t">
            {tentaculos.map(d => (
              <path key={d} d={d} stroke={color} strokeWidth={sw} strokeLinecap="round" fill="none" />
            ))}
          </g>
          <path d="M18 62 C18 30 38 12 60 12 C82 12 102 30 102 62 C102 72 92 76 60 76 C28 76 18 72 18 62 Z" fill={color} />
          <g className="kb-pk-o">
            <ellipse cx="45" cy="50" rx={ojo.rx} ry={ojo.ry} fill="#fff" />
            <ellipse cx="75" cy="50" rx={ojo.rx} ry={ojo.ry} fill="#fff" />
            <circle cx="45" cy="51" r={ojo.r} fill={pupila} />
            <circle cx="75" cy="51" r={ojo.r} fill={pupila} />
          </g>
        </g>
      </svg>
    </>
  );
}
