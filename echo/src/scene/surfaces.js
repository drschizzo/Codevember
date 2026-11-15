// Les matières de la pièce (TSL). Une matière de la recette (recipe.js, MATS)
// devient un MeshPhysicalNodeMaterial : couleur, rugosité et relief calculés
// au pixel dans le repère du monde (tout est immobile, sauf le cordon et la
// boule, qui ont leurs propres matières), à partir du volume de bruit commun.
//
// Les motifs fins (fil du lin, joints, fil du bois) s'effacent avant la
// fréquence du pixel (fwidth), sinon ils moirent.
import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, positionWorld, positionGeometry, normalViewGeometry, faceDirection, attribute,
  mix, smoothstep, abs, sin, cos, fract, floor, min, max, length, fwidth, clamp, step, pow, dot, normalize, atan,
} from 'three/tsl';
import { noise, noise2, fbm, perturb, NZ } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';

const col = (h) => { const c = new THREE.Color(h); return vec3(c.r, c.g, c.b); };
// atténuation d'un motif de fréquence f (cycles par mètre) avant le pixel
const aa = (p, f) => smoothstep(0.35, 0.1, length(fwidth(p)).mul(f));
const hash = (x) => fract(sin(x.mul(127.1).add(311.7)).mul(43758.5453));

// relief → normale (Mikkelsen) dans le sens de la face
const bump = (H) => perturb(H.mul(G.microDetail), normalViewGeometry.mul(faceDirection));

