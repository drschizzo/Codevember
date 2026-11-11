// Calcin — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le verre se fait avec du sable (et du verre brisé). Au départ, un sablier :
// un filet de sable tombe sur un tas. Dès que la recette arrive, le sable
// quitte le tas, grain à grain, et va se poser sur les silhouettes des pièces
// de la scène — leurs vrais profils de souffleur (gen/forms.js), anses,
// bouchons, côtes et fil appliqué compris —, dans l'ordre de la boucle et du
// pied vers le bord, comme au soufflage. Chaque grain qui arrive fond : il
// s'allume, blanc-jaune. Pendant la préparation de la lumière, les pièces
// refroidissent (orange, rouge sombre), puis prennent la teinte de leur verre ;
// aux premières images, la lampe les balaie. À la fin, un dernier reflet, et
// l'on s'approche en s'effaçant. Un nouveau chargement refond les pièces en
// sable, qui retombe au tas avant de reprendre forme.
import { profile } from '../gen/forms.js';
import { GLASSES } from '../glasses.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SAND = [178, 152, 112];
// incandescence (corps noir, ramené à l'écran) : T de 0 (froid) à 1 (blanc-jaune)
const BODY = [[0, [0, 0, 0]], [0.18, [70, 12, 4]], [0.4, [190, 52, 14]], [0.62, [255, 128, 40]], [0.82, [255, 196, 110]], [1, [255, 244, 222]]];
function bodyColor(T) {
  for (let i = 1; i < BODY.length; i++) if (T <= BODY[i][0]) {
    const [a, ca] = BODY[i - 1], [b, cb] = BODY[i], f = (T - a) / (b - a);
    return ca.map((x, k) => x + (cb[k] - x) * f);
  }
  return BODY[BODY.length - 1][1];
}
// teinte du verre refroidi, lisible sur fond sombre
function glassColor(key) {
  const G = GLASSES[key] ?? GLASSES.cristal;
  let c = hex(G.tint);
  if (G.opaque) c = hex(G.edge).map((x) => x * 0.6 + 120 * 0.4);
  const L = lum(c);
  if (L < 0.42) { const k = (0.42 - L) / (1 - L); c = c.map((x) => x + (255 - x) * k * 0.7); }
  return c;
}

