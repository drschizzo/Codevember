// Invariants du cœur : horloge, corrosion, machines, caméra, raccord.
//   node --test rust/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, CLIMATES } from '../src/recipe.js';
import { tauAt, rainAt, wetAt, overcastAt } from '../src/timeline.js';
import { buildPiece } from '../src/gen/pieces.js';
import { corrosionField } from '../src/gen/corrosion.js';
import { laserPlan, laserHead, laserCleanTime, frontAt, turnPlan, turnS, turnAngle, turnCleanS, turnAccess, impactY, nozzleY, JET_COS, bathPlan, bathOffset, bathClean, bathRinsed, rinseY, TAU } from '../src/machines.js';
import { cameraPath, cameraStats } from '../src/camera.js';
import { FAMILIES } from '../src/gen/pieces.js';

const SEEDS = ['a1', 'b7', 'k3', 'z9'];
const cache = new Map();
function scene(seed, machine, family) {
  const k = `${seed}:${machine}:${family}`;
  if (cache.has(k)) return cache.get(k);
  const R = generate(seed, { machine, ...(family ? { family } : {}) });
  const P = buildPiece({ family: R.piece.family, params: R.piece.params, seed: R.seed });
  const C = corrosionField(P.body, { seed: R.seed, lite: true });
  const v = { R, P, C };
  cache.set(k, v);
  return v;
}

test('horloge : τ monotone, 0 avant la première averse, 1 après la dernière, constant pendant le décapage', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    let prev = -1;
    for (let i = 0; i <= 2000; i++) { const u = i / 2000, t = tauAt(R, u); assert.ok(t >= prev - 1e-12, `τ recule en ${u}`); prev = t; }
    assert.equal(tauAt(R, R.timing.showers[0][0] - 1e-4), 0);
    assert.ok(Math.abs(tauAt(R, R.timing.rain1) - 1) < 1e-9);
    assert.ok(Math.abs(tauAt(R, 0.999) - 1) < 1e-9);
    // la pluie et l'eau ne viennent que pendant les averses ; rien pendant le décapage
    for (let u = R.timing.setup0; u < 1; u += 0.001) assert.equal(rainAt(R, u), 0);
    for (let u = R.timing.clean0; u < 1; u += 0.001) assert.ok(wetAt(R, u) < 0.02, `pièce mouillée en ${u}`);
    // la lumière et la pluie suivent la même horloge : il pleut quand le ciel est couvert
    for (let u = 0; u < 1; u += 0.001) if (rainAt(R, u) > 0.5) assert.ok(overcastAt(R, u) > 0.7);
  }
});

test('raccord : l\'horloge est identique en 0 et en 1', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    for (const f of [rainAt, wetAt, overcastAt]) assert.ok(Math.abs(f(R, 0) - f(R, 1 - 1e-9)) < 1e-6);
    assert.equal(tauAt(R, 0), 0);
  }
});

