// Invariants du cœur : l'optique du mirascope (où se forme l'image, comment
// elle s'efface quand on lève le couvercle), la mise en abyme (le petit posé au
// fond, son image au-dessus de l'ouverture, le raccord d'un niveau au suivant),
// l'écorché (le vrai petit au fond, et son image, dans le même cadre), la
// chorégraphie (une plongée à vitesse constante, refermée un niveau plus bas,
// caméra calme).
//   node --test 'mirage/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAB, mirrors, hitParab, traceCavity, imageOf } from '../src/gen/mirascope.js';
import { K, MINI, BOUND, FOOT, BEADS, HEIGHT, SHELL, TABLE_Y, cutOf, traceNested } from '../src/gen/abyme.js';
import { CHORE, SEAM, CUT, cameraAt, levelAt, seamAt, compExp, cutAt } from '../src/timeline.js';
import { generate } from '../src/recipe.js';

const f = PARAB.f, R = PARAB.rimK * f, rh = PARAB.holeK * f;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

test('les deux coupes se rejoignent à leur bord quand le couvercle est fermé (r = √2·f, y = f/2)', () => {
  const [lo, hi] = mirrors(f, 0);
  close(lo.a * R * R + lo.b, f / 2, 1e-12);
  close(hi.a * R * R + hi.b, f / 2, 1e-12);
  // chaque sommet au foyer de l'autre : foyer du bas en y = f, sommet du haut en y = f
  close(1 / (4 * lo.a), f, 1e-12);
  close(hi.b, f, 1e-12);
});

test('un rayon parallèle à l’axe repasse par le foyer après réflexion sur la coupe du bas', () => {
  for (const x of [0.005, 0.02, 0.05]) {
    const [lo] = mirrors(f, 0);
    const h = hitParab([x, 0.2, 0], [0, -1, 0], lo.a, lo.b, lo.rMin, lo.rMax);
    const d = [0, -1, 0], k = 2 * (d[0] * h.n[0] + d[1] * h.n[1]), r = [d[0] - k * h.n[0], d[1] - k * h.n[1], 0];
    const t = -h.p[0] / r[0];
    close(h.p[1] + r[1] * t, f, 1e-9, `x = ${x}`);
  }
});

test('l’image réelle d’un point du fond flotte en y ≈ f + h, au-dessus de l’ouverture', () => {
  const holeY = f - (rh * rh) / (4 * f);
  for (const h of [0.002, 0.004, 0.006]) {
    const I = imageOf([0, h, 0], f, 0, 1500);
    close(I.X[0], 0, 1e-6); close(I.X[2], 0, 1e-6);
    close(I.X[1], f + h, 0.0008, `h = ${h}`);
    assert.ok(I.X[1] > holeY, 'au-dessus du bord de l’ouverture');
    assert.ok(I.spread < 0.0004, `image nette (étalement ${I.spread})`);
  }
});

test('l’image est tournée d’un demi-tour autour de l’axe (x, z → −x, −z)', () => {
  for (const P of [[0.004, 0.003, 0], [0, 0.003, -0.005], [0.003, 0.002, 0.003]]) {
    const I = imageOf(P, f, 0, 1500);
    close(I.X[0], -P[0], 0.15 * Math.hypot(P[0], P[2]) + 2e-4, 'x');
    close(I.X[2], -P[2], 0.15 * Math.hypot(P[0], P[2]) + 2e-4, 'z');
  }
});

test('couvercle levé : l’image descend dans la cavité et perd ses rayons (elle s’efface)', () => {
  const P = [0, 0.004, 0];
  let prevY = Infinity;
  const n0 = imageOf(P, f, 0, 2000).n;
  for (const L of [0, 0.005, 0.01, 0.015, 0.02]) {
    const I = imageOf(P, f, L, 2000);
    assert.ok(I.X[1] < prevY, `L = ${L} : l'image descend`);
    prevY = I.X[1];
  }
  for (const L of [0.028, 0.032, 0.036]) {
    const I = imageOf(P, f, L, 2000);
    assert.ok(!I || I.n < 0.15 * n0, `L = ${L} : ${I?.n} rayons sur ${n0}`);
  }
});


const bowl = (r) => (r * r) / (4 * f);

