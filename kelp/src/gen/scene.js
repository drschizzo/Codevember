// Une scène entière, de la recette aux tampons du GPU (module pur, appelé par
// le worker, importable depuis Node) : la mer, la roche, la place de la
// caméra, la disposition des laminaires, leur simulation, et la géométrie des
// lanières et des crampons.
import { simulateSea, makeProfile } from './sea.js';
import { bakeRock, sampler, makePools } from './rock.js';
import { layoutPlants, buildKelp, simulateKelp, FAMILIES } from './kelp.js';
import { createRng, createNoise3 } from '../rng.js';
import { Buffers, OUT, norm, cross } from './mesh.js';
import { cameraPose } from '../camera.js';

export const BOX = { x0: -7, x1: 9, z0: -12, z1: 4 };
export const SEA_X = [-9, 10];

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// float → demi-flottant
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function toHalf(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return sgn | (e << 10) | (m >> 13);
}

// ── La place de la caméra ─────────────────────────────────────────────────────
// Crescendo : la ligne d'eau de la petite vague coupe le bas du dôme, la
// moyenne le recouvre, la grande passe largement dessus. On cherche le point
// du platier où la profondeur maximale de chaque vague le permet.
export function placeCamera(sea, rockH, C, waves) {
  const T = sea.T, fps = sea.fps;
  const maxDepth = (x, t0, t1) => {
    let m = 0;
    const i = Math.round((x - sea.x0) / sea.dx - 0.5);
    for (let f = Math.round(t0 * fps); f < Math.round(t1 * fps); f++) {
      const ff = ((f % sea.nf) + sea.nf) % sea.nf;
      m = Math.max(m, sea.eta[ff * sea.nx + i] - sea.b[i]);
    }
    return m;
  };
  const win = (k) => [waves[k].t - 1, waves[k].t + 5];
  let best = null;
  for (let x = -2.2; x <= 1.2; x += 0.05) {
    const g = rockH(x, C.z);
    const d1 = maxDepth(x, ...win(0)), d2 = maxDepth(x, ...win(1)), d3 = maxDepth(x, ...win(2));
    const score = Math.abs(d1 - C.lens * 0.9) * 3 + Math.max(0, C.lens + 0.06 - d2) * 2 + Math.max(0, C.lens + 0.25 - d3) * 2 + Math.max(0, x - 0.3) * 0.05;
    if (!best || score < best.score) best = { x, score, d: [d1, d2, d3], g };
  }
  return { x: +best.x.toFixed(3), y: +(best.g + C.lens).toFixed(4), z: C.z, ground: best.g, depths: best.d.map((v) => +v.toFixed(3)) };
}

// ── Couleur de la roche ───────────────────────────────────────────────────────
// albédo (sRGB) et rugosité ; algue calcaire rose dans les creux bas et les
// flaques, film d'algues vertes près des flaques, éclaircie sur les bosses
export function rockColors(B, R) {
  const { M, box, H, fill, crack, id, motif } = B;
  const P = R.rock.color, N = createNoise3(`rockcol:${R.seed}`);
  const c3 = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const base = c3(P.base), dark = c3(P.dark), light = c3(P.light), crust = c3(P.crust);
  const col = new Uint8Array(M * M * 4);
  const sx = (box.x1 - box.x0) / (M - 1), sz = (box.z1 - box.z0) / (M - 1);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i, x = box.x0 + i * sx, z = box.z0 + j * sz;
    let r = base[0], g = base[1], b = base[2], rough = 0.78;
    const mix = (c, t) => { r += (c[0] - r) * t; g += (c[1] - g) * t; b += (c[2] - b) * t; };
    const n1 = N.fbm(x * 0.5, 2.2, z * 0.5, 3), n2 = N.fbm(x * 2.2, 8.3, z * 2.2, 3);
    mix(n1 > 0 ? light : dark, Math.min(1, Math.abs(n1) * 1.3));
    mix(n2 > 0 ? light : dark, Math.min(0.5, Math.abs(n2) * 0.8));
    mix(dark, crack[k] * 0.55);
    if (R.rock.type === 'basalt' || R.rock.type === 'slate') mix(id[k] > 0.5 ? light : dark, Math.abs(id[k] - 0.5) * 0.35);
    if (R.rock.type === 'chalk') mix([0.18, 0.17, 0.16], motif[k] * 0.9); // (silex)
    if (R.rock.type === 'sandstone') mix(dark, motif[k] * 0.4);
    // algue calcaire encroûtante (lithothamnion) : dans les creux bas et les flaques
    const pool = fill[k] - H[k] > 0.003 ? 1 : 0;
    const low = sst(0.12, -0.02, H[k]) * sst(-0.9, -0.3, H[k]);
    const blot = sst(-0.05, 0.25, N.fbm(x * 1.6, 4.4, z * 1.6, 4) + 0.15 * low + 0.35 * pool);
    const cr = Math.min(1, blot * (0.25 + 0.75 * Math.max(low, pool)));
    mix(crust, cr * 0.85);
    if (cr > 0.3) rough = 0.62;
    // film vert sur les bords des flaques
    if (pool) mix([0.18, 0.3, 0.12], 0.25 * sst(0.0, 0.3, N.noise(x * 3, 7, z * 3)));
    // au large, sous l'eau profonde : roche couverte, plus sombre
    mix([r * 0.5, g * 0.55, b * 0.5], sst(-0.5, -1.2, H[k]));
    const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    col[k * 4] = q(r); col[k * 4 + 1] = q(g); col[k * 4 + 2] = q(b); col[k * 4 + 3] = q(rough);
  }
  return col;
}

