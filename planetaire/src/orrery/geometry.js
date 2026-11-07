// Géométries « usinées » : plaques biseautées, roues dentées au module commun,
// pièces tournées, ponts, rochet, roue d'échappement. Les géométries
// paramétrées sont mises en cache (une roue de 20 dents n'est construite qu'une fois).
import * as THREE from 'three/webgpu';
import { MODULE, pitchR } from './layout.js';

const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

// extrusion d'une forme 2D en plaque horizontale, centrée en y, biseautée
export function plate(shape, thick, bevel = 0.004, curve = 8) {
  const bt = Math.min(bevel, thick * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, thick - 2 * bt), bevelEnabled: true, bevelThickness: bt, bevelSize: bt * 0.9,
    bevelSegments: 1, curveSegments: curve,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(thick - 2 * bt) / 2, 0);
  g.computeVertexNormals();
  return g;
}
export const circlePath = (r, cx = 0, cy = 0) => { const h = new THREE.Path(); h.absarc(cx, cy, r, 0, Math.PI * 2, true); return h; };

// pièce tournée (profil [r, y] autour de l'axe y)
export const turned = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// contour d'une roue de n dents au module commun ; profil : flancs arrondis
// (approximation d'une développante), tête arrondie
export function gearShape(n) {
  const R = pitchR(n), out = R + MODULE * 0.95, root = R - MODULE * 1.2, p = (Math.PI * 2) / n;
  const prof = [[root, 0], [root, 0.18], [root + (R - root) * 0.55, 0.26], [R, 0.3], [R + (out - R) * 0.6, 0.35], [out, 0.42],
    [out, 0.58], [R + (out - R) * 0.6, 0.65], [R, 0.7], [root + (R - root) * 0.55, 0.74], [root, 0.82]];
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    prof.forEach(([r, f], j) => { const [x, y] = polar(r, (i + f) * p); if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  return s;
}

// évidements entre la jante (rim) et le moyeu (hub) : count rayons de largeur w
function addSpokes(s, rim, hub, count, w) {
  for (let k = 0; k < count; k++) {
    const a0 = (k / count) * Math.PI * 2, a1 = ((k + 1) / count) * Math.PI * 2, h = new THREE.Path();
    h.moveTo(...polar(rim, a0 + w / rim));
    h.absarc(0, 0, rim, a0 + w / rim, a1 - w / rim, false);
    h.lineTo(...polar(hub, a1 - w / hub));
    h.absarc(0, 0, hub, a1 - w / hub, a0 + w / hub, true);
    h.closePath();
    s.holes.push(h);
  }
}

// roue dentée biseautée, alésée pour son arbre, à rayons évidés si elle est grande
export function gearGeometry(n, thick, bore = 0.02) {
  return cached(`g${n}|${thick}|${bore}`, () => {
    const s = gearShape(n), R = pitchR(n), root = R - MODULE * 1.2;
    if (R > 0.36) addSpokes(s, root - Math.max(0.05, R * 0.1), Math.max(bore + 0.05, R * 0.2), R > 0.8 ? 6 : 5, Math.max(0.03, R * 0.07));
    if (bore > 0) s.holes.push(circlePath(bore));
    return plate(s, thick, Math.min(0.006, thick * 0.25), 6);
  });
}

// moyeu de roue / bague : pièce tournée, creuse si rIn > 0, chanfreinée
export function bushGeometry(rOut, h, rIn = 0, ch = null) {
  return cached(`b${rOut}|${h}|${rIn}`, () => {
    const c = ch ?? Math.min(h * 0.25, (rOut - rIn) * 0.3, 0.012);
    const pts = rIn > 0
      ? [[rIn, h / 2], [rIn, -h / 2], [rOut - c, -h / 2], [rOut, -h / 2 + c], [rOut, h / 2 - c], [rOut - c, h / 2], [rIn, h / 2]]
      : [[0, -h / 2], [rOut - c, -h / 2], [rOut, -h / 2 + c], [rOut, h / 2 - c], [rOut - c, h / 2], [0, h / 2]];
    return turned(pts, 32);
  });
}

// pont / bras plat : stade (bouts ronds) de 0 à len sur x, trous [x, r] facultatifs
export function bridgeGeometry(len, w, thick, holes = []) {
  return cached(`p${len.toFixed(3)}|${w}|${thick}|${holes.map((h) => h.join(',')).join(';')}`, () => {
    const s = new THREE.Shape(), r = w / 2;
    s.moveTo(0, -r); s.lineTo(len, -r); s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, r); s.absarc(0, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    for (const [x, hr] of holes) s.holes.push(circlePath(hr, x, 0));
    return plate(s, thick, 0.006, 12);
  });
}

// rochet à dents de scie (ne tourne que dans un sens, retenu par le cliquet)
export function ratchetGeometry(n, R, thick, bore) {
  return cached(`r${n}|${R}`, () => {
    const root = R * 0.84, p = (Math.PI * 2) / n, s = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = i * p;
      if (i === 0) s.moveTo(...polar(root, a));
      s.lineTo(...polar(R, a + 0.9 * p));
      s.lineTo(...polar(root, a + p));
    }
    s.holes.push(circlePath(bore));
    return plate(s, thick, 0.004, 4);
  });
}

// roue d'échappement à dents en crochet (club teeth), 15 dents, 4 rayons
export function escapeGeometry(R, thick, bore) {
  return cached(`e${R}`, () => {
    const n = 15, p = (Math.PI * 2) / n, rim = R * 0.72, s = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      [[rim, 0], [R * 0.98, 0.38], [R, 0.5], [R * 0.93, 0.56], [rim, 0.4]].forEach(([r, f], j) => {
        const [x, y] = polar(r, (i + f) * p); if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
      });
      s.lineTo(...polar(rim, (i + 1) * p));
    }
    addSpokes(s, rim - 0.025, bore + 0.03, 4, 0.018);
    s.holes.push(circlePath(bore));
    return plate(s, thick, 0.003, 4);
  });
}

