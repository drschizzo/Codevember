// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - les matières (cire, miel) et la lumière sont composées à la main par humeur ;
// - le chemin du point libre est vérifié ici : l'alvéole reste un polygone
//   simple à tous les instants de la boucle (sinon on adoucit les arêtes).
import { createRng } from '../../shared/rng.js';
import { track, tileAt, isSimple } from './gen/tiling.js';
import { hatParams, hatShape } from './gen/hat.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Familles : un groupe, un type de Heesch, un mouvement ────────────────────
// gates : les couples de portes (classes des coins) que le chemin peut prendre ;
// le relais est une rotation autour du centre de la troisième classe.
export const FAMILIES = {
  moulinet: { label: 'Moulinet (p3)', group: 'p3', gates: [[0, 1], [1, 2], [2, 0]] },
  tourniquet: { label: 'Tourniquet (p4)', group: 'p4', gates: [[1, 2], [0, 1], [2, 0]] },
  rosace: { label: 'Rosace (p6)', group: 'p6', gates: [[0, 1], [1, 2], [2, 0]] },
  // le chapeau : pas de groupe, pas de porte — un pavage qui ne se répète jamais, et dont la
  // boucle est un lacet fermé dans le plan du rapport b/a de ses deux sortes d'arêtes
  chapeau: { label: 'Chapeau (apériodique)', group: 'hat', gates: [] },
};

// ── Arêtes : le profil des trois rayons (un par classe de coin) ──────────────
export const EDGES = {
  droite: { label: 'Droites', make: () => [{}, {}, {}] },
  esse: { label: 'En S', make: (r) => [0, 1, 2].map(() => ({ a2: r3(r.range(0.07, 0.13) * r.pick([1, -1])) })) },
  crochet: { label: 'À crochet', make: (r) => [0, 1, 2].map(() => ({ a1: r3(r.range(0.08, 0.15) * r.pick([1, -1])), hook: r2(r.range(0.4, 0.8) * r.pick([1, -1])) })) },
  vague: { label: 'Double vague', make: (r) => [0, 1, 2].map(() => ({ a3: r3(r.range(0.05, 0.09) * r.pick([1, -1])), a1: r3(r.range(-0.05, 0.05)) })) },
  lobe: { label: 'À lobe', make: (r) => { const s = r.pick([1, -1]); return [0, 1, 2].map((k) => ({ a1: r3(r.range(0.1, 0.18) * (k === 1 ? -s : s)) })); } },
  dent: { label: 'En dent', make: (r) => [0, 1, 2].map(() => ({ a2: r3(r.range(0.06, 0.1) * r.pick([1, -1])), a3: r3(r.range(0.03, 0.06) * r.pick([1, -1])) })) },
};

