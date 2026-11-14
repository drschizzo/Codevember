// Essai d'image : cristaux de bismuth en trémie, irisés par leur oxyde, dans
// un bain de bismuth fondu (un miroir). Lancer de rayons en WebGPU brut.
//
// - Trémie : un cube dont chaque face est creusée en gradins vers le centre
//   (les arêtes poussent plus vite que le milieu des faces).
// - Couleur : couche mince d'oxyde (Bi₂O₃, n ≈ 2,2) sur le métal (n ≈ 1,9 + 3,4 i),
//   réflectance d'Airy à trois longueurs d'onde ; l'épaisseur (20 à 250 nm)
//   croît avec le temps passé à l'air chaud : or, pourpre, bleu, vert.
// - Fonte (melt) : les cristaux s'arrondissent, s'enfoncent et se fondent dans
//   le bain par un raccord doux (ménisque).
//
// URL : ?all (planche), ?melt=0..1 &ox=0..1
const params = new URLSearchParams(location.search);
const W = 1280, H = 800;

const SHADER = /* wgsl */ `
struct U {
  res: vec4f,     // w, h, image, passes
  cam: vec4f,     // position, tan(fov/2)
  tgt: vec4f,     // cible, ouverture (flou)
  st: vec4f,      // temps du cycle t, vitesse d'oxydation, port du cristal (0 trémie, 1 spirale, 2 ziggourat), foyer
  cr: array<vec4f, 16>, // 8 cristaux : (centre, demi-côté), (angle, inclinaison, décalage d'oxyde, graine)
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> acc: array<vec4f>;

const PI = 3.14159265;
fn hash31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1,0,0)), w.x), mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), w.x), w.y),
             mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), w.x), mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), w.x), w.y), w.z);
}
var<private> rngS: u32;
fn rnd() -> f32 { rngS = rngS * 747796405u + 2891336453u; var w = ((rngS >> ((rngS >> 28u) + 4u)) ^ rngS) * 277803737u; w = (w >> 22u) ^ w; return f32(w) / 4294967295.0; }

fn smin(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// ── La marée de métal (la liberté) : haut (tout est couvert), descente, bas,
// remontée. Le niveau baisse linéairement de LH à LL entre T0 et T1, remonte
// entre T2 et T3. Le métal sort du bain à t_e(y) et s'oxyde dès lors.
const LH = 2.9; const LL = 0.22;
const T0 = 0.06; const T1 = 0.30; const T2 = 0.60; const T3 = 0.86;
fn level(t: f32) -> f32 {
  if (t < T0) { return LH; }
  if (t < T1) { return mix(LH, LL, (t - T0) / (T1 - T0)); }
  if (t < T2) { return LL; }
  if (t < T3) { return mix(LL, LH, (t - T2) / (T3 - T2)); }
  return LH;
}
fn emerge(y: f32) -> f32 { return T0 + clamp((LH - y) / (LH - LL), 0.0, 1.0) * (T1 - T0); }
fn rising() -> f32 { return clamp((u.st.x - T2) / (T3 - T2), 0.0, 1.0) * select(0.0, 1.0, u.st.x < T3 + 0.02); }

// Une trémie : distance approchée et indice du gradin
fn hopper(q: vec3f, s: f32, round: f32, fill: f32, cav: f32) -> vec2f {
  let b = abs(q) - vec3f(s);
  let dbox = length(max(b, vec3f(0.0))) + min(max(b.x, max(b.y, b.z)), 0.0) - round;
  let a = abs(q);
  var n = 0.0; var t = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) { n = a.x; t = q.yz; } else if (a.y >= a.z) { n = a.y; t = q.xz; } else { n = a.z; t = q.xy; }
  // port : une spirale tourne chaque gradin d'un cran
  var tt = t;
  let w = s * 0.11;
  if (u.st.z > 0.5 && u.st.z < 1.5) {
    let k0 = floor((s - max(abs(t.x), abs(t.y))) / w);
    let a = k0 * 0.07; let c = cos(a); let sn = sin(a);
    tt = vec2f(c * t.x - sn * t.y, sn * t.x + c * t.y);
  }
  let rim = s - max(abs(tt.x), abs(tt.y));
  let k = min(floor(rim / w), 7.0);
  var depth = k * w * 0.75 * (1.0 - fill); // (au plus ~0,55 du demi-côté ; la fonte comble les gradins)
  if (u.st.z > 1.5) { depth = -k * w * 0.55; } // ziggourat : les gradins montent au lieu de creuser
  let dcav = n - (s - depth);
  if (cav < 0.5) { return vec2f(dbox, 0.0); } // (au ras du métal liquide, les gradins sont noyés : le ménisque enveloppe le bloc)
  return vec2f(max(dbox, dcav), k);
}
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }

// la scène : (distance, matière) ; matière ≥ 0 : cristal i·10 + gradin ; −1 : bain
// Voronoï 2D : (F2 − F1, identifiant de la cellule la plus proche)
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

// La marche qui se décroche : quand la fonte atteint le milieu d'un cristal, un
// coin du haut (un gradin) cède, glisse, bascule et tombe dans le bain
fn breakT(A: vec4f) -> f32 { return T2 + (T3 - T2) * clamp((A.y - LL) / (LH - LL), 0.0, 1.0) + 0.015; }
fn cornerLocal(A: vec4f, B: vec4f) -> vec3f {
  let sx = select(-1.0, 1.0, fract(B.w * 0.71) > 0.5); let sz = select(-1.0, 1.0, fract(B.w * 0.53) > 0.5);
  return vec3f(sx * A.w * 0.72, A.w * 0.9, sz * A.w * 0.72);
}
fn sdBox(p: vec3f, b: vec3f) -> f32 { let q = abs(p) - b; return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0); }
fn pieceDist(p: vec3f, A: vec4f, B: vec4f, L: f32) -> f32 {
  let tau = u.st.x - breakT(A);
  if (tau <= 0.0) { return 1e9; }
  let c0 = cornerLocal(A, B);
  let w0 = A.xyz + rotY(c0, -B.x);
  let out = normalize(vec3f(rotY(vec3f(c0.x, 0.0, c0.z), -B.x).x, 0.0, rotY(vec3f(c0.x, 0.0, c0.z), -B.x).z));
  let pos = w0 + out * (9.0 * tau) - vec3f(0.0, 1400.0 * tau * tau, 0.0);
  if (pos.y < L - 0.4) { return 1e9; }
  let q = rotX(rotY(p - pos, B.x), 18.0 * tau * sign(c0.z));
  // un gradin : une plaque en L creusée d'une marche
  let he = vec3f(A.w * 0.26, A.w * 0.09, A.w * 0.26);
  return max(sdBox(q, he), -sdBox(q - vec3f(-sign(c0.x), 1.0, -sign(c0.z)) * he * 0.5, he * vec3f(0.55, 0.6, 0.55)));
}

// l'affaissement : quand le métal chaud atteint la base d'un cristal, son pied
// fond, et le cristal s'enfonce en penchant du côté qui a cédé le premier
fn collapse(A: vec4f) -> f32 {
  let tBase = T2 + (T3 - T2) * clamp((A.y - A.w * 0.6 - LL) / (LH - LL), 0.0, 1.0);
  return smoothstep(tBase, tBase + 0.09, u.st.x);
}
fn crystalFrame(p: vec3f, A: vec4f, B: vec4f) -> vec3f {
  let c = collapse(A);
  let sink = A.w * 0.55 * c;
  let lean = (0.45 * c) * select(-1.0, 1.0, fract(B.w * 0.37) > 0.5);
  return rotX(rotY(p - (A.xyz - vec3f(0.0, sink, 0.0)), B.x), B.y + lean);
}

// les gouttes : l'argent fondu perle aux arêtes et coule le long des faces
// jusqu'au bain (cinq par cristal, pendant la remontée du métal chaud)
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
fn drips(p: vec3f, L: f32) -> f32 {
  let rs = rising();
  if (rs <= 0.0) { return 1e9; }
  var d = 1e9;
  for (var i = 0; i < 8; i++) {
    let A = u.cr[2 * i]; let B = u.cr[2 * i + 1];
    if (A.w <= 0.0) { continue; }
    let s = A.w;
    if (abs(p.x - A.x) > 2.0 * s || abs(p.z - A.z) > 2.0 * s) { continue; }
    for (var j = 0; j < 7; j++) {
      let hj = hash31(vec3f(f32(i), f32(j), B.w));
      let hk = hash31(vec3f(f32(j), B.w, 3.1));
      let face = floor(hj * 4.0);
      let ang = B.x + face * PI * 0.5;
      let nf = vec3f(sin(ang), 0.0, cos(ang)); let tf = vec3f(cos(ang), 0.0, -sin(ang));
      // chaque goutte naît quand la fonte atteint sa hauteur, puis glisse
      let y0 = A.y + s * (0.2 + 0.6 * hk);
      let tStart = T2 + (T3 - T2) * clamp((y0 - 0.5 - LL) / (LH - LL), 0.0, 1.0);
      let age = u.st.x - tStart;
      if (age <= 0.0) { continue; }
      let cl = collapse(A);
      if (cl > 0.35) { continue; } // (le cristal s'affaisse : ses gouttes rejoignent le bain avec lui)
      let fall = y0 - age * 6.0 * s - A.w * 0.55 * cl;
      if (fall < L - 0.03 || y0 < L) { continue; } // arrivée au bain : la goutte s'y fond
      let y = fall;
      let base = vec3f(A.x, 0.0, A.z) + nf * (s * 1.02) + tf * ((hj * 4.0 - face - 0.5) * 1.5 * s);
      let r = s * (0.1 + 0.06 * hk) * min(age * 14.0, 1.0);
      d = min(d, min(sdCapsule(p, base + vec3f(0.0, y, 0.0), base + vec3f(0.0, y + r * 1.6, 0.0), r), sdCapsule(p, base + vec3f(0.0, y + r, 0.0), base + vec3f(0.0, y + r * 2.6, 0.0), r * 0.6))); // une perle et sa traîne
    }
  }
  return d;
}

fn scene(p: vec3f) -> vec2f {
  let L = level(u.st.x);
  let pool = p.y - L;
  let floorD = p.y; // la croûte du fond
  var best = vec2f(1e9, -1.0);
  var dc = 1e9;
  let rs = rising();
  for (var i = 0; i < 8; i++) {
    let A = u.cr[2 * i]; let B = u.cr[2 * i + 1];
    if (A.w <= 0.0) { continue; }
    let s = A.w;
    let q = crystalFrame(p, A, B);
    // la fonte : le métal chaud qui remonte chauffe le cristal par le bas ; au-dessus
    // de la ligne, la part fondue (mp) arrondit les arêtes, comble les gradins et
    // fait fondre le cristal sur lui-même, de bas en haut
    let mp = rs * exp(-max(p.y - L, 0.0) / 0.55);
    let soft = 0.42 * s * mp;
    let cav = select(0.0, 1.0, p.y > L + 0.1);
    let h = hopper(q, s - soft, soft * 0.8, clamp(mp * 1.6, 0.0, 1.0), cav);
    var hx = h.x;
    if (u.st.x > breakT(A)) { hx = max(hx, -sdBox(q - cornerLocal(A, B), vec3f(A.w * 0.29, A.w * 0.12, A.w * 0.29))); } // l'entaille
    let pd = pieceDist(p, A, B, L);
    if (hx < best.x) { best = vec2f(hx, f32(i) * 10.0 + h.y); }
    if (pd < best.x) { best = vec2f(pd, f32(i) * 10.0); }
    dc = min(dc, min(hx, pd));
  }
  dc = min(dc, floorD + 0.4); // (la croûte, sous le bain)
  let dd = drips(p, L);
  let k = 0.035 + 0.1 * rs;
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
  // un studio sombre et cinq grandes boîtes à lumière : chaque facette en attrape une,
  // et le métal liquide les reflète en rectangles nets
  var c = mix(vec3f(0.012, 0.012, 0.014), vec3f(0.06, 0.06, 0.068), smoothstep(-0.1, 1.0, d.y));
  c += vec3f(0.8, 0.82, 0.86) * 0.9 * rect(d, normalize(vec3f(0.1, 0.12, 1.0)), vec3f(0.0, 1.0, 0.0), 0.8, 0.12); // débouchage bas, de face
  c += vec3f(1.0, 0.98, 0.95) * 4.0 * rect(d, normalize(vec3f(-0.7, 0.6, 0.4)), vec3f(0.0, 1.0, 0.0), 0.35, 0.5);
  c += vec3f(0.95, 0.97, 1.0) * 3.0 * rect(d, normalize(vec3f(0.75, 0.55, 0.25)), vec3f(0.0, 1.0, 0.0), 0.25, 0.45);
  c += vec3f(1.0, 0.99, 0.97) * 3.5 * rect(d, normalize(vec3f(0.05, 0.98, 0.15)), vec3f(0.0, 0.0, 1.0), 0.6, 0.3);
  c += vec3f(1.0, 0.86, 0.7) * 2.2 * rect(d, normalize(vec3f(0.2, 0.3, -1.0)), vec3f(0.0, 1.0, 0.0), 0.9, 0.025);
  c += vec3f(0.85, 0.9, 1.0) * 2.5 * rect(d, normalize(vec3f(-0.3, 0.25, 1.0)), vec3f(0.0, 1.0, 0.0), 0.5, 0.2);
  if (u.res.w > 0.5) {
    // forge : le métal chaud au loin rougeoie sous l'horizon, les boîtes se réchauffent
    c = c * vec3f(1.15, 0.92, 0.72) + vec3f(1.6, 0.45, 0.08) * 0.35 * smoothstep(0.25, -0.15, d.y) * (0.7 + 0.3 * noise3(d * 4.0));
  }
  return c;
}

// ── couche mince d'oxyde sur le bismuth (Airy, incidence quasi normale aux interfaces) ──
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2f, b: vec2f) -> vec2f { let d = dot(b, b); return vec2f(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
fn filmR(th: f32, lam: f32, cosi: f32) -> f32 {
  let n1 = 2.2;
  let n2 = vec2f(1.9, 3.4); // bismuth
  let r01 = vec2f((1.0 - n1) / (1.0 + n1), 0.0);
  let r12 = cdiv(vec2f(n1, 0.0) - n2, vec2f(n1, 0.0) + n2);
  let sint = sqrt(max(0.0, 1.0 - cosi * cosi)) / n1;
  let cost = sqrt(1.0 - sint * sint);
  let dl = 4.0 * PI * n1 * th * cost / lam;
  let e = vec2f(cos(dl), sin(dl));
  let num = r01 + cmul(r12, e);
  let den = vec2f(1.0, 0.0) + cmul(r01, cmul(r12, e));
  let r = cdiv(num, den);
  return dot(r, r);
}
fn filmRGB(th: f32, cosi: f32) -> vec3f {
  // trois longueurs d'onde pondérées (rouge, vert, bleu) + un peu de leur voisinage
  return vec3f(
    0.5 * filmR(th, 610.0, cosi) + 0.5 * filmR(th, 650.0, cosi),
    0.5 * filmR(th, 530.0, cosi) + 0.5 * filmR(th, 560.0, cosi),
    0.5 * filmR(th, 450.0, cosi) + 0.5 * filmR(th, 480.0, cosi));
}

fn trace(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0; var rd = rd0;
  var T = vec3f(1.0); var L = vec3f(0.0);
  for (var b = 0; b < 4; b++) {
    var t = 0.002; var hit = false; var mat = -2.0;
    for (var i = 0; i < 200; i++) {
      let h = scene(ro + rd * t);
      if (h.x < 0.0006 * t + 0.0005) { hit = true; mat = h.y; break; }
      t += max(h.x * 0.6, 0.0008);
      if (t > 60.0) { break; }
    }
    if (!hit) { L += T * env(rd); break; }
    let p = ro + rd * t;
    let n = nrm(p);
    let cosi = clamp(-dot(rd, n), 0.0, 1.0);
    var R = vec3f(0.62);
    var n2 = n;
    var rough = 0.01;
    if (mat >= 0.0) {
      let i = i32(floor(mat / 10.0)); let k = mat - f32(i) * 10.0;
      let B = u.cr[2 * i + 1];
      // épaisseur de l'oxyde (nm) : le temps à l'air chaud, plus pour les gradins
      // du fond (formés plus tôt), plus une marbrure
      // oxyde : il pousse dès que le métal sort du bain (en racine du temps),
      // plus vite sur les gradins du fond ; quand le bain remonte, la chaleur du
      // métal liquide l'épaissit juste au-dessus de la ligne
      let L = level(u.st.x);
      let age = max(u.st.x - emerge(p.y), 0.0);
      var th = u.st.y * 300.0 * sqrt(age) * (0.85 + 0.3 * B.z) + 6.0 * k * sqrt(age) * 4.0 + 18.0 * (noise3(p * 2.5 + B.w) - 0.5) * min(age * 8.0, 1.0);
      th += rising() * 220.0 * exp(-max(p.y - L, 0.0) / 0.9);
      // le métal fondu : l'oxyde se dissout, la surface devient un argent liquide
      let mp = rising() * exp(-max(p.y - L, 0.0) / 0.55);
      R = mix(filmRGB(max(th, 0.0), cosi), filmRGB(8.0, cosi), smoothstep(0.45, 0.8, mp));
      rough = mix(0.025, 0.004, smoothstep(0.45, 0.8, mp));
    } else if (mat < -1.5) {
      // une goutte : argent liquide
      R = filmRGB(6.0, cosi); rough = 0.002;
    } else {
      // le bain : métal neuf, une peau d'oxyde à peine dorée
      var th = 10.0 + 14.0 * noise3(p * 0.8 + vec3f(0.0, 0.0, u.st.x * 3.0));
      var nn = n;
      // la peau d'oxyde d'un cristal survit un instant au métal : quand le haut du
      // cristal passe sous la ligne, elle s'étale en pellicule irisée et froissée,
      // se fend en écailles qui s'écartent, puis se dissout
      for (var i = 0; i < 8; i++) {
        let A = u.cr[2 * i]; let B = u.cr[2 * i + 1];
        if (A.w <= 0.0) { continue; }
        let top = A.y + A.w * 1.1;
        let tSub = T2 + (T3 - T2) * clamp((top - LL) / (LH - LL), 0.0, 1.0);
        let age = u.st.x - tSub;
        if (age <= 0.0 || age > 0.16) { continue; }
        let rel = p.xz - A.xz;
        // l'empreinte du cristal (un carré tourné comme lui), qui s'étale et se déchire
        let ca = cos(B.x); let sa = sin(B.x);
        let rl = vec2f(ca * rel.x - sa * rel.y, sa * rel.x + ca * rel.y);
        let sq = max(abs(rl.x), abs(rl.y));
        let R0 = A.w * (1.05 + 3.5 * age) * (0.8 + 0.4 * noise3(vec3f(rel * 3.0, B.w + 2.0)));
        let r = mix(sq, length(rel), smoothstep(0.0, 0.16, age));
        if (r > R0) { continue; }
        // écailles : des cellules qui s'écartent en laissant des fissures d'argent
        // (cellules déformées : des écailles irrégulières, pas une grille)
        let warp = vec2f(noise3(vec3f(rel * 2.3, B.w)), noise3(vec3f(rel * 2.3, B.w + 7.0))) - 0.5;
        let vo = voro((rel + warp * A.w * 0.5) / (A.w * (0.38 + 1.6 * age)), B.w);
        let cid = vec2f(vo.y, B.w);
        if (vo.x < 0.04 + 0.5 * smoothstep(0.02, 0.16, age)) { continue; } // les fissures s'ouvrent : l'argent apparaît
        let fade = 1.0 - smoothstep(0.08, 0.16, age);
        let wr = noise3(vec3f(p.xz * 9.0, B.w));
        th = mix(th, 90.0 + 160.0 * hash31(vec3f(cid, 1.0)) + 70.0 * wr, fade * (1.0 - smoothstep(0.8, 1.0, r / R0)));
        // froissure : la normale suit les plis de la pellicule
        let e = 0.02;
        let gx = noise3(vec3f((p.xz + vec2f(e, 0.0)) * 9.0, B.w)) - wr;
        let gz = noise3(vec3f((p.xz + vec2f(0.0, e)) * 9.0, B.w)) - wr;
        nn = normalize(n + fade * vec3f(-gx, 0.0, -gz) * 6.0);
      }
      // les rides de la chute des gradins
      for (var i = 0; i < 8; i++) {
        let A = u.cr[2 * i]; let B = u.cr[2 * i + 1];
        if (A.w <= 0.0) { continue; }
        let c0 = cornerLocal(A, B);
        let w0 = A.xyz + rotY(c0, -B.x);
        let L2 = level(u.st.x);
        let ti = breakT(A) + sqrt(max(w0.y - L2, 0.0) / 1400.0);
        let dt = u.st.x - ti;
        if (dt <= 0.0 || dt > 0.07) { continue; }
        let outv = normalize(vec2f(rotY(vec3f(c0.x, 0.0, c0.z), -B.x).x, rotY(vec3f(c0.x, 0.0, c0.z), -B.x).z));
        let imp = w0.xz + outv * 9.0 * (ti - breakT(A));
        let rr = length(p.xz - imp) + 1e-4;
        let amp = 0.06 * (1.0 - dt / 0.07) * exp(-rr * 2.8) * smoothstep(9.0 * dt * 30.0 + 0.2, 9.0 * dt * 30.0 - 0.6, rr); // (le front ne dépasse pas la distance parcourue)
        let g = cos(30.0 * rr - 900.0 * dt) * amp;
        nn = normalize(nn + vec3f((p.xz - imp).x / rr * g, 0.0, (p.xz - imp).y / rr * g));
      }
      R = filmRGB(th, max(-dot(rd, nn), 0.0));
      rough = select(0.004, 0.02, th > 40.0);
      n2 = nn;
    }
    // réflexion (métal), légèrement dépolie
    var r = reflect(rd, n2);
    r = normalize(r + rough * (vec3f(rnd(), rnd(), rnd()) - 0.5));
    if (dot(r, n) < 0.0) { r = reflect(r, n); }
    T *= R;
    ro = p + n * 0.003; rd = r;
    // le lointain se perd dans le noir
    L += T * 0.0;
  }
  return L;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u.res.xy;
  if (f32(gid.x) >= res.x || f32(gid.y) >= res.y) { return; }
  rngS = gid.x * 1973u + gid.y * 9277u + u32(u.res.z) * 26699u + 1u;
  let jit = vec2f(rnd(), rnd()) - 0.5;
  let uv = (vec2f(gid.xy) + 0.5 + jit) / res;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let cp = u.cam.xyz; let f = normalize(u.tgt.xyz - cp);
  let rg = normalize(cross(f, vec3f(0.0, 1.0, 0.0))); let up = cross(rg, f);
  let th = u.cam.w;
  var rd = normalize(f + ndc.x * th * (res.x / res.y) * rg + ndc.y * th * up);
  // profondeur de champ
  let foc = u.st.w; let ap = u.tgt.w;
  let a = rnd() * 2.0 * PI; let rr = sqrt(rnd()) * ap;
  let off = (rg * cos(a) + up * sin(a)) * rr;
  let fp = cp + rd * foc;
  let ro = cp + off; rd = normalize(fp - ro);
  var c = trace(ro, rd);
  c = min(c, vec3f(20.0));
  let idx = gid.y * u32(res.x) + gid.x;
  if (u.res.z < 0.5) { acc[idx] = vec4f(c, 1.0); } else { acc[idx] += vec4f(c, 1.0); }
}
`;

