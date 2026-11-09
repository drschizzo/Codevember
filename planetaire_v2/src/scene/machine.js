// La machine, construite d'après sa conception (mech/design.js). Tout est
// porté : chaque roue tourne sur un tenon, chaque tenon est fixé à un bras,
// chaque bras pivote sur un canon, et la chaîne remonte jusqu'au poteau
// central (fixé au plateau) et au tube central (qui porte l'étoile des bras 0).
//
// Sous le plateau, montage concentrique : la couronne dentée est vissée sous
// le plateau, dont le canon repose sur un pont ; le tube central traverse le
// canon et porte sa roue sous le pont. Un arbre de renvoi, tenu entre le bâti
// et le pont, mène les deux par deux pignons ; le mouvement qui le fait
// tourner est dans le boîtier du pied.
//
// Angles, pour le bras i (θᵢ = kᵢ t + φᵢ) et le train qu'il porte (qui mène le
// bras i+1) : ψ = (k_{i−1} − kᵢ) t ; roue A (fixée au bras i−1) à θᵢ + ψ ;
// renvoi n et roue B, dans le repère du bras : (−1)ⁿ (z_A / z) ψ + off. Les
// décalages off calent chaque dent dans un creux à t = 0 ; rapports et
// entraxes exacts les y maintiennent.
//
// Coordonnées : le plan (x, y) de l'orbite est posé en (x, h, −y) ; une
// rotation d'angle θ autour de +y est la rotation du plan.
import * as THREE from 'three/webgpu';
import { uniform, positionLocal, normalLocal, positionPrevious, attribute, Fn, mat3, mat4, vec4, dot, float, vec2, vec3, sin, atan, length, fract, smoothstep, mix, abs, floor, max, fwidth, mx_cell_noise_float, materialColor, materialRoughness, materialMetalness } from 'three/tsl';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { designMachine, SLAB } from '../mech/design.js';
import { createDrive } from '../mech/drive.js';

const TAU = Math.PI * 2;
const BAR_T = 0.012, GEAR_T = 0.009, GEAR_DY = 0.016; // épaisseurs ; hauteur du train au-dessus du bras
const STUD_R = 0.0055;

// ── Finitions d'horlogerie ───────────────────────────────────────────────────
// Sur les faces supérieures (normale verticale) : un décor propre au rôle de
// la pièce, qui module la rugosité et, à peine, la teinte ; sur les chants et
// les biseaux : l'anglage, poli miroir, qui accroche la lumière. Une variation
// lente de la rugosité évite l'aspect « synthétique ». Tout est dans le repère
// de la pièce (le décor tourne avec elle) et s'efface quand il devient plus fin
// que le pixel. La couleur, la rugosité et le métal restent ceux de la matière
// (réglés par la recette) ; le décor ne marque que les métaux.
//   côtes : côtes de Genève (bandes parallèles brossées en arcs) — bras, ponts
//   soleil : soleillage (rayons brossés depuis l'axe) — roues
//   tournage : cercles fins concentriques — bâti, pied, colonnes
//   poli : seulement l'anglage et la variation — goupilles, vis
function workMetal(mat, kind) {
  const p = positionLocal;
  const top = smoothstep(0.8, 0.95, abs(normalLocal.y));
  // variation lente (deux sinus croisés : pas de bruit coûteux)
  const slow = sin(p.x.mul(23).add(sin(p.z.mul(17)).mul(2))).mul(sin(p.z.mul(29).add(p.y.mul(13)))).mul(0.5);
  let v = float(0), freq = null;
  if (kind === 'cotes') {
    // bandes d'environ 9 mm le long du bras, au profil arrondi
    const b = p.z.mul(110);
    const f = fract(b).sub(0.5);
    v = float(1).sub(f.mul(f).mul(4));
    freq = b;
  } else if (kind === 'soleil') {
    const th = atan(p.z, p.x), r = length(vec2(p.x, p.z));
    const a = th.mul(260);
    v = sin(a).mul(0.5).add(0.5).mul(smoothstep(0.004, 0.02, r));
    freq = a;
  } else if (kind === 'tournage') {
    const a = length(vec2(p.x, p.z)).mul(700);
    v = sin(a).mul(0.5).add(0.5);
    freq = a;
  }
  // (le décor s'efface sous le pixel : pas de moiré)
  const fade = freq ? smoothstep(0.6, 0.15, fwidth(freq)) : float(0);
  const deco = v.sub(0.5).mul(fade).mul(top).mul(materialMetalness);
  const edge = float(1).sub(top);
  const rough = materialRoughness.mul(mix(float(1), float(0.3), edge.mul(materialMetalness)))
    .add(deco.mul(0.16)).add(slow.mul(0.05).mul(materialRoughness)).clamp(0.03, 1);
  mat.roughnessNode = rough;
  // (les chants polis sont un peu plus clairs, le décor creuse à peine la teinte)
  mat.colorNode = materialColor.mul(float(1).add(edge.mul(0.06)).sub(deco.mul(0.1)).sub(slow.mul(0.03)));
}

