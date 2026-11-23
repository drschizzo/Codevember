// Petit rastériseur logiciel pour les bancs Node : le voile (grille n × n)
// ombré par sa normale, le socle et, en fantôme, la forme invisible (lancer de
// rayons sur son champ de distance). Écrit un PPM.
import fs from 'node:fs';

export function makeCam(eye, target, fov, W, H) {
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const k = 1 / Math.tan((fov * Math.PI) / 360);
  return {
    eye, f, r, u, W, H,
    proj(p) {
      const d = sub(p, eye), z = dot(d, f);
      return [W / 2 + (dot(d, r) / z) * k * (H / 2), H / 2 - (dot(d, u) / z) * k * (H / 2), z];
    },
    ray(px, py) {
      const x = ((px - W / 2) / (H / 2)) / k, y = (-(py - H / 2) / (H / 2)) / k;
      return norm(add(add(f, mul(r, x)), mul(u, y)));
    },
  };
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export function render(cam, { cloth = null, n = 0, sdfs = [], ghost = null, out, color = [0.92, 0.9, 0.86] }) {
  const { W, H } = cam;
  const img = new Float32Array(W * H * 3).fill(0.12);
  const zb = new Float32Array(W * H).fill(Infinity);
  const L = norm([-0.5, 0.8, 0.6]);
  // fond : lancer de rayons sur les champs (socle = opaque, forme = fantôme)
  const march = (f, o, d) => {
    let t = 0.2;
    for (let i = 0; i < 160 && t < 8; i++) { const p = add(o, mul(d, t)); const v = f(p[0], p[1], p[2]); if (v < 0.0008) return t; t += Math.max(v * 0.9, 0.001); }
    return Infinity;
  };
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const d = cam.ray(px, py), i = py * W + px;
    for (const { f, col, alpha = 1 } of sdfs) {
      const t = march(f, cam.eye, d);
      if (t < zb[i] && t < Infinity) {
        const p = add(cam.eye, mul(d, t)), e = 1e-3;
        const g = norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
        const s = 0.25 + 0.75 * Math.max(0, dot(g, L));
        for (let c = 0; c < 3; c++) img[i * 3 + c] = img[i * 3 + c] * (1 - alpha) + col[c] * s * alpha;
        if (alpha >= 1) zb[i] = t;
      }
    }
  }
  if (cloth) {
    const P = (k) => [cloth[k * 3], cloth[k * 3 + 1], cloth[k * 3 + 2]];
    const tri = (a, b, c) => {
      const A = P(a), B = P(b), C = P(c);
      let nn = norm(cross(sub(B, A), sub(C, A)));
      const ctr = mul(add(add(A, B), C), 1 / 3);
      if (dot(nn, sub(cam.eye, ctr)) < 0) nn = mul(nn, -1);
      const s = 0.18 + 0.82 * Math.max(0, dot(nn, L));
      const pa = cam.proj(A), pb = cam.proj(B), pc = cam.proj(C);
      const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
      const y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
      const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
      if (Math.abs(area) < 1e-9) return;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w0 = ((pb[0] - x) * (pc[1] - y) - (pc[0] - x) * (pb[1] - y)) / area;
        const w1 = ((pc[0] - x) * (pa[1] - y) - (pa[0] - x) * (pc[1] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * pa[2] + w1 * pb[2] + w2 * pc[2], i = y * W + x;
        if (z < zb[i]) { zb[i] = z; for (let c = 0; c < 3; c++) img[i * 3 + c] = color[c] * s; }
      }
    };
    for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i;
      tri(a, a + 1, a + n + 1); tri(a, a + n + 1, a + n);
    }
  }
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) buf[i] = Math.max(0, Math.min(255, Math.round(Math.pow(img[i], 1 / 2.2) * 255)));
  fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), buf]));
}
