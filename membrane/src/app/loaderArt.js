// Membrane — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// L'œuf de la première couche, vu dans l'axe de la plongée, et son vrai motif
// de déchirure : l'armature et les étiquettes des lambeaux sont recalculées
// ici même (gen/armature.js, gen/tear.js, sur un maillage plus grossier) à
// partir de la recette. Pendant que le GPU simule les couches, l'œuf encaisse
// les assauts de l'armature, puis les coupures courent le long des tracés
// préparés ; quand la lumière se prépare, les lambeaux s'ouvrent autour de
// leur charnière (de l'angle même de l'armature) et découvrent l'œuf suivant,
// clos, dans la lumière du cœur ; à la fin, on plonge vers lui.
import { buildArmature } from '../gen/armature.js';
import { tearPattern } from '../gen/level.js';
import { geodesic, triNeighbors, V3 } from '../gen/geo.js';
import { labelTriangles, findSeams } from '../gen/tear.js';
import { fairSeams } from '../gen/prep.js';
import { createRng } from '../rng.js';

const { PI, sin, cos, min, max, abs, acos } = Math;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const hex = (h, k = 1) => {
  const n = parseInt((h || '#e8d8c8').slice(1), 16);
  return [((n >> 16) & 255) * k, ((n >> 8) & 255) * k, (n & 255) * k];
};
// une teinte de membrane, lisible sur fond sombre (latex rouge sombre compris)
const legible = (c) => {
  const l = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
  const k = l < 0.55 ? 0.55 - l : 0;
  return c.map((v) => Math.round(v + (255 - v) * k * 1.2));
};
const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${max(0, min(1, a)).toFixed(3)})`;

// rotation de p autour de l'axe unitaire k passant par h, d'un angle b
function rot(p, h, k, cb, sb) {
  const x = p[0] - h[0], y = p[1] - h[1], z = p[2] - h[2];
  const d = k[0] * x + k[1] * y + k[2] * z;
  const cx = k[1] * z - k[2] * y, cy = k[2] * x - k[0] * z, cz = k[0] * y - k[1] * x;
  return [h[0] + x * cb + cx * sb + k[0] * d * (1 - cb), h[1] + y * cb + cy * sb + k[1] * d * (1 - cb), h[2] + z * cb + cz * sb + k[2] * d * (1 - cb)];
}

// ── Un œuf : armature, motif, lambeaux (contours fermés), coutures ──
function* buildEgg(L, inner, res) {
  const arm = buildArmature({ ...L.arm, inner });
  yield;
  const P = tearPattern(L.arm, arm, L.mem);
  const G = geodesic(res, createRng(`sim:${L.mem.seed}`).fork('geo'));
  const nbr = triNeighbors(G.tri, G.nt);
  yield;
  const Lb = labelTriangles(G.pos, G.tri, G.nt, nbr, P);
  yield;
  const seams = findSeams(G.tri, G.nt, nbr, Lb, P);
  fairSeams(G, seams, 4);
  yield;
  const { pos, tri, nt } = G;
  const V = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const key = (t) => (Lb.inside[t] ? Lb.major[t] * 1000 + Lb.minor[t] : -1);
  const ek = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
  const seamSet = new Map();
  for (const s of seams) seamSet.set(ek(s.a, s.b), s.mult === 1 ? 1 : 2);
  const Z = [0, 0, 1];
  // origine de chaque lambeau : là où sa déchirure commence
  const origin = (k) => {
    if (P.kind === 'faces') { const f = P.faces[Math.floor(k / 1000)]; return V3.norm(f.reduce((a, b) => V3.add(a, b), [0, 0, 0])); }
    if (P.kind === 'sites') { const mj = Math.floor(k / 1000), mn = k % 1000; return mj < 10000 && mn > 0 && P.sites[mj] ? P.sites[mj] : Z; }
    return Z;
  };
  // demi-arêtes de bord de chaque lambeau (sens du triangle : contour orienté)
  const flaps = new Map();
  for (let t = 0; t < nt; t++) {
    const k = key(t);
    if (k < 0) continue;
    let F = flaps.get(k);
    if (!F) flaps.set(k, (F = { k, next: new Map(), tris: 0, c: [0, 0, 0] }));
    F.tris++;
    for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e], b = tri[t * 3 + ((e + 1) % 3)], u = nbr[t * 3 + e];
      F.c[0] += pos[a * 3]; F.c[1] += pos[a * 3 + 1]; F.c[2] += pos[a * 3 + 2];
      if (u >= 0 && key(u) === k) continue;
      F.next.set(a, b);
    }
  }
  yield;
  const out = [];
  for (const F of flaps.values()) {
    if (F.tris < 3) continue;
    // le plus long contour fermé
    const seen = new Set();
    let best = null;
    for (const s of F.next.keys()) {
      if (seen.has(s)) continue;
      const loop = [];
      let v = s, guard = 0;
      while (!seen.has(v) && F.next.has(v) && guard++ < 20000) { seen.add(v); loop.push(v); v = F.next.get(v); }
      if (!best || loop.length > best.length) best = loop;
    }
    if (!best || best.length < 3) continue;
    const c = V3.norm(F.c), o = origin(F.k);
    const pts = new Float32Array(best.length * 3), kind = new Uint8Array(best.length);
    let hinge = [0, 0, 0], nh = 0, far = null, fd = 2;
    best.forEach((v, i) => {
      const p = V(v), w = best[(i + 1) % best.length];
      pts.set(p, i * 3);
      kind[i] = seamSet.get(ek(v, w)) === 1 ? 1 : 0; // (1 : coupure ; 0 : charnière)
      if (!kind[i]) { hinge = V3.add(hinge, p); nh++; }
      const d = V3.dot(p, o);
      if (d < fd) { fd = d; far = p; }
    });
    // charnière : les arêtes du contour qui ne sont pas des coupures (sinon le point le plus éloigné de l'origine)
    const H = nh ? V3.mul(hinge, 1 / nh) : far;
    let axis = V3.cross(V3.norm(H), o);
    if (V3.len(axis) < 1e-4) axis = V3.cross(V3.norm(H), [1, 0, 0]);
    axis = V3.norm(axis);
    // sens : le lambeau s'ouvre vers l'extérieur
    const a1 = rot(c, H, axis, cos(1), sin(1)), a2 = rot(c, H, axis, cos(1), -sin(1));
    const sign = V3.len(a1) >= V3.len(a2) ? 1 : -1;
    const t0 = acos(Math.max(-1, Math.min(1, V3.dot(c, o))));
    out.push({ pts, kind, c, H, axis, sign, t0, n: best.length });
  }
  // coutures (le tracé qui cèdera), avec l'instant de leur rupture : de
  // l'origine vers la charnière, et un peu de désordre
  const rng = createRng(`load:${L.mem.seed}`);
  const cracks = [];
  for (const s of seams) {
    const tA = s.tA, k = key(tA);
    const a = V(s.a), b = V(s.b), m = V3.norm(V3.add(a, b));
    const ang = acos(Math.max(-1, Math.min(1, V3.dot(m, origin(k < 0 ? key(s.tB) : k)))));
    cracks.push({ a, b, prim: s.mult === 1, t: ang, j: rng.next() });
  }
  let tmax = 1e-3;
  for (const c of cracks) tmax = max(tmax, c.t);
  for (const c of cracks) c.t = clamp01((c.t / tmax) * 0.85 + c.j * 0.15) * (c.prim ? 1 : 0.9) + (c.prim ? 0 : 0.1);
  cracks.sort((x, y) => x.t - y.t);
  const flat = new Float32Array(cracks.length * 7);
  cracks.forEach((c, i) => { flat.set(c.a, i * 7); flat.set(c.b, i * 7 + 3); flat[i * 7 + 6] = c.prim ? c.t : -c.t; });
  // l'armature : une nervure par lame (au milieu du lambeau), les épingles, ou les arêtes de la cage
  const ribs = [];
  const A = L.arm;
  if (P.kind === 'star') {
    for (const F of out) {
      const ph = Math.atan2(F.c[1], F.c[0]), th1 = acos(Math.max(-1, Math.min(1, F.H[2] / (V3.len(F.H) || 1))));
      const line = [];
      for (let i = 0; i <= 10; i++) { const th = 0.12 + (th1 - 0.12) * (i / 10), tw = (A.twist ?? 0) * th; line.push([sin(th) * cos(ph + tw), sin(th) * sin(ph + tw), cos(th)].map((x) => x * 1.012)); }
      ribs.push({ flap: F, line });
    }
  }
  const pins = P.kind === 'sites' ? (P.sites || []).map((s) => V3.mul(s, 1.02)) : [];
  const bars = [];
  if (P.kind === 'faces') {
    const done = new Set();
    for (const f of P.faces) for (let i = 0; i < f.length; i++) {
      const a = V3.norm(f[i]), b = V3.norm(f[(i + 1) % f.length]);
      const id = [a, b].map((p) => p.map((x) => x.toFixed(3)).join()).sort().join('|');
      if (done.has(id)) continue;
      done.add(id);
      const line = [];
      for (let s = 0; s <= 8; s++) line.push(V3.mul(V3.norm(V3.add(V3.mul(a, 1 - s / 8), V3.mul(b, s / 8))), 1.015));
      bars.push(line);
    }
  }
  // (la cage se fend de partout : ses pétales s'ouvrent moins, sinon on ne lit plus rien)
  const angle = P.kind === 'faces' ? PI * 0.36 : max(PI * 0.42, (A.angle ?? 100) * (PI / 180));
  return { flaps: out, cracks: flat, nCracks: cracks.length, ribs, pins, bars, angle, struggle: A.struggle ?? 2, kind: P.kind };
}

export default function createArt() {
  let eggs = [], job = null, id = 0;
  let col = [[236, 222, 205], [236, 222, 205]], core = [255, 190, 130], q = 0.45, spin = 0.2;
  const metal = [214, 184, 132];

  // projection : vue légèrement plongeante, la couche tourne lentement sur son axe
  const view = { ca: 1, sa: 0, ct: 1, st: 0 };
  const proj = (p, s, cx, cy) => {
    const x = p[0] * view.ca - p[1] * view.sa, y = p[0] * view.sa + p[1] * view.ca, z = p[2];
    const y2 = y * view.ct - z * view.st, z2 = y * view.st + z * view.ct;
    return [cx + x * s, cy - y2 * s, z2];
  };

  function drawEgg(ctx, E, c, S, o) {
    const { cx, cy, s, open, tear, alpha, strain, inner } = o;
    // fond translucide de l'œuf : la coupe qui reste (silhouette), et le lustre du bord
    const rim = ctx.createRadialGradient(cx, cy, s * 0.55, cx, cy, s * 1.02);
    rim.addColorStop(0, rgba(c, 0));
    rim.addColorStop(0.8, rgba(c, (0.05 + 0.05 * strain) * alpha));
    rim.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, s * 1.02, 0, PI * 2); ctx.fill();
    ctx.lineWidth = S.dpr * 0.8;
    ctx.strokeStyle = rgba(c, 0.18 * alpha);
    ctx.beginPath(); ctx.arc(cx, cy, s, 0, PI * 2); ctx.stroke();
    if (!E) return;
    const b = open * E.angle;
    // lambeaux : tournés autour de leur charnière, du fond vers l'avant
    const list = [];
    for (const F of E.flaps) {
      const ob = b * (0.85 + 0.15 * sin(F.t0 * 3.1 + F.n)); // (ils ne s'ouvrent pas tous d'un même angle)
      const cb = cos(ob), sb = sin(ob) * F.sign;
      const cc = rot(F.c, F.H, F.axis, cb, sb);
      const pc = proj(cc, s, cx, cy);
      // orientation du lambeau (normale ≈ son centre tourné, à partir de la charnière)
      const nrm = V3.sub(rot(V3.mul(F.c, 1.1), F.H, F.axis, cb, sb), cc);
      const pn = proj(nrm, 1, 0, 0);
      list.push({ F, cb, sb, z: pc[2], face: pn[2] / 0.1 });
    }
    list.sort((x, y) => x.z - y.z);
    const R = 1 + 0.035 * strain;
    for (const it of list) {
      const { F, cb, sb, face } = it;
      const n = F.n, P = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const p = [F.pts[i * 3] * R, F.pts[i * 3 + 1] * R, F.pts[i * 3 + 2] * R];
        const r = open > 0 ? rot(p, F.H, F.axis, cb, sb) : p;
        const q2 = proj(r, s, cx, cy);
        P[i * 2] = q2[0]; P[i * 2 + 1] = q2[1];
      }
      const front = face > 0;
      // membrane : plus dense vue par la tranche, plus claire sous tension
      // (de dos, on la voit au travers de la face avant : à peine, tant que l'œuf est clos)
      const a = (front ? 0.055 : 0.012 + 0.03 * min(1, open * 2)) / max(0.4, abs(face)) * (1 + 1.2 * strain) * alpha * (inner ? 1.1 : 1);
      ctx.beginPath();
      ctx.moveTo(P[0], P[1]);
      for (let i = 1; i < n; i++) ctx.lineTo(P[i * 2], P[i * 2 + 1]);
      ctx.closePath();
      ctx.fillStyle = rgba(c, min(0.24, a));
      ctx.fill();
      // bords : les lèvres déchirées s'éclairent (la lumière du cœur passe), la charnière reste discrète
      if (open > 0.001) {
        ctx.lineWidth = S.dpr * (front ? 1.1 : 0.7);
        ctx.strokeStyle = rgba(core, (front ? 0.75 : 0.35) * min(1, open * 4) * alpha);
        ctx.beginPath();
        for (let i = 0; i < n; i++) if (F.kind[i]) { const j = (i + 1) % n; ctx.moveTo(P[i * 2], P[i * 2 + 1]); ctx.lineTo(P[j * 2], P[j * 2 + 1]); }
        ctx.stroke();
      }
    }
    // armature
    ctx.lineCap = 'round';
    for (const r of E.ribs) {
      const F = r.flap, ob = b * (0.85 + 0.15 * sin(F.t0 * 3.1 + F.n)), cb = cos(ob), sb = sin(ob) * F.sign;
      ctx.beginPath();
      r.line.forEach((p, i) => { const q2 = proj(open > 0 ? rot(V3.mul(p, R), F.H, F.axis, cb, sb) : V3.mul(p, R), s, cx, cy); if (i) ctx.lineTo(q2[0], q2[1]); else ctx.moveTo(q2[0], q2[1]); });
      const z = proj(rot(F.c, F.H, F.axis, cb, sb), 1, 0, 0)[2];
      ctx.lineWidth = S.dpr * (z > 0 ? 1.3 : 0.8);
      ctx.strokeStyle = rgba(metal, (z > 0 ? 0.55 : 0.2) * alpha * (inner ? 0.7 : 1));
      ctx.stroke();
    }
    for (const line of E.bars) {
      ctx.beginPath();
      line.forEach((p, i) => { const q2 = proj(V3.mul(p, R), s, cx, cy); if (i) ctx.lineTo(q2[0], q2[1]); else ctx.moveTo(q2[0], q2[1]); });
      const z = proj(line[4], 1, 0, 0)[2];
      ctx.lineWidth = S.dpr * (z > 0 ? 1.2 : 0.7);
      ctx.strokeStyle = rgba(metal, (z > 0 ? 0.5 : 0.16) * alpha);
      ctx.stroke();
    }
    for (const p of E.pins) {
      const q2 = proj(V3.mul(p, R), s, cx, cy);
      ctx.fillStyle = rgba(metal, (q2[2] > 0 ? 0.75 : 0.25) * alpha);
      ctx.beginPath(); ctx.arc(q2[0], q2[1], S.dpr * (q2[2] > 0 ? 1.8 : 1.1), 0, PI * 2); ctx.fill();
    }
    // les coupures : d'abord le tracé préparé (à peine visible), puis la
    // rupture qui court, sa pointe plus vive ; elles laissent la place aux
    // lèvres quand les lambeaux s'ouvrent
    const k = 1 - min(1, open * 3);
    if (k <= 0) return;
    const C = E.cracks;
    ctx.lineWidth = S.dpr * 0.6;
    ctx.strokeStyle = rgba(c, 0.1 * alpha * k);
    ctx.beginPath();
    for (let i = 0; i < E.nCracks; i++) {
      const o2 = i * 7;
      if (C[o2 + 6] < 0) continue;
      const pa = proj([C[o2] * R, C[o2 + 1] * R, C[o2 + 2] * R], s, cx, cy);
      if (pa[2] < -0.05) continue;
      const pb = proj([C[o2 + 3] * R, C[o2 + 4] * R, C[o2 + 5] * R], s, cx, cy);
      ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    if (tear <= 0) return;
    // (halo, coupures principales, embranchements plus fins et plus discrets)
    for (const [lw, al, prim] of [[3.5, 0.2, true], [1.5, 0.85, true], [0.9, 0.38, false]]) {
      ctx.lineWidth = S.dpr * lw;
      ctx.beginPath();
      for (let i = 0; i < E.nCracks; i++) {
        const o2 = i * 7, tt = C[o2 + 6], t = abs(tt);
        if (t > tear) break;
        if ((tt >= 0) !== prim) continue;
        const pa = proj([C[o2] * R, C[o2 + 1] * R, C[o2 + 2] * R], s, cx, cy);
        if (pa[2] < -0.1) continue;
        const pb = proj([C[o2 + 3] * R, C[o2 + 4] * R, C[o2 + 5] * R], s, cx, cy);
        ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
      }
      ctx.strokeStyle = rgba(core, al * alpha * k);
      ctx.stroke();
    }
    // pointes de la rupture
    ctx.fillStyle = rgba([255, 244, 226], 0.9 * alpha * k);
    for (let i = 0; i < E.nCracks; i++) {
      const o2 = i * 7, tt = C[o2 + 6], t = abs(tt);
      if (t > tear) break;
      if (tt < 0 || tear - t > 0.025) continue;
      const pa = proj([C[o2] * R, C[o2 + 1] * R, C[o2 + 2] * R], s, cx, cy);
      if (pa[2] < 0) continue;
      ctx.beginPath(); ctx.arc(pa[0], pa[1], S.dpr * 1.4, 0, PI * 2); ctx.fill();
    }
  }

  return {
    data(d, S) {
      id++;
      eggs = [];
      const L = d.levels || [];
      col = L.map((l) => legible(hex(l.color)));
      if (!col.length) col = [[236, 222, 205]];
      core = legible(hex(d.core || '#ffb27a'));
      q = d.ratio || 0.45; spin = d.spin || 0.2;
      // deux œufs : la couche qui s'ouvre, et la suivante (le modèle d mod N)
      const res = S.lite ? 12 : 16, picks = [L[0], L[1 % L.length]].filter(Boolean);
      const my = id;
      job = (function* () {
        for (let i = 0; i < picks.length; i++) {
          const g = buildEgg(picks[i], q, res);
          let r;
          while (!(r = g.next()).done) yield;
          if (my !== id) return;
          eggs[i] = r.value;
          yield;
        }
      })();
    },
    draw(ctx, S) {
      const { w, h, t } = S;
      // un pas de préparation par image (le calcul a lieu ici, dans le worker)
      if (job) { const t0 = performance.now(); let r; do r = job.next(); while (!r.done && performance.now() - t0 < 4); if (r.done) job = null; }
      const m = min(w, h), cx = w / 2, cy = h * 0.46;
      // avancement par étape : 0–1 le moteur, 1–2 la simulation, 2–3 la lumière, 3–4 les premières images
      const u = S.p * max(1, S.steps.length);
      const build = clamp01(u - 1), comp = clamp01(u - 2), settle = clamp01(u - 3);
      const E0 = eggs[0], E1 = eggs[1] ?? eggs[0];
      // la simulation : les assauts de l'armature (la membrane se tend et
      // blanchit, puis revient), puis la rupture qui court le long des tracés
      const nS = max(1, E0?.struggle ?? 2), as = clamp01(build / 0.35);
      const pulse = as < 1 ? sin(PI * ((as * nS) % 1)) ** 2 * (0.4 + 0.6 * as) : 0;
      const tear = ease((build - 0.3) / 0.62) * 1.02;
      const open = 0.62 * ease(comp) + 0.38 * ease(settle) + 0.1 * S.done;
      const strain = max(pulse, build > 0.3 ? 0.6 * (1 - comp) : 0);
      const breathe = 1 + 0.012 * sin(t * 1.3) + 0.01 * pulse;
      // fin : la plongée vers l'œuf suivant (l'image de la scène)
      const dz = S.done * S.done * (3 - 2 * S.done), zoom = 1 + (1 / q - 1) * dz * 0.85;
      const s = m * 0.2 * breathe * zoom;
      const a = 0.25 + 0.42 * (1 - S.done);
      view.ca = cos(spin * t * 0.35); view.sa = sin(spin * t * 0.35);
      const tilt = 0.32 * (1 - dz);
      view.ct = cos(tilt); view.st = sin(tilt);
      // le cœur : une lumière chaude derrière la membrane, qui monte quand elle s'ouvre
      const li = 0.08 + 0.1 * tear + 0.35 * open + 0.06 * sin(t * 1.7) * (0.3 + open);
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * (1.3 + 0.6 * open));
      gr.addColorStop(0, rgba(core, li * (1 - S.done * 0.5))); gr.addColorStop(0.35, rgba(core, li * 0.35)); gr.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      // l'œuf suivant, au creux de la couche (vu au travers, puis à découvert)
      const c1 = col[1 % col.length], c0 = col[0];
      drawEgg(ctx, E1, c1, S, { cx, cy, s: s * q, open: 0, tear: 0, alpha: (0.35 + 0.65 * min(1, open * 1.4)) * (1 - S.done * 0.2), strain: 0.15 * open, inner: true });
      // la couche qui s'ouvre
      ctx.save();
      ctx.globalAlpha = 1 - S.done * 0.95;
      drawEgg(ctx, E0, c0, S, { cx, cy, s, open, tear, alpha: a / 0.67, strain });
      ctx.restore();
      // avant la recette : l'œuf clos, qui respire
      if (!E0) {
        const g = ctx.createRadialGradient(cx, cy - s * 0.3, s * 0.1, cx, cy, s);
        g.addColorStop(0, rgba(c0, 0.1)); g.addColorStop(1, rgba(c0, 0.02));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, s, 0, PI * 2); ctx.fill();
      }
    },
  };
}