// matières par rôle, réglées à vif depuis la recette
export const ROLES = ['plate', 'arms', 'arms2', 'gears', 'pins', 'foot'];
export function materials() {
  const make = () => new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.3 });
  const m = Object.fromEntries(ROLES.map((r) => [r, make()]));
  // rubis des paliers
  m.jewel = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.55, 0.01, 0.04), metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 });
  // finition du plateau : motif procédural sur la rugosité et la teinte
  // (guilloché : vagues concentriques ; soleil : rayons fins ; perlage : cercles
  // brossés qui se chevauchent), dans le repère du plateau
  const PF = { scale: uniform(1), amp: uniform(0), rough: uniform(0.3), color: uniform(new THREE.Color()) };
  m.plateFinish = PF;
  m.setFinish = (kind, scale = 1) => {
    const p = vec2(positionLocal.x, positionLocal.z).mul(PF.scale);
    const r = length(p), th = atan(p.y, p.x);
    // (motifs fins, à l'échelle des pièces : quelques millimètres ; ils
    // s'effacent quand ils deviennent plus fins que le pixel)
    let v = float(0), freq = float(0);
    if (kind === 'guilloche') { const a = r.mul(520).add(sin(th.mul(36)).mul(2.2)); v = sin(a).mul(0.5).add(0.5); freq = a; }
    else if (kind === 'soleil') { const a = th.mul(900); v = sin(a).mul(0.5).add(0.5).mul(smoothstep(0.05, 0.25, r)); freq = a; }
    else if (kind === 'perlage') {
      const q = p.mul(55), c = floor(q), f = fract(q).sub(0.5);
      const ring = fract(length(f).mul(9).add(mx_cell_noise_float(c).mul(3)));
      v = smoothstep(0.2, 0.8, ring).mul(smoothstep(0.5, 0.38, length(f)));
      freq = q.x.mul(9);
    }
    v = mix(float(0.5), v, smoothstep(0.7, 0.2, fwidth(freq)));
    PF.scale.value = scale;
    PF.amp.value = kind === 'lisse' ? 0 : 1;
    m.plate.roughnessNode = PF.rough.add(v.sub(0.5).mul(0.14).mul(PF.amp)).clamp(0.02, 1);
    m.plate.colorNode = PF.color.mul(float(1).sub(v.mul(0.07).mul(PF.amp)));
    m.plate.needsUpdate = true;
  };
  // émail des cadrans, encre des graduations, vis bleuies, courroies
  m.dial = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.86, 0.85, 0.8), metalness: 0, roughness: 0.25, clearcoat: 1 });
  m.ink = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.6 });
  m.screw = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.05, 0.08, 0.3), metalness: 1, roughness: 0.2, clearcoat: 0.6 });
  m.belt = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color().setRGB(0.05, 0.025, 0.015), roughness: 0.7 });
  // fond des sillons : la matière du plateau, assombrie et mate
  // (les courbes tournent dans un sens ou dans l'autre : rubans visibles des deux côtés)
  m.groove = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.6, roughness: 0.75, side: THREE.DoubleSide });
  m.lip = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.18, side: THREE.DoubleSide });
  // portail : un tronçon d'axe qui s'ouvre depuis son milieu (ouverture et
  // hauteur propres à chaque objet), bords embrasés d'or
  {
    const open = uniform(0).onObjectUpdate(({ object }) => object.userData.open || 0);
    const hh = uniform(0.03).onObjectUpdate(({ object }) => object.userData.h || 0.03);
    const d = abs(positionLocal.y.sub(hh.mul(0.5)));
    const edge = open.mul(hh.mul(0.5).add(0.003));
    const glow = smoothstep(edge.add(0.007), edge, d).mul(smoothstep(0, 0.08, open));
    const pm = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.25, side: THREE.DoubleSide });
    pm.maskNode = d.greaterThan(edge);
    pm.maskShadowNode = d.greaterThan(edge);
    pm.emissiveNode = vec3(1.0, 0.62, 0.28).mul(glow.mul(glow).mul(9));
    m.portal = pm;
  }
  m.bridge = m.arms;
  m.bezel = m.foot;
  workMetal(m.arms, 'cotes'); workMetal(m.arms2, 'cotes');
  workMetal(m.gears, 'soleil'); workMetal(m.foot, 'tournage'); workMetal(m.pins, 'poli');
  m.apply = (matters, table) => {
    for (const role of ROLES) {
      const t = table[matters[role]], x = m[role];
      if (!t) continue;
      x.color.setRGB(...t.color); x.metalness = t.metal; x.roughness = t.rough;
      x.clearcoat = t.coat; x.clearcoatRoughness = 0.08;
      x.iridescence = t.irid || 0; x.sheen = t.sheen || 0;
    }
    const pl = table[matters.plate];
    if (pl) { PF.rough.value = pl.rough; PF.color.value.setRGB(...pl.color); }
    if (pl) { m.groove.color.setRGB(...pl.color.map((c) => c * 0.22)); m.groove.metalness = pl.metal * 0.6; }
    const pn = table[matters.pins];
    if (pn) { m.lip.color.setRGB(...pn.color); m.lip.metalness = pn.metal; m.portal.color.setRGB(...pn.color); m.portal.metalness = pn.metal; m.portal.roughness = pn.rough; }
  };
  return m;
}

// ── Géométries ───────────────────────────────────────────────────────────────

// pose une forme du plan (x, y) à plat : (x, 0, −y), épaisseur centrée sur 0.
// Arêtes adoucies : un arrondi en quart de cercle (trois facettes) aux normales
// lissées, qui accroche la lumière sous tous les angles (un chanfrein unique, à
// normales plates, ne brille que sous un seul) ; les angles vifs du contour
// (dents, ajours) restent vifs (normales lissées sous 50° seulement).
// bevel : taille de l'arrondi en fraction de l'épaisseur ; size : taille
// imposée (en mètres), pour les pièces aux détails fins (dentures).
const CREASE = (50 * Math.PI) / 180;
export function flat(shape, thick, bevel = 0.25, curveSegments = 12, size = null) {
  const b = size ?? thick * bevel * 0.5;
  const g0 = new THREE.ExtrudeGeometry(shape, { depth: thick - (b > 0 ? 2 * b : 0), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3, curveSegments });
  g0.deleteAttribute('uv');
  const g = b > 0 ? toCreasedNormals(g0, CREASE) : g0;
  if (g !== g0) g0.dispose();
  g.translate(0, 0, -thick / 2 + (b > 0 ? b : 0));
  g.rotateX(-Math.PI / 2);
  return g;
}

