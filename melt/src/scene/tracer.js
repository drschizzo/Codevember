// Le rendu : un lancer de rayons en shader de calcul WebGPU, qui écrit l'image
// HDR dans une texture three.js ; la chaîne d'image commune passe ensuite
// dessus (scene/stage.js). Essai d'origine : proto/b0.
//
// - Trémie : un cube dont chaque face est creusée en gradins vers le centre
//   (les arêtes poussent plus vite que le milieu des faces) ; variantes : en
//   spirale (chaque gradin tourne d'un cran), allongée.
// - Couleur : couche mince d'oxyde (Bi₂O₃, n ≈ 2,2) sur le métal
//   (n ≈ 1,9 + 3,4 i), réflectance d'Airy à six longueurs d'onde ; l'épaisseur
//   (0 à ~300 nm) vient du temps passé à l'air et de la chaleur du métal.
// - Le bain : un miroir de métal liquide ; la peau d'oxyde des cristaux engloutis
//   y flotte et se fend ; les chutes y font des rides.
// - Ce qui bouge est calculé côté JavaScript une fois par image (cycle.js) ;
//   chaque rayon ne visite que les cristaux dont la sphère englobante le croise,
//   et un rayon qui ne croise aucun cristal touche le bain analytiquement.
//
// Unités : cm ; y = 0 : la croûte du fond.
import * as THREE from 'three/webgpu';

export const MAXC = 12;

