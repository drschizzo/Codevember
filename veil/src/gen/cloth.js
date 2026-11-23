// Le voile : un carré d'étoffe de n × n particules, simulé par dynamique des
// positions étendue (XPBD, « petits pas » : une passe de Gauss-Seidel par
// sous-pas, beaucoup de sous-pas). JS pur, déterministe (même ordre de calcul
// partout) : il tourne dans les workers, et Node le teste tel quel.
//
// Contraintes : longueur des fils (chaîne et trame), biais (diagonales,
// souple : c'est ce qui laisse l'étoffe épouser une forme), flexion (liens à
// deux mailles). Air : traînée quadratique selon la normale, faible le long du
// tissu. Contacts : la forme invisible et le socle (champs de distance), le
// sol, l'étoffe elle-même (grille de hachage), avec frottement de Coulomb.
// Le centre est tenu par la bague du cordon (particule cinématique).
//
// simulate(job) → { frames: Float32Array (count × N × 3), count, fps, final }
import { buildForm, bakeForm, plinthSDF } from './forms.js';
import { createRng } from '../../../shared/rng.js';

const { sqrt, abs, min, max, floor, hypot } = Math;

// ── Les étoffes (familles) ─────────────────────────────────────────────────
// rho : masse surfacique (kg/m²) ; bend, shear : souplesse relative (XPBD,
// sans dimension : 0 = raide) ; drag : traînée normale (coefficient de forme ×
// porosité) ; mu : frottement ; label, open : part de jour (rendu).
export const FABRICS = {
  mousseline: { label: 'Mousseline', rho: 0.035, bend: 6, shear: 2.5, drag: 1.25, mu: 0.6 },
  satin: { label: 'Satin', rho: 0.14, bend: 6, shear: 1.2, drag: 1.0, mu: 0.6 }, // (lourd et mouillé, il accroche : à 0,25 puis 0,4, il coulait de la tête puis du socle)
  tulle: { label: 'Tulle', rho: 0.022, bend: 1.2, shear: 0.5, drag: 0.55, mu: 0.5 },
  dentelle: { label: 'Dentelle', rho: 0.06, bend: 12, shear: 1.8, drag: 0.8, mu: 0.55 },
};

export const RC = 0.004;
export const MU_FORM = 0.4; // (la statue est un marbre poli : le voile y glisse)
export const SELF = 0.6; // rayon des auto-collisions, en pas de grille // épaisseur de contact du voile (m)
const RHO_AIR = 1.2;
const G = -9.81;

export function makeCloth(n, L, fabric) {
  const N = n * n, h = L / (n - 1);
  const F = FABRICS[fabric];
  const m = (F.rho * L * L) / N;
  const C = [];
  const idx = (i, j) => j * n + i;
  // (ordre : fils, biais, flexion — fixe, donc déterministe)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i + 1 < n) C.push(idx(i, j), idx(i + 1, j), h, 0);
    if (j + 1 < n) C.push(idx(i, j), idx(i, j + 1), h, 0);
  }
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    C.push(idx(i, j), idx(i + 1, j + 1), h * Math.SQRT2, 1);
    C.push(idx(i + 1, j), idx(i, j + 1), h * Math.SQRT2, 1);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i + 2 < n) C.push(idx(i, j), idx(i + 2, j), 2 * h, 2);
    if (j + 2 < n) C.push(idx(i, j), idx(i, j + 2), 2 * h, 2);
  }
  const nc = C.length / 4;
  // ordre de résolution : de la bague vers le bord (distance de Tchebychev du
  // plus proche des deux bouts). La tension part de la bague : une passe vers
  // l'extérieur la transmet d'un seul balayage, comme on résout une chaîne
  // pendue de haut en bas ; la passe suivante revient vers la bague.
  const ci = (n - 1) >> 1;
  const ring = (k) => Math.max(Math.abs((k % n) - ci), Math.abs(((k / n) | 0) - ci));
  const order = Array.from({ length: nc }, (_, c) => c);
  const key = (c) => Math.min(ring(C[c * 4]), ring(C[c * 4 + 1])) * 4 + C[c * 4 + 3]; // (à anneau égal : fils, biais, flexion)
  order.sort((a, b) => key(a) - key(b) || a - b);
  const ca = new Int32Array(nc), cb = new Int32Array(nc), rest = new Float64Array(nc), kind = new Uint8Array(nc);
  order.forEach((o, c) => { ca[c] = C[o * 4]; cb[c] = C[o * 4 + 1]; rest[c] = C[o * 4 + 2]; kind[c] = C[o * 4 + 3]; });
  return { n, N, L, h, m, F, ca, cb, rest, kind, nc, center: idx(ci, ci) };
}