// carte de relief pour le GPU : hauteur, pente (x, z), occlusion des creux (demi-flottants)
export function rockRelief(B) {
  const { M, box, H } = B;
  const sx = (box.x1 - box.x0) / (M - 1), sz = (box.z1 - box.z0) / (M - 1);
  const blur = (A, r) => {
    const T = new Float32Array(M * M), O = new Float32Array(M * M);
    for (let j = 0; j < M; j++) { let s = 0; for (let i = -r; i <= r; i++) s += A[j * M + Math.min(M - 1, Math.max(0, i))]; for (let i = 0; i < M; i++) { T[j * M + i] = s / (2 * r + 1); s += A[j * M + Math.min(M - 1, i + r + 1)] - A[j * M + Math.max(0, i - r)]; } }
    for (let i = 0; i < M; i++) { let s = 0; for (let j = -r; j <= r; j++) s += T[Math.min(M - 1, Math.max(0, j)) * M + i]; for (let j = 0; j < M; j++) { O[j * M + i] = s / (2 * r + 1); s += T[Math.min(M - 1, j + r + 1) * M + i] - T[Math.max(0, j - r) * M + i]; } }
    return O;
  };
  const B1 = blur(H, 2), B2 = blur(H, 10);
  const rel = new Uint16Array(M * M * 4);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i;
    const gx = (H[j * M + Math.min(M - 1, i + 1)] - H[j * M + Math.max(0, i - 1)]) / (2 * sx);
    const gz = (H[Math.min(M - 1, j + 1) * M + i] - H[Math.max(0, j - 1) * M + i]) / (2 * sz);
    const cav = Math.max(0, B1[k] - H[k]) * 14 + Math.max(0, B2[k] - H[k]) * 3;
    rel[k * 4] = toHalf(H[k]); rel[k * 4 + 1] = toHalf(gx); rel[k * 4 + 2] = toHalf(gz); rel[k * 4 + 3] = toHalf(Math.max(0.25, 1 - cav));
  }
  return rel;
}

