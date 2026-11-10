// Grille spatiale de points (proximité, colonne la plus haute) : module pur.
const { sqrt, hypot } = Math;

// ── grille spatiale de points ────────────────────────────────────────────────
export function makeGrid(cell = 0.05) {
  const map = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  return {
    add(p, tag) { const k = key(p[0], p[1], p[2]); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push([p[0], p[1], p[2], tag]); },
    near(p, r, skip) {
      const out = [];
      const n = Math.ceil(r / cell);
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
        const a = map.get(`${cx + i},${cy + j},${cz + k}`);
        if (a) for (const q of a) { if (skip && skip(q[3])) continue; const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2]; if (dx * dx + dy * dy + dz * dz < r * r) out.push(q); }
      }
      return out;
    },
    any(p, r, skip) {
      const n = Math.ceil(r / cell);
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
        const a = map.get(`${cx + i},${cy + j},${cz + k}`);
        if (a) for (const q of a) { if (skip && skip(q[3])) continue; const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2]; if (dx * dx + dy * dy + dz * dz < r * r) return q; }
      }
      return null;
    },
    columnMax(x, z, r, skip) {
      // point le plus haut de la colonne verticale de rayon r (contact d'une sphère qui tombe)
      let best = null;
      for (const [k, a] of map) for (const q of a) {
        if (skip && skip(q[3])) continue;
        const d = hypot(q[0] - x, q[2] - z);
        if (d >= r) continue;
        const yc = q[1] + sqrt(r * r - d * d);
        if (!best || yc > best.yc) best = { yc, q };
      }
      return best;
    },
  };
}

