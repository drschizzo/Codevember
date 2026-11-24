// Les sols où tombe l'ombre, un par humeur. Des surfaces dures et continues :
// ce qu'un moteur temps réel rend juste (docs/concept.md, section f). Chacun
// porte un grain à l'échelle du sujet, qui donne l'échelle (règle 15).
//
// Deux échelles de relief, en mètres, calculées par les MÊMES fonctions :
//  - macro (bosses de roche, crêtes de neige, rides de sable, lobes de lave) :
//    près du tas, un carré de sol finement maillé est réellement déplacé (dans
//    le shader de sommets), pour que le gros plan rasant ait du volume, des
//    silhouettes et des ombres propres ; partout, la macro entre aussi dans le
//    bumpMap, qui donne l'ombrage (la normale de la géométrie, elle, ne la
//    contient pas : pas de double compte) ;
//  - fine (stries, grain, joints, fil du bois) : bumpMap seulement.
// Sous le tas, la macro s'aplatit sur les sols où l'objet doit porter (roche,
// lave, neige) : aucune pièce n'entre dans le sol ni ne flotte au-dessus.
// Le relief reste de quelques millimètres à 2 cm : l'ombre doit rester lisible.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, normalLocal, positionWorld, positionGeometry, positionLocal, vec3, float, mix, smoothstep, clamp, bumpMap, uniform, abs, sin, fract, floor,
  max, min, dot, normalize, pow, length, cameraPosition,
  mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, mx_cell_noise_float,
} from 'three/tsl';
import { WIND_AZ } from '../gen/drift.js';

export const GROUNDS = ['snow', 'rock', 'sand', 'concrete', 'planks', 'basalt'];

const along = (p, az) => p.x.mul(Math.cos(az)).add(p.y.mul(Math.sin(az)));
const across = (p, az) => p.x.mul(-Math.sin(az)).add(p.y.mul(Math.cos(az)));

