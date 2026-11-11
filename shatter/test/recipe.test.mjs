// Invariants de Shatter, vérifiés sans navigateur : node --test 'shatter/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, CLEAR, pieceSpec, loopDuration } from '../src/recipe.js';
import { SETS } from '../src/finishes.js';
import { GLASSES } from '../src/glasses.js';
import { FORMS, shellSurface } from '../src/gen/forms.js';
import { PH, GRAV, DISH, physTime, fragmentPoint, fragmentCenter, landing, spinAngle, inflation, floorH } from '../src/cycle.js';
import { fracture } from '../src/gen/fracture.js';
import { openEdges } from '../tools/bench-fracture.mjs';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette, en JSON pur', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
  const R = generate('json');
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur est tirée ; verres, sols et formes existent', () => {
  const seen = new Set(SEEDS.map((s) => generate(s).mood));
  for (const m of Object.keys(MOODS)) assert.ok(seen.has(m), `humeur jamais tirée : ${m}`);
  for (const [m, M] of Object.entries(MOODS)) {
    for (const g of M.glasses) assert.ok(GLASSES[g], `${m} : verre ${g}`);
    assert.ok(SETS[M.floor.set], `${m} : sol ${M.floor.set}`);
  }
});

test('direction artistique : deux pièces qui se suivent diffèrent en tout ; pas de cristal sur fond blanc', () => {
  let forms = 0, glasses = 0, mechs = 0;
  for (const s of SEEDS) {
    const R = generate(s), N = R.pieces.length;
    for (let k = 0; k < N; k++) {
      const A = R.pieces[k], B = R.pieces[(k + 1) % N];
      assert.notEqual(A.form, B.form, `${s} : même forme ${k}→${(k + 1) % N}`);
      assert.notEqual(A.glass, B.glass, `${s} : même verre ${k}→${(k + 1) % N}`);
      if (k < N - 1) assert.notEqual(A.mech, B.mech, `${s} : même mécanisme`);
      if (k < N - 1) assert.ok(!(CLEAR.has(A.glass) && CLEAR.has(B.glass)), `${s} : deux verres clairs de suite`);
      if (MOODS[R.mood].light) assert.ok(!['cristal', 'dichroique'].includes(A.glass));
    }
    forms += new Set(R.pieces.map((p) => p.form)).size; glasses += new Set(R.pieces.map((p) => p.glass)).size; mechs += new Set(R.pieces.map((p) => p.mech)).size;
  }
  // variété d'une graine à l'autre : toutes les formes, tous les verres et mécanismes sortent
  const all = (k) => new Set(SEEDS.flatMap((s) => generate(s).pieces.map((p) => p[k])));
  assert.equal(all('form').size, Object.keys(FORMS).length);
  assert.equal(all('glass').size, Object.keys(GLASSES).length);
  assert.equal(all('mech').size, 4);
  assert.ok(forms > 0 && glasses > 0 && mechs > 0);
});

test('décors : sept humeurs qui diffèrent par la valeur, la lumière et le cadrage, pas seulement par la teinte', () => {
  const lum = (h) => { const c = parseInt(h.slice(1), 16); return ((c >> 16 & 255) * 0.2126 + (c >> 8 & 255) * 0.7152 + (c & 255) * 0.0722) / 255; };
  const M = Object.values(MOODS);
  assert.ok(M.length >= 7);
  assert.ok(M.filter((m) => lum(m.bg) > 0.6).length >= 2, 'au moins deux décors clairs');
  assert.ok(M.filter((m) => lum(m.bg) < 0.05).length >= 2, 'au moins deux décors sombres');
  const sig = M.map((m) => `${lum(m.bg) > 0.5}|${m.key.el[0] < 0.6 ? 'rasante' : m.key.el[0] > 1.25 ? 'zénithale' : 'haute'}|${m.key.pen < 0.2 ? 'dure' : m.key.pen > 0.8 ? 'douce' : 'moyenne'}|${m.cam.height[0] > 2 ? 'plongée' : m.cam.height[1] < 0.8 ? 'basse' : 'mi'}|${m.floor.set}|${m.prop ?? ''}`);
  assert.equal(new Set(sig).size, M.length, `deux décors trop semblables : ${sig.join(' / ')}`);
});

