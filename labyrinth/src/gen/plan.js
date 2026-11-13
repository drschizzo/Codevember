// Le film : le trajet complet de la bille, simulé une fois puis relu.
//
// Plateau : un pilote suit le chemin (impasses comprises), commande les deux
// angles du cardan sous une vitesse angulaire bornée (servomoteur), puis fait
// faire le tour de la rigole à la bille et la ramène au repos à l'entrée.
//
// Cadran et Roue : une recherche en largeur dans le graphe des états de
// gravité — un état est la cellule où la bille s'est arrêtée et l'angle du
// disque ; une transition est une rotation SIMULÉE en entier (chute, rebonds,
// arrêt). Le film est la suite exacte des transitions retenues, puis le
// retour : le disque tourne dans un seul sens, la poche soulève la bille, qui
// retombe par l'entrée.
//
// La boucle : l'état final doit être l'état initial. On cherche un point fixe
// (l'état d'arrivée devient l'état de départ, on recommence) ; l'écart qui
// reste (≪ 0,1 mm, bille à l'arrêt) est fondu dans la dernière pause.
import { DIM, gateFrame } from './maze.js';
import { PHYS, createWorld, newBall, step, qmul } from './physics.js';
import { createRng } from '../../../shared/rng.js';

const TAU = Math.PI * 2;
export const TILT_MAX = (5.5 * Math.PI) / 180;   // inclinaison maximale du plateau
export const SERVO_RATE = (40 * Math.PI) / 180;  // vitesse angulaire des servomoteurs
export const BACK = (12 * Math.PI) / 180;        // inclinaison arrière des disques dressés
export const DISC_DAMP = 0.9;                    // s⁻¹ : la bille qui roule dans une gorge de bois (pendule amorti)

// ── Enregistrement (120 i/s) ──────────────────────────────────────────────────
class Track {
  constructor() { this.x = []; this.y = []; this.q = []; this.a = []; this.b = []; this.ev = []; }
  push(ball, a, b) { this.x.push(ball.x); this.y.push(ball.y); this.q.push(...ball.q); this.a.push(a); this.b.push(b); }
  get n() { return this.x.length; }
  out(extra = {}) {
    return { n: this.n, rate: 1 / (PHYS.dt * PHYS.rec), x: Float32Array.from(this.x), y: Float32Array.from(this.y), q: Float32Array.from(this.q), a: Float64Array.from(this.a), b: Float64Array.from(this.b), ev: this.ev, ...extra };
  }
}

// ── Plateau : gravité dans le plan pour les angles du cardan ─────────────────
// Le plateau tourne de α autour de l'axe x (chape extérieure) puis de β autour
// de l'axe y (croisillon) : R = Rx(α)·Ry(β), et g∥ = Rᵀ·(0, 0, −g) :
export const plateGravity = (al, be) => ({ gx: PHYS.g * Math.sin(be) * Math.cos(al), gy: -PHYS.g * Math.sin(al), gn: PHYS.g * Math.cos(al) * Math.cos(be) });

