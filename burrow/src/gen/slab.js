// La coupe vivante : une tranche de sable stratifié entre deux verres. Module
// pur (sans three) : le worker et les bancs l'importent.
//
// Unités : 1 = 10 cm. La tranche fait W de large ; le sable monte à HS ; il
// reste AIR au-dessus pour le tumulus. Grille de cellules de C (0,4 mm).
//
// - strates : frontières ondulées, d'épaisseurs tirées, chacune avec ses lamines ;
// - galeries : creusées dans l'ordre (chaque cellule garde son instant) ;
// - tumulus : chaque cellule creusée remonte, dans l'ordre, et roule sur le tas
//   autour de son entrée jusqu'à l'angle de talus. Le tas garde la couleur de la
//   couche d'où vient chaque grain : il empile les couches à l'envers (le sable
//   du fond, creusé en dernier, en fait la peau). Le volume creusé est le volume
//   du tumulus, au grain près.
import { createRng } from '../../../shared/rng.js';

export const SLAB = { W: 3.2, HS: 2.15, AIR: 0.75, C: 0.004, DEPTH: 0.2 };

export function buildSlab(seed, P = {}) {
  const rng = createRng(`${seed}:slab`);
  const { W, HS, AIR, C } = SLAB;
  const nx = Math.round(W / C), ny = Math.round((HS + AIR) / C), nyS = Math.round(HS / C);
  const N = nx * ny;
  const at = (i, j) => i + nx * j;

  // ── strates (de bas en haut) ──
  // style : lits (couches à peine ondulées) ; sablier (les montagnes des
  // bouteilles de sable coloré, versé à l'entonnoir le long du verre) ; dunes
  // (rides dissymétriques, flanc doux et flanc raide) ; éventail (des couches
  // qui s'épaississent d'un côté)
  const style = P.style ?? 'lits';
  const worm = P.digger === 'vers';
  const nL = P.layers ?? (style === 'sablier' ? rng.int(9, 12) : rng.int(6, 8));
  const th = Array.from({ length: nL }, () => rng.range(0.6, 1.4));
  const sum = th.reduce((a, b) => a + b, 0);
  const bounds = []; // bounds[k](x) : bas de la couche k (k = 0 : fond)
  const peaks = Array.from({ length: rng.int(2, 3) }, () => [rng.range(0.15, 0.85) * W, rng.range(0.35, 0.9)]);
  const tri = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w);
  let acc = 0;
  for (let k = 0; k < nL; k++) {
    const base = (acc / sum) * HS;
    acc += th[k];
    if (k === 0) { bounds.push(() => -1); continue; }
    const waves = Array.from({ length: 3 }, (_, w) => [rng.range(0.6, 2.6) * (w + 1), rng.range(0, Math.PI * 2), rng.range(0.008, 0.03) / (w + 1)]);
    const ripple = (x) => waves.reduce((s2, [f, p2, a2]) => s2 + a2 * Math.sin(f * x + p2), 0);
    const tilt = rng.range(-0.03, 0.03);
    if (style === 'sablier') {
      // les pics dérivent un peu d'une couche à l'autre ; leur hauteur varie
      const amp = rng.range(0.12, 0.5) * (k / nL + 0.4), drift = peaks.map(() => rng.range(-0.12, 0.12)), wid = rng.range(0.3, 0.75);
      bounds.push((x) => base - amp * 0.5 + peaks.reduce((s2, [c, h], i) => s2 + amp * h * tri(x, c + drift[i] * k * 0.3, wid), 0) + ripple(x) * 0.4);
    } else if (style === 'dunes') {
      const lam2 = rng.range(0.45, 0.8), ph = rng.range(0, 1), amp = rng.range(0.03, 0.08);
      bounds.push((x) => { const u = ((x / lam2 + ph) % 1 + 1) % 1; const saw = u < 0.75 ? u / 0.75 : (1 - u) / 0.25; return base + amp * (saw * saw * (3 - 2 * saw) - 0.5) + ripple(x) * 0.5; });
    } else if (style === 'eventail') {
      const g = (k / nL - 0.5) * rng.range(0.32, 0.5);
      bounds.push((x) => base + g * (x - W / 2) + ripple(x) * 0.6);
    } else {
      bounds.push((x) => base + tilt * (x - W / 2) + ripple(x));
    }
  }
  // couleur de chaque couche : un ordre propre à la tranche, sans deux voisines pareilles
  const colorOrder = [];
  for (let k = 0; k < nL; k++) { let c; do { c = rng.int(0, 7); } while (k > 0 && c === colorOrder[k - 1]); colorOrder.push(c); }
  const layer = new Uint8Array(N).fill(255); // (255 : air)
  const lam = new Float32Array(N); // lamines : position fine dans la couche (0–1)
  const minT = 0.012; // (une couche ne s'amincit jamais sous 1,2 mm : frontières ordonnées)
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * C;
    const b = bounds.map((f) => f(x));
    for (let k = 1; k < nL; k++) b[k] = Math.max(b[k], Math.max(0, b[k - 1]) + minT);
    for (let j = 0; j < nyS; j++) {
      const y = (j + 0.5) * C;
      let k = 0;
      while (k + 1 < nL && y >= b[k + 1]) k++;
      layer[at(i, j)] = k;
      const top = k + 1 < nL ? b[k + 1] : HS;
      lam[at(i, j)] = (y - Math.max(0, b[k])) / Math.max(1e-3, top - Math.max(0, b[k]));
    }
  }

  // ── galeries ──
  const dug = new Float32Array(N).fill(-1); // instant de creusement (rang), −1 : intact
  const owner = new Int16Array(N).fill(-1); // entrée dont la galerie part
  // chaque entrée creuse à son rythme, toutes en même temps : instants par entrée,
  // ramenés à [0, 1] à la fin
  let t = 0;
  const tE = [0, 0, 0, 0, 0, 0];
  const carve = (x, y, r, ent) => {
    const i0 = Math.max(0, Math.floor((x - r) / C)), i1 = Math.min(nx - 1, Math.ceil((x + r) / C));
    const j0 = Math.max(0, Math.floor((y - r) / C)), j1 = Math.min(nyS - 1, Math.ceil((y + r) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * C - x, dy = (j + 0.5) * C - y;
      if (dx * dx + dy * dy <= r * r && dug[at(i, j)] < 0) { dug[at(i, j)] = tE[ent]++; t++; owner[at(i, j)] = ent; }
    }
  };
  const carveEll = (x, y, rx, ry, ent) => {
    // une chambre : creusée du centre vers le bord (anneaux croissants)
    for (let s = 0.2; s <= 1.0001; s += 0.1) {
      const i0 = Math.max(0, Math.floor((x - rx * s) / C)), i1 = Math.min(nx - 1, Math.ceil((x + rx * s) / C));
      const j0 = Math.max(0, Math.floor((y - ry * s) / C)), j1 = Math.min(nyS - 1, Math.ceil((y + ry * s) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = ((i + 0.5) * C - x) / (rx * s), dy = ((j + 0.5) * C - y) / (ry * s);
        // plancher plat, plafond en voûte
        const q = dy < 0 ? dx * dx + (dy * 2.2) ** 2 : dx * dx + dy * dy;
        if (q <= 1 && dug[at(i, j)] < 0) { dug[at(i, j)] = tE[ent]++; t++; owner[at(i, j)] = ent; }
      }
    }
  };
  const nE = P.entrances ?? (worm ? rng.int(3, 4) : rng.int(2, 3));
  const entrances = [];
  for (let e = 0; e < nE; e++) entrances.push(W * (0.2 + 0.6 * (nE === 1 ? 0.5 : e / (nE - 1))) + rng.range(-0.15, 0.15));
  const R = P.tunnelR ?? (worm ? 0.013 : 0.022);
  // le réseau, pour les fourmis : points de l'axe des galeries, avec l'instant
  // où ils ont été creusés et leur parent (vers l'entrée)
  const nodes = [];
  const node = (x, y, parent, ent) => { nodes.push({ x, y, t: tE[ent], parent, ent }); return nodes.length - 1; };
  // densité du réseau, propre à la tranche : branches, galeries d'étage, chambres
  const dens = P.density ?? rng.range(0.7, 1.5);
  // (budget par entrée : le tas doit tenir sous le cadre — le volume est conservé)
  const budget = Math.floor(62000 / nE);
  // une cellule creusée par une galerie plus ancienne, devant soi ? (pour boucler)
  const older = (x, y, ent, tMax) => {
    const i = Math.floor(x / C), j = Math.floor(y / C);
    if (i < 0 || j < 0 || i >= nx || j >= nyS) return false;
    const id = at(i, j);
    return dug[id] >= 0 && owner[id] === ent && dug[id] < tMax;
  };
  // une galerie : marche à courbure aléatoire ; kind : 'puits' (vers le bas),
  // 'etage' (presque horizontale), 'branche' (entre les deux)
  const gallery = (x, y, ang, len, ent, depth, par, kind = 'puits') => {
    const step = C * 1.5;
    let a = ang, w = 0;
    const t0 = tE[ent];
    const pull = worm ? 0.02 : kind === 'puits' ? 0.05 : kind === 'etage' ? 0.002 : 0.012;
    const level = y; // (une galerie d'étage garde sa hauteur)
    for (let s = 0; s < len; s += step) {
      if (tE[ent] >= budget) return;
      w += rng.range(-0.35, 0.35); w *= 0.92;
      a += w * 0.12;
      // rappel vers le bas (ou vers son étage), et loin des bords
      a += (-Math.PI / 2 - a) * pull * (y > HS - 0.25 ? 3 : 1);
      if (kind === 'etage') a += Math.max(-0.05, Math.min(0.05, (level - y) * 2)) * (Math.cos(a) > 0 ? 1 : -1);
      if (worm) a += w * 0.1; // (un ver serpente)
      if (x < 0.15) a += (0 - a) * 0.08;
      if (x > W - 0.15) a += (Math.PI - a) * 0.08;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      if (y < 0.1) { y = 0.1; a = Math.abs(a); }
      if (y > HS - 0.02) y = HS - 0.02;
      carve(x, y, R * (1 + 0.08 * Math.sin(s * 40)), ent);
      if (Math.round(s / step) % 4 === 0) par = node(x, y, par, ent);
      // une boucle : la galerie retrouve une galerie plus ancienne de la même
      // entrée, s'y raccorde et s'arrête (le réseau devient un maillage)
      if (!worm && depth > 0 && s > 0.12 && older(x + Math.cos(a) * R * 2.2, y + Math.sin(a) * R * 2.2, ent, t0 - 200)) {
        carve(x + Math.cos(a) * R * 1.6, y + Math.sin(a) * R * 1.6, R, ent);
        node(x, y, par, ent);
        return;
      }
      // branches, galeries d'étage, chambres en route
      if (!worm && depth < 3 && rng.chance(0.009 * dens)) gallery(x, y, a + rng.sign() * rng.range(0.7, 1.3), len * rng.range(0.25, 0.55), ent, depth + 1, par, 'branche');
      if (!worm && depth < 2 && rng.chance(0.004 * dens)) gallery(x, y, rng.chance(0.5) ? rng.range(-0.15, 0.1) : Math.PI + rng.range(-0.1, 0.15), rng.range(0.4, 0.9), ent, depth + 1, par, 'etage');
      if (!worm && rng.chance(0.006 * dens)) {
        // une chambre, parfois en grappe (deux ou trois accolées)
        const side = rng.sign(), n = rng.chance(0.35) ? rng.int(2, 3) : 1;
        for (let c = 0; c < n; c++) {
          const cx = x + side * (0.09 + c * 0.11), cy = y - 0.01 + c * rng.range(-0.03, 0.03);
          carveEll(cx, cy, rng.range(0.06, 0.12), rng.range(0.022, 0.034), ent); node(cx, cy - 0.005, par, ent);
        }
      }
    }
    if (tE[ent] >= budget) return;
    if (!worm) carveEll(x, y, rng.range(0.08, 0.14), rng.range(0.025, 0.038), ent);
    node(x, y - 0.01, par, ent);
  };
  entrances.forEach((x0, e) => {
    carve(x0, HS - 0.01, R, e);
    const root = node(x0, HS + 0.01, -1, e);
    gallery(x0, HS - 0.02, -Math.PI / 2 + rng.range(-0.4, 0.4), rng.range(1.6, 2.6) * (worm ? 1.5 : 1) * (P.reach ?? 1), e, 0, root);
  });
  const total = t;
  for (let id = 0; id < N; id++) if (dug[id] >= 0) dug[id] = (dug[id] + 0.5) / tE[owner[id]];
  for (const n of nodes) n.t = Math.min(1, n.t / tE[n.ent]);

  // ── tumulus : chaque cellule creusée, dans l'ordre, roule sur le tas ──
  // (colonnes de 2 cellules, un grain = une cellule : un grain roule si la colonne voisine a
  //  3 grains de moins — talus ≈ 37°, sable humide ; la bouche de l'entrée reste ouverte)
  const cw = 2, ncol = Math.ceil(nx / cw);
  const hcol = new Int32Array(ncol); // grains posés par colonne (cw grains = une rangée de cellules)
  const stack = Array.from({ length: ncol }, () => []); // grains posés : [couche, lamine, instant]
  const order = [];
  for (let id = 0; id < N; id++) if (dug[id] >= 0) order.push(id);
  order.sort((a, b) => dug[a] - dug[b]);
  const mouth = entrances.map((x) => Math.round(x / C / cw));
  const gap = Math.ceil(R / C / cw);
  const drops = []; // (où tombent les boulettes, et quand : pour les fourmis)
  for (const id of order) {
    const e = owner[id], m = mouth[e];
    let c = m + (rng.chance(0.5) ? -1 : 1) * (gap + Math.floor(Math.abs(rng.gauss()) * (worm ? 12 : 30))); // (les turricules d'un ver tombent à la bouche ; les boulettes des fourmis, autour)
    c = Math.max(0, Math.min(ncol - 1, c));
    // une boulette de sable humide roule tant que la pente l'y oblige ; sur une
    // pente douce, elle s'arrête souvent où elle tombe (profil arrondi, bosselé)
    for (let guard = 0; guard < 4000; guard++) {
      const l = c - 1, r = c + 1;
      const dl = l >= 0 && Math.abs(l - m) > gap ? hcol[c] - hcol[l] : -9, dr = r < ncol && Math.abs(r - m) > gap ? hcol[c] - hcol[r] : -9;
      const d = Math.max(dl, dr);
      if (d < 2 || (d < 4 && rng.chance(0.3))) break;
      c = dl === dr ? (rng.chance(0.5) ? l : r) : dl > dr ? l : r;
    }
    stack[c].push([layer[id], lam[id], dug[id]]);
    if (rng.chance(1 / 64)) drops.push({ t: dug[id], x: (c + 0.5) * cw * C, y: nyS * C + (hcol[c] / cw) * C, ent: e });
    hcol[c]++;
  }
  // ── tout en cellules : sable en place (creusé ou non), tas, air ──
  const mound = new Float32Array(N).fill(-1); // instant de dépôt du grain (tas), −1 sinon
  for (let c = 0; c < ncol; c++) {
    stack[c].forEach(([k, l, tt], n) => {
      const j = nyS + Math.floor(n / cw), i = c * cw + (n % cw);
      if (i >= nx || j >= ny) return;
      layer[at(i, j)] = k; lam[at(i, j)] = l; mound[at(i, j)] = tt;
    });
  }
  return { nx, ny, nyS, C, W, HS, layer, lam, dug, mound, total, nL, entrances, hcol, cw, nodes, drops, colorOrder, style, digger: worm ? 'vers' : 'fourmis' };
}
