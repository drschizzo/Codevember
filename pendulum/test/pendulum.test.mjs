// Invariants du cœur : dynamique, transitions, film, ralenti.
//   node --test 'pendulum/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { systemOf } from '../src/gen/machines.js';
import { rk4Step, rkWork } from '../src/gen/dynamics.js';
import { solveMove } from '../src/gen/plan.js';
import { buildFilm, movesOf, slowWindow, physTime, physRate, codeAngles, tremor } from '../src/film.js';
import { clearance } from '../src/gen/clearance.js';
import { planShots } from '../src/camera.js';

const FAMS = ['cart', 'rotary', 'acrobat', 'wheel'];

test('sans commande, l’énergie de la chaîne se conserve (contrôle de l’intégrateur)', () => {
  for (const family of FAMS) {
    const R = generate('e1', { family });
    const sys = systemOf(R.machine);
    const x = new Float64Array(sys.nx);
    for (let k = 0; k < sys.np; k++) { x[k] = 0.4 + 0.7 * k; x[sys.np + k] = 1.2 - k; }
    const E0 = sys.energy(x), w = rkWork(sys.nx);
    for (let i = 0; i < 2000; i++) rk4Step(sys, x, 0, 0, 0.001, w);
    const E1 = sys.energy(x);
    assert.ok(Math.abs(E1 - E0) < 1e-6 * (1 + Math.abs(E0)), `${family} : ${E0} → ${E1}`);
  }
});

test('les équilibres sont des équilibres (accélération nulle au repos, commande nulle)', () => {
  for (const family of FAMS) {
    const R = generate('e2', { family });
    const sys = systemOf(R.machine), n = R.machine.links.length, out = new Float64Array(sys.nx);
    for (let k = 0; k < 1 << n; k++) {
      const code = Array.from({ length: n }, (_, i) => ((k >> i) & 1 ? 'U' : 'D')).join('');
      sys.f(sys.restState(codeAngles(code)), 0, out);
      for (let j = 0; j < sys.nx; j++) assert.ok(Math.abs(out[j]) < 1e-9, `${family} ${code}`);
    }
  }
});

// une graine par famille (et la chaîne triple), résolue une fois
const SEEDS = [['t1', 'cart'], ['t2', 'rotary'], ['t3', 'acrobat'], ['t4', 'wheel']];
const solved = SEEDS.map(([seed, family]) => {
  const R = generate(seed, { family });
  const res = movesOf(R).map((m) => solveMove(R, m.i));
  return { R, res };
});
{
  // chaîne triple : forcée
  const R = generate('t5', { family: 'cart' });
  if (R.machine.links.length < 3) { R.machine.links.push({ ...R.machine.links[1] }); R.film = { seq: ['DDD', 'UUU'], moves: [{ T: 3, signs: [1, 1, 1], slow: { k: 0.5, span: 0.35 } }, { T: 3, signs: [1, 1, 1], slow: null }], holds: [2, 3] }; R.machine.rail.half = 0.85; }
  solved.push({ R, res: movesOf(R).map((m) => solveMove(R, m.i)) });
}

test('chaque transition part au repos et arrive au repos sur son équilibre, la machine revenue', () => {
  for (const { R, res } of solved) {
    const sys = systemOf(R.machine);
    res.forEach((r, i) => {
      assert.ok(r.ok, `${R.seed} ${R.family} transition ${i}`);
      const mv = movesOf(R)[i], tab = r.tab, nx = tab.nx;
      const first = tab.X.subarray(0, nx), last = tab.X.subarray((tab.M - 1) * nx, tab.M * nx);
      const th1 = mv.th0.map((t, j) => (mv.turn ? t + r.signs[j] * 2 * Math.PI : mv.from[j] === mv.to[j] ? t : t + r.signs[j] * Math.PI));
      const X0 = sys.restState(mv.th0), X1 = sys.restState(th1);
      for (let k = 0; k < nx; k++) {
        assert.ok(Math.abs(first[k] - X0[k]) < 1e-5, `départ ${k}`);
        assert.ok(Math.abs(last[k] - X1[k]) < 1e-4, `${R.family} arrivée ${k} : ${last[k]} ≠ ${X1[k]}`);
      }
      assert.equal(tab.U[0], 0); assert.equal(tab.U[tab.M - 1], 0); // (le moteur part et s'arrête sans saut d'accélération)
    });
  }
});

