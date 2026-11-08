// Simulation de la membrane sur le GPU (shaders de calcul WebGPU, sur le
// périphérique du moteur de rendu), et pose de chaque couche à chaque image.
//
// Dynamique par positions (XPBD à petits pas), résolue « par particule » :
// chaque fil de calcul rassemble les corrections de toutes les contraintes qui
// touchent sa particule (arêtes, flexion, liens des coutures) et les applique
// à une copie (Jacobi, deux tampons alternés). Pas d'atomiques, pas de
// coloration de graphe : tout est déterministe.
//
// Par sous-pas : prédiction (pression, air, frémissement, retroussement,
// impulsion d'enroulement), résolution (plusieurs passes), collisions avec
// l'armature (pose précalculée pour chaque sous-pas) et avec la couche
// suivante, ruptures (un fil par lien : étirement autour du lien, fatigue,
// dégrafage de l'avant), vitesses. Par image : enregistrement des positions.
//
// Pose (à chaque image, pour chaque couche affichée) : positions interpolées
// entre les images enregistrées (Catmull-Rom), position à l'image précédente, normales
// (soudées à travers les coutures encore intactes, puis lissées), courbure,
// dilatation de surface J, endommagement, et sommets des lèvres. Le rendu les lit directement dans ses
// tampons (aucun aller-retour par le processeur).

import { LIP_RING } from '../gen/tess.js';

const WG = 64;

// Images enregistrées : positions quantifiées sur 16 bits dans [−R, R]³
// (8 octets par particule et par image au lieu de 16 ; précision 1,2·10⁻⁴,
// un demi-centième d'arête — la membrane au repos a un rayon de 1).
const FRAME_RANGE = 4;
const FRAME_BYTES = 8;
const FRAMES = /* wgsl */`
fn packPos(x: vec3f) -> vec2u {
  let q = x / f32(${2 * FRAME_RANGE}) + 0.5;
  return vec2u(pack2x16unorm(q.xy), pack2x16unorm(vec2f(q.z, 0.0)));
}
fn unpackPos(v: vec2u) -> vec3f {
  return (vec3f(unpack2x16unorm(v.x), unpack2x16unorm(v.y).x) - 0.5) * f32(${2 * FRAME_RANGE});
}
`;

const COMMON = FRAMES + /* wgsl */`
struct C {
  np: u32, nb: u32, nCols: u32, nParts: u32,
  F: u32, SUB: u32, iters: u32, nf: u32,
  h: f32, T: f32, damping: f32, drag: f32,
  flutter: f32, peel: f32, relax: f32, leak: f32,
  curl: f32, curlW: f32, curlKick: f32, aE: f32,
  aF: f32, strength: f32, fatigue: f32, rin: f32,
  margin: f32, friction: f32, gain: f32, omega: f32,
  inflate: f32, pre: f32, settleDamp: f32, armDur: f32,
  sn: f32, sa: f32, sf: f32, guard: f32,
};
struct P { s: u32, settle: u32, frame: u32, pad: u32, t: f32, tPrev: f32, pad2: f32, pad3: f32 };
`;

