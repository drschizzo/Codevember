// Les matières de l'objet, une par accord (src/gen/pieces.js, ACCORDS). Toutes
// sont des matières que le temps réel rend juste : surfaces dures, relief en
// bumpMap à l'échelle du réel, aucune fibre ni translucidité.
// Rôles de surface du maillage (attribut surf) : x peau, y jonction (soudure,
// brasure), z arêtes et coupes ; w : un tirage par pièce.
// Le fil du bois suit l'axe de la pièce : la tangente du maillage (forge.js).
import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, positionGeometry, normalLocal, tangentLocal, vec3, float, mix, smoothstep, clamp, bumpMap, uniform, abs, dot, normalize, step, floor,
  mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, mx_cell_noise_float,
} from 'three/tsl';
import { ironMaterial } from './iron.js';

export const OBJECT_ACCORDS = ['rouille', 'bois', 'cuivre', 'peint', 'galva'];

// givre : poudre blanche sur les faces tournées vers le ciel
function frostOf(p, ny, U) {
  const n = mx_fractal_noise_float(p.mul(22).add(3.1), 3, 2, 0.5).mul(0.5).add(0.5);
  return { mask: smoothstep(0.86, 0.98, ny).mul(smoothstep(0.5, 0.75, n.add(U.frost.mul(0.3)).sub(0.1))).mul(U.frost), n };
}

