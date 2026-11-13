// Matériaux des cellules (TSL, MeshPhysicalNodeMaterial).
//
// Une pièce porte trois finitions — face externe, face interne, tranche
// (chanfreins, congés, chants, parois des trous) — désignées par l'attribut
// `surf` du maillage. Chaque pixel n'évalue que la finition de sa face (une
// branche, cohérente par triangle) ; ses propriétés sont rassemblées dans une
// structure partagée par tous les canaux du modèle physique.
//
// Les motifs sont procéduraux, calculés dans le repère de la pièce (attribut
// `pat` : une plaque a son veinage dans son plan, une barre son brossage le
// long de son axe), et restent attachés à la matière pendant que la cellule
// se plie en 4D. Ils ne calculent aucun bruit : ils échantillonnent un volume
// de bruit périodique précalculé (voir gen/noisevol.js).
//
// La position, la normale et la tangente viennent de la cinématique de
// l'armature (voir rig.js).
//
// Tous les réglages sont des uniformes : les modifier ne recompile rien. Seuls
// le choix d'un motif et l'activation d'une fonction du modèle physique
// (vernis, lustre, irisation, anisotropie, transmission) recompilent : voir
// `signature()`.

import * as THREE from 'three/webgpu';
import {
  Fn, If, struct, uniform, attribute, positionView, positionGeometry, vec2, vec3, vec4, screenCoordinate, hash, uint,
  float, mat3, mix, smoothstep, clamp, abs, length, normalize, dot, cross, sin, floor, fract, mod, step, acos, sign,
  dFdx, dFdy, fwidth, faceDirection, mrt, normalViewGeometry, atan, select, velocity, cos, max as tmax, texture3D, mx_cell_noise_vec3, modelViewMatrix, modelScale,
} from 'three/tsl';
import { FINISH_KEYS } from '../finishes.js';
import { NOISE_PERIOD } from '../gen/noisevol.js';
import { rigPosition } from './rig.js';
import { G } from './globals.js';

const PI = Math.PI;
export { G };

