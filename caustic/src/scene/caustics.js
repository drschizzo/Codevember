// La caustique : la lumière qui traverse la surface et se rassemble au fond.
//
// Méthode de déformation de maillage : un maillage couvre la surface de l'eau
// (un sommet par point de la grille des ondes) ; le vertex shader suit le
// rayon de chaque sommet — incidence (soleil ou lampe), réfraction de Snell
// par la normale de la surface, trajet jusqu'au fond — et place le sommet là
// où le rayon arrive. Chaque triangle porte la lumière qu'il a reçue en haut ;
// étalé sur son aire d'arrivée, il éclaire d'autant plus qu'il s'est resserré.
// Le rapport des aires se lit au pixel par les dérivées écran de la position
// de départ (exact pour des triangles plats) ; les nappes qui se recouvrent
// s'additionnent (mélange additif). Les plis de la caustique sont les lignes
// où les triangles se retournent.
//
// Trois longueurs d'onde (rouge, vert, bleu), chacune avec son indice de
// l'eau : les plis se bordent de franges colorées. Absorption de l'eau sur le
// trajet (Beer-Lambert), facteur de Fresnel à l'entrée, ombre du rebord de la
// cuve. Puis un flou à la taille angulaire de la source (le disque du soleil
// fait 0,53° : un pli a ~2 mm de large à 45 cm sous l'eau).
//
// Les coupes : la même chose à K profondeurs intermédiaires, en une seule
// longueur d'onde, rangées dans un atlas — l'eau légèrement trouble y lit les
// rideaux de lumière (voir water.js).
import * as THREE from 'three/webgpu';
import {
  Fn, storage, positionGeometry, int, float, vec2, vec3, vec4, uniform, normalize, refract, dot, max, min, abs,
  dFdx, dFdy, varyingProperty, texture, uv, exp, clamp, smoothstep, mix, pow, length,
} from 'three/tsl';
import { N_RGB, ABSORB_RGB } from '../optics.js';