const SIM = COMMON + /* wgsl */`
struct Glob { first: atomic<u32>, rsum: atomic<u32>, rcount: atomic<u32>, pbits: atomic<u32> };
@group(0) @binding(0) var<storage, read_write> st: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> xn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> pmeta: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> csr: array<u32>;
@group(0) @binding(4) var<storage, read_write> bonds: array<f32>;
@group(0) @binding(5) var<storage, read_write> geo: array<f32>;
@group(0) @binding(6) var<storage, read_write> glob: Glob;
@group(0) @binding(7) var<storage, read_write> frames: array<vec2u>;
@group(0) @binding(8) var<uniform> c: C;
@group(0) @binding(9) var<uniform> p: P;

const PI = 3.14159265;

fn hash3(q: vec3f) -> f32 { return fract(sin(dot(q, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn vnoise(q: vec3f) -> f32 {
  let i = floor(q); let f = fract(q); let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y);
  let b = mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z) * 2.0 - 1.0;
}
fn tStep() -> f32 { return 1.0 / f32((c.F - 1u) * c.SUB); }
fn tFirst() -> f32 { let f = atomicLoad(&glob.first); if (f == 0xffffffffu) { return -1.0; } return f32(f) * tStep(); }
fn broken(k: u32) -> f32 { return bonds[k * 8u + 3u]; }
fn ease(u0: f32) -> f32 { let u = clamp(u0, 0.0, 1.0); return u * u * u * (u * (u * 6.0 - 15.0) + 10.0); }
// les assauts (voir gen/kin.js)
fn struggle(u: f32) -> f32 {
  if (c.sn <= 0.0 || c.sf <= 0.0) { return u; }
  if (u >= c.sf) { return (u - c.sf) / (1.0 - c.sf); }
  let w = u / c.sf * c.sn; let k = floor(w); let v = w - k;
  let s = sin(PI * v);
  return c.sa * (0.45 + 0.55 * (k + 1.0) / c.sn) * s * s;
}
// fin des assauts, en temps de simulation
fn tStruggle() -> f32 { return c.armDur * c.sf; }
fn inflation(t: f32) -> f32 { return ease(struggle(clamp(t / c.armDur, 0.0, 1.0))); }
fn pressure() -> f32 {
  let p0 = bitcast<f32>(atomicLoad(&glob.pbits));
  if (p.settle == 1u) { return p0; }
  let tf = tFirst();
  if (tf < 0.0) { return p0 * (1.0 + c.inflate * inflation(p.t)); }
  return p0 * (1.0 + c.inflate * inflation(tf)) * exp(-(p.t - tf) * c.T / c.leak);
}

// pose d'une pièce au sous-pas s : p' = σR·p + T
struct Pose { R: mat3x3f, T: vec3f, sig: f32 };
fn pose(s: u32, k: u32) -> Pose {
  let o = c.nCols * 20u + (s * c.nParts + k) * 16u;
  var r: Pose;
  r.R = transpose(mat3x3f(geo[o], geo[o + 1u], geo[o + 2u], geo[o + 3u], geo[o + 4u], geo[o + 5u], geo[o + 6u], geo[o + 7u], geo[o + 8u]));
  r.T = vec3f(geo[o + 9u], geo[o + 10u], geo[o + 11u]);
  r.sig = geo[o + 12u];
  return r;
}
fn applyP(q: Pose, v: vec3f) -> vec3f { return q.R * v * q.sig + q.T; }
fn unapplyP(q: Pose, v: vec3f) -> vec3f { return transpose(q.R) * (v - q.T) / q.sig; }

@compute @workgroup_size(${WG}) fn predict(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.np) { return; }
  let m0 = pmeta[2u * i]; let m1 = pmeta[2u * i + 1u];
  let w = m0.w;
  let x = st[3u * i].xyz;
  if (w == 0.0) { st[3u * i + 1u] = vec4f(m0.xyz, 0.0); st[3u * i] = vec4f(m0.xyz, 0.0); st[3u * i + 2u] = vec4f(0.0); return; }
  var v = st[3u * i + 2u].xyz;
  // normale (et force de pression) depuis les triangles, positions de xn (fin du pas précédent)
  var n = vec3f(0.0);
  let t0 = csr[c.np + 1u + i]; let t1 = csr[c.np + 2u + i];
  for (var k = t0; k < t1; k += 2u) {
    let a = xn[csr[k]].xyz - x; let b = xn[csr[k + 1u]].xyz - x;
    n += cross(a, b);
  }
  v += n * (pressure() * c.h / 6.0);
  let nl = length(n);
  let nh = select(normalize(x), n / nl, nl > 1e-12);
  let tf = tFirst();
  if (p.settle == 0u) {
    v -= nh * dot(v, nh) * min(1.0, c.drag * c.h);
    let nb = u32(m1.y);
    if (tf >= 0.0 && nb > 0u) {
      // frémissement des lambeaux
      v += nh * vnoise(x * 2.5 + vec3f(p.t * 4.1, 0.0, p.t * 2.2)) * c.flutter * c.h;
      // impulsion d'enroulement, à la rupture du lien voisin
      let tb = broken(nb - 1u);
      if (tb >= 0.0 && p.t - tb < tStep() * 1.5 && m1.z <= 1.0) { v += nh * c.curlKick; }
    }
    // retroussement : vers l'arrière le long du méridien, et dehors
    if (tf >= 0.0 && m1.x > 0.0) {
      let pa = c.peel * min(1.0, (p.t - tf) * c.T / 0.25) * m1.x * c.h * (1.0 - smoothstep(1.25, 1.9, length(x)));
      let r = normalize(x); let rho = max(length(r.xy), 1e-6);
      let th = vec3f(r.z * r.x / rho, r.z * r.y / rho, -rho);
      v += (th + r * 0.6) * pa;
    }
  }
  let damp = select(c.damping, c.damping * 6.0 + c.settleDamp, p.settle == 1u);
  v *= exp(-damp * c.h);
  // traînée quadratique de l'air (les grandes vitesses sont freinées) et
  // vitesse plafonnée : un lambeau ne part jamais « en éclats »
  let sp = length(v);
  v /= 1.0 + 1.6 * sp * c.h;
  let sp2 = length(v);
  if (sp2 > 2.5) { v *= 2.5 / sp2; }
  st[3u * i + 1u] = vec4f(x, w);
  st[3u * i] = vec4f(x + v * c.h, w);
  st[3u * i + 2u] = vec4f(v, 0.0);
}

fn solveOne(i: u32, src: u32) -> vec3f {
  let m0 = pmeta[2u * i]; let w = m0.w;
  var x: vec3f; if (src == 0u) { x = st[3u * i].xyz; } else { x = xn[i].xyz; }
  if (w == 0.0) { return x; }
  let tf = tFirst();
  var d = vec3f(0.0); var db = vec3f(0.0); var nc = 0.0; var nbd = 0.0;
  let r0 = csr[i]; let r1 = csr[i + 1u];
  for (var r = r0; r < r1; r += 8u) {
    let j = csr[r]; let kind = csr[r + 1u];
    var xj: vec3f; if (src == 0u) { xj = st[3u * j].xyz; } else { xj = xn[j].xyz; }
    let wj = pmeta[2u * j].w; let ws = w + wj;
    let e = x - xj; let l = length(e);
    if (kind == 2u) {
      if (broken(csr[r + 3u]) < 0.0) { db += (xj - x) * (w / ws); nbd += 1.0; }
      continue;
    }
    if (l < 1e-9) { continue; }
    var L = bitcast<f32>(csr[r + 2u]);
    var al = c.aE;
    if (kind == 0u) {
      // relaxation plastique des lambeaux (à l'avant, après la première rupture)
      if (c.relax > 0.0 && tf >= 0.0 && l > L && p.settle == 0u) {
        let pw = min(pmeta[2u * i + 1u].x, pmeta[2u * j + 1u].x);
        if (pw > 0.0) { L += (l - L) * min(1.0, c.relax * c.h) * pw; csr[r + 2u] = bitcast<u32>(L); }
      }
      if (l < L) { al = c.aE * 8.0; }
    } else {
      let bA = csr[r + 3u]; let bB = csr[r + 4u];
      if ((bA > 0u && broken(bA - 1u) >= 0.0) || (bB > 0u && broken(bB - 1u) >= 0.0)) { continue; }
      al = c.aF;
      let nk = csr[r + 5u];
      if (c.curl > 0.0 && nk > 0u) {
        let tb = broken(nk - 1u);
        if (tb >= 0.0) { let act = min(1.0, (p.t - tb) / 0.12); L *= 1.0 - c.curl * act * exp(-bitcast<f32>(csr[r + 6u]) / c.curlW); }
      }
    }
    d += e * (-(l - L) / (ws + al) / l * w);
    nc += 1.0;
  }
  // Jacobi moyenné : stable quel que soit le nombre de contraintes
  return x + d * (c.omega / max(1.0, nc)) + db / max(1.0, nbd);
}
@compute @workgroup_size(${WG}) fn solveA(@builtin(global_invocation_id) g: vec3u) { let i = g.x; if (i >= c.np) { return; } xn[i] = vec4f(solveOne(i, 0u), pmeta[2u * i].w); }
@compute @workgroup_size(${WG}) fn solveB(@builtin(global_invocation_id) g: vec3u) { let i = g.x; if (i >= c.np) { return; } st[3u * i] = vec4f(solveOne(i, 1u), pmeta[2u * i].w); }

@compute @workgroup_size(${WG}) fn collide(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.np) { return; }
  if (pmeta[2u * i].w == 0.0) { return; }
  var x = st[3u * i].xyz;
  let xp = st[3u * i + 1u].xyz;
  let r2 = dot(x, x);
  if (r2 < c.rin * c.rin) { x *= c.rin / sqrt(r2); }
  let s = p.s; let sp = select(s - 1u, s, s == 0u);
  for (var q = 0u; q < c.nCols; q++) {
    let o = q * 20u;
    let k = u32(geo[o + 1u]);
    let P = pose(s, k);
    let bc = applyP(P, vec3f(geo[o + 16u], geo[o + 17u], geo[o + 18u]));
    let br = geo[o + 19u] * P.sig + 0.03;
    if (dot(x - bc, x - bc) > br * br) { continue; }
    var lp = unapplyP(P, x);
    var hit = false;
    if (geo[o] < 0.5) {
      let R = geo[o + 2u]; let Tk = geo[o + 3u]; let th0 = geo[o + 4u]; let th1 = geo[o + 5u];
      let phi = geo[o + 6u]; let tw = geo[o + 7u]; let wd = geo[o + 8u]; let tip = geo[o + 9u]; let mm = geo[o + 10u];
      let r = length(lp); let top = R + c.margin + mm;
      if (r > top || r < R - Tk - 0.12) { continue; }
      let th = acos(clamp(lp.z / r, -1.0, 1.0));
      let sv = (th - th0) / (th1 - th0);
      if (sv < -0.03 || sv > 1.0) { continue; }
      var dd = atan2(lp.y, lp.x) - (phi + tw * (th - th0));
      dd = dd - 2.0 * PI * floor((dd + PI) / (2.0 * PI));
      let tipK = min(1.0, max(0.0, sv) / tip);
      let hw = wd * pow(max(sin(tipK * PI * 0.5), 1e-6), 0.7) + (c.margin + Tk * 0.5) / max(0.05, sin(th));
      if (abs(dd) > hw) { continue; }
      let edge = max(0.0, (abs(dd) / hw - 0.82) / 0.18);
      let tgt = top - Tk * 0.6 * edge * edge;
      if (r >= tgt) { continue; }
      lp *= tgt / r; hit = true;
    } else {
      let p0 = vec3f(geo[o + 2u], geo[o + 3u], geo[o + 4u]); let p1 = vec3f(geo[o + 5u], geo[o + 6u], geo[o + 7u]);
      let rr = geo[o + 8u] + c.margin;
      let ab = p1 - p0; let tt = clamp(dot(lp - p0, ab) / max(1e-12, dot(ab, ab)), 0.0, 1.0);
      let cp = p0 + ab * tt; let dv = lp - cp; let dl = length(dv);
      if (dl >= rr || dl < 1e-9) { continue; }
      lp = cp + dv * (rr / dl); hit = true;
    }
    if (hit && c.friction > 0.0) {
      let lq = unapplyP(pose(sp, k), xp);
      let nn = normalize(lp); let dv = lp - lq; let tv = dv - nn * dot(dv, nn);
      lp -= tv * c.friction;
    }
    x = applyP(P, lp);
  }
  st[3u * i] = vec4f(x, pmeta[2u * i].w);
}

// étirement maximal (par rapport au repos) des arêtes d'une particule
fn strainOf(i: u32) -> f32 {
  var m = 0.0;
  let x = st[3u * i].xyz; let xr = pmeta[2u * i].xyz;
  for (var r = csr[i]; r < csr[i + 1u]; r += 8u) {
    if (csr[r + 1u] != 0u) { continue; }
    let j = csr[r];
    let l = length(x - st[3u * j].xyz); let l0 = length(xr - pmeta[2u * j].xyz);
    m = max(m, l / l0 - 1.0);
  }
  return m;
}
@compute @workgroup_size(${WG}) fn bondsK(@builtin(global_invocation_id) g: vec3u) {
  let k = g.x; if (k >= c.nb) { return; }
  if (bonds[k * 8u + 3u] >= 0.0) { return; }
  let i = u32(bonds[k * 8u]); let j = u32(bonds[k * 8u + 1u]);
  let s = max(strainOf(i), strainOf(j));
  // la matière résiste pendant les assauts (garde), puis se fatigue
  let ts = tStruggle();
  // pendant les assauts, la membrane encaisse : elle se déforme et revient
  if (ts > 0.0 && p.t < ts * 0.92) { return; }
  let fat = ease((p.t - ts - 0.08) / 0.4);
  let guard = 1.0 + c.guard * (1.0 - ease((p.t - ts * 0.9) / max(ts * 0.1, 0.02)));
  let thr = bonds[k * 8u + 2u] * (1.0 - c.fatigue * fat) * guard;
  let tf = tFirst();
  let forced = tf >= 0.0 && p.t > tf + bonds[k * 8u + 4u];
  if (s > thr || forced) { bonds[k * 8u + 3u] = p.t; atomicMin(&glob.first, p.s); }
}
@compute @workgroup_size(${WG}) fn velocity(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.np) { return; }
  let x = st[3u * i].xyz;
  st[3u * i + 2u] = vec4f((x - st[3u * i + 1u].xyz) / c.h, 0.0);
  xn[i] = vec4f(x, pmeta[2u * i].w);
}
@compute @workgroup_size(${WG}) fn record(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.np) { return; }
  frames[p.frame * c.np + i] = packPos(st[3u * i].xyz);
}
@compute @workgroup_size(${WG}) fn radius(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.np) { return; }
  let m0 = pmeta[2u * i];
  if (m0.w > 0.0 && m0.z > 0.0) { atomicAdd(&glob.rsum, u32(length(st[3u * i].xyz) * 1000.0)); atomicAdd(&glob.rcount, 1u); }
}
@compute @workgroup_size(1) fn adjust() {
  let n = atomicLoad(&glob.rcount);
  if (n > 0u) {
    let mr = f32(atomicLoad(&glob.rsum)) / 1000.0 / f32(n);
    let p0 = bitcast<f32>(atomicLoad(&glob.pbits));
    atomicStore(&glob.pbits, bitcast<u32>(max(0.0, p0 * (1.0 + c.gain * (1.0 - mr)))));
  }
  atomicStore(&glob.rsum, 0u); atomicStore(&glob.rcount, 0u);
}
@compute @workgroup_size(${WG}) fn thresholds(@builtin(global_invocation_id) g: vec3u) {
  let k = g.x; if (k >= c.nb) { return; }
  let i = u32(bonds[k * 8u]); let j = u32(bonds[k * 8u + 1u]);
  bonds[k * 8u + 2u] = max(strainOf(i), strainOf(j)) + c.strength * bonds[k * 8u + 5u];
}
@compute @workgroup_size(${WG}) fn still(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.np) { return; }
  st[3u * i + 2u] = vec4f(0.0);
  xn[i] = st[3u * i];
}
`;

