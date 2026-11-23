// La simulation grossière du voile sur le GPU (shaders de calcul WebGPU),
// portée de src/gen/cloth.js, qui reste la référence (tests Node, version
// sans WebGPU). Même modèle, mêmes contacts, même horaire du cordon ; deux
// différences, propres au parallélisme :
//   - les fils sont résolus en Jacobi moyenné (ITER itérations par sous-pas,
//     tampons alternés) : l'ordre de la bague vers le bord, qui faisait la
//     tenue du Gauss-Seidel sur le CPU, n'existe pas en parallèle ; ce sont
//     les attaches à longue portée et les itérations qui tiennent le voile ;
//   - les auto-collisions passent par une grille de hachage à listes chaînées
//     (atomicExchange), puis chaque particule rassemble ses répulsions.
// L'enregistrement entier d'un morceau est calculé au chargement, bien plus
// vite que le temps réel, puis relu (la boucle ne dépend que de la phase).
//
// createGpuCloth(device) → { simulate(job, onProgress) → Promise<{ frames
// (Float32Array count·N·3), count, fps, final, vel, n, N }>, dispose() }
import { FABRICS, RC, SELF, MU_FORM, knotRise, knotDesc, smoother, flatPositions, makeCloth } from '../gen/cloth.js';
import { plinthCollider, plinthDims } from '../gen/forms.js';
import { QB } from '../gen/quant.js';

const WG = 64;
const RHO_AIR = 1.2, G = -9.81;
// (réglages de mise au point par l'URL : ?gs, ?iter=…, ?omega=…)
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const MODE = Q.has('jacobi') ? 'jacobi' : 'gs';
const ITER = +(Q.get('iter') ?? 6); // (Jacobi : itérations des fils par sous-pas, paire : la dernière écrit dans xb)
const GS_ITER = +(Q.get('gsiter') ?? 3); // (Gauss-Seidel colorié : passes sur les 9 couleurs)
const OMEGA = Q.get('omega');
const LIMIT = !Q.has('nolimit'), LIM_IT = Q.get('lim') ? +Q.get('lim') : 1;
const TB = 16384; // (cases de la grille de hachage)
const VMAX = '12.0'; // (m/s : borne du déplacement par sous-pas)
// (m/s : vitesse sous laquelle le linge mouillé, au contact, ne glisse pas ; à
// 0,05 il tenait le linge posé mais pas celui qui glissait déjà en se posant,
// à 16 cm/s, d'un buste penché ou d'un torse : une scène sur quatre)
const STICT = Q.get('stict') ?? '0.4';

