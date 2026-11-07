// Matériaux des coquilles (TSL, MeshPhysicalNodeMaterial).
//
// Une coquille porte trois finitions — face externe, face interne, tranche
// (parois des trous et biseaux) — désignées par l'attribut `surf` du
// maillage. Chaque pixel n'évalue que la finition de sa face (une branche,
// cohérente par triangle) ; ses propriétés sont rassemblées dans une
// structure partagée par tous les canaux du modèle physique.
//
// Les motifs sont procéduraux, en coordonnées de la coquille (donc le même
// grain à toutes les échelles de la plongée), mais ne calculent aucun bruit :
// ils échantillonnent un volume de bruit périodique précalculé (Perlin ×2,
// Worley F1 et F2−F1 ; voir gen/noisevol.js) — l'essentiel du coût d'un
// matériau procédural tient dans un accès mémoire.
//
// Tous les réglages sont des uniformes : les modifier ne recompile rien. Seuls
// le choix d'un motif et l'activation d'une fonction du modèle physique
// (vernis, lustre, irisation, anisotropie, transmission, usure) recompilent :
// voir `signature()`.
//
// Anticrénelage des motifs : chaque détail est atténué quand sa fréquence
// approche celle des pixels (empreinte du pixel en coordonnées locales).

import * as THREE from 'three/webgpu';
import {
  Fn, If, struct, uniform, attribute, positionLocal, normalLocal, positionWorld, positionView, normalView, vec2, vec3, vec4,
  float, mat3, mix, smoothstep, clamp, abs, length, normalize, dot, cross, sin, floor, fract, mod, step, acos, sign,
  dFdx, dFdy, fwidth, faceDirection, mrt, normalViewGeometry, positionGeometry, velocity, transformNormalToView, cos, max as tmax, texture3D, mx_cell_noise_vec3, modelViewMatrix, modelScale, cameraPosition,
} from 'three/tsl';
import { FINISH_KEYS } from '../finishes.js';
import { NOISE_PERIOD } from '../gen/noisevol.js';
import { tpmsParams } from '../gen/tpms.js';
import { rigPosition, rigBev, rigRadial } from './rig.js';

const PI = Math.PI;

// ── Uniformes partagés par toute la scène ────────────────────────────────────
export const G = {
  D: uniform(4),            // distance caméra–centre (échelle de la plongée)
  envFalloff: uniform(0.6), // occultation de l'environnement vers le centre
  phase: uniform(0),        // phase de la boucle [0, 1)
  microDetail: uniform(1),  // intensité globale des micro-reliefs
  roughFloor: uniform(0.12), // douceur des reflets : rugosité minimale (sources ponctuelles → reflets étendus)
  // halo du cœur : près du cœur, les coquilles baignent dans sa lumière et s'y
  // fondent — une coquille qui naît émerge du rayonnement, sans apparaître
  coreR: uniform(0.2), coreColor: uniform(new THREE.Color(1, 0.8, 0.6)), coreGlow: uniform(10), halo: uniform(2.4),
};

// ── Volume de bruit ──────────────────────────────────────────────────────────
let noiseTexture = null;
export function setNoiseVolume({ data, size }) {
  const t = new THREE.Data3DTexture(data, size, size, size); // (déjà en demi-flottants)
  t.format = THREE.RGBAFormat;
  t.type = THREE.HalfFloatType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  noiseTexture = t;
}
// p en « cellules » : une période du bruit de gradient par unité
const NZ = (p) => texture3D(noiseTexture, p.mul(1 / NOISE_PERIOD));
const noise = (p) => NZ(p).x;                    // gradient, ≈ [-1, 1]
const noise2 = (p) => NZ(p).y;
// rotation entre octaves (cache la périodicité, évite les alignements sur les axes)
const ROT = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
const fbm = (p, oct = 4) => {
  let s = float(0), a = 0.5, q = p;
  for (let i = 0; i < oct; i++) { s = s.add(noise(q).mul(a)); q = ROT.mul(q).mul(2.03); a *= 0.5; }
  return s;
};

// ── Worley analytique ────────────────────────────────────────────────────────
// Pour les motifs à arêtes vives (craquelures, coups de marteau, piqûres) : le
// volume de bruit, interpolé linéairement, dessinerait des escaliers de près.
// Calcul exact au pixel : 27 cellules voisines, hachage sans sinus (Hoskins).
const hash33 = (c) => {
  let q = fract(c.mul(vec3(0.1031, 0.103, 0.0973)));
  q = q.add(dot(q, q.yxz.add(33.33)));
  return fract(q.xxy.add(q.yxx).mul(q.zyx));
};
// renvoie vec2(F1, F2) (distances au germe le plus proche et au suivant, en cellules)
const worley = (p) => {
  const i = floor(p), f = fract(p);
  let f1 = float(8), f2 = float(8);
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const o = vec3(x, y, z);
    const d = length(o.add(hash33(i.add(o))).sub(f));
    f2 = f2.min(f1.max(d));
    f1 = f1.min(d);
  }
  return vec2(f1, f2);
};

