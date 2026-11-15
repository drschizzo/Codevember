// Les chemins de la lumière, en TSL : mêmes formules que src/gen/optics.js
// (testées en Node contre des rayons réfléchis pas à pas). Chaque lumière de
// la scène multiplie sa couleur, au point éclairé x, par la part du front qui
// a atteint ce point ET dont la lumière renvoyée a eu le temps de rejoindre
// l'œil : gate(L(x) + |x − œil|).
//
// L'œil est la caméra qui rend l'image (cameraPosition) : dans le rendu du
// miroir, c'est la caméra virtuelle, symétrique de la vraie ; |x − œil′| est
// alors exactement le chemin x → glace → œil. Le reflet est en retard sur la
// pièce sans rien de plus.
import * as THREE from 'three/webgpu';
import {
  uniform, float, vec2, vec3, smoothstep, length, dot, normalize, max, min, abs, floor, cos, sin, asin, atan,
  select, step, clamp, cameraPosition, mix, cross, sqrt, acos, exp,
} from 'three/tsl';
import { BALL_LAT, FRONT, PULSE_LEN, PULSE_PEAK } from '../gen/optics.js';

const V = () => uniform(new THREE.Vector3());
export const P = {
  rho: uniform(60), front: uniform(FRONT), pulseLen: uniform(PULSE_LEN), peak: uniform(PULSE_PEAK),
  lamp: V(),
  // miroir plan
  mc: V(), mn: V(), mu: V(), mv: V(), mhw: uniform(0.3), mhh: uniform(0.4), mshape: uniform(0), msv: V(),
  // miroir elliptique
  ef1: V(), ef2: V(), ea: uniform(0.5), eaxis: V(), ecos: uniform(0.9), efMin: uniform(0.012),
  // boule à facettes
  bc: V(), br: uniform(0.08), brows: uniform(16), bcols: uniform(40), bspin: uniform(0), bsize: uniform(0.01),
  // galerie : plans des deux glaces, contours (cx, cy, demi-largeur, demi-hauteur)
  gzA: uniform(-0.5), gzB: uniform(2), gA: uniform(new THREE.Vector4(0, 0.5, 0.3, 0.4)), gB: uniform(new THREE.Vector4(0, 0.5, 0.8, 0.8)), gR: uniform(0.88),
  // œil réel (pour la brume, rendue dans une passe où cameraPosition est celle du quad)
  eye: V(),
  // brume : densité, et la lumière de chaque source (couleur × intensité ; 0 si absente)
  haze: uniform(0), cLamp: V(), cMirror: V(), cFocus: V(), cFacet: V(), cGallery: V(), frame: uniform(0),
};

// part de l'impulsion arrivée en un point par un chemin de longueur totale k
// (lampe → point → œil) : même formule que gate() dans optics.js
export const gateK = (k) => {
  const w = P.front.mul(0.5);
  const a = P.rho.sub(k);
  return smoothstep(w.negate(), w, a).mul(exp(a.max(0).div(P.pulseLen).negate())).mul(P.peak);
};
export const gate = (L, x, eye = cameraPosition) => gateK(L.add(length(x.sub(eye))));

// ── Miroir plan : la source image et l'ouverture de la glace ──
// renvoie { L, w } : chemin par la glace, et 1 si le segment s′ → x traverse
// la glace (bord adouci sur 2 mm), 0 sinon
export function planeEcho(x) {
  const sv = P.msv, d = x.sub(sv);
  const dn = dot(d, P.mn);
  const t = dot(P.mc.sub(sv), P.mn).div(select(abs(dn).lessThan(1e-6), float(1e-6), dn));
  const hit = sv.add(d.mul(t));
  const r = hit.sub(P.mc);
  const a = dot(r, P.mu).div(P.mhw), b = dot(r, P.mv).div(P.mhh);
  // « distance » normalisée au contour (≤ 1 dedans) selon la forme
  const rect = max(abs(a), abs(b));
  const oval = length(vec2(a, b));
  const k = P.mhw.div(P.mhh), y0 = float(1).sub(k);
  const arch = select(b.lessThan(y0), max(abs(a), b.negate()), length(vec2(a, b.sub(y0).div(k))));
  const q = select(P.mshape.lessThan(0.5), rect, select(P.mshape.lessThan(1.5), oval, arch));
  const edge = float(0.002).div(min(P.mhw, P.mhh));
  const inside = smoothstep(float(1).add(edge), float(1).sub(edge), q);
  const front = step(0, dot(x.sub(P.mc), P.mn));
  const valid = step(0, t).mul(step(t, 1));
  return { L: length(d), w: inside.mul(front).mul(valid) };
}

