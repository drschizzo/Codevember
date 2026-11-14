// La fonte calculée, sur le GPU, au chargement : pour chaque cristal de la
// grappe, le problème de Stefan sur une grille 3D (modèle : melt/model.js),
// puis l'instant τ où chaque cellule fond et la vitesse du front v = 1/|∇τ|,
// rangés dans un atlas 3D (rg16float) que le lancer de rayons relit à chaque
// image. Le cristal à l'instant u de la fonte est { trémie } ∩ { τ > u }.
//
// Chaque cristal garde aussi, pas à pas, son tassement (le bloc qui s'enfonce
// quand sa taille a fondu) et s'il lui reste du solide au-dessus du bain.
import { PHYS, gridsFor, stepsFor } from '../melt/model.js';
import { HOPPER_WGSL } from './hopper.js';

const WGSL = HOPPER_WGSL + /* wgsl */ `
struct S {
  dims: vec4f,   // nx, ny, nz, h
  box: vec4f,    // X, Y, dt, pas
  crys: vec4f,   // demi-côté, hauteur du centre, angle, inclinaison
  tide: vec4f,   // LL, D (descente totale), exposant, air ambiant
  heat: vec4f,   // alpha, T0, Tb, Lh
  xch: vec4f,    // hb, ha, a, lambda
  fall: vec4f,   // vitesse de tassement, croûte, port, part de la section d'origine qui porte encore
  pack: vec4f,   // pas d'une ligne de l'atlas (en u32), seuil des restes, vitesse de leur effondrement, —
};
@group(0) @binding(0) var<uniform> S0: S;
@group(0) @binding(1) var<storage, read_write> Hin: array<f32>;
@group(0) @binding(2) var<storage, read_write> Hout: array<f32>;
@group(0) @binding(3) var<storage, read_write> tau: array<f32>;
// ctr : pas, cellules au ras du bain, bain (repère du cristal), tassement, cellules au-dessus du bain,
// leur maximum, effondrement des restes (0 / 1)
// (puis, à partir de 8, la section d'origine du cristal, couche par couche)
@group(0) @binding(4) var<storage, read_write> ctr: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> hist: array<f32>;
@group(0) @binding(6) var<storage, read_write> tA: array<f32>;
@group(0) @binding(7) var<storage, read_write> tB: array<f32>;
@group(0) @binding(8) var<storage, read_write> outp: array<u32>;

fn nx() -> i32 { return i32(S0.dims.x); } fn ny() -> i32 { return i32(S0.dims.y); } fn nz() -> i32 { return i32(S0.dims.z); }
fn NN() -> i32 { return nx() * ny() * nz(); }
fn id3(i: i32, j: i32, k: i32) -> i32 { return i + nx() * (j + ny() * k); }
fn cl3(q: vec3i) -> i32 { let r = clamp(q, vec3i(0), vec3i(nx() - 1, ny() - 1, nz() - 1)); return id3(r.x, r.y, r.z); }
fn Tof(e: f32) -> f32 { if (e < 0.0) { return e; } if (e > S0.heat.w) { return e - S0.heat.w; } return 0.0; }
fn bath(u: f32) -> f32 { return S0.tide.x + S0.tide.y * pow(clamp(u, 0.0, 1.0), S0.tide.z); }
fn lin(g: vec3u) -> i32 { return i32(g.x + g.y * 65535u * 64u); }

@compute @workgroup_size(64)
fn init(@builtin(global_invocation_id) g: vec3u) {
  let id = lin(g); if (id >= NN()) { return; }
  let i = id % nx(); let j = (id / nx()) % ny(); let k = id / (nx() * ny());
  let h = S0.dims.w;
  let p = vec3f(-S0.box.x + (f32(i) + 0.5) * h, (f32(j) + 0.5) * h, -S0.box.x + (f32(k) + 0.5) * h);
  let q = rotX(rotY(p - vec3f(0.0, S0.crys.y, 0.0), S0.crys.z), S0.crys.w);
  if (hopperK(q, S0.crys.x, S0.fall.z).x < 0.0) { Hout[id] = S0.heat.y; Hin[id] = S0.heat.y; tau[id] = 99.0; atomicAdd(&ctr[8 + j], 1u); }
  else { Hout[id] = 0.0; tau[id] = -1.0; }
  if (id == 0) { atomicStore(&ctr[0], 0u); atomicStore(&ctr[1], 999999u); atomicStore(&ctr[2], bitcast<u32>(S0.tide.x)); atomicStore(&ctr[3], 0u); atomicStore(&ctr[4], 1u); }
}

@compute @workgroup_size(1)
fn advance() {
  // l'appui : la section du solide au ras du bain ; sous le seuil, le bloc
  // n'est plus porté et s'enfonce (vitesse bornée) ; il ne remonte jamais
  let s = atomicLoad(&ctr[0]) + 1u; atomicStore(&ctr[0], s);
  let u = f32(s) * S0.box.z;
  var d = bitcast<f32>(atomicLoad(&ctr[3]));
  let h = S0.dims.w;
  let band = f32(atomicLoad(&ctr[1]));
  let L = bath(u);
  // (la section d'origine aux mêmes couches : celle d'une trémie creuse est
  // petite à bien des hauteurs, sans que rien n'ait fondu)
  let j0 = i32(floor((L + d) / h));
  var sec = 0.0;
  if (j0 >= 0 && j0 < ny()) { sec += f32(atomicLoad(&ctr[8 + j0])); }
  if (j0 + 1 >= 0 && j0 + 1 < ny()) { sec += f32(atomicLoad(&ctr[9 + j0])); }
  // les restes : sous 20 % du solide qui a été hors du bain, ils s’effondrent
  let ab = atomicLoad(&ctr[4]);
  let mx = max(atomicLoad(&ctr[5]), ab); atomicStore(&ctr[5], mx);
  if (ab > 0u && f32(ab) < S0.pack.y * f32(mx)) { atomicStore(&ctr[6], 1u); }
  if (atomicLoad(&ctr[6]) == 1u && ab > 0u) { d += S0.pack.z * S0.box.z; }
  else if (sec > 0.0 && band < S0.fall.w * sec && L + d < S0.box.y - 0.1) { d += S0.fall.x * S0.box.z; }
  atomicStore(&ctr[3], bitcast<u32>(d));
  atomicStore(&ctr[2], bitcast<u32>(L + d));
  let o = 2u * s;
  if (o + 1u < arrayLength(&hist)) { hist[o] = d; hist[o + 1u] = f32(ab); }
  atomicStore(&ctr[1], 0u); atomicStore(&ctr[4], 0u);
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) g: vec3u) {
  let id = lin(g); if (id >= NN()) { return; }
  let dt = S0.box.z; let u = f32(atomicLoad(&ctr[0])) * dt;
  let e0 = Hin[id];
  if (tau[id] <= u) { Hout[id] = e0; return; }
  let i = id % nx(); let j = (id / nx()) % ny(); let k = id / (nx() * ny());
  let h = S0.dims.w; let L = bitcast<f32>(atomicLoad(&ctr[2]));
  let K = S0.heat.x / (h * h); let Hb = S0.xch.x / h; let Ha = S0.xch.y / h;
  let T = Tof(e0);
  var f = 0.0;
  let off = array<vec3i, 6>(vec3i(-1, 0, 0), vec3i(1, 0, 0), vec3i(0, -1, 0), vec3i(0, 1, 0), vec3i(0, 0, -1), vec3i(0, 0, 1));
  for (var m = 0; m < 6; m++) {
    let q = vec3i(i, j, k) + off[m];
    if (q.y < 0) { f += K * (S0.fall.y - T); continue; } // la croûte, plus froide : elle tient le pied
    if (q.x >= 0 && q.x < nx() && q.y < ny() && q.z >= 0 && q.z < nz()) {
      let o = id3(q.x, q.y, q.z);
      if (tau[o] > u) { f += K * (Tof(Hin[o]) - T); continue; }
    }
    // le bain (au prorata de la part noyée de la cellule voisine) ou le panache d'air chaud
    let y = (f32(q.y) + 0.5) * h;
    let wet = clamp((L - (y - 0.5 * h)) / h, 0.0, 1.0);
    f += wet * Hb * (S0.heat.z - T) + (1.0 - wet) * Ha * (S0.tide.w + (S0.heat.z * S0.xch.z - S0.tide.w) * exp(-max(y - L, 0.0) / S0.xch.w) - T);
  }
  let e = e0 + dt * f;
  Hout[id] = e;
  let half = 0.5 * S0.heat.w;
  if (e >= half) { tau[id] = u + dt * (half - e0) / max(e - e0, 1e-9); }
  else {
    let yc = (f32(j) + 0.5) * h;
    if (yc >= L && yc < L + 2.0 * h) { atomicAdd(&ctr[1], 1u); }
    if (yc >= L) { atomicAdd(&ctr[4], 1u); }
  }
}

// le champ relu par le rendu : remplir l'air au bord de la trémie (sinon
// l'interpolation creuse une fausse surface), lisser (la méthode fond une
// cellule à la fois ; la tension superficielle lisse les faces fondues), dériver
@compute @workgroup_size(4, 4, 4)
fn fill(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  var v = tau[id3(q.x, q.y, q.z)];
  if (v < 0.0) {
    var m = -1.0;
    for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) { for (var c = -1; c <= 1; c++) { m = max(m, tau[cl3(q + vec3i(a, b, c))]); } } }
    v = max(m, 0.0);
  }
  tA[id3(q.x, q.y, q.z)] = min(v, 1.4);
}
fn blurAt(q: vec3i, src: i32) -> f32 {
  var s = 0.0; var w = 0.0;
  for (var a = -1; a <= 1; a++) { for (var b = -1; b <= 1; b++) { for (var c = -1; c <= 1; c++) {
    let k = 1.0 / f32(1 + abs(a) + abs(b) + abs(c));
    let o = cl3(q + vec3i(a, b, c));
    s += k * select(tB[o], tA[o], src == 0); w += k;
  } } }
  return s / w;
}
@compute @workgroup_size(4, 4, 4)
fn blurAB(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  tB[id3(q.x, q.y, q.z)] = blurAt(q, 0);
}
@compute @workgroup_size(4, 4, 4)
fn blurBA(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  tA[id3(q.x, q.y, q.z)] = blurAt(q, 1);
}
@compute @workgroup_size(4, 4, 4)
fn bake(@builtin(global_invocation_id) g: vec3u) {
  let q = vec3i(g); if (q.x >= nx() || q.y >= ny() || q.z >= nz()) { return; }
  let t = tB[id3(q.x, q.y, q.z)];
  let gr = vec3f(tB[cl3(q + vec3i(1, 0, 0))] - tB[cl3(q - vec3i(1, 0, 0))], tB[cl3(q + vec3i(0, 1, 0))] - tB[cl3(q - vec3i(0, 1, 0))], tB[cl3(q + vec3i(0, 0, 1))] - tB[cl3(q - vec3i(0, 0, 1))]) / (2.0 * S0.dims.w);
  let v = clamp(1.0 / max(length(gr), 1e-4), 0.02, 30.0);
  outp[u32(q.z) * u32(ny()) * u32(S0.pack.x) + u32(q.y) * u32(S0.pack.x) + u32(q.x)] = pack2x16float(vec2f(t, v));
}
`;

