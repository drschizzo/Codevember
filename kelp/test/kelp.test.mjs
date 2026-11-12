// Invariants du cœur (sans navigateur) : node --test 'kelp/test/*.test.mjs'
// Une scène allégée entière est construite une fois (comme dans le worker),
// puis on vérifie la mer, les laminaires, le raccord, la cause et l'effet.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { buildScene, BOX } from '../src/gen/scene.js';
import { simulateSea, makeProfile, sampleField } from '../src/gen/sea.js';
import { bakeRock, sampler, makePools } from '../src/gen/rock.js';
import { FAMILIES } from '../src/gen/kelp.js';
import { cameraPose } from '../src/camera.js';

const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * (m / 1024) * 2 ** -14 : s * 2 ** (e - 15) * (1 + m / 1024); };

let R, S, Hc, sea;
before(() => {
  R = generate('test1', { mood: 'ploumanach', family: 'digitata' });
  S = buildScene(R, { lite: true });
  const pools = makePools(R.seed, { x0: -1.6, x1: 3, z0: -8, z1: 2 }, R.rock.pools);
  const rock = bakeRock({ type: R.rock.type, seed: R.rock.seed, profile: R.sea.profile, box: BOX, M: 640, pools, rock: { amp: R.rock.amp, dip: R.rock.dip } });
  Hc = sampler(rock, rock.Hc);
  sea = simulateSea({ T: R.loop.duration, x0: -9, x1: 10, dx: 0.025, profile: R.sea.profile, waves: R.sea.waves, manning: R.sea.manning, fps: 60, loops: 2 });
});

// position d'un nœud (texture demi-flottante, relative à l'ancre de sa plante)
const P = (f, i) => {
  const K = S.kelp, o = (f * K.n + i) * 4;
  return [fromHalf(K.pos[o]), fromHalf(K.pos[o + 1]), fromHalf(K.pos[o + 2])];
};

test('la mer : orbite périodique (état à T = état à 0), hauteur jamais négative', () => {
  const [dh, dq] = sea.stats.residual[sea.stats.residual.length - 1];
  assert.ok(dh < 1e-3 && dq < 1e-2, `raccord de la mer ${dh} m, ${dq} m²/s`);
  for (let k = 0; k < sea.eta.length; k++) assert.ok(sea.eta[k] >= sea.b[k % sea.nx] - 0.003, 'hauteur négative');
});

test('la mer : le grand retrait découvre le platier, la grande vague le recouvre', () => {
  const prof = makeProfile(R.sea.profile), x = -1.5;
  const w3 = R.sea.waves[2];
  const before = Math.min(...[4, 3, 2, 1.5, 1, 0.6, 0.3].map((d) => sampleField(sea, sea.eta, x, w3.t - d) - prof(x))), at = Math.max(...[0, 0.5, 1, 1.5, 2].map((d) => sampleField(sea, sea.eta, x, w3.t + d) - prof(x)));
  assert.ok(before < 0.05, `platier découvert avant la grande vague (${before.toFixed(3)} m)`);
  assert.ok(at > 0.35, `grande vague sur le platier (${at.toFixed(3)} m)`);
});

test('les laminaires : aucun nœud sous la roche, à aucun instant', () => {
  const K = S.kelp, anchors = K.plants;
  // (l'ancre de chaque nœud : celle de la plante, retrouvée par la géométrie des lanières)
  const plantOf = new Int32Array(K.n).fill(-1);
  const sg = K.straps;
  for (let v = 0; v < sg.count; v++) for (let c = 0; c < 4; c++) plantOf[sg.nidx[v * 4 + c]] = sg.anch[v * 4 + 3] >= 0 ? anchors.findIndex((a) => a[0] === sg.anch[v * 4] && a[2] === sg.anch[v * 4 + 2]) : -1;
  let worst = 0;
  for (let f = 0; f < K.nf; f += 3) for (let i = 0; i < K.n; i++) {
    const p = plantOf[i]; if (p < 0) continue;
    const q = P(f, i), x = q[0] + anchors[p][0], y = q[1] + anchors[p][1], z = q[2] + anchors[p][2];
    worst = Math.max(worst, Hc(x, z) - y);
  }
  assert.ok(worst < 0.012, `un nœud passe ${(worst * 100).toFixed(1)} cm sous la roche`);
});

