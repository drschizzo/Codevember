// P3 : la glace se voit-elle dans l'eau ?
//
// Prototype de rendu, sans three.js : un lancer de rayons en un seul shader
// (WebGPU brut) sur une colonne de glace de révolution, de profil fixe (pas de
// simulation). Indices vrais : glace 1,309, eau 1,333, air 1. La glace ne se
// lit que par ce qui la fait voir pour de vrai : liseré de réflexion totale aux
// incidences rasantes, bulles (réflexion totale sur leur bord), cœur laiteux,
// partie émergée, reflet dans le miroir de la surface, et, sur l'humeur
// Ombroscopie, la déviation d'un faisceau parallèle par la glace et par la
// couche limite (champ de température synthétique, épaisseur δ ∝ s^1/4).
//
// URL : ?mood=nuit|ombro|lait|snell|tourbe|pierre  &shape=aiguille|festons|col
//       &all (les 18 images, envoyées au collecteur tools/sink.py sur 8099)
//       &spp=8 (passes accumulées)

const params = new URLSearchParams(location.search);
const MOODS = ['nuit', 'ombro', 'lait', 'snell', 'tourbe', 'pierre', 'soleil'];
const SHAPES = ['aiguille', 'festons', 'col', 'table'];
const W = 1280, H = 800;

// ── Humeurs : une eau et une lumière ────────────────────────────────────────
// absorb, sigS en cm⁻¹ ; couleurs en luminance linéaire
const MOOD = {
  nuit: {
    cam: [0, -5.2, 36], tgt: [0, -5.0, 0], fov: 26, exposure: 1.5,
    absorb: [0.004, 0.0015, 0.001], sigS: 0.004,
    deep: [0.0, 0.0, 0.0], shallow: [0.006, 0.008, 0.011],
    sky: [0.01, 0.012, 0.02], horizon: [0.02, 0.022, 0.03], sun: [0, 1, 0], sunI: 0,
    lb: [-0.85, 0.12, 0.5], lbI: 9, amb: [0.03, 0.033, 0.038],
    sunW: [0, 1, 0], glow: 0,
  },
  ombro: {
    cam: [-3.5, -5.2, 31], tgt: [-3.5, -5.0, -3], fov: 30, exposure: 0.9,
    absorb: [0.002, 0.0008, 0.0006], sigS: 0.001,
    deep: [0.5, 0.5, 0.5], shallow: [0.7, 0.7, 0.7],
    sky: [0.9, 0.9, 0.9], horizon: [0.9, 0.9, 0.9], sun: [0, 1, 0], sunI: 0,
    lb: [0, 0, 1], lbI: 0, amb: [0.55, 0.55, 0.55],
    sunW: [0, 1, 0], glow: 0, screenZ: -9, Ds: 11,
  },
  lait: {
    cam: [0, -2.5, 30], tgt: [0, -5.5, 0], fov: 30, exposure: 1.0,
    absorb: [0.02, 0.006, 0.009], sigS: 0.055,
    deep: [0.01, 0.06, 0.065], shallow: [0.28, 0.62, 0.58],
    sky: [1.0, 1.05, 1.1], horizon: [0.9, 0.95, 1.0], sun: [0.2, 0.9, 0.3], sunI: 0,
    lb: [0, 0, 1], lbI: 0, amb: [0.3, 0.55, 0.52],
    sunW: [0, 1, 0], glow: 1.0,
  },
  snell: {
    cam: [0, -15, 17], tgt: [0, -1.5, 0], fov: 34, exposure: 0.55,
    absorb: [0.006, 0.0018, 0.0012], sigS: 0.01,
    deep: [0.0, 0.012, 0.03], shallow: [0.04, 0.2, 0.3],
    sky: [0.35, 0.6, 1.2], horizon: [1.4, 1.5, 1.6], sun: [0.35, 0.8, -0.45], sunI: 300,
    lb: [0, 0, 1], lbI: 0, amb: [0.18, 0.32, 0.42],
    sunW: [0.26, 0.9, -0.34], glow: 2.0,
  },
  tourbe: {
    cam: [6, -6.5, 34], tgt: [0, -5.0, 0], fov: 26, exposure: 1.4,
    absorb: [0.012, 0.035, 0.1], sigS: 0.025,
    deep: [0.004, 0.002, 0.0], shallow: [0.4, 0.2, 0.06],
    sky: [1.2, 0.9, 0.6], horizon: [1.4, 1.0, 0.6], sun: [-0.7, 0.35, -0.6], sunI: 120,
    lb: [0, 0, 1], lbI: 0, amb: [0.16, 0.09, 0.035],
    sunW: [-0.55, 0.62, -0.55], glow: 3.0,
  },
  soleil: {
    cam: [4, -4, 26], tgt: [-1.5, -11.5, 0], fov: 40, exposure: 0.8,
    absorb: [0.004, 0.0012, 0.001], sigS: 0.004,
    deep: [0.03, 0.08, 0.1], shallow: [0.2, 0.38, 0.45],
    sky: [0.8, 0.9, 1.1], horizon: [1.0, 1.0, 1.0], sun: [0.35, 0.85, 0.3], sunI: 160,
    lb: [0, 0, 1], lbI: 0, amb: [0.3, 0.38, 0.42],
    sunW: [0.27, 0.92, 0.23], glow: 0.4, floorY: -17,
  },
  pierre: {
    cam: [5, -5.5, 30], tgt: [0, -5.0, 0], fov: 28, exposure: 0.9,
    absorb: [0.004, 0.0012, 0.001], sigS: 0.008,
    deep: [0.03, 0.07, 0.08], shallow: [0.25, 0.4, 0.45],
    sky: [0.8, 0.9, 1.1], horizon: [1.0, 1.0, 1.0], sun: [0.3, 0.9, 0.3], sunI: 80,
    lb: [0, 0, 1], lbI: 0, amb: [0.32, 0.38, 0.4],
    sunW: [0.22, 0.95, 0.22], glow: 0.5, wallZ: -9,
  },
};

