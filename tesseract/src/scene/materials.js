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
// La position, la normale et la tangente viennent de la projection 4D (voir
// project.js) ; le relief est mis à l'échelle locale de la projection.
//
// Tous les réglages sont des uniformes : les modifier ne recompile rien. Seuls
// le choix d'un motif et l'activation d'une fonction du modèle physique
// (vernis, lustre, irisation, anisotropie, transmission) recompilent : voir
// `signature()`.

import * as THREE from 'three/webgpu';
import {
  Fn, If, struct, uniform, attribute, positionView, vec2, vec3, vec4,
  float, mat3, mix, smoothstep, clamp, abs, length, normalize, dot, cross, sin, floor, fract, mod, step, acos, sign,
  dFdx, dFdy, fwidth, faceDirection, mrt, normalViewGeometry, atan, select, velocity, cos, max as tmax, min as tmin, positionGeometry, texture3D, mx_cell_noise_vec3, modelViewMatrix, modelScale,
} from 'three/tsl';
import { FINISH_KEYS } from '../finishes.js';
import { NOISE_PERIOD } from '../../../shared/gen/noisevol.js';
import { projectPosition, localScale, revealMask, depthW, depthColor, frameMerge, doorGlow } from './project.js';
import { G, MODE } from './globals.js';
import { probeLight } from './probe.js';

const PI = Math.PI;
export { G };