// fibrilles : instants de rupture et de claquage
const FIB = COMMON + /* wgsl */`
@group(0) @binding(0) var<storage, read_write> frames: array<vec2u>;
@group(0) @binding(1) var<storage, read_write> bonds: array<f32>;
@group(0) @binding(2) var<storage, read_write> fib: array<f32>;
@group(0) @binding(3) var<storage, read_write> fout: array<vec4f>;
@group(0) @binding(4) var<uniform> c: C;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3u) {
  let k = g.x; if (k >= c.nf) { return; }
  let o = k * 8u;
  let a = u32(fib[o]); let an = u32(fib[o + 1u]); let b = u32(fib[o + 2u]); let bn = u32(fib[o + 3u]);
  let u = fib[o + 4u]; let snapLen = fib[o + 5u]; let bk = u32(fib[o + 6u]);
  let tb = bonds[bk * 8u + 3u];
  var brk = 1e6; var snap = 1e6;
  if (tb >= 0.0) {
    brk = tb * f32(c.F - 1u);
    for (var f = u32(ceil(brk)); f < c.F; f++) {
      let A = mix(unpackPos(frames[f * c.np + a]), unpackPos(frames[f * c.np + an]), u);
      let B = mix(unpackPos(frames[f * c.np + b]), unpackPos(frames[f * c.np + bn]), u);
      if (length(A - B) > snapLen) { snap = f32(f) + 0.5; break; }
    }
  }
  fout[k] = vec4f(brk, snap, 0.0, 0.0);
}
`;