const SHADER = /* wgsl */ `
struct U { v: array<vec4f, 20>, prof: array<vec4f, 80> };
@group(0) @binding(0) var<uniform> u: U;

const NW = 1.333;
const NI = 1.309;
const PI = 3.14159265;

fn R0() -> f32 { return u.v[10].x; }
fn LEN() -> f32 { return u.v[10].y; }
fn RC() -> f32 { return u.v[10].z * u.v[10].x; }
fn shapeId() -> f32 { return u.v[0].w; }
fn moodId() -> f32 { return u.v[4].w; }

fn hash31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn hash33(p: vec3f) -> vec3f { var q = fract(p * vec3f(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1,0,0)), w.x), mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), w.x), w.y),
             mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), w.x), mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), w.x), w.y), w.z);
}
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }

// ── Profils (cm). y = 0 : la surface ; la colonne pend sur LEN sous elle. ──
// phase des festons : λ = λ0 (hb/L)^(-3/4)  ⇒  φ = (L/λ0)(4/7)(hb/L)^(7/4)
fn scallopPhase(hb: f32) -> f32 {
  let L = LEN(); let l0 = 0.85;
  return (L / l0) * (4.0 / 7.0) * pow(max(hb, 0.0) / L, 1.75);
}
fn profile(y: f32) -> f32 {
  let r0 = R0();
  if (y >= 0.0) { return r0; }
  if (shapeId() > 2.5) {
    // profil simulé (P5) : rayon en mm par rangée de la grille, z depuis le fond
    let zm = u.v[16].x + y * 0.01;
    let fj = clamp(zm / u.v[16].y - 0.5, 0.0, u.v[16].z - 1.001);
    let j = u32(floor(fj)); let t = fj - floor(fj);
    let a0 = u.prof[j / 4u][j % 4u]; let a1 = u.prof[(j + 1u) / 4u][(j + 1u) % 4u];
    let wl = r0 * (1.0 - smoothstep(0.0, 1.0, -y));
    return smax(mix(a0, a1, t) * 0.1, wl, 0.25);
  }
  let h = -y; let L = LEN(); let hb = L - h;
  if (hb <= 0.0) { return 0.0; }
  let s = shapeId();
  var R = r0;
  if (s < 0.5) {
    // aiguille : couche limite montante, le bas s'effile en pointe à flancs concaves
    let x = clamp(hb / (0.9 * L), 0.0, 1.0);
    let t = 1.0 - (1.0 - x) * (1.0 - x);
    R = 0.9 * r0 * pow(t, 1.45);
  } else if (s < 1.5) {
    // festons : creux paraboliques, crêtes vives, longueur d'onde qui croît vers le bas
    let hbc = max(hb, 0.6);
    let lam = 0.85 * pow(hbc / L, -0.75);
    let f = fract(scallopPhase(hbc) + 0.35);
    let sc = 1.0 - (2.0 * f - 1.0) * (2.0 * f - 1.0);
    R = 0.8 * r0 - 0.11 * lam * sc;
    R *= sqrt(clamp(hb / 0.9, 0.0, 1.0)); // bout arrondi
  } else {
    // col : couche limite descendante depuis la surface ; col sous la ligne d'eau,
    // corps en goutte, bout émoussé
    let n = smoothstep(0.15, 4.5, h);
    R = r0 * (0.26 + 0.6 * pow(n, 0.8));
    let cap = clamp((hb) / 1.6, 0.0, 1.0);
    R *= sqrt(1.0 - (1.0 - cap) * (1.0 - cap));
  }
  // ligne d'eau : la partie émergée garde son rayon, l'encoche se raccorde sur 3 mm
  let wl = r0 * (1.0 - smoothstep(0.0, 1.0, h));
  return smax(R, wl, 0.25);
}

fn sdBody(p: vec3f) -> f32 {
  let r = length(p.xz);
  let yb = -LEN();
  if (p.y < yb) { return length(vec2f(r, p.y - yb)); }
  let R = profile(p.y);
  let e = 0.01;
  let dR = (profile(p.y + e) - profile(p.y - e)) / (2.0 * e);
  return (r - R) / sqrt(1.0 + dR * dR);
}
fn nrm(p: vec3f) -> vec3f {
  let e = 0.003; let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * sdBody(p + k.xyy * e) + k.yyx * sdBody(p + k.yyx * e) + k.yxy * sdBody(p + k.yxy * e) + k.xxx * sdBody(p + k.xxx * e));
}

fn fresnel(ci: f32, n1: f32, n2: f32) -> f32 {
  let eta = n1 / n2; let st2 = eta * eta * (1.0 - ci * ci);
  if (st2 >= 1.0) { return 1.0; }
  let ct = sqrt(1.0 - st2);
  let rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  let rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
  return 0.5 * (rs * rs + rp * rp);
}

// ── Lumières ─────────────────────────────────────────────────────────────────
fn sky(d: vec3f) -> vec3f {
  let zen = u.v[8].xyz; let hor = u.v[9].xyz;
  var c = mix(hor, zen, pow(clamp(d.y, 0.0, 1.0), 0.6));
  let sd = normalize(u.v[6].xyz);
  let cs = dot(d, sd);
  c += u.v[5].w * (smoothstep(0.99996, 0.99999, cs) + 0.002 * pow(max(cs, 0.0), 60.0));
  return c;
}
// boîte à lumière (rectangle doux) vue depuis l'eau, direction lb
fn softbox(d: vec3f) -> vec3f {
  let I = u.v[7].w;
  if (I <= 0.0) { return vec3f(0.0); }
  let lb = normalize(u.v[7].xyz);
  let c = dot(d, lb);
  if (c <= 0.0) { return vec3f(0.0); }
  let t1 = normalize(cross(lb, vec3f(0.0, 1.0, 0.0)));
  let t2 = cross(t1, lb);
  let q = d / c;
  let a = abs(dot(q, t1)); let b = abs(dot(q, t2));
  let m = (1.0 - smoothstep(0.22, 0.3, a)) * (1.0 - smoothstep(0.42, 0.5, b));
  return vec3f(1.0, 0.97, 0.93) * I * m;
}
// rayonnement de l'eau au loin (diffusion), plus la lueur vers le soleil
fn waterInf(d: vec3f) -> vec3f {
  let deep = u.v[4].xyz; let sh = u.v[5].xyz;
  var c = mix(deep, sh, smoothstep(-0.7, 0.95, d.y));
  let g = u.v[12].w;
  if (g > 0.0) {
    let sw = normalize(u.v[12].xyz);
    c += sh * g * pow(max(dot(d, sw), 0.0), 6.0);
  }
  return c + softbox(d);
}
// ce que reflète la glace : le ciel dans la fenêtre de Snell, l'eau ailleurs
fn envWater(d: vec3f) -> vec3f {
  if (d.y > 0.6614) { return sky(refract(d, vec3f(0.0, -1.0, 0.0), NW)) * 0.95; }
  if (d.y > 0.0) { return waterInf(vec3f(d.x, -d.y, d.z)); } // miroir
  return waterInf(d);
}

// ── Fond : écran d'ombroscopie, mur de pierre ────────────────────────────────
fn blDelta(y: f32) -> f32 {
  let L = LEN(); let h = max(-y, 0.0); let hb = max(L - h, 0.0);
  let d0 = u.v[14].z;
  let s = shapeId();
  if (s < 0.5) { return d0 * pow(max(hb, 0.05) / L, 0.25); }
  if (s < 1.5) {
    let f = fract(scallopPhase(max(hb, 0.6)) + 0.35);
    return d0 * pow(max(hb, 0.05) / L, 0.25) * (0.7 + 0.8 * (1.0 - (2.0 * f - 1.0) * (2.0 * f - 1.0)));
  }
  return d0 * pow(max(h, 0.05) / L, 0.25);
}
// Φ(x, y) = ∫ (n − n_eau) dz le long du faisceau parallèle (axe z)
fn phiAt(x: f32, y: f32) -> f32 {
  if (y > 0.0) { return 0.0; }
  let R = profile(y);
  var phi = 0.0;
  let ax = abs(x);
  if (ax < R && u.v[13].z < 0.5) { phi += (NI - NW) * 2.0 * sqrt(R * R - x * x); }
  // couche limite : T = T∞(1 − e^(−d/δ)), n − n∞ = 2,6e-6·T∞·e^(−d/δ)
  let dl = blDelta(y);
  let tinf = u.v[10].w;
  let z0 = sqrt(max(R * R - x * x, 0.0));
  let zmax = sqrt(max((R + 6.0 * dl) * (R + 6.0 * dl) - x * x, 0.0));
  if (zmax > z0) {
    let N = 20;
    let dz = (zmax - z0) / f32(N);
    var acc = 0.0;
    for (var i = 0; i < N; i++) {
      let z = z0 + (f32(i) + 0.5) * dz;
      let r = sqrt(x * x + z * z);
      acc += exp(-max(r - R, 0.0) / dl);
    }
    phi += 2.0 * 2.6e-6 * tinf * acc * dz;
  }
  return phi;
}
fn screenLight(x: f32, y: f32) -> f32 {
  let h = 0.012;
  let c = phiAt(x, y);
  let hxx = (phiAt(x + h, y) - 2.0 * c + phiAt(x - h, y)) / (h * h);
  let hyy = (phiAt(x, y + h) - 2.0 * c + phiAt(x, y - h)) / (h * h);
  let hxy = (phiAt(x + h, y + h) - phiAt(x + h, y - h) - phiAt(x - h, y + h) + phiAt(x - h, y - h)) / (4.0 * h * h);
  let a = u.v[14].w / NW;
  let det = (1.0 + a * hxx) * (1.0 + a * hyy) - a * a * hxy * hxy;
  var I = clamp(1.0 / max(abs(det), 0.04), 0.0, 3.0);
  // ombre du cœur laiteux
  let R = profile(y);
  let rc = min(RC(), R);
  let ch = 2.0 * sqrt(max(rc * rc - x * x, 0.0));
  I *= exp(-u.v[14].y * 0.6 * ch);
  return I;
}
fn caustic(p: vec2f) -> f32 {
  var c = 0.0;
  var q = p;
  for (var i = 0; i < 4; i++) {
    let w = vec2f(sin(q.y * 1.7 + f32(i) * 1.3), cos(q.x * 1.5 - f32(i) * 0.7));
    q = q * 1.21 + w * 0.6;
    c += pow(1.0 - abs(sin(q.x + 0.5 * sin(q.y))), 10.0) * pow(1.0 - abs(sin(q.y * 0.9 + 0.5 * cos(q.x))), 4.0);
  }
  return c;
}
fn limestone(p: vec2f) -> vec3f {
  let n = noise3(vec3f(p * 0.9, 0.0)) * 0.5 + noise3(vec3f(p * 3.1, 2.0)) * 0.3 + noise3(vec3f(p * 11.0, 5.0)) * 0.2;
  return vec3f(0.74, 0.71, 0.64) * (0.82 + 0.3 * n);
}
// distance au fond plan (écran ou mur) le long de d, ou 1e9
fn backdropT(p: vec3f, d: vec3f) -> f32 {
  let m = moodId();
  var zb = 0.0;
  if (abs(m - 1.0) < 0.5) { zb = u.v[8].w; }
  else if (abs(m - 5.0) < 0.5) { zb = u.v[9].w; }
  else if (abs(m - 6.0) < 0.5) { if (d.y >= -1e-4) { return 1e9; } return (u.v[18].w - p.y) / d.y; }
  else { return 1e9; }
  if (d.z >= -1e-4) { return 1e9; }
  return (zb - p.z) / d.z;
}
fn backdrop(p: vec3f) -> vec3f {
  let m = moodId();
  if (abs(m - 1.0) < 0.5) {
    // faisceau parallèle horizontal, oblique de 35° : l'ombre tombe à côté de la colonne
    let b = normalize(vec3f(-0.574, 0.0, -0.819));
    let xp = p.x * b.z - p.z * b.x;
    return vec3f(1.0, 0.97, 0.92) * (screenLight(xp, p.y) * abs(b.z) * 1.2 + 0.08);
  }
  if (abs(m - 6.0) < 0.5) {
    // fond de sable pâle au soleil : l'ombre de la glace et des nappes
    let sw = normalize(u.v[12].xyz);
    let sand = vec3f(0.82, 0.78, 0.68) * (0.85 + 0.25 * noise3(vec3f(p.xz * 2.0, 1.0)) + 0.1 * noise3(vec3f(p.xz * 9.0, 4.0)));
    var I = 1.0;
    if (u.v[16].w > 0.5) { I = floorLight(p); }
    return sand * (u.v[5].w * 0.006 * sw.y * I + u.v[11].xyz);
  }
  // mur de pierre sous le soleil filtré par la surface ridée
  let depthF = exp(p.y * 0.04);
  let E = u.v[5].w * 0.012 * caustic(p.xy * 0.55) * depthF + 0.7;
  return limestone(p.xy) * u.v[11].xyz * E;
}

// ── La glace émergée, dans l'air ─────────────────────────────────────────────
fn airScene(p: vec3f, d: vec3f) -> vec3f {
  // cylindre de rayon R0 au-dessus de y = 0
  let r0 = R0();
  let a = d.x * d.x + d.z * d.z;
  let b = p.x * d.x + p.z * d.z;
  let c = p.x * p.x + p.z * p.z - r0 * r0;
  let disc = b * b - a * c;
  if (a > 1e-6 && disc > 0.0) {
    let t = (-b - sqrt(disc)) / a;
    if (t > 0.0) {
      let q = p + d * t;
      let n = normalize(vec3f(q.x, 0.0, q.z));
      let sd = normalize(u.v[6].xyz);
      let frost = 0.55 + 0.25 * noise3(q * 40.0);
      return frost * (u.v[9].xyz * 0.6 + u.v[5].w * 0.004 * max(dot(n, sd), 0.0)) + sky(reflect(d, n)) * 0.05;
    }
  }
  return sky(d);
}

// ── Intérieur de la glace : cœur laiteux, chapelets de bulles ───────────────
struct Ray { p: vec3f, d: vec3f, T: vec3f, L: vec3f, done: bool };

// corde de q jusqu'à la surface de la glace dans la direction l (profil local, en xz)
fn chordToSurf(q: vec3f, l: vec3f) -> f32 {
  let lx = vec2f(l.x, l.z); let ln = length(lx);
  if (ln < 1e-3) { return 6.0; }
  let dir = lx / ln;
  let R = profile(q.y);
  let b = dot(q.xz, dir); let c = dot(q.xz, q.xz) - R * R;
  let disc = b * b - c;
  if (disc < 0.0) { return 0.0; }
  return max(-b + sqrt(disc), 0.0) / ln;
}
// lumière diffusée par la glace bulleuse (albédo 0,92, isotrope)
fn inscatter(q: vec3f, dens: f32) -> vec3f {
  var s = u.v[11].xyz * 1.3;
  if (u.v[7].w > 0.0) { s += vec3f(1.0, 0.97, 0.93) * u.v[7].w * 0.08 * exp(-dens * chordToSurf(q, normalize(u.v[7].xyz))); }
  if (u.v[5].w > 0.0) { s += mix(vec3f(1.0), u.v[5].xyz * 2.0, 0.5) * u.v[5].w * 0.006 * exp(-dens * chordToSurf(q, normalize(u.v[12].xyz))); }
  return s * 0.92;
}

fn iceInterior(r0: Ray) -> Ray {
  var r = r0;
  let step = 0.028;
  let rc = RC();
  let sig0 = u.v[14].y;
  let amb = u.v[11].xyz + vec3f(0.012 * u.v[7].w);
  var lastCell = vec3f(-999.0);
  var t = 0.0;
  for (var i = 0; i < 220; i++) {
    let q0 = r.p + r.d * t;
    let q = q0 + r.d * step;
    if (q.y > 0.0) { // dans la partie émergée : on la voit de l'intérieur, givrée
      r.L += r.T * u.v[9].xyz * 0.35;
      r.done = true;
      return r;
    }
    // cœur laiteux (les bulles fines chassées par le front de gel)
    let rr = length(q.xz);
    let dens = u.v[13].y * (0.7 + 0.3 * noise3(q * 3.0)) + sig0 * (1.0 - smoothstep(0.7 * rc, rc, rr)) * (0.55 + 0.45 * noise3(q * vec3f(2.0, 0.6, 2.0)));
    if (dens > 0.0) {
      let tr = exp(-dens * step);
      r.L += r.T * (1.0 - tr) * inscatter(q, dens);
      r.T *= tr;
    }
    // chapelets de bulles : alignés verticalement, entre le cœur et la gaine claire
    let ang = atan2(q0.z, q0.x);
    let na = 34.0;
    let cell = vec3f(floor((ang + PI) / (2.0 * PI) * na), floor(length(q0.xz) / 0.16), floor(q0.y / 0.17));
    if (any(cell != lastCell)) {
      let hs = hash33(vec3f(cell.x, cell.y, 7.0));        // le chapelet
      let hb = hash33(cell);                               // la bulle
      let rcen = (cell.y + 0.25 + 0.5 * hs.y) * 0.16;
      let band = smoothstep(0.85 * rc, rc * 1.1, rcen) * (1.0 - smoothstep(0.78 * R0(), 0.9 * R0(), rcen));
      if (hs.z < 0.55 && hb.x < band * 0.8) {
        let ac = (cell.x + 0.3 + 0.4 * hs.x) / na * 2.0 * PI - PI;
        let cen = vec3f(cos(ac) * rcen, (cell.z + 0.3 + 0.4 * hb.y) * 0.17, sin(ac) * rcen);
        let rb = 0.012 + 0.035 * hb.z * hb.z;
        let v = cen - q0;
        let tp = clamp(dot(v, r.d), 0.0, step);
        let bdist = length(v - r.d * tp);
        if (bdist < rb) {
          lastCell = cell;
          let imp = bdist / rb;
          if (imp > 0.76) { // réflexion totale sur le bord de la bulle (glace → air)
            r.L += r.T * envWater(reflect(r.d, normalize(q0 + r.d * tp - cen))) * 0.9;
            r.T *= 0.08;
          } else {
            r.T *= 0.85;
          }
        }
      }
    }
    if (max(r.T.x, max(r.T.y, r.T.z)) < 0.003) { r.done = true; return r; }
    if (sdBody(q) > 0.0) {
      // sortie : dichotomie, réfraction glace → eau (jamais de réflexion totale)
      var a = t; var b = t + step;
      for (var k = 0; k < 6; k++) { let m = 0.5 * (a + b); if (sdBody(r.p + r.d * m) > 0.0) { b = m; } else { a = m; } }
      let pe = r.p + r.d * b;
      let n = nrm(pe);
      let dout = refract(r.d, -n, NI / NW);
      r.p = pe + n * 0.004;
      r.d = normalize(dout);
      return r;
    }
    t += step;
  }
  r.done = true;
  return r;
}

// ── Eau trouble et eau de fonte (P5) : la fraction d'eau de fonte vaut
// c = (T∞ − T)/T∞ (mélange d'eau à 0 °C et d'eau du lac) ; l'eau de fonte est
// limpide, la diffusion y vaut σs(1 − c).
@group(0) @binding(3) var<storage, read> tf: array<f32>;
fn tAt(p: vec3f) -> f32 {
  let dxm = u.v[16].y; let nr = u.v[16].w; let nz = u.v[16].z;
  let fi = length(p.xz) * 0.01 / dxm - 0.5; let fj = (u.v[16].x + p.y * 0.01) / dxm - 0.5;
  if (fi > nr - 1.5 || fj < 0.0 || fj > nz - 1.5) { return u.v[10].w; }
  let i = u32(max(fi, 0.0)); let j = u32(fj); let a = clamp(fi - f32(i), 0.0, 1.0); let b = fj - f32(j);
  let n = u32(nr); let q = j * n + i;
  return mix(mix(tf[2u * q], tf[2u * (q + 1u)], a), mix(tf[2u * (q + n)], tf[2u * (q + n + 1u)], a), b);
}
// second champ (P7) : fraction de glace fs
fn iceAt(p: vec3f) -> f32 {
  let dxm = u.v[16].y; let nr = u.v[16].w; let nz = u.v[16].z;
  let fi = length(p.xz) * 0.01 / dxm - 0.5; let fj = (u.v[16].x + p.y * 0.01) / dxm - 0.5;
  if (fi > nr - 1.5 || fj < 0.0 || fj > nz - 1.5) { return 0.0; }
  let i = u32(max(fi, 0.0)); let j = u32(fj); let a = clamp(fi - f32(i), 0.0, 1.0); let b = fj - f32(j);
  let n = u32(nr); let q = j * n + i;
  return mix(mix(tf[2u * q + 1u], tf[2u * (q + 1u) + 1u], a), mix(tf[2u * (q + n) + 1u], tf[2u * (q + n + 1u) + 1u], a), b);
}
// fraction d'eau de fonte : par la température (P5, eau douce) ou par le sel (P7)
fn meltFrac(q: vec3f) -> f32 {
  if (u.v[18].z > 0.5) {
    let z = u.v[16].x + q.y * 0.01;
    let sInf = u.v[18].x + (u.v[18].y - u.v[18].x) * z / u.v[16].x;
    return clamp(-tAt(q) / max(sInf, 0.1), 0.0, 1.0);
  }
  return clamp((u.v[10].w - tAt(q)) / max(u.v[10].w, 0.1), 0.0, 1.0);
}
// gradient de l'indice dû au sel (par cm) : n = n0 + dn/dS · (S − S∞) (+ le fond, négligeable)
fn gradN(q: vec3f) -> vec3f {
  let e = 0.04;
  let g = vec3f(tAt(q + vec3f(e, 0.0, 0.0)) - tAt(q - vec3f(e, 0.0, 0.0)), tAt(q + vec3f(0.0, e, 0.0)) - tAt(q - vec3f(0.0, e, 0.0)), tAt(q + vec3f(0.0, 0.0, e)) - tAt(q - vec3f(0.0, 0.0, e))) / (2.0 * e);
  return u.v[19].x * g;
}
fn gradIce(q: vec3f) -> vec3f {
  let e = 0.04;
  let g = vec3f(iceAt(q + vec3f(e, 0.0, 0.0)) - iceAt(q - vec3f(e, 0.0, 0.0)), iceAt(q + vec3f(0.0, e, 0.0)) - iceAt(q - vec3f(0.0, e, 0.0)), iceAt(q + vec3f(0.0, 0.0, e)) - iceAt(q - vec3f(0.0, 0.0, e))) / (2.0 * e);
  return (NI - NW) * g;
}
// ombre au soleil sur le fond (P7) : déplacement du faisceau parallèle à
// l'arrivée sur le fond (plan horizontal), et profondeur optique de la glace
fn floorDelta(P: vec3f) -> vec3f {
  let sw = normalize(u.v[12].xyz);
  let yb = -u.v[16].x * 100.0;
  // portion de la droite P + sw·s dans le cylindre du domaine
  let Rd = 3.8; let A = dot(sw.xz, sw.xz); let B = dot(P.xz, sw.xz); let C = dot(P.xz, P.xz) - Rd * Rd;
  let disc = B * B - A * C;
  if (disc <= 0.0) { return vec3f(0.0); }
  var a0 = (-B - sqrt(disc)) / A; var a1 = (-B + sqrt(disc)) / A;
  a0 = max(a0, (yb - P.y) / sw.y); a1 = min(a1, (0.0 - P.y) / sw.y);
  if (a1 <= a0) { return vec3f(0.0); }
  let N = 72; let h = (a1 - a0) / f32(N);
  var dlt = vec3f(0.0); var tau = 0.0;
  for (var m = 0; m < N; m++) {
    let s = a0 + (f32(m) + 0.5) * h;
    let q = P + sw * s;
    var g = gradIce(q);
    if (u.v[19].z > 0.5) { g += gradN(q); }
    let gp = g - dot(g, sw) * sw;
    dlt += s * gp * h / NW;
    tau += u.v[19].y * iceAt(q) * h;
  }
  return vec3f(dlt.x - dlt.y * sw.x / sw.y, dlt.z - dlt.y * sw.z / sw.y, tau);
}
// ombroscopie de laboratoire (P7) : faisceau horizontal le long de z, à
// travers le champ simulé ; écran à Ds (u.v[14].w) cm
fn phiField(x: f32, y: f32) -> f32 {
  let N = 128; let zmax = 3.8; let h = zmax / f32(N);
  var acc = 0.0;
  for (var m = 0; m < N; m++) {
    let q = vec3f(x, y, (f32(m) + 0.5) * h);
    acc += u.v[19].x * tAt(q) + (NI - NW) * iceAt(q);
  }
  return 2.0 * acc * h;
}
fn screenField(x: f32, y: f32) -> f32 {
  let h = u.v[19].w; // pas des différences finies : ≥ 2 mailles, sinon on lit la grille bilinéaire
  let c = phiField(x, y);
  let hxx = (phiField(x + h, y) - 2.0 * c + phiField(x - h, y)) / (h * h);
  let hyy = (phiField(x, y + h) - 2.0 * c + phiField(x, y - h)) / (h * h);
  let hxy = (phiField(x + h, y + h) - phiField(x + h, y - h) - phiField(x - h, y + h) + phiField(x - h, y - h)) / (4.0 * h * h);
  let a = u.v[14].w / NW;
  let det = (1.0 + a * hxx) * (1.0 + a * hyy) - a * a * hxy * hxy;
  var I = clamp(1.0 / max(abs(det), 0.04), 0.0, 3.0);
  // la glace bulleuse diffuse : l'ombre se voile
  var tau = 0.0; let N = 64; let hz = 3.8 / f32(N);
  for (var m = 0; m < N; m++) { tau += u.v[19].y * iceAt(vec3f(x, y, (f32(m) + 0.5) * hz)) * hz; }
  return I * exp(-2.0 * tau);
}
fn floorLight(P: vec3f) -> f32 {
  let e = 0.04;
  let c = floorDelta(P);
  let dxp = floorDelta(P + vec3f(e, 0.0, 0.0)); let dxm = floorDelta(P - vec3f(e, 0.0, 0.0));
  let dzp = floorDelta(P + vec3f(0.0, 0.0, e)); let dzm = floorDelta(P - vec3f(0.0, 0.0, e));
  let j00 = 1.0 + (dxp.x - dxm.x) / (2.0 * e); let j01 = (dzp.x - dzm.x) / (2.0 * e);
  let j10 = (dxp.y - dxm.y) / (2.0 * e); let j11 = 1.0 + (dzp.y - dzm.y) / (2.0 * e);
  let det = j00 * j11 - j01 * j10;
  return exp(-c.z) * clamp(1.0 / max(abs(det), 0.05), 0.0, 4.0);
}
fn fogSeg(r: ptr<function, Ray>, t: f32) {
  let absorb = u.v[3].xyz; let sigS = u.v[3].w;
  let p = (*r).p; let d = (*r).d;
  var t0 = t; var t1 = t;
  if (u.v[16].w > 0.5 && (sigS > 0.0 || u.v[19].z > 0.5)) {
    // portion du segment dans le cylindre du domaine simulé (r < 3,8 cm, −14 < y < 0)
    let Rd = 3.8; let A = dot(d.xz, d.xz); let B = dot(p.xz, d.xz); let C = dot(p.xz, p.xz) - Rd * Rd;
    let disc = B * B - A * C;
    if (A > 1e-8 && disc > 0.0) {
      var a0 = (-B - sqrt(disc)) / A; var a1 = (-B + sqrt(disc)) / A;
      if (abs(d.y) > 1e-6) { let y0 = (-u.v[16].x * 100.0 - p.y) / d.y; let y1 = (0.0 - p.y) / d.y; a0 = max(a0, min(y0, y1)); a1 = min(a1, max(y0, y1)); }
      t0 = clamp(a0, 0.0, t); t1 = clamp(a1, 0.0, t);
    }
  }
  // dehors : analytique ; dedans : marche
  let segs = array<vec2f, 3>(vec2f(0.0, t0), vec2f(t0, t1), vec2f(t1, t));
  for (var k = 0; k < 3; k++) {
    let s0 = segs[k].x; let s1 = segs[k].y; let len = s1 - s0;
    if (len <= 0.0) { continue; }
    if (k != 1) {
      // sous-pas de longueur croissante : la couleur de la brume suit la hauteur
      var a = s0;
      for (var m = 0; m < 24; m++) {
        let bnd = min(s1, s0 + len * pow(f32(m + 1) / 24.0, 2.0));
        let hh = bnd - a;
        if (hh <= 0.0) { continue; }
        let fogC = mix(u.v[4].xyz, u.v[5].xyz, smoothstep(-30.0, 0.0, p.y + d.y * (a + 0.5 * hh)));
        (*r).L += (*r).T * (vec3f(1.0) - exp(-vec3f(sigS) * hh)) * fogC;
        (*r).T *= exp(-(absorb + vec3f(sigS)) * hh);
        a = bnd;
      }
    } else {
      let M = 96; let h = len / f32(M);
      var dacc = vec3f(0.0);
      for (var m = 0; m < M; m++) {
        let q = p + d * (s0 + (f32(m) + 0.5) * h);
        if (u.v[19].z > 0.5) { let gn = gradN(q); dacc += h * (gn - dot(gn, d) * d) / NW; }
        let c = meltFrac(q);
        let sl = sigS * (1.0 - c);
        let fogC = mix(u.v[4].xyz, u.v[5].xyz, smoothstep(-30.0, 0.0, q.y));
        (*r).L += (*r).T * (vec3f(1.0) - exp(-vec3f(sl) * h)) * fogC;
        (*r).T *= exp(-(absorb + vec3f(sl)) * h);
      }
      if (u.v[19].z > 0.5) { (*r).d = normalize(d + dacc); }
    }
  }
}

fn trace(ro: vec3f, rd: vec3f) -> vec3f {
  var r = Ray(ro, rd, vec3f(1.0), vec3f(0.0), false);
  let absorb = u.v[3].xyz; let sigS = u.v[3].w;
  for (var bounce = 0; bounce < 6; bounce++) {
    let tS = select(1e9, -r.p.y / r.d.y, r.d.y > 1e-5);
    let tB = backdropT(r.p, r.d);
    let tmax = min(min(tS, tB), 140.0);
    var t = 0.0; var hit = false;
    for (var i = 0; i < 260; i++) {
      let s = sdBody(r.p + r.d * t);
      if (s < 0.0015) { hit = true; break; }
      t += max(s * 0.75, 0.0015);
      if (t > tmax) { break; }
    }
    t = min(t, tmax);
    // l'eau traversée : absorption et diffusion vers la couleur de l'eau
    fogSeg(&r, t);
    r.p = r.p + r.d * t;
    if (hit) {
      let n = nrm(r.p);
      let ci = -dot(r.d, n);
      let eta = NW / NI;
      let k = 1.0 - eta * eta * (1.0 - ci * ci);
      if (k < 0.0 || ci <= 0.0) { // réflexion totale : le liseré
        r.d = reflect(r.d, n);
        r.p += n * 0.004;
        continue;
      }
      let F = fresnel(ci, NW, NI);
      r.L += r.T * F * envWater(reflect(r.d, n));
      r.T *= (1.0 - F);
      r.d = normalize(refract(r.d, n, eta));
      r.p -= n * 0.004;
      r = iceInterior(r);
      if (r.done) { break; }
      continue;
    }
    if (tS <= tB && t >= tS - 1e-3 && tS < 140.0) {
      // la surface, vue de dessous : fenêtre de Snell ou miroir
      let ci = r.d.y;
      let F = fresnel(ci, NW, 1.0);
      if (F < 1.0) {
        let dt = refract(r.d, vec3f(0.0, -1.0, 0.0), NW);
        r.L += r.T * (1.0 - F) * airScene(vec3f(r.p.x, 0.0, r.p.z), normalize(dt));
      }
      r.T *= F;
      r.d = vec3f(r.d.x, -r.d.y, r.d.z);
      r.p.y = -0.002;
      continue;
    }
    if (tB < tS && t >= tB - 1e-3) { r.L += r.T * backdrop(r.p); break; }
    r.L += r.T * waterInf(r.d);
    break;
  }
  return r.L;
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var P = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(P[i], 0.0, 1.0);
}

@fragment fn fsTrace(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = u.v[0].xy;
  let jit = u.v[15].xy;
  let uv = (fc.xy - vec2f(0.5) + jit) / res;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let cp = u.v[1].xyz; let ct = u.v[2].xyz;
  let f = normalize(ct - cp);
  let rgt = normalize(cross(f, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rgt, f);
  let th = tan(u.v[1].w * 0.5);
  let rd = normalize(f + ndc.x * th * (res.x / res.y) * rgt + ndc.y * th * up);
  let c = trace(cp, rd);
  return vec4f(c, 1.0);
}

@group(0) @binding(1) var acc: texture_2d<f32>;
@group(0) @binding(2) var bub: texture_2d<f32>;
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fsShow(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let c = (textureLoad(acc, vec2i(fc.xy), 0).rgb / u.v[15].z + textureLoad(bub, vec2i(fc.xy), 0).rgb) * u.v[2].w;
  let res = u.v[0].xy;
  let q = fc.xy / res - 0.5;
  let vig = 1.0 - 0.35 * dot(q, q);
  var m = aces(c * vig);
  m = pow(m, vec3f(1.0 / 2.2));
  m += (hash31(vec3f(fc.xy, 3.0)) - 0.5) / 255.0;
  return vec4f(m, 1.0);
}
`;

