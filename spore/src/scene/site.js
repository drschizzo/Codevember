// Un site montré : la nappe et les veines du plasmodium, les sporanges, les
// spores. Deux vues partagent les mêmes données (le site est périodique) : le
// présent (décalage 0, phase u) et le passé (décalage −L, phase u + 1).
import * as THREE from 'three/webgpu';
import { uniform, float, vec2, texture, smoothstep, clamp } from 'three/tsl';
import { createPlasmodium } from './plasmodium.js';
import { createSporangia } from './sporangia.js';
import { createSmoke, smokeTextures } from './smoke.js';
import { woodNodes } from './wood.js';

export function sheetTexture(S) {
  const t = new THREE.DataTexture(S.sheet.TH, S.sheet.Gx, S.sheet.Gz, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
export function edgeTexture(S) {
  const t = new THREE.DataTexture(S.edges.texH, S.edges.K, S.edges.rows, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
const shared = new WeakMap(); // (textures partagées par les deux vues d'un même site)

export function createSiteView({ R, sp, S, wood, off, lite, light }) {
  if (!shared.has(S)) shared.set(S, { sheet: sheetTexture(S), edges: edgeTexture(S), smoke: smokeTextures(S.smoke), n: 0 });
  const TX = shared.get(S); TX.n++;
  const L = R.site.L;
  const U = { s: uniform(0), sPrev: uniform(0), xoff: uniform(off * L) };
  const Wn = woodNodes(wood);
  // T (instant d'arrivée du plasmodium) au point local (x, z) ; 9 hors du territoire
  const Sh = S.sheet;
  const tUV = (x, z) => vec2(x.sub(Sh.x0).div(Sh.h).add(0.5).div(Sh.Gx), z.sub(Sh.z0).div(Sh.h).add(0.5).div(Sh.Gz));
  const inBox = (x, z) => x.greaterThan(Sh.x0).and(x.lessThan(Sh.x0 + Sh.h * (Sh.Gx - 1))).and(z.greaterThan(Sh.z0)).and(z.lessThan(Sh.z0 + Sh.h * (Sh.Gz - 1)));
  const Tat = (x, z, level = false) => { const t = texture(TX.sheet, tUV(x, z)); return (level ? t.level(0) : t).x; };
  const ctx = { R, sp, S, U, Wn, wood, Tat, inBox, TX, lite, off, L, stage: light };
  const plas = createPlasmodium(ctx);
  const spor = sp.head ? createSporangia(ctx) : null;
  const spores = createSmoke(ctx);
  const meshes = [...plas.meshes, ...(spor ? spor.meshes : []), ...spores.meshes];
  const vol = spores.volume;
  return {
    U, meshes, volume: vol,
    // (le volume de fumée va dans sa scène à lui, gv : passe à demi-résolution)
    attach: (g, gv) => { meshes.forEach((m) => g.add(m)); gv.add(vol); },
    dispose(g, gv) {
      for (const m of meshes) { g.remove(m); m.material.dispose(); }
      gv.remove(vol); vol.material.dispose();
      plas.dispose?.(); spor?.dispose?.(); spores.dispose?.();
      if (--TX.n === 0) { TX.sheet.dispose(); TX.edges.dispose(); TX.smoke.dep.dispose(); TX.smoke.pos.dispose(); shared.delete(S); }
    },
    update(ph, camera) {
      U.sPrev.value = U.s.value;
      U.s.value = ph - off;
      plas.update?.(U.s.value);
      spor?.update(U.s.value, ph);
      spores.update?.(U.s.value, camera);
    },
    // mouillure du bois au point MONDE (x, z) : la trace du plasmodium
    trailAt: (x, z) => plas.trailAt(x.sub(U.xoff), z),
    dustAt: (x, z) => spores.dustAt(x.sub(U.xoff), z),
    dustLook: (at) => ({ color: spores.dustColor, at }),
  };
}
