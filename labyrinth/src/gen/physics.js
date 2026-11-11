// Physique de la bille : une sphère pleine qui roule sans glisser sur le fond
// du plateau, dans le repère du plateau (mm, s). Module pur.
//
// Roulement sans glissement sur un plan qui tourne à Ω autour de sa normale
// (Weltner 1979, dans le repère inertiel : dv/dt = 5/7·F/m + 2/7·(Ω̇×x + Ω×v)).
// Ramené dans le repère du plateau (J : rotation d'un quart de tour) :
//
//   a = 5/7·(g∥ + Ω²·x − Ω̇·J·x) − 12/7·Ω·J·v
//
// g∥ est la gravité projetée dans le plan du plateau (repère du plateau). Pour
// le plateau qui bascule de quelques degrés, Ω = 0 et les termes d'inertie de
// la bascule (< 2 % de la gravité motrice) sont négligés.
//
// Contacts : capsules, arcs épaissis, poteaux, cadre (wallDistance de maze.js,
// la même fonction que le rendu et les tests) ; choc à restitution e, contact
// au repos sans rebond, frottement de la bille qui glisse contre la paroi
// (son point de contact équatorial glisse à la vitesse de la bille),
// résistance au roulement.
import { DIM, wallDistance, wallBounds } from './maze.js';

export const PHYS = {
  g: 9810,          // mm/s²
  e: 0.38,          // restitution contre une paroi
  eMin: 25,         // mm/s : en dessous, contact au repos (pas de rebond)
  muWall: 0.12,     // frottement contre la paroi
  muRoll: 0.0035,   // résistance au roulement (bille d'acier sur bois verni)
  dt: 1 / 960,      // pas de temps (8 pas par image enregistrée à 120 i/s)
  rec: 8,
};

// monde : parois classées en cases (requête locale), cadre testé à part
export function createWorld(maze) {
  const rb = DIM.ball, cs = 14;
  const walls = maze.walls;
  const always = [], boxed = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  walls.forEach((w, i) => { const b = wallBounds(w); if (!b) always.push(i); else { boxed.push([i, b]); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); } });
  x0 -= cs; y0 -= cs; x1 += cs; y1 += cs;
  const nx = Math.ceil((x1 - x0) / cs), ny = Math.ceil((y1 - y0) / cs);
  const bins = Array.from({ length: nx * ny }, () => []);
  const m = rb + 1;
  for (const [i, b] of boxed) {
    const i0 = Math.max(0, Math.floor((b[0] - m - x0) / cs)), i1 = Math.min(nx - 1, Math.floor((b[2] + m - x0) / cs));
    const j0 = Math.max(0, Math.floor((b[1] - m - y0) / cs)), j1 = Math.min(ny - 1, Math.floor((b[3] + m - y0) / cs));
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) bins[j * nx + ii].push(i);
  }
  const empty = [];
  return {
    maze, walls, always,
    near(x, y) {
      const i = Math.floor((x - x0) / cs), j = Math.floor((y - y0) / cs);
      return i < 0 || j < 0 || i >= nx || j >= ny ? empty : bins[j * nx + i];
    },
    // distance (au bord de la bille) à la paroi la plus proche
    clearance(x, y) {
      let best = Infinity;
      for (const i of this.near(x, y)) best = Math.min(best, wallDistance(walls[i], x, y));
      for (const i of always) best = Math.min(best, wallDistance(walls[i], x, y));
      return best - rb;
    },
  };
}

export const newBall = (x, y) => ({ x, y, vx: 0, vy: 0, q: [0, 0, 0, 1], t: 0, still: 0, hits: 0 });

