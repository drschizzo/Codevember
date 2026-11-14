// Le rendu : un lancer de rayons en shader de calcul WebGPU, qui écrit l'image
// HDR dans une texture three.js ; la chaîne d'image commune passe ensuite
// dessus (scene/stage.js). Essais d'origine : proto/b0 (l'image), proto/s0 (la
// fonte calculée).
//
// - Trémie : un cube dont chaque face est creusée en gradins irréguliers vers
//   le centre (scene/hopper.js) ; variantes : en spirale, allongée.
// - La fonte : calculée au chargement (scene/melt.js) ; pour chaque cristal,
//   l'atlas 3D donne l'instant τ où chaque point fond et la vitesse du front
//   v. Le cristal à l'instant u de la fonte est { trémie } ∩ { τ > u }. La
//   distance (u − τ)·v n'est juste que près du front : on la borne à deux
//   cellules de la grille, sinon la marche traverse la surface (dents de scie,
//   lambeaux, déchirures noires).
// - Un cristal dont la taille a fondu bascule : sa partie haute pivote sur le
//   bord de l'encoche, tombe dans le bain et y fond.
// - Couleur : couche mince d'oxyde (Bi₂O₃, n ≈ 2,2) sur le métal
//   (n ≈ 1,9 + 3,4 i), réflectance d'Airy à six longueurs d'onde, plus forte
//   en incidence rasante (Fresnel) ; l'épaisseur vient du temps passé à l'air,
//   de la chaleur du bain, et de la place sur la terrasse (l'arête, plus
//   exposée, s'oxyde plus que le pied du gradin).
// - Le creuset : une marmite de fonte, posée sur un brûleur, sur un établi ;
//   le panier (la grille d'acier qui porte la grappe, sa fourche et son long
//   manche). Matières rugueuses :
//   éclairement analytique des boîtes de lumière et du dôme, reflet adouci.
// - Le bain : un miroir de métal liquide ; la peau d'oxyde des cristaux
//   engloutis s'y étale et s'y défait ; un cristal qui bascule le ride ; le
//   bain refroidi se couvre d'une peau dorée, que la grille déchire en sortant.
// - Flou de mise au point (lentille mince), à l'export seulement : chaque
//   sous-image du rendu accumulé tire son point de la lentille. En lecture, un
//   tirage par image fait trembler le flou (on le lit comme une caméra qui
//   bouge) : l'objectif y est fermé. Le satiné du métal, lui, est tiré à
//   chaque image et moyenné par l'anticrénelage temporel.
// - Chaque rayon ne visite que les cristaux dont la sphère englobante le croise ;
//   le reste (bain, creuset, manche, établi) est analytique, la grille se borne
//   simplement loin de son plan.
//
// Unités : cm ; y = 0 : la grille (repère de la grappe) ; le bain est fixe dans le monde.
import * as THREE from 'three/webgpu';
import { HOPPER_WGSL } from './hopper.js';

export const MAXC = 12;
const NH = 18, NB = 18, CS = 6; // en-tête, boîtes, vec4 par cristal

