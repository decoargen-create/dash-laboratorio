// Núcleo de cálculo de Testeos — puro (sin red, sin React, sin estado).
//
// Vive acá y no en el server porque los umbrales los cambia el usuario en la
// UI: al mover "ROAS mínimo" de 1.5 a 1.8 el tablero se recalcula al instante
// sin volver a pedirle datos a Meta. El server solo trae los números crudos.
//
// Qué resuelve:
//   1. Leer el NOMBRE de la campaña para saber si es un testeo, de qué día es
//      y de qué producto. Meta no sabe nada de eso — es convención del equipo.
//   2. Agrupar por semana (lunes a domingo) y clasificar cada campaña en
//      ganadora / perdedora / sin datos suficientes.
//   3. Detectar anuncios PROSPECTADORES (llegan a gente nueva y venden).
//   4. Explicar CADA métrica: qué fórmula usa y con qué números, para poder
//      auditarla en la UI en vez de creerle.

// ── Configuración por defecto ────────────────────────────────────────────
// Todo editable desde la UI. Los defaults salen de cómo trabaja el equipo.
export const CFG_DEFAULT = {
  // Una campaña cuenta como testeo si su nombre contiene ALGUNA de estas...
  //
  // Los defaults salen de los nombres REALES de la cuenta:
  //   "Cepillo 22/8 [CBO Videos]"        → testeo
  //   "Cepillo 27/7 [ABO BIDCAP 25 a 35]" → escala (excluida)
  // Ojo: buscar la palabra "testeo" daría CERO, porque los nombres no la usan.
  // Lo que separa testeo de escala acá es la estructura (CBO vs ABO/bidcap/
  // costcap + rango de edad). Editable desde la UI: si el equipo cambia la
  // convención, se cambia la lista y el tablero se recalcula solo.
  palabrasTesteo: ['cbo', 'testeo', 'test'],
  // ...y NINGUNA de estas (las de escala no son testeos).
  palabrasExcluir: ['abo', 'bidcap', 'bid cap', 'costcap', 'cost cap', 'escala', 'escalado', 'scaling', 'winner'],
  // Además de la palabra, exigir fecha en el nombre para contarla como testeo.
  // Una campaña sin fecha no se puede asignar a ninguna semana.
  exigirFecha: true,

  // Ganador: las dos condiciones a la vez.
  minComprasGanador: 4,
  minRoasGanador: 1.5,

  // Margen bruto del producto (%). Si está seteado, el ROAS de corte se
  // DERIVA de él en vez de ser un número puesto a dedo: con 40% de margen,
  // el breakeven es 1 ÷ 0.40 = 2.5, y por debajo de eso vender pierde plata.
  // null = usar minRoasGanador tal cual.
  margenPct: null,
  // Cuánto por encima del breakeven para considerarlo ganador (1.2 = 20% de
  // colchón sobre el punto de equilibrio).
  factorSobreBreakeven: 1.2,

  // Overrides por producto: { [productoId]: { margenPct, minRoasGanador, ... } }.
  // El cepillo y la crema no tienen el mismo margen; el corte tampoco debería
  // ser el mismo.
  porProducto: {},

  // Piso para que una campaña tenga veredicto. Debajo de esto no es
  // "perdedora": es que no tuvo chance, y contarla hundiría la eficiencia.
  // Impresiones en vez de plata porque no depende de la moneda de la cuenta.
  minImpresiones: 1000,
  minGasto: 0,

  // Prospectador (a nivel ANUNCIO, ventana corta).
  ventanaProspDias: 7,
  maxFrecuenciaProsp: 1.10,
  minRoasProsp: 1.6,
  minComprasProsp: 2,
  minAlcanceProsp: 1000,

  // ── Pausado (la ronda de optimización del día) ──
  // Se mira el día de HOY, no la ventana larga.
  roasMaxPausar: 1.5,           // por debajo de esto es candidato
  sobrePromedioPct: 25,         // cuánto peor que el promedio de la cuenta
  pisoGastoPausar: 25000,       // en la moneda de la cuenta: debajo no tuvo chance
  horaMinimaPausar: 11,         // antes del mediodía el día no maduró (hora AR)
  consumoAltoPct: 90,           // si ya consumió esto del presupuesto, pausar no ahorra
};