// ── Relief : perturbation de la normale par les dérivées écran d'une hauteur
// procédurale (méthode de Mikkelsen) ; la hauteur est en unités monde.
const perturb = Fn(([H, N]) => {
  const p = positionView;
  const dpdx = dFdx(p), dpdy = dFdy(p);
  const dhdx = dFdx(H), dhdy = dFdy(H);
  const R1 = cross(dpdy, N), R2 = cross(N, dpdx);
  const det = dot(dpdx, R1).mul(faceDirection);
  const grad = sign(det).mul(R1.mul(dhdx).add(R2.mul(dhdy)));
  return normalize(abs(det).mul(N).sub(grad));
});

// ── Uniformes d'une finition ─────────────────────────────────────────────────
export function finishUniforms(fin) {
  const U = {};
  for (const k of FINISH_KEYS) U[k] = typeof fin[k] === 'string' ? uniform(new THREE.Color(fin[k])) : uniform(fin[k]);
  return U;
}
export function applyFinish(U, fin) {
  for (const k of FINISH_KEYS) {
    if (U[k].value.isColor) U[k].value.set(fin[k]); else U[k].value = fin[k];
  }
}

// ── Motifs ───────────────────────────────────────────────────────────────────
// p : position locale (rayon ≈ 1) ; pf : empreinte du pixel (unités locales).
// Renvoie les propriétés de la surface (nœuds).
function surface(fin, U, p, pf) {
  const S = U.scale;
  const aa = (freq) => smoothstep(0.7, 0.2, pf.mul(S).mul(freq)); // fréquence (cycles / unité) → atténuation
  const out = {
    color: vec3(U.color), rough: float(U.rough), metal: float(U.metal), h: float(0), aniso: vec2(U.aniso, 0),
    iridT: mix(U.iridMin, U.iridMax, 0.5), ccH: float(0), glitter: vec3(0),
  };
  switch (fin.pattern) {
    case 'brushed': { // brossage circulaire autour de l'axe z local (stries le long des latitudes)
      const dxy = p.xy.div(length(p.xy).max(1e-4));
      const th = acos(clamp(p.z.div(length(p)), -1, 1));
      const n1 = noise(vec3(dxy.mul(S.mul(3)), th.mul(S.mul(380))));
      const n2 = noise2(vec3(dxy.mul(S.mul(9)), th.mul(S.mul(1400)))).mul(aa(1400 / PI));
      const n = n1.mul(0.65).add(n2.mul(0.35));
      out.h = n.mul(0.5).add(0.5).mul(aa(380 / PI));
      out.rough = U.rough.add(n.mul(0.05)).clamp(0.02, 1);
      break;
    }
    case 'hammered': { // coups de marteau : coupelles autour des germes de Worley
      const w = worley(p.mul(S.mul(24))).x.min(1);
      out.h = w.mul(w).mul(aa(24));
      out.rough = U.rough.add(w.oneMinus().mul(0.06));
      break;
    }
    case 'glaze': { // émail : peau d'orange sous le vernis, craquelure, émail plus épais au creux
      const c = worley(p.mul(S.mul(8)));
      const fw = pf.mul(S).mul(8); // empreinte du pixel, en cellules : le trait reste net sans crénelage
      const crack = smoothstep(fw.mul(1.5).add(0.045), fw.mul(0.5), c.y.sub(c.x)).mul(aa(40));
      const pool = noise(p.mul(S.mul(3))).mul(0.5).add(0.5);
      out.color = mix(mix(U.color, U.color.mul(0.8), pool.mul(0.45)), U.color2, crack.mul(0.85));
      out.rough = U.rough.add(crack.mul(0.3));
      out.h = crack.negate().mul(0.5);
      out.ccH = noise2(p.mul(S.mul(160))).mul(aa(160));
      break;
    }
    case 'weave': { // sergé 2/2 de carbone, projeté sur trois plans (triplanaire) : mèches, fibres
      const weave = (uv) => {
        const s = uv.mul(S.mul(110)), c = floor(s), f = fract(s);
        // sergé : le motif dessus/dessous se décale d'une mèche à chaque rang (diagonales)
        const over = step(1.0, mod(c.x.add(c.y), 4.0)).mul(step(mod(c.x.add(c.y), 4.0), 2.99));
        const along = mix(f.x, f.y, over);   // position le long de la mèche
        const across = mix(f.y, f.x, over);  // position en travers
        const bulge = sin(across.mul(PI)).mul(sin(along.mul(PI)).mul(0.35).add(0.65));
        const fiber = sin(across.mul(PI * 14)).mul(0.5).add(0.5); // fibres parallèles dans la mèche
        return vec3(bulge, over, fiber);
      };
      const nw = abs(normalLocal).pow(4.0);
      const r = weave(p.yz).mul(nw.x).add(weave(p.zx).mul(nw.y)).add(weave(p.xy).mul(nw.z)).div(nw.x.add(nw.y).add(nw.z));
      const k = aa(110), kf = aa(110 * 14);
      out.h = r.x.mul(k).add(r.z.mul(0.15).mul(kf));
      out.aniso = mix(vec2(1, 0), vec2(0, 1), r.y).mul(U.aniso);
      out.color = mix(U.color, U.color2, r.y.mul(0.35).mul(k)).mul(r.x.mul(0.25).mul(k).add(0.85)).mul(r.z.mul(0.1).mul(kf).add(0.95));
      out.rough = U.rough.add(r.z.mul(0.05).mul(kf));
      break;
    }
    case 'rock': { // basalte : bosses en chou-fleur, relief fractal, piqûres, deux tons
      const n = fbm(p.mul(S.mul(5)), 4);
      const n2 = fbm(p.mul(S.mul(1.7)).add(13.1), 2);
      const lumps = worley(p.mul(S.mul(9))).x.oneMinus();
      const pits = worley(p.mul(S.mul(34)).add(5.3)).x;
      out.h = n.mul(0.5).add(lumps.mul(0.7).mul(aa(9))).add(smoothstep(0, 0.3, pits).mul(0.25).mul(aa(34)));
      out.color = mix(U.color, U.color2, smoothstep(-0.25, 0.35, n2)).mul(n.mul(0.25).add(lumps.mul(0.15)).add(0.85));
      out.rough = U.rough.add(n.mul(0.08));
      break;
    }
    case 'glitter': { // druse : un tapis de petits cristaux, chacun orienté au hasard (scintillement)
      const q = p.mul(S.mul(220));
      const cell = mx_cell_noise_vec3(floor(q));
      const k = aa(220);
      // facette de chaque cristal : penchée de façon aléatoire, mais vers l'extérieur de la paroi
      out.glitter = cell.sub(0.5).mul(1.2).mul(k);
      const bright = step(0.82, cell.x).mul(k);
      out.color = mix(U.color, U.color2, bright.mul(cell.y.mul(0.7).add(0.3)).add(cell.z.mul(0.25)));
      out.rough = mix(U.rough, U.rough.mul(0.35), bright);
      out.h = NZ(p.mul(S.mul(60))).z.oneMinus().mul(aa(60));
      break;
    }
    case 'nacre': { // nacre : lignes de croissance ondulées, irisation variable
      const w = noise(p.mul(S.mul(2.5)));
      out.h = sin(p.z.add(w.mul(0.12)).mul(S.mul(220))).mul(0.3).add(0.3).mul(aa(220 / (2 * PI)));
      out.iridT = mix(U.iridMin, U.iridMax, noise2(p.mul(S.mul(6)).add(w)).mul(0.5).add(0.5));
      out.color = mix(U.color, U.color2, w.mul(0.5).add(0.5));
      break;
    }
    case 'oxide': { // titane coloré au feu : épaisseur d'oxyde en flammes
      const n = fbm(p.mul(S.mul(2.2)), 3);
      out.iridT = mix(U.iridMin, U.iridMax, clamp(p.z.mul(0.3).add(n.mul(0.6)).add(0.5), 0, 1));
      break;
    }
    case 'velvet': { // velours : fibres et nuances
      const fib = noise2(p.mul(S.mul(320)));
      const blot = noise(p.mul(S.mul(5)));
      out.color = mix(U.color, U.color2, clamp(fib.mul(0.3).mul(aa(320)).add(blot.mul(0.5)).add(0.4), 0, 1));
      out.h = fib.mul(0.5).add(0.5).mul(0.2).mul(aa(320));
      break;
    }
    case 'agate': { // agate : bandes concentriques révélées par la coupe
      const r = length(p);
      const w = fbm(p.mul(S.mul(5)), 2).mul(0.012);
      const band = sin(r.add(w).mul(S.mul(520))).mul(0.5).add(0.5);
      const band2 = sin(r.add(w.mul(1.7)).mul(S.mul(1500))).mul(0.5).add(0.5).mul(aa(240));
      out.color = mix(U.color, U.color2, smoothstep(0.35, 0.75, band).mul(0.8).add(band2.mul(0.2)));
      break;
    }
    case 'patina': { // vert-de-gris : croûte poudreuse en plaques
      const n = fbm(p.mul(S.mul(6)), 3);
      const crust = noise2(p.mul(S.mul(60)));
      out.color = mix(U.color, U.color2, smoothstep(-0.35, 0.35, n)).mul(crust.mul(0.12).add(0.95));
      out.rough = U.rough.add(crust.mul(0.08));
      out.h = n.mul(0.5).add(0.5).add(crust.mul(0.2).mul(aa(60)));
      break;
    }
    default: break;
  }
  out.h = out.h.mul(U.bump);
  return out;
}

