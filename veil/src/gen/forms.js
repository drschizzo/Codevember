// Les statues absentes : des corps sculptés en champs de distance, posés sur
// le dessus du socle (y = 0), face à +z. On ne les voit jamais ; seul le voile
// qui s'y pose les dessine. Les reliefs du visage sont accentués d'environ
// 20 % (comme le marbre voilé napolitain) pour se lire à travers l'étoffe.
//
// buildForm(spec) → f(x, y, z) (distance signée, mètres), avec
//   f.box : boîte englobante [x0, y0, z0, x1, y1, z1] (au-delà : pas de contact)
//   f.top : hauteur du sommet sur l'axe du cordon (x = z = 0)
// La forme est décalée pour que son point le plus haut près de l'axe soit sur
// l'axe : c'est là que la bague du voile se pose.
import { sdSphere, sdEllipsoid, sdCapsule, sdRoundBox, sdRoundCyl, makeLathe, smin, smax, makeFrame } from './sdf.js';

const { min, max, hypot, PI } = Math;

// ── Une tête (repère local : centre du crâne vers (0, 0.445, 0), regard +z) ──
// o : options { bun, chin, nose } — petites variations de traits
function headSDF(x, y, z, o) {
  // borne rapide (la tête tient dans une sphère de 16 cm autour de son centre)
  const bs = hypot(x, y - 0.42, z - 0.01) - 0.16;
  if (bs > 0.02) return bs;
  let d = sdEllipsoid(x, y, z, 0, 0.445, -0.012, 0.077, 0.098, 0.098); // crâne
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.395, 0.03, 0.063, 0.08, 0.07), 0.03); // visage
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.352, 0.032 * o.chin, 0.054, 0.045, 0.062), 0.03); // mâchoire
  d = smin(d, sdCapsule(x, y, z, -0.042, 0.441, 0.082, 0.042, 0.441, 0.082, 0.013), 0.014); // arcades
  d = smin(d, sdSphere(x, y, z, 0.048, 0.41, 0.06, 0.03), 0.02); // pommettes
  d = smin(d, sdSphere(x, y, z, -0.048, 0.41, 0.06, 0.03), 0.02);
  d = smax(d, -sdSphere(x, y, z, 0.031, 0.423, 0.1, 0.017), 0.012); // orbites
  d = smax(d, -sdSphere(x, y, z, -0.031, 0.423, 0.1, 0.017), 0.012);
  const nz = 0.122 * o.nose;
  d = smin(d, sdCapsule(x, y, z, 0, 0.436, 0.093, 0, 0.392, nz, 0.008, 0.012), 0.012); // nez
  d = smin(d, sdSphere(x, y, z, 0, 0.388, nz - 0.004, 0.014), 0.008);
  d = smin(d, sdSphere(x, y, z, 0.015, 0.384, 0.106, 0.009), 0.008); // ailes du nez
  d = smin(d, sdSphere(x, y, z, -0.015, 0.384, 0.106, 0.009), 0.008);
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.362, 0.1, 0.025, 0.009, 0.012), 0.008); // lèvres
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.349, 0.097, 0.021, 0.009, 0.012), 0.008);
  d = smin(d, sdSphere(x, y, z, 0, 0.326, 0.08 * o.chin + 0.004, 0.021), 0.015); // menton
  d = smin(d, sdEllipsoid(x, y, z, 0.077, 0.415, -0.005, 0.012, 0.03, 0.018), 0.008); // oreilles
  d = smin(d, sdEllipsoid(x, y, z, -0.077, 0.415, -0.005, 0.012, 0.03, 0.018), 0.008);
  if (o.bun) d = smin(d, sdSphere(x, y, z, 0, 0.47, -0.105, 0.045), 0.025); // chignon
  return d;
}

// piédouche (pied tourné d'un buste)
const pedestal = makeLathe(0, 0, [[0, 0.085], [0.012, 0.085], [0.022, 0.068], [0.04, 0.046], [0.062, 0.05], [0.075, 0.06]]);

function bust(p) {
  const head0 = makeFrame({ pivot: [0, 0.33, 0], rx: p.tilt, ry: p.turn, rz: p.lean * 0.5 }), head = (x, y, z) => head0(x, y - 0.06, z); // (tête remontée de 6 cm : un cou dégagé)
  const o = { bun: p.bun, chin: p.chin, nose: p.nose };
  return (x, y, z) => {
    // (épaules larges, hautes et coupées droit, comme un buste en hermès : le
    // voile ne montre que l'enveloppe du dessus, et sous des épaules étroites
    // et tombantes il filait de la tête au socle en cloche — un fantôme. La
    // ligne tête, épaules, chute verticale est celle d'une personne voilée.)
    let d = sdRoundBox(x, y, z, 0, 0.14, -0.008, 0.2, 0.14, 0.085, 0.03); // poitrine, taillée en bloc
    d = smin(d, sdEllipsoid(x, y, z, 0.165, 0.255, -0.012, 0.07, 0.045, 0.07), 0.03); // épaules
    d = smin(d, sdEllipsoid(x, y, z, -0.165, 0.255, -0.012, 0.07, 0.045, 0.07), 0.03);
    const q = head(x, y, z);
    d = smin(d, sdCapsule(q[0], q[1], q[2], 0, 0.2, -0.012, 0, 0.35, 0.0, 0.05, 0.046), 0.03); // cou
    d = smin(d, headSDF(q[0], q[1], q[2], o), 0.02);
    return d;
  };
}

// Les Amants (Magritte) : deux têtes qui s'embrassent, de profil sur l'axe x
function lovers(p) {
  const tA = makeFrame({ pivot: [0, 0.27, 0], ry: PI / 2, rz: -p.lean, rx: p.tilt });
  const tB = makeFrame({ pivot: [0, 0.27, 0], ry: -PI / 2, rz: p.lean, rx: p.tilt * 0.6 });
  const off = 0.098; // demi-distance des centres : les lèvres se touchent
  const oA = { bun: p.bun, chin: 1, nose: 1 }, oB = { bun: false, chin: 1.06, nose: 1.04 };
  return (x, y, z) => {
    let d = smax(sdEllipsoid(x, y, z, 0, 0.11, 0, 0.22, 0.085, 0.1), 0.05 - y, 0.012); // épaules jointes
    d = smin(d, sdRoundBox(x, y, z, 0, 0.025, 0, 0.12, 0.025, 0.07, 0.012), 0.02); // plinthe de la sculpture
    // (têtes abaissées de 6 cm : cous de 8 cm au-dessus des épaules)
    let q = tA(x + off, y + 0.06, z);
    let h = smin(sdCapsule(q[0], q[1], q[2], 0, 0.2, -0.015, 0, 0.35, -0.005, 0.048), headSDF(q[0], q[1], q[2], oA), 0.02);
    q = tB(x - off, y + 0.06, z);
    h = min(h, smin(sdCapsule(q[0], q[1], q[2], 0, 0.2, -0.015, 0, 0.35, -0.005, 0.05), headSDF(q[0], q[1], q[2], oB), 0.02));
    return smin(d, h, 0.03);
  };
}