const WGSL = /* wgsl */`
struct U {
  a: vec4f,  // n, N, h (pas), w (inverse de masse)
  b: vec4f,  // dt, RC, ADH, RA
  c: vec4f,  // kn, kt, amortissement (s⁻¹), mu de la forme
  d: vec4f,  // mu du socle, sol, rs (auto-collision), forme présente (0/1)
  e: vec4f,  // α̃ biais, α̃ flexion, sur-relaxation, socle : nombre de pièces
  f: vec4f,  // origine du champ, pas du champ
  g: vec4f,  // dimensions du champ, (inutilisé)
  h: vec4f,  // direction du vent, prise (0 libre, 1 bague, 2 coins)
  q: vec4f,  // axes du voile à plat (fils de trame, de chaîne) dans le plan xz
  p: array<vec4f, 12>,
};
@group(0) @binding(0) var<storage, read_write> xa: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> xb: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> st: array<vec4f>;   // [0, N) positions au début du sous-pas, [N, 2N) vitesses, [2N, 3N) normales
@group(0) @binding(3) var<storage, read_write> heads: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> nexts: array<i32>;   // [0, N) listes de la grille, N : sous-pas, N + 1 : image
@group(0) @binding(5) var<storage, read> ro: array<vec4f>;          // horaire par sous-pas (bague y, rappel β, vent, t), puis H à partir de u.g.w
@group(0) @binding(6) var<storage, read> sdf: array<f32>;
@group(0) @binding(7) var<storage, read_write> frames: array<vec4f>;
@group(0) @binding(8) var<uniform> u: U;

const G = ${G};
// (le linge mouillé accroche : coefficient de frottement relevé de moitié ; à
// son coefficient sec, le satin lourd coulait de la tête puis du socle)
fn wetMu() -> f32 { return 1.0; } // (l'accroche du linge mouillé est déjà dans mu, côté JS)
const SELF_ON = ${Q.has('noself') ? 'false' : 'true'};
const CLAMP = ${Q.has('noclamp') ? 'false' : 'true'};
const NORM = ${Q.has('nonorm') ? 'false' : 'true'}; // (?nonorm : le Gauss-Seidel d'avant, sans pas exact, pour comparer)
const SELF_EVERY = ${Q.has('selfevery') ? 'true' : 'false'};
// (collage visqueux à basse vitesse : un linge mouillé posé ne repart pas ;
// sans lui, le voile glissait lentement de la statue avant qu'elle ne
// s'efface. Retiré un temps parce qu'il « faisait diverger le satin » : la
// vraie cause était l'emballement du Gauss-Seidel, borné depuis)
const STICK = ${Q.get('stick') ?? '60.0'};
fn nI() -> i32 { return i32(u.a.x); }
fn NN() -> i32 { return i32(u.a.y); }
fn centerK() -> i32 { let c = (nI() - 1) / 2; return c * nI() + c; }
fn stepI() -> u32 { return u32(nexts[NN()]); }
// les prises : u.h.w = 1, la bague au centre ; u.h.w = 2, les quatre coins
// (3 : avec leurs attaches à longue portée),
// dont la position et l'état (tenu ou lâché) viennent de l'horaire
fn nSteps() -> i32 { return i32(u.g.w) / 6; }
// (chaque coin est tenu par une pince : les CLIP × CLIP mailles du coin,
// à plat, autour de la prise ; un seul point portait tout le voile et ses
// mailles voisines s'étiraient de moitié)
const CLIP = 3;
fn cornerSlot(k: i32) -> i32 {
  let n = nI(); let i = k % n; let j = k / n;
  var si = -1; var sj = -1;
  if (i < CLIP) { si = 0; } else if (i >= n - CLIP) { si = 1; }
  if (j < CLIP) { sj = 0; } else if (j >= n - CLIP) { sj = 1; }
  if (si < 0 || sj < 0) { return -1; }
  return si + 2 * sj;
}
fn pinPos(k: i32) -> vec4f {
  let c = cornerSlot(k);
  if (c < 0) { return vec4f(0.0); }
  let n = nI(); let i = k % n; let j = k / n;
  let di = f32(select(i, i - (n - 1), (c & 1) == 1));
  let dj = f32(select(j, j - (n - 1), c >= 2));
  let P = ro[2 * nSteps() + i32(stepI()) * 4 + c];
  // (la pince se referme peu à peu : P.w = 1 + e, de la forme où le coin
  // reposait quand on l'a repris (e = 0) jusqu'à la pince à plat (e = 1).
  // Elle TOURNE de sa pose de reprise à sa pose à plat (vecteur de rotation
  // T, calculé à la reprise), et seul le froissé — l'écart à la pince rigide,
  // exprimé dans son repère — se défait en ligne droite. Mêlées en ligne
  // droite, deux poses tournées l'une de l'autre passent par une pince
  // rétrécie de moitié : les fils du bord s'étiraient de trois mailles)
  let e = clamp(P.w - 1.0, 0.0, 1.0);
  let flat = (vec3f(u.q.x, 0.0, u.q.y) * di + vec3f(u.q.z, 0.0, u.q.w) * dj) * u.a.z;
  let grab = ro[i32(u.g.w) + NN() + c * CLIP * CLIP + i32(abs(di)) * CLIP + i32(abs(dj))].xyz;
  let T = ro[i32(u.g.w) + NN() + 4 * CLIP * CLIP + c];
  let v = mix(grab, flat, e);
  let th = T.w * (1.0 - e);
  let off = v * cos(th) + cross(T.xyz, v) * sin(th) + T.xyz * (dot(T.xyz, v) * (1.0 - cos(th)));
  return vec4f(P.xyz + off, P.w);
}
// la statue est là (1) ou s'est évanouie (0) : ro[nS + sous-pas].y
fn formOn() -> bool { return ro[nSteps() + i32(stepI())].y > 0.5; }
// (elle s'efface en s'enfonçant dans le socle : ro[nS + sous-pas].z, en mètres)
fn formDrop() -> f32 { return ro[nSteps() + i32(stepI())].z; }
// (…et se resserre vers son axe : ro[nS + sous-pas].w, échelle horizontale)
fn formShrink() -> f32 { return ro[nSteps() + i32(stepI())].w; }
fn formAt(x: vec3f, g: ptr<function, vec3f>) -> f32 {
  let sc = formShrink();
  let d = sdfAt(vec3f(x.x / sc, x.y + formDrop(), x.z / sc), g);
  return select(d * sc, d, d >= 1.0); // (hors du champ : 1, inchangé)
}
fn pinned(k: i32) -> bool {
  // (appelé pour chaque voisin de chaque sommet : seulement l'état de la
  // prise, sans calculer la pose de la pince)
  if (u.h.w > 1.5) { let c = cornerSlot(k); if (c < 0) { return false; } return ro[2 * nSteps() + i32(stepI()) * 4 + c].w > 0.5; }
  return u.h.w > 0.5 && k == centerK();
}

fn sdfAt(p: vec3f, g: ptr<function, vec3f>) -> f32 {
  let h = u.f.w;
  let dims = vec3i(i32(u.g.x), i32(u.g.y), i32(u.g.z));
  let q = (p - u.f.xyz) / h;
  if (any(q < vec3f(0.0)) || q.x >= f32(dims.x - 1) || q.y >= f32(dims.y - 1) || q.z >= f32(dims.z - 1)) { return 1.0; }
  let i = vec3i(floor(q)); let t = q - floor(q);
  let sx = 1; let sy = dims.x; let sz = dims.x * dims.y;
  let o = i.z * sz + i.y * sy + i.x;
  let a = sdf[o]; let b = sdf[o + sx]; let c = sdf[o + sy]; let d = sdf[o + sx + sy];
  let e = sdf[o + sz]; let f = sdf[o + sx + sz]; let gg = sdf[o + sy + sz]; let hh = sdf[o + sx + sy + sz];
  let ab = mix(a, b, t.x); let cd = mix(c, d, t.x); let ef = mix(e, f, t.x); let gh = mix(gg, hh, t.x);
  let l0 = mix(ab, cd, t.y); let l1 = mix(ef, gh, t.y);
  let dx0 = (b - a) + ((d - c) - (b - a)) * t.y; let dx1 = (f - e) + ((hh - gg) - (f - e)) * t.y;
  *g = vec3f(mix(dx0, dx1, t.z), mix(cd - ab, gh - ef, t.z), l1 - l0) / h;
  return mix(l0, l1, t.z);
}
fn sdRoundBox(p: vec3f, c: vec3f, hh: vec3f, r: f32) -> f32 {
  let q = abs(p - c) - hh + vec3f(r);
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
fn sdRoundCyl(p: vec3f, y0: f32, y1: f32, R: f32, r: f32) -> f32 {
  let dx = length(p.xz) - R + r;
  let dy = abs(p.y - 0.5 * (y0 + y1)) - 0.5 * (y1 - y0) + r;
  return min(max(dx, dy), 0.0) + length(max(vec2f(dx, dy), vec2f(0.0))) - r;
}
fn plinthAt(p: vec3f) -> f32 {
  var d = 1e9;
  let np = i32(u.e.w);
  for (var k = 0; k < np; k++) {
    let A = u.p[2 * k]; let B = u.p[2 * k + 1];
    if (A.x < 0.5) { d = min(d, sdRoundBox(p, A.yzw, B.xyz, B.w)); }
    else { d = min(d, sdRoundCyl(p, A.y, A.z, A.w, B.w)); }
  }
  // Sous le plateau, la sortie est vers le haut. Le socle est un empilement
  // (corniche, moulure, dé) et le minimum de leurs distances n'est pas une
  // distance à l'intérieur : un point enfoncé de plus d'une demi-corniche
  // (3 cm, ce qu'un tas d'étoffe comprimé pousse en un sous-pas) en sortait
  // par le BAS, tombait dans le dé, et y restait pris — ses voisines, tirées
  // par la montée, s'étiraient de quatre mailles ; ou bien il était chassé de
  // 26 cm d'un coup par la face du dé. Tant que le dessus est plus proche que
  // le bord du plateau, la profondeur est celle sous le dessus.
  if (d < 0.0 && p.y < 0.0 && np > 0) {
    let A = u.p[0]; let B = u.p[1];
    var lat = A.w - length(p.xz);
    if (A.x < 0.5) { lat = min(B.x - abs(p.x - A.y), B.z - abs(p.z - A.w)); }
    if (-p.y < lat) { d = p.y; }
  }
  return d;
}
fn plinthGrad(p: vec3f) -> vec3f {
  let e = 0.0001;
  return vec3f(plinthAt(p + vec3f(e, 0.0, 0.0)) - plinthAt(p - vec3f(e, 0.0, 0.0)),
               plinthAt(p + vec3f(0.0, e, 0.0)) - plinthAt(p - vec3f(0.0, e, 0.0)),
               plinthAt(p + vec3f(0.0, 0.0, e)) - plinthAt(p - vec3f(0.0, 0.0, e)));
}
// frottement de Coulomb : retient le déplacement tangent du sous-pas
fn friction(x: vec3f, p0: vec3f, n: vec3f, pen: f32, mu: f32) -> vec3f {
  let d = x - p0;
  let t = d - n * dot(d, n);
  let tl = length(t);
  if (tl < 1e-12) { return x; }
  let s = select(min(1.0, mu * pen / tl), 1.0, tl < mu * 1.3 * pen);
  return x - t * s;
}
// (test exact, par les bits : une comparaison flottante peut être simplifiée
// par le compilateur, qui suppose qu'il n'y a pas de NaN)
fn finite3(v: vec3f) -> bool {
  let b = bitcast<vec3u>(v) & vec3u(0x7f800000u);
  return all(b != vec3u(0x7f800000u));
}
fn hashOf(c: vec3i) -> i32 {
  let h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u);
  return i32(h & ${TB - 1}u);
}

// ── 1. prédiction : gravité, air (traînée selon la normale, vent), amortissement ──
@compute @workgroup_size(${WG})
fn predict(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  let s = ro[stepI()];
  let x = xa[k].xyz;
  st[k] = vec4f(x, 0.0);
  if (pinned(k)) { xa[k] = select(vec4f(0.0, s.x, 0.0, 0.0), vec4f(pinPos(k).xyz, 0.0), u.h.w > 1.5); return; }
  let dt = u.b.x;
  var v = st[NN() + k].xyz + vec3f(0.0, G * dt, 0.0);
  var r = v;
  if (s.z > 0.0) {
    let ph = (x.x * u.h.x + x.z * u.h.z) * 7.0 - s.w * 9.5;
    let sp = s.z * (1.0 + 0.18 * sin(ph) + 0.05 * sin(ph * 2.3 + x.y * 11.0 + 1.7));
    r = v - u.h.xyz * sp;
  }
  let n = st[2 * NN() + k].xyz;
  let vn = dot(r, n);
  let an = u.c.x * abs(vn) * vn * dt;
  let dvn = select(an, vn, abs(an) > abs(vn));
  v = v - (n * dvn + r * (u.c.y * dt));
  // amortissement : interne (u.c.z), plus un collage visqueux à basse vitesse
  // (un linge mouillé posé ne repart pas ; la chute et la montée, plus
  // rapides, n'en sont pas touchées)
  // (garde-fou : aucune étoffe ne va plus vite que 6 m/s ; une instabilité
  // locale reste locale au lieu d'emporter tout le voile en NaN)
  let vl = length(v);
  if (vl > 6.0) { v = v * (6.0 / vl); }
  let sp0 = length(v);
  // (posé, le linge s'imbibe et se calme : l'amortissement interne croît avec
  // le même horaire que l'imbibition — ro[nS + sous-pas].x, de 0 à la pose à
  // 1 1,5 s plus tard, nul pendant l'effacement et la montée)
  let soak = ro[nSteps() + i32(stepI())].x;
  let kv = u.c.z * (1.0 + 6.0 * soak) + STICK * (1.0 - smoothstep(0.03, 0.15, sp0));
  v = v * max(0.0, 1.0 - kv * dt);
  xa[k] = vec4f(x + v * dt, 0.0);
}

// ── 2a. auto-collisions : grille de hachage (un sous-pas sur deux) ──
@compute @workgroup_size(${WG})
fn hashClear(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k < ${TB}) { atomicStore(&heads[k], -1); }
}
@compute @workgroup_size(${WG})
fn hashInsert(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  let c = vec3i(floor(xa[k].xyz / u.d.z));
  nexts[k] = atomicExchange(&heads[hashOf(c)], k);
}
// ── 2b. répulsions rassemblées (sous-pas pairs) puis contacts avec frottement
// et adhérence (forme, socle, sol) : xa → xb ──
@compute @workgroup_size(${WG})
fn gatherContacts(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  var x = xa[k].xyz;
  if (pinned(k)) { xb[k] = vec4f(x, 0.0); return; }
  let n = nI();
  // (posé sur une autre couche d'étoffe : il n'adhère pas à la statue ; au
  // repos, sans auto-collisions, on garde ce qu'en disait leur dernier passage
  // — sans quoi les deux couches s'aspiraient l'une dans l'autre)
  var layered = st[2 * NN() + k].w > 0.5;
  // (auto-collisions : un sous-pas sur deux, et seulement pour une étoffe en
  // mouvement ; posée, ses couches sont déjà séparées, et la répulsion contre
  // les fils et l'adhérence la faisait frémir sans fin)
  if (SELF_ON && (SELF_EVERY || (stepI() & 1u) == 0u) && ro[stepI()].y < 0.0) {
    let rs = u.d.z;
    let ki = k % n; let kj = k / n;
    let c = vec3i(floor(x / rs));
    var acc = vec3f(0.0); var cnt = 0.0;
    for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) { for (var cc = -1; cc <= 1; cc++) {
      var q = atomicLoad(&heads[hashOf(c + vec3i(a, b, cc))]);
      var guard = 0;
      loop {
        if (q < 0 || guard > 64) { break; }
        guard++;
        let qi = q % n; let qj = q / n;
        if (q != k && (abs(qi - ki) > 2 || abs(qj - kj) > 2)) {
          let d3 = xa[q].xyz - x;
          let d = length(d3);
          if (d < rs && d > 1e-7) {
            let w2 = select(0.5, 1.0, pinned(q));
            acc -= d3 * ((rs - d) / d * w2);
            cnt += 1.0;
          }
        }
        q = nexts[q];
      }
    } } }
    // (moyenne des répulsions, et appliquée aussi à la position du début du
    // sous-pas : séparer deux couches ne doit pas leur donner de vitesse —
    // additionnées et sans ce report, elles faisaient frémir le voile au repos)
    layered = cnt > 0.0;
    st[2 * NN() + k].w = select(0.0, 1.0, layered);
    let dx = acc / max(cnt, 1.0);
    x += dx;
    st[k] = vec4f(st[k].xyz + dx, 0.0);
  }
  let p0 = st[k].xyz;
  // la forme (contact, frottement, adhérence du linge humide)
  if (u.d.w > 0.5 && formOn() && (formDrop() == 0.0 || x.y > 0.0)) { // (ce qui s'est enfoncé sous le dessus du socle n'existe plus : un bec en surplomb entraînait le linge)
    var g = vec3f(0.0);
    let d = formAt(x, &g);
    let gl = length(g);
    if (d < u.b.y + u.b.w && gl > 1e-6) {
      let nn = g / gl;
      if (d >= u.b.y) {
        if (!layered) {
          let af = ro[nSteps() + i32(stepI())].x;
          let s = min(d - u.b.y, u.b.z * af * u.b.x * u.b.x);
          x -= nn * s;
          // (au contact, la succion capillaire est une charge normale comme une
          // autre : elle retient le linge par frottement ; sans elle, les pans
          // qui tombent faisaient glisser tout le voile d'un bloc hors de la forme)
          if (d < u.b.y + 0.01 && af > 0.0) { x = friction(x, p0, nn, u.b.z * af * u.b.x * u.b.x, u.c.w * wetMu()); }
        }
      }
      else { let pen = u.b.y - d; x += nn * pen; x = friction(x, p0, nn, pen, u.c.w * wetMu()); }
    }
  }
  // le socle
  if (x.y < 0.05) {
    let d = plinthAt(x);
    if (d < u.b.y) {
      let gp = plinthGrad(x); let l = length(gp);
      if (l > 1e-12) { let nn = gp / l; let pen = u.b.y - d; x += nn * pen; x = friction(x, p0, nn, pen + (u.b.z + 5.0) * u.b.x * u.b.x, u.d.x * wetMu()); } // (le linge mouillé colle aussi au marbre : sa succion compte dans le frottement)
    }
  }
  // le sol
  if (x.y < u.d.y + u.b.y) { let pen = u.d.y + u.b.y - x.y; x.y = u.d.y + u.b.y; x = friction(x, p0, vec3f(0.0, 1.0, 0.0), pen, 0.7); }
  xb[k] = vec4f(x, 0.0);
}

// ── 3. les fils, le biais, la flexion : Jacobi moyenné (src → dst) ──
SOLVE_PLACEHOLDER

// ── 4. attaches à longue portée, projection hors de la matière (sans
// frottement), rappel vers H : xb → xa ──
@compute @workgroup_size(${WG})
fn post(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  var x = xb[k].xyz;
  let s = ro[stepI()];
  var stuck = 0.0; // (1 : le point adhère ce sous-pas ; noté dans xa.w pour la limite d'étirement)
  if (!pinned(k)) {
    let n = nI(); let c = (n - 1) / 2;
    if (u.h.w > 0.5 && u.h.w < 1.5) {
      let r = u.a.z * length(vec2f(f32(k % n - c), f32(k / n - c))) * 1.002;
      let cp = vec3f(0.0, s.x, 0.0);
      let dd = x - cp; let l = length(dd);
      if (l > r) { x = cp + dd * (r / l); }
    }
    if (u.h.w > 2.5) {
      // (pendaison et descente seulement : à la montée, le linge enveloppe
      // encore la statue, et une attache en ligne droite le tirerait au travers)
      // (les mêmes attaches depuis chaque pince tenue : aucune maille ne
      // s'éloigne d'un coin tenu de plus que sa distance au repos)
      let i = k % n; let j = k / n;
      for (var cc = 0; cc < 4; cc++) {
        let P = ro[2 * nSteps() + i32(stepI()) * 4 + cc];
        if (P.w < 0.5) { continue; }
        let ci = select(0, n - 1, (cc & 1) == 1); let cj = select(0, n - 1, cc >= 2);
        let r = u.a.z * length(vec2f(f32(i - ci), f32(j - cj))) * 1.002;
        let dd = x - P.xyz; let l = length(dd);
        if (l > r) { x = P.xyz + dd * (r / l); }
      }
    }
    var touch = vec3f(0.0); // (normale du dernier contact, nulle si le point ne touche rien)
    stuck = 0.0;
    for (var proj = 0; proj < 1; proj++) {
      if (u.d.w > 0.5 && formOn() && (formDrop() == 0.0 || x.y > 0.0)) {
        var g = vec3f(0.0);
        let d = formAt(x, &g); let gl = length(g);
        if (d < u.b.y && gl > 1e-6) { x += g / gl * (u.b.y - d); }
        if (d < u.b.y + 0.0006 && gl > 1e-6) { touch = g / gl; }
      }
      if (x.y < 0.05) {
        let d = plinthAt(x);
        if (d < u.b.y + 0.0006) {
          let gp = plinthGrad(x); let l = length(gp);
          if (l > 1e-12) { if (d < u.b.y) { x += gp / l * (u.b.y - d); } touch = gp / l; }
        }
      }
    }
    x.y = max(x.y, u.d.y + u.b.y);
    // Adhérence statique du linge mouillé. Le frottement de Coulomb, plus haut,
    // ne retient que le déplacement d'inertie du sous-pas ; la dérive que les
    // fils imposent ensuite lui échappe, et un linge mal centré rampait sur le
    // marbre puis glissait d'un bloc jusqu'au sol (une théière sur trois). Un
    // point au contact, que tout le sous-pas ne déplace pas plus vite que
    // STICT (m/s, dosé par l'imbibition), ne bouge pas le long de la surface :
    // sa vitesse reste nulle et ne s'accumule pas. Ce qui tombe, ce qu'on
    // tire, ce qui pend sans rien toucher restent libres.
    {
      // (pleine dès le tiers de l'imbibition : le linge qui vient de se poser
      // sur une arête — le dossier d'une chaise — doit y tenir tout de suite)
      let soak = min(1.0, 3.0 * ro[nSteps() + i32(stepI())].x);
      if (soak > 0.0 && dot(touch, touch) > 0.5) {
        let q0 = st[k].xyz; let dd = x - q0;
        let dn = dot(dd, touch); let tg = dd - touch * dn;
        if (length(tg) < ${STICT} * soak * u.b.x) { x = q0 + touch * dn; stuck = 1.0; }
      }
    }
    // confinement : aucun point ne parcourt plus de VMAX · dt en un sous-pas
    // (le linge tombe à 5 m/s au plus), et une valeur non finie est remplacée
    // par la position du début du sous-pas. Une faute locale reste locale :
    // elle ne gagne ni les voisines, ni le morceau suivant.
    let p0 = st[k].xyz;
    if (finite3(p0)) {
      let dd = x - p0; let dl = length(dd); let lim = ${VMAX} * u.b.x;
      if (!finite3(x)) { x = p0; } else if (dl > lim) { x = p0 + dd * (lim / dl); }
    }
    if (s.y > 0.0) { x += (ro[i32(u.g.w) + k].xyz - x) * s.y; } // (s.y < 0 : auto-collisions actives, sans rappel)
  }
  xa[k] = vec4f(x, stuck);
}

// ── 5. vitesses et normales (pour le sous-pas suivant) ──
@compute @workgroup_size(${WG})
fn velocity(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  let n = nI();
  let x = xa[k].xyz;
  st[NN() + k] = vec4f((x - st[k].xyz) / u.b.x, 0.0);
  let i = k % n; let j = k / n;
  let ua = xa[j * n + min(i + 1, n - 1)].xyz - xa[j * n + max(i - 1, 0)].xyz;
  let va = xa[min(j + 1, n - 1) * n + i].xyz - xa[max(j - 1, 0) * n + i].xyz;
  let nn = cross(ua, va); let l = length(nn);
  st[2 * NN() + k] = vec4f(select(vec3f(0.0, 1.0, 0.0), nn / l, l > 1e-12), st[2 * NN() + k].w);
}
@compute @workgroup_size(1)
fn tick() { nexts[NN()] = nexts[NN()] + 1; }

// ── 6. enregistrement d'une image ──
@compute @workgroup_size(${WG})
fn record(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  frames[nexts[NN() + 1] * NN() + k] = xa[k];
}
@compute @workgroup_size(1)
fn frameTick() { nexts[NN() + 1] = nexts[NN() + 1] + 1; }
`;