// ── Humeurs ──────────────────────────────────────────────────────────────────
// Chacune est un décor (voûte, fond), une lumière (direction, dureté), une
// valeur et un cadrage ; la cire et le miel en découlent.
export const MOODS = {
  vierge: {
    label: 'Cire vierge', env: 'softbox', bg: '#b9c2c8', vault: '#d8d4cb',
    wood: '#e2bf84', woodDark: '#a26c33', stand: '#b9975e', plinth: '#b9b5ac', gold: '#d9a441', old: '#7c5226', zoning: 0.62, wax: '#e6d9b6', waxDeep: '#c2964a', cap: '#ebe0c2', honey: '#c47a12', honeyDeep: '#4a2104', trans: 0.6,
    key: { K: 5200, int: 2.1, az: [-0.75, -0.5], el: [0.5, 0.7], pen: 0.75 }, back: { color: '#ffe9c4', int: 300 }, fill: { color: '#a9c6ff', part: 0.5, el: 0.2 }, envI: [0.14, 0.2],
    cam: { az: [-0.35, 0.35], el: [-0.05, 0.2] }, content: { cap: [0.1, 0.2], honey: [0.44, 0.58] },
    grade: { contrast: 1.07, saturation: 0.97, shadows: [0.95, 1.0, 1.06], highlights: [1.03, 1.0, 0.95] },
  },
  rasante: {
    label: 'Rasante', env: 'studio', bg: '#6f7275', vault: '#55585b',
    wood: '#c9bba0', woodDark: '#7d6a4e', stand: '#2a2a2c', plinth: '#4a4c4f', gold: '#c9a25a', old: '#5a4630', zoning: 0.6, wax: '#e2d6b6', waxDeep: '#b08a45', cap: '#e9e0c6', honey: '#b9781a', honeyDeep: '#4a2205', trans: 0.3,
    key: { K: 5600, int: 15, az: [-1.45, -1.25], el: [0.05, 0.25], pen: 0.35 }, back: { color: '#ffffff', int: 60 }, fill: { color: '#dfe6f2', part: 0.06, el: 0.1 }, envI: [0.2, 0.3],
    cam: { az: [-0.1, 0.1], el: [-0.05, 0.05] }, content: { cap: [0, 0.16], honey: [0.2, 0.42] },
    grade: { contrast: 1.1, saturation: 0.75, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1] },
  },
  contrejour: {
    label: 'Contre-jour', env: 'fogwhite', bg: '#e6dfd0', vault: '#3a332b',
    wood: '#bfa67a', woodDark: '#6e5433', stand: '#1f1d1b', plinth: '#2e2924', gold: '#dba23a', old: '#5e3a14', zoning: 0.9, wax: '#e6d7ae', waxDeep: '#c08d38', cap: '#eadfc0', honey: '#d18a1c', honeyDeep: '#5e2a05', trans: 1.0,
    key: { K: 5200, int: 1.6, az: [-0.6, 0.6], el: [0.3, 0.6], pen: 0.9 }, back: { color: '#fff0d8', int: 480 }, fill: { color: '#ffe8c8', part: 0.5, el: 0.3 }, envI: [0.25, 0.35],
    cam: { az: [-0.45, 0.45], el: [0.0, 0.25] }, content: { cap: [0.1, 0.2], honey: [0.44, 0.6] },
    grade: { contrast: 1.06, saturation: 1.0, shadows: [1.0, 0.99, 0.97], highlights: [1.03, 1.0, 0.95] },
  },
  nuit: {
    label: 'Nuit', env: 'nightsky', bg: '#0a0e18', vault: '#15171c',
    wood: '#a99c84', woodDark: '#5c5242', stand: '#8d8f96', plinth: '#14161c', gold: '#b7a06a', old: '#4a4032', zoning: 0.6, wax: '#d9d6c6', waxDeep: '#9a8a5a', cap: '#e4e2d6', honey: '#b98a2c', honeyDeep: '#3a2408', trans: 0.45,
    key: { K: 8500, int: 9, az: [-1.2, -0.8], el: [0.5, 0.9], pen: 0.6 }, back: { color: '#9db8ff', int: 350 }, fill: { color: '#4f6cc4', part: 0.25, el: 0.4 }, envI: [0.5, 0.7],
    cam: { az: [-0.4, 0.4], el: [0.15, 0.35] }, content: { cap: [0.1, 0.22], honey: [0.42, 0.58] },
    grade: { contrast: 1.08, saturation: 0.9, shadows: [0.9, 0.96, 1.12], highlights: [0.98, 1.0, 1.04] },
  },
  bruyere: {
    label: 'Bruyère', env: 'forest', bg: '#4f5a4c', vault: '#2c2a24',
    wood: '#a98a5c', woodDark: '#5a4226', stand: '#3a2c1e', plinth: '#26241f', gold: '#a8782e', old: '#3c2410', zoning: 1.0, wax: '#b79a62', waxDeep: '#6e4a1c', cap: '#cdb88a', honey: '#a8381a', honeyDeep: '#3a0a04', trans: 0.4,
    key: { K: 6500, int: 10, az: [-0.7, 0.7], el: [0.8, 1.1], pen: 1.0 }, back: { color: '#e9ffd8', int: 300 }, fill: { color: '#bfe3b0', part: 0.3, el: 0.5 }, envI: [0.5, 0.7],
    cam: { az: [-0.3, 0.3], el: [0.2, 0.4] }, content: { cap: [0.12, 0.24], honey: [0.48, 0.64] },
    grade: { contrast: 1.04, saturation: 1.0, shadows: [0.96, 1.0, 1.0], highlights: [1.02, 1.0, 0.97] },
  },
  tilleul: {
    label: 'Tilleul', env: 'clearsky', bg: '#a9c4ae', vault: '#c9cdb8',
    wood: '#e0d2a6', woodDark: '#a08c56', stand: '#c2a868', plinth: '#c4c8b4', gold: '#d6c24a', old: '#77682a', zoning: 0.6, wax: '#ece2a8', waxDeep: '#c2a84a', cap: '#f1ebc4', honey: '#b9c24a', honeyDeep: '#4c5a10', trans: 0.5,
    key: { K: 5500, int: 5, az: [0.5, 0.9], el: [0.7, 1.0], pen: 0.5 }, back: { color: '#f4ffd0', int: 220 }, fill: { color: '#cfe9ff', part: 0.25, el: 0.5 }, envI: [0.45, 0.6],
    cam: { az: [-0.4, 0.4], el: [-0.3, -0.1] }, content: { cap: [0.08, 0.2], honey: [0.5, 0.68] },
    grade: { contrast: 1.03, saturation: 1.05, shadows: [0.96, 1.0, 0.98], highlights: [1.02, 1.01, 0.96] },
  },
  bleu: {
    label: 'Bleu', env: 'cyclo', bg: '#e4e2dc', vault: '#efeee9',
    wood: '#ece6d8', woodDark: '#b9b09c', stand: '#d8d8d8', plinth: '#d9d7d0', gold: '#ddd6c0', old: '#b4ad9c', zoning: 0.35, wax: '#f1eee4', waxDeep: '#cfc7ae', cap: '#f6f4ec', honey: '#2f6fb8', honeyDeep: '#0a1f52', trans: 0.5,
    key: { K: 5800, int: 2.2, az: [-0.25, 0.25], el: [0.25, 0.45], pen: 1.0 }, back: { color: '#ffffff', int: 200 }, fill: { color: '#ffffff', part: 0.35, el: 0.1 }, envI: [0.15, 0.2],
    cam: { az: [-0.08, 0.08], el: [-0.03, 0.06] }, content: { cap: [0, 0.15], honey: [0.6, 0.85] },
    grade: { contrast: 1.0, saturation: 1.0, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1] },
  },
};