// Mains jointes : deux mains paume contre paume, doigts vers le haut
function hand(side, p) {
  // repère : paume dans le plan x = 0, pouce vers +z, doigts vers +y
  const s = side;
  const fingers = [[0.026, 0.083], [0.009, 0.092], [-0.009, 0.087], [-0.026, 0.07]]; // [z, longueur]
  return (x, y, z) => {
    const lx = x * s;
    const bs = hypot(lx - 0.02, y - 0.2, z) - 0.17;
    if (bs > 0.02) return bs;
    let d = sdRoundBox(lx, y, z, 0.016, 0.175, 0, 0.014, 0.05, 0.042, 0.012); // paume
    d = smin(d, sdCapsule(lx, y, z, 0.03, 0.06, -0.01, 0.018, 0.13, 0, 0.026, 0.022), 0.02); // poignet
    d = smin(d, sdCapsule(lx, y, z, 0.07, -0.05, -0.03, 0.035, 0.07, -0.01, 0.034, 0.027), 0.02); // avant-bras
    for (const [fz, L] of fingers) {
      const tip = 0.225 + L * p.reach;
      d = smin(d, sdCapsule(lx, y, z, 0.012, 0.22, fz, 0.0095, tip - 0.01, fz * 0.92, 0.0098, 0.0085), 0.006);
    }
    d = smin(d, sdCapsule(lx, y, z, 0.022, 0.15, 0.042, 0.012, 0.215, 0.05, 0.012, 0.0095), 0.01); // pouce
    return d;
  };
}
function hands(p) {
  const L = hand(1, p), Rh = hand(-1, p);
  const fr = makeFrame({ pivot: [0, 0.1, 0], ry: p.turn, rx: -0.12 });
  return (x, y, z) => {
    let d = sdRoundBox(x, y, z, 0, 0.03, 0, 0.11, 0.03, 0.08, 0.012); // dé de pierre de la sculpture
    const q = fr(x, y, z);
    const k = 1.25; // (plus grandes que nature)
    const qx = q[0] / k, qy = (q[1] - 0.06) / k + 0.05, qz = q[2] / k;
    d = smin(d, min(L(qx, qy, qz), Rh(qx, qy, qz)) * k, 0.02);
    return d;
  };
}

// Nature morte (Morandi) : bouteilles et pots tournés
const PROFILES = {
  bottle: [[0, 0.055], [0.01, 0.06], [0.2, 0.058], [0.25, 0.045], [0.29, 0.022], [0.37, 0.018], [0.385, 0.021], [0.39, 0.018]],
  jug: [[0, 0.05], [0.04, 0.072], [0.13, 0.075], [0.19, 0.05], [0.23, 0.042], [0.245, 0.048]],
  tin: [[0, 0.06], [0.008, 0.062], [0.17, 0.062], [0.18, 0.058]],
  bowl: [[0, 0.04], [0.03, 0.07], [0.07, 0.088], [0.1, 0.092]],
  carafe: [[0, 0.07], [0.06, 0.085], [0.12, 0.07], [0.2, 0.03], [0.3, 0.025], [0.32, 0.03]],
};
function stillLife(p) {
  const parts = p.items.map((it) => {
    const prof = PROFILES[it.kind].map(([yy, r]) => [yy * it.s, r * it.s]);
    return makeLathe(it.x, it.z, prof);
  });
  return (x, y, z) => {
    let d = Infinity;
    for (const f of parts) d = min(d, f(x, y, z));
    return d;
  };
}

// Muse endormie (Brancusi) : une tête couchée sur sa joue
function muse(p) {
  const fr = makeFrame({ pivot: [0, 0.42, 0], rz: PI / 2 - 0.15, ry: p.turn, rx: 0.15 });
  const o = { bun: false, chin: 0.95, nose: 0.92 };
  return (x, y, z) => {
    let d = sdRoundBox(x, y, z, 0, 0.02, 0, 0.13, 0.02, 0.1, 0.01); // socle bas de la sculpture
    const q = fr(x, y + 0.255, z);
    d = smin(d, headSDF(q[0], q[1], q[2], o), 0.025);
    return d;
  };
}

// Torse antique sans bras
function torso(p) {
  const fr = makeFrame({ pivot: [0, 0.2, 0], rz: p.lean * 0.6, ry: p.turn });
  return (x, y, z) => {
    let d = pedestal(x, y, z);
    const q = fr(x, y, z);
    const [a, b, c] = q;
    let t = sdEllipsoid(a, b, c, 0, 0.12, -0.005, 0.12, 0.07, 0.085); // bassin
    t = smin(t, sdEllipsoid(a, b, c, 0, 0.22, 0.0, 0.1, 0.09, 0.07), 0.06); // taille
    t = smin(t, sdEllipsoid(a, b, c, 0, 0.33, -0.01, 0.13, 0.09, 0.08), 0.06); // cage
    t = smin(t, sdSphere(a, b, c, 0.048, 0.33, 0.06, 0.042), 0.03); // seins
    t = smin(t, sdSphere(a, b, c, -0.048, 0.33, 0.06, 0.042), 0.03);
    t = smin(t, sdEllipsoid(a, b, c, 0.12, 0.395, -0.015, 0.055, 0.045, 0.05), 0.04); // épaules
    t = smin(t, sdEllipsoid(a, b, c, -0.12, 0.395, -0.015, 0.055, 0.045, 0.05), 0.04);
    t = smin(t, sdCapsule(a, b, c, 0, 0.38, -0.01, 0, 0.47, 0.0, 0.042, 0.038), 0.03); // cou
    t = smax(t, b - 0.475, 0.01); // cou coupé
    t = smax(t, 0.07 - b, 0.01); // bassin coupé
    d = smin(d, t, 0.015);
    return d;
  };
}

// ── Des objets à silhouette franche : ce qui dépasse (oreilles, bec, anse)
// se lit à travers l'étoffe, là où un corps lisse devient un fantôme ──
// tore dans le plan xy (axe z), centré en (cx, cy, cz)
function sdTorusZ(x, y, z, cx, cy, cz, R, r) {
  const q = hypot(x - cx, y - cy) - R;
  return hypot(q, z - cz) - r;
}

