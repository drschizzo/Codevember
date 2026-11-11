// Invariants du cœur : labyrinthes, physique de la bille, film et raccord,
// mécanique, caméra. Sans navigateur : node --test labyrinth/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaze, wallDistance, DIM } from '../src/gen/maze.js';
import { planScene, TILT_MAX, SERVO_RATE } from '../src/gen/plan.js';
import { createWorld } from '../src/gen/physics.js';
import { COVE } from '../src/gen/build.js';
import { layout, plateauPose, sampleFilm, cameraPath, discMatrix, discFrame, pulleyCenter, mat, vec } from '../src/kin.js';
import { generate, sceneSpec } from '../src/recipe.js';

const SEEDS = { plateau: ['a1', 'b2', 'k11'], cadran: ['a1', 'e5'], roue: ['b2', 'c3'] };
const scenes = [];
for (const [family, seeds] of Object.entries(SEEDS)) for (const seed of seeds) {
  const R = generate(seed, { family, mood: 'cabinet' });
  const { maze, film } = planScene(sceneSpec(R), null, buildMaze);
  scenes.push({ family, seed, R, maze, film, L: layout(maze, family) });
}

test('le labyrinthe est un arbre couvrant : un seul chemin entre deux cellules', () => {
  for (const { maze, seed } of scenes) {
    const N = maze.cells.length;
    let E = 0;
    maze.links.forEach((l) => { E += l.length; });
    assert.equal(E / 2, N - 1, `${seed} : ${E / 2} passages pour ${N} cellules`);
    const seen = new Set([0]), q = [0];
    while (q.length) for (const v of maze.links[q.pop()]) if (!seen.has(v)) { seen.add(v); q.push(v); }
    assert.equal(seen.size, N, `${seed} : non connexe`);
  }
});

test('Wilson tire les arbres couvrants uniformément (les 4 arbres d’un carré, à parts égales)', () => {
  // grille 2 × 2 : 4 arbres couvrants ; 4 000 tirages, chacun doit sortir ~1 000 fois
  const counts = new Map();
  for (let i = 0; i < 4000; i++) {
    const m = buildMaze({ topo: 'grid', nx: 2, ny: 2, c: 22, seed: `u${i}`, family: 'plateau' });
    const k = m.links.map((l, a) => l.filter((b) => b > a).map((b) => `${a}${b}`)).flat().sort().join('|');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 4);
  for (const c of counts.values()) assert.ok(Math.abs(c - 1000) < 120, `écart ${c}`);
});

test('toute porte et tout passage laissent passer la bille', () => {
  for (const { maze, seed } of scenes) {
    const W = createWorld(maze);
    for (let a = 0; a < maze.cells.length; a++) for (const b of maze.links[a]) {
      if (b < a) continue;
      // le point le plus étroit d'un passage est au milieu de la frontière
      const A = maze.cells[a], B = maze.cells[b];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      assert.ok(W.clearance(mx, my) > 0.5 || W.clearance(A.x, A.y) > 0.5, `${seed} : passage ${a}–${b} trop étroit`);
    }
  }
});

test('la bille ne traverse jamais une paroi, à aucun instant de la boucle', () => {
  for (const { maze, film, seed, family } of scenes) {
    const W = createWorld(maze);
    let worst = Infinity;
    for (let i = 0; i < film.n; i++) worst = Math.min(worst, W.clearance(film.x[i], film.y[i]));
    assert.ok(worst > -0.06, `${family} ${seed} : la bille entre de ${(-worst).toFixed(3)} mm dans une paroi`);
  }
});

test('témoin : une bille posée dans une paroi est vue par le banc', () => {
  const { maze } = scenes[0];
  const W = createWorld(maze);
  const w = maze.walls.find((x) => x.t === 'seg' && x.role === 'maze');
  assert.ok(W.clearance((w.ax + w.bx) / 2, (w.ay + w.by) / 2) < -DIM.ball);
});

