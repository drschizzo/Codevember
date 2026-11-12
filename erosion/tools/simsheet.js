// Mise au point de la simulation sur le GPU, dans la page (?debug) :
//   const m = await import('/tools/simsheet.js'); await m.sheet(erosion.renderer, ['delta', 'ravines'], { port: 8137 })
// Pour chaque famille : simulation complète, puis une carte ombrée (lumière
// rasante, strates, dépôts, humidité) de quelques états enregistrés, envoyée
// au collecteur local (tools/sink.py).
import { createGpuSim } from '../src/scene/gpusim.js';
import { familySpec, initialTerrain, layerAt } from '../src/gen/table.js';
import { PHYS } from '../src/gen/sim.js';

export const defaultStrata = () => {
  const s = [];
  for (let z = 0.004, k = 0; z < 0.12; z += 0.005 + (k % 3) * 0.003, k++) s.push({ bottom: z, hard: k % 3 === 1 ? 0.75 : 0.1, tone: k % 4 });
  return s;
};
const TONES = [[226, 196, 156], [196, 112, 74], [236, 222, 196], [150, 92, 70]];

function draw(gs, b0, st, strata, fr) {
  const { NX, NY, l } = gs, W = NX, H = NY;
  const c = new OffscreenCanvas(W, H), x = c.getContext('2d'), img = x.createImageData(W, H);
  const Lv = [-0.6, -0.35, 0.45], lm = Math.hypot(...Lv);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * NX + i;
    const iL = Math.max(0, i - 1), iR = Math.min(W - 1, i + 1), jT = Math.max(0, j - 1), jB = Math.min(H - 1, j + 1);
    const gx = (fr.b[j * NX + iR] - fr.b[j * NX + iL]) / (2 * l), gy = (fr.b[jB * NX + i] - fr.b[jT * NX + i]) / (2 * l);
    const n = [-gx, -gy, 1], m = Math.hypot(...n);
    const sh = Math.max(0, (n[0] * Lv[0] + n[1] * Lv[1] + n[2] * Lv[2]) / (m * lm));
    const dep = fr.b[k] > fr.bmin[k] + 0.0003;
    let col = dep ? [240, 228, 205] : TONES[strata[layerAt(strata, b0[k] - fr.b[k])].tone % 4];
    const w = fr.wet[k];
    col = col.map((v) => v * (1 - 0.45 * w) * (0.2 + 0.95 * sh));
    const o = ((H - 1 - j) * W + i) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export async function sheet(renderer, families, { port = 8137, frames = [0.25, 0.5, 0.75, 1], phys = {}, spec = {}, tag = '', lite = false, seed = 7 } = {}) {
  Object.assign(PHYS, phys);
  const gs = createGpuSim(renderer, { lite });
  const out = [];
  for (const f of families) {
    const S = familySpec(f, spec); S.seed = seed;
    const b0 = initialTerrain(S.form, gs.NX, gs.NY, seed);
    const strata = defaultStrata();
    gs.setup({ b0, strata, S, seed });
    const r = await gs.run();
    const tiles = [];
    for (const p of frames) tiles.push(draw(gs, b0, S, strata, await gs.readTerrain(Math.round(p * (gs.FT - 1)))));
    const W = gs.NX, H = gs.NY, sc = new OffscreenCanvas(W * 2, H * Math.ceil(tiles.length / 2)), x = sc.getContext('2d');
    tiles.forEach((t, k) => x.drawImage(t, (k % 2) * W, Math.floor(k / 2) * H));
    const blob = await sc.convertToBlob({ type: 'image/png' });
    await fetch(`http://127.0.0.1:${port}/sim-${f}${tag}.png`, { method: 'POST', body: blob });
    out.push({ f, ms: Math.round(r.ms), steps: r.steps });
  }
  return out;
}
