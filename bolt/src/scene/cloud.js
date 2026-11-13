// La vapeur et le nuage : UN volume, lu dans la simulation du panache
// (gen/plume.js : une texture 3D (r, z, temps) du traceur) et marché dans la
// chaîne d'image, après la passe de scène, avant l'anticrénelage temporel qui
// lisse le tramage.
//
// La simulation est axisymétrique et lisse. Le rendu lui rend le désordre d'un
// vrai panache sans toucher à sa dynamique : les coordonnées de lecture sont
// déformées par un bruit qui dérive (les volutes), puis la densité est érodée
// par deux échelles de Worley inversé (les bourgeons, d'après Schneider,
// « The real-time volumetric cloudscapes of Horizon Zero Dawn »). La colonne
// de vapeur et le nuage passent par la même fonction : il n'y a pas de couture.
//
// Sous le niveau de condensation (z = 1), le traceur est en partie invisible
// (c'est encore de la vapeur) : la base du nuage est plate.
//
// Lumière : deux prélèvements vers la lampe (loi de Beer), une ambiance qui
// fonce quand le nuage se charge, et les éclairs comme sources ponctuelles à
// l'intérieur (le nuage devient une lanterne).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, uniformArray, vec2, vec3, vec4, float, screenUV, screenCoordinate, perspectiveDepthToViewZ, texture3D,
  normalize, length, dot, exp, sqrt, smoothstep, mix, min as tMin, max as tMax, fract, clamp, step,
} from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export const N_LIGHTS = 6;