// Position de repos à plat (centrée sur l'axe, à la hauteur y, tournée de rot)
export function flatPositions(cl, y, rot, seed) {
  const { n, N, h } = cl;
  const rng = createRng(`flat:${seed}`);
  const X = new Float32Array(N * 3);
  const c = Math.cos(rot), s = Math.sin(rot), o = (n - 1) / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, u = (i - o) * h, v = (j - o) * h;
    X[k * 3] = c * u - s * v;
    X[k * 3 + 1] = y + (rng.next() - 0.5) * h * 0.08; // (un rien de désordre : la symétrie ne tient pas)
    X[k * 3 + 2] = s * u + c * v;
  }
  return X;
}

// ── Le cordon ────────────────────────────────────────────────────────────────
// La bague du voile monte et descend sur l'axe (x = z = 0). Lois en forme
// fermée, partagées par la simulation, le rendu (le cordon) et les tests.
export const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
export function knotRise(t, y0, yH, T) {
  // T = { tug, lift, hang } : le cordon se tend (1,5 cm), puis monte, puis pend
  const tug = T.tug, lift = T.lift;
  if (t < tug) return y0 + 0.015 * smoother(t / tug);
  const s = (t - tug) / lift;
  return y0 + 0.015 + (yH - y0 - 0.015) * smoother(s);
}
export function knotDesc(t, yH, y1, T) {
  // T = { pre, lower, settle } : immobile, descente (lente à l'arrivée), repos
  if (t < T.pre) return yH;
  const s = (t - T.pre) / T.lower;
  if (s >= 1) return y1;
  return yH + (y1 - yH) * smoother(s);
}

