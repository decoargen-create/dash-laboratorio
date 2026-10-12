// Home pública de AdsLab — lo que ve un visitante SIN sesión en
// adslab-studio.vercel.app. "Entrar" y todos los CTA llevan al login de
// siempre (onEntrar); los links de recuperación / magic-link nunca pasan por
// acá (App.jsx los detecta y va directo al auth).
//
// El markup vive como HTML plano: es contenido estático de marketing,
// idéntico al prototipo aprobado, y así el diseño no se desincroniza por una
// conversión a JSX. La interactividad (reveals, contadores, demo paso a paso)
// se engancha en el useEffect, toda con try/catch: si algo falla, la página
// se ve completa igual (los reveals solo se ocultan bajo .lp.js).

import React, { useEffect, useRef } from 'react';

const CSS = `
  /* Landing comercial de AdsLab — oscuro vibrante, acentos neón por módulo.
     PROGRESIVO: el contenido es visible SIEMPRE; las animaciones de scroll
     solo se activan si el JS corre (html.js) — nunca más una página en blanco. */
  :root{
    --bg:#0a0e1d; --bg2:#0d1428; --panel:#121a31; --line:#20294a; --line2:#32406e;
    --fg:#f1f4fd; --mut:#93a2c6; --mut2:#5e6d93;
    --violeta:#8b5cf6; --violeta2:#a78bfa; --cian:#38bdf8; --rosa:#f472b6; --ambar:#fbbf24; --verde:#34d399; --rojo:#fb7185;
    color-scheme: dark;
  }
  .lp{min-height:100vh;background:var(--bg); color:var(--fg); margin:0; font-family:Inter,system-ui,sans-serif; font-size:15px; line-height:1.6; padding-inline:16px; padding-block:0 60px; overflow-x:hidden;}
  *{box-sizing:border-box}
  h1,h2,h3{font-family:Sora,Inter,sans-serif; letter-spacing:-.02em; text-wrap:balance;}
  .wrap{max-width:1080px; margin:0 auto;}
  .ico{width:18px; height:18px; stroke:currentColor; stroke-width:1.8; fill:none; stroke-linecap:round; stroke-linejoin:round; flex:none;}

  /* texto con gradiente ANIMADO */
  .grad{background:linear-gradient(92deg,var(--violeta2),var(--cian),var(--rosa),var(--violeta2)); background-size:260% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent; animation:ola 7s linear infinite;}
  @keyframes ola{to{background-position:260% 0}}

  /* motion: SOLO con html.js — sin JS todo se ve */
  .lp.js .reveal{opacity:0; transform:translateY(22px); transition:opacity .7s ease, transform .7s ease;}
  .lp.js .reveal.in{opacity:1; transform:none;}
  .lp.js .reveal.d1{transition-delay:.08s} .lp.js .reveal.d2{transition-delay:.16s} .lp.js .reveal.d3{transition-delay:.24s} .lp.js .reveal.d4{transition-delay:.32s}
  @media (prefers-reduced-motion: reduce){
    .lp.js .reveal{opacity:1 !important; transform:none !important; transition:none !important;}
    *{animation-duration:.01ms !important; animation-iteration-count:1 !important;}
  }

  /* nav */
  nav{display:flex; align-items:center; gap:12px; padding:18px 0; position:relative; z-index:3;}
  .logo{display:inline-flex; align-items:center; gap:10px; font-family:Sora; font-weight:800; font-size:18px;}
  .logo .cubo{width:33px;height:33px;border-radius:10px;background:linear-gradient(135deg,var(--violeta),var(--cian));display:grid;place-items:center; box-shadow:0 4px 18px rgba(139,92,246,.45);}
  .logo .cubo svg{width:17px;height:17px;stroke:#fff;}
  nav .links{margin-left:auto; display:flex; gap:24px; font-size:13.5px; color:var(--mut); font-weight:600;}
  nav .links a{color:inherit; text-decoration:none; transition:color .15s;} nav .links a:hover{color:var(--fg)}
  .btn{display:inline-flex; align-items:center; justify-content:center; gap:9px; border-radius:13px; padding:13px 24px; font-weight:800; font-size:14px; text-decoration:none; border:1px solid var(--line2); color:var(--fg); transition:.18s; cursor:pointer; background:none; font-family:inherit; position:relative; overflow:hidden;}
  .btn:hover{border-color:var(--violeta); transform:translateY(-1px);}
  .btn.primario{background:linear-gradient(94deg,var(--violeta),#6d4df0 45%,var(--cian)); background-size:200% 100%; border:none; box-shadow:0 10px 32px rgba(139,92,246,.45); animation:ola 6s linear infinite;}
  .btn.primario:hover{box-shadow:0 14px 44px rgba(139,92,246,.65); transform:translateY(-2px) scale(1.02);}
  .btn.chico{padding:9px 17px; font-size:13px;}
  @media (max-width:680px){ nav .links{display:none} }

  /* hero */
  .hero{text-align:center; padding:56px 0 20px; position:relative;}
  .blob{position:absolute; width:560px; height:560px; border-radius:50%; filter:blur(85px); opacity:.22; pointer-events:none; z-index:0;}
  .blob.a{background:var(--violeta); top:-240px; left:-120px; animation:flotar 11s ease-in-out infinite;}
  .blob.b{background:var(--cian); top:-180px; right:-200px; animation:flotar 13s ease-in-out infinite reverse;}
  .blob.c{background:var(--rosa); top:160px; left:50%; width:420px; height:420px; opacity:.1; animation:flotar 15s ease-in-out infinite;}
  @keyframes flotar{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(42px,30px) scale(1.08)}}
  .hero>*{position:relative; z-index:1;}
  .pill{display:inline-flex; align-items:center; gap:8px; border:1px solid rgba(139,92,246,.5); background:rgba(139,92,246,.1); border-radius:999px; padding:7px 16px; font-size:12px; color:var(--violeta2); font-weight:700;}
  .pill .punto{width:7px;height:7px;border-radius:50%;background:var(--verde); animation:pulso 1.8s ease-in-out infinite;}
  @keyframes pulso{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}
  .hero h1{font-size:clamp(32px,5.8vw,58px); margin:20px auto 0; max-width:18ch; line-height:1.08; font-weight:800;}
  .hero p.baja{color:var(--mut); font-size:clamp(15px,2vw,17.5px); max-width:54ch; margin:20px auto 0;}
  .hero .ctas{display:flex; gap:12px; justify-content:center; margin-top:30px; flex-wrap:wrap;}
  .hero .micro{font-size:12px; color:var(--mut2); margin-top:14px;}

  .stats{display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:44px;}
  .stat{background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:15px 24px; min-width:155px; text-align:center; position:relative; overflow:hidden;}
  .stat::before{content:""; position:absolute; inset:0 0 auto; height:3px;}
  .stat:nth-child(1)::before{background:var(--violeta)} .stat:nth-child(2)::before{background:var(--ambar)}
  .stat:nth-child(3)::before{background:var(--rosa)} .stat:nth-child(4)::before{background:var(--cian)}
  .stat .v{font-family:Sora; font-size:25px; font-weight:800; font-variant-numeric:tabular-nums;}
  .stat:nth-child(1) .v{color:var(--violeta2)} .stat:nth-child(2) .v{color:var(--ambar)}
  .stat:nth-child(3) .v{color:var(--rosa)} .stat:nth-child(4) .v{color:var(--cian)}
  .stat .l{font-size:11px; color:var(--mut2); margin-top:2px; font-weight:600;}

  section{margin-top:92px; position:relative;}
  .cab{text-align:center; max-width:64ch; margin:0 auto 36px;}
  .cab .k{font-size:11px; font-weight:800; letter-spacing:.18em; text-transform:uppercase;
    background:linear-gradient(92deg,var(--violeta2),var(--cian)); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .cab h2{font-size:clamp(24px,3.6vw,36px); margin:10px 0 8px; font-weight:800;}
  .cab p{color:var(--mut); font-size:14.5px; margin:0;}

  /* ═══ demo paso a paso ═══ */
  .demo{display:grid; grid-template-columns:minmax(260px,380px) 1fr; gap:22px; align-items:stretch;}
  @media (max-width:820px){ .demo{grid-template-columns:1fr;} }
  .pasos{display:flex; flex-direction:column; gap:8px;}
  .pasoBtn{text-align:left; background:var(--panel); border:1px solid var(--line); border-radius:15px; padding:14px 16px; cursor:pointer; font-family:inherit; color:var(--fg); transition:.18s; position:relative; overflow:hidden;}
  .pasoBtn .top{display:flex; align-items:center; gap:11px;}
  .pasoBtn .num{width:27px;height:27px;border-radius:9px;background:var(--bg2);border:1px solid var(--line2);display:grid;place-items:center;font-size:12px;font-weight:800;color:var(--mut);flex:none;transition:.18s;}
  .pasoBtn b{font-size:14px; font-family:Sora;}
  .pasoBtn .desc{display:none; margin:7px 0 0 38px; font-size:12px; color:var(--mut); line-height:1.5;}
  .pasoBtn .prog{position:absolute; left:0; bottom:0; height:3px; width:0; background:linear-gradient(90deg,var(--violeta),var(--cian),var(--rosa));}
  .pasoBtn.on{border-color:var(--violeta); background:rgba(139,92,246,.09); box-shadow:0 8px 26px rgba(139,92,246,.18);}
  .pasoBtn.on .num{background:linear-gradient(135deg,var(--violeta),var(--cian)); border-color:transparent; color:#fff;}
  .pasoBtn.on .desc{display:block;}
  .lp.js .pasoBtn.on .prog{animation:barra var(--dur,5.2s) linear forwards;}
  @keyframes barra{to{width:100%}}

  .pantalla{background:var(--bg2); border:1px solid var(--line); border-radius:20px; padding:18px; position:relative; min-height:340px; overflow:hidden;
    background-image:radial-gradient(400px 180px at 85% -10%, rgba(56,189,248,.12), transparent);}
  .pantalla .barra-v{display:flex; gap:6px; margin-bottom:14px;}
  .barra-v i{width:10px;height:10px;border-radius:50%;}
  .barra-v i:nth-child(1){background:var(--rojo)} .barra-v i:nth-child(2){background:var(--ambar)} .barra-v i:nth-child(3){background:var(--verde)}
  .vista{display:none;}
  .vista.on{display:block; animation:aparecer .45s ease;}
  @keyframes aparecer{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
  .mrow{display:flex; align-items:center; gap:10px; background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:10px 13px; margin-bottom:8px; font-size:12px;}
  .mrow .nom{font-weight:700; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .mrow .roas{font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap;}
  .verde{color:var(--verde)} .rojo{color:var(--rojo)}
  .mbar{height:6px; border-radius:3px; background:var(--line); flex:1; max-width:110px; overflow:hidden;}
  .mbar i{display:block; height:100%; border-radius:3px; background:linear-gradient(90deg,var(--cian),var(--violeta)); width:var(--w,70%);}
  .vista.on .mbar i{width:0; animation:crecer 1.1s .2s ease forwards;}
  @keyframes crecer{to{width:var(--w,70%)}}
  .pillq{font-size:10px; font-weight:800; border-radius:999px; padding:3px 10px; white-space:nowrap;}
  .pillq.bad{background:rgba(251,113,133,.15); color:var(--rojo);}
  .pillq.ok{background:rgba(52,211,153,.14); color:var(--verde);}
  .pillq.win{background:rgba(251,191,36,.15); color:var(--ambar);}
  .sw{width:30px;height:17px;border-radius:999px;background:var(--cian);position:relative;flex:none;}
  .sw::after{content:"";position:absolute;top:2px;left:15px;width:13px;height:13px;border-radius:50%;background:#fff;}
  .vista.on .sw.apaga{animation:apagar .4s 1.4s forwards;}
  .vista.on .sw.apaga::after{animation:bolita .4s 1.4s forwards;}
  @keyframes apagar{to{background:var(--line2)}}
  @keyframes bolita{to{left:2px}}
  .estrella{display:inline-grid; place-items:center; width:30px; height:30px; flex:none;}
  .estrella svg{width:24px;height:24px;fill:var(--ambar);stroke:var(--ambar);opacity:.3;transform:scale(.7);}
  .vista.on .estrella.pop svg{animation:pop .5s .9s forwards;}
  @keyframes pop{60%{transform:scale(1.35);opacity:1}100%{transform:scale(1);opacity:1}}
  .notif{position:absolute; right:16px; bottom:16px; background:#1a2340; border:1px solid var(--line2); border-left:3px solid var(--violeta); border-radius:11px; padding:10px 14px; font-size:11.5px; max-width:264px; box-shadow:0 14px 34px rgba(0,0,0,.45);}
  .lp.js .vista.on .notif{opacity:0; transform:translateY(16px); animation:subir .5s 1.6s forwards;}
  @keyframes subir{to{opacity:1; transform:none}}
  .kanban{display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;}
  .kcol{background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:8px; min-height:120px;}
  .kcol .kt{font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.07em; margin-bottom:7px;}
  .kcol:nth-child(1) .kt{color:var(--rosa)} .kcol:nth-child(2) .kt{color:var(--ambar)} .kcol:nth-child(3) .kt{color:var(--verde)}
  .kcard{background:var(--bg2); border:1px solid var(--line2); border-radius:9px; padding:8px; font-size:11px; margin-bottom:6px; font-weight:600;}
  .kcard .kp{color:var(--mut2); font-size:10px; font-weight:500;}
  .lp.js .vista.on .kcard.mueve{animation:deslizar .6s 1.2s both;}
  @keyframes deslizar{from{transform:translateX(-40%); opacity:.3}to{transform:none; opacity:1}}
  .formline{display:flex; align-items:center; gap:10px; margin-bottom:9px; font-size:12px;}
  .formline .lab{width:110px; color:var(--mut2); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; font-weight:800; flex:none;}
  .formline .val{background:var(--panel); border:1px solid var(--line2); border-radius:9px; padding:7px 11px; flex:1; font-weight:700;}
  .lanzando{display:flex; align-items:center; gap:10px; margin-top:14px; font-size:12.5px; font-weight:800;}
  .lanzando .okmsg{display:inline-flex;align-items:center;gap:6px;color:var(--verde);}
  .lp.js .vista.on .lanzando .carga{width:0; animation:crecer 1.3s .8s ease forwards;}
  .lp.js .vista.on .lanzando .okmsg{opacity:0; animation:subir .3s 2.1s forwards;}

  /* módulos — cada uno con su color */
  .mods{display:grid; grid-template-columns:repeat(auto-fit,minmax(245px,1fr)); gap:14px;}
  .mod{background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:22px; transition:.2s; position:relative; overflow:hidden;}
  .mod::before{content:""; position:absolute; inset:0 0 auto; height:3px; background:var(--acc); opacity:.85;}
  .mod:hover{transform:translateY(-4px); border-color:var(--line2); box-shadow:0 18px 44px rgba(0,0,0,.4);}
  .mod .icbox{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;margin-bottom:14px;background:color-mix(in srgb, var(--acc) 14%, transparent);border:1px solid color-mix(in srgb, var(--acc) 40%, transparent);color:var(--acc);}
  .mod .icbox svg{width:22px;height:22px;}
  .mod h3{font-size:16px; margin:0 0 7px;}
  .mod p{font-size:13px; color:var(--mut); margin:0; line-height:1.6;}
  .mod .vs{display:inline-block; margin-top:12px; font-size:10.5px; font-weight:700; color:var(--acc); border:1px solid color-mix(in srgb, var(--acc) 35%, transparent); border-radius:8px; padding:3px 10px; background:color-mix(in srgb, var(--acc) 8%, transparent);}

  /* comparativa */
  .comp{overflow-x:auto; border:1px solid var(--line); border-radius:18px; background:var(--panel);}
  .comp table{border-collapse:collapse; width:100%; min-width:640px; font-size:13px;}
  .comp th{padding:14px 16px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--mut2); border-bottom:1px solid var(--line);}
  .comp th.adslab{background:linear-gradient(92deg,var(--violeta2),var(--cian)); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .comp td{padding:12px 16px; border-bottom:1px solid var(--line); color:var(--mut);}
  .comp tr:last-child td{border-bottom:none;}
  .comp td:first-child{color:var(--fg); font-weight:700;}
  .comp td.adslab{background:rgba(139,92,246,.1); font-weight:800;}
  .tick{color:var(--verde);} .cross{color:var(--mut2);}

  /* pricing */
  .precios{display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:14px; align-items:stretch;}
  .plan{background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:26px; display:flex; flex-direction:column; gap:14px; position:relative; transition:.2s;}
  .plan:hover{transform:translateY(-4px);}
  .plan.star{border:1px solid transparent; background:
    linear-gradient(var(--panel),var(--panel)) padding-box,
    linear-gradient(140deg,var(--violeta),var(--cian),var(--rosa)) border-box;
    box-shadow:0 22px 60px rgba(139,92,246,.26);}
  .plan .tag{position:absolute; top:-13px; left:50%; transform:translateX(-50%); background:linear-gradient(92deg,var(--violeta),var(--cian)); font-size:10.5px; font-weight:800; letter-spacing:.08em; border-radius:999px; padding:5px 15px; white-space:nowrap; box-shadow:0 6px 18px rgba(139,92,246,.4);}
  .plan h3{margin:0; font-size:17px;}
  .plan .p{font-family:Sora; font-size:38px; font-weight:800; font-variant-numeric:tabular-nums;}
  .plan .p small{font-size:13px; color:var(--mut); font-weight:600; font-family:Inter;}
  .plan .para{font-size:12px; color:var(--mut2); margin-top:-8px; font-weight:600;}
  .plan ul{list-style:none; margin:0; padding:0; display:grid; gap:9px; font-size:13px; color:var(--mut); flex:1;}
  .plan li{padding-left:24px; position:relative;}
  .plan li svg{position:absolute; left:0; top:3px; width:14px; height:14px; color:var(--verde);}
  .plan li.destaque svg{color:var(--ambar);}
  .creditos{margin-top:14px; border-radius:16px; padding:16px 20px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; font-size:13px; color:var(--mut);
    background:linear-gradient(92deg, rgba(251,191,36,.08), rgba(244,114,182,.07)); border:1px solid rgba(251,191,36,.3);}
  .creditos b{color:var(--fg)}
  .creditos .icbox{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.4);color:var(--ambar);flex:none;}
  .creditos .icbox svg{width:18px;height:18px;}

  .final{margin-top:96px; text-align:center; border-radius:26px; padding:60px 24px; position:relative; overflow:hidden; border:1px solid var(--line2);
    background:radial-gradient(620px 260px at 50% -20%, rgba(139,92,246,.3), transparent), radial-gradient(400px 200px at 80% 110%, rgba(56,189,248,.18), transparent), var(--panel);}
  .final h2{font-size:clamp(25px,4vw,40px); margin:0 0 10px; font-weight:800;}
  .final p{color:var(--mut); margin:0 0 28px;}
  footer{margin-top:46px; display:flex; gap:16px; align-items:center; color:var(--mut2); font-size:12px; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:24px;}
  footer .links{margin-left:auto; display:flex; gap:18px;}
  footer a{color:var(--mut2); text-decoration:none;} footer a:hover{color:var(--mut);}
  .demo-chip{position:fixed; right:14px; bottom:calc(14px + env(safe-area-inset-bottom,0px)); background:var(--panel); border:1px solid var(--line2); color:var(--mut); font-size:10px; font-weight:800; letter-spacing:.08em; border-radius:999px; padding:5px 11px; z-index:50;}
`;

const HTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <g id="i-chart"><path d="M3 3v18h18"/><path d="M7 15v-4"/><path d="M12 15V7"/><path d="M17 15v-6"/></g>
    <g id="i-star"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z"/></g>
    <g id="i-film"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 4l2 5"/><path d="M14 4l2 5"/></g>
    <g id="i-send"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></g>
    <g id="i-spark"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></g>
    <g id="i-check"><path d="M20 6L9 17l-5-5"/></g>
    <g id="i-flask"><path d="M9 3h6"/><path d="M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/></g>
    <g id="i-ticket"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4z"/><path d="M13 7v10"/></g>
  </defs>
</svg>

<div class="wrap">
  <nav>
    <span class="logo"><span class="cubo"><svg viewBox="0 0 24 24" class="ico"><use href="#i-flask"/></svg></span>AdsLab</span>
    <div class="links">
      <a href="#demo">Cómo funciona</a><a href="#modulos">Plataforma</a><a href="#precios">Precios</a>
    </div>
    <button class="btn chico" data-accion="entrar">Entrar</button>
  </nav>

  <!-- ═══ HERO ═══ -->
  <div class="hero">
    <div class="blob a"></div><div class="blob b"></div><div class="blob c"></div>
    <span class="pill"><span class="punto"></span>NUEVO · Winners automáticos: Meta le avisa solo a tu equipo qué replicar</span>
    <h1>Escalá tus ads con un equipo que <span class="grad">nunca duerme</span></h1>
    <p class="baja">AdsLab lee tus campañas de Meta todos los días, te dice qué pausar y qué escalar con tu punto
    de equilibrio real, marca los videos ganadores para que tu equipo los replique y genera creativos desde la
    competencia que ya vende. Todo lo que hoy hacés con cinco pestañas y una planilla — en un solo circuito.</p>
    <div class="ctas">
      <button class="btn primario" data-accion="entrar">Probar 14 días gratis <svg viewBox="0 0 24 24" class="ico" style="width:15px;height:15px"><use href="#i-send"/></svg></button>
      <button class="btn" data-accion="demo">Ver cómo funciona</button>
    </div>
    <p class="micro">Sin tarjeta · Conectás Meta en 30 segundos · Hecho por gente que invierte en ads todos los días</p>

    <div class="stats">
      <div class="stat reveal"><div class="v" data-cuenta="5" data-suf=" min">5 min</div><div class="l">de optimización por día</div></div>
      <div class="stat reveal d1"><div class="v">24/7</div><div class="l">el circuito trabaja solo</div></div>
      <div class="stat reveal d2"><div class="v" data-cuenta="2" data-suf=" min">2 min</div><div class="l">por creativo generado</div></div>
      <div class="stat reveal d3"><div class="v" data-cuenta="1" data-suf=" click">1 click</div><div class="l">para publicar una campaña</div></div>
    </div>
  </div>

  <!-- ═══ DEMO PASO A PASO ═══ -->
  <section id="demo">
    <div class="cab reveal">
      <span class="k">El método</span>
      <h2>Un circuito que trabaja mientras vos vendés</h2>
      <p>Cinco pasos, todos conectados. Tocá cada uno — o dejá que avance solo.</p>
    </div>
    <div class="demo reveal">
      <div class="pasos" id="pasos">
        <button class="pasoBtn on" data-p="0"><span class="top"><span class="num">1</span><b>Meta mide, AdsLab traduce</b></span>
          <span class="desc">Métricas en vivo juzgadas con TU punto de equilibrio por producto — no el ROAS genérico que usa todo el mundo.</span><span class="prog"></span></button>
        <button class="pasoBtn" data-p="1"><span class="top"><span class="num">2</span><b>Optimizás en cinco minutos</b></span>
          <span class="desc">Qué pausar, qué escalar, y el presupuesto se edita con doble click — sin abrir el Ads Manager.</span><span class="prog"></span></button>
        <button class="pasoBtn" data-p="2"><span class="top"><span class="num">3</span><b>Los winners se marcan solos</b></span>
          <span class="desc">Cada mañana el sistema cruza las ventas de Meta con tu producción, marca los ganadores y avisa a Discord.</span><span class="prog"></span></button>
        <button class="pasoBtn" data-p="3"><span class="top"><span class="num">4</span><b>Tu equipo replica lo que vende</b></span>
          <span class="desc">Los editores ven los ganadores en su tablero y producen la próxima tanda sobre lo que ya funciona.</span><span class="prog"></span></button>
        <button class="pasoBtn" data-p="4"><span class="top"><span class="num">5</span><b>Publicás con un click</b></span>
          <span class="desc">CBO deep pocket, cost cap o ABO bid cap: tus recetas, tus pujas, tus presupuestos — y el circuito vuelve a empezar.</span><span class="prog"></span></button>
      </div>

      <div class="pantalla">
        <div class="barra-v"><i></i><i></i><i></i></div>

        <div class="vista on" data-v="0">
          <div class="mrow"><span class="nom">Skincare · Escala [CBO Deep Pocket]</span><span class="mbar"><i style="--w:86%"></i></span><span class="roas verde">ROAS 3.44 ▲</span></div>
          <div class="mrow"><span class="nom">Skincare · Evergreen [CBO]</span><span class="mbar"><i style="--w:64%"></i></span><span class="roas verde">ROAS 6.58 ▲</span><span class="pillq ok">Subir presupuesto</span></div>
          <div class="mrow"><span class="nom">Wellness · Testeo [CBO Costcap]</span><span class="mbar"><i style="--w:42%"></i></span><span class="roas rojo">ROAS 0.97 ▼</span><span class="pillq bad">Pausar</span></div>
          <div class="mrow"><span class="nom">Home · Testeo semanal [CBO]</span><span class="mbar"><i style="--w:55%"></i></span><span class="roas verde">ROAS 2.90 ▲</span></div>
        </div>

        <div class="vista" data-v="1">
          <div class="mrow"><span class="sw apaga"></span><span class="nom">Wellness · Testeo — ROAS 0.97</span><span class="pillq bad">Pausada</span></div>
          <div class="mrow"><span class="sw"></span><span class="nom">Skincare · Evergreen — presupuesto diario</span><span class="roas" style="color:var(--fg)">$<span data-cuenta="80" data-desde="45">80</span>.000</span><span class="pillq ok">+78%</span></div>
          <div class="mrow"><span class="sw"></span><span class="nom">Skincare · Escala [CBO Deep Pocket]</span><span class="pillq ok">Va bien</span></div>
        </div>

        <div class="vista" data-v="2">
          <div class="mrow"><span class="estrella pop"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="nom">Video C1 · Mecanismo</span><span class="roas verde">15 compras · ROAS 3.78</span><span class="pillq win">WINNER AUTO</span></div>
          <div class="mrow"><span class="estrella pop"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="nom">Video C7 · Testimonio</span><span class="roas verde">14 compras · ROAS 2.90</span><span class="pillq win">WINNER AUTO</span></div>
          <div class="mrow" style="opacity:.55"><span class="estrella"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="nom">Video C5 · POV</span><span class="roas">1 compra — sigue en testeo</span></div>
          <div class="notif"><b style="color:var(--violeta2)">AdsLab → #equipo</b><br>2 winners nuevos marcados en Producción. Los editores ya los ven en su tablero.</div>
        </div>

        <div class="vista" data-v="3">
          <div class="kanban">
            <div class="kcol"><div class="kt">Por hacer</div><div class="kcard">Tanda semanal · 7 videos<div class="kp">brief: replicar C1 Mecanismo ★</div></div></div>
            <div class="kcol"><div class="kt">En revisión</div><div class="kcard mueve">Tanda express · 5 videos<div class="kp">Editor asignado</div></div></div>
            <div class="kcol"><div class="kt">Aprobado</div><div class="kcard">Tanda evergreen · 7 videos<div class="kp">pago proporcional listo</div></div></div>
          </div>
          <div class="notif"><b style="color:var(--violeta2)">Tablero del editor</b><br>Cada tarjeta trae los winners del producto como referencia — nadie pregunta "¿qué edito ahora?"</div>
        </div>

        <div class="vista" data-v="4">
          <div class="formline"><span class="lab">Receta</span><span class="val">CBO · Deep Pocket</span></div>
          <div class="formline"><span class="lab">Presupuesto</span><span class="val">$150.000 / día</span></div>
          <div class="formline"><span class="lab">Anuncios</span><span class="val">6 posts seleccionados · 1 conjunto</span></div>
          <div class="lanzando">
            <span class="mbar" style="max-width:200px"><i class="carga" style="--w:100%"></i></span>
            <span class="okmsg"><svg viewBox="0 0 24 24" class="ico" style="width:15px"><use href="#i-check"/></svg> Campaña creada en Meta</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ MÓDULOS ═══ -->
  <section id="modulos">
    <div class="cab reveal">
      <span class="k">La plataforma</span>
      <h2>Cuatro herramientas que afuera se venden por separado</h2>
      <p>Y una quinta — el circuito que las conecta — que no vende nadie.</p>
    </div>
    <div class="mods">
      <div class="mod reveal" style="--acc:var(--cian)"><div class="icbox"><svg viewBox="0 0 24 24" class="ico"><use href="#i-chart"/></svg></div>
        <h3>Métricas y optimización</h3>
        <p>Qué pausar hoy con tu ROAS de equilibrio por producto, desglose por conjunto y anuncio, presupuestos editables y testeos por semana con eficiencia.</p>
        <span class="vs">Afuera: Revealbot / Madgicx — US$49 a 329/mes</span></div>
      <div class="mod reveal d1" style="--acc:var(--rosa)"><div class="icbox"><svg viewBox="0 0 24 24" class="ico"><use href="#i-spark"/></svg></div>
        <h3>Creativos desde la competencia</h3>
        <p>Relevá la Ad Library, elegí los ads que ya venden y generá creativos con tu producto imitándolos — con eventos, ángulos de venta y nomenclatura automática.</p>
        <span class="vs">Afuera: AdCreative.ai — US$39 a 999/mes</span></div>
      <div class="mod reveal d2" style="--acc:var(--violeta2)"><div class="icbox"><svg viewBox="0 0 24 24" class="ico"><use href="#i-film"/></svg></div>
        <h3>Producción con tu equipo</h3>
        <p>Tandas semanales por producto, editores con su acceso, estados que avisan a Discord, Drive integrado y pagos proporcionales por video.</p>
        <span class="vs">Afuera: no existe — planillas y ClickUp</span></div>
      <div class="mod reveal d3" style="--acc:var(--ambar)"><div class="icbox"><svg viewBox="0 0 24 24" class="ico"><use href="#i-star"/></svg></div>
        <h3>Winners automáticos</h3>
        <p>El diferencial: AdsLab cruza tus métricas con tu producción y marca solo los videos ganadores, todos los días. Tu equipo siempre sabe qué replicar.</p>
        <span class="vs">Afuera: nadie lo tiene</span></div>
    </div>
  </section>

  <!-- ═══ COMPARATIVA ═══ -->
  <section>
    <div class="cab reveal">
      <span class="k">La diferencia</span>
      <h2>Los demás hacen una parte. <span class="grad">AdsLab cierra el círculo.</span></h2>
    </div>
    <div class="comp reveal"><table>
      <thead><tr><th></th><th>Madgicx</th><th>AdCreative</th><th>Planillas + chat</th><th class="adslab">AdsLab</th></tr></thead>
      <tbody>
        <tr><td>Optimiza Meta con tu break-even real</td><td class="cross">parcial</td><td class="cross">—</td><td class="cross">a mano</td><td class="adslab tick">✓</td></tr>
        <tr><td>Genera creativos desde la competencia</td><td class="cross">—</td><td class="tick">✓</td><td class="cross">—</td><td class="adslab tick">✓</td></tr>
        <tr><td>Organiza a tus editores con data</td><td class="cross">—</td><td class="cross">—</td><td class="cross">sin data</td><td class="adslab tick">✓</td></tr>
        <tr><td>Marca winners y avisa al equipo solo</td><td class="cross">—</td><td class="cross">—</td><td class="cross">—</td><td class="adslab tick">✓</td></tr>
        <tr><td>Publica campañas con tus recetas</td><td class="tick">✓</td><td class="cross">—</td><td class="cross">—</td><td class="adslab tick">✓</td></tr>
      </tbody>
    </table></div>
  </section>

  <!-- ═══ PRECIOS ═══ -->
  <section id="precios">
    <div class="cab reveal">
      <span class="k">Precios</span>
      <h2>Pagás según cuánto invertís en ads</h2>
      <p>Todos los planes incluyen créditos de IA para creativos y análisis. 14 días gratis, sin tarjeta.</p>
    </div>
    <div class="precios">
      <div class="plan reveal">
        <h3>Starter</h3>
        <div class="p">US$ 49 <small>/mes</small></div>
        <p class="para">Marcas que invierten hasta US$5.000/mes</p>
        <ul>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>1 cuenta publicitaria · 1 usuario</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Métricas, optimización diaria y embudo</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>30 créditos de IA por mes</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Testeos por semana</li>
        </ul>
        <button class="btn" data-accion="entrar">Empezar gratis</button>
      </div>
      <div class="plan star reveal d1">
        <span class="tag">EL MÁS ELEGIDO</span>
        <h3>Pro</h3>
        <div class="p">US$ 149 <small>/mes</small></div>
        <p class="para">Marcas que invierten hasta US$30.000/mes</p>
        <ul>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>3 cuentas · 5 usuarios</li>
          <li class="destaque"><svg viewBox="0 0 24 24" class="ico"><use href="#i-star"/></svg>Winners automáticos + avisos a Discord</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Producción con editores y pagos</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Publicar campañas (CBO / ABO)</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>150 créditos de IA por mes</li>
        </ul>
        <button class="btn primario" data-accion="entrar">Empezar gratis</button>
      </div>
      <div class="plan reveal d2">
        <h3>Agencia</h3>
        <div class="p">US$ 399 <small>/mes</small></div>
        <p class="para">Multi-cliente · hasta US$150.000/mes de inversión</p>
        <ul>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>10 cuentas · equipo ilimitado</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Todo lo de Pro, por cliente</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>500 créditos de IA por mes</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Marca blanca · soporte prioritario</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Más inversión: enterprise a % del spend</li>
        </ul>
        <button class="btn" data-accion="entrar">Hablar con nosotros</button>
      </div>
    </div>
    <div class="creditos reveal">
      <span class="icbox"><svg viewBox="0 0 24 24" class="ico"><use href="#i-ticket"/></svg></span>
      <span><b>¿Se te acabaron los créditos?</b> 1 crédito = 1 creativo generado o 1 análisis IA de un winner.
      Packs de 100 por <b>US$25</b>, cuando los necesites.</span>
    </div>
  </section>

  <!-- ═══ CTA FINAL ═══ -->
  <div class="final reveal">
    <h2>Dejá de mirar el Ads Manager.<br><span class="grad">Empezá a cerrar el círculo.</span></h2>
    <p>Conectás tu cuenta de Meta en 30 segundos y AdsLab empieza a trabajar con tus datos reales hoy.</p>
    <button class="btn primario" data-accion="entrar">Probar AdsLab 14 días gratis <svg viewBox="0 0 24 24" class="ico" style="width:15px;height:15px"><use href="#i-send"/></svg></button>
  </div>

  <footer>
    <span class="logo" style="font-size:14px"><span class="cubo" style="width:24px;height:24px;border-radius:8px"><svg viewBox="0 0 24 24" class="ico" style="width:12px;height:12px;stroke:#fff"><use href="#i-flask"/></svg></span>AdsLab</span>
    <span>· Hecho en Argentina por gente que invierte en ads todos los días</span>
    <div class="links"><a href="#demo">Método</a><a href="#precios">Precios</a><a href="#">Términos</a></div>
  </footer>