async function main() {
  const info = document.querySelector('#info');
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) { info.textContent = 'pas de WebGPU'; return; }
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e) => { console.error(e.error.message); window.__err = e.error.message; });
  const canvas = document.querySelector('#c');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('webgpu');
  const fmt = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: fmt, alphaMode: 'opaque' });

  const module = device.createShaderModule({ code: SHADER });
  const info2 = await module.getCompilationInfo();
  for (const m of info2.messages) console[m.type === 'error' ? 'error' : 'log'](`${m.lineNum}:${m.linePos} ${m.message}`);
  if (info2.messages.some((m) => m.type === 'error')) { window.__err = info2.messages.map((m) => `${m.lineNum}: ${m.message}`).join('\n'); return; }

  const ubuf = device.createBuffer({ size: 100 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const accTex = device.createTexture({ size: [W, H], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const outTex = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });

  const bglT = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} }] });
  const bglS = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
  ] });
  const tBuf = device.createBuffer({ size: 80 * 320 * 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // bulles (P5) : traits additifs dans une texture à part
  const bubTex = device.createTexture({ size: [W, H], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const bubView = bubTex.createView();
  const mkShow = (format) => device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglS] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fsShow', targets: [{ format }] },
  });
  const pShowCanvas = mkShow(fmt), pShowOut = mkShow('rgba8unorm');
  const bgT = device.createBindGroup({ layout: bglT, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  const bgS = device.createBindGroup({ layout: bglS, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: accTex.createView() }, { binding: 2, resource: bubView }, { binding: 3, resource: { buffer: tBuf } }] });

  // le pas de 32 bits flottants ne se mélange pas : on accumule à la main dans
  // un second tampon (ping-pong) — plus simple : une passe = une image, et on
  // moyenne sur le CPU ? Non : on accumule en lisant la passe précédente.
  // Ici : chaque passe écrit la somme (texture lue + nouvel échantillon).
  const accB = device.createTexture({ size: [W, H], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const SUMSH = SHADER.replace('@fragment fn fsTrace', '@fragment fn fsTraceUnused') + `
@group(0) @binding(1) var prev: texture_2d<f32>;
@fragment fn fsSum(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = u.v[0].xy;
  let jit = u.v[15].xy;
  let uv = (fc.xy - vec2f(0.5) + jit) / res;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let cp = u.v[1].xyz; let ct = u.v[2].xyz;
  let f = normalize(ct - cp);
  let rgt = normalize(cross(f, vec3f(0.0, 1.0, 0.0)));
  let up = cross(rgt, f);
  let th = tan(u.v[1].w * 0.5);
  let rd = normalize(f + ndc.x * th * (res.x / res.y) * rgt + ndc.y * th * up);
  var c = vec3f(0.0);
  if (u.v[13].x > 1.5) { c = vec3f(screenField((uv.x - 0.5) * 16.0 * res.x / res.y, -uv.y * 16.0)); }
  else if (u.v[13].x > 0.5) { c = vec3f(screenLight((uv.x - 0.5) * 12.8, 1.0 - uv.y * 12.0)); }
  else { c = trace(cp, rd); }
  return vec4f(textureLoad(prev, vec2i(fc.xy), 0).rgb + c, 1.0);
}`.replace('@group(0) @binding(1) var acc: texture_2d<f32>;', '');
  // (fsShow lit « acc » : on le remplace dans le module de somme par « prev »)
  const sumModule = device.createShaderModule({ code: SUMSH.replace(/textureLoad\(acc,/g, 'textureLoad(prev,') });
  const ci2 = await sumModule.getCompilationInfo();
  if (ci2.messages.some((m) => m.type === 'error')) { window.__err = ci2.messages.map((m) => `${m.lineNum}: ${m.message}`).join('\n'); console.error(window.__err); return; }
  const pSum = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglS] }),
    vertex: { module: sumModule, entryPoint: 'vs' },
    fragment: { module: sumModule, entryPoint: 'fsSum', targets: [{ format: 'rgba32float' }] },
  });
  const bgSumFromA = device.createBindGroup({ layout: bglS, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: accTex.createView() }, { binding: 2, resource: bubView }, { binding: 3, resource: { buffer: tBuf } }] });
  const bgSumFromB = device.createBindGroup({ layout: bglS, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: accB.createView() }, { binding: 2, resource: bubView }, { binding: 3, resource: { buffer: tBuf } }] });
  const bgShowB = device.createBindGroup({ layout: bglS, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: accB.createView() }, { binding: 2, resource: bubView }, { binding: 3, resource: { buffer: tBuf } }] });
  void bgT;

  const SEG = /* wgsl */ `
struct U { v: array<vec4f, 20>, prof: array<vec4f, 80> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> segs: array<f32>;
struct VO { @builtin(position) pos: vec4f, @location(0) w: vec3f };
fn proj(p: vec3f) -> vec4f {
  let cp = u.v[1].xyz; let f = normalize(u.v[2].xyz - cp);
  let rgt = normalize(cross(f, vec3f(0.0, 1.0, 0.0))); let up = cross(rgt, f);
  let th = tan(u.v[1].w * 0.5); let asp = u.v[0].x / u.v[0].y;
  let d = p - cp;
  return vec4f(dot(d, rgt) / (th * asp), dot(d, up) / th, 0.5, dot(d, f));
}
@vertex fn vsSeg(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  let b = ii * 7u;
  let p0 = vec3f(segs[b], segs[b + 1u], segs[b + 2u]);
  let p1 = vec3f(segs[b + 3u], segs[b + 4u], segs[b + 5u]);
  let rb = segs[b + 6u] * 1e-4; // µm → cm
  let c0 = proj(p0); let c1 = proj(p1);
  let res = u.v[0].xy;
  let s0 = c0.xy / c0.w * res * 0.5; let s1 = c1.xy / c1.w * res * 0.5;
  var dir = s1 - s0; let L = length(dir);
  if (L < 1e-3) { dir = vec2f(1.0, 0.0); } else { dir = dir / L; }
  let nrm = vec2f(-dir.y, dir.x);
  let pxPerCm = res.y * 0.5 / (tan(u.v[1].w * 0.5) * c1.w);
  let rpx = rb * pxPerCm;
  let hw = max(0.7, rpx);
  var C = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = C[vi];
  let len = L + 2.0 * hw;
  let sp = s0 - dir * hw + dir * len * k.x + nrm * hw * k.y;
  // l'énergie du disque de la bulle, étalée sur le trait
  let I = 3.14159 * rpx * rpx / (len * 2.0 * hw);
  o.pos = vec4f(sp / (res * 0.5), 0.5, 1.0);
  if (c0.w < 0.1 || c1.w < 0.1) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  o.w = vec3f(k.x, k.y, I);
  return o;
}
@fragment fn fsSeg(i: VO) -> @location(0) vec4f {
  let across = 1.0 - abs(i.w.y);
  let head = 0.3 + 0.7 * i.w.x; // plus clair à la position actuelle
  return vec4f(u.v[17].xyz * i.w.z * across * head * 2.0 * u.v[17].w, 1.0);
}`;
  const segModule = device.createShaderModule({ code: SEG });
  const ci3 = await segModule.getCompilationInfo();
  if (ci3.messages.some((m) => m.type === 'error')) { window.__err = ci3.messages.map((m) => `${m.lineNum}: ${m.message}`).join('\n'); console.error(window.__err); return; }
  const bglG = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
  ] });
  const pSeg = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bglG] }),
    vertex: { module: segModule, entryPoint: 'vsSeg' },
    fragment: { module: segModule, entryPoint: 'fsSeg', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list' },
  });
  let segBuf = null, segBG = null, nSeg = 0;
  function setBubbles(segs) {
    nSeg = segs ? segs.length : 0;
    if (!nSeg) return;
    const arr = new Float32Array(nSeg * 7); segs.forEach((q, n) => arr.set(q, n * 7));
    segBuf = device.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(segBuf, 0, arr);
    segBG = device.createBindGroup({ layout: bglG, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: segBuf } }] });
  }

  const U = new Float32Array(100 * 4);
  const setU = (mood, shape, jit, spp, ice) => {
    const M = { ...MOOD[mood], ...(window.__cam ?? {}) };
    const s = (i, a, b = 0, c = 0, d = 0) => U.set([a, b, c, d], i * 4);
    s(0, W, H, 0, SHAPES.indexOf(shape));
    s(1, ...M.cam, M.fov * Math.PI / 180);
    s(2, ...M.tgt, M.exposure);
    s(3, ...M.absorb, M.sigS);
    s(4, ...M.deep, MOODS.indexOf(mood));
    s(5, ...M.shallow, M.sunI);
    const sn = norm(M.sun); s(6, ...sn, 0);
    s(7, ...M.lb, M.lbI);
    s(8, ...M.sky, M.screenZ ?? 0);
    s(9, ...M.horizon, M.wallZ ?? 0);
    let Lcol = 10;
    if (shape === 'table' && window.__p5) { const P5 = window.__p5; let j = 0; while (j < P5.prof.length && P5.prof[j] < 0.3) j++; Lcol = (P5.Z - (j + 0.5) * P5.dx) * 100; }
    s(10, 1.4, Lcol, 0.38, shape === 'aiguille' ? 3 : shape === 'festons' ? 5.6 : 8.5);
    s(11, ...M.amb, 0);
    s(12, ...norm(M.sunW), M.glow);
    s(13, window.__dbg ?? 0, typeof ice === 'number' ? ice : ice === 'bulleuse' ? 1.6 : 0, window.__noIce ? 1 : 0, 0);
    s(14, 0.38, 5.0, 0.12, M.Ds ?? 30);
    s(15, jit[0], jit[1], spp, 0);
    const P5 = window.__p5;
    if (P5) {
      s(16, P5.Z, P5.dx, P5.prof.length, P5.T || P5.dS ? P5.nr : 0);
      if ((P5.T || P5.dS) && !P5.sent) {
        const f0 = P5.dS ?? P5.T, n = f0.length, arr = new Float32Array(2 * n);
        for (let q = 0; q < n; q++) { arr[2 * q] = f0[q]; arr[2 * q + 1] = P5.fs ? P5.fs[q] : 0; }
        device.queue.writeBuffer(tBuf, 0, arr); P5.sent = true;
      }
      U[10 * 4 + 3] = P5.Tinf;
      s(18, P5.Sbot ?? 0, P5.Stop ?? 0, P5.dS ? 1 : 0, M.floorY ?? -17);
      s(19, 1.9e-4, 0.5, P5.refract ? 1 : 0, window.__sgH ?? 0.12);
      for (let n = 0; n < 320; n++) U[20 * 4 + n] = n < P5.prof.length ? P5.prof[n] : 0;
      // rayonnement réfléchi par une bulle (réflexion totale sur 44 % de sa section)
      const g = M.amb.map((a) => 0.44 * (2 * a + 0.03 * M.lbI + 0.004 * (M.sunI ?? 0)));
      s(17, ...g, window.__bubGain ?? 1);
    }
    device.queue.writeBuffer(ubuf, 0, U);
  };

  async function render(mood, shape, spp, ice = 'claire') {
    const t0 = performance.now();
    // passe 0 : efface accTex (somme nulle)
    let enc = device.createCommandEncoder();
    for (const tex of [accTex, accB]) enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end();
    device.queue.submit([enc.finish()]);
    for (let k = 0; k < spp; k++) {
      // décalages de Halton (2, 3)
      const jit = [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5];
      setU(mood, shape, jit, spp, ice);
      enc = device.createCommandEncoder();
      const src = k % 2 === 0 ? accTex : accB, dst = k % 2 === 0 ? accB : accTex;
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pSum); pass.setBindGroup(0, src === accTex ? bgSumFromA : bgSumFromB); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    enc = device.createCommandEncoder();
    { const bp = enc.beginRenderPass({ colorAttachments: [{ view: bubView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      if (nSeg && window.__p5) { bp.setPipeline(pSeg); bp.setBindGroup(0, segBG); bp.draw(6, nSeg); }
      bp.end(); }
    device.queue.submit([enc.finish()]);
    const last = spp % 2 === 1 ? accB : accTex;
    const bgLast = last === accB ? bgShowB : bgS;
    enc = device.createCommandEncoder();
    for (const [pipe, view] of [[pShowCanvas, ctx.getCurrentTexture().createView()], [pShowOut, outTex.createView()]]) {
      const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(pipe); p.setBindGroup(0, bgLast); p.draw(3); p.end();
    }
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    info.textContent = `${mood} · ${shape} · ${ice} · ${spp} passes · ${ms.toFixed(0)} ms`;
    return ms;
  }

  async function send(name) {
    const bpr = Math.ceil(W * 4 / 256) * 256;
    const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: outTex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const img = new ImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(src.subarray(y * bpr, y * bpr + W * 4), y * W * 4);
    buf.unmap(); buf.destroy();
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d').putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    await fetch(`http://127.0.0.1:${params.get('sink') ?? 8097}/${name}`, { method: 'POST', body: blob });
  }

  window.p3 = { render, send, setBubbles, MOOD, MOODS, SHAPES };
  const spp = +(params.get('spp') ?? 8);
  if (params.has('all')) {
    window.__job = 'running';
    const times = [];
    for (const mood of MOODS) for (const shape of SHAPES) {
      times.push(await render(mood, shape, spp));
      await send(`p3-${mood}-${shape}.jpg`);
    }
    window.__job = `done ${times.map((t) => t.toFixed(0)).join(',')}`;
  } else {
    await render(params.get('mood') ?? 'nuit', params.get('shape') ?? 'festons', spp);
    window.__job = 'done';
  }
}

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

main().catch((e) => { console.error(e); window.__err = String(e); });