// chemin à suivre : cellules → points (au passage d'une cellule à l'autre, le
// milieu de la frontière commune : la bille ne coupe pas les virages)
function cellPoints(maze, seq) {
  const P = [];
  const C = maze.cells;
  for (let i = 0; i < seq.length; i++) {
    const c = C[seq[i]];
    if (i > 0) {
      const p = C[seq[i - 1]];
      if (maze.topo === 'polar' && p.k === c.k && c.k > 0) {
        // même anneau : passer par la frontière radiale, à mi-rayon
        const r = (maze.radii[c.k] + maze.radii[c.k + 1]) / 2;
        let a = Math.abs(p.a1 - c.a0) < 1e-6 || Math.abs(p.a1 - c.a0 - TAU) < 1e-6 || Math.abs(p.a1 - TAU - c.a0) < 1e-6 ? p.a1 : p.a0;
        P.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      } else if (maze.topo === 'polar' && p.k !== c.k) {
        const o = p.k > c.k ? p : c, r = maze.radii[o.k];
        if (o.k > 1) { const a = (o.a0 + o.a1) / 2; P.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
      }
    }
    P.push({ x: c.x, y: c.y, cell: seq[i] });
  }
  return P;
}

// impasses visitées : des branches de 2 à 5 cellules qui partent du chemin
function withDetours(maze, path, n, rng) {
  if (!n) return { seq: [...path], ends: [] };
  const onPath = new Set(path);
  const cand = [];
  path.forEach((c, i) => {
    if (i === 0 || i >= path.length - 2) return;
    for (const v of maze.links[c]) {
      if (onPath.has(v)) continue;
      // la branche : descendre jusqu'à la feuille la plus profonde (≤ 5)
      // (une vraie impasse : toute la branche tient en 5 cellules, et l'on va
      // jusqu'à sa feuille la plus profonde)
      const best = deepest(maze.links, v, c, 6);
      if (best.length >= 2 && best.length <= 5) cand.push({ i, branch: best });
    }
  });
  const picked = [];
  for (let t = 0; t < 40 && picked.length < n && cand.length; t++) {
    const c = cand[Math.floor(rng.next() * cand.length)];
    if (picked.some((p) => Math.abs(p.i - c.i) < 4)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => a.i - b.i);
  const seq = [], ends = [];
  path.forEach((c, i) => {
    seq.push(c);
    for (const p of picked) if (p.i === i) {
      seq.push(...p.branch);
      ends.push(seq.length - 1);
      for (let k = p.branch.length - 2; k >= 0; k--) seq.push(p.branch[k]);
      seq.push(c);
    }
  });
  return { seq, ends };
}
function deepest(links, v, from, max) {
  let best = [v];
  const go = (u, prev, acc) => {
    if (acc.length > best.length) best = [...acc];
    if (acc.length >= max) return;
    for (const w of links[u]) if (w !== prev) { acc.push(w); go(w, u, acc); acc.pop(); }
  };
  go(v, from, [v]);
  return best;
}

// le milieu de la rigole, échantillonné (rectangle arrondi ou cercle)
function raceLoop(maze) {
  const w = maze.race.width, P = [];
  if (maze.topo === 'polar') {
    const r = maze.race.mid.r;
    for (let i = 0; i < 360; i++) { const a = (i / 360) * TAU; P.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); }
    return P;
  }
  const hx = maze.race.mid.hx, hy = maze.race.mid.hy, rr = w / 2 + 2;
  const ix = hx - rr, iy = hy - rr;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    // point du rectangle arrondi dans la direction a (par dichotomie sur le rayon)
    let lo = 0, hi = hx + hy;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2, x = m * ca, y = m * sa;
      const qx = Math.abs(x) - ix, qy = Math.abs(y) - iy;
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
      if (sd < 0) lo = m; else hi = m;
    }
    P.push({ x: lo * ca, y: lo * sa });
  }
  return P;
}
const angOf = (p) => Math.atan2(p.y, p.x);