// Ce qui, dans une couche, impose une recompilation quand cela change
export function signature(f) {
  const s = (fin) => [fin.pattern, fin.sheen > 0, fin.clearcoat > 0, fin.irid > 0, fin.aniso > 0, fin.glass > 0, fin.dispersion > 0, fin.smudge > 0].join('');
  return [s(f.outer), s(f.inner), s(f.edge), f.wear > 0, (f.groove || 0) > 0, (f.seam || 0) > 0].join('|');
}

// ── Normale analytique des surfaces minimales ────────────────────────────────
// Même champ que gen/tpms.js, évalué dans le shader : la normale (gradient par
// différences centrées) est exacte à chaque pixel. Sur une finition miroir,
// les reflets ne trahissent plus la triangulation.
export function tpmsUniforms() {
  return { f: uniform(10), wall: uniform(0.3), k: uniform(0.09), Rm: uniform(0.93), half: uniform(0.07), portalR: uniform(0.3), portalCos: uniform(1) };
}
export function applyTpms(T, spec) {
  const { f, wall, k } = tpmsParams(spec); // (mêmes valeurs que le maillage)
  T.f.value = f;
  T.wall.value = wall;
  T.k.value = k;
  T.Rm.value = 1 - spec.thickness / 2;
  T.half.value = spec.thickness / 2;
  T.portalR.value = Math.tan(spec.portal);
  T.portalCos.value = Math.cos(spec.portal);
}
function tpmsNormal(spec, T) {
  const tp = (q) => {
    const X = q.x.mul(T.f), Y = q.y.mul(T.f), Z = q.z.mul(T.f);
    const cX = cos(X), cY = cos(Y), cZ = cos(Z), sX = sin(X), sY = sin(Y), sZ = sin(Z);
    let g;
    switch (spec.surface) {
      case 'schwarz': g = cX.add(cY).add(cZ).div(1.9); break;
      case 'diamond': g = sX.mul(sY).mul(sZ).add(sX.mul(cY).mul(cZ)).add(cX.mul(sY).mul(cZ)).add(cX.mul(cY).mul(sZ)).div(1.25); break;
      case 'neovius': g = cX.add(cY).add(cZ).mul(3).add(cX.mul(cY).mul(cZ).mul(4)).div(6); break;
      case 'iwp': g = cX.mul(cY).add(cY.mul(cZ)).add(cZ.mul(cX)).mul(2).sub(cos(X.mul(2)).add(cos(Y.mul(2))).add(cos(Z.mul(2)))).div(3); break;
      case 'fischer': g = cos(X.mul(2)).mul(sY).mul(cZ).add(cX.mul(cos(Y.mul(2))).mul(sZ)).add(sX.mul(cY).mul(cos(Z.mul(2)))).div(1.4); break;
      default: g = sX.mul(cY).add(sY.mul(cZ)).add(sZ.mul(cX)).div(1.5);
    }
    return (spec.sheet ? abs(g).sub(T.wall) : g.sub(T.wall)).div(T.f);
  };
  const smax = (a, b) => { const h = tmax(T.k.sub(abs(a.sub(b))), 0).div(T.k); return tmax(a, b).add(h.mul(h).mul(T.k).mul(0.25)); };
  const field = (q) => {
    const s = abs(length(q).sub(T.Rm)).sub(T.half);
    const d = smax(s, tp(q));
    const cyl = tmax(length(q.xy).sub(T.portalR.mul(q.z)).mul(T.portalCos), q.z.negate());
    return smax(d, cyl.negate());
  };
  const p = positionLocal, e = 0.0015;
  const gx = field(p.add(vec3(e, 0, 0))).sub(field(p.sub(vec3(e, 0, 0))));
  const gy = field(p.add(vec3(0, e, 0))).sub(field(p.sub(vec3(0, e, 0))));
  const gz = field(p.add(vec3(0, 0, e))).sub(field(p.sub(vec3(0, 0, e))));
  return vec3(gx, gy, gz);
}

