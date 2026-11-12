// Les spores à l'écran : des dizaines de milliers de grains de 10 µm, chacun un
// petit carré tourné vers la caméra, posé par la trajectoire de gen/spores.js
// réécrite ici en TSL (même formule ; test/spores.test.mjs vérifie l'accord).
// Un grain est plus petit qu'un pixel : sa taille à l'écran est bornée à un
// demi-pixel et son opacité réduite d'autant (sa couverture réelle), si bien
// que le nuage se lit comme une fumée dont la densité est juste. Éclairé par la
// diffusion vers l'avant (Henyey-Greenstein, g = 0,6) : le nuage s'allume à
// contre-jour. Posés, ils poudrent le bois ; le plasmodium qui passe les
// absorbe (ils germent).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, float, vec2, vec3, vec4, texture, positionLocal, positionPrevious, cameraPosition, cameraViewMatrix, modelViewMatrix,
  normalize, mix, smoothstep, clamp, sin, exp, positionWorld, max as tmax, min as tmin, abs, varying, color, length, dot, uv, select, cross,
} from 'three/tsl';
import { isLite, stableVelocity } from './materials.js';
import { SEC, WTAB } from '../gen/spores.js';
import { T as TL } from '../timeline.js';
import { toHalf } from '../gen/half.js';

const sst = (a, b, x) => smoothstep(float(a), float(b), x);