test('la boucle se referme exactement (u = 0 et u → 1), les tenues sont immobiles', () => {
  for (const { R, res } of solved) {
    const sys = systemOf(R.machine);
    const F = buildFilm(R, sys, res.map((r) => r.tab));
    const a = F.at(0), b = F.at(1 - 1e-9);
    const wrap = (d) => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    a.theta.forEach((t, i) => assert.ok(wrap(t - b.theta[i]) < 1e-5, `${R.family} θ${i}`));
    assert.ok(R.family === 'acrobat' ? wrap(a.s - b.s) < 1e-5 : Math.abs(a.s - b.s) < 1e-5);
    // continuité aux raccords tenue → transition → tenue (angles à 2π près)
    for (const st of F.steps) {
      const e = 1e-7 / F.duration;
      const u0 = st.t0 / F.duration, u1 = (st.t0 + st.dur) / F.duration;
      for (const u of [u0, u1]) {
        const p = F.at(u - e), q = F.at(u + e);
        p.theta.forEach((t, i) => assert.ok(wrap(t - q.theta[i]) < 1e-4, `${R.family} raccord ${st.kind} θ${i}`));
        // (l'angle du coude ne compte qu'à 2π près, comme ceux des maillons)
        assert.ok(R.family === 'acrobat' ? wrap(p.s - q.s) < 1e-4 : Math.abs(p.s - q.s) < 1e-4, `${R.family} raccord s ${p.s} ${q.s}`);
      }
    }
  }
});

test('corrections d’équilibre : seulement pendant une tenue debout, nulles aux raccords, de l’ordre du millimètre', () => {
  for (const { R, res } of solved) {
    const sys = systemOf(R.machine);
    const F = buildFilm(R, sys, res.map((r) => r.tab));
    const wrap = (d) => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    let seen = 0;
    for (let k = 0; k <= 4000; k++) {
      const u = k / 4000, a = F.at(u), b = tremor(R, { ...F.at(u) });
      const dth = Math.max(...a.theta.map((t, i) => wrap(t - b.theta[i]))), ds = Math.abs(a.s - b.s);
      if (a.step.kind !== 'hold' || !R.film.seq[a.step.i].includes('U')) assert.ok(dth === 0 && ds === 0, `${R.family} hors tenue debout`);
      assert.ok(dth < 0.01 && ds < (R.family === 'cart' ? 0.005 : 0.2), `${R.family} amplitude ${dth} ${ds}`);
      if (dth > 1e-3) seen++;
    }
    assert.ok(seen > 0 || !R.film.seq.some((c) => c.includes('U')), `${R.family} : aucune correction visible`);
    for (const st of F.steps) {
      for (const u of [st.t0 / F.duration, (st.t0 + st.dur) / F.duration]) {
        const a = F.at(u), b = tremor(R, { ...F.at(u) });
        a.theta.forEach((t, i) => assert.ok(wrap(t - b.theta[i]) < 1e-9, `${R.family} raccord θ${i}`));
        assert.ok(Math.abs(a.s - b.s) < 1e-9, `${R.family} raccord s`);
      }
    }
  }
});

