// La surface de l'eau, calculée sur le GPU à chaque image (shaders de calcul
// WebGPU sur le périphérique du moteur de rendu).
//
// 1. assemble : pour chaque mode k du domaine périodique (N×N, côté L), le
//    spectre de l'instant — chaque dessin j : Wⱼ·cos(ω(k)τⱼ)·e^{−2νk²|τⱼ|}·Ĥⱼ(k)
//    (ondes stationnaires : la convergence est la dispersion lue à l'envers),
//    plus la ride de fond (ondes progressives, fréquences arrondies à des
//    multiples de 2π/T : périodique sur la boucle) ; et le spectre des pentes
//    i·kx·Ŝ + i·(i·kz·Ŝ), pour en tirer ∂h/∂x et ∂h/∂z d'une seule FFT.
// 2. FFT inverse en deux passes (lignes, colonnes), chacune en mémoire
//    partagée : un groupe de travail par ligne, toutes les étapes de Cooley-
//    Tukey entre deux barrières.
// 3. finalize : champ (h, ∂h/∂x, ∂h/∂z, 0) en mètres, plus les termes
//    analytiques des familles Faraday (ondes stationnaires à enveloppe) et
//    Kármán (fossettes des tourbillons). three.js le lit directement dans son
//    tampon (StorageBufferAttribute) : aucun aller-retour par le processeur.
import * as THREE from 'three/webgpu';
import { GRAV, SIGMA_RHO, NU } from '../optics.js';

export const MAX_EVENTS = 3;
export const MAX_MODES = 12; // Faraday : ondes planes du réseau
export const MAX_VORTEX = 24; // Kármán : tourbillons à l'image

const WG = 256;