// Les couches d'un sol au point p (vec2 : x, z du monde).
function layers(kind, p) {
  const p3 = vec3(p.x, 0, p.y);
  switch (kind) {
    case 'snow': {
      // sastrugi : crêtes allongées dans le sens du vent, bord raide au vent
      const al = along(p, WIND_AZ), ac = across(p, WIND_AZ);
      const warp = mx_noise_float(vec3(al.mul(0.25), ac.mul(0.25), 3.1)).mul(0.6);
      const q = vec3(al.mul(0.55), ac.add(warp).mul(2.2), 0.7);
      const r1 = float(1).sub(abs(mx_noise_float(q))).pow(3);
      const r2 = float(1).sub(abs(mx_noise_float(q.mul(2.3).add(5.2)))).pow(3);
      const big = mx_fractal_noise_float(vec3(p.mul(0.18), 1.3), 3, 2, 0.5);
      const crust = mx_noise_float(vec3(p.mul(18), 9.0)).mul(0.5).add(0.5);
      return {
        col: mix(vec3(0.80, 0.83, 0.87), vec3(0.90, 0.91, 0.93), smoothstep(0.0, 0.5, r1)),
        rough: float(0.72).sub(crust.mul(0.08)),
        macro: r1.mul(0.03).add(r2.mul(0.012)).add(big.mul(0.02)),
        fine: crust.mul(0.0012), flatten: false, // (la congère pose déjà le tas)
      };
    }
    case 'rock': {
      // gneiss poli par un glacier : grandes bosses lisses, foliation, stries
      const big = mx_fractal_noise_float(p3.mul(0.6), 3, 2, 0.5);
      const fol = mx_fractal_noise_float(vec3(along(p, 0.3).mul(0.9), across(p, 0.3).mul(3.5), 0.5), 3, 2, 0.5);
      const stri = mx_noise_float(vec3(along(p, 1.1).mul(0.8), across(p, 1.1).mul(260), 2.3));
      const mott = mx_fractal_noise_float(p3.mul(7), 3, 2, 0.5).mul(0.5).add(0.5);
      return {
        // gneiss clair, bandes sombres (biotite) adoucies : de la valeur sans concurrencer l'ombre
        col: mix(vec3(0.17, 0.165, 0.165), vec3(0.34, 0.33, 0.315), smoothstep(-0.7, 0.6, fol.mul(0.6).add(mott.mul(0.35)))),
        rough: float(0.38).add(mott.mul(0.15)),
        macro: big.mul(0.025),
        fine: stri.mul(0.0006).add(mx_noise_float(p3.mul(80)).mul(0.0003)), flatten: true,
      };
    }
    case 'sand': {
      // sable humide : rides de courant asymétriques (14 cm), film d'eau dans les creux
      const w = mx_noise_float(p3.mul(0.7)).mul(1.6);
      const ph = fract(along(p, 0.9).mul(7).add(w));
      const ripple = smoothstep(0.0, 0.7, ph).mul(smoothstep(1.0, 0.82, ph)); // pente douce, front raide
      const wet = smoothstep(0.08, 0.0, ripple).mul(smoothstep(0.2, 0.6, mx_noise_float(p3.mul(1.3).add(9)).mul(0.5).add(0.5)));
      const grain = mx_noise_float(p3.mul(900)).mul(0.5).add(0.5);
      const tone = mx_fractal_noise_float(p3.mul(2.2), 3, 2, 0.5).mul(0.5).add(0.5);
      let col = mix(vec3(0.30, 0.27, 0.225), vec3(0.24, 0.215, 0.18), tone);
      col = mix(col, col.mul(0.75), wet.mul(0.9)).mul(grain.mul(0.12).add(0.94)).mul(ripple.mul(0.12).add(0.92));
      const fade = smoothstep(9.0, 4.0, positionWorld.sub(cameraPosition).length()); // (le grain fin s'efface au loin : moiré)
      return { col, rough: mix(float(0.82), float(0.22), wet), macro: ripple.mul(0.008), fine: grain.mul(0.0002).mul(fade), flatten: false };
    }
    case 'concrete': {
      // dalle de quai : joints tous les 2 m, taloché, granulats, taches d'eau
      const gx = fract(p.x.mul(0.5)), gz = fract(p.y.mul(0.5));
      const joint = max(smoothstep(0.006, 0.0, min(gx, float(1).sub(gx))), smoothstep(0.006, 0.0, min(gz, float(1).sub(gz))));
      const agg = smoothstep(0.85, 0.95, mx_cell_noise_float(p3.mul(330)));
      const trowel = mx_noise_float(vec3(along(p, 0.2).mul(3), across(p, 0.2).mul(0.6), 1.7));
      const stain = smoothstep(0.1, 0.6, mx_fractal_noise_float(p3.mul(0.35), 4, 2, 0.55).mul(0.5).add(0.5));
      const tone = mx_fractal_noise_float(p3.mul(4), 3, 2, 0.5).mul(0.5).add(0.5);
      let col = mix(vec3(0.36, 0.355, 0.34), vec3(0.27, 0.27, 0.265), tone.mul(0.6).add(stain.mul(0.5)));
      col = mix(col, vec3(0.5, 0.49, 0.47), agg.mul(0.5));
      col = mix(col, vec3(0.06, 0.06, 0.06), joint);
      return {
        col, rough: float(0.78).sub(stain.mul(0.15)), macro: float(0),
        fine: joint.mul(-0.008).add(trowel.mul(0.0008)).add(agg.mul(0.0004)).add(mx_noise_float(p3.mul(120)).mul(0.0002)), flatten: false,
      };
    }
    case 'planks': {
      // ponton : planches de 14 cm, jours de 8 mm, bois grisé, bouts décalés
      const u = along(p, 0), v = across(p, 0);
      const row = floor(v.div(0.14)), fv = fract(v.div(0.14));
      const len = mx_cell_noise_float(vec3(row, 0, 0)).mul(1.5).add(1.8);
      const off = mx_cell_noise_float(vec3(row, 1, 0)).mul(3);
      const fu = fract(u.add(off).div(len));
      const gap = max(smoothstep(0.03, 0.0, min(fv, float(1).sub(fv))), smoothstep(0.003, 0.0, min(fu, float(1).sub(fu))));
      const board = mx_cell_noise_float(vec3(row, floor(u.add(off).div(len)), 2));
      const grain = mx_noise_float(vec3(u.mul(2.5), v.mul(70).add(board.mul(9)), board.mul(5)));
      const ring = abs(sin(v.mul(260).add(grain.mul(5)))).mul(0.5);
      let col = mix(vec3(0.24, 0.23, 0.215), vec3(0.36, 0.35, 0.33), board.mul(0.6).add(grain.mul(0.2)).add(ring.mul(0.3)));
      col = mix(col, vec3(0.02, 0.02, 0.02), gap);
      return { col, rough: float(0.8), macro: float(0), fine: gap.mul(-0.01).add(grain.mul(0.0007)).add(ring.mul(0.0003)), flatten: false };
    }
    default: { // basalt : lave cordée noire, lobes, cordes de 3 cm polies, vésicules
      const w = mx_noise_float(p3.mul(0.9)).mul(2.5);
      // cordes : plis courbes et irréguliers (arêtes d'un bruit étiré, courbé par les lobes), pas des rayures
      const rq = vec3(along(p, 0.5).mul(28).add(w.mul(9)), across(p, 0.5).mul(3.5).add(w.mul(2)), 4.4);
      const rope = float(1).sub(abs(mx_noise_float(rq))).pow(2).mul(smoothstep(-0.4, 0.3, mx_noise_float(p3.mul(2.2).add(1.7))));
      const lobe = mx_fractal_noise_float(p3.mul(0.8), 3, 2, 0.5);
      const ves = smoothstep(0.12, 0.03, mx_worley_noise_float(p3.mul(140)));
      const sheen = mx_noise_float(p3.mul(1.1)).mul(0.5).add(0.5);
      return {
        col: mix(vec3(0.03, 0.029, 0.032), vec3(0.055, 0.052, 0.054), rope.mul(0.6).add(sheen.mul(0.25))).mul(float(1).sub(ves.mul(0.6))),
        rough: float(0.5).sub(rope.mul(0.25)).add(ves.mul(0.4)),
        macro: lobe.mul(0.02),
        fine: rope.mul(0.004).add(ves.mul(-0.002)), flatten: true,
      };
    }
  }
}