test('découpage : boucle exacte, plans sans saut, raccords francs, caméra calme et au-dessus du sol', () => {
  const V = () => ({ set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  for (const { R, res } of solved) {
    const F = buildFilm(R, systemOf(R.machine), res.map((r) => r.tab));
    const sumL = R.machine.links.reduce((a, L) => a + L.l, 0);
    const P = planShots(R, F, { w: 2, h: R.machine.height + sumL, H: R.machine.height, sumL });
    assert.ok(P.shots.length >= 2 && P.shots.length <= 5, `${R.family} : ${P.shots.length} plans`);
    for (const s of P.shots) assert.ok(s.t1 - s.t0 > 2, `${R.family} : plan de ${(s.t1 - s.t0).toFixed(2)} s`);
    const at = (u) => P.at(u, 1.6, { position: V(), target: V() });
    const a = at(0), b = at(1 - 1e-9);
    assert.ok(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) < 1e-6, `${R.family} : raccord de boucle`);
    const N = 6000, dt = F.duration / N;
    let prev = at(0), cuts = 0;
    for (let i = 1; i <= N; i++) {
      const c = at(i / N);
      assert.ok(c.position.y >= 0.27, `${R.family} : objectif à ${c.position.y.toFixed(2)} m`);
      if (c.shot !== prev.shot) { cuts++; prev = c; continue; }
      // dans un plan : l'objectif et la visée se déplacent de moins d'un
      // quart de la distance de prise de vue par seconde
      const d = Math.hypot(c.position.x - c.target.x, c.position.y - c.target.y, c.position.z - c.target.z);
      const v = Math.hypot(c.position.x - prev.position.x, c.position.y - prev.position.y, c.position.z - prev.position.z) / dt / d;
      const w = Math.hypot(c.target.x - prev.target.x, c.target.y - prev.target.y, c.target.z - prev.target.z) / dt / d;
      assert.ok(v < 0.25 && w < 0.25, `${R.family} : caméra trop vive (${v.toFixed(2)}, ${w.toFixed(2)} /s) à u = ${(i / N).toFixed(3)}`);
      prev = c;
    }
    assert.equal(cuts, P.shots.length === 1 ? 0 : P.shots.length, `${R.family} : un raccord par plan`);
  }
});

test('ralenti : temps physique continu, croissant, qui couvre exactement la transition', () => {
  for (const k of [0.4, 0.55, 0.7]) {
    const T = 2.6, W = slowWindow(T, 1.9, { k, span: 0.35 });
    assert.ok(W);
    let prev = -1;
    for (let i = 0; i <= 4000; i++) {
      const t = (i / 4000) * W.F, p = physTime(t, W, T);
      assert.ok(p >= prev - 1e-12, 'croissant');
      if (i) assert.ok(p - prev < (W.F / 4000) * 1.0001 + 1e-12, 'vitesse ≤ 1');
      prev = p;
    }
    assert.ok(Math.abs(physTime(W.F, W, T) - T) < 1e-9);
    assert.ok(Math.abs(physRate((W.a + W.b) / 2 + W.r / 2, W) - k) < 1e-9, 'vitesse κ au cœur du ralenti');
  }
});

test('la course reste dans le rail, l’accélération dans les moyens du moteur', () => {
  for (const { R, res } of solved) {
    if (R.family !== 'cart') continue;
    for (const r of res) {
      const np = r.tab.nx / 2 - 1;
      for (let m = 0; m < r.tab.M; m++) assert.ok(Math.abs(r.tab.X[m * r.tab.nx + 2 * np]) <= R.machine.rail.half - 0.06 + 1e-9);
    }
  }
});

test('aucun contact sur toute la boucle : maillons contre bâti, sol, pièces mobiles et entre eux', () => {
  for (const { R, res } of solved) {
    const F = buildFilm(R, systemOf(R.machine), res.map((r) => r.tab));
    for (const wood of [false, true]) {
      const { hits, minGap } = clearance(R.machine, F, { wood });
      assert.equal(hits.length, 0, `${R.seed} ${R.family} : ${JSON.stringify(hits.slice(0, 2))}`);
      assert.ok(minGap > 0.002, `${R.family} : jeu ${minGap}`);
    }
  }
});

test('témoin négatif : la même chaîne reculée dans son support est vue', () => {
  for (const { R, res } of solved) {
    const F = buildFilm(R, systemOf(R.machine), res.map((r) => r.tab));
    const { hits } = clearance(R.machine, F, { zShift: R.family === 'rotary' ? 0 : -0.06, n: 60 });
    if (R.family !== 'rotary') assert.ok(hits.length > 0, `${R.family} : le banc ne voit rien`);
  }
});
