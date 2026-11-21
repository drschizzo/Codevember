// Ciels de plein air (module pur) : carte équirectangulaire en demi-flottants,
// en radiance de scène (1 = 1 000 cd/m², la même échelle que la lave et le
// soleil, voir planck.js). Ce sont eux que la peau vitreuse de la lave
// reflète : le ciel couvert la rend argentée, le ciel bleu la bleuit, la nuit
// la laisse noire.
//
// Préréglage : { zenith, horizon, ground (rgb), sun: { az, el, halo, L } }
// — le disque du soleil lui-même est rendu par la lampe directionnelle (son
// reflet est un reflet de lampe) ; ici seulement son halo dans le ciel.

const half = (() => {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  return (v) => {
    f[0] = v; const x = u[0];
    const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
    if (e <= 0) return sgn;
    if (e >= 31) return sgn | 0x7c00;
    return (sgn | (e << 10) | (m >> 13)) + ((m >> 12) & 1);
  };
})();
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function skyPixels(P, W = 1024) {
  const H = W / 2, data = new Uint16Array(W * H * 4);
  const sun = P.sun;
  const sd = sun ? [Math.cos(sun.el) * Math.cos(sun.az), Math.sin(sun.el), Math.cos(sun.el) * Math.sin(sun.az)] : null;
  for (let j = 0; j < H; j++) {
    const elev = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(elev), ce = Math.cos(elev);
    for (let i = 0; i < W; i++) {
      // (même convention que three : u = 0,5 face à −z… on suit envmap.js)
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      const d = [ce * Math.cos(phi), y, ce * Math.sin(phi)];
      let c;
      if (y >= 0) {
        // dégradé d'un ciel (couvert : loi CIE, 1 + 2 sin h ; clair : plus clair à l'horizon)
        const t = P.overcast ? (1 + 2 * y) / 3 : Math.pow(y, 0.45);
        c = P.horizon.map((h, k) => h + (P.zenith[k] - h) * t);
      } else {
        // le sol du champ (noir) avec une bande d'horizon adoucie
        // (sous l'horizon : le champ lui-même, éclairé par ce ciel — au moins un
        // cinquième de l'horizon ; plus sombre, ses reflets dans les lèvres
        // raides de la croûte dessinaient des traits noirs)
        const g = ss(0, -0.08, y);
        c = P.horizon.map((h, k) => h * (1 - g) + Math.max(P.ground[k], 0.2 * h) * g);
      }
      if (sd) {
        const cosA = Math.max(-1, Math.min(1, d[0] * sd[0] + d[1] * sd[1] + d[2] * sd[2]));
        const a = Math.acos(cosA);
        const halo = sun.halo * (Math.exp(-a / 0.12) * 0.7 + Math.exp(-a / 0.45) * 0.3) * ss(-0.05, 0.05, y);
        c = c.map((v, k) => v + halo * sun.color[k]);
      }
      const o = (j * W + i) * 4;
      data[o] = half(c[0]); data[o + 1] = half(c[1]); data[o + 2] = half(c[2]); data[o + 3] = half(1);
    }
  }
  return data;
}
