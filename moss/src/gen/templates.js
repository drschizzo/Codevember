// Gabarits instanciés : la feuille (lame épaisse à tranche arrondie, et son
// poil hyalin) et le sporophyte (soie, capsule, opercule, dents du
// péristome, coiffe). Ils ne portent que des coordonnées paramétriques : la
// forme réelle est calculée dans le vertex shader (scene/moss.js), d'après
// la pose de la feuille (pose.js) ou l'état du sporophyte.
import { FAMILIES } from '../families.js';

// ── La feuille ───────────────────────────────────────────────────────────────
// Attribut lp = (s, x, ν, lat) : s le long (0 base, 1 pointe ; > 1 : le poil),
// x en travers (−1…1), ν côté de l'épaisseur (+1 dessus, −1 dessous), lat
// bourrelet de la tranche. Le poil : s = 1 + u (u le long), x = cos φ, ν =
// sin φ, lat = −1 (drapeau).
export function leafTemplate(family, lod = 0) {
  const Lf = FAMILIES[family].leaf;
  // abscisses : serrées à la gaine, à la charnière et vers la pointe
  const sh = Lf.sheath, hg = Lf.hinge;
  const S = new Set([0, sh * 0.5, sh, sh + hg * 0.5, sh + hg]);
  const nb = lod ? 4 : 8;
  for (let k = 1; k <= nb; k++) { const t = k / nb; S.add(sh + hg + (1 - sh - hg) * (1 - (1 - t) ** 1.4)); }
  const ss = [...S].filter((s) => s <= 1).sort((a, b) => a - b);
  const nx = lod ? 2 : 4;
  // anneau : dessus (x de −1 à 1), tranche droite, dessous (de 1 à −1), tranche gauche
  const ring = [];
  for (let i = 0; i <= nx; i++) ring.push([-1 + (2 * i) / nx, 1, 0]);
  for (const b of [Math.PI / 4, -Math.PI / 4]) ring.push([1, Math.sin(b), Math.cos(b)]);
  for (let i = 0; i <= nx; i++) ring.push([1 - (2 * i) / nx, -1, 0]);
  for (const b of [-Math.PI / 4, Math.PI / 4]) ring.push([-1, Math.sin(b), Math.cos(b)]);
  const R = ring.length;
  const lp = [], idx = [];
  for (const s of ss) for (const [x, nu, lat] of ring) lp.push(s, x, nu, lat);
  for (let j = 0; j + 1 < ss.length; j++) for (let i = 0; i < R; i++) {
    const a = j * R + i, b = j * R + ((i + 1) % R), c = (j + 1) * R + ((i + 1) % R), d = (j + 1) * R + i;
    idx.push(a, d, c, a, c, b);
  }
  // poil hyalin (tube effilé)
  if (Lf.hair > 0) {
    const base = lp.length / 4, nu = lod ? 3 : 6, nr = lod ? 3 : 4;
    for (let k = 0; k <= nu; k++) for (let i = 0; i < nr; i++) {
      const ph = (2 * Math.PI * i) / nr;
      lp.push(1.0005 + k / nu, Math.cos(ph), Math.sin(ph), -1);
    }
    for (let k = 0; k < nu; k++) for (let i = 0; i < nr; i++) {
      const a = base + k * nr + i, b = base + k * nr + ((i + 1) % nr), c = base + (k + 1) * nr + ((i + 1) % nr), d = base + (k + 1) * nr + i;
      idx.push(a, d, c, a, c, b);
    }
  }
  const lpA = new Float32Array(lp);
  const n = lpA.length / 4;
  // (position et normale de repos : seulement pour les bornes et pour three.js)
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { position[i * 3] = lpA[i * 4 + 1] * 0.03; position[i * 3 + 1] = Math.min(1.5, lpA[i * 4]) * 0.3; normal[i * 3 + 2] = 1; }
  return { lp: lpA, position, normal, index: n < 65536 ? new Uint16Array(idx) : new Uint32Array(idx) };
}

