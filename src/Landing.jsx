// Home pública de AdsLab — lo que ve un visitante SIN sesión en
// adslab-studio.vercel.app. Versión "resultados": dolores del media buyer
// resueltos + demo animada tipo GIF de la plataforma en uso (cursor que
// pausa, escala, marca winners y publica, en loop).
//
// "Entrar" y todos los CTA llevan al login (onEntrar); los callbacks de auth
// en la URL nunca pasan por acá (App.jsx los detecta y va directo al auth).
// El markup vive como HTML plano (idéntico al prototipo aprobado) y la
// interactividad se engancha en el useEffect, toda con try/catch: si algo
// falla, la página se ve completa igual (los reveals solo bajo .lp.js).

import React, { useEffect, useRef } from 'react';

const CSS = `
  /* Landing comercial de AdsLab v4 — dolor → solución → resultado, con la
     plataforma mostrándose EN USO (demo animada tipo GIF con cursor).
     Progresivo: el contenido se ve siempre; los reveals solo con html.js. */
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
  .grad{background:linear-gradient(92deg,var(--violeta2),var(--cian),var(--rosa),var(--violeta2)); background-size:260% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent; animation:ola 7s linear infinite;}
  @keyframes ola{to{background-position:260% 0}}

  .lp.js .reveal{opacity:0; transform:translateY(22px); transition:opacity .7s ease, transform .7s ease;}
  .lp.js .reveal.in{opacity:1; transform:none;}
  .lp.js .reveal.d1{transition-delay:.08s} .lp.js .reveal.d2{transition-delay:.16s} .lp.js .reveal.d3{transition-delay:.24s}
  @media (prefers-reduced-motion: reduce){
    .lp.js .reveal{opacity:1 !important; transform:none !important; transition:none !important;}
  }

  nav{display:flex; align-items:center; gap:12px; padding:18px 0; position:relative; z-index:3;}
  .logo{display:inline-flex; align-items:center; gap:10px; font-family:Sora; font-weight:800; font-size:18px;}
  .logo .cubo{width:33px;height:33px;border-radius:10px;background:linear-gradient(135deg,var(--violeta),var(--cian));display:grid;place-items:center; box-shadow:0 4px 18px rgba(139,92,246,.45);}
  .logo .cubo svg{width:17px;height:17px;stroke:#fff;}
  nav .links{margin-left:auto; display:flex; gap:24px; font-size:13.5px; color:var(--mut); font-weight:600;}
  nav .links a{color:inherit; text-decoration:none;} nav .links a:hover{color:var(--fg)}
  .btn{display:inline-flex; align-items:center; justify-content:center; gap:9px; border-radius:13px; padding:13px 24px; font-weight:800; font-size:14px; text-decoration:none; border:1px solid var(--line2); color:var(--fg); transition:.18s; cursor:pointer; background:none; font-family:inherit;}
  .btn:hover{border-color:var(--violeta); transform:translateY(-1px);}
  .btn.primario{background:linear-gradient(94deg,var(--violeta),#6d4df0 45%,var(--cian)); background-size:200% 100%; border:none; box-shadow:0 10px 32px rgba(139,92,246,.45); animation:ola 6s linear infinite;}
  .btn.primario:hover{box-shadow:0 14px 44px rgba(139,92,246,.65); transform:translateY(-2px) scale(1.02);}
  .btn.chico{padding:9px 17px; font-size:13px;}
  @media (max-width:680px){ nav .links{display:none} }

  /* hero */
  .hero{text-align:center; padding:50px 0 0; position:relative;}
  .blob{position:absolute; width:560px; height:560px; border-radius:50%; filter:blur(85px); opacity:.2; pointer-events:none; z-index:0;}
  .blob.a{background:var(--violeta); top:-240px; left:-120px; animation:flotar 11s ease-in-out infinite;}
  .blob.b{background:var(--cian); top:-180px; right:-200px; animation:flotar 13s ease-in-out infinite reverse;}
  @keyframes flotar{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(42px,30px) scale(1.08)}}
  .hero>*{position:relative; z-index:1;}
  .pill{display:inline-flex; align-items:center; gap:8px; border:1px solid rgba(139,92,246,.5); background:rgba(139,92,246,.1); border-radius:999px; padding:7px 16px; font-size:12px; color:var(--violeta2); font-weight:700;}
  .pill .punto{width:7px;height:7px;border-radius:50%;background:var(--verde); animation:pulso 1.8s ease-in-out infinite;}
  @keyframes pulso{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}
  .hero h1{font-size:clamp(31px,5.6vw,56px); margin:20px auto 0; max-width:19ch; line-height:1.08; font-weight:800;}
  .hero p.baja{color:var(--mut); font-size:clamp(15px,2vw,17.5px); max-width:56ch; margin:20px auto 0;}
  .hero .ctas{display:flex; gap:12px; justify-content:center; margin-top:28px; flex-wrap:wrap;}
  .hero .micro{font-size:12px; color:var(--mut2); margin-top:12px;}

  /* ═══ demo tipo GIF: la plataforma usándose sola ═══ */
  .tv{max-width:760px; margin:40px auto 0; background:var(--bg2); border:1px solid var(--line2); border-radius:20px; overflow:hidden; box-shadow:0 30px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(139,92,246,.15), 0 0 80px rgba(139,92,246,.12); text-align:left; position:relative;}
  .tv .top{display:flex; align-items:center; gap:7px; padding:11px 14px; border-bottom:1px solid var(--line); background:var(--panel);}
  .tv .top i{width:10px;height:10px;border-radius:50%;}
  .tv .top i:nth-child(1){background:var(--rojo)} .tv .top i:nth-child(2){background:var(--ambar)} .tv .top i:nth-child(3){background:var(--verde)}
  .tv .top span{margin-left:8px; font-size:11px; color:var(--mut2); font-weight:600;}
  .tv .vivo{margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-size:10px; font-weight:800; letter-spacing:.08em; color:var(--rojo);}
  .tv .vivo i{width:7px;height:7px;border-radius:50%;background:var(--rojo); animation:pulso 1.4s infinite;}
  .esc-zona{position:relative; min-height:272px; padding:16px;}
  .esc{display:none;}
  .esc.on{display:block; animation:aparecer .4s ease;}
  @keyframes aparecer{from{opacity:0}to{opacity:1}}
  .esc .titulo{font-size:10.5px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--mut2); margin-bottom:10px;}
  .fila{display:flex; align-items:center; gap:10px; background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:11px 13px; margin-bottom:8px; font-size:12.5px; position:relative;}
  .fila .nom{font-weight:700; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .roas{font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap;}
  .verde{color:var(--verde)} .rojo{color:var(--rojo)}
  .pillq{font-size:10px; font-weight:800; border-radius:999px; padding:3px 10px; white-space:nowrap;}
  .pillq.bad{background:rgba(251,113,133,.15); color:var(--rojo);}
  .pillq.ok{background:rgba(52,211,153,.14); color:var(--verde);}
  .pillq.win{background:rgba(251,191,36,.15); color:var(--ambar);}
  .sw{width:32px;height:18px;border-radius:999px;background:var(--cian);position:relative;flex:none;}
  .sw::after{content:"";position:absolute;top:2px;left:16px;width:14px;height:14px;border-radius:50%;background:#fff;}
  /* resultado grande que aparece al final de cada escena */
  .logro{position:absolute; left:50%; bottom:14px; transform:translateX(-50%) translateY(14px); opacity:0;
    background:linear-gradient(94deg, rgba(52,211,153,.16), rgba(56,189,248,.14)); border:1px solid rgba(52,211,153,.45);
    color:var(--verde); border-radius:999px; padding:8px 18px; font-size:12.5px; font-weight:800; white-space:nowrap; max-width:92%;}
  .esc.on .logro{animation:logroIn .5s 2.6s forwards;}
  @keyframes logroIn{to{opacity:1; transform:translateX(-50%) translateY(0)}}
  /* cursor fantasma */
  .cursor{position:absolute; width:18px; height:18px; z-index:6; pointer-events:none; opacity:0;}
  .cursor svg{width:18px;height:18px; fill:#fff; stroke:#0a0e1d; stroke-width:1; filter:drop-shadow(0 2px 6px rgba(0,0,0,.6));}
  .cursor::after{content:""; position:absolute; inset:-7px; border-radius:50%; border:2px solid var(--cian); opacity:0; transform:scale(.4);}
  /* trayectorias por escena */
  .esc.on .cursor{animation:var(--path) 3s .2s forwards;}
  .esc.on .cursor::after{animation:clickAnillo .45s var(--clickAt,1.4s) ease-out;}
  @keyframes clickAnillo{0%{opacity:.9; transform:scale(.4)}100%{opacity:0; transform:scale(1.6)}}
  @keyframes pathA{0%{opacity:0; left:72%; top:85%}25%{opacity:1}50%{left:13px; top:96px}100%{opacity:1; left:13px; top:96px}}
  @keyframes pathB{0%{opacity:0; left:20%; top:90%}30%{opacity:1}55%{left:71%; top:58px}100%{opacity:1; left:71%; top:58px}}
  @keyframes pathD{0%{opacity:0; left:80%; top:20%}35%{opacity:1}60%{left:34%; top:168px}100%{opacity:1; left:34%; top:168px}}
  /* efectos internos */
  .esc.on .apagar{animation:swOff .35s 1.75s forwards;}
  .esc.on .apagar::after{animation:swBola .35s 1.75s forwards;}
  @keyframes swOff{to{background:var(--line2)}}
  @keyframes swBola{to{left:2px}}
  .esc.on .fila.muere{animation:apagada .4s 1.95s forwards;}
  @keyframes apagada{to{opacity:.45}}
  .num-edit{background:var(--bg2); border:1px solid var(--cian); border-radius:8px; padding:4px 10px; font-weight:800; font-variant-numeric:tabular-nums;}
  .estrella{display:inline-grid; place-items:center; width:28px; height:28px; flex:none;}
  .estrella svg{width:23px;height:23px;fill:var(--ambar);stroke:var(--ambar);opacity:.3;transform:scale(.7);}
  .esc.on .estrella.pop svg{animation:pop .5s .8s forwards;}
  .esc.on .estrella.pop2 svg{animation:pop .5s 1.3s forwards;}
  @keyframes pop{60%{transform:scale(1.4);opacity:1}100%{transform:scale(1);opacity:1}}
  .notifD{position:absolute; right:14px; top:14px; background:#1a2340; border:1px solid var(--line2); border-left:3px solid var(--violeta); border-radius:11px; padding:9px 13px; font-size:11px; max-width:250px; box-shadow:0 14px 34px rgba(0,0,0,.5); opacity:0; transform:translateY(-12px);}
  .esc.on .notifD{animation:notifIn .45s 1.9s forwards;}
  @keyframes notifIn{to{opacity:1; transform:none}}
  .barraProg{height:7px; border-radius:4px; background:var(--line); overflow:hidden; flex:1; max-width:220px;}
  .barraProg i{display:block; height:100%; width:0; background:linear-gradient(90deg,var(--cian),var(--violeta));}
  .esc.on .barraProg i{animation:cargar 1.1s 1.7s ease forwards;}
  @keyframes cargar{to{width:100%}}
  .okTxt{display:inline-flex; align-items:center; gap:6px; color:var(--verde); font-weight:800; font-size:12.5px; opacity:0;}
  .esc.on .okTxt{animation:logroIn .35s 2.7s forwards; transform:none;}
  .botonFake{display:inline-flex; align-items:center; gap:7px; background:linear-gradient(94deg,var(--violeta),var(--cian)); border-radius:10px; padding:9px 16px; font-size:12.5px; font-weight:800;}
  /* puntos de escena */
  .esc-dots{display:flex; gap:7px; justify-content:center; padding:12px 0 14px; background:var(--panel); border-top:1px solid var(--line);}
  .esc-dots i{width:7px; height:7px; border-radius:50%; background:var(--line2); transition:.25s; cursor:pointer;}
  .esc-dots i.on{background:var(--cian); transform:scale(1.3);}

  section{margin-top:92px; position:relative;}
  .cab{text-align:center; max-width:64ch; margin:0 auto 36px;}
  .cab .k{font-size:11px; font-weight:800; letter-spacing:.18em; text-transform:uppercase;
    background:linear-gradient(92deg,var(--violeta2),var(--cian)); -webkit-background-clip:text; background-clip:text; color:transparent;}
  .cab h2{font-size:clamp(24px,3.6vw,36px); margin:10px 0 8px; font-weight:800;}
  .cab p{color:var(--mut); font-size:14.5px; margin:0;}

  /* dolores */
  .dolores{display:grid; grid-template-columns:repeat(auto-fit,minmax(255px,1fr)); gap:14px;}
  .dolor{background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:22px; display:flex; flex-direction:column; gap:12px; transition:.2s; position:relative; overflow:hidden;}
  .dolor::before{content:""; position:absolute; inset:0 0 auto; height:3px; background:var(--acc);}
  .dolor:hover{transform:translateY(-4px); box-shadow:0 18px 44px rgba(0,0,0,.4);}
  .dolor .queja{font-size:14.5px; font-weight:700; line-height:1.5; color:var(--fg); font-style:italic;}
  .dolor .queja::before{content:"“"; color:var(--acc); font-size:26px; line-height:0; vertical-align:-8px; margin-right:2px; font-style:normal;}
  .dolor .sol{font-size:12.5px; color:var(--mut); line-height:1.6;}
  .dolor .res{margin-top:auto; display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:800; color:var(--verde);}
  .dolor .res svg{width:14px;height:14px;}

  /* resultados strip */
  .resultados{display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;}
  .resu{background:linear-gradient(160deg, var(--panel), var(--bg2)); border:1px solid var(--line); border-radius:18px; padding:22px; text-align:center;}
  .resu .v{font-family:Sora; font-size:34px; font-weight:800; font-variant-numeric:tabular-nums;}
  .resu:nth-child(1) .v{color:var(--verde)} .resu:nth-child(2) .v{color:var(--cian)}
  .resu:nth-child(3) .v{color:var(--rosa)} .resu:nth-child(4) .v{color:var(--ambar)}
  .resu .l{font-size:12.5px; color:var(--mut); margin-top:4px; font-weight:600; line-height:1.45;}

  /* pricing (compacto) */
  .precios{display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:14px; align-items:stretch;}
  .plan{background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:26px; display:flex; flex-direction:column; gap:13px; position:relative; transition:.2s;}
  .plan:hover{transform:translateY(-4px);}
  .plan.star{border:1px solid transparent; background:
    linear-gradient(var(--panel),var(--panel)) padding-box,
    linear-gradient(140deg,var(--violeta),var(--cian),var(--rosa)) border-box;
    box-shadow:0 22px 60px rgba(139,92,246,.26);}
  .plan .tag{position:absolute; top:-13px; left:50%; transform:translateX(-50%); background:linear-gradient(92deg,var(--violeta),var(--cian)); font-size:10.5px; font-weight:800; letter-spacing:.08em; border-radius:999px; padding:5px 15px; white-space:nowrap;}
  .plan h3{margin:0; font-size:17px;}
  .plan .p{font-family:Sora; font-size:38px; font-weight:800; font-variant-numeric:tabular-nums;}
  .plan .p small{font-size:13px; color:var(--mut); font-weight:600; font-family:Inter;}
  .plan .para{font-size:12px; color:var(--mut2); margin-top:-8px; font-weight:600;}
  .plan ul{list-style:none; margin:0; padding:0; display:grid; gap:9px; font-size:13px; color:var(--mut); flex:1;}
  .plan li{padding-left:24px; position:relative;}
  .plan li svg{position:absolute; left:0; top:3px; width:14px; height:14px; color:var(--verde);}

  .final{margin-top:96px; text-align:center; border-radius:26px; padding:56px 24px; position:relative; overflow:hidden; border:1px solid var(--line2);
    background:radial-gradient(620px 260px at 50% -20%, rgba(139,92,246,.3), transparent), radial-gradient(400px 200px at 80% 110%, rgba(56,189,248,.18), transparent), var(--panel);}
  .final h2{font-size:clamp(25px,4vw,40px); margin:0 0 10px; font-weight:800;}
  .final p{color:var(--mut); margin:0 0 28px;}
  footer{margin-top:46px; display:flex; gap:16px; align-items:center; color:var(--mut2); font-size:12px; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:24px;}
  footer .links{margin-left:auto; display:flex; gap:18px;}
  footer a{color:var(--mut2); text-decoration:none;}
  .demo-chip{position:fixed; right:14px; bottom:calc(14px + env(safe-area-inset-bottom,0px)); background:var(--panel); border:1px solid var(--line2); color:var(--mut); font-size:10px; font-weight:800; letter-spacing:.08em; border-radius:999px; padding:5px 11px; z-index:50;}
`;

const HTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <g id="i-star"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.4l6.6-.9z"/></g>
    <g id="i-send"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></g>
    <g id="i-check"><path d="M20 6L9 17l-5-5"/></g>
    <g id="i-flask"><path d="M9 3h6"/><path d="M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/></g>
  </defs>
</svg>

<div class="wrap">
  <nav>
    <span class="logo"><span class="cubo"><svg viewBox="0 0 24 24" class="ico"><use href="#i-flask"/></svg></span>AdsLab</span>
    <div class="links"><a href="#dolores">Para quién</a><a href="#precios">Precios</a></div>
    <button class="btn chico" data-accion="entrar">Entrar</button>
  </nav>

  <!-- ═══ HERO ═══ -->
  <div class="hero">
    <div class="blob a"></div><div class="blob b"></div>
    <span class="pill"><span class="punto"></span>Para marcas que invierten en Meta todos los días</span>
    <h1>Vendé más, quemá menos, <span class="grad">sin vivir en el Ads Manager</span></h1>
    <p class="baja">AdsLab te avisa qué pausar antes de que se queme la plata, le dice solo a tu equipo qué video
    está vendiendo para que lo replique, y te genera los creativos desde la competencia que ya funciona.
    Vos decidís en cinco minutos por día. El resto corre solo.</p>
    <div class="ctas">
      <button class="btn primario" data-accion="entrar">Probar 14 días gratis <svg viewBox="0 0 24 24" class="ico" style="width:15px;height:15px"><use href="#i-send"/></svg></button>
    </div>
    <p class="micro">Sin tarjeta · Conectás Meta en 30 segundos · Hecho por gente que invierte en ads todos los días</p>

    <!-- ═══ EL GIF: la plataforma usándose sola ═══ -->
    <div class="tv">
      <div class="top"><i></i><i></i><i></i><span>app.adslab — Métricas</span><span class="vivo"><i></i>EN USO</span></div>
      <div class="esc-zona" id="escZona">

        <!-- Escena 1: pausar a tiempo -->
        <div class="esc on" style="--path:pathA; --clickAt:1.6s">
          <div class="titulo">07:58 AM — AdsLab revisa tus campañas con TU punto de equilibrio</div>
          <div class="fila"><span class="sw"></span><span class="nom">Skincare · Escala</span><span class="roas verde">ROAS 3.44</span><span class="pillq ok">Va bien</span></div>
          <div class="fila muere"><span class="sw apagar"></span><span class="nom">Wellness · Testeo</span><span class="roas rojo">ROAS 0.97</span><span class="pillq bad">Pausar ya</span></div>
          <div class="fila"><span class="sw"></span><span class="nom">Home · Evergreen</span><span class="roas verde">ROAS 2.81</span><span class="pillq ok">Va bien</span></div>
          <span class="cursor"><svg viewBox="0 0 24 24"><path d="M5 3l14 9-6.5 1L9 20z"/></svg></span>
          <span class="logro">Frenaste $45.000 de gasto malo antes del mediodía</span>
        </div>

        <!-- Escena 2: escalar a la ganadora -->
        <div class="esc" style="--path:pathB; --clickAt:1.8s">
          <div class="titulo">La ganadora pide más — doble click y listo</div>
          <div class="fila"><span class="sw"></span><span class="nom">Skincare · Escala</span><span class="roas verde">ROAS 6.58</span><span class="num-edit">$ <span data-cuenta="80" data-desde="45">45</span>.000 / día</span></div>
          <div class="fila"><span class="sw"></span><span class="nom">Home · Evergreen</span><span class="roas verde">ROAS 2.81</span><span class="num-edit" style="border-color:var(--line2)">$ 60.000 / día</span></div>
          <span class="cursor"><svg viewBox="0 0 24 24"><path d="M5 3l14 9-6.5 1L9 20z"/></svg></span>
          <span class="logro">Escalaste la campaña ganadora en 5 segundos</span>
        </div>

        <!-- Escena 3: winners al equipo -->
        <div class="esc" style="--path:pathD; --clickAt:9s">
          <div class="titulo">09:00 AM — los winners se marcan solos y tu equipo se entera</div>
          <div class="fila"><span class="estrella pop"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="nom">Video C1 · Mecanismo</span><span class="roas verde">15 ventas</span><span class="pillq win">WINNER</span></div>
          <div class="fila"><span class="estrella pop2"><svg viewBox="0 0 24 24"><use href="#i-star"/></svg></span><span class="nom">Video C7 · Testimonio</span><span class="roas verde">14 ventas</span><span class="pillq win">WINNER</span></div>
          <div class="notifD"><b style="color:var(--violeta2)">AdsLab → #equipo</b><br>2 winners nuevos. Los editores ya los ven como referencia.</div>
          <span class="logro">Tu equipo replica lo que vende — sin que lo persigas</span>
        </div>

        <!-- Escena 4: publicar sin Ads Manager -->
        <div class="esc" style="--path:pathD; --clickAt:1.5s">
          <div class="titulo">Campaña nueva con tu receta — un click</div>
          <div class="fila"><span class="nom">CBO Deep Pocket · $150.000/día · 6 anuncios</span></div>
          <div class="fila" style="gap:14px"><span class="botonFake">Crear en Meta</span><span class="barraProg"><i></i></span><span class="okTxt"><svg viewBox="0 0 24 24" class="ico" style="width:14px"><use href="#i-check"/></svg> Publicada</span></div>
          <span class="cursor"><svg viewBox="0 0 24 24"><path d="M5 3l14 9-6.5 1L9 20z"/></svg></span>
          <span class="logro">Cero pestañas del Ads Manager abiertas</span>
        </div>
      </div>
      <div class="esc-dots" id="escDots"><i class="on"></i><i></i><i></i><i></i></div>
    </div>
  </div>

  <!-- ═══ DOLORES ═══ -->
  <section id="dolores">
    <div class="cab reveal">
      <span class="k">¿Te suena?</span>
      <h2>Los cuatro dolores de invertir en Meta — <span class="grad">resueltos</span></h2>
    </div>
    <div class="dolores">
      <div class="dolor reveal" style="--acc:var(--rojo)">
        <p class="queja">Me di cuenta tarde y la campaña quemó $200.000 el fin de semana."</p>
        <p class="sol">AdsLab revisa tus campañas todos los días contra <b>tu</b> punto de equilibrio por producto y te marca qué pausar — con el monto exacto que está en juego.</p>
        <span class="res"><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Pausás a tiempo, todos los días</span>
      </div>
      <div class="dolor reveal d1" style="--acc:var(--ambar)">
        <p class="queja">Mis editores me preguntan qué editar y nunca llego a pasarles los ganadores."</p>
        <p class="sol">Cada mañana el sistema detecta solo qué video está vendiendo, lo marca en el tablero del equipo y avisa por Discord. Nadie espera tu mensaje.</p>
        <span class="res"><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>El equipo replica ganadores solo</span>
      </div>
      <div class="dolor reveal d2" style="--acc:var(--rosa)">
        <p class="queja">Espero tres días un creativo nuevo y no sé si va a funcionar."</p>
        <p class="sol">Elegís los ads de tu competencia que ya venden y AdsLab genera creativos con tu producto imitándolos — ángulos, eventos y nomenclatura incluidos.</p>
        <span class="res"><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Creativos listos en 2 minutos</span>
      </div>
      <div class="dolor reveal d3" style="--acc:var(--cian)">
        <p class="queja">Vivo copiando números del Ads Manager a una planilla."</p>
        <p class="sol">Métricas, embudo de compra, testeos por semana y presupuestos editables — todo en un tablero que se actualiza solo y habla tu idioma: plata ganada o quemada.</p>
        <span class="res"><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>5 minutos por día, no 2 horas</span>
      </div>
    </div>
  </section>

  <!-- ═══ RESULTADOS ═══ -->
  <section>
    <div class="cab reveal">
      <span class="k">Lo que te llevás</span>
      <h2>Resultados desde la primera semana</h2>
    </div>
    <div class="resultados">
      <div class="resu reveal"><div class="v">−8 h</div><div class="l">por semana de gestión manual que recuperás</div></div>
      <div class="resu reveal d1"><div class="v">24/7</div><div class="l">tus campañas vigiladas contra tu break-even</div></div>
      <div class="resu reveal d2"><div class="v">2 min</div><div class="l">por creativo nuevo, desde la competencia que vende</div></div>
      <div class="resu reveal d3"><div class="v">0</div><div class="l">planillas, capturas y "¿qué edito ahora?"</div></div>
    </div>
  </section>

  <!-- ═══ PRECIOS ═══ -->
  <section id="precios">
    <div class="cab reveal">
      <span class="k">Precios</span>
      <h2>Pagás según cuánto invertís</h2>
      <p>Todos los planes con créditos de IA incluidos. 14 días gratis, sin tarjeta.</p>
    </div>
    <div class="precios">
      <div class="plan reveal">
        <h3>Starter</h3>
        <div class="p">US$ 49 <small>/mes</small></div>
        <p class="para">Invertís hasta US$5.000/mes</p>
        <ul>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Optimización diaria con tu break-even</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Embudo y testeos por semana</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>30 creativos IA por mes</li>
        </ul>
        <button class="btn" data-accion="entrar">Empezar gratis</button>
      </div>
      <div class="plan star reveal d1">
        <span class="tag">EL MÁS ELEGIDO</span>
        <h3>Pro</h3>
        <div class="p">US$ 149 <small>/mes</small></div>
        <p class="para">Invertís hasta US$30.000/mes</p>
        <ul>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-star"/></svg>Winners automáticos + Discord</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Tu equipo de editores adentro</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Publicás campañas con un click</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>150 creativos IA por mes</li>
        </ul>
        <button class="btn primario" data-accion="entrar">Empezar gratis</button>
      </div>
      <div class="plan reveal d2">
        <h3>Agencia</h3>
        <div class="p">US$ 399 <small>/mes</small></div>
        <p class="para">Multi-cliente · hasta US$150.000/mes</p>
        <ul>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>10 cuentas · equipo ilimitado</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>Marca blanca · soporte prioritario</li>
          <li><svg viewBox="0 0 24 24" class="ico"><use href="#i-check"/></svg>500 creativos IA por mes</li>
        </ul>
        <button class="btn" data-accion="entrar">Hablar con nosotros</button>
      </div>
    </div>
  </section>

  <!-- ═══ CTA FINAL ═══ -->
  <div class="final reveal">
    <h2>La plata que quemaste este mes <span class="grad">pagaba 10 años de AdsLab</span></h2>
    <p>Conectá tu cuenta de Meta y mirá qué habría pausado hoy. Son 30 segundos.</p>
    <button class="btn primario" data-accion="entrar">Probar AdsLab 14 días gratis <svg viewBox="0 0 24 24" class="ico" style="width:15px;height:15px"><use href="#i-send"/></svg></button>
  </div>

  <footer>
    <span class="logo" style="font-size:14px"><span class="cubo" style="width:24px;height:24px;border-radius:8px"><svg viewBox="0 0 24 24" class="ico" style="width:12px;height:12px;stroke:#fff"><use href="#i-flask"/></svg></span>AdsLab</span>
    <span>· Hecho en Argentina por gente que invierte en ads todos los días</span>
    <div class="links"><a href="#dolores">Para quién</a><a href="#precios">Precios</a><a href="#">Términos</a></div>
  </footer>
