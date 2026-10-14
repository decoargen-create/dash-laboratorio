// Bloque de REALISMO FOTOGRÁFICO para los prompts de gpt-image-2.
//
// gpt-image tiende al "AI look" cuando hay personas: piel de cera, poros
// borrados, iluminación de beauty ad, manos raras. Este bloque (destilado de
// un prompt largo de fotografía documental) empuja al modelo hacia foto real:
// piel con textura, anatomía creíble, luz físicamente plausible y render de
// cámara full-frame.
//
// Se APLICA SOLO cuando la escena muestra humanos/piel (escenaConHumanos):
// en un packshot o una gráfica flat estas instrucciones diluyen el prompt y
// pueden arruinar estilos ilustrados a propósito.

// ¿La escena descrita incluye personas, manos o piel? Recibe cualquier mezcla
// de strings/objetos (skeleton, plan, idea, variation) y busca señales en
// inglés y castellano. Conservador: ante la duda, no aplica.
export function escenaConHumanos(...fuentes) {
  const h = fuentes
    .filter(Boolean)
    .map(f => (typeof f === 'string' ? f : JSON.stringify(f)))
    .join(' ')
    .toLowerCase();
  return /\b(person|people|woman|man|male|female|model|face|skin|hand|hands|arm|leg|body|selfie|ugc|influencer|wearing|holding|applying|portrait|persona|gente|mujer|hombre|modelo|rostro|cara|piel|mano|manos|brazo|pierna|cuerpo|sostiene|aplica|usa el producto)\b/.test(h);
}

// El bloque, en inglés como el resto del prompt de imagen. Compacto a
// propósito: un muro de texto diluye las instrucciones de composición.
export function realismoFotografico() {
  return [
    '**HUMAN PHOTOREALISM (CRITICAL — every person and every bit of skin in this image must read as a REAL, unretouched photograph, never AI):**',
    '  • SKIN: real living tissue — visible pores, fine lines, tiny vellus hairs, subtly uneven tone, natural redness and occasional freckles where plausible. NEVER wax, plastic, porcelain, airbrushed smoothness or beauty-filter perfection. Preserve microtexture without exaggerating it.',
    '  • ANATOMY: correct and organic — believable hands with five normal fingers, asymmetric features, natural relaxed posture, believable muscle/fat distribution, age-appropriate detail without caricature.',
    '  • LIGHT: soft directional daylight as from a real side window — realistic highlight-to-shadow transitions that reveal skin depth and contours, physically plausible shadow falloff, delicate specular highlights. NO artificial glow, flat beauty lighting, dramatic studio spotlight or heavy HDR.',
    '  • CAMERA: authentic full-frame photographic rendering — natural perspective, believable depth of field with organic falloff, a touch of sensor noise, neutral-warm white balance, lifelike skin undertones (red/peach/beige/brown). NO oversharpening, oversaturation, clarity filters or cinematic color grading.',
    '  • RESULT: documentary/editorial photography of a real person captured with a real camera — NOT CGI, 3D render, illustration, synthetic skin or an uncanny beauty-ad render.',
  ].join('\n');
}
