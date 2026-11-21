// Les fumées et l'air chaud : un volume de gaz qui monte des surfaces chaudes,
// éclairé par le soleil, le ciel et, par dessous, par la lave elle-même ; et
// l'air qui tremble au-dessus d'elle.
//
// Marche de rayon dans la passe d'image (crochet `overlay` de la chaîne
// commune, avant l'anticrénelage temporel qui lisse le tramage), dans une
// tranche d'air de 2 m au-dessus du champ. La source : la carte de lueur du
// champ (field.js), floutée — ce qui est chaud fume. Le bruit monte d'un nombre
// entier de périodes du volume par boucle : la fumée boucle aussi.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, screenUV, screenCoordinate, normalize, dot, mix, max, min, clamp, exp, smoothstep,
  fract, sin, perspectiveDepthToViewZ, floor, step, abs,
} from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';

const Y0 = -0.45, Y1 = 1.7;

export function createFumes(field, { lite = false } = {}) {
  const U = {
    camPos: uniform(new THREE.Vector3()), camWorld: uniform(new THREE.Matrix4()), projInv: uniform(new THREE.Matrix4()),
    near: uniform(0.03), far: uniform(60),
    rise: uniform(0), // (montée du bruit, en cellules : multiple de 4 par boucle)
    sun: uniform(new THREE.Vector3(0, 1, 0)), sunCol: uniform(new THREE.Color(1, 1, 1)), skyCol: uniform(new THREE.Color(1, 1, 1)),
    dens: uniform(1.2), vog: uniform(0), rain: uniform(0), heat: uniform(1), shimmer: uniform(1), wind: uniform(new THREE.Vector2(0.15, -0.05)),
  };
  const lum = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

  // densité au point p (m⁻¹) ; g = lueur au sol sous p (radiance)
  const density = (p) => {
    const y = p.y;
    const base = vec2(p.x, p.z).sub(U.wind.mul(max(y, 0)));
    const g = field.glowAt(base, 6);
    const src = float(1).sub(exp(lum(g).mul(-1.5)));
    const q = vec3(p.x.mul(1.7), y.mul(1.2).sub(U.rise), p.z.mul(1.7));
    const n = NZ(q).x.mul(0.65).add(NZ(q.mul(2).add(vec3(1.7, 0, 3.1))).y.mul(0.35));
    const plume = src.mul(exp(y.mul(-1.6))).mul(smoothstep(-0.25, 0.35, n));
    const veil = U.vog.mul(smoothstep(-0.5, 0.4, n.add(0.15))).mul(exp(y.mul(-0.6)));
    return [plume.mul(U.dens).add(veil), g];
  };

  const overlay = (color, { depth, scenePass }) => Fn(() => {
    const N = lite ? 8 : 16;
    const dz = depth.sample(screenUV).r;
    const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1));
    const far = U.projInv.mul(vec4(ndc, 1, 1));
    const vdir = normalize(far.xyz.div(far.w));
    const ro = U.camPos, rd = normalize(U.camWorld.mul(vec4(vdir, 0)).xyz);
    const tScene = perspectiveDepthToViewZ(dz, U.near, U.far).div(vdir.z);
    // tranche d'air [Y0, Y1]
    const ry = rd.y.abs().max(1e-4).mul(rd.y.lessThan(0).select(float(-1), float(1)));
    const tA = float(Y1).sub(ro.y).div(ry), tB = float(Y0).sub(ro.y).div(ry);
    const t0 = max(min(tA, tB), 0), t1 = min(max(tA, tB), tScene).min(12);
    const len = max(t1.sub(t0), 0), dt = len.div(N);
    const j = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189).add(G.frame.mul(0.618034)));
    // fonction de phase (Henyey-Greenstein, vers l'avant)
    const cosV = dot(rd, U.sun), g0 = 0.55;
    const phase = float(1 - g0 * g0).div(float(1 + g0 * g0).sub(cosV.mul(2 * g0)).pow(1.5)).mul(0.6).add(0.4);
    const tr = float(1).toVar(), scat = vec3(0).toVar();
    for (let i = 0; i < N; i++) {
      const t = t0.add(dt.mul(j.add(i)));
      const p = ro.add(rd.mul(t));
      const [d, g] = density(p);
      const a = d.mul(dt);
      const y = max(p.y, 0);
      // lumière : soleil (diffusion vers l'avant), ciel, et la lave par dessous
      const under = field.glowAt(vec2(p.x, p.z), clamp(y.mul(6).add(3), 3, 7)).mul(exp(y.mul(-1.2))).mul(0.9);
      const Li = vec3(U.sunCol).mul(phase).add(vec3(U.skyCol)).add(under).mul(vec3(0.93, 0.97, 1.04));
      scat.addAssign(Li.mul(a).mul(tr));
      tr.mulAssign(exp(a.negate()));
      void g;
    }
    // l'air chaud tremble : la scène est relue un peu décalée au-dessus de la
    // lave (amplitude selon la lueur sous le point vu, fréquence entière par boucle)
    let base = color.rgb;
    if (!lite && scenePass) {
      const hit = ro.add(rd.mul(min(tScene, 30)));
      const hg = lum(field.glowAt(vec2(hit.x, hit.z), 4));
      const amp = float(1).sub(exp(hg.mul(-1.5))).mul(U.shimmer).mul(0.0018);
      const ph = G.phase.mul(Math.PI * 2 * 40);
      const off = vec2(sin(screenUV.y.mul(90).add(ph)).add(NZ(vec3(screenUV.mul(14), G.phase.mul(8))).x), sin(screenUV.x.mul(70).sub(ph.mul(0.75))).mul(0.5)).mul(amp);
      const tex = scenePass.getTextureNode('output');
      base = base.add(tex.sample(screenUV.add(off)).rgb.sub(tex.sample(screenUV).rgb));
    }
    // la pluie : des traits fins, à deux profondeurs, qui tombent d'un nombre
    // entier d'écrans par boucle (la boucle reste parfaite), éclairés par le ciel
    // et, près du sol, par la lave
    let rain = vec3(0);
    if (!lite) {
      for (const [cols, rows, sp, k] of [[260, 9, 23, 1], [150, 6, 15, 0.6]]) {
        const q = vec2(screenUV.x.mul(cols), screenUV.y.mul(rows).sub(G.phase.mul(sp * rows)));
        const cell = floor(q), f = fract(q);
        const hsh = fract(sin(cell.x.mul(127.1).add(cell.y.mul(311.7))).mul(43758.5453));
        const off = fract(hsh.mul(17.31)).mul(0.6).add(0.2);
        const line = smoothstep(0.09, 0, abs(f.x.sub(off))).mul(smoothstep(0, 0.35, f.y)).mul(smoothstep(1, 0.75, f.y)).mul(step(0.72, hsh));
        rain = rain.add(vec3(U.skyCol).mul(0.05).add(field.glowAt(vec2(ro.x, ro.z), 6).mul(0.02)).mul(line).mul(k));
      }
      rain = rain.mul(U.rain);
    }
    return vec4(base.mul(tr).add(scat).add(rain), color.a);
  })();

  // caméra de la scène (dans une passe plein écran, les nœuds « caméra »
  // désignent la caméra du quad : voir three-tsl-pitfalls)
  function update(camera, R, u, TL) {
    camera.updateMatrixWorld();
    U.camPos.value.copy(camera.position);
    U.camWorld.value.copy(camera.matrixWorld);
    U.projInv.value.copy(camera.projectionMatrixInverse);
    U.near.value = camera.near; U.far.value = camera.far;
    // le bruit monte de 4 × m cellules par boucle (le volume est périodique de 4)
    const f = u - Math.floor(u);
    const m = 6, a = 0.15; // (plus vite pendant l'accéléré : une part de la montée suit la vitesse du film)
    const w = TL ? (TL.tau(u) - TL.tau(Math.floor(u))) / R.loop.P : f;
    U.rise.value = 4 * m * ((1 - a) * f + a * w);
    const S = R.sun, el = S.el, az = S.az;
    U.sun.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    U.sunCol.value.set(S.color).multiplyScalar(S.klux / Math.PI * 0.6);
    const z = R.sky.zenith, h = R.sky.horizon;
    U.skyCol.value.setRGB((z[0] + h[0]) * 0.5, (z[1] + h[1]) * 0.5, (z[2] + h[2]) * 0.5);
    U.dens.value = R.fumes?.dens ?? 1.2;
    U.vog.value = R.fumes?.vog ?? 0;
    U.rain.value = R.look?.wet ?? 0;
  }
  return { U, overlay, update };
}
