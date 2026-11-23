// L'étage fin (version JS du WGSL, src/gen/fineRef.js) sur un drapé simulé :
// rien dans le socle ni dans la statue, déterministe, continu dans le temps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, RC } from '../src/gen/cloth.js';
import { buildForm, bakeForm, plinthSDF, drawForm } from '../src/gen/forms.js';
import { fineSolve } from '../src/gen/fineRef.js';
import { FINE } from '../src/gen/fineParams.js';
import { createRng } from '../../shared/rng.js';

const n = 21, L = 1.0, fabric = 'mousseline', R = 4;
const plinth = { kind: 'die', height: 1.0, half: 0.3 };
const spec = drawForm('bust', createRng('test:fine'));
const form = buildForm(spec), baked = bakeForm(form);
const hang = simulate({ mode: 'hang', n, L, fabric, seed: 'f', rot: 0.3, T: { total: 3 }, floorY: -10, wet: 1 });
let lo = 0;
for (let k = 0; k < hang.N; k++) lo = Math.min(lo, hang.final[k * 3 + 1]);
const yH = Math.max(form.top, form.box[4] - 0.04) + RC - lo + 0.08;
const H = hang.final.slice();
for (let k = 0; k < hang.N; k++) H[k * 3 + 1] += yH;
const desc = simulate({ mode: 'desc', n, L, fabric, start: H, form: spec, plinth, yH, y1: form.top + RC, T: { pre: 0.3, lower: 2.5, settle: 1.5 }, floorY: -1, wet: 1 });
const P = { ...FINE, L, RC, seed: 1 }; // (les réglages de la page)
const vec4 = (S, f) => { const o = new Float32Array(S.N * 4); for (let k = 0; k < S.N; k++) for (let c = 0; c < 3; c++) o[k * 4 + c] = S.frames[(f * S.N + k) * 3 + c]; return o; };
const last = desc.count - 1;
const A = fineSolve(vec4(desc, last), n, R, baked, plinth, P);

test('l’étage fin ne traverse ni la statue ni le socle', () => {
  const pl = plinthSDF(plinth);
  let worstForm = 0, worstPl = 0;
  for (let k = 0; k < A.m * A.m; k++) {
    const x = A.X[k * 3], y = A.X[k * 3 + 1], z = A.X[k * 3 + 2];
    worstForm = Math.min(worstForm, form(x, y, z));
    worstPl = Math.min(worstPl, pl(x, y, z));
  }
  assert.ok(worstForm > -0.002, `dans la statue : ${(worstForm * 1000).toFixed(2)} mm`);
  assert.ok(worstPl > -0.002, `dans le socle : ${(worstPl * 1000).toFixed(2)} mm`);
});

test('l’étage fin colle à la statue (linge humide) : une part du voile y touche', () => {
  let touch = 0;
  for (let k = 0; k < A.m * A.m; k++) if (form(A.X[k * 3], A.X[k * 3 + 1], A.X[k * 3 + 2]) < RC + 0.003) touch++;
  assert.ok(touch / (A.m * A.m) > 0.15, `${((touch / (A.m * A.m)) * 100).toFixed(1)} % du voile au contact`);
});

test('l’étage fin est déterministe (ne dépend que de l’image grossière)', () => {
  const B = fineSolve(vec4(desc, last), n, R, baked, plinth, P);
  let d = 0;
  for (let k = 0; k < A.X.length; k++) d = Math.max(d, Math.abs(A.X[k] - B.X[k]));
  assert.equal(d, 0);
});

test('l’étage fin ne clignote pas : son accélération suit celle du grossier', () => {
  // différence seconde sur trois images voisines (un pli qui saute d'un état à
  // l'autre fait un aller-retour) : centile 99 du fin ≤ 1,3 × celui du grossier
  // + 1 mm ; au repos, aucun sommet au-delà de 12 mm/image² (ancienne
  // adhérence en tout-ou-rien : sauts de 19 mm)
  const pct = (arr, q) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length * q)]; };
  for (const f of [Math.round(desc.count * 0.5), Math.round(desc.count * 0.75), desc.count - 3]) {
    const [a, b, c] = [f - 1, f, f + 1].map((g) => fineSolve(vec4(desc, g), n, R, baked, plinth, P));
    const [ca, cb, cc] = [f - 1, f, f + 1].map((g) => fineSolve(vec4(desc, g), n, R, baked, plinth, { ...P, iters: 0 }));
    const acc = (x, y, z) => { const o = []; for (let k = 0; k < x.m * x.m; k++) o.push(Math.hypot(...[0, 1, 2].map((q) => z.X[k * 3 + q] - 2 * y.X[k * 3 + q] + x.X[k * 3 + q]))); return o; };
    const fa = acc(a, b, c), co = acc(ca, cb, cc);
    assert.ok(pct(fa, 0.99) <= pct(co, 0.99) * 1.3 + 0.001, `image ${f} : ${(pct(fa, 0.99) * 1000).toFixed(1)} contre ${(pct(co, 0.99) * 1000).toFixed(1)} mm`);
    if (f === desc.count - 3) assert.ok(Math.max(...fa) < 0.012, `au repos : ${(Math.max(...fa) * 1000).toFixed(1)} mm/image²`);
  }
});