// ── Géométrie des lanières ───────────────────────────────────────────────────
// Un seul maillage pour toutes les chaînes : chaque sommet porte les indices
// des quatre nœuds de sa travée (spline de Catmull-Rom), sa place dans la
// travée, son angle autour de la section (ellipse aplatie : la lame s'amincit
// vers ses bords) et les dimensions de la section ; le vertex shader
// (scene/kelp.js) lit les positions enregistrées et construit le ruban.
export function strapGeometry(K, plants, { ring = 8, sub = 3 } = {}) {
  const F = FAMILIES[K.family];
  const pos = [], nidx = [], seg = [], sect = [], anch = [], index = [];
  let v = 0;
  const rnd = createRng(`straps:${K.family}`);
  for (const [ci, c] of K.chains.entries()) {
    const P = plants[c.plant], an = K.nodes[c.parent];
    // la suite des nœuds : le parent (et son prédécesseur, pour la tangente), puis la chaîne
    const prevOf = (n) => { for (const d of K.dist) if (d[1] === n) return d[0]; return n; };
    const seq = [c.parent, ...c.nodes], pre = prevOf(c.parent);
    const nn = seq.length, rk = rnd.next();
    const blade = c.kind === 1, R = blade ? ring : 8;
    const nseg = nn - 1;
    const rings = [];
    for (let sI = 0; sI < nseg; sI++) for (let q = 0; q < sub; q++) rings.push([sI, q / sub]);
    rings.push([nseg - 1, 1]);
    // (le bout d'un stipe est fermé : deux anneaux qui se resserrent sur place —
    // ouvert, il se lisait comme un tuyau d'où sortaient les lames)
    if (!blade) rings.push([nseg - 1, 1, 0.55], [nseg - 1, 1, 0.02]);
    const base = v;
    rings.forEach(([sI, s, capK = 1], ri) => {
      const ia = sI === 0 ? pre : seq[sI - 1], ib = seq[sI], ic = seq[sI + 1], id = sI + 2 < nn ? seq[sI + 2] : seq[sI + 1];
      const u = (sI + s) / nseg; // (place le long de la chaîne)
      let hw, ht;
      if (blade) {
        // lanière : s'élargit depuis la paume, s'effile et s'arrondit à la pointe
        const tip = 1 - sst(0.86, 1.0, u) * 0.85;
        hw = 0.5 * c.w * (0.55 + 0.45 * sst(0, 0.18, u)) * tip * (1 - 0.25 * u);
        ht = Math.max(0.0008, 0.5 * c.e * (1 - 0.4 * u));
      } else {
        // stipe : s'effile vers le haut (la palme), s'élargit au pied
        const r0 = K.nodes[seq[1]]?.r ?? 0.01;
        hw = ht = r0 * (F.stipe.stand ? 1.5 - 0.85 * u : 1.25 - 0.4 * u); // (le palmier de mer s'évase au pied)
        // le haut du stipe s'aplatit et s'élargit en paume, d'où partent les lames
        const flat = F.stipe.stand ? 0 : sst(0.55, 1, u);
        hw *= (1 + 0.9 * flat) * capK; ht *= (1 - 0.55 * flat) * capK;
      }
      for (let k = 0; k < R; k++) {
        const th = (k / R) * Math.PI * 2;
        pos.push(an.x, an.y, an.z);
        nidx.push(ia, ib, ic, id);
        seg.push(s, th, u, blade && sI === 0 ? 1 : 0); // (w : premier tronçon d'une lanière — son directeur est celui du nœud suivant)
        sect.push(hw, ht, blade ? 1 : 0, rk);
        anch.push(P.x, P.y, P.z, ci);
        v++;
      }
    });
    for (let ri = 0; ri < rings.length - 1; ri++) for (let k = 0; k < R; k++) {
      const a = base + ri * R + k, b = base + ri * R + ((k + 1) % R), cc = a + R, d = b + R;
      index.push(a, b, cc, b, d, cc); // (faces vers l'extérieur)
    }
  }
  return {
    position: new Float32Array(pos), nidx: new Float32Array(nidx), seg: new Float32Array(seg), sect: new Float32Array(sect), anch: new Float32Array(anch),
    index: v > 65535 ? new Uint32Array(index) : new Uint16Array(index), count: v,
  };
}

