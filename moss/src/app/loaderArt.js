// Moss — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// La propagation de la scène, en direct et en petit : la même pierre (son
// relief, ses fissures), le même habitat et les mêmes averses que le film
// (field.js, gen/rock.js), et la même équation de Fisher-KPP intégrée ici, pas
// à pas. Au départ, la sécheresse : des touffes brunes, fermées, dans les
// fissures. Puis les averses passent en bandes (la roche fonce sous elles),
// les rosettes s'ouvrent d'un coup à l'eau (la reviviscence), et les tiges
// poussent depuis les refuges : le front avance, plus clair, et les coussins
// se rejoignent. Pendant la préparation de la lumière, la saison des pluies
// s'installe et le soleil vient sur le coussin ; à la fin, on s'approche du
// bord d'un îlot, là où la caméra du film commence son travelling.
import { makeHabitat, showers, rainAt, rainNow, wetSeason, FIELD_N, YEAR } from '../field.js';
import { makeRock, ROCK_PALETTES } from '../gen/rock.js';
import { FAMILIES } from '../families.js';
import { createRng, createNoise3, smoothstep as sst } from '../../../shared/rng.js';

const TILT = 0.56, RISE = 0.84;   // vue oblique : profondeur écrasée, hauteur un peu raccourcie
const U0 = 0.035, UMAX = 0.55;     // de la sécheresse au cœur de la saison des pluies
const DU = 1 / 640;                // un pas d'intégration (part d'année, ~0,57 jour)
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a, k = 1) => `rgba(${Math.round(Math.min(255, c[0] * k))}, ${Math.round(Math.min(255, c[1] * k))}, ${Math.round(Math.min(255, c[2] * k))}, ${a.toFixed(3)})`;
const ARMS = { tortule: 5, polytric: 8, funaire: 4, sphaigne: 6 };
const OPEN_Q = 5, YOUNG_Q = 3;