// Chat qui fait le gros dos, de profil sur l'axe x : la queue dressée, le dos
// en arche, la tête basse et ses deux oreilles. Trois reliefs à trois
// hauteurs, séparés par deux creux : c'est ce que le linge dessine. (Assis à
// l'égyptienne, il n'offrait que deux pointes au sommet d'un cône.)
function cat(p) {
  const head = makeFrame({ pivot: [0.2, 0.25, 0], ry: p.turn * 0.5, rx: p.tilt * 0.4 });
  return (x, y, z) => {
    let d = sdCapsule(x, y, z, -0.13, 0.27, 0, -0.02, 0.4, 0, 0.068, 0.072); // croupe → sommet du dos
    d = smin(d, sdCapsule(x, y, z, -0.02, 0.4, 0, 0.13, 0.28, 0, 0.072, 0.062), 0.03); // sommet → épaules
    for (const [lx, fx] of [[-0.13, -0.15], [0.12, 0.15]]) for (const sz of [-1, 1]) d = smin(d, sdCapsule(x, y, z, lx, 0.25, sz * 0.045, fx, 0.02, sz * 0.05, 0.034, 0.024), 0.02); // pattes raidies
    d = smin(d, sdCapsule(x, y, z, -0.17, 0.27, 0, -0.2, 0.47, 0, 0.03, 0.024), 0.02); // queue dressée
    d = smin(d, sdCapsule(x, y, z, -0.2, 0.47, 0, -0.175, 0.52, 0, 0.024, 0.022), 0.01); // son bout, recourbé
    const [a, b, c] = head(x, y, z);
    let h = sdEllipsoid(a, b, c, 0.215, 0.25, 0, 0.068, 0.062, 0.07); // tête
    h = smin(h, sdEllipsoid(a, b, c, 0.27, 0.23, 0, 0.03, 0.028, 0.034), 0.02); // museau
    for (const sz of [-1, 1]) h = smin(h, sdCapsule(a, b, c, 0.2, 0.29, sz * 0.04, 0.19, 0.365, sz * 0.066, 0.03, 0.015), 0.012); // oreilles
    return smin(d, smin(h, sdCapsule(x, y, z, 0.13, 0.28, 0, 0.19, 0.25, 0, 0.055), 0.02), 0.025); // cou
  };
}

// Tête de cheval (le cheval de Séléné, au Parthénon) sur un bloc
function horse(p) {
  const fr = makeFrame({ pivot: [0, 0.05, 0], ry: p.turn * 0.8, rz: p.lean * 0.5 });
  return (x, y, z) => {
    let d = sdRoundBox(x, y, z, 0, 0.03, 0, 0.095, 0.03, 0.08, 0.01);
    const [a, b, c] = fr(x, y, z);
    let h = sdCapsule(a, b, c, 0, 0.05, -0.035, 0, 0.3, 0.015, 0.072, 0.05); // encolure
    h = smin(h, sdCapsule(a, b, c, 0, 0.07, -0.08, 0, 0.34, -0.02, 0.028, 0.022), 0.04); // crinière
    h = smin(h, sdEllipsoid(a, b, c, 0, 0.3, 0.03, 0.05, 0.06, 0.065), 0.04); // ganache
    h = smin(h, sdCapsule(a, b, c, 0, 0.345, 0.0, 0, 0.2, 0.17, 0.052, 0.036), 0.03); // chanfrein
    h = smin(h, sdEllipsoid(a, b, c, 0, 0.19, 0.19, 0.04, 0.036, 0.042), 0.02); // bout du nez
    h = smin(h, sdCapsule(a, b, c, 0.026, 0.37, -0.012, 0.036, 0.44, -0.026, 0.018, 0.004), 0.01); // oreilles
    h = smin(h, sdCapsule(a, b, c, -0.026, 0.37, -0.012, -0.036, 0.44, -0.026, 0.018, 0.004), 0.01);
    return smin(d, h, 0.02);
  };
}

// Théière : la panse, le bec, l'anse et le bouton du couvercle
const verseuse = makeLathe(0, 0, [[0, 0.065], [0.015, 0.075], [0.06, 0.105], [0.13, 0.115], [0.21, 0.09], [0.28, 0.058], [0.33, 0.052], [0.345, 0.062], [0.365, 0.055], [0.39, 0.03]]);
function teapot(p) {
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.25 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    // (une verseuse haute : la théière basse ne dépassait pas 39 cm, le linge
    // reposait surtout sur le socle et n'en faisait qu'un tas. Trois chevilles
    // à trois hauteurs — le bouton, le bout du bec, le haut de l'anse — et
    // rien de plus mince que trois mailles.)
    let d = verseuse(x, y, z); // panse en poire, col, couvercle
    d = smin(d, sdSphere(x, y, z, 0, 0.415, 0, 0.026), 0.012); // bouton
    d = smin(d, sdCapsule(x, y, z, 0.07, 0.1, 0, 0.215, 0.33, 0, 0.034, 0.02), 0.02); // bec, long et relevé
    const t = smax(sdTorusZ(x, y, z, -0.1, 0.255, 0, 0.085, 0.02), x + 0.07, 0.005); // anse, qui remonte au-dessus de l'épaule
    return smin(d, t, 0.012);
  };
}

// Amphore : col étroit, deux anses
const amphoraBody = makeLathe(0, 0, [[0, 0.05], [0.02, 0.06], [0.07, 0.085], [0.17, 0.13], [0.27, 0.118], [0.33, 0.075], [0.37, 0.07], [0.41, 0.085], [0.432, 0.1], [0.445, 0.098]]);
function amphora(p) {
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.25 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    let d = amphoraBody(x, y, z);
    for (const sx of [1, -1]) {
      // (anses à volutes, plus hautes que la lèvre : sous le linge, des anses
      // plaquées au col disparaissaient ; celles-ci font deux cornes de part
      // et d'autre d'une bouche large)
      const t = smax(sdTorusZ(sx * x, y, z, 0.105, 0.37, 0, 0.068, 0.021), 0.06 - sx * x, 0.006);
      d = smin(d, t, 0.012);
      d = smin(d, sdRoundCyl(sx * x, y, z, 0.158, 0, 0.455, 0.5, 0.034, 0.012), 0.01); // volute
    }
    return d;
  };
}