test('le petit repose au fond du grand par l’arête de son pied (ni flottant, ni enfoncé)', () => {
  // la base (r = FOOT.base.r, à y = TABLE_Y dans son repère) touche la coupe du bas du parent
  const rb = FOOT.base.r * K, yBase = MINI.y + K * TABLE_Y;
  assert.ok(Math.abs(yBase - bowl(rb)) < 1e-5, `écart ${(yBase - bowl(rb)) * 1e6} µm`);
  // la base, partout, au-dessus du fond
  for (let k = 0; k <= 20; k++) { const r = (rb * k) / 20; assert.ok(yBase >= bowl(r) - 1e-9, `r = ${r}`); }
});

test('le petit tient dans sa sphère englobante, et elle dans la cavité du grand, sous l’ouverture', () => {
  const c = [0, BOUND.y], pts = [
    [R + SHELL + 2 * BEADS.hi.r, BEADS.hi.y + BEADS.hi.r], [R + SHELL + 2 * BEADS.lo.r, BEADS.lo.y - BEADS.lo.r],
    [rh, f + SHELL + BEADS.lip.r], [0, f + SHELL], [FOOT.base.r, TABLE_Y], [0, TABLE_Y],
  ];
  for (const [r, y] of pts) assert.ok(Math.hypot(r - c[0], y - c[1]) < BOUND.r, `(${r}, ${y})`);
  // la sphère, dans le repère du grand : sous le plan de l'ouverture, dans la coupe
  const cy = MINI.y + BOUND.y * K, rr = BOUND.r * K;
  assert.ok(cy + rr < f - bowl(rh), 'sous l’ouverture');
  assert.ok(rr < rh, 'plus étroite que l’ouverture');
});

test('le petit est assez bas pour que son image passe entière par l’ouverture (≤ 11,5 mm)', () => {
  assert.ok(HEIGHT * K <= 0.0115, `${HEIGHT * K}`);
});

// une caméra de la spirale (repère du grand)
const ray = (P, x = 0, y = 0, aspect = 16 / 9) => {
  const F = P.tgt.map((v, i) => v - P.pos[i]), Lf = Math.hypot(...F), Fw = F.map((v) => v / Lf);
  let Rt = [-Fw[2], 0, Fw[0]]; const lr = Math.hypot(...Rt); Rt = Rt.map((v) => v / lr);
  const Up = [Rt[1] * Fw[2] - Rt[2] * Fw[1], Rt[2] * Fw[0] - Rt[0] * Fw[2], Rt[0] * Fw[1] - Rt[1] * Fw[0]];
  const th = Math.tan((P.fov * Math.PI) / 360), tw = th * aspect * (P.ax ?? 1);
  const d = Fw.map((v, k) => v + Rt[k] * x * tw + Up[k] * y * th), l = Math.hypot(...d);
  return [P.pos, d.map((v) => v / l)];
};

test('l’image du petit se forme au-dessus de l’ouverture : la caméra du raccord la voit, deux réflexions plus bas', () => {
  const Rr = generate('abyme');
  const C = cameraAt(Rr, 0, 1), cut = null; // (λ = 1 : la caméra qui regarde l'image du petit, couvercles fermés)
  // sur tout le cadre : le dôme du petit, vu par deux réflexions dans le grand (son image) ;
  // et, plus bas dans la chaîne, le niveau suivant
  let image = 0, deeper = 0, n = 0;
  for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) {
    const h = traceNested(...ray(C, ((i + 0.5) / 32) * 2 - 1, 1 - ((j + 0.5) / 18) * 2), { cut });
    n++;
    if (h.level === 1 && h.id === 'outHi' && h.bounces >= 2) image++;
    if (h.level >= 2) deeper++;
  }
  assert.ok(image > 0.1 * n, `image du petit : ${image} / ${n}`);
  assert.ok(deeper > 0.01 * n, `niveaux plus bas : ${deeper} / ${n}`);
});

