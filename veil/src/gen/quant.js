// Quantification des images du film (16 bits) : bornes communes au worker
// (qui quantifie) et à la scène (qui relit). Le voile ne sort jamais de cette
// boîte (test) : pas de 0,04 mm en x et z, 0,06 mm en y.
export const QB = { lo: [-1.3, -1.5, -1.3], hi: [1.3, 2.7, 1.3] };
export const QS = [0, 1, 2].map((c) => (QB.hi[c] - QB.lo[c]) / 65535);
// valeur quantifiée → mètres
export const deq = (q, c) => (q + 32768) * QS[c] + QB.lo[c];

// mètres → valeurs quantifiées (images du film)
export function quantize(frames) {
  const q = new Int16Array(frames.length);
  const s = [0, 1, 2].map((c) => 65535 / (QB.hi[c] - QB.lo[c]));
  for (let i = 0; i < frames.length; i++) {
    const c = i % 3;
    const v = Math.round((frames[i] - QB.lo[c]) * s[c]) - 32768;
    q[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
  }
  return q;
}
