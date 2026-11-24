// float → demi-flottant (IEEE 754 binaire16, arrondi au plus proche)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function half(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return (sgn | (e << 10) | (m >> 13)) + ((m >> 12) & 1);
}
