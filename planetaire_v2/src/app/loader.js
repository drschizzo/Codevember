// L'écran de génération : on regarde le calcul se faire.
//
// Au centre, l'essai en tête (le plus petit indice encore en lice) : sa courbe,
// un fil de lumière qui se tortille pendant la descente, et ses N astres qui la
// parcourent déjà, avec leur traîne. Dessous, une rangée de vignettes, une par
// essai de la graine : en cours (la courbe bouge), raté (la courbe se fige et
// s'éteint, avec la raison : collision, Lagrange, frôlement…), trouvé (en or).
// Quand une orbite est trouvée, elle reste au centre, en or, pendant la
// construction des machines.
const TAU = Math.PI * 2;
const GOLD = [255, 214, 150], DIM = [150, 140, 128];

export function createLoader(el) {
  const canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
  const label = el.querySelector('p');
  const txt = el.querySelector('.txt');
  const status = document.createElement('small'); status.className = 'status';
  const bar = document.createElement('div'); bar.className = 'actions';
  txt.append(status, bar);
  // essais : index → { pts, N, action, state: 'run' | 'fail' | 'ok', reason, t (dernier changement) }
  const tries = new Map();
  let raf = 0, on = false, searching = false, seed = '', maxTries = 24, found = null;

  // taille et centre d'une courbe (les essais n'ont pas tous la même échelle)
  const frame = (pts) => {
    let cx = 0, cy = 0, n = pts.length / 2, s = 0;
    for (let i = 0; i < n; i++) { cx += pts[2 * i]; cy += pts[2 * i + 1]; }
    cx /= n; cy /= n;
    for (let i = 0; i < n; i++) s = Math.max(s, Math.hypot(pts[2 * i] - cx, pts[2 * i + 1] - cy));
    return { cx, cy, s: s || 1 };
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function path(pts, X, Y, R, f) {
    const n = pts.length / 2;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const q = i % n, x = X + R * (pts[2 * q] - f.cx), y = Y - R * (pts[2 * q + 1] - f.cy);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  }

  // la grande courbe et ses astres
  function hero(tr, X, Y, R, now, dpr, gold) {
    const f = frame(tr.pts), k = R / f.s, n = tr.pts.length / 2;
    const col = gold ? GOLD : [255, 224, 170];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // halo, puis le fil
    ctx.strokeStyle = rgba(col, gold ? 0.12 : 0.06); ctx.lineWidth = 7 * dpr;
    path(tr.pts, X, Y, k, f); ctx.stroke();
    ctx.strokeStyle = rgba(col, gold ? 0.85 : 0.55); ctx.lineWidth = 1.3 * dpr;
    path(tr.pts, X, Y, k, f); ctx.stroke();
    // les astres : N points à 1/N de période l'un de l'autre, avec une traîne
    const N = tr.N || 3, ph = (now / 9000) % 1;
    for (let j = 0; j < N; j++) {
      const u = (ph + j / N) % 1;
      for (let s = 14; s >= 0; s--) {
        const v = ((u - s * 0.006) % 1 + 1) % 1, i = Math.floor(v * n) % n;
        const x = X + k * (tr.pts[2 * i] - f.cx), y = Y - k * (tr.pts[2 * i + 1] - f.cy);
        const a = s ? 0.5 * (1 - s / 15) : 1, r = (s ? 2.2 : 3.4) * dpr * (1 - s / 22);
        if (!s) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 16 * dpr);
          g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16 * dpr, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = rgba(s ? col : [255, 246, 230], a);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    const now = performance.now();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);
    const small = W < 700 * dpr;
    // ── vignettes (une par essai), sous la courbe
    const cols = small ? 8 : 12;
    const cell = Math.min((W * 0.86) / cols, (small ? 46 : 58) * dpr), gridW = cell * cols, pitch = cell + 16 * dpr; // (place pour la raison)
    const gx = (W - gridW) / 2, gy = H * (small ? 0.54 : 0.58);
    for (let i = 0; i < maxTries; i++) {
      const tr = tries.get(i), cx = gx + cell * ((i % cols) + 0.5), cy = gy + pitch * Math.floor(i / cols) + cell * 0.5, r = cell * 0.36;
      if (!tr || !tr.pts) {
        ctx.strokeStyle = rgba(DIM, tr ? 0.35 : 0.12); ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TAU); ctx.stroke();
        if (tr?.state === 'fail') { ctx.fillStyle = rgba(DIM, 0.5); ctx.beginPath(); ctx.arc(cx, cy, 1.5 * dpr, 0, TAU); ctx.fill(); }
        continue;
      }
      const f = frame(tr.pts), age = (now - tr.t) / 1000;
      let col = [233, 196, 138], a = 0.75;
      if (tr.state === 'fail') { col = DIM; a = 0.18 + 0.5 * Math.exp(-age * 2.5); }
      if (tr.state === 'ok') { col = GOLD; a = 1; }
      ctx.strokeStyle = rgba(col, a); ctx.lineWidth = (tr.state === 'ok' ? 1.4 : 1) * dpr;
      path(tr.pts, cx, cy, r / f.s, f); ctx.stroke();
      if (tr.state === 'ok') { ctx.strokeStyle = rgba(GOLD, 0.6); ctx.lineWidth = dpr; ctx.strokeRect(cx - cell / 2 + 2 * dpr, cy - cell / 2 + 2 * dpr, cell - 4 * dpr, cell - 4 * dpr); }
      if (tr.state === 'fail' && tr.reason && age < 1.6) {
        ctx.fillStyle = rgba([255, 170, 150], Math.min(1, 1.6 - age) * 0.8);
        ctx.font = `${10 * dpr}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(tr.reason, cx, cy + cell * 0.5 + 10 * dpr);
      }
    }
    // ── au centre : l'orbite trouvée, sinon l'essai en tête
    let lead = found !== null ? tries.get(found) : null;
    if (!lead) for (const i of [...tries.keys()].sort((a, b) => a - b)) { const t = tries.get(i); if (t.state === 'run' && t.pts) { lead = t; break; } }
    const HX = W / 2, HY = H * (small ? 0.32 : 0.34), HR = Math.min(W * 0.36, H * (small ? 0.2 : 0.24));
    if (lead) hero(lead, HX, HY, HR, now, dpr, lead.state === 'ok');
    if (searching && !el.classList.contains('error')) {
      const done = [...tries.values()].filter((t) => t.state === 'fail').length;
      const head = lead && found === null ? ` · action ${lead.action.toFixed(4)}` : '';
      label.textContent = `graine ${seed} · ${done} essai${done > 1 ? 's' : ''} écarté${done > 1 ? 's' : ''} sur ${maxTries}${head}`;
    }
  }
  const start = () => { if (!on) { on = true; draw(); } };

  return {
    show(text = 'recherche d’une orbite…') {
      tries.clear(); found = null; searching = false; label.textContent = text;
      el.classList.remove('gone', 'error');
      bar.replaceChildren(); status.textContent = '';
      start();
    },
    // une nouvelle recherche (une graine, au plus max essais)
    begin(s, max = 24) { tries.clear(); found = null; seed = s; maxTries = max; searching = true; },
    snap(i, s) {
      const t = tries.get(i) || { state: 'run', t: performance.now() };
      t.pts = s.pts; t.action = s.action; t.N = s.N || t.N;
      tries.set(i, t);
    },
    // fin d'un essai : { ok, reason }
    result(i, r) {
      const t = tries.get(i) || {};
      t.state = r.ok ? 'ok' : 'fail'; t.reason = r.reason; t.t = performance.now();
      tries.set(i, t);
      if (r.ok && (found === null || i < found)) found = i;
    },
    text(t) { searching = false; label.textContent = t; },
    status(t) { status.textContent = t; },
    // un échec : le message, et des boutons pour repartir ({ label, run })
    error(t, actions = []) {
      el.classList.remove('gone');
      el.classList.add('error'); searching = false; label.textContent = t; status.textContent = 'N : nouvelle graine';
      start();
      bar.replaceChildren(...actions.map(({ label: l, run }) => {
        const b = document.createElement('button');
        b.textContent = l; b.onclick = () => run();
        return b;
      }));
    },
    hide() { el.classList.add('gone'); on = false; cancelAnimationFrame(raf); tries.clear(); found = null; },
  };
}
