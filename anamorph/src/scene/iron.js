// Le fer de la ferronnerie (TSL) : de la ferraille restée dehors, dans
// l'Arctique. Ce qui fait le vrai, d'après des photographies de ferraille
// sous la neige :
//  - la rouille n'est pas une teinte : c'est une croûte. Brun très sombre et
//    compact sur l'ancienne, orange vif et poudreux en efflorescences, noire
//    dans les piqûres ; rugueuse (≈ 0,9), en relief (cloques, écailles) ;
//  - la calamine (oxyde de forge) : noir bleuté, satiné, en plaques que la
//    rouille ronge par les bords ;
//  - les coupes et les arêtes : l'acier y apparaît, gris, mais déjà piqué ;
//  - les soudures : un cordon sombre, grumeleux, bleui par la chaleur ;
//  - le givre : une poudre blanche sur les faces tournées vers le ciel, plus
//    épaisse dans les creux, absente des faces verticales.
// Les échelles suivent le réel : plaques de 3 à 10 cm, cloques de 2 à 5 mm,
// piqûres de 0,5 mm. Tout est calculé dans l'espace de l'objet.
import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, positionGeometry, normalLocal, vec3, float, mix, smoothstep, clamp, bumpMap, uniform,
  mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float,
} from 'three/tsl';

export function ironMaterial({ rust = 0.45, frost = 0.5 } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const U = { rust: uniform(rust), frost: uniform(frost) };
  const surf = attribute('surf', 'vec4');
  const edge = surf.z, weld = surf.y, piece = surf.w;
  const p = positionGeometry; // (la matière suit la pièce quand elle vole : position au repos)
  const pr = piece.mul(6.283).sin().mul(0.5).add(0.5); // tirage propre à la pièce
  const ny = normalLocal.y;

  // ── rouille : avancement par pièce, plaques, attaque par le haut (l'eau stagne)
  const plates = mx_fractal_noise_float(p.mul(14).add(pr.mul(31)), 5, 2.0, 0.55).mul(0.5).add(0.5);
  const rustAmt = U.rust.mul(pr.mul(0.9).add(0.55));
  const rustMask = smoothstep(0.34, 0.44, plates.add(rustAmt.mul(0.5)).add(ny.mul(0.08)).sub(0.32).add(edge.mul(0.06)));
  // efflorescences orange (poudre fraîche) et piqûres noires
  const bloom = smoothstep(0.55, 0.8, mx_fractal_noise_float(p.mul(60).add(7.3), 3, 2, 0.5).mul(0.5).add(0.5));
  const pitsN = mx_worley_noise_float(p.mul(420));
  const pits = smoothstep(0.18, 0.05, pitsN).mul(rustMask);
  const blister = mx_worley_noise_float(p.mul(260)); // cloques de 2–4 mm
  const crustTone = mx_noise_float(p.mul(170)).mul(0.5).add(0.5);
  // (teintes orangées : un rouge sans vert vire au rose sous le soleil et l'étalonnage)
  const rustDark = vec3(0.04, 0.019, 0.009), rustMid = vec3(0.085, 0.04, 0.016), rustBright = vec3(0.2, 0.095, 0.03);
  let rustCol = mix(rustDark, rustMid, smoothstep(0.25, 0.75, crustTone.mul(0.6).add(plates.mul(0.4))));
  rustCol = mix(rustCol, rustBright, bloom.mul(0.85));
  rustCol = mix(rustCol, vec3(0.012, 0.007, 0.005), pits);

  // ── calamine : noir bleuté marbré, voile brun d'oxydation
  const scaleM = mx_fractal_noise_float(p.mul(9), 4, 2, 0.5).mul(0.5).add(0.5);
  const scaleCol = mix(vec3(0.014, 0.015, 0.018), vec3(0.04, 0.034, 0.03), scaleM);
  // ── acier des coupes et des arêtes, déjà terni
  const steelCol = mix(vec3(0.20, 0.20, 0.21), vec3(0.34, 0.34, 0.35), mx_noise_float(p.mul(300)).mul(0.5).add(0.5));
  // ── soudure : sombre, bleuie
  const heat = mx_noise_float(p.mul(90)).mul(0.5).add(0.5);
  const weldCol = mix(vec3(0.02, 0.02, 0.026), vec3(0.05, 0.05, 0.075), heat);

  let col = mix(scaleCol, steelCol, edge.mul(0.6));
  col = mix(col, rustCol, rustMask);
  col = mix(col, weldCol, weld.mul(float(1).sub(rustMask.mul(0.5))));
  let metal = mix(mix(float(0.2), float(0.9), edge.mul(0.6)), float(0), rustMask).mul(float(1).sub(weld.mul(0.4)));
  let rough = mix(mix(float(0.62).add(scaleM.mul(0.15)), float(0.42), edge.mul(0.6)), float(0.86).add(bloom.mul(0.1)), rustMask).add(weld.mul(0.2));

  // ── givre : poudre blanche sur les faces hautes, cassée par le vent
  const frostN = mx_fractal_noise_float(p.mul(22).add(3.1), 3, 2, 0.5).mul(0.5).add(0.5);
  const frostMask = smoothstep(0.86, 0.98, ny).mul(smoothstep(0.5, 0.75, frostN.add(U.frost.mul(0.3)).sub(0.1))).mul(U.frost);
  col = mix(col, vec3(0.78, 0.8, 0.84), frostMask);
  metal = mix(metal, float(0), frostMask);
  rough = mix(rough, float(0.8), frostMask);

  m.colorNode = col;
  m.metalnessNode = metal;
  m.roughnessNode = clamp(rough, 0.05, 1);
  // relief (en mètres) : cloques et écailles de la rouille, piqûres, grumeaux de soudure, grains de givre
  const h = blister.mul(-0.0006).mul(rustMask)
    .add(pits.mul(-0.0005))
    .add(smoothstep(0.45, 0.6, plates).mul(0.0004).mul(rustMask))
    .add(mx_noise_float(p.mul(140)).mul(0.0009).mul(weld))
    .add(frostN.mul(0.0004).mul(frostMask))
    .add(mx_worley_noise_float(p.mul(45)).mul(-0.00025).mul(float(1).sub(rustMask))); // coups de marteau sur la calamine
  m.normalNode = bumpMap(h, 1);
  m.userData.U = U;
  return m;
}
