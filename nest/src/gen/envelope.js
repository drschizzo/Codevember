// L'enveloppe d'un nid de guêpe : des écailles de papier en coquille, drapées
// les unes sur les autres comme des tuiles, chacune faite de bandes (une bande
// = une charge de pâte de bois rapportée par une ouvrière).
//
// Module pur (Node, worker) : aucune dépendance à three.js.
//
// Unités : 1 = 10 cm. Le nid est centré sur l'origine, la poutre au-dessus
// (dessous de la poutre à y = yBeam), le trou de vol en bas (pôle −y).
//
// Construction :
// 1. la surface de base : un ellipsoïde bosselé, étoilé autour du centre
//    (ρ(dir)) — c'est la feuille d'enveloppe précédente, le « corps » qui
//    paraît entre les écailles ;
// 2. les racines des écailles : un semis de Poisson sur la base ;
// 3. chaque écaille : un demi-disque elliptique (racine en haut, bord libre en
//    bas), soulevé de la base d'autant plus qu'on s'approche du bord libre,
//    bombé, au bord légèrement roulé ;
// 4. le drapage : les écailles sont posées de bas en haut ; chacune épouse ce
//    qui est déjà posé (hauteur = max(son profil, pile + jeu)), puis s'ajoute
//    à la pile (une grille (θ, φ) des hauteurs au-dessus de la base). Rien ne
//    se traverse, par construction : les écailles du haut recouvrent les
//    racines de celles du bas, comme sur un vrai nid.
// 5. chaque écaille devient une lame épaisse fermée (dessus, dessous, tranche
//    arrondie), et ses bandes une rangée de la table des bandes (source de
//    chaque charge, tirée par une chaîne de Markov : une butineuse revient
//    souvent à la même planche).
import { createRng, createNoise3, clamp, smoothstep } from '../../../shared/rng.js';

const PI = Math.PI, TAU = 2 * PI;
export const MAXB = 48; // bandes par écaille au plus (largeur de la table)
// bord d'écaille en superellipse |X|^SP + Y^SP = 1 : un bord libre plat et large,
// des bandes en arcs (et non en cibles autour de la racine)
export const SP = 2.6;
const sup = (al) => { const s = Math.sin(al), c = Math.cos(al); return [Math.sign(s) * Math.abs(s) ** (2 / SP), Math.abs(c) ** (2 / SP)]; };

