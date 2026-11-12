// Le nuage à l'écran (gen/smoke.js le calcule) :
//
// 1. Le volume : une boîte (faces arrière) où chaque pixel marche le long de
//    son rayon, de l'entrée dans la boîte jusqu'à la sortie ou jusqu'à la
//    surface opaque la plus proche (profondeur de la scène). La densité vient
//    de deux images enregistrées, interpolées AVEC COMPENSATION DE MOUVEMENT :
//    chacune est lue au point où la vitesse enregistrée amène (ou ramène) la
//    fumée à l'instant voulu, si bien qu'entre deux images la fumée glisse au
//    lieu de se fondre. Un bruit de détail (le volume de bruit périodique,
//    entraîné par le vent) érode les bords : des volutes plus fines que la
//    grille. Lumière : diffusion simple, fonction de phase de Henyey-Greenstein
//    (g = 0,55 : la fumée s'allume à contre-jour), transmission vers le soleil
//    précalculée par image (ombre propre du nuage), ambiance du lieu ;
//    absorption de Beer-Lambert.
// 2. Les grains : des milliers de spores portées par le même champ de vitesse
//    (positions enregistrées, relues en Catmull-Rom) ; posés, une poudre.
// 3. La poussière déposée : la carte de dépôt cumulée, lue par le bois.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, float, vec2, vec3, vec4, ivec2, int, texture3D, textureLoad, attribute, positionWorld, positionLocal, positionPrevious,
  cameraPosition, cameraNear, cameraFar, normalize, mix, smoothstep, clamp, exp, max as tmax, min as tmin, abs, dot, length, varying, color,
  screenUV, viewportDepthTexture, perspectiveDepthToViewZ, cameraViewMatrix, instanceIndex, cross, fract, sin, screenCoordinate, uint, hash, select,
} from 'three/tsl';
import { NZ, isLite, stableVelocity } from './materials.js';
import { G } from './globals.js';
import { SMOKE } from '../gen/smoke.js';

const sst = (a, b, x) => smoothstep(float(a), float(b), x);

export function smokeTextures(Sm) {
  const D = Sm.domain, N = D.nx * D.ny * D.nz;
  const mk = () => {
    const t = new THREE.Data3DTexture(new Uint8Array(N * 4), D.nx, D.ny, D.nz);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  };
  const dep = new THREE.Data3DTexture(Sm.depH, D.nx, D.nz, Sm.frames);
  dep.format = THREE.RedFormat; dep.type = THREE.HalfFloatType; dep.minFilter = dep.magFilter = THREE.LinearFilter; dep.unpackAlignment = 2; dep.needsUpdate = true;
  const G2 = Sm.grains;
  const pos = new THREE.DataTexture(G2.posH, G2.n, Sm.frames, THREE.RGBAFormat, THREE.HalfFloatType);
  pos.minFilter = pos.magFilter = THREE.NearestFilter; pos.needsUpdate = true;
  return { mk, dep, pos, N };
}

