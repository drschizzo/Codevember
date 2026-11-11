// Transformées de Fourier rapides et solveurs de Poisson — fonctions pures.
//
// fft1(re, im, n, inv) : FFT complexe en place, radix 2 (n puissance de 2).
// fft2(re, im, n, inv) : 2D, lignes puis colonnes (tableaux n×n, ligne par ligne).
// La transformée inverse est normalisée (1/n par dimension).

export function fft1(re, im, n, inv = false, off = 0, stride = 1) {
  // permutation par inversion des bits
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = off + (i + k) * stride, b = off + (i + k + half) * stride;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[off + i * stride] /= n; im[off + i * stride] /= n; }
}

export function fft2(re, im, n, inv = false) {
  for (let y = 0; y < n; y++) fft1(re, im, n, inv, y * n, 1);
  for (let x = 0; x < n; x++) fft1(re, im, n, inv, x, n);
}

// Équation de Poisson ∇²u = f sur une grille m×m de pas h, u = 0 au bord
// (le bord est hors de la grille, à une demi-cellule… non : aux nœuds −1 et m).
// Méthode : extension impaire (période 2(m+1)), FFT, division par les valeurs
// propres du laplacien discret à 5 points, transformée inverse.
// m + 1 doit être une puissance de 2.
export function poissonDirichlet(f, m, h) {
  const P = 2 * (m + 1);
  const re = new Float64Array(P * P), im = new Float64Array(P * P);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const v = f[y * m + x];
    const X1 = x + 1, Y1 = y + 1, X2 = P - X1, Y2 = P - Y1;
    re[Y1 * P + X1] = v; re[Y1 * P + X2] = -v; re[Y2 * P + X1] = -v; re[Y2 * P + X2] = v;
  }
  fft2(re, im, P);
  for (let q = 0; q < P; q++) for (let p = 0; p < P; p++) {
    const lam = (2 * Math.cos((2 * Math.PI * p) / P) - 2 + 2 * Math.cos((2 * Math.PI * q) / P) - 2) / (h * h);
    const i = q * P + p;
    if (lam === 0) { re[i] = 0; im[i] = 0; } else { re[i] /= lam; im[i] /= lam; }
  }
  fft2(re, im, P, true);
  const u = new Float64Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) u[y * m + x] = re[(y + 1) * P + x + 1];
  return u;
}

// Équation de Poisson ∇²u = f, dérivée normale nulle au bord (Neumann), sur
// une grille m×m de pas h (cellules centrées) ; m puissance de 2. Extension
// paire (période 2m), moyenne de u nulle (f doit être de moyenne nulle : on
// la retire).
export function poissonNeumann(f, m, h) {
  const P = 2 * m;
  const re = new Float64Array(P * P), im = new Float64Array(P * P);
  let mean = 0;
  for (let i = 0; i < m * m; i++) mean += f[i];
  mean /= m * m;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const v = f[y * m + x] - mean;
    const X2 = P - 1 - x, Y2 = P - 1 - y;
    re[y * P + x] = v; re[y * P + X2] = v; re[Y2 * P + x] = v; re[Y2 * P + X2] = v;
  }
  fft2(re, im, P);
  for (let q = 0; q < P; q++) for (let p = 0; p < P; p++) {
    const lam = (2 * Math.cos((2 * Math.PI * p) / P) - 2 + 2 * Math.cos((2 * Math.PI * q) / P) - 2) / (h * h);
    const i = q * P + p;
    if (lam === 0) { re[i] = 0; im[i] = 0; } else { re[i] /= lam; im[i] /= lam; }
  }
  fft2(re, im, P, true);
  const u = new Float64Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) u[y * m + x] = re[y * P + x];
  return u;
}