// ── Des objets qui ne figurent rien, mais que l'étoffe sculpte (à la façon
// des objets empaquetés de Christo et Jeanne-Claude) ──
// Chaise : le dossier fait une tente, l'assise une table, les pieds des plis
function chair(p) {
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.3 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    let d = sdRoundBox(x, y, z, 0, 0.268, 0.005, 0.125, 0.013, 0.118, 0.006); // assise
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) d = min(d, sdCapsule(x, y, z, sx * 0.105, 0.012, sz * 0.098 + 0.005, sx * 0.108, 0.26, sz * 0.1 + 0.005, 0.012, 0.011)); // pieds
    // Le dossier porteur est l'arceau de la chaise montrée (gen : chairShow), en
    // 4 cm d'épaisseur, trois mailles du voile : à 2 cm, le linge posé dessus
    // le traversait rang après rang, comme un fil à couper le beurre, et ne
    // restait que sur l'assise. Ni traverse droite ni bouts de montants : le
    // linge dessinait un rectangle au-dessus d'un arceau, et les bouts le perçaient.
    for (const sx of [-1, 1]) d = min(d, sdCapsule(x, y, z, sx * 0.1, 0.27, -0.09, sx * 0.102, 0.385, -0.112, 0.02)); // montants
    d = min(d, smax(sdTorusZ(x, y, z, 0, 0.385, -0.112, 0.102, 0.02), 0.385 - y, 0.004)); // arceau
    return d;
  };
}

// Lyre : deux cornes écartées de 36 cm, la traverse plus bas entre elles.
// Deux pointes aussi éloignées ne se fondent pas en une tente : le linge
// plonge de l'une à l'autre et dessine un M.
function lyre() {
  return (x, y, z) => {
    let d = sdEllipsoid(x, y, z, 0, 0.13, 0, 0.115, 0.115, 0.06); // caisse
    d = smin(d, sdRoundBox(x, y, z, 0, 0.02, 0, 0.09, 0.02, 0.06, 0.008), 0.015); // pied
    for (const sx of [-1, 1]) {
      d = smin(d, sdCapsule(x, y, z, sx * 0.09, 0.17, 0, sx * 0.17, 0.33, 0, 0.034, 0.028), 0.02); // bras, qui s'ouvrent
      d = smin(d, sdCapsule(x, y, z, sx * 0.17, 0.33, 0, sx * 0.155, 0.47, 0, 0.028, 0.024), 0.012); // cornes
    }
    d = min(d, sdCapsule(x, y, z, -0.165, 0.36, 0, 0.165, 0.36, 0, 0.02)); // traverse (joug)
    return d;
  };
}

// ── Les modèles détaillés (show) ─────────────────────────────────────────────
// Ce que l'hologramme montre. Le linge se pose sur les formes ci-dessus,
// épaissies exprès (rien de plus mince que trois mailles) ; l'hologramme, lui,
// dessine l'objet à ses vraies sections — barreaux, anses, cordes — logé à
// l'intérieur de la forme épaisse, donc toujours sous le linge.
const sdTorusY = (x, y, z, cx, cy, cz, R, r) => hypot(hypot(x - cx, z - cz) - R, y - cy) - r; // (anneau horizontal)
const sdTorusX = (x, y, z, cx, cy, cz, R, r) => hypot(hypot(y - cy, z - cz) - R, x - cx) - r; // (roue dans le plan yz)
const sdDiscX = (x, y, z, cx, cy, cz, R, hw, r) => sdRoundCyl(y - cy, x, z - cz, 0, 0, cx - hw, cx + hw, R, r); // (disque d'axe x)
const sdDiscZ = (x, y, z, cx, cy, cz, R, hw, r) => sdRoundCyl(x - cx, z, y - cy, 0, 0, cz - hw, cz + hw, R, r); // (disque d'axe z)

// Chaise de bistrot en hêtre courbé (Thonet n° 14, 1859) : assise ronde, deux
// arceaux de dossier, pieds galbés, cerclage
function chairShow(p) {
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.3 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    let d = sdRoundCyl(x, y, z, 0, 0.005, 0.262, 0.28, 0.125, 0.008); // assise
    d = min(d, sdTorusY(x, y, z, 0, 0.255, 0.005, 0.116, 0.008)); // ceinture
    d = min(d, sdTorusY(x, y, z, 0, 0.115, 0.005, 0.098, 0.006)); // cerclage des pieds
    for (const sx of [-1, 1]) {
      d = min(d, sdCapsule(x, y, z, sx * 0.082, 0.26, 0.088, sx * 0.104, 0.008, 0.112, 0.012, 0.008)); // pied avant
      d = min(d, sdCapsule(x, y, z, sx * 0.085, 0.26, -0.082, sx * 0.106, 0.008, -0.102, 0.012, 0.008)); // pied arrière
      d = min(d, sdCapsule(x, y, z, sx * 0.1, 0.26, -0.086, sx * 0.102, 0.385, -0.112, 0.012, 0.011)); // montant du grand arceau
      d = min(d, sdCapsule(x, y, z, sx * 0.05, 0.27, -0.088, sx * 0.058, 0.365, -0.108, 0.008)); // montant du petit
    }
    d = min(d, smax(sdTorusZ(x, y, z, 0, 0.385, -0.112, 0.102, 0.011), 0.385 - y, 0.004)); // grand arceau
    d = min(d, smax(sdTorusZ(x, y, z, 0, 0.365, -0.108, 0.058, 0.008), 0.365 - y, 0.004)); // petit arceau
    return d;
  };
}