// ── Normale de la tranche (coquilles percées) ────────────────────────────────
// Le maillage porte, sur la tranche, la normale horizontale du bord du trou et
// l'angle du profil (attribut `bev`, voir gen/shell.js) : la normale
// cos(a)·horizontale + sin(a)·radiale est recalculée à chaque pixel. Le biseau
// reste parfaitement rond quel que soit son nombre de segments, et la diagonale
// des quadrilatères ne se lit plus dans les reflets. Ailleurs (faces, rivets :
// attribut nul), la normale du maillage. (Pièces animées : normale de tranche
// et direction radiale tournées avec la pièce, voir rig.js.)
function bevelNormal(rigged = false) {
  const bev = rigged ? rigBev : attribute('bev', 'vec4');
  const r = normalize(rigged ? rigRadial : positionLocal);
  // (sans branche ni division par zéro : un `select` TSL devient un if/else,
  // et la normale géométrique — variable partagée — n'y serait assignée que
  // d'un côté ; un NaN, lui, se propagerait par les dérivées écran)
  const on = step(0.5, length(bev.xyz));
  const h = mix(vec3(1, 0, 0), bev.xyz, on);
  const w0 = h.sub(r.mul(dot(h, r)));
  const w = w0.div(length(w0).max(1e-5));
  const a = bev.w.mul(PI / 2);
  const n = modelViewMatrix.mul(vec4(w.mul(cos(a)).add(r.mul(sin(a))), 0)).xyz;
  return normalize(mix(normalViewGeometry, n.div(length(n).max(1e-6)), on));
}