// Gauss-Seidel par sommet, en place (xb), une couleur par dispatch : deux
// sommets de même couleur (i mod 3, j mod 3) sont à 3 mailles au moins, et ne
// partagent aucun lien (le plus long, la flexion, va à 2 mailles)
const SOLVE_GS = (name, ci, cj) => /* wgsl */`
@compute @workgroup_size(${WG})
fn ${name}(@builtin(global_invocation_id) gid: vec3u) {
  let n = nI();
  let m3 = (n - ${ci} + 2) / 3;
  let t = i32(gid.x);
  let i = ${ci} + 3 * (t % m3); let j = ${cj} + 3 * (t / m3);
  if (i >= n || j >= n) { return; }
  let k = j * n + i;
  if (pinned(k)) { return; }
  let x = xb[k].xyz;
  let h = u.a.z; let w = u.a.w;
  var acc = vec3f(0.0);
  var mD = vec3f(0.0); var mO = vec3f(0.0); // (Σ g d dᵀ : diagonale, puis xy, xz, yz)
  for (var s = 0; s < 12; s++) {
    var di = 0; var dj = 0; var rest = h; var at = 0.0; var bend = false;
    switch s {
      case 0: { di = 1; } case 1: { di = -1; } case 2: { dj = 1; } case 3: { dj = -1; }
      case 4: { di = 1; dj = 1; rest = h * 1.41421356; at = u.e.x; }
      case 5: { di = -1; dj = 1; rest = h * 1.41421356; at = u.e.x; }
      case 6: { di = 1; dj = -1; rest = h * 1.41421356; at = u.e.x; }
      case 7: { di = -1; dj = -1; rest = h * 1.41421356; at = u.e.x; }
      case 8: { di = 2; rest = 2.0 * h; at = u.e.y; bend = true; }
      case 9: { di = -2; rest = 2.0 * h; at = u.e.y; bend = true; }
      case 10: { dj = 2; rest = 2.0 * h; at = u.e.y; bend = true; }
      default: { dj = -2; rest = 2.0 * h; at = u.e.y; bend = true; }
    }
    let ii = i + di; let jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= n || jj >= n) { continue; }
    let q = jj * n + ii;
    let e = xb[q].xyz - x; let l = length(e);
    if (l < 1e-12) { continue; }
    let cv = l - rest;
    if (bend && cv > 0.0) { continue; }
    let wq = select(w, 0.0, pinned(q));
    let g = w / (w + wq + at); let d = e / l;
    acc += d * (cv * g);
    mD += g * d * d; mO += g * vec3f(d.x * d.y, d.x * d.z, d.y * d.z);
  }
  // Les douze corrections s'additionnent : chacune suppose que le sommet ne
  // répond qu'à son lien. Deux fils opposés font ensemble un pas exact, mais
  // le biais et la flexion s'y ajoutent (gain 1,85 pour le tulle, raide en
  // biais ; plus de 2 dans un pli froissé, où les liens se replient du même
  // côté) : au-delà de 2 le sommet dépasse sa cible de plus que son écart, et
  // l'erreur croît à chaque passe — c'était l'explosion. Le pas est donc
  // ramené au pas exact le long de la correction (Gauss-Newton sur la droite :
  // gain = âᵀ (Σ g d dᵀ) â), jamais plus.
  var al = length(acc);
  if (al > 1e-12) {
    let a = acc / al;
    let den = dot(mD, a * a) + 2.0 * dot(mO, vec3f(a.x * a.y, a.x * a.z, a.y * a.z));
    if (NORM) { acc = acc / max(1.0, den); al = al / max(1.0, den); }
  }
  // (et au plus une maille par passe)
  if (CLAMP && al > h) { acc = acc * (h / al); }
  xb[k] = vec4f(x + acc * u.e.z, 0.0);
}
`;