test('corrosion : la rouille commence dans les creux et au pied des rivets, plus tard sur les faces dégagées', () => {
  const { C } = scene('a1', 'laser', 'noeud');
  const pr = C.probe, crev = [], open = [];
  const { data, dims, lo, vox } = C.field;
  const at = (p) => { const i = [0, 1, 2].map((k) => Math.floor((p[k] - lo[k]) / vox)); return data[((i[2] * dims[1] + i[1]) * dims[0] + i[0]) * 4] / 255; };
  for (let i = 0; i < pr.length; i += 8) {
    const p = [pr[i], pr[i + 1], pr[i + 2]], tow = pr[i + 7];
    if (pr[i + 6] === 2) continue;
    (tow > 0.85 ? crev : tow < 0.45 ? open : []).push(at(p));
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(crev.length > 50 && open.length > 50);
  assert.ok(mean(crev) < mean(open) - 0.1, `creux ${mean(crev).toFixed(2)} / faces ${mean(open).toFixed(2)}`);
});

test('laser : chaque point atteint est décapé quand la ligne passe sur lui, une seule fois, pendant le décapage', () => {
  for (const fam of Object.keys(FAMILIES)) {
    const { R, P, C } = scene('b7', 'laser', fam);
    const plan = laserPlan(R, C.front, P.info.lo, P.info.hi);
    const pr = C.probe;
    let reached = 0;
    for (let i = 0; i < pr.length; i += 8) {
      const p = [pr[i], pr[i + 1], pr[i + 2]], n = [pr[i + 3], pr[i + 4], pr[i + 5]];
      const t = laserCleanTime(plan, C.front, p, n);
      if (t === Infinity) continue;
      reached++;
      assert.ok(t >= R.timing.clean0 - 1e-9 && t <= R.timing.clean1 + 1e-9, `${fam} : instant hors fenêtre ${t}`);
      // à l'instant du décapage, la ligne de balayage est sur le point (contact exact)
      const h = laserHead(plan, t);
      assert.equal(h.on, 1);
      assert.ok(Math.abs(h.x - p[0]) < 1e-6, `${fam} : la tête est en ${h.x}, le point en ${p[0]}`);
      assert.ok(Math.abs(h.y - p[1]) <= plan.w / 2 + 1e-6);
      // juste avant, la ligne n'y est pas encore (écart positif)
      const hb = laserHead(plan, t - 0.002);
      assert.ok(!(hb.on && Math.abs(hb.x - p[0]) < 1e-9 && Math.abs(hb.y - p[1]) <= plan.w / 2), `${fam} : déjà décapé avant`);
    }
    assert.ok(reached / (pr.length / 8) > 0.15, `${fam} : trop peu de points atteints (${(reached / (pr.length / 8)).toFixed(2)})`);
    // la tête : continue (pas de saut) et dans le cadre de la pièce
    let prev = laserHead(plan, R.timing.clean0);
    for (let u = R.timing.clean0; u <= R.timing.clean1; u += 1e-5) {
      const h = laserHead(plan, u);
      assert.ok(Math.hypot(h.x - prev.x, h.y - prev.y) < 0.02, `${fam} : saut de la tête en ${u}`);
      prev = h;
    }
  }
});

test('sablage : le plateau fait un nombre entier de tours ; la buse atteint chaque point quand il passe devant elle, à sa hauteur', () => {
  for (const fam of Object.keys(FAMILIES)) {
    const { R, P, C } = scene('k3', 'sablage', fam);
    const plan = turnPlan(R, C.radial, P.info.lo, P.info.hi);
    assert.ok(Number.isInteger(plan.N));
    const th1 = turnAngle(plan, turnS(R, 0.999999)), th0 = turnAngle(plan, turnS(R, 0));
    assert.ok(Math.abs(Math.cos(th1) - Math.cos(th0)) < 1e-6 && Math.abs(Math.sin(th1) - Math.sin(th0)) < 1e-6);
    assert.ok((plan.yTop - plan.yBot) / plan.N <= plan.foot * 0.75 + 1e-9, 'le pas de l\'hélice dépasse l\'empreinte');
    const pr = C.probe;
    let reached = 0;
    for (let i = 0; i < pr.length; i += 8) {
      const p = [pr[i], pr[i + 1], pr[i + 2]], n = [pr[i + 3], pr[i + 4], pr[i + 5]];
      const s = turnCleanS(plan, C.dirs, p, n);
      if (s === Infinity) continue;
      reached++;
      assert.ok(s >= 0 && s <= 1 + 1e-9, `${fam} : s* = ${s}`);
      // à s*, la face entre dans le champ des jets (azimut d'accès tourné jusqu'à
      // la rampe), avec une incidence utile, et le jet frappe à sa hauteur
      const ph = turnAccess(plan, C.dirs, p, n), az = ph + turnAngle(plan, s);
      const d = Math.atan2(Math.sin(az - plan.az), Math.cos(az - plan.az));
      assert.ok(Math.abs(d) < 1e-6, `${fam} : écart d'azimut ${d}`);
      const a = plan.az - turnAngle(plan, s), jet = [-Math.cos(plan.tilt) * Math.cos(a), -Math.sin(plan.tilt), -Math.cos(plan.tilt) * Math.sin(a)];
      const inc = -(n[0] * jet[0] + n[1] * jet[1] + n[2] * jet[2]);
      // (au moins l'incidence utile, ou la meilleure possible pour une face rasante)
      const best = Math.cos(plan.tilt) * Math.hypot(n[0], n[2]) + Math.sin(plan.tilt) * n[1];
      if (Math.hypot(n[0], n[2]) > 0.45) assert.ok(inc > Math.min(JET_COS, best) - 0.02, `${fam} : incidence ${inc.toFixed(2)}`);
      // (le jet incliné frappe plus bas que la rampe ; un point plus haut que le
      // premier passage est pris au premier tour)
      const yi = impactY(plan, p, ph);
      if (yi < plan.yTop - plan.foot / 2) assert.ok(Math.abs(nozzleY(plan, s) - yi) <= plan.foot / 2 + 1e-6, `${fam} : hors de l'empreinte`);
    }
    assert.ok(reached / (pr.length / 8) > 0.15, `${fam} : trop peu de points atteints (${(reached / (pr.length / 8)).toFixed(2)})`);
  }
});

test('bain : la pièce descend toute entière sous le niveau, remonte, et ressort décapée', () => {
  for (const fam of Object.keys(FAMILIES)) {
    const { R, P } = scene('z9', 'bain', fam);
    const plan = bathPlan(R, P.info.lo, P.info.hi, P.info.lifts, P.info.hook);
    const U = plan.u;
    assert.ok(P.info.hi[1] + bathOffset(plan, (U.down1 + U.up0) / 2) < plan.L, 'le haut de la pièce reste hors du bain');
    assert.ok(P.info.lo[1] + plan.rest > 0.05, 'au repos, la pièce touche le sol');
    assert.ok(Math.abs(bathOffset(plan, 0) - bathOffset(plan, 0.999999)) < 1e-9);
    // monotone : descend puis remonte
    let prev = bathOffset(plan, U.down0);
    for (let u = U.down0; u <= U.down1; u += 1e-4) { const o = bathOffset(plan, u); assert.ok(o <= prev + 1e-12); prev = o; }
    for (let u = U.up0; u <= U.up1; u += 1e-4) { const o = bathOffset(plan, u); assert.ok(o >= prev - 1e-12); prev = o; }
    // à la fin, tout point est décapé ; avant la remontée, aucun
    for (const y of [P.info.lo[1], (P.info.lo[1] + P.info.hi[1]) / 2, P.info.hi[1]]) {
      assert.ok(bathClean(plan, [0, y, 0], U.up1 + 0.001));
      assert.ok(!bathClean(plan, [0, y, 0], U.up0 - 0.001));
      // la boue : rincée quand la rampe passe sous le point, toute rincée à la fin
      assert.ok(!bathRinsed(plan, [0, y, 0], U.rinse0 - 0.001));
      assert.ok(bathRinsed(plan, [0, y, 0], U.rinse1 + 0.001));
    }
    // la rampe : entoure la pièce (en plan, dans la fosse), balaie de son
    // sommet à son pied en descendant, revient se garer ; jamais sur le couvercle
    const g = plan.ring, T = plan.tank;
    assert.ok(g.hx - g.r > (P.info.hi[0] - P.info.lo[0]) / 2 + 0.02 && g.hz - g.r > (P.info.hi[2] - P.info.lo[2]) / 2 + 0.02, `${fam} : la rampe touche la pièce`);
    assert.ok(g.hx + g.r < T.hx && g.hz + g.r < T.hz, `${fam} : la rampe déborde de la fosse`);
    assert.ok(g.top > P.info.hi[1] + plan.rest + 0.05 && g.bot < P.info.lo[1] + plan.rest);
    let py = rinseY(plan, U.rinse0);
    for (let u = U.rinse0; u <= U.rinse1; u += 1e-4) { const y = rinseY(plan, u); assert.ok(y <= py + 1e-12); py = y; }
    for (let u = 0; u < 1; u += 1e-3) assert.ok(rinseY(plan, u) - g.r > 0.075, `${fam} : la rampe descend sur le couvercle en ${u}`);
    assert.ok(Math.abs(rinseY(plan, 0) - rinseY(plan, 0.999999)) < 1e-9);
  }
});

test('caméra : lente, lisse, périodique ; jamais sous le sol', () => {
  for (const s of SEEDS) for (const m of ['laser', 'sablage', 'bain']) {
    const { R, P } = scene(s, m);
    const box = { lo: P.info.lo, hi: P.info.hi };
    const path = cameraPath(R, { box, focus: (u) => (u > 0.5 && u < 0.9 ? [0.3 * Math.sin(u * 40), P.info.hi[1] * (0.9 - u) * 2, 0] : null) });
    const st = cameraStats(path, R.loop.duration);
    assert.ok(st.wMax < 25, `${s}/${m} : pointe à ${st.wMax.toFixed(1)}°/s`);
    assert.ok(st.aMax < 3, `${s}/${m} : accélération ${st.aMax.toFixed(2)}`);
    const a = path.at(0), b = path.at(1 - 1e-9);
    assert.ok(Math.hypot(...a.pos.map((v, k) => v - b.pos[k])) < 1e-4);
    for (let u = 0; u < 1; u += 0.01) assert.ok(path.at(u).pos[1] > 0.2);
  }
});

test('recette : déterministe, JSON, toutes les humeurs, pièces, machines et climats tirés', () => {
  const seen = { mood: new Set(), family: new Set(), machine: new Set(), climate: new Set() };
  for (let i = 0; i < 400; i++) {
    const R = generate(`s${i}`);
    seen.mood.add(R.mood); seen.family.add(R.family); seen.machine.add(R.machine.kind); seen.climate.add(R.climate);
    if (i < 20) assert.deepEqual(JSON.parse(JSON.stringify(R)), generate(`s${i}`));
  }
  assert.equal(seen.mood.size, Object.keys(MOODS).length);
  assert.equal(seen.family.size, Object.keys(FAMILIES).length);
  assert.equal(seen.machine.size, 3);
  assert.equal(seen.climate.size, Object.keys(CLIMATES).length);
});

test('direction artistique : lampes presque blanches, humeurs différentes par le décor, la lumière et la valeur', () => {
  const lum = (hex) => { const c = parseInt(hex.slice(1), 16); return (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255; };
  for (const [k, M] of Object.entries(MOODS)) assert.ok(M.key.K >= 4700, `${k} : lampe trop chaude`);
  const floors = new Set(Object.values(MOODS).map((M) => M.floor));
  assert.equal(floors.size, Object.keys(MOODS).length, 'deux humeurs ont le même sol');
  const vals = Object.values(MOODS).map((M) => lum(M.bg));
  assert.ok(Math.min(...vals) < 0.05 && Math.max(...vals) > 0.75, 'il faut au moins une humeur très sombre et une très claire');
  const hard = Object.values(MOODS).filter((M) => M.key.penumbra < 0.3).length, soft = Object.values(MOODS).filter((M) => M.key.penumbra > 0.9).length;
  assert.ok(hard >= 1 && soft >= 2, 'lumières dures et douces');
});

test('rien ne se traverse : machines et pièce à tous les instants', async () => {
  const { buildMachine } = await import('../src/gen/machinery.js');
  const { laserRig } = await import('../src/machines.js');
  for (const fam of Object.keys(FAMILIES)) {
    // laser : la tête reste devant la pièce, et au-dessus quand le portique passe
    {
      const { R, P, C } = scene('b7', 'laser', fam);
      const plan = laserPlan(R, C.front, P.info.lo, P.info.hi);
      const M = buildMachine({ kind: 'laser', lo: P.info.lo, hi: P.info.hi, zHead: plan.zHead });
      for (let u = 0; u < 1; u += 0.0005) {
        const g = laserRig(R, plan, u, P.info.hi[1], M.info.zb);
        const headFront = g.z + plan.zHead; // (face avant de la tête)
        const overPiece = headFront < P.info.hi[2] + 0.05;
        if (overPiece) assert.ok(g.y - 0.07 > P.info.hi[1] + 0.05, `${fam} : la tête traverse la pièce en ${u.toFixed(4)}`);
        else assert.ok(headFront > P.info.hi[2] + 0.1 - 1e-9 || g.y - 0.07 > P.info.hi[1], `${fam} : tête trop près en ${u.toFixed(4)}`);
        // la traverse et les colonnes restent hors de la pièce
        assert.ok(M.info.beamY > P.info.hi[1] + 0.3 && M.info.half > Math.max(-P.info.lo[0], P.info.hi[0]) + 0.3);
      }
    }
    // sablage : la buse reste hors du cylindre balayé par la pièce
    {
      const { R, P, C } = scene('k3', 'sablage', fam);
      const plan = turnPlan(R, C.radial, P.info.lo, P.info.hi);
      const M = buildMachine({ kind: 'sablage', lo: P.info.lo, hi: P.info.hi, rMax: plan.rMax, platen: 0.3, tilt: plan.tilt, foot: plan.foot });
      const tip = M.info.Rc - M.info.reach;
      assert.ok(tip - Math.sin(plan.tilt) * 0.0 > plan.rMax + 0.1, `${fam} : buse à ${tip.toFixed(2)} pour une pièce de rayon ${plan.rMax.toFixed(2)}`);
      assert.ok(M.info.Rp > plan.rMax && M.info.Rc - 0.12 > M.info.Rp, `${fam} : colonne sur le plateau`);
      // la rampe (aussi large que la pièce) ne pivote qu'au-dessus d'elle, et
      // la colonne est assez haute pour la porter
      assert.ok(plan.yTop - 0.03 > P.info.hi[1] + 0.03, `${fam} : la rampe pivote dans la pièce`);
      assert.ok(M.info.H > plan.yTop + 0.3 + 0.1, `${fam} : colonne trop courte`);
      assert.ok(Math.abs(M.info.Rc - M.info.reach - plan.Rn) < 1e-9, `${fam} : buses hors de leur place`);
    }
    // bain : la pièce reste dans la fosse (marges) et au-dessus de son fond
    {
      const { R, P } = scene('z9', 'bain', fam);
      const plan = bathPlan(R, P.info.lo, P.info.hi, P.info.lifts, P.info.hook);
      const T = plan.tank;
      assert.ok(P.info.lo[0] > T.cx - T.hx + 0.05 && P.info.hi[0] < T.cx + T.hx - 0.05 && P.info.lo[2] > T.cz - T.hz + 0.08 && P.info.hi[2] < T.cz + T.hz - 0.08);
      for (let u = 0; u < 1; u += 0.001) assert.ok(P.info.lo[1] + bathOffset(plan, u) > -T.depth + 0.05, `${fam} : la pièce touche le fond en ${u}`);
    }
  }
});

test('lien partagé : une recette retouchée se relit à l\'identique', async () => {
  const { upgrade } = await import('../src/recipe.js');
  for (const s of SEEDS) {
    const R = generate(s);
    R.rust.pits = 30; R.camera.fov = 28;
    const back = upgrade(JSON.parse(JSON.stringify(R)));
    assert.deepEqual(back, R);
  }
});

test('aucune pièce ne flotte : chaque élément touche le sol de proche en proche', async () => {
  const { floatingGroups } = await import('../src/gen/audit.js');
  for (const fam of Object.keys(FAMILIES)) for (const s of ['a1', 'b7', 'k3']) {
    const R = generate(s, { family: fam });
    const P = buildPiece({ family: fam, params: R.piece.params, seed: s });
    const A = floatingGroups([['pièce', P.body], ['support', P.stand]]);
    assert.equal(A.groups.length, 0, `${fam}/${s} : ${JSON.stringify(A.groups)}`);
  }
});

test('les élingues ne traversent pas la pièce', () => {
  for (const fam of Object.keys(FAMILIES)) for (const s of ['a1', 'b7']) {
    const R = generate(s, { family: fam });
    const P = buildPiece({ family: fam, params: R.piece.params, seed: s });
    const pos = P.body.position, I = P.info;
    const segs = I.spreader ? I.lifts.map((L) => [L, [L[0], I.hook[1] - 0.5, L[2]]]) : I.lifts.map((L) => [L, I.hook]);
    for (const [A, B] of segs) {
      const d = B.map((v, k) => v - A[k]), len = Math.hypot(...d);
      for (let i = 0; i < pos.length; i += 3) {
        const v = [pos[i] - A[0], pos[i + 1] - A[1], pos[i + 2] - A[2]], t = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / (len * len);
        if (t * len < 0.07 || t > 1) continue;
        const q = v.map((x, k) => x - d[k] * t);
        assert.ok(Math.hypot(...q) >= 0.025, `${fam}/${s} : l'élingue passe à ${Math.hypot(...q).toFixed(3)} m de la pièce`);
      }
    }
  }
});
