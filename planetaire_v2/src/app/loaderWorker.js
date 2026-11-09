// Le dessin de l'écran de génération, dans un worker (OffscreenCanvas) : il
// reste fluide même quand le thread principal est pris (conception et
// construction des machines, compilation des shaders). Le thread principal ne
// fait que lui transmettre les essais et l'étape (voir loader.js).
//
// Pas de texte : tout se lit dans l'image.
//   - au centre, l'essai en tête : sa courbe, un fil de lumière qui se tortille
//     pendant la descente, et ses N astres qui la parcourent déjà ;
//   - autour, une couronne de points, un par essai : il palpite tant que
//     l'essai cherche, s'éteint et tombe s'il est écarté, devient d'or s'il
//     est retenu (un trait le relie alors à la courbe du centre) ;
//   - dès que la machine est conçue, ses bras (les épicycles) apparaissent :
//     des cercles portés par des cercles, qui tracent la courbe au bout de
//     chaque chaîne ;
//   - un anneau fin en quatre arcs suit le chargement : trajectoire, machine,
//     construction, rendu.
const TAU = Math.PI * 2;
const GOLD = [255, 214, 150], AMBER = [233, 196, 138], DIM = [150, 140, 128], FAIL = [190, 120, 105];
let canvas = null, ctx = null, dpr = 1, W = 0, H = 0;
const tries = new Map();
let maxTries = 24, found = null, running = false, step = 0, stepT = 0, error = false;
let mech = null; // { k, L, phi, N } : les bras de la machine
const now = () => performance.now();
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(now()), 16);
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const frame = (pts) => {
  let cx = 0, cy = 0, s = 0;
  const n = pts.length / 2;
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
const glow = (x, y, r, col, a) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
};