test('le congé au pied des parois taillées reste sous la bille qui les touche', () => {
  // à la hauteur z, le congé déborde de COVE − √(COVE² − (COVE − z)²) ; la bille
  // au contact (centre à hw + rb de l'axe) occupe √(rb² − (rb − z)²) vers la paroi
  for (let z = 0; z <= COVE; z += 0.01) {
    const cove = COVE - Math.sqrt(Math.max(0, COVE * COVE - (COVE - z) ** 2));
    const ball = Math.sqrt(Math.max(0, DIM.ball ** 2 - (DIM.ball - z) ** 2));
    assert.ok(cove + ball <= DIM.ball + 1e-9, `z = ${z.toFixed(2)} : ${(cove + ball - DIM.ball).toFixed(3)} mm`);
  }
});

test('la boucle se referme : état final = état initial (bille, appareil, tours entiers)', () => {
  for (const { film, seed, family } of scenes) {
    const n = film.n;
    assert.ok(Math.hypot(film.x[n - 1] - film.x[0], film.y[n - 1] - film.y[0]) < 1e-4, `${seed} position`);
    const turns = (film.a[n - 1] - film.a[0]) / (2 * Math.PI);
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `${seed} : ${turns} tours`);
    if (family === 'plateau') assert.ok(Math.abs(film.b[n - 1] - film.b[0]) < 1e-9 && Math.abs(film.a[n - 1]) < 1e-9);
    // orientation propre : raccord continu
    const q0 = film.q.slice(0, 4), q1 = film.q.slice(4 * (n - 1));
    const d = Math.abs(q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3]);
    assert.ok(d > 1 - 1e-6, `${seed} : orientation ${d}`);
  }
});

test('continuité image par image : aucun saut de la bille ni de l’appareil', () => {
  for (const { film, seed } of scenes) {
    for (let i = 1; i < film.n; i++) {
      const dx = Math.hypot(film.x[i] - film.x[i - 1], film.y[i] - film.y[i - 1]);
      assert.ok(dx < 20, `${seed} : saut de ${dx.toFixed(1)} mm à l’image ${i}`); // (< 2,4 m/s)
      assert.ok(Math.abs(film.a[i] - film.a[i - 1]) < 0.05, `${seed} : l’appareil saute à l’image ${i}`);
    }
  }
});

test('Plateau : inclinaison ≤ 5,5°, vitesse des servomoteurs bornée', () => {
  for (const { film, seed, family } of scenes) {
    if (family !== 'plateau') continue;
    for (let i = 0; i < film.n; i++) {
      assert.ok(Math.abs(film.a[i]) <= TILT_MAX + 1e-9 && Math.abs(film.b[i]) <= TILT_MAX + 1e-9, seed);
      if (i) assert.ok(Math.abs(film.a[i] - film.a[i - 1]) * film.rate <= SERVO_RATE * 1.001 && Math.abs(film.b[i] - film.b[i - 1]) * film.rate <= SERVO_RATE * 1.001, `${seed} : servomoteur trop rapide`);
    }
  }
});

test('Plateau : la bille ne part pas avant que le plateau ne s’incline (cause avant l’effet)', () => {
  for (const { film, seed, family } of scenes) {
    if (family !== 'plateau') continue;
    for (let i = 1; i < film.n; i++) {
      if (Math.abs(film.a[i]) > 1e-4 || Math.abs(film.b[i]) > 1e-4) break;
      assert.ok(Math.hypot(film.x[i] - film.x[0], film.y[i] - film.y[0]) < 0.01, `${seed} : la bille bouge sur un plateau à plat`);
    }
  }
});