// Chat qui fait le gros dos : échine, cuisses, pattes et coussinets, queue en
// trois segments, tête à museau, joues et oreilles pointues
function catShow(p) {
  const head = makeFrame({ pivot: [0.2, 0.25, 0], ry: p.turn * 0.5, rx: p.tilt * 0.4 });
  return (x, y, z) => {
    let d = sdCapsule(x, y, z, -0.13, 0.27, 0, -0.02, 0.395, 0, 0.055, 0.06); // croupe → sommet du dos
    d = smin(d, sdCapsule(x, y, z, -0.02, 0.395, 0, 0.13, 0.28, 0, 0.06, 0.048), 0.03); // sommet → épaules
    d = smin(d, sdEllipsoid(x, y, z, 0.05, 0.27, 0, 0.09, 0.05, 0.045), 0.03); // ventre rentré
    for (const sz of [-1, 1]) {
      d = smin(d, sdEllipsoid(x, y, z, -0.13, 0.21, sz * 0.042, 0.045, 0.07, 0.028), 0.02); // cuisse
      d = smin(d, sdCapsule(x, y, z, -0.135, 0.15, sz * 0.045, -0.15, 0.03, sz * 0.05, 0.019, 0.013), 0.012); // jarret
      d = smin(d, sdEllipsoid(x, y, z, -0.138, 0.012, sz * 0.05, 0.028, 0.012, 0.017), 0.008); // coussinet
      d = smin(d, sdCapsule(x, y, z, 0.12, 0.25, sz * 0.038, 0.15, 0.03, sz * 0.045, 0.021, 0.013), 0.012); // patte avant
      d = smin(d, sdEllipsoid(x, y, z, 0.162, 0.012, sz * 0.045, 0.028, 0.012, 0.017), 0.008);
    }
    d = smin(d, sdCapsule(x, y, z, -0.165, 0.27, 0, -0.2, 0.4, 0, 0.02, 0.016), 0.015); // queue
    d = smin(d, sdCapsule(x, y, z, -0.2, 0.4, 0, -0.2, 0.47, 0, 0.016, 0.013), 0.006);
    d = smin(d, sdCapsule(x, y, z, -0.2, 0.47, 0, -0.177, 0.512, 0, 0.013, 0.009), 0.006);
    d = smin(d, sdCapsule(x, y, z, 0.13, 0.28, 0, 0.19, 0.25, 0, 0.044, 0.04), 0.02); // cou
    const [a, b, c] = head(x, y, z);
    let h = sdEllipsoid(a, b, c, 0.215, 0.25, 0, 0.056, 0.052, 0.058); // tête
    h = smin(h, sdEllipsoid(a, b, c, 0.262, 0.232, 0, 0.026, 0.022, 0.03), 0.015); // museau
    h = smin(h, sdSphere(a, b, c, 0.287, 0.24, 0, 0.007), 0.004); // truffe
    for (const sz of [-1, 1]) {
      h = smin(h, sdSphere(a, b, c, 0.248, 0.224, sz * 0.03, 0.021), 0.01); // joue
      h = smax(h, -sdSphere(a, b, c, 0.262, 0.266, sz * 0.03, 0.01), 0.006); // orbite
      h = smin(h, sdCapsule(a, b, c, 0.2, 0.288, sz * 0.036, 0.19, 0.36, sz * 0.062, 0.024, 0.003), 0.008); // oreille
    }
    return smin(d, h, 0.015);
  };
}

// Buste sur son piédouche : la poitrine drapée coupée en arrondi, les épaules,
// le cou dégagé, la tête et ses traits
function bustShow(p) {
  const head0 = makeFrame({ pivot: [0, 0.33, 0], rx: p.tilt, ry: p.turn, rz: p.lean * 0.5 });
  const o = { bun: p.bun, chin: p.chin, nose: p.nose };
  return (x, y, z) => {
    let d = smax(sdEllipsoid(x, y, z, 0, 0.185, -0.008, 0.185, 0.095, 0.08), 0.09 - y, 0.012); // poitrine, coupée
    d = smin(d, sdEllipsoid(x, y, z, 0.15, 0.236, -0.012, 0.062, 0.042, 0.06), 0.022); // épaules
    d = smin(d, sdEllipsoid(x, y, z, -0.15, 0.236, -0.012, 0.062, 0.042, 0.06), 0.022);
    d = smin(d, sdCapsule(x, y, z, -0.1, 0.25, 0.04, 0.1, 0.25, 0.04, 0.01), 0.015); // clavicules
    d = smin(d, pedestal(x, y * 0.85, z), 0.012); // piédouche
    const q = head0(x, y - 0.06, z);
    d = smin(d, sdCapsule(q[0], q[1], q[2], 0, 0.2, -0.012, 0, 0.35, 0.0, 0.044, 0.04), 0.018); // cou
    d = smin(d, headSDF(q[0], q[1], q[2], o), 0.02);
    return d;
  };
}

// Verseuse : pied, panse en poire, col, couvercle à bouton, bec en col de
// cygne, anse en oreille, deux filets
const verseuseFine = makeLathe(0, 0, [[0, 0.06], [0.008, 0.068], [0.02, 0.058], [0.035, 0.068], [0.08, 0.104], [0.13, 0.112], [0.2, 0.09], [0.27, 0.054], [0.32, 0.046], [0.34, 0.054], [0.352, 0.058]]);
const verseuseLid = makeLathe(0, 0, [[0.352, 0.056], [0.362, 0.05], [0.378, 0.03], [0.39, 0.01]]);
function teapotShow(p) {
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.25 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    let d = verseuseFine(x, y, z);
    d = min(d, verseuseLid(x, y, z));
    d = min(d, sdCapsule(x, y, z, 0, 0.388, 0, 0, 0.402, 0, 0.006)); // tige du bouton
    d = smin(d, sdSphere(x, y, z, 0, 0.41, 0, 0.013), 0.004);
    d = min(d, sdTorusY(x, y, z, 0, 0.13, 0, 0.109, 0.004)); // filets
    d = min(d, sdTorusY(x, y, z, 0, 0.3, 0, 0.049, 0.004));
    let b = sdCapsule(x, y, z, 0.085, 0.11, 0, 0.15, 0.17, 0, 0.026, 0.018); // bec
    b = smin(b, sdCapsule(x, y, z, 0.15, 0.17, 0, 0.19, 0.27, 0, 0.018, 0.012), 0.012);
    b = smin(b, sdCapsule(x, y, z, 0.19, 0.27, 0, 0.214, 0.336, 0, 0.012, 0.008), 0.008);
    d = smin(d, b, 0.012);
    d = smin(d, smax(sdTorusZ(x, y, z, -0.1, 0.252, 0, 0.074, 0.009), x + 0.078, 0.004), 0.008); // anse
    d = smin(d, sdSphere(x, y, z, -0.11, 0.322, 0, 0.01), 0.006); // poucier
    return d;
  };
}

// Cratère à volutes : pied à tige, panse, col évasé, bouche ouverte ; chaque
// anse faite de deux joncs qui montent de l'épaule et s'enroulent en volute
const kraterFine = makeLathe(0, 0, [[0, 0.062], [0.012, 0.064], [0.026, 0.04], [0.05, 0.032], [0.075, 0.058], [0.12, 0.104], [0.18, 0.127], [0.25, 0.121], [0.3, 0.09], [0.33, 0.072], [0.37, 0.068], [0.41, 0.082], [0.435, 0.097], [0.445, 0.099]]);
function amphoraShow(p) {
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.25 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    let d = smax(kraterFine(x, y, z), -sdRoundCyl(x, y, z, 0, 0, 0.385, 0.6, 0.056, 0.01), 0.006); // bouche creusée (plus étroite que le col : à 8 cm, elle le coupait et la lèvre flottait)
    d = min(d, sdTorusY(x, y, z, 0, 0.3, 0, 0.09, 0.004)); // filet de l'épaule
    for (const sx of [1, -1]) {
      for (const sz of [-1, 1]) d = min(d, sdCapsule(sx * x, y, z, 0.12, 0.3, sz * 0.01, 0.158, 0.445, sz * 0.01, 0.008, 0.007)); // joncs
      d = min(d, sdDiscZ(sx * x, y, z, 0.158, 0.466, 0, 0.028, 0.02, 0.006)); // volute
      d = min(d, sdCapsule(sx * x, y, z, 0.135, 0.445, 0, 0.095, 0.438, 0, 0.008, 0.007)); // attache à la lèvre
      d = smax(d, -sdTorusZ(sx * x, y, Math.abs(z), 0.158, 0.466, 0.023, 0.016, 0.004), 0.003); // sa gorge
      d = min(d, sdSphere(sx * x, y, Math.abs(z), 0.158, 0.466, 0.02, 0.008)); // son œil
    }
    return d;
  };
}