function wgsl(N) {
  const LOG = Math.log2(N);
  return /* wgsl */`
const N: u32 = ${N}u;
const LOGN: u32 = ${LOG}u;
const PI: f32 = 3.14159265358979;
struct P {
  L: f32, H: f32, nEv: u32, famK: u32,
  tAmb: f32, ambAmp: f32, dOmega: f32, pad0: f32,
  tau: vec4f,        // temps physique de chaque dessin
  wgt: vec4f,        // poids (fenêtre) de chaque dessin
  far: vec4f,        // Faraday : amplitude, oscillation (cos de la phase), modes du 1er réseau, du 2nd
  front1: vec4f,     // Faraday : 1er réseau — centre (x, z), rayon du front, largeur du front
  front2: vec4f,     // Faraday : 2nd réseau, qui envahit le premier
  vtx: vec4f,        // Kármán : nombre de tourbillons
  modes: array<vec4f, ${MAX_MODES}>,   // kx, kz, phase, poids
  vort: array<vec4f, ${MAX_VORTEX}>,   // x, z, circulation signée (profondeur), rayon
};
@group(0) @binding(0) var<storage, read> spec: array<vec2f>;
@group(0) @binding(1) var<storage, read> amb: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> A: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> B: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> field: array<vec4f>;
@group(0) @binding(5) var<uniform> p: P;

fn waveK(c: u32) -> vec2f {
  let q = c / N; let pp = c % N;
  let fp = select(f32(pp), f32(pp) - f32(N), pp > N / 2u);
  let fq = select(f32(q), f32(q) - f32(N), q > N / 2u);
  return vec2f(fp, fq) * (2.0 * PI / p.L);
}
fn omega(k: f32) -> f32 { return sqrt((${GRAV} * k + ${SIGMA_RHO} * k * k * k) * tanh(min(k * p.H, 20.0))); }
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

@compute @workgroup_size(${WG}) fn assemble(@builtin(global_invocation_id) g: vec3u) {
  let c = g.x; if (c >= N * N) { return; }
  let kv = waveK(c); let k = length(kv);
  let w = omega(k); let gam = ${2 * NU} * k * k;
  var S = vec2f(0.0);
  for (var e = 0u; e < p.nEv; e++) {
    let t = p.tau[e];
    let f = p.wgt[e] * cos(w * t) * exp(-gam * abs(t));
    S += spec[e * N * N + c] * f;
  }
  if (p.ambAmp > 0.0) {
    // ride de fond : ½[a(k)e^{−iωt} + conj(a(−k))e^{iωt}] (spectre hermitien)
    let q = c / N; let pp = c % N;
    let cn = ((N - q) % N) * N + (N - pp) % N;
    let wq = round(w / p.dOmega) * p.dOmega;
    let ph = wq * p.tAmb;
    let e1 = vec2f(cos(ph), -sin(ph));
    let a = amb[c]; let b = amb[cn];
    S += 0.5 * p.ambAmp * (cmul(a, e1) + cmul(vec2f(b.x, -b.y), vec2f(e1.x, -e1.y)));
  }
  A[c] = S;
  B[c] = vec2f(-kv.x * S.y - kv.y * S.x, kv.x * S.x - kv.y * S.y);
}

var<workgroup> sh: array<vec2f, ${N}>;
fn rev(i: u32) -> u32 { return reverseBits(i) >> (32u - LOGN); }
fn stages(li: u32) {
  for (var s = 1u; s <= LOGN; s++) {
    let m = 1u << s; let half = m >> 1u;
    for (var b = li; b < N / 2u; b += ${WG}u) {
      let j = b % half; let k = (b / half) * m + j;
      let ang = 2.0 * PI * f32(j) / f32(m);
      let t = cmul(vec2f(cos(ang), sin(ang)), sh[k + half]);
      let u = sh[k];
      sh[k] = u + t; sh[k + half] = u - t;
    }
    workgroupBarrier();
  }
}
// un groupe par ligne : les N premiers groupes pour A, les N suivants pour B
@compute @workgroup_size(${WG}) fn rows(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let r = wg.x % N; let isB = wg.x >= N; let base = r * N;
  for (var i = li; i < N; i += ${WG}u) { sh[rev(i)] = select(A[base + i], B[base + i], isB); }
  workgroupBarrier();
  stages(li);
  for (var i = li; i < N; i += ${WG}u) { if (isB) { B[base + i] = sh[i]; } else { A[base + i] = sh[i]; } }
}
@compute @workgroup_size(${WG}) fn cols(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let col = wg.x % N; let isB = wg.x >= N;
  for (var i = li; i < N; i += ${WG}u) { let c = i * N + col; sh[rev(i)] = select(A[c], B[c], isB); }
  workgroupBarrier();
  stages(li);
  for (var i = li; i < N; i += ${WG}u) { let c = i * N + col; if (isB) { B[c] = sh[i]; } else { A[c] = sh[i]; } }
}

// Faraday : deux réseaux d'ondes stationnaires, chacun sous l'enveloppe de
// son front (qui s'étend depuis son centre de nucléation) ; le second
// remplace le premier là où il est passé ; le tout oscille à Ω/2 (p.far.y).
fn envelope(x: vec2f, fr: vec4f) -> vec3f {
  let w = max(fr.w, 1e-4);
  let d = length(x - fr.xy);
  let t = clamp((d - (fr.z - w)) / (2.0 * w), 0.0, 1.0);
  let e = 1.0 - t * t * (3.0 - 2.0 * t);
  let de = -6.0 * t * (1.0 - t) / (2.0 * w) * (x - fr.xy) / max(d, 1e-5);
  return vec3f(e, de);
}
fn faraday(x: vec2f) -> vec3f {
  if (p.far.x <= 0.0) { return vec3f(0.0); }
  let e1 = envelope(x, p.front1); let e2 = envelope(x, p.front2);
  // poids des deux réseaux et leurs gradients
  let a1 = e1.x * (1.0 - e2.x); let g1 = e1.yz * (1.0 - e2.x) - e1.x * e2.yz;
  let a2 = e2.x; let g2 = e2.yz;
  if (a1 + a2 <= 0.0) { return vec3f(0.0); }
  let n1 = u32(p.far.z); let n = n1 + u32(p.far.w);
  var h1 = 0.0; var d1 = vec2f(0.0); var h2 = 0.0; var d2 = vec2f(0.0);
  for (var i = 0u; i < n; i++) {
    let m = p.modes[i];
    let a = dot(m.xy, x) + m.z;
    let c = m.w * cos(a); let dc = -m.w * sin(a) * m.xy;
    if (i < n1) { h1 += c; d1 += dc; } else { h2 += c; d2 += dc; }
  }
  let s = p.far.x * p.far.y;
  return s * vec3f(h1 * a1 + h2 * a2, d1 * a1 + h1 * g1 + d2 * a2 + h2 * g2);
}

// Kármán : fossette de chaque tourbillon (profil de Lamb-Oseen, dépression
// h = −c·(1 − e^{−r²/a²})/r² en forme régularisée) ; ses pentes exactes
fn karman(x: vec2f) -> vec3f {
  var h = 0.0; var g = vec2f(0.0);
  for (var i = 0u; i < u32(p.vtx.x); i++) {
    let v = p.vort[i];
    let d = x - v.xy; let r2 = dot(d, d); let a2 = v.w * v.w;
    // dépression gaussienne-algébrique : f(r²) = −c·a²/(r² + a²) · e^{−r²/(9a²)}
    let q = a2 / (r2 + a2); let e = exp(-r2 / (9.0 * a2));
    let f = -v.z * q * e;
    h += f;
    // df/d(r²) = −c·[−a²/(r²+a²)²·e + q·e·(−1/(9a²))]
    let df = -v.z * (-q / (r2 + a2) * e - q * e / (9.0 * a2));
    g += 2.0 * d * df;
  }
  return vec3f(h, g);
}

@compute @workgroup_size(${WG}) fn finalize(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x; if (c >= N * N) { return; }
  let inv = 1.0 / f32(N * N);
  let a = A[c]; let b = B[c];
  var f = vec3f(a.x, b.x, b.y) * inv;
  if (p.famK > 0u) {
    let i = c % N; let j = c / N;
    let x = (vec2f(f32(i), f32(j)) + 0.5) * (p.L / f32(N)) - 0.5 * p.L;
    if (p.famK == 1u) { f += faraday(x); }
    if (p.famK == 2u) { f += karman(x); }
  }
  field[c] = vec4f(f, 0.0);
}
`;
}

