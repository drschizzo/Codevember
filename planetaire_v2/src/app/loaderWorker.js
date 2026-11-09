// Le dessin de l'écran de génération, dans un worker (OffscreenCanvas) : il
// reste fluide même quand le thread principal est pris (conception et
// construction des machines, compilation des shaders). Le thread principal ne
// fait que lui transmettre les essais (voir loader.js).
//
// Au centre, l'essai en tête (le plus petit indice encore en lice) : sa courbe,
// un fil de lumière qui se tortille pendant la descente, et ses N astres qui la
// parcourent déjà, avec leur traîne. Dessous, une rangée de vignettes, une par
// essai : en cours (la courbe bouge), écarté (la courbe s'éteint, avec la
// raison), trouvé (en or). L'orbite trouvée reste au centre ensuite.
const TAU = Math.PI * 2;
const GOLD = [255, 214, 150], DIM = [150, 140, 128];
let canvas = null, ctx = null, dpr = 1, W = 0, H = 0;
const tries = new Map();
let maxTries = 24, found = null, running = false;
const now = () => performance.now();
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(now()), 16);

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

// la grande courbe et ses astres
function hero(tr, X, Y, R, t, gold) {
  const f = tr.f || (tr.f = frame(tr.pts)), k = R / f.s, n = tr.pts.length / 2;
  const col = gold ? GOLD : [255, 224, 170];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(col, gold ? 0.12 : 0.06); ctx.lineWidth = 7 * dpr;
  path(tr.pts, X, Y, k, f); ctx.stroke();
  ctx.strokeStyle = rgba(col, gold ? 0.85 : 0.55); ctx.lineWidth = 1.3 * dpr;
  path(tr.pts, X, Y, k, f); ctx.stroke();
  const N = tr.N || 3, ph = (t / 9000) % 1;
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

let frames = 0; // (images dessinées : contrôle de fluidité, ?debug)
function draw(t) {
  if (!running) return;
  raf(draw);
  frames++;
  if (!ctx) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.clearRect(0, 0, W, H);
  const small = W < 700 * dpr;
  // ── vignettes
  const cols = small ? 8 : 12;
  const cell = Math.min((W * 0.86) / cols, (small ? 46 : 58) * dpr), gridW = cell * cols, pitch = cell + 16 * dpr;
  const gx = (W - gridW) / 2, gy = H * (small ? 0.58 : 0.61);
  for (let i = 0; i < maxTries; i++) {
    const tr = tries.get(i), cx = gx + cell * ((i % cols) + 0.5), cy = gy + pitch * Math.floor(i / cols) + cell * 0.5, r = cell * 0.36;
    if (!tr || !tr.pts) {
      ctx.strokeStyle = rgba(DIM, tr ? 0.35 : 0.12); ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TAU); ctx.stroke();
      continue;
    }
    const f = tr.f || (tr.f = frame(tr.pts)), age = (t - tr.t) / 1000;
    let col = [233, 196, 138], a = 0.75;
    if (tr.state === 'fail') { col = DIM; a = 0.18 + 0.5 * Math.exp(-age * 2.5); }
    if (tr.state === 'ok') { col = GOLD; a = i === found ? 1 : 0.5; } // (valide, mais un essai d'indice plus petit fait foi)
    ctx.strokeStyle = rgba(col, a); ctx.lineWidth = (tr.state === 'ok' ? 1.4 : 1) * dpr;
    path(tr.pts, cx, cy, r / f.s, f); ctx.stroke();
    if (tr.state === 'ok' && i === found) { ctx.strokeStyle = rgba(GOLD, 0.6); ctx.lineWidth = dpr; ctx.strokeRect(cx - cell / 2 + 2 * dpr, cy - cell / 2 + 2 * dpr, cell - 4 * dpr, cell - 4 * dpr); }
    if (tr.state === 'fail' && tr.reason && age < 1.6) {
      ctx.fillStyle = rgba([255, 170, 150], Math.min(1, 1.6 - age) * 0.8);
      ctx.font = `${9.5 * dpr}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(tr.reason, cx, cy + cell * 0.5 + 10 * dpr);
    }
  }
  // ── au centre : l'orbite trouvée, sinon l'essai en tête
  let lead = found !== null ? tries.get(found) : null;
  if (!lead) for (const i of [...tries.keys()].sort((a, b) => a - b)) { const tr = tries.get(i); if (tr.state === 'run' && tr.pts) { lead = tr; break; } }
  const HX = W / 2, HY = H * 0.35, HR = Math.min(W * 0.3, H * 0.135);
  if (lead) hero(lead, HX, HY, HR, t, lead.state === 'ok');
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { canvas = m.canvas; ctx = canvas.getContext('2d'); }
  else if (m.type === 'size') { W = m.w; H = m.h; dpr = m.dpr; }
  else if (m.type === 'start') { if (!running) { running = true; raf(draw); } }
  else if (m.type === 'stop') { running = false; tries.clear(); found = null; if (ctx) ctx.clearRect(0, 0, W, H); }
  else if (m.type === 'begin') { tries.clear(); found = null; maxTries = m.max; }
  else if (m.type === 'clear') { tries.clear(); found = null; }
  else if (m.type === 'stats') self.postMessage({ type: 'stats', frames, t: now() });
  else if (m.type === 'snap') {
    const tr = tries.get(m.i) || { state: 'run', t: now() };
    tr.pts = m.pts; tr.f = null; tr.N = m.N || tr.N;
    tries.set(m.i, tr);
  } else if (m.type === 'result') {
    const tr = tries.get(m.i) || {};
    tr.state = m.ok ? 'ok' : 'fail'; tr.reason = m.reason; tr.t = now();
    tries.set(m.i, tr);
    if (m.ok && (found === null || m.i < found)) found = m.i;
  }
};
