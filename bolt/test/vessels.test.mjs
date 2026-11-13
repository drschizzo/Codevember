// Les récipients : maillages sains, et rien ne se traverse (cuillère, soucoupe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVessel, VARIANTS, shellProfile } from '../src/gen/vessels.js';

const all = Object.keys(VARIANTS).flatMap((v) => [0, 1].map((flare) => ({ v, out: buildVessel({ variant: v, flare, flutes: flare ? 24 : 0, spoonAz: 2.4 }) })));

test('maillages : ni NaN, ni triangle dégénéré, normales unitaires', () => {
  for (const { v, out } of all) for (const [name, P] of Object.entries(out.parts)) {
    if (!P) continue;
    for (let i = 0; i < P.position.length; i++) assert.ok(Number.isFinite(P.position[i]) && Number.isFinite(P.normal[i]), `${v}.${name} : NaN`);
    for (let i = 0; i < P.normal.length; i += 3) assert.ok(Math.abs(Math.hypot(P.normal[i], P.normal[i + 1], P.normal[i + 2]) - 1) < 1e-3, `${v}.${name} : normale`);
    assert.ok(P.index.length % 3 === 0 && P.index.length > 300);
    let big = 0;
    for (let i = 0; i < P.index.length; i++) big = Math.max(big, P.index[i]);
    assert.ok(big < P.position.length / 3);
  }
});

test('ambition : chaque récipient est fait de plusieurs pièces (anse, bec, couvercle, soucoupe, cuillère…)', () => {
  for (const { v, out } of all) {
    const V = VARIANTS[v], pieces = 2 + (V.handle ? 1 : 0) + (V.saucer ? 1 : 0) + (V.lid ? 2 : 0) + (V.spout ? 1 : 0) + (out.meta.spoon ? 3 : 0) + (V.foot ? 1 : 0);
    assert.ok(pieces >= 3, `${v} : ${pieces} éléments`);
    assert.ok(out.parts.body.position.length / 3 > 8000, `${v} : maillage trop pauvre`);
  }
});

test('la cuillère repose sur le fond et sur la lèvre, sans traverser la paroi (tous ses sommets)', () => {
  for (const { v, out } of all) {
    if (!out.meta.spoon) continue;
    const V = VARIANTS[v], S = shellProfile(V.outer({ flare: 0.5 }), { t: V.t, floor: V.floor, foot: V.foot });
    const P = out.parts.metal.position, yB = out.meta.yBase;
    let deep = 0, low = Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const r = Math.hypot(P[i], P[i + 2]), y = P[i + 1] - yB;
      low = Math.min(low, y);
      if (y < S.top - 0.03 && y > S.floor) { // (dans la hauteur de la paroi : doit être à l'intérieur)
        const pen = r - S.rIn(y);
        if (pen > 0.004 && r < S.rOut(y) + 0.01) deep = Math.max(deep, pen);
      }
    }
    assert.ok(deep < 0.012, `${v} : la cuillère entre de ${deep.toFixed(3)} dans la paroi`);
    assert.ok(low > S.floor - 0.004, `${v} : la cuillère passe sous le fond (${(low - S.floor).toFixed(3)})`);
    // la pointe est le point le plus haut de la scène posée
    assert.ok(out.meta.strike[1] > out.meta.top + 0.1, `${v} : la cuillère ne dépasse pas`);
  }
});

test('le thé est dans le récipient : sous la lèvre, au-dessus du fond', () => {
  for (const { v, out } of all) {
    const m = out.meta;
    assert.ok(m.liquid.y < m.top - 0.03 && m.liquid.y > m.yBase + VARIANTS[v].floor + 0.05, `${v} : niveau ${m.liquid.y}`);
    assert.ok(m.liquid.r > 0.15);
  }
});

test('l’anse d’une tasse quitte la paroi et y revient, sans toucher la soucoupe ni passer sous la lèvre du pied', () => {
  for (const { v, out } of all) {
    const m = out.meta;
    if (!m.handle) continue;
    const V = VARIANTS[v], S = shellProfile(V.outer({ flare: 0.5 }), { t: V.t, floor: V.floor, foot: V.foot });
    // les deux bouts sont noyés dans la paroi ; le milieu est dehors
    for (const k of [0, m.handle.length - 1]) { const [r, y] = m.handle[k]; assert.ok(r < S.rOut(y - m.yBase) && r > S.rIn(y - m.yBase) - 0.004, `${v} : attache hors de la paroi`); }
    const mid = m.handle[12]; assert.ok(mid[0] > S.rOut(mid[1] - m.yBase) + 0.1, `${v} : anse collée à la paroi`);
    // au-dessus de la soucoupe : la surface de la soucoupe sous chaque point de l'axe
    for (const [r, y, rad] of m.handle) {
      let ys = 0;
      for (const [rs, yy] of m.saucer.surface) if (rs <= r) ys = Math.max(ys, yy);
      assert.ok(y - rad * 1.6 > ys + 0.015, `${v} : l'anse descend à ${(y - rad * 1.6 - ys).toFixed(3)} de la soucoupe`);
    }
  }
});
