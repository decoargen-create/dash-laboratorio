// Imágenes de ads de la competencia con COPIA PROPIA.
//
// Las URLs del CDN de Meta vencen en días: los ads scrapeados se veían en
// negro en otra PC o a las semanas. Ahora cada imagen se guarda (al scrapear,
// o en segundo plano la primera vez que se logra ver) en
//   creativos/<dueño>/ads/<adId>.jpg   (bucket público → la URL no vence)
// y la ruta es determinística: cualquier PC/cuenta del mismo dueño la arma
// sin depender de datos locales.

import { supabase } from './supabase.js';
import { ownerEfectivo } from './miembroStore.js';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
let _uid = null;
if (supabase) {
  supabase.auth.getSession().then(({ data }) => { _uid = data?.session?.user?.id || null; }).catch(() => {});
  supabase.auth.onAuthStateChange((_e, session) => { _uid = session?.user?.id || null; });
}

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

// URL de la copia guardada (puede no existir todavía: el <img> cae al CDN).
export function urlImagenGuardada(adId) {
  const owner = ownerEfectivo(_uid);
  if (!SUPA_URL || !owner || !adId) return null;
  return `${SUPA_URL}/storage/v1/object/public/creativos/${owner}/ads/${safeId(adId)}.jpg`;
}

// Pide guardar la copia de un ad cuya URL del CDN todavía funciona. Se
// agrupan de a 20 y se mandan juntas; cada ad se pide una sola vez por sesión.
const pedidos = new Set();
let cola = [];
let timer = null;
export function pedirGuardarImagenAd(adId, url) {
  if (!adId || !url || pedidos.has(String(adId))) return;
  pedidos.add(String(adId));
  cola.push({ id: String(adId), url });
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const lote = cola.splice(0, cola.length);
    for (let i = 0; i < lote.length; i += 20) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        await fetch('/api/marketing/ads-imagenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ ads: lote.slice(i, i + 20) }),
        });
      } catch { /* best-effort: se reintenta en otra sesión */ }
    }
  }, 2000);
}
