// Aperçu 3D du cocon dans Node : segments de fil rastérisés (z-buffer, Lambert
// + reflet le long du fil), à plusieurs instants S, en PNG via PIL.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { windCocoon, threadSegments } from '../src/gen/winding.js';
export function render(seg, S, { W = 360, Hh = 480, scale = 1300, el = 0.25, az = 0.4 } = {}) {
  const img = new Float32Array(W * Hh * 3).fill(0.08), z = new Float32Array(W * Hh).fill(1e9);
  const ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(az), sa = Math.sin(az);
  const proj = (x, y, w) => { const X = ca * x + sa * w, Z0 = -sa * x + ca * w; const Y = ce * y - se * Z0, Z = se * y + ce * Z0; return [W / 2 + X * scale, Hh / 2 - Y * scale, -Z]; };
  const L = [0.5, 0.7, 0.5];
  for (let i = 0; i < seg.count; i++) {
    const s0 = seg.a[i * 4 + 3]; if (s0 >= S) continue;
    const p = proj(seg.a[i * 4], seg.a[i * 4 + 1], seg.a[i * 4 + 2]), q = proj(seg.b[i * 4], seg.b[i * 4 + 1], seg.b[i * 4 + 2]);
    const tx = seg.b[i * 4] - seg.a[i * 4], ty = seg.b[i * 4 + 1] - seg.a[i * 4 + 1], tz = seg.b[i * 4 + 2] - seg.a[i * 4 + 2], tl = Math.hypot(tx, ty, tz) || 1;
    const tl_ = (tx * L[0] + ty * L[1] + tz * L[2]) / tl;
    const kk = Math.sqrt(Math.max(0, 1 - tl_ * tl_));
    const sh = 0.25 + 0.6 * kk + 0.5 * kk ** 40, k = seg.c[i * 4 + 1] % 2 ? 0.92 : 1;
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])) + 1;
    for (let t = 0; t <= n; t++) {
      const f = t / n, x = Math.round(p[0] + (q[0] - p[0]) * f), y = Math.round(p[1] + (q[1] - p[1]) * f), d = p[2] + (q[2] - p[2]) * f;
      if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
      const o = y * W + x; if (d >= z[o]) continue; z[o] = d;
      img[o * 3] = sh * k * 0.95; img[o * 3 + 1] = sh * k * 0.9; img[o * 3 + 2] = sh * k * 0.8;
    }
  }
  return { img, W, Hh };
}
export function savePanels(panels, file) {
  const W = panels[0].W, Hh = panels[0].Hh, buf = Buffer.alloc(W * panels.length * Hh * 3);
  panels.forEach((P, q) => { for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) buf[(y * W * panels.length + q * W + x) * 3 + c] = Math.min(255, Math.round(255 * Math.pow(P.img[(y * W + x) * 3 + c], 1 / 2.2))); });
  fs.writeFileSync(file + '.ppm', Buffer.concat([Buffer.from(`P6 ${W * panels.length} ${Hh} 255\n`), buf]));
  execSync(`python3 -c "from PIL import Image; Image.open('${file}.ppm').save('${file}.png')"`);
  fs.unlinkSync(file + '.ppm');
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  const spec = JSON.parse(process.argv[3]);
  const W = windCocoon(spec);
  const seg = threadSegments(W);
  const Ss = (process.argv[4] || '0.06,0.2,0.4,0.6,0.8,1').split(',').map(Number);
  savePanels(Ss.map((S) => render(seg, S)), out);
}