// limite d'étirement, après la projection (les fils ont le dernier mot) :
// un fil de chaîne ou de trame tendu au-delà de 8 % est ramené à 8 %, en
// place dans xa, une couleur par dispatch
const LIMIT_GS = (name, ci, cj) => /* wgsl */`
@compute @workgroup_size(${WG})
fn ${name}(@builtin(global_invocation_id) gid: vec3u) {
  let n = nI();
  let m3 = (n - ${ci} + 2) / 3;
  let t = i32(gid.x);
  let i = ${ci} + 3 * (t % m3); let j = ${cj} + 3 * (t / m3);
  if (i >= n || j >= n) { return; }
  let k = j * n + i;
  // (un point qui adhère est un ancrage, comme une prise : la limite, passée
  // après l'adhérence, le déplaçait quand même, et le linge filait du dossier
  // d'une chaise en une à deux secondes dès qu'il n'avait plus de bouts où s'accrocher)
  if (pinned(k) || xa[k].w > 0.5) { return; }
  let x = xa[k].xyz;
  let h = u.a.z; let w = u.a.w;
  var acc = vec3f(0.0);
  var mD = vec3f(0.0); var mO = vec3f(0.0);
  for (var s = 0; s < 4; s++) {
    var di = 0; var dj = 0;
    switch s { case 0: { di = 1; } case 1: { di = -1; } case 2: { dj = 1; } default: { dj = -1; } }
    let ii = i + di; let jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= n || jj >= n) { continue; }
    let q = jj * n + ii;
    let e = xa[q].xyz - x; let l = length(e);
    let lim = h * 1.08;
    if (l <= lim) { continue; }
    let wq = select(w, 0.0, pinned(q) || xa[q].w > 0.5);
    let g = w / (w + wq); let d = e / l;
    acc += d * ((l - lim) * g);
    mD += g * d * d; mO += g * vec3f(d.x * d.y, d.x * d.z, d.y * d.z);
  }
  // (même pas exact que les fils : quatre fils repliés du même côté
  // tiraient deux fois trop)
  let al = length(acc);
  if (al > 1e-12) {
    let a = acc / al;
    acc = acc / max(1.0, dot(mD, a * a) + 2.0 * dot(mO, vec3f(a.x * a.y, a.x * a.z, a.y * a.z)));
  }
  xa[k] = vec4f(x + acc, 0.0);
}
`;