// ROAS de equilibrio: por debajo de esto, cada venta pierde plata.
// Con 40% de margen bruto → 1 ÷ 0.40 = 2.5.
export function roasBreakeven(margenPct) {
  const m = Number(margenPct);
  if (!(m > 0 && m < 100)) return null;
  return 100 / m;
}

// Config efectiva para un producto: base + override del producto + ROAS de
// corte derivado del margen si hay margen cargado.
//
// Es lo que permite que la misma herramienta sirva para otra tienda: se cambia
// el perfil, no el código.
export function cfgPara(cfg = CFG_DEFAULT, productoId = null) {
  const base = { ...CFG_DEFAULT, ...cfg };
  const over = productoId && cfg?.porProducto ? (cfg.porProducto[productoId] || {}) : {};
  const efectiva = { ...base, ...over };

  // El ROAS de equilibrio puede venir de dos lados, en este orden:
  //   1. Anotado a mano para ese producto (`roasBreakeven`) — es como trabaja
  //      el equipo: cada producto tiene el suyo apuntado.
  //   2. Derivado del margen bruto, si en vez del breakeven cargaron el margen.
  const be = (Number(over.roasBreakeven) || Number(base.roasBreakeven)) || roasBreakeven(efectiva.margenPct);
  if (be != null && be > 0) {
    efectiva.roasBreakeven = be;
    // El corte de ganador sale del breakeven salvo que el perfil lo pise a mano.
    if (over.minRoasGanador == null && (cfg?.minRoasGanador == null || over.roasBreakeven != null)) {
      efectiva.minRoasGanador = +(be * (efectiva.factorSobreBreakeven || 1)).toFixed(2);
    }
    // El corte de pausado es el breakeven puro: por debajo, perdés plata.
    if (over.roasMaxPausar == null && (cfg?.roasMaxPausar == null || over.roasBreakeven != null)) {
      efectiva.roasMaxPausar = +be.toFixed(2);
    }
  } else {
    efectiva.roasBreakeven = null;
  }
  return efectiva;
}

// ── Texto ────────────────────────────────────────────────────────────────

// Minúsculas, sin acentos, espacios normalizados. Para comparar nombres sin
// que un "Cepillo" y un "cepíllo " cuenten como cosas distintas.
export function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Fecha en el nombre ───────────────────────────────────────────────────

// Saca la fecha de lanzamiento del nombre de la campaña: "cepillo 15/8",
// "[15-08]", "crema 15.8.26". Formato argentino (día primero).
//
// Toma el ÚLTIMO match del nombre: la fecha suele ir al final y así un "2x1"
// o un "kit 3/6" al principio no la pisan.
//
// Sin año, elige el que deja la fecha en el pasado cercano: si dd/mm de este
// año cae más de 15 días en el futuro, es del año pasado (un "28/12" mirado
// en enero es de diciembre pasado, no del que viene).
export function fechaDelNombre(nombre, hoy = new Date()) {
  const txt = String(nombre || '');
  const re = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{2,4}))?/g;
  let m, ultimo = null;
  while ((m = re.exec(txt)) !== null) ultimo = m;
  if (!ultimo) return null;

  const dia = Number(ultimo[1]);
  const mes = Number(ultimo[2]);
  if (!(dia >= 1 && dia <= 31) || !(mes >= 1 && mes <= 12)) return null;

  let anio;
  if (ultimo[3]) {
    const n = Number(ultimo[3]);
    anio = n < 100 ? 2000 + n : n;
  } else {
    anio = hoy.getFullYear();
    const tentativa = Date.UTC(anio, mes - 1, dia);
    const limite = hoy.getTime() + 15 * 24 * 60 * 60 * 1000;
    if (tentativa > limite) anio -= 1;
  }

  // Validación real (31/2 no existe).
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Lunes de la semana de una fecha 'YYYY-MM-DD' → 'YYYY-MM-DD'. La semana del
// equipo es lunes a domingo.
export function lunesDe(fecha) {
  if (!fecha) return null;
  const [y, m, d] = String(fecha).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 dom … 6 sab
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
}

// "Semana del 18/8 al 24/8" — etiqueta legible de una cohorte.
export function etiquetaSemana(lunes) {
  if (!lunes) return 'Sin fecha en el nombre';
  const [y, m, d] = lunes.split('-').map(Number);
  const ini = new Date(Date.UTC(y, m - 1, d));
  const fin = new Date(ini); fin.setUTCDate(ini.getUTCDate() + 6);
  const f = (dt) => `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`;
  return `${f(ini)} al ${f(fin)}`;
}

