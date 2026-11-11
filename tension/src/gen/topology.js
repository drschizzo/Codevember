// Topologies de tenségrité : nœuds (embouts massifs), barres (rigides) et
// câbles (unilatéraux). Fonctions pures, sans three.js : la recette, le worker,
// les tests et les bancs d'essai Node les importent.
//
// Unités : 1 u = 10 cm, masses en kg, temps en s. Une force vaut kg·u/s²
// (0,1 N) et une raideur kg/s² (numériquement des N/m).
//
// Trois familles :
// - prism(n)  : prisme tordu à n barres (Culbute), couché sur le flanc ;
// - chain(m)  : chaîne de m prismes carrés à anneaux partagés (Chenille) ;
// - hoop(m)   : couronne de m prismes triangulaires refermée en tore, et un
//               moyeu (une barre-axe) suspendu par des rayons (Cerceau).
//
// Une forme initiale géométrique est donnée ici ; la forme d'équilibre
// précontrainte est trouvée par relaxation (sim.js · formFind).

const TAU = Math.PI * 2;

// Torsion d'équilibre d'un prisme régulier à n barres (anneau du haut tourné
// par rapport à celui du bas, mesuré entre un nœud du bas et le nœud du haut
// relié par un câble « vertical ») : α = π/2 − π/n.
export const prismTwist = (n) => Math.PI / 2 - Math.PI / n;

function base() {
  return { nodes: [], bars: [], cables: [] };
}
const addNode = (T, p, m, r, extra = {}) => (T.nodes.push({ p: [...p], m, r, ...extra }), T.nodes.length - 1);
const addBar = (T, i, j, r, extra = {}) => T.bars.push({ i, j, r, ...extra });
const addCable = (T, i, j, kind, extra = {}) => T.cables.push({ i, j, kind, ...extra });

// ── Culbute : prisme tordu à n barres ───────────────────────────────────────
// Anneau A (z = 0) et anneau B (z = h). Barre a_i → b_i, b_i tourné de
// φ = π/2 + π/n ; câble « vertical » a_i → b_{i−1} (écart angulaire α) ;
// câbles d'anneau a_i → a_{i+1} et b_i → b_{i+1}.
export function prism({ n = 3, L = 3, hr = 1.4, barR = 0.05, capR = 0.13, mBar = 0.14, mCap = 0.07 } = {}) {
  const T = base();
  const phi = Math.PI / 2 + Math.PI / n;
  const chord = 2 * Math.sin(phi / 2);
  const r = L / Math.sqrt(hr * hr + chord * chord), h = hr * r;
  const m = mBar / 2 + mCap;
  for (let i = 0; i < n; i++) addNode(T, [r * Math.cos(TAU * i / n), r * Math.sin(TAU * i / n), -h / 2], m, capR, { ring: 0, k: i });
  for (let i = 0; i < n; i++) addNode(T, [r * Math.cos(TAU * i / n + phi), r * Math.sin(TAU * i / n + phi), h / 2], m, capR, { ring: 1, k: i });
  for (let i = 0; i < n; i++) addBar(T, i, n + i, barR, { k: i });
  for (let i = 0; i < n; i++) addCable(T, i, (i + 1) % n, 'ring', { k: i, ring: 0 });
  for (let i = 0; i < n; i++) addCable(T, n + i, n + (i + 1) % n, 'ring', { k: i, ring: 1 });
  for (let i = 0; i < n; i++) addCable(T, i, n + (i - 1 + n) % n, 'saddle', { k: i });
  T.family = 'culbute';
  T.n = n; T.L = L; T.r = r; T.h = h;
  return T;
}