// pose d'une couche à une image donnée
//
// Normales : somme des triangles du premier anneau (soudée à travers les
// coutures intactes), écrite dans un tampon de travail, puis lissée sur le
// premier anneau (moitié la particule, moitié ses voisines). Le maillage simulé
// est volontairement désordonné : sans ce lissage, le reflet d'une peau
// humide dessine ses arêtes. Les arêtes ne traversent pas une couture
// rompue (sommets dédoublés) : les lèvres restent franches. Le long d'une
// couture intacte, les copies d'un sommet lissent sur la réunion de leurs
// anneaux : même résultat des deux côtés, aucun pli.
//
// Courbure : variation de la normale par unité de longueur, moyenne sur les
// arêtes (cur.w). Le matériau en tire la rugosité d'anticrénelage du reflet,
// continue d'un triangle à l'autre (des dérivées écran de la normale
// interpolée seraient constantes par triangle : facettes dans le reflet).
const POSE = FRAMES + /* wgsl */`
struct U { np: u32, nl: u32, F: u32, lipOff: u32, f: f32, fPrev: f32, lipT: f32, ringOff: u32 };
@group(0) @binding(0) var<storage, read_write> frames: array<vec2u>;
@group(0) @binding(1) var<storage, read_write> csr: array<u32>;
@group(0) @binding(2) var<storage, read_write> bonds: array<f32>;
@group(0) @binding(3) var<storage, read_write> pmeta: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> raw: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> cur: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> prv: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> nor: array<vec4f>;
@group(0) @binding(8) var<uniform> u: U;

// position à l'image f : spline de Catmull-Rom entre les images enregistrées.
// Au ralenti, une image enregistrée couvre plusieurs images affichées : une
// interpolation linéaire y briserait la vitesse à chaque image enregistrée.
fn frame(k: u32, i: u32) -> vec3f { return unpackPos(frames[min(k, u.F - 1u) * u.np + i]); }
fn at(i: u32, f: f32) -> vec3f {
  let ff = clamp(f, 0.0, f32(u.F - 1u));
  let k = u32(floor(ff)); let t = fract(ff);
  let p0 = frame(max(k, 1u) - 1u, i); let p1 = frame(k, i); let p2 = frame(k + 1u, i); let p3 = frame(k + 2u, i);
  return p1 + 0.5 * t * ((p2 - p0) + t * ((2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) + t * (3.0 * (p1 - p2) + p3 - p0)));
}
fn tNow() -> f32 { return u.f / f32(u.F - 1u); }
fn intact(k: u32) -> bool { let tb = bonds[k * 8u + 3u]; return tb < 0.0 || tb > tNow(); }
// lèvres et anneaux sont rangés à la suite des tables de voisinage
fn lip(k: u32) -> u32 { return csr[u.lipOff + k]; }
const PARTNER = 0x80000000u;
fn rg(k: u32) -> u32 { return csr[u.ringOff + k]; }
// somme des normales brutes des voisines par une arête, et leur nombre
fn ringSum(i: u32) -> vec4f {
  var s = vec3f(0.0); var k = 0.0;
  var r = rg(i); let e = rg(i + 1u);
  while (r < e) {
    let v = rg(r);
    if ((v & PARTNER) != 0u) { r += 2u; continue; }
    s += raw[v].xyz; k += 1.0; r += 1u;
  }
  return vec4f(s, k);
}

@compute @workgroup_size(${WG}) fn interp(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.np) { return; }
  cur[i] = vec4f(at(i, u.f), 0.0);
  prv[i] = vec4f(at(i, u.fPrev), 0.0);
}
fn triSum(i: u32) -> vec4f {
  var n = vec3f(0.0);
  let x = cur[i].xyz;
  for (var k = csr[u.np + 1u + i]; k < csr[u.np + 2u + i]; k += 2u) { n += cross(cur[csr[k]].xyz - x, cur[csr[k + 1u]].xyz - x); }
  return vec4f(n, length(n) / 6.0);
}
@compute @workgroup_size(${WG}) fn normals(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.np) { return; }
  var s = triSum(i); var a0 = pmeta[2u * i + 1u].w;
  // soudure à travers les coutures intactes
  for (var r = csr[i]; r < csr[i + 1u]; r += 8u) {
    if (csr[r + 1u] == 2u && intact(csr[r + 3u])) { let j = csr[r]; s += triSum(j); a0 += pmeta[2u * j + 1u].w; }
  }
  let n = select(normalize(cur[i].xyz), normalize(s.xyz), length(s.xyz) > 1e-12);
  raw[i] = vec4f(n, s.w / max(a0, 1e-9));
  // endommagement (près d'une couture rompue)
  let m1 = pmeta[2u * i + 1u];
  var dmg = 0.0;
  let nb = u32(m1.y);
  if (nb > 0u) { let tb = bonds[(nb - 1u) * 8u + 3u]; if (tb >= 0.0 && tb <= tNow()) { dmg = exp(-m1.z / 1.6) * min(1.0, (tNow() - tb) / 0.08 + 0.2); } }
  prv[i].w = dmg;
}
@compute @workgroup_size(${WG}) fn smoothNormals(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.np) { return; }
  var own = raw[i].xyz; var nbr = ringSum(i); var ns = 1.0;
  var r = rg(i); let e = rg(i + 1u);
  while (r < e) {
    let v = rg(r);
    if ((v & PARTNER) == 0u) { r += 1u; continue; }
    if (intact(rg(r + 1u))) { let j = v & ~PARTNER; own += raw[j].xyz; nbr += ringSum(j); ns += 1.0; }
    r += 2u;
  }
  let n = own * (max(nbr.w, 1.0) / ns) + nbr.xyz;
  nor[i] = vec4f(select(raw[i].xyz, normalize(n), length(n) > 1e-9), raw[i].w);
}
@compute @workgroup_size(${WG}) fn curvature(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.np) { return; }
  let x = cur[i].xyz; let n = nor[i].xyz;
  var s = 0.0; var k = 0.0;
  var r = rg(i); let e = rg(i + 1u);
  while (r < e) {
    let v = rg(r);
    if ((v & PARTNER) != 0u) { r += 2u; continue; }
    s += length(nor[v].xyz - n) / max(length(cur[v].xyz - x), 1e-6); k += 1.0; r += 1u;
  }
  cur[i].w = s / max(k, 1.0);
}
@compute @workgroup_size(${WG}) fn lipsK(@builtin(global_invocation_id) g: vec3u) {
  let l = g.x; if (l >= u.nl) { return; }
  let o = l * 8u; let pi = lip(o); let ne = lip(o + 1u);
  let x = cur[pi].xyz; let n = nor[pi].xyz;
  var e = vec3f(0.0);
  for (var q = 0u; q < ne; q++) {
    let xj = cur[lip(o + 2u + 2u * q)].xyz; let xk = cur[lip(o + 3u + 2u * q)].xyz;
    let ed = xj - x; let m = (x + xj) * 0.5 - xk;
    e += m - ed * (dot(m, ed) / max(dot(ed, ed), 1e-12));
  }
  e -= n * dot(e, n);
  e = select(vec3f(0.0), normalize(e), length(e) > 1e-9);
  // écartement des lèvres : distance aux partenaires dont le lien est rompu
  var sep = 0.0;
  var r = rg(pi); let re = rg(pi + 1u);
  while (r < re) {
    let v = rg(r);
    if ((v & PARTNER) == 0u) { r += 1u; continue; }
    if (!intact(rg(r + 1u))) { sep = max(sep, length(x - cur[v & ~PARTNER].xyz)); }
    r += 2u;
  }
  let cc = min(1.0, sep / (u.lipT * 3.0 + 1e-6));
  let rr = u.lipT * cc;
  let base = u.np + l * ${LIP_RING}u;
  let dp = prv[pi].xyz - x;
  let J = nor[pi].w;
  // (courbure du bourrelet : un demi-tour sur le rayon de la lèvre)
  let kc = max(cur[pi].w, 1.0 / max(u.lipT, 1e-4));
  // bourrelet : demi-ellipse de la face avant (n) à la face arrière (−n), en
  // passant par le bord (e, un peu plus loin), normales de l'ellipse
  for (var k = 0u; k < ${LIP_RING}u; k++) {
    let th = 3.14159265 * f32(k) / f32(${LIP_RING - 1}u);
    let ct = cos(th); let st = sin(th);
    let p = x + (n * ct + e * (1.25 * st)) * rr;
    let nn = n * ct + e * (st / 1.25);
    let nk = select(select(n, -n, ct < 0.0), normalize(nn), length(nn) > 1e-3);
    cur[base + k] = vec4f(p, kc);
    prv[base + k] = vec4f(p + dp, cc);
    nor[base + k] = vec4f(nk, J);
  }
}
`;