// solide de révolution autour de y, profil (r, y) en partant de l'axe, au
// bas : chaque point porte sa normale (nr, ny). Normales lisses le long du profil.
function revolve(prof, seg) {
  const m = prof.length, pos = new Float32Array((seg + 1) * m * 3), nrm = new Float32Array((seg + 1) * m * 3), idx = [];
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * TAU, c = Math.cos(a), sn = Math.sin(a);
    for (let i = 0; i < m; i++) {
      const [r, y, nr, ny] = prof[i], o = (s * m + i) * 3;
      pos[o] = r * c; pos[o + 1] = y; pos[o + 2] = -r * sn;
      nrm[o] = nr * c; nrm[o + 1] = ny; nrm[o + 2] = -nr * sn;
    }
  }
  for (let s = 0; s < seg; s++) for (let i = 0; i < m - 1; i++) {
    const a = s * m + i, b = (s + 1) * m + i;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// cylindre (ou tronc de cône : r en bas, r2 en haut) aux arêtes arrondies,
// posé sur y = 0 ; l'arrondi est proportionné à la pièce
function roundCyl(r, h, seg, r2 = r, fillet = null) {
  const f = Math.max(0, Math.min(fillet ?? 0.2 * Math.min(r, r2), 0.42 * h, 0.45 * Math.min(r, r2)));
  if (f < 1e-5) { const g = new THREE.CylinderGeometry(r2, r, h, seg); g.translate(0, h / 2, 0); return g; }
  // normale du flanc (vers l'extérieur) ; centres des arrondis, tangents au fond et au flanc
  const L = Math.hypot(h, r - r2), nsr = h / L, nsy = (r - r2) / L;
  const xb = r - (f * (1 + nsy)) / nsr, xt = r2 - (f * (1 - nsy)) / nsr;
  const aS = Math.atan2(nsy, nsr), prof = [[0, 0, 0, -1], [xb, 0, 0, -1]];
  const K = 4;
  for (let q = 1; q <= K; q++) { const a = -Math.PI / 2 + (q / K) * (aS + Math.PI / 2); prof.push([xb + f * Math.cos(a), f + f * Math.sin(a), Math.cos(a), Math.sin(a)]); }
  for (let q = 0; q < K; q++) { const a = aS + (q / K) * (Math.PI / 2 - aS); prof.push([xt + f * Math.cos(a), h - f + f * Math.sin(a), Math.cos(a), Math.sin(a)]); }
  prof.push([xt, h, 0, 1], [0, h, 0, 1]);
  return revolve(prof, seg);
}

// roue dentée : dents trapézoïdales centrées sur les angles 2πi/z, alésage,
// bras (rayons) pour les grandes roues, ou couronne (anneau) ; une denture plus
// fine que le pixel devient un simple disque
const gearCache = new Map();
// styles : spokes5 (horlogerie), spokes8 (astrolabe), holes (planétaire
// classique : ajours ronds), solid (atelier : pleine), pulley (poulie lisse),
// escape (roue d'échappement : dents pointues)
export function gearGeometry(z, r, { thick = GEAR_T, ring = 0, style = 'spokes5' } = {}) {
  const key = `${z}:${r.toFixed(5)}:${thick}:${ring}:${style}`;
  if (gearCache.has(key)) return gearCache.get(key);
  const m = (2 * r) / z, p = TAU / z;
  const rTip = r + m, rRoot = Math.max(r * 0.5, r - 1.25 * m);
  const shape = new THREE.Shape();
  if (m < 0.0014 || style === 'pulley') shape.absarc(0, 0, style === 'pulley' ? r : r, 0, TAU, false);
  else if (style === 'escape') {
    for (let i = 0; i < z; i++) {
      const a = i * p;
      const pts = [[rRoot, a - 0.42 * p], [rTip * 1.04, a + 0.05 * p], [rTip * 0.96, a + 0.18 * p], [rRoot, a + 0.3 * p]];
      pts.forEach(([rr, b], kk) => (i === 0 && kk === 0 ? shape.moveTo(rr * Math.cos(b), rr * Math.sin(b)) : shape.lineTo(rr * Math.cos(b), rr * Math.sin(b))));
    }
    shape.closePath();
  } else {
    for (let i = 0; i < z; i++) {
      const a = i * p;
      const pts = [[rRoot, a - 0.3 * p], [rTip, a - 0.13 * p], [rTip, a + 0.13 * p], [rRoot, a + 0.3 * p]];
      pts.forEach(([rr, b], kk) => (i === 0 && kk === 0 ? shape.moveTo(rr * Math.cos(b), rr * Math.sin(b)) : shape.lineTo(rr * Math.cos(b), rr * Math.sin(b))));
    }
    shape.closePath();
  }
  const bore = new THREE.Path();
  bore.absarc(0, 0, ring ? rRoot - ring : Math.max(STUD_R * 1.15, r * 0.1), 0, TAU, true);
  shape.holes.push(bore);
  // ajours : ronds (classique), ou bras de roue entre moyeu et serge
  if (!ring && style === 'holes' && r > 0.025) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU, h = new THREE.Path();
      h.absarc(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56, r * 0.17, 0, TAU, true);
      shape.holes.push(h);
    }
  } else if (!ring && style === 'pulley' && r > 0.025) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4, h = new THREE.Path();
      h.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.2, 0, TAU, true);
      shape.holes.push(h);
    }
  } else if (!ring && (style === 'spokes5' || style === 'spokes8' || style === 'escape') && r > 0.03) {
    const ns = style === 'spokes8' ? 8 : style === 'escape' ? 4 : 5, rIn = r * 0.26, rOut = rRoot - Math.max(0.006, r * 0.1);
    const wSp = style === 'spokes8' ? 0.035 : 0.06;
    const gapO = Math.max(0.004, r * wSp) / rOut, gapI = Math.max(0.004, r * wSp) / rIn;
    for (let s = 0; s < ns; s++) {
      const a0 = (s / ns) * TAU, a1 = ((s + 1) / ns) * TAU;
      const h = new THREE.Path();
      h.absarc(0, 0, rOut, a0 + gapO, a1 - gapO, false);
      h.absarc(0, 0, rIn, a1 - gapI, a0 + gapI, true);
      h.closePath();
      shape.holes.push(h);
    }
  }
  // (arrondi à l'échelle de la denture : il ne doit pas manger les dents)
  const g = flat(shape, thick, 0.3, 12, Math.min(thick * 0.18, m * 0.22));
  gearCache.set(key, g);
  return g;
}