// ── Chenille : chaîne de m prismes carrés ───────────────────────────────────
// Anneaux carrés k = 0..m, dans des plans x = k·s ; chaque nœud d'anneau est
// une rotule commune à deux barres (une de chaque module voisin). Les modules
// alternent leur sens de torsion : les anneaux ne tournent pas en moyenne.
// Câbles : anneaux, câbles de selle (un par barre), et câbles axiaux moteurs
// (nœud i de l'anneau k → nœud i de l'anneau k + 1), qui raccourcissent le
// module. Les nœuds du bas portent des patins à écailles.
export function chain({ m = 4, L = 1.9, w = 1.2, barR = 0.042, capR = 0.11, mBar = 0.1, mCap = 0.05 } = {}) {
  const T = base();
  const n = 4, rr = w / Math.SQRT2;
  const tw = Math.PI / 4; // (torsion de chaque module, alternée)
  // longueur axiale du module d'après la torsion et la longueur de barre
  const chord = 2 * rr * Math.sin(tw / 2 + Math.PI / 4 * 0);
  const ax = Math.sqrt(Math.max(0.2, L * L - (2 * rr * Math.sin(tw / 2)) ** 2));
  const mNode = mBar + mCap; // (une rotule porte deux demi-barres)
  for (let k = 0; k <= m; k++) {
    const rot = (k % 2) * tw; // (anneaux pairs alignés, impairs tournés)
    for (let i = 0; i < n; i++) {
      const a = TAU * i / n + Math.PI / 4 + rot;
      addNode(T, [k * ax, rr * Math.sin(a), rr * Math.cos(a)], mNode * (k === 0 || k === m ? 0.75 : 1), capR, { ring: k, k: i });
    }
  }
  const id = (k, i) => k * n + (((i % n) + n) % n);
  for (let k = 0; k < m; k++) {
    const s = k % 2 ? -1 : 1;
    // anneau k : nœud i à l'angle a_i (+ rot_k) ; anneau k+1 tourné de ±tw
    for (let i = 0; i < n; i++) {
      // barre : nœud i de k → nœud i+s de k+1 (diagonale) ; selle : i → i de k+1 (proche)
      addBar(T, id(k, i), id(k + 1, i + (s > 0 ? 1 : 0) - (s > 0 ? 0 : 1) * 0), barR, { k: i, mod: k });
    }
  }
  // (barres recalculées plus bas : diagonales franches)
  T.bars.length = 0;
  for (let k = 0; k < m; k++) {
    const s = k % 2 ? -1 : 1;
    for (let i = 0; i < n; i++) addBar(T, id(k, i), id(k + 1, i + s), barR, { k: i, mod: k });
    for (let i = 0; i < n; i++) addCable(T, id(k, i), id(k + 1, i), 'axial', { k: i, mod: k });
  }
  for (let k = 0; k <= m; k++) for (let i = 0; i < n; i++) addCable(T, id(k, i), id(k, i + 1), 'ring', { k: i, ring: k });
  T.family = 'chenille';
  T.m = m; T.n = n; T.L = L; T.ax = ax; T.w = w;
  void chord;
  return T;
}

// ── Cerceau : la roue de vélo, une tenségrité ───────────────────────────────
// Une jante en échelle (deux polygones de m tubes, à gauche et à droite,
// reliés par des barreaux, et haubanée en croix par des câbles), un moyeu
// lourd (axe et moteurs) suspendu par 2m rayons : flasque gauche → nœuds
// gauches, flasque droit → nœuds droits ; les flasques sont plus écartés que
// la jante (stabilité latérale, comme une roue de vélo). La jante est
// comprimée, les rayons sont tendus.
export function hoop({ m = 12, Rw = 2.2, w = 1.5, hubW = 2.2, barR = 0.04, rungR = 0.03, capR = 0.075, mNode = 0.035, mHub = 0.9 } = {}) {
  const T = base();
  for (let k = 0; k < m; k++) {
    const psi = TAU * (k + 0.5) / m - Math.PI / 2; // (un côté à plat en bas)
    for (const side of [0, 1]) addNode(T, [Rw * Math.cos(psi), Rw * Math.sin(psi), (side ? 1 : -1) * w / 2], mNode, capR, { ring: k, k: side, rim: true });
  }
  const id = (k, side) => (((k % m) + m) % m) * 2 + side;
  for (let k = 0; k < m; k++) {
    addBar(T, id(k, 0), id(k + 1, 0), barR, { rim: 0 });
    addBar(T, id(k, 1), id(k + 1, 1), barR, { rim: 1 });
    addBar(T, id(k, 0), id(k, 1), rungR, { rung: true });
    addCable(T, id(k, 0), id(k + 1, 1), 'brace', { k, pre: 0 });
    addCable(T, id(k, 1), id(k + 1, 0), 'brace', { k, pre: 0 });
  }
  const h0 = addNode(T, [0, 0, -hubW / 2], mHub / 2, 0.16, { hub: 0 });
  const h1 = addNode(T, [0, 0, hubW / 2], mHub / 2, 0.16, { hub: 1 });
  T.bars.push({ i: h0, j: h1, r: 0.06, hub: true });
  for (let k = 0; k < m; k++) {
    addCable(T, h0, id(k, 0), 'spoke', { k, side: 0 });
    addCable(T, h1, id(k, 1), 'spoke', { k, side: 1 });
  }
  T.family = 'cerceau';
  T.m = m; T.Rw = Rw; T.w = w; T.hub = [h0, h1];
  return T;
}

export function buildTopology(spec) {
  if (spec.family === 'culbute') return prism(spec);
  if (spec.family === 'chenille') return chain(spec);
  if (spec.family === 'cerceau') return hoop(spec);
  throw new Error(`famille inconnue : ${spec.family}`);
}