const WGSL = HOPPER_WGSL + /* wgsl */ `
struct P {
  res: vec4f, cam: vec4f, camF: vec4f, camR: vec4f, camU: vec4f,
  st: vec4f,     // t, vitesse d'oxydation, port (0 trémie, 1 spirale, 2 allongée), nombre de cristaux
  tide: vec4f,   // niveau du bain (monde), chaleur de la fonte (0–1), ligne au repos LH et suspendue LOW (repère de la grappe)
  times: vec4f,  // T0, T1, T2, T3
  envLo: vec4f, envHi: vec4f, // fond du studio (bas, haut)
  forge: vec4f,  // lueur de forge (couleur, force)
  atlas: vec4f,  // dimensions de l'atlas de la fonte, temps u de la fonte
  pot: vec4f,    // rayon intérieur, épaisseur, haut du bord, fond extérieur
  gal: vec4f,    // la grille : rayon, —, hauteur du montant du manche, hauteur de la grappe dans le monde
  flow: vec4f,   // peau du bain qui refroidit : couverture (0–1), rayon de la déchirure (part du bain), —, —
  flow2: vec4f,  // — ; — ; flamme (0–1) ; —
  lens: vec4f,   // échantillon de la lentille (disque unité), rayon d'ouverture, distance de mise au point
  misc: vec4f,   // image, —, —, établi
  boxes: array<vec4f, ${NB}>, // 6 boîtes : (direction, intensité), (couleur, demi-largeur), (haut, demi-hauteur)
  cr: array<vec4f, ${MAXC * CS}>, // cristaux : (centre, demi-côté), (angle, inclinaison, oxyde, graine),
                              // (origine x, z dans l'atlas, pas, demi-largeur de la grille), (descente, nx, ny, nz),
                              // bascule (direction x, z, angle, hauteur de l'encoche), (pivot, fonte de la partie tombée, enfoncement, —)
  sk: array<vec4f, ${MAXC}>,  // peau (âge ou −1), ride (x, z, âge ou −1)
};
@group(0) @binding(0) var<uniform> u: P;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var meltT: texture_3d<f32>;
@group(0) @binding(3) var meltS: sampler;

const PI = 3.14159265;
const TAU = 6.2831853;
fn hash31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1,0,0)), w.x), mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), w.x), w.y),
             mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), w.x), mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), w.x), w.y), w.z);
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
fn voro(x: vec2f, seed: f32) -> vec2f {
  let i = floor(x); var f1 = 9.0; var f2 = 9.0; var id = 0.0;
  for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) {
    let c = i + vec2f(f32(a), f32(b));
    let h = vec2f(hash31(vec3f(c, seed)), hash31(vec3f(c, seed + 3.7)));
    let d = length(x - c - h);
    if (d < f1) { f2 = f1; f1 = d; id = hash31(vec3f(c, seed + 9.1)); } else if (d < f2) { f2 = d; }
  } }
  return vec2f(f2 - f1, id);
}
// rotation d'angle a autour de l'axe horizontal perpendiculaire à dir (le haut penche vers dir)
fn tip(v: vec3f, dir: vec2f, a: f32) -> vec3f {
  let d = vec3f(dir.x, 0.0, dir.y);
  let al = dot(v, d); let h = v.y; let side = v - d * al - vec3f(0.0, h, 0.0);
  let c = cos(a); let s = sin(a);
  return d * (al * c + h * s) + vec3f(0.0, -al * s + h * c, 0.0) + side;
}
// un temps périodique sur la boucle : deux coordonnées d'un cercle (pour le bruit)
fn loopc(k: f32) -> vec2f { let a = TAU * u.st.x * k; return vec2f(cos(a), sin(a)); }

// le cristal dans le repère de sa grille : (distance, gradin + terrasse, part fondue)
fn crystalGrid(pc: vec3f, i: i32) -> vec3f {
  let A = u.cr[${CS} * i]; let B = u.cr[${CS} * i + 1]; let G = u.cr[${CS} * i + 2]; let D = u.cr[${CS} * i + 3];
  let hk = hopperK(rotX(rotY(pc - vec3f(0.0, A.y, 0.0), B.x), B.y), A.w, u.st.z);
  if (hk.x > 0.05 * A.w + 0.03) { return vec3f(hk.x, hk.y, 0.0); }
  // la fonte calculée : τ (instant où le point fond) et v (vitesse du front)
  let g = clamp(vec3f((pc.x + G.w) / G.z, pc.y / G.z, (pc.z + G.w) / G.z), vec3f(0.5), D.yzw - vec3f(0.5));
  let F = textureSampleLevel(meltT, meltS, (vec3f(G.x, 0.0, G.y) + g) / u.atlas.xyz, 0.0).xy;
  // (la distance au front n'est juste que près de lui : bornée à deux cellules)
  let phi = min((u.atlas.w - F.x) * F.y, 4.0 * G.z);
  return vec3f(max(hk.x, phi), hk.y, smoothstep(-0.3 * G.z, 0.3 * G.z, phi - hk.x));
}
fn crystalAt(p: vec3f, i: i32) -> vec3f {
  let A = u.cr[${CS} * i]; let D = u.cr[${CS} * i + 3]; let K = u.cr[${CS} * i + 4]; let E = u.cr[${CS} * i + 5];
  // (repère de la grille : la grappe est descendue de D.x)
  let pc = vec3f(p.x - A.x, p.y + D.x, p.z - A.z);
  if (K.z <= 0.0) { return crystalGrid(pc, i); }
  // la bascule : la partie au-dessus de l'encoche pivote sur son bord, tombe
  // dans le bain, s'y enfonce et y fond ; le pied reste sur la grille
  let lo = crystalGrid(pc, i);
  var c = vec3f(max(lo.x, pc.y - K.w), lo.y, lo.z);
  if (E.y >= 1.8 * A.w) { return c; } // (la partie tombée a fini de fondre)
  let piv = vec3f(K.x * E.x, K.w - E.z, K.y * E.x);
  let q = tip(pc - piv, K.xy, -K.z) + piv + vec3f(0.0, E.z, 0.0);
  let hi = crystalGrid(q, i);
  let dh = max(hi.x + E.y, K.w - q.y);
  if (dh < c.x) { c = vec3f(dh, hi.y, max(hi.z, smoothstep(0.0, 0.05, E.y))); }
  return c;
}

// la grille : un treillis d'acier tendu dans un cerceau, sur lequel la grappe
// a poussé (les cristaux reposent sur ses fils, cycle.js GRID_WIRE) ; on voit le bain au travers.
// Une plaque pleine, quoi qu'on en fasse, se lisait en socle ou en neige.
const GBIT = 32768u;
const MESH = 0.42; // (pas du treillis, cm)
const HANDLE = -0.8; // (direction du manche du panier : au fond à gauche ; plus sur le côté, il sortait du cadre des gros plans, et la grille semblait suspendue à rien)
fn galette(p: vec3f) -> f32 {
  let q = p - vec3f(0.0, u.gal.w, 0.0);
  let rr = length(q.xz);
  // (loin du plan de la grille, une borne simple)
  let far = max(abs(q.y) - 0.1, rr - u.gal.x - 0.1);
  if (far > 0.03) { return far; }
  let ring = length(vec2f(rr - u.gal.x, q.y)) - 0.08; // (le cerceau : un fil de 1,6 mm)
  let fx = abs(fract(q.x / MESH + 0.5) - 0.5) * MESH; let fz = abs(fract(q.z / MESH + 0.5) - 0.5) * MESH;
  let wire = max(length(vec2f(min(fx, fz), q.y)) - 0.02, rr - u.gal.x);
  return min(ring, wire);
}

var<private> MASK: u32;
// la scène : (distance, matière) ; matière ≥ 0 : cristal i·16 + gradin ; −1 : bain
fn scene(p: vec3f) -> vec2f {
  let pool = max(p.y - u.tide.x, length(p.xz) - u.pot.x); // (le bain est dans le creuset, pas au-delà)
  var best = vec2f(1e9, -1.0);
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    if ((MASK & (1u << u32(i))) == 0u) { continue; }
    let c = crystalAt(p, i);
    if (c.x < best.x) { best = vec2f(c.x, f32(i) * 16.0 + c.y); }
  }
  if ((MASK & GBIT) != 0u) { let g = galette(p); if (g < best.x) { best = vec2f(g, -11.0); } }
  let k = 0.03; // le ménisque : le bain mouille le cristal
  let d = smin(best.x, pool, k);
  if (pool < best.x - 0.5 * k) { return vec2f(d, -1.0); }
  return vec2f(d, best.y);
}
fn nrm(p: vec3f, e: f32) -> vec3f {
  let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * scene(p + k.xyy * e).x + k.yyx * scene(p + k.yyx * e).x + k.yxy * scene(p + k.yxy * e).x + k.xxx * scene(p + k.xxx * e).x);
}

// ── l'atelier : ce que le métal reflète ──
// (boîtes à bords doux : un bord dur se lit, sur une face plane, comme une coupure)
fn rect(d: vec3f, c: vec3f, up: vec3f, hw: f32, hh: f32, soft: f32) -> f32 {
  let cc = dot(d, c); if (cc <= 0.0) { return 0.0; }
  let r = normalize(cross(c, up)); let v = cross(r, c);
  let q = d / cc;
  let ex = abs(dot(q, r)) / hw; let ey = abs(dot(q, v)) / hh;
  return (1.0 - smoothstep(1.0 - soft, 1.0 + soft * 0.5, ex)) * (1.0 - smoothstep(1.0 - soft, 1.0 + soft * 0.5, ey)) * (0.75 + 0.25 * (1.0 - ex * ex));
}
fn env(d: vec3f, soft: f32) -> vec3f {
  // un dôme : sombre près de l'horizon, clair en hauteur
  var c = mix(u.envLo.xyz, u.envHi.xyz, smoothstep(0.05 - soft, 0.75 + soft, d.y));
  for (var b = 0; b < 6; b++) {
    let A = u.boxes[3 * b]; let B = u.boxes[3 * b + 1]; let Cb = u.boxes[3 * b + 2];
    if (A.w <= 0.0) { continue; }
    c += B.xyz * A.w * rect(d, A.xyz, Cb.xyz, B.w + soft * 0.4, Cb.w + soft * 0.4, 0.35 + soft) * mix(1.0, 0.6, soft);
  }
  if (u.forge.w > 0.0) { c += u.forge.xyz * u.forge.w * smoothstep(0.25, -0.15, d.y) * (0.7 + 0.3 * noise3(d * 4.0)); }
  return c;
}
// l'éclairement d'une surface mate (dôme et boîtes, sans ombres), divisé par π
fn irr(n: vec3f) -> vec3f {
  var c = mix(u.envLo.xyz, u.envHi.xyz, 0.5 + 0.5 * n.y) * 0.9;
  for (var b = 0; b < 6; b++) {
    let A = u.boxes[3 * b]; let B = u.boxes[3 * b + 1]; let Cb = u.boxes[3 * b + 2];
    if (A.w <= 0.0) { continue; }
    c += B.xyz * A.w * (4.0 * B.w * Cb.w) / PI * max(dot(n, A.xyz), 0.0);
  }
  return c;
}

// ── couche mince d'oxyde sur le bismuth (Airy) ──
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2f, b: vec2f) -> vec2f { let d = dot(b, b); return vec2f(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
fn filmR(th: f32, lam: f32, cosi: f32, n1: f32, n2: vec2f) -> f32 {
  let r01 = vec2f((1.0 - n1) / (1.0 + n1), 0.0);
  let r12 = cdiv(vec2f(n1, 0.0) - n2, vec2f(n1, 0.0) + n2);
  let sint = sqrt(max(0.0, 1.0 - cosi * cosi)) / n1;
  let dl = 4.0 * PI * n1 * th * sqrt(1.0 - sint * sint) / lam;
  let e = vec2f(cos(dl), sin(dl));
  let r = cdiv(r01 + cmul(r12, e), vec2f(1.0, 0.0) + cmul(r01, cmul(r12, e)));
  return dot(r, r);
}
fn filmRGBn(th: f32, cosi: f32, n1: f32, n2: vec2f) -> vec3f {
  let R = vec3f(0.5 * filmR(th, 610.0, cosi, n1, n2) + 0.5 * filmR(th, 650.0, cosi, n1, n2),
                0.5 * filmR(th, 530.0, cosi, n1, n2) + 0.5 * filmR(th, 560.0, cosi, n1, n2),
                0.5 * filmR(th, 450.0, cosi, n1, n2) + 0.5 * filmR(th, 480.0, cosi, n1, n2));
  // (en incidence rasante, tout métal devient miroir : Fresnel de Schlick)
  let f = pow(1.0 - cosi, 5.0);
  return R + (vec3f(1.0) - R) * f;
}
fn filmRGB(th: f32, cosi: f32) -> vec3f { return filmRGBn(th, cosi, 2.2, vec2f(1.9, 3.4)); }
fn emerge(y: f32) -> f32 { let T = u.times; return T.x + clamp((u.tide.z - y) / (u.tide.z - u.tide.w), 0.0, 1.0) * (T.y - T.x); }

// le bain : peau d'oxyde des cristaux engloutis (épaisseur), rides et frémissement (normale)
var<private> NOUT: vec3f;
fn poolFilm(p: vec3f) -> f32 {
  let q = p.xz;
  let lc = loopc(1.0);
  var th = 10.0 + 14.0 * noise3(vec3f(q.x * 0.8, 0.0, q.y * 0.8) + 0.5 * vec3f(lc.x, 0.0, lc.y));
  // la peau du bain qui refroidit : elle s’épaissit en couleurs (paille, puis or),
  // plus vite au bord, contre la fonte froide ; la grille
  // qui sort la déchire du centre vers les bords, en lambeaux qui s'écartent
  if (u.flow.x > 0.0) {
    let r = length(q) / u.pot.x;
    let wv = noise3(vec3f(q * 0.9, 7.0));
    var cov = u.flow.x * smoothstep(0.0, 1.0, u.flow.x * 1.4 + 0.35 * r + 0.2 * (wv - 0.5) - 0.2);
    if (u.flow.y > 0.0) { cov *= smoothstep(-0.04, 0.04, r - u.flow.y + 0.12 * (noise3(vec3f(q * 1.7, 3.0)) - 0.5)); }
    // (les premières couleurs seulement, paille et or pâle : plus épaisse, la peau virait au brun sale)
    if (cov > 0.0) { th = mix(th, 14.0 + 17.0 * cov + 6.0 * (wv - 0.5), smoothstep(0.0, 0.3, cov)); }
  }
  var nn = vec3f(0.0, 1.0, 0.0);
  // les cellules de convection quand le creuset chauffe (le bain frémit)
  if (u.tide.y > 0.0) {
    let lc8 = loopc(8.0);
    let cv = vec3f(p.x * 0.9 + 0.6 * lc8.x, p.z * 0.9 + 0.6 * lc8.y, 3.0);
    let e = 0.05; let c0 = noise3(cv);
    nn += u.tide.y * 0.006 * vec3f(-(noise3(cv + vec3f(e, 0.0, 0.0)) - c0) / e, 0.0, -(noise3(cv + vec3f(0.0, e, 0.0)) - c0) / e);
  }
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    let A = u.cr[${CS} * i]; let B = u.cr[${CS} * i + 1]; let S = u.sk[i];
    if (S.x > 0.0) {
      // la peau du cristal englouti : elle s'étale depuis l'endroit où il a
      // disparu (sans surgir d'un bloc), une seule pellicule en dégradé ; le
      // bain, chauffé par le bas, s'écoule en surface du centre vers les bords
      // et l'emporte ; elle se fend, et ses plaques rapetissent jusqu'à rien
      let age = S.x;
      var dir = A.xz; if (dot(dir, dir) < 0.01) { dir = vec2f(cos(B.w), sin(B.w)); }
      dir = normalize(dir);
      let c0 = A.xz + dir * (3.0 * age + 12.0 * age * age);
      let rel = p.xz - c0;
      let R0 = A.w * 3.4 * sqrt(age) * (0.82 + 0.36 * noise3(vec3f(rel * 2.2, B.w + 2.0)));
      let r = length(rel);
      if (r < R0) {
        let warp = vec2f(noise3(vec3f(rel * 2.3, B.w)), noise3(vec3f(rel * 2.3, B.w + 7.0))) - 0.5;
        let vo = voro((rel + warp * A.w * 0.5) / (A.w * 0.8), B.w);
        let crack = 0.02 + 1.25 * smoothstep(0.012, 0.095, age);
        let edge = smoothstep(0.0, 0.05, vo.x - crack) * (1.0 - smoothstep(0.75, 1.0, r / R0));
        if (edge > 0.0) {
          let wr = noise3(vec3f(rel * 9.0, B.w));
          let grad = noise3(vec3f(rel / A.w * 0.9, B.w + 4.0));
          th = mix(th, 110.0 + 150.0 * grad + 18.0 * (hash31(vec3f(vo.y, 1.0, B.w)) - 0.5) + 25.0 * (wr - 0.5), edge);
          let e = 0.02;
          let gx = noise3(vec3f((rel + vec2f(e, 0.0)) * 9.0, B.w)) - wr;
          let gz = noise3(vec3f((rel + vec2f(0.0, e)) * 9.0, B.w)) - wr;
          nn += edge * vec3f(-gx, 0.0, -gz) * 3.5;
        }
      }
    }
    if (S.w > 0.0) {
      let rr = length(p.xz - S.yz) + 1e-4;
      let amp = 0.05 * (1.0 - S.w / 0.07) * exp(-rr * 2.8) * smoothstep(9.0 * S.w * 30.0 + 0.2, 9.0 * S.w * 30.0 - 0.6, rr);
      let g = cos(30.0 * rr - 900.0 * S.w) * amp;
      nn += vec3f((p.x - S.y) / rr * g, 0.0, (p.z - S.z) / rr * g);
    }
  }
  NOUT = normalize(nn);
  return th;
}

// sphères englobantes : les cristaux que le rayon croise, et jusqu'où marcher
fn rayMask(ro: vec3f, rd: vec3f, tEnd: ptr<function, f32>) -> u32 {
  var m = 0u; var te = 0.0;
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    let A = u.cr[${CS} * i]; let D = u.cr[${CS} * i + 3]; let K = u.cr[${CS} * i + 4]; let E = u.cr[${CS} * i + 5];
    let c = vec3f(A.x, A.y - D.x, A.z);
    let R = A.w * select(1.9, 2.5, u.st.z > 1.5);
    var hitAny = false;
    // (le cristal, ou son pied s'il a basculé)
    if (c.y + R >= u.tide.x - 0.05) {
      let oc = ro - c; let b = dot(oc, rd); let cc = dot(oc, oc) - R * R;
      let disc = b * b - cc;
      if (disc > 0.0) { let t1 = -b + sqrt(disc); if (t1 > 0.0) { hitAny = true; te = max(te, t1); } }
    }
    // (la partie basculée : sa propre sphère, tant qu'elle n'a pas fini de fondre)
    if (K.z > 0.0 && E.y < 1.8 * A.w) {
      let piv = vec3f(A.x + K.x * E.x, K.w - D.x, A.z + K.y * E.x);
      let cu = tip(c - piv, K.xy, K.z) + piv - vec3f(0.0, E.z, 0.0);
      let Ru = R - 0.9 * E.y;
      if (cu.y + Ru >= u.tide.x - 0.05) {
        let oc = ro - cu; let b = dot(oc, rd); let cc = dot(oc, oc) - Ru * Ru;
        let disc = b * b - cc;
        if (disc > 0.0) { let t1 = -b + sqrt(disc); if (t1 > 0.0) { hitAny = true; te = max(te, t1); } }
      }
    }
    if (hitAny) { m |= (1u << u32(i)); }
  }
  // (la grille, tant qu'elle est hors du bain)
  if (u.gal.w > u.tide.x - 0.1) {
    let c = vec3f(0.0, u.gal.w, 0.0); let R = u.gal.x + 0.2;
    let oc = ro - c; let b = dot(oc, rd); let cc = dot(oc, oc) - R * R; let disc = b * b - cc;
    if (disc > 0.0) { let t1 = -b + sqrt(disc); if (t1 > 0.0) { m |= GBIT; te = max(te, t1); } }
  }
  *tEnd = te;
  return m;
}

// ── le creuset et l'atelier, analytiques : (t, matière), normale dans HN ──
// matières : −1 bain, −2 paroi intérieure, −3 bord, −4 paroi extérieure, 
// −7 établi, −8 brûleur, −9 dessous du creuset, −10 fourche et manche du panier, −11 grille
var<private> HN: vec3f;
fn cylV(ro: vec2f, rd: vec2f, r: f32) -> vec2f { // (racines t1 ≤ t2 d'un cylindre vertical d'axe passant par l'origine)
  let a = dot(rd, rd); let b = dot(ro, rd); let c = dot(ro, ro) - r * r;
  let disc = b * b - a * c;
  if (disc < 0.0 || a < 1e-9) { return vec2f(1e9, -1e9); }
  let s = sqrt(disc); return vec2f((-b - s) / a, (-b + s) / a);
}
// une capsule (segment a–b, rayon r) : distance du rayon, ou −1 (Quílez)
fn capHit(ro: vec3f, rd: vec3f, pa: vec3f, pb: vec3f, r: f32) -> f32 {
  let ba = pb - pa; let oa = ro - pa;
  let baba = dot(ba, ba); let bard = dot(ba, rd); let baoa = dot(ba, oa); let rdoa = dot(rd, oa); let oaoa = dot(oa, oa);
  let a = baba - bard * bard; let b = baba * rdoa - baoa * bard; let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0.0) {
    let t = (-b - sqrt(h)) / a; let y = baoa + t * bard;
    if (y > 0.0 && y < baba) { return t; }
    let oc = select(ro - pb, oa, y <= 0.0); let b2 = dot(rd, oc); let c2 = dot(oc, oc) - r * r; let h2 = b2 * b2 - c2;
    if (h2 > 0.0) { return -b2 - sqrt(h2); }
  }
  return -1.0;
}
fn capN(p: vec3f, a: vec3f, b: vec3f) -> vec3f { let ba = b - a; let pa = p - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return normalize(pa - h * ba); }
fn capTest(ro: vec3f, rd: vec3f, a: vec3f, b: vec3f, r: f32, m: f32, tMin: f32, best: ptr<function, vec2f>) {
  let t = capHit(ro, rd, a, b, r);
  if (t > tMin && t < (*best).x) { *best = vec2f(t, m); HN = capN(ro + rd * t, a, b); }
}
fn world(ro: vec3f, rd: vec3f, tMin: f32) -> vec2f {
  var best = vec2f(1e9, 0.0);
  let Ri = u.pot.x; let Ro = u.pot.x + u.pot.y; let rim = u.pot.z; let bot = u.pot.w; let L = u.tide.x;
  // le bain (dans le creuset seulement)
  if (rd.y < -1e-5 && ro.y > L) {
    let t = (L - ro.y) / rd.y; let q = ro + rd * t;
    if (t > tMin && length(q.xz) < Ri) { best = vec2f(t, -1.0); HN = vec3f(0.0, 1.0, 0.0); }
  }
  // la paroi intérieure (vue de dedans : la racine de sortie), au-dessus du bain
  let ci = cylV(ro.xz, rd.xz, Ri);
  if (ci.y > tMin && ci.y < best.x) { let y = ro.y + rd.y * ci.y; if (y > L - 0.01 && y < rim) { best = vec2f(ci.y, -2.0); let q = ro + rd * ci.y; HN = -vec3f(q.x, 0.0, q.z) / Ri; } }
  // la paroi extérieure (vue de dehors : la racine d'entrée)
  let co = cylV(ro.xz, rd.xz, Ro);
  if (co.x > tMin && co.x < best.x) { let y = ro.y + rd.y * co.x; if (y > bot && y < rim) { best = vec2f(co.x, -4.0); let q = ro + rd * co.x; HN = vec3f(q.x, 0.0, q.z) / Ro; } }
  // le bord : un anneau au sommet, à lèvre arrondie (la normale se courbe vers l'extérieur et l'intérieur)
  if (abs(rd.y) > 1e-5) {
    let t = (rim - ro.y) / rd.y; let q = ro + rd * t; let r = length(q.xz);
    if (t > tMin && t < best.x && r > Ri && r < Ro) {
      let m = (r - (Ri + Ro) * 0.5) / (0.5 * (Ro - Ri));
      best = vec2f(t, -3.0); HN = normalize(vec3f(0.0, 1.0, 0.0) + vec3f(q.x, 0.0, q.z) / r * m * 1.1);
    }
    // le dessous du creuset (entre le brûleur et l'établi, vu d'en bas)
    let tb = (bot - ro.y) / rd.y; let qb = ro + rd * tb;
    if (rd.y > 0.0 && tb > tMin && tb < best.x && length(qb.xz) < Ro) { best = vec2f(tb, -9.0); HN = vec3f(0.0, -1.0, 0.0); }
  }
  // la grille elle-même est dans la marche des rayons (galette()) ; ici, ce qui la tient
  {
    let o = u.gal.w; let Rg = u.gal.x;
    // (un panier à long manche, comme un panier à friture : une fourche de deux
    // tiges part du cerceau, au fond à gauche ; un montant presque droit monte
    // jusqu'au-dessus du bord de la marmite (même grille au fond), puis le
    // manche se coude et part vers le fond à gauche, presque à plat, par-dessus la
    // paroi, jusqu'à une main hors champ. Deux fils tendus vers un crochet ne se
    // lisaient pas comme un outil ; un manche droit à 68° se lisait en poteau)
    let th = HANDLE;
    let b = vec2f(sin(th), -cos(th));
    let apex = vec3f(b.x * (Rg + 0.6), o + 0.35, b.y * (Rg + 0.6));
    for (var k = 0; k < 2; k++) {
      let a = th + select(-0.5, 0.5, k == 1);
      capTest(ro, rd, vec3f(sin(a) * Rg, o + 0.02, -cos(a) * Rg), apex, 0.09, -10.0, tMin, &best);
    }
    let bend = apex + vec3f(b.x * 0.25, u.gal.z, b.y * 0.25);
    capTest(ro, rd, apex, bend, 0.22, -10.0, tMin, &best);
    let el = 0.26; // (15° au-dessus de l'horizontale)
    capTest(ro, rd, bend, bend + vec3f(b.x * cos(el), sin(el), b.y * cos(el)) * 60.0, 0.22, -10.0, tMin, &best);
  }
  // le brûleur, sous le creuset
  let rb = Ro * 0.42;
  let cb = cylV(ro.xz, rd.xz, rb);
  if (cb.x > tMin && cb.x < best.x) { let y = ro.y + rd.y * cb.x; if (y > u.misc.w && y < bot) { best = vec2f(cb.x, -8.0); let q = ro + rd * cb.x; HN = vec3f(q.x, 0.0, q.z) / rb; } }
  // l'établi
  if (rd.y < -1e-5) {
    let t = (u.misc.w - ro.y) / rd.y;
    if (t > tMin && t < best.x) { best = vec2f(t, -7.0); HN = vec3f(0.0, 1.0, 0.0); }
  }
  return best;
}

// les flammes du brûleur : une nappe bleue sous le creuset, des langues qui
// lèchent sa paroi (émission intégrée le long du rayon, de 0 à tEnd)
fn flameAt(p: vec3f) -> vec3f {
  let Ro = u.pot.x + u.pot.y; let bot = u.pot.w;
  let r = length(p.xz); let a = atan2(p.z, p.x);
  let lc = loopc(240.0);
  // (la nappe, sous le fond)
  let sheet = exp(-pow((p.y - (bot - 0.12)) / 0.09, 2.0)) * smoothstep(Ro * 0.42, Ro * 0.42 + 0.3, r) * (1.0 - smoothstep(Ro - 0.05, Ro + 0.25, r));
  // (les langues, contre la paroi)
  let cell = a * 34.0 / TAU;
  let fk = noise3(vec3f(cell * 1.7, lc.x * 0.8, lc.y * 0.8));
  let H = 0.45 + 0.75 * fk;
  let hgt = p.y - (bot - 0.15);
  let tongue = pow(0.5 + 0.5 * cos(TAU * cell + 2.0 * fk), 3.0) * exp(-pow((r - Ro - 0.1 - 0.15 * hgt) / 0.1, 2.0)) * smoothstep(H, H - 0.45, hgt) * step(0.0, hgt);
  let blue = vec3f(0.12, 0.3, 1.5);
  let tipc = vec3f(0.9, 0.55, 0.35);
  return (sheet * blue * 1.4 + tongue * mix(blue, tipc, smoothstep(0.2, 0.9, hgt / H) * 0.35)) * u.flow2.z;
}
fn flames(ro: vec3f, rd: vec3f, tEnd: f32) -> vec3f {
  if (u.flow2.z <= 0.0) { return vec3f(0.0); }
  let Ro = u.pot.x + u.pot.y; let bot = u.pot.w;
  let cb = cylV(ro.xz, rd.xz, Ro + 0.6);
  var t0 = max(cb.x, 0.0); var t1 = min(cb.y, tEnd);
  // (la tranche de hauteur des flammes)
  if (abs(rd.y) > 1e-5) {
    let ta = (bot - 0.35 - ro.y) / rd.y; let tb = (bot + 1.3 - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  }
  if (t1 <= t0) { return vec3f(0.0); }
  // (un segment tout entier dans le creuset ne croise pas de flamme)
  let ci = cylV(ro.xz, rd.xz, u.pot.x);
  if (ci.x <= t0 && ci.y >= t1) { return vec3f(0.0); }
  var c = vec3f(0.0);
  let ds = (t1 - t0) / 16.0;
  let j = hash31(vec3f(rd * 917.0 + u.misc.x));
  for (var k = 0; k < 16; k++) { c += flameAt(ro + rd * (t0 + (f32(k) + j) * ds)); }
  return c * ds * 2.2;
}

// un vecteur aléatoire par pixel et par image (satiné, lentille)
var<private> SEED: vec3f;
fn rnd3() -> vec3f {
  SEED = SEED + vec3f(0.618, 0.414, 0.732);
  return vec3f(hash31(SEED * 113.7), hash31(SEED.yzx * 71.3 + 4.1), hash31(SEED.zxy * 53.1 + 9.7)) * 2.0 - 1.0;
}
fn glossy(n: vec3f, r: f32) -> vec3f { return normalize(n + rnd3() * r); }

// une matière rugueuse (fonte, graphite, établi) : diffus + reflet adouci
fn rough(n: vec3f, rd: vec3f, alb: vec3f, spec: f32, soft: f32) -> vec3f {
  let cosi = clamp(-dot(rd, n), 0.0, 1.0);
  let F = spec + (1.0 - spec) * pow(1.0 - cosi, 5.0) * 0.5;
  return alb * irr(n) + F * env(reflect(rd, n), soft);
}

fn trace(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0; var rd = rd0;
  var T = vec3f(1.0); var L = vec3f(0.0);
  let Lv = u.tide.x;
  let Ro = u.pot.x + u.pot.y;
  for (var b = 0; b < 3; b++) {
    var tEnd = 0.0;
    MASK = rayMask(ro, rd, &tEnd);
    var hit = false; var mat = 0.0; var t = 0.002;
    // (le monde analytique d'abord : la marche s'arrête à sa surface)
    HN = vec3f(0.0, 1.0, 0.0);
    let W = world(ro, rd, 0.002);
    let wN = HN;
    if (MASK != 0u) {
      let tMax = min(tEnd, W.x + 0.05);
      var hb = vec2f(1e9, 0.0); var tb = t;
      for (var i = 0; i < 200; i++) {
        let h = scene(ro + rd * t);
        if (h.x < 0.0006 * t + 0.0005) { hit = true; mat = h.y; break; }
        if (h.x < hb.x) { hb = h; tb = t; }
        t += max(h.x * 0.8, 0.0008);
        if (t > tMax) { break; }
      }
      // (marche épuisée le long d'une paroi : le point le plus proche est la surface)
      if (!hit && t <= tMax && hb.x < 0.004) { hit = true; mat = hb.y; t = tb; }
    }
    // (les flammes, devant ce que le rayon touche)
    let tHit = select(W.x, t, hit);
    L += T * flames(ro, rd, min(tHit, 400.0));
    if (!hit) {
      if (W.x < 1e8) { t = W.x; hit = true; mat = W.y; }
      else { L += T * env(rd, 0.0); break; }
    }
    let p = ro + rd * t;
    var n = wN;
    if (mat == -1.0) { n = vec3f(0.0, 1.0, 0.0); if (MASK != 0u && abs(p.y - Lv) > 0.004) { n = nrm(p, 0.0015); } }
    // (une face fondue : le champ τ est fait de couches d'une cellule ; sa
    // normale se prend à l'échelle de la cellule, sinon elle se lit en zébrures)
    var meltF = 0.0;
    if (mat == -11.0) { n = nrm(p, 0.003); }
    if (mat >= 0.0) {
      let ci = i32(floor(mat / 16.0));
      meltF = crystalAt(p, ci).z;
      n = nrm(p, mix(0.0015, 1.3 * u.cr[${CS} * ci + 2].z, meltF));
    }
    var cosi = clamp(-dot(rd, n), 0.0, 1.0);
    var R = vec3f(0.62);
    var gl = 0.0;
    if (mat >= 0.0) {
      let i = i32(floor(mat / 16.0)); let kf = mat - f32(i) * 16.0;
      let k = floor(kf); let fr = kf - k;
      let A = u.cr[${CS} * i]; let B = u.cr[${CS} * i + 1]; let D = u.cr[${CS} * i + 3];
      // oxyde : il pousse dès que le métal sort du bain qu'on vide (hauteur dans
      // le repère du cristal) ; plus épais sur l'arête de chaque terrasse (plus
      // exposée, plus chaude), un peu plus vers le fond de la trémie ; la
      // chaleur du bain l'épaissit juste au-dessus de la ligne ; une face
      // fondue est du métal liquide, sans oxyde
      let age = max(u.st.x - emerge(p.y + D.x), 0.0);
      let sa = sqrt(age);
      let lip = (1.0 - fr) * (1.0 - fr);
      var th = u.st.y * 300.0 * sa * (0.8 + 0.4 * B.z) + (9.0 * k + 55.0 * lip) * sa
        + 40.0 * (noise3(p * 0.7 + B.w) - 0.5) * min(age * 6.0, 1.0) + 10.0 * (noise3(p * 6.0 + B.w) - 0.5) * min(age * 6.0, 1.0);
      th += u.tide.y * 140.0 * exp(-max(p.y - Lv, 0.0) / 0.9);
      let melted = meltF;
      R = mix(filmRGB(max(th, 0.0), cosi), filmRGB(8.0, cosi), melted);
      gl = mix(0.005, 0.002, melted); // (satiné : les terrasses ne sont pas des miroirs parfaits)
    } else if (mat == -1.0) {
      let th = poolFilm(p);
      n = normalize(n + (NOUT - vec3f(0.0, 1.0, 0.0)));
      cosi = clamp(-dot(rd, n), 0.0, 1.0);
      R = filmRGB(th, cosi);
      gl = 0.0; // (en rasant, le moindre dépoli du bain se lit en grain)
    } else {
      // matières rugueuses : la fonte du creuset, le panier, l'établi, le brûleur
      // (la fonte : un gris sombre marbré, plus mat par plaques)
      let mott = noise3(p * 2.3) * 0.5 + noise3(p * 13.0) * 0.5;
      var alb = vec3f(0.07, 0.066, 0.063) * (0.85 + 0.3 * mott); var spec = 0.06 * (0.8 + 0.4 * mott); var soft = 0.45 + 0.15 * (1.0 - mott);
      if (mat == -7.0) {
        // l'établi : une plaque d'acier huilé, rayée
        let g = noise3(vec3f(p.x * 1.2, p.z * 26.0, 2.0)) * 0.5 + noise3(p * 0.6) * 0.5;
        alb = vec3f(0.05, 0.05, 0.052) * (0.85 + 0.3 * g); spec = 0.05; soft = 0.35;
      }
      if (mat == -8.0 || mat == -9.0) { alb = vec3f(0.03); spec = 0.04; soft = 0.6; }
      if (mat == -11.0) {
        // la grille : de l'acier inoxydable, terni par le bain, un peu de bismuth
        // figé sur les fils, irisé depuis qu'il a quitté le bain
        let age = max(u.st.x - emerge(p.y - u.gal.w), 0.0);
        let tint = filmRGB(u.st.y * 120.0 * sqrt(age), 0.8);
        alb = mix(vec3f(0.05), tint * 0.12, 0.5); spec = 0.6; soft = 0.2;
      }
      var c = rough(n, rd, alb, spec, soft);
      // (l'ombre de la marmite et du brûleur sur l'établi : ils y sont posés)
      if (mat == -7.0) { let r = length(p.xz); c *= mix(0.12, 1.0, smoothstep(Ro * 0.75, Ro * 1.9, r)); }
      // (le pied de la paroi extérieure, près du brûleur, reçoit moins de jour)
      if (mat == -4.0) { c *= mix(0.45, 1.0, smoothstep(u.pot.w, u.pot.w + 1.5, p.y)); }
      // (la lueur des flammes sur ce qui les entoure)
      if (u.flow2.z > 0.0 && p.y < u.pot.w + 2.0) {
        let dr = abs(length(p.xz) - Ro * 0.8); let dy = max(p.y - u.pot.w, 0.0) + max(u.pot.w - 0.3 - p.y, 0.0) * 0.4;
        c += u.flow2.z * vec3f(0.08, 0.16, 0.6) * exp(-(dr * 0.6 + dy * 1.5));
      }
      // (le fond de la marmite, sous le bord : un peu d'ombre)
      if (mat == -2.0) { c *= 0.55 + 0.45 * smoothstep(Lv, u.pot.z, p.y); }
      L += T * c;
      break;
    }
    T *= R;
    let ng = select(n, glossy(n, gl), gl > 0.0);
    ro = p + n * 0.003; rd = reflect(rd, ng);
    if (dot(rd, n) < 0.0) { rd = reflect(rd, n); }
    // (un rayon encore pris dans les gradins au dernier rebond voit le studio, pas le noir)
    if (b == 2) { L += T * env(rd, 0.15); }
  }
  return L;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u.res.xy;
  if (f32(gid.x) >= res.x || f32(gid.y) >= res.y) { return; }
  SEED = vec3f(vec2f(gid.xy), u.misc.x * 0.37);
  let uv = (vec2f(gid.xy) + 0.5 + u.res.zw) / res;
  var ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = u.cam.w;
  let dir = normalize(u.camF.xyz + ndc.x * th * (res.x / res.y) * u.camR.xyz + ndc.y * th * u.camU.xyz);
  // la lentille mince : le point net est à la distance de mise au point
  let lo = (u.camR.xyz * u.lens.x + u.camU.xyz * u.lens.y) * u.lens.z;
  let fp = u.cam.xyz + dir * (u.lens.w / dot(dir, u.camF.xyz));
  let ro = u.cam.xyz + lo;
  let c = min(trace(ro, normalize(fp - ro)), vec3f(24.0));
  textureStore(outTex, vec2i(gid.xy), vec4f(c, 1.0));
}
`;

