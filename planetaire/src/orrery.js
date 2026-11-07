// La machine : un planétaire (orrery) en laiton qui « porte » la simulation.
//
// Rien ici ne simule : la mécanique LIT l'état du GPU et le rend tangible.
// Chaque pièce a une fonction, et la chaîne cinématique est cohérente :
//
//   BARILLET (ressort = énergie d'un cycle de vie)
//     ├─▶ pignon de l'ARBRE DE RENVOI ─▶ pignons ─▶ ROUES des tubes ─▶ BRAS ─▶ planètes
//     │      (rapport roue / pignon = rapport des vitesses angulaires : Kepler)
//     └─▶ ROUE DE CENTRE ─▶ ROUE D'ÉCHAPPEMENT ⇄ ANCRE ⇄ BALANCIER (régulateur)
//
//  · toutes les dentures ont le même module : les entraxes sont exacts et les
//    dents s'engrènent vraiment (nombres de dents entiers, phases calées) ;
//  · RÉSERVE DE MARCHE : l'aiguille suit le ressort qui se détend au fil du
//    cycle ; le cadran est gradué par les phases de la vie du système ;
//  · FIN DE CYCLE : le ressort est vide, le LEVIER D'ARRÊT bloque le balancier ;
//    la TRÉMIE aspire les débris de la supernova pendant que la COURONNE
//    remonte le barillet (le CLIQUET claque sur le ROCHET) ; le levier se
//    déclenche, la VANNE s'ouvre et les grains se déversent : le nouveau nuage ;
//  · PEIGNE de boîte à musique = la tête de lecture, au-dessus du disque :
//    la POINTE qui prolonge la tige de chaque planète soulève la lame de son
//    rayon (lames inclinées : seule la pointe accroche, comme un picot de
//    cylindre). Il se relève quand l'étoile enfle. Le CURSEUR de la ligne des
//    glaces glisse sur sa barre ;
//  · LIMBE gradué, PIEDS et ARCEAUX qui portent la CLOCHE de verre.
//
// Les pièces sont « usinées » : biseaux, chanfreins, alésages là où un arbre
// passe, ponts et piliers vissés — aucune pièce ne traverse une autre.
import * as THREE from 'three/webgpu';
import {
  vec3, vec4, mix, positionLocal, mx_noise_float, float, mrt, normalWorld, positionWorld, cameraPosition,
  normalize, dot, abs, pow, max, min, reflect, uniform, smoothstep,
} from 'three/tsl';
import { R_IN, R_OUT } from './sim.js';

const K = 12;                          // bras (planètes portées) au maximum
const Y_ARM0 = -0.42, DY_ARM = 0.12;   // hauteur des bras sous le plan du disque
const Y_BASE = -3.3;                   // dessus de la platine
const Y_GEAR0 = Y_BASE + 0.52, DY_GEAR = 0.07; // pile des roues (au-dessus du régulateur)
const MODULE = 0.065;                  // module commun de toutes les dentures
const LAY_N = 40;                      // dents roue + pignon d'un étage (entraxe = 40 × m / 2 = 1,3)
const LAY_D = (LAY_N * MODULE) / 2;
const OMEGA_L = 0.25;                  // vitesse de l'arbre de renvoi (rad / unité de temps) = une orbite à 2,5 UA
const LIMB_R0 = 9.55, LIMB_R1 = 10.35, LIMB_RM = (LIMB_R0 + LIMB_R1) / 2;
const DOME_H = 10.2;                   // hauteur de la cloche (le nuage initial tient dessous)
export const HOPPER = new THREE.Vector3(0, DOME_H - 0.95, 0); // buse de la trémie
// peigne (au-dessus du disque) : barre, lames inclinées, pointes des tiges
const COMB_Z = 0.34, COMB_BAR_Y = 0.44, TOOTH_ROOT_Y = 0.41, TOOTH_TIP_Y = 0.3, TOOTH_TIP_Z = 0.035, PIN_TOP = 0.312;
const NTEETH = 44;
// part de chaque phase dans la réserve du ressort (même ordre que PHASES)
const PHASE_W = [0.06, 0.06, 0.3, 0.14, 0.22, 0.14, 0.08];
const PHASE_SHORT = ['nuage', 'proto', 'planètes', 'dissip.', 'maturité', 'géante', 'nova'];
export const WIND0 = 0.62, WIND1 = 0.93; // fenêtre d'aspiration / remontage dans la supernova (progression)

// Rayon affiché d'une planète (même formule que le shader de visuals.js, × k)
export function visRadius(mE, k = 1) {
  const Rp = mE < 2 ? Math.pow(mE, 0.28) : Math.min(11.5, 1.21 * Math.pow(mE / 2, 0.59));
  return Math.max(0.005, 0.013 * Math.pow(Rp, 0.75)) * k;
}
export const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pitchR = (n) => (n * MODULE) / 2;

// ── Matériaux : laiton patiné et satiné (il ne doit pas voler la vedette) ──
function brass(tone = [0.64, 0.56, 0.38], rough = 0.5) {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: rough });
  const p = positionWorld;
  // laiton brossé (stries) et patine irrégulière ; coordonnées monde, pour
  // que les pièces instanciées ou mises à l'échelle gardent le même grain
  const brush = mx_noise_float(vec3(p.x.mul(14.0), p.y.mul(260.0), p.z.mul(14.0))).mul(0.5).add(0.5);
  const patina = mx_noise_float(p.mul(2.3)).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(...tone).mul(0.82), vec3(...tone), brush).mul(patina.mul(0.25).add(0.8));
  m.roughnessNode = float(rough).add(brush.mul(0.12)).add(patina.mul(0.1));
  return m;
}
const steel = () => new THREE.MeshStandardNodeMaterial({ color: 0xb4bac2, metalness: 0.85, roughness: 0.2 }); // acier poli
const blued = () => new THREE.MeshStandardNodeMaterial({ color: 0x2c4596, metalness: 0.75, roughness: 0.16 }); // acier bleui, très poli
const ruby = () => new THREE.MeshStandardNodeMaterial({ color: 0x9a1028, roughness: 0.06, metalness: 0.1, emissive: 0x2a0208 });
const dark = () => new THREE.MeshStandardNodeMaterial({ color: 0x0c0a08, roughness: 0.7, metalness: 0.2 });

