// L'étage fin du voile, d'après Huamin Wang, « GPU-Based Simulation of Cloth
// Wrinkles at Submillimeter Levels » (SIGGRAPH 2021) : la simulation grossière
// (n × n particules, workers) donne le mouvement ; à chaque image, une grille
// régulière R fois plus fine est posée sur sa surface (le même patch de
// Catmull-Rom que le rendu), puis amenée à l'équilibre sur le GPU :
//   - fils et biais à la longueur de la VRAIE étoffe (la surface grossière,
//     tendue entre ses particules, est plus courte : ce surplus fait les plis) ;
//   - flexion (liens à deux mailles, en compression) ;
//   - attache à la surface grossière, tangentielle seulement (le pli sort de
//     la surface, il ne glisse pas) et bornée en hauteur ;
//   - contact avec la statue absente (son champ cuit, lu en trilinéaire) et
//     le socle (ses cotes analytiques), adhérence du linge humide.
// Le solveur est un Jacobi par sommet (deux tampons alternés), sans opération
// atomique : déterministe. Il part chaque image de la surface grossière, sans
// état gardé d'une image à l'autre : l'image ne dépend que de la phase.
//
// createFine(renderer, n, R) → { cur, prv (StorageBufferAttribute, lus par le
// rendu), m, setForms(sdfs), setPlinth(dims), encode(coarse, formIdx, P) }

import * as THREE from 'three/webgpu';

const WG = 64;
const NEAR = '0.03'; // (portée du poids d'adhérence, comme fineRef.js : P.near)

const WGSL = /* wgsl */`
struct U {
  a: vec4f,   // n, m, R, pin (rayon tenu par la bague, en sommets fins)
  b: vec4f,   // hf, RC, adh, RA
  c: vec4f,   // origine du champ (x, y, z), pas du champ
  d: vec4f,   // nx, ny, nz (dimensions du champ), décalage de la forme dans le tableau
  e: vec4f,   // ancrage, hauteur maximale hors de la surface, poids de la flexion, poids du biais
  f: vec4f,   // nombre de pièces du socle, sol, forme active (0/1), graine
  p: array<vec4f, 12>, // socle : (type, a, b, c), (d, e, f, r) par pièce
};
@group(0) @binding(0) var<storage, read> coarse: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> base: array<vec4f>;  // surface grossière (xyz) + normale encodée dans nrm
@group(0) @binding(2) var<storage, read_write> nrm: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> xa: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> xb: array<vec4f>;
@group(0) @binding(5) var<storage, read> sdf: array<f32>;
@group(0) @binding(6) var<uniform> u: U;

fn C(i: i32, j: i32) -> vec3f {
  let n = i32(u.a.x);
  return coarse[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)].xyz;
}
fn crw(t: f32) -> vec4f {
  let t2 = t * t; let t3 = t2 * t;
  return vec4f(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2) * 0.5;
}
fn crd(t: f32) -> vec4f {
  let t2 = t * t;
  return vec4f(-3.0 * t2 + 4.0 * t - 1.0, 9.0 * t2 - 10.0 * t, -9.0 * t2 + 8.0 * t + 1.0, 3.0 * t2 - 2.0 * t) * 0.5;
}
fn hash(i: u32) -> f32 {
  var x = i * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

// ── 1. pose initiale : le patch de Catmull-Rom de la surface grossière ──
@compute @workgroup_size(${WG})
fn init(@builtin(global_invocation_id) gid: vec3u) {
  let m = i32(u.a.y);
  let k = i32(gid.x);
  if (k >= m * m) { return; }
  let R = u.a.z;
  let gx = f32(k % m) / R; let gy = f32(k / m) / R;
  let n = u.a.x;
  let fi = clamp(gx, 0.0, n - 1.0001); let fj = clamp(gy, 0.0, n - 1.0001);
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj));
  let tu = fi - floor(fi); let tv = fj - floor(fj);
  let wu = crw(tu); let wv = crw(tv); let du = crd(tu); let dv = crd(tv);
  var p = vec3f(0.0); var pu = vec3f(0.0); var pv = vec3f(0.0);
  for (var b = 0; b < 4; b++) {
    var row = vec3f(0.0); var rowU = vec3f(0.0);
    for (var a = 0; a < 4; a++) {
      let q = C(i0 + a - 1, j0 + b - 1);
      row += q * wu[a]; rowU += q * du[a];
    }
    p += row * wv[b]; pu += rowU * wv[b]; pv += row * dv[b];
  }
  var nn = cross(pu, pv);
  let l = length(nn);
  nn = select(vec3f(0.0, 1.0, 0.0), nn / l, l > 1e-9);
  base[k] = vec4f(p, 0.0);
  // poids de l'adhérence (dans nrm.w) : la surface grossière doit déjà être
  // près de la statue, sinon le linge claquerait d'un coup sur la forme
  var wAdh = 0.0;
  if (u.f.z > 0.5) {
    var g0 = vec3f(0.0);
    let d0 = sdfAt(p, &g0);
    if (d0 < 1.0) { wAdh = 1.0 - smoothstep(0.006, ${NEAR}, d0); }
  }
  nrm[k] = vec4f(nn, wAdh);
  // (un souffle de désordre selon la normale : sans lui, le surplus d'étoffe
  // resterait à plat, en équilibre instable)
  let jit = (hash(u32(k) * 7u + u32(u.f.w)) - 0.5) * 0.0006;
  xa[k] = vec4f(p + nn * jit, 0.0);
}

// champ de la forme (trilinéaire, gradient par cellule)
fn sdfAt(p: vec3f, g: ptr<function, vec3f>) -> f32 {
  let h = u.c.w;
  let dims = vec3i(i32(u.d.x), i32(u.d.y), i32(u.d.z));
  let q = (p - u.c.xyz) / h;
  if (any(q < vec3f(0.0)) || q.x >= f32(dims.x - 1) || q.y >= f32(dims.y - 1) || q.z >= f32(dims.z - 1)) { return 1.0; }
  let i = vec3i(floor(q)); let t = q - floor(q);
  let off = i32(u.d.w);
  let sx = 1; let sy = dims.x; let sz = dims.x * dims.y;
  let o = off + i.z * sz + i.y * sy + i.x;
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
  let np = i32(u.f.x);
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

`;