// Phase d'engrènement : une roue A (angle de rotation rotA, nA dents) entraîne
// B (nB dents) dont le centre est dans la direction thC vue de A (angle monde,
// atan2(z, x)). Renvoie l'angle de rotation de B (rotation.y) pour que ses
// dents tombent dans les creux de A.
export function meshAngle(rotA, nA, nB, thC) {
  const pA = (Math.PI * 2) / nA, pB = (Math.PI * 2) / nB;
  // la forme est tracée dans le plan XY puis couchée (rotateX(-π/2)) :
  // angle monde = −angle forme − rotation.y
  const alpha = -0.5 * pA - rotA;
  const beta = thC + Math.PI - pB / 2 - (alpha - thC) * (nA / nB);
  return -0.5 * pB - beta;
}

// demi-arceau elliptique, du limbe jusqu'au collier de la trémie
export class ArchCurve extends THREE.Curve {
  constructor(dir, a, b, rEnd) { super(); this.dir = dir; this.a = a; this.b = b; this.te = Math.acos(rEnd / a); }
  getPoint(t, out = new THREE.Vector3()) {
    const th = this.te * t;
    return out.set(this.dir.x * this.a * Math.cos(th), this.b * Math.sin(th) - 0.05, this.dir.z * this.a * Math.cos(th));
  }
}

// pied : du dessous du limbe (rayon rLimb) jusqu'au patin sur la platine (yBase)
export const legCurve = (pt, rLimb, yBase) =>
  new THREE.CubicBezierCurve3(pt(rLimb, -0.14), pt(9.9, -2.6), pt(4.2, yBase + 0.55), pt(2.38, yBase + 0.07));

// ressort hélicoïdal / vis sans fin : hélice de rayon r, de hauteur h, en `turns` tours
export function helixCurve(r, h, turns, y0 = 0, n = 120) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * Math.PI * 2 * turns; pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + t * h, Math.sin(a) * r)); }
  return new THREE.CatmullRomCurve3(pts);
}