// bras : un plat aux bouts arrondis, de −cw (contrepoids) à L, ajouré s'il est long
// styles : plain (horlogerie : pont ajouré), lyre (classique : effilé vers le
// bout), truss (atelier : treillis à ajours triangulaires), scroll (astrolabe :
// chapelet d'ajours ronds)
function barGeometry(L, w, cw, style = 'plain') {
  const s = new THREE.Shape(), h = w / 2;
  if (style === 'lyre') {
    s.moveTo(L, -h * 0.55);
    s.absarc(L, 0, h * 0.55, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, h * 1.35);
    s.absarc(-cw, 0, h * 1.35, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.lineTo(L, -h * 0.55);
    if (L > 0.1) { const ho = new THREE.Path(); ho.absarc(L * 0.16, 0, h * 0.62, 0, TAU, true); s.holes.push(ho); }
    return flat(s, BAR_T, 0.42);
  }
  s.absarc(L, 0, h, -Math.PI / 2, Math.PI / 2, false);
  s.absarc(-cw, 0, h * 1.25, Math.PI / 2, (3 * Math.PI) / 2, false);
  s.closePath();
  if (style === 'truss' && L > 0.1) {
    const n = Math.max(2, Math.floor((L * 0.8) / (w * 1.3))), step = (L * 0.8) / n, x0 = L * 0.1, hh = h * 0.55;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * step + w * 0.12, xb = x0 + (i + 1) * step - w * 0.12, up = i % 2 ? 1 : -1, t = new THREE.Path();
      t.moveTo(xa, -up * hh); t.lineTo(xb, -up * hh); t.lineTo((xa + xb) / 2, up * hh); t.closePath();
      s.holes.push(t);
    }
    return flat(s, BAR_T, 0.42);
  }
  if (style === 'scroll' && L > 0.08) {
    const n = Math.max(1, Math.floor((L * 0.75) / (w * 1.1)));
    for (let i = 0; i < n; i++) { const ho = new THREE.Path(); ho.absarc(L * 0.14 + (i + 0.5) * ((L * 0.72) / n), 0, h * 0.5, 0, TAU, true); s.holes.push(ho); }
    return flat(s, BAR_T, 0.42);
  }
  if (L > 0.14) {
    const a = L * 0.2, b = L * 0.8, hh = h * 0.42, hole = new THREE.Path();
    hole.absarc(b, 0, hh, -Math.PI / 2, Math.PI / 2, false);
    hole.absarc(a, 0, hh, Math.PI / 2, (3 * Math.PI) / 2, false);
    hole.closePath();
    s.holes.push(hole);
  }
  return flat(s, BAR_T, 0.42);
}

// cylindre posé sur y = 0 (arêtes arrondies) ; cylC : centré sur y = 0
export const cyl = (r, h, seg = 20, r2 = r, fillet = null) => roundCyl(r, Math.max(h, 1e-4), seg, r2, fillet);
export const cylC = (r, h, seg = 20, r2 = r, fillet = null) => { const g = cyl(r, h, seg, r2, fillet); g.translate(0, -Math.max(h, 1e-4) / 2, 0); return g; };

// ── Calage des dents ─────────────────────────────────────────────────────────
// gears alignées sur +x (centres croissants), angles relatifs à t = 0 : la
// première dent de la première roue pointe vers +x ; chaque roue suivante
// présente un creux à la dent qui la mène
export function meshOffsets(zs) {
  const off = [0];
  for (let g = 1; g < zs.length; g++) {
    const pPrev = TAU / zs[g - 1], p = TAU / zs[g];
    const fPrev = ((((0 - off[g - 1]) / pPrev) % 1) + 1) % 1;
    const f = (((0.5 - fPrev) % 1) + 1) % 1;
    off.push(Math.PI - f * p);
  }
  return off;
}

