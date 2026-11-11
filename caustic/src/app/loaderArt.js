// Caustic — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// On regarde la lumière du fond de la cuve. Au départ, elle traverse une eau
// à peine ridée : un réseau de caustiques qui ondoie. Puis, pour un Foyer, le
// transport optimal se résout (dans les workers de génération) : chaque grille
// ∇u reçue (envoyée par main.js avec loader.art) déplace un semis de points de
// lumière — la lumière quitte le fond et se rassemble sur le dessin (diatomée,
// oursin, méduse…), dont l'esquisse froide attend dessous ; la grille de
// l'application se déforme et s'efface à mesure que le résidu tombe. Les trois
// dessins de la scène se succèdent, défaits en anneaux comme dans la scène.
// Faraday : l'onde stationnaire du réseau se lève sous le stroboscope ;
// Kármán : une allée de tourbillons passe. À la fin, la tache de lumière
// s'approche et s'efface sur la scène.
//
// Rendu : densité de lumière par poussée en avant (chaque point source porte
// la même lumière ; là où l'application resserre les points, le fond s'éclaire)
// — c'est exactement l'équation que résout le transport : μ = ν(∇u)·det D²u.
import { target } from '../gen/motifs.js';

const TAU = Math.PI * 2;
const TOL = 2e-3, R0 = 0.32; // (résidu visé par le solveur, résidu de départ typique)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export default function createArt(S) {
  const lite = !!S.lite;
  const B = lite ? 128 : 176; // densité : B×B cases sur le carré de la lentille
  const P = lite ? 190 : 270; // semis : P×P points de lumière
  const D = 129; // grille de l'application affichée (celle que le worker envoie)

  // semis fixe, légèrement dérangé (pas de moiré)
  const px = new Float32Array(P * P), py = new Float32Array(P * P);
  {
    let s = 0x2545f491;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let j = 0, k = 0; j < P; j++) for (let i = 0; i < P; i++, k++) {
      px[k] = (i + 0.15 + 0.7 * rnd()) / P; py[k] = (j + 0.15 + 0.7 * rnd()) / P;
    }
  }
  const acc = new Float32Array(B * B), tmp = new Float32Array(B * B);
  const layer = new OffscreenCanvas(B, B), lctx = layer.getContext('2d');
  const img = lctx.createImageData(B, B);
  // masque : un disque de lumière, doux au bord (hors du disque r = 0,8 du
  // carré, la lumière ne bouge pas : on ne montre que le cœur)
  // (mask2 : le disque du dessin seul, quand la lumière s'y est rassemblée)
  const mask = new Float32Array(B * B), mask2 = new Float32Array(B * B);
  for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
    const x = ((i + 0.5) / B) * 2 - 1, y = ((j + 0.5) / B) * 2 - 1, r = Math.hypot(x, y);
    mask[j * B + i] = 1 - smooth(0.78, 0.99, r);
    mask2[j * B + i] = 1 - smooth(0.7, 0.9, r);
  }
  // application affichée (nœuds D×D, coordonnées dans [0, 1]²)
  const Mx = new Float32Array(D * D), My = new Float32Array(D * D);

  let fam = 'foyer', light = [236, 206, 160], events = [], shown = 0, cycleT = 0, switched = false;
  let faraday = null, karman = null, seedPhase = 0, id = 0;
  let lastP = 0, frameN = 0;

  const newEvent = () => ({ grid: null, recv: null, n: 0, f: 0, res: 1, solved: false, tgt: null, spec: null });

  // l'esquisse froide du dessin attendu (calculée ici, à partir de la recette)
  function sketch(ev) {
    if (ev.tgt || !ev.spec) return;
    const m = lite ? 96 : 128;
    const t = target(ev.spec.series, ev.spec.level, ev.spec.seed, m, { rotation: ev.spec.rotation });
    const c = new OffscreenCanvas(m, m), x = c.getContext('2d'), d = x.createImageData(m, m);
    for (let i = 0; i < m * m; i++) {
      const v = Math.min(1, Math.max(0, (t[i] - 1.15) / 3.5));
      d.data[i * 4] = 140; d.data[i * 4 + 1] = 176; d.data[i * 4 + 2] = 222; d.data[i * 4 + 3] = Math.round(255 * Math.sqrt(v));
    }
    x.putImageData(d, 0, 0);
    ev.tgt = c;
  }

  // l'eau : quelques trains d'ondes (hauteur h, on n'a besoin que de ∇h)
  const waves = [];
  function seedWaves(phase) {
    waves.length = 0;
    // (des directions et des longueurs mêlées : une eau ridée, pas une trame)
    for (let k = 0; k < 6; k++) {
      const a = phase + k * 2.39996 + 0.5 * Math.sin(k * 5.1 + phase);
      const lam = 0.07 + 0.09 * ((k * 0.618 + phase * 0.37) % 1);
      const kk = TAU / lam;
      waves.push({ kx: Math.cos(a) * kk, ky: Math.sin(a) * kk, w: (0.7 + 0.25 * k) * Math.sqrt(kk / 60), A: (1 / (kk * kk)) * (0.36 - 0.03 * k) });
    }
  }
  seedWaves(0.7);

  // ── l'application affichée, pour cette image ──
  function buildMap(t, rip, s, ev, ring) {
    const g = ev?.grid, n = ev?.n || 0;
    for (let j = 0, k = 0; j < D; j++) {
      const y = j / (D - 1);
      for (let i = 0; i < D; i++, k++) {
        const x = i / (D - 1);
        let X = x, Y = y;
        if (g && s > 0) {
          let gx, gy;
          if (n === D) { gx = g[2 * k]; gy = g[2 * k + 1]; }
          else { // (autre résolution : bilinéaire)
            const fx = x * (n - 1), fy = y * (n - 1), i0 = Math.min(n - 2, fx | 0), j0 = Math.min(n - 2, fy | 0), u = fx - i0, v = fy - j0, q = (j0 * n + i0) * 2;
            gx = (1 - v) * ((1 - u) * g[q] + u * g[q + 2]) + v * ((1 - u) * g[q + 2 * n] + u * g[q + 2 * n + 2]);
            gy = (1 - v) * ((1 - u) * g[q + 1] + u * g[q + 3]) + v * ((1 - u) * g[q + 2 * n + 1] + u * g[q + 2 * n + 3]);
          }
          X += s * (gx - x); Y += s * (gy - y);
        }
        if (rip > 0) {
          let dx = 0, dy = 0;
          for (const w of waves) { const c = w.A * Math.sin(w.kx * x + w.ky * y - w.w * t); dx += w.kx * c; dy += w.ky * c; }
          X += rip * dx; Y += rip * dy;
        }
        if (ring) { // les anneaux d'un dessin qui se défait
          const rx = x - 0.5, ry = y - 0.5, r = Math.hypot(rx, ry) + 1e-6;
          const kk = 46, c = ring.A * Math.cos(kk * r - ring.ph) * Math.exp(-(((r - ring.r) / 0.16) ** 2));
          X += (c * rx) / r; Y += (c * ry) / r;
        }
        if (faraday) {
          let dx = 0, dy = 0;
          for (const m of faraday.modes) { const c = faraday.a * Math.sin(m.kx * (x - 0.5) + m.ky * (y - 0.5)); dx -= m.kx * c; dy -= m.ky * c; }
          X += dx; Y += dy;
        }
        if (karman) {
          for (const v of karman.v) {
            const rx = x - v.x, ry = y - v.y, e = Math.exp(-(rx * rx + ry * ry) / (v.c * v.c)) * v.a;
            X += e * (rx * 0.9 - v.s * ry); Y += e * (ry * 0.9 + v.s * rx);
          }
        }
        Mx[k] = X; My[k] = Y;
      }
    }
  }

  // ── poussée en avant du semis, puis l'image ──
  function pushLight(gain, sharp, focus) {
    acc.fill(0);
    const D1 = D - 1;
    for (let k = 0; k < P * P; k++) {
      const fx = px[k] * D1, fy = py[k] * D1;
      const i0 = fx | 0, j0 = fy | 0, u = fx - i0, v = fy - j0, q = j0 * D + i0;
      const a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
      const X = a * Mx[q] + b * Mx[q + 1] + c * Mx[q + D] + d * Mx[q + D + 1];
      const Y = a * My[q] + b * My[q + 1] + c * My[q + D] + d * My[q + D + 1];
      const bx = X * B - 0.5, by = Y * B - 0.5;
      if (bx < 0 || by < 0 || bx >= B - 1 || by >= B - 1) continue;
      const I = bx | 0, J = by | 0, s = bx - I, t = by - J, o = J * B + I;
      acc[o] += (1 - s) * (1 - t); acc[o + 1] += s * (1 - t); acc[o + B] += (1 - s) * t; acc[o + B + 1] += s * t;
    }
    // un léger flou (3×3, pondéré) : le grain du semis disparaît
    const c0 = sharp, c1 = (1 - sharp) / 4;
    for (let j = 1; j < B - 1; j++) for (let i = 1; i < B - 1; i++) {
      const o = j * B + i;
      tmp[o] = c0 * acc[o] + c1 * (acc[o - 1] + acc[o + 1] + acc[o - B] + acc[o + B]);
    }
    const norm = (B * B) / (P * P), px8 = img.data;
    const [lr, lg, lb] = light;
    for (let o = 0; o < B * B; o++) {
      const dd = tmp[o] * norm; // 1 : la lumière d'une eau plate
      const v = 1 - Math.exp(-gain * dd * dd * 0.06 - gain * dd * 0.12);
      const hot = v * v * v; // (le cœur des traits blanchit)
      const m = mask[o] + (mask2[o] - mask[o]) * focus;
      px8[o * 4] = lr + (255 - lr) * hot; px8[o * 4 + 1] = lg + (250 - lg) * hot; px8[o * 4 + 2] = lb + (240 - lb) * hot;
      px8[o * 4 + 3] = 255 * v * m;
    }
    lctx.putImageData(img, 0, 0);
  }

  return {
    data(d) {
      if (d.kind === 'recipe') {
        id++;
        fam = d.family; light = d.light || light;
        seedPhase = ((d.seedHash || 0) % 1000) / 1000 * TAU;
        seedWaves(seedPhase);
        events = (d.events || []).map((e) => ({ ...newEvent(), spec: { series: d.series, seed: d.seed, ...e } }));
        shown = 0; cycleT = 0;
        faraday = null; karman = null;
        if (fam === 'faraday') {
          const dirs = { square: 2, hex: 3, quasi8: 4, quasi10: 5, quasi12: 6 }[d.lattice] || 2;
          const kk = TAU / (lite ? 0.11 : 0.09), modes = [];
          for (let m = 0; m < dirs; m++) { const a = (d.angle || 0) + (m * Math.PI) / dirs; modes.push({ kx: Math.cos(a) * kk, ky: Math.sin(a) * kk }); }
          faraday = { modes, a: 0, kk };
        }
        if (fam === 'karman') karman = { v: [], n: d.emissions || 10 };
      } else if (d.kind === 'ot') {
        const ev = events[d.event];
        if (!ev) return;
        ev.recv = d.grid; ev.n = d.n; ev.res = d.res;
        ev.f = Math.max(ev.f, Math.min(1, Math.max(0, Math.log(R0 / Math.max(d.res, 1e-9)) / Math.log(R0 / TOL))));
        if (!ev.grid || ev.grid.length !== d.grid.length) { // (départ : l'identité)
          ev.grid = new Float32Array(d.grid.length);
          for (let j = 0; j < d.n; j++) for (let i = 0; i < d.n; i++) { const k = (j * d.n + i) * 2; ev.grid[k] = i / (d.n - 1); ev.grid[k + 1] = j / (d.n - 1); }
        }
      } else if (d.kind === 'solved') {
        const ev = events[d.event];
        if (ev) { ev.solved = true; ev.f = 1; }
      }
    },

    draw(ctx, S) {
      const { w, h, t, dt, dpr } = S;
      const m = Math.min(w, h), cx = w / 2, cy = h * 0.46;
      const done = S.done, alpha = 1 - done;
      frameN++;
      const foyer = fam === 'foyer' && events.length > 0;
      // lissage des grilles reçues (le solveur avance par à-coups de 60 ms)
      for (const ev of events) if (ev.recv) { const g = ev.grid, r = ev.recv, k = Math.min(1, dt * 5); for (let i = 0; i < g.length; i++) g[i] += (r[i] - g[i]) * k; }
      // esquisses : une par image au plus (≈ 10 ms chacune)
      if (foyer) { const ev = events.find((e) => !e.tgt); if (ev) sketch(ev); }

      // ── quel dessin, et où en est-on ──
      let ev = null, s = 0, ring = null;
      if (foyer) {
        const ready = events.map((e, i) => (e.grid ? i : -1)).filter((i) => i >= 0);
        const dwell = 5.2, tr = 1.8;
        if (ready.length > 1 || (ready.length === 1 && ready[0] !== shown)) cycleT += dt;
        else cycleT = Math.min(cycleT, dwell - tr * 0.5);
        if (cycleT > dwell + tr) { cycleT -= dwell + tr; switched = false; }
        let dip = 0;
        if (cycleT > dwell) {
          const u = (cycleT - dwell) / tr;
          dip = Math.sin(Math.PI * u);
          if (u > 0.5 && !switched) { // au creux : le dessin suivant
            switched = true;
            if (ready.length) { const k = ready.indexOf(shown); shown = ready[(k + 1) % ready.length] ?? ready[0]; }
          }
          ring = { A: 0.012 * dip, r: 0.1 + 0.32 * u, ph: t * 5 };
        }
        ev = events[shown];
        const conv = ev?.grid ? ev.f : 0;
        s = ev?.grid ? (1 - 0.88 * dip) : 0;
        ev && (ev._conv = conv);
      }
      if (faraday) { // l'onde se lève avec l'avancement, respire sous le stroboscope
        const grow = smooth(0, 0.9, S.p) * 0.9 + 0.1;
        faraday.a = (grow / (faraday.kk * faraday.kk)) * 1.25 * (0.75 + 0.25 * Math.sin(t * 1.3));
      }
      if (karman) { // les tourbillons naissent derrière l'obstacle et descendent le canal
        const per = 1.4, sp = 0.085;
        karman.v = [];
        for (let k = 0; k < 9; k++) {
          const age = ((t / per) % 1 + k) * per;
          const x = 0.18 + age * sp, side = (Math.floor(t / per) - k) % 2 ? 1 : -1;
          if (x > 0.95) continue;
          const life = smooth(0, 0.6, age) * (1 - smooth(0.7, 0.95, x));
          karman.v.push({ x, y: 0.5 + side * 0.055 * smooth(0, 2, age), c: 0.045 + 0.02 * smooth(0, 6, age), a: 0.0028 / 0.045 ** 2 * life * 0.012 * 40, s: 1.6 * side });
        }
      }
      // l'eau : vive au départ, presque lisse quand le dessin est résolu
      const conv = ev?._conv ?? 0;
      let rip = foyer ? 1 - 0.9 * conv * s : fam === 'foyer' ? 1 : 0.45;
      if (S.stepIdx >= 3 && foyer) rip *= 0.8;
      rip *= 1 - 0.6 * done;
      buildMap(t, rip, s, ev, ring);
      // exposition : la lumière « se prépare » (compile), puis se pose
      const lit = S.step === 'compile' ? 1 + 0.2 * S.real : S.step === 'settle' ? 1.2 : 1;
      const gain = (foyer ? 0.9 + 0.5 * conv : 1) * lit;
      if (!(lite && frameN % 2)) pushLight(gain, 0.4 + 0.3 * conv, foyer ? 0.85 * conv * s : 0);

      // ── composition ──
      const R = m * 0.36 * (1 + 0.32 * done * done);
      const side = R * 2;
      ctx.globalAlpha = alpha;
      // halo chaud très doux sous la tache de lumière
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
      halo.addColorStop(0, `rgba(${light[0]}, ${light[1]}, ${light[2]}, ${0.05 + 0.04 * conv})`);
      halo.addColorStop(1, `rgba(${light[0]}, ${light[1]}, ${light[2]}, 0)`);
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.03 * Math.sin(t * 0.21));
      // l'esquisse froide du dessin attendu (s'efface quand la lumière la recouvre)
      if (foyer && ev?.tgt) {
        const k = Math.max(0, 1 - 0.85 * conv) * smooth(0, 1.2, t) * (1 - smooth(0.6, 1, done * 2));
        if (k > 0.01) {
          ctx.globalAlpha = alpha * 0.32 * k * s;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(ev.tgt, -R, -R, side, side);
        }
      }
      // la lumière : une lueur, puis l'image nette
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = alpha * 0.55;
      ctx.filter = `blur(${(5 + 4 * lit) * dpr}px)`;
      ctx.drawImage(layer, -R, -R, side, side);
      ctx.filter = 'none';
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer, -R, -R, side, side);
      // la grille de ∇u, qui s'efface à mesure que le résidu tombe
      if (foyer && ev?.grid) {
        const ga = (0.2 * (1 - conv) + 0.025) * s * (S.stepIdx <= 1 ? 1 : 1 - smooth(0, 1, S.real + S.stepIdx - 2));
        if (ga > 0.004) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = `rgba(150, 186, 228, ${ga * alpha})`;
          ctx.lineWidth = Math.max(0.6, 0.7 * dpr);
          ctx.beginPath();
          const step = 6, X = (k) => (Mx[k] - 0.5) * side, Y = (k) => (My[k] - 0.5) * side;
          for (let j = step; j < D - 1; j += step) {
            const yy = j / (D - 1) - 0.5, xx = yy;
            if (Math.abs(yy) > 0.42) continue;
            const lim = Math.sqrt(Math.max(0, 0.42 * 0.42 - yy * yy)) * (D - 1);
            const i0 = Math.ceil((D - 1) / 2 - lim), i1 = Math.floor((D - 1) / 2 + lim);
            for (let i = i0; i <= i1; i++) { const k = j * D + i; i === i0 ? ctx.moveTo(X(k), Y(k)) : ctx.lineTo(X(k), Y(k)); }
            for (let i = i0; i <= i1; i++) { const k = i * D + j; i === i0 ? ctx.moveTo(X(k), Y(k)) : ctx.lineTo(X(k), Y(k)); }
            void xx;
          }
          ctx.stroke();
        }
      }
      ctx.restore();
      // les dessins de la scène : un point par dessin, plein quand il est résolu
      if (foyer && events.length > 1) {
        const y = cy + R + Math.max(18 * dpr, m * 0.035), gap = 12 * dpr;
        for (let i = 0; i < events.length; i++) {
          const e = events[i], x = cx + (i - (events.length - 1) / 2) * gap;
          const on = i === shown ? 1 : 0.45;
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = alpha * (1 - smooth(0, 0.5, done));
          ctx.strokeStyle = `rgba(${light[0]}, ${light[1]}, ${light[2]}, ${0.35 * on})`;
          ctx.lineWidth = Math.max(1, 0.8 * dpr);
          ctx.beginPath(); ctx.arc(x, y, 2.4 * dpr, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.001, e.f)); ctx.stroke();
          if (e.solved || e.f >= 1) { ctx.fillStyle = `rgba(${light[0]}, ${light[1]}, ${light[2]}, ${0.6 * on})`; ctx.beginPath(); ctx.arc(x, y, 1.3 * dpr, 0, TAU); ctx.fill(); }
        }
      }
      void lastP; void id;
    },
  };
}