const WGSL = /* wgsl */ `
struct P {
  res: vec4f, cam: vec4f, camF: vec4f, camR: vec4f, camU: vec4f,
  st: vec4f,     // t, vitesse d'oxydation, port (0 trémie, 1 spirale, 2 allongée), nombre de cristaux
  tide: vec4f,   // niveau L, remontée (0–1), LH, LL
  times: vec4f,  // T0, T1, T2, T3
  envLo: vec4f, envHi: vec4f, // fond du studio (bas, haut)
  forge: vec4f,  // lueur de forge (couleur, force)
  boxes: array<vec4f, 18>,    // 6 boîtes : (direction, intensité), (couleur, demi-largeur), (haut, demi-hauteur)
  cr: array<vec4f, 36>,       // cristaux : (centre, demi-côté), (angle, inclinaison, oxyde, graine), (coin, cédé)
  pc: array<vec4f, 24>,       // coins tombés : (position, actif), (angle, rotation, demi-côté, —)
  dr: array<vec4f, 48>,       // gouttes : 4 par cristal, (position, rayon)
  sk: array<vec4f, 12>,       // peau (âge ou −1), ride (x, z, âge ou −1)
};
@group(0) @binding(0) var<uniform> u: P;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;

const PI = 3.14159265;
fn hash31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1,0,0)), w.x), mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), w.x), w.y),
             mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), w.x), mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), w.x), w.y), w.z);
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
fn sdBox(p: vec3f, b: vec3f) -> f32 { let q = abs(p) - b; return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0); }
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
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

// ── la trémie ──
fn hopper(q0: vec3f, s: f32, round: f32, fill: f32, cav: f32) -> vec2f {
  var q = q0;
  let lng = u.st.z > 1.5;
  if (lng) { q = vec3f(q0.x * 0.62, q0.y, q0.z); } // allongée (le long de x)
  let b = abs(q) - vec3f(s);
  let dbox = (length(max(b, vec3f(0.0))) + min(max(b.x, max(b.y, b.z)), 0.0) - round) * select(1.0, 0.62, lng);
  if (cav < 0.5) { return vec2f(dbox, 0.0); } // (au ras du métal, les gradins sont noyés : le ménisque enveloppe le bloc)
  let a = abs(q);
  var n = 0.0; var t = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) { n = a.x; t = q.yz; } else if (a.y >= a.z) { n = a.y; t = q.xz; } else { n = a.z; t = q.xy; }
  let w = s * 0.11;
  var tt = t;
  if (u.st.z > 0.5 && u.st.z < 1.5) { // spirale : chaque gradin tourne d'un cran
    let k0 = floor((s - max(abs(t.x), abs(t.y))) / w);
    let an = k0 * 0.07; let c = cos(an); let sn = sin(an);
    tt = vec2f(c * t.x - sn * t.y, sn * t.x + c * t.y);
  }
  let rim = s - max(abs(tt.x), abs(tt.y));
  let k = min(floor(rim / w), 7.0);
  let depth = k * w * 0.75 * (1.0 - fill); // (au plus ~0,55 du demi-côté ; la fonte comble les gradins)
  // (vraie distance : le fond du gradin, ou la paroi du gradin extérieur, plus
  // haut, à côté — sans elle, la marche traverse les parois et les normales
  // deviennent du bruit)
  var dcav = n - (s - depth);
  if (k > 0.5) {
    let up = (k - 1.0) * w * 0.75 * (1.0 - fill);
    let lat = rim - k * w;
    dcav = min(dcav, length(vec2f(lat, max(n - (s - up), 0.0))));
  }
  dcav *= select(1.0, 0.62, lng);
  return vec2f(max(dbox, dcav), k);
}

var<private> MASK: u32;
fn crystal(p: vec3f, i: i32, L: f32) -> vec2f {
  let A = u.cr[3 * i]; let B = u.cr[3 * i + 1]; let Cc = u.cr[3 * i + 2];
  let s = A.w;
  let q = rotX(rotY(p - A.xyz, B.x), B.y);
  // la fonte : au-dessus de la ligne de métal chaud, la part fondue (mp) arrondit
  // les arêtes, comble les gradins et fond le cristal sur lui-même, de bas en haut
  let mp = u.tide.y * exp(-max(p.y - L, 0.0) / 0.55);
  let soft = 0.42 * s * mp;
  let h = hopper(q, s - soft, soft * 0.8, clamp(mp * 1.6, 0.0, 1.0), select(0.0, 1.0, p.y > L + 0.1));
  var d = h.x;
  if (Cc.w > 0.5) { d = max(d, -sdBox(q - Cc.xyz, vec3f(s * 0.29, s * 0.12, s * 0.29))); } // l'entaille du coin tombé
  return vec2f(d, h.y);
}
fn piece(p: vec3f, i: i32) -> f32 {
  let A = u.pc[2 * i]; let B = u.pc[2 * i + 1];
  if (A.w < 0.5) { return 1e9; }
  let q = rotX(rotY(p - A.xyz, B.x), B.y);
  let he = vec3f(B.z * 0.26, B.z * 0.09, B.z * 0.26);
  return max(sdBox(q, he), -sdBox(q - vec3f(0.5, 0.5, 0.5) * he, he * vec3f(0.55, 0.6, 0.55))); // un gradin : une plaque creusée d'une marche
}
fn drips(p: vec3f, i: i32) -> f32 {
  var d = 1e9;
  for (var j = 0; j < 4; j++) {
    let D = u.dr[4 * i + j];
    if (D.w <= 0.0) { continue; }
    d = min(d, min(sdCapsule(p, D.xyz, D.xyz + vec3f(0.0, D.w * 1.6, 0.0), D.w), sdCapsule(p, D.xyz + vec3f(0.0, D.w, 0.0), D.xyz + vec3f(0.0, D.w * 2.6, 0.0), D.w * 0.6)));
  }
  return d;
}
// la scène : (distance, matière) ; matière ≥ 0 : cristal i·10 + gradin ; −1 : bain ; −2 : goutte
fn scene(p: vec3f) -> vec2f {
  let L = u.tide.x;
  let pool = p.y - L;
  var best = vec2f(1e9, -1.0);
  var dc = 1e9; var dd = 1e9;
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    if ((MASK & (1u << u32(i))) == 0u) { continue; }
    let c = crystal(p, i, L);
    if (c.x < best.x) { best = vec2f(c.x, f32(i) * 10.0 + c.y); }
    let pd = piece(p, i);
    if (pd < best.x) { best = vec2f(pd, f32(i) * 10.0); }
    dc = min(dc, min(c.x, pd));
    dd = min(dd, drips(p, i));
  }
  let k = 0.035 + 0.1 * u.tide.y;
  let d = smin(smin(dc, pool, k), dd, 0.04);
  if (dd < min(dc, pool) && dd < 0.02) { return vec2f(d, -2.0); }
  if (pool < dc - 0.5 * k) { return vec2f(d, -1.0); }
  return vec2f(d, best.y);
}
fn nrm(p: vec3f) -> vec3f {
  let e = 0.0015; let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * scene(p + k.xyy * e).x + k.yyx * scene(p + k.yyx * e).x + k.yxy * scene(p + k.yxy * e).x + k.xxx * scene(p + k.xxx * e).x);
}

// ── l'atelier : ce que le métal reflète ──
fn rect(d: vec3f, c: vec3f, up: vec3f, hw: f32, hh: f32) -> f32 {
  let cc = dot(d, c); if (cc <= 0.0) { return 0.0; }
  let r = normalize(cross(c, up)); let v = cross(r, c);
  let q = d / cc;
  return (1.0 - smoothstep(hw * 0.85, hw, abs(dot(q, r)))) * (1.0 - smoothstep(hh * 0.85, hh, abs(dot(q, v))));
}
fn env(d: vec3f) -> vec3f {
  // un dôme : sombre près de l'horizon (le bain, vu en rasant, reste un miroir noir), clair en hauteur
  // (les faces des cristaux, qui regardent le ciel, attrapent la lumière et montrent leur oxyde)
  var c = mix(u.envLo.xyz, u.envHi.xyz, smoothstep(0.12, 0.75, d.y));
  for (var b = 0; b < 6; b++) {
    let A = u.boxes[3 * b]; let B = u.boxes[3 * b + 1]; let Cb = u.boxes[3 * b + 2];
    if (A.w <= 0.0) { continue; }
    c += B.xyz * A.w * rect(d, A.xyz, Cb.xyz, B.w, Cb.w);
  }
  if (u.forge.w > 0.0) { c += u.forge.xyz * u.forge.w * smoothstep(0.25, -0.15, d.y) * (0.7 + 0.3 * noise3(d * 4.0)); }
  return c;
}

// ── couche mince d'oxyde sur le bismuth (Airy) ──
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2f, b: vec2f) -> vec2f { let d = dot(b, b); return vec2f(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
fn filmR(th: f32, lam: f32, cosi: f32) -> f32 {
  let n1 = 2.2; let n2 = vec2f(1.9, 3.4);
  let r01 = vec2f((1.0 - n1) / (1.0 + n1), 0.0);
  let r12 = cdiv(vec2f(n1, 0.0) - n2, vec2f(n1, 0.0) + n2);
  let sint = sqrt(max(0.0, 1.0 - cosi * cosi)) / n1;
  let dl = 4.0 * PI * n1 * th * sqrt(1.0 - sint * sint) / lam;
  let e = vec2f(cos(dl), sin(dl));
  let r = cdiv(r01 + cmul(r12, e), vec2f(1.0, 0.0) + cmul(r01, cmul(r12, e)));
  return dot(r, r);
}
fn filmRGB(th: f32, cosi: f32) -> vec3f {
  return vec3f(0.5 * filmR(th, 610.0, cosi) + 0.5 * filmR(th, 650.0, cosi),
               0.5 * filmR(th, 530.0, cosi) + 0.5 * filmR(th, 560.0, cosi),
               0.5 * filmR(th, 450.0, cosi) + 0.5 * filmR(th, 480.0, cosi));
}
fn emerge(y: f32) -> f32 { let T = u.times; return T.x + clamp((u.tide.z - y) / (u.tide.z - u.tide.w), 0.0, 1.0) * (T.y - T.x); }

// le bain : peau d'oxyde des cristaux engloutis (épaisseur), rides des chutes (normale)
var<private> NOUT: vec3f;
fn poolFilm(p: vec3f) -> f32 {
  var th = 10.0 + 14.0 * noise3(p * 0.8 + 0.5 * vec3f(cos(6.2831853 * u.st.x), 0.0, sin(6.2831853 * u.st.x)));
  var nn = vec3f(0.0, 1.0, 0.0);
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    let A = u.cr[3 * i]; let B = u.cr[3 * i + 1]; let S = u.sk[i];
    if (S.x > 0.0) {
      let age = S.x;
      let rel = p.xz - A.xz;
      let ca = cos(B.x); let sa = sin(B.x);
      let rl = vec2f(ca * rel.x - sa * rel.y, sa * rel.x + ca * rel.y);
      let R0 = A.w * (1.05 + 3.5 * age) * (0.8 + 0.4 * noise3(vec3f(rel * 3.0, B.w + 2.0)));
      let r = mix(max(abs(rl.x), abs(rl.y)), length(rel), smoothstep(0.0, 0.16, age));
      if (r < R0) {
        let warp = vec2f(noise3(vec3f(rel * 2.3, B.w)), noise3(vec3f(rel * 2.3, B.w + 7.0))) - 0.5;
        let vo = voro((rel + warp * A.w * 0.5) / (A.w * (0.75 + 1.4 * age)), B.w);
        if (vo.x >= 0.03 + 0.28 * smoothstep(0.02, 0.16, age)) {
          let fade = (1.0 - smoothstep(0.08, 0.16, age)) * (1.0 - smoothstep(0.8, 1.0, r / R0));
          let wr = noise3(vec3f(p.xz * 9.0, B.w));
          // (une seule peau, dont la couleur varie en dégradé — celle du cristal
          // englouti —, fendue en grandes plaques : une teinte au hasard par
          // plaque faisait des confettis)
          let grad = noise3(vec3f(rel / A.w * 0.9, B.w + 4.0));
          th = mix(th, 110.0 + 150.0 * grad + 18.0 * (hash31(vec3f(vo.y, 1.0, B.w)) - 0.5) + 25.0 * (wr - 0.5), fade);
          let e = 0.02;
          let gx = noise3(vec3f((p.xz + vec2f(e, 0.0)) * 9.0, B.w)) - wr;
          let gz = noise3(vec3f((p.xz + vec2f(0.0, e)) * 9.0, B.w)) - wr;
          nn += fade * vec3f(-gx, 0.0, -gz) * 3.5;
        }
      }
    }
    if (S.w > 0.0) {
      let rr = length(p.xz - S.yz) + 1e-4;
      let amp = 0.06 * (1.0 - S.w / 0.07) * exp(-rr * 2.8) * smoothstep(9.0 * S.w * 30.0 + 0.2, 9.0 * S.w * 30.0 - 0.6, rr);
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
    let A = u.cr[3 * i]; let P0 = u.pc[2 * i];
    var c = A.xyz; var R = A.w * select(2.0, 3.0, u.st.z > 1.5);
    if (P0.w > 0.5) { c = 0.5 * (A.xyz + P0.xyz); R += 0.5 * length(P0.xyz - A.xyz) + A.w * 0.5; }
    if (u.dr[4 * i].w > 0.0 || u.dr[4 * i + 1].w > 0.0) { R += A.w * 0.4; }
    let oc = ro - c; let b = dot(oc, rd); let cc = dot(oc, oc) - R * R;
    let disc = b * b - cc;
    if (disc > 0.0) { let t1 = -b + sqrt(disc); if (t1 > 0.0) { m |= (1u << u32(i)); te = max(te, t1); } }
  }
  *tEnd = te;
  return m;
}

fn trace(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0; var rd = rd0;
  var T = vec3f(1.0); var L = vec3f(0.0);
  let Lv = u.tide.x;
  for (var b = 0; b < 3; b++) {
    var tEnd = 0.0;
    MASK = rayMask(ro, rd, &tEnd);
    var hit = false; var mat = -3.0; var t = 0.002;
    if (MASK != 0u) {
      var hb = vec2f(1e9, 0.0); var tb = t;
      for (var i = 0; i < 160; i++) {
        let h = scene(ro + rd * t);
        if (h.x < 0.0006 * t + 0.0005) { hit = true; mat = h.y; break; }
        if (h.x < hb.x) { hb = h; tb = t; }
        t += max(h.x * 0.7, 0.0008);
        if (t > tEnd) { break; }
      }
      // (marche épuisée le long d'une paroi de gradin : le point le plus proche
      // est la surface ; le compter comme « rien touché » faisait des points de lumière)
      if (!hit && t <= tEnd && hb.x < 0.02) { hit = true; mat = hb.y; t = tb; }
    }
    if (!hit) {
      // au-delà des cristaux : le bain (un plan) ou le studio
      if (rd.y < -1e-4 && ro.y > Lv) { t = (Lv - ro.y) / rd.y; hit = true; mat = -1.0; }
      else { L += T * env(rd); break; }
    }
    let p = ro + rd * t;
    var n = vec3f(0.0, 1.0, 0.0);
    if (MASK != 0u && abs(p.y - Lv) > 0.004) { n = nrm(p); }
    var cosi = clamp(-dot(rd, n), 0.0, 1.0);
    var R = vec3f(0.62);
    if (mat >= 0.0) {
      let i = i32(floor(mat / 10.0)); let k = mat - f32(i) * 10.0;
      let B = u.cr[3 * i + 1];
      // oxyde : il pousse dès que le métal sort du bain ; quand le métal chaud
      // remonte, il s'épaissit juste au-dessus de la ligne ; le métal fondu, lui,
      // n'en a plus (argent liquide)
      let age = max(u.st.x - emerge(p.y), 0.0);
      var th = u.st.y * 300.0 * sqrt(age) * (0.85 + 0.3 * B.z) + 24.0 * k * sqrt(age) + 18.0 * (noise3(p * 2.5 + B.w) - 0.5) * min(age * 8.0, 1.0);
      th += u.tide.y * 220.0 * exp(-max(p.y - Lv, 0.0) / 0.9);
      let mp = u.tide.y * exp(-max(p.y - Lv, 0.0) / 0.55);
      R = mix(filmRGB(max(th, 0.0), cosi), filmRGB(8.0, cosi), smoothstep(0.45, 0.8, mp));
    } else if (mat < -1.5) {
      R = filmRGB(6.0, cosi);
    } else {
      let th = poolFilm(p);
      n = normalize(n + (NOUT - vec3f(0.0, 1.0, 0.0)));
      cosi = clamp(-dot(rd, n), 0.0, 1.0);
      R = filmRGB(th, cosi);
    }
    // réflexion légèrement dépolie (décalage par pixel et par image, moyenné par l'anticrénelage)
    // (miroir net : sans anticrénelage temporel, un dépoli aléatoire n'est que du bruit)
    var r = reflect(rd, n);
    T *= R;
    ro = p + n * 0.003; rd = r;
    // (un rayon encore pris dans les gradins au dernier rebond voit le studio, pas le noir)
    if (b == 2) { L += T * env(rd); }
  }
  return L;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u.res.xy;
  if (f32(gid.x) >= res.x || f32(gid.y) >= res.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5 + u.res.zw) / res;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = u.cam.w;
  let rd = normalize(u.camF.xyz + ndc.x * th * (res.x / res.y) * u.camR.xyz + ndc.y * th * u.camU.xyz);
  let c = min(trace(u.cam.xyz, rd), vec3f(24.0));
  textureStore(outTex, vec2i(gid.xy), vec4f(c, 1.0));
}
`;

