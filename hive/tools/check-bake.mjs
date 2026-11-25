import { bakeTiling, bakeInstances } from '../src/gen/bake.js';
const spec = { group: 'p6', path: { legs: [{ a: 0, b: 1, q: [0.3, 0.3, 0.4] }, { a: 1, b: 0, q: [0.25, 0.25, 0.5] }] }, profiles: [{ a1: 0.1, a2: 0.1 }, { a1: -0.1, a3: 0.05 }, { a2: 0.12 }], wall: 0.045, n: 16, RL: 48, sdfN: 64 };
let t = performance.now(); const B = bakeTiling(spec); console.log('cuisson', (performance.now() - t).toFixed(0), 'ms', B.rows, 'rangées', B.M, 'points', [...B.boxes].map((v) => v.toFixed(2)).join(' '));
// écart paroi : distance axe → face intérieure
let mn = 1e9, mx = 0; for (let i = 0; i < B.curves.length; i += 4) { const d = Math.hypot(B.curves[i] - B.curves[i + 2], B.curves[i + 1] - B.curves[i + 3]); mn = Math.min(mn, d); mx = Math.max(mx, d); }
console.log('axe → face intérieure : min', mn.toFixed(4), 'max', mx.toFixed(4));
const I = bakeInstances(spec.group, spec.path, spec.profiles, 14); console.log('instances', I.count, 'ref', I.ref);
// dump de quelques rangées pour dessin
const rows = [0, 12, 24, 36, 47, 48, 60, 72, 84, 95];
const out = [rows.map((r) => { const a = [], b = []; for (let i = 0; i < B.M; i++) { const o = (r * B.M + i) * 4; a.push(B.curves[o], B.curves[o + 1]); b.push(B.curves[o + 2], B.curves[o + 3]); } return [a, b]; })];
process.stdout.write('\n' + JSON.stringify(out));