// rangement des grilles dans l'atlas : par étagères, dans le plan (x, z)
function packAtlas(grids) {
  const order = grids.map((g, i) => i).sort((a, b) => grids[b].nz - grids[a].nz);
  const area = grids.reduce((s, g) => s + (g.nx + 1) * (g.nz + 1), 0);
  const width = Math.min(2048, Math.max(Math.max(...grids.map((g) => g.nx + 1)), Math.ceil(Math.sqrt(area) * 1.2)));
  const pos = [];
  let x = 0, z = 0, rowH = 0;
  for (const i of order) {
    const g = grids[i];
    if (x + g.nx + 1 > width) { x = 0; z += rowH; rowH = 0; }
    pos[i] = [x, z];
    x += g.nx + 1; rowH = Math.max(rowH, g.nz + 1);
  }
  return { pos, W: width, H: Math.max(...grids.map((g) => g.ny)), D: z + rowH };
}

export function createMelt(renderer) {
  const device = renderer.backend.device;
  const module = device.createShaderModule({ code: WGSL, label: 'fonte' });
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) if (m.type === 'error') console.error(`fonte ${m.lineNum}:${m.linePos} ${m.message}`);
  });
  const B = (type) => ({ visibility: GPUShaderStage.COMPUTE, buffer: { type } });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, ...B('uniform') }, { binding: 1, ...B('storage') }, { binding: 2, ...B('storage') }, { binding: 3, ...B('storage') },
    { binding: 4, ...B('storage') }, { binding: 5, ...B('storage') }, { binding: 6, ...B('storage') }, { binding: 7, ...B('storage') },
    { binding: 8, ...B('storage') }] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipes = {};
  const ready = Promise.all(['init', 'advance', 'step', 'fill', 'blurAB', 'blurBA', 'bake'].map(async (e) => {
    pipes[e] = await device.createComputePipelineAsync({ layout: pl, compute: { module, entryPoint: e } });
  }));

  // un atlas vide (rien ne fond) tant que la simulation n'a pas tourné
  const blank = device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: blank }, new Uint16Array([0x5630, 0x3c00]), { bytesPerRow: 4 }, [1, 1, 1]); // (τ = 99, v = 1)
  let atlas = null;

  // simulate(grappe, …) : promesse de { texture, dims, crystals } ; cancelled() l'interrompt
  async function simulate(cluster, { habit, LL, D, quality = 1, budget = 2.5e10, onProgress = () => {}, cancelled = () => false }) {
    await ready;
    const grids = gridsFor(cluster, habit, { quality, budget });
    const P = PHYS;
    const work = grids.map((g) => g.nx * g.ny * g.nz * stepsFor(g.h).steps);
    const total = work.reduce((a, b) => a + b, 0);
    let done = 0;
    const Nmax = Math.max(...grids.map((g) => g.nx * g.ny * g.nz));
    const mk = (n, extra = 0) => device.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | extra });
    const H0 = mk(Nmax), H1 = mk(Nmax), tauB = mk(Nmax), tA = mk(Nmax), tB = mk(Nmax), ctr = mk(Math.max(...grids.map((g) => g.ny)) + 12, GPUBufferUsage.COPY_DST);
    const strideMax = Math.ceil((Math.max(...grids.map((g) => g.nx)) * 4) / 256) * 64;
    const outB = mk(strideMax * Math.max(...grids.map((g) => g.ny * g.nz)), GPUBufferUsage.COPY_SRC);
    const ubuf = device.createBuffer({ size: 32 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const pk = packAtlas(grids);
    const tex = device.createTexture({ size: [pk.W, pk.H, pk.D], dimension: '3d', format: 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const out = [];
    const free = () => { for (const b of [H0, H1, tauB, tA, tB, ctr, outB, ubuf]) b.destroy(); };
    try {
      for (let ci = 0; ci < cluster.length; ci++) {
        const c = cluster[ci], g = grids[ci], { dt, steps } = stepsFor(g.h);
        const N = g.nx * g.ny * g.nz, stride = Math.ceil((g.nx * 4) / 256) * 64;
        device.queue.writeBuffer(ubuf, 0, new Float32Array([
          g.nx, g.ny, g.nz, g.h, g.X, g.Y, dt, steps, c.s, c.y, c.ang, c.tilt, LL, D, P.rise, P.amb,
          P.alpha, P.T0, P.Tb, P.Lh, P.hb, P.ha, P.a, P.lam, P.fall, P.crust, habit, P.neck, stride, P.rest, P.plunge, 0]));
        const hist = mk(2 * (steps + 2), GPUBufferUsage.COPY_SRC);
        const bg = (a, b) => device.createBindGroup({ layout, entries: [
          { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: a } }, { binding: 2, resource: { buffer: b } },
          { binding: 3, resource: { buffer: tauB } }, { binding: 4, resource: { buffer: ctr } }, { binding: 5, resource: { buffer: hist } },
          { binding: 6, resource: { buffer: tA } }, { binding: 7, resource: { buffer: tB } }, { binding: 8, resource: { buffer: outB } }] });
        const g01 = bg(H0, H1), g10 = bg(H1, H0);
        const nwg = Math.ceil(N / 64), wx = Math.min(nwg, 65535), wy = Math.ceil(nwg / 65535);
        device.queue.writeBuffer(ctr, 0, new Uint32Array(g.ny + 12));
        {
          const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
          p.setPipeline(pipes.init); p.setBindGroup(0, g01); p.dispatchWorkgroups(wx, wy); p.end();
          device.queue.submit([enc.finish()]);
        }
        const CH = Math.max(20, Math.floor(4e8 / N)); // (des lots d'environ 400 millions de cellules-pas)
        for (let s0 = 0; s0 < steps; s0 += CH) {
          if (cancelled()) return null;
          const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
          for (let s = s0; s < Math.min(steps, s0 + CH); s++) {
            p.setPipeline(pipes.step); p.setBindGroup(0, s % 2 ? g10 : g01); p.dispatchWorkgroups(wx, wy);
            p.setPipeline(pipes.advance); p.dispatchWorkgroups(1);
          }
          p.end(); device.queue.submit([enc.finish()]);
          await device.queue.onSubmittedWorkDone();
          done += N * (Math.min(steps, s0 + CH) - s0);
          onProgress(done / total);
        }
        // le champ, rangé dans l'atlas ; l'historique du tassement, relu
        const rb = device.createBuffer({ size: 2 * (steps + 2) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        {
          const enc = device.createCommandEncoder(); const p = enc.beginComputePass();
          const d3 = [Math.ceil(g.nx / 4), Math.ceil(g.ny / 4), Math.ceil(g.nz / 4)];
          p.setBindGroup(0, g01);
          p.setPipeline(pipes.fill); p.dispatchWorkgroups(...d3);
          for (const e of ['blurAB', 'blurBA', 'blurAB']) { p.setPipeline(pipes[e]); p.dispatchWorkgroups(...d3); }
          p.setPipeline(pipes.bake); p.dispatchWorkgroups(...d3);
          p.end();
          enc.copyBufferToTexture({ buffer: outB, bytesPerRow: stride * 4, rowsPerImage: g.ny }, { texture: tex, origin: [pk.pos[ci][0], 0, pk.pos[ci][1]] }, [g.nx, g.ny, g.nz]);
          enc.copyBufferToBuffer(hist, 0, rb, 0, 2 * (steps + 2) * 4);
          device.queue.submit([enc.finish()]);
        }
        await rb.mapAsync(GPUMapMode.READ);
        const hv = new Float32Array(rb.getMappedRange().slice(0));
        rb.unmap(); rb.destroy(); hist.destroy();
        const drop = new Float32Array(steps + 1), above = new Uint8Array(steps + 1);
        for (let s = 1; s <= steps; s++) { drop[s] = hv[2 * s]; above[s] = hv[2 * s + 1] > 0 ? 1 : 0; }
        above[0] = 1;
        // (le premier instant où il ne reste plus rien au-dessus du bain, et celui où le bloc commence à s'enfoncer)
        let uGone = P.uEnd, uSettle = -1, uPlunge = -1, mx = 0;
        for (let s = 1; s <= steps; s++) { if (!above[s]) { uGone = s * dt; break; } }
        for (let s = 1; s <= steps; s++) { if (drop[s] > 0) { uSettle = s * dt; break; } }
        // (le premier pas où les restes s'effondrent : même règle que le GPU, sur les comptes relus)
        for (let s = 1; s <= steps; s++) { const a = hv[2 * s + 1]; mx = Math.max(mx, a); if (a > 0 && a < P.rest * mx) { uPlunge = s * dt; break; } }
        out.push({ ox: pk.pos[ci][0], oz: pk.pos[ci][1], ...g, dt, steps, drop, uGone, uSettle, uPlunge });
      }
    } finally { free(); }
    atlas?.destroy();
    atlas = tex;
    return { texture: tex, dims: [pk.W, pk.H, pk.D], crystals: out };
  }
  return { simulate, blank, ready };
}
