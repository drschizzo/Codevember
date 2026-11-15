// Invariants du cœur (sans navigateur) : node --test 'kelp/test/*.test.mjs'
// Une scène allégée entière est construite une fois (comme dans le worker),
// puis on vérifie la mer, les laminaires, le raccord, la cause et l'effet.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { buildScene, BOX } from '../src/gen/scene.js';
import { simulateSea, makeProfile, sampleField } from '../src/gen/sea.js';
import { bakeRock, sampler, makePools } from '../src/gen/rock.js';
import { FAMILIES, layoutPlants, buildKelp, simulateKelp } from '../src/gen/kelp.js';
import { cameraPose } from '../src/camera.js';

const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * (m / 1024) * 2 ** -14 : s * 2 ** (e - 15) * (1 + m / 1024); };

let R, S, Hc, sea;
before(() => {
  R = generate('test1', { mood: 'ploumanach', family: 'digitata' });
  S = buildScene(R, { lite: true });
  const pools = makePools(R.seed, { x0: -1.6, x1: 3, z0: -8, z1: 2 }, R.rock.pools);
  const rock = bakeRock({ type: R.rock.type, seed: R.rock.seed, profile: R.sea.profile, edge: R.sea.edge, box: BOX, M: 640, pools, rock: { amp: R.rock.amp, dip: R.rock.dip } });
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

test('les laminaires sont à l\'heure de la mer : un nombre entier de sous-pas par image enregistrée', () => {
  // (à 100 sous-pas par seconde, une image tous les round(100/30) = 3 sous-pas
  // durait 0,030 s : en fin de boucle, les lames avaient 3 s de retard sur l'eau)
  const plants = layoutPlants('digitata', 'sub', { x0: -1.5, x1: -1.2, z0: -0.2, z1: 0.2 }, Hc, { near: { x: -1.3, z: 0 }, nearR: 1, max: 1 });
  const K = buildKelp('digitata', plants, Hc);
  const out = simulateKelp(K, { sea, rockH: Hc, T: 1, fps: 30, sub: 100, loops: 1, settle: 0.1 });
  assert.equal(out.stats.sub % 30, 0, `sous-pas ${out.stats.sub}`);
  assert.equal(out.nf, 30);
  assert.equal(S.stats.kelp.sub % 30, 0);
});

test('le faisceau : le bord du platier et le front varient le long de la côte', () => {
  const B = S.sea.bundle;
  assert.ok(B && B.nz >= 8, 'faisceau de profils absent');
  // le fond de deux profils éloignés diffère au tombant
  const bAt = (k, x) => fromHalf(B.b[(k * B.nx + Math.round((x - B.x0) / B.dx)) * 4]);
  let dmax = 0;
  for (let k = 1; k < B.nz; k++) for (let x = -4; x < -1.5; x += 0.1) dmax = Math.max(dmax, Math.abs(bAt(k, x) - bAt(0, x)));
  assert.ok(dmax > 0.2, `bord droit (écart des fonds ${dmax.toFixed(3)} m)`);
  // au passage de la grande vague, la hauteur au tombant n'est pas la même d'un profil à l'autre
  const w3 = R.sea.waves[2], f = Math.round(w3.t * B.fps) % B.nf, i = Math.round((-2.4 - B.x0) / B.dx);
  const etas = Array.from({ length: B.nz }, (_, k) => fromHalf(B.tex[((k * B.nf + f) * B.nx + i) * 4]));
  assert.ok(Math.max(...etas) - Math.min(...etas) > 0.05, 'front identique sur tous les profils');
});

test('la forêt : des clones au-delà des plantes simulées, jamais contre le dôme', () => {
  const C = S.kelp.clones, cam = S.cam;
  assert.ok(S.kelp.nClones > 20, `trop peu de clones (${S.kelp.nClones})`);
  for (let v = 0; v < C.count; v += 97) {
    const x = C.anch[4 * v], z = C.anch[4 * v + 2];
    assert.ok(Math.hypot(x - cam.x, z - cam.z) > 2.0, 'clone contre le dôme');
    assert.ok(C.clone[2 * v + 1] === 1, 'attribut de clone');
  }
  // les sommets des plantes simulées sont deux fois moins nombreux que ceux de la forêt entière, au moins
  assert.ok(C.count > S.kelp.straps.count * 0.5, 'la forêt ne s\'étend pas');
});

test("l'écume : des flocons nés dans le ressaut, emportés vers la côte, dont certains s'échouent", () => {
  const F = S.sea.bundle.flakes;
  assert.ok(F && F.n > 5000, `trop peu de flocons (${F?.n})`);
  // un flocon sur cent : son abscisse au départ et en fin de vie, et s'il a fini échoué
  let moved = 0, stranded = 0, n = 0;
  for (let j = 0; j < F.n; j += 100) {
    const row = Math.floor(j / F.perRow), col = (j % F.perRow) * F.K, o0 = (row * F.perRow * F.K + col) * 2, o1 = o0 + (F.K - 1) * 2;
    const x0 = fromHalf(F.traj[o0]), x1 = fromHalf(F.traj[o1]);
    if (Math.abs(x1 - x0) > 0.3) moved++;
    if (fromHalf(F.traj[o1 + 1]) < 0.5) stranded++;
    n++;
  }
  assert.ok(moved > n * 0.3, `les flocons ne bougent pas (${moved}/${n})`);
  assert.ok(stranded > 0, 'aucun flocon échoué');
});

test('la paume de la digitée relie les doigts voisins', () => {
  const Wg = S.kelp.web;
  assert.ok(Wg && Wg.count > 100, 'pas de paume');
  for (let v = 0; v < Wg.count; v += 37) assert.ok(Wg.ws[v * 4 + 3] <= 1.0001 && Wg.ws[v * 4 + 2] >= 0 && Wg.ws[v * 4 + 2] <= 1, 'paume hors des doigts');
});