// Le chemin : deux étapes, porte a → porte b dans une sorte de face, puis
// b → a dans l'autre. q : point de contrôle (poids barycentriques).
function makePath(rng, gates, style) {
  const [a, b] = gates, c = 3 - a - b;
  const q = (wc) => { const w = [0, 0, 0]; const s = rng.range(0.35, 0.65); w[a] = (1 - wc) * s; w[b] = (1 - wc) * (1 - s); w[c] = wc; return w.map(r3); };
  const wide = style === 'long' ? [0.5, 0.7] : style === 'court' ? [0.2, 0.32] : [0.32, 0.5];
  return { legs: [{ a, b, q: q(rng.range(...wide)) }, { a: b, b: a, q: q(rng.range(...wide)) }] };
}

/** Le chapeau et l'anti-chapeau restent-ils des polygones simples tout au long du lacet ? */
export function hatIsValid(loop, n = 48) {
  for (let k = 0; k < n; k++) { const P = hatParams(loop, k / n); if (!isSimple(hatShape(P.a, P.b, 0)) || !isSimple(hatShape(P.a, P.b, 1))) return false; }
  return true;
}

/** L'alvéole reste-t-elle un polygone simple tout au long de la boucle ? */
export function pathIsValid(group, path, profiles, amp, n = 96) {
  const tr = track(group, path);
  for (let k = 0; k < n; k++) if (!isSimple(tileAt(group, path, tr, profiles, (k + 0.37) / n, 10, amp))) return false;
  return true;
}

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  // (le chapeau est tiré à part : les graines gardent la famille qu'elles avaient parmi les trois pavages de groupe)
  const GROUPED = Object.keys(FAMILIES).filter((f) => FAMILIES[f].group !== 'hat');
  const family = overrides.family ?? (rng.fork('apériodique').range(0, 1) < 0.22 ? 'chapeau' : rng.fork('family').pick(GROUPED));
  const M = MOODS[mood];
  const rt = rng.fork('tiling'), rc = rng.fork('camera'), rl = rng.fork('light'), rb = rng.fork('comb'), rw = rng.fork('wave');

  // ── un pavage : famille, arêtes, chemin ; le chemin est vérifié ──
  const makeTiling = (fam, r, edges) => {
    const Ff = FAMILIES[fam];
    if (Ff.group === 'hat') {
      // ln|b/a| = r0 + dr·cos, arg(b/a) = dphi·sin : du chapeau vers la tortue et retour, par un autre côté
      const loop = { r0: r2(r.range(-0.05, 0.12)), dr: r2(r.range(0.42, 0.56)), dphi: r2(r.range(0.16, 0.26) * r.pick([1, -1])) };
      rw.pick([0, 0, 0, 0]); // (même nombre de tirages que les autres familles : le reste de la scène ne change pas)
      while (!hatIsValid(loop) && loop.dr > 0.1) { loop.dr = r2(loop.dr * 0.8); loop.dphi = r2(loop.dphi * 0.8); }
      return { family: fam, group: 'hat', edges: 'droite', loop, rot: r2(r.range(0, 6.28)), amp: 1, wall: r3(r.range(0.034, 0.042)), wave: 0 };
    }
    edges ??= r.pick(Object.keys(EDGES));
    const profiles = EDGES[edges].make(r.fork('edges'));
    const path = makePath(r.fork('path'), r.pick(Ff.gates), r.pick(['court', 'moyen', 'long']));
    let amp = 1;
    while (amp > 0.05 && !pathIsValid(Ff.group, path, profiles, amp)) amp = r2(amp * 0.8);
    if (!pathIsValid(Ff.group, path, profiles, amp)) amp = 0;
    return { family: fam, group: Ff.group, edges, path, profiles, amp, wall: r3(r.range(0.034, 0.046)), wave: r2(rw.pick([0.3, 0.4, 0.5, 0.6])) };
  };

  // ── les cadres ──
  // Un cadre d'apiculteur sans cire gaufrée : les abeilles y bâtissent librement. Le rayon
  // pend de la barre du haut et ne remplit pas tout — il reste un jour, bordé de cire fraîche.
  const frame = { Wi: r2(rb.range(1.36, 1.46)), Hi: r2(rb.range(1.6, 1.8)), tb: 0.11, st: 0.07, bb: 0.055, depth: 0.27, lug: 0.24, gap: r2(rb.range(0.42, 0.56)), plinthH: 0.4 };
  // un triptyque : le cadre de devant, et deux autres en retrait de part et d'autre
  const lobes = [];
  const order = [0, -1, 1];
  for (const i of order) {
    const hero = i === 0;
    const built = hero ? rb.range(0.74, 0.92) : rb.pick([rb.range(0.48, 0.66), rb.range(0.66, 0.85), rb.range(0.9, 1.0)]);
    const wob = r3(rb.range(0.006, 0.018)), skew = r3(rb.range(-0.03, 0.03));
    lobes.push({
      W: r2(frame.Wi * rb.range(0.95, 0.985) / (1 + wob + Math.abs(skew))), L: r2(frame.Hi * built), built: r2(built),
      p: r2(rb.range(3.4, 6)), q: r2(rb.range(2.1, 3)), flare: 0,
      wob, wf: r2(rb.range(2, 5)), wp: r2(rb.range(0, 6.28)), skew,
      // en échelon : les cadres du fond dépassent de part et d'autre de celui de devant
      x: r2(Math.sign(i) * [0, 2.65][Math.abs(i)] * rb.range(0.96, 1.04)), z: r2(-[0, 1.15][Math.abs(i)] * rb.range(0.95, 1.05)),
      off: [r2(rb.range(-3, 3)), r2(rb.range(-3, 3))],
      // le cadre est tourné de quelques degrés vers le centre : z = l·x (le rayon y est plan)
      warp: [0, r3(hero ? rb.range(-0.03, 0.03) : i * rb.range(0.05, 0.13) / Math.abs(i)), 0, 0, 1, 0],
    });
  }
  // chaque langue a son motif : la première porte la famille de la scène, les
  // suivantes épuisent les autres familles avant d'en reprendre une (avec
  // d'autres arêtes et une autre porte)
  {
    // chaque scène montre un chapeau. S'il n'est pas devant, il prend l'un des deux cadres du
    // fond, l'autre gardant un pavage de groupe ; s'il est devant, le fond a deux pavages de groupe
    const ro = rng.fork('others');
    const others = GROUPED.filter((f) => f !== family);
    if (family === 'chapeau') others.splice(ro.int(0, 2), 1);
    else others[ro.int(0, 1)] = 'chapeau';
    const edgeKeys = Object.keys(EDGES), used = new Set();
    lobes.forEach((l, k) => {
      const f2 = k === 0 ? family : others[k - 1];
      let e = k === 0 ? (overrides.edges ?? rt.pick(edgeKeys)) : rt.pick(edgeKeys);
      for (let i = 0; i < 6 && used.has(e); i++) e = edgeKeys[(edgeKeys.indexOf(e) + 1) % edgeKeys.length];
      used.add(e);
      l.tiling = makeTiling(f2, rt.fork('lobe' + k), e);
      // (le pavage chapeau se déforme en bloc pendant la boucle : son rayon garde plus de marge dans le cadre)
      if (l.tiling.group === 'hat') { l.W = r2(l.W * 0.78); l.L = r2(Math.min(l.L, frame.Hi * 0.8)); }
    });
  }
  const edges = lobes[0].tiling.edges;

  // plan d'ensemble : toute la série de cadres sur son socle
  const fov = r2(rc.range(26, 32));
  const span = 2 * (Math.max(...lobes.map((l) => Math.abs(l.x))) + frame.Wi + 0.85);
  const dist = r2(0.84 * span / 2 / (1.6 * Math.tan(fov * Math.PI / 360)));
  // le gros plan vise la bande de miel ouvert, sous les opercules
  const content = { cap: r2(rb.range(...M.content.cap)), honey: r2(rb.range(...M.content.honey)), fill: r2(rb.range(0.7, 0.9)) };
  const lookY = r2(-lobes[0].L * (content.cap + Math.max(0.08, content.honey - content.cap) * 0.5) * 0.85);
  return {
    v: 1, seed, mood, family, edges,
    loop: { duration: rng.fork('loop').pick([24, 28, 32]) },
    // l'onde descend de l'attache : ψ = u − wave·retard·clamp(dot(p, dir) + c, 0, 1)
    wave: 1, waveDir: rw.pick([[0, -0.38, 0], [0, -0.38, 0], [0.2, -0.33, 0.2], [-0.2, -0.33, 0.2]]),
    comb: {
      cell: r3(rb.range(0.078, 0.095)), depth: r3(rb.range(0.12, 0.15)), tilt: 0.19, edge: r2(rb.range(0.16, 0.26)), rim: 0.011,
      lobes, top: 1.05, frame,
      content,
    },
    decor: { wood: M.wood ?? '#d6c19a', woodDark: M.woodDark ?? '#8c6f47', stand: M.stand ?? '#b3925c', standMetal: M.standMetal ?? 1, plinth: M.plinth ?? M.vault },
    wax: { wax: M.wax, deep: M.waxDeep, gold: M.gold, old: M.old, zoning: M.zoning, cap: M.cap, honey: M.honey, honeyDeep: M.honeyDeep, trans: M.trans, sss: M.sss ?? 0.08, vault: M.vault },
    camera: {
      fov, dist, close: r2(rc.range(2.5, 3.0)),
      az: r2(rc.range(...M.cam.az)), el: r2(rc.range(...M.cam.el)), sway: r2(rc.range(0.08, 0.16) * rc.pick([1, -1])),
      // ce que le gros plan regarde (dans le repère de la langue de devant)
      look: [r2(rc.range(-0.25, 0.25)), lookY], peak: r2(rc.range(0.48, 0.56)),
      // le gros plan est pris de biais (jamais de face : l'image serait plate)
      rake: [r2(rc.range(0.3, 0.45) * rc.pick([1, -1])), r2(rc.range(0.12, 0.28) * rc.pick([1, -1, 1]))],
    },
    light: {
      key: { color: kelvinToHex(M.key.K + rl.range(-200, 200)), intensity: r2(M.key.int * rl.range(0.9, 1.1)), az: r2(rl.range(...M.key.az)), el: r2(rl.range(...M.key.el)), soft: M.key.pen },
      back: { color: M.back.color, intensity: r2(M.back.int * rl.range(0.9, 1.1)), az: r2(rl.range(-0.5, 0.5)), el: r2(rl.range(0.1, 0.5)) },
      // remplissage : le ciel, du côté opposé à la lampe (une part de la lampe, de la couleur du ciel de l'humeur)
      fill: { color: M.fill?.color ?? '#c9dcff', intensity: r2(M.key.int * (M.fill?.part ?? 0.22)), el: r2(M.fill?.el ?? 0.25) },
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envI)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: 9, far: 40 },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family, edges: R.edges });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