// ── Géométries usinées ──────────────────────────────────────────────────────
const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
// extrusion d'une forme 2D en plaque horizontale, centrée en y, biseautée
function plate(shape, thick, bevel = 0.004, curve = 8) {
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
const circlePath = (r, cx = 0, cy = 0) => { const h = new THREE.Path(); h.absarc(cx, cy, r, 0, Math.PI * 2, true); return h; };

// Roue dentée à sa taille réelle (n dents, module commun), biseautée, avec
// alésage pour l'arbre qui la traverse et rayons évidés si elle est grande.
// Profil : flancs arrondis (approximation d'une développante), tête arrondie.
function gearGeometry(n, thick, bore = 0.02) {
  return cached(`g${n}|${thick}|${bore}`, () => {
    const R = pitchR(n), out = R + MODULE * 0.95, root = R - MODULE * 1.2, p = (Math.PI * 2) / n;
    const s = new THREE.Shape();
    const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    for (let i = 0; i < n; i++) {
      const a = i * p;
      const prof = [[root, 0], [root, 0.18], [root + (R - root) * 0.55, 0.26], [R, 0.3], [R + (out - R) * 0.6, 0.35], [out, 0.42],
        [out, 0.58], [R + (out - R) * 0.6, 0.65], [R, 0.7], [root + (R - root) * 0.55, 0.74], [root, 0.82]];
      prof.forEach(([r, f], j) => { const [x, y] = pt(r, a + f * p); if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
    }
    s.closePath();
    const hub = Math.max(bore + 0.05, R * 0.2);
    if (R > 0.36) {
      const S = R > 0.8 ? 6 : 5, rim = root - Math.max(0.05, R * 0.1), w = Math.max(0.03, R * 0.07);
      for (let k = 0; k < S; k++) {
        const a0 = (k / S) * Math.PI * 2, a1 = ((k + 1) / S) * Math.PI * 2;
        const h = new THREE.Path();
        h.moveTo(...pt(rim, a0 + w / rim));
        h.absarc(0, 0, rim, a0 + w / rim, a1 - w / rim, false);
        h.lineTo(...pt(hub, a1 - w / hub));
        h.absarc(0, 0, hub, a1 - w / hub, a0 + w / hub, true);
        h.closePath();
        s.holes.push(h);
      }
    }
    if (bore > 0) s.holes.push(circlePath(bore));
    return plate(s, thick, Math.min(0.006, thick * 0.25), 6);
  });
}
// moyeu de roue / bague : pièce tournée creuse, chanfreinée
function bushGeometry(rOut, h, rIn = 0, ch = null) {
  return cached(`b${rOut}|${h}|${rIn}`, () => {
    const c = ch ?? Math.min(h * 0.25, (rOut - rIn) * 0.3, 0.012);
    const pts = rIn > 0
      ? [[rIn, h / 2], [rIn, -h / 2], [rOut - c, -h / 2], [rOut, -h / 2 + c], [rOut, h / 2 - c], [rOut - c, h / 2], [rIn, h / 2]]
      : [[0, -h / 2], [rOut - c, -h / 2], [rOut, -h / 2 + c], [rOut, h / 2 - c], [rOut - c, h / 2], [0, h / 2]];
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 32);
  });
}
// pièce tournée quelconque (profil [r, y])
const turned = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// pont / bras plat : stade (bouts ronds) de 0 à len sur x, trous facultatifs
function bridgeGeometry(len, w, thick, holes = []) {
  return cached(`p${len.toFixed(3)}|${w}|${thick}|${holes.map((h) => h.join(',')).join(';')}`, () => {
    const s = new THREE.Shape(), r = w / 2;
    s.moveTo(0, -r); s.lineTo(len, -r); s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, r); s.absarc(0, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    for (const [x, hr] of holes) s.holes.push(circlePath(hr, x, 0));
    return plate(s, thick, 0.006, 12);
  });
}
// Rochet à dents de scie (ne tourne que dans un sens, retenu par le cliquet)
function ratchetGeometry(n, R, thick, bore) {
  return cached(`r${n}|${R}`, () => {
    const root = R * 0.84, p = (Math.PI * 2) / n, s = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = i * p;
      if (i === 0) s.moveTo(root * Math.cos(a), root * Math.sin(a));
      s.lineTo(R * Math.cos(a + 0.9 * p), R * Math.sin(a + 0.9 * p));
      s.lineTo(root * Math.cos(a + p), root * Math.sin(a + p));
    }
    s.holes.push(circlePath(bore));
    return plate(s, thick, 0.004, 4);
  });
}
// Roue d'échappement à dents en crochet (club teeth), 15 dents, 4 rayons
function escapeGeometry(R, thick, bore) {
  return cached(`e${R}`, () => {
    const n = 15, p = (Math.PI * 2) / n, rim = R * 0.72, s = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = i * p;
      const P = [[rim, 0], [R * 0.98, 0.38], [R, 0.5], [R * 0.93, 0.56], [rim, 0.4]];
      P.forEach(([r, f], j) => { const x = r * Math.cos(a + f * p), y = r * Math.sin(a + f * p); if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
      s.lineTo(rim * Math.cos(a + p), rim * Math.sin(a + p));
    }
    const hub = bore + 0.03, rimIn = rim - 0.025, w = 0.018;
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * Math.PI * 2, a1 = ((k + 1) / 4) * Math.PI * 2, h = new THREE.Path();
      h.moveTo(rimIn * Math.cos(a0 + w / rimIn), rimIn * Math.sin(a0 + w / rimIn));
      h.absarc(0, 0, rimIn, a0 + w / rimIn, a1 - w / rimIn, false);
      h.lineTo(hub * Math.cos(a1 - w / hub), hub * Math.sin(a1 - w / hub));
      h.absarc(0, 0, hub, a1 - w / hub, a0 + w / hub, true);
      h.closePath(); s.holes.push(h);
    }
    s.holes.push(circlePath(bore));
    return plate(s, thick, 0.003, 4);
  });
}
// Phase d'engrènement : une roue A (angle de rotation aA, n dents) entraîne B
// (nb dents) dont le centre est dans la direction thC vue de A (angles monde,
// atan2(z, x)). Renvoie l'angle de rotation de B (rotation.y) pour que ses
// dents tombent dans les creux de A.
function meshAngle(rotA, nA, nB, thC) {
  const pA = (Math.PI * 2) / nA, pB = (Math.PI * 2) / nB;
  // angle monde de la dent 0 : la forme est tracée dans le plan XY puis
  // couchée (rotateX(-π/2)) : angle monde = −angle forme − rotation.y
  const alpha = -0.5 * pA - rotA;
  const beta = thC + Math.PI - pB / 2 - (alpha - thC) * (nA / nB);
  return -0.5 * pB - beta;
}

// Gravure du limbe : graduations en degrés, chiffres, devise
function limbTexture() {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const C = S / 2, R1 = C, R0 = C * (LIMB_R0 / LIMB_R1);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = g.fillStyle = '#3a2a14';
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); };
  const band = R1 - R0;
  ring(R1 - band * 0.06, 3); ring(R1 - band * 0.30, 2); ring(R0 + band * 0.42, 2); ring(R0 + band * 0.06, 3);
  // degrés (sens trigonométrique, 0° sur la tête de lecture)
  for (let d = 0; d < 360; d++) {
    const a = (-d * Math.PI) / 180;
    const L = d % 10 === 0 ? 0.24 : d % 5 === 0 ? 0.16 : 0.09;
    const r1 = R1 - band * 0.06, r0 = r1 - band * L;
    g.lineWidth = d % 10 === 0 ? 3 : 1.6;
    g.beginPath(); g.moveTo(C + r0 * Math.cos(a), C + r0 * Math.sin(a)); g.lineTo(C + r1 * Math.cos(a), C + r1 * Math.sin(a)); g.stroke();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const along = (txt, r, a, px) => {
    g.save(); g.translate(C + r * Math.cos(a), C + r * Math.sin(a)); g.rotate(a + Math.PI / 2);
    g.font = `500 ${px}px "Cormorant Garamond", Georgia, serif`; g.fillText(txt, 0, 0); g.restore();
  };
  for (let d = 0; d < 360; d += 10) along(String(d), R1 - band * 0.38, (-d * Math.PI) / 180, band * 0.12);
  // devise gravée dans la bande intérieure, avec les signes des douze maisons
  const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  for (let k = 0; k < 12; k++) along(ROM[k], R0 + band * 0.24, (-(k * 30 + 15) * Math.PI) / 180, band * 0.13);
  for (let k = 0; k < 12; k++) {
    const a = (-k * 30 * Math.PI) / 180;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(C + (R0 + band * 0.06) * Math.cos(a), C + (R0 + band * 0.06) * Math.sin(a));
    g.lineTo(C + (R0 + band * 0.42) * Math.cos(a), C + (R0 + band * 0.42) * Math.sin(a)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Gravure de la platine (dessus du socle) : guillochage et inscription
function plateTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), C = S / 2;
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.strokeStyle = g.fillStyle = '#3a2a14';
  // guillochage : rosace de cercles décentrés
  g.globalAlpha = 0.35; g.lineWidth = 1;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    g.beginPath(); g.arc(C + Math.cos(a) * 60, C + Math.sin(a) * 60, 300, 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1; g.lineWidth = 3;
  for (const r of [0.985, 0.93, 0.79]) { g.beginPath(); g.arc(C, C, C * r, 0, Math.PI * 2); g.stroke(); }
  const txt = 'MACHINA · MUNDI · PLANÉTAIRE · T² ∝ a³ · LIGNÉE & SILLONS · ';
  g.font = `500 ${C * 0.075}px "Cormorant Garamond", Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...txt + txt];
  chars.forEach((ch, i) => {
    const a = (i / chars.length) * Math.PI * 2;
    g.save(); g.translate(C + C * 0.86 * Math.cos(a), C + C * 0.86 * Math.sin(a)); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Petit ciel d'atelier pour les reflets du métal : pénombre chaude, deux
// fenêtres et une lampe — juste de quoi faire luire les arêtes.
function workshopEnv() {
  const W = 512, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#9a9488'); sky.addColorStop(0.35, '#4c4640'); sky.addColorStop(0.5, '#1e1914'); sky.addColorStop(1, '#0a0807');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const glow = (x, y, rx, ry, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y);
    g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
  };
  glow(140, 60, 90, 45, 'rgba(255,224,180,1)');
  glow(360, 70, 110, 40, 'rgba(200,212,255,0.7)');
  glow(250, 10, 260, 40, 'rgba(255,215,170,0.6)');
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cadran de la réserve de marche : un arc de 270°, de « plein » à « vide »,
// découpé en secteurs proportionnels à la part de chaque phase du cycle.
// (angle dans le canevas : 135° = plein … 405° = vide, sens horaire)
const dialAngle = (reserve) => ((135 + 270 * (1 - reserve)) * Math.PI) / 180;
function dialTexture() {
  const S = 512, C = S / 2, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.strokeStyle = g.fillStyle = '#3a2a14';
  g.lineWidth = 3; g.beginPath(); g.arc(C, C, C * 0.96, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(C, C, C * 0.82, dialAngle(1), dialAngle(0)); g.stroke();
  g.beginPath(); g.arc(C, C, C * 0.9, dialAngle(1), dialAngle(0)); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let cum = 0;
  const tick = (res, len, w) => {
    const a = dialAngle(res);
    g.lineWidth = w; g.beginPath();
    g.moveTo(C + Math.cos(a) * C * (0.9 - len), C + Math.sin(a) * C * (0.9 - len));
    g.lineTo(C + Math.cos(a) * C * 0.9, C + Math.sin(a) * C * 0.9); g.stroke();
  };
  for (let k = 0; k <= 40; k++) tick(k / 40, 0.05, 1.5);
  PHASE_W.forEach((w, i) => {
    tick(1 - cum, 0.16, 3.5);
    const a = dialAngle(1 - cum - w / 2);
    g.save(); g.translate(C + Math.cos(a) * C * 0.66, C + Math.sin(a) * C * 0.66); g.rotate(a + Math.PI / 2);
    g.font = `500 ${S * 0.052}px "Cormorant Garamond", Georgia, serif`; g.fillText(PHASE_SHORT[i], 0, 0); g.restore();
    cum += w;
  });
  tick(0, 0.16, 3.5);
  g.font = `600 ${S * 0.07}px "Cormorant SC", Georgia, serif`;
  g.fillText('réserve', C, C + C * 0.42);
  g.font = `italic 400 ${S * 0.05}px "Cormorant Garamond", Georgia, serif`;
  g.fillText('de marche', C, C + C * 0.56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


// Demi-arceau elliptique, du limbe jusqu'au collier de la trémie
class ArchCurve extends THREE.Curve {
  constructor(dir, a, b, rEnd) { super(); this.dir = dir; this.a = a; this.b = b; this.te = Math.acos(rEnd / a); }
  getPoint(t, out = new THREE.Vector3()) {
    const th = this.te * t;
    return out.set(this.dir.x * this.a * Math.cos(th), this.b * Math.sin(th) - 0.05, this.dir.z * this.a * Math.cos(th));
  }
}

// verre : presque invisible, liseré au bord et reflets des deux lumières
function glassMaterial(k = 1) {
  const gm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const V = normalize(cameraPosition.sub(positionWorld)), N = normalize(normalWorld);
  const fres = pow(float(1).sub(abs(dot(N, V))), 4.0);
  const spec = pow(max(dot(reflect(V.negate(), N), normalize(vec3(-8, 14, 10))), 0), 90.0);
  const spec2 = pow(max(dot(reflect(V.negate(), N), normalize(vec3(9, 6, -12))), 0), 30.0);
  gm.colorNode = vec4(vec3(1.0, 0.96, 0.9).mul(fres.mul(0.07).add(spec.mul(0.18)).add(spec2.mul(0.05)).mul(k)), 1);
  gm.mrtNode = mrt({ velocity: vec4(0) }); // (le verre ne brouille pas le flou de mouvement)
  return gm;
}

export function createOrrery(scene, renderer) {
  const root = new THREE.Group();
  root.name = 'orrery';
  scene.add(root);
  // (préfiltrée en PMREM : sans cela, les reflets du métal restent noirs)
  let env = null;
  scene.environmentIntensity = 1.1;
  new THREE.PMREMGenerator(renderer).fromEquirectangularAsync(workshopEnv()).then((rt) => {
    env = rt.texture;
    if (root.visible) scene.environment = env;
  });

  const MB = brass(), MBd = brass([0.4, 0.34, 0.24], 0.55), MS = steel(), MBl = blued(), MR = ruby(), MK = dark();
  const MBz = brass([0.55, 0.38, 0.24], 0.4); // bronze des bagues et coussinets
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  };
  const up = new THREE.Vector3(0, 1, 0);
  // vis à tête bombée fendue (bleuie), posée sur une surface à la hauteur y
  const screwHead = turned([[0, 0], [1, 0], [1, 0.25], [0.85, 0.55], [0.5, 0.72], [0, 0.76]], 20);
  const slotG = new THREE.BoxGeometry(2.1, 0.5, 0.22).translate(0, 0.62, 0);
  const screw = (x, y, z, r = 0.028, parent = root, rot = Math.random() * 3) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(r); g.rotation.y = rot;
    add(screwHead, MBl, 0, 0, 0, g); add(slotG, MK, 0, 0, 0, g); parent.add(g); return g;
  };
  // pilier tourné de y0 à y1 (embase, fût, chanfreins)
  const pillar = (x, z, y0, y1, r = 0.05, mat = MB) => {
    const h = y1 - y0, c = Math.min(0.012, r * 0.25);
    return add(turned([[0, 0], [r * 1.5, 0], [r * 1.5, 0.02], [r, 0.04], [r, h - c], [r - c, h], [0, h]], 24), mat, x, y0, z);
  };
  // arbre d'acier vertical
  const arbor = (x, z, y0, y1, r = 0.018) => add(new THREE.CylinderGeometry(r, r, y1 - y0, 12).translate(0, (y1 - y0) / 2, 0), MS, x, y0, z);
  // pont plat orienté de a vers b (points monde), à la hauteur y
  const bridgeAB = (a, b, y, w, thick, ext0 = 0, ext1 = 0, holes = [], mat = MB) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.z - a.z, b.x - a.x);
    const m = add(bridgeGeometry(d + ext0 + ext1, w, thick, holes.map(([t, r]) => [t * d + ext0, r])), mat, a.x, y, a.z);
    m.rotation.y = -ang;
    m.translateX(-ext0);
    return m;
  };
  const at = (v, t, b, ext = 0) => { // point sur le segment v→b, à t·d + ext
    const d = Math.hypot(b.x - v.x, b.z - v.z);
    return new THREE.Vector3(v.x + (b.x - v.x) * (t + ext / d), 0, v.z + (b.z - v.z) * (t + ext / d));
  };

  // ── Lumières : l'étoile est la vraie source ; la lampe d'atelier, discrète,
  //    ne fait que révéler les volumes quand l'étoile est faible ───────────
  const starLight = new THREE.PointLight(0xffd6a0, 2, 0, 0.3);
  root.add(starLight);
  // projecteur de musée : un cône chaud, en biais, qui découpe la machine et
  // porte ses ombres (les bras et les roues s'ombrent sur la platine)
  const lamp = new THREE.SpotLight(0xffe2c0, 130, 0, 0.66, 0.8, 1.1);
  lamp.position.set(-6.5, 9.5, 8.5);
  lamp.target.position.set(0.3, -2.2, 0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 4; lamp.shadow.camera.far = 30;
  lamp.shadow.bias = -0.0004; lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 3;
  root.add(lamp, lamp.target);
  // second projecteur, froid et rasant, pour sculpter la galerie des automates
  const lamp2 = new THREE.SpotLight(0xc9d8ff, 80, 0, 0.6, 0.9, 1.05);
  lamp2.position.set(8, -2.2, 7.5);
  lamp2.target.position.set(0, -3.9, 0.5);
  root.add(lamp2, lamp2.target);
  // appoint : ciel froid, sol chaud (la pénombre de l'atelier)
  const hemi = new THREE.HemisphereLight(0xa8b8e0, 0x5a3a20, 1.1);
  root.add(hemi);
  // contre-jour froid : liseré sur les arêtes, détache la machine du fond
  const rim = new THREE.DirectionalLight(0xb8ccff, 0.8);
  rim.position.set(7, -1.5, -12);
  root.add(rim);

  // ── Socle tourné + platine gravée ───────────────────────────────────────
  const PLATE_R = 2.56;
  {
    const y = Y_BASE;
    add(turned([[0, y - 1.25], [2.3, y - 1.25], [2.4, y - 1.22], [2.44, y - 1.17], [2.2, y - 1.1], [1.25, y - 0.92], [0.98, y - 0.72],
      [0.82, y - 0.5], [0.8, y - 0.42], [0.95, y - 0.3], [1.6, y - 0.21], [2.5, y - 0.14], [2.6, y - 0.1], [2.62, y - 0.07],
      [2.62, y - 0.035], [2.6, y - 0.02], [0, y - 0.02]], 96), MBd);
    const pm = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: 0.5 });
    pm.map = plateTexture();
    pm.color = new THREE.Color(0.56, 0.5, 0.37);
    add(new THREE.CylinderGeometry(PLATE_R, PLATE_R, 0.02, 96), pm, 0, y - 0.01, 0);
    // chanfrein du bord de la platine
    add(turned([[PLATE_R, y], [PLATE_R, y - 0.02], [PLATE_R + 0.03, y - 0.02], [PLATE_R + 0.03, y - 0.012], [PLATE_R + 0.012, y]], 96), MB);
  }

  // ── Limbe gradué, pieds, arceaux, cloche de verre ───────────────────────
  {
    const lm = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: 0.45 });
    lm.map = limbTexture();
    lm.color = new THREE.Color(0.62, 0.55, 0.39);
    const limb = add(new THREE.RingGeometry(LIMB_R0 + 0.02, LIMB_R1 - 0.02, 256, 1), lm, 0, -0.02, 0);
    limb.rotation.x = -Math.PI / 2;
    // tranche du limbe, chanfreinée dessus et dessous
    add(turned([[LIMB_R0 + 0.02, -0.02], [LIMB_R0, -0.035], [LIMB_R0, -0.125], [LIMB_R0 + 0.02, -0.14], [LIMB_R1 - 0.02, -0.14],
      [LIMB_R1, -0.125], [LIMB_R1, -0.035], [LIMB_R1 - 0.02, -0.02]], 256), MBd);
    // gorge où repose la cloche
    add(turned([[LIMB_R1, -0.03], [LIMB_R1 + 0.09, -0.03], [LIMB_R1 + 0.1, -0.01], [LIMB_R1 + 0.1, 0.05], [LIMB_R1 + 0.08, 0.06],
      [LIMB_R1 + 0.065, 0.02], [LIMB_R1 + 0.035, 0.02], [LIMB_R1 + 0.02, 0.06], [LIMB_R1, 0.05]], 256), MB);
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const pt = (r, y) => d.clone().multiplyScalar(r).setY(y);
      // pied : du dessous du limbe jusqu'au patin vissé sur la platine
      const curve = new THREE.CubicBezierCurve3(pt(LIMB_RM, -0.14), pt(9.9, -2.6), pt(4.2, Y_BASE + 0.55), pt(2.38, Y_BASE + 0.07));
      add(new THREE.TubeGeometry(curve, 64, 0.055, 14), MB);
      const shoe = add(bridgeGeometry(0.34, 0.17, 0.05), MB, 0, Y_BASE + 0.025, 0);
      shoe.position.copy(pt(2.2, Y_BASE + 0.025)); shoe.rotation.y = -a;
      screw(...pt(2.45, Y_BASE + 0.05).toArray(), 0.03);
      add(bushGeometry(0.075, 0.06), MB, ...pt(2.38, Y_BASE + 0.08).toArray());
      // pommeau sur le limbe, d'où part l'arceau supérieur
      const knob = add(turned([[0, 0], [0.13, 0], [0.15, 0.03], [0.12, 0.08], [0.07, 0.11], [0, 0.12]], 24), MB);
      knob.position.copy(pt(LIMB_RM, -0.02));
      add(new THREE.TubeGeometry(new ArchCurve(d, LIMB_RM, DOME_H + 0.02, 0.47), 160, 0.042, 12), MB);
    }
    // collier de la trémie : les arceaux s'y arrêtent, la trémie le traverse
    add(bushGeometry(0.5, 0.1, 0.13), MB, 0, DOME_H + 0.06, 0);
    for (let k = 0; k < 4; k++) screw(Math.cos(k * Math.PI / 2 + 0.785) * 0.32, DOME_H + 0.11, Math.sin(k * Math.PI / 2 + 0.785) * 0.32, 0.025);
    // cloche (ouverte au sommet pour le collier)
    const dome = add(new THREE.SphereGeometry(1, 128, 48, 0, Math.PI * 2, 0.045, Math.PI / 2 - 0.045), glassMaterial());
    dome.scale.set(LIMB_R1 + 0.05, DOME_H + 0.1, LIMB_R1 + 0.05);
    dome.renderOrder = 10;
  }

  // ── Trémie : réservoir de grains, entonnoir, vanne ─────────────────────
  const heapLevel = uniform(0);
  const valve = new THREE.Group();
  {
    const Gc = DOME_H + 0.78, GR = 0.55;
    const globe = add(new THREE.SphereGeometry(GR, 48, 32), glassMaterial(1.6), 0, Gc, 0);
    globe.renderOrder = 11;
    // grains dans le réservoir : une sphère dont le dessus est arasé au niveau
    const sm = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
    const sp = positionLocal;
    const sparkle = mx_noise_float(sp.mul(90.0)).mul(0.5).add(0.5);
    sm.colorNode = mix(vec3(0.32, 0.22, 0.16), vec3(0.85, 0.62, 0.42), sparkle.pow(3.0));
    sm.emissiveNode = vec3(0.9, 0.5, 0.3).mul(sparkle.pow(8.0)).mul(0.6);
    sm.positionNode = vec3(sp.x, min(sp.y, heapLevel.mul(2 * (GR - 0.03)).sub(GR - 0.03)), sp.z);
    const heap = add(new THREE.SphereGeometry(GR - 0.03, 40, 24), sm, 0, Gc, 0);
    heap.userData.isHeap = true;
    // monture : cerclage, chapeau et col
    const band = add(new THREE.TorusGeometry(GR + 0.005, 0.022, 10, 64), MB, 0, Gc, 0);
    band.rotation.x = Math.PI / 2;
    add(turned([[0, 0], [0.2, 0], [0.22, 0.02], [0.18, 0.07], [0.06, 0.1], [0.05, 0.2], [0.08, 0.23], [0.05, 0.27], [0, 0.28]], 32), MB, 0, Gc + GR - 0.04, 0);
    const neckY = Gc - GR;
    add(turned([[0.13, -0.12], [0.19, -0.1], [0.21, -0.07], [0.21, 0.02], [0.16, 0.05], [0.13, 0.05]], 32), MB, 0, neckY, 0);
    // entonnoir : du col jusqu'à la buse, à travers le collier
    const y0 = neckY - 0.12, y1 = HOPPER.y + 0.08;
    const fun = add(turned([[0.13, y0], [0.125, y0 - 0.25], [0.1, (y0 + y1) / 2], [0.06, y1 + 0.12], [0.05, y1], [0.065, y1 - 0.02],
      [0.065, y1 - 0.06], [0.04, y1 - 0.08]], 32), MB);
    fun.material = MB.clone(); fun.material.side = THREE.DoubleSide;
    // vanne : boisseau et sa clé, qui pivote d'un quart de tour à l'ouverture
    add(bushGeometry(0.075, 0.1), MBd, 0, y1 + 0.05, 0);
    valve.position.set(0, y1 + 0.05, 0);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8).rotateZ(Math.PI / 2).translate(0.15, 0, 0), MS, 0, 0, 0, valve);
    add(bridgeGeometry(0.18, 0.05, 0.02), MBl, 0.22, 0, 0, valve).rotation.y = -Math.PI / 2;
    root.add(valve);
  }

  // ── Peigne de la boîte à musique (= la tête de lecture), au-dessus du disque
  // Il pivote sur un pilier planté dans le limbe (axe +X) ; il se relève quand
  // l'étoile enfle, comme on relève un bras de lecture.
  const teeth = [];
  const comb = new THREE.Group();
  comb.position.set(LIMB_RM, COMB_BAR_Y, COMB_Z);
  root.add(comb);
  const snowSlider = new THREE.Group();
  const COMB_X0 = R_IN * 0.7 - LIMB_RM; // bout intérieur (repère du peigne)
  {
    pillar(LIMB_RM, COMB_Z, -0.02, COMB_BAR_Y - 0.03, 0.06);
    // barre-talon : les lames en sortent, côté étoile
    add(bridgeGeometry(-COMB_X0 + 0.07, 0.13, 0.045, [[-COMB_X0, 0.022]]), MS, COMB_X0, 0, 0, comb); // peigne d'acier, d'une pièce
    screw(0, 0.0225, 0, 0.04, comb);
    for (let x = COMB_X0 + 0.6; x < -0.3; x += 1.15) screw(x, 0.0225, 0.03, 0.02, comb);
    const spacing = (R_OUT - R_IN) / NTEETH;
    const rootZ = -0.062, dy = TOOTH_TIP_Y - TOOTH_ROOT_Y, dz = (TOOTH_TIP_Z - COMB_Z) - rootZ;
    const Lt = Math.hypot(dy, dz), dirT = new THREE.Vector3(0, dy, dz).normalize();
    const qBase = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dirT);
    const toothG = bridgeGeometry(Lt, spacing * 0.68, 0.012);
    for (let i = 0; i < NTEETH; i++) {
      const r = R_IN + (i + 0.5) * spacing;
      const t = new THREE.Group();
      t.position.set(r - LIMB_RM, TOOTH_ROOT_Y - COMB_BAR_Y, rootZ);
      t.quaternion.copy(qBase);
      // la lame est tracée de 0 à Lt sur x ; on la recentre sur sa largeur
      const blade = add(toothG, MS, 0, 0, 0, t);
      blade.rotation.x = 0;
      // masselottes de plomb sous les lames graves (elles abaissent la note)
      if (i > NTEETH * 0.45) {
        const w = 0.02 + 0.05 * ((i - NTEETH * 0.45) / (NTEETH * 0.55));
        add(new THREE.BoxGeometry(w * 2, 0.02, spacing * 0.5), MK, 0.05 + w, -0.016, 0, t);
      }
      comb.add(t);
      teeth.push({ g: t, q0: qBase.clone(), r, amp: 0, t: 0, f: 26 - 14 * (i / NTEETH) });
    }
    // curseur de la ligne des glaces, à cheval sur la barre
    add(bridgeGeometry(0.1, 0.24, 0.12), MBl, -0.05, 0, 0, snowSlider);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8).translate(0, 0.1, 0), MS, 0, 0.06, 0.06, snowSlider);
    add(new THREE.OctahedronGeometry(0.035), MBl, 0, 0.28, 0.06, snowSlider);
    screw(0, 0.06, -0.06, 0.02, snowSlider);
    comb.add(snowSlider);
  }

  // ── Axe central, tubes, arbre de renvoi et grand pont ───────────────────
  const polar = (a, r) => new THREE.Vector2(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r);
  const W = (v) => new THREE.Vector3(-v.x, 0, -v.y); // repère local de la platine → monde (demi-tour)
  const dLB = pitchR(10) + pitchR(22), dBC = pitchR(22) + pitchR(8), dCE = pitchR(10) + pitchR(8); // (roue de centre à 10 dents : elle passe à côté du tambour)
  const Lp = polar(150, LAY_D);
  const Bp = Lp.clone().add(polar(240, dLB));
  const Cp = Bp.clone().add(polar(0, dBC));
  const Ep = Cp.clone().add(polar(275, dCE));
  const Fp = Ep.clone().add(polar(275, 0.4));
  const BalP = Fp.clone().add(polar(275, 0.52));
  const layP = W(Lp), bW = W(Bp), cW = W(Cp), eW = W(Ep), fW = W(Fp), balW = W(BalP);
  const dW = new THREE.Vector3(-1.25, 0, 1.22);
  const gearTop = Y_GEAR0 + (K - 1) * DY_GEAR;
  const bridgeY = gearTop + 0.09;
  const angTo = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  {
    // l'arbre le plus fin monte de la platine jusqu'à l'étoile, qu'il porte dans une coupe
    add(bushGeometry(0.08, 0.04, 0.02), MBz, 0, Y_BASE + 0.02, 0);
    arbor(0, 0, Y_BASE, -0.1, 0.02);
    add(turned([[0.02, -0.06], [0.035, -0.06], [0.05, -0.03], [0.075, 0.0], [0.08, 0.01], [0.07, 0.012], [0.045, -0.015], [0.02, -0.03]], 32), MB, 0, -0.08, 0)
      .material = Object.assign(MB.clone(), { side: THREE.DoubleSide });
    // arbre de renvoi
    add(bushGeometry(0.09, 0.04, 0.035), MBz, layP.x, Y_BASE + 0.02, layP.z);
    arbor(layP.x, layP.z, Y_BASE, bridgeY + 0.03, 0.035);
    // grand pont : bague autour des tubes, palier de l'arbre de renvoi, pilier au bout
    const pEnd = at(new THREE.Vector3(), 1, layP, 1.16);
    const br = bridgeAB(new THREE.Vector3(), layP, bridgeY, 0.2, 0.05, 0, 1.16, [[0, 0.2], [1, 0.035]]);
    void br;
    add(bushGeometry(0.25, 0.07, 0.19), MBz, 0, bridgeY, 0);                       // coussinet des tubes
    add(bushGeometry(0.07, 0.03, 0), MR, layP.x, bridgeY + 0.035, layP.z);         // rubis
    pillar(pEnd.x, pEnd.z, Y_BASE, bridgeY - 0.025, 0.06);
    screw(pEnd.x, bridgeY + 0.025, pEnd.z, 0.035);
    screw(...at(new THREE.Vector3(), 0.5, layP).setY(bridgeY + 0.025).toArray(), 0.022);
  }

  // ── Barillet, rouage du régulateur, échappement, balancier ─────────────
  const Ylay = Y_BASE + 0.07, Ywheel = Y_BASE + 0.15, Yesc = Y_BASE + 0.235, YtrainBr = Y_BASE + 0.36;
  const gm = (n, thick, bore, mat, p, y) => add(gearGeometry(n, thick, bore), mat, p.x, y, p.z);
  const layPin = gm(10, 0.05, 0.035, MS, layP, Ylay);
  const barrelGear = gm(22, 0.04, 0.04, MB, bW, Ylay);
  const barrel = new THREE.Group(); barrel.position.copy(bW).setY(Y_BASE + 0.07); root.add(barrel);
  // tambour (avec gorge de couvercle et gravure circulaire)
  add(turned([[0.04, 0.02], [0.6, 0.02], [0.62, 0.035], [0.62, 0.23], [0.6, 0.25], [0.56, 0.25], [0.555, 0.24], [0.5, 0.24],
    [0.495, 0.25], [0.04, 0.25]], 64), MBd, 0, 0, 0, barrel);
  for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.03, 0.03, 0.005, 12), MK, Math.cos(k * 2.1) * 0.38, 0.252, Math.sin(k * 2.1) * 0.38, barrel);
  arbor(bW.x, bW.z, Y_BASE, Y_BASE + 0.46, 0.04);
  // pont de barillet : pilier au bord de la platine, palier au-dessus de l'arbre
  const outB = new THREE.Vector3(bW.x, 0, bW.z).normalize();
  const bPil = bW.clone().addScaledVector(outB, 0.78);
  const YbBr = Y_BASE + 0.355;
  bridgeAB(bPil, bW, YbBr, 0.2, 0.04, 0.02, 0.16, [[1, 0.042]]);
  pillar(bPil.x, bPil.z, Y_BASE, YbBr - 0.02, 0.055);
  screw(bPil.x, YbBr + 0.02, bPil.z, 0.032);
  // rochet sur l'arbre, au-dessus du pont ; cliquet et son ressort
  const ratchet = add(ratchetGeometry(24, 0.26, 0.03, 0.04), MS, bW.x, YbBr + 0.04, bW.z);
  screw(bW.x, YbBr + 0.055, bW.z, 0.05);
  const side = new THREE.Vector3(-outB.z, 0, outB.x);
  const clickPiv = bW.clone().addScaledVector(side, 0.36).addScaledVector(outB, 0.12);
  const click = new THREE.Group(); click.position.copy(clickPiv).setY(YbBr + 0.04); root.add(click);
  {
    const toR = angTo(clickPiv, bW);
    click.rotation.y = -toR + 0.18;
    click.userData.base = click.rotation.y;
    add(bridgeGeometry(0.17, 0.05, 0.026), MS, 0, 0, 0, click);
    screw(0, 0.015, 0, 0.022, click);
    // ressort de cliquet (lame fine)
    const spring = add(bridgeGeometry(0.22, 0.016, 0.02), MS, clickPiv.x, YbBr + 0.04, clickPiv.z);
    spring.rotation.y = -toR - 1.3; spring.translateZ(0.04);
  }
  // remontoir : couronne au bord du socle, tige, renvoi sur le rochet
  const crownPos = outB.clone().multiplyScalar(2.86).setY(YbBr + 0.04);
  const crownG = new THREE.Group(); crownG.position.copy(crownPos);
  crownG.quaternion.setFromUnitVectors(up, outB);
  root.add(crownG);
  const crownWheel = add(gearGeometry(18, 0.09, 0), MB, 0, 0, 0, crownG); // couronne moletée
  add(turned([[0, 0.045], [0.08, 0.045], [0.06, 0.08], [0, 0.09]], 20), MB, 0, 0, 0, crownG);
  // la tige passe à côté du pont de barillet ; une vis sans fin à son bout
  // entraîne le rochet
  const stemG = new THREE.Group();
  {
    const OFF = 0.19, y = YbBr + 0.04;
    const e0 = Math.sqrt(0.27 * 0.27 - OFF * OFF);
    const a0 = bW.clone().addScaledVector(outB, e0 - 0.05).addScaledVector(side, OFF);
    const a1 = bW.clone().addScaledVector(outB, 2.86 - bW.length() - 0.06).addScaledVector(side, OFF);
    crownG.position.copy(a1).addScaledVector(outB, 0.06).setY(y);
    stemG.position.copy(a0).setY(y);
    stemG.quaternion.setFromUnitVectors(up, outB);
    root.add(stemG);
    const len = a0.distanceTo(a1);
    add(new THREE.CylinderGeometry(0.02, 0.02, len, 10).translate(0, len / 2, 0), MS, 0, 0, 0, stemG);
    const helix = [];
    for (let i = 0; i <= 120; i++) { const t = i / 120, an = t * Math.PI * 2 * 4; helix.push(new THREE.Vector3(Math.cos(an) * 0.032, t * 0.16, Math.sin(an) * 0.032)); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 160, 0.009, 6), MS, 0, 0, 0, stemG);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12).translate(0, 0.08, 0), MS, 0, 0, 0, stemG);
    // palier de la tige, vissé sur la platine
    const blk = bW.clone().addScaledVector(outB, 2.5 - bW.length()).addScaledVector(side, OFF);
    const h = y + 0.04 - Y_BASE;
    const bl = add(bridgeGeometry(0.12, 0.12, h), MBd, blk.x, Y_BASE + h / 2, blk.z);
    bl.rotation.y = -Math.atan2(outB.z, outB.x); bl.translateX(-0.06);
    screw(blk.x, Y_BASE + h, blk.z, 0.022);
  }
  // roue de centre et échappement
  const centerPin = gm(8, 0.05, 0.018, MS, cW, Ylay);
  const centerWheel = gm(10, 0.03, 0.018, MB, cW, Ywheel);
  const escPin = gm(8, 0.035, 0.018, MS, eW, Ywheel);
  const escape = add(escapeGeometry(0.26, 0.022, 0.018), MS, eW.x, Yesc, eW.z);
  for (const p of [cW, eW]) { arbor(p.x, p.z, Y_BASE, YtrainBr + 0.02); add(bushGeometry(0.05, 0.03, 0), MBz, p.x, Y_BASE + 0.015, p.z); }
  // pont de rouage : un pilier au-delà de la roue de centre, rubis sur les pivots
  {
    const pA = at(cW, 0, eW, -0.7);
    bridgeAB(pA, eW, YtrainBr, 0.15, 0.04, 0, 0.1, [[0.7 / (0.7 + cW.distanceTo(eW)), 0.018], [1, 0.018]]);
    pillar(pA.x, pA.z, Y_BASE, YtrainBr - 0.02, 0.05);
    screw(pA.x, YtrainBr + 0.02, pA.z, 0.03);
    for (const p of [cW, eW]) add(bushGeometry(0.035, 0.025, 0), MR, p.x, YtrainBr + 0.028, p.z);
  }
  // ancre : palettes de rubis sur la roue d'échappement, fourchette vers le balancier
  const anchor = new THREE.Group(); anchor.position.copy(fW).setY(Yesc); root.add(anchor);
  {
    const toE = angTo(fW, eW);
    anchor.rotation.y = -toE;
    anchor.userData.base = anchor.rotation.y;
    // bras des palettes (en T), levier, fourchette
    const arm = add(bridgeGeometry(0.34, 0.05, 0.02), MS, 0.14, 0, -0.17, anchor); arm.rotation.y = -Math.PI / 2;
    add(bridgeGeometry(0.14, 0.05, 0.02), MS, 0, 0, 0, anchor);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.03, 0.025), MR, 0.17, 0, s * 0.17, anchor);
    const lev = add(bridgeGeometry(0.44, 0.035, 0.02), MS, 0, 0, 0, anchor); lev.rotation.y = Math.PI;
    for (const s of [-1, 1]) add(bridgeGeometry(0.05, 0.016, 0.02), MS, -0.44, 0, s * 0.028, anchor).rotation.y = Math.PI;
    arbor(fW.x, fW.z, Y_BASE, Y_BASE + 0.33, 0.014);
    // pont d'ancre (petit coq)
    const perpF = new THREE.Vector3(-(eW.z - fW.z), 0, eW.x - fW.x).normalize();
    const pa = fW.clone().addScaledVector(perpF, -0.3);
    bridgeAB(pa, fW, Y_BASE + 0.32, 0.1, 0.03, 0, 0.06, [[1, 0.014]]);
    pillar(pa.x, pa.z, Y_BASE, Y_BASE + 0.305, 0.04);
    screw(pa.x, Y_BASE + 0.335, pa.z, 0.024);
  }
  // balancier spiral, sous son coq
  const balance = new THREE.Group();
  const Ybal = Y_BASE + 0.29;
  balance.position.copy(balW).setY(Ybal);
  {
    add(turned([[0.335, -0.018], [0.38, -0.018], [0.385, -0.012], [0.385, 0.012], [0.38, 0.018], [0.335, 0.018], [0.33, 0.012], [0.33, -0.012]], 64), MB, 0, 0, 0, balance);
    for (let k = 0; k < 3; k++) {
      const a = add(bridgeGeometry(0.33, 0.03, 0.016), MB, 0, 0, 0, balance);
      a.rotation.y = (k / 3) * Math.PI * 2;
    }
    add(bushGeometry(0.045, 0.03, 0.012), MB, 0, 0, 0, balance);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const s = add(turned([[0, 0], [0.018, 0], [0.018, 0.012], [0.012, 0.02], [0, 0.022]], 10), MBl, Math.cos(a) * 0.385, 0, Math.sin(a) * 0.385, balance);
      s.quaternion.setFromUnitVectors(up, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    add(bushGeometry(0.05, 0.02, 0.012), MS, 0, -0.04, 0, balance);  // plateau
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), MR, 0.04, -0.055, 0, balance); // cheville
    root.add(balance);
    const pts = [];
    for (let i = 0; i <= 500; i++) {
      const t = i / 500, ang = t * Math.PI * 2 * 9, r = 0.03 + t * 0.2;
      pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.035, Math.sin(ang) * r));
    }
    const hair = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicNodeMaterial({ color: 0x3a56b0 }));
    balance.add(hair);
    balance.userData.hair = hair;
    arbor(balW.x, balW.z, Y_BASE, Y_BASE + 0.45, 0.012);
    add(bushGeometry(0.04, 0.02, 0), MR, balW.x, Y_BASE + 0.01, balW.z);
    // coq : pont en porte-à-faux au-dessus du balancier, piton du spiral
    const sdB = new THREE.Vector3(-balW.z, 0, balW.x).normalize(); // de côté (le levier d'arrêt est de l'autre)
    const foot = balW.clone().addScaledVector(sdB, 0.5);
    bridgeAB(foot, balW, Y_BASE + 0.44, 0.15, 0.035, 0.05, 0.08, [[1, 0.012]]);
    pillar(foot.x, foot.z, Y_BASE, Y_BASE + 0.4225, 0.06);
    screw(foot.x, Y_BASE + 0.4575, foot.z, 0.035);
    add(bushGeometry(0.04, 0.02, 0), MR, balW.x, Y_BASE + 0.465, balW.z);
    const stud = balW.clone().addScaledVector(sdB, 0.23);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8).translate(0, -0.055, 0), MS, stud.x, Y_BASE + 0.42, stud.z);
  }
  // levier d'arrêt : bloque la serge du balancier (pause, remontage) puis se
  // déclenche pour libérer un nouveau cycle
  const stop = new THREE.Group();
  {
    const sd = new THREE.Vector3(-balW.z, 0, balW.x).normalize();
    const piv = balW.clone().addScaledVector(sd, -0.62).setY(Ybal);
    stop.position.copy(piv);
    const toBal = angTo(piv, balW);
    stop.userData.on = -toBal;
    stop.userData.off = -toBal + 0.6;
    stop.rotation.y = stop.userData.off;
    add(bridgeGeometry(0.2, 0.05, 0.03), MBl, 0, 0, 0, stop);
    add(new THREE.BoxGeometry(0.04, 0.03, 0.04), MR, 0.215, 0, 0, stop);
    arbor(piv.x, piv.z, Y_BASE, Ybal + 0.03, 0.014);
    screw(0, 0.015, 0, 0.022, stop);
    root.add(stop);
  }
  // cadran de la réserve de marche, posé sur trois pieds
  const dial = new THREE.Group();
  dial.position.copy(dW).setY(Y_BASE + 0.08);
  dial.rotation.y = Math.PI / 2; // le haut du cadran vers le fond : lisible depuis la vue d'ensemble
  root.add(dial);
  {
    const dm = new THREE.MeshStandardNodeMaterial({ metalness: 0.15, roughness: 0.55 });
    dm.map = dialTexture();
    dm.color = new THREE.Color(0.5, 0.47, 0.4); // émail un peu jauni (sous le projecteur)
    add(new THREE.CylinderGeometry(0.52, 0.52, 0.03, 64), dm, 0, 0.015, 0, dial);
    add(turned([[0.5, 0], [0.56, 0], [0.57, 0.012], [0.57, 0.04], [0.555, 0.055], [0.52, 0.05], [0.5, 0.035]], 64), MB, 0, 0, 0, dial);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      add(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 12).translate(0, -0.04, 0), MB, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, dial);
    }
  }
  const hand = new THREE.Group(); hand.position.y = 0.045; dial.add(hand);
  {
    const s = new THREE.Shape(); // aiguille « poire »
    s.moveTo(-0.08, 0); s.lineTo(0, -0.012); s.lineTo(0.3, -0.004); s.lineTo(0.4, 0); s.lineTo(0.3, 0.004); s.lineTo(0, 0.012); s.closePath();
    add(plate(s, 0.008, 0.002), MBl, 0, 0, 0, hand);
    add(bushGeometry(0.03, 0.02, 0), MBl, 0, 0, 0, hand);
  }

  // ── Pièces mobiles, une par planète portée ──────────────────────────────
  // (matériaux à part, sans vecteur vitesse : ces pièces suivent les planètes)
  const noVel = new Map();
  const inst = (geo, mat0, n) => {
    if (!noVel.has(mat0)) { const c = mat0.clone(); c.mrtNode = mrt({ velocity: vec4(0) }); noVel.set(mat0, c); }
    const mat = noVel.get(mat0);
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    root.add(m);
    return m;
  };
  const rodX = new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
  const rodY = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
  const HUB_IN = 0.72; // rapport alésage / diamètre des bagues instanciées
  const arms = inst(rodX, MB, K);
  const counters = inst(rodX, MB, K);
  const weights = inst(turned([[0, -0.5], [0.85, -0.5], [1, -0.3], [1, 0.3], [0.85, 0.5], [0, 0.5]], 24), MBd, K);
  const stems = inst(rodY, MS, K);
  const pins = inst(rodY, MS, K);
  const pinTips = inst(new THREE.SphereGeometry(1, 10, 8), MS, K);
  const bosses = inst(bushGeometry(1, 1, 0, 0.18), MB, K);
  const collars = inst(turned([[0, -0.5], [0.45, -0.5], [0.55, -0.2], [1, 0.4], [0.95, 0.5], [0.4, 0.1], [0, 0.1]], 24), MB, K);
  const tubes = inst(new THREE.CylinderGeometry(1, 1, 1, 24).translate(0, 0.5, 0), MB, K);
  const hubs = inst(bushGeometry(1, 1, HUB_IN, 0.06), MBd, K);
  const hubScrews = inst(new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2), MBl, K);
  const gearHubs = inst(bushGeometry(1, 1, HUB_IN, 0.06), MB, K);
  const pinHubs = inst(bushGeometry(1, 1, HUB_IN, 0.06), MS, K);
  // réserve de roues et de pignons (une paire par bras)
  const gearPool = [];
  for (let k = 0; k < K; k++) {
    const g = add(gearGeometry(20, 0.028, 0.04), MB); const p = add(gearGeometry(20, 0.028, 0.035), MS);
    g.visible = p.visible = false; gearPool.push({ g, p });
  }
  const tubeR = (j) => 0.035 + 0.013 * j;
  const thLay = Math.atan2(layP.z, layP.x);

  // Suivi des bras : un bras ne surgit jamais d'un coup. Quand une planète est
  // prise en charge, son bras sort de la bague (la tringle s'allonge, puis la
  // tige monte sous la bille) ; quand elle disparaît (fusion, éjection, ou elle
  // n'est plus parmi les plus massives), le bras redescend et rentre en
  // continuant de tourner à la vitesse képlérienne. Sa roue glisse dans la pile
  // quand l'ordre des rayons change. Seuils à hystérésis : pas de clignotement
  // autour de la masse limite.
  const track = new Map(); // index → { alive, e, s, x, y, z, a, phi, mE, pair }
  const M_IN = 0.12, M_OUT = 0.06, SWAP = 1.6;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const place = (mesh, i, pos, rotY, scale) => { _q.setFromAxisAngle(up, rotY); _m.compose(pos, _q, scale); mesh.setMatrixAt(i, _m); };


  const S = { lay: 0, escCont: 0, ph: 0, amp: 0, reserve: 1, ratchet: 0, crown: 0, tooth: 0, stop: 1, cycle: -1, valve: 0, lift: 0 };
  const api = { root, onClick: null, onClack: null, collect: 0 };
  const zAxis = new THREE.Vector3(0, 0, 1), _qb = new THREE.Quaternion();

  // ═══ Galerie des automates ═════════════════════════════════════════════
  // Une plate-forme annulaire autour du pied du socle. Une grande couronne
  // dentée (88 dents), tirée par un POIDS MOTEUR qui descend au fil du cycle,
  // entraîne une ronde de stations ; chacune lit un aspect de la simulation :
  //   · RÉGULATEUR À BOULES : les boules s'écartent avec la vitesse du temps ;
  //   · TAMBOUR À CAMES (le programme du cycle) : trois cames — luminosité de
  //     l'étoile, gaz du disque, ligne des glaces — poussent des crémaillères
  //     qui font tourner les aiguilles de trois cadrans ;
  //   · COMPTEUR À ROULEAUX : orbites à 1 UA et numéro du cycle ;
  //   · POMPE À SOUFFLET : aspire les débris à la fin du cycle ; sa conduite
  //     remonte le long d'un pied et d'un arceau jusqu'à la trémie ;
  //   · CLOCHE : frappée à chaque impact géant.
  const G = {};
  {
    const Yg = Y_BASE - 0.62, RIN = 0.93, ROUT = 3.85;
    const RING_N = 88, RING_R = pitchR(RING_N);
    G.Yg = Yg;
    // plate-forme (anneau tourné, bord mouluré) et consoles sous la plate-forme
    add(turned([[RIN, 0], [ROUT - 0.03, 0], [ROUT, 0.015], [ROUT, 0.045], [ROUT - 0.02, 0.06], [ROUT - 0.08, 0.06], [ROUT - 0.09, 0.045],
      [RIN + 0.05, 0.045], [RIN, 0.03]], 128), MBd, 0, Yg - 0.06, 0);
    add(bushGeometry(RIN + 0.1, 0.12, RIN - 0.03), MB, 0, Yg - 0.04, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const s = new THREE.Shape(); // console en équerre, chantournée
      s.moveTo(0, 0); s.lineTo(1.6, 0); s.lineTo(1.6, -0.06);
      s.quadraticCurveTo(0.6, -0.12, 0.12, -0.55); s.lineTo(0, -0.55); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
      g.translate(0, 0, -0.02);
      const m = add(g, MB, Math.cos(a) * (RIN - 0.02), Yg - 0.06, Math.sin(a) * (RIN - 0.02));
      m.rotation.y = -a;
    }
    // couronne motrice, posée sur huit galets
    {
      const s = new THREE.Shape(), R = RING_R, out = R + MODULE * 0.95, root = R - MODULE * 1.2, p = (Math.PI * 2) / RING_N;
      for (let i = 0; i < RING_N; i++) {
        const a = i * p;
        const prof = [[root, 0], [root, 0.18], [R, 0.3], [out, 0.42], [out, 0.58], [R, 0.7], [root, 0.82]];
        prof.forEach(([r, f], j) => { const x = r * Math.cos(a + f * p), y = r * Math.sin(a + f * p); if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
      }
      s.holes.push(circlePath(R - 0.32));
      for (let k = 0; k < 24; k++) s.holes.push(circlePath(0.05, Math.cos((k / 24) * Math.PI * 2) * (R - 0.2), Math.sin((k / 24) * Math.PI * 2) * (R - 0.2)));
      G.ring = add(plate(s, 0.05, 0.006, 4), MB, 0, Yg + 0.075, 0);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const roller = add(bushGeometry(0.045, 0.04, 0), MS, Math.cos(a) * (RING_R - 0.17), Yg + 0.025, Math.sin(a) * (RING_R - 0.17));
        roller.rotation.z = Math.PI / 2; roller.rotation.y = -a;
      }
    }
    // une station : pinion vertical qui engrène la couronne, à l'angle th
    G.stations = [];
    const station = (thDeg, n) => {
      const th = (thDeg * Math.PI) / 180, r = RING_R + pitchR(n);
      const pos = new THREE.Vector3(Math.cos(th) * r, Yg + 0.075, Math.sin(th) * r);
      const pin = add(gearGeometry(n, 0.05, 0.022), MS, pos.x, pos.y, pos.z);
      arbor(pos.x, pos.z, Yg - 0.01, Yg + 0.14, 0.022);
      add(bushGeometry(0.06, 0.03, 0.022), MBz, pos.x, Yg + 0.015, pos.z);
      const st = { th, n, pos, pin, rot: 0 };
      G.stations.push(st);
      return st;
    };

    // ── poids moteur : tambour (axe vertical), poulie de renvoi, chaîne, poids
    {
      const st = station(-6, 14);
      const { pos } = st;
      G.drum = add(turned([[0.022, 0], [0.2, 0], [0.2, 0.02], [0.17, 0.03], [0.17, 0.22], [0.2, 0.23], [0.2, 0.25], [0.022, 0.25]], 40), MB, pos.x, Yg + 0.1, pos.z);
      for (let k = 0; k < 8; k++) add(new THREE.TorusGeometry(0.172, 0.008, 6, 40).rotateX(Math.PI / 2), MS, pos.x, Yg + 0.14 + k * 0.022, pos.z);
      arbor(pos.x, pos.z, Yg + 0.1, Yg + 0.42, 0.022);
      // potence et poulie au bord de la plate-forme
      const out = new THREE.Vector3(Math.cos(st.th), 0, Math.sin(st.th));
      const tan = new THREE.Vector3(-out.z, 0, out.x);
      const pul = out.clone().multiplyScalar(ROUT + 0.12).addScaledVector(tan, 0.2).setY(Yg + 0.2);
      G.pulleyPos = pul;
      const arm = bridgeAB(out.clone().multiplyScalar(ROUT - 0.2).addScaledVector(tan, 0.2), pul, Yg + 0.03, 0.1, 0.04, 0, 0.08);
      void arm;
      pillar(pul.x - out.x * 0.0, pul.z, Yg + 0.05, Yg + 0.1, 0.03);
      const pg = new THREE.Group(); pg.position.copy(pul); pg.rotation.y = -Math.atan2(tan.z, tan.x); root.add(pg);
      G.pulley = add(turned([[0.02, -0.025], [0.14, -0.025], [0.14, -0.015], [0.11, 0], [0.14, 0.015], [0.14, 0.025], [0.02, 0.025]], 32), MB, 0, 0, 0, pg);
      G.pulley.rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) add(bridgeGeometry(0.2, 0.06, 0.02), MBd, 0, -0.1, s * 0.045, pg).rotation.z = Math.PI / 2;
      // chaîne (maillons instanciés) et poids
      const linkG = new THREE.TorusGeometry(0.022, 0.006, 6, 12);
      linkG.scale(1, 1.7, 1);
      G.links = new THREE.InstancedMesh(linkG, MS, 160);
      G.links.instanceMatrix.setUsage(THREE.DynamicDrawUsage); G.links.frustumCulled = false; G.links.castShadow = true;
      root.add(G.links);
      G.chainX = pul.clone().addScaledVector(out, 0.14); // point de chute
      G.weight = new THREE.Group(); root.add(G.weight);
      add(turned([[0, 0], [0.16, 0], [0.18, 0.03], [0.18, 0.5], [0.15, 0.56], [0.06, 0.6], [0.04, 0.64], [0, 0.64]], 40), MB, 0, -0.64, 0, G.weight);
      add(new THREE.TorusGeometry(0.035, 0.009, 6, 16), MS, 0, 0.0, 0, G.weight);
      for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.182, 0.006, 6, 40).rotateX(Math.PI / 2), MBd, 0, -0.5 + k * 0.18, 0, G.weight);
    }

    // ── régulateur à boules (Watt)
    {
      const st = station(68, 12), { pos } = st;
      const H = 1.25;
      arbor(pos.x, pos.z, Yg + 0.1, Yg + H, 0.02);
      G.gov = new THREE.Group(); G.gov.position.set(pos.x, Yg + H, pos.z); root.add(G.gov);
      add(turned([[0.02, -0.05], [0.07, -0.05], [0.08, -0.03], [0.08, 0.02], [0.05, 0.05], [0.02, 0.06]], 24), MB, 0, 0, 0, G.gov);
      add(turned([[0, 0], [0.04, 0], [0.03, 0.08], [0.012, 0.16], [0, 0.18]], 16), MB, 0, 0.05, 0, G.gov);
      G.govArms = []; G.govLinks = [];
      for (const s of [0, Math.PI]) {
        const side = new THREE.Group(); side.rotation.y = s; G.gov.add(side);
        const arm = new THREE.Group(); side.add(arm);
        add(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 8).translate(0, -0.25, 0), MS, 0, 0, 0, arm);
        add(new THREE.SphereGeometry(0.075, 24, 16), MB, 0, -0.52, 0, arm);
        G.govArms.push(arm);
        const link = new THREE.Group(); side.add(link);
        add(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 8).translate(0, -0.13, 0), MS, 0, 0, 0, link);
        G.govLinks.push(link);
      }
      G.sleeve = add(bushGeometry(0.05, 0.08, 0.02), MBz, pos.x, Yg + H - 0.4, pos.z);
      // levier de l'étrangleur (il freine le poids si la machine s'emballe)
      G.govLever = add(bridgeGeometry(0.4, 0.04, 0.02), MBl, pos.x, Yg + H - 0.4, pos.z);
      const bkt = pillar(pos.x + Math.cos(st.th) * 0.42, pos.z + Math.sin(st.th) * 0.42, Yg, Yg + H - 0.42, 0.03);
      void bkt;
      G.govLever.rotation.y = -st.th;
    }

    // ── tambour à cames (programme du cycle) et colonne des cadrans
    {
      const st = station(180, 12), { pos } = st;
      const out = new THREE.Vector3(Math.cos(st.th), 0, Math.sin(st.th)), tan = new THREE.Vector3(-out.z, 0, out.x);
      arbor(pos.x, pos.z, Yg + 0.1, Yg + 0.75, 0.024);
      // roue à vis sans fin (réduction énorme : un tour par cycle)
      const ww = add(gearGeometry(40, 0.03, 0.024), MB, pos.x, Yg + 0.16, pos.z);
      G.wormWheel = ww;
      const wormP = pos.clone().addScaledVector(tan, pitchR(40) + 0.04);
      const helix = [];
      for (let i = 0; i <= 140; i++) { const t = i / 140, an = t * Math.PI * 2 * 5; helix.push(new THREE.Vector3(Math.cos(an) * 0.04, t * 0.22 - 0.11, Math.sin(an) * 0.04)); }
      G.worm = new THREE.Group(); G.worm.position.copy(wormP).setY(Yg + 0.16);
      G.worm.quaternion.setFromUnitVectors(up, out); root.add(G.worm);
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 200, 0.01, 6), MS, 0, 0, 0, G.worm);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12), MS, 0, 0, 0, G.worm);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), MS, 0, 0, 0, G.worm);
      for (const s of [-1, 1]) pillar(wormP.x + out.x * s * 0.22, wormP.z + out.z * s * 0.22, Yg, Yg + 0.15, 0.025);
      // trois cames : profil = la grandeur au fil du cycle (angle = fraction du cycle)
      const prog = [
        (f) => { // luminosité de l'étoile
          const c = PHASE_W.reduce((a, w, i) => (a.push((a[i - 1] || 0) + w), a), []);
          if (f < c[1]) return 0.1 + 0.15 * f / c[1];
          if (f < c[2]) return 0.25 + 0.3 * ss(c[1], c[1] + 0.06, f);
          if (f < c[4]) return 0.55 + 0.1 * (f - c[2]) / (c[4] - c[2]);
          if (f < c[5]) return 0.65 + 0.35 * ss(c[4], c[5], f);
          return 1 - 0.85 * ss(c[5], 1, f);
        },
        (f) => { // gaz du disque
          const c = PHASE_W.reduce((a, w, i) => (a.push((a[i - 1] || 0) + w), a), []);
          return f < c[1] ? 1 : f < c[2] ? 1 - ss(c[1], c[2], f) : 0.02;
        },
        (f) => { // ligne des glaces (∝ √L)
          return Math.sqrt(prog[0](f));
        },
      ];
      G.cams = []; G.racks = []; G.needles = [];
      const R0 = 0.16, AMP = 0.11, DELTA = Math.atan2(out.z, out.x) + Math.PI; // les poussoirs regardent vers l'axe du socle
      prog.forEach((F, i) => {
        const y = Yg + 0.3 + i * 0.14;
        const s = new THREE.Shape(), NP = 180;
        for (let k = 0; k <= NP; k++) {
          const phi = (k / NP) * Math.PI * 2;
          const f = (((phi + DELTA) / (Math.PI * 2)) % 1 + 1) % 1;
          const r = R0 + AMP * F(f);
          if (k === 0) s.moveTo(r * Math.cos(phi), r * Math.sin(phi)); else s.lineTo(r * Math.cos(phi), r * Math.sin(phi));
        }
        s.holes.push(circlePath(0.024));
        const cam = add(plate(s, 0.04, 0.005, 2), [MB, MS, MBd][i], pos.x, y, pos.z);
        G.cams.push(cam);
        // poussoir : galet, tige coulissante, crémaillère
        const rack = new THREE.Group(); root.add(rack);
        rack.userData = { F, R0, AMP, y, dir: new THREE.Vector3(Math.cos(DELTA), 0, Math.sin(DELTA)) };
        add(bushGeometry(0.03, 0.03, 0), MS, 0, 0, 0, rack);
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8).rotateZ(Math.PI / 2).translate(0.32, 0, 0), MS, 0, 0, 0, rack);
        const teethR = new THREE.Group(); rack.add(teethR);
        add(new THREE.BoxGeometry(0.22, 0.03, 0.025), MB, 0.52, 0, -0.02, rack);
        for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.012, 0.03, 0.02), MB, 0.43 + k * 0.022, 0, -0.04, rack);
        rack.rotation.y = -DELTA;
        G.racks.push(rack);
        // guide du poussoir
        const gp = pos.clone().addScaledVector(rack.userData.dir, 0.42);
        pillar(gp.x, gp.z, Yg, y - 0.02, 0.03);
        add(bushGeometry(0.03, 0.04, 0.012), MBz, gp.x, y, gp.z).rotation.z = Math.PI / 2;
      });
      // colonne des cadrans, entre le tambour et le socle
      const colP = pos.clone().addScaledVector(out, -0.85);
      G.colP = colP;
      add(turned([[0, 0], [0.12, 0], [0.12, 0.03], [0.07, 0.06], [0.06, 0.9], [0.08, 0.93], [0.08, 0.96], [0, 0.96]], 24), MB, colP.x, Yg, colP.z);
      const dTex = (label, c0, c1) => {
        const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
        const g = c.getContext('2d'); g.fillStyle = '#efe6d2'; g.fillRect(0, 0, S, S);
        g.strokeStyle = g.fillStyle = '#2a1e10'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2); g.stroke();
        for (let k = 0; k <= 10; k++) { const a = Math.PI * (0.75 + 1.5 * k / 10); g.lineWidth = k % 5 ? 2 : 4; g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * S * 0.34, S / 2 + Math.sin(a) * S * 0.34); g.lineTo(S / 2 + Math.cos(a) * S * 0.42, S / 2 + Math.sin(a) * S * 0.42); g.stroke(); }
        g.textAlign = 'center'; g.font = `600 ${S * 0.11}px "Cormorant SC", Georgia, serif`; g.fillText(label, S / 2, S * 0.72);
        g.font = `italic ${S * 0.08}px "Cormorant Garamond", Georgia, serif`; g.fillText(c0, S * 0.24, S * 0.9); g.fillText(c1, S * 0.76, S * 0.9);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      };
      [['lumière', 'faible', 'vive'], ['gaz', 'vide', 'plein'], ['glaces', 'près', 'loin']].forEach(([l, a, b], i) => {
        const dg = new THREE.Group(); dg.position.copy(colP).setY(Yg + 0.3 + i * 0.25).addScaledVector(out, 0.09);
        dg.quaternion.setFromUnitVectors(up, out); // face vers l'extérieur
        root.add(dg);
        const mm = new THREE.MeshStandardNodeMaterial({ metalness: 0.1, roughness: 0.5 }); mm.map = dTex(l, a, b);
        add(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 40), mm, 0, 0, 0, dg).rotation.y = Math.PI / 2;
        add(new THREE.TorusGeometry(0.115, 0.012, 8, 40).rotateX(Math.PI / 2), MB, 0, 0.008, 0, dg);
        const nd = new THREE.Group(); nd.position.y = 0.012; dg.add(nd);
        add(new THREE.BoxGeometry(0.004, 0.005, 0.09).translate(0, 0, -0.04), MBl, 0, 0, 0, nd);
        G.needles.push(nd);
      });
    }

    // ── compteur à rouleaux (orbites, cycle)
    {
      const st = station(108, 10), { pos } = st;
      const out = new THREE.Vector3(Math.cos(st.th), 0, Math.sin(st.th)), tan = new THREE.Vector3(-out.z, 0, out.x);
      const S = 512, c = document.createElement('canvas'); c.width = S; c.height = 64;
      const g = c.getContext('2d'); g.fillStyle = '#16100a'; g.fillRect(0, 0, S, 64);
      g.fillStyle = '#efe4cc'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 46px "EB Garamond", Georgia, serif';
      for (let d = 0; d < 10; d++) { g.save(); g.translate((d + 0.5) * S / 10, 32); g.rotate(-Math.PI / 2); g.fillText(String(d), 0, 2); g.restore(); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const dm = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 }); dm.map = tex;
      const cp = pos.clone().addScaledVector(out, 0.35).setY(Yg + 0.42);
      G.counter = new THREE.Group(); G.counter.position.copy(cp);
      G.counter.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan); root.add(G.counter);
      G.digits = [];
      const N = 6;
      for (let k = 0; k < N; k++) {
        const x = (k - (N - 1) / 2) * 0.1 + (k === N - 1 ? 0.06 : 0);
        const w = add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 40, 1, true).rotateZ(Math.PI / 2), k === N - 1 ? MBd : dm, x, 0, 0, G.counter);
        w.material = k === N - 1 ? dm : dm;
        G.digits.push(w);
        add(new THREE.CylinderGeometry(0.064, 0.064, 0.012, 40).rotateZ(Math.PI / 2), MB, x + 0.046, 0, 0, G.counter);
      }
      // bâti : joues, axe, fenêtre
      for (const s of [-1, 1]) add(bridgeGeometry(0.3, 0.16, 0.025), MB, s * 0.36, -0.3, 0, G.counter).rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.78, 8).rotateZ(Math.PI / 2), MS, 0, 0, 0, G.counter);
      const fr = new THREE.Shape(); fr.moveTo(-0.38, -0.09); fr.lineTo(0.38, -0.09); fr.lineTo(0.38, 0.09); fr.lineTo(-0.38, 0.09); fr.closePath();
      const hole = new THREE.Path(); hole.moveTo(-0.3, -0.035); hole.lineTo(0.3, -0.035); hole.lineTo(0.3, 0.035); hole.lineTo(-0.3, 0.035); hole.closePath(); fr.holes.push(hole);
      const front = add(plate(fr, 0.015, 0.004), MB, 0, 0, 0.07, G.counter); front.rotation.x = Math.PI / 2;
      // renvoi d'angle (pignons coniques) entre la station et l'axe des rouleaux
      add(new THREE.ConeGeometry(0.05, 0.05, 16, 1, true).translate(0, 0.025, 0), MS, pos.x, Yg + 0.14, pos.z);
      arbor(pos.x, pos.z, Yg + 0.1, Yg + 0.3, 0.015);
    }

    // ── pompe à soufflet et sa conduite jusqu'à la trémie
    {
      const st = station(252, 12), { pos } = st;
      const out = new THREE.Vector3(Math.cos(st.th), 0, Math.sin(st.th)), tan = new THREE.Vector3(-out.z, 0, out.x);
      // plateau excentrique (embrayé seulement pendant l'aspiration)
      G.crank = new THREE.Group(); G.crank.position.copy(pos).setY(Yg + 0.13); root.add(G.crank);
      add(bushGeometry(0.16, 0.03, 0.022), MB, 0, 0, 0, G.crank);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), MS, 0.11, 0.04, 0, G.crank);
      // soufflet : accordéon tourné, couché le long de la tangente
      const bp = pos.clone().addScaledVector(tan, 0.75).setY(Yg + 0.2);
      G.bellows = new THREE.Group(); G.bellows.position.copy(bp);
      G.bellows.quaternion.setFromUnitVectors(up, tan.clone().negate()); root.add(G.bellows);
      const acc = []; for (let k = 0; k <= 12; k++) acc.push([k % 2 ? 0.1 : 0.14, k / 12]);
      const leather = new THREE.MeshStandardNodeMaterial({ color: 0x3a1c10, roughness: 0.85, metalness: 0 });
      G.bellowsBody = add(turned([[0, 0], ...acc, [0, 1]], 24), leather, 0, 0, 0, G.bellows);
      add(bushGeometry(0.16, 0.025, 0), MB, 0, 0, 0, G.bellows);
      G.bellowsCap = add(bushGeometry(0.16, 0.025, 0), MB, 0, 0.3, 0, G.bellows);
      G.rod = add(new THREE.CylinderGeometry(0.012, 0.012, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0), MS, 0, Yg + 0.2, 0);
      G.bellowsBase = bp;
      const fixed = bp.clone().addScaledVector(tan, 0.05);
      pillar(fixed.x, fixed.z, Yg, Yg + 0.06, 0.06);
      // conduite : du soufflet au bord de la platine, le long du pied (225°), puis de l'arceau, jusqu'au collier
      const a = (5 * Math.PI) / 4 + 0.035;
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const ptd = (r, y) => d.clone().multiplyScalar(r).setY(y);
      const leg = new THREE.CubicBezierCurve3(ptd(LIMB_RM, -0.14), ptd(9.9, -2.6), ptd(4.2, Y_BASE + 0.55), ptd(2.38, Y_BASE + 0.07));
      const arch = new ArchCurve(d, LIMB_RM - 0.02, DOME_H - 0.05, 0.56);
      const pts = [bp.clone().addScaledVector(tan, 0.02).setY(Yg + 0.2), bp.clone().addScaledVector(out, 0.25).setY(Yg + 0.35)];
      for (let i = 10; i >= 1; i--) pts.push(leg.getPoint(i / 10 * 0.98 + 0.02).add(new THREE.Vector3(0, 0.1, 0)));
      for (let i = 1; i <= 24; i++) pts.push(arch.getPoint(i / 24).add(new THREE.Vector3(0, 0.1, 0)));
      const pipeC = new THREE.CatmullRomCurve3(pts);
      add(new THREE.TubeGeometry(pipeC, 400, 0.028, 10), MB);
      for (let k = 1; k < 30; k++) { // colliers de fixation
        const t = k / 30, p = pipeC.getPoint(t), tg = pipeC.getTangent(t);
        add(new THREE.TorusGeometry(0.034, 0.008, 6, 16), MBd, p.x, p.y, p.z).quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg);
      }
    }

    // ── cloche et son marteau (impacts géants)
    {
      const th = (292 * Math.PI) / 180, r = 3.25;
      const out = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)), tan = new THREE.Vector3(-out.z, 0, out.x);
      const p = out.clone().multiplyScalar(r);
      pillar(p.x, p.z, Yg, Yg + 1.0, 0.035);
      const top = p.clone().setY(Yg + 1.0);
      const gal = add(bridgeGeometry(0.42, 0.06, 0.03), MB, top.x, top.y, top.z); gal.rotation.y = -Math.atan2(tan.z, tan.x);
      const bellP = top.clone().addScaledVector(tan, 0.36);
      G.bell = add(turned([[0.005, 0.02], [0.05, 0], [0.09, -0.06], [0.11, -0.18], [0.16, -0.27], [0.165, -0.29], [0.14, -0.285],
        [0.1, -0.2], [0.08, -0.08], [0.04, -0.02], [0.005, 0.0]], 40), MBz, bellP.x, bellP.y - 0.03, bellP.z);
      G.bell.material = Object.assign(MBz.clone(), { side: THREE.DoubleSide });
      G.hammer = new THREE.Group(); G.hammer.position.copy(p).setY(Yg + 0.62).addScaledVector(tan, 0.02);
      G.hammer.rotation.y = -Math.atan2(tan.z, tan.x); root.add(G.hammer);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8).rotateZ(Math.PI / 2).translate(0.21, 0, 0), MS, 0, 0, 0, G.hammer);
      add(new THREE.SphereGeometry(0.04, 16, 12), MBl, 0.42, 0, 0, G.hammer);
      add(bushGeometry(0.03, 0.04, 0), MB, 0, 0, 0, G.hammer).rotation.x = Math.PI / 2;
      G.hammerT = 1;
    }
  }

  // la cloche sonne : impact géant (k ~ intensité)
  api.strike = (k = 1) => { G.hammerT = 0; G.hammerK = Math.min(1, 0.4 + k); };

  function updateGallery(dtSim, dtReal, life, rate, reserve, collect, simTime) {
    const ringRot = S.lay * 0.18;
    G.ring.rotation.y = ringRot;
    for (const st of G.stations) {
      st.rot = meshAngle(ringRot, 88, st.n, st.th);
      st.pin.rotation.y = st.rot;
    }
    const [drumSt, govSt, camSt, cntSt, pumpSt] = G.stations;
    // poids : descend quand le ressort se détend, remonte au remontage
    G.drum.rotation.y = drumSt.rot;
    const len = 0.35 + 2.4 * (1 - reserve);
    const top = G.chainX.clone().setY(G.Yg + 0.2 - 0.14);
    const pitch = 0.064, nL = Math.min(160, Math.ceil(len / pitch));
    for (let i = 0; i < nL; i++) {
      _q.setFromAxisAngle(up, i % 2 ? Math.PI / 2 : 0);
      _m.compose(_p.set(top.x, top.y - i * pitch, top.z), _q, _s.set(1, 1, 1));
      G.links.setMatrixAt(i, _m);
    }
    G.links.count = nL; G.links.instanceMatrix.needsUpdate = true;
    G.weight.position.set(top.x, top.y - len - 0.02, top.z);
    G.pulley.rotation.y = -len / 0.12;
    // régulateur : rotation rapide ; les boules s'écartent avec la vitesse
    G.gov.rotation.y = govSt.rot * 3;
    const sp = Math.min(1, rate / 6);
    const ang = 0.25 + 0.75 * sp + 0.03 * Math.sin(simTime * 3);
    G.govArms.forEach((a) => { a.rotation.z = ang; a.position.x = 0.03; });
    const ballX = 0.03 + Math.sin(ang) * 0.27, ballY = -Math.cos(ang) * 0.27;
    const sleeveY = -0.4 + 0.18 * sp;
    G.govLinks.forEach((l) => { l.position.set(ballX, ballY, 0); l.rotation.z = -Math.atan2(ballX - 0.02, ballY - sleeveY); });
    G.sleeve.position.y = G.gov.position.y + sleeveY;
    G.govLever.position.y = G.sleeve.position.y;
    // tambour à cames : un tour par cycle (fraction du cycle écoulée)
    const frac = 1 - reserve;
    const camRot = -frac * Math.PI * 2;
    G.cams.forEach((c) => { c.rotation.y = camRot; });
    G.wormWheel.rotation.y = camRot;
    G.worm.rotation.set(0, 0, 0); G.worm.quaternion.setFromUnitVectors(up, new THREE.Vector3(Math.cos(camSt.th), 0, Math.sin(camSt.th))).multiply(_qb.setFromAxisAngle(up, frac * 40 * Math.PI * 2));
    G.racks.forEach((rk, i) => {
      const { F, R0, AMP, y, dir } = rk.userData;
      const r = R0 + AMP * F(((frac % 1) + 1) % 1);
      rk.position.copy(camSt.pos).addScaledVector(dir, r + 0.03).setY(y);
      G.needles[i].rotation.y = -(Math.PI * 0.75) + 1.5 * Math.PI * ((r - R0) / AMP) - Math.PI / 2;
    });
    // compteur : orbites à 1 UA (5 rouleaux) + cycle
    const orbits = simTime / (Math.PI * 2);
    let carry = orbits;
    for (let k = 0; k < 5; k++) {
      const v = carry % 10, lower = k === 0 ? 0 : (orbits / Math.pow(10, k - 1)) % 10;
      const val = k === 0 ? v : Math.floor(v) + (lower > 9 ? lower - 9 : 0);
      G.digits[4 - k].rotation.x = -(val / 10) * Math.PI * 2;
      carry = carry / 10;
    }
    G.digits[5].rotation.x = -((life.cycle + 1) % 10 / 10) * Math.PI * 2;
    // pompe : embrayée pendant l'aspiration
    S.pump = (S.pump || 0) + ((collect > 0 && collect < 1 ? 1 : 0) - (S.pump || 0)) * Math.min(1, dtReal * 4);
    S.pumpA = (S.pumpA || 0) + dtReal * 9 * S.pump;
    G.crank.rotation.y = -S.pumpA;
    G.crank.position.y = G.Yg + 0.13 + 0.03 * (1 - S.pump);
    const tan = new THREE.Vector3(-Math.sin(pumpSt.th), 0, Math.cos(pumpSt.th));
    const pinW = new THREE.Vector3(Math.cos(S.pumpA) * 0.11, 0, -Math.sin(S.pumpA) * 0.11).add(pumpSt.pos);
    const stroke = pinW.clone().sub(pumpSt.pos).dot(tan);
    const capD = 0.3 + stroke * 0.6 * S.pump;
    G.bellowsBody.scale.set(1, capD, 1);
    G.bellowsCap.position.y = capD;
    const capW = G.bellowsBase.clone().addScaledVector(tan, -capD);
    G.rod.position.copy(pinW).setY(G.Yg + 0.2);
    G.rod.scale.x = Math.max(0.05, pinW.distanceTo(capW.setY(pinW.y)));
    G.rod.rotation.y = -Math.atan2(capW.z - pinW.z, capW.x - pinW.x);
    // cloche
    G.hammerT += dtReal;
    const h = G.hammerT;
    const lift = h < 0.25 ? h / 0.25 : h < 0.32 ? 1 - (h - 0.25) / 0.07 : Math.max(0, -0.15 * Math.exp(-(h - 0.32) * 8) * Math.cos((h - 0.32) * 30));
    G.hammer.rotation.z = lift * 0.6 * (G.hammerK || 1);
    G.bell.rotation.z = h > 0.32 && h < 2 ? Math.sin((h - 0.32) * 25) * 0.04 * Math.exp(-(h - 0.32) * 2) : 0;
  }

  // planets : liste de main.js ; pred : index → [x, y, z] (instant présent)
  // life : cycle de vie ; k : échelle des planètes ; pour : {t, dur} du versement
  function update(planets, pred, dtSim, dtReal, running, life, k = 1, pour = null) {
    // ── bras, tubes, roues
    const ok = (p) => pred.has(p.index) && p.a < LIMB_R0 - 0.4 && p.a > 0.2;
    const byIdx = new Map(planets.map((p) => [p.index, p]));
    // planètes perdues ou devenues trop légères : leur bras rentre
    for (const [i, t] of track) {
      const p = byIdx.get(i);
      if (t.alive && (!p || !ok(p) || p.mE < M_OUT)) t.alive = false;
    }
    // nouvelles planètes : un bras libre, ou on remplace la plus légère si
    // la nouvelle est nettement plus massive
    const cands = planets.filter((p) => ok(p) && p.mE >= M_IN && !(track.get(p.index)?.alive)).sort((a, b) => b.m - a.m);
    for (const p of cands) {
      const old = track.get(p.index);
      if (old) { old.alive = true; continue; } // (bras en train de rentrer : il ressort)
      if (track.size >= K) {
        const alive = [...track.entries()].filter(([, t]) => t.alive).sort((a, b) => a[1].mE - b[1].mE);
        if (alive.length && p.mE > alive[0][1].mE * SWAP) alive[0][1].alive = false;
        continue; // (le bras libéré servira quand il sera rentré)
      }
      const used = new Set([...track.values()].map((t) => t.pair));
      const pair = gearPool.find((q) => !used.has(q));
      track.set(p.index, { alive: true, e: 0, s: -1, phi: 0, pair, mE: p.mE });
    }
    // positions : planète vivante → position du GPU ; bras qui rentre → il
    // poursuit son orbite képlérienne à partir de la dernière position connue
    for (const [i, t] of track) {
      const q = t.alive ? pred.get(i) : null;
      if (q) { t.x = q[0]; t.y = q[1]; t.z = q[2]; t.a = Math.hypot(q[0], q[2]); t.phi = Math.atan2(q[2], q[0]); t.mE = byIdx.get(i).mE; }
      else if (t.a) { t.phi += dtSim * Math.pow(t.a, -1.5); t.x = t.a * Math.cos(t.phi); t.z = t.a * Math.sin(t.phi); }
      t.e = Math.max(0, Math.min(1, t.e + (t.alive ? dtReal / 1.3 : -dtReal / 1.0)));
    }
    for (const [i, t] of track) if (!t.alive && t.e <= 0) { t.pair.g.visible = t.pair.p.visible = false; track.delete(i); }
    // étages : par rayon croissant (la plus proche en haut) ; glissement doux
    const order = [...track.values()].filter((t) => t.a).sort((a, b) => a.a - b.a);
    order.forEach((t, j) => { t.s = t.s < 0 ? j : t.s + (j - t.s) * Math.min(1, dtReal * 2.5); });
    let n = 0;
    for (const t of order) {
      const j = n, sl = t.s, e = t.e;
      const eArm = ss(0, 0.55, e), eStem = ss(0.5, 0.9, e), ePin = ss(0.85, 1, e), eHub = ss(0, 0.25, e);
      const { x, y, z, a, phi } = t;
      const ya = Y_ARM0 - sl * DY_ARM, vr = visRadius(t.mE, k), rT = tubeR(sl);
      const ra = 0.014 + 0.008 * Math.min(1, Math.cbrt(t.mE / 30)); // rayon de la tringle
      const rHub = rT / HUB_IN, back = 0.26 + 0.09 * (Math.round(sl) % 3);
      const cx = Math.cos(phi), cz = Math.sin(phi);
      const reach = rHub * 0.97 + (a - rHub * 0.97) * eArm;           // bout de la tringle
      const tx = cx * reach, tz = cz * reach;
      // bague serrée sur le tube (vis de pression), tringle, contre-tringle et contrepoids
      place(hubs, j, _p.set(0, ya, 0), 0, _s.set(rHub * eHub, 0.06, rHub * eHub));
      place(hubScrews, j, _p.set(-cz * rHub, ya, cx * rHub), -phi, _s.set(0.012 * eHub, 0.03 * eHub, 0.012 * eHub));
      place(arms, j, _p.set(cx * rHub * 0.97, ya, cz * rHub * 0.97), -phi, _s.set(Math.max(1e-3, reach - rHub * 0.97), ra * eHub, ra * eHub));
      const bk = rHub + (back - rHub) * eArm;
      place(counters, j, _p.set(-cx * rHub * 0.97, ya, -cz * rHub * 0.97), Math.PI - phi, _s.set(Math.max(1e-3, bk - rHub), ra * eHub, ra * eHub));
      place(weights, j, _p.set(-cx * bk, ya, -cz * bk), -phi, _s.set((0.04 + 2 * ra) * eHub, 0.07 * eHub, (0.04 + 2 * ra) * eHub));
      place(bosses, j, _p.set(tx, ya, tz), 0, _s.set(ra * 1.9 * eHub, ra * 2.6 * eHub, ra * 1.9 * eHub));
      // tige : monte du bossage jusque sous la planète ; pointe au-dessus
      const top = y - vr * 0.85, stemTop = ya + (top - ya) * eStem;
      place(stems, j, _p.set(tx, ya, tz), 0, _s.set(0.009 * eHub, Math.max(0.005, stemTop - ya), 0.009 * eHub));
      place(collars, j, _p.set(tx, stemTop, tz), 0, _s.setScalar((vr * 0.6 + 0.008) * eStem));
      const pin0 = y + vr * 0.9;
      place(pins, j, _p.set(x, pin0, z), 0, _s.set(0.004 * ePin, Math.max(0.001, (PIN_TOP - pin0) * ePin), 0.004 * ePin));
      place(pinTips, j, _p.set(x, pin0 + (PIN_TOP - pin0) * ePin, z), 0, _s.setScalar(0.007 * ePin));
      // tube (de sa roue jusqu'à sa bague) ; roue (solidaire du tube, donc du bras)
      const gy = Y_GEAR0 + sl * DY_GEAR;
      place(tubes, j, _p.set(0, gy, 0), 0, _s.set(rT, Math.max(1e-3, (ya - gy)), rT));
      // rapport : ω_planète / ω_renvoi = n_pignon / n_roue, n_roue + n_pignon = 40
      const om = Math.pow(Math.max(a, 0.2), -1.5);
      const ng = Math.min(LAY_N - 8, Math.max(8, Math.round((LAY_N * OMEGA_L) / (OMEGA_L + om)))), np = LAY_N - ng;
      const { g: G, p: P } = t.pair, bore = tubeR(Math.round(sl));
      if (G.userData.n !== ng || G.userData.b !== bore) { G.geometry = gearGeometry(ng, 0.028, bore); G.userData.n = ng; G.userData.b = bore; }
      if (P.userData.n !== np) { P.geometry = gearGeometry(np, 0.028, 0.035); P.userData.n = np; }
      G.visible = P.visible = true;
      G.position.set(0, gy, 0); G.rotation.y = -phi; G.scale.set(eHub, 1, eHub);
      P.position.set(layP.x, gy, layP.z); P.scale.set(eHub, 1, eHub);
      P.rotation.y = meshAngle(G.rotation.y, ng, np, thLay); // ses dents dans les creux de la roue
      place(gearHubs, j, _p.set(0, gy + 0.03, 0), 0, _s.set(rHub * 0.95, 0.035, rHub * 0.95));
      place(pinHubs, j, _p.set(layP.x, gy + 0.03, layP.z), 0, _s.set(0.035 / HUB_IN * eHub, 0.035, 0.035 / HUB_IN * eHub));
      n++;
    }
    for (const m of [arms, counters, weights, stems, pins, pinTips, bosses, collars, tubes, hubs, hubScrews, gearHubs, pinHubs]) {
      m.count = n; m.instanceMatrix.needsUpdate = true;
    }

    // ── réserve de marche, aspiration et remontage (d'après le cycle de vie)
    const ph = life.phase, pr = Math.min(1, life.p.progress || 0);
    let cum = 0;
    for (let i = 0; i < ph; i++) cum += PHASE_W[i];
    let target, winding = false;
    if (ph < 6) target = 1 - cum - PHASE_W[ph] * pr;
    else if (pr < WIND0) target = PHASE_W[6] * (1 - pr / WIND0);
    else { winding = pr < WIND1 + 0.05; target = ss(WIND0, WIND1, pr); }
    const prevRes = S.reserve;
    S.reserve += (target - S.reserve) * Math.min(1, dtReal * (winding ? 10 : 3));
    const dRes = S.reserve - prevRes;
    if (dRes > 0 && winding) {
      S.ratchet += dRes * 6 * Math.PI * 2;      // six tours de ressort pour un cycle
      S.crown += dRes * 6 * Math.PI * 2 * 1.45; // (rapport couronne / rochet)
    }
    ratchet.rotation.y = -S.ratchet;
    crownWheel.rotation.y = S.crown;
    stemG.rotation.set(0, 0, 0); stemG.quaternion.setFromUnitVectors(up, outB).multiply(_qb.setFromAxisAngle(up, S.crown));
    const toothF = S.ratchet / ((Math.PI * 2) / 24), tooth = Math.floor(toothF);
    if (tooth !== S.tooth) { S.tooth = tooth; if (winding && api.onClick) api.onClick(); }
    click.rotation.y = click.userData.base - 0.25 * (toothF - tooth);
    hand.rotation.y = -dialAngle(S.reserve);
    // trémie : les débris remontent pendant le remontage ; au nouveau cycle la
    // vanne s'ouvre et le réservoir se vide dans la cloche
    api.collect = ph === 6 ? ss(WIND0, WIND1, pr) : 0;
    let fill = 0, open = 0;
    if (ph === 6) fill = api.collect;
    else if (ph === 0 && pour) { fill = 1 - ss(0, pour.dur, pour.t); open = pour.t < pour.dur + 0.5 ? 1 : 0; }
    heapLevel.value = fill;
    S.valve += (open - S.valve) * Math.min(1, dtReal * 5);
    valve.rotation.y = S.valve * Math.PI / 2;
    root.children.forEach((c) => { if (c.userData.isHeap) c.visible = fill > 0.01; });

    // ── levier d'arrêt
    const held = !running || (ph === 6 && pr > WIND0 - 0.05);
    if (life.cycle !== S.cycle) {
      if (S.cycle >= 0 && api.onClack) api.onClack();
      S.cycle = life.cycle;
    }
    S.stop += ((held ? 1 : 0) - S.stop) * Math.min(1, dtReal * (held ? 4 : 14));
    stop.rotation.y = stop.userData.off + (stop.userData.on - stop.userData.off) * S.stop;

    // ── rouage : l'arbre de renvoi tourne avec le temps simulé ; la roue
    //    d'échappement avance par à-coups et tout le rouage la suit, dents
    //    dans les creux (rapports exacts : 10/22, 22/8, 10/8)
    const dLay = dtSim * OMEGA_L;
    S.lay += dLay;
    const R_ESC = (10 / 22) * (22 / 8) * (10 / 8);
    S.escCont += dLay * R_ESC;
    S.ph = S.escCont * 15; // une oscillation du balancier par dent d'échappement
    const rate = dtReal > 0 ? (dLay * R_ESC * 15) / dtReal / (Math.PI * 2) : 0; // Hz
    const half = Math.floor(S.ph / Math.PI), fr = Math.min(1, (S.ph / Math.PI - half) * 5);
    const escRot = ((half + fr * fr * (3 - 2 * fr)) * Math.PI) / 15; // sens : renvoi + → échappement −  (rotation.y = −angle)
    escape.rotation.y = escRot; escPin.rotation.y = escRot;
    const cRot = meshAngle(escRot, 8, 10, angTo(eW, cW));
    centerWheel.rotation.y = cRot; centerPin.rotation.y = cRot;
    const bRot = meshAngle(cRot, 8, 22, angTo(cW, bW));
    barrelGear.rotation.y = bRot; barrel.rotation.y = bRot;
    layPin.rotation.y = meshAngle(bRot, 22, 10, angTo(bW, layP));
    // balancier : amplitude réduite quand il bat très vite ou que le ressort
    // faiblit ; immobilisé par le levier d'arrêt
    const ampT = held ? 0 : Math.min(1, 0.35 + S.reserve * 4) / (1 + Math.max(0, rate - 5) / 5);
    S.amp += (ampT - S.amp) * Math.min(1, dtReal * (held ? 6 : 2));
    const bAng = Math.sin(S.ph) * 2.5 * S.amp;
    balance.rotation.y = bAng;
    const hair = balance.userData.hair;
    hair.scale.set(1 + 0.05 * Math.sin(S.ph) * S.amp, 1, 1 + 0.05 * Math.sin(S.ph) * S.amp);
    hair.rotation.y = -bAng * 0.85;
    anchor.rotation.y = anchor.userData.base + 0.12 * Math.tanh(Math.sin(S.ph) * 5) * Math.min(1, S.amp * 3);

    updateGallery(dtSim, dtReal, life, rate, S.reserve, api.collect, S.lay / OMEGA_L);

    // ── peigne : relevé si l'étoile enfle ; curseur de la ligne des glaces
    const starR = life.p.starVisR || 0.06;
    const liftT = Math.atan(Math.max(0, starR + 0.25 - (TOOTH_TIP_Y - 0.02)) / (LIMB_RM - R_IN));
    S.lift += (liftT - S.lift) * Math.min(1, dtReal * 1.5);
    comb.rotation.z = -S.lift;
    const sx = Math.min(R_OUT, Math.max(R_IN, life.p.snow || 2.7)) - LIMB_RM;
    snowSlider.position.x += (sx - snowSlider.position.x) * Math.min(1, dtReal * 2);
    // lames : vibration amortie après le passage d'une pointe
    for (const t of teeth) {
      if (t.amp < 1e-3) { if (t.amp !== 0) { t.amp = 0; t.g.quaternion.copy(t.q0); } continue; }
      t.t += dtReal;
      t.amp *= Math.exp(-dtReal * 3.2);
      // la pointe soulève d'abord la lame, puis elle vibre
      const bend = (t.t < 0.06 ? t.t / 0.06 : Math.cos((t.t - 0.06) * t.f * Math.PI * 2 / 6)) * 0.12 * t.amp;
      t.g.quaternion.copy(t.q0).multiply(_qb.setFromAxisAngle(zAxis, bend));
    }
  }

  // une planète croise la tête : sa pointe soulève la lame de son rayon
  function pluck(a, strength = 1) {
    let best = null, bd = 1e9;
    for (const t of teeth) { const d = Math.abs(t.r - a); if (d < bd) { bd = d; best = t; } }
    if (!best) return;
    best.amp = Math.min(1, best.amp + 0.6 + 0.4 * strength);
    best.t = 0;
  }

  // éclairage de la machine par l'étoile (couleur et luminosité du cycle de vie)
  function setStar(color, lightK, shell = 0) {
    // (couleur de l'étoile adoucie vers le blanc : le laiton reste du laiton)
    starLight.color.setRGB(0.5 + 0.5 * color[0], 0.5 + 0.5 * color[1], 0.5 + 0.5 * color[2]);
    starLight.intensity = 2.4 * Math.min(2.0, lightK) + 10 * shell;
  }

  function setVisible(v) {
    root.visible = v;
    scene.environment = v ? env : null;
  }

  // ombres : toute la mécanique en porte et en reçoit (pas le verre)
  root.traverse((o) => {
    if (!o.isMesh) return;
    const glass = o.material && o.material.blending === THREE.AdditiveBlending;
    o.castShadow = !glass && !o.userData.isHeap;
    o.receiveShadow = !glass;
  });

  return Object.assign(api, { update, pluck, setStar, setVisible });
}