const SHOW = /* wgsl */ `
@group(0) @binding(0) var<storage, read> acc: array<vec4f>;
@group(0) @binding(1) var<uniform> info: vec4f; // w, h, exposition
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var P = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(P[i], 0.0, 1.0);
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let i = u32(fc.y) * u32(info.x) + u32(fc.x);
  let a = acc[i];
  var c = a.rgb / max(a.w, 1.0) * info.z;
  let q = fc.xy / info.xy - 0.5;
  c *= 1.0 - 0.4 * dot(q, q);
  return vec4f(pow(aces(c), vec3f(1.0 / 2.2)), 1.0);
}
`;

// une grappe de trémies, plantées dans le bain
function cluster(seed) {
  let h = seed * 9973 + 17;
  const r = () => ((h = (h * 16807) % 2147483647) / 2147483647);
  const out = [];
  const base = [[0, 0.45, 0, 1.0], [-1.85, 0.05, 0.7, 0.55], [1.6, 0.35, -0.5, 0.72], [-0.7, -0.05, 1.8, 0.4], [0.95, -0.1, 1.55, 0.3], [-1.35, 0.55, -1.35, 0.62], [2.5, -0.12, 0.9, 0.26], [-2.6, -0.06, -0.6, 0.33]];
  for (const [x, y, z, s] of base) out.push({ c: [x + (r() - 0.5) * 0.3, s * (0.55 + 0.6 * r()) + y, z + (r() - 0.5) * 0.3], s, ang: r() * Math.PI, tilt: (r() - 0.5) * 0.6, ox: r(), seed: r() * 50 });
  return out;
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e) => { console.error(e.error.message); window.__err = e.error.message; });
  const canvas = document.querySelector('#c'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('webgpu'); const fmt = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: fmt, alphaMode: 'opaque' });
  const mod = device.createShaderModule({ code: SHADER });
  const ci = await mod.getCompilationInfo();
  if (ci.messages.some((m) => m.type === 'error')) { window.__err = ci.messages.map((m) => `${m.lineNum}: ${m.message}`).join('\n'); console.error(window.__err); return; }
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const smod = device.createShaderModule({ code: SHOW });
  const mkShow = (format) => device.createRenderPipeline({ layout: 'auto', vertex: { module: smod, entryPoint: 'vs' }, fragment: { module: smod, entryPoint: 'fs', targets: [{ format }] } });
  const pShowC = mkShow(fmt), pShowO = mkShow('rgba8unorm');
  const NU = 4 * 4 + 16 * 4;
  const U = new Float32Array(NU);
  const ubuf = device.createBuffer({ size: NU * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const abuf = device.createBuffer({ size: W * H * 16, usage: GPUBufferUsage.STORAGE });
  const ibuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const outTex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: abuf } }] });
  const sbgC = device.createBindGroup({ layout: pShowC.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: abuf } }, { binding: 1, resource: { buffer: ibuf } }] });
  const sbgO = device.createBindGroup({ layout: pShowO.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: abuf } }, { binding: 1, resource: { buffer: ibuf } }] });

  async function render({ t = 0.45, ox = 1, habit = 0, cam = [0.8, 4.2, 10.5], tgt = [0, 0.7, 0], fov = 30, ap = 0.05, focus = 10.8, env = 0, scale = 1, exposure = 1.0, spp = 24, seed = 3 } = {}) {
    const C = cluster(seed);
    U.set([W, H, 0, env], 0);
    U.set([...cam, Math.tan((fov * Math.PI) / 360)], 4);
    U.set([...tgt, ap], 8);
    U.set([t, ox, habit, focus], 12);
    C.forEach((c, i) => { U.set([c.c[0] * scale, c.c[1] * scale, c.c[2] * scale, c.s * scale], 16 + i * 8); U.set([c.ang, c.tilt, c.ox, c.seed], 16 + i * 8 + 4); });
    device.queue.writeBuffer(ibuf, 0, new Float32Array([W, H, exposure, 0]));
    for (let k = 0; k < spp; k++) {
      U[2] = k;
      device.queue.writeBuffer(ubuf, 0, U);
      const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); p.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    const enc = device.createCommandEncoder();
    for (const [pp, view, g] of [[pShowC, ctx.getCurrentTexture().createView(), sbgC], [pShowO, outTex.createView(), sbgO]]) {
      const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(pp); p.setBindGroup(0, g); p.draw(3); p.end();
    }
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  async function send(name) {
    const bpr = W * 4;
    const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: outTex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const img = new ImageData(new Uint8ClampedArray(buf.getMappedRange().slice(0)), W, H);
    buf.unmap(); buf.destroy();
    const c = new OffscreenCanvas(W, H); c.getContext('2d').putImageData(img, 0, 0);
    await fetch(`http://127.0.0.1:${params.get('sink') ?? 8097}/${name}`, { method: 'POST', body: await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }) });
  }
  window.b0 = { render, send };
  await render({ t: +(params.get('t') ?? 0.45), spp: 8 });
  window.__ready = true;
}
main().catch((e) => { console.error(e); window.__err = String(e); });
