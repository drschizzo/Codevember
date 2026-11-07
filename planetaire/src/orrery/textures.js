// Textures dessinées sur canevas (gravures, cadrans) et environnement de studio.
import * as THREE from 'three/webgpu';
import { LIMB_R0, LIMB_R1, PHASE_W, PHASE_SHORT } from './layout.js';
import { ss } from '../util.js';

const INK = '#3a2a14';
const SERIF = '"Cormorant Garamond", Georgia, serif';

// canevas w × h fond `paper`, encre `ink` ; draw(g, w, h) ; renvoie une texture sRGB
function canvasTexture(w, h, draw, { paper = '#fff', ink = INK, anisotropy = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = paper; g.fillRect(0, 0, w, h);
  g.strokeStyle = g.fillStyle = ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}
const circle = (g, cx, cy, r, w, a0 = 0, a1 = Math.PI * 2) => { g.lineWidth = w; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke(); };
const radial = (g, cx, cy, a, r0, r1, w) => {
  g.lineWidth = w; g.beginPath();
  g.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); g.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); g.stroke();
};
// texte posé le long d'un cercle, tangent
const along = (g, txt, cx, cy, r, a, font) => {
  g.save(); g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a)); g.rotate(a + Math.PI / 2);
  g.font = font; g.fillText(txt, 0, 0); g.restore();
};

// Limbe : graduations en degrés (0° sur la tête de lecture), chiffres, maisons
export const limbTexture = () => canvasTexture(2048, 2048, (g, S) => {
  const C = S / 2, R1 = C, R0 = C * (LIMB_R0 / LIMB_R1), band = R1 - R0;
  circle(g, C, C, R1 - band * 0.06, 3); circle(g, C, C, R1 - band * 0.30, 2); circle(g, C, C, R0 + band * 0.42, 2); circle(g, C, C, R0 + band * 0.06, 3);
  for (let d = 0; d < 360; d++) {
    const L = d % 10 === 0 ? 0.24 : d % 5 === 0 ? 0.16 : 0.09, r1 = R1 - band * 0.06;
    radial(g, C, C, (-d * Math.PI) / 180, r1 - band * L, r1, d % 10 === 0 ? 3 : 1.6);
  }
  for (let d = 0; d < 360; d += 10) along(g, String(d), C, C, R1 - band * 0.38, (-d * Math.PI) / 180, `500 ${band * 0.12}px ${SERIF}`);
  const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  for (let k = 0; k < 12; k++) {
    along(g, ROM[k], C, C, R0 + band * 0.24, (-(k * 30 + 15) * Math.PI) / 180, `500 ${band * 0.13}px ${SERIF}`);
    radial(g, C, C, (-k * 30 * Math.PI) / 180, R0 + band * 0.06, R0 + band * 0.42, 2.5);
  }
}, { anisotropy: 8 });

// Platine : guillochage (rosace de cercles décentrés) et inscription circulaire
export const plateTexture = () => canvasTexture(1024, 1024, (g, S) => {
  const C = S / 2;
  g.globalAlpha = 0.35;
  for (let k = 0; k < 72; k++) { const a = (k / 72) * Math.PI * 2; circle(g, C + Math.cos(a) * 60, C + Math.sin(a) * 60, 300, 1); }
  g.globalAlpha = 1;
  for (const r of [0.985, 0.93, 0.79]) circle(g, C, C, C * r, 3);
  const txt = 'MACHINA · MUNDI · PLANÉTAIRE · T² ∝ a³ · LIGNÉE & SILLONS · ';
  const chars = [...txt + txt];
  chars.forEach((ch, i) => along(g, ch, C, C, C * 0.86, (i / chars.length) * Math.PI * 2, `500 ${C * 0.075}px ${SERIF}`));
});

// Cadran de la réserve de marche : un arc de 270°, de « plein » à « vide »,
// découpé en secteurs proportionnels à la part de chaque phase du cycle.
// (angle dans le canevas : 135° = plein … 405° = vide, sens horaire)
export const dialAngle = (reserve) => ((135 + 270 * (1 - reserve)) * Math.PI) / 180;
export const dialTexture = () => canvasTexture(512, 512, (g, S) => {
  const C = S / 2;
  circle(g, C, C, C * 0.96, 3);
  circle(g, C, C, C * 0.82, 2, dialAngle(1), dialAngle(0));
  circle(g, C, C, C * 0.9, 2, dialAngle(1), dialAngle(0));
  const tick = (res, len, w) => radial(g, C, C, dialAngle(res), C * (0.9 - len), C * 0.9, w);
  for (let k = 0; k <= 40; k++) tick(k / 40, 0.05, 1.5);
  let cum = 0;
  PHASE_W.forEach((w, i) => {
    tick(1 - cum, 0.16, 3.5);
    along(g, PHASE_SHORT[i], C, C, C * 0.66, dialAngle(1 - cum - w / 2), `500 ${S * 0.052}px ${SERIF}`);
    cum += w;
  });
  tick(0, 0.16, 3.5);
  g.font = `600 ${S * 0.07}px "Cormorant SC", Georgia, serif`;
  g.fillText('réserve', C, C + C * 0.42);
  g.font = `italic 400 ${S * 0.05}px ${SERIF}`;
  g.fillText('de marche', C, C + C * 0.56);
});