</div>`;

export default function Landing({ onEntrar }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const lp = root.querySelector('.lp') || root;

    // Tipografías de la landing (Sora/Inter). Si ya está el link, no se duplica.
    if (!document.querySelector('link[data-lp-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.lpFonts = '1';
      link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(link);
    }

    const tituloAnterior = document.title;
    document.title = 'AdsLab — Escala tus ads con un equipo que nunca duerme';

    // CTAs
    const onClick = (e) => {
      const btn = e.target.closest('[data-accion]');
      if (!btn) return;
      if (btn.dataset.accion === 'entrar') onEntrar?.();
      if (btn.dataset.accion === 'demo') root.querySelector('#demo')?.scrollIntoView({ behavior: 'smooth' });
    };
    root.addEventListener('click', onClick);

    // Animaciones (capa opcional: sin esto, todo visible).
    const timers = [];
    let io = null, ioNum = null;
    try {
      lp.classList.add('js');
      io = new IntersectionObserver(es => {
        for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }, { threshold: 0.1 });
      lp.querySelectorAll('.reveal').forEach(el => io.observe(el));
      timers.push(setTimeout(() => {
        lp.querySelectorAll('.reveal:not(.in)').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.top < innerHeight && r.bottom > 0) el.classList.add('in');
        });
      }, 1500));
    } catch { lp.classList.remove('js'); }

    const contar = (el) => {
      try {
        const fin = Number(el.dataset.cuenta), desde = Number(el.dataset.desde || 0);
        const suf = el.dataset.suf || '';
        const t0 = performance.now(), dur = 900;
        const paso = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          el.textContent = Math.round(desde + (fin - desde) * (1 - Math.pow(1 - k, 3))) + suf;
          if (k < 1) requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
      } catch {}
    };
    try {
      ioNum = new IntersectionObserver(es => {
        for (const e of es) if (e.isIntersecting) { contar(e.target); ioNum.unobserve(e.target); }
      }, { threshold: 0.6 });
      lp.querySelectorAll('.stat [data-cuenta]').forEach(el => ioNum.observe(el));
    } catch {}

    // Demo paso a paso: avanza sola, click selecciona.
    let timer = null;
    try {
      const DUR = 5200;
      const botones = [...lp.querySelectorAll('.pasoBtn')];
      const vistas = [...lp.querySelectorAll('.vista')];
      let actual = 0;
      lp.style.setProperty('--dur', DUR + 'ms');
      const irA = (i, manual = false) => {
        actual = i;
        botones.forEach((b, j) => {
          b.classList.toggle('on', j === i);
          const prog = b.querySelector('.prog');
          if (prog) { prog.style.animation = 'none'; void prog.offsetWidth; prog.style.animation = ''; }
        });
        vistas.forEach((v, j) => {
          v.classList.toggle('on', j === i);
          if (j === i) v.querySelectorAll('[data-cuenta]').forEach(contar);
        });
        clearInterval(timer);
        timer = setInterval(() => irA((actual + 1) % botones.length), manual ? DUR * 1.6 : DUR);
      };
      botones.forEach((b, i) => b.addEventListener('click', () => irA(i, true)));
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timer = setInterval(() => irA((actual + 1) % botones.length), DUR);
      }
    } catch {}

    return () => {
      document.title = tituloAnterior;
      root.removeEventListener('click', onClick);
      clearInterval(timer);
      timers.forEach(clearTimeout);
      try { io?.disconnect(); ioNum?.disconnect(); } catch {}
    };
  }, [onEntrar]);

  return (
    <div ref={ref}>
      <style>{CSS}</style>
      <div className="lp" dangerouslySetInnerHTML={{ __html: HTML }} />
    </div>
  );
}