// cibles d'une pièce, en unités de la pièce (sa plus grande dimension vaut 1 ;
// y vers le haut, depuis la sole) : [x, y, ordre d'accrétion 0..1, sorte]
// sortes : 0 paroi (le contour), 1 masse (le verre vu au travers), 2 modelé et fil
function pieceTargets(spec, n, rand) {
  const { pts, flip, sBowl } = profile(spec, 110);
  const rows = pts.length - 1;
  const at = (s) => {
    const k = Math.min(rows - 1, Math.max(0, s * rows)), k0 = Math.floor(k), f = k - k0;
    return { r: pts[k0].r + (pts[k0 + 1].r - pts[k0].r) * f, y: pts[k0].y + (pts[k0 + 1].y - pts[k0].y) * f };
  };
  const D = spec.decor ?? 'lisse', amp = spec.decorAmp ?? 0.04;
  const swell = D === 'lobes' ? 2.5 * amp : D === 'lisse' ? 0 : D === 'feston' ? 0 : amp;
  const out = [];
  const push = (x, y, u, kind) => out.push([x, y, Math.min(1, Math.max(0, u)), kind]);
  // parties posées chaudes après le corps (anse, bouchon, fil)
  const parts = new Set(spec.parts ?? []);
  const curves = [];
  const th0 = spec.handleAngle ?? 0;
  const bez = (a, b, c, d, t) => a.map((_, k) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * b[k] + 3 * (1 - t) * t * t * c[k] + t ** 3 * d[k]);
  const handle = (side, s0, s1, reach) => {
    const a = at(s0), b = at(s1), o = Math.max(a.r, b.r) + reach * 0.5;
    const A = [a.r * 0.92, a.y], B = [o, a.y + (b.y - a.y) * 0.05 + 0.02], C = [o * 0.95, a.y + (b.y - a.y) * 0.75], E = [b.r * 0.92, b.y];
    curves.push((t) => { const p = bez(A, B, C, E, t); return [side * p[0], p[1]]; });
  };
  // (l'anse de profil, du côté où elle est posée ; deux anses : de part et d'autre)
  if (parts.has('anse')) handle(Math.cos(th0) >= 0 ? 1 : -1, 0.86, 0.5, 0.17);
  if (parts.has('anses2')) { handle(1, 0.8, 0.55, 0.12); handle(-1, 0.8, 0.55, 0.12); }
  let cap = null;
  if (parts.has('bouchon') && !flip) {
    const top = pts[rows], rn = Math.max(0.01, top.r);
    cap = { y: top.y, prof: [[0, -0.5], [0.85, -0.45], [0.9, 0.15], [0.6, 0.4], [0.55, 0.7], [1.7, 1.4], [2.1, 2.6], [1.5, 3.6], [0.5, 4.1], [0, 4.2]].map(([r, y]) => [r * rn, y * rn]) };
  }
  const fil = parts.has('fil') && !flip;
  const ribs = ['cotes', 'torse', 'godrons', 'lobes'].includes(D);
  const share = { wall: 0.56, mass: 0.2, rib: ribs ? 0.12 : 0, fil: fil ? 0.1 : 0, part: (curves.length ? 0.1 : 0) + (cap ? 0.06 : 0) };
  const tot = Object.values(share).reduce((a, b) => a + b, 0);
  const cnt = (k) => Math.round((n * share[k]) / tot);
  const PART0 = 0.8; // (l'ordre d'accrétion : le corps jusqu'à 0,8, les parties ensuite)
  for (let i = 0, N = cnt('wall'); i < N; i++) {
    const s = rand(), p = at(s), side = rand() < 0.5 ? -1 : 1, w = s > sBowl ? 1 + swell * Math.min(1, (s - sBowl) / 0.12) : 1;
    const lip = D === 'feston' && s > 0.85 ? amp * 0.3 * ((s - 0.85) / 0.15) ** 2 * Math.cos((spec.decorN ?? 8) * side * 0.7) : 0;
    push(side * p.r * w + (rand() - 0.5) * 0.005, p.y + lip * (flip ? -1 : 1) + (rand() - 0.5) * 0.004, s * PART0, 0);
  }
  for (let i = 0, N = cnt('mass'); i < N; i++) {
    const s = rand(), p = at(s);
    push((rand() * 2 - 1) * p.r * 0.94, p.y, s * PART0, 1);
  }
  if (ribs) {
    const nR = Math.min(9, Math.max(3, Math.round((spec.decorN ?? 12) / 2)));
    for (let i = 0, N = cnt('rib'); i < N; i++) {
      const s = sBowl + 0.04 + rand() * (0.94 - sBowl), p = at(s), j = Math.floor(rand() * nR);
      const tw = D === 'torse' ? 2 * Math.PI * (spec.twist ?? 0.5) * s : 0;
      const a = (Math.PI * (j + 0.5)) / nR - Math.PI / 2 + tw * 0.5;
      if (Math.abs(a) > Math.PI / 2) continue;
      push(p.r * Math.sin(a), p.y, s * PART0, 2);
    }
  }
  if (fil) {
    const s0 = spec.threadFrom ?? 0.55, s1 = spec.threadTo ?? 0.9, turns = spec.threadTurns ?? 5;
    for (let i = 0, N = cnt('fil'); i < N; i++) {
      const t = rand(), s = s0 + (s1 - s0) * t, p = at(s), a = th0 + 2 * Math.PI * turns * t;
      if (Math.cos(a) < -0.2) continue; // (la face avant)
      push(p.r * 1.01 * Math.sin(a), p.y, PART0 + 0.12 + 0.08 * t, 2);
    }
  }
  if (curves.length) for (let i = 0, N = cnt('part'); i < N; i++) {
    const t = rand(), c = curves[i % curves.length](t);
    push(c[0] + (rand() - 0.5) * 0.008, c[1], PART0 + 0.1 * t, 0);
  }
  if (cap) for (let i = 0, N = Math.round((n * 0.06) / tot); i < N; i++) {
    const k = Math.min(cap.prof.length - 2, Math.floor(rand() * (cap.prof.length - 1))), f = rand();
    const [r0, y0] = cap.prof[k], [r1, y1] = cap.prof[k + 1];
    push((rand() < 0.5 ? -1 : 1) * (r0 + (r1 - r0) * f), cap.y + y0 + (y1 - y0) * f, 0.9 + 0.1 * rand(), 0);
  }
  // emprise (pour la mise en page)
  let x0 = 0, x1 = 0, y1 = 0;
  for (const [x, y] of out) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { pts: out, x0, x1, h: y1 };
}