// une itération de Jacobi (src → dst) ; le WGSL est écrit pour chaque sens
const SOLVE = (name, src, dst) => /* wgsl */`
// ── 2. une itération de Jacobi : src → dst ──
fn ${name}(k: i32) {
  let m = i32(u.a.y);
  if (k >= m * m) { return; }
  let i = k % m; let j = k / m;
  let x = ${src}[k].xyz;
  let hf = u.b.x;
  // la bague : les sommets fins sous elle suivent la surface grossière
  let c = (m - 1) / 2;
  let pr = i32(u.a.w);
  let pinned = abs(i - c) <= pr && abs(j - c) <= pr; // (sous la bague : la surface grossière, mais hors de la matière)
  var acc = vec3f(0.0); var wsum = 0.0;
  // fils (4 voisins), biais (4 diagonales), flexion (4 voisins à deux mailles, en compression)
  for (var s = 0; s < 12; s++) {
    var di = 0; var dj = 0; var rest = hf; var w = 1.0; var bend = false;
    switch s {
      case 0: { di = 1; } case 1: { di = -1; } case 2: { dj = 1; } case 3: { dj = -1; }
      case 4: { di = 1; dj = 1; rest = hf * 1.41421356; w = u.e.w; }
      case 5: { di = -1; dj = 1; rest = hf * 1.41421356; w = u.e.w; }
      case 6: { di = 1; dj = -1; rest = hf * 1.41421356; w = u.e.w; }
      case 7: { di = -1; dj = -1; rest = hf * 1.41421356; w = u.e.w; }
      case 8: { di = 2; rest = 2.0 * hf; w = u.e.z; bend = true; }
      case 9: { di = -2; rest = 2.0 * hf; w = u.e.z; bend = true; }
      case 10: { dj = 2; rest = 2.0 * hf; w = u.e.z; bend = true; }
      default: { dj = -2; rest = 2.0 * hf; w = u.e.z; bend = true; }
    }
    let ii = i + di; let jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= m || jj >= m) { continue; }
    let y = ${src}[jj * m + ii].xyz;
    let e = y - x; let l = length(e);
    if (l < 1e-9) { continue; }
    let cv = l - rest;
    if (bend && cv > 0.0) { continue; }
    acc += e * (0.5 * cv / l) * w;
    wsum += w;
  }
  var p = x + acc / max(wsum, 1.0) * 1.6; // (sur-relaxation : Jacobi moyenné converge lentement)
  // attache tangentielle à la surface grossière, hauteur hors surface bornée
  let b0 = base[k].xyz; let n0 = nrm[k].xyz;
  let dlt = p - b0;
  let hn = dot(dlt, n0);
  let tg = dlt - n0 * hn;
  p = select(b0 + tg * (1.0 - u.e.x) + n0 * clamp(hn, -u.e.y, u.e.y), b0, pinned);
  // statue absente : contact et adhérence du linge humide
  // (deux projections : dans un creux, une seule peut retomber dans la matière)
  for (var proj = 0; proj < 2; proj++) {
  if (u.f.z > 0.5) {
    var g = vec3f(0.0);
    let d = sdfAt(p, &g);
    let gl = length(g);
    if (gl > 1e-6 && d < 1.0) {
      let nn = g / gl;
      if (d < u.b.y) { p += nn * (u.b.y - d); }
      else if (d < u.b.y + u.b.w && proj == 0) { p -= nn * min(d - u.b.y, u.b.z * nrm[k].w * (1.0 - smoothstep(u.b.y, u.b.y + u.b.w, d))); }
    }
  }
  }
  // socle (gradient par différences centrées, seulement près du dessus)
  if (p.y < 0.05) {
    let d = plinthAt(p);
    if (d < u.b.y) {
      let e = 0.0005;
      let gp = vec3f(plinthAt(p + vec3f(e, 0.0, 0.0)) - plinthAt(p - vec3f(e, 0.0, 0.0)),
                     plinthAt(p + vec3f(0.0, e, 0.0)) - plinthAt(p - vec3f(0.0, e, 0.0)),
                     plinthAt(p + vec3f(0.0, 0.0, e)) - plinthAt(p - vec3f(0.0, 0.0, e)));
      let l = length(gp);
      if (l > 1e-9) { p += gp / l * (u.b.y - d); }
    }
  }
  p.y = max(p.y, u.f.y + u.b.y);
  // (w : le linge collé à la statue, pour le rendu — plus sombre et plus
  // lisse là où l'eau le plaque ; u.f.z < 0 : la statue s'efface, plus de
  // contact, et la marque s'estompe d'elle-même en -u.f.z)
  var cl = 0.0;
  if (abs(u.f.z) > 0.001) {
    var g2 = vec3f(0.0);
    let d2 = sdfAt(p, &g2);
    cl = (1.0 - smoothstep(u.b.y, u.b.y + 0.012, d2)) * select(1.0, -u.f.z, u.f.z < 0.0);
  }
  ${dst}[k] = vec4f(p, cl);
}

@compute @workgroup_size(${WG})
fn ${name}Main(@builtin(global_invocation_id) gid: vec3u) { ${name}(i32(gid.x)); }
`;