// ── Matériau d'une couche ────────────────────────────────────────────────────
// ── Pores (radiolaire) ───────────────────────────────────────────────────────
// Micro-perforations des faces, loin du bord des trous : des disques de
// Worley taillés selon la direction depuis le centre (mêmes pores sur les deux
// faces, on voit au travers), bordés d'une cuvette. U : { radius, freq }.
export const poreUniforms = () => ({ radius: uniform(0.3), freq: uniform(80) });
export function applyPores(U, geo) { U.radius.value = geo.pores || 0; U.freq.value = geo.poreFreq || 80; }
function pores(U, p, surfA) {
  const f1 = worley(normalize(p).mul(U.freq)).x;
  const on = step(surfA.z, 0.5).mul(step(surfA.w, 0.72));
  const open = f1.lessThan(U.radius).and(on.greaterThan(0.5));
  const dimple = smoothstep(U.radius.mul(1.9), U.radius, f1).mul(on);
  return { open, dimple };
}

// Options : tpms : { spec, U } pour une surface minimale (normale analytique) ;
// rig : uniformes d'une couche à pièces animées (voir rig.js) ; pore :
// uniformes des micro-perforations (radiolaire) ; meshNormal : normale du
// maillage telle quelle (champs implicites sans expression dans le shader)
export function buildShellMaterial(finish, U, { tpms = null, rig = null, pore = null, meshNormal = false } = {}) {
  const fins = [finish.outer, finish.inner, finish.edge];
  const any = (pred) => fins.some(pred);
  const F = {
    cc: any((f) => f.clearcoat > 0), ccN: fins.some((f) => f.pattern === 'glaze'), sheen: any((f) => f.sheen > 0),
    irid: any((f) => f.irid > 0), aniso: any((f) => f.aniso > 0), glass: any((f) => f.glass > 0),
    disp: any((f) => f.glass > 0 && f.dispersion > 0), glit: fins.some((f) => f.pattern === 'glitter'),
    smudge: any((f) => f.smudge > 0), wear: finish.wear > 0, groove: (finish.groove || 0) > 0, seam: (finish.seam || 0) > 0,
  };

  // membres de la structure : seulement ce que le modèle utilisera
  const members = { color: 'vec3', rough: 'float', metal: 'float', h: 'float' };
  if (F.cc) Object.assign(members, { cc: 'float', ccRough: 'float' });
  if (F.ccN) members.ccH = 'float';
  if (F.sheen) Object.assign(members, { sheen: 'vec3', sheenRough: 'float' });
  if (F.irid) Object.assign(members, { irid: 'float', iridIOR: 'float', iridT: 'float' });
  if (F.aniso) members.aniso = 'vec2';
  if (F.glass) Object.assign(members, { glass: 'float', ior: 'float', att: 'vec3', attDist: 'float' });
  if (F.disp) members.disp = 'float';
  if (F.glit) members.glitter = 'vec3';
  if (F.smudge) members.smudge = 'float';
  const Surf = struct(members);

  // propriétés complètes d'une face (motif + uniformes) ; les motifs suivent
  // les pièces animées (position au repos)
  const p = rig ? positionGeometry : positionLocal;
  // empreinte du pixel : calculée avant les branches (les dérivées n'y sont pas définies)
  const pf = length(fwidth(p)).toVar('pixelFootprint');
  const props = (fin, Uf) => {
    const s = surface(fin, Uf, p, pf);
    const o = { color: s.color, rough: s.rough, metal: s.metal, h: s.h };
    if (F.cc) { o.cc = float(Uf.clearcoat); o.ccRough = float(Uf.ccRough); }
    if (F.ccN) o.ccH = s.ccH;
    if (F.sheen) { o.sheen = Uf.sheenColor.mul(Uf.sheen); o.sheenRough = float(Uf.sheenRough); }
    if (F.irid) { o.irid = float(Uf.irid); o.iridIOR = float(Uf.iridIOR); o.iridT = s.iridT; }
    if (F.aniso) o.aniso = s.aniso;
    if (F.glass) { o.glass = float(Uf.glass); o.ior = float(Uf.ior); o.att = vec3(Uf.color2); o.attDist = float(Uf.attDist); }
    if (F.disp) o.disp = float(Uf.dispersion);
    if (F.glit) o.glitter = s.glitter;
    if (F.smudge) o.smudge = float(Uf.smudge);
    return o;
  };
  const surfA = attribute('surf', 'vec4');
  // (empreinte du pixel dans l'espace « proximité du bord » : la gravure ne crénelle pas)
  const pw = fwidth(surfA.w).toVar('proxFootprint');
  const evaluate = Fn(() => {
    pf.assign(length(fwidth(p)));
    pw.assign(fwidth(surfA.w));
    const out = Surf().toVar();
    const write = (o) => { for (const k of Object.keys(members)) out.get(k).assign(o[k]); };
    If(surfA.y.greaterThan(0.5), () => write(props(finish.inner, U.inner)))
      .ElseIf(surfA.z.greaterThan(0.5), () => write(props(finish.edge, U.edge)))
      .Else(() => {
        const o = props(finish.outer, U.outer);
        if (F.wear) { // la face externe s'use jusqu'à la tranche : près des bords, et par plaques
          const e = props(finish.edge, U.edge);
          const n = noise(p.mul(9)).mul(0.5).add(0.5), n2 = noise2(p.mul(70)).mul(0.12);
          const m = surfA.w.mul(0.62).add(n.mul(0.38)).add(n2);
          const worn = smoothstep(U.wear.oneMinus(), U.wear.oneMinus().add(0.06), m).mul(step(0.001, U.wear));
          for (const k of Object.keys(o)) o[k] = mix(o[k], e[k], worn);
        }
        if (F.seam) { // kintsugi : la finition de la tranche (l'or) borde les cassures, sur la face externe
          const e = props(finish.edge, U.edge);
          const w = pw.mul(1.2);
          const k = smoothstep(U.seam.add(w), U.seam.sub(w).max(0), surfA.w);
          for (const key of Object.keys(o)) o[key] = mix(o[key], e[key], k);
        }
        if (F.groove) { // gravure : un filet qui suit le contour du trou, à mi-barreau
          const w = pw.mul(1.5).max(0.03);
          const band = smoothstep(w, w.mul(0.3), abs(surfA.w.sub(U.grooveAt))).mul(U.groove);
          o.h = o.h.sub(band.mul(1.4));
          o.color = o.color.mul(band.mul(-0.3).add(1));
          o.rough = o.rough.add(band.mul(0.12));
        }
        write(o);
      });
    return out;
  });
  const S = evaluate().toVar('shellSurface');
  const get = (k) => S.get(k);

  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = vec4(get('color'), 1);
  m.metalnessNode = get('metal');
  // traces de doigts / voile : une seule carte, dosée par finition
  let rough = get('rough');
  if (F.smudge) {
    const sm = smoothstep(0.1, 0.45, fbm(p.mul(2.2).add(7.3), 3)).mul(noise2(p.mul(140)).mul(0.25).add(0.75));
    rough = rough.add(sm.mul(get('smudge')).mul(0.35));
  }
  // plancher doux (√(r² + f²)) : l'ordre des finitions est conservé, mais aucun
  // reflet ne se réduit à un point brûlé
  const soft = (r, f) => r.mul(r).add(f.mul(f)).sqrt().clamp(0.02, 1);
  m.roughnessNode = soft(rough, G.roughFloor);

  // relief (hauteur en unités monde : la plongée garde le même grain à toute échelle)
  const world = modelScale.x;
  // le relief s'annule à la frontière entre deux finitions (poids mêlés) : sans
  // cela, le saut de hauteur d'une finition à l'autre dessine un liseré dentelé
  const purity = smoothstep(0.55, 0.85, surfA.x.max(surfA.y).max(surfA.z));
  if (rig) m.positionNode = rigPosition(rig, G.phase, true);
  const N0 = tpms ? transformNormalToView(tpmsNormal(tpms.spec, tpms.U)) : meshNormal ? normalViewGeometry : bevelNormal(!!rig);
  let H = get('h').mul(purity);
  if (pore) { // (perforations : la face est percée, et creusée en cuvette autour)
    const P = pores(pore, p, surfA);
    m.maskNode = P.open.not();
    H = H.sub(P.dimple.mul(1.6));
  }
  let N = perturb(H.mul(0.0035).mul(world).mul(G.microDetail), N0);
  // (sans normalisation : la plupart des faces n'ont pas de facettes, vecteur nul)
  if (F.glit) N = normalize(N.add(modelViewMatrix.mul(vec4(get('glitter'), 0)).xyz.div(world).mul(0.22).mul(G.microDetail)));
  m.normalNode = N;
  // Anticrénelage spéculaire (Kaplanyan) : là où la normale varie fortement
  // d'un pixel au voisin (congés serrés, arêtes fines), on élargit le lobe
  // spéculaire au lieu de laisser un reflet scintiller en dents de scie.
  const dN = dFdx(N).dot(dFdx(N)).add(dFdy(N).dot(dFdy(N)));
  const aaRough = (r) => r.pow(4).add(dN.mul(0.5).min(0.18)).pow(0.25);
  m.roughnessNode = aaRough(m.roughnessNode);

  if (F.cc) {
    m.clearcoatNode = get('cc');
    m.clearcoatRoughnessNode = aaRough(soft(get('ccRough'), G.roughFloor.mul(0.7)));
    if (F.ccN) m.clearcoatNormalNode = perturb(get('ccH').mul(purity).mul(0.0008).mul(world), N0);
    else m.clearcoatNormalNode = N0; // (le vernis suit aussi la normale par pixel)
  }
  if (F.sheen) { m.sheenNode = get('sheen'); m.sheenRoughnessNode = get('sheenRough'); }
  if (F.irid) {
    m.iridescenceNode = get('irid');
    m.iridescenceIORNode = get('iridIOR');
    m.iridescenceThicknessNode = get('iridT');
  }
  if (F.aniso) m.anisotropyNode = get('aniso');
  if (F.glass) {
    m.transmissionNode = get('glass');
    m.iorNode = get('ior');
    m.thicknessNode = float(0.05).mul(world);
    m.attenuationColorNode = get('att');
    m.attenuationDistanceNode = get('attDist').mul(world).mul(0.25);
    if (F.disp) m.dispersionNode = get('disp');
  }
  // l'environnement s'éteint vers le centre du nid (lumière ambiante occultée par les couches)
  const r = length(positionWorld).div(G.D);
  m.aoNode = mix(float(1), clamp(r.pow(0.75), 0.04, 1), G.envFalloff);
  m.emissiveNode = haloEmission();
  m.mrtNode = stableVelocity();
  return m;
}