// Déformation (photoélasticité). Pour chaque triangle : gradient de la
// déformation F (du triangle au repos au triangle posé), tenseur de Cauchy-Green
// gauche b = F·Fᵀ dans le plan déformé, ses étirements principaux λ₁ ≥ λ₂ et
// leurs directions d₁, d₂. La biréfringence d'un film tendu ne dépend que de
// l'écart des étirements : on garde le déviateur logarithmique
//   E = ½·ln(λ₁/λ₂)·(d₁d₁ᵀ − d₂d₂ᵀ)
// (nul sous tension égale dans toutes les directions : une bulle gonflée reste
// noire entre polariseurs croisés), moyenné par aire sur les triangles de la
// particule (soudé à travers les coutures intactes), puis lissé sur le premier
// anneau. Le déformé est mesuré depuis la géométrie au repos, pas depuis les
// longueurs relaxées : un lambeau étiré plastiquement garde sa biréfringence
// (orientation des chaînes du polymère), comme un film plastique que l'on a tiré.
//
// Plis. Un film mince ne supporte pas la compression : il flambe en plis
// parallèles à la tension. Le maillage simulé est trop grossier pour les
// résoudre, mais il sait où la matière est comprimée et dans quel sens : on
// garde, dans le repère au repos (les plis restent attachés à la matière), le
// tenseur W = c·k·kᵀ, où k est la direction de compression (vecteur propre de
// C = FᵀF pour la plus petite valeur propre) et c = max(0, (1 − pre) − λ₂) la
// compression au-delà de la longueur relâchée. Le matériau en tire des plis
// (voir wrinkles dans membrane.js).
//
// str[3i] = (Exx, Eyy, Ezz, Wxx), str[3i + 1] = (Exy, Eyz, Ezx, Wyy),
// str[3i + 2] = (Wzz, Wxy, Wyz, Wzx), repère de la couche.
const STRAIN = FRAMES + /* wgsl */`
struct U { np: u32, nl: u32, F: u32, lipOff: u32, f: f32, fPrev: f32, lipT: f32, ringOff: u32, pre: f32, q0: f32, q1: f32, q2: f32 };
@group(0) @binding(0) var<storage, read_write> cur: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> pmeta: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> csr: array<u32>;
@group(0) @binding(3) var<storage, read_write> bonds: array<f32>;
@group(0) @binding(4) var<storage, read_write> tmp: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> str: array<vec4f>;
@group(0) @binding(6) var<uniform> u: U;
const PARTNER = 0x80000000u;
fn tNow() -> f32 { return u.f / f32(u.F - 1u); }
fn intact(k: u32) -> bool { let tb = bonds[k * 8u + 3u]; return tb < 0.0 || tb > tNow(); }
fn rg(k: u32) -> u32 { return csr[u.ringOff + k]; }
struct Acc { a: vec3f, b: vec3f, wa: vec3f, wb: vec3f, w: f32 };
fn triDev(i: u32) -> Acc {
  var r: Acc; r.a = vec3f(0.0); r.b = vec3f(0.0); r.wa = vec3f(0.0); r.wb = vec3f(0.0); r.w = 0.0;
  let x0 = cur[i].xyz; let X0 = pmeta[2u * i].xyz;
  for (var k = csr[u.np + 1u + i]; k < csr[u.np + 2u + i]; k += 2u) {
    let j = csr[k]; let l = csr[k + 1u];
    let e1 = pmeta[2u * j].xyz - X0; let e2 = pmeta[2u * l].xyz - X0;
    let d1 = cur[j].xyz - x0; let d2 = cur[l].xyz - x0;
    let nR = cross(e1, e2); let A2 = length(nR); let la = length(e1);
    let nD = cross(d1, d2); let lD = length(nD); let ld = length(d1);
    if (A2 < 1e-12 || la < 1e-9 || lD < 1e-12 || ld < 1e-9) { continue; }
    // repère orthonormé du triangle au repos, F = Ds·Dm⁻¹ (3×2)
    let ue = e1 / la; let ve = cross(nR / A2, ue);
    let b = dot(e2, ue); let c = dot(e2, ve);
    let f0 = d1 / la; let f1 = (d2 - d1 * (b / la)) / c;
    // b = F·Fᵀ dans le repère (p, q) du triangle déformé
    let p = d1 / ld; let q = cross(nD / lD, p);
    let f0p = dot(f0, p); let f0q = dot(f0, q); let f1p = dot(f1, p); let f1q = dot(f1, q);
    let A = f0p * f0p + f1p * f1p; let D = f0q * f0q + f1q * f1q; let C = f0p * f0q + f1p * f1q;
    let m = 0.5 * (A + D); let hd = 0.5 * (A - D); let rr = sqrt(hd * hd + C * C);
    r.w += A2;
    // compression (repère au repos) : C = FᵀF dans (ue, ve)
    let C00 = dot(f0, f0); let C11 = dot(f1, f1); let C01 = dot(f0, f1);
    let cm = 0.5 * (C00 + C11); let ch = 0.5 * (C00 - C11); let cr = sqrt(ch * ch + C01 * C01);
    let cmp = max(0.0, (1.0 - u.pre) - sqrt(max(cm - cr, 0.0)));
    if (cmp > 0.0) {
      // k ⟂ direction principale : k·kᵀ = ½(I − cos2α(ueueᵀ − veveᵀ) − sin2α(ueveᵀ + veueᵀ))
      var c2c = 1.0; var s2c = 0.0;
      if (cr > 1e-9) { c2c = ch / cr; s2c = C01 / cr; }
      let kw = 0.5 * cmp * A2;
      r.wa += kw * ((ue * ue + ve * ve) - c2c * (ue * ue - ve * ve) - s2c * 2.0 * ue * ve);
      r.wb += kw * ((ue * ue.yzx + ve * ve.yzx) - c2c * (ue * ue.yzx - ve * ve.yzx) - s2c * (ue * ve.yzx + ve * ue.yzx));
    }
    if (rr < 1e-9) { continue; }
    // ln(λ₁/λ₂) = ½·ln(λ₁²/λ₂²) ; cos 2α, sin 2α de la direction principale
    let dl = 0.5 * log((m + rr) / max(m - rr, 1e-6));
    let c2 = hd / rr; let s2 = C / rr;
    let k2 = 0.5 * dl * A2;
    r.a += k2 * (c2 * (p * p - q * q) + s2 * 2.0 * p * q);
    r.b += k2 * (c2 * (p * p.yzx - q * q.yzx) + s2 * (p * q.yzx + q * p.yzx));
  }
  return r;
}
@compute @workgroup_size(${WG}) fn strainK(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.np) { return; }
  var s = triDev(i);
  for (var r = csr[i]; r < csr[i + 1u]; r += 8u) {
    if (csr[r + 1u] == 2u && intact(csr[r + 3u])) { let t = triDev(csr[r]); s.a += t.a; s.b += t.b; s.wa += t.wa; s.wb += t.wb; s.w += t.w; }
  }
  let w = max(s.w, 1e-12);
  let wa = s.wa / w; let wb = s.wb / w;
  tmp[3u * i] = vec4f(s.a / w, wa.x); tmp[3u * i + 1u] = vec4f(s.b / w, wa.y); tmp[3u * i + 2u] = vec4f(wa.z, wb);
}
@compute @workgroup_size(${WG}) fn strainSmooth(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.np) { return; }
  var a = vec4f(0.0); var b = vec4f(0.0); var c = vec4f(0.0); var k = 0.0;
  var r = rg(i); let e = rg(i + 1u);
  while (r < e) {
    let v = rg(r);
    if ((v & PARTNER) != 0u) { r += 2u; continue; }
    a += tmp[3u * v]; b += tmp[3u * v + 1u]; c += tmp[3u * v + 2u]; k += 1.0; r += 1u;
  }
  // moitié la particule, moitié ses voisines
  let kk = 0.5 / max(k, 1.0);
  str[3u * i] = 0.5 * tmp[3u * i] + a * kk;
  str[3u * i + 1u] = 0.5 * tmp[3u * i + 1u] + b * kk;
  str[3u * i + 2u] = 0.5 * tmp[3u * i + 2u] + c * kk;
}
// sommets des lèvres : ceux de leur particule
@compute @workgroup_size(${WG}) fn strainLips(@builtin(global_invocation_id) g: vec3u) {
  let l = g.x; if (l >= u.nl) { return; }
  let pi = csr[u.lipOff + l * 8u];
  let a = str[3u * pi]; let b = str[3u * pi + 1u]; let c = str[3u * pi + 2u];
  for (var k = 0u; k < ${LIP_RING}u; k++) { let o = u.np + l * ${LIP_RING}u + k; str[3u * o] = a; str[3u * o + 1u] = b; str[3u * o + 2u] = c; }
}
`;

