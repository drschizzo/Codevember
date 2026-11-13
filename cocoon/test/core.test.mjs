// Invariants du cœur : bobinage (continuité, dépôt sans traversée, table de
// transmission), cinématique de l'ailette, horloge du film (raccord, relève,
// conservation du fil), caméra (vitesse et accélération bornées).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windCocoon, buildPath, geodesicHalf } from '../src/gen/winding.js';
import { makeProfile } from '../src/gen/profile.js';
import { buildScene } from '../src/gen/build.js';
import { makeProgram, beamAngle, filmState, cameraPose } from '../src/timeline.js';
import { generate, windSpec } from '../src/recipe.js';

const spec = (family, shape = 'ovoid') => ({
  family, cage: { shape, R: 0.13, hub: family === 'meridien' ? 0.016 : 0.024, ribs: 16, wire: 0.0016 },
  band: { threads: family === 'huit' ? 5 : 10, thread: 0.0016, gap: 1.05, width: (family === 'huit' ? 5 : 10) * 0.0016 * 1.05 },
  wind: { c1: 0.55, n1: 8, c2: 0.3, ribs: 5, mu: 0.85, amp: 0.04, k: 1.15, passes: 2 },
  grid: { ns: 512, np: 1024 }, step: 0.003,
});
const FAMS = ['losange', 'cerclage', 'huit', 'meridien'];
const cache = new Map();
const wind = (f) => { if (!cache.has(f)) cache.set(f, windCocoon(spec(f))); return cache.get(f); };

test('géodésique de Clairaut : r·sin α = c le long de la demi-géodésique', () => {
  const P = makeProfile({ shape: 'ovoid', R: 0.13, hub: 0.024 });
  const c = 0.06, G = geodesicHalf(P, c);
  // dφ/dσ = c / (r √(r² − c²)) ⇒ r² dφ/dl = c, avec dl² = dσ² + r² dφ²
  for (let i = 100; i < G.sig.length - 100; i += 97) {
    const ds = G.sig[i + 1] - G.sig[i - 1], dp = G.phi[i + 1] - G.phi[i - 1], r = P.rAt(G.sig[i]);
    const dl = Math.hypot(ds, r * dp), sinA = (r * dp) / dl;
    assert.ok(Math.abs(r * sinA - c) < 2e-3, `r sin α = ${r * sinA} ≠ ${c}`);
  }
});

test('le ruban est continu (pas de saut entre deux points)', () => {
  for (const f of FAMS) {
    const { P, path } = buildPath(spec(f));
    let worst = 0;
    for (let j = 1; j < path.sig.length; j++) {
      const r = P.rAt((path.sig[j] + path.sig[j - 1]) / 2);
      worst = Math.max(worst, Math.hypot(path.sig[j] - path.sig[j - 1], r * (path.phi[j] - path.phi[j - 1])));
    }
    assert.ok(worst < 0.0035, `${f} : saut de ${worst} m`);
  }
});

// Le banc de traversée : deux fils ronds de diamètre d dont les axes sont à
// δ < d l'un de l'autre (dans la métrique de la paroi) ne se traversent pas si
// leurs hauteurs diffèrent d'au moins √(d² − δ²). Pour chaque point de fil,
// on le vérifie contre les points des fils posés AVANT lui (tolérance : la
// grille de dépôt, 0,15 d). Un témoin sans dépôt (hauteurs égales) échoue.
function crossings(W, heights = W.Hp, stride = 3) {
  const { P, nb, m, TS, TP, d } = W;
  const TAU = Math.PI * 2, wrap = (a) => a - TAU * Math.round(a / TAU);
  // cellules : d en σ, d / r_min en φ (un voisinage de ±1 cellule couvre d partout)
  const cp = d / P.hub, np = Math.ceil(TAU / cp), grid = new Map();
  let bad = 0, checked = 0;
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < nb; k++) {
      const i = k * m + j, s = TS[i], ph = ((TP[i] % TAU) + TAU) % TAU, h = heights[i];
      const cs = Math.floor(s / d), cx = Math.floor(ph / cp);
      if (j % stride === 0) {
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const L = grid.get(`${cs + a},${(cx + b + np) % np}`);
          if (!L) continue;
          for (const q of L) {
            if (j - q.j < 12) continue; // (même passage : voisins de ruban)
            const r = P.rAt((s + q.s) / 2), dd = Math.hypot(q.s - s, r * wrap(q.ph - ph));
            if (dd > 0.95 * d) continue;
            checked++;
            if (h - q.h < Math.sqrt(d * d - dd * dd) - 0.15 * d) bad++;
          }
        }
      }
      const kk = `${cs},${cx}`;
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push({ j, s, ph, h });
    }
  }
  return { bad, checked };
}

test('dépôt : aucun fil ne traverse un fil posé avant lui (et le banc voit une traversée)', () => {
  for (const f of FAMS) {
    const W = windCocoon({ ...spec(f), grid: { ns: 1024, np: 2048 } }); // (la grille de l'application)
    const r = crossings(W);
    assert.ok(r.checked > 50000, `${f} : trop peu de croisements contrôlés (${r.checked})`);
    assert.ok(r.bad / r.checked < 2e-4, `${f} : ${r.bad} traversées sur ${r.checked}`);
    // témoin négatif : tous les fils à la même hauteur
    const flat = new Float32Array(W.Hp.length).fill(0.001);
    const w = crossings(W, flat);
    assert.ok(w.bad / w.checked > 0.05, `${f} : le banc ne voit pas une traversée évidente`);
  }
});