// chemin complet du Plateau : labyrinthe (avec impasses), sortie, tour de la
// rigole jusqu'à l'entrée, retour à la cellule de départ
export function plateauRoute(maze, detours, seed) {
  const rng = createRng(`${seed}:detours`);
  const { seq, ends } = withDetours(maze, maze.path, detours, rng);
  const pts = cellPoints(maze, seq);
  const stops = new Map(); // indice du point → arrêt (impasse)
  let ci = 0;
  pts.forEach((p, i) => { if (p.cell !== undefined) { if (ends.includes(ci)) stops.set(i, 'end'); ci++; } });
  const X = gateFrame(maze.gates.X), E = gateFrame(maze.gates.E);
  const loop = raceLoop(maze);
  const nearest = (g) => { let bi = 0, bd = Infinity; loop.forEach((p, i) => { const d = Math.hypot(p.x - g.x - g.nx * maze.race.width / 2, p.y - g.y - g.ny * maze.race.width / 2); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const ix = nearest(X), ie = nearest(E);
  // sens : celui qui ne passe pas par la butée
  const bar = maze.race.pocket, ab = bar ? bar.a : 0;
  const n = loop.length;
  const passes = (dir) => { for (let i = ix; i !== ie; i = (i + dir + n) % n) if (Math.abs(((angOf(loop[i]) - ab + 3 * Math.PI) % TAU) - Math.PI) < 0.02) return true; return false; };
  const dir = passes(1) ? -1 : 1;
  pts.push({ x: X.x, y: X.y, gate: 'X' });
  for (let i = ix; ; i = (i + dir + n) % n) { if ((i - ix + n) % 6 === 0 || i === ie) pts.push(loop[i]); if (i === ie) break; }
  pts.push({ x: E.x, y: E.y, gate: 'E' });
  const s = maze.cells[maze.path[0]];
  pts.push({ x: s.x, y: s.y, cell: maze.path[0], final: true });
  stops.set(pts.length - 1, 'final');
  return { pts, stops, raceFrom: pts.findIndex((p) => p.gate === 'X') };
}

// ── Plateau : le pilote ──────────────────────────────────────────────────────
export function simulatePlateau(maze, opts = {}) {
  const world = createWorld(maze);
  const route = plateauRoute(maze, opts.detours ?? 1, opts.seed ?? '');
  const P = route.pts;
  // abscisses curvilignes, contraintes de vitesse aux coudes et aux arrêts
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
  const cons = []; // [abscisse, vitesse maximale]
  for (let i = 1; i < P.length - 1; i++) {
    if (route.stops.has(i)) { cons.push([L[i], 0, i]); continue; }
    const ax = P[i].x - P[i - 1].x, ay = P[i].y - P[i - 1].y, bx = P[i + 1].x - P[i].x, by = P[i + 1].y - P[i].y;
    const c = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
    if (c < 0.92) cons.push([L[i], c < 0.2 ? 55 : 95, i]);
  }
  cons.push([L[P.length - 1], 0, P.length - 1]);
  const at = (s) => {
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const t = Math.max(0, Math.min(1, (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1)));
    return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * t, y: P[i - 1].y + (P[i].y - P[i - 1].y) * t, i };
  };
  const aMax = (5 / 7) * PHYS.g * Math.sin(TILT_MAX) * 0.92, aBrake = aMax * 0.45;

  const start = opts.start ?? { x: P[0].x, y: P[0].y };
  const ball = newBall(start.x, start.y);
  if (opts.q) ball.q = [...opts.q];
  const T = new Track();
  let al = 0, be = 0, s = 0, hold = 0, ci = 0, phase = 'run', lastProg = 0, lastProgT = 0, k = 0;
  const raceStart = L[route.raceFrom];
  const pauseIn = opts.pauseIn ?? 0.7, pauseOut = opts.pauseOut ?? 1.1;
  let ending = 0;
  for (let it = 0; it < 960 * 240; it++) {
    const t = it * PHYS.dt;
    // progression : projection de la bille sur le chemin, en avant de s
    {
      let best = s, bd = Infinity;
      for (let ss = s; ss <= Math.min(L[L.length - 1], s + 30); ss += 0.5) {
        const p = at(ss), d = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (d < bd - 1e-6) { bd = d; best = ss; }
      }
      // (on ne dépasse pas l'arrêt en cours)
      s = Math.min(best, cons[ci][0]);
      if (s > lastProg + 2) { lastProg = s; lastProgT = t; }
      if (t - lastProgT > 6 && phase === "run") throw new Error(`bille bloquée (s = ${s.toFixed(0)} / ${L[L.length - 1].toFixed(0)}) bille ${ball.x.toFixed(1)},${ball.y.toFixed(1)} v ${ball.vx.toFixed(1)},${ball.vy.toFixed(1)} arrêt ${ci} ${JSON.stringify(cons[ci])} al ${al.toFixed(3)} be ${be.toFixed(3)} hold ${hold.toFixed(2)}`);
    }
    // commande
    let gx = 0, gy = 0;
    if (t < pauseIn) { /* pause de départ : plateau à plat */ }
    else if (phase === 'run') {
      const inRace = s >= raceStart - 4;
      const vmax = inRace ? 300 : 170;
      let vl = vmax;
      const sp0 = Math.hypot(ball.vx, ball.vy), react = 0.16; // (temps que met le plateau à basculer)
      for (let c = ci; c < cons.length; c++) {
        const [sc, vc] = cons[c];
        if (sc - s > 400) break;
        vl = Math.min(vl, Math.sqrt(vc * vc + 2 * aBrake * Math.max(0, sc - s - 1.5 - sp0 * react)));
      }
      const look = 7 + 0.1 * Math.hypot(ball.vx, ball.vy);
      let tg = at(Math.min(s + look, cons[ci][0]));
      const ps = at(s), off = Math.hypot(ps.x - ball.x, ps.y - ball.y);
      if (off > 5) { tg = ps; vl = Math.min(vl, 40 + 4 * off); } // (écartée du chemin : elle y revient d'abord)
      const dx = tg.x - ball.x, dy = tg.y - ball.y, dl = Math.hypot(dx, dy) || 1;
      const vdx = (vl * dx) / dl, vdy = (vl * dy) / dl;
      const kv = 7;
      let axc = kv * (vdx - ball.vx), ayc = kv * (vdy - ball.vy);
      // près d'un arrêt : asservissement en position sur le point d'arrêt
      // (la bille qui l'a dépassé y revient)
      if (cons[ci][1] === 0 && cons[ci][0] - s < 10) {
        const Pq = P[cons[ci][2]];
        axc = 14 * (Pq.x - ball.x) - 7.5 * ball.vx; ayc = 14 * (Pq.y - ball.y) - 7.5 * ball.vy;
      }
      const sp = Math.hypot(ball.vx, ball.vy);
      const rr = PHYS.muRoll * PHYS.g;
      if (sp > 1) { axc += (rr * ball.vx) / sp; ayc += (rr * ball.vy) / sp; }
      const am = Math.hypot(axc, ayc);
      if (am > aMax) { axc *= aMax / am; ayc *= aMax / am; }
      // arrêt atteint ?
      const [sc, , pi] = cons[ci];
      const stopP = P[pi];
      if (Math.hypot(stopP.x - ball.x, stopP.y - ball.y) < 2.5 && sp < 12) {
        hold += PHYS.dt;
        axc = kv * -ball.vx; ayc = kv * -ball.vy;
        if (hold > (route.stops.get(pi) === 'final' ? 0.25 : 0.3)) {
          if (route.stops.get(pi) === 'final') { phase = 'level'; T.ev.push(['home', T.n]); }
          else { T.ev.push(['deadend', T.n]); ci++; hold = 0; }
        }
      } else if (cons[ci][1] > 0 && s >= sc - 0.5) { ci++; }
      gx = (7 / 5) * axc; gy = (7 / 5) * ayc;
    }
    // angles visés → servomoteurs (vitesse bornée, petit retard)
    let alT = 0, beT = 0;
    if (phase === 'run' && t >= pauseIn) {
      alT = Math.asin(Math.max(-1, Math.min(1, -gy / PHYS.g)));
      beT = Math.asin(Math.max(-1, Math.min(1, gx / (PHYS.g * Math.cos(alT)))));
      alT = Math.max(-TILT_MAX, Math.min(TILT_MAX, alT)); beT = Math.max(-TILT_MAX, Math.min(TILT_MAX, beT));
    }
    const lag = 1 - Math.exp(-PHYS.dt / 0.045), mr = SERVO_RATE * PHYS.dt;
    al += Math.max(-mr, Math.min(mr, (alT - al) * lag * 4));
    be += Math.max(-mr, Math.min(mr, (beT - be) * lag * 4));
    if (phase === 'level' && Math.abs(al) < 1e-5 && Math.abs(be) < 1e-5) { al = 0; be = 0; ending += PHYS.dt; }
    const env = plateGravity(al, be);
    step(world, ball, env);
    if (it % PHYS.rec === 0) { T.push(ball, al, be); k++; }
    if (ending > pauseOut && ball.still > 0.2) break;
  }
  if (phase !== 'level') throw new Error('trajet inachevé');
  return { track: T, end: { x: ball.x, y: ball.y }, q: ball.q, route, world };
}

// ── Disques dressés : une rotation simulée ───────────────────────────────────
// gravité dans le plan du disque, au repère du disque, pour un angle φ
export const discGravity = (phi) => {
  const g = PHYS.g * Math.cos(BACK); // g∥ = R(−φ)·(0, −g·cos β)
  return { gx: -g * Math.sin(phi), gy: -g * Math.cos(phi), gn: PHYS.g * Math.sin(BACK), damp: DISC_DAMP };
};

// profil de rotation à secousse minimale, de φ0 à φ1 en T secondes
const mj = (t) => t * t * t * (10 + t * (-15 + 6 * t));
const mjd = (t) => 30 * t * t * (1 - t) * (1 - t);
const mjdd = (t) => 60 * t * (1 - t) * (1 - 2 * t);
export const rotDuration = (d) => 0.6 + 0.9 * Math.sqrt(Math.abs(d) / (Math.PI / 2));

function inMaze(maze, b) {
  if (maze.topo === 'polar') return Math.hypot(b.x, b.y) < maze.radii[maze.radii.length - 1];
  return Math.abs(b.x) < maze.extent.hx && Math.abs(b.y) < maze.extent.hy;
}
export function cellAt(maze, x, y) {
  if (maze.topo === 'polar') {
    const r = Math.hypot(x, y), R = maze.radii;
    if (r < R[1]) return 0;
    let k = 1;
    while (k < R.length - 1 && r >= R[k + 1]) k++;
    if (k >= R.length - 1) return -1;
    let a = Math.atan2(y, x); if (a < 0) a += TAU;
    const n = maze.counts[k], j = Math.min(n - 1, Math.floor((a / TAU) * n));
    let id = 1;
    for (let kk = 1; kk < k; kk++) id += maze.counts[kk];
    return id + j;
  }
  const { hx, hy } = maze.extent, c = maze.c;
  const i = Math.floor((x + hx) / c), j = Math.floor((y + hy) / c), nx = Math.round((2 * hx) / c), ny = Math.round((2 * hy) / c);
  if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
  return j * nx + i;
}

// fait tourner le disque de φ0 à φ0 + d, puis attend l'arrêt de la bille ;
// rec (facultatif) reçoit les images
function rotate(world, ball, phi0, d, rec = null, settleMax = 3.5) {
  const T = Math.abs(d) < 1e-9 ? 0 : rotDuration(d);
  const n = Math.round(T / PHYS.dt);
  let exitedVia = null, it = 0;
  const was = inMaze(world.maze, ball);
  for (; it < n; it++) {
    const u = it / n, phi = phi0 + d * mj(u), W = (d * mjd(u)) / T, dW = (d * mjdd(u)) / (T * T);
    step(world, ball, { ...discGravity(phi), W, dW });
    if (was && !exitedVia && !inMaze(world.maze, ball)) exitedVia = gateHit(world.maze, ball);
    if (rec && it % PHYS.rec === 0) rec.push(ball, phi, W);
  }
  const phi1 = phi0 + d;
  const g = discGravity(phi1);
  let st = 0;
  for (let k = 0; k < settleMax / PHYS.dt; k++, it++) {
    step(world, ball, g);
    if (was && !exitedVia && !inMaze(world.maze, ball)) exitedVia = gateHit(world.maze, ball);
    if (rec && it % PHYS.rec === 0) rec.push(ball, phi1, 0);
    if (ball.still > 0.25) { st = 1; break; }
  }
  // (pause de lecture : la bille arrêtée, le disque immobile)
  return { phi: phi1, settled: !!st, exitedVia, it };
}
function gateHit(maze, b) {
  const e = gateFrame(maze.gates.E), x = gateFrame(maze.gates.X);
  const de = Math.hypot(b.x - e.x, b.y - e.y), dx = Math.hypot(b.x - x.x, b.y - x.y);
  return dx < de ? 'X' : 'E';
}

// retour : rotation continue dans le sens de la poche, jusqu'à ce que la bille
// soit rentrée par l'entrée, puis arrêt à l'angle de départ (modulo un tour)
export const RET_SPEED = (110 * Math.PI) / 180;
function returnRun(world, ball, phi0, turn, home, rec = null, snap = 0) {
  const maze = world.maze;
  let phi = phi0, W = 0, it = 0, entered = null;
  const acc = RET_SPEED / 0.6;
  // montée en vitesse, puis vitesse constante jusqu'à l'entrée
  for (; it < 960 * 40; it++) {
    const Wt = turn * RET_SPEED;
    const dW = Math.sign(Wt - W) * Math.min(acc, Math.abs(Wt - W) / PHYS.dt);
    W += dW * PHYS.dt; phi += W * PHYS.dt;
    step(world, ball, { ...discGravity(phi), W, dW });
    if (rec && it % PHYS.rec === 0) rec.push(ball, phi, W);
    if (inMaze(maze, ball) && Math.hypot(ball.vx, ball.vy) >= 0) { entered = phi; break; }
  }
  if (entered === null) throw new Error('la bille ne rentre pas');
  // cible : premier angle ≡ home (mod 2π) au moins 35° plus loin
  let target = home ?? entered + turn * (40 * Math.PI) / 180;
  // (Cadran : l'arrêt sur un multiple de 90°, la gravité alignée sur les couloirs)
  if (home === undefined && snap) target = turn > 0 ? Math.ceil((entered + 0.45) / snap) * snap : Math.floor((entered - 0.45) / snap) * snap;
  if (home !== undefined) {
    const m = Math.ceil(((entered + turn * 0.6) * turn - home * turn) / TAU);
    target = home + turn * m * TAU;
  }
  // décélération : quintique qui part de (phi, W) et arrive en (target, 0)
  const D = target - phi, Td = Math.max(0.6, (2 * Math.abs(D)) / Math.abs(W || 1e-9));
  const n = Math.round(Td / PHYS.dt);
  // p(u) = φ + W·Td·h(u) + D·mj(u) : h(0) = h(1) = 0, h'(0) = 1, h'(1) = h''(0) = h''(1) = 0
  for (let i = 1; i <= n; i++, it++) {
    const u = i / n;
    const h = u - 6 * u ** 3 + 8 * u ** 4 - 3 * u ** 5, hd = 1 - 18 * u ** 2 + 32 * u ** 3 - 15 * u ** 4, hdd = -36 * u + 96 * u ** 2 - 60 * u ** 3;
    const W0 = W;
    const p = phi + W0 * Td * h + D * mj(u);
    const Wn = W0 * hd + (D * mjd(u)) / Td;
    const dW = (W0 * hdd) / Td + (D * mjdd(u)) / (Td * Td);
    step(world, ball, { ...discGravity(p), W: Wn, dW });
    if (rec && it % PHYS.rec === 0) rec.push(ball, p, Wn);
  }
  phi = target;
  const g = discGravity(phi);
  for (let k = 0; k < 960 * 4; k++, it++) {
    step(world, ball, g);
    if (rec && it % PHYS.rec === 0) rec.push(ball, phi, 0);
    if (ball.still > 0.3) break;
  }
  return { phi, entered };
}

// recherche en largeur des rotations qui mènent la bille à la sortie
export const lastSearch = {};
function searchDisc(world, start, phi0, actions, maxStates = 1600) {
  const maze = world.maze, q = 8;
  const keyOf = (b, phi) => `${cellAt(maze, b.x, b.y)}:${(((Math.round(phi / (TAU / q)) % q) + q) % q)}`;
  const nodes = [{ b: { ...start, cn: null }, phi: phi0, prev: -1, act: 0 }];
  const seen = new Set([keyOf(start, phi0)]);
  Object.assign(lastSearch, { start: keyOf(start, phi0), nodes: 0, unsettled: 0, viaE: 0 });
  for (let h = 0; h < nodes.length && nodes.length < maxStates; h++) {
    const N = nodes[h];
    for (const d of actions) {
      const b = { ...N.b, q: [...N.b.q] };
      const r = rotate(world, b, N.phi, d);
      lastSearch.nodes = nodes.length;
      if (!r.settled && inMaze(maze, b)) { lastSearch.unsettled++; continue; }
      if (r.exitedVia === 'E') { lastSearch.viaE++; continue; }
      if (r.exitedVia === 'X') {
        nodes.push({ b, phi: r.phi, prev: h, act: d, goal: true });
        const seqA = [];
        for (let k = nodes.length - 1; k > 0; k = nodes[k].prev) seqA.push(nodes[k].act);
        return seqA.reverse();
      }
      const k = keyOf(b, r.phi);
      if (seen.has(k)) continue;
      seen.add(k);
      nodes.push({ b, phi: r.phi, prev: h, act: d });
    }
  }
  return null;
}

export function discActions(family) {
  const q = Math.PI / 2;
  return family === 'cadran' ? [q, -q, 2 * q] : [q / 2, -q / 2, q, -q, 2 * q, -2 * q];
}

// le film d'un disque dressé
export function simulateDisc(maze, spec) {
  const world = createWorld(maze);
  const turn = spec.turn;
  const actions = discActions(spec.family);
  // état de départ canonique : la bille au repos dans la rigole, en bas, puis
  // un retour (la poche la soulève, elle rentre) ; l'angle d'arrêt devient
  // l'angle de départ du film
  const rr = maze.topo === 'polar' ? maze.race.mid.r : maze.race.mid.hy;
  let ball = newBall(0, -rr);
  const pre = returnRun(world, ball, 0, turn, undefined, null, spec.family === 'cadran' ? Math.PI / 2 : 0);
  const home = pre.phi;
  let start = { ...ball, q: [0, 0, 0, 1] };
  for (let iter = 0; iter < 4; iter++) {
    const seqA = searchDisc(world, start, home, actions);
    if (!seqA) throw new Error('aucune suite de rotations ne mène à la sortie');
    // le film : pause, rotations (chacune suivie de l'arrêt de la bille et d'une courte pause), retour
    const T = new Track();
    const b = { ...start, q: [...start.q], cn: null };
    let phi = home;
    const pause = (sec) => { const g = discGravity(phi); for (let i = 0; i < sec / PHYS.dt; i++) { step(world, b, g); if (i % PHYS.rec === 0) T.push(b, phi, 0); } };
    pause(spec.pauseIn ?? 0.8);
    for (const d of seqA) {
      T.ev.push(['turn', T.n, d]);
      const r = rotate(world, b, phi, d, T);
      phi = r.phi;
      pause(0.35);
    }
    T.ev.push(['exit', T.n]);
    pause(0.25);
    const ret = returnRun(world, b, phi, turn, home, T);
    phi = ret.phi; // (la pause finale se lit à l'angle d'arrivée)
    T.ev.push(['home', T.n]);
    pause(spec.pauseOut ?? 0.6);
    const err = Math.hypot(b.x - start.x, b.y - start.y);
    const dphi = ret.phi - home;
    if (err < 0.05 || iter === 3) {
      return { track: T, moves: seqA, home, turns: Math.round(dphi / TAU), err, end: { x: b.x, y: b.y }, q: b.q, world };
    }
    start = { ...b, vx: 0, vy: 0, q: [0, 0, 0, 1], cn: null, t: 0, still: 0, hits: 0 };
  }
  return null;
}

// ── Le film complet d'un labyrinthe, raccordé ────────────────────────────────
// Renvoie la piste à 120 i/s : position et orientation de la bille dans le
// repère du plateau, angles de l'appareil (Plateau : α, β ; disques : φ, Ω).
export function simulateFilm(maze, spec) {
  if (spec.family === 'plateau') {
    let start = null, q = null, res = null;
    for (let iter = 0; iter < 4; iter++) {
      res = simulatePlateau(maze, { ...spec, start, q: null });
      const e = res.end;
      if (start && Math.hypot(e.x - start.x, e.y - start.y) < 0.03) break;
      start = { x: e.x, y: e.y };
    }
    return close(res.track.out({ family: 'plateau', moves: null, turns: 0, events: res.track.ev }), res.track, 0);
  }
  const res = simulateDisc(maze, spec);
  return close(res.track.out({ family: spec.family, moves: res.moves, turns: res.turns, events: res.track.ev }), res.track, res.turns * TAU);
}

// raccord : l'écart final (bille au repos) fondu sur la dernière demi-seconde ;
// l'orientation propre de la bille corrigée en douceur sur toute la boucle
// (une rotation résiduelle répartie sur 30 à 60 s : invisible)
function close(o, T, dA) {
  const n = o.n, m = Math.min(n - 1, Math.round(o.rate * 0.5));
  const dx = o.x[0] - o.x[n - 1], dy = o.y[0] - o.y[n - 1];
  for (let i = n - m; i < n; i++) {
    const t = (i - (n - m)) / (m - 1 || 1), s = t * t * (3 - 2 * t);
    o.x[i] += dx * s; o.y[i] += dy * s;
  }
  // orientation : q(i) ← q(i)·slerp(1, q(n−1)⁻¹·q(0), i/n) — sans saut au raccord
  const q0 = [...o.q.slice(0, 4)], qn = [...o.q.slice(4 * (n - 1), 4 * n)];
  const inv = [-qn[0], -qn[1], -qn[2], qn[3]];
  let D = qmul(inv, q0); // q(n−1)·D = q(0)
  if (D[3] < 0) D = D.map((v) => -v);
  const ang = 2 * Math.acos(Math.min(1, D[3])), s = Math.sin(ang / 2) || 1;
  const ax = [D[0] / s, D[1] / s, D[2] / s];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), h = (ang * t) / 2, R = [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)];
    const qi = qmul([o.q[4 * i], o.q[4 * i + 1], o.q[4 * i + 2], o.q[4 * i + 3]], R);
    o.q.set(qi, 4 * i);
  }
  // l'angle de l'appareil : la fin vaut le début plus un nombre entier de tours
  o.a[n - 1] = o.a[0] + dA;
  o.duration = (n - 1) / o.rate;
  o.residual = Math.hypot(dx, dy);
  o.spin = ang;
  return o;
}

// ── Une scène : un labyrinthe dont le film a la bonne longueur ───────────────
// Le labyrinthe de la graine d'abord ; s'il ne donne pas un bon film (bille
// bloquée, trop peu ou trop de coups), le suivant (graine~1, graine~2…) : la
// scène reste déterminée par la graine.
export function planScene(spec, onProgress = null, buildMazeFn) {
  let lastErr = null;
  for (let attempt = 0; attempt < 14; attempt++) {
    onProgress?.(attempt / 14);
    const sp = { ...spec, seed: attempt ? `${spec.seed}~${attempt}` : spec.seed };
    try {
      const maze = buildMazeFn(sp);
      const film = simulateFilm(maze, sp);
      const ok = spec.family === 'plateau'
        ? film.duration >= 14 && film.duration <= 52
        : film.moves.length >= 4 && film.moves.length <= 12 && film.duration <= 52;
      if (ok && film.residual < 0.2) return { maze, film, attempt };
      lastErr = new Error(`film hors gabarit (${film.duration.toFixed(1)} s, ${film.moves?.length ?? '-'} coups)`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('aucun labyrinthe');
}