// émission du halo (ne dépend que du rayon : identique d'une couche à l'autre)
export const haloEmission = () => {
  const r = length(positionWorld);
  const f = smoothstep(G.coreR.mul(G.halo), G.coreR, r);
  return G.coreColor.mul(G.coreGlow).mul(f.mul(f).mul(f));
};

// Vecteur vitesse nul pour un objet qui vient d'apparaître : sa matrice
// « précédente » date de sa dernière apparition (autre taille, autre place) et
// donnerait un flou de mouvement et une reprojection temporelle aberrants.
const still = uniform(1).onObjectUpdate(({ object }) => object.userData.still ?? 1);
export const stableVelocity = () => mrt({ velocity: velocity.mul(still) });

// ── Matériau d'ombre (maillage grossier) ─────────────────────────────────────
// La couche qui vient de naître au cœur « pousse » dans la carte d'ombre :
// ses barreaux s'élargissent depuis leur axe (proximité du bord < naissance),
// ce qui évite tout saut dans la lumière du cœur.
export const birth = uniform(1).onObjectUpdate(({ object }) => object.userData.birth ?? 1);
export function buildShadowMaterial(rig = null, pore = null) {
  const m = new THREE.MeshBasicNodeMaterial();
  if (rig) m.positionNode = rigPosition(rig, G.phase, false);
  const surfA = attribute('surf', 'vec4');
  let mask = surfA.w.lessThanEqual(birth.mul(1.001));
  // (les pores laissent passer la lumière : des points de lumière sur la couche suivante)
  if (pore) mask = mask.and(pores(pore, positionLocal, surfA).open.not());
  m.maskShadowNode = mask;
  return m;
}