test('les laminaires : étirement borné (à la mise en place < 5 %, pointe transitoire < 60 %)', () => {
  const st = S.stats.kelp;
  assert.ok(st.maxStretch < 0.6, `étirement maximal ${st.maxStretch}`);
  assert.ok(st.settleStretch < 0.05, `étirement après la mise en place ${st.settleStretch}`);
});

test('les lanières ne traversent jamais le caisson de la caméra (sinon le plan proche les coupe)', () => {
  const K = S.kelp, sg = K.straps, anch = new Float32Array(K.n * 3);
  for (let v = 0; v < sg.count; v++) for (let c = 0; c < 4; c++) { const i = sg.nidx[v * 4 + c]; anch[3 * i] = sg.anch[v * 4]; anch[3 * i + 1] = sg.anch[v * 4 + 1]; anch[3 * i + 2] = sg.anch[v * 4 + 2]; }
  let m = 9;
  for (let f = 0; f < K.nf; f += 2) {
    const c = cameraPose(R.camera, S.cam, f / K.nf).pos;
    for (let i = 0; i < K.n; i++) { const q = P(f, i); m = Math.min(m, Math.hypot(q[0] + anch[3 * i] - c[0], q[1] + anch[3 * i + 1] - c[1], q[2] + anch[3 * i + 2] - c[2])); }
  }
  assert.ok(m > 0.1, `une lanière passe à ${(m * 100).toFixed(1)} cm de l'objectif`);
});

test('raccord : la dernière image rejoint la première sans saut', () => {
  const K = S.kelp;
  let m = 0;
  for (let i = 0; i < K.n; i++) { const a = P(K.nf - 1, i), b = P(0, i); m = Math.max(m, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
  // (au plus le déplacement d'une image : ~1,5 m/s en fin de retrait, 1/30 s)
  assert.ok(m < 0.06, `saut au raccord ${(m * 100).toFixed(1)} cm`);
});

test('cause et effet : à l\'air, les lanières reposent sur la roche', () => {
  const K = S.kelp, prof = makeProfile(R.sea.profile);
  // au grand retrait (avant la grande vague), la frange est à sec : les lames sont couchées
  const f = Math.round(((R.sea.waves[2].t - 1.0) / R.loop.duration) * K.nf);
  let lifted = 0, n = 0;
  for (let i = 0; i < K.n; i++) {
    const q = P(f, i);
    if (Math.abs(q[0]) + Math.abs(q[2]) < 0.3) continue; // (près du crampon : le stipe)
    n++;
    if (q[1] > 0.25) lifted++;
  }
  assert.ok(lifted / n < 0.05, `${lifted} nœuds sur ${n} dressés à l'air`);
});

test('la caméra : périodique, lente, au-dessus de la roche', () => {
  const cam = S.cam;
  const a = cameraPose(R.camera, cam, 0), b = cameraPose(R.camera, cam, 1 - 1e-12);
  assert.ok(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) < 1e-6);
  let maxW = 0;
  for (let k = 0; k < 400; k++) {
    const p0 = cameraPose(R.camera, cam, k / 400), p1 = cameraPose(R.camera, cam, (k + 1) / 400);
    const d0 = p0.target.map((v, j) => v - p0.pos[j]), d1 = p1.target.map((v, j) => v - p1.pos[j]);
    const c = (d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]) / (Math.hypot(...d0) * Math.hypot(...d1));
    maxW = Math.max(maxW, (Math.acos(Math.min(1, c)) * 180 / Math.PI) / (R.loop.duration / 400));
  }
  assert.ok(maxW < 25, `rotation de la caméra ${maxW.toFixed(1)}°/s`);
  assert.ok(cam.y - cam.ground > 0.1, 'le dôme est au-dessus de la roche');
});

test('les familles bougent chacune à sa façon (flottabilité, raideur)', () => {
  const F = FAMILIES;
  assert.ok(F.durvillaea.blade.rho < F.digitata.blade.rho, 'le cochayuyo flotte plus');
  assert.ok(F.postelsia.stipe.stand && F.postelsia.stipe.EI > 10 * F.digitata.stipe.EI, 'le palmier de mer reste debout');
  assert.ok(F.egregia.blade.fringe, 'le boa est frangé');
});