// ── Mode allégé (mobile) ─────────────────────────────────────────────────────
// Fixé au chargement, avant la construction du premier matériau (les
// matériaux sont compilés différemment). Ici : Worley lu dans le volume de
// bruit (canaux F1, F2 − F1) au lieu des 27 cellules évaluées à chaque pixel ;
// fBm limité à deux octaves ; pas de vecteurs vitesse ; tramage des fondus
// fixe (sans anticrénelage temporel, un tramage renouvelé à chaque image
// fourmillerait) ; armature de verre sans transmission physique. Voir aussi
// membrane.js, photo.js, nest.js et lights.js.
let LITE = false;
export const setLite = (v) => { LITE = !!v; };
export const isLite = () => LITE;

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
// rotation entre octaves (cache la périodicité, évite les alignements sur les axes)
const ROT = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
const ROT2 = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
// Le volume est périodique (NOISE_PERIOD cellules) : lu tel quel, un motif se
// répète toutes les 4 cellules — visible de près sur les grands motifs
// (bosses, plaques, cloques). Version sans répétition (noiseNT, fbmNT) : deux
// lectures sur deux réseaux incommensurables (tourné, échelle × 1,37, décalé),
// mêlées par un poids lu dans la seconde (canal .y, indépendant), contraste
// renormalisé : aucune période commune. Deux lectures au lieu d'une : on la
// réserve aux motifs larges ; les détails fins et les octaves suivantes (tournées,
// × 2,03, sans période commune avec la première) restent en lecture simple.
const detile = (p, ch) => {
  const a = NZ(p), b = NZ(ROT2.mul(p).mul(1.37).add(vec3(17.31, 5.77, 41.13)));
  const w = smoothstep(-0.3, 0.3, b.y);
  const k = float(1).div(w.mul(w).add(float(1).sub(w).mul(float(1).sub(w))).sqrt());
  return a[ch].mul(float(1).sub(w)).add(b[ch].mul(w)).mul(k);
};
const noise = (p) => NZ(p).x;                    // gradient, ≈ [-1, 1]
const noise2 = (p) => NZ(p).y;
const noiseNT = (p) => detile(p, 'x');
const fbmWith = (first) => (p, oct = 4) => {
  if (LITE) oct = Math.min(oct, 2);
  let s = first(p).mul(0.5), a = 0.25, q = ROT.mul(p).mul(2.03);
  for (let i = 1; i < oct; i++) { s = s.add(NZ(q).x.mul(a)); q = ROT.mul(q).mul(2.03); a *= 0.5; }
  return s;
};
const fbm = fbmWith(noise), fbmNT = fbmWith(noiseNT);
// Worley du volume (F1 en .z) sans répétition : le plus proche des germes des
// deux réseaux, chacun dominant là où son poids l'emporte
const worleyNT = (p) => {
  const A = NZ(p), B = NZ(ROT2.mul(p).mul(1.37).add(vec3(17.31, 5.77, 41.13)));
  const w = smoothstep(-0.3, 0.3, B.y);
  return A.z.add(w.mul(0.7)).min(B.z.add(float(1).sub(w).mul(0.7)));
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
  if (LITE) { const w = NZ(p); return vec2(w.z, w.z.add(w.w)); } // (volume : F1, F2 − F1)
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
function surface(fin, U, p, pf, pn) {
  const S = U.scale;
  const aa = (freq) => smoothstep(0.7, 0.2, pf.mul(S).mul(freq)); // fréquence (cycles / unité) → atténuation
  const out = {
    color: vec3(U.color), rough: float(U.rough), metal: float(U.metal), h: float(0), aniso: vec2(U.aniso, 0),
    iridT: mix(U.iridMin, U.iridMax, 0.5), ccH: float(0), glitter: vec3(0),
  };
  switch (fin.pattern) {
    case 'brushed': { // brossage le long de la pièce (direction de la tangente au repos)
      const t = normalize(attribute('tangent', 'vec4').xyz);
      const along = dot(p, t), across = p.sub(t.mul(along));
      const n1 = noise(across.mul(S.mul(260)).add(t.mul(along.mul(S.mul(2.5)))));
      const n2 = noise2(across.mul(S.mul(1000)).add(t.mul(along.mul(S.mul(7))))).mul(aa(1000 / PI));
      const n = n1.mul(0.65).add(n2.mul(0.35));
      out.h = n.mul(0.5).add(0.5).mul(aa(260 / PI));
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
      // (normale dans le repère du motif, calculée hors des branches)
      const nw = abs(pn).pow(4.0);
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
    case 'guilloche': { // guilloché « grain d'orge », tourné autour du centre de la pièce, sous émail
      // deux familles de sillons concentriques ondulés qui se croisent ; l'émail
      // (vernis plat) est plus profond, donc plus sombre, au creux des sillons
      const rho = length(p.xy);
      const ph = atan(p.y, p.x);
      const F = S.mul(150);
      const w = sin(ph.mul(24)).mul(0.9).mul(smoothstep(0.02, 0.12, rho));
      const g = tmax(cos(rho.mul(F).add(w)), cos(rho.mul(F).sub(w))).mul(0.5).add(0.5);
      const k = aa(150 / (2 * PI));
      out.h = g.mul(k);
      out.color = mix(U.color.mul(mix(float(1), float(0.5), k)), U.color, g.mul(k).add(k.oneMinus().mul(0.75)));
      out.rough = U.rough.add(g.oneMinus().mul(0.08).mul(k));
      break;
    }
    case 'damascus': { // acier damassé : couches repliées, deux tons, relief léger
      const n = fbm(p.mul(S.mul(2.5)), 3);
      const s = sin(dot(p, vec3(0.36, 0.48, 0.8)).add(n.mul(0.35)).mul(S.mul(90)));
      const band = smoothstep(-0.35, 0.35, s).mul(aa(90 / (2 * PI))).add(aa(90 / (2 * PI)).oneMinus().mul(0.5));
      out.color = mix(U.color2, U.color, band);
      out.h = band.mul(0.4);
      out.rough = mix(U.rough.add(0.12), U.rough, band);
      break;
    }
    case 'marble': { // marbre : nuages, grandes veines et veinules
      const n = fbm(p.mul(S.mul(2.2)), 4);
      const v1 = abs(sin(p.x.add(p.y.mul(0.6)).mul(S.mul(9)).add(n.mul(7))));
      const v2 = abs(sin(p.y.sub(p.z.mul(0.7)).mul(S.mul(23)).add(n.mul(11))));
      const vein = smoothstep(0.1, 0, v1).mul(0.85).add(smoothstep(0.05, 0, v2).mul(0.4).mul(aa(23)));
      const cloud = noise2(p.mul(S.mul(4))).mul(0.5).add(0.5);
      out.color = mix(mix(U.color, U.color.mul(0.88), cloud.mul(0.5)), U.color2, vein.min(1));
      out.rough = U.rough.add(vein.mul(0.04));
      break;
    }
    case 'urushi': { // laque urushi saupoudrée d'or (maki-e) : paillettes en nuées
      const q = p.mul(S.mul(140));
      const cell = mx_cell_noise_vec3(floor(q));
      const density = smoothstep(-0.15, 0.45, fbm(p.mul(S.mul(2.5)), 3));
      // (paillette ronde, de taille et de place propres à la cellule)
      const off = fract(q).sub(0.5).sub(cell.yzx.sub(0.5).mul(0.4));
      const rad = cell.z.mul(0.2).add(0.18);
      const flake = step(float(1).sub(density.mul(0.4)), cell.x).mul(smoothstep(rad, rad.mul(0.7), length(off))).mul(aa(140));
      out.color = mix(U.color, U.color2, flake);
      out.metal = flake;
      out.rough = mix(U.rough, float(0.22), flake);
      out.glitter = cell.sub(0.5).mul(0.9).mul(flake);
      out.h = noise2(p.mul(S.mul(110))).mul(0.12).mul(aa(110));
      break;
    }
    case 'soap': { // film de savon : l'épaisseur coule lentement (boucle parfaite)
      const ph = G.phase.mul(2 * PI);
      const n = fbm(p.mul(S.mul(1.6)).add(vec3(sin(ph), cos(ph), 0).mul(0.6)), 3);
      out.iridT = mix(U.iridMin, U.iridMax, sin(p.z.mul(S.mul(4)).add(n.mul(3)).add(ph)).mul(0.5).add(0.5));
      break;
    }
    default: break;
  }
  out.h = out.h.mul(U.bump);
  return out;
}

export { noise, noise2, noiseNT, fbm, fbmNT, worley, worleyNT, perturb, NZ, hash33 };

// Seuil de tramage d'un fondu (pixel gardé si seuil < couverture) : aléatoire
// et renouvelé à chaque image (lissé par l'anticrénelage temporel) ; en mode
// allégé, bruit de gradient entrelacé (Jimenez) fixe à l'écran — un voile
// régulier et stable, sans fourmillement. salt : décorrélation entre objets.
export const ditherThreshold = (salt = 0) => {
  if (LITE) {
    const x = screenCoordinate.x.add(salt * 5.588238), y = screenCoordinate.y.add(salt * 3.1);
    return fract(fract(x.mul(0.06711056).add(y.mul(0.00583715))).mul(52.9829189));
  }
  return hash(screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(8191))).add(G.frame.toUint().mul(uint(131071))).add(uint(salt)));
};