// Lyre : caisse en écaille et son ouïe, pied, deux cornes galbées, joug à
// boutons, sept cordes tendues du joug au chevalet
function lyreShow() {
  const arm = [[0.08, 0.19, 0.02], [0.15, 0.27, 0.016], [0.172, 0.36, 0.013], [0.155, 0.465, 0.009], [0.135, 0.486, 0.006]];
  return (x, y, z) => {
    let d = smax(sdEllipsoid(x, y, z, 0, 0.13, 0, 0.108, 0.108, 0.045), -sdSphere(x, y, z, 0, 0.145, 0.055, 0.03), 0.005); // caisse, ouïe
    d = smin(d, sdRoundBox(x, y, z, 0, 0.018, 0, 0.085, 0.018, 0.055, 0.006), 0.012); // pied
    const ax = Math.abs(x);
    for (let k = 0; k + 1 < arm.length; k++) d = smin(d, sdCapsule(ax, y, z, arm[k][0], arm[k][1], 0, arm[k + 1][0], arm[k + 1][1], 0, arm[k][2], arm[k + 1][2]), 0.008); // cornes
    d = min(d, sdCapsule(x, y, z, -0.182, 0.36, 0, 0.182, 0.36, 0, 0.009)); // joug
    d = min(d, sdSphere(ax, y, z, 0.186, 0.36, 0, 0.014)); // boutons
    d = min(d, sdRoundBox(x, y, z, 0, 0.112, 0.047, 0.05, 0.006, 0.006, 0.003)); // chevalet
    for (let k = -3; k <= 3; k++) d = min(d, sdCapsule(x, y, z, k * 0.03, 0.36, -0.004, k * 0.014, 0.13, 0.044, 0.0034)); // cordes
    return d;
  };
}

// Orgue : des tuyaux de hauteurs inégales sur un sommier
function organ(p) {
  const pipes = [[-0.15, 0.24, 0.036], [-0.075, 0.38, 0.042], [0, 0.52, 0.046], [0.075, 0.33, 0.042], [0.15, 0.2, 0.036]];
  const fr = makeFrame({ pivot: [0, 0, 0], ry: p.turn * 0.3 });
  return (x0, y, z0) => {
    const [x, , z] = fr(x0, y, z0);
    let d = sdRoundBox(x, y, z, 0, 0.025, 0, 0.195, 0.025, 0.06, 0.008); // sommier
    for (const [px, h, r] of pipes) {
      const pz = 0.012 * Math.cos(px * 20); // (une légère courbe en plan)
      d = smin(d, sdRoundCyl(x, y, z, px, pz, 0.04, h, r, 0.012), 0.004);
      d = min(d, sdRoundCyl(x, y, z, px, pz, 0.09, 0.11, r + 0.006, 0.004)); // bague (la bouche du tuyau)
    }
    return d;
  };
}

// Trois sphères posées l'une sur l'autre (la plus petite au sommet)
function spheres(p) {
  const a = p.turn * 2;
  const c = (r, ang, h) => [Math.cos(a + ang) * r, h, Math.sin(a + ang) * r];
  const S = [[...c(0.075, 0, 0.115), 0.115], [...c(0.085, 2.4, 0.095), 0.095], [...c(0.02, 1.2, 0.29), 0.085]];
  return (x, y, z) => {
    let d = Infinity;
    for (const [cx, cy, cz, r] of S) d = min(d, sdSphere(x, y, z, cx, cy, cz, r));
    return d;
  };
}

// Trois blocs empilés, chacun tourné d'un huitième de tour sur celui du
// dessous : des arêtes vives, ce que l'étoffe dessine le mieux
function blocks(p) {
  const B = [[0, 0.075, 0.12, 0.075, 0], [0, 0.215, 0.09, 0.065, 0.62 + p.turn * 0.3], [0, 0.335, 0.062, 0.055, 1.3 + p.turn * 0.6]];
  return (x, y, z) => {
    let d = Infinity;
    for (const [cx, cy, hw, hh, a] of B) {
      const c = Math.cos(a), sn = Math.sin(a), u = c * (x - cx) - sn * z, w = sn * (x - cx) + c * z;
      d = min(d, sdRoundBox(u, y, w, 0, cy, 0, hw, hh, hw, 0.006));
    }
    return d;
  };
}

export const FORMS = {
  bust: { label: 'Buste', make: bust, show: bustShow },
  lovers: { label: 'Les Amants', make: lovers },
  hands: { label: 'Mains jointes', make: hands },
  still: { label: 'Nature morte', make: stillLife },
  muse: { label: 'Muse endormie', make: muse },
  torso: { label: 'Torse', make: torso },
  cat: { label: 'Chat', make: cat, show: catShow, keep: true },
  horse: { label: 'Tête de cheval', make: horse },
  teapot: { label: 'Verseuse', make: teapot, show: teapotShow },
  amphora: { label: 'Cratère à volutes', make: amphora, show: amphoraShow, keep: true },
  lyre: { label: 'Lyre', make: lyre, show: lyreShow, keep: true },
  chair: { label: 'Chaise', make: chair, show: chairShow, keep: true }, // (keep : la chaise reste au milieu du socle, le linge couvre l'assise ET le dossier ; centrée sur son dossier, il n'en restait que la moitié)
  organ: { label: 'Orgue', make: organ },
  spheres: { label: 'Trois sphères', make: spheres },
  blocks: { label: 'Trois blocs', make: blocks },
};

