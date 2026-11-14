// Le rendu : un lancer de rayons, en shader de calcul WebGPU, qui écrit l'image
// HDR dans une texture three.js ; la chaîne d'image commune (bloom,
// étalonnage, grain, anticrénelage) s'applique ensuite (scene/stage.js).
// Prototypes : proto/p3 (indices vrais, glace bulleuse, miroir de la surface),
// proto/p5 (profil simulé), proto/p8 (le fuseau libéré).
//
// Pourquoi un lancer de rayons : la glace dans l'eau ne se lit que par ce qui
// la fait voir pour de vrai (réfraction d'indice relatif 0,982, réflexion
// totale aux incidences rasantes, diffusion dans la glace bulleuse), et la
// surface vue de dessous est un miroir hors de la fenêtre de Snell (48,6°) :
// chaque forme a son double. Une matière à transmission de three.js ne sait
// faire ni l'un ni l'autre.
//
// Unités : cm ; y = 0 à la surface ; l'axe de la colonne est l'axe y.
import * as THREE from 'three/webgpu';

export const MAX_ROWS = 256;

const WGSL = /* wgsl */ `
struct P {
  res: vec4f,      // largeur, hauteur, décalage x, décalage y (pixels)
  cam: vec4f,      // position, tan(fov/2)
  camF: vec4f, camR: vec4f, camU: vec4f,
  absorb: vec4f,   // absorption de l'eau (cm⁻¹), w : diffusion
  deep: vec4f,     // eau profonde, w : humeur
  shallow: vec4f,  // eau claire (vers la surface), w : soleil (intensité)
  sun: vec4f,      // direction du soleil dans l'air, w : intensité du ciel
  sunW: vec4f,     // direction du soleil dans l'eau, w : lueur vers lui
  lb: vec4f,       // boîte à lumière (direction), w : intensité
  sky: vec4f,      // zénith, w : z du mur (Bassin de pierre)
  horizon: vec4f,  // horizon, w : y du fond (Ombre)
  amb: vec4f,      // lumière ambiante dans l'eau, w : diffusion de la glace (cm⁻¹)
  col: vec4f,      // rayon de la colonne émergée, hauteur du domaine, pas des rangées (cm), nombre de rangées
  mat: vec4f,      // avance cumulée (cm, coordonnées de la matière), densité des bulles, hauteur des cellules de bulles, section (0 ronde, 1 carrée, 2 hexagonale)
  frag: vec4f,     // centre du fuseau (cm), w : θ (inclinaison de l'axe, horaire)
  frag2: vec4f,    // longueur (cm), rangées, présent, azimut du plan de bascule
  frag3: vec4f,    // centre de masse depuis le bas (cm), cellules de bulles par période d'avance, —, rides (amplitude)
  ripple: vec4f,   // x, z de l'origine des rides, temps (s), longueur d'onde (cm)
  glint: vec4f,    // couleur de l'éclat des bulles, w : bleu de la glace (absorption)
};
@group(0) @binding(0) var<uniform> u: P;
@group(0) @binding(1) var<storage, read> rows: array<f32>; // [colonne MAX_ROWS][fuseau MAX_ROWS], mm
@group(0) @binding(2) var outTex: texture_storage_2d<rgba16float, write>;

const NW = 1.333;
const NI = 1.309;
const PI = 3.14159265;
const MAXR = ${MAX_ROWS}u;

fn hash31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn hash33(p: vec3f) -> vec3f { var q = fract(p * vec3f(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn noise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3f(1,0,0)), w.x), mix(hash31(i + vec3f(0,1,0)), hash31(i + vec3f(1,1,0)), w.x), w.y),
             mix(mix(hash31(i + vec3f(0,0,1)), hash31(i + vec3f(1,0,1)), w.x), mix(hash31(i + vec3f(0,1,1)), hash31(i + vec3f(1,1,1)), w.x), w.y), w.z);
}

// ── La colonne : rayon simulé par rangée (mm), interpolé ──
fn colRow(fj: f32) -> f32 {
  let n = u.col.w;
  let f = clamp(fj, 0.0, n - 1.001);
  let j = u32(floor(f)); let t = f - floor(f);
  return mix(rows[j], rows[j + 1u], t) * 0.1;
}
fn colRadius(y: f32) -> f32 {
  if (y >= 0.0) { return u.col.x; } // la partie émergée (dans l'air, elle ne fond pas)
  return colRow((u.col.y + y) / u.col.z - 0.5);
}
// section : ronde, carrée ou hexagonale, arrondie avec la profondeur (la glace
// neuve est sciée, l'eau en arrondit les arêtes)
fn sectionScale(p: vec3f) -> f32 {
  let s = u.mat.w;
  if (s < 0.5) { return 1.0; }
  let a = atan2(p.z, p.x);
  let nSides = select(4.0, 6.0, s > 1.5);
  let k = PI / nSides;
  let polyR = cos(k) / cos(((a + PI) % (2.0 * k)) - k); // rayon du polygone inscrit (apothème 1)
  let age = clamp(-p.y / 6.0, 0.0, 1.0); // arrondi par la fonte
  return mix(polyR / cos(k) * 0.93, 1.0, age);
}
fn sdColumn(p: vec3f) -> f32 {
  let yb = -u.col.y;
  let r = length(p.xz);
  let R = colRadius(p.y) * sectionScale(p);
  let e = 0.05;
  let dR = (colRadius(p.y + e) - colRadius(p.y - e)) / (2.0 * e);
  return (r - R) / sqrt(1.0 + dR * dR) * 0.9;
}
// ── Le fuseau libéré ──
fn fragLocal(p: vec3f) -> vec3f { // (s depuis le centre de masse, rayon, coordonnée hors plan)
  let az = u.frag2.w; let th = u.frag.w;
  let q0 = p - u.frag.xyz;
  // plan de bascule tourné de az autour de y
  let c = cos(az); let s = sin(az);
  let q = vec3f(c * q0.x + s * q0.z, q0.y, -s * q0.x + c * q0.z);
  let ax = vec3f(sin(th), cos(th), 0.0);
  let along = dot(q, ax);
  let perp = q - ax * along;
  return vec3f(along, length(perp), q.z);
}
fn fragRow(sFromBottom: f32) -> f32 {
  let n = u.frag2.y;
  let f = clamp(sFromBottom / u.col.z - 0.5, 0.0, n - 1.001);
  let j = u32(floor(f)); let t = f - floor(f);
  return mix(rows[MAXR + j], rows[MAXR + j + 1u], t) * 0.1;
}
fn sdFrag(p: vec3f) -> f32 {
  if (u.frag2.z < 0.5) { return 1e9; }
  let L = u.frag2.x; let sg = u.frag3.x;
  let l = fragLocal(p);
  let s = l.x + sg;
  if (s < 0.0) { return length(vec2f(s, l.y)); }
  if (s > L) { return length(vec2f(s - L, l.y)); }
  let e = 0.05;
  let dR = (fragRow(s + e) - fragRow(s - e)) / (2.0 * e);
  return (l.y - fragRow(s)) / sqrt(1.0 + dR * dR) * 0.9;
}
fn sdBody(p: vec3f) -> f32 { return min(sdColumn(p), sdFrag(p)); }
fn nrm(p: vec3f) -> vec3f {
  let e = 0.004; let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * sdBody(p + k.xyy * e) + k.yyx * sdBody(p + k.yyx * e) + k.yxy * sdBody(p + k.yxy * e) + k.xxx * sdBody(p + k.xxx * e));
}
// coordonnées de la matière (les bulles descendent avec la glace qui avance)
fn matCoord(p: vec3f) -> vec3f {
  if (sdFrag(p) < sdColumn(p)) {
    // le fuseau garde la matière qu'il avait dans la colonne au détachement :
    // repère du fuseau ramené à sa pose de départ (axe vertical, centre à y_G0)
    let az = u.frag2.w; let th = u.frag.w; let c = cos(az); let s = sin(az);
    let q0 = p - u.frag.xyz;
    let q = vec3f(c * q0.x + s * q0.z, q0.y, -s * q0.x + c * q0.z);
    let X = dot(q, vec3f(cos(th), -sin(th), 0.0)); let Y = dot(q, vec3f(sin(th), cos(th), 0.0));
    return vec3f(c * X - s * q.z, Y + u.frag3.z, s * X + c * q.z);
  }
  return vec3f(p.x, p.y + u.mat.x, p.z);
}

fn fresnel(ci: f32, n1: f32, n2: f32) -> f32 {
  let eta = n1 / n2; let st2 = eta * eta * (1.0 - ci * ci);
  if (st2 >= 1.0) { return 1.0; }
  let ct = sqrt(1.0 - st2);
  let rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  let rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
  return 0.5 * (rs * rs + rp * rp);
}

// ── Lumières ──
fn sky(d: vec3f) -> vec3f {
  var c = mix(u.horizon.xyz, u.sky.xyz, pow(clamp(d.y, 0.0, 1.0), 0.6)) * u.sun.w;
  let cs = dot(d, normalize(u.sun.xyz));
  c += u.shallow.w * (smoothstep(0.99996, 0.99999, cs) + 0.002 * pow(max(cs, 0.0), 60.0));
  return c;
}
fn softbox(d: vec3f) -> vec3f {
  let I = u.lb.w;
  if (I <= 0.0) { return vec3f(0.0); }
  let lb = normalize(u.lb.xyz);
  let c = dot(d, lb);
  if (c <= 0.0) { return vec3f(0.0); }
  let t1 = normalize(cross(lb, vec3f(0.0, 1.0, 0.0))); let t2 = cross(t1, lb);
  let q = d / c;
  let m = (1.0 - smoothstep(0.22, 0.3, abs(dot(q, t1)))) * (1.0 - smoothstep(0.42, 0.5, abs(dot(q, t2))));
  return vec3f(1.0, 0.97, 0.93) * I * m;
}
fn waterInf(d: vec3f) -> vec3f {
  var c = mix(u.deep.xyz, u.shallow.xyz, smoothstep(-0.7, 0.95, d.y));
  if (u.sunW.w > 0.0) { c += u.shallow.xyz * u.sunW.w * pow(max(dot(d, normalize(u.sunW.xyz)), 0.0), 6.0); }
  return c + softbox(d);
}
fn envWater(d: vec3f) -> vec3f {
  if (d.y > 0.6614) { return sky(refract(d, vec3f(0.0, -1.0, 0.0), NW)) * 0.95; }
  if (d.y > 0.0) { return waterInf(vec3f(d.x, -d.y, d.z)); }
  return waterInf(d);
}
// la surface : plane, ridée par la brise après le détachement (rides qui
// partent du fuseau couché)
fn surfNormal(p: vec3f) -> vec3f {
  let A = u.frag3.w;
  if (A <= 0.0) { return vec3f(0.0, -1.0, 0.0); }
  let q = p.xz - u.ripple.xy;
  let r = length(q) + 1e-4;
  let k = 2.0 * PI / u.ripple.w;
  let ph = k * r - 6.0 * u.ripple.z;
  let a = A * exp(-0.08 * r) * cos(ph);
  let g = q / r * a * k;
  // vent : de petites rides régulières
  let gw = vec2f(0.6 * A * cos(p.x * 3.1 + p.z * 1.3 + 4.0 * u.ripple.z), 0.4 * A * cos(p.z * 2.7 - p.x * 0.9 + 3.0 * u.ripple.z));
  return normalize(vec3f(g.x + gw.x, -1.0, g.y + gw.y));
}

// ── Fonds ──
fn caustic(p: vec2f) -> f32 {
  var c = 0.0; var q = p;
  for (var i = 0; i < 4; i++) {
    let w = vec2f(sin(q.y * 1.7 + f32(i) * 1.3), cos(q.x * 1.5 - f32(i) * 0.7));
    q = q * 1.21 + w * 0.6;
    c += pow(1.0 - abs(sin(q.x + 0.5 * sin(q.y))), 10.0) * pow(1.0 - abs(sin(q.y * 0.9 + 0.5 * cos(q.x))), 4.0);
  }
  return c;
}
fn backdropT(p: vec3f, d: vec3f) -> f32 {
  let m = u.deep.w;
  if (abs(m - 5.0) < 0.5) { if (d.z >= -1e-4) { return 1e9; } return (u.sky.w - p.z) / d.z; }
  if (abs(m - 2.0) < 0.5) { if (d.y >= -1e-4) { return 1e9; } return (u.horizon.w - p.y) / d.y; }
  return 1e9;
}
// ombre portée de la glace sur le fond (humeur Ombre) : la corde traversée le
// long du soleil assombrit (glace bulleuse), le bord dévie la lumière
fn chordSun(P0: vec3f) -> f32 {
  let sw = normalize(u.sunW.xyz);
  let top = (0.0 - P0.y) / sw.y;
  let N = 40; let h = top / f32(N);
  var c = 0.0;
  for (var m = 0; m < N; m++) {
    let q = P0 + sw * ((f32(m) + 0.5) * h);
    c += (1.0 - smoothstep(-0.02, 0.02, sdBody(q))) * h;
  }
  return c;
}
fn backdrop(p: vec3f) -> vec3f {
  let m = u.deep.w;
  if (abs(m - 2.0) < 0.5) {
    let sw = normalize(u.sunW.xyz);
    let sand = vec3f(0.82, 0.78, 0.68) * (0.85 + 0.25 * noise3(vec3f(p.xz * 2.0, 1.0)) + 0.1 * noise3(vec3f(p.xz * 9.0, 4.0)));
    let e = 0.05;
    let c0 = chordSun(p);
    // lentille divergente : le bord de l'ombre se resserre en un liseré clair
    let lap = (chordSun(p + vec3f(e, 0.0, 0.0)) + chordSun(p - vec3f(e, 0.0, 0.0)) + chordSun(p + vec3f(0.0, 0.0, e)) + chordSun(p - vec3f(0.0, 0.0, e)) - 4.0 * c0) / (e * e);
    let I = exp(-u.amb.w * c0 * 0.8) * clamp(1.0 + 0.02 * lap, 0.15, 3.0);
    let caus = 1.0 + 0.5 * caustic(p.xz * 0.6 + vec2f(u.ripple.z * 0.15, 0.0));
    return sand * (u.shallow.w * 0.006 * sw.y * I * caus + u.amb.xyz);
  }
  let depthF = exp(p.y * 0.04);
  let E = u.shallow.w * 0.012 * caustic(p.xy * 0.55 + vec2f(u.ripple.z * 0.1, 0.0)) * depthF + 0.7;
  let n = noise3(vec3f(p.xy * 0.9, 0.0)) * 0.5 + noise3(vec3f(p.xy * 3.1, 2.0)) * 0.3 + noise3(vec3f(p.xy * 11.0, 5.0)) * 0.2;
  return vec3f(0.74, 0.71, 0.64) * (0.82 + 0.3 * n) * u.amb.xyz * E;
}

// ── La glace émergée, dans l'air ──
fn airScene(p: vec3f, d: vec3f) -> vec3f {
  let r0 = u.col.x;
  let a = d.x * d.x + d.z * d.z; let b = p.x * d.x + p.z * d.z; let c = p.x * p.x + p.z * p.z - r0 * r0;
  let disc = b * b - a * c;
  if (a > 1e-6 && disc > 0.0) {
    let t = (-b - sqrt(disc)) / a;
    if (t > 0.0) {
      let q = p + d * t;
      let n = normalize(vec3f(q.x, 0.0, q.z));
      let frost = 0.55 + 0.25 * noise3(q * 40.0);
      return frost * (u.horizon.xyz * u.sun.w * 0.6 + u.shallow.w * 0.004 * max(dot(n, normalize(u.sun.xyz)), 0.0)) + sky(reflect(d, n)) * 0.05;
    }
  }
  return sky(d);
}

struct Ray { p: vec3f, d: vec3f, T: vec3f, L: vec3f, done: bool };

// corde jusqu'à la surface de la colonne dans la direction l (profil local)
fn chordToSurf(q: vec3f, l: vec3f) -> f32 {
  let lx = vec2f(l.x, l.z); let ln = length(lx);
  if (ln < 1e-3) { return 6.0; }
  let dir = lx / ln;
  let R = colRadius(q.y);
  let b = dot(q.xz, dir); let c = dot(q.xz, q.xz) - R * R;
  let disc = b * b - c;
  if (disc < 0.0) { return 0.3; }
  return max(-b + sqrt(disc), 0.0) / ln;
}
fn inscatter(q: vec3f, dens: f32) -> vec3f {
  var s = u.amb.xyz * 1.3;
  if (u.lb.w > 0.0) { s += vec3f(1.0, 0.97, 0.93) * u.lb.w * 0.08 * exp(-dens * chordToSurf(q, normalize(u.lb.xyz))); }
  if (u.shallow.w > 0.0) { s += mix(vec3f(1.0), u.shallow.xyz * 2.0, 0.5) * u.shallow.w * 0.006 * exp(-dens * chordToSurf(q, normalize(u.sunW.xyz))); }
  return s * 0.92;
}

fn iceInterior(r0: Ray) -> Ray {
  var r = r0;
  let step = 0.03;
  let sig = u.amb.w;
  let cellH = u.mat.z;
  var lastCell = vec3f(-999.0);
  var t = 0.0;
  for (var i = 0; i < 200; i++) {
    let q0 = r.p + r.d * t;
    let q = q0 + r.d * step;
    if (q.y > 0.0) { r.L += r.T * u.horizon.xyz * u.sun.w * 0.35; r.done = true; return r; }
    let mq = matCoord(q);
    // glace bulleuse : un fond diffus, plus dense au cœur (bulles chassées par le gel)
    let rr = length(mq.xz);
    let dens = sig * (0.7 + 0.3 * noise3(mq * 3.0)) * (1.0 + 1.5 * (1.0 - smoothstep(0.25, 0.6, rr)));
    let tr = exp(-dens * step);
    r.L += r.T * (1.0 - tr) * inscatter(q, dens);
    r.T *= tr * exp(-u.glint.w * step * vec3f(1.0, 0.35, 0.12)); // la glace épaisse est bleue
    // chapelets de bulles, fixes dans la matière
    let mq0 = matCoord(q0);
    let ang = atan2(mq0.z, mq0.x);
    let na = 34.0;
    // (indice vertical modulo le nombre de cellules par période d'avance : à u = 1, la
    // glace a avancé d'un nombre entier de cellules, le motif retombe sur lui-même)
    let nPer = max(u.frag3.y, 1.0);
    let cz = floor(mq0.y / cellH);
    let cell = vec3f(floor((ang + PI) / (2.0 * PI) * na), floor(length(mq0.xz) / 0.16), cz - nPer * floor(cz / nPer));
    if (any(cell != lastCell)) {
      let hs = hash33(vec3f(cell.x, cell.y, 7.0));
      let hb = hash33(cell);
      let rcen = (cell.y + 0.25 + 0.5 * hs.y) * 0.16;
      if (hs.z < 0.55 && hb.x < u.mat.y && rcen < 1.3) {
        let ac = (cell.x + 0.3 + 0.4 * hs.x) / na * 2.0 * PI - PI;
        let cenM = vec3f(cos(ac) * rcen, (cz + 0.3 + 0.4 * hb.y) * cellH, sin(ac) * rcen);
        let rb = 0.012 + 0.04 * hb.z * hb.z;
        let v = cenM - mq0;
        // (le trajet du rayon en coordonnées de la matière : même pas, même direction à une rotation près)
        let dM = normalize(matCoord(q0 + r.d * 0.01) - mq0);
        let tp = clamp(dot(v, dM), 0.0, step);
        let bd = length(v - dM * tp);
        if (bd < rb) {
          lastCell = cell;
          if (bd / rb > 0.76) { r.L += r.T * u.glint.xyz; r.T *= 0.1; } // réflexion totale au bord de la bulle
          else { r.T *= 0.85; }
        }
      }
    }
    if (max(r.T.x, max(r.T.y, r.T.z)) < 0.003) { r.done = true; return r; }
    if (sdBody(q) > 0.0) {
      var a = t; var b = t + step;
      for (var k = 0; k < 6; k++) { let m = 0.5 * (a + b); if (sdBody(r.p + r.d * m) > 0.0) { b = m; } else { a = m; } }
      let pe = r.p + r.d * b;
      let n = nrm(pe);
      r.p = pe + n * 0.004;
      r.d = normalize(refract(r.d, -n, NI / NW));
      return r;
    }
    t += step;
  }
  r.done = true;
  return r;
}

fn fog(r: ptr<function, Ray>, t: f32) {
  let sigS = u.absorb.w;
  var a = 0.0;
  for (var m = 0; m < 12; m++) {
    let bnd = t * pow(f32(m + 1) / 12.0, 2.0);
    let hh = bnd - a;
    if (hh <= 0.0) { continue; }
    let fogC = mix(u.deep.xyz, u.shallow.xyz, smoothstep(-30.0, 0.0, (*r).p.y + (*r).d.y * (a + 0.5 * hh)));
    (*r).L += (*r).T * (vec3f(1.0) - exp(-vec3f(sigS) * hh)) * fogC;
    (*r).T *= exp(-(u.absorb.xyz + vec3f(sigS)) * hh);
    a = bnd;
  }
}

fn trace(ro: vec3f, rd: vec3f) -> vec3f {
  var r = Ray(ro, rd, vec3f(1.0), vec3f(0.0), false);
  for (var bounce = 0; bounce < 6; bounce++) {
    let tS = select(1e9, -r.p.y / r.d.y, r.d.y > 1e-5);
    let tB = backdropT(r.p, r.d);
    let tmax = min(min(tS, tB), 140.0);
    var t = 0.0; var hit = false;
    for (var i = 0; i < 220; i++) {
      let s = sdBody(r.p + r.d * t);
      if (s < 0.0015) { hit = true; break; }
      t += max(s, 0.0015);
      if (t > tmax) { break; }
    }
    t = min(t, tmax);
    fog(&r, t);
    r.p = r.p + r.d * t;
    if (hit) {
      let n = nrm(r.p);
      let ci = -dot(r.d, n);
      let eta = NW / NI;
      let k = 1.0 - eta * eta * (1.0 - ci * ci);
      if (k < 0.0 || ci <= 0.0) { r.d = reflect(r.d, n); r.p += n * 0.004; continue; } // le liseré
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
      // la surface vue de dessous : fenêtre de Snell, miroir au-delà
      let sn = surfNormal(r.p);
      let ci = max(dot(r.d, -sn), 0.0);
      let F = fresnel(ci, NW, 1.0);
      if (F < 1.0) { r.L += r.T * (1.0 - F) * airScene(vec3f(r.p.x, 0.0, r.p.z), normalize(refract(r.d, sn, NW))); }
      r.T *= F;
      r.d = normalize(reflect(r.d, sn));
      if (r.d.y > -0.001) { r.d = normalize(vec3f(r.d.x, -0.001, r.d.z)); }
      r.p.y = -0.002;
      continue;
    }
    if (tB < tS && t >= tB - 1e-3) { r.L += r.T * backdrop(r.p); break; }
    r.L += r.T * waterInf(r.d);
    break;
  }
  return r.L;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u.res.xy;
  if (f32(gid.x) >= res.x || f32(gid.y) >= res.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5) + u.res.zw) / res;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = u.cam.w;
  let rd = normalize(u.camF.xyz + ndc.x * th * (res.x / res.y) * u.camR.xyz + ndc.y * th * u.camU.xyz);
  let c = trace(u.cam.xyz, rd);
  textureStore(outTex, vec2i(gid.xy), vec4f(c, 1.0));
}
`;