// ── une scène : la pierre, l'habitat, le champ, les tiges ──
function makeWorld(d, lite) {
  const famKey = FAMILIES[d.family] ? d.family : 'tortule', fam = FAMILIES[famKey];
  const E = (d.radius || 3.8) * 1.12, N = FIELD_N, NN = N * N, dx = (2 * E) / N;
  const sunDir = d.sunDir ?? [0.4, 0.8, 0.3];
  const rock = d.rock ? makeRock(d.rock, d.rockSeed ?? 0) : null;
  const H = makeHabitat(d.seed, E, sunDir, rock);
  const SH = showers(d.seed);
  const look = { ...fam.color, ...(d.look || {}) };
  const C = { dry: hex(look.dry), wet: hex(look.wet), young: hex(look.young), old: hex(look.old), hair: hex(look.hair), seta: hex(look.seta), capsule: hex(look.capsule) };

  // champ (mêmes lois et paramètres que field.js, simulateField)
  const B = new Float32Array(NN), W = new Float32Array(NN), L = new Float32Array(NN), K = new Float32Array(NN), floor = new Float32Array(NN), rain = new Float32Array(NN);
  for (let k = 0; k < NN; k++) {
    K[k] = H.M[k] * (0.55 + 0.45 * Math.max(0, H.R[k]));
    floor[k] = H.M[k] * 0.5 * sst(0.45, 0.9, H.R[k]);
    B[k] = floor[k];
    W[k] = 0.12 * Math.max(0, H.R[k]) * H.M[k];
  }
  const P = { r: 0.034, D: 0.0011, m: 0.022, ev: 0.35 };
  function step(u) {
    const dt = YEAR * DU;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) rain[j * N + i] = rainAt(u, -E + dx * (i + 0.5), -E + dx * (j + 0.5), SH, E);
    const e = P.ev * (0.15 + 0.85 * (1 - wetSeason(u))), season = Math.max(0.15, wetSeason(u));
    for (let k = 0; k < NN; k++) {
      const rr = rain[k];
      W[k] = Math.min(1, Math.max(0, W[k] + dt * (rr * 3 * (1 - W[k]) - e * (rr > 0.05 ? 0.1 : 1) * (1.2 - H.R[k]) * W[k])));
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!H.M[k]) { L[k] = 0; continue; }
      const c = B[k], lap = (B[j * N + Math.max(0, i - 1)] + B[j * N + Math.min(N - 1, i + 1)] + B[Math.max(0, j - 1) * N + i] + B[Math.min(N - 1, j + 1) * N + i] - 4 * c) / (dx * dx);
      L[k] = P.D * lap + P.r * season * W[k] * c * (1 - c / Math.max(1e-3, K[k])) - P.m * (1 - W[k]) * (1 - Math.max(0, H.R[k])) ** 2 * c;
    }
    for (let k = 0; k < NN; k++) B[k] = Math.max(floor[k], Math.min(1, B[k] + dt * L[k]));
  }

  // tiges : semis aléatoire, plus lâche que le vrai (une tige dessinée en vaut plusieurs)
  const rng = createRng(`loader:${d.seed}`);
  const area = Math.PI * E * E * 0.8, want = lite ? 520 : 1000;
  const sp = Math.max(fam.shoot.spacing * 1.3, Math.sqrt(area / want));
  const S = [];
  for (let z = -E; z < E; z += sp) for (let x = -E; x < E; x += sp) {
    const px = x + (rng.next() - 0.5) * sp * 0.9, pz = z + (rng.next() - 0.5) * sp * 0.9;
    if (Math.hypot(px, pz) > E * 0.93) continue;
    const fx = Math.min(N - 1.001, Math.max(0, ((px + E) / (2 * E)) * N - 0.5)), fz = Math.min(N - 1.001, Math.max(0, ((pz + E) / (2 * E)) * N - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz);
    S.push({
      x: px, z: pz, k: j * N + i, a: fx - i, b: fz - j,
      th: 0.04 + 0.42 * rng.next() ** 1.4, hm: 0.7 + 0.5 * rng.next(), rot: rng.next() * 6.283, ph: rng.next() * 6.283,
      spor: rng.next() < fam.spor.frac * (famKey === 'funaire' ? 0.9 : 0.35), lit: rng.next() < 0.35, slow: 0, sx: 0, sy: 0,
    });
  }
  S.sort((p, q) => p.z - q.z); // (de l'arrière vers l'avant)

  // lieu du gros plan (comme gen/build.js) : le bord d'un refuge près du centre
  let hero = [0, 0], best = -1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -E + dx * (i + 0.5), z = -E + dx * (j + 0.5), v = H.R[j * N + i] * (1 - (Math.hypot(x, z) / E) * 1.4);
    if (v > best) { best = v; hero = [x, z]; }
  }

  // la silhouette de la pierre
  const nz = createNoise3(`outline:${d.seed}`), outline = [];
  for (let a = 0; a <= 96; a++) { const t = (a / 96) * 6.2832; outline.push([Math.cos(t), Math.sin(t), 0.985 + 0.03 * nz.fbm(Math.cos(t) * 1.3, 0.5, Math.sin(t) * 1.3, 3)]); }

  return {
    d, fam, famKey, E, N, H, SH, B, W, C, S, hero, rock, outline, sunDir, step,
    u: U0, uRain: U0, alpha: 0, fade: 1, rockRow: 0, rockLayer: null, rockA: 0, rockD: null, rockC: null,
  };
}