// ── Mode allégé (mobile) ─────────────────────────────────────────────────────
// Fixé au chargement, avant la construction du premier matériau. Ce qui change :
//  - Worley sur les 8 cellules voisines au lieu de 27 (voir worley8) ;
//  - fBm limité à deux octaves ; patine des parois en deux lectures du volume
//    au lieu de six ;
//  - verre, cristaux : plus de transmission physique (copie de l'image et
//    chaîne de mipmaps à chaque image, objets double face rendus deux fois)
//    mais un verre « composité » (mélange alpha teinté, opacité de Fresnel) ;
//    les pierres taillées deviennent des cabochons opaques à feu irisé ;
//  - occlusion ambiante (pré-passe et GTAO absentes) imitée aux jonctions des
//    parois, là où elle se voyait ;
//  - pas de vecteurs vitesse (ni seconde projection 4D par sommet).
export const setLite = (v) => { MODE.lite = !!v; };
export const isLite = () => MODE.lite;

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
  if (MODE.lite) oct = Math.min(oct, 2);
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
// Mobile : 8 cellules au lieu de 27 — les 2 × 2 × 2 cellules les plus proches
// du point, germes resserrés au centre de leur cellule (0,2 à 0,8) pour que le
// plus proche y soit presque toujours. Les arêtes restent nettes (le volume de
// bruit, interpolé, les dessinait en escalier de près, sur un panneau vu à
// quelques centimètres pendant le voyage), pour un tiers du calcul.
const worley8 = (p) => {
  const fl = floor(p), f0 = fract(p);
  const i = fl.add(step(0.5, f0).sub(1)), f = p.sub(i);
  let f1 = float(8), f2 = float(8);
  for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) {
    const o = vec3(x, y, z);
    const d = length(o.add(hash33(i.add(o)).mul(0.6).add(0.2)).sub(f));
    f2 = f2.min(f1.max(d));
    f1 = f1.min(d);
  }
  return vec2(f1, f2);
};
const worley = (p) => {
  if (MODE.lite) return worley8(p);
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
// p : position locale (rayon ≈ 1) ; pf : empreinte du pixel (unités locales) ;
// pn : normale dans le repère du motif ; lines : part des traits fins
// (veines, craquelures) que la pièce peut porter — sur une barre fine, une
// veine coupée de biais se lit comme un cheveu.
// Renvoie les propriétés de la surface (nœuds).
function surface(fin, U, p, pf, pn, lines) {
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
      const crack = smoothstep(fw.mul(1.5).add(0.045), fw.mul(0.5), c.y.sub(c.x)).mul(aa(40)).mul(lines);
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
      const vein = smoothstep(0.1, 0, v1).mul(0.85).add(smoothstep(0.05, 0, v2).mul(0.4).mul(aa(23))).mul(lines);
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

export { noise, noise2, fbm, worley, perturb, NZ };

// Ce qui, dans un matériau, impose une recompilation quand cela change
export function signature(f) {
  const s = (fin) => [fin.pattern, fin.sheen > 0, fin.clearcoat > 0, fin.irid > 0, fin.aniso > 0, fin.glass > 0, fin.dispersion > 0, fin.smudge > 0, fin.emit > 0].join('');
  return [s(f.outer), s(f.inner), s(f.edge), (f.wear || 0) > 0].join('|');
}

// L'objet exposé est enfermé : il ne voit du studio (éclairage indirect et
// reflets de l'environnement) que ce que laissent passer les parois de sa
// cellule, de G.nestEnv (enfermé) à tout (à l'air libre) ; le reste de ses
// reflets vient des réflexions en espace écran.
const studioSeen = (openness) => mix(G.nestEnv, float(1), openness);

// Vecteur vitesse sous garde : une valeur aberrante (NaN, infinie, démesurée)
// est remplacée par zéro — par sélection, pas par multiplication (∞ × 0 = NaN).
export const stableVelocity = () => MODE.lite ? null : mrt({ velocity: select(length(velocity.xy).lessThan(0.5), velocity, vec4(0)) });

// ── Matériau d'une pièce de cellule ──────────────────────────────────────────
// finish : { outer, inner, edge, wear } (finitions complètes) ; U : leurs
// uniformes ({ outer, inner, edge, wear }) ; M : uniformes du maillage
// (matrice 4D, voir project.js) ; opts.shadowTint : ombre colorée (verre) ;
// opts.openness : objet exposé, part du studio que voit sa cellule
// opts.patina : parois (encrassement aux jonctions, marbrure, rugosité inégale)
// opts.gi : part de la sonde de pièce (rebond diffus des murs ; sur l'objet
// exposé, leur reflet aussi : voir probe.js)
// opts.caustic : lumière qu'une pierre ou un cristal jette sur les parois
// ({ color, dir } : teinte, direction où elle tombe)
export function buildPieceMaterial(finish, U, M, { shadowTint = null, reveal = null, depth = false, openness = null, merge = false, patina = false, gi = null, caustic = null } = {}) {
  const content = openness !== null;
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

  const p = attribute('pat', 'vec3');
  const pf = length(fwidth(p)).toVar('pixelFootprint');
  // normale dans le repère du motif (dérivées écran : hors des branches)
  const pn = vec3(0, 0, 1).toVar('patNormal');
  const surfA = attribute('surf', 'vec4');
  // traits fins : effacés sur les pièces plus fines qu'environ 0,03 (voir gen/mesh.js, span)
  const lines = smoothstep(0.012, 0.045, attribute('span', 'float'));
  const props = (fin, Uf) => {
    const s = surface(fin, Uf, p, pf, pn, lines);
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
  const pre = merge ? frameMerge(M) : null;
  m.positionNode = projectPosition(M, true, reveal, pre, depth);
  m.castShadowPositionNode = projectPosition(M, false, reveal, pre);
  if (reveal) { m.maskNode = revealMask(true); m.maskShadowNode = revealMask(false); }
  let color = get('color'), rough = get('rough');
  // Patine des parois : ce qui fait croire à une matière sans y ajouter de
  // dessin (rien de net, rien de fin) —
  //  • encrassement aux jonctions : plus sombre et plus mat là où la paroi
  //    rejoint l'ossature et dans les coins des pièces, irrégulier ;
  //  • marbrure : une teinte qui varie de quelques pour cent, à grande échelle ;
  //  • rugosité inégale : le reflet n'est jamais parfaitement uniforme.
  // La distance à l'arête vient de la position au repos (repère de la
  // cellule) : la deuxième plus grande coordonnée vaut ~0,93 au bord du panneau.
  if (patina) {
    const a = abs(positionGeometry), hi = tmax(a.x, tmax(a.y, a.z)), lo = tmin(a.x, tmin(a.y, a.z));
    const mid = a.x.add(a.y).add(a.z).sub(hi).sub(lo);
    // (mobile : les trois bruits en deux lectures du volume — ses deux canaux
    // de gradient sont indépendants)
    const lo2 = MODE.lite ? NZ(p.mul(1.7).add(3.7)) : null;
    const blot = (MODE.lite ? lo2.x.mul(0.5) : fbm(p.mul(2.1).add(3.7), 2)).mul(0.5).add(0.5);
    const grime = smoothstep(0.62, 0.95, mid.add(blot.sub(0.5).mul(0.2))).mul(G.patina);
    const mottle = (MODE.lite ? lo2.y.mul(0.5) : fbm(p.mul(1.3).add(11.1), 2)).mul(0.16).mul(G.patina);
    color = color.mul(mottle.add(1)).mul(grime.mul(-0.34).add(1).max(0.4));
    rough = rough.add((MODE.lite ? noise(p.mul(3.4).add(5.2)).mul(0.5) : fbm(p.mul(3.4).add(5.2), 2)).mul(0.12).mul(G.patina)).add(grime.mul(0.2)).clamp(0.02, 1);
    // occlusion ambiante imitée (mobile, sans GTAO) : la lumière indirecte se
    // retire des jonctions avec l'ossature et des coins, où la passe d'AO
    // l'assombrissait ; l'encrassement y est déjà
    if (MODE.lite) m.aoNode = smoothstep(0.7, 0.99, mid).mul(-0.45).add(1).mul(smoothstep(0.85, 0.99, hi.add(lo).mul(0.5)).mul(-0.25).add(1));
  }
  m.colorNode = vec4(color, 1);
  m.metalnessNode = get('metal');
  if (F.smudge) {
    const sm = smoothstep(0.1, 0.45, fbm(p.mul(2.2).add(7.3), 3)).mul(noise2(p.mul(140)).mul(0.25).add(0.75));
    rough = rough.add(sm.mul(get('smudge')).mul(0.35));
  }
  const soft = (r, f) => r.mul(r).add(f.mul(f)).sqrt().clamp(0.02, 1);
  m.roughnessNode = soft(rough, G.roughFloor);

  // relief : hauteur en unités de l'objet (échelle locale de la projection)
  const world = localScale.mul(modelScale.x);
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
  if (F.glass && MODE.lite) liteGlass(m, get('glass'), get('att'), content ? 0.25 : 0.08);
  else if (F.glass) {
    m.transmissionNode = get('glass');
    m.iorNode = get('ior');
    // tôle de verre mince, ou cristal massif (objet exposé) : la lumière y
    // parcourt toute l'épaisseur de l'objet, qui réfracte la cellule derrière lui
    m.thicknessNode = (content ? G.crystalThick.mul(0.7) : float(0.03)).mul(world);
    m.attenuationColorNode = get('att');
    // (absorption : de l'ordre d'une longueur sur l'épaisseur d'un cristal ;
    // au-delà, saphir et quartz fumé viraient au noir)
    m.attenuationDistanceNode = get('attDist').mul(world).mul(content ? 1 : 0.25);
    if (F.disp) m.dispersionNode = get('disp');
  }
  if (F.emit) m.emissiveNode = get('emit');
  // profondeur 4D en couleur (ossature, pendant la rotation)
  if (depth) { const e = depthColor(depthW).mul(G.depthTint); m.emissiveNode = m.emissiveNode ? m.emissiveNode.add(e) : e; }
  // Caustiques : une pierre ou un cristal éclairé jette sur les murs un
  // réseau de filets de lumière, à sa teinte, qui tourne avec lui. Deux nappes
  // de crêtes du volume de bruit, lues dans la direction du mur depuis le
  // centre de la pièce (deux lectures : presque gratuit) ; elles dérivent en
  // boucle parfaite.
  if (caustic && !MODE.lite) {
    const ph = G.phase.mul(2 * PI * 3);
    const drift = vec3(sin(ph), cos(ph), sin(ph.add(2.1))).mul(0.3);
    const dir = normalize(positionGeometry), q = dir.mul(3.1).add(drift);
    const ridge = (n) => float(1).sub(abs(n)).clamp(0, 1).pow(16);
    const net = ridge(noise(q)).add(ridge(noise2(q.mul(1.83).add(vec3(4.3, 1.7, 2.9)).sub(drift))).mul(0.7));
    // (la tache est du côté opposé à la lampe : là où tombe la lumière qui a traversé l'objet)
    const e = caustic.color.mul(net).mul(smoothstep(0.1, 0.95, dot(dir, caustic.dir))).mul(color.add(0.03));
    m.emissiveNode = m.emissiveNode ? m.emissiveNode.add(e) : e;
  }
  // lisière lumineuse des portes du voyage (parois et verre)
  if (reveal) { const e = G.doorRim.mul(doorGlow()); m.emissiveNode = m.emissiveNode ? m.emissiveNode.add(e) : e; }
  if (gi && !MODE.lite) {
    // (le verre ne diffuse rien ; une paroi ne prend de la sonde que le rebond
    // diffus : ses reflets sont ceux de l'espace écran)
    const base = F.glass ? color.mul(get('glass').oneMinus()) : color;
    const e = probeLight(N, base, get('metal'), m.roughnessNode, { specular: content ? 1 : 0 }).mul(gi);
    m.emissiveNode = m.emissiveNode ? m.emissiveNode.add(e) : e;
  }
  if (shadowTint) m.castShadowNode = vec4(shadowTint, 1);
  if (content) m.aoNode = studioSeen(openness);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Pierre taillée (objet exposé) ────────────────────────────────────────────
export function gemUniforms(g) {
  return { color: uniform(new THREE.Color(g.color)), ior: uniform(g.ior), dispersion: uniform(g.dispersion), depth: uniform(g.depth ?? 0.4) };
}
export function applyGem(U, g) {
  U.color.value.set(g.color); U.ior.value = g.ior; U.dispersion.value = g.dispersion; U.depth.value = g.depth ?? 0.4;
}
export function buildGemMaterial(U, M, openness, gi = null) {
  if (MODE.lite) return buildLiteGem(U, M, openness);
  const m = new THREE.MeshPhysicalNodeMaterial({ transmission: 1, side: THREE.DoubleSide });
  m.positionNode = projectPosition(M, true);
  m.castShadowPositionNode = projectPosition(M, false);
  const world = localScale.mul(modelScale.x);
  m.colorNode = vec4(1, 1, 1, 1);
  m.normalNode = normalViewGeometry.mul(faceDirection);
  m.attenuationColorNode = U.color;
  m.attenuationDistanceNode = U.depth.mul(0.45).mul(world); // (pierre colorée : teinte profonde, pas noire)
  m.thicknessNode = G.crystalThick.mul(0.3).mul(world);
  m.roughnessNode = G.roughFloor.mul(0.15).max(0.015);
  m.transmissionNode = float(1);
  m.iorNode = U.ior;
  m.dispersionNode = U.dispersion;
  m.specularIntensityNode = float(1);
  m.metalnessNode = float(0);
  m.iridescenceNode = float(0.4);
  m.iridescenceIORNode = float(1.6);
  m.iridescenceThicknessNode = float(380);
  // (une pierre vit de reflets : ceux de sa pièce)
  if (gi) m.emissiveNode = probeLight(m.normalNode, vec3(1), float(0), m.roughnessNode, { diffuse: 0 }).mul(gi);
  m.castShadowNode = vec4(U.color.mul(0.8).add(0.2), 1);
  m.aoNode = studioSeen(openness);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Mode allégé : verre et pierres ───────────────────────────────────────────
// Verre allégé : la surface devient semi-transparente (mélange alpha), d'autant
// plus opaque qu'on la voit de biais (Fresnel de Schlick, n ≈ 1,5) ; sa
// couleur est celle que la lumière prend en la traversant. Les reflets
// restent ceux du modèle physique, l'ombre colorée aussi (castShadowNode).
// L'écriture de profondeur est conservée, une seule passe (pas de rendu face
// arrière puis face avant) : une pièce de verre cache sa propre face arrière,
// mais laisse voir la cellule derrière elle.
function liteGlass(m, glass, tint, base = 0.12) {
  const V = positionView.negate().normalize();
  const fres = float(1).sub(abs(dot(normalize(m.normalNode), V))).pow(5);
  m.transparent = true;
  m.depthWrite = true;
  m.forceSinglePass = true;
  // (un verre teinté absorbe : plus sa teinte est sombre, moins il laisse voir
  // derrière lui — l'alpha imite cette absorption, qu'on obtiendrait sinon par
  // multiplication avec l'image transmise)
  const clear = dot(tint, vec3(0.2126, 0.7152, 0.0722)).clamp(0, 1).sqrt();
  const b0 = mix(float(0.82), float(base), clear);
  m.opacityNode = mix(float(1), mix(b0, float(1), fres.mul(0.96).add(0.04)), glass);
  // (le verre clair ne diffuse presque rien : sa teinte, très assombrie, et ses reflets)
  m.colorNode = vec4(mix(m.colorNode.rgb, tint.mul(0.08), glass), 1);
  m.metalnessNode = mix(m.metalnessNode, float(0), glass);
}
// Pierre allégée : cabochon opaque, teinte profonde, vernis net et feu irisé
function buildLiteGem(U, M, openness) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  m.positionNode = projectPosition(M, true);
  m.castShadowPositionNode = projectPosition(M, false);
  m.colorNode = vec4(U.color.mul(0.55), 1);
  m.normalNode = normalViewGeometry.mul(faceDirection);
  m.roughnessNode = G.roughFloor.mul(0.15).max(0.015);
  m.metalnessNode = float(0);
  m.specularIntensityNode = float(1);
  m.iorNode = U.ior;
  m.clearcoatNode = float(1);
  m.clearcoatRoughnessNode = float(0.02);
  m.iridescenceNode = U.dispersion.mul(0.6).add(0.2);
  m.iridescenceIORNode = float(1.6);
  m.iridescenceThicknessNode = float(380);
  m.castShadowNode = vec4(U.color.mul(0.8).add(0.2), 1);
  m.aoNode = studioSeen(openness);
  return m;
}