// ── Cristaux de la géode ─────────────────────────────────────────────────────
export function crystalUniforms(c) {
  return { tip: uniform(new THREE.Color(c.tip)), base: uniform(new THREE.Color(c.base)), rough: uniform(c.rough), dispersion: uniform(c.dispersion), ior: uniform(c.ior) };
}
export function applyCrystal(U, c) {
  U.tip.value.set(c.tip); U.base.value.set(c.base);
  U.rough.value = c.rough; U.dispersion.value = c.dispersion; U.ior.value = c.ior;
}
export function buildCrystalMaterial(U) {
  const m = new THREE.MeshPhysicalNodeMaterial({ transmission: 1 });
  const y = positionLocal.y.clamp(0, 1);
  // pied laiteux et dépoli (inclusions), pointe limpide et saturée (améthyste, citrine…)
  m.colorNode = vec4(1, 1, 1, 1);
  m.attenuationColorNode = mix(U.base, U.tip, smoothstep(0.0, 0.7, y));
  m.attenuationDistanceNode = float(0.05).mul(modelScale.x);
  m.thicknessNode = float(0.04).mul(modelScale.x);
  m.roughnessNode = mix(float(0.45), U.rough, smoothstep(0.0, 0.45, y)).max(G.roughFloor.mul(0.5));
  m.transmissionNode = float(1);
  m.iorNode = U.ior;
  m.dispersionNode = U.dispersion;
  m.specularIntensityNode = float(1);
  m.metalnessNode = float(0);
  m.aoNode = mix(float(1), clamp(length(positionWorld).div(G.D).pow(0.75), 0.04, 1), G.envFalloff);
  m.emissiveNode = haloEmission();
  m.mrtNode = stableVelocity();
  return m;
}

