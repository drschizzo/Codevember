// Sonde WebGPU injectée avant tout script de la page (tools/stats-runtime.mjs).
// Compte ce que la scène demande au GPU : tampons, textures, shaders, pipelines,
// et, image par image, appels de dessin, triangles, dispatchs et octets envoyés.
(() => {
  if (!self.GPUDevice || self.__probe) return;
  const BPP = {
    r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1, stencil8: 1,
    r16uint: 2, r16sint: 2, r16float: 2, rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2, depth16unorm: 2,
    r32uint: 4, r32sint: 4, r32float: 4, rg16uint: 4, rg16sint: 4, rg16float: 4, rgba8unorm: 4, 'rgba8unorm-srgb': 4,
    rgba8snorm: 4, rgba8uint: 4, rgba8sint: 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgb10a2unorm: 4, rgb10a2uint: 4,
    rg11b10ufloat: 4, rgb9e5ufloat: 4, depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4,
    'depth32float-stencil8': 5, rg32uint: 8, rg32sint: 8, rg32float: 8, rgba16uint: 8, rgba16sint: 8, rgba16float: 8,
    rgba32uint: 16, rgba32sint: 16, rgba32float: 16,
  };
  if (self.__probeStacks) Error.stackTraceLimit = 40;
  const P = self.__probe = {
    adapter: null, t0: performance.now(), firstSubmit: null,
    buf: new Map(), tex: new Map(), bufBytes: 0, texBytes: 0, peakBuf: 0, peakTex: 0,
    bufCreated: 0, texCreated: 0, bufByUsage: {},
    shaders: new Set(), wgslBytes: 0, wgslLines: 0, renderPipelines: 0, computePipelines: 0, bindGroups: 0, samplers: 0,
    stacks: /[?&]stacks\b/.test(self.location?.search ?? '') || self.__probeStacks, big: {}, passFrom: {}, views: new WeakMap(), T: null,
    c: { draws: 0, tris: 0, inst: 0, dispatch: 0, groups: 0, writeBytes: 0, submits: 0, passes: 0, cpasses: 0 },
  };
  const texSize = (d) => {
    const s = d.size, w = s.width ?? s[0], h = s.height ?? s[1] ?? 1, l = s.depthOrArrayLayers ?? s[2] ?? 1;
    const bpp = BPP[d.format] ?? 4, mips = d.mipLevelCount ?? 1, ms = d.sampleCount ?? 1;
    let b = 0, mw = w, mh = h, ml = l;
    const is3d = d.dimension === '3d';
    for (let i = 0; i < mips; i++) { b += mw * mh * ml * bpp; mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); if (is3d) ml = Math.max(1, ml >> 1); }
    return b * ms;
  };
  const wrap = (proto, name, fn) => { const o = proto[name]; if (o) proto[name] = function (...a) { return fn.call(this, o, a); }; };
  const peak = () => { P.peakBuf = Math.max(P.peakBuf, P.bufBytes); P.peakTex = Math.max(P.peakTex, P.texBytes); };
  const usageName = (u) => u & 0x10 ? 'index' : u & 0x20 ? 'vertex' : u & 0x80 ? 'storage' : u & 0x40 ? 'uniform' : u & 0x100 ? 'indirect' : u & 0x8 ? 'readback' : 'other';

  wrap(GPUAdapter.prototype, 'requestDevice', function (o, a) {
    const i = this.info; P.adapter = i ? { vendor: i.vendor, architecture: i.architecture, description: i.description } : null;
    const d = { ...(a[0] ?? {}) };
    if (this.features.has('timestamp-query')) d.requiredFeatures = [...new Set([...(d.requiredFeatures ?? []), 'timestamp-query'])];
    return o.call(this, d).then((dev) => { P.device ??= dev; return dev; });
  });
  wrap(GPUDevice.prototype, 'createBuffer', function (o, a) {
    const b = o.apply(this, a), s = a[0].size;
    P.buf.set(b, s); P.bufBytes += s; P.bufCreated++;
    const k = usageName(a[0].usage); P.bufByUsage[k] = (P.bufByUsage[k] ?? 0) + s; peak(); return b;
  });
  wrap(GPUBuffer.prototype, 'destroy', function (o, a) {
    const s = P.buf.get(this); if (s != null) { P.bufBytes -= s; P.buf.delete(this); } return o.apply(this, a);
  });
  wrap(GPUDevice.prototype, 'createTexture', function (o, a) {
    const t = o.apply(this, a), s = texSize(a[0]);
    const from = P.stacks && s > 1 << 20 ? (new Error().stack ?? '').split('\n').slice(2, 40).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, '').replace(/\?[^:)]*/, '')).filter((l) => !/stats-probe|<anonymous>/.test(l)).slice(0, 6).join(' < ') : undefined;
    P.tex.set(t, { s, f: a[0].format, d: a[0].dimension ?? '2d', w: a[0].size.width ?? a[0].size[0], h: a[0].size.height ?? a[0].size[1] ?? 1, l: a[0].size.depthOrArrayLayers ?? a[0].size[2] ?? 1, ms: a[0].sampleCount ?? 1, mip: a[0].mipLevelCount ?? 1, u: a[0].usage, from }); P.texBytes += s; P.texCreated++; peak(); return t;
  });
  wrap(GPUTexture.prototype, 'createView', function (o, a) { const v = o.apply(this, a); P.views.set(v, this); return v; });
  wrap(GPUTexture.prototype, 'destroy', function (o, a) {
    const e = P.tex.get(this); if (e) { P.texBytes -= e.s; P.tex.delete(this); } return o.apply(this, a);
  });
  wrap(GPUDevice.prototype, 'createShaderModule', function (o, a) {
    const code = a[0].code ?? '';
    if (!P.shaders.has(code)) { P.shaders.add(code); P.wgslBytes += code.length; P.wgslLines += code.split('\n').length; }
    return o.apply(this, a);
  });
  for (const n of ['createRenderPipeline', 'createRenderPipelineAsync']) wrap(GPUDevice.prototype, n, function (o, a) { P.renderPipelines++; return o.apply(this, a); });
  for (const n of ['createComputePipeline', 'createComputePipelineAsync']) wrap(GPUDevice.prototype, n, function (o, a) { P.computePipelines++; return o.apply(this, a); });
  wrap(GPUDevice.prototype, 'createBindGroup', function (o, a) { P.bindGroups++; return o.apply(this, a); });
  wrap(GPUDevice.prototype, 'createSampler', function (o, a) { P.samplers++; return o.apply(this, a); });
  wrap(GPUQueue.prototype, 'submit', function (o, a) {
    P.firstSubmit ??= performance.now(); P.c.submits++;
    const r = o.apply(this, a), T = P.T;
    if (T && T.n) {
      const n = T.n, labels = T.labels; T.n = 0; T.labels = [];
      const dev = P.device, enc = dev.createCommandEncoder();
      const rb = dev.createBuffer({ size: n * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const mb = dev.createBuffer({ size: n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      enc.resolveQuerySet(T.qs, 0, n, rb, 0); enc.copyBufferToBuffer(rb, 0, mb, 0, n * 8);
      o.call(this, [enc.finish()]);
      T.pending++;
      mb.mapAsync(GPUMapMode.READ).then(() => {
        const v = new BigUint64Array(mb.getMappedRange());
        for (let k = 0; k < labels.length; k++) {
          const ms = Number(v[2 * k + 1] - v[2 * k]) / 1e6;
          if (ms >= 0 && ms < 1000) { const e = (T.acc[labels[k]] ??= { ms: 0, n: 0 }); e.ms += ms; e.n++; }
        }
        mb.unmap(); mb.destroy(); rb.destroy(); T.pending--;
      });
    }
    return r;
  });
  wrap(GPUQueue.prototype, 'writeBuffer', function (o, a) {
    const d = a[2], el = d?.BYTES_PER_ELEMENT ?? 1;
    const n = a[4] != null ? a[4] * el : (d?.byteLength ?? 0) - (a[3] ?? 0) * el;
    P.c.writeBytes += n;
    if (n > 262144) { // gros envois : d'où viennent-ils (première ligne de pile hors three)
      const at = (new Error().stack ?? '').split('\n').find((l) => /\/src\/|\/shared\//.test(l))?.trim() ?? '?';
      const k = n + ' o ' + at; P.big[k] = (P.big[k] ?? 0) + 1;
    }
    return o.apply(this, a);
  });
  wrap(GPUQueue.prototype, 'writeTexture', function (o, a) { P.c.writeBytes += a[1]?.byteLength ?? 0; return o.apply(this, a); });
  const tdesc = (v) => { const t = P.views.get(v), e = t && P.tex.get(t); return e ? `${e.w}x${e.h} ${e.f}${e.ms > 1 ? ' ms' + e.ms : ''}` : 'écran'; };
  const stamp = (d, label) => {
    const T = P.T; if (!T || d.timestampWrites || T.n + 2 > T.cap) return d;
    T.labels.push(label); const i = T.n; T.n += 2;
    return { ...d, timestampWrites: { querySet: T.qs, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 } };
  };
  wrap(GPUCommandEncoder.prototype, 'beginRenderPass', function (o, a) {
    P.c.passes++;
    if (!P.T) return o.apply(this, a);
    const d = a[0], col = (d.colorAttachments ?? []).filter(Boolean);
    const label = col.length ? `${col.length > 1 ? col.length + '× ' : ''}${tdesc(col[0].view)}${d.depthStencilAttachment ? ' +z' : ''}` : `profondeur ${tdesc(d.depthStencilAttachment?.view)}`;
    if (P.stacks) { // d'où vient la passe : les fonctions de three.js et du projet sur la pile
      const fn = (new Error().stack ?? '').split('\n').slice(2).map((l) => l.trim().match(/^at (?:async )?([\w$.<>]+)/)?.[1]).filter((n) => n && !/^(Object|Array|Promise|wrap|stamp|<anonymous>)/.test(n)).slice(0, 18).join(' < ');
      const k = label + ' ← ' + fn; P.passFrom[k] = (P.passFrom[k] ?? 0) + 1;
    }
    return o.call(this, stamp(d, label));
  });
  wrap(GPUCommandEncoder.prototype, 'beginComputePass', function (o, a) {
    P.c.cpasses++;
    return P.T ? o.call(this, stamp(a[0] ?? {}, 'calcul')) : o.apply(this, a);
  });
  for (const proto of [GPURenderPassEncoder.prototype, GPURenderBundleEncoder.prototype]) {
    wrap(proto, 'draw', function (o, a) { const i = a[1] ?? 1; P.c.draws++; P.c.inst += i; P.c.tris += (a[0] * i) / 3; return o.apply(this, a); });
    wrap(proto, 'drawIndexed', function (o, a) { const i = a[1] ?? 1; P.c.draws++; P.c.inst += i; P.c.tris += (a[0] * i) / 3; return o.apply(this, a); });
    wrap(proto, 'drawIndirect', function (o, a) { P.c.draws++; return o.apply(this, a); });
    wrap(proto, 'drawIndexedIndirect', function (o, a) { P.c.draws++; return o.apply(this, a); });
  }
  wrap(GPUComputePassEncoder.prototype, 'dispatchWorkgroups', function (o, a) {
    P.c.dispatch++; P.c.groups += (a[0] ?? 1) * (a[1] ?? 1) * (a[2] ?? 1); return o.apply(this, a);
  });
  wrap(GPUComputePassEncoder.prototype, 'dispatchWorkgroupsIndirect', function (o, a) { P.c.dispatch++; return o.apply(this, a); });

  // échantillon : compteurs par image sur `ms` millisecondes (images comptées par rAF)
  P.sample = (ms) => new Promise((res) => {
    const c0 = { ...P.c }, t0 = performance.now(); let frames = 0; const dts = []; let last = t0;
    const tick = (t) => {
      frames++; dts.push(t - last); last = t;
      if (t - t0 < ms) return requestAnimationFrame(tick);
      const d = {}; for (const k in P.c) d[k] = (P.c[k] - c0[k]) / Math.max(1, frames);
      dts.sort((a, b) => a - b);
      res({ frames, ms: t - t0, perFrame: d, frameMs: { median: dts[dts.length >> 1], p95: dts[Math.floor(dts.length * 0.95)] } });
    };
    requestAnimationFrame(tick);
  });
  // temps GPU par passe sur `frames` images (timestamp-query), regroupé par cible
  P.gpuTiming = (frames = 60) => new Promise((res) => {
    const dev = P.device;
    if (!dev || !dev.features.has('timestamp-query')) return res(null);
    const cap = 1024, T = P.T = { qs: dev.createQuerySet({ type: 'timestamp', count: cap }), cap, n: 0, labels: [], acc: {}, pending: 0 };
    let f = 0; P.passFrom = {};
    const tick = () => {
      if (++f < frames) return requestAnimationFrame(tick);
      P.T = null;
      const done = () => {
        if (T.pending) return setTimeout(done, 20);
        const passes = Object.entries(T.acc).map(([k, e]) => ({ pass: k, ms: e.ms / frames, count: e.n / frames })).sort((a, b) => b.ms - a.ms);
        T.qs.destroy();
        const from = Object.entries(P.passFrom).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${(n / frames).toFixed(1)} × ${k}`);
        res({ frames, from, totalMs: passes.reduce((x, p) => x + p.ms, 0), passes });
      };
      done();
    };
    requestAnimationFrame(tick);
  });
  P.report = () => {
    const fmt = {}, dim = {};
    for (const e of P.tex.values()) { fmt[e.f] = (fmt[e.f] ?? 0) + e.s; dim[e.d] = (dim[e.d] ?? 0) + e.s; }
    const liveBufByUsage = {};
    return {
      adapter: P.adapter, firstSubmitMs: P.firstSubmit && P.firstSubmit - P.t0,
      gpu: { bufBytes: P.bufBytes, texBytes: P.texBytes, peakBuf: P.peakBuf, peakTex: P.peakTex,
        liveBuffers: P.buf.size, liveTextures: P.tex.size, bufCreated: P.bufCreated, texCreated: P.texCreated,
        bufCreatedByUsage: P.bufByUsage, texByFormat: fmt, texByDim: dim },
      shaders: { modules: P.shaders.size, wgslBytes: P.wgslBytes, wgslLines: P.wgslLines,
        renderPipelines: P.renderPipelines, computePipelines: P.computePipelines, bindGroups: P.bindGroups, samplers: P.samplers },
      bigWrites: P.big,
      texList: [...P.tex.values()].filter((e) => e.s > 1 << 20).sort((a, b) => b.s - a.s).map((e) => `${e.w}x${e.h}x${e.l} ${e.f}${e.ms > 1 ? ' ms' + e.ms : ''}${e.mip > 1 ? ' mip' + e.mip : ''} ${(e.s / 1048576).toFixed(1)}${e.from ? ' ← ' + e.from : ''}`),
      heap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null,
    };
  };
})();