// ── La simulation ────────────────────────────────────────────────────────────
// job = { mode: 'hang' | 'rise' | 'desc', n, L, fabric, seed, start (Float32Array),
//   target (H, pour 'rise'), form (spec), plinth (spec), y0, yH, y1, T, sub, fps,
//   rot, floorY }
export function simulate(job) {
  const cl = makeCloth(job.n, job.L, job.fabric);
  const { n, N, ca, cb, rest, kind, nc, center } = cl;
  // linge humide : l'eau alourdit l'étoffe (×2,2) et l'assouplit
  const wet = job.wet ?? 0;
  const F = { ...cl.F, rho: cl.F.rho * (1 + 1.2 * wet), bend: cl.F.bend * (1 + 0.8 * wet), mu: cl.F.mu * (1 - 0.5 * wet) }; // (l'eau lubrifie : le linge glisse sur le marbre et s'y colle selon la normale)
  const m = cl.m * (1 + 1.2 * wet);
  const sub = job.sub ?? 450; // sous-pas par seconde
  const dt = 1 / sub;
  const fps = job.fps ?? 30;
  const form = job.form ? bakeForm(buildForm(job.form)) : null;
  const plinth = job.plinth ? plinthSDF(job.plinth) : null;
  const floorY = job.floorY ?? -2;

  const X = new Float64Array(N * 3), P = new Float64Array(N * 3), V = new Float64Array(N * 3), NR = new Float64Array(N * 3);
  const start = job.start ?? flatPositions(cl, 0, job.rot ?? 0, job.seed);
  for (let k = 0; k < N * 3; k++) X[k] = start[k];
  // (vitesses de départ : la montée reprend le voile en mouvement là où la
  // descente l'a laissé, sinon le raccord se verrait)
  if (job.startVel) for (let k = 0; k < N * 3; k++) V[k] = job.startVel[k];
  const tw0 = job.windT0 ?? 0; // (horloge du vent : continue d'un morceau au suivant)
  const H = job.target ?? null;

  // durée et cordon
  let Ttot, knot;
  if (job.mode === 'hang') { Ttot = job.T.total; knot = () => 0; }
  else if (job.mode === 'rise') { Ttot = job.T.tug + job.T.lift + job.T.hang; knot = (t) => knotRise(t, job.y0, job.yH, job.T); }
  else { Ttot = job.T.pre + job.T.lower + job.T.settle + (job.T.fall ?? 0); knot = (t) => knotDesc(t, job.yH, job.y1, job.T); }
  // le vent : il souffle pendant le repos, retombe avant la pendaison (H se
  // calcule sans vent), revient après la pose (enveloppe en forme fermée)
  const W = job.wind ?? null;
  const wd = W ? W.dir : [0, 0, 0];
  const windSpeed = (t) => {
    if (!W) return 0;
    let e = 0;
    if (job.mode === 'desc') e = smoother((t - (job.T.pre + job.T.lower * 0.7)) / 1.6);
    else if (job.mode === 'rise') e = 1 - smoother(t / (job.T.tug + job.T.lift * 0.55));
    // souffle lent (deux respirations par repos)
    return W.speed * e * (0.82 + 0.18 * Math.sin((t + tw0) * W.breath + W.phase));
  };
  const steps = Math.round(Ttot * sub);
  const count = Math.round(Ttot * fps) + 1;
  const frames = new Float32Array(count * N * 3);
  const record = (f) => { const o = f * N * 3; for (let k = 0; k < N * 3; k++) frames[o + k] = X[k]; };
  record(0);

  // souplesses XPBD (α̃ = α/dt², relatives à la somme des inverses de masse)
  const w = 1 / m;
  const at = [0, F.shear * 2 * w, F.bend * 2 * w];
  // traînée : a = −k |vn| vn n − kt v
  const kn = (0.5 * RHO_AIR * F.drag) / F.rho, kt = 0.02 * kn;
  const damp = job.mode === 'hang' ? 1 : 0; // (pendaison de référence : amortie fort pour converger)
  const DAMP = job.damp ?? 1.2; // (amortissement interne, s⁻¹)

  // grille de hachage (auto-collisions)
  const rs = cl.h * SELF, rs2 = rs * rs, inv = 1 / rs;
  const TB = 1 << (Math.ceil(Math.log2(N)) + 1);
  const head = new Int32Array(TB), next = new Int32Array(N);
  const hashOf = (ix, iy, iz) => (((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0) & (TB - 1);

  const g = [0, 0, 0];
  // contact (et adhérence d'un linge humide) : un point à moins de RC de la
  // matière en sort, avec frottement ; un point mouillé à moins de RC + RA y
  // est attiré (capillarité), d'une accélération ADH bornée par l'écart
  const ADH = (job.wet ?? 0) * (job.adhA ?? 60), RA = job.adhR ?? 0.05;
  const contact = (k, f, mu, baked, adh = 0) => {
    const k3 = k * 3, x = X[k3], y = X[k3 + 1], z = X[k3 + 2];
    const d = baked ? f(x, y, z, g) : f(x, y, z);
    if (d >= RC + (adh ? RA : 0)) return;
    if (!baked) {
      const e = 1e-4;
      g[0] = f(x + e, y, z) - f(x - e, y, z); g[1] = f(x, y + e, z) - f(x, y - e, z); g[2] = f(x, y, z + e) - f(x, y, z - e);
    }
    const l = hypot(g[0], g[1], g[2]) || 1;
    const nx = g[0] / l, ny = g[1] / l, nz = g[2] / l;
    if (d >= RC) { const s = Math.min(d - RC, adh * dt * dt); X[k3] -= nx * s; X[k3 + 1] -= ny * s; X[k3 + 2] -= nz * s; return; }
    const pen = RC - d;
    X[k3] += nx * pen; X[k3 + 1] += ny * pen; X[k3 + 2] += nz * pen;
    if (mu > 0) friction(k3, nx, ny, nz, pen, mu);
  };
  const friction = (k3, nx, ny, nz, pen, mu) => {
    const dx = X[k3] - P[k3], dy = X[k3 + 1] - P[k3 + 1], dz = X[k3 + 2] - P[k3 + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
    const tl = hypot(tx, ty, tz);
    if (tl < 1e-12) return;
    const s = tl < mu * 1.3 * pen ? 1 : min(1, (mu * pen) / tl);
    X[k3] -= tx * s; X[k3 + 1] -= ty * s; X[k3 + 2] -= tz * s;
  };

  // la bague tient la particule du centre (essayé : une rosette de 3 × 3
  // tenue à plat — le pli vif à son bord étirait davantage l'étoffe)
  const PASSES = job.passes ?? 2;
  const PIN = new Uint8Array(N), POFF = new Float64Array(N * 3);
  if (!job.noPin) PIN[center] = 1;
  const LRA = new Float64Array(N);
  { const ci = center % n, cj = (center / n) | 0; for (let k = 0; k < N; k++) LRA[k] = cl.h * hypot((k % n) - ci, ((k / n) | 0) - cj) * 1.002; }
  let frame = 1;
  for (let step = 1; step <= steps; step++) {
    const t = step * dt;
    // normales (différences centrées sur la grille)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, a = j * n + min(i + 1, n - 1), b = j * n + max(i - 1, 0), c = min(j + 1, n - 1) * n + i, e = max(j - 1, 0) * n + i;
      const ux = X[a * 3] - X[b * 3], uy = X[a * 3 + 1] - X[b * 3 + 1], uz = X[a * 3 + 2] - X[b * 3 + 2];
      const vx = X[c * 3] - X[e * 3], vy = X[c * 3 + 1] - X[e * 3 + 1], vz = X[c * 3 + 2] - X[e * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = hypot(nx, ny, nz) || 1;
      NR[k * 3] = nx / l; NR[k * 3 + 1] = ny / l; NR[k * 3 + 2] = nz / l;
    }
    // prédiction
    const ky = knot(t);
    const wa = windSpeed(t);
    for (let k = 0; k < N; k++) {
      const k3 = k * 3;
      P[k3] = X[k3]; P[k3 + 1] = X[k3 + 1]; P[k3 + 2] = X[k3 + 2];
      if (PIN[k]) { X[k3] = POFF[k3]; X[k3 + 1] = ky; X[k3 + 2] = POFF[k3 + 2]; continue; }
      let vx = V[k3], vy = V[k3 + 1] + G * dt, vz = V[k3 + 2];
      // vitesse relative à l'air (le vent)
      let rx = vx, ry = vy, rz = vz;
      if (wa > 0) {
        const x = X[k3], z = X[k3 + 2], y = X[k3 + 1];
        // rafale qui traverse : onde progressive le long du vent, plus un frisson
        const ph = (x * wd[0] + z * wd[2]) * 7 - (t + tw0) * 9.5;
        const sp = wa * (1 + 0.18 * Math.sin(ph) + 0.05 * Math.sin(ph * 2.3 + y * 11 + 1.7));
        rx -= wd[0] * sp; ry -= wd[1] * sp; rz -= wd[2] * sp;
      }
      const nx = NR[k3], ny = NR[k3 + 1], nz = NR[k3 + 2];
      const vn = rx * nx + ry * ny + rz * nz;
      const an = kn * abs(vn) * vn * dt;
      // (la traînée ne peut pas inverser la vitesse normale relative en un pas)
      const dvn = abs(an) > abs(vn) ? vn : an;
      vx -= dvn * nx + kt * rx * dt; vy -= dvn * ny + kt * ry * dt; vz -= dvn * nz + kt * rz * dt;
      { const s = 1 - (damp ? 3 : DAMP) * dt; vx *= s; vy *= s; vz *= s; } // (amortissement interne : un linge humide posé ne frémit pas)
      X[k3] += vx * dt; X[k3 + 1] += vy * dt; X[k3 + 2] += vz * dt;
    }
    // auto-collisions : particules non voisines dans la grille plus proches que rs
    // (avant les fils : ce sont eux qui ont le dernier mot, l'étoffe ne s'étire pas)
    if (step % 2 === 0 && !job.noSelf) {
    head.fill(-1);
    for (let k = 0; k < N; k++) {
      const hk = hashOf(floor(X[k * 3] * inv), floor(X[k * 3 + 1] * inv), floor(X[k * 3 + 2] * inv));
      next[k] = head[hk]; head[hk] = k;
    }
    for (let k = 0; k < N; k++) {
      const k3 = k * 3, ix = floor(X[k3] * inv), iy = floor(X[k3 + 1] * inv), iz = floor(X[k3 + 2] * inv);
      const ki = k % n, kj = (k / n) | 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (let q = head[hashOf(ix + a, iy + b, iz + c)]; q >= 0; q = next[q]) {
          if (q <= k) continue;
          const qi = q % n, qj = (q / n) | 0;
          if (abs(qi - ki) <= 2 && abs(qj - kj) <= 2) continue;
          const q3 = q * 3;
          const dx = X[q3] - X[k3], dy = X[q3 + 1] - X[k3 + 1], dz = X[q3 + 2] - X[k3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rs2 || d2 < 1e-14) continue;
          const d = sqrt(d2), wk = PIN[k] ? 0 : 1, wq = PIN[q] ? 0 : 1;
          if (wk + wq === 0) continue;
          const s = (rs - d) / d / (wk + wq);
          X[k3] -= dx * s * wk; X[k3 + 1] -= dy * s * wk; X[k3 + 2] -= dz * s * wk;
          X[q3] += dx * s * wq; X[q3 + 1] += dy * s * wq; X[q3 + 2] += dz * s * wq;
        }
      }
    }
    }
    // contacts avec frottement (forme, socle, sol) : AVANT les fils. Le
    // frottement retient le déplacement tangent du sous-pas ; appliqué après
    // les fils, il défaisait leurs corrections et l'étoffe se distendait.
    const fb = form ? form.box : null;
    for (let k = 0; k < N; k++) {
      if (PIN[k]) continue;
      const k3 = k * 3, x = X[k3], y = X[k3 + 1], z = X[k3 + 2];
      if (form && x > fb[0] && x < fb[3] && y > fb[1] && y < fb[4] && z > fb[2] && z < fb[5]) contact(k, form, F.mu * MU_FORM, true, ADH);
      if (plinth && X[k3 + 1] < 0.05) contact(k, plinth, F.mu * 0.8, false);
      if (X[k3 + 1] < floorY + RC) { const pen = floorY + RC - X[k3 + 1]; X[k3 + 1] = floorY + RC; friction(k3, 0, 1, 0, pen, 0.7); }
    }
    // contraintes de distance : deux passes par sous-pas, de la bague vers le
    // bord puis retour (Gauss-Seidel symétrique)
    for (let pass = 0; pass < PASSES; pass++) {
    const fwd = (pass & 1) === 0;
    for (let cc = 0; cc < nc; cc++) {
      const c = fwd ? cc : nc - 1 - cc;
      const a = ca[c], b = cb[c];
      const wa = PIN[a] ? 0 : w, wb = PIN[b] ? 0 : w;
      const ws = wa + wb;
      if (ws === 0) continue;
      const a3 = a * 3, b3 = b * 3;
      const dx = X[b3] - X[a3], dy = X[b3 + 1] - X[a3 + 1], dz = X[b3 + 2] - X[a3 + 2];
      const l = sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-12) continue;
      let Cv = l - rest[c];
      const kd = kind[c];
      // la flexion et le biais ne résistent qu'à la compression (un tissu ne
      // s'étire pas en biais au-delà de sa longueur, mais se froisse librement)
      if (kd === 2 && Cv > 0) continue;
      const s = -Cv / (ws + at[kd]) / l;
      X[a3] -= dx * s * wa; X[a3 + 1] -= dy * s * wa; X[a3 + 2] -= dz * s * wa;
      X[b3] += dx * s * wb; X[b3 + 1] += dy * s * wb; X[b3 + 2] += dz * s * wb;
    }
    }
    // attaches à longue portée (Kim, Chentanez, Müller 2012) : aucun point ne
    // s'éloigne de la bague au-delà de sa distance sur l'étoffe à plat. C'est
    // ce qui tient le poids du voile pendu sans qu'il ne s'étire en chaîne.
    {
      const cx = X[center * 3], cy = X[center * 3 + 1], cz = X[center * 3 + 2];
      for (let k = 0; k < N; k++) {
        const k3 = k * 3, dx = X[k3] - cx, dy = X[k3 + 1] - cy, dz = X[k3 + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz, r = LRA[k];
        if (d2 > r * r) { const s = r / sqrt(d2); X[k3] = cx + dx * s; X[k3 + 1] = cy + dy * s; X[k3 + 2] = cz + dz * s; }
      }
    }
    // puis projection hors de la matière, sans frottement : rien ne traverse
        for (let k = 0; k < N; k++) {
      if (PIN[k]) continue;
      const k3 = k * 3, x = X[k3], y = X[k3 + 1], z = X[k3 + 2];
      if (form && x > fb[0] && x < fb[3] && y > fb[1] && y < fb[4] && z > fb[2] && z < fb[5]) contact(k, form, 0, true);
      if (plinth && X[k3 + 1] < 0.05) contact(k, plinth, 0, false);
      if (X[k3 + 1] < floorY + RC) { X[k3 + 1] = floorY + RC; }
    }
    // rappel vers la pendaison de référence (montée : pendant la pendaison seulement)
    if (H && job.mode === 'rise') {
      const s0 = job.T.tug + job.T.lift;
      if (t > s0) {
        // rappel doux (un amortissement vers H), puis raccord exact sur les
        // derniers 15 % : au dernier sous-pas, X = H
        const s = step === steps ? 1 : min(1, (t - s0) / job.T.hang);
        const beta = min(1, 0.006 * s * s + smoother((s - 0.85) / 0.15));
        for (let k = 0; k < N * 3; k++) X[k] += beta * (H[k] - X[k]);
      }
    }
    // vitesses
    for (let k = 0; k < N * 3; k++) V[k] = (X[k] - P[k]) / dt;
    if (job.onProgress && step % 300 === 0) job.onProgress(step / steps);
    // enregistrement
    while (frame < count && frame / fps <= t + 1e-9) { record(frame); frame++; }
  }
  while (frame < count) { record(frame); frame++; }
  const final = new Float32Array(N * 3);
  final.set(frames.subarray((count - 1) * N * 3));
  const vel = new Float32Array(N * 3);
  for (let k = 0; k < N * 3; k++) vel[k] = V[k];
  return { frames, count, fps, final, vel, n, N };
}
