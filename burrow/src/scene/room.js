// Le sol (la table) et le mur : des matières calculées, dans le repère du monde.
// La table et le mur suivent la caméra (ils sont invariants en x) ; leur motif,
// lui, est accroché au monde, et se répète exactement tous les PERIOD = M·L
// (12 unités) : la boucle se referme. Le volume de bruit commun a une période
// de 4 ; on le lit à l'échelle f/3 (f entier), périodique de 12 en x.
//
// Sols : parquet (lames décalées, fil du bois, joints), dalles de pierre
// (joints, teinte par dalle, mouchetis), zinc (joints debout, brossé, patine),
// granito (éclats dans un ciment). Mur : plâtre (marbrures lentes, grain).
import * as THREE from 'three/webgpu';
import { uniform, vec2, vec3, float, positionWorld, mix, smoothstep, floor as tFloor, fract, min, sin, length, select, mod, normalViewGeometry, faceDirection } from 'three/tsl';
import { NZ, perturb } from '../../../shared/scene/materials.js';
import { SHELF } from '../layout.js';

const PERIOD = SHELF.M * SHELF.L;
export const FLOORS = { parquet: 'Parquet', dalles: 'Dalles de pierre', zinc: 'Zinc', granito: 'Granito' };

// bruit périodique de PERIOD en x, f motifs par unité ≈ f/3
const pn = (p, f) => NZ(p.mul(f / 3));
const hash2 = (a, b) => fract(sin(a.mul(127.1).add(b.mul(311.7))).mul(43758.5453));

export function roomMaterial(kind, { c1, c2, wall, wallRough = 0.9 }) {
  const floor_ = tFloor;
  const U = { c1: uniform(new THREE.Color(c1)), c2: uniform(new THREE.Color(c2)), wall: uniform(new THREE.Color(wall)) };
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const P = positionWorld;
  const wallness = smoothstep(0.05, 0.5, P.y);

  // le sol : couleur, rugosité, métal, hauteur du relief (unités monde)
  const F = () => {
    const x = P.x, z = P.z;
    let col, rough, metal = float(0), h;
    if (kind === 'parquet') {
      const w = 0.16, l = 1.2, n = Math.round(PERIOD / l);
      const row = floor_(z.div(w));
      const sh = hash2(row, float(3.7)).mul(l);
      const u = x.add(sh).div(l), id = mod(floor_(u), n);
      const tint = hash2(row, id);
      // le fil : des veines le long de la lame, ondulées par le bruit
      const zl = fract(z.div(w)), warp = pn(vec3(x, z.mul(4), row.mul(0.37)), 30).x;
      const vein = sin(zl.mul(38).add(warp.mul(5)).add(tint.mul(20))).mul(0.5).add(0.5);
      const fine = pn(vec3(x.mul(0.3), z.mul(9), row), 240).y.mul(0.5).add(0.5);
      const base = mix(vec3(U.c1), vec3(U.c2), tint.mul(0.7).add(vein.mul(0.25)));
      const seamZ = min(zl, float(1).sub(zl)).mul(w), seamX = min(fract(u), float(1).sub(fract(u))).mul(l);
      const seam = smoothstep(0.0, 0.0025, min(seamZ, seamX));
      col = (base.mul(fine.mul(0.12).add(0.9)).mul(seam.mul(0.5).add(0.5)));
      rough = (mix(float(0.55), float(0.32), tint).add(fine.mul(0.1)));
      h = (seam.sub(1).mul(0.0015).add(vein.mul(0.0002)));
    } else if (kind === 'dalles') {
      const s = 0.6, n = Math.round(PERIOD / s);
      const ix = mod(floor_(x.div(s)), n), iz = floor_(z.div(s));
      const tint = hash2(ix, iz);
      const fx = fract(x.div(s)), fz = fract(z.div(s));
      const j = min(min(fx, float(1).sub(fx)), min(fz, float(1).sub(fz))).mul(s);
      const joint = smoothstep(0.003, 0.006, j);
      const mott = pn(vec3(x, z, tint.mul(5)), 6).x.mul(0.5).add(0.5);
      const speck = smoothstep(0.62, 0.75, pn(vec3(x, z, 1.3), 300).z.oneMinus());
      const base = mix(vec3(U.c1), vec3(U.c2), tint.mul(0.6).add(mott.mul(0.4)));
      col = (mix(vec3(0.16, 0.16, 0.15), base.mul(float(1).sub(speck.mul(0.25))), joint));
      rough = (mix(float(0.85), float(0.5).add(mott.mul(0.2)), joint));
      h = (joint.sub(1).mul(0.002).add(mott.mul(0.0004)));
    } else if (kind === 'zinc') {
      const s = 1.5, n = Math.round(PERIOD / s);
      const fx = fract(x.div(s)), id = mod(floor_(x.div(s)), n);
      const ridge = smoothstep(0.012, 0.0, min(fx, float(1).sub(fx)).mul(s));
      const brush = pn(vec3(x.mul(0.2), z.mul(40), id), 60).y.mul(0.5).add(0.5);
      const pat = smoothstep(0.1, 0.6, pn(vec3(x, z, id.mul(0.3)), 3).x);
      col = (mix(vec3(U.c1), vec3(U.c2), pat.mul(0.7)).mul(brush.mul(0.1).add(0.95)));
      metal = (mix(float(0.85), float(0.35), pat));
      rough = (mix(float(0.42), float(0.7), pat).add(brush.mul(0.05)));
      h = (ridge.mul(0.004));
    } else { // granito
      const s = 0.02, n = Math.round(PERIOD / s); // (600 éclats par période : le motif se répète exactement)
      const q = vec2(x, z).div(s), ic = floor_(q), fc = fract(q);
      let best = float(9), bid = vec2(0);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const c = ic.add(vec2(a, b)), cx = mod(c.x, n);
        const o = vec2(hash2(cx, c.y), hash2(c.y, cx.add(7.1))).mul(0.8).add(0.1);
        const d = length(vec2(a, b).add(o).sub(fc));
        const closer = d.lessThan(best);
        bid = select(closer, vec2(cx, c.y), bid); best = min(best, d);
      }
      const k = hash2(bid.x, bid.y), chip = smoothstep(0.42, 0.36, best).mul(select(k.lessThan(0.55), float(1), float(0)));
      const chipCol = select(k.lessThan(0.25), vec3(0.93, 0.92, 0.89), select(k.lessThan(0.42), vec3(0.12, 0.12, 0.13), vec3(U.c2)));
      const cement = vec3(U.c1).mul(pn(vec3(x, z, 2.2), 30).x.mul(0.06).add(1));
      col = (mix(cement, chipCol, chip));
      rough = (mix(float(0.5), float(0.3), chip));
      h = (chip.mul(-0.0001));
    }
    return { col, rough, metal, h };
  };
  // le mur : plâtre
  const Wl = () => {
    const mott = pn(P, 3).x.mul(0.5).add(0.5), fine = pn(P, 360).y;
    return { col: vec3(U.wall).mul(mott.mul(0.08).add(0.96)).mul(fine.mul(0.03).add(1)), h: mott.mul(0.0006).add(fine.mul(0.00008)) };
  };
  const f = F(), w = Wl();
  m.colorNode = mix(f.col, w.col, wallness);
  m.roughnessNode = mix(f.rough, float(wallRough), wallness);
  m.metalnessNode = mix(f.metal, float(0), wallness);
  m.normalNode = perturb(mix(f.h, w.h, wallness), normalViewGeometry.mul(faceDirection));
  return { material: m, U };
}
