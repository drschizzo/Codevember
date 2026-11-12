// La simulation de référence (gen/sim.js) sur une petite grille : conservation,
// positivité, déterminisme, et les gestes attendus de chaque famille.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/gen/sim.js';
import { familySpec, initialTerrain, TABLE, b0At, longProfile, crossProfile, layerAt, hardnessAt } from '../src/gen/table.js';

const NX = 96, NY = 48;
const strata = [{ bottom: 0.005, hard: 0.1 }, { bottom: 0.009, hard: 0.7 }, { bottom: 0.02, hard: 0.1 }, { bottom: 1, hard: 0.2 }];
function run(family, until, spec = {}) {
  const S = familySpec(family, spec); S.seed = 3;
  const b0 = initialTerrain(S.form, NX, NY, 3);
  const sim = createSim({ NX, NY, b0, strata, S });
  const V0 = sim.sandVolume();
  sim.runTo(Math.min(until, S.T));
  return { sim, S, b0, V0 };
}

test('le sable se conserve : ce qui manque est sorti par le déversoir', () => {
  for (const f of ['delta', 'ravines']) {
    const { sim, V0, S } = run(f, 12);
    const lost = V0 - sim.sandVolume(), out = sim.st.outSand * S.morfac;
    assert.ok(Math.abs(lost - out) < 1e-6 + 1e-3 * Math.abs(out), `${f} : perdu ${lost * 1e6} cm³, sorti ${out * 1e6} cm³`);
  }
});

test('l’eau se conserve (entrées − sorties) et reste positive, sans NaN', () => {
  const { sim } = run('delta', 8);
  const bal = sim.st.inWater - sim.st.outWater;
  assert.ok(Math.abs(sim.waterVolume() - bal) < 1e-6 + 1e-3 * Math.abs(bal), `${sim.waterVolume()} ≠ ${bal}`);
  for (let i = 0; i < sim.d.length; i++) { assert.ok(sim.d[i] >= 0); assert.ok(Number.isFinite(sim.b[i]) && Number.isFinite(sim.s[i])); }
});

test('déterministe : même spécification, même relief', () => {
  const a = run('ravines', 3).sim, b = run('ravines', 3).sim;
  assert.deepEqual(Array.from(a.b), Array.from(b.b));
});

test('le delta : l’amont se creuse, le lac se comble', () => {
  const { sim, b0 } = run('delta', 18);
  let up = 0, down = 0;
  const l = TABLE.Lx / NX;
  for (let j = 0; j < NY; j++) for (let i = 1; i < NX - 2; i++) {
    const x = (i + 0.5) * l, db = sim.b[j * NX + i] - b0[j * NX + i];
    if (x < 0.5) up += Math.min(0, db); else if (x > 0.78) down += Math.max(0, db);
  }
  assert.ok(up < -1e-4 && down > 1e-4, `amont ${up}, aval ${down}`);
});

test('les ravines : l’escarpement se creuse plus vite que le plateau (par unité de surface)', () => {
  const { sim, b0 } = run('ravines', 6);
  const l = TABLE.Lx / NX;
  const cut = (x0, x1) => { let s = 0; for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX; i++) { const x = (i + 0.5) * l; if (x >= x0 && x < x1) s += Math.max(0, b0[j * NX + i] - sim.b[j * NX + i]); } return s / (x1 - x0); };
  assert.ok(cut(0.52, 0.66) > cut(0.1, 0.3), 'l’érosion part de l’escarpement');
});

test('la brèche : le lac se vide par l’échancrure, la digue est entaillée', () => {
  const { sim, b0, S } = run('breche', 24);
  const l = TABLE.Lx / NX, i = Math.round(S.form.xd / l), j = Math.round(S.form.notchY / l);
  assert.ok(b0[j * NX + i] - sim.b[j * NX + i] > 0.004, `entaille ${(b0[j * NX + i] - sim.b[j * NX + i]) * 1000} mm`);
});

test('strates : la couche et la dureté suivent la profondeur sous la surface de départ', () => {
  assert.equal(layerAt(strata, 0.001), 0);
  assert.equal(layerAt(strata, 0.007), 1);
  assert.ok(Math.abs(hardnessAt(strata, 0.007) - 0.7) < 1e-9);
  assert.ok(hardnessAt(strata, 0.005) > 0.1 && hardnessAt(strata, 0.005) < 0.7); // (frontière adoucie)
});

test('la surface de départ est celle que dessine la lame (à la micro-topographie près)', () => {
  for (const f of ['delta', 'recul', 'ravines', 'breche']) {
    const { form } = familySpec(f);
    for (let k = 0; k < 400; k++) {
      const x = (k % 20) / 20 * TABLE.Lx, y = Math.floor(k / 20) / 20 * TABLE.Ly;
      const gap = b0At(form, x, y, 7) - (longProfile(form, x) + crossProfile(form, y));
      assert.ok(Math.abs(gap) <= 1.2 * (form.rough ?? 0.0006), `${f} (${x}, ${y}) : écart ${gap}`);
    }
  }
});