test('le raccord : la caméra C1 (image du petit) et la caméra P (le grand) voient la même chose, salle allumée', () => {
  // chaque pixel : même surface un niveau plus bas, au même point (repère de chaque niveau),
  // ou la salle dans la même direction
  const Rr = generate('raccord'), A = cameraAt(Rr, 0, 1), B = cameraAt(Rr, 0, 0), cut = cutOf(Rr.camera.az, cutAt(Rr, 0)); // (couvercle fermé au raccord)
  assert.equal(cut, null);
  let bad = 0, n = 0, err = 0, ok = 0, ang = 0, nr = 0;
  for (let j = 0; j < 27; j++) for (let i = 0; i < 48; i++) {
    const x = ((i + 0.5) / 48) * 2 - 1, y = 1 - ((j + 0.5) / 27) * 2;
    const a = traceNested(...ray(A, x, y), { cut }), b = traceNested(...ray(B, x, y), { cut });
    n++;
    if (a.id === 'room' && b.id === 'room') { const t = Math.acos(Math.min(1, a.d[0] * b.d[0] + a.d[1] * b.d[1] + a.d[2] * b.d[2])); ang += t; nr++; if (t > 0.15) bad++; continue; }
    if (a.id !== b.id || a.level !== b.level + 1 || !a.p) { bad++; continue; }
    ok++; err += Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  }
  assert.ok(bad / n < 0.09, `${((bad / n) * 100).toFixed(1)} % de pixels en désaccord`);
  assert.ok(err / ok < 0.0013, `écart moyen ${((err / ok) * 1000).toFixed(2)} mm`);
  assert.ok(ang / nr < 0.02, `reflets de la salle : ${((ang / nr) * 180 / Math.PI).toFixed(2)}°`);
});

test('la spirale : C1 et P sont les deux bouts d’un niveau, la distance y est géométrique', () => {
  const Rr = generate('spirale'), r = SEAM.C1.dist / SEAM.P.dist;
  const d = (P) => Math.hypot(...P.pos.map((v, i) => v - P.tgt[i]));
  assert.ok(Math.abs(d(cameraAt(Rr, 0, 1)) - SEAM.C1.dist) < 1e-9);
  assert.ok(Math.abs(d(cameraAt(Rr, 0, 0)) - SEAM.P.dist) < 1e-9);
  assert.ok(Math.abs(d(cameraAt(Rr, 0, 0.5)) - SEAM.P.dist * Math.sqrt(r)) < 1e-9);
});

test('la boucle se referme un niveau plus bas : λ(1⁻) − 1 = λ(0⁺), et partout ailleurs λ est continu', () => {
  for (let i = 0; i < 20; i++) {
    const Rr = generate(`t${i}`), e = 1e-7;
    assert.ok(Math.abs(levelAt(Rr, 1 - e) - 1 - levelAt(Rr, e)) < 1e-4, Rr.seed);
    let prev = levelAt(Rr, 0);
    for (let k = 1; k <= 3000; k++) {
      const u = k / 3000, l = k === 3000 ? levelAt(Rr, 1 - e) : levelAt(Rr, u);
      assert.ok(Math.abs(l - prev) < 0.01, `${Rr.seed} u = ${u} : saut de λ`);
      prev = l;
    }
  }
});

test('une seule plongée, sans retour : λ croît de 0 à 1, lentement au début, à la même vitesse des deux côtés du raccord', () => {
  const Rr = generate('mono'), e = 1e-6;
  let prev = levelAt(Rr, 0);
  for (let k = 1; k < 2000; k++) { const l = levelAt(Rr, k / 2000); assert.ok(l > prev, `u = ${k / 2000}`); prev = l; }
  const v0 = (levelAt(Rr, e) - levelAt(Rr, 0)) / e, v1 = (1 + levelAt(Rr, 1 - 2 * e) - (1 + levelAt(Rr, 1 - e))) / -e;
  assert.ok(Math.abs(v0 - v1) < 1e-3 && v0 < 0.5, `${v0} ${v1}`);
});

test('la coupe ouverte : la caméra voit dans le même cadre le vrai petit au fond (sans miroir) et son image au-dessus de l’ouverture', () => {
  for (let i = 0; i < 6; i++) {
    const u = (CUT.open[1] + CUT.close[0]) / 2 - 0.1, Rr = generate(`t${i}`), P = cameraAt(Rr, u), cut = cutOf(Rr.camera.az, cutAt(Rr, u));
    assert.ok(cut, 'la coupe est ouverte');
    let real = 0, image = 0;
    for (let j = 0; j < 27; j++) for (let k = 0; k < 48; k++) {
      const h = traceNested(...ray(P, ((k + 0.5) / 48) * 2 - 1, 1 - ((j + 0.5) / 27) * 2), { cut });
      if (h.level === 1 && h.bounces === 0) real++;
      if (h.level === 1 && h.bounces >= 2) image++;
    }
    assert.ok(real > 2, `${Rr.seed} : le vrai petit (${real} pixels)`);
    assert.ok(image > 2, `${Rr.seed} : son image (${image} pixels)`);
    // sans l'entaille, le vrai petit ne se voit pas directement
    let hidden = 0;
    for (let j = 0; j < 27; j++) for (let k = 0; k < 48; k++) { const h = traceNested(...ray(P, ((k + 0.5) / 48) * 2 - 1, 1 - ((j + 0.5) / 27) * 2)); if (h.level === 1 && h.bounces === 0) hidden++; }
    assert.equal(hidden, 0, `${Rr.seed} : couvercle entier`);
    // et la coupe est fermée au raccord, ouverte au milieu, d'un seul mouvement
    assert.equal(cutAt(Rr, 0), 0); assert.equal(cutAt(Rr, 1 - 1e-9), 0);
  }
});