// ── Crampons : des haptères ramifiés agrippés à la roche ─────────────────────
// des griffes en tubes effilés qui partent du pied du stipe et descendent en
// arcs jusqu'à la roche, sur deux ou trois étages (cône d'haptères)
export function holdfastGeometry(K, plants, rockH, seed) {
  const F = FAMILIES[K.family];
  const B = new Buffers();
  const rr = createRng(`holdfast:${seed}`);
  const N = createNoise3(`holdfast-n:${seed}`);
  plants.forEach((P, pi) => {
    // (chaque crampon a son âge : taille de 0,6 à 1,5)
    const age = 0.6 + 0.9 * rr.next() ** 1.5;
    const R0 = F.holdfast * age;
    if (K.family === 'durvillaea') {
      // disque massif : un coussin de tissu bosselé, au contour irrégulier,
      // qui épouse la roche (un seul maillage, pas des tubes rayonnants)
      const NR = 7, NT = 28, ph = rr.next() * 10;
      const at = (t, a) => {
        const edge = R0 * (0.9 + 0.22 * N.fbm(Math.cos(a) * 1.3 + ph, Math.sin(a) * 1.3, pi * 0.37, 3));
        const rad = edge * t, x = P.x + Math.cos(a) * rad, z = P.z + Math.sin(a) * rad;
        const lump = 1 + 0.35 * N.fbm(x * 40 + ph, z * 40, pi, 2);
        return [x, rockH(x, z) + R0 * 0.5 * (1 - t * t) * lump - 0.003 * t, z];
      };
      const base = B.n;
      for (let i = 0; i <= NR; i++) for (let k = 0; k < NT; k++) {
        const t = i / NR, a = (k / NT) * Math.PI * 2;
        const p = at(t, a), e = 0.01;
        const px = at(Math.min(1, t + e), a), pa = at(Math.max(0.02, t), a + e);
        const d1 = [px[0] - p[0], px[1] - p[1], px[2] - p[2]], d2 = [pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]];
        let n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
        if (n[1] < 0) n = n.map((c) => -c);
        const l = Math.hypot(...n) || 1; n = i === 0 ? [0, 1, 0] : n.map((c) => c / l);
        B.vert(p, n, OUT, d1);
      }
      for (let i = 0; i < NR; i++) for (let k = 0; k < NT; k++) {
        const a = base + i * NT + k, b = base + i * NT + ((k + 1) % NT), c = a + NT, d = b + NT;
        B.tri(a, c, b); B.tri(b, c, d);
      }
      return;
    }
    // le pied du stipe qui s'évase, puis des haptères en nombre, en longueur et
    // en direction irréguliers, qui plongent en arc vers la roche et s'y
    // ramifient une ou deux fois (pointes enfoncées dans la roche)
    const g0 = rockH(P.x, P.z), top = P.y + F.holdfast * 0.6 * age;
    tube(B, [[P.x, g0 - 0.004, P.z], [P.x + (rr.next() - 0.5) * 0.004, (g0 + top) / 2, P.z + (rr.next() - 0.5) * 0.004], [P.x, top + 0.004, P.z]], R0 * 0.42, R0 * 0.16, 10);
    const n = 6 + Math.floor(rr.next() * 8);
    const arm = (o, a, reach, r, depth) => {
      const pts = [];
      const bend = (rr.next() - 0.5) * 0.6;
      for (let s2 = 0; s2 <= 6; s2++) {
        const t = s2 / 6, aa = a + bend * t, rad = reach * t, x = o[0] + Math.cos(aa) * rad, z = o[2] + Math.sin(aa) * rad;
        const g = rockH(x, z);
        pts.push([x, t < 1 ? Math.max(g + r * 0.6, o[1] + (g - o[1]) * t ** 0.7) : g - 0.002, z]);
      }
      tube(B, pts, r, r * 0.55, 6);
      if (depth > 0) {
        const m = pts[3], nb = 1 + (rr.next() < 0.5 ? 1 : 0);
        for (let b = 0; b < nb; b++) arm(m, a + bend * 0.5 + (b === 0 ? 0.45 : -0.45) * (0.6 + 0.6 * rr.next()), reach * (0.4 + 0.25 * rr.next()), r * 0.7, depth - 1);
      }
    };
    for (let k = 0; k < n; k++) {
      const a = rr.next() * Math.PI * 2;
      const h = g0 + (top - g0) * (0.15 + 0.75 * rr.next());
      const o = [P.x + Math.cos(a) * R0 * 0.25, h, P.z + Math.sin(a) * R0 * 0.25];
      arm(o, a, R0 * (0.45 + 0.6 * rr.next()), 0.0045 * (0.8 + 0.5 * rr.next()) * Math.sqrt(age), rr.next() < 0.7 ? 1 : 0);
    }
  });
  return B.out();
}