// ── Miroir elliptique ──
// avant le foyer f₂ : L = 2a − |x − f₂|, la lumière vient de la paroi (dans
// la direction de x − f₂) ; après : L = 2a + |x − f₂|, elle vient de f₂
export function ellipseEcho(x) {
  const r = x.sub(P.ef2), dr = length(r).max(1e-5), d = r.div(dr);
  const c = dot(d, P.eaxis);
  const D = P.ef2.sub(P.ef1);
  const a = P.ea;
  const rr = a.mul(a).mul(4).sub(dot(D, D)).div(dot(D, d).mul(2).add(a.mul(4)));
  // l'ampoule n'est pas un point : la calotte en forme une image de la taille
  // du filament (rayon efMin). Un point est éclairé quand sa distance au cône
  // de lumière (apex f₂, demi-angle θc) est inférieure à ce rayon : loin du
  // foyer c'est le cône, au foyer un disque de rayon efMin (la tache ardente)
  const th = acos(P.ecos);
  const perpB = dr.mul(sin(clamp(acos(clamp(c, -1, 1)).sub(th), 0, 1.5707)));
  const perpA = dr.mul(sin(clamp(acos(clamp(c.negate(), -1, 1)).sub(th), 0, 1.5707)));
  const before = smoothstep(P.efMin, P.efMin.mul(0.55), perpB).mul(step(dr, rr));
  const after = smoothstep(P.efMin, P.efMin.mul(0.55), perpA).mul(step(float(1e-4), c.negate().add(P.efMin.div(dr))));
  return {
    before, after,
    Lb: a.mul(2).sub(dr), La: a.mul(2).add(dr),
    dirB: d, dirA: d.negate(), dist: dr,
  };
}

// ── Boule à facettes ──
// la facette qui renvoie la lampe vers x : normale la plus proche de la
// bissectrice de (x − B) et (s − B) ; tache si le rayon s′ᶠ → x traverse
// la facette (un carré de côté bsize)
export function facetEcho(x) {
  const w = normalize(x.sub(P.bc)), l = normalize(P.lamp.sub(P.bc));
  const h = normalize(w.add(l));
  const LAT = BALL_LAT;
  const lat = asin(clamp(h.y, -1, 1));
  const i = floor(lat.add(LAT).div(2 * LAT).mul(P.brows));
  const rowOk = step(0, i).mul(step(i, P.brows.sub(1)));
  const latI = float(-LAT).add(i.add(0.5).div(P.brows).mul(2 * LAT));
  const nc = max(float(6), floor(P.bcols.mul(cos(latI)).add(0.5)));
  const odd = i.sub(floor(i.mul(0.5)).mul(2)).mul(0.5);
  const lon = atan(h.z, h.x).sub(P.bspin);
  const j = floor(lon.div(2 * Math.PI).mul(nc).sub(odd).add(0.5));
  const lonJ = j.add(odd).div(nc).mul(2 * Math.PI).add(P.bspin);
  const n = vec3(cos(latI).mul(cos(lonJ)), sin(latI), cos(latI).mul(sin(lonJ)));
  const t = vec3(sin(lonJ).negate(), 0, cos(lonJ));
  const b = cross(n, t).negate();
  const fc = P.bc.add(n.mul(P.br));
  const sv = P.lamp.sub(n.mul(dot(P.lamp.sub(fc), n).mul(2)));
  const d = x.sub(sv);
  const tt = dot(fc.sub(sv), n).div(dot(d, n).max(1e-6));
  const hit = sv.add(d.mul(tt));
  const q = hit.sub(fc);
  const half = P.bsize.mul(0.5);
  const e = float(0.0006);
  const inside = smoothstep(half.add(e), half.sub(e), max(abs(dot(q, t)), abs(dot(q, b))));
  const ok = rowOk.mul(step(0, dot(P.lamp.sub(fc), n))).mul(step(0, dot(x.sub(fc), n))).mul(step(0, tt)).mul(step(tt, 1));
  return { L: length(d), w: inside.mul(ok), hit, sv };
}