const C = { d: 0, nx: 0, ny: 0 };
// un pas : env = { gx, gy (gravité dans le plan), gn (composante normale, ≥ 0),
// W (Ω), dW (Ω̇) } ; renvoie l'intensité du choc le plus fort (mm/s)
export function step(world, b, env, dt = PHYS.dt) {
  const rb = DIM.ball, { walls } = world;
  const W = env.W ?? 0, dW = env.dW ?? 0;
  // partie lisse (gravité, inertie du plateau qui tourne) : intégrée au point
  // milieu (second ordre) — en Euler, un tour de bille sur un plateau tournant
  // dérivait de 25 mm au pas de 1/960 s
  const acc = (x, y, vx, vy) => [(5 / 7) * (env.gx + W * W * x + dW * y) + (12 / 7) * W * vy, (5 / 7) * (env.gy + W * W * y - dW * x) - (12 / 7) * W * vx];
  const [a0x, a0y] = acc(b.x, b.y, b.vx, b.vy);
  const mvx = b.vx + a0x * dt / 2, mvy = b.vy + a0y * dt / 2;
  let [ax, ay] = acc(b.x + b.vx * dt / 2, b.y + b.vy * dt / 2, mvx, mvy);
  // contacts au repos (de l'image précédente) : la paroi reprend la poussée
  // vers elle, et freine la bille qui glisse contre elle
  const sp = Math.hypot(b.vx, b.vy);
  if (b.cn) for (const [nx, ny] of b.cn) {
    const an = ax * nx + ay * ny;
    if (an < 0) {
      ax -= an * nx; ay -= an * ny;
      if (sp > 1e-6) { const f = (5 / 7) * PHYS.muWall * -an; ax -= (f * b.vx) / sp; ay -= (f * b.vy) / sp; }
    }
  }
  // résistance au roulement (seuil : une bille arrêtée sur une pente plus
  // douce que l'angle de roulement reste arrêtée)
  const rr = PHYS.muRoll * (env.gn ?? PHYS.g);
  if (sp > 0.5) { ax -= (rr * b.vx) / sp; ay -= (rr * b.vy) / sp; }
  else if (Math.hypot(ax, ay) < rr) { ax = 0; ay = 0; b.vx = 0; b.vy = 0; }
  const vx0 = b.vx, vy0 = b.vy;
  b.vx += ax * dt; b.vy += ay * dt;
  if (env.damp) { const k = 1 - env.damp * dt; b.vx *= k; b.vy *= k; } // (amortissement visqueux : gorge, air)
  b.x += 0.5 * (vx0 + b.vx) * dt; b.y += 0.5 * (vy0 + b.vy) * dt;

  // chocs et contacts : deux passes (coins, jonctions)
  let hit = 0;
  b.cn = null;
  for (let pass = 0; pass < 2; pass++) {
    const near = world.near(b.x, b.y);
    for (let k = 0; k < near.length + world.always.length; k++) {
      const w = walls[k < near.length ? near[k] : world.always[k - near.length]];
      wallDistance(w, b.x, b.y, C);
      const pen = rb - C.d;
      if (pen <= 0) continue;
      b.x += C.nx * pen; b.y += C.ny * pen;
      const vn = b.vx * C.nx + b.vy * C.ny;
      if (vn < 0) {
        const j = -vn > PHYS.eMin ? (1 + PHYS.e) * -vn : -vn;
        b.vx += j * C.nx; b.vy += j * C.ny;
        // frottement du choc sur la composante tangente
        const tx = -C.ny, ty = C.nx, vt = b.vx * tx + b.vy * ty;
        const dvt = Math.min(Math.abs(vt), 0.25 * PHYS.muWall * j) * Math.sign(vt);
        b.vx -= dvt * tx; b.vy -= dvt * ty;
        hit = Math.max(hit, -vn);
      }
      (b.cn ??= []).push([C.nx, C.ny]);
    }
  }
  if (hit > PHYS.eMin) b.hits++;
  // rotation propre (roulement : ω = n × v / r, n normale du fond)
  const wx = -b.vy / rb, wy = b.vx / rb, ang = Math.hypot(wx, wy) * dt;
  if (ang > 1e-9) {
    const s = Math.sin(ang / 2) / (ang / dt), dq = [wx * s, wy * s, 0, Math.cos(ang / 2)];
    b.q = qmul(dq, b.q);
  }
  b.t += dt;
  b.still = Math.hypot(b.vx, b.vy) < 1.5 ? b.still + dt : 0;
  return hit;
}

export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