// ── Pierres serties ──────────────────────────────────────────────────────────
// Taille brillant à facettes planes : le « feu » vient de la dispersion et des
// reflets de l'environnement ; la teinte, de l'absorption dans la pierre.
export function gemUniforms(g) {
  return { color: uniform(new THREE.Color(g.color)), ior: uniform(g.ior), dispersion: uniform(g.dispersion), depth: uniform(g.depth ?? 0.4) };
}
export function applyGem(U, g) {
  U.color.value.set(g.color); U.ior.value = g.ior; U.dispersion.value = g.dispersion; U.depth.value = g.depth ?? 0.4;
}
export function buildGemMaterial(U) {
  const m = new THREE.MeshPhysicalNodeMaterial({ transmission: 1 });
  m.colorNode = vec4(1, 1, 1, 1);
  m.attenuationColorNode = U.color;
  m.attenuationDistanceNode = U.depth.mul(0.01).mul(modelScale.x);
  m.thicknessNode = float(0.01).mul(modelScale.x);
  m.roughnessNode = G.roughFloor.mul(0.15).max(0.015);
  m.transmissionNode = float(1);
  m.iorNode = U.ior;
  m.dispersionNode = U.dispersion;
  m.specularIntensityNode = float(1);
  m.metalnessNode = float(0);
  // « feu » : les reflets des facettes se teintent (couche mince), et la pierre
  // rend la lumière du cœur qu'elle reçoit (décroissance en 1/r²)
  m.iridescenceNode = float(0.45);
  m.iridescenceIORNode = float(1.6);
  m.iridescenceThicknessNode = float(380);
  const r = length(positionWorld);
  const glow = G.coreR.mul(G.coreR).div(r.mul(r)).mul(G.coreGlow).mul(0.5);
  m.aoNode = mix(float(1), clamp(r.div(G.D).pow(0.75), 0.04, 1), G.envFalloff);
  m.emissiveNode = haloEmission().add(G.coreColor.mul(U.color).mul(glow));
  m.mrtNode = stableVelocity();
  return m;
}

// ── Cœur lumineux ────────────────────────────────────────────────────────────
// Sphère émissive (en HDR) : assombrissement centre-bord comme une étoile,
// granulation lente qui boucle (le bruit glisse sur un cercle de phase).
export function buildCoreMaterial(U) {
  const m = new THREE.MeshBasicNodeMaterial();
  const ph = G.phase.mul(PI * 2);
  const loop = vec3(sin(ph), sin(ph.add(PI / 2)), 0).mul(0.9);
  const n = fbm(positionLocal.mul(2.8).add(loop), 3);
  const V = normalize(cameraPosition.sub(positionWorld));
  const mu = dot(normalize(positionWorld), V).clamp(0, 1);
  const limb = mu.pow(0.45).mul(0.75).add(0.25);
  const pulse = sin(ph.mul(2)).mul(U.pulse).add(1);
  m.colorNode = vec4(U.color.mul(U.glow).mul(limb).mul(n.mul(0.35).add(1)).mul(pulse), 1);
  return m;
}