// ── Clasificación por nombre ─────────────────────────────────────────────

// ¿Es campaña de testeo? Tiene que tener alguna palabra de testeo y ninguna
// de las excluidas. Devuelve el motivo para poder mostrarlo en la UI.
export function tipoDeCampana(nombre, cfg = CFG_DEFAULT, hoy = new Date()) {
  const n = normalizar(nombre);
  const excluida = (cfg.palabrasExcluir || []).find(p => n.includes(normalizar(p)));
  if (excluida) return { tipo: 'excluida', motivo: `dice "${excluida}" → es de escala` };
  const marca = (cfg.palabrasTesteo || []).find(p => n.includes(normalizar(p)));
  if (!marca) return { tipo: 'otra', motivo: 'no dice ninguna palabra de testeo' };
  if (cfg.exigirFecha && !fechaDelNombre(nombre, hoy)) {
    return { tipo: 'sin-fecha', motivo: `dice "${marca}" pero no tiene fecha en el nombre` };
  }
  return { tipo: 'testeo', motivo: `dice "${marca}" + fecha en el nombre` };
}

// Qué producto es, cruzando el nombre de la campaña contra los productos que
// ya están cargados en AdsLab. Gana el que coincide en más palabras (así
// "Kit inicial" le gana a "Kit" cuando la campaña dice las dos).
export function productoDeCampana(nombre, productos = []) {
  const n = normalizar(nombre);
  const vacias = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'por', 'a', 'en', 'kit']);
  let mejor = null;
  for (const p of productos) {
    const nom = typeof p === 'string' ? p : p?.nombre;
    if (!nom) continue;
    const tokens = normalizar(nom).split(' ').filter(t => t.length >= 3 && !vacias.has(t));
    if (tokens.length === 0) continue;
    const aciertos = tokens.filter(t => n.includes(t));
    if (aciertos.length === 0) continue;
    const puntaje = aciertos.length * 100 + aciertos.join('').length;
    if (!mejor || puntaje > mejor.puntaje) {
      mejor = { id: typeof p === 'string' ? nom : (p.id ?? nom), nombre: nom, puntaje, aciertos };
    }
  }
  return mejor ? { id: mejor.id, nombre: mejor.nombre, coincidio: mejor.aciertos } : null;
}

// ── Veredicto de una campaña ─────────────────────────────────────────────

// 'ganador' | 'perdedor' | 'sin-datos'. El tercer estado existe para que el
// porcentaje de eficiencia no mienta: una campaña con 200 impresiones no
// fracasó, no tuvo chance.
export function veredicto(ins, cfg = CFG_DEFAULT) {
  const impresiones = Number(ins?.impressions || 0);
  const gasto = Number(ins?.spend || 0);
  const compras = Number(ins?.purchases || 0);
  const roas = Number(ins?.roas || 0);

  if (impresiones < (cfg.minImpresiones || 0) || gasto < (cfg.minGasto || 0)) {
    return {
      estado: 'sin-datos',
      motivo: `solo ${Math.round(impresiones)} impresiones (mínimo ${cfg.minImpresiones})`,
    };
  }
  const cumpleCompras = compras >= cfg.minComprasGanador;
  const cumpleRoas = roas >= cfg.minRoasGanador;
  if (cumpleCompras && cumpleRoas) {
    return { estado: 'ganador', motivo: `${compras} compras y ROAS ${roas.toFixed(2)}` };
  }
  const falta = [];
  if (!cumpleCompras) falta.push(`compras ${compras} < ${cfg.minComprasGanador}`);
  if (!cumpleRoas) falta.push(`ROAS ${roas.toFixed(2)} < ${cfg.minRoasGanador}`);
  return { estado: 'perdedor', motivo: falta.join(' · ') };
}

// ── Prospectador ─────────────────────────────────────────────────────────