export function objectMaterial(accord, { rust = 0.45, frost = 0.5, paint = '#8e2a1c' } = {}) {
  if (accord === 'rouille' || !OBJECT_ACCORDS.includes(accord)) return ironMaterial({ rust, frost });
  const m = new THREE.MeshPhysicalNodeMaterial();
  const U = { rust: uniform(rust), frost: uniform(frost), paint: uniform(new THREE.Color(paint)) };
  const surf = attribute('surf', 'vec4');
  const edge = surf.z, joint = surf.y, piece = surf.w;
  const p = positionGeometry, ny = normalLocal.y; // (la matière suit la pièce quand elle vole)
  const pr = piece.mul(6.283).sin().mul(0.5).add(0.5);
  let col, metal, rough, h;

  if (accord === 'bois') {
    // bois flotté : gris argent, blanchi par le sel et le soleil, fil en relief
    // (le bois tendre s'use, le bois d'été reste), gerces le long du fil ;
    // bout de branche plus brun (bois de bout)
    // (tangente protégée : une tangente nulle donnerait des normales NaN, et un tas gris uniforme)
    const T = normalize(attribute('tangent', 'vec4').xyz.add(vec3(1e-4, 2e-4, 3e-4))); // (au repos, comme la position)
    const al = dot(p, T), perp = p.sub(T.mul(al));
    const grain = mx_noise_float(perp.mul(70).add(T.mul(al.mul(1.6))).add(pr.mul(13)));
    const fib = mx_noise_float(perp.mul(260).add(T.mul(al.mul(4))));
    // (smoothstep aux bornes dans l'ordre : inversées, le résultat n'est pas défini en WGSL)
    const check = float(1).sub(smoothstep(0.0, 0.05, abs(mx_noise_float(perp.mul(16).add(T.mul(al.mul(0.7))).add(pr.mul(7)))))).mul(smoothstep(-0.2, 0.4, mx_noise_float(p.mul(3).add(2))));
    const tone = mx_fractal_noise_float(p.mul(2.5).add(pr.mul(5)), 3, 2, 0.5).mul(0.5).add(0.5);
    // chaque branche a sa teinte : gris argent blanchi, gris brun, brun d'écorce restée
    const streak = mx_noise_float(perp.mul(18).add(T.mul(al.mul(0.5))).add(pr.mul(3)));
    const bark = smoothstep(0.75, 0.95, pr);
    // (sous ce soleil, un albédo de 0,3 sort presque blanc et l'étalonnage écrase les
    // hautes lumières : bois sombre et chaud, écarts de valeur francs)
    // chaque branche : du gris argent (longtemps au soleil) au brun (encore imbibée)
    const warm = piece.mul(17.3).fract();
    const silver = vec3(0.21, 0.2, 0.18), brown = vec3(0.19, 0.105, 0.05);
    col = mix(silver, brown, smoothstep(0.35, 0.85, warm)).mul(pr.mul(0.7).add(0.45)).mul(tone.mul(0.3).add(0.85));
    col = mix(col, vec3(0.06, 0.035, 0.018), bark.mul(0.8));
    // le fil : des bandes nettement plus sombres le long de la branche, des stries fines
    col = col.mul(smoothstep(-0.7, 0.7, streak).mul(0.6).add(0.62));
    col = col.mul(smoothstep(-0.5, 0.5, grain).mul(0.7).add(0.55)).mul(fib.mul(0.12).add(0.94));
    col = mix(col, vec3(0.015, 0.012, 0.01), check.mul(0.9));
    // creux de la géométrie (sillons, fentes, nœuds : canal y de surf) : sombres, salis ;
    // crêtes des veines pâlies par le soleil
    const groove = joint;
    col = col.mul(float(1).sub(smoothstep(0.05, 0.9, groove).mul(0.75))).mul(float(1).sub(groove).mul(0.25).add(0.85));
    col = mix(col, vec3(0.22, 0.17, 0.12).mul(grain.mul(0.25).add(1)), edge.mul(0.8));
    metal = float(0); rough = float(0.82).add(fib.mul(0.06));
    // (relief faible : un fil trop marqué en bumpMap donne des normales presque aléatoires,
    // et l'image moyennée devient grise et uniforme)
    // (relief sans la tangente : avec elle, le bumpMap rendait le tas gris et uniforme ;
    // le fil orienté reste dans la couleur)
    h = mx_noise_float(p.mul(90).add(pr.mul(7))).mul(0.00018).add(mx_noise_float(p.mul(300)).mul(0.00005));
  } else if (accord === 'cuivre') {
    // plomberie : cuivre (tubes) et laiton (ronds, une pièce sur trois), terni
    // en brun, vert-de-gris en plaques et en coulures vers le bas, coupes vives,
    // brasures claires
    const brass = step(0.68, pr);
    const base = mix(vec3(0.95, 0.64, 0.54), vec3(0.91, 0.78, 0.42), brass);
    const tarn = mx_fractal_noise_float(p.mul(9).add(pr.mul(9)), 4, 2, 0.5).mul(0.5).add(0.5);
    const dull = mix(base.mul(vec3(0.26, 0.15, 0.1)), base.mul(vec3(0.55, 0.42, 0.34)), smoothstep(0.35, 0.85, tarn));
    const drip = mx_noise_float(p.mul(vec3(30, 2.2, 30))).mul(0.5).add(0.5);
    const pat = smoothstep(0.55, 0.62, mx_fractal_noise_float(p.mul(11).add(4.4), 4, 2, 0.55).mul(0.5).add(0.5).add(ny.mul(0.1)).add(drip.mul(0.12)).add(U.rust.mul(0.25)).sub(0.12))
      .mul(float(1).sub(edge.mul(0.9)));
    const patCol = mix(vec3(0.05, 0.14, 0.11), vec3(0.13, 0.3, 0.24), mx_noise_float(p.mul(80)).mul(0.5).add(0.5));
    col = mix(mix(dull, base, edge.mul(0.85)), patCol, pat);
    col = mix(col, vec3(0.82, 0.76, 0.6), joint.mul(0.8));
    metal = mix(float(1), float(0), pat);
    rough = mix(mix(float(0.42).add(tarn.mul(0.15)), float(0.22), edge), float(0.85), pat).add(joint.mul(0.1));
    h = pat.mul(0.0004).add(mx_noise_float(p.mul(140)).mul(0.0004).mul(joint)).add(mx_worley_noise_float(p.mul(200)).mul(-0.0002).mul(pat));
  } else if (accord === 'peint') {
    // acier peint d'une couleur industrielle, mat de vieillesse (farinage plus
    // pâle sur le dessus), écaillé : aux arêtes d'abord, puis en plaques ; dessous,
    // la rouille ; les soudures restent nues
    const chipN = mx_fractal_noise_float(p.mul(42).add(pr.mul(21)), 4, 2.1, 0.55).mul(0.5).add(0.5);
    const chip = smoothstep(0.64, 0.66, chipN.add(edge.mul(0.35)).add(U.rust.mul(0.12)).sub(0.08));
    const rustN = mx_fractal_noise_float(p.mul(45), 3, 2, 0.5).mul(0.5).add(0.5);
    const rustCol = mix(vec3(0.05, 0.022, 0.01), vec3(0.17, 0.075, 0.025), rustN);
    const chalk = clamp(ny, 0, 1).mul(0.12); // (farinage léger : une peinture rouge qui farine trop vire au rose)
    const paintCol = mix(vec3(U.paint), vec3(0.6, 0.58, 0.55), chalk).mul(mx_noise_float(p.mul(30)).mul(0.06).add(0.97));
    col = mix(paintCol, rustCol, chip);
    col = mix(col, mix(vec3(0.035, 0.035, 0.04), rustCol, 0.5), joint);
    metal = float(0);
    rough = mix(float(0.62).add(chalk.mul(0.3)), float(0.88), chip).add(joint.mul(0.1));
    // le bord d'un éclat : la peinture fait une petite marche
    h = float(1).sub(chip).mul(0.00025).add(rustN.mul(0.0003).mul(chip)).add(mx_noise_float(p.mul(140)).mul(0.0008).mul(joint));
  } else { // galva
    // acier galvanisé : fleurage de zinc (grandes cellules de reflet), voile
    // blanc de rouille blanche, coupes brunes (le zinc n'y est pas)
    const q = p.mul(28).add(vec3(mx_noise_float(p.mul(9)), mx_noise_float(p.mul(9).add(3)), mx_noise_float(p.mul(9).add(7))).mul(0.6));
    const cell = mx_cell_noise_float(floor(q));
    const white = smoothstep(0.56, 0.7, mx_fractal_noise_float(p.mul(7).add(1.3), 4, 2, 0.55).mul(0.5).add(0.5).add(U.rust.mul(0.12)).add(ny.mul(0.06)).sub(0.1)).mul(0.8);
    const zinc = mix(vec3(0.27, 0.28, 0.29), vec3(0.47, 0.48, 0.49), cell).mul(mx_fractal_noise_float(p.mul(4).add(pr.mul(5)), 3, 2, 0.5).mul(0.25).add(0.85)); // (zinc terni, sali)
    col = mix(zinc, vec3(0.38, 0.39, 0.37), white);
    col = mix(col, vec3(0.13, 0.06, 0.025), edge.mul(0.85));
    col = mix(col, vec3(0.06, 0.06, 0.065), joint);
    metal = mix(float(1), float(0), white.max(edge.mul(0.85)));
    rough = mix(float(0.48).add(cell.mul(0.25)), float(0.88), white).add(edge.mul(0.3));
    h = white.mul(0.0003).add(mx_noise_float(p.mul(140)).mul(0.0008).mul(joint));
  }

  const F = frostOf(p, ny, U);
  col = mix(col, vec3(0.78, 0.8, 0.84), F.mask);
  metal = mix(metal, float(0), F.mask);
  rough = mix(rough, float(0.8), F.mask);
  m.colorNode = col;
  m.metalnessNode = metal;
  m.roughnessNode = clamp(rough, 0.05, 1);
  m.normalNode = bumpMap(h.add(F.n.mul(0.0004).mul(F.mask)), 1);
  m.userData.U = U;
  return m;
}