// Ce qui, dans un matériau, impose une recompilation quand cela change
export function signature(f) {
  const s = (fin) => [fin.pattern, fin.sheen > 0, fin.clearcoat > 0, fin.irid > 0, fin.aniso > 0, fin.glass > 0, fin.dispersion > 0, fin.smudge > 0, fin.emit > 0].join('');
  return [s(f.outer), s(f.inner), s(f.edge), (f.wear || 0) > 0].join('|');
}

// Vecteur vitesse sous garde : une valeur aberrante (NaN, infinie, démesurée)
// est remplacée par zéro — par sélection, pas par multiplication (∞ × 0 = NaN).
export const stableVelocity = () => LITE ? null : mrt({ velocity: select(length(velocity.xy).lessThan(0.5), velocity, vec4(0)) });

// ── Matériau d'une pièce de cellule ──────────────────────────────────────────
// finish : { outer, inner, edge, wear } (finitions complètes) ; U : leurs
// uniformes ({ outer, inner, edge, wear }) ; M : uniformes du maillage
// (matrice 4D, voir project.js) ; opts.shadowTint : ombre colorée (verre)
export function buildPieceMaterial(finish, U, M, { shadowTint = null, content = false } = {}) {
  const fins = [finish.outer, finish.inner, finish.edge];
  const any = (pred) => fins.some(pred);
  const F = {
    cc: any((f) => f.clearcoat > 0), ccN: fins.some((f) => f.pattern === 'glaze'), sheen: any((f) => f.sheen > 0),
    irid: any((f) => f.irid > 0), aniso: any((f) => f.aniso > 0), glass: any((f) => f.glass > 0),
    disp: any((f) => f.glass > 0 && f.dispersion > 0), glit: fins.some((f) => f.pattern === 'glitter' || f.pattern === 'urushi'),
    smudge: any((f) => f.smudge > 0), emit: any((f) => f.emit > 0), wear: (finish.wear || 0) > 0,
  };
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
  if (F.emit) members.emit = 'vec3';
  const Surf = struct(members);

  // (motif : dans le repère de la pièce au repos — position d'origine)
  const p = positionGeometry.add(M.seedOff);
  const pf = length(fwidth(p)).toVar('pixelFootprint');
  // normale dans le repère du motif (dérivées écran : hors des branches)
  const pn = vec3(0, 0, 1).toVar('patNormal');
  const surfA = attribute('surf', 'vec4');
  const props = (fin, Uf) => {
    const s = surface(fin, Uf, p, pf, pn);
    // nuance propre à la pièce (chaque barre, chaque latte) : rugosité et teinte
    const piece = surfA.w.sub(0.5);
    const o = { color: s.color.mul(piece.mul(0.06).add(1)), rough: s.rough.add(piece.mul(0.05)).clamp(0.02, 1), metal: s.metal, h: s.h };
    if (F.cc) { o.cc = float(Uf.clearcoat); o.ccRough = float(Uf.ccRough); }
    if (F.ccN) o.ccH = s.ccH;
    if (F.sheen) { o.sheen = Uf.sheenColor.mul(Uf.sheen); o.sheenRough = float(Uf.sheenRough); }
    if (F.irid) { o.irid = float(Uf.irid); o.iridIOR = float(Uf.iridIOR); o.iridT = s.iridT; }
    if (F.aniso) o.aniso = s.aniso;
    if (F.glass) { o.glass = float(Uf.glass); o.ior = float(Uf.ior); o.att = vec3(Uf.color2); o.attDist = float(Uf.attDist); }
    if (F.disp) o.disp = float(Uf.dispersion);
    if (F.glit) o.glitter = s.glitter;
    if (F.smudge) o.smudge = float(Uf.smudge);
    if (F.emit) o.emit = Uf.emitColor.mul(Uf.emit);
    return o;
  };
  const evaluate = Fn(() => {
    pf.assign(length(fwidth(p)));
    const c = cross(dFdx(p), dFdy(p));
    pn.assign(c.div(length(c).max(1e-12)));
    const out = Surf().toVar();
    const write = (o) => { for (const k of Object.keys(members)) out.get(k).assign(o[k]); };
    If(surfA.y.greaterThan(0.5), () => write(props(finish.inner, U.inner)))
      .ElseIf(surfA.z.greaterThan(0.5), () => write(props(finish.edge, U.edge)))
      .Else(() => {
        const o = props(finish.outer, U.outer);
        if (F.wear) { // usure : la face externe laisse paraître la tranche, par plaques
          const e = props(finish.edge, U.edge);
          const n = noise(p.mul(6)).mul(0.5).add(0.5), n2 = noise2(p.mul(60)).mul(0.15);
          const worn = smoothstep(U.wear.oneMinus(), U.wear.oneMinus().add(0.05), n.add(n2)).mul(step(0.001, U.wear));
          for (const k of Object.keys(o)) o[k] = mix(o[k], e[k], worn);
        }
        write(o);
      });
    return out;
  });
  const S = evaluate().toVar('pieceSurface');
  const get = (k) => S.get(k);

  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  m.positionNode = rigPosition(M, true);
  m.castShadowPositionNode = rigPosition(M, false);
  m.colorNode = vec4(get('color'), 1);
  m.metalnessNode = get('metal');
  let rough = get('rough');
  if (F.smudge) {
    const sm = smoothstep(0.1, 0.45, fbm(p.mul(2.2).add(7.3), 3)).mul(noise2(p.mul(140)).mul(0.25).add(0.75));
    rough = rough.add(sm.mul(get('smudge')).mul(0.35));
  }
  const soft = (r, f) => r.mul(r).add(f.mul(f)).sqrt().clamp(0.02, 1);
  m.roughnessNode = soft(rough, G.roughFloor);

  // relief : hauteur en unités de l'objet (échelle locale de la projection)
  const world = modelScale.x;
  const purity = smoothstep(0.55, 0.85, surfA.x.max(surfA.y).max(surfA.z));
  // (normale géométrique dans le sens de la face : voir project.js)
  const N0 = normalViewGeometry.mul(faceDirection);
  const H = get('h').mul(purity);
  let N = perturb(H.mul(0.0035).mul(world).mul(G.microDetail), N0);
  if (F.glit) N = normalize(N.add(modelViewMatrix.mul(vec4(get('glitter'), 0)).xyz.mul(0.22).mul(G.microDetail)));
  m.normalNode = N;
  // anticrénelage spéculaire (Kaplanyan) : lobe élargi là où la normale varie vite
  const dN = dFdx(N).dot(dFdx(N)).add(dFdy(N).dot(dFdy(N)));
  const aaRough = (r) => r.pow(4).add(dN.mul(0.5).min(0.18)).pow(0.25);
  m.roughnessNode = aaRough(m.roughnessNode);
  if (F.cc) {
    m.clearcoatNode = get('cc');
    m.clearcoatRoughnessNode = aaRough(soft(get('ccRough'), G.roughFloor.mul(0.7)));
    m.clearcoatNormalNode = F.ccN ? perturb(get('ccH').mul(purity).mul(0.0008).mul(world), N0) : N0;
  }
  if (F.sheen) { m.sheenNode = get('sheen'); m.sheenRoughnessNode = get('sheenRough'); }
  if (F.irid) {
    m.iridescenceNode = get('irid');
    m.iridescenceIORNode = get('iridIOR');
    m.iridescenceThicknessNode = get('iridT');
  }
  if (F.aniso) m.anisotropyNode = get('aniso');
  if (F.glass && LITE) {
    // verre allégé : une baguette de verre sombre, teintée par son absorption,
    // brillante sous son vernis (pas de copie de l'image ni de double passe)
    m.colorNode = vec4(mix(get('color'), get('att').mul(0.3), get('glass')), 1);
    m.metalnessNode = mix(get('metal'), float(0), get('glass'));
    m.clearcoatNode = F.cc ? get('cc').max(get('glass')) : get('glass');
    if (!F.cc) m.clearcoatRoughnessNode = float(0.03);
  } else if (F.glass) {
    m.transmissionNode = get('glass');
    m.iorNode = get('ior');
    // tôle de verre mince, ou cristal massif (objet exposé) : la lumière y
    // parcourt toute l'épaisseur de l'objet, qui réfracte la cellule derrière lui
    m.thicknessNode = float(0.03).mul(world);
    m.attenuationColorNode = get('att');
    m.attenuationDistanceNode = get('attDist').mul(world).mul(0.25);
    if (F.disp) m.dispersionNode = get('disp');
  }
  if (F.emit) m.emissiveNode = get('emit');
  if (shadowTint) m.castShadowNode = vec4(shadowTint, 1);
  // l'armature est enfermée dans sa membrane : elle ne voit du studio que ce
  // que la membrane laisse passer
  if (content) m.aoNode = content;
  // fondu (couche qui s'éloigne derrière la caméra) : tramage aléatoire renouvelé
  // à chaque image, lissé par l'anticrénelage temporel ; l'ombre suit
  if (M.vis) {
    const keep = ditherThreshold().lessThan(M.vis);
    m.maskNode = keep; m.maskShadowNode = keep;
  }
  m.mrtNode = stableVelocity();
  return m;
}