// Taille du tampon d'uniformes (voir la structure P)
const UBYTES = 8 * 16 + MAX_MODES * 16 + MAX_VORTEX * 16; // (8 vec4 d'en-tête)

export function createWaves(renderer, { N, L, H }) {
  const device = renderer.backend.device;
  const NN = N * N;
  const fieldAttr = new THREE.StorageBufferAttribute(new Float32Array(NN * 4), 4);
  renderer.backend.createStorageAttribute(fieldAttr);
  const fieldBuf = renderer.backend.get(fieldAttr).buffer;
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const specBuf = device.createBuffer({ size: MAX_EVENTS * NN * 8, usage });
  const ambBuf = device.createBuffer({ size: NN * 8, usage });
  const aBuf = device.createBuffer({ size: NN * 8, usage });
  const bBuf = device.createBuffer({ size: NN * 8, usage });
  const ubuf = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: wgsl(N) });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const mk = (entryPoint) => device.createComputePipeline({ layout: pl, compute: { module, entryPoint } });
  const P = { assemble: mk('assemble'), rows: mk('rows'), cols: mk('cols'), finalize: mk('finalize') };
  const bind = device.createBindGroup({
    layout,
    entries: [specBuf, ambBuf, aBuf, bBuf, fieldBuf, ubuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  // (erreurs de compilation : affichées une fois)
  module.getCompilationInfo?.().then((info) => { for (const m of info.messages) if (m.type === 'error') console.error(`waves.wgsl ${m.lineNum}:${m.linePos} ${m.message}`); });

  const data = new ArrayBuffer(UBYTES), f32 = new Float32Array(data), u32 = new Uint32Array(data);
  let nEv = 0;

  const api = {
    N, L, H, fieldAttr,
    // spectre Ĥ du dessin e (re, im entrelacés)
    setEvent(e, inter) { device.queue.writeBuffer(specBuf, e * NN * 8, inter); },
    setEventCount(n) { nEv = Math.min(MAX_EVENTS, n); },
    setAmbient(inter) { device.queue.writeBuffer(ambBuf, 0, inter); },
    // s = { events: [{ tau, w }], tAmb, ambAmp, dOmega, family: 0|1|2, faraday, karman }
    update(s) {
      f32.fill(0);
      f32[0] = api.L; f32[1] = api.H; u32[2] = nEv; u32[3] = s.family || 0;
      f32[4] = s.tAmb || 0; f32[5] = s.ambAmp || 0; f32[6] = s.dOmega || 1;
      for (let e = 0; e < MAX_EVENTS; e++) { f32[8 + e] = s.events?.[e]?.tau ?? 0; f32[12 + e] = s.events?.[e]?.w ?? 0; }
      const F = s.faraday, K = s.karman;
      if (F) {
        const modes = [...F.modes1, ...F.modes2].slice(0, MAX_MODES);
        f32[16] = F.amp; f32[17] = F.osc; f32[18] = Math.min(F.modes1.length, MAX_MODES); f32[19] = modes.length - f32[18];
        f32.set(F.front1, 20); f32.set(F.front2, 24);
        modes.forEach((m, i) => f32.set(m, 32 + i * 4));
      }
      if (K) {
        f32[28] = Math.min(MAX_VORTEX, K.vortices.length);
        K.vortices.slice(0, MAX_VORTEX).forEach((v, i) => f32.set(v, 32 + MAX_MODES * 4 + i * 4));
      }
      device.queue.writeBuffer(ubuf, 0, data);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, bind);
      pass.setPipeline(P.assemble); pass.dispatchWorkgroups(Math.ceil(NN / WG));
      pass.setPipeline(P.rows); pass.dispatchWorkgroups(2 * N);
      pass.setPipeline(P.cols); pass.dispatchWorkgroups(2 * N);
      pass.setPipeline(P.finalize); pass.dispatchWorkgroups(Math.ceil(NN / WG));
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    // lecture du champ (mise au point) : Float32Array N×N×4
    async read() {
      const rb = device.createBuffer({ size: NN * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(fieldBuf, 0, rb, 0, NN * 16);
      device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(rb.getMappedRange().slice(0));
      rb.unmap(); rb.destroy();
      return out;
    },
    dispose() { for (const b of [specBuf, ambBuf, aBuf, bBuf, ubuf]) b.destroy(); },
  };
  return api;
}
