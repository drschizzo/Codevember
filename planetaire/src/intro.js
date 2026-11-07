// Introduction : le cycle complet en miniature, en ~20 s qui bouclent.
//
// Un petit film en Canvas 2D (indépendant de WebGPU, donc il tourne pendant
// que la vraie simulation s'initialise) : effondrement du nuage, protoétoile
// et jets, allumage, croissance des planètes qui creusent leurs sillons,
// dissipation du disque (ceinture de débris), supergéante rouge, supernova et
// pulsar, puis un nouveau nuage. Rien n'est intégré physiquement : chaque grain
// suit une trajectoire scriptée (seul son angle orbital est intégré), avec un
// tirage aléatoire fixe pour que chaque boucle soit identique.
//
// Les grains portent la même couleur de provenance que dans la simulation.
import { provenanceRGB } from './palette.js';
import { clamp, ss, lerp, mixRGB as mixc } from './util.js';

const canvas = document.getElementById('introAnim');
if (canvas) run();

function run() {
  const intro = document.getElementById('intro');
  const label = document.getElementById('introLabel');
  const bar = document.querySelector('#introBar u');
  const ctx = canvas.getContext('2d');

  // ——— chronologie (secondes) ———
  const T = 20;
  const T_IGN = 4.4;                 // allumage
  const T_CLR = 10.4, T_CLR_D = 2.0; // dissipation : front de l'intérieur vers l'extérieur
  const T_GI0 = 12.6, T_GI1 = 15.6;  // supergéante
  const T_COL = 16.0, T_BOOM = 16.35; // effondrement du cœur, explosion
  const PH = [
    [0, 'Effondrement du nuage'],
    [3.0, 'Protoétoile'],
    [T_IGN, 'Allumage'],
    [5.2, 'Formation des planètes'],
    [T_CLR, 'Dissipation du disque'],
    [T_GI0, 'Supergéante rouge'],
    [T_COL, 'Supernova'],
    [18.9, 'Un nouveau nuage…'],
  ];

  // ——— utilitaires ———
  let seed = 0x9e3779b9;
  const rnd = () => { // mulberry32 : même film à chaque boucle
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const unit = () => {
    const z = 2 * rnd() - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    return [s * Math.cos(a), s * Math.sin(a), z];
  };
  const auOf = (rd) => 0.35 + 8.65 * Math.pow(clamp((rd - 0.09) / 1.0), 1.25);

  const COL_PROTO = [1.0, 0.32, 0.1], COL_MAIN = [1.0, 0.84, 0.66], COL_GIANT = [1.0, 0.27, 0.07];
  const GAS = [0.87, 0.78, 0.62];
  const EJ = [[1.0, 0.3, 0.24], [0.55, 0.6, 1.0], [1.0, 0.62, 0.34]]; // Hα, bleu-violet, chaud

  // ——— planètes : rayon orbital, taille, fenêtre de croissance, zone d'alimentation ———
  const PL = [
    { r: 0.17, sz: 1.7, ts: 4.8, te: 8.0, w: 0.035 },
    { r: 0.27, sz: 2.1, ts: 5.0, te: 8.5, w: 0.045 },
    { r: 0.41, sz: 1.9, ts: 5.2, te: 9.0, w: 0.05 },
    { r: 0.56, sz: 4.8, ts: 5.0, te: 9.6, w: 0.08, gas: 0.6 },
    { r: 0.92, sz: 3.3, ts: 5.6, te: 10.0, w: 0.07, gas: 0.35 },
  ];
  for (const p of PL) {
    const c = provenanceRGB(auOf(p.r));
    p.col = p.gas ? mixc(c, GAS, p.gas) : c;
  }
  const BELT = [0.67, 0.79];

  // ——— grains ———
  const N = 11000;
  const STAR = -1, BELTF = 5, BLOWN = 6, INWARD = 7;
  const R0 = new Float32Array(N), Z0 = new Float32Array(N), PH0 = new Float32Array(N);
  const RD = new Float32Array(N), HZ = new Float32Array(N), DEL = new Float32Array(N);
  const FATE = new Int8Array(N), TEV = new Float32Array(N), TW = new Float32Array(N);
  const COL = new Float32Array(N * 3), EJD = new Float32Array(N * 3), EJF = new Float32Array(N);
  const EJC = new Uint8Array(N), A = new Float64Array(N);

  const LOBES = Array.from({ length: 28 }, unit); // « doigts » de Rayleigh-Taylor
  for (let i = 0; i < N; i++) {
    const r0 = 0.25 + 0.75 * Math.cbrt(rnd());
    const ct = 2 * rnd() - 1, st = Math.sqrt(1 - ct * ct);
    const ph = rnd() * Math.PI * 2;
    R0[i] = r0 * st; Z0[i] = r0 * ct * 0.85; PH0[i] = ph;
    // rayon centrifuge : le moment cinétique fixe le lieu de naissance dans le disque
    const rd = Math.min(1.1, 1.1 * st * st * Math.pow(r0, 1.3) * (0.85 + 0.3 * rnd()));
    RD[i] = rd;
    HZ[i] = (rnd() + rnd() + rnd() - 1.5) * 0.035 * rd;
    DEL[i] = 0.15 + 1.4 * Math.pow(r0, 1.5);
    TW[i] = rnd() * 6.283;
    const c = provenanceRGB(auOf(rd));
    COL[i * 3] = c[0]; COL[i * 3 + 1] = c[1]; COL[i * 3 + 2] = c[2];

    let fate = rd < 0.09 ? STAR : -2;
    if (fate === -2) {
      for (let k = 0; k < PL.length; k++) {
        const p = PL[k];
        if (Math.abs(rd - p.r) < p.w && rnd() < 0.9) { fate = k; TEV[i] = p.ts + (p.te - p.ts) * Math.pow(rnd(), 0.8); break; }
      }
    }
    if (fate === -2 && rd > BELT[0] && rd < BELT[1] && rnd() < 0.85) fate = BELTF;
    if (fate === -2) {
      fate = rnd() < 0.6 ? BLOWN : INWARD;
      TEV[i] = T_CLR + (rd - 0.05) / 1.1 * T_CLR_D + (rnd() - 0.5) * 0.3;
    }
    FATE[i] = fate;

    // éjecta : la plupart dans les doigts, le reste en coquille
    let d, f;
    const j = Math.floor(rnd() * LOBES.length);
    if (rnd() < 0.65) {
      const u = unit(), L = LOBES[j];
      d = [L[0] + u[0] * 0.28, L[1] + u[1] * 0.28, L[2] + u[2] * 0.28];
      const n = Math.hypot(...d); d = d.map((v) => v / n);
      f = 0.95 + 0.35 * Math.sqrt(rnd());
      EJC[i] = j % 2;
    } else {
      d = unit(); f = 0.6 + 0.25 * rnd(); EJC[i] = 2;
    }
    EJD[i * 3] = d[0]; EJD[i * 3 + 1] = d[1]; EJD[i * 3 + 2] = d[2]; EJF[i] = f;
  }

  const PA = new Float64Array(PL.length), engT = new Float32Array(PL.length), swT = new Float32Array(PL.length);
  function resetLoop() {
    for (let i = 0; i < N; i++) A[i] = PH0[i];
    for (let k = 0; k < PL.length; k++) { PA[k] = k * 2.4 + 0.7; engT[k] = -1; swT[k] = -1; }
  }
  resetLoop();

  // ——— taille du canevas ———
  let cw = 0, ch = 0, dpr = 1, Sc = 1, Sd = 1, buf, acc, img, pctx, bw = 0, bh = 0, bs = 1, ay = 0;
  const card = intro.querySelector('.card');
  const EL = 24 * Math.PI / 180, SE = Math.sin(EL), CE = Math.cos(EL), CAM = 4.5;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === cw && h === ch)) return;
    cw = w; ch = h; dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    // tampon des grains à résolution réduite sur grand écran (points plus doux, moins de calcul)
    bs = Math.min(1, 1100 / cw); bw = Math.round(cw * bs); bh = Math.round(ch * bs);
    buf = document.createElement('canvas'); buf.width = bw; buf.height = bh;
    pctx = buf.getContext('2d');
    img = pctx.createImageData(bw, bh);
    acc = new Float32Array(bw * bh * 3);
    // zone visible : au-dessus du titre et des boutons (qui débordent un peu sur le disque)
    const ah = ch - (card ? card.offsetHeight : 0) * 0.72;
    ay = ah / 2;
    Sc = Math.min(ah / 2 / 1.08, cw / 2 / 1.1); // nuage
    Sd = Math.min(ah / 2 / 0.6, cw / 2 / 1.25); // disque
  }

  // projection : caméra au-dessus du plan du disque (élévation EL), légère perspective
  let S = 1, cx = 0, cy = 0;
  const P = { x: 0, y: 0, d: 0, k: 1 };
  function project(x, y, z) {
    const depth = -y * CE + z * SE, up = y * SE + z * CE, k = CAM / (CAM - depth);
    P.x = cx + x * S * k; P.y = cy - up * S * k; P.d = depth; P.k = k;
    return P;
  }

  function splat(x, y, r, g, b, a) {
    if (a <= 0.002) return;
    x *= bs; y *= bs;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= bw - 1 || y0 >= bh - 1) return;
    const fx = x - x0, fy = y - y0;
    const w = [(1 - fx) * (1 - fy) * a, fx * (1 - fy) * a, (1 - fx) * fy * a, fx * fy * a];
    const o = [(y0 * bw + x0) * 3, (y0 * bw + x0 + 1) * 3, ((y0 + 1) * bw + x0) * 3, ((y0 + 1) * bw + x0 + 1) * 3];
    for (let q = 0; q < 4; q++) { acc[o[q]] += r * w[q]; acc[o[q] + 1] += g * w[q]; acc[o[q] + 2] += b * w[q]; }
  }

  function glow(x, y, rad, col, a, core = 0) {
    if (a <= 0.003 || rad <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = (k) => `rgba(${col.map((v) => Math.round(clamp(v * k) * 255)).join(',')},`;
    g.addColorStop(0, c(1.3) + a + ')');
    if (core) g.addColorStop(core, c(1) + a * 0.5 + ')');
    g.addColorStop(0.35, c(1) + a * 0.18 + ')');
    g.addColorStop(1, c(1) + '0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const rgba = (c, a, k = 1) => `rgba(${c.map((v) => Math.round(clamp(v * k) * 255)).join(',')},${a})`;

  // ——— image ———
  let t = 0, last = performance.now(), raf = 0, phaseShown = -1;
  const W0 = 0.45; // vitesse angulaire à r = 1 (rad/s)

  function frame(now) {
    raf = 0;
    if (!canvas.isConnected) return;
    if (intro.classList.contains('gone')) return; // reprend si l'accueil revient
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    t += dt;
    if (t >= T) { t -= T; resetLoop(); }
    resize();
    if (!cw) return;

    // ——— état global ———
    const A0 = ss(0, 1.0, t);                                    // le nuage apparaît
    const F = 1 - ss(18.8, 19.9, t);                             // le rémanent s'éteint
    const g = ss(T_GI0, T_GI1, t);                               // supergéante
    const E = 1 + 0.22 * g;                                      // orbites élargies par la perte de masse
    const col = ss(T_COL, T_BOOM, t);                            // effondrement du cœur
    const boom = t >= T_BOOM, tb = t - T_BOOM;
    const Sr = boom ? 0.95 * Math.pow(tb, 0.65) : 0;             // onde de choc
    const heat = boom ? Math.exp(-tb * 1.6) : 0;
    S = Sc + (Sd - Sc) * (ss(0.3, 3.2, t) - ss(16.4, 19.4, t));  // zoom : nuage → disque → rémanent
    const u = S / 250; // (tailles des halos, à l'échelle du disque)
    cx = cw / 2; cy = ay + ay * 0.06 * ss(0.3, 3.2, t) * (1 - ss(16.4, 19.4, t));

    let starR, starCol, starB;
    if (t < T_IGN) { starR = 0.026 + 0.012 * ss(0.5, 3, t); starCol = COL_PROTO; starB = (0.25 + 0.5 * ss(0.5, 3.5, t)) * A0; }
    else { starR = 0.038; starCol = mixc(COL_PROTO, COL_MAIN, ss(T_IGN, T_IGN + 0.7, t)); starB = 1; }
    const flash = t >= T_IGN && t < T_COL ? Math.exp(-(t - T_IGN) * 2.2) : 0;
    starCol = mixc(starCol, COL_GIANT, g);
    starR = lerp(starR, 0.36, g);
    starB *= 1 - 0.3 * g;
    starR = starR * Math.pow(1 - col, 2) + 0.004 * col;
    starB *= 1 - 0.85 * col;
    const light = (t < T_IGN ? 0.5 + 0.3 * ss(1, 4, t) : 1) * (1 - 0.6 * col);

    // ——— grains ———
    acc.fill(0);
    for (let i = 0; i < N; i++) {
      const fate = FATE[i], rd = RD[i];
      let r = COL[i * 3], gg = COL[i * 3 + 1], b = COL[i * 3 + 2];
      let a = 0.4 * (0.8 + 0.2 * Math.sin(t * 3 + TW[i]));
      let x, y, z, dead = false;

      // effondrement : le grain glisse de sa place dans le nuage vers son rayon centrifuge
      const u = clamp((t - DEL[i]) / 1.3), c = u * u * (3 - 2 * u);
      let R = lerp(R0[i], fate === STAR ? 0 : rd, c);
      z = lerp(Z0[i], HZ[i], c);
      if (fate === STAR) {
        a *= 1 - ss(0.65, 1, c);
        const h = ss(0.3, 1, c); r = lerp(r, 1, h); gg = lerp(gg, 0.45, h); b = lerp(b, 0.2, h);
        if (c >= 1) dead = true;
      }
      // rotation : moment cinétique conservé (accélère en tombant), képlérien une fois posé
      const w = Math.min(9, W0 * Math.sqrt(Math.max(rd, 0.03)) / Math.max(R, 0.05) ** 2) / (E * E);
      A[i] += w * dt;
      let ang = A[i];

      if (fate >= 0 && fate < PL.length && t > TEV[i]) { // capté par une planète
        const v = (t - TEV[i]) / 0.4;
        if (v >= 1) dead = true;
        else {
          const p = PL[fate];
          let da = ((PA[fate] - ang) % 6.2832 + 9.4248) % 6.2832 - 3.1416;
          ang += da * v * v; R = lerp(R, p.r, v); a *= 1 - v * v;
          r = lerp(r, 1, v * 0.5); gg = lerp(gg, 0.9, v * 0.5); b = lerp(b, 0.8, v * 0.5);
        }
      } else if ((fate === BLOWN || fate === INWARD) && t > TEV[i]) { // dissipation
        const v = (t - TEV[i]) / 0.7;
        if (v >= 1) dead = true;
        else if (fate === BLOWN) { R += v * v * 0.9; a *= 1 - v; }
        else { R *= Math.pow(1 - v, 0.7); a *= 1 - v * v * v; }
      }

      if (!dead && !boom) {
        R *= E;
        if (g > 0) { // éclairé par la géante : rougit, chauffe
          r = lerp(r, 1, g * 0.5); gg = lerp(gg, 0.45, g * 0.6); b = lerp(b, 0.3, g * 0.7);
          if (R < starR * 1.02) continue;
        }
        x = R * Math.cos(ang); y = R * Math.sin(ang);
        a *= (fate === STAR ? 1 : light) * A0;
      } else if (!dead) { // ceinture balayée par l'onde de choc
        R *= E;
        const front = Sr * EJF[i] * 0.92;
        if (front > R) {
          const h = Math.exp(-(front - R) * 2.5);
          R = front; r = lerp(r, 1, h); gg = lerp(gg, 0.75, h); b = lerp(b, 0.55, h); a *= 0.8 + 1.5 * h;
        } else a *= 0.4 + 0.6 * heat;
        x = R * Math.cos(ang); y = R * Math.sin(ang); a *= F;
      } else if (boom) { // éjecta : tout ce qui a été avalé, capté ou soufflé revient
        const s = Sr * EJF[i];
        x = EJD[i * 3] * s; y = EJD[i * 3 + 1] * s; z = EJD[i * 3 + 2] * s;
        const ec = EJ[EJC[i]], h = Math.min(1, heat * 1.6);
        r = lerp(ec[0], 1, h); gg = lerp(ec[1], 0.95, h); b = lerp(ec[2], 0.85, h);
        a = (0.9 + 2.2 * heat) * F * (0.75 + 0.25 * Math.sin(t * 2 + TW[i]));
        // courte traînée vers le centre : les doigts se lisent comme des filaments
        for (let q = 1; q <= 3; q++) {
          const p = project(x * (1 - 0.05 * q), y * (1 - 0.05 * q), z * (1 - 0.05 * q));
          splat(p.x, p.y, r, gg, b, a * (0.5 - 0.12 * q));
        }
      } else continue;

      const p = project(x, y, z);
      splat(p.x, p.y, r, gg, b, a);
    }
    const data = img.data;
    for (let q = 0, o = 0; q < acc.length; q += 3, o += 4) {
      data[o] = 255 * (1 - Math.exp(-acc[q] * 1.6));
      data[o + 1] = 255 * (1 - Math.exp(-acc[q + 1] * 1.6));
      data[o + 2] = 255 * (1 - Math.exp(-acc[q + 2] * 1.6));
      data[o + 3] = 255;
    }
    pctx.putImageData(img, 0, 0);

    // ——— composition ———
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.fillStyle = '#010103';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';

    // nébuleuse : le berceau du nouveau nuage (symétrique autour de la boucle)
    const neb = t > 10 ? ss(18.2, 20, t) : 1 - ss(0, 2.4, t);
    if (neb > 0.01) {
      glow(cx, cy, Sc * 1.25, [0.55, 0.32, 0.75], 0.16 * neb);
      glow(cx - Sc * 0.3, cy + Sc * 0.15, Sc * 0.8, [0.8, 0.28, 0.3], 0.08 * neb);
    }
    // gaz du disque : lueur aplatie, qui se dissipe après l'allumage
    const gas = ss(1.5, 3.2, t) * (1 - ss(5.5, T_CLR + 0.6, t));
    if (gas > 0.01) {
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(1, SE);
      glow(0, 0, S * 1.1, t < T_IGN ? [0.85, 0.42, 0.32] : [0.9, 0.68, 0.5], 0.22 * gas);
      ctx.restore();
    }

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buf, 0, 0, cw, ch);
    ctx.filter = `blur(${(3 * Math.max(1, u * 0.7)).toFixed(1)}px)`; ctx.globalAlpha = 0.65;
    ctx.drawImage(buf, 0, 0, cw, ch);
    ctx.filter = 'none'; ctx.globalAlpha = 1;

    // planètes : derrière l'étoile, l'étoile, puis devant
    const planets = [];
    for (let k = 0; k < PL.length; k++) {
      const p = PL[k];
      PA[k] += W0 * Math.min(9, Math.pow(p.r, -1.5)) / (E * E) * dt;
      if (t < p.ts || engT[k] >= 0 && t - engT[k] > 0.6) continue;
      let R = p.r * E, al = ss(p.ts, p.ts + 0.4, t);
      const frac = clamp((t - p.ts) / (p.te - p.ts));
      let sz = p.sz * (0.3 + 0.7 * Math.cbrt(frac)), pc = p.col, hot = 0;
      if (g > 0 && k >= 3) pc = mixc(pc, [1, 0.62, 0.42], g * 0.35); // les glaces fondent
      if (engT[k] < 0 && !boom && R < starR * 1.03) engT[k] = t;
      if (engT[k] >= 0) { const v = (t - engT[k]) / 0.6; al *= 1 - v; hot = 1 - v; }
      if (boom) {
        if (Sr * 0.95 > R) { if (swT[k] < 0) swT[k] = t; R = Sr * 0.95; }
        if (swT[k] >= 0) { const v = (t - swT[k]) / 1.4; if (v >= 1) continue; al *= 1 - v; hot = Math.max(hot, 1 - v); }
      }
      const pr = project(R * Math.cos(PA[k]), R * Math.sin(PA[k]), 0);
      planets.push({ x: pr.x, y: pr.y, d: pr.d, rad: Math.max(1.1, sz * pr.k * S / 250), col: pc, al: al * (boom ? 1 : light), hot });
    }
    const sx = cx, sy = cy, sRad = starR * S * CAM / CAM;
    const drawPlanet = (q) => {
      if (q.al <= 0.01) return;
      ctx.globalCompositeOperation = 'source-over';
      const lx = sx - q.x, ly = sy - q.y, ln = Math.hypot(lx, ly) || 1;
      const gx = q.x + lx / ln * q.rad * 0.45, gy = q.y + ly / ln * q.rad * 0.45;
      const gr = ctx.createRadialGradient(gx, gy, 0, q.x, q.y, q.rad);
      gr.addColorStop(0, rgba(q.col, q.al, 1.25));
      gr.addColorStop(0.7, rgba(q.col, q.al, 0.55));
      gr.addColorStop(1, rgba(q.col, q.al, 0.15));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.rad, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      glow(q.x, q.y, q.rad * 3.2, q.col, 0.18 * q.al);
      if (q.hot > 0) glow(q.x, q.y, q.rad * (3 + 5 * (1 - q.hot)), [1, 0.7, 0.45], 0.7 * q.hot * q.al);
    };
    for (const q of planets) if (q.d < 0) drawPlanet(q);

    // étoile
    if (!boom && starB > 0.005) {
      const rad = Math.max(1.4, sRad);
      glow(sx, sy, rad * 3 + (14 + 30 * starB) * u, starCol, 0.55 * starB);
      ctx.globalCompositeOperation = 'source-over';
      const gr = ctx.createRadialGradient(sx, sy - rad * 0.1, 0, sx, sy, rad);
      const hotCore = mixc(starCol, [1, 1, 1], 0.55 * (1 - g));
      gr.addColorStop(0, rgba(hotCore, starB));
      gr.addColorStop(0.75, rgba(starCol, starB, 0.95));
      gr.addColorStop(1, rgba(starCol, starB, 0.6));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(sx, sy, rad * (1 + 0.012 * Math.sin(t * 5) * g), 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      // jets de la protoétoile, le long de l'axe de rotation
      const jet = ss(2.4, 3.2, t) * (1 - ss(4.3, 5.0, t));
      if (jet > 0.01) {
        const len = 0.55 * S;
        for (const sg of [1, -1]) {
          const tipY = sy - sg * len * CE;
          const lg = ctx.createLinearGradient(sx, sy, sx, tipY);
          lg.addColorStop(0, `rgba(255,170,140,${0.55 * jet})`);
          lg.addColorStop(1, 'rgba(160,140,255,0)');
          ctx.fillStyle = lg;
          ctx.beginPath(); ctx.ellipse(sx, (sy + tipY) / 2, 1.8 * Math.max(1, u * 0.8), len * CE / 2, 0, 0, 6.2832); ctx.fill();
          for (let n = 0; n < 3; n++) { // nœuds qui remontent le jet
            const v = (t * 0.9 + n / 3) % 1;
            glow(sx, sy - sg * len * CE * v, 5 * u, [1, 0.6, 0.7], 0.5 * jet * (1 - v));
          }
        }
      }
      // allumage : éclair et traînée anamorphique
      if (flash > 0.01) {
        glow(sx, sy, S * 0.9, [1, 0.9, 0.75], 0.6 * flash);
        streak(sx, sy, cw * 0.55, [1, 0.85, 0.7], 0.5 * flash);
      }
    }
    for (const q of planets) if (q.d >= 0) drawPlanet(q);

    // supernova : éclair, onde de choc, pulsar
    if (boom) {
      const fl = Math.exp(-tb * 3.2);
      glow(cx, cy, Math.max(cw, ch) * 0.7, [1, 0.93, 0.85], 0.95 * fl);
      streak(cx, cy, cw * 0.7, [0.8, 0.85, 1], 0.7 * fl);
      const ringA = 0.45 * Math.exp(-tb * 0.9) * F;
      if (ringA > 0.01) {
        ctx.strokeStyle = `rgba(255,205,170,${ringA})`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(cx, cy, Sr * S, Sr * S * SE, 0, 0, 6.2832); ctx.stroke();
      }
      const pul = ss(T_BOOM + 0.5, T_BOOM + 1.3, t) * F;
      if (pul > 0.01) {
        const ph = t * 7;
        glow(cx, cy, 7 * u, [0.6, 0.75, 1], 0.9 * pul);
        for (const sg of [1, -1]) {
          const bx = sg * Math.sin(0.5) * Math.cos(ph), by = sg * Math.sin(0.5) * Math.sin(ph), bz = sg * Math.cos(0.5);
          const e = project(bx * 0.75, by * 0.75, bz * 0.75);
          const facing = 0.35 + 0.65 * Math.max(0, e.d / 0.75);
          const lg = ctx.createLinearGradient(cx, cy, e.x, e.y);
          lg.addColorStop(0, `rgba(170,195,255,${0.7 * pul * facing})`);
          lg.addColorStop(1, 'rgba(170,195,255,0)');
          ctx.strokeStyle = lg; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e.x, e.y); ctx.stroke();
        }
      }
    }
    // effondrement : le noir se fait juste avant l'explosion
    ctx.globalCompositeOperation = 'source-over';

    // légende
    let ph = 0;
    while (ph + 1 < PH.length && t >= PH[ph + 1][0]) ph++;
    if (ph !== phaseShown) {
      phaseShown = ph;
      label.classList.add('swap');
      setTimeout(() => { label.textContent = PH[ph][1]; label.classList.remove('swap'); }, 220);
    }
    bar.style.width = (t / T * 100).toFixed(2) + '%';
  }

  function streak(x, y, half, col, a) {
    if (a <= 0.01) return;
    const lg = ctx.createLinearGradient(x - half, y, x + half, y);
    lg.addColorStop(0, rgba(col, 0)); lg.addColorStop(0.5, rgba(col, a)); lg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.ellipse(x, y, half, 1.6, 0, 0, 6.2832); ctx.fill();
  }

  // repères de phases sous la barre
  const ticks = document.getElementById('introBar');
  for (const [t0] of PH.slice(1)) {
    const s = document.createElement('i'); s.style.left = (t0 / T * 100) + '%'; ticks.appendChild(s);
  }

  const kick = () => { if (!raf && canvas.isConnected && !intro.classList.contains('gone')) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  new MutationObserver(kick).observe(intro, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => { cw = 0; });
  kick();
  window.__intro = { get t() { return t; }, set t(v) { t = v; } }; // (débogage)
}
