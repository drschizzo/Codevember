// Invariants du cœur : propagation, roche, coussins, contacts, caméra.
//   node --test moss/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { FAMILIES, FAMILY_KEYS } from '../src/families.js';
import { buildMoss } from '../src/gen/build.js';
import { leafPoint, poseParams, leafOpen, tipFrame } from '../src/pose.js';
import { qrot, makeSubstrate, LEAF_STRIDE } from '../src/gen/colony.js';
import { createCameraPath } from '../src/camera.js';
import { sampleField, makeHabitat, FIELD_N, wetSeason } from '../src/field.js';
import { makeRock } from '../src/gen/rock.js';

const scenes = FAMILY_KEYS.map((family, i) => {
  const R = generate(`inv${i}`, { family, mood: ['lande', 'sousbois', 'muret', 'tourbiere'][i] });
  return { R, D: buildMoss({ colony: R.colony, loop: R.loop, water: R.hydro, camera: R.camera }) };
});
const cover = (D, u, th = 0.3) => {
  const NN = FIELD_N * FIELD_N, f = sampleField(D.rec, u, new Float32Array(2 * NN));
  let c = 0, m = 0;
  for (let k = 0; k < NN; k++) if (D.habitat.M[k] > 0.5) { m++; if (f[k] > th) c++; }
  return c / m;
};