export function createSpores(ctx) {
  const { S, U, Wn, Tat, inBox, R, sp, lite } = ctx;
  const Sd = S.spores, n = Sd.count;
  const dustColor = color(new THREE.Color(sp.colors.ripe)).mul(0.9);
  if (!n) return { meshes: [], update() {}, dustAt: () => float(0), dustColor };
  // table du vent intégré (1D)
  // (demi-flottants : une texture float32 n'est pas échantillonnable par un
  // échantillonneur filtrant en WebGPU — la pipeline serait invalide, sans bruit)
  const wt = new THREE.DataTexture(toHalf(Sd.wind), WTAB.n, 1, THREE.RedFormat, THREE.HalfFloatType);
  wt.magFilter = wt.minFilter = THREE.NearestFilter; wt.needsUpdate = true;
  const windAt = (s) => {
    const f = clamp(s.sub(WTAB.s0).div(WTAB.s1 - WTAB.s0).mul(WTAB.n - 1), 0, WTAB.n - 1.001);
    const i = f.floor(), t = f.sub(i);
    const a = texture(wt, vec2(i.add(0.5).div(WTAB.n), 0.5)).level(0).x, b = texture(wt, vec2(i.add(1.5).div(WTAB.n), 0.5)).level(0).x;
    return mix(a, b, t);
  };
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [k, a] of [['s0', Sd.a0], ['s1', Sd.a1], ['s2', Sd.a2], ['s3', Sd.a3]]) g.setAttribute(k, new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
  const A0 = attribute('s0', 'vec4'), A1 = attribute('s1', 'vec4'), A2 = attribute('s2', 'vec4'), A3 = attribute('s3', 'vec4');
  const pxSize = uniform(0.001); // (taille d'un pixel à 1 cm de la caméra, cm)
  const vA = varying(float(0), 'vA'), vUv = varying(vec2(0), 'vUv'), vLanded = varying(float(0), 'vLanded');

  // trajectoire (gen/spores.js : flight) ; s : phase du site
  const flight = (s) => {
    const sr = A0.w, tau = tmax(s.sub(sr).mul(SEC), 0);
    const a = float(1).sub(exp(tau.div(-1.2))), tl = A1.w, ramp = tl.greaterThan(0).select(tmin(tau.div(tl), 1), float(0));
    return vec3(
      A0.x.add(windAt(s).sub(windAt(sr))).add(A1.z.mul(a).mul(sin(tau.mul(1.3).add(A2.x)))).add(A3.x.mul(ramp)),
      A0.y.add(A1.x.mul(float(1).sub(exp(tau.div(-0.8))))).sub(A1.y.mul(tau)).add(A1.z.mul(0.5).mul(a).mul(sin(tau.mul(1.7).add(A2.z)))),
      A0.z.add(A1.z.mul(a).mul(sin(tau.mul(0.9).add(A2.y)))).add(A3.y.mul(ramp)),
    );
  };
  // pose d'une spore à la phase s : en vol, posée (sur le bois), ou cachée
  const place = (s, write) => {
    const sl = A2.w, landed = s.greaterThanEqual(sl);
    const fp = flight(tmin(s, sl));
    const xw = fp.x.add(U.xoff);
    const yl = Wn.height(xw, fp.z).add(0.0006);
    const p = vec3(xw, landed.select(yl, tmax(fp.y, yl)), fp.z);
    // présence : partie (s ≥ s_r) ; posée sur le site suivant, absorbée par
    // son plasmodium (il germe là) ; disparue avec l'usure de son site
    const born = s.greaterThan(A0.w);
    const xn = fp.x.sub(ctx.L), Tn = Tat(xn, fp.z, true);
    const eaten = landed.and(inBox(xn, fp.z)).and(Tn.lessThan(s.sub(1)));
    const fade = float(1).sub(sst(1.45, 1.75, s));
    const alive = born.and(eaten.not()).select(fade, float(0));
    if (write) { vLanded.assign(landed.select(1, 0)); }
    return { p, alive };
  };
  const quad = (s, write) => {
    const { p, alive } = place(s, write);
    // une particule est une bouffée de spores qui s'étale en vol (diffusion :
    // rayon ∝ √τ) et pâlit d'autant (densité ∝ 1/r²) ; posée, c'est un grain
    // de poussière (au moins un demi-pixel, opacité = sa couverture réelle)
    const toCam = cameraPosition.sub(p), d = length(toCam);
    const tau = tmax(tmin(s, A2.w).sub(A0.w).mul(SEC), 0);
    const puff = float(0.0035).add(float(0.022).mul(float(1).sub(exp(tau.div(-2.2)))).mul(A3.z.mul(0.8).add(0.6)));
    const landed2 = s.greaterThanEqual(A2.w);
    // (posées : une pincée de poudre de 60 µm, peu couvrante — 30 000 pincées poudrent le bois)
    const sizeReal = landed2.select(float(0.007).mul(A3.z.mul(0.6).add(0.7)), puff);
    const sizePx = pxSize.mul(d).mul(0.6);
    const size = tmax(sizeReal, sizePx).mul(alive.greaterThan(0.001).select(1, 0));
    const dens = landed2.select(float(0.16), float(0.0035).div(puff).pow(2).mul(0.85).add(0.06));
    if (write) vA.assign(alive.mul(dens).mul(sizeReal.div(tmax(sizeReal, sizePx)).pow(2)));
    const f = normalize(toCam), right = normalize(cross(vec3(0, 1, 0), f)), up = cross(f, right);
    return p.add(right.mul(positionLocal.x.mul(size))).add(up.mul(positionLocal.y.mul(size)));
  };
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.positionNode = Fn(() => { const q = quad(U.s, true); vUv.assign(positionLocal.xy); if (!isLite()) positionPrevious.assign(quad(U.sPrev, false)); return q; })();
  // éclairage : diffusion d'un grain (albédo du pigment) + diffusion vers l'avant
  const sunDir = uniform(new THREE.Vector3(0, 1, 0)), sunCol = uniform(new THREE.Color()), amb = uniform(new THREE.Color());
  const base = color(new THREE.Color(sp.colors.ripe)).mul(0.8).add(0.05);
  const v = normalize(cameraPosition.sub(positionWorld));
  const cosT = dot(sunDir, v.negate()), gg = 0.6;
  const hg = float((1 - gg * gg) / (4 * Math.PI)).div(float(1 + gg * gg).sub(cosT.mul(2 * gg)).pow(1.5));
  // (en vol : diffusion vers l'avant ; posée : une poudre mate)
  m.colorNode = base.mul(amb.add(sunCol.mul(vLanded.greaterThan(0.5).select(float(0.3), hg.mul(6).add(0.25)))));
  const disc = exp(length(vUv).pow(2).mul(-3.2)).sub(0.04).max(0);
  m.opacityNode = vA.mul(disc).mul(0.95);
  m.mrtNode = stableVelocity();
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 5;

  return {
    meshes: [mesh],
    dustColor,
    // poudre déposée (point local) : densité des spores posées autour du point — approchée
    // par une bande sous le vent du site, ombrée par l'arrivée du plasmodium suivant
    dustAt: (x, z) => {
      const s = U.s;
      const land = sst(TL.release[0] + 0.05, 1.0, s);
      const xn = x.sub(ctx.L), Tn = Tat(xn, z);
      const eaten = inBox(xn, z).and(Tn.lessThan(s.sub(1))).select(0, 1);
      const band = sst(0.4, 2.0, x).mul(sst(ctx.L + 1.6, ctx.L + 0.2, x)).mul(sst(1.1, 0.2, abs(z.sub(R.plasmodium.territory[1]))));
      return band.mul(land).mul(eaten).mul(float(1).sub(sst(1.4, 1.8, s))).mul(0.18);
    },
    update(s, camera) {
      const h = camera.isPerspectiveCamera ? 2 * Math.tan((camera.fov * Math.PI) / 360) : 1;
      const px = (globalThis.innerHeight || 800) * Math.min(globalThis.devicePixelRatio || 1, 1.5);
      pxSize.value = h / px;
      const st = ctx.stage;
      if (st) { sunDir.value.copy(st.sunDir); sunCol.value.copy(st.sunCol); amb.value.copy(st.amb); }
    },
    dispose() { wt.dispose(); },
  };
}