test('table de transmission : instants croissants, paroi fermée à la fin', () => {
  for (const f of FAMS) {
    const W = wind(f), { Ns, Np, cs } = W.grid;
    let order = 0, open = 0, tot = 0;
    const lo = Math.floor(W.P.sLo / cs) + 4, hi = Math.floor(W.P.sHi / cs) - 4;
    for (let i = lo; i < hi; i++) for (let k = 0; k < Np; k++) {
      const c = (i * Np + k) * 4;
      for (let q = 1; q < 4; q++) if (W.cook[c + q] < W.cook[c + q - 1]) order++;
      tot++; if (W.cook[c] > 1) open++;
    }
    assert.equal(order, 0, `${f} : instants non ordonnés`);
    assert.ok(open / tot < 0.1, `${f} : ${(100 * open / tot).toFixed(1)} % de jours à la fin`);
  }
});

test('ailette : rail hors du cocon plein, rotation continue, brin libre dégagé', () => {
  for (const seed of ['a1', 'b2', 'd4']) {
    const R = generate(seed);
    const o = buildScene(windSpec(R, true));
    const E = o.eye;
    // rail : à au moins 0,8 × l'écart de l'enveloppe
    for (let k = 0; k < E.railPts.length; k += 2) {
      const rx = E.railPts[k], ry = E.railPts[k + 1];
      let dmin = 1e9;
      for (let i = 0; i < E.envR.length; i += 3) dmin = Math.min(dmin, Math.hypot(rx - E.envR[i], ry - E.envY[i]));
      assert.ok(dmin > E.gap * 0.5, `${seed} : rail à ${dmin.toFixed(3)} m du cocon`);
    }
    let dmax = 0;
    for (let j = 1; j < o.m; j++) dmax = Math.max(dmax, Math.abs(E.psi[j] - E.psi[j - 1]));
    assert.ok(dmax < 0.15, `${seed} : l'ailette saute de ${dmax.toFixed(3)} rad`);
    assert.ok(E.fallback / o.m < 0.3, `${seed} : brin libre à travers le cocon plein ${(100 * E.fallback / o.m).toFixed(0)} % du temps`);
  }
});

test('horloge : transfert monotone, relève de 0 à π sans à-coup, raccord par échange', () => {
  const marks = [{ s: 0 }, { s: 0.12 }, { s: 0.7 }];
  const prog = makeProgram(marks, [1, 4, 1.3]);
  let prev = -1;
  for (let i = 0; i <= 1000; i++) { const S = prog.S(i / 1000); assert.ok(S >= prev - 1e-9); prev = S; }
  assert.ok(prog.S(0) < 1e-6 && prog.S(1) > 1 - 1e-6);
  assert.ok(Math.abs(beamAngle(0)) < 1e-12 && Math.abs(beamAngle(1) - Math.PI) < 1e-12);
  const h = 1e-5;
  assert.ok(Math.abs(beamAngle(h) - beamAngle(0)) / h < 1e-3 && Math.abs(beamAngle(1) - beamAngle(1 - h)) / h < 1e-3);
  const R = generate('a1');
  const a = filmState(R, prog, 0), b = filmState(R, prog, 1 - 1e-9);
  // à la fin : droite pleine, gauche vide, fléau tourné de π = le début, rôles échangés
  assert.ok(a.SB < 1e-6 && a.SA > 1 - 1e-6 && Math.abs(a.theta) < 1e-9);
  assert.ok(b.SB > 1 - 1e-6 && b.SA < 1e-6 && Math.abs(b.theta - Math.PI) < 1e-6);
  // conservation : le fil quitte la gauche au rythme où il arrive à droite
  for (let u = 0; u < 1; u += 0.01) { const F = filmState(R, prog, u); assert.ok(Math.abs(F.SA + F.SB - 1) < 1e-12); }
});

test('caméra : périodique, < 25°/s, accélération bornée (120 i/s)', () => {
  for (const seed of ['a1', 'b2', 'c3', 'k6']) {
    const R = generate(seed), D = R.loop.duration, lay = { yc: 1.2 };
    const n = Math.round(D * 120), dir = (u) => { const p = cameraPose(R, u, lay); const v = p.target.map((t, i) => t - p.pos[i]); const l = Math.hypot(...v); return v.map((x) => x / l); };
    const a = cameraPose(R, 0, lay), b = cameraPose(R, 1, lay);
    assert.ok(a.pos.every((x, i) => Math.abs(x - b.pos[i]) < 1e-9));
    let wmax = 0, amax = 0, prevW = 0;
    for (let i = 1; i <= n; i++) {
      const d0 = dir((i - 1) / n), d1 = dir(i / n);
      const ang = Math.acos(Math.min(1, d0.reduce((s, x, k) => s + x * d1[k], 0)));
      const w = (ang * 180) / Math.PI * 120;
      wmax = Math.max(wmax, w);
      if (i > 1) amax = Math.max(amax, Math.abs(w - prevW) * 120);
      prevW = w;
    }
    assert.ok(wmax < 25, `${seed} : ${wmax.toFixed(1)} °/s`);
    assert.ok(amax < 60, `${seed} : ${amax.toFixed(1)} °/s²`);
  }
});