export function createFine(renderer, n, R = 4) {
  const device = renderer.backend.device;
  const m = (n - 1) * R + 1, M = m * m;
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const buf = (bytes) => device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });
  const coarse = buf(n * n * 16), base = buf(M * 16), nrm = buf(M * 16), xa = buf(M * 16), xb = buf(M * 16);
  let sdf = buf(16);
  const ub = device.createBuffer({ size: 6 * 16 + 12 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // sorties lues par le rendu : attributs de stockage de three.js, dont on
  // écrit le tampon GPU nous-mêmes (jamais de needsUpdate : three l'écraserait)
  const cur = new THREE.StorageBufferAttribute(new Float32Array(M * 4), 4);
  const prv = new THREE.StorageBufferAttribute(new Float32Array(M * 4), 4);
  renderer.backend.createStorageAttribute(cur);
  renderer.backend.createStorageAttribute(prv);
  const curBuf = renderer.backend.get(cur).buffer, prvBuf = renderer.backend.get(prv).buffer;

  const module = device.createShaderModule({ code: WGSL + SOLVE('solveAB', 'xa', 'xb') + SOLVE('solveBA', 'xb', 'xa'), label: 'veil-fine' });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ...[1, 2, 3, 4].map((b) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })),
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipe = (entryPoint) => device.createComputePipeline({ layout: pl, compute: { module, entryPoint } });
  const P = { init: pipe('init'), ab: pipe('solveABMain'), ba: pipe('solveBAMain') };
  module.getCompilationInfo?.().then((info) => { for (const msg of info.messages) if (msg.type === 'error') console.error('veil-fine WGSL', msg.lineNum, msg.message); });
  let bg = null;
  const rebind = () => {
    bg = device.createBindGroup({ layout, entries: [coarse, base, nrm, xa, xb, sdf, ub].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
  };
  rebind();

  // formes : champs cuits concaténés ; chaque forme garde son en-tête
  let forms = [];
  function setForms(list) {
    let total = 0;
    for (const f of list) total += f.D.length;
    const all = new Float32Array(Math.max(4, total));
    forms = [];
    let off = 0;
    for (const f of list) { all.set(f.D, off); forms.push({ off, dims: f.dims, origin: f.origin, h: f.h }); off += f.D.length; }
    sdf.destroy();
    sdf = device.createBuffer({ size: Math.ceil(all.byteLength / 16) * 16, usage });
    device.queue.writeBuffer(sdf, 0, all);
    rebind();
  }
  const U = new Float32Array(6 * 4 + 12 * 4);
  function setPlinth(dims) {
    const parts = dims.parts.slice(0, 6);
    U[20] = parts.length; U[21] = -dims.H;
    parts.forEach((q, k) => {
      const o = 24 + k * 8;
      if (q.t === 'box') { U.set([0, q.c[0], q.c[1], q.c[2], q.h[0], q.h[1], q.h[2], q.r], o); }
      else { U.set([1, q.y0, q.y1, q.R, 0, 0, 0, q.r], o); }
    });
  }

  // P = { L, iters, adh, anchor, maxN, bend, shear, seed }
  function encode(enc, coarseData, formIdx, prm) {
    device.queue.writeBuffer(coarse, 0, coarseData);
    const hf = prm.L / (m - 1);
    U.set([n, m, R, prm.pin ?? R], 0);
    U.set([hf, prm.RC ?? 0.004, prm.adh ?? 0, prm.RA ?? 0.02], 4);
    const F = forms[formIdx];
    if (F) { U.set([F.origin[0], F.origin[1], F.origin[2], F.h], 8); U.set([F.dims[0], F.dims[1], F.dims[2], F.off], 12); }
    U.set([prm.anchor ?? 0.04, prm.maxN ?? 0.02, prm.bend ?? 0.3, prm.shear ?? 0.5], 16);
    U[22] = F ? (prm.fade != null ? -Math.max(0.002, prm.fade) : 1) : 0; U[23] = prm.seed ?? 0;
    device.queue.writeBuffer(ub, 0, U);
    // (la pose précédente garde l'image d'avant : les vecteurs vitesse)
    enc.copyBufferToBuffer(curBuf, 0, prvBuf, 0, M * 16);
    const pass = enc.beginComputePass({ label: 'veil-fine' });
    pass.setBindGroup(0, bg);
    const g = Math.ceil(M / WG);
    pass.setPipeline(P.init); pass.dispatchWorkgroups(g);
    const it = prm.iters ?? 48;
    for (let k = 0; k < it; k++) { pass.setPipeline(k % 2 ? P.ba : P.ab); pass.dispatchWorkgroups(g); }
    pass.end();
    enc.copyBufferToBuffer(it % 2 ? xb : xa, 0, curBuf, 0, M * 16);
  }

  // lecture du résultat (mise au point, tests dans la page)
  async function read() {
    const rd = device.createBuffer({ size: M * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(curBuf, 0, rd, 0, M * 16);
    device.queue.submit([enc.finish()]);
    await rd.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(rd.getMappedRange().slice(0));
    rd.unmap(); rd.destroy();
    return out;
  }

  return {
    m, R, cur, prv, setForms, setPlinth, encode, read,
    dispose() { for (const b of [coarse, base, nrm, xa, xb, sdf, ub]) b.destroy(); for (const a of [cur, prv]) { try { renderer._attributes?.delete(a) ?? renderer.backend.destroyAttribute(a); } catch { /* déjà libéré */ } } },
  };
}