// Tirage des paramètres d'une forme (rng : un flux propre à la forme)
export function drawForm(kind, rng) {
  const r2 = (v) => Math.round(v * 1000) / 1000 || 0;
  const p = { kind, tilt: r2(rng.range(-0.12, 0.18)), turn: r2(rng.range(-0.45, 0.45)), lean: r2(rng.range(-0.15, 0.15)), bun: rng.chance(0.4), chin: r2(rng.range(0.96, 1.06)), nose: r2(rng.range(0.96, 1.06)), reach: r2(rng.range(0.92, 1.05)) };
  if (kind === 'lovers') { p.lean = r2(rng.range(0.12, 0.28)); p.tilt = r2(rng.range(-0.05, 0.1)); }
  // échelle : chaque statue à la taille du voile (≈ 1 m). Une forme sans tête
  // ou couchée est agrandie, sinon le voile pend en tube et ne la dessine plus
  p.scale = { bust: 1.1, lovers: 1.1, torso: 1.35, muse: 1.45, hands: 1.25, still: 1.2, cat: 1.15, horse: 1.25, teapot: 1.3, amphora: 1.15, lyre: 1.25, chair: 1.15, organ: 1.15, spheres: 1.25, blocks: 1.35 }[kind];
  if (kind === 'still') {
    const kinds = ['jug', 'tin', 'bowl', 'carafe'];
    const n = rng.int(2, 3);
    const items = [{ kind: 'bottle', x: 0, z: 0, s: r2(rng.range(1.0, 1.15)) }];
    const ang0 = rng.range(0, 2 * PI);
    for (let i = 0; i < n; i++) {
      const a = ang0 + (i / n) * 2 * PI + rng.range(-0.3, 0.3);
      const r = rng.range(0.13, 0.16);
      items.push({ kind: kinds[(i + rng.int(0, 3)) % 4], x: r2(Math.cos(a) * r), z: r2(Math.sin(a) * r * 0.8), s: r2(rng.range(0.85, 1.05)) });
    }
    p.items = items;
  }
  return p;
}

// Construit la forme, mesure son sommet près de l'axe et l'y amène.
export function buildForm(spec, show = false) {
  const g0 = FORMS[spec.kind].make(spec), sc = spec.scale ?? 1.1; // (un peu plus grandes que nature, comme au musée)
  // (yaw : la forme tournée vers la caméra, pour qu'on lise son profil)
  const cy = Math.cos(spec.yaw ?? 0), sy = Math.sin(spec.yaw ?? 0);
  const g = (x, y, z) => { const u = cy * x - sy * z, w = sy * x + cy * z; return g0(u / sc, y / sc, w / sc) * sc; };
  // sommet : point le plus haut de la surface dans un disque de 15 cm autour
  // de l'axe (à 6 cm, le dossier d'une chaise échappait : le hamac descendait
  // jusqu'à l'assise en forçant le linge le long du dossier)
  let best = { x: 0, z: 0, y: -1 };
  const tol = FORMS[spec.kind].tol ?? 0.02;
  // (une forme qui reste au milieu du socle — keep — est cherchée sur toute son emprise)
  const span = FORMS[spec.kind].keep ? 32 : 15;
  for (let ix = -span; ix <= span; ix++) for (let iz = -span; iz <= span; iz++) {
    const x = ix * 0.01, z = iz * 0.01;
    if (x * x + z * z > span * span * 1e-4) continue;
    // descente depuis le haut : premier point dans la matière (pas de 2 mm puis bissection)
    let y = 1.0, prev = g(x, y, z);
    while (y > 0 && prev > 0) { y -= 0.002; prev = g(x, y, z); }
    if (prev > 0) continue;
    let a = y, b = y + 0.002;
    for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (g(x, m, z) > 0) b = m; else a = m; }
    // (à 2 cm près, le plus proche de l'axe : un dessus plat ne décentre pas la forme)
    if (a > best.y + tol || (a > best.y - tol && x * x + z * z < best.x * best.x + best.z * best.z)) best = { x, z, y: Math.max(a, best.y) };
  }
  const keep = FORMS[spec.kind].keep, ox = keep ? 0 : best.x, oz = keep ? 0 : best.z;
  const f = (x, y, z) => g(x + ox, y, z + oz);
  // boîte englobante (échantillonnage grossier, élargi)
  let x0 = 1, y0 = 1, z0 = 1, x1 = -1, y1 = -1, z1 = -1;
  for (let ix = -25; ix <= 25; ix++) for (let iy = 0; iy <= 40; iy++) for (let iz = -25; iz <= 25; iz++) {
    const x = ix * 0.016, y = iy * 0.02, z = iz * 0.016;
    if (f(x, y, z) < 0.012) { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y); z0 = min(z0, z); z1 = max(z1, z); }
  }
  const m = 0.04;
  f.box = [x0 - m, -0.01, z0 - m, x1 + m, y1 + m, z1 + m];
  f.top = best.y;
  f.offset = [ox, oz];
  // (show : le modèle détaillé de l'objet, pour l'hologramme — même pose, même
  // place ; le linge, lui, se pose sur la forme épaissie ci-dessus)
  const S = show && FORMS[spec.kind].show;
  if (S) {
    const s0 = S(spec);
    const fs = (x, y, z) => { const X = x + ox, Z = z + oz, u = cy * X - sy * Z, w = sy * X + cy * Z; return s0(u / sc, y / sc, w / sc) * sc; };
    fs.box = f.box; fs.top = f.top; fs.offset = f.offset;
    return fs;
  }
  return f;
}

// ── Les socles (bien réels, eux) ────────────────────────────────────────────
// Le même champ sert à la simulation (contact du voile) et aux tests ; le
// maillage de rendu (gen/plinth.js) est construit depuis les mêmes cotes.
// Dessus du socle à y = 0, sol à y = −H.
export const PLINTHS = {
  // dé à corniche : plinthe, dé, corniche moulurée
  die: { label: 'Dé à corniche' },
  // colonne tournée : base, fût, chapiteau carré (abaque)
  column: { label: 'Colonne' },
  // bloc de pierre brute, arêtes adoucies
  block: { label: 'Bloc' },
  // guéridon : plateau rond sur un pied (le voile y fait des godets)
  gueridon: { label: 'Guéridon' },
  // selle de sculpteur : plateau tournant de bois sur un trépied
  stand: { label: 'Selle de sculpteur' },
};