// ── Pipelines (par périphérique) ─────────────────────────────────────────────
const cache = new WeakMap();
function pipelines(device) {
  let P = cache.get(device);
  if (P) return P;
  const sto = (b) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } });
  const uni = (b, dyn = false) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: dyn } });
  const simL = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5, 6, 7].map(sto).concat([uni(8), uni(9, true)]) });
  const fibL = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map(sto).concat([uni(4)]) });
  const poseL = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5, 6, 7].map(sto).concat([uni(8)]) });
  const strL = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5].map(sto).concat([uni(6)]) });
  // (une erreur de compilation n'apparaît sinon qu'en cascade de « pipeline invalide »)
  const mod = (code, label) => {
    const m = device.createShaderModule({ code, label });
    m.getCompilationInfo().then((info) => {
      for (const e of info.messages) if (e.type === 'error') console.error(`WGSL ${label} ${e.lineNum}:${e.linePos} ${e.message}`);
    });
    return m;
  };
  const sim = mod(SIM, 'sim'), fib = mod(FIB, 'fib'), pose = mod(POSE, 'pose'), strain = mod(STRAIN, 'strain');
  const mk = (layout, module, entryPoint) => device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint } });
  P = {
    simL, fibL, poseL, strL,
    strain: mk(strL, strain, 'strainK'), strainSmooth: mk(strL, strain, 'strainSmooth'), strainLips: mk(strL, strain, 'strainLips'),
    predict: mk(simL, sim, 'predict'), solveA: mk(simL, sim, 'solveA'), solveB: mk(simL, sim, 'solveB'), collide: mk(simL, sim, 'collide'),
    bonds: mk(simL, sim, 'bondsK'), velocity: mk(simL, sim, 'velocity'), record: mk(simL, sim, 'record'), radius: mk(simL, sim, 'radius'),
    adjust: mk(simL, sim, 'adjust'), thresholds: mk(simL, sim, 'thresholds'), still: mk(simL, sim, 'still'),
    fib: mk(fibL, fib, 'main'),
    interp: mk(poseL, pose, 'interp'), normals: mk(poseL, pose, 'normals'), smoothNormals: mk(poseL, pose, 'smoothNormals'),
    curvature: mk(poseL, pose, 'curvature'), lips: mk(poseL, pose, 'lipsK'),
  };
  cache.set(device, P);
  return P;
}

