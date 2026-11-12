// Pendulum — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le calcul se regarde : une plaque de chronophotographie (à la Marey : poses
// blanches sur fond noir) par manœuvre de la boucle. Pendant que le solveur
// cherche, chaque plaque montre l'itéré courant : la chaîne à la fin de
// chacun des segments du tir multiple, chaque segment repartant de son
// propre état. Tant que les raccords ne sont pas refermés, les poses sautent
// d'un segment à l'autre ; quand le solveur converge, elles s'alignent en un
// seul geste continu — la chaîne qui se dresse. Sous chaque plaque, la
// courbe du résidu (log) descend. Une fois tout trouvé, la manœuvre est
// rejouée en or sur sa plaque, en boucle.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p, step, stepIdx, done, error, lite }. Pas de texte, rien sous ~88 %
// de la hauteur, < 3 ms par image.
export default function createArt() {
  let M = null, film = null, plates = [], solved = false, t0 = 0, family = 'cart', capture = null;

  const setup = (d) => {
    M = d.machine; film = d.film; family = d.family; solved = false;
    const k = film.seq.length;
    plates = film.seq.map((code, i) => ({ from: code, to: film.seq[(i + 1) % k], poses: null, hist: [], k: -1, done: false, ease: 0 }));
  };

  // pose au repos (pour la plaque vide) : la chaîne pendante ou debout
  const restPose = (code) => {
    const out = [];
    let x = 0, y = M.height;
    out.push(x, y);
    M.links.forEach((L, i) => { const up = code[i] === 'U'; y += up ? L.l : -L.l; out.push(x, y); });
    out.push(0);
    return out;
  };

  return {
    data(d) {
      if (d.type === 'recipe') setup(d);
      else if (d.type === 'iter' && plates[d.i]) {
        const P = plates[d.i];
        if (d.k !== P.k) { P.hist = []; P.k = d.k; }
        P.poses = d.poses;
        P.hist.push(Math.log10(Math.max(1e-12, d.cn)));
        if (P.hist.length > 90) P.hist.shift();
      } else if (d.type === 'capture') {
        capture = d; // (?debug : une image du dessin envoyée au collecteur, pour la vignette de l'accueil)
      } else if (d.type === 'film') {
        solved = true;
        plates.forEach((P, i) => { P.done = true; if (d.poses?.[i]) P.poses = d.poses[i]; });
      }
    },
    draw(ctx, S) {
      if (!M) return;
      const n = plates.length, sumL = M.links.reduce((s, L) => s + L.l, 0);
      const W = S.w, H = S.h, top = H * 0.12, bottom = H * 0.8;
      const gap = W * 0.02, pw = Math.min((W * 0.9 - gap * (n - 1)) / n, (bottom - top) * 0.9);
      const x0 = (W - (pw * n + gap * (n - 1))) / 2;
      const ph = Math.min(bottom - top, pw * 1.25);
      const fade = 1 - S.done;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (!t0 && solved) t0 = S.t;
      plates.forEach((P, i) => {
        const px = x0 + i * (pw + gap), py = top + (bottom - top - ph) / 2;
        // cadre de la plaque (verre noir, filet clair)
        ctx.globalAlpha = 0.9 * fade;
        ctx.fillStyle = '#060606';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = 'rgba(236, 226, 210, 0.16)';
        ctx.lineWidth = S.dpr;
        ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
        // échelle : la chaîne entière (deux longueurs, debout et pendante)
        const span = family === 'cart' ? Math.max(2 * sumL, 2 * (M.rail?.half ?? 0.6) + 0.2) : 2 * sumL + 0.1;
        const sc = Math.min(pw * 0.86 / span, ph * 0.84 / (2 * sumL + 0.12));
        const cx = px + pw / 2, cy = py + ph / 2;
        const X = (x) => cx + x * sc, Y = (y) => cy - (y - M.height) * sc;
        // la machine : rail (chariot) ou pivot
        ctx.strokeStyle = 'rgba(236, 226, 210, 0.35)';
        ctx.lineWidth = 1.2 * S.dpr;
        ctx.beginPath();
        if (family === 'cart') { const h = M.rail?.half ?? 0.6; ctx.moveTo(X(-h - 0.05), Y(M.height)); ctx.lineTo(X(h + 0.05), Y(M.height)); }
        else { ctx.arc(X(0), Y(M.height), 3 * S.dpr, 0, Math.PI * 2); }
        ctx.stroke();
        const chain = (pose, alpha, color, wdt) => {
          ctx.globalAlpha = alpha * fade;
          ctx.strokeStyle = color; ctx.lineWidth = wdt;
          ctx.beginPath();
          const m = (pose.length - 1) / 2;
          for (let j = 0; j < m; j++) { const x = X(pose[2 * j]), y = Y(pose[2 * j + 1]); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          ctx.stroke();
          if (family === 'cart' && wdt > 2 * S.dpr) { ctx.fillStyle = color; ctx.fillRect(X(pose[0]) - 6 * S.dpr, Y(pose[1]) - 3 * S.dpr, 12 * S.dpr, 6 * S.dpr); }
        };
        if (!P.poses) {
          // en attente : la chaîne au repos, qui respire
          chain(restPose(P.from), 0.35 + 0.15 * Math.sin(S.t * 2 + i), '#ece2d2', 1.4 * S.dpr);
        } else {
          // l'itéré : les poses aux nœuds de tir, de la plus ancienne (pâle) à la dernière
          const q = P.poses.length;
          // (une pose sur deux : la plaque reste lisible)
          P.poses.forEach((pose, j) => { if (j % 2 === 0 || j === q - 1) chain(pose, 0.12 + 0.45 * (j / Math.max(1, q - 1)), '#ece2d2', 1 * S.dpr); });
          // après convergence : la manœuvre rejouée en or
          if (P.done) {
            P.ease = Math.min(1, P.ease + S.dt * 1.5);
            const u = ((S.t - t0) * 0.45 + i * 0.27) % 1.3;
            const f = Math.min(q - 1, Math.max(0, u / 1.0 * (q - 1)));
            const a = Math.floor(f), b = Math.min(q - 1, a + 1), t = f - a;
            const A = P.poses[a], B = P.poses[b];
            const mix = A.map((v, k) => v + (B[k] - v) * t);
            chain(mix, P.ease, '#e9c48a', 2.4 * S.dpr);
          }
        }
        // courbe du résidu (log), sous la plaque
        if (P.hist.length > 1) {
          const gy = py + ph + 10 * S.dpr, gh = Math.min(26 * S.dpr, H * 0.86 - gy);
          if (gh > 4) {
            ctx.globalAlpha = 0.55 * fade;
            ctx.strokeStyle = P.done ? '#e9c48a' : '#ece2d2';
            ctx.lineWidth = 1 * S.dpr;
            ctx.beginPath();
            P.hist.forEach((v, j) => {
              const x = px + (j / 89) * pw, y = gy + gh * (1 - (v + 12) / 14);
              if (j) ctx.lineTo(x, Math.min(gy + gh, Math.max(gy, y))); else ctx.moveTo(x, Math.min(gy + gh, Math.max(gy, y)));
            });
            ctx.stroke();
          }
        }
      });
      ctx.globalAlpha = 1;
      if (capture && S.p >= (capture.at ?? 0)) {
        const c = capture; capture = null;
        ctx.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }).then((b) => fetch(c.url + (c.name ?? 'loader.jpg'), { method: 'POST', body: b })).catch(() => {});
      }
    },
  };
}