// patch : true pour le carré déplacé autour du tas (U.patch : x0, z0, taille,
// largeur du fondu ; U.heap : centre et demi-axes de l'emprise du tas).
export function groundMaterial(kind, { patch = false } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const U = {
    sun: uniform(new THREE.Vector3(0, 1, 0)), glint: uniform(1),
    patch: uniform(new THREE.Vector4(-2, -2, 4, 0.8)), heap: uniform(new THREE.Vector4(0, 0, 1, 1)),
    drift: uniform(1), // (part de la congère : elle monte avec le tas, redescend au démontage)
  };
  // aplatissement sous le tas (sols porteurs) : 0 dans l'emprise, 1 au-delà de 1,15 fois
  const flat = (q) => smoothstep(0.8, 1.15, length(q.sub(U.heap.xy).div(U.heap.zw)));
  const macroAt = (q) => { const L = layers(kind, q); return L.flatten ? L.macro.mul(flat(q)) : L.macro; };
  const p = positionWorld.xz;
  const L = layers(kind, p);
  if (patch) {
    // déplacement du carré : la macro, fondue vers 0 au bord (raccord avec le sol plat)
    const g = positionGeometry.xz;
    const e = min(min(g.x.sub(U.patch.x), U.patch.x.add(U.patch.z).sub(g.x)), min(g.y.sub(U.patch.y), U.patch.y.add(U.patch.z).sub(g.y)));
    const fade = smoothstep(0, U.patch.w, e);
    // la congère (attribut drift : hauteur, pente en x, pente en z), à la part U.drift
    m.positionNode = Fn(() => {
      const D = attribute('drift', 'vec3');
      normalLocal.assign(normalize(vec3(D.y.mul(U.drift).negate(), 1, D.z.mul(U.drift).negate())));
      return positionLocal.add(vec3(0, macroAt(g).mul(fade).add(D.x.mul(U.drift)), 0));
    })();
  }
  m.colorNode = L.col;
  m.roughnessNode = clamp(L.rough, 0.05, 1);
  m.metalnessNode = float(0);
  m.normalNode = bumpMap(macroAt(p).add(L.fine), 1);
  if (kind === 'snow') {
    // paillettes de givre : une sur ~400 cellules de 4 mm, orientée au hasard ;
    // elle brille si elle renvoie le soleil vers l'œil
    const cell = p.mul(250);
    const pick = mx_cell_noise_float(vec3(cell, 0.5));
    const nx = mx_cell_noise_float(vec3(cell, 1.5)).sub(0.5), nz = mx_cell_noise_float(vec3(cell, 2.5)).sub(0.5);
    const facet = normalize(vec3(nx.mul(0.6), 1, nz.mul(0.6)));
    const V = normalize(cameraPosition.sub(positionWorld));
    const Hh = normalize(V.add(U.sun));
    m.emissiveNode = vec3(smoothstep(0.9975, 1, pick).mul(pow(max(dot(facet, Hh), 0), 900)).mul(U.glint).mul(40));
  }
  m.userData.U = U;
  return m;
}
