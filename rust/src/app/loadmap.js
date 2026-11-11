// L'écran de chargement montre le calcul : la pièce vue de face (carte de
// profondeur du laser), et la rouille qui s'y étend au rythme de l'instant
// d'apparition calculé par le champ de corrosion — depuis les rivets, les
// creux, les arêtes, puis sur les faces dégagées. En boucle, jusqu'à ce que la
// scène soit prête.
export function createLoadMap(canvas) {
  const ctx = canvas.getContext('2d');
  let cur = null, img = null, onset = null, shade = null, w = 0, h = 0, t0 = 0, on = false;
  const ramp = (a) => { // rouille : orange vif (jeune) → brun sombre (épaisse)
    const k = Math.min(1, a / 0.6);
    return [200 - 120 * k, 92 - 60 * k, 34 - 22 * k];
  };
  return {
    has: (C) => C === cur,
    clear() { cur = null; on = false; canvas.classList.remove('on'); },
    stop() { on = false; },
    show(C) {
      cur = C;
      const F = C.front, V = C.field, [nx, ny, nz] = V.dims;
      // (sous-échantillonnage : ≤ 260 px de haut)
      const s = Math.max(1, Math.ceil(F.h / 260));
      w = Math.ceil(F.w / s); h = Math.ceil(F.h / s);
      canvas.width = w; canvas.height = h;
      img = ctx.createImageData(w, h);
      onset = new Float32Array(w * h).fill(-1); shade = new Float32Array(w * h);
      let zmin = 1e9, zmax = -1e9;
      for (const z of F.data) if (z > -999) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const fi = Math.min(F.w - 1, i * s), fj = Math.min(F.h - 1, j * s), z = F.data[fj * F.w + fi];
        if (z <= -999) continue;
        const x = F.lo[0] + (fi + 0.5) * F.cell, y = F.lo[1] + (fj + 0.5) * F.cell;
        const vx = Math.floor((x - V.lo[0]) / V.vox), vy = Math.floor((y - V.lo[1]) / V.vox), vz = Math.floor((z - 0.004 - V.lo[2]) / V.vox);
        const k = ((Math.min(nz - 1, Math.max(0, vz)) * ny + Math.min(ny - 1, Math.max(0, vy))) * nx + Math.min(nx - 1, Math.max(0, vx))) * 4;
        const o = (h - 1 - j) * w + i; // (image : y vers le bas)
        onset[o] = V.data[k] / 255;
        // relief : pente de la profondeur (lumière rasante d'en haut à gauche)
        const zr = F.data[fj * F.w + Math.min(F.w - 1, fi + s)], zu = F.data[Math.min(F.h - 1, fj + s) * F.w + fi];
        const g = (zr > -999 ? zr - z : 0) * -6 + (zu > -999 ? zu - z : 0) * 6;
        shade[o] = Math.max(0.35, Math.min(1.25, 0.75 + (z - zmin) / Math.max(1e-3, zmax - zmin) * 0.25 + g * 8));
      }
      t0 = performance.now(); on = true;
      canvas.classList.add('on');
    },
    frame(now) {
      if (!on || !img) return;
      // τ balaye 0 → 1 en 3,2 s, s'arrête un instant, recommence
      const T = ((now - t0) / 3200) % 1.25, tau = Math.min(1, T);
      const d = img.data;
      for (let o = 0; o < w * h; o++) {
        const a = onset[o];
        if (a < 0) { d[o * 4 + 3] = 0; continue; }
        const sh = shade[o], age = tau - a;
        let r = 150, g = 152, b = 155;
        if (age > 0) { const c = ramp(age); const m = Math.min(1, age / 0.04); r = r + (c[0] - r) * m; g = g + (c[1] - g) * m; b = b + (c[2] - b) * m; }
        d[o * 4] = r * sh; d[o * 4 + 1] = g * sh; d[o * 4 + 2] = b * sh; d[o * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },
  };
}