test('Plateau : les bielles gardent leur longueur, les manivelles leur course', () => {
  for (const { film, L, seed, family } of scenes) {
    if (family !== 'plateau') continue;
    for (let i = 0; i < film.n; i += 7) {
      const P = plateauPose(L, film.a[i], film.b[i]);
      for (const m of P.motors) {
        assert.ok(Math.abs(vec.len(vec.sub(m.P, m.C)) - L.Lr) < 1e-6, `${seed} : bielle`);
        assert.ok(Math.abs(m.g) < 1.2, `${seed} : manivelle à ${(m.g * 57.3).toFixed(0)}°`);
        // le maneton reste au-dessus du socle, la rotule sous la dalle
        assert.ok(m.C[1] - 6 > L.plinth.h + 2, `${seed} : la bielle touche le socle`);
      }
      // le dessous de la dalle (au bord, là où elle penche le plus) reste au-dessus des carters
      const o = mat.apply(P.B, [0, -16, 0]), nrm = vec.norm(vec.sub(mat.apply(P.B, [0, 1, 0]), mat.apply(P.B, [0, 0, 0])));
      const under = (x, z) => o[1] - (nrm[0] * (x - o[0]) + nrm[2] * (z - o[2])) / nrm[1];
      for (const m of L.motors) for (const t of [-(L.motorLen + 10), 0]) {
        const x = m.M[0] + m.axis[0] * t, z = m.M[2] + m.axis[2] * t;
        assert.ok(under(x, z) - (m.M[1] + L.motorR * 1.04) > 3, `${seed} : la dalle frôle le moteur ${m.name}`);
      }
    }
  }
});

test('Disques : le plateau tourne loin du socle, du moteur et du chevalet', () => {
  for (const { L, seed, family } of scenes) {
    if (family === 'plateau') continue;
    const F = discFrame(L);
    // le point le plus bas du plateau balayé (rayon Rout), au-dessus du socle et de la poulie
    const lowest = F.C[1] - L.Rout * Math.cos(L.back);
    assert.ok(lowest > L.base.h + 10, `${seed} : le plateau frôle le socle`);
    const pc = pulleyCenter(L);
    assert.ok(L.Dm > L.Rv + L.rp + 10, `${seed} : poulie dans le volant`);
    // la poulie est sous le bord du plateau (dans son plan, distance au centre > Rout + rp)
    assert.ok(L.Dm >= L.Rout + L.rp + 10, `${seed} : poulie derrière le plateau`);
    assert.ok(pc[1] - L.rp > L.base.h, `${seed} : poulie dans le socle`);
  }
});

test('Disques : le film est une suite de rotations, puis le retour par la poche', () => {
  for (const { film, seed, family } of scenes) {
    if (family === 'plateau') continue;
    assert.ok(film.moves.length >= 4 && film.moves.length <= 12, `${seed} : ${film.moves.length} coups`);
    const ev = film.events.map((e) => e[0]);
    assert.equal(ev[ev.length - 1], 'home');
    assert.ok(ev.includes('exit'));
  }
});

test('caméra : périodique, lente, sans à-coups (120 i/s)', () => {
  for (const { film, L, R, seed, maze } of scenes) {
    const C = cameraPath({ layout: L, film }, R);
    const T = film.duration, dt = 1 / 120, n = Math.round(T / dt);
    const p0 = C.pose(0), p1 = C.pose(1 - 1e-12);
    assert.ok(vec.len(vec.sub(p0.pos, p1.pos)) < 1e-6, `${seed} : raccord de la caméra`);
    let prevDir = null, prevW = 0, maxW = 0, maxA = 0;
    for (let i = 0; i <= n; i++) {
      const p = C.pose((i * dt) / T);
      const dir = vec.norm(vec.sub(p.target, p.pos));
      if (prevDir) {
        const w = Math.acos(Math.min(1, vec.dot(dir, prevDir))) / dt;
        maxW = Math.max(maxW, w);
        if (i > 1) maxA = Math.max(maxA, Math.abs(w - prevW) / dt);
        prevW = w;
      }
      prevDir = dir;
    }
    assert.ok((maxW * 180) / Math.PI < 25, `${seed} : ${((maxW * 180) / Math.PI).toFixed(1)}°/s`);
    assert.ok((maxA * 180) / Math.PI < 400, `${seed} : ${((maxA * 180) / Math.PI).toFixed(0)}°/s²`);
  }
});