test('pièces : des constructions de verrier (pied, anses, bouchon, fil, modelés) sortent toutes', () => {
  const all = SEEDS.flatMap((s) => generate(s).pieces);
  for (const p of ['anse', 'anses2', 'bouchon', 'fil']) assert.ok(all.some((P) => P.parts.includes(p)), `partie jamais tirée : ${p}`);
  for (const d of ['cotes', 'torse', 'lobes', 'feston', 'godrons']) assert.ok(all.some((P) => P.decor === d), `modelé jamais tiré : ${d}`);
  assert.ok(all.some((P) => ['verre', 'flute', 'tazza'].includes(P.form)));
  assert.ok(all.filter((P) => P.fil).length > all.length * 0.1);
  // une pièce à anse et bouchon est d'un seul tenant (surface sans NaN, posée au sol)
  const s = shellSurface({ form: 'carafe', size: 2, parts: ['anse', 'bouchon'], decor: 'torse', decorN: 16, decorAmp: 0.04, twist: 0.5 });
  assert.ok(s.pos.every(Number.isFinite) && s.nor.every(Number.isFinite));
  // posée sur la cuvette : aucun sommet dessous, et au moins un qui la touche
  let gap = Infinity;
  for (let i = 0; i < s.pos.length; i += 3) gap = Math.min(gap, s.pos[i + 1] - floorH(Math.hypot(s.pos[i], s.pos[i + 2])));
  assert.ok(Math.abs(gap) < 1e-9, `posée sur la sole (écart ${gap})`);
});

test('temps : la caméra rapide ralentit autour du choc puis revient au temps réel, sans jamais reculer', () => {
  const slow = { k: 16, pre: -0.09, plat: 2, post: 1 }, Ts = 12, t0 = PH.rupture * Ts;
  let prev = -Infinity;
  for (let i = 0; i <= 2400; i++) { const l = (i / 2400) * Ts, p = physTime(l, Ts, slow); assert.ok(p >= prev - 1e-12); prev = p; }
  const rate = (l) => (physTime(l + 1e-4, Ts, slow) - physTime(l, Ts, slow)) / 1e-4;
  assert.ok(rate(t0 - 0.05) > 0.999 && rate(t0) > 0.8, 'le choc arrive en temps réel (rien ne s’approche au ralenti)');
  assert.ok(Math.abs(rate(t0 + 0.2) - 1 / 16) < 1e-3, 'puis ralenti ×16 aussitôt');
  assert.ok(Math.abs(rate(2) - 1) < 1e-6 && Math.abs(rate(Ts - 1) - 1) < 1e-6, 'temps réel ailleurs');
  // le plateau tourne pendant le soufflage et s'arrête avant le choc
  const P = { angle0: 0.3, spin: 0.8 };
  assert.ok(Math.abs(spinAngle(P, t0, Ts) - spinAngle(P, Ts, Ts)) < 1e-12);
  assert.ok(spinAngle(P, 2, Ts) !== spinAngle(P, 1, Ts));
});

const R0 = generate('fracture-test');
const specs = ['ball', 'resonance', 'tempered', 'thermal'].map((mech, i) => ({ ...pieceSpec(R0, 0), mech, seed: `ft${i}`, form: ['vase', 'bol', 'cloche', 'bouteille'][i], parts: [], rays: 11, aspect: 0.6, ringStep: 0.5, crush: 0.035, strips: 10, elong: 0.22, dice: 150, pieces: 10 }));
const fr = specs.map((s) => fracture(s));

test('fracture : des éclats fermés, nombreux pour la bille et la trempe, peu pour le choc thermique', () => {
  const [ball, res, temp, therm] = fr;
  assert.ok(ball.frags.length >= 60, `bille : ${ball.frags.length}`);
  assert.ok(res.frags.length >= 12, `résonance : ${res.frags.length}`);
  assert.ok(temp.frags.length >= 100, `trempe : ${temp.frags.length}`);
  assert.ok(therm.frags.length >= 5 && therm.frags.length <= 20, `choc : ${therm.frags.length}`);
  for (const r of fr) {
    const edges = r.mesh.index.length / 2;
    assert.ok(openEdges(r) / edges < 0.002, `arêtes ouvertes : ${openEdges(r)} / ${edges}`);
    for (const k of ['position', 'normal', 'rigA', 'rigB', 'rigC', 'rigD']) assert.ok(r.mesh[k].every(Number.isFinite), `${k} : NaN`);
  }
});

