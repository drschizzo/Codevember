// Banc des contacts (module pur) : sur toute la boucle, aucun maillon ne
// touche le bâti, le sol, une pièce mobile de la machine ni un autre
// maillon. Il voit ce que l'écran montre :
// - la scène est posée par la fonction du rendu (gen/pose.js : poseOf) ;
// - les obstacles sont les vraies pièces construites (gen/build.js), chacune
//   ramenée à la boîte de chacune de ses composantes connexes (une colonne,
//   un palier, un pied : conservateur) ;
// - un maillon est échantillonné le long de son axe tous les 4 mm, avec sa
//   demi-largeur dans le plan et sa demi-épaisseur hors du plan (lentille
//   comprise).
import { layoutOf, poseOf, thickOf, bobThick } from './pose.js';
import { cartBench, cartCarriage, rotaryBase, rotaryArm, portal, acroDrive, gallows, flywheel } from './build.js';

// boîtes des composantes connexes d'un maillage (union-find sur les triangles)
export function components(o) {
  const n = o.position.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  // (des sommets confondus — les coutures — appartiennent à la même pièce)
  const key = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(o.position[i * 3] * 1e5)},${Math.round(o.position[i * 3 + 1] * 1e5)},${Math.round(o.position[i * 3 + 2] * 1e5)}`;
    if (key.has(k)) parent[find(i)] = find(key.get(k)); else key.set(k, i);
  }
  for (let t = 0; t < o.index.length; t += 3) {
    const a = find(o.index[t]), b = find(o.index[t + 1]), c = find(o.index[t + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const boxes = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i), p = [o.position[i * 3], o.position[i * 3 + 1], o.position[i * 3 + 2]];
    const B = boxes.get(r) ?? { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    for (let k = 0; k < 3; k++) { B.lo[k] = Math.min(B.lo[k], p[k]); B.hi[k] = Math.max(B.hi[k], p[k]); }
    boxes.set(r, B);
  }
  return [...boxes.values()];
}

// obstacles d'une machine : boîtes fixes (monde) et boîtes portées par un
// corps mobile (repère local + fonction qui ramène un point monde dans ce repère)
export function obstaclesOf(M, Lay = layoutOf(M), wood = false) {
  const fixed = [], moving = [];
  // l'axe qui porte le premier maillon entre dans sa chape : on l'arrête à
  // la face arrière du maillon (au-delà, c'est le pivot lui-même)
  const back = Lay.z[0] - (thickOf(M.links[0]) / 2 + 0.0025) - 0.0035;
  const add = (o) => { if (o?.position?.length) fixed.push(...components(o)); };
  if (M.family === 'cart') {
    const b = cartBench(M, wood);
    Object.values(b.parts).forEach(add);
    const c = cartCarriage(M, Lay.z0);
    // (l'axe du premier maillon sort du chariot jusqu'à son plan : exclu)
    const boxes = [...components(c.body), ...components(c.hub)].filter((B) => B.hi[2] < Lay.z[0] - 0.012);
    moving.push({ name: 'chariot', boxes, toLocal: (p, st) => [p[0] - st.s, p[1] - M.height, p[2]] });
  } else if (M.family === 'rotary') {
    Object.values(rotaryBase(M)).forEach(add);
    const a = rotaryArm(M, Lay);
    // (l'axe du pendule, à la tête du bras, entre dans le premier maillon : exclu)
    const boxes = [...components(a.arm), ...components(a.hub), ...components(a.accent)].filter((B) => !(B.lo[2] > M.arm.r - 0.002 && B.hi[0] - B.lo[0] < 0.012));
    moving.push({ name: 'bras', boxes, toLocal: (p, st) => { const c = Math.cos(st.s), s = Math.sin(st.s), x = p[0], z = p[2]; return [c * x - s * z, p[1] - M.height, s * x + c * z]; } });
  } else if (M.family === 'acrobat') {
    const P = portal(M, Lay, wood);
    // (l'axe de l'épaule traverse le premier maillon : son bout est exclu)
    for (const o of Object.values(P)) for (const B of components(o)) { if (B.hi[2] > back && B.hi[1] - B.lo[1] < 0.03) B.hi[2] = back; fixed.push(B); }
  } else if (M.family === 'wheel') {
    const G = gallows(M, Lay, wood);
    for (const o of Object.values(G)) for (const B of components(o)) { if (B.hi[2] > back && B.hi[1] - B.lo[1] < 0.03) B.hi[2] = back; fixed.push(B); }
  }
  return { fixed, moving };
}

// distance d'un point à une boîte (0 dedans)
const boxDist = (p, B, pad) => {
  let d2 = 0;
  for (let k = 0; k < 3; k++) { const v = Math.max(B.lo[k] - pad[k] - p[k], 0, p[k] - B.hi[k] - pad[k]); d2 += v * v; }
  return Math.sqrt(d2);
};

// Échantillons d'un maillon (et de ce qu'il porte) à un instant : centres,
// demi-largeur dans le plan, demi-épaisseur hors du plan (repère monde : la
// normale au plan est z, ou le bras pour le tourniquet)
export function linkSamples(M, Q, i, Lay) {
  const L = M.links[i], P = Q.links[i], th = thickOf(L);
  const c = Math.cos(P.angle), s = Math.sin(P.angle), cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  const out = [];
  const put = (d, rIn, rOut) => {
    // point du maillon à la distance d du pivot, dans son plan
    const lx = s * d, ly = -c * d;
    out.push({ p: [P.pos[0] + cy * lx, P.pos[1] + ly, P.pos[2] - sy * lx], rIn, rOut });
  };
  for (let d = 0; d <= L.l + 1e-9; d += 0.004) put(d, Math.max(L.w, 0.012) / 2, th / 2 + 0.0025);
  if (L.bob) for (let d = -L.bob.r; d <= L.bob.r; d += 0.006) put(L.bob.at * L.l + d, Math.sqrt(Math.max(0, L.bob.r * L.bob.r - d * d)), bobThick(L) / 2);
  // ce que le maillon porte : volant et son moteur (roue), moteur du coude (acrobate)
  const at = (d, dz, rIn, rOut, ox = 0) => {
    const lx = s * d + c * ox, ly = -c * d + s * ox;
    out.push({ p: [P.pos[0] + cy * lx, P.pos[1] + ly, P.pos[2] - sy * lx + dz], rIn, rOut, carried: true });
  };
  if (M.family === 'wheel' && i === M.links.length - 1) {
    const r = M.wheel.r, dzW = Lay.wheelZ - Lay.z[i];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * Math.PI; at(L.l + r * Math.cos(a), dzW, 0.012, 0.011, r * Math.sin(a)); }
    at(L.l, -(th / 2 + 0.004) - 0.028, 0.031, 0.028);
  }
  if (M.family === 'acrobat' && i === 0) at(M.motor.at * L.l, -(th / 2 + 0.012) - 0.04, 0.029, 0.03);
  return out;
}

// Le banc : n instants sur la boucle (film.at), toutes les paires. Rend la
// liste des contacts (vide si tout passe) et le jeu minimal relevé.
export function clearance(M, film, { n = 240, margin = 0.002, wood = false, zShift = 0 } = {}) {
  const Lay = layoutOf(M), O = obstaclesOf(M, Lay, wood);
  const hits = [];
  let minGap = Infinity;
  const st = {};
  for (let k = 0; k < n; k++) {
    const u = k / n;
    film.at(u, st);
    const Q = poseOf(M, st.theta, st.s, Lay);
    const S = M.links.map((_, i) => linkSamples(M, Q, i, Lay));
    if (zShift) for (const pts of S) for (const q of pts) q.p[2] += zShift; // (témoin négatif)
    S.forEach((pts, i) => {
      for (const { p, rIn, rOut } of pts) {
        // sol (et plateau du socle : il est dans les boîtes fixes)
        minGap = Math.min(minGap, p[1] - rIn);
        if (p[1] - rIn < margin) hits.push({ u, i, what: 'sol', p });
        // pour les boîtes, la marge est anisotrope : dans le plan rIn, hors du plan rOut
        const pad = M.family === 'rotary' ? [rIn, rIn, rIn] : [rIn, rIn, rOut];
        for (const B of O.fixed) {
          const d = boxDist(p, B, pad);
          if (d < minGap) minGap = d;
          if (d < margin) { hits.push({ u, i, what: 'bâti', p, B }); break; }
        }
 for (const mv of O.moving) {
          // (dans le repère du chariot ou du bras, la normale au plan du maillon est z)
          const q = mv.toLocal(p, st), padL = [rIn, rIn, rOut];
          for (const B of mv.boxes) { const d = boxDist(q, B, padL); minGap = Math.min(minGap, d); if (d < margin) { hits.push({ u, i, what: mv.name, p }); break; } }
        }
      }
    });
    // maillons entre eux : plans séparés (épaisseurs et lentilles comprises)
    for (let i = 0; i + 1 < M.links.length; i++) {
      const own = (q) => !q.carried; // (le moteur, le volant sont de l'autre côté)
      const a = Math.max(...S[i].filter(own).map((q) => q.rOut)), b = Math.max(...S[i + 1].filter(own).map((q) => q.rOut));
      const gap = Math.abs(Lay.z[i + 1] - Lay.z[i]) - a - b;
      if (gap < margin) hits.push({ u, i, what: `maillon ${i + 1}`, gap });
    }
    if (hits.length > 20) break;
  }
  return { hits, minGap };
}