export function createCloud() {
  const U = {
    c: uniform(new THREE.Vector3(0, 1.8, 0)),      // centre de la base (le niveau de condensation)
    R: uniform(1), H: uniform(0.9),
    shred: uniform(0), dark: uniform(0), dens: uniform(1),
    tint: uniform(new THREE.Color('#ffffff')), shade: uniform(new THREE.Color('#556070')), amb: uniform(0.5),
    sun: uniform(new THREE.Vector3(0.5, 0.7, 0.3)), sunCol: uniform(new THREE.Color('#ffffff')),
    drift: uniform(0), seed: uniform(0), frame: uniform(0),
    steamP: uniform(new THREE.Vector3(0, 0.5, 0)), span: uniform(1), kr: uniform(0.6),
    simT: uniform(0), simSize: uniform(new THREE.Vector3(1.6, 1.7, 72)), // étendue (r, z) de la simulation, nombre d'images
    lights: uniformArray(Array.from({ length: N_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'), // xyz, intensité
    lcol: uniform(new THREE.Color('#bcd0ff')),
    camPos: uniform(new THREE.Vector3()), camWorld: uniform(new THREE.Matrix4()), projInv: uniform(new THREE.Matrix4()), near: uniform(0.05), far: uniform(80),
  };

  // la simulation : texture 3D (r, z, temps), remplacée à chaque scène
  const blank = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2);
  blank.format = THREE.RedFormat; blank.needsUpdate = true;
  const sim = texture3D(blank);
  function setSimulation(P) {
    const t = new THREE.Data3DTexture(P.frames, P.NR, P.NZ, P.NF);
    t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    const old = sim.value;
    sim.value = t;
    old?.dispose();
    U.simSize.value.set(P.NR * P.DX, P.NZ * P.DX, P.NF);
  }

  // densité au point p (monde) : la vapeur et le nuage, un seul champ
  // (fine = false : pour les prélèvements vers la lampe — ni volutes ni petite
  // échelle de bourgeons, deux lectures de texture au lieu de quatre)
  const density = (p, fine = true) => {
    const z0 = p.y.sub(U.steamP.y).div(U.span);
    // l'axe du panache : de la source (la tasse, le bec) à l'aplomb du nuage
    const ctr = mix(U.steamP.xz, U.c.xz, smoothstep(0, 0.85, z0));
    const o = vec3(U.seed, U.drift, U.seed.mul(1.7));
    // volutes : la lecture est déformée par un bruit lent, davantage dans le nuage
    const wn = fine ? NZ(p.mul(1.15).add(o)).level(0) : vec4(0);
    const amt = smoothstep(0.02, 0.6, z0).mul(0.7).add(0.3);
    const r = length(p.xz.sub(ctr).add(wn.xy.mul(0.16).mul(amt).mul(U.span))).div(U.span.mul(U.kr));
    const z = z0.add(wn.x.mul(0.07).mul(amt));
    const inside = step(r, U.simSize.x.mul(0.985)).mul(step(0.004, z)).mul(step(z, U.simSize.y.mul(0.995)));
    const tw = U.simT.mul(U.simSize.z.sub(1)).add(0.5).div(U.simSize.z);
    const sv = sim.sample(vec3(r.div(U.simSize.x), z.div(U.simSize.y), tw)).level(0).r;
    // (enregistré en racine carrée : 8 bits suffisent pour les voiles minces ;
    // le plafond du domaine est adouci, sinon le sommet serait une table)
    const env = sv.mul(inside).mul(smoothstep(U.simSize.y, U.simSize.y.sub(0.14), z));
    // bourgeons (Worley inversé, deux échelles) et lambeaux (Perlin)
    const w1 = NZ(p.mul(2.6).add(o)).level(0);
    const fineN = fine ? NZ(p.mul(6.1).add(o.mul(2))).level(0).z.min(1).oneMinus().mul(0.26) : float(0.13);
    const n = w1.z.min(1).oneMinus().mul(0.56).add(fineN).add(w1.x.mul(0.5).add(0.5).mul(0.18));
    // érosion : le champ simulé sert d'enveloppe, le bruit en mange les bords.
    // Plus forte dans la colonne (des volutes, pas un tuyau), sur le pourtour
    // (des lambeaux, pas un mur) et pendant l'averse.
    const col = smoothstep(0.95, 0.55, z);
    const rim = smoothstep(U.R.mul(0.6), U.R.mul(1.08), length(p.xz.sub(U.c.xz)));
    const er = U.shred.mul(0.9).add(0.78).add(col.mul(0.5)).add(rim.mul(0.5));
    // (hors du panache, l'enveloppe est négative : le bruit seul ne crée rien)
    const d = smoothstep(0, 0.22, env.sub(0.2).mul(1.25).add(n.sub(0.72).mul(er)).sub(col.mul(0.1)).sub(rim.mul(0.3)));
    // condensation : sous le niveau z = 1, la vapeur ne se voit qu'en partie
    const cond = smoothstep(0.8, 1.03, z).mul(0.7).add(0.3);
    // (la colonne est plus légère que le nuage : c'est dans la densité, continue
    // en hauteur — et non dans le coefficient d'extinction de chaque marche, qui
    // faisait une ligne à leur couture)
    const light = smoothstep(0.5, 1.0, z).mul(0.45).add(0.55);
    return d.mul(cond).mul(light).mul(U.dens).mul(U.shred.oneMinus().pow(0.6));
  };

  // intersection rayon / boîte alignée (bmin, bmax) → vec2(t0, t1)
  const slab = (ro, rd, bmin, bmax) => {
    const inv = vec3(1).div(rd);
    const a = bmin.sub(ro).mul(inv), b = bmax.sub(ro).mul(inv);
    const lo = tMin(a, b), hi = tMax(a, b);
    return vec2(tMax(tMax(lo.x, lo.y), lo.z).max(0), tMin(tMin(hi.x, hi.y), hi.z));
  };

  // haze(depth, lite, rgb) → rgb vu à travers le nuage et la vapeur
  const haze = (depthTex, lite, rgb) => Fn(() => {
    const N = lite ? 14 : 36, NS = lite ? 6 : 12;
    // rayon de la caméra et distance du premier obstacle. Deux pièges : dans
    // une passe plein écran, les nœuds « caméra » de three.js (cameraPosition,
    // cameraWorldMatrix…) désignent la caméra du quad, pas celle de la scène —
    // elle est donc passée par des uniformes ; et getViewPosition suppose une
    // profondeur OpenGL.
    const dz = depthTex.sample(screenUV).r;
    const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1));
    const far = U.projInv.mul(vec4(ndc, 1, 1));
    const vdir = normalize(far.xyz.div(far.w));
    const ro = U.camPos, rd = normalize(U.camWorld.mul(vec4(vdir, 0)).xyz);
    const tScene = perspectiveDepthToViewZ(dz, U.near, U.far).div(vdir.z);
    // tramage entrelacé (Jimenez), renouvelé à chaque image : le TRAA le lisse
    const j = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189).add(U.frame.mul(0.618034)));
    const col = vec3(rgb).toVar();

    // lumière d'un point du volume
    const shade = (p, d, col) => {
      const d2 = lite ? d.mul(0.6) : density(p.add(U.sun.mul(0.14)), false).add(density(p.add(U.sun.mul(0.36)), false));
      const Tl = exp(d2.mul(-1.9));
      const yn = p.y.sub(U.c.y).div(U.H).clamp(0, 1);
      // corps : de l'ombre (claire sur un cumulus, d'ardoise quand il se charge)
      // à la face éclairée ; « poudre » : un voile mince diffuse peu
      const sh = mix(U.tint.mul(0.72), U.shade, U.dark.mul(0.8).add(0.2)).mul(yn.mul(0.4).add(0.6));
      const litc = U.tint.mul(U.sunCol).mul(U.dark.mul(0.25).oneMinus()).mul(1.2);
      const powder = exp(d.mul(-7)).oneMinus();
      col.assign(mix(sh, litc, Tl.mul(powder.mul(0.75).add(0.25))).mul(U.amb));
      for (let k = 0; k < N_LIGHTS; k++) { // les éclairs, de l'intérieur
        const Lk = U.lights.element(k), v = Lk.xyz.sub(p);
        col.addAssign(U.lcol.mul(Lk.w.div(dot(v, v).mul(14).add(1))));
      }
    };
    const march = (bmin, bmax, steps, sigma) => {
      const tc = slab(ro, rd, bmin, bmax);
      const t0 = tc.x, t1 = tMin(tc.y, tScene);
      If(t1.greaterThan(t0).and(U.shred.lessThan(0.999)), () => {
        const dt = t1.sub(t0).div(steps);
        const T = float(1).toVar(), L = vec3(0).toVar();
        Loop(steps, ({ i }) => {
          const p = ro.add(rd.mul(t0.add(dt.mul(float(i).add(j)))));
          const d = density(p);
          If(d.greaterThan(0.004).and(T.greaterThan(0.01)), () => {
            const c = vec3(0).toVar();
            shade(p, d, c);
            const a = exp(d.mul(dt).mul(-sigma)).oneMinus();
            L.addAssign(c.mul(a).mul(T));
            T.mulAssign(a.oneMinus());
          });
        });
        col.assign(col.mul(T).add(L));
      });
    };
    // deux domaines de marche pour un même champ : la colonne (étroite, sous le
    // nuage), puis le nuage (large). La couture est à 0,72 de la montée, dans
    // la colonne : les deux côtés lisent la même densité.
    const top = U.steamP.y.add(U.simSize.y.mul(U.span)).add(0.03), cut = U.steamP.y.add(U.span.mul(0.62));
    const rc = U.span.mul(U.kr).mul(0.62).add(0.12);
    const lo = tMin(U.steamP.xz, U.c.xz).sub(rc), hi = tMax(U.steamP.xz, U.c.xz).add(rc);
    march(vec3(lo.x, U.steamP.y, lo.y), vec3(hi.x, cut, hi.y), NS, 13);
    const ext = U.R.mul(1.12);
    march(vec3(U.c.x.sub(ext), cut, U.c.z.sub(ext)), vec3(U.c.x.add(ext), top, U.c.z.add(ext)), N, 13);
    return clamp(col, 0, 1e4);
  })();

  return { U, haze, setSimulation };
}