test('fracture : près de l’impact, éclats plus petits et plus rapides ; le pendule frappe à l’horizontale', () => {
  const ball = fr[0], O = ball.origin, near = [], far = [];
  for (const F of ball.frags) (Math.hypot(F.c[0] - O[0], F.c[1] - O[1], F.c[2] - O[2]) < 0.35 ? near : far).push(F);
  const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
  assert.ok(near.length && far.length);
  assert.ok(mean(near, (F) => F.area) < mean(far, (F) => F.area));
  assert.ok(mean(near, (F) => Math.hypot(...F.v)) > mean(far, (F) => Math.hypot(...F.v)));
  assert.ok(Math.abs(ball.dir[1]) < 1e-9);
});

test('gravité : chaque éclat tombe, touche la sole, s’y arrête, se couche et ne la traverse pas', () => {
  const Ts = 12, slow = { k: 16, pre: -0.09, plat: 2, post: 1 };
  for (const r of fr) {
    const rest = r.thickness / 2;
    for (const F of r.frags.slice(0, 40)) {
      const tL = landing(F, rest);
      assert.ok(tL >= 0 && tL < 1.5, `atterrissage ${tL}`);
      // au sol : à la hauteur de la cuvette
      const c = fragmentCenter(F, tL + 2, rest).c;
      assert.ok(Math.abs(c[1] - (floorH(Math.hypot(c[0], c[2])) + rest)) < 1e-9);
      // en vol : parabole (accélération g)
      const y = (t) => fragmentCenter(F, t, rest).c[1], h = 1e-3, tm = tL / 2;
      if (tL > 0.01) assert.ok(Math.abs((y(tm + h) - 2 * y(tm) + y(tm - h)) / (h * h) + GRAV) < 1e-2);
      // aucun sommet de l'éclat sous la sole, à aucun instant (pas seulement son centre)
      const P = r.mesh.position, [a, b] = F.range;
      for (const l of [0.45, 0.52, 0.55, 0.62, 0.75, 0.86, 0.95].map((f) => f * Ts)) for (let i = a; i < b; i += 7) {
        const p = fragmentPoint(F, [P[3 * i], P[3 * i + 1], P[3 * i + 2]], l, { Ts, slow, rest });
        assert.ok(p[1] >= floorH(Math.hypot(p[0], p[2])) - 1e-6, `sommet sous la sole à ${l.toFixed(2)} s`);
      }
      assert.ok(F.tm >= PH.melt * Ts && F.tm < Ts);
      // au repos, l'éclat est posé, pas écrasé : sans la sécurité du shader (qui
      // remonte les sommets sous la sole), aucun ne passerait dessous de plus de 1,5 cm
      let worst = 0;
      for (let i = a; i < b; i += 3) { const p = fragmentPoint(F, [P[3 * i], P[3 * i + 1], P[3 * i + 2]], 0.79 * Ts, { Ts, slow, rest, clampFloor: false }); worst = Math.min(worst, p[1] - floorH(Math.hypot(p[0], p[2]))); }
      assert.ok(worst > -0.12, `éclat enfoncé dans la sole de ${(-worst).toFixed(3)} u`);
    }
  }
  assert.ok(DISH > 0 && floorH(20) < 0.31 && inflation(0, 0, 12) === 0 && inflation(1, PH.acc * 12, 12) === 1);
});

test('cause et effet : l’outil touche le point d’impact exactement au choc, jamais avant', async () => {
  const { pendulum, hammer, resonanceAmp, torchOn } = await import('../src/kinematics.js');
  const Ts = 12, t0 = PH.rupture * Ts, O = [0.3, 1.1, -0.6], nh = [0.6, 0, -0.8];
  for (const f of [pendulum, hammer]) {
    assert.ok(Math.abs(f(O, nh, 0, t0, Ts).gap) < 1e-9, `${f.name} : contact au choc`);
    for (const tp of [-0.3, -0.1, -0.03, -0.01, -0.002]) assert.ok(f(O, nh, tp, t0 + tp, Ts).gap > 0, `${f.name} : contact avant le choc (${tp})`);
  }
  // le haut-parleur est au plus fort au choc ; la flamme brûle juste avant le choc thermique
  assert.ok(resonanceAmp(t0, Ts) === 1 && resonanceAmp(t0 - 3, Ts) < 0.1);
  assert.ok(torchOn(t0 - 0.3, Ts) > 0.9 && torchOn(t0 + 0.5, Ts) < 0.05);
});
