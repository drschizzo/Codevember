// Sonde « planche des passes » (tools/passes.mjs), injectée avant tout script de la page.
// __passes.capture() suit une image entière : chaque passe de rendu ou de calcul, dans
// l'ordre, avec ses cibles, ses dessins, la pile qui l'a lancée et, pour chaque cible,
// une vignette de ce qu'elle contient à la fin de la passe.
//
// Vignettes : à la fin d'une passe, une petite passe ajoutée dans le même encodeur
// réduit la cible (moyenne 4 × 4 lectures) vers une texture rgba32float, copiée dans un
// tampon lu après l'envoi. Les valeurs brutes décident ensuite de l'affichage (profondeur
// étirée, lumière tonemappée, vitesses en couleurs). Les textures de rendu reçoivent pour
// cela l'usage TEXTURE_BINDING dès leur création (rien d'autre ne change).
(() => {
  if (!self.GPUDevice || self.__passes) return;
  Error.stackTraceLimit = 60;
  const TW = 512; // largeur des vignettes (affichées plus petites, agrandies au clic)
  const S = self.__passes = { device: null, tex: new WeakMap(), views: new WeakMap(), on: false, list: [], open: new Map(), maps: new Map(), pending: [], errors: [] };
  // (three imbrique les rendus : une passe s'ouvre, d'autres s'ouvrent et se ferment avant
  // ses dessins ; chaque passe ouverte est suivie à part, et rangée à sa fermeture)
  const wrap = (proto, name, fn) => { const o = proto[name]; if (o) proto[name] = function (...a) { return fn.call(this, o, a); }; };
  const isDepth = (f) => /^depth|stencil8$/.test(f);
  const isInt = (f) => /int$/.test(f) && !/norm/.test(f);

  wrap(GPUAdapter.prototype, 'requestDevice', function (o, a) { return o.apply(this, a).then((d) => { if (!S.device) { S.device = d; d.addEventListener('uncapturederror', (e) => S.errors.push('GPU : ' + e.error.message.split('\n')[0])); } return d; }); });
  let texId = 0;
  wrap(GPUDevice.prototype, 'createTexture', function (o, a) {
    const d = a[0];
    if (d.usage & (GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING) && !isInt(d.format) && d.format !== 'stencil8') a = [{ ...d, usage: d.usage | GPUTextureUsage.TEXTURE_BINDING }];
    const t = o.apply(this, a), s = d.size;
    S.tex.set(t, { w: s.width ?? s[0], h: s.height ?? s[1] ?? 1, l: s.depthOrArrayLayers ?? s[2] ?? 1, f: d.format, ms: d.sampleCount ?? 1, dim: d.dimension ?? '2d', label: d.label ?? '', storage: !!(d.usage & GPUTextureUsage.STORAGE_BINDING), id: ++texId });
    return t;
  });
  wrap(GPUCanvasContext.prototype, 'configure', function (o, a) { return o.call(this, { ...a[0], usage: (a[0].usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.TEXTURE_BINDING }); });
  wrap(GPUCanvasContext.prototype, 'getCurrentTexture', function (o, a) {
    const t = o.apply(this, a);
    if (!S.tex.has(t)) S.tex.set(t, { w: t.width, h: t.height, l: 1, f: t.format, ms: 1, dim: '2d', label: 'écran', screen: true, id: ++texId });
    return t;
  });
  wrap(GPUTexture.prototype, 'createView', function (o, a) { const v = o.apply(this, a); S.views.set(v, { t: this, d: { ...(a[0] ?? {}) } }); /* (copie : three réutilise l'objet descripteur) */ return v; });

  // (les textures qu'un calcul peut écrire : vues liées en storage dans ses bind groups)
  const bgViews = new WeakMap(), bgReads = new WeakMap();
  wrap(GPUDevice.prototype, 'createBindGroup', function (o, a) {
    const g = o.apply(this, a);
    const all = (a[0].entries ?? []).map((e) => e.resource).filter((r) => r && S.views.has(r));
    const vs = all.filter((r) => S.tex.get(S.views.get(r).t)?.storage);
    if (vs.length) bgViews.set(g, vs);
    if (all.length) bgReads.set(g, all.map((r) => S.tex.get(S.views.get(r).t)?.id).filter(Boolean));
    return g;
  });
  // (les textures qu'une passe lit : de quoi dire, pour une étape intermédiaire, qui s'en sert)
  for (const proto of [GPURenderPassEncoder.prototype, GPUComputePassEncoder.prototype]) wrap(proto, 'setBindGroup', function (o, a) {
    const c = S.open.get(this), ids = a[1] && bgReads.get(a[1]);
    if (c && ids) for (const id of ids) if (!c.reads.includes(id)) c.reads.push(id);
    return o.apply(this, a);
  });
  wrap(GPUComputePassEncoder.prototype, 'setBindGroup', function (o, a) {
    const c = S.open.get(this), vs = a[1] && bgViews.get(a[1]);
    if (c && vs) for (const v of vs) if (!c.views.includes(v)) c.views.push(v);
    return o.apply(this, a);
  });

  // ── la pile : fonctions de three.js et du projet (three non minifié, voir passes.mjs) ──
  const stack = () => (new Error().stack ?? '').split('\n').slice(3).map((l) => {
    const m = l.trim().match(/^at (?:async )?(?:([\w$.<>\[\] ]+?) \()?(?:https?:\/\/[^/]+)?\/?([^?:)]*)[^:)]*:(\d+)/);
    return m ? { fn: m[1] ?? '', file: m[2], line: +m[3] } : null;
  }).filter((f) => f && !/passes-probe|^$/.test(f.file));

  // ── les pipelines de réduction, une par type de texture ──
  const pipes = new Map();
  const SRC = {
    float: ['texture_2d<f32>', (c) => `textureLoad(src, ${c}, lod)`],
    ms: ['texture_multisampled_2d<f32>', (c) => `textureLoad(src, ${c}, 0)`],
    depth: ['texture_depth_2d', (c) => `vec4f(textureLoad(src, ${c}, lod), 0., 0., 1.)`],
    msdepth: ['texture_depth_multisampled_2d', (c) => `vec4f(textureLoad(src, ${c}, 0), 0., 0., 1.)`],
    vol: ['texture_3d<f32>', (c) => `textureLoad(src, vec3i(${c}, i32(U.z)), 0)`], // (une tranche : U.z)
  };
  // (vignettes : demi-flottants pour la couleur, 32 bits pour la profondeur, dont les écarts sont minuscules près de 1)
  const FMT = (kind) => (/depth/.test(kind) ? 'r32float' : 'rgba16float');
  const BPP = (kind) => (/depth/.test(kind) ? 4 : 8);
  function pipe(kind) {
    if (pipes.has(kind)) return pipes.get(kind);
    const dev = S.device, [T, load] = SRC[kind];
    const code = `
      @group(0) @binding(0) var src: ${T};
      @group(0) @binding(1) var<uniform> U: vec4u; // taille source (x, y), tranche (3D), hauteur de la vignette
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2. - 1., 0., 1.);
      }
      @fragment fn fs(@builtin(position) q: vec4f) -> @location(0) vec4f {
        let lod = 0; let o = vec2f(f32(${TW}), f32(U.w));
        var s = vec4f(0.); var n = 0.;
        for (var j = 0; j < 4; j++) { for (var k = 0; k < 4; k++) {
          let uv = (floor(q.xy) + (vec2f(f32(k), f32(j)) + .5) / 4.) / o;
          let c = vec2i(min(uv * vec2f(U.xy), vec2f(U.xy) - 1.));
          let v = ${load('c')};
          if (all(v == v)) { s += v; n += 1.; } // (NaN écartés)
        } }
        return s / max(n, 1.);
      }`;
    const mod = dev.createShaderModule({ code, label: 'passes-probe' });
    // (disposition explicite : 'unfilterable-float' accepte aussi les formats 32 bits flottants)
    const tex = kind === 'vol' ? { sampleType: 'unfilterable-float', viewDimension: '3d' } : kind === 'float' ? { sampleType: 'unfilterable-float' } : kind === 'ms' ? { sampleType: 'unfilterable-float', multisampled: true } : kind === 'depth' ? { sampleType: 'depth' } : { sampleType: 'depth', multisampled: true };
    const bgl = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: tex }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const p = dev.createRenderPipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [bgl] }), vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: FMT(kind) }] }, label: 'passes-probe' });
    p.bgl = bgl; pipes.set(kind, p); return p;
  }
  // réduit `view` (une cible de passe) dans l'encodeur, après la passe ; rend la description
  function thumb(enc, view, slice = 0) {
    const v = S.views.get(view), e = v && S.tex.get(v.t);
    if (!e || isInt(e.f) || e.f === 'stencil8' || e.dim === '1d') return null;
    const vol = e.dim === '3d';
    const mip = v.d.baseMipLevel ?? 0, layer = vol ? slice : v.d.baseArrayLayer ?? 0;
    const w = Math.max(1, e.w >> mip), h = Math.max(1, e.h >> mip);
    const th = Math.max(1, Math.min(TW, Math.round(TW * h / w)));
    const dev = S.device, depth = isDepth(e.f);
    const kind = vol ? 'vol' : e.ms > 1 ? (depth ? 'msdepth' : 'ms') : depth ? 'depth' : 'float';
    const out = dev.createTexture({ size: [TW, th], format: FMT(kind), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, label: 'passes-probe' });
    const src = vol ? v.t.createView({ dimension: '3d', baseMipLevel: mip, mipLevelCount: 1, label: 'passes-probe' })
      : v.t.createView({ dimension: '2d', baseMipLevel: kind === 'float' || kind === 'depth' ? mip : 0, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1, aspect: depth ? 'depth-only' : 'all', label: 'passes-probe' });
    const ub = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'passes-probe' });
    dev.queue.writeBuffer(ub, 0, new Uint32Array([w, h, vol ? slice : 0, th]));
    const p = pipe(kind);
    const bg = dev.createBindGroup({ layout: p.bgl, entries: [{ binding: 0, resource: src }, { binding: 1, resource: { buffer: ub } }] });
    S.inner = true;
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }], label: 'passes-probe' });
    pass.setPipeline(p); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    const rb = dev.createBuffer({ size: TW * BPP(kind) * th, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'passes-probe' });
    enc.copyTextureToBuffer({ texture: out }, { buffer: rb, bytesPerRow: TW * BPP(kind) }, [TW, th]);
    S.inner = false;
    const r = { id: e.id, w: e.w, h: e.h, l: e.l, f: e.f, ms: e.ms, mip, layer, vol, screen: !!e.screen, label: e.label, tw: TW, th, px: BPP(kind), data: null };
    (S.maps.get(enc) ?? S.maps.set(enc, []).get(enc)).push({ rb, r, free: [out, ub] });
    return r;
  }

  wrap(GPUCommandEncoder.prototype, 'beginRenderPass', function (o, a) {
    const pass = o.apply(this, a);
    if (!S.on || S.inner) return pass;
    const d = a[0];
    const col = (d.colorAttachments ?? []).filter(Boolean);
    S.open.set(pass, { kind: 'render', label: d.label ?? '', stack: stack(), draws: 0, tris: 0, reads: [],
      col: col.map((c) => ({ view: c.resolveTarget ?? c.view, load: c.loadOp, slice: c.depthSlice ?? 0 })), depth: d.depthStencilAttachment ? { view: d.depthStencilAttachment.view, load: d.depthStencilAttachment.depthLoadOp } : null,
      enc: this });
    return pass;
  });
  wrap(GPURenderPassEncoder.prototype, 'end', function (o, a) {
    const r = o.apply(this, a), c = S.open.get(this);
    if (c) {
      S.open.delete(this);
      c.loads = c.col.map((x) => x.load).concat(c.depth ? [c.depth.load] : []);
      // (une vignette qui échoue ne doit pas casser le rendu de la page)
      const safe = (v, sl) => { try { return thumb(c.enc, v, sl); } catch (e) { S.errors.push(String(e.message ?? e)); S.inner = false; return null; } };
      c.targets = c.col.map((x) => safe(x.view, x.slice)).filter(Boolean);
      if (c.depth) { const t = safe(c.depth.view); if (t) { t.depth = true; c.targets.push(t); } }
      delete c.col; delete c.depth; delete c.enc; c.i = S.list.length; S.list.push(c);
    }
    return r;
  });
  wrap(GPUCommandEncoder.prototype, 'beginComputePass', function (o, a) {
    const pass = o.apply(this, a);
    if (S.on && !S.inner) S.open.set(pass, { kind: 'compute', label: a[0]?.label ?? '', stack: stack(), dispatch: 0, groups: 0, targets: [], views: [], reads: [], enc: this });
    return pass;
  });
  wrap(GPUComputePassEncoder.prototype, 'end', function (o, a) {
    const r = o.apply(this, a), c = S.open.get(this);
    if (c) {
      S.open.delete(this);
      // vignettes des textures liées en écriture (une 3D : sa tranche du milieu)
      for (const v of c.views.slice(0, 4)) {
        const e = S.tex.get(S.views.get(v).t);
        try { const t = thumb(c.enc, v, e.dim === '3d' ? e.l >> 1 : 0); if (t) { t.storage = true; c.targets.push(t); } } catch (err) { S.errors.push(String(err.message ?? err)); S.inner = false; }
      }
      delete c.views; delete c.enc; c.i = S.list.length; S.list.push(c);
    }
    return r;
  });
  for (const n of ['copyTextureToTexture', 'copyBufferToTexture']) wrap(GPUCommandEncoder.prototype, n, function (o, a) {
    if (S.on && !S.inner) {
      const dst = a[1].texture, e = S.tex.get(dst), src = n === 'copyTextureToTexture' ? S.tex.get(a[0].texture) : null;
      S.list.push({ kind: 'copy', i: S.list.length, stack: stack(), what: `${src ? `${src.w}×${src.h} ${src.f}${src.screen ? ' (écran)' : ''}` : 'tampon'} → ${e ? `${e.w}×${e.h} ${e.f}` : '?'}`, targets: [] });
    }
    return o.apply(this, a);
  });
  for (const proto of [GPURenderPassEncoder.prototype]) {
    for (const n of ['draw', 'drawIndexed']) wrap(proto, n, function (o, a) { const c = S.open.get(this); if (c) { c.draws++; c.tris += (a[0] * (a[1] ?? 1)) / 3; } return o.apply(this, a); });
    for (const n of ['drawIndirect', 'drawIndexedIndirect', 'executeBundles']) wrap(proto, n, function (o, a) { const c = S.open.get(this); if (c) c.draws++; return o.apply(this, a); });
  }
  wrap(GPUComputePassEncoder.prototype, 'dispatchWorkgroups', function (o, a) { const c = S.open.get(this); if (c) { c.dispatch++; c.groups += (a[0] ?? 1) * (a[1] ?? 1) * (a[2] ?? 1); } return o.apply(this, a); });
  // (les tampons de lecture ne se lisent qu'une fois envoyés : on suit encodeur → commandes → envoi)
  const cbs = new WeakMap();
  wrap(GPUCommandEncoder.prototype, 'finish', function (o, a) { const cb = o.apply(this, a); const m = S.maps.get(this); if (m) { cbs.set(cb, m); S.maps.delete(this); } return cb; });
  wrap(GPUQueue.prototype, 'submit', function (o, a) {
    const r = o.apply(this, a);
    for (const cb of a[0] ?? []) for (const m of cbs.get(cb) ?? []) {
      S.pending.push(m.rb.mapAsync(GPUMapMode.READ).catch((e) => { S.errors.push('lecture : ' + (e.message ?? e)); }).then(() => {
        if (m.rb.mapState !== 'mapped') return;
        m.r.data = unpack(m.rb.getMappedRange(), m.r.px); m.rb.unmap(); m.rb.destroy(); m.free.forEach((x) => x.destroy());
      }));
    }
    return r;
  });

  // demi-flottants (couleur) ou 32 bits à un canal (profondeur) → 4 flottants par pixel
  function unpack(buf, px) {
    if (px === 4) { const a = new Float32Array(buf), o = new Float32Array(a.length * 4); for (let i = 0; i < a.length; i++) o[i * 4] = a[i]; return o; }
    const h = new Uint16Array(buf), o = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) {
      const x = h[i], e = (x >> 10) & 31, m = x & 1023, sg = x & 0x8000 ? -1 : 1;
      o[i] = e === 0 ? sg * m * 2 ** -24 : e === 31 ? (m ? NaN : sg * Infinity) : sg * (1 + m / 1024) * 2 ** (e - 15);
    }
    return o;
  }

  // ── affichage : les valeurs brutes décident ──
  // (exposition : une seule pour les images de la scène et du post-traitement, celle de la
  // scène, pour que les vignettes d'une série se comparent ; ailleurs, la médiane de chaque image)
  const exposure = (d, n) => {
    const L = []; for (let i = 0; i < n; i += 7) { const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; if (l > 0 && Number.isFinite(l)) L.push(l); }
    L.sort((a, b) => a - b); return 0.18 / Math.max(L[L.length >> 1] ?? 0.18, 1e-4);
  };
  function show(t, gexpo) {
    const { data: d, tw: W, th: H } = t, n = W * H, px = new Uint8ClampedArray(n * 4);
    const ch = /^(r8|r16|r32|depth)/.test(t.f) ? 1 : /^rg(8|16|32)/.test(t.f) ? 2 : 3;
    const alpha = /^(rgba|bgra)/.test(t.f);
    let mode, lo = Infinity, hi = -Infinity, mx = 0, sum = 0;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = d[i * 4 + c]; if (!Number.isFinite(v)) continue; if (t.depth || ch === 1) { if (v > 0 && v < 1 || !t.depth) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } mx = Math.max(mx, Math.abs(v)); sum += v; }
    const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
    if (t.depth || /^depth/.test(t.f)) mode = 'profondeur';
    else if (ch === 2) mode = 'vecteurs';
    else if (ch === 1) mode = 'valeurs';
    else if (/srgb|unorm|snorm/.test(t.f) && mx <= 1.0001) mode = 'couleur';
    else mode = mx > 1.5 ? 'lumière (HDR)' : 'couleur';
    // exposition : la médiane de luminance ramenée vers 0,18
    let expo = 1;
    if (mode === 'lumière (HDR)') expo = gexpo ?? exposure(d, n);
    let vs = 0; if (mode === 'vecteurs') { const A = []; for (let i = 0; i < n; i += 3) A.push(Math.hypot(d[i * 4], d[i * 4 + 1])); A.sort((a, b) => a - b); vs = A[Math.floor(A.length * 0.98)] || 1; }
    const span = hi > lo ? hi - lo : 1;
    let empty = true;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      let R, G, B;
      if (mode === 'profondeur') { const v = r >= 1 || r <= 0 ? (r >= 1 ? 1 : 0) : (r - lo) / span; const k = Math.pow(1 - v, 0.8) * 255; R = G = B = k; }
      else if (mode === 'valeurs') { const k = ((r - lo) / span) * 255; R = G = B = Number.isFinite(k) ? k : 0; }
      else if (mode === 'vecteurs') { const x = r / vs, y = g / vs; R = (0.5 + 0.5 * x) * 255; G = (0.5 + 0.5 * y) * 255; B = 128 * (1 - Math.min(1, Math.hypot(x, y))) + 64; }
      else if (mode === 'lumière (HDR)') { const f = (x) => { x = Math.max(0, x * expo); return enc(x / (1 + x) * 1.2); }; R = f(r); G = f(g); B = f(b); }
      else { R = enc(Math.max(0, r)); G = enc(Math.max(0, g)); B = enc(Math.max(0, b)); if (t.screen || /srgb/.test(t.f)) { R = r * 255; G = g * 255; B = b * 255; } }
      px[i * 4] = R; px[i * 4 + 1] = G; px[i * 4 + 2] = B; px[i * 4 + 3] = 255;
      if (R > 3 || G > 3 || B > 3) empty = false;
    }
    // (une cible écran est déjà encodée en sRGB par la page, idem pour les formats -srgb ; et
    // textureLoad rend toujours r, g, b dans l'ordre, même d'une texture bgra : pas d'inversion)
    return { px, mode, empty, alpha };
  }
  async function toURL(t, gexpo) {
    const { px, mode, empty } = show(t, gexpo);
    const c = new OffscreenCanvas(t.tw, t.th); c.getContext('2d').putImageData(new ImageData(px, t.tw, t.th), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.82 });
    const url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    return { url, mode, empty };
  }

  // une image entière, d'un rAF au suivant
  S.capture = () => new Promise((res) => {
    requestAnimationFrame(() => {
      S.list = []; S.on = true; // (ce rAF est appelé avant celui de la scène : toute son image est suivie)
      requestAnimationFrame(async () => {
        S.on = false; S.open.clear();
        // (au plus 20 s d'attente des lectures : une lecture perdue ne bloque pas le relevé)
        await Promise.race([Promise.allSettled(S.pending), new Promise((r) => setTimeout(r, 20000))]); S.pending = [];
        const ref = S.list.flatMap((p) => p.targets ?? []).find((t) => t.label === 'output' && t.data);
        const gexpo = ref ? exposure(ref.data, ref.tw * ref.th) : undefined;
        const out = [];
        for (const p of S.list) {
          const targets = [];
          for (const t of p.targets ?? []) {
            if (!t.data) { targets.push({ ...t, data: undefined, url: null }); continue; }
            // (exposition commune : textures nommées par three ou à la taille de l'image ; les
            // textures de données du projet, d'autres tailles, gardent la leur)
            const shared = t.label || (ref && t.w === ref.w && t.h === ref.h);
            const v = await toURL(t, shared ? gexpo : undefined);
            targets.push({ ...t, data: undefined, ...v, ownExpo: !shared || gexpo == null });
          }
          out.push({ ...p, targets });
        }
        res(out);
      });
    });
  });
})();