const buf = (device, data, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC) => {
  const size = Math.max(16, Math.ceil(data.byteLength / 16) * 16);
  const b = device.createBuffer({ size, usage, mappedAtCreation: true });
  new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  b.unmap();
  return b;
};
const concatU32 = (...parts) => {
  const c = new Uint32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { c.set(p, o); o += p.length; }
  return c;
};
const emptyBuf = (device, size) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });

// ── Simulation d'une couche ──────────────────────────────────────────────────
// prep : sortie de gen/prep.js ; S : paramètres ; fibOut : tampon GPU (nf × vec4)
// qui reçoit les instants des fibrilles. Rend { frames, meta, csr, lipOff,
// ringOff, bonds } (csr : tables de voisinage, puis lèvres à partir de lipOff
// et anneaux à partir de ringOff — un seul tampon, la pose étant à la limite
// des 8 tampons de stockage par étape).
export async function simulate(device, prep, S, fibOut, onProgress) {
  const P = pipelines(device);
  const np = prep.np, nb = prep.nb, F = S.frames, SUB = S.substeps;
  const h = S.duration / (F - 1) / SUB;
  // état : x, x au début du pas, v
  const st0 = new Float32Array(np * 12), xn0 = new Float32Array(np * 4);
  for (let i = 0; i < np; i++) {
    const m = prep.meta.subarray(i * 8, i * 8 + 4);
    st0.set(m, i * 12); st0.set(m, i * 12 + 4); xn0.set(m, i * 4);
  }
  const geo = new Float32Array(prep.cols.length + prep.poses.length);
  geo.set(prep.cols); geo.set(prep.poses, prep.cols.length);
  const metaF = new Float32Array(np * 8);
  metaF.set(prep.meta);
  const B = {
    st: buf(device, st0), xn: buf(device, xn0), meta: buf(device, metaF), csr: buf(device, concatU32(prep.csr, prep.lipData, prep.ring)), bonds: buf(device, prep.bonds),
    geo: buf(device, geo), glob: buf(device, new Uint32Array([0xffffffff, 0, 0, 0])), frames: emptyBuf(device, np * F * FRAME_BYTES),
  };
  // pression initiale estimée (sphère de rayon 1 : p = 2T, T ≈ √3·ε/α)
  const p0 = (S.pressure ?? 1) * 2 * Math.sqrt(3) * (S.pre + 0.01) / S.stretch;
  device.queue.writeBuffer(B.glob, 12, new Float32Array([p0]));
  const settleSteps = S.settle * SUB, runSteps = (F - 1) * SUB;
  const consts = new ArrayBuffer(144), cu = new Uint32Array(consts), cf = new Float32Array(consts);
  cu.set([np, nb, prep.nCols, prep.nParts, F, SUB, S.iters ?? 6, prep.nf]);
  cf.set([h, S.duration, S.damping, S.drag, S.flutter, S.peel, S.relax, S.leak, S.curl, S.curlWidth, S.curlKick * (S.curlSign || 1), S.stretch / (h * h),
    S.bend / (h * h), S.strength, S.fatigue, S.inner * 1.06, S.thick * 0.5 + 0.004, S.friction, S.pressureGain ?? 2, S.omega ?? 1.6,
    S.inflate ?? 0, S.pre, 6, S.armDur ?? 0.5, S.st?.n ?? 0, S.st?.a ?? 0, S.st?.f ?? 0, S.guard ?? 0.7], 8);
  const cBuf = buf(device, new Uint8Array(consts), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  // paramètres par sous-pas (décalages dynamiques de 256 octets)
  const nRec = settleSteps + runSteps + 1;
  const pRec = new ArrayBuffer(nRec * 256), pu = new Uint32Array(pRec), pf = new Float32Array(pRec);
  const rec = (r, s, settle, frame, t, tPrev) => { const o = r * 64; pu[o] = s; pu[o + 1] = settle; pu[o + 2] = frame; pf[o + 4] = t; pf[o + 5] = tPrev; };
  for (let r = 0; r < settleSteps; r++) rec(r, 0, 1, 0, 0, 0);
  const dt = 1 / runSteps;
  for (let r = 0; r < runSteps; r++) { const s = r + 1; rec(settleSteps + r, s, 0, Math.floor((s - 1) / SUB) + 1, s * dt, (s - 1) * dt); }
  rec(nRec - 1, 0, 1, 0, 0, 0); // (enregistrement de l'image 0)
  const pBuf = buf(device, new Uint8Array(pRec), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const bg = device.createBindGroup({
    layout: P.simL,
    entries: [B.st, B.xn, B.meta, B.csr, B.bonds, B.geo, B.glob, B.frames].map((b, i) => ({ binding: i, resource: { buffer: b } }))
      .concat([{ binding: 8, resource: { buffer: cBuf } }, { binding: 9, resource: { buffer: pBuf, size: 32 } }]),
  });
  const gP = Math.ceil(np / WG), gB = Math.max(1, Math.ceil(nb / WG));
  const iters = S.iters ?? 6;
  const skip = S.skip || {}; // (mise au point)
  const step = (pass, r, settle) => {
    pass.setBindGroup(0, bg, [r * 256]);
    if (!skip.predict) { pass.setPipeline(P.predict); pass.dispatchWorkgroups(gP); }
    if (!skip.solve) {
      for (let k = 0; k < iters; k++) { pass.setPipeline(k % 2 ? P.solveB : P.solveA); pass.dispatchWorkgroups(gP); }
      if (iters % 2) { pass.setPipeline(P.solveB); pass.dispatchWorkgroups(gP); } // (la dernière passe écrit dans st)
    }
    if (!skip.collide) { pass.setPipeline(P.collide); pass.dispatchWorkgroups(gP); }
    if (!settle) { pass.setPipeline(P.bonds); pass.dispatchWorkgroups(gB); }
    if (!skip.velocity) { pass.setPipeline(P.velocity); pass.dispatchWorkgroups(gP); }
  };
  const submit = async (fn) => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    fn(pass);
    pass.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  };
  // mise en place (armature fermée) et réglage de la pression
  for (let f0 = 0; f0 < S.settle; f0 += 10) {
    await submit((pass) => {
      for (let f = f0; f < Math.min(S.settle, f0 + 10); f++) {
        for (let k = 0; k < SUB; k++) step(pass, f * SUB + k, true);
        pass.setBindGroup(0, bg, [0]);
        pass.setPipeline(P.radius); pass.dispatchWorkgroups(gP);
        pass.setPipeline(P.adjust); pass.dispatchWorkgroups(1);
      }
    });
    onProgress?.((f0 / S.settle) * 0.25);
  }
  await submit((pass) => {
    pass.setBindGroup(0, bg, [(nRec - 1) * 256]);
    pass.setPipeline(P.still); pass.dispatchWorkgroups(gP);
    pass.setPipeline(P.thresholds); pass.dispatchWorkgroups(gB);
    pass.setPipeline(P.record); pass.dispatchWorkgroups(gP);
  });
  // éclosion
  const CH = 8;
  for (let f0 = 1; f0 < F; f0 += CH) {
    await submit((pass) => {
      for (let f = f0; f < Math.min(F, f0 + CH); f++) {
        for (let k = 0; k < SUB; k++) step(pass, settleSteps + (f - 1) * SUB + k, false);
        pass.setBindGroup(0, bg, [(settleSteps + f * SUB - 1) * 256]);
        pass.setPipeline(P.record); pass.dispatchWorkgroups(gP);
      }
    });
    onProgress?.(0.25 + 0.75 * (f0 / F));
  }
  // fibrilles
  if (prep.nf > 0 && fibOut) {
    const fibBuf = buf(device, prep.fibData);
    const fbg = device.createBindGroup({ layout: P.fibL, entries: [B.frames, B.bonds, fibBuf, fibOut].map((b, i) => ({ binding: i, resource: { buffer: b } })).concat([{ binding: 4, resource: { buffer: cBuf } }]) });
    await submit((pass) => { pass.setBindGroup(0, fbg); pass.setPipeline(P.fib); pass.dispatchWorkgroups(Math.ceil(prep.nf / WG)); });
    fibBuf.destroy();
  }
  // statistiques (lecture des liens)
  const rd = device.createBuffer({ size: nb * 32 || 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(B.bonds, 0, rd, 0, nb * 32 || 16);
  device.queue.submit([enc.finish()]);
  await rd.mapAsync(GPUMapMode.READ);
  const bf = new Float32Array(rd.getMappedRange().slice(0));
  rd.unmap(); rd.destroy();
  let broken = 0, first = 1;
  for (let k = 0; k < nb; k++) if (bf[k * 8 + 3] >= 0) { broken++; first = Math.min(first, bf[k * 8 + 3]); }
  for (const k of ['st', 'xn', 'geo', 'glob']) B[k].destroy();
  cBuf.destroy(); pBuf.destroy();
  const lipOff = prep.csr.length, ringOff = lipOff + prep.lipData.length;
  return { frames: B.frames, meta: B.meta, csr: B.csr, lipOff, ringOff, bonds: B.bonds, stats: { broken, firstTear: first } };
}

// ── Pose d'une couche ────────────────────────────────────────────────────────
export function createPoser(device, gpu, prep, S, out) {
  const P = pipelines(device);
  const ub = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const raw = emptyBuf(device, prep.np * 16); // (normales avant lissage)
  const bg = device.createBindGroup({
    layout: P.poseL,
    entries: [gpu.frames, gpu.csr, gpu.bonds, gpu.meta, raw, out.cur, out.prv, out.nor].map((b, i) => ({ binding: i, resource: { buffer: b } }))
      .concat([{ binding: 8, resource: { buffer: ub } }]),
  });
  const data = new ArrayBuffer(48), du = new Uint32Array(data), df = new Float32Array(data);
  du.set([prep.np, prep.nl, S.frames, gpu.lipOff]); du[7] = gpu.ringOff; df[8] = S.pre ?? 0;
  const lipT = S.thick * S.lip * 0.5;
  // déformation (photoélasticité, plis), seulement si le matériau la lit
  let sbg = null, stmp = null;
  if (out.str) {
    stmp = emptyBuf(device, prep.np * 48);
    sbg = device.createBindGroup({
      layout: P.strL,
      entries: [out.cur, gpu.meta, gpu.csr, gpu.bonds, stmp, out.str].map((b, i) => ({ binding: i, resource: { buffer: b } }))
        .concat([{ binding: 6, resource: { buffer: ub } }]),
    });
  }
  // (dernière pose calculée : une couche close ou finie ne bouge plus, ses
  // tampons sont déjà justes — on ne refait rien)
  let lastF = NaN, lastFPrev = NaN;
  return {
    // encode la pose à l'image f (et fPrev pour les vecteurs vitesse)
    encode(enc, f, fPrev) {
      if (f === lastF && fPrev === lastFPrev) return;
      lastF = f; lastFPrev = fPrev;
      df[4] = f; df[5] = fPrev; df[6] = lipT;
      device.queue.writeBuffer(ub, 0, data);
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, bg);
      const gP = Math.ceil(prep.np / WG);
      for (const k of ['interp', 'normals', 'smoothNormals', 'curvature']) { pass.setPipeline(P[k]); pass.dispatchWorkgroups(gP); }
      if (prep.nl) { pass.setPipeline(P.lips); pass.dispatchWorkgroups(Math.ceil(prep.nl / WG)); }
      if (sbg) {
        pass.setBindGroup(0, sbg);
        pass.setPipeline(P.strain); pass.dispatchWorkgroups(gP);
        pass.setPipeline(P.strainSmooth); pass.dispatchWorkgroups(gP);
        if (prep.nl) { pass.setPipeline(P.strainLips); pass.dispatchWorkgroups(Math.ceil(prep.nl / WG)); }
      }
      pass.end();
    },
    dispose() { ub.destroy(); raw.destroy(); stmp?.destroy(); },
  };
}