export function surfaceMaterial(S, opts = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: opts.side ?? THREE.FrontSide });
  const p = (opts.local ? positionGeometry : positionWorld).add(vec3(...(opts.offset ?? [0, 0, 0])));
  const c1 = col(S.color), c2 = col(S.color2);
  let color = c1, rough = float(S.rough), H = float(0);
  const sc = float(S.scale);
  switch (S.kind) {
    case 'plaster': {
      const n = fbm(p.mul(2.2), 4).mul(0.5).add(0.5);
      color = mix(c2, c1, smoothstep(0.25, 0.75, n));
      H = fbm(p.mul(30), 3).mul(0.0004).add(noise2(p.mul(260)).mul(0.00006).mul(aa(p, 260)));
      rough = rough.add(noise(p.mul(9)).mul(0.05));
      break;
    }
    case 'paint': case 'panel': {
      const n = fbm(p.mul(1.4), 3).mul(0.5).add(0.5);
      color = mix(c2, c1, smoothstep(0.2, 0.8, n));
      // peau d'orange du pinceau, coulures verticales très douces
      H = noise2(p.mul(vec3(320, 90, 320))).mul(0.00004).mul(aa(p, 320)).add(noise(p.mul(vec3(14, 2, 14))).mul(0.00015));
      rough = rough.add(noise(p.mul(6)).mul(0.06));
      break;
    }
    case 'lacquer': {
      const n = fbm(p.mul(1.8), 3).mul(0.5).add(0.5);
      color = mix(c2, c1, smoothstep(0.15, 0.85, n));
      H = noise2(p.mul(180)).mul(0.00003).mul(aa(p, 180));
      m.clearcoatNode = float(S.clearcoat);
      m.clearcoatRoughnessNode = float(0.04).add(noise(p.mul(5)).mul(0.03).abs());
      break;
    }
    case 'velvet': {
      const n = fbm(p.mul(vec3(3, 9, 3)), 3).mul(0.5).add(0.5);
      color = mix(c2, c1, n);
      m.sheenNode = vec3(0.25, 0.25, 0.28).mul(S.sheen).mul(n.mul(0.6).add(0.7));
      m.sheenRoughnessNode = float(0.35);
      H = noise2(p.mul(500)).mul(0.00008).mul(aa(p, 500));
      break;
    }
    case 'tile': { // faïence ou tomette : carreaux de côté scale, joints en creux
      const q = (opts.floor ? vec2(p.x, p.z) : vec2(p.x, p.y)).div(sc);
      const cell = floor(q), f = fract(q);
      const e = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(sc); // distance au joint (m)
      const groove = smoothstep(0.0012, 0.0045, e); // (0 dans le joint, 1 sur l'émail)
      const tint = hash(cell.x.add(cell.y.mul(17.3)));
      color = mix(c2.mul(0.55), mix(c1, c1.mul(0.93), tint), groove);
      rough = mix(float(0.85), rough.add(tint.mul(0.08)), groove);
      // émail bombé : le carreau est un coussin, le joint un creux
      H = groove.mul(0.0012).add(smoothstep(0.0, 0.02, e).mul(0.0006)).add(noise2(p.mul(140)).mul(0.00004));
      if (S.clearcoat) { m.clearcoatNode = groove.mul(S.clearcoat); m.clearcoatRoughnessNode = float(0.03); }
      break;
    }
    case 'wood': { // fil du bois le long de x ; planches si opts.boards
      // (planches : le fil court le long de z, les joints sont parallèles à z)
      let q = p, plank = float(0), gap = float(1);
      if (opts.boards) {
        const w = float(0.145);
        plank = hash(floor(p.x.div(w)));
        const fx = fract(p.x.div(w)).mul(w);
        gap = smoothstep(0.0, 0.0018, fx).mul(smoothstep(0.0, 0.0018, w.sub(fx)));
        q = vec3(p.z, p.y, p.x).add(vec3(plank.mul(13.1), 0, 0));
      }
      const warp = fbm(q.mul(vec3(1.5, 6, 6)).mul(sc), 3);
      const rings = sin(q.z.mul(60).mul(sc).add(q.y.mul(40)).add(warp.mul(9))).mul(0.5).add(0.5);
      const fine = noise2(q.mul(vec3(4, 260, 260)).mul(sc)).mul(0.5).add(0.5).mul(aa(q, 260));
      const g = smoothstep(0.2, 0.9, rings).mul(0.7).add(fine.mul(0.3));
      color = mix(c1, c2, g).mul(plank.mul(0.16).add(0.92)).mul(gap.mul(0.85).add(0.15));
      H = gap.mul(0.0012).add(fine.mul(0.00008)).add(rings.mul(0.00012));
      rough = rough.add(g.mul(0.08)).sub(plank.mul(0.04));
      if (S.clearcoat) { m.clearcoatNode = float(S.clearcoat); m.clearcoatRoughnessNode = float(0.12); }
      break;
    }
    case 'linen': {
      const fx = sin(p.x.mul(2 * Math.PI * 420)), fz = sin(p.z.mul(2 * Math.PI * 420));
      const weave = fx.mul(fz).mul(0.5).add(0.5).mul(aa(p, 420));
      const slub = smoothstep(0.55, 0.95, noise(p.mul(vec3(2, 2, 90))).mul(0.5).add(0.5));
      const n = fbm(p.mul(3), 3).mul(0.5).add(0.5);
      color = mix(c2, c1, n.mul(0.7).add(weave.mul(0.2))).mul(slub.mul(0.06).add(0.97));
      H = weave.mul(0.00012).add(noise(p.mul(18)).mul(0.0006));
      m.sheenNode = vec3(0.12).mul(S.sheen);
      m.sheenRoughnessNode = float(0.5);
      break;
    }
    case 'marble': {
      // fond nuageux, puis des veines « en crête » (1 − |n| à une forte
      // puissance) lues à travers une déformation : fines et nettes, de
      // largeurs variées, interrompues par un masque ; quelques veines larges
      // et pâles en dessous (la profondeur de la pierre)
      const q = p.add(vec3(fbm(p.mul(1.7), 4), fbm(p.mul(1.7).add(5.2), 4), 0).mul(0.22));
      const cloud = fbm(p.mul(3.1).add(11), 4).mul(0.5).add(0.5);
      const fine = pow(float(1).sub(abs(noise(q.mul(vec3(5, 5, 5))))), 44);
      const mid = pow(float(1).sub(abs(noise(q.mul(2.3).add(3.7)))), 18);
      const mask = smoothstep(-0.25, 0.35, noise(p.mul(2.2).add(8)));
      const vein = fine.mul(mask).mul(0.85).add(mid.mul(0.35)).clamp(0, 1);
      const base = mix(c1.mul(0.93), c1, cloud).mul(fbm(p.mul(28), 2).mul(0.025).add(1));
      color = mix(base, c2, vein.mul(0.8));
      rough = rough.add(vein.mul(0.08));
      H = vein.mul(-0.00002);
      if (S.clearcoat) { m.clearcoatNode = float(S.clearcoat); m.clearcoatRoughnessNode = float(0.025).add(cloud.mul(0.03)); }
      break;
    }
    case 'metal': {
      const n = fbm(p.mul(20), 3).mul(0.5).add(0.5);
      color = mix(c1, c2, smoothstep(0.55, 0.95, n).mul(0.3));
      rough = rough.add(n.mul(0.06));
      m.metalnessNode = float(1);
      H = noise2(p.mul(400)).mul(0.00002).mul(aa(p, 400));
      break;
    }
    case 'bakelite': case 'glaze': {
      color = mix(c1, c2, fbm(p.mul(30), 2).mul(0.5).add(0.5).mul(0.3));
      if (S.clearcoat) { m.clearcoatNode = float(S.clearcoat); m.clearcoatRoughnessNode = float(0.04); }
      break;
    }
    default: break;
  }
  // ronds laissés par des verres et des pots (plateau de table)
  if (opts.stains) {
    let st = float(0);
    for (const [x, z, r] of opts.stains) {
      const d = length(vec2(p.x.sub(x), p.z.sub(z)));
      const arc = smoothstep(-0.2, 0.4, noise(vec3(p.x.mul(30), p.z.mul(30), x * 9)));
      st = st.max(smoothstep(0.0025, 0.0, abs(d.sub(r))).mul(arc).mul(step(abs(p.y), float(0.002))));
    }
    color = color.mul(float(1).sub(st.mul(0.28)));
    rough = rough.add(st.mul(0.15));
  }
  // usure des arêtes : la sous-couche paraît là où le relief saille (rôle
  // « tranche » des moulures) et par plaques
  if (opts.wear) {
    const edge = attribute('surf', 'vec4').z;
    const wv = smoothstep(0.78, 0.9, fbm(p.mul(38), 3).mul(0.5).add(0.5).add(edge.mul(0.18)));
    color = mix(color, col(opts.wear), wv);
    rough = mix(rough, float(0.62), wv);
    if (m.metalnessNode) m.metalnessNode = m.metalnessNode.mul(float(1).sub(wv));
    else m.metalnessNode = float(S.metal).mul(float(1).sub(wv));
  }
  m.colorNode = vec4(opts.tint ? color.mul(opts.tint) : color, 1);
  m.roughnessNode = rough.clamp(0.04, 1);
  if (!m.metalnessNode) m.metalnessNode = float(S.metal);
  if (!opts.flat) m.normalNode = bump(H);
  return m;
}