// Un anuncio prospectador es el que sigue trayendo gente NUEVA y además
// vende. La señal de "gente nueva" es la frecuencia baja en la ventana: si en
// 7 días cada persona lo vio ~1 vez, la audiencia se está renovando.
//
// Ojo: la frecuencia tiene que medirse sobre la VENTANA (5-7 días). Medida por
// día da ~1.0 siempre y no dice nada.
export function esProspectador(ins, cfg = CFG_DEFAULT) {
  const freq = Number(ins?.frequency || 0);
  const roas = Number(ins?.roas || 0);
  const compras = Number(ins?.purchases || 0);
  const alcance = Number(ins?.reach || 0);

  const checks = [
    { ok: freq > 0 && freq <= cfg.maxFrecuenciaProsp, texto: `frecuencia ${freq.toFixed(2)} ≤ ${cfg.maxFrecuenciaProsp}` },
    { ok: roas >= cfg.minRoasProsp, texto: `ROAS ${roas.toFixed(2)} ≥ ${cfg.minRoasProsp}` },
    { ok: compras >= cfg.minComprasProsp, texto: `compras ${compras} ≥ ${cfg.minComprasProsp}` },
    { ok: alcance >= cfg.minAlcanceProsp, texto: `alcance ${Math.round(alcance)} ≥ ${cfg.minAlcanceProsp}` },
  ];
  return { es: checks.every(c => c.ok), checks };
}

// ── Agregación ───────────────────────────────────────────────────────────

// Suma insights crudos y recalcula los ratios sobre las SUMAS. Promediar los
// ROAS de cada campaña daría un número que no existe: una campaña de $2
// pesaría igual que una de $2000.
export function sumarInsights(lista) {
  const t = lista.reduce((acc, i) => {
    acc.spend += Number(i?.spend || 0);
    acc.impressions += Number(i?.impressions || 0);
    acc.reach += Number(i?.reach || 0);
    acc.clicks += Number(i?.clicks || 0);
    acc.purchases += Number(i?.purchases || 0);
    acc.revenue += Number(i?.revenue || 0);
    acc.addToCart += Number(i?.addToCart || 0);
    acc.initiateCheckout += Number(i?.initiateCheckout || 0);
    return acc;
  }, { spend: 0, impressions: 0, reach: 0, clicks: 0, purchases: 0, revenue: 0, addToCart: 0, initiateCheckout: 0 });
  t.roas = t.spend > 0 ? t.revenue / t.spend : 0;
  t.cpa = t.purchases > 0 ? t.spend / t.purchases : 0;
  t.costoPorATC = t.addToCart > 0 ? t.spend / t.addToCart : null;
  t.costoPorCheckout = t.initiateCheckout > 0 ? t.spend / t.initiateCheckout : null;
  return t;
}

// Arma las cohortes semanales a partir de las campañas ya normalizadas.
//
// campanas: [{ id, name, effectiveStatus, insights: {...} }]
// Devuelve una fila por semana (lunes), ordenada de la más nueva a la más
// vieja, con el veredicto de cada campaña adentro para poder abrir Meta con
// las que uno quiera.
export function cohortesSemanales(campanas, { cfg = CFG_DEFAULT, productos = [], productoId = null, hoy = new Date() } = {}) {
  const enriquecidas = (campanas || []).map(c => {
    const tipo = tipoDeCampana(c.name, cfg, hoy);
    const fecha = fechaDelNombre(c.name, hoy);
    const producto = productoDeCampana(c.name, productos);
    return {
      ...c,
      tipo: tipo.tipo,
      tipoMotivo: tipo.motivo,
      fecha,
      semana: lunesDe(fecha),
      producto,
      veredicto: veredicto(c.insights, cfg),
      activa: c.effectiveStatus === 'ACTIVE',
    };
  });

  // Solo testeos, y del producto elegido si hay filtro.
  const testeos = enriquecidas.filter(c =>
    c.tipo === 'testeo' && (!productoId || c.producto?.id === productoId));

  const porSemana = new Map();
  for (const c of testeos) {
    const k = c.semana || 'sin-fecha';
    if (!porSemana.has(k)) porSemana.set(k, []);
    porSemana.get(k).push(c);
  }

  const filas = [...porSemana.entries()].map(([semana, items]) => {
    const ganadoras = items.filter(c => c.veredicto.estado === 'ganador');
    const perdedoras = items.filter(c => c.veredicto.estado === 'perdedor');
    const sinDatos = items.filter(c => c.veredicto.estado === 'sin-datos');
    const conVeredicto = ganadoras.length + perdedoras.length;
    return {
      semana: semana === 'sin-fecha' ? null : semana,
      etiqueta: semana === 'sin-fecha' ? 'Sin fecha en el nombre' : etiquetaSemana(semana),
      lanzadas: items.length,
      ganadoras: ganadoras.length,
      perdedoras: perdedoras.length,
      sinDatos: sinDatos.length,
      conVeredicto,
      // Eficiencia sobre las que tuvieron chance, no sobre todas.
      eficiencia: conVeredicto > 0 ? (ganadoras.length / conVeredicto) * 100 : 0,
      activas: items.filter(c => c.activa).length,
      totales: sumarInsights(items.map(c => c.insights)),
      items,
      idsGanadoras: ganadoras.map(c => c.id),
      idsTodas: items.map(c => c.id),
    };
  });

  filas.sort((a, b) => {
    if (!a.semana) return 1;
    if (!b.semana) return -1;
    return b.semana.localeCompare(a.semana);
  });

  return { filas, enriquecidas, descartadas: enriquecidas.filter(c => c.tipo !== 'testeo') };
}

