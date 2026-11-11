// Banc d'essai de la fracture : temps, nombre d'éclats, étanchéité.
//   node shatter/tools/bench-fracture.mjs
import { fracture } from '../src/gen/fracture.js';
import { FORMS } from '../src/gen/forms.js';

export function openEdges(res) {
  const { position: P, index: I } = res.mesh;
  let open = 0;
  for (const F of res.frags) {
    const [a, b] = F.range, count = new Map();
    const key = (i) => `${Math.round(P[3 * i] * 1e5)},${Math.round(P[3 * i + 1] * 1e5)},${Math.round(P[3 * i + 2] * 1e5)}`;
    for (let t = 0; t < I.length; t += 3) {
      if (I[t] < a || I[t] >= b) continue;
      for (let k = 0; k < 3; k++) {
        const u = key(I[t + k]), v = key(I[t + (k + 1) % 3]);
        if (u === v) continue;
        const e = u < v ? `${u}|${v}` : `${v}|${u}`;
        count.set(e, (count.get(e) || 0) + 1);
      }
    }
    for (const c of count.values()) if (c % 2) open++;
  }
  return open;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const mech of ['ball', 'resonance', 'tempered', 'thermal']) {
    for (const form of ['vase', 'bol', 'cloche', 'bouteille']) {
      const t0 = performance.now();
      const r = fracture({ seed: `b-${mech}-${form}`, form, size: 2, thickness: 0.018, mech, Ts: 9 });
      const ms = performance.now() - t0;
      const small = r.frags.filter((f) => f.area < 1e-4).length;
      console.log(mech.padEnd(10), form.padEnd(10), `${ms.toFixed(0)} ms`, `${r.frags.length} éclats`, `${r.mesh.position.length / 3} sommets`, `${r.mesh.index.length / 3} tri`, `ouvertes ${openEdges(r)}`, `minus ${small}`, `front ${r.tFront.map((x) => x.toFixed(2))}`);
    }
  }
}