// Céramiques de la nature morte. Un seul matériau pour tous les vases : la
// couleur, la rugosité, l'émail et la forme passent par des attributs ; le
// centre et la hauteur du vase (vc) donnent l'angle et la hauteur relative.
// - tournage : des rides horizontales au pas de 4 à 7 mm, qui ondulent ;
// - émail (cr.y = 1) : son épaisseur fait sa couleur. Il coule en traînées
//   verticales, s'amasse en bourrelet au-dessus du pied, s'amincit sur la
//   lèvre et les arêtes où la terre transparaît ; il s'arrête à 1 cm du sol
//   sur une ligne irrégulière : le pied est en terre nue, mate ;
// - piqûres de fer (points sombres), craquelure sur un vase sur trois ;
// - mat (cr.y = 0) : une peinture poudrée à la Morandi, marbrée, aux traces
//   de pinceau horizontales, avec un velouté de poussière.
export function ceramicMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry;
  const c = attribute('col', 'vec3'), cr = attribute('cr', 'vec4'), vc = attribute('vc', 'vec3');
  const surf = attribute('surf', 'vec4');
  const glazed = cr.y, v = cr.z, seed = v.mul(37.1);
  const inner = surf.y, lip = surf.z;
  const rel = vec2(p.x.sub(vc.x), p.z.sub(vc.y));
  const ang = atan(rel.y, rel.x);
  const ring = vec3(cos(ang), sin(ang), 0); // (l'angle sans couture)
  const yh = p.y.div(vc.z.max(0.01)).clamp(0, 1);
  // tournage
  const pitch = mix(float(0.004), float(0.007), v);
  const wob = noise(ring.mul(2).add(vec3(seed, p.y.mul(30), 0))).mul(0.0016);
  const ridge = sin(p.y.add(wob).div(pitch).mul(2 * Math.PI));
  // (amplitude qui varie d'un vase et d'une hauteur à l'autre : un tourneur
  // n'efface pas ses traces partout pareil)
  const amp = smoothstep(-0.3, 0.6, noise(vec3(seed, p.y.mul(9), 0))).mul(mix(float(0.15), float(1), fract(v.mul(3.7))));
  const throwH = ridge.mul(0.00006).mul(amp).mul(smoothstep(0.02, 0.1, yh)).mul(float(1).sub(inner.mul(0.6)));
  // émail
  const footLine = float(0.009).add(noise(ring.mul(3).add(seed)).mul(0.004));
  const onGlaze = smoothstep(footLine, footLine.add(0.0012), p.y).max(inner);
  const drip = smoothstep(0.1, 0.75, noise(vec3(ring.x.mul(5).add(seed), ring.y.mul(5), p.y.mul(3.5))).mul(0.5).add(0.5));
  const bead = smoothstep(footLine.add(0.018), footLine.add(0.002), p.y).mul(0.7);
  const thick = float(0.45).add(drip.mul(0.55).mul(float(1).sub(yh).mul(0.8).add(0.2))).add(bead).mul(float(1).sub(lip.mul(0.75))).clamp(0, 1.4);
  const clay = mix(vec3(0.48, 0.38, 0.29), vec3(0.62, 0.58, 0.52), fract(v.mul(7.3)));
  const gl = c.mul(mix(float(1.18), float(0.72), thick.clamp(0, 1))).mul(pow(c, vec3(0.25)).mul(thick.mul(0.2)).add(1).sub(thick.mul(0.2)));
  const glazeCol = mix(clay.mul(0.9), gl, smoothstep(0.05, 0.35, thick));
  // piqûres de fer et craquelure
  const pk = noise2(p.mul(820).add(seed)).mul(0.5).add(0.5);
  const speck = smoothstep(0.86, 0.9, pk).mul(aa(p, 820));
  const crackOn = step(0.68, v).mul(glazed);
  // (Worley lu dans le volume de bruit commun, F2 − F1 : le calcul exact sur 27
  // cellules allongeait la compilation de plusieurs dizaines de secondes)
  const crack = smoothstep(0.07, 0.0, NZ(p.mul(40).add(seed)).w).mul(crackOn).mul(aa(p, 160));
  // mat poudré (Morandi) : marbrure, traces de pinceau horizontales
  const mott = fbm(p.mul(16).add(seed), 3).mul(0.5).add(0.5);
  const brush = noise2(vec3(ring.x.mul(40), p.y.mul(900), ring.y.mul(40)).add(seed)).mul(0.5).add(0.5).mul(aa(p, 900));
  const matte = c.mul(mott.mul(0.12).add(0.94)).mul(brush.mul(0.05).add(0.975));
  let col = mix(matte, glazeCol, glazed);
  col = mix(clay, col, onGlaze.max(float(1).sub(glazed).mul(smoothstep(0.003, 0.006, p.y))));
  col = col.mul(float(1).sub(speck.mul(0.55))).mul(float(1).sub(crack.mul(0.4)));
  m.colorNode = vec4(col.mul(inner.mul(-0.4).add(1)), 1);
  const gRough = mix(float(0.32), float(0.1), thick.clamp(0, 1));
  m.roughnessNode = mix(cr.x.add(mott.mul(0.06)), gRough, glazed.mul(onGlaze)).add(speck.mul(0.2)).clamp(0.05, 1);
  m.metalnessNode = float(0);
  m.clearcoatNode = glazed.mul(onGlaze).mul(thick.mul(0.4).add(0.6)).mul(float(1).sub(inner.mul(0.5)));
  m.clearcoatRoughnessNode = float(0.03).add(drip.mul(0.03)).add(crack.mul(0.2));
  m.sheenNode = vec3(0.16, 0.155, 0.15).mul(float(1).sub(glazed));
  m.sheenRoughnessNode = float(0.6);
  const H = throwH.add(drip.mul(0.0001).mul(glazed)).add(bead.mul(0.0004).mul(glazed))
    .sub(speck.mul(0.00008)).sub(crack.mul(0.00003)).add(brush.mul(0.00002).mul(float(1).sub(glazed)));
  m.normalNode = bump(H);
  return m;
}
