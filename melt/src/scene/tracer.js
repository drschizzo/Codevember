// Le rendu : un lancer de rayons en shader de calcul WebGPU, qui écrit l'image
// HDR dans une texture three.js ; la chaîne d'image commune passe ensuite
// dessus (scene/stage.js). Essais d'origine : proto/b0 (l'image), proto/s0 (la
// fonte calculée).
//
// - Trémie : un cube dont chaque face est creusée en gradins vers le centre
//   (scene/hopper.js) ; variantes : en spirale, allongée.
// - La fonte : calculée au chargement (scene/melt.js) ; pour chaque cristal,
//   l'atlas 3D donne l'instant τ où chaque point fond et la vitesse du front
//   v. Le cristal à l'instant u de la fonte est { trémie } ∩ { τ > u }, de
//   distance max(trémie, (u − τ)·v) ; une face fondue est du métal liquide.
// - Couleur : couche mince d'oxyde (Bi₂O₃, n ≈ 2,2) sur le métal
//   (n ≈ 1,9 + 3,4 i), réflectance d'Airy à six longueurs d'onde ; l'épaisseur
//   vient du temps passé à l'air et de la chaleur du bain.
// - Le bain : un miroir de métal liquide ; la peau d'oxyde des cristaux
//   engloutis s'y étale et s'y défait ; un cristal qui se tasse le ride.
// - Chaque rayon ne visite que les cristaux dont la sphère englobante le croise ;
//   un rayon qui n'en croise aucun touche le bain analytiquement.
//
// Unités : cm ; y = 0 : la croûte du fond (repère de la grappe, avant sa descente).
import * as THREE from 'three/webgpu';
import { HOPPER_WGSL } from './hopper.js';

export const MAXC = 12;