// ruban posé à plat le long d'une courbe fermée du plan (sillon) : y constant,
// largeur w ; coordonnées (x, y) → (x, h, −y)
export function ribbonGeometry(pts, w, h) {
  const n = pts.length / 2, pos = new Float32Array(n * 2 * 3), nrm = new Float32Array(n * 2 * 3), idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    let tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = -ty, ny = tx, x = pts[2 * i], y = pts[2 * i + 1];
    for (let sd = 0; sd < 2; sd++) {
      const o = (i * 2 + sd) * 3, f = sd ? -w / 2 : w / 2;
      pos[o] = x + nx * f; pos[o + 1] = h; pos[o + 2] = -(y + ny * f);
      nrm[o + 1] = 1;
    }
    const i2 = (i + 1) % n;
    idx.push(i * 2, i2 * 2, i * 2 + 1, i2 * 2, i2 * 2 + 1, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// ── Fusion des pièces fixes ──────────────────────────────────────────────────
function mergeStatic(roots, update, keep) {
  const P = new Float64Array(2 * 64);
  const seen = new Map(); // mesh → matrice locale au premier instant
  const moved = new Set();
  [0.37, 2.91, 5.13].forEach((tau, s) => {
    update(tau, P);
    for (const r of roots) r.traverse((o) => {
      if (!o.isMesh) return;
      o.updateMatrix();
      if (!s) seen.set(o, o.matrix.clone());
      else if (!o.matrix.equals(seen.get(o))) moved.add(o);
    });
  });
  const parents = new Set();
  for (const o of seen.keys()) parents.add(o.parent);
  for (const parent of parents) {
    const buckets = new Map();
    for (const o of parent.children) {
      if (!o.isMesh || o.isInstancedMesh || moved.has(o) || o.children.length || !o.visible || o.renderOrder || o.userData.anim) continue;
      const k = `${o.material.id}:${o.castShadow}:${o.receiveShadow}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(o);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((o) => {
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        g.clearGroups();
        return g.applyMatrix4(o.matrix);
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(keep(merged), list[0].material);
      m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
      for (const o of list) parent.remove(o);
      parent.add(m);
    }
  }
}

// ── Chaînes instanciées ──────────────────────────────────────────────────────
// Les bras restent des groupes (détachés de la scène) qui portent les
// transformations ; leurs pièces sont dessinées par instanciation (une
// instance par chaîne), avec leurs propres matières.
//
// Pas d'InstancedMesh : three.js compile un shader par InstancedMesh (la clé
// de son cache contient l'identifiant de l'objet, et le tampon des matrices
// porte un nom unique dans le code), soit plusieurs centaines de shaders pour
// trois machines, et l'essentiel du temps de chargement. Ici, chaque pièce est
// un Mesh ordinaire dont la géométrie porte la matrice de chaque instance
// (attributs im0…im3, et ip0…ip3 pour l'image précédente : les vitesses de
// l'anticrénelage temporel) ; la matière les applique dans son positionNode.
// Toutes les pièces d'une même matière partagent alors le même shader.
const instanced = (mat) => {
  const m = mat.clone();
  const col = (p) => [0, 1, 2, 3].map((i) => attribute(`${p}${i}`, 'vec4'));
  const cur = col('im'), prev = col('ip');
  m.positionNode = Fn(() => {
    positionPrevious.assign(mat4(...prev).mul(vec4(positionLocal, 1)).xyz);
    // (matrice de rotation et d'échelle : colonnes orthogonales)
    const c0 = cur[0].xyz, c1 = cur[1].xyz, c2 = cur[2].xyz;
    normalLocal.assign(mat3(c0, c1, c2).mul(normalLocal.div(vec3(dot(c0, c0), dot(c1, c1), dot(c2, c2)))));
    return mat4(...cur).mul(vec4(positionLocal, 1)).xyz;
  })();
  return m;
};
function instanceChains(chains, group, n, keep) {
  const parts = [];
  const clones = new Map();
  const matFor = (m) => { if (!clones.has(m)) clones.set(m, instanced(m)); return clones.get(m); };
  // signature d'une pièce : matière, sommets et boîte englobante. Les chaînes
  // ne sont pas toutes identiques : d'une chaîne à l'autre, un même bras peut
  // être à un autre étage, et ses pièces fusionnées (goupille, chaton, axe,
  // colonnes) n'ont alors pas la même hauteur. On n'instancie ensemble que les
  // chaînes dont les pièces sont exactement les mêmes.
  const sig = (c) => {
    if (!c.isMesh || c.children.length || c.userData.anim) return null; // (portail : son ouverture est propre à chaque chaîne)
    const g = c.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox, r = (x) => Math.round(x * 1e5);
    return `${c.material.id}:${g.attributes.position.count}:${r(b.min.x)},${r(b.min.y)},${r(b.min.z)},${r(b.max.x)},${r(b.max.y)},${r(b.max.z)}`;
  };
  for (let i = 0; i < n; i++) {
    const byShape = new Map();
    for (const ch of chains) {
      const g = ch.arm[i], ss = g.children.map(sig);
      if (ss.includes(null)) continue; // (ce bras reste tel quel)
      const key = ss.join('|');
      if (!byShape.has(key)) byShape.set(key, []);
      byShape.get(key).push(g);
    }
    for (const gs of byShape.values()) {
      const kids = gs[0].children;
      kids.forEach((c0, ci) => {
        // la géométrie de la pièce (position et normale, partagées), plus les matrices des instances
        const ig = keep(new THREE.InstancedBufferGeometry());
        ig.setIndex(c0.geometry.index);
        ig.setAttribute('position', c0.geometry.attributes.position);
        ig.setAttribute('normal', c0.geometry.attributes.normal);
        ig.instanceCount = gs.length;
        const bufs = ['im', 'ip'].map((p) => {
          const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(16 * gs.length), 16, 1).setUsage(THREE.DynamicDrawUsage);
          for (let q = 0; q < 4; q++) ig.setAttribute(`${p}${q}`, new THREE.InterleavedBufferAttribute(ib, 4, 4 * q));
          return ib;
        });
        const im = new THREE.Mesh(ig, matFor(c0.material));
        im.castShadow = c0.castShadow; im.receiveShadow = c0.receiveShadow;
        im.frustumCulled = false; // (les instances bougent : la sphère englobante serait fausse)
        group.add(im);
        parts.push({ cur: bufs[0], prev: bufs[1], gs, src: gs.map((g) => g.children[ci]) });
      });
      for (const g of gs) g.removeFromParent();
    }
  }
  const M4 = new THREE.Matrix4();
  const groups = new Set(parts.flatMap((p) => p.gs));
  let primed = false;
  // les matrices de l'image qu'on vient de dessiner deviennent les précédentes
  const after = () => { for (const { cur, prev } of parts) { prev.array.set(cur.array); prev.needsUpdate = true; } };
  const sync = () => {
    for (const g of groups) g.updateMatrix();
    for (const { cur, gs, src } of parts) {
      for (let j = 0; j < gs.length; j++) { src[j].updateMatrix(); M4.multiplyMatrices(gs[j].matrix, src[j].matrix).toArray(cur.array, 16 * j); }
      cur.needsUpdate = true;
    }
    if (!primed) { primed = true; after(); }
  };
  return { sync, after };
}

// ── La machine ───────────────────────────────────────────────────────────────
//
// La pile monte depuis le plateau : l'étoile des bras 0 juste au-dessus de
// lui, chaque bras un étage plus haut que celui qui le porte, son train
// d'engrenages au-dessus de lui ; les astres au sommet, au-dessus de toutes
// les roues, chacun sur sa goupille. L'étoile, qui porte tout, roule sur des
// galets dont les patins glissent dans des sillons circulaires du plateau ;
// les autres bras qui le peuvent reposent aussi sur une colonne et un sillon
// (mech/design.js choisit où la poser pour qu'aucune pièce ne la croise).

export const Y_PLATE = -0.34;
const CLEAR = 0.05;      // du plateau au dessous de la pile (hauteur des galets de l'étoile)
const BODY_CLEAR = 0.07;  // du sommet de la pile au plan des astres
const GAP = 0.004;        // jeu entre un bras et le train qu'il porte

// archétypes : style des roues, des bras, transmission (courroies : atelier)
export const ARCHETYPES = {
  horlogerie: { label: 'Mouvement d’horlogerie', gear: 'spokes5', bar: 'plain', belts: false },
  classique: { label: 'Planétaire classique', gear: 'holes', bar: 'lyre', belts: false },
  atelier: { label: 'Atelier (courroies)', gear: 'solid', bar: 'truss', belts: true },
  astrolabe: { label: 'Astrolabe', gear: 'spokes8', bar: 'scroll', belts: false },
};

// design : la conception déjà calculée (dans un worker, voir orbit/client.js) ;
// sinon elle est calculée ici
export function createMachine({ arms, N, mats, omegaFrac, yFloor = -0.72, archetype = 'horlogerie', design = null }) {
  const D = design || designMachine(arms, N);
  const AR = ARCHETYPES[archetype] || ARCHETYPES.horlogerie;
  const GS = { style: AR.gear };
  const n = D.n, k = D.k, L = D.L, phi = D.phi;
  const group = new THREE.Group();   // tourne avec le plateau
  const stand = new THREE.Group();   // fixe (studio)
  const geos = new Set();
  const keep = (g) => (geos.add(g), g);
  const mesh = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; return o; };

  // ── hauteurs
  const yPlate = Y_PLATE;
  const yTop = yPlate + CLEAR + D.height;
  const slabBase = (i, j) => yPlate + CLEAR + D.base[i] + D.level[i][j] * SLAB;
  const yBar = (i, j) => slabBase(i, j) + BAR_T / 2;                      // milieu du bras
  const yGear = (i, j) => slabBase(i, j) + BAR_T + GAP + GEAR_T / 2;      // milieu du train porté par le bras i
  const yGroove = yPlate + 0.0004, yBody = yTop + BODY_CLEAR;

  // ── plateau, jonc, graduations
  // le plateau ne porte que ce qui repose sur lui : l'étoile des bras 0 (avec
  // ses roues et ses contrepoids) et les sillons où glissent les galets. Les
  // bras des étages supérieurs le surplombent librement ; le mouvement est sur
  // un bâti fixe autour de lui (mech/drive.js)
  let sweep = 0;
  {
    const Pq = new Float64Array(2 * n + 2);
    for (let s = 0; s < 720; s++) {
      D.pivots((TAU * s) / 720, Pq);
      const x1 = Pq[2], y1 = Pq[3];
      sweep = Math.max(sweep, Math.hypot(x1, y1) + D.halfW[0], D.cw[0] + Math.max(0.006, D.barW[0] * 0.95));
      // galets : patin de rayon 0.014 dans un sillon de 0.032 bordé de lèvres
      D.supports.forEach((us, a) => (us || []).forEach((u) => {
        const px = Pq[2 * a] + u * (Pq[2 * a + 2] - Pq[2 * a]), py = Pq[2 * a + 1] + u * (Pq[2 * a + 3] - Pq[2 * a + 1]);
        sweep = Math.max(sweep, Math.hypot(px, py) + 0.022);
      }));
    }
  }
  const plateR = Math.max(0.45, sweep + 0.06);
  // ce que balaient les astres (pour le cadrage : ils peuvent survoler le bâti)
  let bodyReach = 0;
  {
    const Pq = new Float64Array(2 * n + 2);
    for (let s = 0; s < 720; s++) { D.pivots((TAU * s) / 720, Pq); bodyReach = Math.max(bodyReach, Math.hypot(Pq[2 * n], Pq[2 * n + 1])); }
  }
  const plate = mesh(keep(cylC(plateR, 0.06, 180, plateR, 0.008)), mats.plate);
  plate.position.y = yPlate - 0.03;
  group.add(plate);
  const rim = mesh(keep(new THREE.TorusGeometry(plateR - 0.02, 0.016, 12, 220)), mats.arms);
  rim.rotation.x = Math.PI / 2; rim.position.y = yPlate;
  group.add(rim);
  {
    const tick = keep(new THREE.BoxGeometry(0.05, 0.003, 0.005));
    const ticks = new THREE.InstancedMesh(tick, mats.pins, 120);
    const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU, long = i % 10 === 0 ? 2 : i % 5 === 0 ? 1.5 : 1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      p.set(Math.cos(a) * (plateR - 0.06 - 0.012 * long), yPlate + 0.0015, Math.sin(a) * (plateR - 0.06 - 0.012 * long));
      s.set(long, 1, 1);
      ticks.setMatrixAt(i, M4.compose(p, q, s));
    }
    ticks.receiveShadow = true;
    group.add(ticks);
  }

  // ── sillons : la courbe décrite par chaque patin (la même pour toutes les chaînes)
  const P = new Float64Array(2 * n + 2);
  const grooveCurves = [];
  D.supports.forEach((us, a) => (us || []).forEach((u) => {
    const m = 1600, pts = new Float32Array(m * 2);
    for (let s = 0; s < m; s++) {
      D.pivots((TAU * s) / m, P);
      pts[2 * s] = P[2 * a] + u * (P[2 * a + 2] - P[2 * a]);
      pts[2 * s + 1] = P[2 * a + 1] + u * (P[2 * a + 3] - P[2 * a + 1]);
    }
    grooveCurves.push({ a, pts });
    const floor = mesh(keep(ribbonGeometry(pts, 0.032, yGroove)), mats.groove, false);
    group.add(floor);
    for (const sd of [-1, 1]) {
      // lèvres du sillon (chanfrein qui accroche la lumière)
      const lipPts = new Float32Array(pts.length);
      for (let s = 0; s < m; s++) {
        const a2 = (s + m - 1) % m, b2 = (s + 1) % m;
        let tx = pts[2 * b2] - pts[2 * a2], ty = pts[2 * b2 + 1] - pts[2 * a2 + 1];
        const l = Math.hypot(tx, ty) || 1;
        lipPts[2 * s] = pts[2 * s] - (ty / l) * sd * 0.017;
        lipPts[2 * s + 1] = pts[2 * s + 1] + (tx / l) * sd * 0.017;
      }
      group.add(mesh(keep(ribbonGeometry(lipPts, 0.003, yPlate + 0.0007)), mats.lip, false));
    }
  }));

  // ── centre : poteau fixé au plateau (porte la roue solaire, au-dessus de
  // l'étoile), tube tournant autour de lui (porte l'étoile)
  const train0 = D.trains[1];
  const ySun = yGear(0, 0);
  const post = mesh(keep(cyl(0.011, ySun + GEAR_T / 2 + 0.01 - yPlate)), mats.pins);
  post.position.y = yPlate; group.add(post);
  let sun = null;
  if (train0) {
    sun = mesh(gearGeometry(train0.gears[0].z, train0.gears[0].r, AR.belts ? { style: 'pulley' } : GS), mats.gears);
    sun.position.y = ySun;
    group.add(sun);
  }
  const starHub = mesh(keep(cyl(0.045, BAR_T * 1.8, 32)), mats.arms);
  starHub.position.y = yBar(0, 0) - BAR_T * 0.9;
  group.add(starHub);
  const finial = mesh(keep(new THREE.SphereGeometry(0.018, 20, 12)), mats.pins);
  finial.position.y = ySun + GEAR_T / 2 + 0.01;
  group.add(finial);

  // planétaire classique : sphère armillaire au sommet du poteau, si aucun astre
  // ne passe au-dessus du centre
  let armillary = null;
  {
    let rMin = Infinity;
    const Pq = new Float64Array(2 * n + 2);
    for (let s = 0; s < 256; s++) { D.pivots((TAU * s) / 256, Pq); rMin = Math.min(rMin, Math.hypot(Pq[2 * n], Pq[2 * n + 1])); }
    if (archetype === 'classique' && rMin > 0.2) {
      armillary = new THREE.Group();
      const ra = 0.07;
      for (let i = 0; i < 3; i++) { const t = mesh(keep(new THREE.TorusGeometry(ra, 0.003, 8, 64)), mats.arms); t.rotation.set(Math.PI / 2 + (i === 1 ? 0.41 : 0), i * 1.05, 0); armillary.add(t); }
      const globe = mesh(keep(new THREE.SphereGeometry(ra * 0.3, 24, 12)), mats.arms2); armillary.add(globe);
      armillary.position.y = yPlate + CLEAR + D.height + 0.04;
      group.add(armillary);
      const rod = mesh(keep(cyl(0.004, armillary.position.y - yPlate)), mats.pins);
      rod.position.y = yPlate; group.add(rod);
    }
  }

  // ── les passages (portails). Là où une dalle d'une autre chaîne traverse
  // forcément un axe vertical (mech/design.js, portals), l'axe s'ouvre à la
  // hauteur de cette dalle le temps qu'elle passe : le tronçon s'efface depuis
  // son milieu, ses bords s'embrasent d'or, puis il se referme. gapsOf(j, p) :
  // tronçons (hauteurs du monde) de l'axe p de la chaîne j, avec leurs fenêtres.
  const gapsOf = (j, p) => {
    const lvY = (l) => yPlate + CLEAR + l * SLAB;
    const list = (D.portals?.[j]?.[p] || []).map(({ l0, l1, win }) => (
      // (de sous le contrepoids, qui descend sous le bras, au-dessus du train)
      { y0: lvY(l0) - 0.011, y1: lvY(l1) + BAR_T + GAP + GEAR_T + 0.004, win: win.slice() }
    )).sort((a, b) => a.y0 - b.y0);
    const out = [];
    for (const q of list) {
      const last = out[out.length - 1];
      if (last && q.y0 <= last.y1) { last.y1 = Math.max(last.y1, q.y1); last.win.push(...q.win); } else out.push(q);
    }
    return out;
  };
  const portalsList = [];
  // axe de rayon r, en x le long du bras, de yA à yB (repère du groupe g, dont
  // l'origine est à la hauteur oy) : tronçons fixes et tronçons qui s'ouvrent
  function shaft(g, oy, r, x, yA, yB, gaps, mat) {
    const cuts = gaps.map((q) => [Math.max(q.y0 - oy, yA), Math.min(q.y1 - oy, yB), q.win]).filter((c) => c[1] - c[0] > 1e-4);
    let y = yA;
    const piece = (a, b, m) => { const o = mesh(keep(cyl(r, b - a, 16)), m); o.position.set(x, a, 0); g.add(o); return o; };
    for (const [a, b, win] of cuts) {
      if (a > y + 1e-4) piece(y, a, mat);
      const o = piece(Math.max(a, y), b, mats.portal);
      o.userData.anim = true; o.userData.open = 0; o.userData.h = b - Math.max(a, y); o.userData.win = win;
      o.castShadow = true;
      portalsList.push(o);
      y = Math.max(y, b);
    }
    if (yB > y + 1e-4) piece(y, yB, mat);
  }

  // ── les chaînes
  const chains = [];
  const barGeos = L.map((l, i) => keep(barGeometry(l, D.barW[i], D.cw[i], AR.bar)));
  for (const tr of D.trains) if (tr) tr.off = meshOffsets(tr.gears.map((g) => g.z));
  for (let j = 0; j < N; j++) {
    const ch = { arm: [], idlers: [], tipA: [] };
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const oy = yBar(i, j); // origine du groupe : milieu du bras
      g.position.y = oy;
      g.add(mesh(barGeos[i], i % 2 ? mats.arms2 : mats.arms));
      // quincaillerie du rang (réduite d'un facteur σ dans la tête de la chaîne,
      // pour qu'elle tienne autour de son astre : voir mech/design.js)
      const sc = D.hw ? D.hw[i] : 1;
      // contrepoids
      const cwR = D.cwR ? D.cwR[i] : Math.max(0.006, D.barW[i] * 0.95);
      const cwm = mesh(keep(cyl(cwR, BAR_T * 2.4, 24)), mats.arms);
      cwm.position.set(-D.cw[i], -BAR_T * 1.2, 0);
      g.add(cwm);
      // moyeu, rubis, vis
      const hubR = D.hubR ? D.hubR[i] : Math.max(0.009, D.barW[i] * 0.5);
      const hub = mesh(keep(cyl(hubR, BAR_T * 1.6, 20)), mats.pins);
      hub.position.y = -BAR_T * 0.8;
      g.add(hub);
      const jewel = mesh(keep(cyl(hubR * 0.45, 0.0008, 16)), mats.jewel, false);
      jewel.position.y = BAR_T * 0.8;
      g.add(jewel);
      if (L[i] > 0.08) {
        for (const sx of [0.1, 0.9]) {
          const screw = mesh(keep(cyl(D.barW[i] * 0.15, 0.0014, 12)), mats.pins, false);
          screw.position.set(L[i] * sx, BAR_T / 2, 0);
          g.add(screw);
        }
      }
      const top = BAR_T / 2, bottom = -BAR_T / 2; // dessus et dessous du bras, dans son repère
      // train porté par ce bras (mène le bras i + 1), au-dessus de lui : renvois sur tenons
      const tr = D.trains[i + 1], idl = [];
      if (tr && AR.belts) {
        // courroie de A à B : ouverte si le rapport est positif, croisée sinon
        const rA = tr.gears[0].r, rB = tr.gears[tr.gears.length - 1].r, Ld = L[i], yb = yGear(i, j) - oy, pts = [];
        if (tr.ratio > 0) {
          const al = Math.asin(Math.max(-1, Math.min(1, (rA - rB) / Ld)));
          for (let q = 0; q <= 32; q++) { const b = Math.PI / 2 + al + (q / 32) * (Math.PI - 2 * al); pts.push(new THREE.Vector3(Math.cos(b) * rA, yb, -Math.sin(b) * rA)); }
          for (let q = 0; q <= 32; q++) { const b = -Math.PI / 2 - al + (q / 32) * (Math.PI + 2 * al); pts.push(new THREE.Vector3(Ld + Math.cos(b) * rB, yb, -Math.sin(b) * rB)); }
        } else {
          const be = Math.acos(Math.max(-1, Math.min(1, (rA + rB) / Ld)));
          for (let q = 0; q <= 32; q++) { const b = be + (q / 32) * (TAU - 2 * be); pts.push(new THREE.Vector3(Math.cos(b) * rA, yb + 0.0012 * Math.sin(q / 5), -Math.sin(b) * rA)); }
          for (let q = 0; q <= 32; q++) { const b = Math.PI - be - (q / 32) * (TAU - 2 * be); pts.push(new THREE.Vector3(Ld + Math.cos(b) * rB, yb, -Math.sin(b) * rB)); }
        }
        g.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 200, Math.max(0.0012, rB * 0.06), 5, true)), mats.belt, false));
      } else if (tr) {
        tr.gears.forEach((gear, gi) => {
          if (gear.role !== 'I') return;
          const yg = yGear(i, j) - oy;
          const stud = mesh(keep(cyl(STUD_R * sc, yg + GEAR_T / 2 + 0.0015 - top)), mats.pins);
          stud.position.set(gear.x, top, 0);
          g.add(stud);
          const gm = mesh(gearGeometry(gear.z, gear.r, GS), mats.gears);
          gm.position.set(gear.x, yg, 0);
          g.add(gm);
          idl.push({ m: gm, z: gear.z, off: tr.off[gi], sign: gi % 2 ? -1 : 1, zA: tr.gears[0].z });
        });
      }
      ch.idlers.push(idl);
      // au bout du bras : l'axe qui porte le bras suivant (et, au-dessus de lui,
      // la roue A du train suivant, solidaire de ce bras) ; au dernier bras, la
      // goupille de l'astre et son chaton
      if (i < n - 1) {
        const trNext = D.trains[i + 2];
        const yHigh = (trNext ? yGear(i + 1, j) + GEAR_T / 2 : yBar(i + 1, j) + BAR_T / 2) + 0.003 - oy;
        shaft(g, oy, STUD_R * 1.3 * sc, L[i], top, yHigh, gapsOf(j, i + 1), mats.pins);
        if (trNext) {
          const A = mesh(gearGeometry(trNext.gears[0].z, trNext.gears[0].r, AR.belts ? { style: 'pulley' } : GS), mats.gears);
          A.position.set(L[i], yGear(i + 1, j) - oy, 0);
          g.add(A);
          ch.tipA.push({ A, i });
        }
      } else {
        shaft(g, oy, 0.007 * sc, L[i], top, yBody - 0.03 - oy, gapsOf(j, n), mats.pins);
        const cup = mesh(keep(new THREE.CylinderGeometry(0.02, 0.009, 0.016, 20)), mats.pins);
        cup.position.set(L[i], yBody - 0.024 - oy, 0);
        g.add(cup);
      }
      // galets : colonnes du dessous du bras jusqu'aux sillons, patins
      for (const u of D.supports[i] || []) {
        const x = u * L[i], yFoot = yPlate + 0.006 - oy;
        const col = mesh(keep(cyl(0.008, bottom - yFoot)), mats.pins);
        col.position.set(x, yFoot, 0);
        g.add(col);
        const shoe = mesh(keep(cyl(0.014, 0.01, 20, 0.009)), mats.foot);
        shoe.position.set(x, yPlate + 0.0004 - oy, 0);
        g.add(shoe);
        const collar = mesh(keep(cyl(0.013, 0.008, 20)), mats.pins);
        collar.position.set(x, bottom - 0.004, 0);
        g.add(collar);
      }
      // roue B du train précédent : solidaire de ce bras, sous lui, et son canon
      const trPrev = D.trains[i];
      if (trPrev) {
        const gB = trPrev.gears[trPrev.gears.length - 1];
        const yB = yGear(i - 1, j) - oy;
        const B = mesh(gearGeometry(gB.z, gB.r, AR.belts ? { style: 'pulley' } : GS), mats.gears);
        B.position.y = yB;
        B.userData.off = trPrev.off[trPrev.gears.length - 1];
        g.add(B);
        const canonH = bottom - (yB + GEAR_T / 2);
        if (canonH > 0) {
          shaft(g, oy, D.canonR ? D.canonR[i] : Math.max(STUD_R * 2.2, hubR * 0.8), 0, yB + GEAR_T / 2, bottom + 0.0005, gapsOf(j, i), mats.arms);
        }
        g.userData.B = B;
      }
      group.add(g);
      ch.arm.push(g);
    }
    chains.push(ch);
  }

  // ── le mouvement : bâti, rouage, échappement ou vapeur, arbre de sortie,
  // denture du plateau, roue du tube central, pied
  const drive = createDrive({ archetype, plateR, yPlate, yFloor, k0: k[0], omegaFrac, mats, keep, plateGroup: group, stand, styleGear: AR.gear, yTubeTop: yBar(0, 0) + BAR_T / 2 });

  // ── animation : tau, temps de l'orbite ; bodyXY reçoit la position des astres
  function update(tau, bodyXY) {
    for (let j = 0; j < N; j++) {
      const t = tau + (TAU * j) / N, ch = chains[j];
      D.pivots(t, P);
      for (let i = 0; i < n; i++) {
        const g = ch.arm[i];
        g.position.x = P[2 * i]; g.position.z = -P[2 * i + 1];
        g.rotation.y = k[i] * t + phi[i];
        const psi = ((i ? k[i - 1] : 0) - k[i]) * t;
        for (const it of ch.idlers[i]) it.m.rotation.y = it.sign * (it.zA / it.z) * psi + it.off;
        if (g.userData.B) g.userData.B.rotation.y = g.userData.B.userData.off + phi[i - 1] - phi[i];
      }
      for (const { A, i } of ch.tipA) A.rotation.y = phi[i + 1] - phi[i];
      bodyXY[2 * j] = P[2 * n]; bodyXY[2 * j + 1] = P[2 * n + 1];
    }
    if (sun) sun.rotation.y = phi[0];
    drive.update(tau);
    if (armillary) armillary.rotation.y = tau * 0.2;
    // portails : ouverts pendant les fenêtres, avec une rampe avant et après
    if (portalsList.length) {
      const x = ((tau % TAU) + TAU) % TAU, R = 0.035 * TAU;
      const ss = (a, b, v) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
      for (const o of portalsList) {
        let op = 0;
        for (const [a, b] of o.userData.win) for (const v of [x, x + TAU, x - TAU]) op = Math.max(op, ss(a - R, a, v) * (1 - ss(b, b + R, v)));
        o.userData.open = op;
      }
    }
  }

  // ── pièces fixes fusionnées : chaque bras, le plateau et le bâti portent des
  // dizaines de pièces solidaires (vis, rubis, colonnes, galets, roues calées…)
  // qui ne bougent pas dans le repère de leur parent. On les repère en faisant
  // tourner la machine à trois instants, puis on fusionne, parent par parent,
  // celles qui partagent une matière : 4 à 6 fois moins d'appels de dessin.
  mergeStatic([group, stand], update, keep);
  // puis les N chaînes, identiques à un décalage de phase près : chaque pièce
  // d'un bras devient un seul dessin instancié N fois
  const inst = instanceChains(chains, group, n, keep);
  const updateAll = (tau, xy) => { update(tau, xy); inst.sync(); };
  inst.sync();

  return {
    // (afterRender : à appeler après chaque image quand le rendu utilise les vitesses)
    group, stand, update: updateAll, afterRender: inst.after, design: D, yPlate, yTop, yBody, plateR, bodyReach, bezelR: drive.bezelR, grooveCurves,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