// ── Surface de base ──────────────────────────────────────────────────────────
export function makeBase({ a = 1.25, b = 1.45, lump = 0.045, top = 3.2, seed = 'nest' } = {}) {
  const N = createNoise3(`base:${seed}`);
  // rayon dans la direction unitaire (x, y, z) : en bas un ellipsoïde, en haut
  // une superellipse (|ρ·h/a|² + |ρ·y/b|^top = 1) — le nid reste large jusqu'à
  // la poutre, où le papier s'attache sur une grande plaque ; puis des bosses
  const rho = (x, y, z) => {
    const h2 = x * x + z * z;
    let r = 1 / Math.sqrt(h2 / (a * a) + (y * y) / (b * b));
    if (y > 0) {
      for (let i = 0; i < 8; i++) { // (Newton sur f(ρ) = ρ²h²/a² + (ρy/b)^top − 1)
        const u = (r * y) / b, f = (r * r * h2) / (a * a) + u ** top - 1;
        const df = (2 * r * h2) / (a * a) + (top * u ** (top - 1) * y) / b;
        r -= f / df;
      }
    }
    return r * (1 + lump * N.fbm(x * 0.8 + 3, y * 0.8, z * 0.8, 3) + lump * 0.4 * N.noise(x * 2.6, y * 2.6 + 7, z * 2.6));
  };
  // direction ↔ (θ depuis +y, φ autour de y)
  const dirOf = (th, ph) => [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  const point = (th, ph) => { const d = dirOf(th, ph), r = rho(d[0], d[1], d[2]); return [d[0] * r, d[1] * r, d[2] * r]; };
  // repère de la surface en (θ, φ) : point, normale extérieure, tangente « vers le bas » (θ croissant)
  const frame = (th, ph) => {
    const e = 1e-4;
    const P = point(th, ph);
    const Pt = point(th + e, ph), Pp = point(th, ph + e / Math.max(0.05, Math.sin(th)));
    const T = norm(sub(Pt, P)), U = norm(sub(Pp, P));
    let Nn = norm(cross(U, T)); // (extérieure : vérifiée ci-dessous)
    if (dot(Nn, P) < 0) Nn = neg(Nn);
    return { P, N: Nn, T, U };
  };
  return { rho, dirOf, point, frame, a, b };
}

// ── Petits outils vectoriels ─────────────────────────────────────────────────
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const mul = (p, s) => [p[0] * s, p[1] * s, p[2] * s];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const len = (p) => Math.hypot(p[0], p[1], p[2]);
const norm = (p) => { const l = len(p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
const neg = (p) => [-p[0], -p[1], -p[2]];
const toThPh = (p) => { const l = len(p); return [Math.acos(clamp(p[1] / l, -1, 1)), Math.atan2(p[2], p[0])]; };

// ── Tampon de maillage (attributs propres au papier) ─────────────────────────
// pat : (X, Y, E, code) — (X, Y) : coordonnées planes de l'écaille, normalisées
// (X en travers, Y vers le bas ; elles varient linéairement : le pixel en tire
// t = |(X, Y)| / E, la coordonnée de croissance, 0 à la racine et 1 au bord
// libre, sans les cordes d'une interpolation de t) ; E : rayon du bord dans la
// direction du point ; code = (id + 1)·4 + rôle — id : numéro de l'écaille (−1
// pour le corps), rôle : 0 dessus, 1 dessous, 2 tranche, 3 corps (base). Pour le
// corps : X = position de θ entre l'attache et le trou, Y = φ / 2π.
class Mesh {
  constructor(cap = 1 << 16) { this.n = 0; this.ni = 0; this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3); this.pat = new Float32Array(cap * 4); this.gr = new Float32Array(cap * 2); this.idx = new Uint32Array(cap * 6); this.birth = [0, 1]; }
  grow() {
    const g = (a, k) => { const b = new a.constructor(a.length * 2); b.set(a); return b; };
    this.pos = g(this.pos); this.nor = g(this.nor); this.pat = g(this.pat); this.gr = g(this.gr);
  }
  vert(p, n, x, y, e, id, role) {
    if ((this.n + 1) * 3 > this.pos.length) this.grow();
    const i = this.n++;
    this.pos.set(p, i * 3); this.nor.set(n, i * 3);
    this.pat[i * 4] = x; this.pat[i * 4 + 1] = y; this.pat[i * 4 + 2] = e; this.pat[i * 4 + 3] = (id + 1) * 4 + role;
    this.gr[i * 2] = this.birth[0]; this.gr[i * 2 + 1] = this.birth[1];
    return i;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.idx.length) { const b2 = new Uint32Array(this.idx.length * 2); b2.set(this.idx); this.idx = b2; }
    // orientation d'après les normales des sommets
    const P = this.pos, N = this.nor;
    const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const v = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const g = cross(u, v), s = g[0] * (N[a * 3] + N[b * 3] + N[c * 3]) + g[1] * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + g[2] * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (s < 0) { this.idx[this.ni++] = a; this.idx[this.ni++] = c; this.idx[this.ni++] = b; } else { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  out() { return { position: this.pos.slice(0, this.n * 3), normal: this.nor.slice(0, this.n * 3), pat: this.pat.slice(0, this.n * 4), grow: this.gr.slice(0, this.n * 2), index: this.idx.slice(0, this.ni) }; }
}

// ── La pile : hauteurs posées au-dessus de la base, sur une grille (θ, φ) ────
class Stack {
  constructor(base, th0, th1, W = 1024, H = 512) {
    Object.assign(this, { base, th0, th1, W, H });
    this.h = new Float32Array(W * H);
    this.own = new Int32Array(W * H).fill(-1); // (écaille du dessus en ce point, et son t)
    this.ownT = new Float32Array(W * H);
    this.P = new Float32Array(W * H * 3); // points de la base (précalculés)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = base.point(this.th(j), this.ph(i));
      this.P.set(p, (j * W + i) * 3);
    }
  }
  th(j) { return this.th0 + ((j + 0.5) / this.H) * (this.th1 - this.th0); }
  ph(i) { return ((i + 0.5) / this.W) * TAU - PI; }
  // hauteur maximale sur un voisinage de ±r cellules (ce qui est sous un
  // triangle entre deux sommets : une lèvre fine ne doit pas percer la face)
  maxAt(th, ph, r = 2) {
    const y = Math.round(((th - this.th0) / (this.th1 - this.th0)) * this.H - 0.5);
    const x = Math.round(((ph + PI) / TAU) * this.W - 0.5);
    let m = 0;
    for (let dj = -r; dj <= r; dj++) {
      const j = y + dj;
      if (j < 0 || j >= this.H) continue;
      for (let di = -r; di <= r; di++) { const v = this.h[j * this.W + (((x + di) % this.W) + this.W) % this.W]; if (v > m) m = v; }
    }
    return m;
  }
  // hauteur bilinéaire en (θ, φ)
  at(th, ph) {
    const y = ((th - this.th0) / (this.th1 - this.th0)) * this.H - 0.5;
    if (y < 0 || y > this.H - 1) return 0;
    const x = ((ph + PI) / TAU) * this.W - 0.5;
    const j = Math.floor(y), fy = y - j, i0 = Math.floor(x), fx = x - i0;
    const W = this.W, h = this.h, w = (i) => ((i % W) + W) % W;
    const a = h[j * W + w(i0)], b = h[j * W + w(i0 + 1)], c = h[(j + 1) * W + w(i0)], d = h[(j + 1) * W + w(i0 + 1)];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

// ── Une cloche du nid ────────────────────────────────────────────────────────
// Le nid grandit par cloches emboîtées : chacune est une enveloppe complète,
// d'échelle lam, attachée sous la poutre, construite du haut vers le bas
// pendant [s0, s1] de la saison par-dessus la précédente.
// spec : { seed, k, lam, s0, s1, a, b, lump, yBeam, hole, spacing, sources: [poids…], persist }
// Repère local : le haut de la cloche est sous la poutre à y = yBeam·lam ; la
// scène la descend de yBeam·(1 − lam) pour que toutes touchent la poutre.
export function buildEnvelope(spec) {
  const t0 = Date.now();
  const S = { a: 1.25, b: 1.45, lump: 0.045, yBeam: 1.25, hole: 0.09, spacing: 0.21, persist: 0.62, sources: [1, 1, 1, 1], lam: 1, k: 0, s0: 0, s1: 1, ...spec };
  const lam = S.lam;
  const rng = createRng(`env:${S.seed}:${S.k}`);
  const N = createNoise3(`scales:${S.seed}:${S.k}`);
  // (bruit des bords : indexé par la clé de l'écaille, pas par son rang)
  // une petite cloche pend à son pétiole (une boule) ; la grande s'étale sous la poutre
  const flat = smoothstep(0.25, 0.9, lam);
  const base = makeBase({ ...S, a: S.a * lam, b: S.b * lam, top: 2 + 1.2 * flat * (S.topK ?? 1) });
  const yTop = S.b * lam * (0.985 - (0.985 - S.yBeam / S.b) * flat * (S.topK ?? 1));
  // θ de l'anneau d'attache (base ∩ dessous de la poutre) et du trou de vol
  let thTop = 0.05;
  while (base.point(thTop, 0)[1] > yTop && thTop < 1.5) thTop += 0.002;
  const hole = S.hole * lam ** 0.4;
  const thHole = PI - Math.asin(hole / base.rho(0, -1, 0));
  const GW = Math.round(1024 * Math.max(0.4, lam) / 64) * 64;
  const stack = new Stack(base, Math.max(0.02, thTop - 0.25), PI, GW, GW / 2);
  // résolution des écailles : une petite cloche se voit de plus près
  const NT = Math.round((S.lite ? 6 : 8) * lam ** -0.2), NA = Math.round((S.lite ? 14 : lam < 0.99 ? 22 : 20) * lam ** -0.2), NR = S.lite ? 3 : 4;
  const span = S.s1 - S.s0, dScale = span * 0.15;

  // racines : semis de Poisson (aire uniforme), de l'attache jusqu'à la collerette du trou
  const sp = S.spacing * lam ** 0.75 * (S.lite ? 1.25 : 1), roots = []; // (mobile : des écailles plus grandes, deux fois moins nombreuses)
  const cell = sp * 0.9, grid = new Map();
  const key = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  const cosA = Math.cos(thTop - 0.18), cosB = Math.cos(thHole - 0.3);
  for (let k = 0; k < 40000 && roots.length < 2000; k++) {
    const y = cosB + (cosA - cosB) * rng.next(), ph = rng.range(-PI, PI), th = Math.acos(y);
    const p = base.point(th, ph), md = sp * rng.range(0.82, 1.0);
    let ok = true;
    const [gx, gy, gz] = [Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)];
    for (let dx = -2; dx <= 2 && ok; dx++) for (let dy = -2; dy <= 2 && ok; dy++) for (let dz = -2; dz <= 2 && ok; dz++) {
      const L = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (L) for (const q of L) if (len(sub(p, q.p)) < md) { ok = false; break; }
    }
    if (!ok) continue;
    const r = { th, ph, p, key: roots.length };
    roots.push(r);
    const kk = key(p); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(r);
  }
  // pose de bas en haut (θ décroissant) : les écailles du haut recouvrent les racines du bas
  roots.sort((u, v) => v.th - u.th);

  const M = new Mesh(1 << 18);
  const nS = roots.length;
  const bands = new Uint8Array(nS * MAXB * 4); // par bande : source, nuance, largeur relative, humidité
  const scales = [];
  const thick = 0.0032, gap = 0.0018;
  const vSp = (1.65 * sp) / NT, cellW = (TAU * S.a * lam) / stack.W;
  const dil = S.dilate === false ? 0 : Math.max(2, Math.ceil((0.75 * vSp) / cellW)); // (dilatation de la pile : un pas de sommet ; sans elle — témoin des tests — les lèvres percent)
  const thR0 = thTop - 0.18, thR1 = thHole - 0.3;

  // cicatrice : seules les écailles du haut, arrachées (le nid tombé laisse sur la
  // poutre le haut de sa dernière cloche, déchiré)
  if (S.scar) {
    const keep = roots.filter((r) => r.th < thTop + 0.03 + 0.03 * Math.sin(r.ph * 3 + 1.3));
    roots.length = 0; roots.push(...keep);
  }
  roots.forEach((r, id) => {
    // (un tirage propre à chaque écaille : la cicatrice, qui n'en garde que le
    // haut, retrouve exactement les mêmes écailles que le nid entier)
    const rr = createRng(`sc:${S.seed}:${S.k}:${r.key}`);
    // naissance : le front descend de l'attache vers le trou (une enveloppe se
    // bâtit du haut vers le bas), un peu de désordre d'une écaille à l'autre
    const f = clamp((r.th - thR0) / (thR1 - thR0) + rr.range(-0.04, 0.04), 0, 1);
    r.b = S.s0 + f * (span - dScale); r.d = dScale * rr.range(0.85, 1.15);
    r.v0 = M.n; // (sommets de l'écaille : leur naissance est fixée après coup)
    const F = base.frame(r.th, r.ph);
    // direction « vers le bas » tournée d'un angle tiré ; près du trou, vers le trou
    const psi = rr.range(-0.38, 0.38);
    const d = norm(add(mul(F.T, Math.cos(psi)), mul(F.U, Math.sin(psi))));
    const e = norm(cross(F.N, d));
    const jit = Math.exp(rr.gauss() * 0.22); // (tailles log-normales : quelques grandes poches parmi les petites)
    const A = sp * 1.05 * jit * rr.range(0.85, 1.25), Bl = sp * 1.65 * jit * rr.range(0.85, 1.15); // demi-largeur, longueur (poches plus larges que hautes)
    const skew = rr.range(-0.25, 0.25); // (une poche n'est jamais symétrique)
    const lk = S.liftK ?? 1;
    const lift = rr.range(0.16, 0.26) * lk, bulge = rr.range(0.05, 0.1) * lk, curl = rr.range(0.06, 0.14) * lk; // (poches profondes, lèvres relevées)
    const ph0 = rr.range(0, 100);
    const kid = r.key;
    const edge = (al) => 1 + 0.14 * N.noise(al * 1.3 + ph0, kid * 0.37, 0.5) + 0.06 * N.noise(al * 4.5 + ph0, 1.7, kid * 0.11) + 0.025 * N.noise(al * 14 + ph0, 2.9, kid * 0.21); // (bord effrangé)
    // (cicatrice : chaque écaille déchirée à une longueur qui varie le long de son bord)
    const tear = (al) => 0.22 + 0.2 * (0.5 + 0.5 * N.noise(al * 3 + ph0, kid * 0.7, 3.3)) + 0.04 * N.noise(al * 17, kid, 1.1);
    // profil : hauteur au-dessus de la base en (t, α) — α = 0 vers le bas
    const prof = (t, al) => {
      const ca = Math.max(0, Math.cos(al));
      return Bl * (lift * Math.pow(t, 1.5) * Math.pow(ca, 0.5) + bulge * Math.sin(PI * Math.min(1, t)) * ca * ca * 0.5 + curl * Math.pow(smoothstep(0.72, 1, t), 2) * Math.pow(ca, 0.7));
    };
    // point de la base sous (t, α) : plan tangent à la racine, projeté sur la base
    const under = (t, al) => {
      const E = edge(al);
      const [sx, sy] = sup(al);
      const qx = (sx + skew * sy) * A * t * E, qy = sy * Bl * t * E;
      const p0 = add(r.p, add(mul(e, qx), mul(d, qy)));
      const [th, ph] = toThPh(p0);
      return { th, ph };
    };
    // grille du dessus : positions drapées
    const tMin = 0.04;
    const top = [], tp = [];
    for (let j = 0; j <= NT; j++) {
      const t = tMin + (1 - tMin) * Math.pow(j / NT, 0.85);
      const row = [], rowT = [];
      for (let i = 0; i <= NA; i++) {
        const al = -PI / 2 + (PI * i) / NA;
        const u = under(S.scar ? Math.min(t, tear(al)) : t, al);
        const Fb = base.frame(u.th, u.ph);
        const z = Math.max(prof(t, al), stack.maxAt(u.th, u.ph, dil) + gap);
        row.push(add(Fb.P, mul(Fb.N, z)));
        const [sx, sy] = sup(al);
        rowT.push([sx * t * edge(al), sy * t * edge(al), edge(al)]);
      }
      top.push(row); tp.push(rowT);
    }
    // normales du dessus (différences centrées sur la grille)
    const nrm = top.map((row, j) => row.map((p, i) => {
      const a = top[Math.min(NT, j + 1)][i], b = top[Math.max(0, j - 1)][i];
      const c = row[Math.min(NA, i + 1)], dd = row[Math.max(0, i - 1)];
      let n = norm(cross(sub(c, dd), sub(a, b)));
      if (dot(n, p) < 0) n = neg(n);
      return n;
    }));
    // lame épaisse : dessus, dessous, tranche arrondie tout autour
    const vT = top.map((row, j) => row.map((p, i) => M.vert(p, nrm[j][i], ...tp[j][i], id, 0)));
    const vB = top.map((row, j) => row.map((p, i) => M.vert(sub(p, mul(nrm[j][i], thick)), neg(nrm[j][i]), ...tp[j][i], id, 1)));
    for (let j = 0; j < NT; j++) for (let i = 0; i < NA; i++) {
      M.quad(vT[j][i], vT[j][i + 1], vT[j + 1][i + 1], vT[j + 1][i]);
      M.quad(vB[j][i], vB[j + 1][i], vB[j + 1][i + 1], vB[j][i + 1]);
    }
    // contour (dans l'ordre) : bord libre (t = 1), flanc α = +π/2, racine, flanc α = −π/2
    const ring = [];
    for (let i = 0; i <= NA; i++) ring.push([NT, i]);
    for (let j = NT - 1; j >= 0; j--) ring.push([j, NA]);
    for (let i = NA - 1; i >= 0; i--) ring.push([0, i]);
    for (let j = 1; j < NT; j++) ring.push([j, 0]);
    const rimRows = ring.map(([j, i], k) => {
      // normale « dans le plan », vers l'extérieur de la lame
      const p = top[j][i], n = nrm[j][i];
      const prev = ring[(k - 1 + ring.length) % ring.length], next = ring[(k + 1) % ring.length];
      const tg = norm(sub(top[next[0]][next[1]], top[prev[0]][prev[1]]));
      let o = norm(cross(tg, n));
      // (vers l'extérieur : à l'opposé du centre de l'écaille)
      const cIn = top[Math.floor(NT / 2)][Math.floor(NA / 2)];
      if (dot(o, sub(p, cIn)) < 0) o = neg(o);
      const out = [];
      for (let s = 0; s <= NR; s++) {
        const w = (PI * s) / NR; // 0 : dessus, π : dessous
        const c = sub(p, mul(n, thick / 2));
        const q = add(c, add(mul(n, (Math.cos(w) * thick) / 2), mul(o, (Math.sin(w) * thick) / 2 * 1.4)));
        const nn = norm(add(mul(n, Math.cos(w)), mul(o, Math.sin(w))));
        out.push(M.vert(q, nn, ...tp[j][i], id, 2));
      }
      return out;
    });
    for (let k = 0; k < rimRows.length; k++) {
      const A0 = rimRows[k], B0 = rimRows[(k + 1) % rimRows.length];
      for (let s = 0; s < NR; s++) M.quad(A0[s], A0[s + 1], B0[s + 1], B0[s]);
    }

    // pile : la grille sous l'empreinte reçoit le dessus de l'écaille
    const thMin = Math.min(...top.flat().map((p) => toThPh(p)[0])) - 0.02, thMax = Math.max(...top.flat().map((p) => toThPh(p)[0])) + 0.02;
    const j0 = Math.max(0, Math.floor(((thMin - stack.th0) / (stack.th1 - stack.th0)) * stack.H)), j1 = Math.min(stack.H - 1, Math.ceil(((thMax - stack.th0) / (stack.th1 - stack.th0)) * stack.H));
    let dphMax = 0;
    for (const p of top.flat()) { let dp = toThPh(p)[1] - r.ph; dp = ((dp + PI) % TAU + TAU) % TAU - PI; dphMax = Math.max(dphMax, Math.abs(dp)); }
    const ni = Math.ceil(((dphMax + 0.02) / TAU) * stack.W), ic = Math.floor(((r.ph + PI) / TAU) * stack.W);
    const writes = [];
    for (let j = j0; j <= j1; j++) for (let di = -ni; di <= ni; di++) {
      const i = (((ic + di) % stack.W) + stack.W) % stack.W, k = j * stack.W + i;
      const P = [stack.P[k * 3], stack.P[k * 3 + 1], stack.P[k * 3 + 2]];
      // (inverse exact de la pose : le rayon issu du centre qui passe par ce point de
      // la base coupe le plan tangent à la racine en p0 = c + qx·e + qy·d)
      const kk = dot(r.p, F.N) / dot(P, F.N);
      if (!(kk > 0)) continue;
      const v = sub(mul(P, kk), r.p), qx = dot(v, e), qy = dot(v, d);
      if (qy < -0.002) continue;
      const yy = Math.max(0, qy) / Bl, xx = qx / A - skew * yy; // (on défait le biais)
      const al = Math.atan2(Math.sign(xx) * Math.abs(xx) ** (SP / 2), yy ** (SP / 2));
      const t = (Math.abs(xx) ** SP + yy ** SP) ** (1 / SP) / edge(al);
      if (t > 1) continue;
      // (la même hauteur que les sommets : la pile dilatée d'avant cette écaille)
      writes.push(k, Math.max(prof(t, al), stack.maxAt(stack.th(j), stack.ph(i), dil) + gap) + thick, t);
    }
    for (let q = 0; q < writes.length; q += 3) { const k = writes[q]; stack.h[k] = Math.max(stack.h[k], writes[q + 1]); stack.own[k] = id; stack.ownT[k] = writes[q + 2]; }

    // bandes : largeur tirée par écaille, sources en chaîne de Markov
    const w = rr.range(0.0035, 0.0065) * (S.stripW ?? 1);
    const nb = Math.min(MAXB, Math.max(6, Math.round(Bl / w)));
    let src = pickW(rr, S.sources);
    for (let k = 0; k < MAXB; k++) {
      if (k > 0 && !rr.chance(S.persist)) src = pickW(rr, S.sources);
      const o = (id * MAXB + k) * 4;
      bands[o] = src; bands[o + 1] = Math.floor(rr.next() * 255); bands[o + 2] = Math.floor(rr.range(0.6, 1.4) * 127); bands[o + 3] = 0;
    }
    bands[id * MAXB * 4 + 3] = nb; // (nombre de bandes de l'écaille : alpha du premier texel)
    r.v1 = M.n;
    scales.push({ nb, th: r.th, ph: r.ph });
  });

  // Naissances : une écaille ne commence que lorsque l'écaille qui la recouvre
  // (celle du dessus à sa racine) a poussé jusqu'à elle — sinon son amorce
  // flotterait sous le front. Ordre du haut vers le bas (θ croissant).
  const byTh = roots.map((r, i) => i).sort((i, j) => roots[i].th - roots[j].th);
  // (et jamais avant les écailles nettement au-dessus d'elle : le front descend sans retour)
  const rad = base.rho(1, 0, 0), dTh = (0.55 * sp) / rad;
  let lo = 0, runMax = -1;
  for (const j of byTh) {
    while (lo < byTh.length && roots[byTh[lo]].th < roots[j].th - dTh) { runMax = Math.max(runMax, roots[byTh[lo]].b); lo++; }
    if (runMax > 0) roots[j].b = Math.max(roots[j].b, runMax + 0.15 * roots[j].d);
    const r = roots[j];
    const y = Math.round(((r.th - stack.th0) / (stack.th1 - stack.th0)) * stack.H - 0.5), x = Math.round(((r.ph + PI) / TAU) * stack.W - 0.5);
    const k = clamp(y, 0, stack.H - 1) * stack.W + ((x % stack.W) + stack.W) % stack.W;
    const i = stack.own[k];
    if (i >= 0 && i !== j && roots[i].th < r.th) r.b = Math.max(r.b, roots[i].b + Math.min(1, stack.ownT[k] + 0.05) * roots[i].d);
  }
  // (la dernière écaille doit finir dans la fenêtre : on resserre si besoin)
  if (S.scar) roots.forEach((r) => { r.b = -1; r.d = 1e-3; });
  const last = Math.max(...roots.map((r) => r.b + r.d));
  const squeeze = !S.scar && last > S.s1 ? (S.s1 - S.s0) / (last - S.s0) : 1;
  roots.forEach((r) => {
    const b = S.s0 + (r.b - S.s0) * squeeze, d = r.d * squeeze;
    for (let v = r.v0; v < r.v1; v++) { M.gr[v * 2] = b; M.gr[v * 2 + 1] = d; }
    r.b = b; r.d = d;
  });
  // front du corps : sous les écailles, il paraît quand celles de sa rangée sont faites
  // (après la dernière écaille de la rangée : le corps ne doit jamais devancer le front)
  const front = new Float64Array(64).fill(S.s0);
  for (const r of roots) { const q = clamp(Math.floor(((r.th - thR0) / (thR1 - thR0)) * 63), 0, 63); front[q] = Math.max(front[q], r.b + r.d * 0.95); }
  for (let q = 1; q < 64; q++) front[q] = Math.max(front[q], front[q - 1]);

  // le corps : la feuille précédente (la base), en grille (θ, φ), avec sa collerette jusqu'au trou
  const nb = new Float32Array(nS); scales.forEach((s, i) => { nb[i] = s.nb; });
  const NB = S.scar ? 0 : Math.round(220 * Math.max(0.35, lam)), NP = Math.round(256 * Math.max(0.35, lam));
  // (une bande de quadrilatères par rangée, sans sommet partagé avec la voisine :
  // tous les sommets d'une bande ont la même naissance — une bande pas encore
  // née s'écrase entière en un point, sans étirer de triangle vers le centre)
  const thOf = (j) => (thTop - 0.12) + ((thHole - (thTop - 0.12)) * j) / NB;
  const bornOf = (th) => front[clamp(Math.floor(((th - thR0) / (thR1 - thR0)) * 63), 0, 63)];
  for (let j = 0; j < NB; j++) {
    const t0 = thOf(j), t1 = thOf(j + 1);
    M.birth = [Math.max(bornOf(t0), bornOf(t1)), dScale * 0.2];
    const rows = [t0, t1].map((th) => {
      const row = [];
      for (let i = 0; i <= NP; i++) {
        const F = base.frame(th, -PI + (TAU * i) / NP);
        row.push(M.vert(F.P, F.N, (th - thTop) / (thHole - thTop), i / NP, 1, -1, 3));
      }
      return row;
    });
    for (let i = 0; i < NP; i++) M.quad(rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]);
  }
  // lèvre du trou de vol : un bourrelet qui rentre dans le nid
  const lip = [];
  const NL = S.scar ? 0 : 10;
  M.birth = [S.s1 - dScale * 0.5, dScale * 0.4];
  for (let s = 0; s <= NL && NL > 0; s++) {
    const w = (PI * s) / NL;
    const row = [];
    for (let i = 0; i <= NP; i++) {
      const ph = -PI + (TAU * i) / NP;
      const F = base.frame(thHole, ph);
      const out = norm(sub(F.P, [0, F.P[1], 0])); // radial horizontal
      const rr = 0.022 * lam ** 0.4;
      const c = add(F.P, mul(F.N, -rr));
      const q = add(c, add(mul(F.N, Math.cos(w) * rr), mul(out, -Math.sin(w) * rr)));
      const n = norm(add(mul(F.N, Math.cos(w)), mul(out, -Math.sin(w))));
      row.push(M.vert(q, n, 1, i / NP, 1, -1, 3));
    }
    lip.push(row);
  }
  for (let s = 0; s < NL; s++) for (let i = 0; i < NP; i++) M.quad(lip[s][i], lip[s][i + 1], lip[s + 1][i + 1], lip[s + 1][i]);

  const out = M.out();
  // par écaille : premier sommet de sa grille du dessus, naissance, durée, bandes
  // (le temps fort choisit une écaille au front et y fait marcher une ouvrière)
  const info = new Float32Array(roots.length * 4);
  roots.forEach((r, id) => { info.set([r.v0, r.b, r.d, scales[id]?.nb ?? 0], id * 4); });
  return { ...out, bands, info, grid: [NT, NA, 0.04], nScales: nS, nb, thTop, thHole, k: S.k, lam, yOff: S.yBeam - yTop, ms: Date.now() - t0 };
}

function pickW(rng, w) {
  let s = 0; for (const x of w) s += x;
  let r = rng.next() * s;
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
  return w.length - 1;
}

// La cicatrice : la plaque de papier par laquelle le nid tenait à la poutre,
// restée collée quand il est tombé — une tache plate aux bandes concentriques,
// au bord déchiré. Corps (rôle 3) : X = rayon relatif (les bandes), Y = φ / 2π.
export function buildScar({ seed = 'nest', yBeam = 1.25, radius = 0.5 } = {}) {
  const N = createNoise3(`scar:${seed}`);
  const M = new Mesh(1 << 14);
  M.birth = [-1, 1e-3];
  const NR = 36, NP = 160, rows = [];
  const edge = (ph) => radius * (1 + 0.16 * N.noise(Math.cos(ph) * 1.5, Math.sin(ph) * 1.5, 0.3) + 0.06 * N.noise(Math.cos(ph) * 6, Math.sin(ph) * 6, 1.7));
  for (let j = 0; j <= NR; j++) {
    const row = [];
    for (let i = 0; i <= NP; i++) {
      const ph = (TAU * i) / NP, r = (edge(ph) * j) / NR;
      // (plaque à peine bombée, un peu plus épaisse au centre : le pétiole arraché)
      const y = yBeam - 0.002 - 0.004 * (1 - j / NR) ** 2;
      row.push(M.vert([Math.cos(ph) * r, y, Math.sin(ph) * r], [0, -1, 0], (j / NR) * 0.35, i / NP, 2, -1, 3)); // (E = 2 : la cicatrice, délavée)
    }
    rows.push(row);
  }
  for (let j = 0; j < NR; j++) for (let i = 0; i < NP; i++) M.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  return { ...M.out(), bands: new Uint8Array(MAXB * 4), nScales: 1 };
}
