// float32 → demi-flottants (IEEE 754 binaire16, arrondi au plus proche) : les
// textures float32 ne sont pas filtrables en WebGPU, les demi-flottants oui.
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function half(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return (sgn | (e << 10) | (m >> 13)) + ((m >> 12) & 1);
}
export function toHalf(a) {
  const out = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = half(a[i]);
  return out;
}