export function createSmoke(ctx) {
  const { S, U, Wn, Tat, inBox, R, sp, lite, L } = ctx;
  const Sm = S.smoke, D = Sm.domain, F = Sm.frames, N = D.nx * D.ny * D.nz;
  const TX = ctx.TX.smoke;
  const A = TX.mk(), B = TX.mk();
  const fd = (SMOKE.s1 - SMOKE.s0) / (F - 1);
  const uFrac = uniform(0), uOn = uniform(0);
  const uBmin = uniform(new THREE.Vector3()), uBmax = uniform(new THREE.Vector3()); // (boîte serrée de l'image)
  const light = ctx.stage;
  const uSun = uniform(new THREE.Vector3(0, 1, 0)), uSunCol = uniform(new THREE.Color()), uAmb = uniform(new THREE.Color());
  // (un nuage de spores diffuse beaucoup : son albédo est clair, teinté par le pigment)
  const albedo = mix(color(new THREE.Color(sp.colors.ripe)), vec3(0.85, 0.8, 0.72), 0.45);
  const bmin = vec3(D.x0, D.y0, D.z0), bsize = vec3(D.x1 - D.x0, D.y1 - D.y0, D.z1 - D.z0);
  const dtFrame = fd * SMOKE.sec; // (secondes entre deux images)

  // ── 1. le volume ──
  // (un cube unité, posé et étiré à chaque image sur la boîte serrée du nuage)
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const vm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide });
  vm.fog = false;
  const steps = lite ? 14 : 22;
  const march = Fn(() => {
    // rayon dans le repère du site
    const off = vec3(U.xoff, 0, 0);
    const ro = cameraPosition.sub(off), rd = normalize(positionWorld.sub(cameraPosition));
    const inv = vec3(1).div(rd);
    const t0v = uBmin.sub(ro).mul(inv), t1v = uBmax.sub(ro).mul(inv);
    const tn = tmin(t0v, t1v), tf = tmax(t0v, t1v);
    const tEnter = tmax(tmax(tn.x, tn.y), tmax(tn.z, 0)), tExit = tmin(tmin(tf.x, tf.y), tf.z);
    // la surface opaque la plus proche (profondeur de la scène)
    const zv = perspectiveDepthToViewZ(viewportDepthTexture(screenUV).x, cameraNear, cameraFar);
    const fwd = normalize(cameraViewMatrix.transpose().mul(vec4(0, 0, -1, 0)).xyz);
    const tDepth = zv.negate().div(tmax(dot(rd, fwd), 0.05));
    const tEnd = tmin(tExit, tDepth);
    const len = tmax(tEnd.sub(tEnter), 0);
    const dt = len.div(steps);
    // départ tramé (renouvelé à chaque image ; l'anticrénelage temporel le lisse)
    // (sans anticrénelage temporel — mobile —, une trame fixe entrelacée : pas de fourmillement)
    const jit = isLite()
      ? fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189))
      : hash(screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(4099))).add(G.frame.toUint().mul(uint(7919))));
    const Tr = float(1).toVar(), acc = vec3(0).toVar();
    const cosT = dot(uSun, rd);
    const g = 0.55;
    const hg = float((1 - g * g) / (4 * Math.PI)).div(float(1 + g * g).sub(cosT.mul(2 * g)).pow(1.5)).mul(4 * Math.PI);
    Loop(steps, ({ i }) => {
      If(Tr.greaterThan(0.01), () => {
        const t = tEnter.add(i.toFloat().add(jit).mul(dt));
        const p = ro.add(rd.mul(t));
        const uvw = p.sub(bmin).div(bsize);
        // compensation de mouvement : la vitesse (enregistrée) amène la fumée
        const ca = texture3D(A, uvw), vel = vec3(ca.z.sub(0.502).mul(255 / 40), ca.w.sub(0.502).mul(255 / 40), 0);
        const da = texture3D(A, uvw.sub(vel.mul(uFrac.mul(dtFrame)).div(bsize)));
        const db = texture3D(B, uvw.add(vel.mul(float(1).sub(uFrac).mul(dtFrame)).div(bsize)));
        const rho = mix(da.x.mul(da.x), db.x.mul(db.x), uFrac);
        const tl = mix(da.y, db.y, uFrac);
        // détail : érosion par le volume de bruit, entraîné par le vent
        // (deux octaves : des volutes de ~1 mm et des filaments de ~0,3 mm)
        const nz = NZ(p.mul(9).sub(vec3(U.s.mul(32), 0, 0)));
        const n = nz.x.mul(0.65).add(nz.y.mul(0.35));
        const d = tmax(rho.mul(float(0.9).add(n.mul(2.2))).sub(rho.mul(0.25).add(0.012)), 0);
        const sigma = d.mul(30);
        const a = exp(sigma.mul(dt).negate());
        // simple diffusion (soleil, ombre propre) + diffusion multiple approchée (ambiance, renforcée dans le nuage)
        const Li = uSunCol.mul(hg.mul(tl).add(tl.mul(0.25).add(0.08))).add(uAmb.mul(2.2));
        acc.addAssign(Tr.mul(float(1).sub(a)).mul(Li.mul(albedo)));
        Tr.mulAssign(a);
      });
    });
    const alpha = float(1).sub(Tr).mul(uOn);
    return vec4(acc.div(tmax(float(1).sub(Tr), 1e-4)), alpha);
  });
  const out = march();
  vm.colorNode = out.xyz;
  vm.opacityNode = out.w;
  const vol = new THREE.Mesh(box, vm);
  vol.frustumCulled = false; vol.renderOrder = 10;

  // ── 2. les grains ──
  const GR = Sm.grains, n = GR.count;
  const gg = new THREE.InstancedBufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  gg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  gg.setIndex([0, 1, 2, 0, 2, 3]);
  const gi = new Float32Array(Math.max(1, n) * 4);
  for (let i = 0; i < n; i++) gi.set([GR.born[i], GR.land[i], GR.corr[i * 2], GR.corr[i * 2 + 1]], i * 4);
  gg.setAttribute('gi', new THREE.InstancedBufferAttribute(gi, 4));
  gg.instanceCount = n;
  gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
  const Ai = attribute('gi', 'vec4');
  const pxSize = uniform(0.001);
  const vA = varying(float(0), 'vGA'), vUv = varying(vec2(0), 'vGUv'), vLand = varying(float(0), 'vGLand');
  const at = (s) => {
    const f = clamp(s.sub(SMOKE.s0).div(fd), 0, F - 1.001), k = f.floor(), t = f.sub(k);
    const ld = (dk) => textureLoad(TX.pos, ivec2(instanceIndex.toInt(), int(clamp(k.add(dk), 0, F - 1)))).xyz;
    const p0 = ld(-1), p1 = ld(0), p2 = ld(1), p3 = ld(2);
    const t2 = t.mul(t), t3 = t2.mul(t);
    const cr = p1.mul(2).add(p2.sub(p0).mul(t)).add(p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3).mul(t2)).add(p3.sub(p0).add(p1.mul(3)).sub(p2.mul(3)).mul(t3)).mul(0.5);
    const ramp = clamp(s.sub(Ai.x).div(tmax(Ai.y.sub(Ai.x), 1e-3)), 0, 1);
    return cr.add(vec3(Ai.z, 0, Ai.w).mul(ramp));
  };
  const quad = (s, write) => {
    const q = at(s);
    const xw = q.x.add(U.xoff);
    const landed = s.greaterThanEqual(Ai.y);
    const yl = Wn.height(xw, q.z).add(0.0006);
    const p = vec3(xw, landed.select(yl, tmax(q.y, yl)), q.z);
    const born = s.greaterThan(Ai.x).and(s.lessThan(SMOKE.s1 + 0.6));
    const xn = q.x.sub(L), eaten = landed.and(inBox(xn, q.z)).and(Tat(xn, q.z, true).lessThan(s.sub(1)));
    const alive = born.and(eaten.not()).select(float(1).sub(sst(1.45, 1.75, s)), float(0));
    const toCam = cameraPosition.sub(p), dd = length(toCam);
    const sizeReal = float(0.0011), sizePx = pxSize.mul(dd).mul(0.7);
    const size = tmax(sizeReal, sizePx).mul(alive.greaterThan(0.001).select(1, 0));
    if (write) { vA.assign(alive.mul(sizeReal.div(tmax(sizeReal, sizePx)).pow(2)).mul(landed.select(0.5, 1))); vLand.assign(landed.select(1, 0)); }
    const fw = normalize(toCam), right = normalize(cross(vec3(0, 1, 0), fw)), up = cross(fw, right);
    return p.add(right.mul(positionLocal.x.mul(size))).add(up.mul(positionLocal.y.mul(size)));
  };
  const gm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  gm.positionNode = Fn(() => { const q = quad(U.s, true); vUv.assign(positionLocal.xy); if (!isLite()) positionPrevious.assign(quad(U.sPrev, false)); return q; })();
  const cosG = dot(uSun, normalize(positionWorld.sub(cameraPosition)));
  const hgG = float(0.0716).div(float(1.3025).sub(cosG.mul(1.1)).pow(1.5)).mul(4 * Math.PI);
  gm.colorNode = albedo.mul(uAmb.add(uSunCol.mul(vLand.greaterThan(0.5).select(float(0.3), hgG.mul(0.8).add(0.2)))));
  gm.opacityNode = vA.mul(smoothstep(1, 0.3, length(vUv)));
  gm.mrtNode = stableVelocity();
  const grains = new THREE.Mesh(gg, gm);
  grains.frustumCulled = false; grains.renderOrder = 9;

  let kCur = -1;
  const dustColor = albedo.mul(0.85);
  return {
    meshes: [vol, grains],
    dustColor,
    // poudre déposée (point local) : la carte de dépôt cumulée à la phase du site
    dustAt: (x, z) => {
      const s = U.s;
      const f = clamp(s.sub(SMOKE.s0).div(SMOKE.s1 - SMOKE.s0), 0, 1).mul((F - 1) / F).add(0.5 / F);
      const uv = vec3(x.sub(D.x0).div(D.x1 - D.x0), z.sub(D.z0).div(D.z1 - D.z0), f);
      const inside = uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1)).and(s.greaterThan(SMOKE.s0));
      const dep = texture3D(TX.dep, uv).x;
      // le plasmodium suivant l'absorbe en passant (il germe là) ; le temps l'efface
      const xn = x.sub(L), eaten = inBox(xn, z).and(Tat(xn, z).lessThan(s.sub(1)));
      const cover = float(1).sub(exp(dep.max(0).sqrt().mul(-3.2)));
      return inside.and(eaten.not()).select(cover.mul(float(1).sub(sst(1.45, 1.8, s))).mul(0.8), float(0));
    },
    update(s, camera) {
      const h = 2 * Math.tan((camera.fov * Math.PI) / 360);
      pxSize.value = h / ((globalThis.innerHeight || 800) * Math.min(globalThis.devicePixelRatio || 1, 1.5));
      if (light) { uSun.value.copy(light.sunDir).normalize(); uSunCol.value.copy(light.sunCol); uAmb.value.copy(light.amb); }
      // images du nuage (k, k + 1) : recopiées seulement quand k change
      const on = s > SMOKE.s0 && s < SMOKE.s1;
      uOn.value = on ? 1 - Math.max(0, Math.min(1, (s - (SMOKE.s1 - 0.04)) / 0.04)) : 0;
      vol.visible = false;
      if (!on) return;
      const f = Math.min(F - 1.0001, Math.max(0, (s - SMOKE.s0) / fd)), k = Math.floor(f);
      uFrac.value = f - k;
      if (k !== kCur) {
        kCur = k;
        // boîte serrée : union des images k et k + 1, élargie d'une marge (le mouvement, le bruit)
        const bb = Sm.bbox, h = D.h, m = 3;
        const fr = [k, k + 1].filter((q) => bb[q * 6 + 3] >= 0);
        const empty = fr.length === 0;
        const lo = [0, 1, 2].map((j) => Math.min(...fr.map((q) => bb[q * 6 + j]), 1e9)), hi = [0, 1, 2].map((j) => Math.max(...fr.map((q) => bb[q * 6 + 3 + j]), -1));
        const o = [D.x0, D.y0, D.z0], n = [D.nx, D.ny, D.nz];
        const mn = lo.map((v, j) => o[j] + Math.max(0, v - m) * h), mx = hi.map((v, j) => o[j] + Math.min(n[j], v + 1 + m) * h);
        uBmin.value.set(...mn); uBmax.value.set(...mx);
        vol.position.set(mn[0] + ctx.U.xoff.value, mn[1], mn[2]); vol.scale.set(Math.max(1e-3, mx[0] - mn[0]), Math.max(1e-3, mx[1] - mn[1]), Math.max(1e-3, mx[2] - mn[2]));
        vol.userData.empty = empty;
        A.image.data.set(Sm.rec.subarray(k * N * 4, (k + 1) * N * 4)); A.needsUpdate = true;
        B.image.data.set(Sm.rec.subarray((k + 1) * N * 4, (k + 2) * N * 4)); B.needsUpdate = true;
      }
      vol.visible = !vol.userData.empty;
    },
    dispose() { A.dispose(); B.dispose(); },
  };
}