// ── Ronda de optimización: qué pausar hoy ───────────────────────────────
//
// Replica la rutina manual: mirar el día de HOY, ordenar por ROAS, y bajar el
// pulgar sobre lo que gasta bien pero no convierte. La diferencia es que acá
// las condiciones son explícitas y auditables en vez de "ojo de buen cubero".
//
// Un candidato tiene que cumplir TODO esto:
//   1. Ya gastó lo suficiente hoy (piso) — si no, no tuvo chance.
//   2. ROAS de hoy por debajo del mínimo.
//   3. Su costo por agregar al carrito Y su costo por iniciar pago están al
//      menos X% por encima del promedio de la cuenta de hoy.
//
// Y además se ordena por PLATA EN RIESGO (presupuesto que le queda por gastar
// hoy), porque pausar algo que ya quemó todo su presupuesto no ahorra nada.

// Promedio de la cuenta para el día: se calcula sobre las SUMAS de todo lo
// que corrió hoy, no promediando los costos de cada campaña (una campaña de
// $2 pesaría igual que una de $200.000).
export function promediosDelDia(items) {
  return sumarInsights((items || []).map(i => i.insights));
}

// Hora local de Argentina (0-23). El día publicitario no madura hasta el
// mediodía: a las 9 AM casi todo parece un desastre.
export function horaAR(ahora = new Date()) {
  const h = ahora.toLocaleString('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false,
  });
  return Number(h);
}