// Cotes d'un socle (fonction pure des paramètres tirés)
export function plinthDims(P) {
  const H = P.height, a = P.half; // demi-côté (ou rayon) du dessus
  switch (P.kind) {
    case 'die': return { H, a, parts: [
      { t: 'box', c: [0, -0.03, 0], h: [a, 0.03, a], r: 0.006 }, // corniche
      { t: 'box', c: [0, -0.075, 0], h: [a - 0.02, 0.018, a - 0.02], r: 0.008 }, // moulure
      { t: 'box', c: [0, -(H + 0.09) / 2, 0], h: [a - 0.04, (H - 0.09) / 2, a - 0.04], r: 0.004 }, // dé
      { t: 'box', c: [0, -H + 0.04, 0], h: [a - 0.015, 0.04, a - 0.015], r: 0.006 }, // plinthe
    ] };
    case 'column': return { H, a, parts: [
      { t: 'box', c: [0, -0.025, 0], h: [a, 0.025, a], r: 0.005 }, // abaque
      { t: 'cyl', y0: -0.09, y1: -0.05, R: a * 0.82, r: 0.012 }, // échine
      { t: 'cyl', y0: -H + 0.09, y1: -0.07, R: a * 0.62, r: 0.004 }, // fût
      { t: 'cyl', y0: -H + 0.04, y1: -H + 0.11, R: a * 0.8, r: 0.015 }, // base (tore)
      { t: 'box', c: [0, -H + 0.022, 0], h: [a * 0.95, 0.022, a * 0.95], r: 0.004 }, // plinthe
    ] };
    case 'block': return { H, a, parts: [
      { t: 'box', c: [0, -H / 2, 0], h: [a, H / 2, a * 0.92], r: 0.03 },
    ] };
    case 'gueridon': return { H, a, parts: [
      { t: 'cyl', y0: -0.03, y1: 0, R: a, r: 0.012 }, // plateau
      { t: 'cyl', y0: -H + 0.05, y1: -0.03, R: 0.035, r: 0.006 }, // fût
      { t: 'cyl', y0: -H, y1: -H + 0.05, R: a * 0.55, r: 0.02 }, // pied
    ] };
    case 'stand': return { H, a, parts: [
      { t: 'cyl', y0: -0.035, y1: 0, R: a, r: 0.006 }, // plateau tournant
      { t: 'cyl', y0: -0.09, y1: -0.035, R: 0.06, r: 0.01 }, // moyeu
      { t: 'box', c: [0, -0.1, 0], h: [a * 0.7, 0.02, 0.025], r: 0.006 }, // traverse
      { t: 'box', c: [0, -0.1, 0], h: [0.025, 0.02, a * 0.7], r: 0.006 },
      { t: 'cyl', y0: -H, y1: -0.1, R: 0.03, r: 0.005 }, // pied central (les jambes du trépied sont hors contact)
    ] };
  }
  throw new Error(`socle inconnu : ${P.kind}`);
}

// Le socle des contacts : l'aplomb du plateau, d'un seul bloc jusqu'au sol.
// Un linge mouillé pend à la verticale du bord de la corniche ; sous le
// surplomb (moulure, fût, pied du guéridon) il n'y a rien à toucher, mais de
// quoi se prendre : remonté par ses coins, le pan qui pendait là traversait
// la corniche par-dessous et ses fils s'étiraient de trois mailles.
export function plinthCollider(P) {
  const D = plinthDims(P), t = D.parts[0];
  const part = t.t === 'box'
    ? { t: 'box', c: [t.c[0], -D.H / 2, t.c[2]], h: [t.h[0], D.H / 2, t.h[2]], r: t.r }
    : { t: 'cyl', y0: -D.H, y1: t.y1, R: t.R, r: t.r };
  return { H: D.H, a: D.a, parts: [part] };
}

export function plinthSDF(P) {
  const D = plinthCollider(P);
  const parts = D.parts, top = parts[0];
  const f = (x, y, z) => {
    if (y > 0.05) return y; // (borne : au-dessus du dessus)
    let d = Infinity;
    for (const q of parts) {
      const v = q.t === 'box' ? sdRoundBox(x, y, z, q.c[0], q.c[1], q.c[2], q.h[0], q.h[1], q.h[2], q.r) : sdRoundCyl(x, y, z, 0, 0, q.y0, q.y1, q.R, q.r);
      if (v < d) d = v;
    }
    // (sous le plateau, la sortie est vers le haut : le minimum des pièces
    // empilées n'est pas une distance à l'intérieur — voir scene/gpucloth.js)
    if (d < 0 && y < 0) {
      const lat = top.t === 'box' ? Math.min(top.h[0] - Math.abs(x - top.c[0]), top.h[2] - Math.abs(z - top.c[2])) : top.R - Math.hypot(x, z);
      if (-y < lat) d = y;
    }
    return d;
  };
  f.dims = D;
  return f;
}

// ── Cuisson du champ sur une grille ─────────────────────────────────────────
// La simulation interroge la forme des millions de fois : on la cuit une fois
// sur une grille de pas h (5 mm), exacte près de la surface (|d| < 3 cm, une
// passe grossière à 4h repère la bande), interpolée au-delà. La lecture est
// trilinéaire, avec son gradient exact par cellule.
export function bakeForm(f, h = 0.005, band = 0.06) {
  const [x0, y0, z0, x1, y1, z1] = f.box;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const H4 = h * 4, cx = Math.ceil((nx - 1) / 4) + 1, cy = Math.ceil((ny - 1) / 4) + 1, cz = Math.ceil((nz - 1) / 4) + 1;
  const C = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) C[(k * cy + j) * cx + i] = f(x0 + i * H4, y0 + j * H4, z0 + k * H4);
  const D = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    // valeur grossière (plus proche nœud à 4h)
    const ci = Math.min(cx - 1, Math.round(i / 4)), cj = Math.min(cy - 1, Math.round(j / 4)), ck = Math.min(cz - 1, Math.round(k / 4));
    const c = C[(ck * cy + cj) * cx + ci];
    D[(k * ny + j) * nx + i] = Math.abs(c) > band ? c : f(x0 + i * h, y0 + j * h, z0 + k * h);
  }
  const inv = 1 / h, sx = 1, sy = nx, sz = nx * ny;
  const g = (x, y, z, grad) => {
    let u = (x - x0) * inv, v = (y - y0) * inv, w = (z - z0) * inv;
    if (u < 0 || v < 0 || w < 0 || u >= nx - 1 || v >= ny - 1 || w >= nz - 1) return 1;
    const i = u | 0, j = v | 0, k = w | 0;
    u -= i; v -= j; w -= k;
    const o = k * sz + j * sy + i;
    const a = D[o], b = D[o + sx], c = D[o + sy], d = D[o + sx + sy];
    const e = D[o + sz], ff = D[o + sx + sz], gg = D[o + sy + sz], hh = D[o + sx + sy + sz];
    const ab = a + (b - a) * u, cd = c + (d - c) * u, ef = e + (ff - e) * u, gh = gg + (hh - gg) * u;
    const l0 = ab + (cd - ab) * v, l1 = ef + (gh - ef) * v;
    if (grad) {
      const dx0 = (b - a) + ((d - c) - (b - a)) * v, dx1 = (ff - e) + ((hh - gg) - (ff - e)) * v;
      grad[0] = (dx0 + (dx1 - dx0) * w) * inv;
      grad[1] = ((cd - ab) + ((gh - ef) - (cd - ab)) * w) * inv;
      grad[2] = (l1 - l0) * inv;
    }
    return l0 + (l1 - l0) * w;
  };
  g.box = f.box; g.top = f.top; g.offset = f.offset; g.baked = { nx, ny, nz, h, x0, y0, z0, D };
  return g;
}
