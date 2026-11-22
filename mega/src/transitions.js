// Les passages du relais. Chacun reprend le geste du jour qui ARRIVE : on
// entre dans une scène par ce qui s'y passe. A : l'image du jour qui s'en va,
// B : celle du jour qui arrive (toutes deux étalonnées, en espace d'affichage) ;
// p ∈ [0, 1] : l'avancée du passage ; t : l'horloge de l'hôte (s).
//
//   heat     → Magma    la peau se fend, les fissures rougeoient puis s'ouvrent
//   shatter  → Shatter  l'image se fêle en éclats aux arêtes de verre, qui tombent
//   melt     → Melt     l'image fond et coule vers le bas en filets de cire
//   bolt     → Bolt     un traceur descend, l'éclair frappe, le jour s'ouvre
//                       depuis le canal
//   ripple   → Caustic  des ondes accourent des bords vers un point, réfractent
//                       l'image et dessinent des caustiques
//   wave     → Kelp     une vague monte depuis le bas, ligne d'écume
//   rivulets → Erosion  l'eau descend en rigoles ramifiées, mouille et emporte
//   moss     → Moss     la pierre fonce sous l'averse, des îlots verts poussent
//                       et se rejoignent
//   spore    → Spore    une poussière de spores se pose, germe en gouttelettes
//                       jaunes qui fusionnent, un réseau de plasmode s'étend
//   feather  → Feather  une plume s'ouvre depuis son rachis, barbe après barbe
//   cocoon   → Cocoon   des fils de soie s'enroulent et couvrent l'image, chacun
//                       portant un peu de lumière
//   twist    → Tangle   l'image se tord autour du centre, et l'autre se détord
//   cables   → Tension  des câbles tendus découpent l'image en panneaux, qui
//                       s'ouvrent un à un
//   rust     → Rust     la rouille fleurit sur l'image, puis s'écaille en plaques
//   membrane → Membrane une membrane veinée couvre l'image, se tend et se
//                       déchire depuis le centre
//   fold     → Fold     l'image se plie le long de plis, panneau par panneau
//   swing    → Pendulum un balancier pendu en haut balaie l'image en oscillant
//   maze     → Labyrinth l'ouverture avance dans les couloirs d'un dédale
//   flash    → Echo     l'éclair part d'un point, son front avance en anneau
//   mirror   → Mirage   l'image est aspirée vers l'ouverture du mirascope, où la
//                       scène suivante apparaît
//   dive     → Hollow   la caméra plonge dans une alvéole qui s'élargit
//   unfold   → Tesseract des carrés pivotent sur leurs arêtes, comme le patron
//                       d'un cube qui se replie
//   orbit    → Orrery   trois corps parcourent un huit, leurs traînées ouvrent
//                       l'image
//   scales   → Nest     des écailles de papier poussent du haut vers le bas,
//                       bande après bande, et recouvrent l'image
//
// screenUV : origine en haut à gauche, y vers le bas.
import * as THREE from 'three/webgpu';
import {
  Fn, texture, uniform, vec2, vec3, vec4, float, dot, mix, smoothstep, clamp, screenUV, select,
  mx_fractal_noise_float, mx_noise_float, mx_cell_noise_float, max, min, abs, exp, sin, cos, pow, floor, fract, length, normalize, step,
} from 'three/tsl';

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const fbm = (p2, z, oct = 3) => mx_fractal_noise_float(vec3(p2, z), oct, 2, 0.5); // ≈ [-1, 1]

// cellules de Voronoï : F1, F2 (distances aux deux germes les plus proches) et
// un nombre propre à la cellule (0…1) ; q en unités de cellule
function voronoi(q) {
  const c = floor(q).toVar(), f = fract(q).toVar();
  const F1 = float(8).toVar(), F2 = float(8).toVar(), id = float(0).toVar();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const g = vec2(dx, dy), cell = c.add(g);
    const o = vec2(mx_cell_noise_float(cell), mx_cell_noise_float(cell.add(vec2(37, 11))));
    const d = length(g.add(o).sub(f)).toVar();
    const closer = d.lessThan(F1);
    F2.assign(select(closer, F1, min(F2, d)));
    id.assign(select(closer, mx_cell_noise_float(cell.add(vec2(5, 91))), id));
    F1.assign(min(F1, d));
  }
  return { F1, F2, id, edge: F2.sub(F1) };
}