export default function createArt(S0) {
  const lite = !!S0.lite;
  let W = null, old = null, tData = -1, lit = 0;
  const RES = lite ? 140 : 224;
  // calques du champ (64², agrandis avec lissage)
  const veil = new OffscreenCanvas(FIELD_N, FIELD_N), vctx = veil.getContext('2d'), vimg = vctx.createImageData(FIELD_N, FIELD_N);
  const wet = new OffscreenCanvas(FIELD_N, FIELD_N), wctx = wet.getContext('2d'), wimg = wctx.createImageData(FIELD_N, FIELD_N);
  let drops = [], splashes = [], glints = [];
  // en attendant la recette : une pierre de granit à la sécheresse, la mousse en dormance dans ses fissures
  W = makeWorld({ seed: 'moss', radius: 3.7, rock: 'granite', rockSeed: 1207, family: 'tortule', water: 'rain' }, lite);
  W.alpha = 0;

  // relief de la pierre, quelques rangées par image (le dessin ne s'arrête jamais)
  function bakeRockRows(w, ms) {
    if (!w.rock || w.rockLayer) return;
    const t0 = performance.now(), E = w.E, n = RES, px = (2 * E) / n;
    w.rockD ??= new Float32Array(n * n); w.rockC ??= new Float32Array(n * n);
    while (w.rockRow < n && performance.now() - t0 < ms) {
      const j = w.rockRow++;
      for (let i = 0; i < n; i++) {
        const x = -E + (i + 0.5) * px, z = -E + (j + 0.5) * px;
        if (Math.hypot(x, z) > E * 1.02) continue;
        const o = w.rock.sample(x, z);
        w.rockD[j * n + i] = o.d; w.rockC[j * n + i] = o.crack;
      }
    }
    if (w.rockRow < n) return;
    // ombrage (le soleil de la scène), fissures sombres, bord qui s'estompe
    const pal = ROCK_PALETTES[w.rock.type] ?? ROCK_PALETTES.granite, base = hex(pal.base), dark = hex(pal.dark);
    const c = new OffscreenCanvas(n, n), cx = c.getContext('2d'), img = cx.createImageData(n, n);
    const sl = Math.hypot(w.sunDir[0], w.sunDir[2]) || 1, sx = w.sunDir[0] / sl, sz = w.sunDir[2] / sl;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = -E + (i + 0.5) * px, z = -E + (j + 0.5) * px, r = Math.hypot(x, z) / E;
      const D = w.rockD, gx = (D[j * n + Math.min(n - 1, i + 1)] - D[j * n + Math.max(0, i - 1)]) / (2 * px), gz = (D[Math.min(n - 1, j + 1) * n + i] - D[Math.max(0, j - 1) * n + i]) / (2 * px);
      const sh = Math.max(0.25, Math.min(1.6, 0.85 - 2.2 * (gx * sx + gz * sz)));
      const cr = w.rockC[k], col = mix3(base, dark, Math.min(1, cr * 1.1));
      const v = 0.36 * sh * (1 - 0.75 * cr) * (1 - 0.25 * r * r);
      img.data[k * 4] = col[0] * v; img.data[k * 4 + 1] = col[1] * v; img.data[k * 4 + 2] = col[2] * v;
      img.data[k * 4 + 3] = 255 * (1 - sst(0.9, 1.0, r));
    }
    cx.putImageData(img, 0, 0);
    w.rockLayer = c; w.rockD = w.rockC = null;
  }

  // le champ en images : voile vert de la mousse, eau sur la roche
  function paintField(w) {
    const NN = FIELD_N * FIELD_N, wc = w.C.wet, M = w.H.M;
    for (let k = 0; k < NN; k++) {
      const b = w.B[k], ww = w.W[k], m = M[k];
      const c = mix3(w.C.dry, wc, sst(0.15, 0.6, ww));
      vimg.data[k * 4] = c[0] * 0.42; vimg.data[k * 4 + 1] = c[1] * 0.42; vimg.data[k * 4 + 2] = c[2] * 0.42;
      vimg.data[k * 4 + 3] = 255 * m * Math.min(1, b * 0.9);
      wimg.data[k * 4] = 110; wimg.data[k * 4 + 1] = 140; wimg.data[k * 4 + 2] = 175;
      wimg.data[k * 4 + 3] = 255 * m * ww * 0.08;
    }
    vctx.putImageData(vimg, 0, 0); wctx.putImageData(wimg, 0, 0);
  }

  function drawWorld(ctx, w, S, sc, alpha) {
    if (alpha <= 0.002) return;
    const E = w.E, dpr = S.dpr, fam = w.fam, F = w.famKey, arms = ARMS[F] ?? 5;
    // la pierre
    ctx.save(); ctx.scale(1, TILT);
    if (w.rockLayer) {
      w.rockA = Math.min(1, w.rockA + S.dt * 1.5);
      ctx.globalAlpha = alpha * w.rockA;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(w.rockLayer, -E * sc, -E * sc, 2 * E * sc, 2 * E * sc);
    }
    // eau puis voile de mousse (64², lissés)
    paintField(w);
    ctx.globalAlpha = alpha;
    ctx.drawImage(wet, -E * sc, -E * sc, 2 * E * sc, 2 * E * sc);
    ctx.drawImage(veil, -E * sc, -E * sc, 2 * E * sc, 2 * E * sc);
    // la silhouette de la pierre
    ctx.globalAlpha = alpha * (0.35 + 0.65 * (1 - w.rockA * 0.6));
    ctx.strokeStyle = 'rgba(236, 228, 214, 0.16)'; ctx.lineWidth = dpr / TILT * 0.8;
    ctx.beginPath();
    w.outline.forEach(([c, s, r], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, c * r * E * sc, s * r * E * sc));
    ctx.stroke();
    ctx.restore();

    // les tiges
    const N = w.N, B = w.B, Wf = w.W, dome = fam.shoot.dome, leafL = (fam.leaf.L[0] + fam.leaf.L[1]) * 0.5;
    const rosQ = Array.from({ length: OPEN_Q * YOUNG_Q }, () => []), stemQ = Array.from({ length: OPEN_Q }, () => []), spor = [], tips = [];
    const t = S.t, sway = 0.035 + 0.05 * sst(0.2, 0.9, w.uRain);
    for (const p of w.S) {
      const k = p.k, a = p.a, b = p.b;
      const bv = (B[k] * (1 - a) + B[k + 1] * a) * (1 - b) + (B[k + N] * (1 - a) + B[k + N + 1] * a) * b;
      const wv = (Wf[k] * (1 - a) + Wf[k + 1] * a) * (1 - b) + (Wf[k + N] * (1 - a) + Wf[k + N + 1] * a) * b;
      p.slow += (bv - p.slow) * Math.min(1, S.dt * 1.2);
      const g = sst(p.th, p.th + 0.3, bv);
      if (g <= 0.01) { p.vis = 0; continue; }
      p.vis = 1;
      const hgt = dome * p.hm * Math.sqrt(g) * 0.7 + 0.03;
      // penchée vers l'extérieur du coussin (là où la mousse décroît)
      const gx = B[k + 1] - B[k], gz = B[k + N] - B[k];
      const lean = 0.35 * hgt;
      const bx = p.x * sc, by = p.z * TILT * sc;
      const wob = Math.sin(t * 1.4 + p.ph) * sway * hgt;
      const tx = (p.x - gx * lean * 3 + wob) * sc, ty = (p.z - gz * lean * 3) * TILT * sc - hgt * RISE * sc;
      const open = sst(0.12, 0.65, wv), young = Math.max(0, Math.min(1, (bv - p.slow) * 40));
      const oq = Math.min(OPEN_Q - 1, Math.floor(open * OPEN_Q)), yq = Math.min(YOUNG_Q - 1, Math.floor(young * YOUNG_Q));
      p.bx = bx; p.by = by; p.tx = tx; p.ty = ty; p.open = open; p.g = g;
      stemQ[oq].push(p); rosQ[oq * YOUNG_Q + yq].push(p);
      if (p.spor && bv > 0.55) spor.push(p);
      if (p.lit) tips.push(p);
    }
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    // les tiges (le feutre) : sombres
    ctx.lineWidth = Math.max(0.6, 0.75 * dpr);
    for (let q = 0; q < OPEN_Q; q++) {
      if (!stemQ[q].length) continue;
      const c = mix3(w.C.old, mix3(w.C.dry, w.C.wet, q / (OPEN_Q - 1)), 0.45);
      ctx.strokeStyle = rgba(c, 0.45);
      ctx.beginPath();
      for (const p of stemQ[q]) { ctx.moveTo(p.bx, p.by); ctx.lineTo(p.tx, p.ty); }
      ctx.stroke();
    }
    // les rosettes : fermées et dressées au sec, ouvertes en étoile à l'eau
    ctx.lineWidth = Math.max(0.6, 0.7 * dpr);
    for (let q = 0; q < OPEN_Q; q++) for (let y = 0; y < YOUNG_Q; y++) {
      const list = rosQ[q * YOUNG_Q + y];
      if (!list.length) continue;
      const o = q / (OPEN_Q - 1);
      const c = mix3(mix3(w.C.dry, w.C.wet, o), w.C.young, (y / (YOUNG_Q - 1)) * 0.75);
      ctx.strokeStyle = rgba(c, 0.62, 1.05); ctx.fillStyle = rgba(c, 0.62, 1.05);
      ctx.beginPath();
      for (const p of list) {
        const Lr = leafL * (0.45 + 0.55 * p.g) * sc * (0.3 + 0.45 * p.open);
        if (!arms) { ctx.moveTo(p.tx + Lr * 0.55, p.ty); ctx.arc(p.tx, p.ty, Lr * 0.55, 0, 6.2832); continue; }
        const tw = (1 - p.open) * (F === 'tortule' ? 1.3 : 0.4);
        if (F === 'sphaigne') { const r = Lr * 0.22; ctx.moveTo(p.tx + r, p.ty); ctx.arc(p.tx, p.ty, r, 0, 6.2832); }
        for (let m = 0; m < arms; m++) {
          const an = p.rot + (6.2832 * m) / arms + tw;
          ctx.moveTo(p.tx, p.ty);
          ctx.lineTo(p.tx + Math.cos(an) * Lr * p.open, p.ty + Math.sin(an) * Lr * TILT * p.open - Lr * (1 - p.open) * 0.9);
        }
      }
      if (arms) ctx.stroke(); else ctx.fill();
    }
    // les soies et leurs capsules (sur la mousse établie)
    if (spor.length) {
      ctx.strokeStyle = rgba(w.C.seta, 0.55, 1.1); ctx.lineWidth = Math.max(0.5, 0.6 * dpr);
      ctx.beginPath();
      const caps = [];
      for (const p of spor) {
        const hs = fam.spor.seta[0] * sc * RISE * 0.5 * p.g, bend = F === 'funaire' ? 0.25 : 0.08;
        const ex = p.tx + Math.sin(p.rot + t * 0.3) * hs * bend, ey = p.ty - hs;
        ctx.moveTo(p.tx, p.ty); ctx.quadraticCurveTo(p.tx, ey + hs * 0.3, ex, ey); caps.push(ex, ey);
      }
      ctx.stroke();
      ctx.fillStyle = rgba(w.C.capsule, 0.8, 1.15);
      ctx.beginPath();
      const cr = Math.max(1, fam.spor.cap[1] * sc * 0.6);
      for (let i = 0; i < caps.length; i += 2) { ctx.moveTo(caps[i] + cr, caps[i + 1]); ctx.ellipse(caps[i], caps[i + 1], cr * 1.3, cr, 0.4, 0, 6.2832); }
      ctx.fill();
    }
    // la lumière : le soleil de la scène prend les pointes (poils hyalins, gouttes)
    if (lit > 0.01 && tips.length) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(w.C.hair, 0.55 * lit * alpha);
      ctx.beginPath();
      const sx = w.sunDir[0], sz = w.sunDir[2], r = Math.max(0.8, 0.9 * dpr);
      for (const p of tips) {
        if (!p.vis) continue;
        const hx = p.tx + sx * 2 * dpr, hy = p.ty + sz * TILT * 2 * dpr - dpr;
        ctx.moveTo(hx + r, hy); ctx.arc(hx, hy, r * (0.6 + 0.6 * p.open), 0, 6.2832);
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    w.visible = w.S.filter((p) => p.vis && p.open > 0.5);
  }

  // l'eau qui passe : gouttes, éclaboussures, brume ou rosée selon la scène
  function drawWater(ctx, w, S, sc, alpha) {
    const E = w.E, dpr = S.dpr, kind = w.d.water || 'rain', dt = S.dt;
    const R = rainNow(w.uRain, w.SH, E);
    if (kind === 'rain') {
      const n = (lite ? 50 : 120) * R * dt * 6;
      for (let i = 0; i < n && drops.length < (lite ? 50 : 110); i++) {
        const x = (Math.random() * 2 - 1) * E, z = (Math.random() * 2 - 1) * E;
        if (Math.hypot(x, z) > E * 0.98 || Math.random() > rainAt(w.uRain, x, z, w.SH, E) * 1.6) continue;
        drops.push({ x, z, y: 2 + Math.random() * 3, v: 26 + Math.random() * 8 });
      }
      ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(196, 214, 236, 0.22)'; ctx.lineWidth = Math.max(0.6, 0.7 * dpr);
      ctx.beginPath();
      drops = drops.filter((p) => {
        p.y -= p.v * dt * 0.25;
        if (p.y <= 0) { splashes.push({ x: p.x, z: p.z, t: 0 }); return false; }
        const sx = p.x * sc, sy = p.z * TILT * sc - p.y * RISE * sc;
        ctx.moveTo(sx, sy); ctx.lineTo(sx + 0.01 * sc, sy - 0.35 * RISE * sc); return true;
      });
      ctx.stroke();
      ctx.lineWidth = Math.max(0.5, 0.6 * dpr);
      splashes = splashes.filter((s) => (s.t += dt) < 0.35);
      for (const s of splashes) {
        const k = s.t / 0.35, r = (0.06 + 0.22 * k) * sc;
        ctx.strokeStyle = `rgba(200, 220, 240, ${(0.35 * (1 - k)).toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(s.x * sc, s.z * TILT * sc, r, r * TILT, 0, 0, 6.2832); ctx.stroke();
      }
      ctx.restore();
    } else if (kind === 'fog') {
      // un banc de brume qui traverse la pierre dans le sens des averses
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const veilA = Math.min(1, R * 1.3 + 0.25 * wetSeason(w.uRain));
      for (let i = 0; i < 4; i++) {
        const ph = S.t * 0.05 + i * 0.27, ox = Math.sin(ph * 6.283) * E * 0.7, oz = Math.cos(ph * 4.1 + i) * E * 0.5;
        const x = ox * sc, y = oz * TILT * sc - 0.6 * sc, r = E * sc * (0.55 + 0.15 * i);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(190, 200, 210, ${(0.07 * veilA * alpha).toFixed(3)})`); g.addColorStop(1, 'rgba(190, 200, 210, 0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      ctx.restore();
    }
    // rosée (et gouttes accrochées, toutes scènes) : des scintillements sur les rosettes mouillées
    const vis = w.visible || [];
    const rate = (kind === 'dew' ? 14 : 5) * (0.3 + lit);
    if (vis.length && glints.length < 16 && Math.random() < dt * rate) {
      const p = vis[Math.floor(Math.random() * vis.length)];
      glints.push({ p, t: 0, l: 0.5 + Math.random() * 0.6 });
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = Math.max(0.6, 0.8 * dpr);
    glints = glints.filter((g) => (g.t += dt) < g.l);
    for (const g of glints) {
      const k = Math.sin((g.t / g.l) * Math.PI), s = 5 * dpr * k, x = g.p.tx, y = g.p.ty;
      ctx.strokeStyle = `rgba(240, 248, 255, ${(0.75 * k * alpha).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
    }
    ctx.restore();
  }

  return {
    data(d) {
      if (W && W.alpha > 0.05) { old = W; old.fade = old.alpha; }
      W = makeWorld(d, lite);
      W.alpha = 0; tData = 0; drops = []; splashes = []; glints = [];
    },
    draw(ctx, S) {
      const { w, h, dt, dpr } = S;
      // horloge de la saison : le temps fait passer les averses, l'avancement réel fait pousser
      if (tData >= 0) tData += dt;
      const overall = S.p;
      let uT = U0;
      if (tData >= 0) {
        const uTime = Math.min(0.32, U0 + 0.075 * tData);
        const uProg = U0 + (UMAX - U0) * sst(0.25, 0.97, overall);
        uT = Math.min(UMAX, Math.max(uTime, uProg));
      }
      // le monde courant : intégration bornée en temps, et le relief de sa pierre
      const t0 = performance.now(), budget = lite ? 1.6 : 2.2;
      let n = 0;
      while (W.u < uT && performance.now() - t0 < budget && n < 6) { W.step(W.u); W.u += DU; n++; }
      W.uRain += (W.u - W.uRain) * Math.min(1, dt * 8);
      bakeRockRows(W, Math.max(0.4, budget - (performance.now() - t0)));
      W.alpha = Math.min(1, W.alpha + dt * (old ? 1.2 : 2));
      if (old) { old.fade -= dt * 2.2; if (old.fade <= 0) old = null; }
      const litT = S.stepIdx >= 2 ? 0.55 + 0.45 * (S.stepIdx >= 3 ? 1 : 0) : 0;
      lit += (litT - lit) * Math.min(1, dt * 1.5);

      // mise en page : centrée vers 0,46 h ; à la fin, on s'approche du bord d'un îlot
      const m = Math.min(w, h * 1.6), cx = w / 2, cy = h * 0.46;
      const done = S.done, ease = done * done * (3 - 2 * done);
      const zoom = 1 + 0.7 * ease, fadeAll = 1 - done ** 1.6;
      const draw1 = (wd, a) => {
        if (!wd || a <= 0.002) return;
        const sc = (m * 0.33) / wd.E;
        ctx.save();
        ctx.translate(cx, cy + 0.15 * wd.E * sc * TILT);
        ctx.scale(zoom, zoom);
        ctx.translate(-wd.hero[0] * sc * ease, -wd.hero[1] * TILT * sc * ease);
        // halo : l'humidité de l'air, puis le soleil du côté de la lumière
        ctx.globalAlpha = a;
        const R0 = wd.E * sc * 1.25;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R0);
        const wetA = 0.05 + 0.06 * wetSeason(wd.uRain);
        g.addColorStop(0, `rgba(120, 150, 130, ${wetA.toFixed(3)})`); g.addColorStop(1, 'rgba(120, 150, 130, 0)');
        ctx.fillStyle = g; ctx.fillRect(-R0, -R0, 2 * R0, 2 * R0);
        if (lit > 0.01) {
          const sl = Math.hypot(wd.sunDir[0], wd.sunDir[2]) || 1, lx = (wd.sunDir[0] / sl) * wd.E * sc * 0.6, ly = (wd.sunDir[2] / sl) * wd.E * sc * 0.6 * TILT - 0.5 * sc;
          const gs = ctx.createRadialGradient(lx, ly, 0, lx, ly, R0);
          gs.addColorStop(0, `rgba(255, 228, 186, ${(0.085 * lit).toFixed(3)})`); gs.addColorStop(1, 'rgba(255, 228, 186, 0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gs; ctx.fillRect(lx - R0, ly - R0, 2 * R0, 2 * R0);
          ctx.globalCompositeOperation = 'source-over';
        }
        drawWorld(ctx, wd, S, sc, a);
        if (wd === W) drawWater(ctx, wd, S, sc, a);
        ctx.restore();
      };
      if (old) draw1(old, old.fade * fadeAll);
      draw1(W, W.alpha * fadeAll * (old ? 1 - Math.max(0, old.fade) * 0.5 : 1));
    },
  };
}