const WGSL = HOPPER_WGSL + /* wgsl */ `
struct P {
  res: vec4f, cam: vec4f, camF: vec4f, camR: vec4f, camU: vec4f,
  st: vec4f,     // t, vitesse d'oxydation, port (0 trémie, 1 spirale, 2 allongée), nombre de cristaux
  tide: vec4f,   // niveau du bain, chaleur de la fonte (0–1), LH, LL
  times: vec4f,  // T0, T1, T2, T3
  envLo: vec4f, envHi: vec4f, // fond du studio (bas, haut)
  forge: vec4f,  // lueur de forge (couleur, force)
  atlas: vec4f,  // dimensions de l'atlas de la fonte, temps u de la fonte
  boxes: array<vec4f, 18>,    // 6 boîtes : (direction, intensité), (couleur, demi-largeur), (haut, demi-hauteur)
  cr: array<vec4f, 48>,       // cristaux : (centre, demi-côté), (angle, inclinaison, oxyde, graine),
                              // (origine x, z dans l'atlas, pas, demi-largeur de la grille), (descente, nx, ny, nz)
  sk: array<vec4f, 12>,       // peau (âge ou −1), ride (x, z, âge ou −1)
};
@group(0) @binding(0) var<uniform> u: P;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var meltT: texture_3d<f32>;
@group(0) @binding(3) var meltS: sampler;

const PI = 3.14159265;
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

// un cristal : (distance, gradin, part fondue de la surface)
fn crystalAt(p: vec3f, i: i32) -> vec3f {
  let A = u.cr[4 * i]; let B = u.cr[4 * i + 1]; let G = u.cr[4 * i + 2]; let D = u.cr[4 * i + 3];
  // (repère de la grille : la grappe est descendue de D.x)
  let pc = vec3f(p.x - A.x, p.y + D.x, p.z - A.z);
  let hk = hopperK(rotX(rotY(pc - vec3f(0.0, A.y, 0.0), B.x), B.y), A.w, u.st.z);
  if (hk.x > 0.05 * A.w + 0.02) { return vec3f(hk.x, hk.y, 0.0); }
  // la fonte calculée : τ (instant où le point fond) et v (vitesse du front)
  let g = clamp(vec3f((pc.x + G.w) / G.z, pc.y / G.z, (pc.z + G.w) / G.z), vec3f(0.5), D.yzw - vec3f(0.5));
  let F = textureSampleLevel(meltT, meltS, (vec3f(G.x, 0.0, G.y) + g) / u.atlas.xyz, 0.0).xy;
  let phi = (u.atlas.w - F.x) * F.y;
  return vec3f(max(hk.x, phi), hk.y, smoothstep(-0.006, 0.006, phi - hk.x));
}

var<private> MASK: u32;
// la scène : (distance, matière) ; matière ≥ 0 : cristal i·10 + gradin ; −1 : bain
fn scene(p: vec3f) -> vec2f {
  let pool = p.y - u.tide.x;
  var best = vec2f(1e9, -1.0);
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    if ((MASK & (1u << u32(i))) == 0u) { continue; }
    let c = crystalAt(p, i);
    if (c.x < best.x) { best = vec2f(c.x, f32(i) * 10.0 + c.y); }
  }
  let k = 0.03; // le ménisque : le bain mouille le cristal
  let d = smin(best.x, pool, k);
  if (pool < best.x - 0.5 * k) { return vec2f(d, -1.0); }
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

// le bain : peau d'oxyde des cristaux engloutis (épaisseur), rides des tassements (normale)
var<private> NOUT: vec3f;
fn poolFilm(p: vec3f) -> f32 {
  var th = 10.0 + 14.0 * noise3(p * 0.8 + 0.5 * vec3f(cos(6.2831853 * u.st.x), 0.0, sin(6.2831853 * u.st.x)));
  var nn = vec3f(0.0, 1.0, 0.0);
  let n = i32(u.st.w);
  for (var i = 0; i < n; i++) {
    let A = u.cr[4 * i]; let B = u.cr[4 * i + 1]; let S = u.sk[i];
    if (S.x > 0.0) {
      // la peau du cristal englouti : elle s'étale depuis l'endroit où il a
      // disparu (sans surgir d'un bloc), une seule pellicule en dégradé ; le
      // bain, chauffé par le bas, s'écoule en surface du centre vers les bords
      // et l'emporte ; elle se fend, et ses plaques rapetissent jusqu'à rien
      // avant la fin de sa vie (aucune ne disparaît d'un coup)
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
        // (la fente grandit au-delà du plus grand écart possible entre deux
        // germes : à 0,12, il ne reste rien ; la vie de la peau s'arrête à 0,14)
        let crack = 0.02 + 1.25 * smoothstep(0.015, 0.12, age);
        let edge = smoothstep(0.0, 0.05, vo.x - crack) * (1.0 - smoothstep(0.75, 1.0, r / R0));
        if (edge > 0.0) {
          // (les plis sont ceux de la peau : ils partent avec elle)
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
    let A = u.cr[4 * i]; let D = u.cr[4 * i + 3];
    let c = vec3f(A.x, A.y - D.x, A.z);
    let R = A.w * select(1.9, 2.5, u.st.z > 1.5);
    if (c.y + R < u.tide.x - 0.05) { continue; } // (tout entier sous le bain)
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
    // (le bain d'abord : la marche s'arrête à sa surface)
    var tp = 1e9; if (rd.y < -1e-4 && ro.y > Lv) { tp = (Lv - ro.y) / rd.y; }
    if (MASK != 0u) {
      let tMax = min(tEnd, tp + 0.05);
      var hb = vec2f(1e9, 0.0); var tb = t;
      for (var i = 0; i < 180; i++) {
        let h = scene(ro + rd * t);
        if (h.x < 0.0006 * t + 0.0005) { hit = true; mat = h.y; break; }
        if (h.x < hb.x) { hb = h; tb = t; }
        t += max(h.x * 0.7, 0.0008);
        if (t > tMax) { break; }
      }
      // (marche épuisée le long d'une paroi : le point le plus proche est la surface)
      if (!hit && t <= tMax && hb.x < 0.02) { hit = true; mat = hb.y; t = tb; }
    }
    if (!hit) {
      if (tp < 1e8) { t = tp; hit = true; mat = -1.0; }
      else { L += T * env(rd); break; }
    }
    let p = ro + rd * t;
    var n = vec3f(0.0, 1.0, 0.0);
    if (MASK != 0u && abs(p.y - Lv) > 0.004) { n = nrm(p); }
    var cosi = clamp(-dot(rd, n), 0.0, 1.0);
    var R = vec3f(0.62);
    if (mat >= 0.0) {
      let i = i32(floor(mat / 10.0)); let k = mat - f32(i) * 10.0;
      let B = u.cr[4 * i + 1]; let D = u.cr[4 * i + 3];
      // oxyde : il pousse dès que le métal sort du bain qu'on vide (hauteur dans
      // le repère du cristal) ; la chaleur du bain l'épaissit juste au-dessus de
      // la ligne ; une face fondue, elle, est du métal liquide, sans oxyde
      let age = max(u.st.x - emerge(p.y + D.x), 0.0);
      var th = u.st.y * 300.0 * sqrt(age) * (0.85 + 0.3 * B.z) + 24.0 * k * sqrt(age) + 18.0 * (noise3(p * 2.5 + B.w) - 0.5) * min(age * 8.0, 1.0);
      th += u.tide.y * 140.0 * exp(-max(p.y - Lv, 0.0) / 0.9);
      let melted = crystalAt(p, i).z;
      R = mix(filmRGB(max(th, 0.0), cosi), filmRGB(8.0, cosi), melted);
    } else {
      let th = poolFilm(p);
      n = normalize(n + (NOUT - vec3f(0.0, 1.0, 0.0)));
      cosi = clamp(-dot(rd, n), 0.0, 1.0);
      R = filmRGB(th, cosi);
    }
    // (miroir net : l'anticrénelage temporel moyenne les arêtes, un dépoli aléatoire n'y ajouterait que du bruit)
    T *= R;
    ro = p + n * 0.003; rd = reflect(rd, n);
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

// L'anticrénelage : chaque image est décalée d'une fraction de pixel (suite de
// Halton) et fondue dans un historique, borné par le voisinage de l'image
// courante (ce qui a bougé ne traîne pas). Ni la caméra ni la grappe ne vont
// vite : sans reprojection, l'historique converge vers une image
// suréchantillonnée. Il repart de zéro après un saut (graine, temps, taille).
const RESOLVE = /* wgsl */ `
@group(0) @binding(0) var<uniform> R: vec4f; // part de l'image courante, largeur, hauteur
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var prev: texture_2d<f32>;
@group(0) @binding(3) var next: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let q = vec2i(g.xy);
  if (f32(q.x) >= R.y || f32(q.y) >= R.z) { return; }
  let c = textureLoad(cur, q, 0).rgb;
  var lo = c; var hi = c;
  for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) {
    let n = textureLoad(cur, clamp(q + vec2i(a, b), vec2i(0), vec2i(i32(R.y) - 1, i32(R.z) - 1)), 0).rgb;
    lo = min(lo, n); hi = max(hi, n);
  } }
  let h = clamp(textureLoad(prev, q, 0).rgb, lo, hi);
  let o = mix(h, c, R.x);
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
  // (agencement : 12 vec4 d'en-tête, 18 boîtes, 48 cristaux, 12 peaux)
  const NV = 12 + 18 + 48 + 12;
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
  // p.melt : { texture (GPUTexture rg16float 3D), dims, crystals } de melt.js
  function run(p) {
    target(p.w, p.h);
    U.fill(0);
    // (rendu accumulé ou export : le décalage vient de l'accumulateur, sans historique)
    const external = p.jitter[0] !== 0 || p.jitter[1] !== 0;
    frame++;
    const jit = external ? p.jitter : [halton(frame % 64 + 1, 2) - 0.5, halton(frame % 64 + 1, 3) - 0.5];
    set(0, p.w, p.h, jit[0], jit[1]);
    const key = [p.t, ...p.cam.pos];
    const jump = external || !last || Math.abs(key[0] - last[0]) > 0.01 || Math.hypot(key[1] - last[1], key[2] - last[2], key[3] - last[3]) > 0.05 || p.reset;
    last = key;
    set(1, ...p.cam.pos, p.cam.tanHalf); set(2, ...p.cam.f, 0); set(3, ...p.cam.r, 0); set(4, ...p.cam.u, 0);
    const mc = p.melt?.crystals;
    set(5, p.t, p.oxRate, p.habit, Math.min(MAXC, p.crystals.length));
    set(6, p.tide.L, p.tide.rising, p.tide.LH, p.tide.LL);
    set(7, p.tide.T0, p.tide.T1, p.tide.T2, p.tide.T3);
    set(8, ...p.env.lo, 0); set(9, ...p.env.hi, 0);
    set(10, ...p.env.forge.color, p.env.forge.strength);
    set(11, ...(p.melt ? p.melt.dims : [1, 1, 1]), p.u);
    p.env.boxes.slice(0, 6).forEach((b, k) => {
      set(12 + 3 * k, ...norm(b.dir), b.I); set(13 + 3 * k, ...b.color, b.hw); set(14 + 3 * k, ...(b.up ?? [0, 1, 0]), b.hh);
    });
    const cr0 = 30, sk0 = cr0 + 48;
    p.crystals.slice(0, MAXC).forEach((c, i) => {
      const m = mc?.[i];
      set(cr0 + 4 * i, c.x, c.y, c.z, c.s);
      set(cr0 + 4 * i + 1, c.ang, c.tilt, c.ox, c.seed);
      // (sans simulation : une grille d'une cellule où rien ne fond)
      if (m) { set(cr0 + 4 * i + 2, m.ox, m.oz, m.h, m.X); set(cr0 + 4 * i + 3, c.desc, m.nx, m.ny, m.nz); }
      else { set(cr0 + 4 * i + 2, 0, 0, 1e3, 0); set(cr0 + 4 * i + 3, c.desc, 1, 1, 1); }
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
    device.queue.writeBuffer(rbuf, 0, new Float32Array([jump ? 1 : 0.12, p.w, p.h, 0]));
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