export function createCaustics(renderer, waves, { W, D, rim = 0.04, res = 1024, slices = 8, sliceRes = 256, lite = false }) {
  const { N, L, H, fieldAttr } = waves;
  const dx = L / N;
  // la grille de la surface : les points de la grille des ondes dans la cuve
  const i0 = Math.round((L / 2 - W / 2) / dx), nI = Math.round(W / dx);
  const j0 = Math.round((L / 2 - D / 2) / dx), nJ = Math.round(D / dx);
  // le fond (et l'atlas) couvre la cuve : [x0, x0 + W] × [z0, z0 + D]
  const x0 = -W / 2, z0 = -D / 2;

  const F = storage(fieldAttr, 'vec4', N * N).toReadOnly();
  const U = {
    sunDir: uniform(new THREE.Vector3(0, -1, 0)),
    lampPos: uniform(new THREE.Vector3(0, 1, 0)),
    lampMode: uniform(0), // 0 : soleil (direction), 1 : lampe (point)
    cosRef: uniform(1), // soleil : cos de l'incidence (normalise à l'éclairement horizontal)
    lampH: uniform(1), // lampe : hauteur au-dessus de l'eau (normalise à l'éclairement sous la lampe)
    rim: uniform(rim),
    eMax: uniform(60),
    blurTex: uniform(2), // σ du flou, en texels du fond
    blurSlice: uniform(1.5),
    post: uniform(new THREE.Vector4(0, 0, 0, 0)), // poteau qui intercepte la lumière : x, z, rayon, actif
  };

  function grid(step) {
    const nx = Math.floor((nI - 1) / step) + 1, nz = Math.floor((nJ - 1) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = (j * nx + i) * 3; pos[k] = i0 + i * step; pos[k + 1] = j0 + j * step; }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }

  // matériau d'une nappe : indice eta, absorption alpha, profondeur du plan
  // d'arrivée, case de l'atlas [ox, oy, sx, sy] en coordonnées de découpe,
  // canal de sortie
  function splatMaterial({ n2, alpha, depth, tile = [0, 0, 1, 1], mask, texel }) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.depthTest = false; m.depthWrite = false;
    m.transparent = true;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor;
    m.side = THREE.DoubleSide;
    const vSrc = varyingProperty('vec2', 'vSrc');
    const vFlux = varyingProperty('float', 'vFlux');
    m.vertexNode = Fn(() => {
      const I = int(positionGeometry.x), J = int(positionGeometry.y);
      const f = F.element(J.mul(N).add(I));
      const x = positionGeometry.x.add(0.5).mul(dx).sub(L / 2);
      const z = positionGeometry.y.add(0.5).mul(dx).sub(L / 2);
      const P = vec3(x, f.x, z);
      const nU = vec3(f.y.negate(), 1, f.z.negate());
      const n = normalize(nU);
      const toLamp = P.sub(U.lampPos);
      const inc = normalize(mix(U.sunDir, toLamp, U.lampMode));
      const t = refract(inc, n, 1 / n2);
      const s = float(-depth).sub(P.y).div(min(t.y, -1e-4));
      const Fp = P.add(t.mul(s));
      // flux reçu par la facette (par unité d'aire horizontale), normalisé
      const cosI = max(dot(inc.negate(), n), 0);
      const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(cosI), 5)));
      const norm = mix(float(1).div(U.cosRef), U.lampH.mul(U.lampH).div(dot(toLamp, toLamp)), U.lampMode);
      // ombre du rebord : le rayon, remonté jusqu'au haut des parois, doit
      // être passé au-dessus de la cuve
      const up = U.rim.sub(P.y).div(max(inc.y.negate(), 1e-3));
      const Q = P.sub(inc.mul(up));
      const inside = smoothstep(0, 0.004, float(W / 2).sub(abs(Q.x))).mul(smoothstep(0, 0.004, float(D / 2).sub(abs(Q.z))));
      // ombre du poteau (Kármán) : distance de l'axe au segment du rayon dans l'eau
      const a2 = P.xz, b2 = Fp.xz, c2 = U.post.xy, ab = b2.sub(a2);
      const tt = clamp(dot(c2.sub(a2), ab).div(dot(ab, ab).max(1e-12)), 0, 1);
      const dist = length(a2.add(ab.mul(tt)).sub(c2));
      const block = float(1).sub(smoothstep(U.post.z.mul(1.08), U.post.z.mul(0.92), dist).mul(U.post.w));
      // (au-dessus de l'eau aussi : du haut du poteau à la surface)
      const above = U.rim.mul(4).div(max(inc.y.negate(), 1e-3));
      const a3 = P.xz.sub(inc.xz.mul(above)), ab3 = P.xz.sub(a3);
      const t3 = clamp(dot(c2.sub(a3), ab3).div(dot(ab3, ab3).max(1e-12)), 0, 1);
      const block2 = float(1).sub(smoothstep(U.post.z.mul(1.08), U.post.z.mul(0.92), length(a3.add(ab3.mul(t3)).sub(c2))).mul(U.post.w));
      vFlux.assign(max(dot(inc.negate(), nU), 0).mul(float(1).sub(fres)).mul(norm).mul(exp(s.mul(-alpha))).mul(inside).mul(block).mul(block2));
      vSrc.assign(vec2(x, z));
      const u = Fp.x.sub(x0).div(W), v = Fp.z.sub(z0).div(D);
      return vec4(u.mul(2).sub(1).mul(tile[2]).add(tile[0]), v.mul(2).sub(1).mul(tile[3]).add(tile[1]), 0, 1);
    })();
    m.colorNode = Fn(() => {
      const a = abs(dFdx(vSrc.x).mul(dFdy(vSrc.y)).sub(dFdx(vSrc.y).mul(dFdy(vSrc.x))));
      const E = min(vFlux.mul(a).div(texel), U.eMax);
      return vec4(mask[0], mask[1], mask[2], mask[3]).mul(E);
    })();
    return m;
  }

  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter };
  const resX = res, resZ = Math.round((res * D) / W);
  const raw = new THREE.RenderTarget(resX, resZ, rtOpts);
  const tmp = new THREE.RenderTarget(resX, resZ, rtOpts);
  const floorRT = new THREE.RenderTarget(resX, resZ, rtOpts);
  // atlas des coupes : cols × rows cases de sliceRes
  const cols = 4, rows = Math.ceil(slices / cols);
  const aW = cols * sliceRes, aH = rows * Math.round((sliceRes * D) / W);
  const atlasRaw = new THREE.RenderTarget(aW, aH, rtOpts);
  const atlasTmp = new THREE.RenderTarget(aW, aH, rtOpts);
  const atlasRT = new THREE.RenderTarget(aW, aH, rtOpts);

  const cam = new THREE.OrthographicCamera();
  const fullGrid = grid(lite ? 2 : 1);
  const coarse = grid(lite ? 4 : 2);
  const floorScene = new THREE.Scene();
  const texelFloor = (W / resX) * (D / resZ);
  const chans = lite ? [[1, 1, 1, 0]] : [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  chans.forEach((mask, c) => {
    const k = lite ? 1 : c;
    const mesh = new THREE.Mesh(fullGrid, splatMaterial({ n2: N_RGB[k], alpha: lite ? 0.06 : ABSORB_RGB[k], depth: H, mask, texel: texelFloor }));
    mesh.frustumCulled = false;
    floorScene.add(mesh);
  });
  const sliceScene = new THREE.Scene();
  const sliceDepths = [];
  const texelSlice = (W / sliceRes) * (D / Math.round((sliceRes * D) / W));
  for (let k = 0; k < slices; k++) {
    const d = (H * (k + 1)) / slices;
    sliceDepths.push(d);
    const cx = k % cols, cy = Math.floor(k / cols);
    // case (cx, cy) : centre et demi-taille en coordonnées de découpe
    const tile = [-1 + (2 * cx + 1) / cols, -1 + (2 * cy + 1) / rows, 1 / cols, 1 / rows];
    const mesh = new THREE.Mesh(coarse, splatMaterial({ n2: N_RGB[1], alpha: ABSORB_RGB[1], depth: d, tile, mask: [1, 1, 1, 0], texel: texelSlice }));
    mesh.frustumCulled = false;
    sliceScene.add(mesh);
  }

  // flou gaussien séparable (σ en texels), en deux passes
  function blurMaterial(src, dir, sigma, size) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.depthTest = false; m.depthWrite = false;
    m.colorNode = Fn(() => {
      const t = texture(src.texture);
      const st = vec2(dir[0] / size[0], dir[1] / size[1]);
      const sg = max(sigma, 0.35);
      let acc = vec4(0), wsum = float(0);
      for (let i = -8; i <= 8; i++) {
        // (prélèvement à i·σ/4 : 17 prélèvements couvrent ±2σ)
        const w = Math.exp(-((i / 4) ** 2) / 2);
        acc = acc.add(t.sample(uv().add(st.mul(sg.mul(i / 4)))).mul(w));
        wsum = wsum.add(w);
      }
      return acc.div(wsum);
    })();
    return m;
  }
  // lumière du fond très adoucie (128², σ ≈ 3 cm) : la source du rebond sur
  // les parois — un rebond diffus ne doit pas recopier le dessin
  const lowN = 128, lowZ = Math.round((lowN * D) / W);
  const lowA = new THREE.RenderTarget(lowN, lowZ, rtOpts), lowB = new THREE.RenderTarget(lowN, lowZ, rtOpts);
  const sig = (v) => float(v);
  const quads = {
    l1: new THREE.QuadMesh(blurMaterial(floorRT, [1, 0], sig(12), [resX, resZ])),
    l2: new THREE.QuadMesh(blurMaterial(lowA, [0, 1], sig(6), [lowN, lowZ])),
    l3: new THREE.QuadMesh(blurMaterial(lowB, [1, 0], sig(6), [lowN, lowZ])),
    l4: new THREE.QuadMesh(blurMaterial(lowA, [0, 1], sig(6), [lowN, lowZ])),
    fh: new THREE.QuadMesh(blurMaterial(raw, [1, 0], U.blurTex, [resX, resZ])),
    fv: new THREE.QuadMesh(blurMaterial(tmp, [0, 1], U.blurTex, [resX, resZ])),
    sh: new THREE.QuadMesh(blurMaterial(atlasRaw, [1, 0], U.blurSlice, [aW, aH])),
    sv: new THREE.QuadMesh(blurMaterial(atlasTmp, [0, 1], U.blurSlice, [aW, aH])),
  };

  const clear = new THREE.Color(0, 0, 0);
  function render() {
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setClearColor(clear, 0);
    renderer.setRenderTarget(raw); renderer.clear(); renderer.render(floorScene, cam);
    renderer.setRenderTarget(tmp); quads.fh.render(renderer);
    renderer.setRenderTarget(floorRT); quads.fv.render(renderer);
    renderer.setRenderTarget(lowA); quads.l1.render(renderer);
    renderer.setRenderTarget(lowB); quads.l2.render(renderer);
    renderer.setRenderTarget(lowA); quads.l3.render(renderer);
    renderer.setRenderTarget(lowB); quads.l4.render(renderer);
    if (slices) {
      renderer.setRenderTarget(atlasRaw); renderer.clear(); renderer.render(sliceScene, cam);
      renderer.setRenderTarget(atlasTmp); quads.sh.render(renderer);
      renderer.setRenderTarget(atlasRT); quads.sv.render(renderer);
    }
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
  }

  // ── Lecture dans les matériaux de la scène (positions en mètres) ──
  const floorTex = texture(floorRT.texture);
  // éclairement relatif au fond (1 = eau plane, soleil au zénith)
  const floorAt = (xz) => floorTex.sample(vec2(xz.x.sub(x0).div(W), xz.y.sub(z0).div(D))).level(0).rgb;
  const lowTex = texture(lowB.texture);
  // éclairement du fond, très adouci (rebond)
  const floorSoftAt = (x, z) => lowTex.sample(vec2(clamp(x.sub(x0).div(W), 0, 1), clamp(z.sub(z0).div(D), 0, 1))).level(0).rgb;
  const atlasTex = texture(atlasRT.texture);
  // éclairement relatif dans l'eau au point (x, y, z), y ∈ [−H, 0]
  const sliceAt = Fn(([p]) => {
    const fk = clamp(p.y.negate().div(H).mul(slices).sub(1), 0, slices - 1.001);
    const k0 = fk.floor(), t = fk.sub(k0);
    const u = clamp(p.x.sub(x0).div(W), 0.002, 0.998), v = clamp(p.z.sub(z0).div(D), 0.002, 0.998);
    const tileUV = (k) => vec2(k.mod(cols).add(u).div(cols), k.div(cols).floor().add(v).div(rows));
    // (niveau 0 explicite : lu dans des branches et le long de rayons
    // réfractés, un niveau de mip implicite serait tiré au hasard)
    const a = atlasTex.sample(tileUV(k0)).level(0).r, b = atlasTex.sample(tileUV(k0.add(1).min(slices - 1))).level(0).r;
    // au-dessus de la première coupe : vers l'éclairement à la surface (≈ 1)
    const top = smoothstep(0, H / slices, p.y.negate());
    return mix(float(1), mix(a, b, t), top);
  });

  return {
    U, render, floorRT, atlasRT, floorAt, floorSoftAt, sliceAt, sliceDepths, region: [x0, z0, W, D], res: [resX, resZ],
    // réglages de la source : sun = { dir } | lamp = { pos }, taille angulaire
    // (rad) de la source → flou au fond et dans les coupes
    setLight(light, angular) {
      if (light.kind === 'sun') {
        const d = new THREE.Vector3(...light.dir).normalize();
        U.sunDir.value.copy(d); U.lampMode.value = 0; U.cosRef.value = Math.max(0.05, -d.y);
      } else {
        U.lampPos.value.set(...light.pos); U.lampMode.value = 1; U.lampH.value = light.pos[1];
      }
      const pathTex = (H * Math.tan(angular)) / (W / resX);
      U.blurTex.value = Math.max(0.6, pathTex * 0.5);
      U.blurSlice.value = Math.max(0.8, ((H * 0.5 * Math.tan(angular)) / (W / sliceRes)) * 0.5 + 0.6);
    },
    dispose() { for (const r of [raw, tmp, floorRT, atlasRaw, atlasTmp, atlasRT, lowA, lowB]) r.dispose(); fullGrid.dispose(); coarse.dispose(); },
  };
}