// ── La vie du platier : balanes, patelles, moules ──────────────────────────
// Autour de la caméra, dans le champ, sur la roche découverte : des balanes
// en colonies sur les bosses, des patelles éparses, des moules serrées dans
// les fissures. Elles donnent l'échelle (un centimètre se lit) et la vie.
// Chaque coquillage est construit dans le repère de la roche (normale du
// relief) ; surf porte l'espèce (balane, patelle, moule) et piece un tirage.
export function faunaGeometry(R, cam, rock, plants, lite = false) {
  const B = new Buffers(1 << 15);
  const rr = createRng(`fauna:${R.seed}`);
  const H = sampler(rock, rock.H), crack = sampler(rock, rock.crack), fill = sampler(rock, rock.fill);
  const yaw = R.camera.yaw, half = (R.camera.fov * Math.PI / 180) * 0.75;
  const ok = (x, z, rMin = 0.35) => {
    const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    if (d < rMin || d > 4.5) return false;
    let a = Math.atan2(-dx, -dz) - yaw; a -= 2 * Math.PI * Math.round(a / (2 * Math.PI));
    if (Math.abs(a) > half) return false;
    if (fill(x, z) - H(x, z) > 0.004) return false; // (pas au fond d'une flaque)
    if (H(x, z) < -0.25) return false; // (pas sur le tombant)
    for (const P of plants) if ((P.x - x) ** 2 + (P.z - z) ** 2 < 0.012) return false;
    return true;
  };
  const frameAt = (x, z) => {
    const e = 0.01, n = norm([-(H(x + e, z) - H(x - e, z)) / (2 * e), 1, -(H(x, z + e) - H(x, z - e)) / (2 * e)]);
    const a = rr.next() * Math.PI * 2;
    const t0 = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [Math.cos(a), 0, Math.sin(a)]));
    const b0 = cross(n, t0);
    return { o: [x, H(x, z), z], n, t: t0, b: b0 };
  };
  const put = (F, u, v, w) => [F.o[0] + F.t[0] * u + F.b[0] * v + F.n[0] * w, F.o[1] + F.t[1] * u + F.b[1] * v + F.n[1] * w, F.o[2] + F.t[2] * u + F.b[2] * v + F.n[2] * w];
  const dir = (F, u, v, w) => norm([F.t[0] * u + F.b[0] * v + F.n[0] * w, F.t[1] * u + F.b[1] * v + F.n[1] * w, F.t[2] * u + F.b[2] * v + F.n[2] * w]);
  // une coque de révolution : profil [[rayon, hauteur], ...] du bord au sommet,
  // rayon modulé par l'angle (lobes, côtes), aplatie en x par sx
  const shell = (F, prof, nSeg, kind, mod = () => 1, sx = 1, sk = 0) => {
    B.piece = Math.floor(rr.next() * 255);
    const rows = [];
    prof.forEach(([r, h], j) => {
      const row = [];
      for (let k = 0; k < nSeg; k++) {
        const a = (k / nSeg) * Math.PI * 2, m = r * mod(a, j);
        const u = Math.cos(a) * m * sx + sk * h, v = Math.sin(a) * m;
        // normale approchée : radiale inclinée par la pente du profil
        const nb = prof[Math.min(prof.length - 1, j + 1)], pb = prof[Math.max(0, j - 1)];
        const dr = nb[0] - pb[0], dh = nb[1] - pb[1];
        row.push(B.vert(put(F, u, v, h - 0.0015), dir(F, Math.cos(a) * dh * sx, Math.sin(a) * dh, -dr || 1e-4), kind));
      }
      rows.push(row);
    });
    B.grid(rows, true);
  };
  const BAR = [255, 0, 0], LIM = [0, 255, 0], MUS = [0, 0, 255];
  const k = lite ? 0.5 : 1;
  // balanes : colonies serrées sur les bosses découvertes
  for (let c = 0; c < 110 * k; c++) {
    const x0 = cam.x + (rr.next() - 0.5) * 7, z0 = cam.z - 0.3 - rr.next() * 4.4;
    if (!ok(x0, z0)) continue;
    const n = 6 + Math.floor(rr.next() * 22);
    for (let q = 0; q < n; q++) {
      const x = x0 + (rr.next() - 0.5) * 0.14, z = z0 + (rr.next() - 0.5) * 0.14;
      if (!ok(x, z, 0.25)) continue;
      const F = frameAt(x, z), r = 0.003 + 0.0055 * rr.next() ** 2, h = r * (0.55 + 0.3 * rr.next()), lob = rr.next() * 6;
      shell(F, [[r, 0], [r * 0.82, h * 0.55], [r * 0.5, h], [r * 0.34, h * 0.92], [r * 0.12, h * 0.55]], 12, BAR, (a, j) => (j < 2 ? 1 + 0.09 * Math.sin(6 * a + lob) : 1));
    }
  }
  // patelles : éparses
  for (let c = 0; c < 140 * k; c++) {
    const x = cam.x + (rr.next() - 0.5) * 7, z = cam.z - 0.3 - rr.next() * 4.4;
    if (!ok(x, z)) continue;
    const F = frameAt(x, z), r = 0.009 + 0.012 * rr.next(), h = r * (0.45 + 0.25 * rr.next()), ph = rr.next() * 6;
    shell(F, [[r, 0], [r * 0.92, h * 0.3], [r * 0.62, h * 0.72], [r * 0.25, h * 0.95], [0.0005, h]], 18, LIM, (a, j) => (j < 3 ? 1 + 0.05 * Math.sin(17 * a + ph) : 1), 1.15, r * 0.25 * (rr.next() - 0.5));
  }
  // moules : serrées dans les fissures et les creux
  for (let c = 0; c < 900 * k; c++) {
    const x0 = cam.x + (rr.next() - 0.5) * 7, z0 = cam.z - 0.3 - rr.next() * 4.4;
    if (crack(x0, z0) < 0.15 || !ok(x0, z0)) continue;
    const n = 3 + Math.floor(rr.next() * 9);
    for (let q = 0; q < n; q++) {
      const x = x0 + (rr.next() - 0.5) * 0.09, z = z0 + (rr.next() - 0.5) * 0.09;
      if (!ok(x, z, 0.25)) continue;
      const F = frameAt(x, z), L = 0.022 + 0.026 * rr.next(), W = L * 0.42, Hh = L * 0.36;
      // (une coque allongée, en pointe à un bout, à moitié enfoncée et dressée de biais)
      const prof = [[1, -0.25], [0.95, 0.1], [0.78, 0.45], [0.5, 0.75], [0.12, 0.9]].map(([r, h]) => [r * W, h * Hh]);
      shell(F, prof, 14, MUS, (a) => 1 + 0.9 * Math.max(0, Math.cos(a)) ** 1.5 * (L / W - 1) * 0.5, 1.6, 0.4 * Hh);
    }
  }
  return B.out();
}