// Evalúa UN item (anuncio, conjunto o campaña) contra la regla de pausado.
// `item.insights` son los números de HOY; `item.dailyBudget` su presupuesto
// diario (puede venir null si el presupuesto está en otro nivel).
export function evaluarPausa(item, promedios, cfg = CFG_DEFAULT) {
  const ins = item?.insights || {};
  const gasto = Number(ins.spend || 0);
  const roas = Number(ins.roas || 0);
  const costoATC = ins.addToCart > 0 ? gasto / ins.addToCart : null;
  const costoCheckout = ins.initiateCheckout > 0 ? gasto / ins.initiateCheckout : null;

  const factor = 1 + (cfg.sobrePromedioPct || 0) / 100;
  const umbralATC = promedios?.costoPorATC != null ? promedios.costoPorATC * factor : null;
  const umbralCheckout = promedios?.costoPorCheckout != null ? promedios.costoPorCheckout * factor : null;

  // Un item SIN carritos ni checkouts habiendo gastado el piso es peor que
  // uno caro: no llegó a ninguna parte. Cuenta como que supera el umbral.
  const atcMalo = costoATC == null ? gasto > 0 : (umbralATC != null && costoATC > umbralATC);
  const checkoutMalo = costoCheckout == null ? gasto > 0 : (umbralCheckout != null && costoCheckout > umbralCheckout);

  const condiciones = [
    {
      clave: 'piso',
      ok: gasto >= (cfg.pisoGastoPausar || 0),
      texto: `gastó ${Math.round(gasto)} (piso ${cfg.pisoGastoPausar})`,
    },
    {
      clave: 'roas',
      ok: roas < (cfg.roasMaxPausar ?? 0),
      texto: `ROAS ${roas.toFixed(2)} < ${cfg.roasMaxPausar}`,
    },
    {
      clave: 'atc',
      ok: atcMalo,
      texto: costoATC == null
        ? 'ningún carrito'
        : `costo por carrito ${Math.round(costoATC)} vs ${umbralATC != null ? Math.round(umbralATC) : '—'} (promedio +${cfg.sobrePromedioPct}%)`,
    },
    {
      clave: 'checkout',
      ok: checkoutMalo,
      texto: costoCheckout == null
        ? 'ningún pago iniciado'
        : `costo por pago iniciado ${Math.round(costoCheckout)} vs ${umbralCheckout != null ? Math.round(umbralCheckout) : '—'} (promedio +${cfg.sobrePromedioPct}%)`,
    },
  ];

  const candidato = condiciones.every(c => c.ok);

  // Plata en riesgo: lo que le queda por gastar hoy. Es lo que ahorrás si lo
  // pausás ahora, y por eso ordena la lista.
  const presupuesto = item?.dailyBudget != null ? Number(item.dailyBudget) : null;
  const restante = presupuesto != null ? Math.max(0, presupuesto - gasto) : null;
  const consumidoPct = presupuesto > 0 ? (gasto / presupuesto) * 100 : null;
  const yaQuemado = consumidoPct != null && consumidoPct >= (cfg.consumoAltoPct || 100);

  return {
    candidato,
    condiciones,
    costoATC,
    costoCheckout,
    umbralATC,
    umbralCheckout,
    presupuesto,
    restante,
    consumidoPct,
    // Sin presupuesto conocido no podemos calcular el ahorro: no es motivo
    // para esconderlo, pero sí para no ponerlo arriba de todo.
    plataEnRiesgo: restante ?? 0,
    // "Pausar ahora ahorra" vs "ya se gastó, dejalo morir".
    accion: !candidato ? null : (yaQuemado ? 'dejar-correr' : 'pausar'),
    motivoAccion: !candidato
      ? null
      : yaQuemado
        ? `ya consumió el ${Math.round(consumidoPct)}% del presupuesto: pausarlo no ahorra casi nada`
        : restante != null
          ? `le quedan ${Math.round(restante)} por gastar hoy`
          : 'sin presupuesto diario propio (está a nivel conjunto)',
  };
}

// Lista completa de la ronda: ordena por plata en riesgo desc.
// `temprano` avisa que el día todavía no maduró (antes de la hora mínima).
export function rondaDeOptimizacion(items, { cfg = CFG_DEFAULT, ahora = new Date() } = {}) {
  const promedios = promediosDelDia(items);
  const evaluados = (items || []).map(i => ({ ...i, pausa: evaluarPausa(i, promedios, cfg) }));
  const candidatos = evaluados
    .filter(i => i.pausa.candidato)
    .sort((a, b) => b.pausa.plataEnRiesgo - a.pausa.plataEnRiesgo);

  const hora = horaAR(ahora);
  return {
    promedios,
    hora,
    temprano: hora < (cfg.horaMinimaPausar || 0),
    candidatos,
    aPausar: candidatos.filter(i => i.pausa.accion === 'pausar'),
    dejarCorrer: candidatos.filter(i => i.pausa.accion === 'dejar-correr'),
    ahorroPotencial: candidatos
      .filter(i => i.pausa.accion === 'pausar')
      .reduce((s, i) => s + (i.pausa.plataEnRiesgo || 0), 0),
    evaluados,
  };
}