// ouverture le long d'un ordre (0 = d'abord, 1 = en dernier), front doux
function sweep(order, p, w = 0.06) {
  const front = p.mul(1 + 2 * w).sub(w);
  const m = smoothstep(order.sub(w), order.add(w), front);
  return { m, rim: pow(m.mul(float(1).sub(m)).mul(4), 1.5) };
}

export function createTransitions(slots) {
  // Les deux images viennent toujours des deux mêmes textures, les emplacements
  // de l'hôte (slots) ; `swap` dit lequel tient le jour qui s'en va. (Changer
  // la texture d'un nœud d'une image à l'autre laissait la première image d'un
  // passage noire : three.js ne relit la valeur qu'à l'image suivante.)
  const U = { p: uniform(0), t: uniform(0), aspect: uniform(1), swap: uniform(0) };
  const pick = (first, uv) => {
    const s0 = texture(slots[0].texture, uv).rgb, s1 = texture(slots[1].texture, uv).rgb;
    return first ? mix(s0, s1, U.swap) : mix(s1, s0, U.swap);
  };
  const A = (uv) => pick(true, uv), B = (uv) => pick(false, uv);
  const uv = screenUV, asp = vec2(U.aspect, 1), p = U.p, t = U.t;

  const T = {
    // → Magma : fissures de la croûte, qui rougeoient avant de s'ouvrir
    heat: () => {
      const a = A(uv), b = B(uv);
      const v = voronoi(uv.mul(asp).mul(6.5));
      const n = fbm(uv.mul(asp).mul(2.5), t.mul(0.1)).mul(0.5).add(0.5);
      const lum = clamp(dot(a, LUMA), 0, 1);
      const order = clamp(smoothstep(0, 0.45, v.edge).mul(0.75).add(n.mul(0.25)).sub(lum.mul(0.1)), 0, 1);
      const { m, rim } = sweep(order, p, 0.07);
      const crack = float(1).sub(smoothstep(0.0, 0.06, v.edge)).mul(smoothstep(0.0, 0.25, p)).mul(float(1).sub(m));
      const hot = vec3(1.0, 0.34, 0.07);
      return mix(a.mul(float(1).sub(crack.mul(0.3))), b, m).add(hot.mul(rim.mul(0.9).add(crack.mul(1.1))));
    },
    // → Shatter : fêlures, puis chaque éclat glisse et tombe, arêtes claires
    shatter: () => {
      const v = voronoi(uv.mul(asp).mul(4.5));
      const lp = clamp(p.mul(1.8).sub(v.id.mul(0.75)).sub(0.05), 0, 1).toVar();
      const drop = lp.mul(lp).mul(0.55);
      const a = A(uv.sub(vec2(v.id.sub(0.5).mul(0.07).mul(lp), drop)));
      const b = B(uv.add(vec2(v.id.sub(0.5), v.id.mul(0.7).sub(0.35)).mul(0.012).mul(float(1).sub(p))));
      const keep = float(1).sub(smoothstep(0.3, 0.85, lp));
      const crack = float(1).sub(smoothstep(0.0, 0.03, v.edge)).mul(smoothstep(0.0, 0.18, p));
      const glint = vec3(0.92, 0.96, 1.0).mul(crack.mul(keep).mul(0.85));
      return mix(b, a.mul(float(1).sub(lp.mul(0.3))), keep).add(glint);
    },
    // → Melt : l'image coule, par colonnes, en filets ; le front luit comme la cire
    melt: () => {
      const x = uv.x.mul(U.aspect);
      const col = mx_noise_float(vec3(x.mul(3), 0.5, 0)).mul(0.5).add(0.5);
      const drip = pow(mx_noise_float(vec3(x.mul(10), 1.3, 0)).mul(0.5).add(0.5), 3);
      const disp = pow(p, 1.7).mul(float(1.1).add(col.mul(0.5)).add(drip.mul(0.9)));
      const src = uv.y.sub(disp).toVar(); // (le contenu descend : on lit plus haut)
      const a = A(vec2(uv.x, src));
      const inside = smoothstep(-0.006, 0.006, src);
      const soft = exp(src.negate().div(0.06)); // (près du front, la matière ramollit et luit)
      const wax = vec3(1.0, 0.82, 0.55);
      const aw = mix(a, a.mul(1.12).add(wax.mul(0.06)), soft);
      const sheen = exp(abs(src).negate().div(0.01)).mul(inside).mul(smoothstep(0.02, 0.15, p));
      return mix(B(uv), aw, inside).add(wax.mul(sheen.mul(0.55)));
    },
    // → Bolt : le traceur descend, l'arc frappe (éclair), la scène s'ouvre depuis le canal
    bolt: () => {
      const P = uv.mul(asp);
      const y = uv.y;
      const cx = U.aspect.mul(0.5).add(fbm(vec2(y.mul(2.2), 3.1), 0.7, 2).mul(0.2)).add(fbm(vec2(y.mul(11), 8.3), 1.9, 2).mul(0.035));
      const d0 = abs(P.x.sub(cx));
      const yb = float(0.42), side = float(1);
      const bx = cx.add(y.sub(yb).mul(0.55).mul(side)).add(fbm(vec2(y.mul(9), 4.4), 2.5, 2).mul(0.03));
      const d1 = select(y.greaterThan(yb), abs(P.x.sub(bx)), float(9));
      const lead = smoothstep(0, 0.3, p); // (le traceur, jusqu'à la frappe)
      const grown = float(1).sub(smoothstep(lead.mul(1.05).sub(0.02), lead.mul(1.05), y));
      const strike = exp(p.sub(0.34).div(0.035).pow(2).negate());
      const after = smoothstep(0.3, 0.36, p).mul(float(1).sub(smoothstep(0.36, 1, p)).mul(0.8).add(0.2));
      const core = exp(d0.negate().div(0.0035)).add(exp(d1.negate().div(0.0025)).mul(0.7));
      const halo = exp(d0.negate().div(0.04)).add(exp(d1.negate().div(0.03)).mul(0.5));
      const chan = core.mul(1.4).add(halo.mul(0.35)).mul(grown).mul(float(0.35).add(after.mul(1.6)).add(strike.mul(2)));
      const { m } = sweep(clamp(d0.mul(1.6), 0, 1), smoothstep(0.33, 0.95, p), 0.08);
      const blue = vec3(0.78, 0.84, 1.0);
      return mix(A(uv), B(uv), m).add(blue.mul(chan)).add(blue.mul(strike.mul(0.9)));
    },
    // → Caustic : les ondes viennent des bords vers le foyer
    ripple: () => {
      const d = uv.sub(0.5).mul(asp), r = length(d).toVar();
      const R = float(1).sub(p).mul(length(asp).mul(0.5).add(0.05));
      const delta = r.sub(R).toVar();
      const env = exp(abs(delta).negate().div(0.07));
      const wave = sin(delta.mul(95).sub(t.mul(7)));
      const dir = normalize(d.add(vec2(1e-5, 0))).div(asp);
      const off = dir.mul(wave.mul(env).mul(0.012));
      const m = smoothstep(-0.012, 0.012, delta);
      const lines = pow(max(wave, 0), 6).mul(env).mul(m);
      return mix(A(uv.add(off)), B(uv.add(off.mul(0.6))), m).add(vec3(1.0, 0.97, 0.86).mul(lines.mul(0.45)));
    },
    // → Kelp : une vague monte de bas en haut, ligne d'écume
    wave: () => {
      const x = uv.x.mul(U.aspect);
      const yl = float(1.18).sub(p.mul(1.42)).add(sin(x.mul(8).add(t.mul(1.4))).mul(0.03)).add(sin(x.mul(21).sub(t.mul(2.3))).mul(0.012));
      const delta = uv.y.sub(yl).toVar(); // (> 0 : sous la ligne d'eau)
      const m = smoothstep(-0.005, 0.005, delta);
      const refr = vec2(sin(uv.y.mul(55).add(t.mul(3))).mul(0.004), 0).mul(exp(delta.negate().div(0.25)));
      const foamN = mx_noise_float(vec3(uv.mul(asp).mul(38), t.mul(0.8))).mul(0.5).add(0.5);
      const foam = exp(abs(delta).negate().div(0.012)).mul(foamN.mul(0.5).add(0.5)).add(exp(delta.negate().div(0.05)).mul(m).mul(pow(foamN, 4)).mul(0.6));
      return mix(A(uv), B(uv.add(refr)), m).add(vec3(0.93, 0.96, 1.0).mul(foam.mul(0.75)));
    },
    // → Erosion : l'eau descend en rigoles ramifiées
    rivulets: () => {
      const P = uv.mul(asp);
      const warp = vec2(fbm(P.mul(2.5), 1.1), fbm(P.mul(2.5), 7.7)).mul(0.12);
      const ridge = float(1).sub(abs(mx_noise_float(vec3(P.add(warp).mul(vec2(7, 2.2)), 0.3))));
      const chan = pow(ridge, 7);
      const order = clamp(uv.y.mul(0.55).add(float(1).sub(chan).mul(0.4)).add(fbm(P.mul(9), 2.2).mul(0.04)), 0, 1);
      const { m, rim } = sweep(order, p, 0.05);
      const front = p.mul(1.1).sub(0.05);
      const wet = smoothstep(order.sub(0.22), order, front).mul(float(1).sub(m));
      return mix(A(uv).mul(float(1).sub(wet.mul(0.4))), B(uv), m).add(vec3(0.75, 0.86, 0.97).mul(rim.mul(0.3)));
    },
    // → Moss : la pierre fonce sous l'averse, des îlots verts naissent et se rejoignent
    // → Nest : des écailles de papier en coquille poussent rangée après rangée,
    // du haut vers le bas ; chacune s'étend de sa racine vers son bord libre,
    // bande par bande (la bande fraîche, sombre), et découvre le jour suivant
    scales: () => {
      const P = uv.mul(asp).mul(vec2(7, 9));
      const row = floor(P.y), off = fract(row.mul(0.5)).mul(1); // (rangées décalées d'une demi-écaille)
      const pick = (r) => {
        const x = P.x.add(fract(r.mul(0.5))), col = floor(x);
        const dx = fract(x).sub(0.5).mul(2), dy = P.y.sub(r).mul(0.95);
        const t = pow(pow(abs(dx), 2.6).add(pow(dy.max(0), 2.6)), 1 / 2.6);
        const id = mx_cell_noise_float(vec2(col, r));
        const order = clamp(r.div(9.5).mul(0.78).add(id.mul(0.14)), 0, 1);
        const g = clamp(p.mul(1.25).sub(order).div(0.2), 0, 1);
        return { t, g, in: step(t, g).mul(step(0, dy)) };
      };
      const up = pick(row.sub(1)), me = pick(row);
      const useUp = up.in;
      const t = mix(me.t, up.t, useUp), g = mix(me.g, up.g, useUp);
      const m = max(up.in, me.in);
      const band = fract(t.mul(11)), fresh = smoothstep(0.07, 0, g.sub(t)).mul(m);
      const stripe = smoothstep(0.0, 0.12, band).mul(smoothstep(1.0, 0.88, band)).mul(0.12).add(0.88);
      return mix(A(uv), B(uv).mul(mix(float(1), stripe, smoothstep(0.98, 0.6, p))).mul(float(1).sub(fresh.mul(0.35))), m);
    },
    moss: () => {
      const P = uv.mul(asp);
      const v = voronoi(P.mul(5));
      const blob = fbm(P.mul(3.5), 0.4).mul(0.5).add(0.5);
      const order = clamp(v.F1.mul(0.5).add(blob.mul(0.5)), 0, 1);
      const { m, rim } = sweep(order, smoothstep(0.15, 1, p), 0.07);
      const rain = smoothstep(0, 0.3, p).mul(float(1).sub(m));
      return mix(A(uv).mul(float(1).sub(rain.mul(0.32))), B(uv), m).add(vec3(0.32, 0.58, 0.14).mul(rim.mul(0.55)));
    },
    // → Spore : spores posées, gouttelettes qui grossissent et fusionnent,
    // réseau jaune du plasmode entre elles
    spore: () => {
      const P = uv.mul(asp);
      const v = voronoi(P.mul(13));
      const r = pow(p, 1.25).mul(0.95);
      const m = float(1).sub(smoothstep(r.sub(0.035), r.add(0.035), v.F1));
      const yellow = vec3(1.0, 0.8, 0.12);
      const dust = exp(v.F1.negate().div(0.018)).mul(smoothstep(0, 0.12, p)).mul(float(1).sub(m));
      const rim = exp(abs(v.F1.sub(r)).negate().div(0.02)).mul(float(1).sub(smoothstep(0.75, 1, p)));
      const vv = voronoi(P.mul(4.5));
      const vein = float(1).sub(smoothstep(0, 0.035, vv.edge)).mul(smoothstep(0.15, 0.45, p)).mul(float(1).sub(smoothstep(0.7, 1, p)));
      // (une gouttelette est du plasmode : un voile jaune translucide, qui
      // s'efface quand la scène suivante a pris toute la place)
      const b = B(uv), film = float(1).sub(smoothstep(0.45, 1, p)).mul(0.6);
      const drop = mix(b, yellow.mul(clamp(dot(b, LUMA), 0.2, 1).mul(0.9).add(0.25)), film);
      return mix(A(uv), drop, m).add(yellow.mul(dust.mul(0.9).add(rim.mul(0.55)).add(vein.mul(0.35))));
    },
    // → Feather : le rachis traverse l'image en diagonale, les barbes s'ouvrent
    // de part et d'autre, en mèches
    feather: () => {
      const P = uv.mul(asp);
      const x = P.x.div(U.aspect);
      const ry = float(1.05).sub(x.mul(0.95)).add(x.mul(x).mul(0.25)); // (le rachis, du bas à gauche au haut à droite)
      const d = abs(uv.y.sub(ry)).mul(0.82);
      const along = x.mul(U.aspect).add(uv.y.sub(ry).mul(0.4).mul(select(uv.y.greaterThan(ry), float(1), float(-1))));
      const barb = fract(along.mul(70).add(d.mul(25)).add(fbm(P.mul(3), 2.3).mul(1.5)));
      const strand = smoothstep(0.0, 0.5, barb).mul(smoothstep(1.0, 0.5, barb));
      const order = clamp(d.mul(1.35).add(strand.sub(0.5).mul(0.07)).add(fbm(P.mul(5), 6.1).mul(0.04)), 0, 1);
      const { m, rim } = sweep(order, p, 0.05);
      const shaft = exp(d.negate().div(0.004)).mul(smoothstep(0, 0.15, p)).mul(float(1).sub(smoothstep(0.7, 1, p)));
      const down = vec3(0.96, 0.94, 0.9);
      return mix(A(uv), B(uv), m).add(down.mul(rim.mul(strand).mul(0.45).add(shaft.mul(0.7))));
    },
    // → Cocoon : fils de soie enroulés, presque horizontaux, qui recouvrent
    // l'image un à un en portant la lumière
    cocoon: () => {
      const P = uv.mul(asp);
      const q = uv.y.mul(70).add(P.x.mul(7)).add(fbm(P.mul(1.8), 3.3).mul(2.2));
      const band = floor(q), fq = fract(q);
      const r = mx_cell_noise_float(vec2(band, 7));
      const order = clamp(r.mul(0.65).add(uv.y.mul(0.35)), 0, 1);
      const { m, rim } = sweep(order, p, 0.04);
      const thread = smoothstep(0.3, 0.5, fq).mul(smoothstep(0.7, 0.5, fq));
      const silk = vec3(1.0, 0.86, 0.62);
      // (une bande qui vient d'être couverte est d'abord du fil : son éclat,
      // puis la scène suivante)
      const fresh = rim.mul(0.85);
      const base = mix(mix(A(uv), B(uv), m), silk.mul(thread.mul(0.4).add(0.45)), fresh);
      return base.add(silk.mul(thread.mul(rim).mul(0.6)));
    },
    // → Tangle : l'image se tord autour du centre ; la suivante arrive tordue
    // et se détord
    twist: () => {
      const d = uv.sub(0.5).mul(asp), r = length(d);
      const fall = exp(r.mul(-2.2));
      const rot = (a) => { const c = cos(a), s2 = sin(a); return vec2(d.x.mul(c).sub(d.y.mul(s2)), d.x.mul(s2).add(d.y.mul(c))).div(asp).add(0.5); };
      const aOut = p.mul(p).mul(7).mul(fall), aIn = float(1).sub(p).pow(2).mul(-7).mul(fall);
      const m = smoothstep(0.3, 0.7, p.add(float(0.5).sub(r).mul(0.35)));
      return mix(A(rot(aOut)), B(rot(aIn)), m);
    },
    // → Tension : des câbles tendus découpent l'image en panneaux, qui
    // s'ouvrent un à un ; les câbles brillent
    cables: () => {
      const P = uv.mul(asp);
      const L = [[0.12, 0.9, 0.31], [1.21, 0.2, 0.55], [2.05, 0.6, 0.42], [0.67, 0.35, 0.6], [2.6, 0.8, 0.52], [1.7, 0.55, 0.38], [0.35, 0.1, 0.5]];
      let id = float(0), near = float(9);
      L.forEach(([ang, ox, oy], k) => {
        const n = vec2(Math.cos(ang), Math.sin(ang));
        const sd = dot(P.sub(vec2(U.aspect.mul(ox), oy)), n);
        id = id.add(step(0, sd).mul(2 ** k));
        near = min(near, abs(sd));
      });
      const order = clamp(mx_cell_noise_float(vec2(id, 3)).mul(0.85).add(uv.y.mul(0.1)), 0, 1);
      const { m } = sweep(order, smoothstep(0.12, 1, p), 0.03);
      const taut = smoothstep(0, 0.15, p).mul(float(1).sub(smoothstep(0.75, 1, p)));
      const line = exp(near.negate().div(0.0016)).mul(taut);
      return mix(A(uv), B(uv), m).add(vec3(0.86, 0.89, 0.94).mul(line.mul(0.9)));
    },
    // → Rust : la rouille fleurit sur l'image, puis s'écaille en plaques
    rust: () => {
      const P = uv.mul(asp);
      const blob = fbm(P.mul(2.6), 4.2).mul(0.5).add(0.5);
      const grow = smoothstep(blob.sub(0.12), blob, p.mul(1.7));
      const tone = fbm(P.mul(18), 1.7).mul(0.5).add(0.5);
      const rustC = mix(vec3(0.36, 0.12, 0.04), vec3(0.78, 0.4, 0.13), tone);
      const a = A(uv);
      const aR = mix(a, rustC.mul(clamp(dot(a, LUMA), 0.25, 1).mul(1.2)), grow.mul(0.85));
      const v = voronoi(P.mul(8));
      const order = clamp(v.id.mul(0.5).add(blob.mul(0.5)), 0, 1);
      const { m, rim } = sweep(order, smoothstep(0.35, 1, p), 0.05);
      return mix(aR, B(uv), m).mul(float(1).sub(rim.mul(0.55)));
    },
    // → Membrane : un voile veiné couvre l'image, se tend, puis se déchire en
    // lambeaux depuis le centre
    membrane: () => {
      const P = uv.mul(asp);
      const d = uv.sub(0.5).mul(asp), r = length(d);
      const veil = smoothstep(0, 0.35, p).mul(float(1).sub(smoothstep(0.45, 0.95, p).mul(0)));
      const vv = voronoi(P.mul(6).add(vec2(fbm(P.mul(2), 1.3), fbm(P.mul(2), 4.1)).mul(0.6)));
      const vein = float(1).sub(smoothstep(0, 0.05, vv.edge));
      const order = clamp(r.mul(1.25).add(fbm(P.mul(4), 2.7).mul(0.12)).add(vein.mul(0.08)), 0, 1);
      const { m, rim } = sweep(order, smoothstep(0.4, 1, p), 0.04);
      const skin = vec3(0.86, 0.78, 0.74), red = vec3(0.55, 0.16, 0.14);
      const a = A(uv.add(d.mul(smoothstep(0.2, 0.5, p).mul(-0.04))));
      const veiled = mix(a, mix(skin, red, vein.mul(0.8)).mul(clamp(dot(a, LUMA), 0.2, 1).add(0.25)), veil.mul(0.55).mul(float(1).sub(m)));
      return mix(veiled, B(uv), m).add(skin.mul(rim.mul(0.4)));
    },
    // → Fold : des plis traversent l'image ; chaque panneau se rabat (il se
    // resserre vers son pli, s'ombre, puis découvre la scène suivante)
    fold: () => {
      const P = uv.mul(asp);
      const L = [[0.6, 0.45, 0.5], [2.2, 0.55, 0.5], [1.15, 0.3, 0.3], [2.75, 0.7, 0.62]];
      let id = float(0), near = float(9);
      L.forEach(([ang, ox, oy], k) => {
        const n = vec2(Math.cos(ang), Math.sin(ang));
        const sd = dot(P.sub(vec2(U.aspect.mul(ox), oy)), n);
        id = id.add(step(0, sd).mul(2 ** k));
        near = min(near, abs(sd));
      });
      const r = mx_cell_noise_float(vec2(id, 9));
      const lp = clamp(p.mul(1.6).sub(r.mul(0.6)), 0, 1);
      const shade = float(1).sub(lp.mul(0.6)).mul(float(1).add(smoothstep(0.02, 0.0, near).mul(0.4).mul(lp)));
      const m = smoothstep(0.55, 0.75, lp);
      const crease = exp(near.negate().div(0.003)).mul(smoothstep(0, 0.2, p)).mul(float(1).sub(smoothstep(0.8, 1, p)));
      return mix(A(uv).mul(shade), B(uv), m).add(vec3(1, 0.97, 0.9).mul(crease.mul(0.5)));
    },
    // → Pendulum : un balancier pendu au milieu du haut ; son ombre balaie
    // l'image d'un bord à l'autre en s'amortissant, chaque passage découvre
    // un secteur de plus
    swing: () => {
      const d = uv.sub(vec2(0.5, -0.05)).mul(asp);
      const ang = d.x.div(max(d.y, 1e-3)).atan(); // (angle depuis la verticale, −π/2…π/2)
      const amp = float(1.2).mul(float(1).sub(p.mul(0.55)));
      const arm = sin(p.mul(Math.PI * 3.5)).mul(amp); // (où est le balancier)
      const opened = smoothstep(0.1, 0.95, p).mul(1.65); // (demi-angle déjà découvert)
      const m = smoothstep(opened.add(0.04), opened.sub(0.04), abs(ang));
      const rod = exp(abs(ang.sub(arm)).negate().div(0.006)).mul(float(1).sub(smoothstep(0.85, 1, p)));
      const bob = exp(length(d.sub(vec2(sin(arm), cos(arm)).mul(0.75))).negate().div(0.02)).mul(float(1).sub(smoothstep(0.85, 1, p)));
      return mix(A(uv), B(uv), m).add(vec3(0.9, 0.88, 0.82).mul(rod.mul(0.6).add(bob.mul(0.8))));
    },
    // → Labyrinth : l'ouverture avance dans les couloirs d'un dédale
    maze: () => {
      const P = uv.mul(asp).mul(9);
      const c = floor(P), f = fract(P);
      const r = mx_cell_noise_float(c);
      // (un mur par cellule, d'un côté tiré au hasard : un dédale de « 10 PRINT »)
      const diag = select(r.greaterThan(0.5), abs(f.x.sub(f.y)), abs(f.x.add(f.y).sub(1)));
      const wall = float(1).sub(smoothstep(0.04, 0.09, diag));
      // (les deux moitiés d'une case, de part et d'autre du mur, s'ouvrent
      // chacune à son tour : l'ouverture suit les couloirs, pas les cases)
      const side = select(r.greaterThan(0.5), step(f.y, f.x), step(1, f.x.add(f.y)));
      const half = mx_cell_noise_float(c.mul(2).add(vec2(side, 17)));
      const order = clamp(length(c.add(0.5).div(9).sub(vec2(0, 1))).mul(0.6).add(half.mul(0.25)), 0, 1);
      const { m, rim } = sweep(order, p, 0.03);
      const lit = smoothstep(0, 0.2, p).mul(float(1).sub(smoothstep(0.8, 1, p)));
      return mix(A(uv), B(uv), m).mul(float(1).sub(wall.mul(lit).mul(0.45))).add(vec3(0.95, 0.85, 0.6).mul(rim.mul(0.35)));
    },
    // → Echo : l'éclair part d'un point, son front avance en anneau et laisse
    // la scène suivante derrière lui
    flash: () => {
      const d = uv.sub(vec2(0.32, 0.4)).mul(asp), r = length(d);
      const R = p.mul(length(asp).mul(1.05));
      const delta = r.sub(R);
      const m = smoothstep(0.01, -0.01, delta);
      const front = exp(abs(delta).negate().div(0.012)).mul(float(1).sub(smoothstep(0.85, 1, p)));
      const glow = exp(p.div(0.04).negate()).mul(0.6); // (l'éclair lui-même, au départ)
      const echo = exp(abs(r.sub(R.mul(0.6))).negate().div(0.006)).mul(0.25).mul(float(1).sub(smoothstep(0.7, 1, p))); // (un écho, plus loin derrière)
      return mix(A(uv), B(uv), m).add(vec3(1.0, 0.97, 0.9).mul(front.mul(1.1).add(glow).add(echo)));
    },
    // → Mirage : l'image s'enfonce vers l'ouverture du mirascope ; la scène
    // suivante y apparaît, net, et l'ouverture s'élargit
    mirror: () => {
      const d = uv.sub(0.5).mul(asp), r = length(d);
      const hole = pow(p, 1.4).mul(length(asp).mul(0.55));
      const pull = smoothstep(0, 1, p).mul(0.35).mul(exp(r.mul(-2)));
      const a = A(uv.sub(d.div(asp).mul(pull.negate())));
      const m = smoothstep(hole.add(0.008), hole.sub(0.008), r);
      const lip = exp(abs(r.sub(hole)).negate().div(0.01)).mul(float(1).sub(smoothstep(0.9, 1, p)));
      const silver = vec3(0.9, 0.92, 0.95);
      return mix(a.mul(float(1).sub(pull)), B(uv), m).add(silver.mul(lip.mul(0.7)));
    },
    // → Hollow : la caméra plonge dans une alvéole ; l'image se dilate autour
    // d'elle, et la scène suivante remplit le trou qui s'élargit
    dive: () => {
      const d = uv.sub(0.5);
      const z = pow(p, 2).mul(5).add(1); // (zoom vers le centre)
      const a = A(d.div(z).add(0.5));
      const r = length(d.mul(asp));
      const hole = pow(p, 1.8).mul(length(asp).mul(0.6));
      const m = smoothstep(hole.add(0.02), hole.sub(0.02), r);
      const rimDark = exp(abs(r.sub(hole)).negate().div(0.03)).mul(float(1).sub(smoothstep(0.85, 1, p)));
      return mix(a.mul(float(1).sub(rimDark.mul(0.7))), B(d.mul(float(1).add(float(1).sub(p).mul(0.3))).add(0.5)), m);
    },
    // → Tesseract : des carrés pivotent sur leurs arêtes ; chacun se referme
    // (il s'amincit, s'ombre) puis s'ouvre sur la scène suivante
    unfold: () => {
      const P = uv.mul(asp).mul(5);
      const c = floor(P), f = fract(P);
      const order = clamp(abs(c.x.sub(U.aspect.mul(2.5))).add(abs(c.y.sub(2.5))).div(U.aspect.mul(2.5).add(2.5)).mul(0.8).add(mx_cell_noise_float(c).mul(0.2)), 0, 1);
      const lp = clamp(p.mul(1.5).sub(order.mul(0.5)), 0, 1);
      const ang = lp.mul(Math.PI); // (demi-tour autour de l'arête gauche)
      const w = abs(cos(ang)); // (largeur apparente)
      const showB = lp.greaterThan(0.5);
      const inside = f.x.lessThan(w);
      const fx = f.x.div(max(w, 1e-3));
      const src = c.add(vec2(fx, f.y)).div(5).div(asp);
      const face = select(showB, B(src), A(src)).mul(float(0.55).add(w.mul(0.45)));
      const behind = select(showB, A(uv), B(uv)); // (derrière le carré qui tourne)
      return select(inside, face, select(showB, B(uv), A(uv)).mul(0.6)).add(vec3(0.8, 0.85, 1).mul(smoothstep(0.03, 0, min(f.x, f.y)).mul(0.25).mul(lp.mul(float(1).sub(lp)).mul(4)))).add(behind.mul(0));
    },
    // → Orrery : trois corps parcourent un huit (la chorégraphie de Moore) ;
    // leurs traînées ouvrent l'image
    orbit: () => {
      const P = uv.sub(0.5).mul(asp);
      const near = float(9).toVar(), trail = float(9).toVar();
      // la lemniscate x = a sin t, y = a sin t cos t, échantillonnée
      const S = 48;
      for (let i = 0; i < S; i++) {
        const t = (i / S) * Math.PI * 2;
        const q = vec2(Math.sin(t) * 0.62, Math.sin(t) * Math.cos(t) * 0.42).mul(vec2(U.aspect.mul(0.75), 1));
        const dd = length(P.sub(q));
        trail.assign(min(trail, dd));
        // (les trois corps, à un tiers de tour l'un de l'autre, avancent avec p)
        for (let k = 0; k < 3; k++) {
          if (i !== 0) break;
          const tb = p.mul(Math.PI * 4).add((k * Math.PI * 2) / 3);
          const b = vec2(sin(tb).mul(0.62), sin(tb).mul(cos(tb)).mul(0.42)).mul(vec2(U.aspect.mul(0.75), 1));
          near.assign(min(near, length(P.sub(b))));
        }
      }
      const order = clamp(trail.mul(1.6), 0, 1);
      const { m, rim } = sweep(order, p, 0.05);
      const body = exp(near.negate().div(0.012)).mul(float(1).sub(smoothstep(0.85, 1, p)));
      const path = exp(trail.negate().div(0.003)).mul(smoothstep(0, 0.15, p)).mul(float(1).sub(smoothstep(0.7, 1, p)));
      const gold = vec3(1.0, 0.86, 0.55);
      return mix(A(uv), B(uv), m).add(gold.mul(body.mul(1.2).add(path.mul(0.35)).add(rim.mul(0.25))));
    },
  };
  T.fade = () => mix(A(uv), B(uv), p);

  return {
    U, kinds: Object.keys(T),
    build: (kind) => vec4(Fn(() => (T[kind] ?? T.fade)())(), 1),
  };
}