// tube effilé le long d'une polyligne (rayon r0 → r1), fermé aux bouts
function tube(B, pts, r0, r1, nr = 8) {
  const n = pts.length;
  const base = B.n;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; const tl = Math.hypot(...t) || 1; t = t.map((c) => c / tl);
    let a = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]]; const ul = Math.hypot(...u) || 1; u = u.map((c) => c / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const r = r0 + (r1 - r0) * (i / (n - 1));
    for (let k = 0; k < nr; k++) {
      const th = (k / nr) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const nx = u[0] * c + w[0] * s, ny = u[1] * c + w[1] * s, nz = u[2] * c + w[2] * s;
      B.vert([p[0] + nx * r, p[1] + ny * r, p[2] + nz * r], [nx, ny, nz], OUT, t);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < nr; k++) {
    const a = base + i * nr + k, b = base + i * nr + ((k + 1) % nr);
    B.tri(a, b, a + nr); B.tri(b, b + nr, a + nr);
  }
}

// ── Tout ─────────────────────────────────────────────────────────────────────
export function buildScene(R, { lite = false, onProgress = () => {} } = {}) {
  const t0 = Date.now(), times = {};
  const T = R.loop.duration;
  // 1. la mer (60 images / s : un ressaut avance de 6 cm par image)
  const sea = simulateSea({ T, x0: SEA_X[0], x1: SEA_X[1], dx: 0.025, profile: R.sea.profile, waves: R.sea.waves, manning: R.sea.manning, fps: 60, loops: 2 }, (p) => onProgress(0.08 * p));
  times.sea = Date.now() - t0;
  // 2. la roche
  const pools = makePools(R.seed, { x0: -1.6, x1: 3, z0: -8, z1: 2 }, R.rock.pools);
  const rock = bakeRock({ type: R.rock.type, seed: R.rock.seed, profile: R.sea.profile, box: BOX, M: lite ? 640 : 1024, pools, rock: { amp: R.rock.amp, dip: R.rock.dip } });
  const Hc = sampler(rock, rock.Hc), Hr = sampler(rock, rock.H);
  onProgress(0.14);
  times.rock = Date.now() - t0;
  // 3. la caméra
  const cam = placeCamera(sea, Hr, R.camera, R.sea.waves);
  // 4. les laminaires : la frange du bord du platier, devant la caméra
  // (la frange du bord du platier, dans le champ de la caméra : un cône
  // horizontal autour de sa direction de visée, jusqu'à ~6 m)
  const area = { x0: -3.0, x1: Math.max(cam.x + 0.6, -0.2), z0: cam.z - (lite ? 4.8 : 6.2), z1: cam.z + 0.4 };
  const yaw = R.camera.yaw, half = (R.camera.fov * Math.PI / 180) * 0.5 * 1.8 + 0.15;
  const inside = (x, z) => {
    const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    if (d < 0.6) return false; // (rien contre le dôme)
    const a = Math.atan2(-dx, -dz) - yaw; // (angle depuis l'axe de visée)
    return Math.abs(a) < half || d < 0.9;
  };
  const fill = sampler(rock, rock.fill);
  const plants = layoutPlants(R.family, R.seed, area, Hr, {
    near: { x: cam.x, z: cam.z }, nearR: 2.4, max: lite ? 36 : 64, density: R.kelp.density, inside,
    // (pas dans une flaque, pas sur le dôme de la caméra)
    avoid: (x, z) => fill(x, z) - Hr(x, z) > 0.01 || ((x - cam.x) ** 2 + (z - cam.z) ** 2 < 0.06),
  });
  const K = buildKelp(R.family, plants, Hc);
  const sim = simulateKelp(K, { sea, rockH: Hc, T, fps: 30, sub: lite ? 90 : 100, loops: 2, obliq: R.sea.obliq, zRef: cam.z, camera: (ph) => cameraPose(R.camera, cam, ph).pos }, (p) => onProgress(0.14 + 0.8 * p));
  times.kelp = Date.now() - t0;
  // 5. tampons du GPU
  const N = sim.n, nf = sim.nf;
  const kpos = new Uint16Array(N * nf * 4), kdir = new Uint8Array(N * nf * 4);
  const anchorOf = new Float32Array(N * 3);
  K.nodes.forEach((o, i) => { const P = plants[o.plant]; anchorOf[3 * i] = P.x; anchorOf[3 * i + 1] = P.y; anchorOf[3 * i + 2] = P.z; });
  // directeurs de signe cohérent le long de chaque chaîne et d'une image à
  // l'autre (un ruban est symétrique : b et −b décrivent la même lame, mais le
  // maillage, lui, tournerait d'un demi-tour)
  {
    const D = sim.dir;
    for (let f = 0; f < nf; f++) for (const c of K.chains) {
      if (c.kind !== 1) continue;
      let prev = null;
      for (const i of c.nodes) {
        const s = (f * N + i) * 3;
        let ref = prev;
        if (!ref && f > 0) { const q = ((f - 1) * N + i) * 3; ref = [D[q], D[q + 1], D[q + 2]]; }
        if (ref && D[s] * ref[0] + D[s + 1] * ref[1] + D[s + 2] * ref[2] < 0) { D[s] = -D[s]; D[s + 1] = -D[s + 1]; D[s + 2] = -D[s + 2]; }
        prev = [D[s], D[s + 1], D[s + 2]];
      }
    }
  }
  for (let f = 0; f < nf; f++) for (let i = 0; i < N; i++) {
    const s = (f * N + i) * 3, d = (f * N + i) * 4;
    kpos[d] = toHalf(sim.pos[s] - anchorOf[3 * i]); kpos[d + 1] = toHalf(sim.pos[s + 1] - anchorOf[3 * i + 1]); kpos[d + 2] = toHalf(sim.pos[s + 2] - anchorOf[3 * i + 2]); kpos[d + 3] = 0;
    const q = (v) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
    kdir[d] = q(sim.dir[s]); kdir[d + 1] = q(sim.dir[s + 1]); kdir[d + 2] = q(sim.dir[s + 2]); kdir[d + 3] = 255;
  }
  const seaTex = new Uint16Array(sea.nx * sea.nf * 4), wetTex = new Uint16Array(sea.nx * sea.nf);
  for (let k = 0; k < sea.nx * sea.nf; k++) {
    seaTex[4 * k] = toHalf(sea.eta[k]); seaTex[4 * k + 1] = toHalf(sea.u[k]); seaTex[4 * k + 2] = toHalf(sea.foam[k]); seaTex[4 * k + 3] = toHalf(sea.aer[k]);
    wetTex[k] = toHalf(sea.wet[k]);
  }
  // le dôme : pour chaque hauteur autour de l'objectif (32 niveaux sur ±12 cm)
  // et chaque image, le temps écoulé depuis que l'eau l'a quitté (−1 s'il est
  // dans l'eau) et le numéro de cette émergence — les gouttes naissent quand
  // l'eau se retire, glissent et sèchent ; chaque vague en dépose de nouvelles
  const EL = 32, emerge = new Uint16Array(sea.nf * EL * 2);
  {
    const ic = Math.round((cam.x - sea.x0) / sea.dx - 0.5);
    for (let l = 0; l < EL; l++) {
      const hgt = cam.y - 0.12 + (0.24 * l) / (EL - 1);
      let tau = 99, count = 0;
      for (let pass = 0; pass < 2; pass++) for (let f = 0; f < sea.nf; f++) {
        if (sea.eta[f * sea.nx + ic] >= hgt) tau = -1;
        else { if (tau < 0) { tau = 0; count++; } else tau += 1 / sea.fps; }
        if (pass) { const o = (l * sea.nf + f) * 2; emerge[o] = toHalf(Math.min(tau, 60)); emerge[o + 1] = toHalf(count % 64); }
      }
    }
  }
  const fillTex = new Uint16Array(rock.M * rock.M);
  // (hors flaque : juste sous la roche, pas −9 — le champ reste continu et le
  // bord d'une flaque, seuillé sur l'interpolation, suit une courbe au lieu
  // de marches de texels)
  for (let k = 0; k < fillTex.length; k++) fillTex[k] = toHalf(rock.fill[k] - rock.H[k] > 0.002 ? rock.fill[k] : rock.H[k] - 0.002);
  const straps = strapGeometry(K, plants);
  const holdfasts = holdfastGeometry(K, plants, Hr, R.seed);
  const fauna = faunaGeometry(R, cam, rock, plants, lite);
  onProgress(1);
  times.total = Date.now() - t0;
  return {
    T, cam, times, emerge: { tex: emerge, nf: sea.nf, levels: EL, y0: cam.y - 0.12, dy: 0.24 }, stats: { sea: sea.stats, kelp: { ...sim.stats, worst: undefined }, plants: plants.length, nodes: N },
    sea: { nx: sea.nx, nf: sea.nf, x0: sea.x0, dx: sea.dx, fps: sea.fps, tex: seaTex, wet: wetTex, b: sea.b },
    rock: { M: rock.M, box: BOX, relief: rockRelief(rock), color: rockColors(rock, R), fill: fillTex },
    fauna,
    kelp: { n: N, nf, fps: sim.fps, pos: kpos, dir: kdir, straps, holdfasts, fringe: !!FAMILIES[R.family].blade.fringe, plants: plants.map((p) => [p.x, p.y, p.z]) },
  };
}