</div>`;

export default function Landing({ onEntrar }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const lp = root.querySelector('.lp') || root;

    if (!document.querySelector('link[data-lp-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.lpFonts = '1';
      link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(link);
    }

    const tituloAnterior = document.title;
    document.title = 'AdsLab — Vende mas, quema menos, sin vivir en el Ads Manager';

    const onClick = (e) => {
      const btn = e.target.closest('[data-accion]');
      if (!btn) return;
      if (btn.dataset.accion === 'entrar') onEntrar?.();
    };
    root.addEventListener('click', onClick);

    const timers = [];
    let io = null, loop = null;
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
        const t0 = performance.now(), dur = 800;
        const paso = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          el.textContent = Math.round(desde + (fin - desde) * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
      } catch {}
    };

    // El "GIF": rota las escenas cada 4.6s; los puntos saltan de escena.
    try {
      const escenas = [...lp.querySelectorAll('.esc')];
      const dots = [...lp.querySelectorAll('.esc-dots i')];
      let cur = 0;
      const DUR = 4600;
      const irA = (i) => {
        cur = i;
        escenas.forEach((e, j) => {
          e.classList.toggle('on', j === i);
          if (j === i) {
            timers.push(setTimeout(() => e.querySelectorAll('[data-cuenta]').forEach(el => {
              el.textContent = el.dataset.desde || '0';
              timers.push(setTimeout(() => contar(el), 1900));
            }), 50));
          }
        });
        dots.forEach((d, j) => d.classList.toggle('on', j === i));
      };
      dots.forEach((d, i) => d.addEventListener('click', () => {
        irA(i); clearInterval(loop);
        loop = setInterval(() => irA((cur + 1) % escenas.length), DUR);
      }));
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        loop = setInterval(() => irA((cur + 1) % escenas.length), DUR);
        irA(0);
      }
    } catch {}

    return () => {
      document.title = tituloAnterior;
      root.removeEventListener('click', onClick);
      clearInterval(loop);
      timers.forEach(clearTimeout);
      try { io?.disconnect(); } catch {}
    };
  }, [onEntrar]);

  return (
    <div ref={ref}>
      <style>{CSS}</style>
      <div className="lp" dangerouslySetInnerHTML={{ __html: HTML }} />
    </div>
  );
}