const SOLVE = (name, src, dst) => /* wgsl */`
@compute @workgroup_size(${WG})
fn ${name}(@builtin(global_invocation_id) gid: vec3u) {
  let k = i32(gid.x);
  if (k >= NN()) { return; }
  let x = ${src}[k].xyz;
  if (pinned(k)) { ${dst}[k] = vec4f(x, 0.0); return; }
  let n = nI(); let i = k % n; let j = k / n;
  let h = u.a.z; let w = u.a.w;
  var acc = vec3f(0.0); var cnt = 0.0;
  for (var s = 0; s < 12; s++) {
    var di = 0; var dj = 0; var rest = h; var at = 0.0; var bend = false;
    switch s {
      case 0: { di = 1; } case 1: { di = -1; } case 2: { dj = 1; } case 3: { dj = -1; }
      case 4: { di = 1; dj = 1; rest = h * 1.41421356; at = u.e.x; }
      case 5: { di = -1; dj = 1; rest = h * 1.41421356; at = u.e.x; }
      case 6: { di = 1; dj = -1; rest = h * 1.41421356; at = u.e.x; }
      case 7: { di = -1; dj = -1; rest = h * 1.41421356; at = u.e.x; }
      case 8: { di = 2; rest = 2.0 * h; at = u.e.y; bend = true; }
      case 9: { di = -2; rest = 2.0 * h; at = u.e.y; bend = true; }
      case 10: { dj = 2; rest = 2.0 * h; at = u.e.y; bend = true; }
      default: { dj = -2; rest = 2.0 * h; at = u.e.y; bend = true; }
    }
    let ii = i + di; let jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= n || jj >= n) { continue; }
    let q = jj * n + ii;
    let e = ${src}[q].xyz - x; let l = length(e);
    if (l < 1e-12) { continue; }
    let cv = l - rest;
    if (bend && cv > 0.0) { continue; }
    let wq = select(w, 0.0, pinned(q));
    let lam = cv / (w + wq + at);
    acc += e * (lam * w / l);
    cnt += 1.0;
  }
  ${dst}[k] = vec4f(x + acc * (u.e.z / max(cnt * 0.5, 1.0)), 0.0);
}
`;