// ── Le sporophyte ────────────────────────────────────────────────────────────
// Repère local : la soie le long de +Y, de 0 à 1 (allongée à sa longueur dans
// le shader). Attribut sp = (partie, a, b, c) :
//   0 soie : position = (cos φ, y ∈ [0, 1], sin φ) ; rayon dans le shader
//   1 capsule, 2 opercule, 4 coiffe : position dans le repère de la capsule
//     (axe +Y, origine au col), en cm
//   3 dent du péristome : sp.y = angle de la dent autour de la bouche, sp.z =
//     abscisse le long de la dent (0…1), sp.w = côté (−1…1) ; position.y =
//     épaisseur (±)
export const SPOR_KINDS = {
  // capsule cylindrique dressée, péristome de 32 filaments torsadés en vis
  tortula: { len: 0.24, r: 0.034, neck: 0.05, nod: 0.08, shape: 'cyl', mouth: 0.022, teethLen: 0.06, teethW: 0.006, setaR: 0.0065, lidLen: 0.07 },
  // capsule prismatique inclinée, coiffe velue dorée, épiphragme et 64 dents courtes
  polytrichum: { len: 0.3, r: 0.058, neck: 0.05, nod: 0.55, shape: 'prism', mouth: 0.045, teethLen: 0.012, teethW: 0.006, setaR: 0.009, lidLen: 0.06 },
  // capsule piriforme asymétrique, penchée au bout d'une soie en crochet
  funaria: { len: 0.17, r: 0.045, neck: 0.08, nod: 2.0, shape: 'pear', mouth: 0.028, teethLen: 0.032, teethW: 0.009, setaR: 0.0055, lidLen: 0.05 },
  // capsule sphérique noire luisante au bout d'un pseudopode blanc
  sphagnum: { len: 0.15, r: 0.075, neck: 0.01, nod: 0, shape: 'sphere', mouth: 0.035, teethLen: 0.0, teethW: 0, setaR: 0.012, lidLen: 0.035 },
};

