// Le support à relief cuit (module pur) : les grandes grilles du dessus de la
// pierre, de la souche ou de la motte (un demi-million de sommets) sont
// calculées dans un worker de génération (gen/worker.js) — positions,
// normales, coordonnées de texture et indices, dans la disposition exacte de
// THREE.PlaneGeometry / CylinderGeometry et de computeVertexNormals — pour que
// le changement de scène ne tienne pas le fil principal plusieurs secondes.
// scene/decor.js en fait des maillages (et garde ses formules : mêmes surfaces).
import { makeSubstrate } from './colony.js';

// les surfaces du support (partagées avec scene/decor.js)
export function supportSurface(R, sub = makeSubstrate(R.colony.support)) {
  const D = R.decor, Rc = R.colony.radius;
  switch (D.support) {
    case 'log': return { kind: 'log', Rl: 1 / 0.2, len: 60, top: (x, z) => sub.base(x, z) };
    case 'granite': case 'boulder': case 'wall': case 'peat': case 'ground': {
      const Rs = Rc + (D.support === 'wall' ? 3 : ['peat', 'ground'].includes(D.support) ? 3.5 : 4.5);
      const f = (x, z, rocky) => {
        const a = Math.atan2(z, x), r = (D.support === 'wall' ? Math.abs(z) * 1.6 + Math.abs(x) * 0.2 : Math.hypot(x, z)) * (1 + 0.18 * Math.sin(a * 3 + 1.3) + 0.08 * Math.sin(a * 7 + 0.4));
        const fall = Math.max(0, r - Rs);
        return (rocky ? sub.base(x, z) : sub.y(x, z)) - 0.18 * fall * fall - 0.5 * fall;
      };
      return { kind: 'block', f };
    }
    default: {
      const f = (x, z, rocky) => { const r = Math.hypot(x, z); return (rocky ? sub.base : sub.y)(x, z) * Math.exp(-Math.max(0, r - Rc - 4) * 0.05) - Math.max(0, r - 10) * 0.06; };
      return { kind: 'ground', f };
    }
  }
}

// normales comme BufferGeometry.computeVertexNormals (faces indexées, pondérées par l'aire)
function vertexNormals(pos, index) {
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const cbx = pos[c] - pos[b], cby = pos[c + 1] - pos[b + 1], cbz = pos[c + 2] - pos[b + 2];
    const abx = pos[a] - pos[b], aby = pos[a + 1] - pos[b + 1], abz = pos[a + 2] - pos[b + 2];
    const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  for (let v = 0; v < nrm.length; v += 3) {
    const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1;
    nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l;
  }
  return nrm;
}
// indices d'une grille (gx + 1) × (gy + 1), faces (a, b, d) et (b, c, d)
// (colOrder : colonne par colonne, l'ordre de CylinderGeometry)
function gridIndex(gx, gy, colOrder = false) {
  const index = new Uint32Array(gx * gy * 6), w = gx + 1;
  let k = 0;
  for (let i = 0; i < gx * gy; i++) {
    const y = colOrder ? i % gy : Math.floor(i / gx), x = colOrder ? Math.floor(i / gy) : i % gx;
    const a = x + w * y, b = x + w * (y + 1), c = x + 1 + w * (y + 1), d = x + 1 + w * y;
    index[k++] = a; index[k++] = b; index[k++] = d; index[k++] = b; index[k++] = c; index[k++] = d;
  }
  return index;
}

// grille X × Z (cm) posée à plat, nx × nz segments (comme PlaneGeometry(2X, 2Z, nx, nz).rotateX(−π/2))
function plane(f, X, Z, nx, nz) {
  const n = (nx + 1) * (nz + 1), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const sw = (2 * X) / nx, sh = (2 * Z) / nz;
  for (let iy = 0, v = 0; iy <= nz; iy++) for (let ix = 0; ix <= nx; ix++, v++) {
    const x = Math.fround(ix * sw - X), z = Math.fround(iy * sh - Z);
    pos[v * 3] = x; pos[v * 3 + 1] = f(x, z); pos[v * 3 + 2] = z;
    uv[v * 2] = ix / nx; uv[v * 2 + 1] = 1 - iy / nz;
  }
  const index = gridIndex(nx, nz);
  return { pos, nrm: vertexNormals(pos, index), uv, index };
}

// souche : cylindre ouvert de rayon Rl, couché le long de x, dont le dessus suit le substrat
// (CylinderGeometry(Rl, Rl, len, rs, hs, true).rotateZ(π/2).translate(0, −Rl, 0))
function log(top, Rl, len, rs, hs) {
  const n = (rs + 1) * (hs + 1), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
  for (let y = 0, v = 0; y <= hs; y++) for (let x = 0; x <= rs; x++, v++) {
    const th = (x / rs) * Math.PI * 2;
    const px = Math.fround(Rl * Math.sin(th)), py = Math.fround(-(y / hs) * len + len / 2), pz = Math.fround(Rl * Math.cos(th));
    const X = Math.fround(px * c - py * s), Y = Math.fround(Math.fround(px * s + py * c) - Rl), Z = pz;
    const t = Math.max(0, (Y + Rl) / Rl) ** 4;
    pos[v * 3] = X; pos[v * 3 + 1] = Y + t * (top(X, Z) - Y) * (Math.abs(Z) < Rl * 0.95 ? 1 : 0); pos[v * 3 + 2] = Z;
    uv[v * 2] = x / rs; uv[v * 2 + 1] = 1 - y / hs;
  }
  const index = gridIndex(rs, hs, true);
  return { pos, nrm: vertexNormals(pos, index), uv, index };
}

// le maillage fin du support (avec relief cuit) ; spec : { decor, colony, lite }
export function bakeSupport(spec) {
  const S = supportSurface(spec);
  const lite = !!spec.lite;
  if (S.kind === 'log') return log(S.top, S.Rl, S.len, lite ? 480 : 900, lite ? 260 : 520);
  const res = lite ? 360 : 720;
  if (S.kind === 'block') return plane((x, z) => Math.max(-14, S.f(x, z, true)), 22, 22, res, res);
  return plane((x, z) => S.f(x, z, true), 14, 14, res, res);
}