export function createGpuCloth(device) {
    let gsCode = '';
  for (let c = 0; c < 9; c++) gsCode += SOLVE_GS(`solveC${c}`, c % 3, Math.floor(c / 3)) + LIMIT_GS(`limitC${c}`, c % 3, Math.floor(c / 3));
  const code = WGSL.replace('SOLVE_PLACEHOLDER', SOLVE('solveAB', 'xb', 'xa') + SOLVE('solveBA', 'xa', 'xb') + gsCode);
  const module = device.createShaderModule({ code, label: 'veil-cloth' });
  module.getCompilationInfo?.().then((info) => { for (const m of info.messages) if (m.type === 'error') console.error('veil-cloth WGSL', m.lineNum, m.message); });
  const S = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    entries: [
      ...[0, 1, 2, 3, 4].map((b) => ({ binding: b, visibility: S, buffer: { type: 'storage' } })),
      ...[5, 6].map((b) => ({ binding: b, visibility: S, buffer: { type: 'read-only-storage' } })),
      { binding: 7, visibility: S, buffer: { type: 'storage' } },
      { binding: 8, visibility: S, buffer: { type: 'uniform' } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const P = {};
  for (const k of ['predict', 'hashClear', 'hashInsert', 'gatherContacts', 'solveAB', 'solveBA', 'post', 'velocity', 'tick', 'record', 'frameTick', ...Array.from({ length: 9 }, (_, c) => `solveC${c}`), ...Array.from({ length: 9 }, (_, c) => `limitC${c}`)]) {
    P[k] = device.createComputePipeline({ layout: pl, compute: { module, entryPoint: k } });
  }
  const USE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const mk = (bytes, usage = USE) => device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });

  // job : comme simulate() de gen/cloth.js, plus sdf (champ cuit de la forme)
  async function simulate(job, onProgress = null) {
    const t0 = performance.now();
    const cl = makeCloth(job.n, job.L, job.fabric);
    const { n, N } = cl;
    const wet = job.wet ?? 0;
    // (frottement sur la statue : celui de l'étoffe, à peine réduit par l'eau
    // (×0,8). Réduit par le « marbre poli » (×0,4) et par l'eau (×0,5), il
    // tombait à 0,14 : le linge glissait d'un bloc hors de la forme)
    const F0 = cl.F, rho = F0.rho * (1 + 1.2 * wet), bend = F0.bend * (1 + 0.8 * wet), mu = F0.mu * (1 - 0.2 * wet) * (wet > 0 ? 1.5 : 1) * (Q.get('mu') ? +Q.get('mu') : 1); // (le linge mouillé accroche : frottement relevé de moitié)
    const m = cl.m * (1 + 1.2 * wet), w = 1 / m;
    const sub = Q.get('sub') ? +Q.get('sub') : (job.sub ?? 450), dt = 1 / sub, fps = job.fps ?? 30;
    const per = Math.round(sub / fps);
    if (per * fps !== sub) throw new Error('sous-pas : multiple de la cadence attendu');
    let Ttot, knot;
    if (job.mode === 'hang') { Ttot = job.T.total; knot = () => 0; }
    else if (job.mode === 'rise') { Ttot = job.T.tug + job.T.lift + job.T.hang; knot = (t) => knotRise(t, job.y0, job.yH, job.T); }
    else { Ttot = job.T.pre + job.T.lower + job.T.settle + (job.T.fall ?? 0); knot = (t) => knotDesc(t, job.yH, job.y1, job.T); }
    const steps = Math.round(Ttot * sub), count = Math.round(Ttot * fps) + 1;
    const W = job.wind ?? null, tw0 = job.windT0 ?? 0;
    const windSpeed = (t) => {
      if (!W) return 0;
      let e = 0;
      if (job.mode === 'desc') e = smoother((t - (job.T.pre + job.T.lower * 0.7)) / 1.6);
      else if (job.mode === 'rise') e = 1 - smoother(t / (job.T.tug + job.T.lift * 0.55));
      return W.speed * e * (0.82 + 0.18 * Math.sin((t + tw0) * W.breath + W.phase));
    };
    // horaire : un vec4 par sous-pas (indice = numéro du sous-pas, 1…steps)
    const sched = new Float32Array((steps + 2) * 4);
    for (let s = 1; s <= steps; s++) {
      const t = s * dt;
      let beta = 0;
      if (job.mode === 'rise' && job.target) {
        const s0 = job.T.tug + job.T.lift;
        // (rappel étalé sur toute la pendaison, sans resserrement final : à
        // 3 % par sous-pas au plus, croissant comme q², l'écart restant au
        // dernier sous-pas est de l'ordre du millimètre ; le resserrement des derniers 15 % recalait le voile d'un coup)
        // Sur les 0,3 dernières secondes, le rappel monte à 20 % par sous-pas :
        // l'écart restant (jusqu'à 2 cm sur un bord qui balance encore) se
        // résorbe en dix images au lieu de sauter au dernier sous-pas, où un
        // point partait à 8 m/s — un à-coup au raccord de la boucle.
        if (t > s0) { const q = s === steps ? 1 : Math.min(1, (t - s0) / job.T.hang), e = smoother((t - (s0 + job.T.hang - 0.3)) / 0.3); beta = s === steps ? 1 : 0.0005 + 0.03 * q * q + 0.2 * e * e; }
      }
      // auto-collisions tant que le voile bouge vraiment : jusqu'à 0,8 s après
      // la pose de la bague (descente), pendant la tension et la montée ;
      // ensuite l'étoffe est posée (ou pendue), ses couches séparées
      let selfOn = true;
      if (job.mode === 'desc') selfOn = t < job.T.pre + job.T.lower + (Q.get('selfend') ? +Q.get('selfend') : 0.8);
      else if (job.mode === 'rise') selfOn = t < job.T.tug + job.T.lift + 0.3;
      else if (job.mode === 'hang') selfOn = t < 1.5;
      if (Q.has('selfall')) selfOn = true;
      sched.set([knot(t), beta > 0 ? beta : selfOn ? -1 : 0, windSpeed(t), t + tw0], s * 4);
    }
    // uniformes
    const U = new Float32Array(9 * 4 + 12 * 4);
    const kn = (0.5 * RHO_AIR * F0.drag) / rho;
    const damp = (job.mode === 'hang' ? 3 : (job.damp ?? 1.2)) * (job.safe ? 3 : 1); // (job.safe : reprise d'un morceau malsain, plus amortie, deux passes de plus)
    const gsIter = GS_ITER + (job.safe ? 2 : 0);
    U.set([n, N, cl.h, w], 0);
    // (l'aspiration du linge humide est retirée : à 5 cm de portée, elle tirait
    // une couche extérieure à travers celle du dessous, et le voile posé se
    // traversait ; plus courte, elle faisait diverger le satin. ?adh=30 la remet,
    // pour comparer)
    U.set([dt, RC, Q.has("noadh") ? 0 : wet * (job.adhA ?? (Q.get("adh") ? +Q.get("adh") : 0)), job.adhR ?? 0.05], 4);
    U.set([kn, 0.02 * kn, damp, mu], 8);
    U.set([mu * 0.8, job.floorY ?? -2, cl.h * SELF, job.sdf ? 1 : 0], 12);
    U.set([F0.shear * 2 * w, bend * 2 * w, OMEGA != null ? +OMEGA : MODE === 'gs' ? 1 : 1.5, 0], 16);
    if (job.sdf) { U.set([...job.sdf.origin, job.sdf.h], 20); U.set([...job.sdf.dims, 0], 24); }
    const wd = W ? W.dir : [0, 0, 0];
    U.set([wd[0], wd[1], wd[2], job.pins === 'corners' ? (job.mode === 'rise' && job.sdf ? 2 : 3) : job.noPin ? 0 : 1], 28);
    { const c = Math.cos(job.rot ?? 0), s = Math.sin(job.rot ?? 0); U.set([c, s, -s, c], 32); }
    if (job.plinth) {
      const parts = (Q.has('stack') ? plinthDims(job.plinth) : plinthCollider(job.plinth)).parts.slice(0, 6); // (?stack : l'empilement entier, pour comparer)
      U[19] = parts.length;
      parts.forEach((q, k) => {
        const o = 36 + k * 8;
        if (q.t === 'box') U.set([0, q.c[0], q.c[1], q.c[2], q.h[0], q.h[1], q.h[2], q.r], o);
        else U.set([1, q.y0, q.y1, q.R, 0, 0, 0, q.r], o);
      });
    }
    // tampons
    const start = job.start ?? flatPositions(cl, 0, job.rot ?? 0, job.seed);
    const v4 = (src) => { const o = new Float32Array(N * 4); if (src) for (let k = 0; k < N; k++) { o[k * 4] = src[k * 3]; o[k * 4 + 1] = src[k * 3 + 1]; o[k * 4 + 2] = src[k * 3 + 2]; } return o; };
    const nS = steps + 2; // (horaire, horaire de l'adhérence, puis H)
    // adhérence progressive : nulle à la pose, pleine 1,5 s plus tard (le
    // linge s'imbibe et se plaque peu à peu, sans claquer sur la forme) ;
    // elle retombe dès que la montée commence
    const adhAt = (t) => job.mode === 'desc' ? smoother((t - (job.T.pre + job.T.lower * 0.85)) / 1.5) : job.mode === 'rise' ? (1 - smoother(t / (0.6 * (job.T.tug + job.T.lift * 0.3)))) / 3 : 0; // (à la reprise, l'adhérence lâche en une demi-seconde : tenue plus longtemps, elle ancrait le tas pendant que les coins tiraient, et les fils s'étiraient de 3 à 5 mailles)
    // ro : horaire [0, nS), adhérence [nS, 2nS), prises des coins [2nS, 6nS)
    // (4 par sous-pas : position, tenu 1 / lâché 0), puis H à 6nS
    const CLIP = 3;
    const ro = new Float32Array((6 * nS + N + 4 * CLIP * CLIP + 4) * 4);
    ro.set(sched, 0);
    // (la statue s'évanouit au bout du repos : le linge s'effondre sur le socle)
    // Elle s'enfonce dans le socle en 70 % de la chute (une chute libre
    // faisait glisser le linge hors du socle), puis disparaît.
    const tVanish = job.mode === 'desc' && job.T.fall ? job.T.pre + job.T.lower + job.T.settle : Infinity;
    const sink = job.T?.fall ? job.T.fall * 0.85 : 1, depth = (job.formTop ?? 0.6) + 0.02;
    for (let st = 0; st <= steps; st++) {
      const t = st * dt, s = (t - tVanish) / sink, on = s < 1;
      // (l'adhérence demeure pendant qu'elle s'efface : le linge mouillé
      // la suit vers le centre du socle au lieu d'en glisser)
      ro[(nS + st) * 4] = on ? adhAt(t) : 0;
      ro[(nS + st) * 4 + 1] = on ? 1 : 0;
      ro[(nS + st) * 4 + 2] = s > 0 ? depth * smoother(Math.min(1, s)) : 0;
      ro[(nS + st) * 4 + 3] = s > 0 ? 1 - 0.65 * smoother(Math.min(1, s)) : 1;
    }
    if (job.pins === 'corners') for (let st = 0; st <= steps; st++) for (let c = 0; c < 4; c++) {
      const P4 = job.cornerAt(st * dt, c);
      ro.set(P4, (2 * nS + st * 4 + c) * 4);
    }
    if (job.target) ro.set(v4(job.target), 6 * nS * 4);
    // (formes des pinces à la reprise : écart de chaque maille au coin)
    if (job.pins === 'corners' && job.start) for (let c = 0; c < 4; c++) {
      const ci = c & 1 ? n - 1 : 0, cj = c >= 2 ? n - 1 : 0, q0 = cj * n + ci;
      const Gk = [], dI = [], dJ = [];
      for (let a = 0; a < CLIP; a++) for (let b = 0; b < CLIP; b++) {
        const i = c & 1 ? ci - a : a, j = c >= 2 ? cj - b : b, q = j * n + i;
        Gk.push([0, 1, 2].map((d) => job.start[q * 3 + d] - job.start[q0 * 3 + d])); dI.push(i - ci); dJ.push(j - cj);
      }
      // repère de la pince telle qu'elle repose : G ≈ U di + V dj (moindres carrés)
      let sii = 0, sij = 0, sjj = 0; const bi = [0, 0, 0], bj = [0, 0, 0];
      Gk.forEach((g, m) => { sii += dI[m] * dI[m]; sij += dI[m] * dJ[m]; sjj += dJ[m] * dJ[m]; for (let d = 0; d < 3; d++) { bi[d] += dI[m] * g[d]; bj[d] += dJ[m] * g[d]; } });
      const det = sii * sjj - sij * sij;
      const Uv = [0, 1, 2].map((d) => (sjj * bi[d] - sij * bj[d]) / det), Vv = [0, 1, 2].map((d) => (sii * bj[d] - sij * bi[d]) / det);
      const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const nrm3 = (a) => { const l = Math.hypot(...a); return l > 1e-9 ? a.map((x) => x / l) : null; };
      const cr = Math.cos(job.rot ?? 0), sr = Math.sin(job.rot ?? 0);
      const uF = [cr, 0, sr], vF = [-sr, 0, cr], nF = cross3(uF, vF);
      let axis = [0, 1, 0], theta = 0, Qm = null;
      const uG = Math.hypot(...Uv) > 0.2 * cl.h ? nrm3(Uv) : null;
      const vG = uG ? nrm3(Vv.map((x, d) => x - dot3(Vv, uG) * uG[d])) : null;
      if (uG && vG && Math.hypot(...Vv) > 0.2 * cl.h && Gk.every((g) => g.every(Number.isFinite))) {
        const nG = cross3(uG, vG);
        // Q = [uG vG nG] [uF vF nF]ᵀ : amène la pince à plat sur la pince qui repose
        Qm = [0, 1, 2].map((r) => [0, 1, 2].map((cc) => uG[r] * uF[cc] + vG[r] * vF[cc] + nG[r] * nF[cc]));
        const tr = Qm[0][0] + Qm[1][1] + Qm[2][2];
        theta = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
        const ax = [Qm[2][1] - Qm[1][2], Qm[0][2] - Qm[2][0], Qm[1][0] - Qm[0][1]];
        if (Math.hypot(...ax) > 1e-4) axis = nrm3(ax);
        else if (theta > 1) { // (demi-tour : l'axe se lit sur la diagonale)
          const d = [0, 1, 2].map((r) => Math.sqrt(Math.max(0, (Qm[r][r] + 1) / 2))), m = d.indexOf(Math.max(...d));
          axis = nrm3([0, 1, 2].map((r) => (r === m ? d[m] : (Qm[m][r] + Qm[r][m]) / (4 * d[m])))) ?? [0, 1, 0];
        } else theta = 0;
        if (theta === 0) Qm = null;
      }
      Gk.forEach((g, m) => {
        const a = Math.abs(dI[m]), b = Math.abs(dJ[m]), o = (6 * nS + N + c * CLIP * CLIP + a * CLIP + b) * 4;
        // (le froissé, dans le repère de la pince à plat : Qᵀ G)
        const gl = Qm ? [0, 1, 2].map((cc) => Qm[0][cc] * g[0] + Qm[1][cc] * g[1] + Qm[2][cc] * g[2]) : g;
        for (let d = 0; d < 3; d++) ro[o + d] = Number.isFinite(gl[d]) ? gl[d] : 0;
      });
      ro.set([axis[0], axis[1], axis[2], theta], (6 * nS + N + 4 * CLIP * CLIP + c) * 4);
    }
    U[27] = 6 * nS; // (u.g.w : début de H dans ro)
    const B = {
      xa: mk(N * 16), xb: mk(N * 16), st: mk(N * 48), heads: mk(TB * 4), nexts: mk((N + 2) * 4), ro: mk(ro.byteLength),
      sdf: mk(job.sdf ? job.sdf.D.byteLength : 16), frames: mk(count * N * 16), ub: mk(U.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    };
    // (entrées assainies : une vitesse non finie vaut zéro)
    if (job.startVel && !job.startVel.every(Number.isFinite)) job = { ...job, startVel: job.startVel.map((x) => (Number.isFinite(x) ? x : 0)) };
    const X0 = v4(start);
    device.queue.writeBuffer(B.xa, 0, X0);
    device.queue.writeBuffer(B.frames, 0, X0);
    device.queue.writeBuffer(B.st, N * 16, v4(job.startVel));
    device.queue.writeBuffer(B.nexts, N * 4, new Int32Array([1, 1]));
    device.queue.writeBuffer(B.ro, 0, ro);
    if (job.sdf) device.queue.writeBuffer(B.sdf, 0, job.sdf.D);
    device.queue.writeBuffer(B.ub, 0, U);
    // normales de départ
    {
      const nr = new Float32Array(N * 4);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i, a = j * n + Math.min(i + 1, n - 1), b = j * n + Math.max(i - 1, 0), c = Math.min(j + 1, n - 1) * n + i, e = Math.max(j - 1, 0) * n + i;
        const ux = start[a * 3] - start[b * 3], uy = start[a * 3 + 1] - start[b * 3 + 1], uz = start[a * 3 + 2] - start[b * 3 + 2];
        const vx = start[c * 3] - start[e * 3], vy = start[c * 3 + 1] - start[e * 3 + 1], vz = start[c * 3 + 2] - start[e * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nr.set([nx / l, ny / l, nz / l, 0], k * 4);
      }
      device.queue.writeBuffer(B.st, N * 32, nr);
    }
    const bg = device.createBindGroup({
      layout,
      entries: ['xa', 'xb', 'st', 'heads', 'nexts', 'ro', 'sdf', 'frames', 'ub'].map((k, i) => ({ binding: i, resource: { buffer: B[k] } })),
    });
    const gN = Math.ceil(N / WG), gT = Math.ceil(TB / WG), gC = Math.ceil(Math.ceil(n / 3) ** 2 / WG);
    // Par tranches de sous-pas. Au chargement : 150 sous-pas (≈ 90 ms de GPU)
    // par soumission, au plus vite. Pendant que le film joue (job.pace), une
    // petite tranche par image affichée, au débit qu'il faut pour que tout
    // soit prêt à temps, plus 50 % (on finit en avance, sans à-coup final) : les grosses tranches bloquaient le rendu
    // et le début de la boucle saccadait.
    const nRecorded = Math.floor(steps / per); // (images enregistrées en cours de route ; le reste = l'état final)
    const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 50); });
    let step = 1, tPrev = performance.now(), inflight = 0;
    const free = () => { for (const b of Object.values(B)) b.destroy(); };
    while (step <= steps) {
      // (une autre scène a été demandée : on s'arrête là, le GPU est rendu)
      if (job.alive && !job.alive()) { await device.queue.onSubmittedWorkDone(); free(); return null; }
      let chunk = 150;
      if (job.pace) {
        while (inflight > 2 && (!job.alive || job.alive())) await nextFrame(); // (au plus trois tranches en attente sur le GPU ; à deux, le débit tombait de moitié quand l'hologramme chargeait le rendu et le film attendait une seconde)
        // (job.pace(reste) : sous-pas par seconde qu'il faut tenir pour que
        // ce morceau et les suivants soient prêts à temps ; la tranche suit
        // le temps réellement écoulé depuis la précédente)
        const now = performance.now(), dtf = Math.min(1 / 30, Math.max(1 / 144, (now - tPrev) / 1000)); // (le temps réellement écoulé, jusqu'à 1/30 s : borné à 1/60, le débit tombait sous le besoin dès que l'affichage passait sous 60 i/s, et le retard s'emballait)
        tPrev = now;
        // (28 sous-pas par image au plus, ≈ 18 ms de GPU : c'est encore deux à
        // trois fois le temps réel. À 150, une tranche prenait 100 ms et le
        // rendu s'effondrait — plus il ralentissait, plus le retard grossissait
        // les tranches. Si le calcul ne suit pas, le film attend sur son image.)
        chunk = Math.min(28, Math.max(3, Math.ceil(job.pace(steps - step + 1) * dtf * 1.5)));
        if (Q.has('debug')) (globalThis.__veilChunks ??= []).push([Math.round(now), chunk, Math.round(job.pace(steps - step + 1))]);
      }
      const last = Math.min(steps, step + chunk - 1);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, bg);
      {
        for (; step <= last; step++) {
          pass.setPipeline(P.predict); pass.dispatchWorkgroups(gN);
          if ((Q.has('selfevery') || (step & 1) === 0) && !Q.has('noself')) { pass.setPipeline(P.hashClear); pass.dispatchWorkgroups(gT); pass.setPipeline(P.hashInsert); pass.dispatchWorkgroups(gN); }
          pass.setPipeline(P.gatherContacts); pass.dispatchWorkgroups(gN);
          if (MODE === 'gs') { for (let it = 0; it < gsIter; it++) for (let c = 0; c < 9; c++) { pass.setPipeline(P[`solveC${c}`]); pass.dispatchWorkgroups(gC); } }
          else for (let it = 0; it < ITER; it++) { pass.setPipeline(it % 2 ? P.solveBA : P.solveAB); pass.dispatchWorkgroups(gN); }
          pass.setPipeline(P.post); pass.dispatchWorkgroups(gN);
          if (LIMIT) for (let it = 0; it < LIM_IT; it++) for (let c = 0; c < 9; c++) { pass.setPipeline(P[`limitC${c}`]); pass.dispatchWorkgroups(gC); }
          pass.setPipeline(P.velocity); pass.dispatchWorkgroups(gN);
          pass.setPipeline(P.tick); pass.dispatchWorkgroups(1);
          if (step % per === 0 && step / per <= nRecorded && step / per < count) { pass.setPipeline(P.record); pass.dispatchWorkgroups(gN); pass.setPipeline(P.frameTick); pass.dispatchWorkgroups(1); }
        }
      }
      pass.end();
      device.queue.submit([enc.finish()]);
      // (pendant la lecture, on n'attend pas la fin de chaque tranche : cette
      // attente prenait 70 ms et grossissait les tranches ; on compte celles
      // en vol pour ne jamais empiler plus de travail que le GPU n'en absorbe)
      if (!job.pace || step > steps) await device.queue.onSubmittedWorkDone();
      else { inflight++; device.queue.onSubmittedWorkDone().then(() => { inflight--; }); }
      onProgress?.(Math.min(1, step / steps));
      if (job.pace) await nextFrame();
    }
    // lecture : images, état final, vitesses
    const rd = mk(count * N * 16 + N * 16 * 2, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(B.frames, 0, rd, 0, count * N * 16);
    enc.copyBufferToBuffer(B.xa, 0, rd, count * N * 16, N * 16);
    enc.copyBufferToBuffer(B.st, N * 16, rd, count * N * 16 + N * 16, N * 16);
    device.queue.submit([enc.finish()]);
    await rd.mapAsync(GPUMapMode.READ);
    // (lu en place, sans copie ; pendant la lecture du film, quelques images
    // à la fois entre deux images affichées : en un seul bloc, la copie, le
    // rangement et la quantification de ~30 Mo figeaient le rendu ~100 ms)
    const all = new Float32Array(rd.getMappedRange());
    const final = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    const fo = count * N * 4;
    for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) { final[k * 3 + c] = all[fo + k * 4 + c]; vel[k * 3 + c] = all[fo + N * 4 + k * 4 + c]; }
    const exactLast = job.mode === 'rise' && job.target; // (rappel exact sur H : le dernier sous-pas a β = 1)
    const frames = job.quantized ? new Int16Array(count * N * 3) : new Float32Array(count * N * 3);
    const qs = [0, 1, 2].map((c) => 65535 / (QB.hi[c] - QB.lo[c]));
    const put = job.quantized
      ? (i, v, c) => { const q = Math.round((v - QB.lo[c]) * qs[c]) - 32768; frames[i] = q < -32768 ? -32768 : q > 32767 ? 32767 : q; }
      : (i, v) => { frames[i] = v; };
    const out = new Float32Array(N * 3);
    // santé de l'enregistrement, mesurée sur les flottants (une fois quantifié,
    // un NaN vaut 0 et ne se voit plus) : première image non finie ou hors de
    // la boîte de quantification, plus grand étirement d'un fil
    const health = { ok: true, bad: -1, stretch: 0, stretchAt: -1, stretchK: -1, speed: 0 };
    const check = (f, o) => {
      let worst = 0, wk = -1;
      for (let k = 0; k < N; k++) {
        const a = o + k * 4, x = all[a], y = all[a + 1], z = all[a + 2];
        if (!(x > QB.lo[0] && x < QB.hi[0] && y > QB.lo[1] && y < QB.hi[1] && z > QB.lo[2] && z < QB.hi[2])) { if (health.bad < 0) health.bad = f; return; }
        if (k % n < n - 1) { const b = a + 4, d = Math.hypot(all[b] - x, all[b + 1] - y, all[b + 2] - z); if (d > worst) { worst = d; wk = k; } }
        if (k < N - n) { const b = a + n * 4, d = Math.hypot(all[b] - x, all[b + 1] - y, all[b + 2] - z); if (d > worst) { worst = d; wk = k; } }
      }
      if (worst / cl.h - 1 > health.stretch) { health.stretch = worst / cl.h - 1; health.stretchAt = f; health.stretchK = wk; }
    };
    for (let f = 0; f < count; f++) {
      const src = f <= nRecorded ? f : -1; // (images après la dernière enregistrée : l'état final, comme sur le CPU)
      const last = f === count - 1;
      // (la santé se mesure image par image, entre deux images affichées :
      // d'un bloc, ses cinq millions de longueurs figeaient le rendu 80 ms à
      // la fin de chaque morceau)
      if (src >= 0) check(f, f * N * 4);
      if (last) check(f, fo);
      for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) {
        const v = last && exactLast ? job.target[k * 3 + c] : src >= 0 ? all[(src * N + k) * 4 + c] : final[k * 3 + c];
        put((f * N + k) * 3 + c, v, c);
        // (comme gen/cloth.js : l'état de sortie est la dernière image du
        // film, pour que le morceau suivant reparte exactement de ce qu'on a vu)
        if (last) out[k * 3 + c] = v;
      }
      if (job.pace && f % 6 === 5) await nextFrame();
    }
    for (let k = 0; k < N; k++) { const s = Math.hypot(vel[k * 3], vel[k * 3 + 1], vel[k * 3 + 2]); if (!(s < 50)) { if (health.bad < 0) health.bad = count - 1; } else if (s > health.speed) health.speed = s; }
    health.ok = health.bad < 0 && health.stretch < 6; // (un accroc bref sur l'arête du socle étire un fil de 2 à 4 mailles ; une explosion, de dix et plus)
    rd.unmap(); rd.destroy();
    free();
    if (Q.has('nan')) { // (mise au point : premier NaN de l'enregistrement)
      const sv = job.startVel ? job.startVel.findIndex((v) => !Number.isFinite(v)) : -1;
      const fi = frames.findIndex((v) => !Number.isFinite(v));
      console.warn('nan', job.mode, { startVel: sv, frame: fi < 0 ? -1 : Math.floor(fi / (N * 3)), k: fi < 0 ? -1 : Math.floor((fi % (N * 3)) / 3) % n, j: fi < 0 ? -1 : Math.floor(Math.floor((fi % (N * 3)) / 3) / n), vel: vel.findIndex((v) => !Number.isFinite(v)) });
    }
    return { frames, count, fps, final: out, vel, n, N, health, ms: performance.now() - t0 };
  }

  return { simulate, dispose() {} };
}