// ── Galerie : les images de la lampe entre deux glaces face à face ──
// Même construction que galleryImages() dans optics.js (testée contre des
// rayons réfléchis). Chaque image est une source ponctuelle d'intensité
// Rⁿ·I ; elle éclaire x si la droite image → x traverse chaque copie dépliée
// des glaces dans son contour. N réflexions au plus, de chaque côté.
export const GALLERY_N = 4;
export function galleryList({ skipA1 = false } = {}) {
  const out = [];
  const D = P.gzB.sub(P.gzA);
  for (const side of ['A', 'B']) {
    const z0 = side === 'A' ? P.gzA : P.gzB, sg = side === 'A' ? -1 : 1;
    for (let n = 1; n <= GALLERY_N; n++) {
      if (skipA1 && side === 'A' && n === 1) continue;
      const k = Math.floor((n - 1) / 2);
      const z = n % 2 ? z0.mul(2).sub(P.lamp.z).add(D.mul(sg * 2 * k)) : P.lamp.z.add(D.mul(sg * 2 * Math.ceil(n / 2)));
      const planes = [];
      for (let j = 0; j < n; j++) planes.push({ z: z0.add(D.mul(sg * j)), M: (j % 2 ? (side === 'A' ? P.gB : P.gA) : (side === 'A' ? P.gA : P.gB)) });
      out.push({ q: vec3(P.lamp.x, P.lamp.y, z), n, side, planes });
    }
  }
  return out;
}
// ouverture d'une image vue depuis un point x (1 si la droite traverse tous
// les contours, bord adouci sur 3 mm)
export function galleryAperture(im, x) {
  const d = x.sub(im.q);
  let ok = float(1);
  for (const pl of im.planes) {
    const t = pl.z.sub(im.q.z).div(d.z);
    const px = im.q.x.add(d.x.mul(t)), py = im.q.y.add(d.y.mul(t));
    const e = float(0.003);
    const ins = smoothstep(pl.M.z.add(e), pl.M.z.sub(e), abs(px.sub(pl.M.x))).mul(smoothstep(pl.M.w.add(e), pl.M.w.sub(e), abs(py.sub(pl.M.y))));
    ok = ok.mul(ins).mul(step(0, t)).mul(step(t, 1));
  }
  return ok;
}
// somme des échos de la galerie en x : { w (Σ Rⁿ·porte/r²), dir (direction
// pondérée vers les sources, monde) }
export function galleryEcho(x, eye = cameraPosition, opts = {}) {
  let w = float(0), dir = vec3(0);
  const inRoom = step(P.gzA, x.z).mul(step(x.z, P.gzB));
  const D = length(x.sub(eye));
  for (const im of galleryList(opts)) {
    const v = im.q.sub(x), r = length(v).max(1e-3);
    const c = galleryAperture(im, x).mul(gateK(r.add(D))).mul(P.gR.pow(im.n)).div(r.mul(r));
    w = w.add(c);
    dir = dir.add(v.div(r).mul(c));
  }
  return { w: w.mul(inRoom), dir };
}