// la grande courbe, ses astres, et (machine conçue) les bras qui la tracent
function hero(tr, X, Y, R, t, gold) {
  // (machine conçue : la courbe est redessinée par ses bras, dans leur repère)
  const m = gold && mech && mech.N === (tr.N || 3) ? mech : null;
  if (m && !tr.fromArms) { tr.pts = m.pts; tr.f = null; tr.fromArms = true; }
  const f = tr.f || (tr.f = frame(tr.pts)), k = R / f.s, n = tr.pts.length / 2;
  const col = gold ? GOLD : [255, 224, 170];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(col, gold ? 0.1 : 0.05); ctx.lineWidth = 7 * dpr;
  path(tr.pts, X, Y, k, f); ctx.stroke();
  ctx.strokeStyle = rgba(col, gold ? 0.8 : 0.5); ctx.lineWidth = 1.2 * dpr;
  path(tr.pts, X, Y, k, f); ctx.stroke();
  const N = tr.N || 3, ph = (t / 9000) % 1;
  // les bras : pour chaque astre, la chaîne de cercles qui le porte (même
  // paramétrage que la courbe : z(τ) = Σ Lᵢ e^{i(kᵢτ + φᵢ)}, l'astre j en τ + 2πj/N)
  const show = m ? ease((t - m.t) / 1400) : 0;
  for (let j = 0; j < N; j++) {
    const u = (ph + j / N) % 1;
    if (m && show > 0) {
      const tau = u * TAU;
      let x = 0, y = 0;
      ctx.lineWidth = dpr;
      for (let i = 0; i < m.L.length; i++) {
        const a = m.k[i] * tau + m.phi[i], x2 = x + m.L[i] * Math.cos(a), y2 = y + m.L[i] * Math.sin(a);
        const sx = X + k * (x - f.cx), sy = Y - k * (y - f.cy), ex = X + k * (x2 - f.cx), ey = Y - k * (y2 - f.cy);
        const w = Math.max(0.15, 1 - i / m.L.length);
        if (j === 0 && m.L[i] * k > 3 * dpr) {
          ctx.strokeStyle = rgba(AMBER, 0.14 * show * w);
          ctx.beginPath(); ctx.arc(sx, sy, m.L[i] * k, 0, TAU); ctx.stroke();
        }
        ctx.strokeStyle = rgba(AMBER, (j === 0 ? 0.75 : 0.32) * show * w);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = rgba(AMBER, (j === 0 ? 0.8 : 0.35) * show * w);
        ctx.beginPath(); ctx.arc(sx, sy, 1.6 * dpr * w, 0, TAU); ctx.fill();
        x = x2; y = y2;
      }
    }
    for (let s = 14; s >= 0; s--) {
      const v = ((u - s * 0.006) % 1 + 1) % 1, i = Math.floor(v * n) % n;
      const x = X + k * (tr.pts[2 * i] - f.cx), y = Y - k * (tr.pts[2 * i + 1] - f.cy);
      const a = s ? 0.5 * (1 - s / 15) : 1, r = (s ? 2.2 : 3.4) * dpr * (1 - s / 22);
      if (!s) glow(x, y, 16 * dpr, col, 0.55);
      ctx.fillStyle = rgba(s ? col : [255, 246, 230], a);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }
}

let frames = 0; // (images dessinées : contrôle de fluidité, ?debug)
function draw(t) {
  if (!running) return;
  raf(draw);
  frames++;
  if (!ctx) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.clearRect(0, 0, W, H);
  const X = W / 2, Y = H * 0.47, R = Math.min(W * 0.3, H * 0.24);
  const fade = error ? 0.35 : 1;
  ctx.globalAlpha = fade;

  // ── au centre : l'orbite trouvée, sinon l'essai en tête
  let lead = found !== null ? tries.get(found) : null;
  if (!lead) for (const i of [...tries.keys()].sort((a, b) => a - b)) { const tr = tries.get(i); if (tr.state === 'run' && tr.pts) { lead = tr; break; } }
  if (lead) hero(lead, X, Y, R * 0.78, t, lead.state === 'ok');

  // ── la couronne des essais
  const RC = R * 1.18;
  for (let i = 0; i < maxTries; i++) {
    const tr = tries.get(i), a = -Math.PI / 2 + (i / maxTries) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    if (!tr) {
      ctx.fillStyle = rgba(DIM, 0.18);
      ctx.beginPath(); ctx.arc(X + ca * RC, Y + sa * RC, 1.3 * dpr, 0, TAU); ctx.fill();
      continue;
    }
    const age = (t - tr.t) / 1000;
    if (tr.state === 'run') {
      const p = 0.5 + 0.5 * Math.sin(t / 260 + i * 1.7);
      glow(X + ca * RC, Y + sa * RC, 7 * dpr, AMBER, 0.25 * p);
      ctx.fillStyle = rgba(AMBER, 0.5 + 0.4 * p);
      ctx.beginPath(); ctx.arc(X + ca * RC, Y + sa * RC, 2 * dpr, 0, TAU); ctx.fill();
    } else if (tr.state === 'fail') {
      // l'essai écarté s'éteint et glisse vers l'extérieur
      const e = ease(age / 1.2), rr = RC + e * 10 * dpr;
      ctx.fillStyle = rgba(age < 0.4 ? FAIL : DIM, 0.75 - 0.55 * e);
      ctx.beginPath(); ctx.arc(X + ca * rr, Y + sa * rr, (2 - 0.8 * e) * dpr, 0, TAU); ctx.fill();
    } else if (tr.state === 'ok') {
      const best = i === found, e = ease(age / 0.8);
      if (best) {
        ctx.strokeStyle = rgba(GOLD, 0.25 * (1 - ease((age - 1) / 1.5)));
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(X + ca * RC, Y + sa * RC); ctx.lineTo(X + ca * RC * (1 - 0.3 * e), Y + sa * RC * (1 - 0.3 * e)); ctx.stroke();
        glow(X + ca * RC, Y + sa * RC, 14 * dpr, GOLD, 0.5);
      }
      ctx.fillStyle = rgba(GOLD, best ? 1 : 0.45);
      ctx.beginPath(); ctx.arc(X + ca * RC, Y + sa * RC, (best ? 2.8 : 1.8) * dpr, 0, TAU); ctx.fill();
    }
  }

  // ── l'anneau du chargement : quatre arcs (trajectoire, machine, construction, rendu)
  const RA = R * 1.32, gap = 0.06;
  ctx.lineCap = 'round'; ctx.lineWidth = 1.2 * dpr;
  for (let s = 0; s < 4; s++) {
    const a0 = -Math.PI / 2 + (s / 4) * TAU + gap, a1 = -Math.PI / 2 + ((s + 1) / 4) * TAU - gap;
    ctx.strokeStyle = rgba(DIM, 0.16);
    ctx.beginPath(); ctx.arc(X, Y, RA, a0, a1); ctx.stroke();
    let p = s < step ? 1 : 0;
    if (s === step && !error) p = 1 - Math.exp(-(t - stepT) / 2500); // (on ne sait pas la durée : l'arc avance en ralentissant)
    if (p > 0) {
      ctx.strokeStyle = rgba(s < step ? AMBER : GOLD, s < step ? 0.55 : 0.9);
      ctx.beginPath(); ctx.arc(X, Y, RA, a0, a0 + (a1 - a0) * p); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { canvas = m.canvas; ctx = canvas.getContext('2d'); }
  else if (m.type === 'size') { W = m.w; H = m.h; dpr = m.dpr; }
  else if (m.type === 'start') { if (!running) { running = true; raf(draw); } }
  else if (m.type === 'stop') { running = false; tries.clear(); found = null; mech = null; if (ctx) ctx.clearRect(0, 0, W, H); }
  else if (m.type === 'begin') { tries.clear(); found = null; mech = null; maxTries = m.max; error = false; }
  else if (m.type === 'clear') { tries.clear(); found = null; mech = null; step = 0; stepT = now(); error = false; }
  else if (m.type === 'step') { if (m.step !== step) { step = m.step; stepT = now(); } }
  else if (m.type === 'error') error = m.on;
  else if (m.type === 'machine') {
    const { k, L, phi } = m.mech, n = 720, pts = new Float32Array(2 * n);
    for (let q = 0; q < n; q++) {
      const t = (q / n) * TAU;
      let x = 0, y = 0;
      for (let i = 0; i < L.length; i++) { x += L[i] * Math.cos(k[i] * t + phi[i]); y += L[i] * Math.sin(k[i] * t + phi[i]); }
      pts[2 * q] = x; pts[2 * q + 1] = y;
    }
    mech = { ...m.mech, pts, t: now() };
  }
  else if (m.type === 'stats') self.postMessage({ type: 'stats', frames, t: now() });
  else if (m.type === 'snap') {
    const tr = tries.get(m.i) || { state: 'run', t: now() };
    tr.pts = m.pts; tr.f = null; tr.N = m.N || tr.N;
    tries.set(m.i, tr);
  } else if (m.type === 'result') {
    const tr = tries.get(m.i) || {};
    tr.state = m.ok ? 'ok' : 'fail'; tr.t = now();
    tries.set(m.i, tr);
    if (m.ok && (found === null || m.i < found)) found = m.i;
  }
};