export function sporTemplate(kind) {
  const K = SPOR_KINDS[kind];
  const pos = [], sp = [], nrm = [], idx = [];
  const v = (p, n, a) => { pos.push(...p); nrm.push(...n); sp.push(...a); return pos.length / 3 - 1; };
  const grid = (rows, closed) => {
    for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i < (closed ? rows[j].length : rows[j].length - 1); i++) {
      const M = rows[j].length, a = rows[j][i], b = rows[j][(i + 1) % M], c = rows[j + 1][(i + 1) % M], d = rows[j + 1][i];
      idx.push(a, b, c, a, c, d);
    }
  };
  // soie
  { const rows = [], NR = 7, NY = 22;
    for (let k = 0; k <= NY; k++) { const row = []; for (let i = 0; i < NR; i++) { const ph = (2 * Math.PI * i) / NR; row.push(v([Math.cos(ph), k / NY, Math.sin(ph)], [Math.cos(ph), 0, Math.sin(ph)], [0, k / NY, ph, 0])); } rows.push(row); }
    grid(rows, true); }
  // capsule : profil (r, y) de révolution, du col à la bouche
  const prof = [];
  const NP = 18;
  for (let k = 0; k <= NP; k++) {
    const t = k / NP, y = t * K.len;
    let r;
    if (K.shape === 'cyl') r = K.r * Math.sin(Math.min(1, t * 3) * Math.PI / 2) ** 0.7 * (1 - 0.35 * Math.max(0, t - 0.85) / 0.15);
    else if (K.shape === 'prism') r = K.r * Math.sin(Math.min(1, t * 2.5) * Math.PI / 2) ** 0.8 * (1 - 0.3 * Math.max(0, t - 0.88) / 0.12);
    else if (K.shape === 'pear') r = K.r * (t < 0.45 ? 0.25 + 0.75 * Math.sin((t / 0.45) * Math.PI / 2) ** 1.3 : 1 - 0.38 * ((t - 0.45) / 0.55) ** 1.6);
    else r = K.r * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * 1.0 + (t < 0.08 ? 0.01 : 0);
    if (K.shape !== 'sphere' && k === NP) r = K.mouth;
    prof.push([Math.max(0.004, r), y]);
  }
  const NA = K.shape === 'prism' ? 24 : 16;
  const capRows = [];
  for (let k = 0; k <= NP; k++) {
    const [r, y] = prof[k], [r0, y0] = prof[Math.max(0, k - 1)], [r1, y1] = prof[Math.min(NP, k + 1)];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
    const row = [];
    for (let i = 0; i < NA; i++) {
      const ph = (2 * Math.PI * i) / NA;
      // (polytric : section carrée à angles arrondis)
      let rr = r;
      if (K.shape === 'prism') { const c = Math.abs(Math.cos(ph)), s = Math.abs(Math.sin(ph)); rr = r / Math.pow(c ** 4 + s ** 4, 0.25) * 0.86; }
      // (funaire : asymétrique, le dos bombé)
      if (K.shape === 'pear') rr *= 1 + 0.12 * Math.cos(ph) * Math.sin(Math.PI * (y / K.len));
      row.push(v([Math.cos(ph) * rr, y, Math.sin(ph) * rr], [Math.cos(ph) * dy / l, -dr / l, Math.sin(ph) * dy / l], [1, y / K.len, ph, 0]));
    }
    capRows.push(row);
  }
  grid(capRows, true);
  // fond de la capsule (au col)
  { const c = v([0, -0.004, 0], [0, -1, 0], [1, 0, 0, 0]); for (let i = 0; i < NA; i++) idx.push(c, capRows[0][(i + 1) % NA], capRows[0][i]); }
  // opercule (couvercle conique à bec) : posé sur la bouche
  { const rows = [], NL = 8;
    for (let k = 0; k <= NL; k++) {
      const t = k / NL, r = (K.shape === 'sphere' ? K.mouth * 1.25 : K.mouth * 1.06) * (1 - t) ** (K.shape === 'sphere' ? 0.5 : 0.8), y = K.len + K.lidLen * (K.shape === 'sphere' ? Math.sqrt(t) * 0.5 : t);
      const row = [];
      for (let i = 0; i < NA; i++) { const ph = (2 * Math.PI * i) / NA; row.push(v([Math.cos(ph) * Math.max(r, 0.0015), y, Math.sin(ph) * Math.max(r, 0.0015)], [Math.cos(ph) * 0.7, 0.7, Math.sin(ph) * 0.7], [2, t, ph, 0])); }
      rows.push(row);
    }
    grid(rows, true); }
  // dents du péristome : lames effilées, pivot sur la bouche
  const NT = { tortula: 32, polytrichum: 32, funaria: 16, sphagnum: 0 }[kind];
  for (let k = 0; k < NT; k++) {
    const ph = (2 * Math.PI * k) / NT, rows = [];
    for (let j = 0; j <= 5; j++) {
      const a = j / 5, row = [];
      for (const [side, th] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) row.push(v([side, th, 0], [0, th, 0], [3, ph, a, side]));
      rows.push(row);
    }
    grid(rows, true);
  }
  // coiffe velue du polytric : cône de poils dorés qui coiffe la capsule
  if (kind === 'polytrichum') {
    const rows = [], NL = 10;
    for (let k = 0; k <= NL; k++) {
      const t = k / NL, r = K.r * 1.12 * (1 - t) ** 0.8 + 0.003, y = K.len * 0.45 + (K.len * 0.75 + 0.06) * t;
      const row = [];
      for (let i = 0; i < 20; i++) { const ph = (2 * Math.PI * i) / 20; row.push(v([Math.cos(ph) * r, y, Math.sin(ph) * r], [Math.cos(ph), 0.4, Math.sin(ph)], [4, t, ph, 0])); }
      rows.push(row);
    }
    grid(rows, true);
  }
  const n = pos.length / 3;
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), sp: new Float32Array(sp), index: n < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), K };
}
