// Les cotes du sablier et de la pièce, le soleil. Module pur (sans three) :
// la scène, les tests de contact et le test « la fonte commence quand le
// soleil touche le métal » le lisent.
//
// Repère du sablier : origine au pivot, y vers le haut quand il est droit.
// Repère monde : la table en y = 0, le pivot à HG.pivotY ; le sablier tourne
// autour de l'axe x (les tourillons), la caméra le regarde de face-gauche.
import { BLOCK } from './gen/burrows.js';
import { state } from './story.js';

const caseT = 0.015, plate = 0.07, neckL = 0.16, bulbR = 0.36, bulbT = 0.012, gapTop = 0.02;
const bottom = BLOCK.hy + caseT + plate, top = BLOCK.hy + caseT + neckL + 2 * bulbR + gapTop + plate;
const half = (bottom + top) / 2;
export const HG = {
  caseT, plate, neckL, bulbR, bulbT, gapTop,
  pivotY: 1.78,
  blockY: -(half - bottom) + 0, // (centre du bloc, repère du sablier)
  halfH: half,
  plateX: 0.92, plateZ: 0.68,
  colX: 0.84, colZ: 0.6, colR: 0.04,
  uprightX: 1.04, uprightR: 0.045, pinR: 0.03, footL: 0.7, footH: 0.06,
};
HG.blockY = bottom - half;
HG.neckY0 = HG.blockY + BLOCK.hy + caseT; // (bas du col : face du haut de la caisse)
HG.bulbC = HG.neckY0 + neckL + bulbR; // (centre du bulbe)
HG.plateBot = HG.blockY - BLOCK.hy - caseT; // (dessus de la platine du bas)
HG.plateTop = HG.bulbC + bulbR + gapTop; // (dessous de la platine du haut)
// rayon balayé autour du pivot (coins des platines) : le pied doit rester dessous
HG.sweepR = Math.hypot(HG.halfH, HG.plateZ);

// la fenêtre (mur de gauche) : plan x = X, ouverture [y0, y1] × [z0, z1]
export const WINDOW = { X: -2.4, y0: 0.35, y1: 4.3, z0: -0.8, z1: 0.8, bars: [2, 3], barW: 0.06 };

// direction du soleil (vers le soleil, monde) à la phase u
export function sunDir(u, sun = { az: 0.46, elMin: 0.1, elMax: 0.38 }) {
  const S = state(u);
  const t = S.sunT;
  const az = sun.az * (1 - 2 * t); // (matin : soleil vers l'avant, tache derrière le sablier)
  const el = sun.elMin + (sun.elMax - sun.elMin) * Math.sin(Math.PI * t);
  return [-Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}

// un point (monde) est-il dans la tache de soleil ? (même test que le shader)
export function sunLitPoint(p, d, W = WINDOW) {
  if (d[0] >= 0 || d[1] <= 0) return 0;
  const s = (W.X - p[0]) / d[0];
  const y = p[1] + d[1] * s, z = p[2] + d[2] * s;
  if (y < W.y0 || y > W.y1 || z < W.z0 || z > W.z1) return 0;
  const by = Math.abs(((y - W.y0) / (W.y1 - W.y0) * W.bars[1] + 0.5) % 1 - 0.5) * (W.y1 - W.y0) / W.bars[1];
  const bz = Math.abs(((z - W.z0) / (W.z1 - W.z0) * W.bars[0] + 0.5) % 1 - 0.5) * (W.z1 - W.z0) / W.bars[0];
  return Math.min(by, bz) > W.barW / 2 ? 1 : 0;
}

// matrice du sablier (rotation θ autour de x, au pivot) appliquée à un point
export function frameToWorld(q, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [q[0], HG.pivotY + c * q[1] - s * q[2], s * q[1] + c * q[2]];
}