// ── Fórmulas (para mostrarlas en la UI) ──────────────────────────────────
//
// Cada métrica dice qué fórmula usa y con qué números se calculó en ESTE
// caso. La UI pasa sus formateadores (f.money / f.num / f.pct) para que el
// texto salga en la moneda de la cuenta.
export const FORMULAS = {
  roas: {
    label: 'ROAS',
    formula: 'ingresos ÷ gasto',
    nota: 'Los ingresos son el valor de las compras que atribuye el pixel de Meta, no tu facturación real.',
    calculo: (d, f) => `${f.money(d.revenue)} ÷ ${f.money(d.spend)} = ${f.num(d.spend > 0 ? d.revenue / d.spend : 0, 2)}`,
  },
  cpa: {
    label: 'CPA',
    formula: 'gasto ÷ compras',
    calculo: (d, f) => `${f.money(d.spend)} ÷ ${f.num(d.purchases)} = ${d.purchases > 0 ? f.money(d.spend / d.purchases) : '—'}`,
  },
  eficiencia: {
    label: 'Eficiencia',
    formula: 'ganadoras ÷ (ganadoras + perdedoras) × 100',
    nota: 'Las campañas "sin datos suficientes" quedan afuera del divisor a propósito: no fracasaron, no tuvieron chance. Si las contáramos, el porcentaje bajaría solo por lanzar campañas nuevas.',
    calculo: (d, f) => `${d.ganadoras} ÷ (${d.ganadoras} + ${d.perdedoras}) × 100 = ${f.pct(d.eficiencia)}`,
  },
  ganador: {
    label: 'Campaña ganadora',
    formula: 'compras ≥ mínimo Y ROAS ≥ mínimo',
    nota: 'Las dos condiciones a la vez. Un ROAS alto con 1 sola compra es ruido, no una señal.',
    calculo: (d, f, cfg) => `compras ${f.num(d.purchases)} ≥ ${cfg.minComprasGanador} y ROAS ${f.num(d.roas, 2)} ≥ ${cfg.minRoasGanador}`,
  },
  sinDatos: {
    label: 'Sin datos suficientes',
    formula: 'impresiones < mínimo',
    nota: 'Es el estado que evita que el porcentaje de eficiencia mienta.',
    calculo: (d, f, cfg) => `${f.num(d.impressions)} impresiones < ${f.num(cfg.minImpresiones)}`,
  },
  frecuencia: {
    label: 'Frecuencia',
    formula: 'impresiones ÷ alcance (en la ventana elegida)',
    nota: 'Cuántas veces vio el anuncio la misma persona. Cerca de 1 significa que casi todos los que lo vieron son gente nueva — por eso sirve para detectar prospectadores. Medida por día daría ~1 siempre y no diría nada.',
    calculo: (d, f) => `${f.num(d.impressions)} ÷ ${f.num(d.reach)} = ${f.num(d.reach > 0 ? d.impressions / d.reach : 0, 2)}`,
  },
  prospectador: {
    label: 'Anuncio prospectador',
    formula: 'frecuencia ≤ máx Y ROAS ≥ mín Y compras ≥ mín Y alcance ≥ mín',
    nota: 'Las cuatro a la vez: llega a gente nueva (frecuencia baja), a suficiente gente (alcance), y además vende (compras + ROAS).',
    calculo: (d, f, cfg) => `frecuencia ≤ ${cfg.maxFrecuenciaProsp} · ROAS ≥ ${cfg.minRoasProsp} · compras ≥ ${cfg.minComprasProsp} · alcance ≥ ${f.num(cfg.minAlcanceProsp)}`,
  },
  costoPorATC: {
    label: 'Costo por carrito',
    formula: 'gasto ÷ agregados al carrito',
    calculo: (d, f) => `${f.money(d.spend)} ÷ ${f.num(d.addToCart)} = ${d.addToCart > 0 ? f.money(d.spend / d.addToCart) : 'sin carritos'}`,
  },
  costoPorCheckout: {
    label: 'Costo por pago iniciado',
    formula: 'gasto ÷ pagos iniciados',
    calculo: (d, f) => `${f.money(d.spend)} ÷ ${f.num(d.initiateCheckout)} = ${d.initiateCheckout > 0 ? f.money(d.spend / d.initiateCheckout) : 'sin pagos iniciados'}`,
  },
  promedioCuenta: {
    label: 'Promedio de la cuenta',
    formula: 'gasto TOTAL del día ÷ eventos TOTALES del día',
    nota: 'Se calcula sobre las sumas de toda la cuenta, no promediando el costo de cada campaña: si no, una campaña de $2 pesaría igual que una de $200.000.',
    calculo: (d, f) => `${f.money(d.spend)} ÷ ${f.num(d.addToCart)} carritos = ${d.costoPorATC != null ? f.money(d.costoPorATC) : '—'}`,
  },
  pausar: {
    label: 'Candidato a pausar',
    formula: 'gastó ≥ piso Y ROAS < máx Y costo por carrito > promedio+X% Y costo por pago iniciado > promedio+X%',
    nota: 'Las cuatro a la vez. El piso de gasto está primero a propósito: sin él, todo lo que arrancó hace media hora aparecería como candidato. Un item sin ningún carrito ni pago iniciado habiendo gastado el piso cuenta como que supera el umbral — no llegó a ninguna parte.',
    calculo: (d, f, cfg) => `gasto ≥ ${f.money(cfg.pisoGastoPausar)} · ROAS < ${cfg.roasMaxPausar} · costos > promedio +${cfg.sobrePromedioPct}%`,
  },
  plataEnRiesgo: {
    label: 'Plata en riesgo',
    formula: 'presupuesto diario − gastado hoy',
    nota: 'Es lo que ahorrás si lo pausás AHORA, y por eso ordena la lista. Si ya consumió casi todo el presupuesto, pausarlo no ahorra nada: por eso esos van aparte como "dejalo correr".',
    calculo: (d, f) => `${d.presupuesto != null ? f.money(d.presupuesto) : 'sin presupuesto propio'} − ${f.money(d.gastoHoy)} = ${d.restante != null ? f.money(d.restante) : '—'}`,
  },
  horaCorte: {
    label: 'Hora de corte',
    formula: `hora local AR ≥ mínima`,
    nota: 'El día publicitario no madura hasta el mediodía: a las 9 de la mañana casi todo parece un desastre y pausarías cosas que iban a levantar. Antes de esa hora el tablero muestra los candidatos igual, pero avisando que es temprano.',
    calculo: (d, f, cfg) => `son las ${d.hora}:00 en Argentina (mínima ${cfg.horaMinimaPausar}:00)`,
  },
  breakeven: {
    label: 'ROAS de equilibrio',
    formula: 'lo anotás por producto, o sale de 1 ÷ margen bruto',
    nota: 'Por debajo de este ROAS cada venta pierde plata. Con 40% de margen, el equilibrio está en 2,5 — un ROAS de 2 con ese margen NO es rentable, aunque suene bien. Si no cargás el margen, el corte es el número que pongas a mano.',
    calculo: (d, f) => d.roasBreakevenManual
      ? `anotado a mano para este producto: ${f.num(d.roasBreakevenManual, 2)}`
      : d.margenPct
        ? `1 ÷ ${d.margenPct}% = ${f.num(100 / d.margenPct, 2)}`
        : 'sin breakeven ni margen cargado — se usa el ROAS mínimo puesto a mano',
  },
  cohorte: {
    label: 'Semana de la campaña',
    formula: 'fecha escrita en el nombre → lunes de esa semana',
    nota: 'La fecha sale del NOMBRE de la campaña (ej. "cepillo 15/8"), no de cuándo Meta la creó. La semana va de lunes a domingo. Una campaña sin fecha en el nombre cae en "Sin fecha" y no ensucia ninguna semana.',
    calculo: (d) => `"${d.name}" → ${d.fecha || 'sin fecha'} → semana del ${d.semana ? etiquetaSemana(d.semana) : '—'}`,
  },
  testeo: {
    label: 'Es campaña de testeo',
    formula: 'el nombre contiene una palabra de testeo y ninguna de exclusión',
    nota: 'Meta no sabe qué es un testeo: lo decide tu convención de nombres. Las de escala quedan afuera del cálculo de eficiencia.',
    calculo: (d) => d.tipoMotivo || '',
  },
};

// ── Deep link a Meta ─────────────────────────────────────────────────────

// Abre el Ads Manager mostrando EXACTAMENTE estas campañas/conjuntos/anuncios.
//
// Meta no tiene una forma soportada de meter condiciones en la URL ("ROAS >
// 1.5"): el parámetro de filtros es interno y se rompe. Seleccionar por ID es
// estable y da el mismo resultado — nosotros calculamos quiénes son y Meta
// solo los muestra.
export function linkMeta({ accountId, nivel = 'campaigns', ids = [], desde, hasta }) {
  const base = `https://business.facebook.com/adsmanager/manage/${nivel}`;
  const p = new URLSearchParams();
  if (accountId) p.set('act', String(accountId).replace(/^act_/, ''));
  const param = { campaigns: 'selected_campaign_ids', adsets: 'selected_adset_ids', ads: 'selected_ad_ids' }[nivel];
  if (param && ids.length) p.set(param, ids.join(','));
  // Rango de fechas del Ads Manager: YYYY-MM-DD_YYYY-MM-DD.
  if (desde && hasta) p.set('date', `${desde}_${hasta}`);
  return `${base}?${p.toString()}`;
}