export default function createArt(S) {
  const M = S.lite ? 1700 : 4200;
  // grains : position, vitesse, cible, foyer (tas ou filet), ordre, chaleur, état
  const px = new Float32Array(M), py = new Float32Array(M), vx = new Float32Array(M), vy = new Float32Array(M);
  const tx = new Float32Array(M), ty = new Float32Array(M), hx = new Float32Array(M), hy = new Float32Array(M);
  const ord = new Float32Array(M), heat = new Float32Array(M), ph = new Float32Array(M);
  const piece = new Uint8Array(M), kind = new Uint8Array(M), fused = new Uint8Array(M), stream = new Uint8Array(M), has = new Uint8Array(M);
  const lx = new Float32Array(M), ly = new Float32Array(M); // (cible en unités de mise en page)
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let pieces = [], colors = [], ready = false, layout = null, t0 = 0, sweep = -1, sweepT = 0;
  // calques : grains nets, puis deux réductions pour la lueur
  let layer = null, lc = null, g1 = null, g1c = null, g2 = null, g2c = null;
  const buckets = [];

  // la scène : sa sole (ligne de base), le tas en dessous, le filet au-dessus
  const frame = () => {
    const { w, h } = S, m = Math.min(w, h * 1.25), cx = w / 2, cy = h * 0.46;
    const base = cy + m * 0.16;
    return { m, cx, cy, base, heapH: m * 0.06, heapW: m * 0.15, top: cy - m * 0.24 };
  };
  function home(i, F) {
    // un tas conique, plus dense en bas ; une part des grains fait le filet du sablier
    const f = 1 - Math.sqrt(rand());
    hx[i] = F.cx + (rand() * 2 - 1) * F.heapW * (1 - f) * (0.6 + 0.4 * rand());
    hy[i] = F.base + F.heapH * 1.25 - f * F.heapH;
  }
  function init() {
    const F = frame();
    for (let i = 0; i < M; i++) {
      stream[i] = rand() < 0.07 ? 1 : 0;
      home(i, F); ph[i] = rand() * 1000;
      px[i] = hx[i]; py[i] = stream[i] ? F.top + rand() * (F.base - F.top) : hy[i];
      vy[i] = stream[i] ? 40 * S.dpr : 0;
    }
  }
  init();

  // mise en page : les pièces côte à côte sur la sole
  function place() {
    if (!pieces.length) return;
    const F = frame(), gap = 0.18;
    let W = 0, H = 0;
    for (const p of pieces) { W += p.x1 - p.x0; H = Math.max(H, p.h); }
    W += gap * (pieces.length - 1);
    const sc = Math.min((S.w * 0.8) / W, (F.m * 0.4) / H, (F.m * 0.62) / Math.max(1, W * 0.6));
    let x = F.cx - (W * sc) / 2;
    layout = pieces.map((p) => { const o = { ox: x - p.x0 * sc, sc }; x += (p.x1 - p.x0 + gap) * sc; return o; });
    layout.bed = [F.cx - (W * sc) / 2 - 0.1 * sc, F.cx + (W * sc) / 2 + 0.1 * sc];
    for (let i = 0; i < M; i++) {
      if (!has[i]) continue;
      if (piece[i] === 255) { tx[i] = layout.bed[0] + lx[i] * (layout.bed[1] - layout.bed[0]); ty[i] = F.base + ly[i] * S.dpr; continue; }
      const L = layout[piece[i]];
      tx[i] = L.ox + lx[i] * L.sc; ty[i] = F.base - ly[i] * L.sc;
    }
  }
  // (les calques ne couvrent que la région du dessin : le coût suit sa taille, pas celle de l'écran)
  let box = { x: 0, y: 0, w: 1, h: 1 };
  function ensureLayers() {
    const F = frame(), x = Math.max(0, Math.floor(S.w * 0.06)), y = Math.max(0, Math.floor(F.top - F.m * 0.08));
    const bw = Math.min(S.w, Math.ceil(S.w * 0.94)) - x, bh = Math.min(S.h, Math.ceil(F.base + F.heapH * 1.25 + F.m * 0.05)) - y;
    box = { x, y, w: Math.max(1, bw), h: Math.max(1, bh) };
    if (layer && layer.width === box.w && layer.height === box.h) return;
    layer = new OffscreenCanvas(box.w, box.h); lc = layer.getContext('2d');
    g1 = new OffscreenCanvas(Math.max(1, box.w >> 2), Math.max(1, box.h >> 2)); g1c = g1.getContext('2d');
    g2 = new OffscreenCanvas(Math.max(1, box.w >> 4), Math.max(1, box.h >> 4)); g2c = g2.getContext('2d');
  }

  return {
    data(d) {
      seed = 1 + [...String(d.seed ?? 'calcin')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const specs = d.pieces ?? [];
      const N = Math.max(1, specs.length);
      const BED = Math.round(M * 0.07), per = Math.floor((M - BED) / N);
      pieces = specs.map((sp) => pieceTargets(sp, per, rand));
      colors = specs.map((sp) => glassColor(sp.glass));
      // cibles : dans l'ordre de la boucle, du pied vers le bord ; un lit de sable sur la sole
      const T = [];
      for (let k = 0; k < pieces.length; k++) for (const [x, y, u, kd] of pieces[k].pts) T.push([k, x, y, (k + u) / N, kd]);
      for (let i = 0; i < BED; i++) T.push([255, rand(), (rand() - 0.5) * 2.2, rand() * 0.15, 3]);
      // (les grains en trop doublent la paroi : aucun ne reste au tas)
      for (let n0 = T.length; T.length < M && n0;) { const q = T[Math.floor(rand() * n0)]; T.push([q[0], q[1] + (rand() - 0.5) * 0.006, q[2], q[3], q[4]]); }
      T.sort((a, b) => a[3] - b[3]);
      // le tas se vide par le haut : les grains les plus hauts partent les premiers
      const F = frame();
      const idx = Array.from({ length: M }, (_, i) => i);
      for (let i = 0; i < M; i++) { has[i] = 0; fused[i] = 0; home(i, F); }
      idx.sort((a, b) => hy[a] - hy[b]);
      for (let j = 0; j < Math.min(M, T.length); j++) {
        const i = idx[j], [k, x, y, u, kd] = T[j];
        has[i] = 1; piece[i] = k; lx[i] = x; ly[i] = y; ord[i] = u + (rand() - 0.5) * 0.02; kind[i] = kd;
      }
      ready = true; t0 = S.t; sweep = -1;
      place();
    },
    resize() { if (ready) place(); },
    end() { sweep = 0; sweepT = 0; },
    draw(ctx, S2) {
      const { w, h, dt, t, dpr } = S2;
      ensureLayers();
      const F = frame();
      // où en est le soufflage (étape 'build') et le refroidissement ('compile', 'settle')
      const n = Math.max(1, S2.steps.length), bi = Math.max(0, S2.steps.indexOf('build'));
      const stepP = (key) => { const i = S2.steps.indexOf(key); return i < 0 ? 0 : Math.min(1, Math.max(0, (S2.p * n - i) / 0.92)); };
      let grow = ready ? Math.max(stepP('build'), S2.stepIdx > bi ? 1 : 0) : 0;
      grow = Math.max(grow, ready ? Math.min(0.08, (t - t0) * 0.05) : 0);
      const cool = stepP('compile'), lit = stepP('settle');
      const floorT = ready ? Math.max(0, 0.74 - 0.44 * smooth(0, 1, cool) - 0.3 * smooth(0, 0.45, lit) - 0.1 * S2.done) : 0;
      const k = 26, c = 2 * Math.sqrt(k) * 0.78;
      // ── mouvement ──
      for (let i = 0; i < M; i++) {
        const go = ready && has[i] && ord[i] <= grow * 1.03;
        let ax, ay;
        if (go) {
          const dx = tx[i] - px[i], dy = ty[i] - py[i], d = Math.hypot(dx, dy) + 1e-3;
          // ressort, et une dérive perpendiculaire qui courbe les trajets
          const curl = Math.min(1, d / (60 * dpr)) * 5 * ((i & 1) * 2 - 1);
          ax = dx * k - vx[i] * c - dy * curl; ay = dy * k - vy[i] * c + dx * curl;
          if (!fused[i] && d < 2.5 * dpr && Math.abs(vx[i]) + Math.abs(vy[i]) < 60 * dpr) { fused[i] = 1; heat[i] = 1; }
        } else if (stream[i] && !ready) {
          // le filet du sablier : chute, puis retour en haut une fois sur le tas
          ax = (F.cx - px[i]) * 8 - vx[i] * 2; ay = 900 * dpr * 0.35;
          const surf = F.base + F.heapH * 0.25 + Math.abs(px[i] - F.cx) * (F.heapH / F.heapW);
          if (py[i] > surf) { py[i] = F.top + rand() * 0.15 * (F.base - F.top); vy[i] = (120 + 60 * rand()) * dpr; px[i] = F.cx + (rand() - 0.5) * 1.6 * dpr; }
        } else {
          // au tas (au premier chargement, ou de retour : la pièce refondue retombe en sable)
          const dx = hx[i] - px[i], dy = hy[i] - py[i];
          ax = dx * 10 - vx[i] * 5; ay = dy * 10 - vy[i] * 5 + (dy > 0 ? 300 * dpr : 0);
          fused[i] = 0;
        }
        vx[i] += ax * dt; vy[i] += ay * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt;
        // chaleur : le grain qui fond s'allume, puis refroidit vers la température de la scène
        const target = fused[i] ? (kind[i] === 3 ? floorT * 0.35 : floorT) : 0;
        heat[i] += (target - heat[i]) * Math.min(1, dt * (fused[i] ? 1.1 : 2.5));
      }
      // ── dessin des grains, par paquets de même couleur ──
      const L = 20, P = pieces.length;
      const nb = (P + 1) * 4 * L + 1;
      while (buckets.length < nb) buckets.push([]);
      for (let b = 0; b < nb; b++) buckets[b].length = 0;
      for (let i = 0; i < M; i++) {
        let b;
        if (!fused[i] && heat[i] < 0.02) b = nb - 1;
        else {
          const pk = piece[i] === 255 ? P : piece[i];
          b = ((pk * 4 + kind[i]) * L) + Math.min(L - 1, Math.round(Math.max(0, heat[i]) * (L - 1)));
        }
        buckets[b].push(i);
      }
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, box.w, box.h);
      lc.translate(-box.x, -box.y);
      lc.globalCompositeOperation = 'lighter';
      const s0 = 1.15 * dpr;
      for (let b = 0; b < nb; b++) {
        const list = buckets[b];
        if (!list.length) continue;
        let col, a, size = s0;
        if (b === nb - 1) { col = SAND; a = 0.55; }
        else {
          const lv = b % L, kd = Math.floor(b / L) % 4, pk = Math.floor(b / (4 * L));
          const T = lv / (L - 1), base = pk < P ? colors[pk] : SAND;
          const inc = bodyColor(T), gl = smooth(0, 0.28, 0.3 - T);
          // verre refroidi (sa teinte) + incandescence
          col = base.map((x, q) => Math.min(255, x * gl * (pk < P ? 1.15 : 0.6) + inc[q]));
          a = [0.95, 0.32, 0.6, 0.45][kd];
          if (kd === 1) size = dpr;
          if (kd === 3) a *= 1 - 0.5 * gl;
        }
        lc.fillStyle = `rgba(${col[0] | 0}, ${col[1] | 0}, ${col[2] | 0}, ${a})`;
        lc.beginPath();
        for (const i of list) {
          // (un frémissement : le verre chaud vit, le sable bouge à peine)
          const j = 0.25 * dpr * Math.sin(t * 3 + ph[i]) * (0.3 + heat[i]);
          lc.rect(px[i] - size / 2 + j, py[i] - size / 2, size, size);
        }
        lc.fill();
      }
      // la lampe balaie les pièces refroidies (premières images), un dernier reflet à la fin
      if (ready && layout) {
        if (sweep < 0 && lit > 0.05) { sweep = 0; sweepT = 0; }
        if (sweep >= 0) {
          sweepT += dt;
          const period = S2.done > 0 ? 1.1 : 2.6, u = (sweepT % period) / period;
          const x0 = layout.bed[0], x1 = layout.bed[1], sx = x0 - 0.15 * (x1 - x0) + u * 1.3 * (x1 - x0), bw = (x1 - x0) * 0.08;
          const g = lc.createLinearGradient(sx - bw, 0, sx + bw, 0);
          const amp = 0.55 * Math.max(lit, S2.done);
          g.addColorStop(0, 'rgba(255,250,240,0)'); g.addColorStop(0.5, `rgba(255,250,240,${amp})`); g.addColorStop(1, 'rgba(255,250,240,0)');
          lc.globalCompositeOperation = 'source-atop';
          lc.fillStyle = g; lc.fillRect(sx - bw, box.y, 2 * bw, box.h);
        }
      }
      // lueur : deux réductions du calque, agrandies en douceur
      g1c.globalCompositeOperation = 'copy'; g1c.imageSmoothingEnabled = true;
      g1c.drawImage(layer, 0, 0, g1.width, g1.height);
      g2c.globalCompositeOperation = 'copy';
      g2c.drawImage(g1, 0, 0, g2.width, g2.height);
      // ── composition ──
      const zoom = 1 + 0.16 * S2.done * S2.done, alpha = 1 - S2.done;
      const glowK = ready ? 0.55 + 0.7 * smooth(0, 0.5, floorT) : 0.25;
      ctx.save();
      ctx.translate(w / 2, F.cy); ctx.scale(zoom, zoom); ctx.translate(-w / 2, -F.cy);
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = alpha * 0.9 * glowK; ctx.drawImage(g2, box.x, box.y, box.w, box.h);
      ctx.globalAlpha = alpha * 0.7 * glowK; ctx.drawImage(g1, box.x, box.y, box.w, box.h);
      ctx.globalAlpha = alpha; ctx.drawImage(layer, box.x, box.y);
      ctx.restore();
    },
  };
}