export const MOOD_INDEX = { nuit: 0, snell: 1, ombre: 2, lait: 3, tourbe: 4, pierre: 5, contrejour: 6 };

export function createTracer(renderer) {
  const device = renderer.backend.device;
  const module = device.createShaderModule({ code: WGSL });
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) if (m.type === 'error') console.error(`tracer ${m.lineNum}:${m.linePos} ${m.message}`);
  });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const NU = 21 * 4;
  const U = new Float32Array(NU);
  const ubuf = device.createBuffer({ size: NU * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const rowsArr = new Float32Array(MAX_ROWS * 2);
  const rbuf = device.createBuffer({ size: rowsArr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
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
  // p : tout ce que le shader lit, déjà mis en forme par stage.js
  function run(p) {
    target(p.w, p.h);
    set(0, p.w, p.h, p.jitter[0], p.jitter[1]);
    set(1, ...p.cam.pos, p.cam.tanHalf);
    set(2, ...p.cam.f, 0); set(3, ...p.cam.r, 0); set(4, ...p.cam.u, 0);
    const M = p.mood;
    set(5, ...M.absorb, M.sigS);
    set(6, ...M.deep, MOOD_INDEX[M.key]);
    set(7, ...M.shallow, p.sunI);
    set(8, ...M.sun, p.skyI);
    set(9, ...M.sunW, M.glow);
    set(10, ...M.lb, M.lbI);
    set(11, ...M.sky, M.wallZ ?? 0);
    set(12, ...M.horizon, M.floorY ?? -17);
    set(13, ...p.amb, p.ice.sigma);
    set(14, p.col.a, p.col.Z, p.col.dz, p.col.n);
    set(15, p.ice.feedOffset, p.ice.bubbles, p.ice.cellH, p.ice.section);
    set(16, ...(p.frag ? p.frag.pos : [0, 0, 0]), p.frag ? p.frag.th : 0);
    set(17, p.frag ? p.frag.L : 0, p.frag ? p.frag.n : 0, p.frag ? 1 : 0, p.frag ? p.frag.az : 0);
    set(18, p.frag ? p.frag.sG : 0, p.ice.nPer, p.frag ? p.frag.matY : 0, p.ripple.amp);
    set(19, p.ripple.x, p.ripple.z, p.ripple.t, p.ripple.lambda);
    set(20, ...p.glint, p.ice.blue); // l'éclat des bulles, le bleu de la glace épaisse
    device.queue.writeBuffer(ubuf, 0, U);
    rowsArr.fill(0);
    rowsArr.set(p.col.rows.subarray(0, Math.min(MAX_ROWS, p.col.rows.length)), 0);
    if (p.frag) rowsArr.set(p.frag.rows.subarray(0, Math.min(MAX_ROWS, p.frag.rows.length)), MAX_ROWS);
    device.queue.writeBuffer(rbuf, 0, rowsArr);
    const gpuTex = renderer.backend.get(tex).texture;
    if (!bind || bind.tex !== gpuTex) {
      bind = { tex: gpuTex, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: rbuf } }, { binding: 2, resource: gpuTex.createView() }] }) };
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