// L'anticrénelage : chaque image est décalée d'une fraction de pixel (suite de
// Halton) et d'un tirage du satiné, et fondue dans un historique, borné par
// le voisinage 3 × 3 de l'image courante (ce qui a bougé ne traîne pas ; un
// bornage plus lâche, par l'écart type, laissait passer le décalage d'une
// image à l'autre : les arêtes scintillaient, la caméra semblait bouger). Ni la caméra ni la grappe ne vont vite : sans reprojection,
// l'historique converge vers une image suréchantillonnée. Il repart de zéro
// après un saut (graine, temps, taille).
const RESOLVE = /* wgsl */ `
@group(0) @binding(0) var<uniform> R: vec4f; // part de l'image courante, largeur, hauteur
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var prev: texture_2d<f32>;
@group(0) @binding(3) var next: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;
fn tm(c: vec3f) -> vec3f { return c / (1.0 + max(c.x, max(c.y, c.z))); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - max(c.x, max(c.y, c.z)), 1e-4); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let q = vec2i(g.xy);
  if (f32(q.x) >= R.y || f32(q.y) >= R.z) { return; }
  let c = tm(textureLoad(cur, q, 0).rgb);
  var lo = c; var hi = c;
  for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) {
    let n = tm(textureLoad(cur, clamp(q + vec2i(a, b), vec2i(0), vec2i(i32(R.y) - 1, i32(R.z) - 1)), 0).rgb);
    lo = min(lo, n); hi = max(hi, n);
  } }
  let h = clamp(tm(textureLoad(prev, q, 0).rgb), lo, hi);
  let o = itm(mix(h, c, R.x));
  textureStore(next, q, vec4f(o, 1.0));
  textureStore(outTex, q, vec4f(o, 1.0));
}
`;
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export function createTracer(renderer) {
  const device = renderer.backend.device;
  const module = device.createShaderModule({ code: WGSL, label: 'traceur' });
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) if (m.type === 'error') console.error(`tracer ${m.lineNum}:${m.linePos} ${m.message}`);
  });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const rpipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: RESOLVE, label: 'anticrénelage' }), entryPoint: 'main' } });
  const rbuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let cur = null, hist = [null, null], frame = 0, last = null;
  const NV = NH + NB + MAXC * CS + MAXC;
  const U = new Float32Array(NV * 4);
  const ubuf = device.createBuffer({ size: U.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let tex = null, bind = null, W = 0, H = 0;
  function target(w, h) {
    if (tex && w === W && h === H) return tex;
    tex?.dispose();
    W = w; H = h;
    tex = new THREE.StorageTexture(w, h);
    tex.type = THREE.HalfFloatType; tex.format = THREE.RGBAFormat;
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    renderer.initTexture(tex);
    for (const t of [cur, ...hist]) t?.destroy();
    const mk = () => device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    cur = mk(); hist = [mk(), mk()]; last = null;
    bind = null;
    return tex;
  }
  const set = (i, a, b = 0, c = 0, d = 0) => U.set([a, b, c, d], i * 4);
  // p.melt : { texture (GPUTexture rg16float 3D), dims, crystals } de melt.js ;
  // p.world : creuset, grille, flamme, peau du bain (camera.js potFor, cycle.js apparatusAt, cool) ;
  // p.lens : échantillon de la lentille imposé (rendu accumulé), sinon tiré ici
  function run(p) {
    target(p.w, p.h);
    U.fill(0);
    // (rendu accumulé ou export : le décalage vient de l'accumulateur, sans historique)
    const external = p.jitter[0] !== 0 || p.jitter[1] !== 0;
    frame++;
    const fi = frame % 64 + 1;
    const jit = external ? p.jitter : [halton(fi, 2) - 0.5, halton(fi, 3) - 0.5];
    const lens = p.lens ?? (() => { const r = Math.sqrt(halton(fi, 5)), a = 2 * Math.PI * halton(fi, 7); return [r * Math.cos(a), r * Math.sin(a)]; })();
    set(0, p.w, p.h, jit[0], jit[1]);
    const key = [p.t, ...p.cam.pos];
    const jump = external || !last || Math.abs(key[0] - last[0]) > 0.01 || Math.hypot(key[1] - last[1], key[2] - last[2], key[3] - last[3]) > 0.05 || p.reset;
    last = key;
    set(1, ...p.cam.pos, p.cam.tanHalf); set(2, ...p.cam.f, 0); set(3, ...p.cam.r, 0); set(4, ...p.cam.u, 0);
    const mc = p.melt?.crystals;
    set(5, p.t, p.oxRate, p.habit, Math.min(MAXC, p.crystals.length));
    set(6, p.tide.L, p.tide.rising, p.tide.LH, p.tide.LOW);
    set(7, p.tide.T0, p.tide.T1, p.tide.T2, p.tide.T3);
    set(8, ...p.env.lo, 0); set(9, ...p.env.hi, 0);
    set(10, ...p.env.forge.color, p.env.forge.strength);
    set(11, ...(p.melt ? p.melt.dims : [1, 1, 1]), p.u);
    const w = p.world;
    set(12, w.pot.Ri, w.pot.th, w.pot.rim, w.pot.bottom);
    set(13, w.galette.r, w.galette.crust, w.galette.bar, w.galette.lift);
    set(14, w.cool.cover, w.cool.tear, 0, 0);
    set(15, 0, 0, w.flame, 0);
    set(16, lens[0], lens[1], p.aperture, p.focus);
    set(17, frame % 4096, 0, 0, w.pot.bench);
    p.env.boxes.slice(0, 6).forEach((b, k) => {
      set(NH + 3 * k, ...norm(b.dir), b.I); set(NH + 1 + 3 * k, ...b.color, b.hw); set(NH + 2 + 3 * k, ...(b.up ?? [0, 1, 0]), b.hh);
    });
    const cr0 = NH + NB, sk0 = cr0 + MAXC * CS;
    p.crystals.slice(0, MAXC).forEach((c, i) => {
      const m = mc?.[i], o = cr0 + CS * i;
      set(o, c.x, c.y, c.z, c.s);
      set(o + 1, c.ang, c.tilt, c.ox, c.seed);
      // (sans simulation : une grille d'une cellule où rien ne fond)
      if (m) { set(o + 2, m.ox, m.oz, m.h, m.X); set(o + 3, c.desc, m.nx, m.ny, m.nz); }
      else { set(o + 2, 0, 0, 1e3, 0); set(o + 3, c.desc, 1, 1, 1); }
      const k = c.topple;
      if (k) { set(o + 4, k.dir[0], k.dir[1], k.angle, k.neck); set(o + 5, k.pivot, k.shrink, k.sink, 0); }
      set(sk0 + i, c.skin, c.ripple ? c.ripple.x : 0, c.ripple ? c.ripple.z : 0, c.ripple ? c.ripple.dt : -1);
    });
    device.queue.writeBuffer(ubuf, 0, U);
    const gpuTex = renderer.backend.get(tex).texture;
    const mt = p.melt?.texture ?? p.blank;
    if (!bind || bind.tex !== gpuTex || bind.mt !== mt) {
      bind = { tex: gpuTex, mt, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: cur.createView() },
        { binding: 2, resource: mt.createView({ dimension: '3d' }) }, { binding: 3, resource: sampler }] }),
        res: [0, 1].map((k) => device.createBindGroup({ layout: rpipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: rbuf } }, { binding: 1, resource: cur.createView() },
          { binding: 2, resource: hist[k].createView() }, { binding: 3, resource: hist[1 - k].createView() },
          { binding: 4, resource: gpuTex.createView() }] })) };
    }
    device.queue.writeBuffer(rbuf, 0, new Float32Array([jump ? 1 : 0.1, p.w, p.h, 0]));
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind.group);
    pass.dispatchWorkgroups(Math.ceil(p.w / 8), Math.ceil(p.h / 8));
    pass.setPipeline(rpipe); pass.setBindGroup(0, bind.res[frame % 2]);
    pass.dispatchWorkgroups(Math.ceil(p.w / 8), Math.ceil(p.h / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
    return tex;
  }
  return { run, target, texture: () => tex };
}
function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