test('la caméra ne tourne pas autour de l’axe (au balancement près) : l’entaille de chaque niveau lui fait face', () => {
  for (let i = 0; i < 20; i++) {
    const Rr = generate(`t${i}`);
    for (let k = 0; k <= 40; k++) {
      const c = cameraAt(Rr, k / 40), az = (Math.atan2(c.pos[0], c.pos[2]) * 180) / Math.PI;
      const dz = ((az - Rr.camera.az + 540) % 360) - 180;
      assert.ok(Math.abs(dz) <= Math.abs(Rr.camera.sway) + 1e-6, `${Rr.seed} u = ${k / 40} : ${dz}°`);
    }
  }
});

test('le fondu du raccord : moitié-moitié à u = 1, nul aux bords ; l’éclat de l’argent se raccorde', () => {
  const Rr = generate('fondu'), e = 1e-7;
  const a = seamAt(Rr, 1 - e), b = seamAt(Rr, e);
  assert.ok(Math.abs(a.w - 0.5) < 1e-3 && Math.abs(b.w - 0.5) < 1e-3);
  assert.ok(seamAt(Rr, CHORE.seam[0] - 0.001) === null && seamAt(Rr, CHORE.seam[1] - 1 + 0.001) === null);
  assert.ok(seamAt(Rr, CHORE.seam[0] + 1e-5).w < 1e-3);
  // les deux vues mêlées sont les mêmes de part et d'autre (vue courante ↔ vue de l'autre niveau)
  assert.ok(Math.abs(levelAt(Rr, 1 - e) - b.alt) < 1e-4 && Math.abs(levelAt(Rr, e) - a.alt) < 1e-4);
  // éclat affiché d'une vue au niveau λ, qui regarde le niveau n : ρ^(−2λ) × ρ^(2n) — le même des deux côtés
  const shown = (λ, n) => -2 * compExp(λ) + 2 * n;
  assert.ok(Math.abs(shown(levelAt(Rr, 1 - e), 1) - shown(levelAt(Rr, e), 0)) < 1e-3);
  assert.ok(Math.abs(shown(a.alt, 0) - shown(levelAt(Rr, 1 - e), 1)) < 1e-3);
});

test('caméra calme : le regard tourne à moins de 25°/s', () => {
  for (let i = 0; i < 10; i++) {
    const Rr = generate(`t${i}`), T = Rr.loop.duration, N = 3000;
    const dir = (u) => { const P = cameraAt(Rr, u), d = P.tgt.map((v, k) => v - P.pos[k]), l = Math.hypot(...d); return d.map((v) => v / l); };
    let peak = 0;
    for (let k = 0; k < N; k++) {
      const u = k / N, a = dir(u), b = dir(u + 1 / N);
      if (u > 0.999) continue;
      const ang = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI;
      peak = Math.max(peak, ang / (T / N));
    }
    assert.ok(peak < 25, `${Rr.seed} : ${peak.toFixed(1)}°/s`);
  }
});

test('caméra : jamais dans les coupes', () => {
  for (let i = 0; i < 8; i++) {
    const Rr = generate(`t${i}`);
    for (let k = 0; k <= 48; k++) {
      const u = k / 48, c = cameraAt(Rr, u), r = Math.hypot(c.pos[0], c.pos[2]);
      assert.ok(r > R + 0.01 || c.pos[1] > f + SHELL + 0.004 - bowl(Math.max(r, rh)), `${Rr.seed} u = ${u}`);
    }
  }
});