test('la propagation est une orbite périodique (la boucle se referme)', () => {
  for (const { R, D } of scenes) {
    assert.ok(D.rec.residual < 1e-3, `${R.family} : résidu ${D.rec.residual}`);
    const NN = FIELD_N * FIELD_N, a = sampleField(D.rec, 0, new Float32Array(2 * NN)), b = sampleField(D.rec, 1 - 1e-7, new Float32Array(2 * NN));
    for (let k = 0; k < 2 * NN; k++) assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${R.family} : raccord ${k}`);
  }
});

test('la mousse se réfugie à la sécheresse, s\'étend aux pluies, se retire ensuite', () => {
  for (const { R, D } of scenes) {
    const dry = cover(D, 0.05), wet = cover(D, 0.55), late = cover(D, 0.92);
    assert.ok(dry > 0.01 && dry < 0.35, `${R.family} : îlots ${dry}`);
    assert.ok(wet > dry * 2.5 && wet > 0.4, `${R.family} : extension ${wet}`);
    assert.ok(late < wet * 0.6, `${R.family} : retrait ${late}`);
    // le front avance pendant les pluies, sans reculer
    let prev = 0;
    for (let u = 0.26; u <= 0.55; u += 0.03) { const c = cover(D, u); assert.ok(c >= prev - 0.01, `${R.family} : recul en ${u.toFixed(2)}`); prev = c; }
    assert.ok(wetSeason(0.4) > 0.9 && wetSeason(0.05) < 0.01);
  }
});

test('les refuges de la mousse sont les fissures de la roche', () => {
  const rock = makeRock('granite', 7), H = makeHabitat('t', 5, [0.4, 0.8, 0.3], rock);
  let inC = 0, nC = 0, out = 0, nO = 0;
  for (let j = 0; j < H.N; j++) for (let i = 0; i < H.N; i++) {
    const x = -5 + (10 * (i + 0.5)) / H.N, z = -5 + (10 * (j + 0.5)) / H.N, c = rock.sample(x, z).crack, r = H.R[j * H.N + i];
    if (c > 0.6) { inC += r; nC++; } else if (c < 0.05) { out += r; nO++; }
  }
  assert.ok(nC > 0 && inC / nC > out / nO + 0.3, 'rétention pas plus forte dans les fissures');
});

// points d'une feuille (monde), tige entièrement poussée, à l'ouverture f
function leafPoints(l, fam, f, SS = [0.3, 0.6, 0.85, 1], XS = [-1, 0, 1]) {
  const Lf = fam.leaf, G = { L: l[3], W: l[10], h: 0, stemR: l[12], twist: l[13] }, q = [l[4], l[5], l[6], l[7]];
  const P = poseParams(fam, leafOpen(f, l[9]), l[9], l[14]);
  const out = [];
  for (const s of SS) for (const x of XS) { const r = qrot(q, leafPoint(s, x, 0, 0, P, G, Lf)); out.push([r[0] + l[0], r[1] + l[1], r[2] + l[2]]); }
  if (Lf.hair) { const T = tipFrame(P, G, Lf), r = qrot(q, [T.p[0] + T.t[0] * Lf.hair * G.L, T.p[1] + T.t[1] * Lf.hair * G.L, T.p[2] + T.t[2] * Lf.hair * G.L]); out.push([r[0] + l[0], r[1] + l[1], r[2] + l[2]]); }
  return out;
}

// (les rosettes voisines s'imbriquent, comme dans un vrai coussin : une
// feuille passe au-dessus ou au-dessous de celles de la voisine, mais ne
// traverse pas sa tige)
test('aucune feuille ne traverse la tige d\'une voisine', () => {
  for (const { R, D } of scenes) {
    const C = D.colony, fam = FAMILIES[R.family], margin = fam.shoot.stemR + fam.leaf.thick;
    const by = Array.from({ length: C.n }, () => []);
    for (let i = 0; i < C.leafCount; i++) by[C.leafStem[i]].push(C.leafInst.subarray(i * LEAF_STRIDE, (i + 1) * LEAF_STRIDE));
    // axe d'une tige : de son pied à son sommet (la tige zigzague de 2 % de sa hauteur)
    const axisAt = (j, y) => { const S = C.shoots[j], t = Math.min(1, Math.max(0, (y - S.yb) / (S.top[1] - S.yb))); return [S.x + (S.top[0] - S.x) * t, S.z + (S.top[2] - S.z) * t, t]; };
    let bad = 0, tot = 0;
    for (const f of [0, 1]) for (let i = 0; i < C.n; i += 2) {
      for (const l of by[i]) for (const p of leafPoints(l, fam, f, [0.6, 1], [0])) for (const j of C.nb[i]) {
        const a = axisAt(j, p[1]);
        if (a[2] <= 0 || a[2] >= 1) continue;
        tot++;
        if (Math.hypot(p[0] - a[0], p[2] - a[1]) < margin + 0.02 * (C.shoots[j].top[1] - C.shoots[j].yb)) bad++;
      }
    }
    // (~1 % existe déjà au sec, feuilles plaquées : deux tiges voisines penchées
    // l'une vers l'autre sur un flanc de dôme — au fond du coussin, invisibles)
    assert.ok(bad / tot < 0.02, `${R.family} : ${bad} traversées sur ${tot}`);
  }
});

test('le coussin est dense : des rosettes imbriquées, sans feuille jetée', () => {
  for (const { R, D } of scenes) {
    const C = D.colony, fam = FAMILIES[R.family];
    if (!fam.shoot.capitulum) assert.ok(C.d < C.reach.r * 0.6, `${R.family} : tiges à ${C.d} pour une rosette de ${C.reach.r}`);
    assert.ok(C.lods.reduce((a, L) => a + L.count, 0) === C.leafCount);
    // chaque tige porte ses feuilles (au loin, au moins celles du haut)
    const per = new Int32Array(C.n);
    for (let i = 0; i < C.leafCount; i++) per[C.leafStem[i]]++;
    assert.ok(Math.min(...per) >= 4, `${R.family} : une tige sans rosette`);
  }
});

test('les tiges des refuges naissent les premières (elles survivent à la sécheresse)', () => {
  for (const { R, D } of scenes) {
    const S = D.colony.shoots, ref = S.filter((s) => s.refuge > 0.8), rest = S.filter((s) => s.refuge < 0.1);
    if (ref.length < 10 || rest.length < 10) continue;
    const mean = (a) => a.reduce((x, s) => x + s.b, 0) / a.length;
    assert.ok(mean(ref) < mean(rest) * 0.5, `${R.family} : seuils ${mean(ref).toFixed(3)} / ${mean(rest).toFixed(3)}`);
  }
});

test('les feuilles restent au-dessus de la roche (relief fin compris)', () => {
  for (const { R, D } of scenes) {
    const C = D.colony, fam = FAMILIES[R.family], sub = makeSubstrate(R.colony.support);
    let bad = 0, tot = 0;
    for (let i = 0; i < C.leafCount; i += 3) {
      const l = C.leafInst.subarray(i * LEAF_STRIDE, (i + 1) * LEAF_STRIDE);
      for (const f of [0, 1]) for (const p of leafPoints(l, fam, f, [0.5, 1], [-1, 1])) { tot++; if (p[1] < sub.y(p[0], p[2])) bad++; }
    }
    assert.ok(bad / tot < 0.002, `${R.family} : ${bad} points sous la roche sur ${tot}`);
  }
});

test('la caméra est périodique, lente et sans à-coup', () => {
  for (const { R, D } of scenes) {
    const tops = D.colony.shoots.map((s) => s.top[1]).sort((a, b) => a - b);
    const cam = createCameraPath(R.camera, { top: tops[Math.floor(tops.length * 0.6)], E: D.habitat.E, hero: D.hero, heroDir: D.heroDir }, R.loop.duration);
    const a = cam.pose(0), b = cam.pose(1 - 1e-9);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.pos[k] - b.pos[k]) < 1e-3);
    const T = R.loop.duration, dt = 1 / 120;
    let peak = 0;
    const dirOf = (p) => { const d = p.target.map((v, k) => v - p.pos[k]), l = Math.hypot(...d); return d.map((v) => v / l); };
    for (let t = 0; t < T; t += dt) {
      const d0 = dirOf(cam.pose(t / T)), d1 = dirOf(cam.pose((t + dt) / T));
      peak = Math.max(peak, Math.acos(Math.min(1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2])) / dt * 180 / Math.PI);
    }
    assert.ok(peak < 25, `${R.family} : pointe ${peak.toFixed(1)}°/s`);
  }
});
