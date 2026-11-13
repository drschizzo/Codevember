// Les récipients et leur machine : maillages sains, et rien ne se traverse (résistance, pierres, soucoupe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVessel, VARIANTS, shellProfile, HEAT } from '../src/gen/vessels.js';

const all = Object.keys(VARIANTS).flatMap((v) => [0, 1].map((flare) => ({ v, flare, out: buildVessel({ variant: v, flare, flutes: flare ? 24 : 0, mastAz: flare ? -2.7 : 2.4, mast: flare, stones: flare ? 4 : 2 }) })));

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

test('ambition : chaque récipient est fait de plusieurs pièces (anse, bec, couvercle, soucoupe, machine…)', () => {
  for (const { v, out } of all) {
    const V = VARIANTS[v], pieces = 2 + (V.handle ? 1 : 0) + (V.saucer ? 1 : 0) + (V.lid ? 2 : 0) + (V.spout ? 1 : 0) + (out.meta.heater ? 3 : 0) + (V.foot ? 1 : 0);
    assert.ok(pieces >= 3, `${v} : ${pieces} éléments`);
    assert.ok(out.parts.body.position.length / 3 > 8000, `${v} : maillage trop pauvre`);
  }
});

test('chaque récipient a sa machine, et la foudre sait où tomber', () => {
  for (const { v, out } of all) {
    const h = out.meta.heater, V = VARIANTS[v];
    assert.equal(h.kind, V.heater, `${v} : machine`);
    if (h.kind === 'pierres') {
      assert.equal(out.meta.strike, null);
      assert.ok(h.pins.length >= 1 && h.pins.length <= 4);
      // chaque pierre dépasse du thé et tient dans le bol
      for (const p of h.pins) {
        assert.ok(p[1] > out.meta.liquid.y + 0.015, `${v} : une pierre est noyée (${(p[1] - out.meta.liquid.y).toFixed(3)})`);
        assert.ok(p[1] < out.meta.top + 0.02, `${v} : une pierre dépasse du bol`);
        assert.ok(Math.hypot(p[0], p[2]) < out.meta.liquid.r * 0.8, `${v} : une pierre contre la paroi`);
      }
    } else {
      // la pointe est le point le plus haut de la scène posée
      assert.ok(out.meta.strike[1] > out.meta.top + 0.2, `${v} : la pointe ne dépasse pas`);
      for (const P of [out.parts.metal, out.parts.element]) if (P) for (let i = 1; i < P.position.length; i += 3) assert.ok(P.position[i] <= out.meta.strike[1] + 1e-6, `${v} : un point plus haut que la pointe`);
    }
  }
});

test('le chemin de la chaleur : il part de la pointe (s = 0) et finit dans ce qui rougit', () => {
  for (const { v, out } of all) {
    let sMin = Infinity, hot = 0, rod = 0;
    for (const P of [out.parts.metal, out.parts.element]) if (P) for (let i = 0; i < P.anchor.length; i += 3) {
      const s = P.anchor[i], k = P.anchor[i + 1];
      if (k === HEAT.HOT) { hot++; assert.ok(s >= 0 && s <= 1 + 1e-6); }
      if (k === HEAT.ROD) { rod++; sMin = Math.min(sMin, s); }
    }
    assert.ok(hot > 200, `${v} : rien ne garde la chaleur`);
    if (out.meta.strike) assert.ok(rod > 200 && sMin < 0.02, `${v} : la chaleur ne part pas de la pointe (s min = ${sMin})`);
    // (le corps du récipient n'est pas sur le chemin)
    for (let i = 1; i < out.parts.body.anchor.length; i += 3) assert.equal(out.parts.body.anchor[i], 0);
  }
});

test('la résistance du thermoplongeur est dans le thé, sans traverser la paroi (tous ses sommets)', () => {
  for (const { v, out } of all) {
    if (out.meta.heater.kind !== 'plongeur') continue;
    const V = VARIANTS[v], S = shellProfile(V.outer({ flare: 0.5 }), { t: V.t, floor: V.floor, foot: V.foot });
    const P = out.parts.metal, yB = out.meta.yBase;
    let n = 0;
    for (let i = 0; i < P.position.length; i += 3) {
      if (P.anchor[i + 1] !== HEAT.HOT) continue;
      n++;
      const r = Math.hypot(P.position[i], P.position[i + 2]), y = P.position[i + 1] - yB;
      assert.ok(r < S.rIn(Math.max(y, S.floor + 0.02)) - 0.004, `${v} : la résistance touche la paroi (r = ${r.toFixed(3)}, y = ${y.toFixed(3)})`);
      assert.ok(y > S.floor + 0.005, `${v} : la résistance passe sous le fond`);
      assert.ok(y + yB < out.meta.liquid.y - 0.022, `${v} : la résistance sort du thé`);
    }
    assert.ok(n > 500);
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
  for (const { v, flare, out } of all) {
    const m = out.meta;
    if (!m.handle) continue;
    const V = VARIANTS[v], S = shellProfile(V.outer({ flare }), { t: V.t, floor: V.floor, foot: V.foot });
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