// petit cadran de la galerie : arc de 270°, libellé et bornes
export const gaugeTexture = (label, lo, hi) => canvasTexture(256, 256, (g, S) => {
  circle(g, S / 2, S / 2, S * 0.46, 3);
  for (let k = 0; k <= 10; k++) radial(g, S / 2, S / 2, Math.PI * (0.75 + 1.5 * k / 10), S * 0.34, S * 0.42, k % 5 ? 2 : 4);
  g.textBaseline = 'alphabetic';
  g.font = `600 ${S * 0.11}px "Cormorant SC", Georgia, serif`; g.fillText(label, S / 2, S * 0.72);
  g.font = `italic ${S * 0.08}px ${SERIF}`; g.fillText(lo, S * 0.24, S * 0.9); g.fillText(hi, S * 0.76, S * 0.9);
}, { paper: '#efe6d2', ink: '#2a1e10' });

// bande des chiffres 0–9 d'un compteur à rouleaux
export const digitsTexture = () => canvasTexture(512, 64, (g, W) => {
  g.font = '600 46px "EB Garamond", Georgia, serif';
  for (let d = 0; d < 10; d++) { g.save(); g.translate((d + 0.5) * W / 10, 32); g.rotate(-Math.PI / 2); g.fillText(String(d), 0, 2); g.restore(); }
}, { paper: '#16100a', ink: '#efe4cc' });

// Environnement de studio en HDR (demi-flottants) : c'est lui que le métal
// reflète. Un fond presque noir et des sources formées — une grande softbox
// chaude au-dessus (la lampe de musée), deux bandes verticales froides en
// contre-jour, une fenêtre lointaine, un rebond chaud du plateau.
export function studioEnv() {
  const W = 512, H = 256, data = new Uint16Array(W * H * 4);
  const box = (az, el, phi, elev, w, h, soft) => { // source rectangulaire en (azimut, élévation), bords adoucis
    let d = Math.abs(phi - az); d = Math.min(d, Math.PI * 2 - d);
    return ss(w + soft, w - soft, d * Math.cos(elev)) * ss(h + soft, h - soft, Math.abs(elev - el));
  };
  const L = [ // [azimut, élévation, ½ largeur, ½ hauteur, flou, r, g, b]
    [-2.45, 1.0, 0.42, 0.22, 0.05, 7.0, 6.2, 5.0],   // softbox tiède, haut-gauche-avant (lampe de musée)
    [0.55, 0.12, 0.05, 0.55, 0.02, 0.7, 0.95, 1.5],  // bande froide, contre-jour droit
    [-0.9, 0.2, 0.04, 0.45, 0.02, 0.45, 0.62, 1.0],  // bande froide, contre-jour gauche
    [2.2, 0.35, 0.18, 0.12, 0.03, 0.9, 0.75, 0.55],  // fenêtre lointaine, tiède
  ];
  const half = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < H; j++) {
    const elev = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(elev); // rangée 0 = nadir
    for (let i = 0; i < W; i++) {
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      // pénombre de l'atelier, un peu plus claire en haut ; rebond chaud du plateau en bas
      let r = 0.012 + 0.02 * Math.max(0, y), g = 0.011 + 0.02 * Math.max(0, y), b = 0.012 + 0.026 * Math.max(0, y);
      const fl = ss(-0.05, -0.5, y) * 0.05; r += fl; g += fl * 0.62; b += fl * 0.36;
      for (const [az, el, w, h, sf, lr, lg, lb] of L) {
        const k = box(az, el, phi, elev, w, h, sf);
        if (k > 0) { r += k * lr; g += k * lg; b += k * lb; }
      }
      const o = (j * W + i) * 4;
      data[o] = half(r); data[o + 1] = half(g); data[o + 2] = half(b); data[o + 3] = half(1);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