export function createTracer(renderer) {
  const device = renderer.backend.device;
  const module = device.createShaderModule({ code: WGSL });
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) if (m.type === 'error') console.error(`tracer ${m.lineNum}:${m.linePos} ${m.message}`);
  });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  // (agencement : 11 vec4 d'en-tête, 18 boîtes, 36 cristaux, 24 coins, 48 gouttes, 12 peaux)
  const NV = 11 + 18 + 36 + 24 + 48 + 12;
  const U = new Float32Array(NV * 4);
  const ubuf = device.createBuffer({ size: U.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let tex = null, bind = null, W = 0, H = 0;
  function target(w, h) {
    if (tex && w === W && h === H) return tex;
    tex?.dispose();
    W = w; H = h;
    tex = new THREE.StorageTexture(w, h);
    tex.type = THREE.HalfFloatType; tex.format = THREE.RGBAFormat;
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    renderer.initTexture(tex);
    bind = null;
    return tex;
  }
  const set = (i, a, b = 0, c = 0, d = 0) => U.set([a, b, c, d], i * 4);
  function run(p) {
    target(p.w, p.h);
    U.fill(0);
    set(0, p.w, p.h, p.jitter[0], p.jitter[1]);
    set(1, ...p.cam.pos, p.cam.tanHalf); set(2, ...p.cam.f, 0); set(3, ...p.cam.r, 0); set(4, ...p.cam.u, 0);
    set(5, p.t, p.oxRate, p.habit, Math.min(MAXC, p.crystals.length));
    set(6, p.tide.L, p.tide.rising, p.tide.LH, p.tide.LL);
    set(7, p.tide.T0, p.tide.T1, p.tide.T2, p.tide.T3);
    set(8, ...p.env.lo, 0); set(9, ...p.env.hi, 0);
    set(10, ...p.env.forge.color, p.env.forge.strength);
    p.env.boxes.slice(0, 6).forEach((b, k) => {
      set(11 + 3 * k, ...norm(b.dir), b.I); set(12 + 3 * k, ...b.color, b.hw); set(13 + 3 * k, ...(b.up ?? [0, 1, 0]), b.hh);
    });
    const cr0 = 29, pc0 = cr0 + 36, dr0 = pc0 + 24, sk0 = dr0 + 48;
    p.crystals.slice(0, MAXC).forEach((c, i) => {
      set(cr0 + 3 * i, c.x, c.y, c.z, c.s);
      set(cr0 + 3 * i + 1, c.ang, c.tilt, c.ox, c.seed);
      set(cr0 + 3 * i + 2, ...c.cornerLocal, c.broken ? 1 : 0);
      if (c.piece) { set(pc0 + 2 * i, ...c.piece.pos, 1); set(pc0 + 2 * i + 1, c.piece.ang, c.piece.rot, c.piece.s, 0); }
      c.drips.slice(0, 4).forEach((d, j) => set(dr0 + 4 * i + j, ...d));
      set(sk0 + i, c.skin, c.ripple ? c.ripple.x : 0, c.ripple ? c.ripple.z : 0, c.ripple ? c.ripple.dt : -1);
    });
    device.queue.writeBuffer(ubuf, 0, U);
    const gpuTex = renderer.backend.get(tex).texture;
    if (!bind || bind.tex !== gpuTex) {
      bind = { tex: gpuTex, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: gpuTex.createView() }] }) };
    }
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind.group);
    pass.dispatchWorkgroups(Math.ceil(p.w / 8), Math.ceil(p.h / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
    return tex;
  }
  return { run, target, texture: () => tex };
}
function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
