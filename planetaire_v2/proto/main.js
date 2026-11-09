// Prototype : recherche d'une chorégraphie à partir d'une graine, descente
// affichée en direct, puis l'orbite animée (Canvas 2D) avec un premier essai
// du sillage de verre filé : chaque corps laisse derrière lui un verre en
// fusion qui refroidit ; la traîne dure exactement un N-ième de période, si
// bien que le corps suivant arrive quand elle s'éteint et la ranime.
import { createPool } from '../src/orbit/client.js';
import { curveAt } from '../src/orbit/action.js';

const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);
const pool = createPool();
const url = new URL(location.href);

const state = {
  seed: url.searchParams.get('seed') || randomSeed(),
  orbit: null,           // { coef, params, info, … }
  curve: null,           // échantillons de la courbe (repère tournant)
  snaps: new Map(),      // essai → dernière courbe de la descente
  failed: new Set(),
  phase: 0, paused: false,
  rotating: true,        // affichage dans le repère de la courbe
  gallery: url.searchParams.has('gallery'),
  tiles: [],
  run: 0,
};

function randomSeed() { return Math.random().toString(36).slice(2, 8); }

// ---------------------------------------------------------------- recherche

async function find(seed) {
  const run = ++state.run;
  state.seed = seed; state.orbit = null; state.curve = null;
  state.snaps.clear(); state.failed.clear();
  $('seed').value = seed;
  url.searchParams.set('seed', seed); history.replaceState(null, '', url);
  $('tries').innerHTML = ''; renderInfo(null);
  const r = await pool.search(seed, {
    onSnap: (i, s) => state.snaps.set(i, s),
    onTry: (i, t) => { if (!t.ok) state.failed.add(i); state.snaps.delete(i); },
  });
  if (run !== state.run) return;
  $('tries').innerHTML = r.tries.map((t) => `<li value="${t.index}" class="${t.ok ? 'ok' : ''}">${t.ok ? 'réussi' : t.reason} (${t.ms.toFixed(0)} ms)</li>`).join('');
  if (!r.ok) { renderInfo(r); return; }
  state.orbit = { ...r.orbit, seed, ms: r.ms, tries: r.tries.length, index: r.index };
  state.curve = sample(r.orbit, 1024);
  state.phase = 0;
  renderInfo(r);
  const st = await pool.stability(r.orbit);
  if (run !== state.run) return;
  Object.assign(state.orbit, { rho: st.rho, closure: st.closure, msStab: st.ms });
  renderInfo(r);
}

function sample(orbit, n) {
  const { params } = orbit, D = params.D, pos = new Float64Array(D);
  const pts = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    curveAt(orbit.coef, params, (TAU * i) / n, pos);
    pts[2 * i] = pos[0]; pts[2 * i + 1] = pos[1];
  }
  return pts;
}

function renderInfo(r) {
  const o = state.orbit, rows = [];
  if (!r) rows.push(['', 'recherche…']);
  else if (!r.ok) rows.push(['', `<span class="badge bad">aucune orbite en ${r.tries.length} essais</span>`]);
  else {
    const p = o.params, i = o.info;
    rows.push(
      ['corps', p.N], ['repère tournant ω', p.omega.toFixed(3)],
      ['symétrie', p.sym ? `${p.sym.m} pétales (l = ${p.sym.l})${p.sym.mirror ? ' · miroir' : ''}` : 'aucune'],
      ['action', o.action.toFixed(4)],
      ['harmoniques', p.K], ['engrenages', `${i.gears} <span style="color:var(--dim)">(${i.harmonics.slice(0, 6).join(' ')}…)</span>`],
      ['croisements', i.crossings], ['approche / taille', i.ratio.toFixed(3)],
      ['résidu de Newton', o.residual.toExponential(1)],
      ['raccord des tirs', o.closure === undefined ? '…' : o.closure.toExponential(1)],
      ['stabilité', o.rho === undefined ? '…' : o.rho < 1.01
        ? `<span class="badge ok">stable</span> ρ ${o.rho.toFixed(4)}`
        : `<span class="badge bad">instable</span> ρ ${o.rho < 1e4 ? o.rho.toFixed(1) : o.rho.toExponential(1)}`],
      ['génération', `${(o.ms / 1000).toFixed(2)} s · essai ${o.index} · ${pool.size} workers`],
    );
  }
  $('info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------------------------------------------------------- dessin

const view = $('view'), ctx = view.getContext('2d');

function fit(canvas) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

// verre en fusion → verre froid : 1 = blanc chaud, 0 = refroidi
function heat(a) {
  const stops = [[0, [70, 92, 120]], [0.18, [120, 24, 12]], [0.4, [222, 72, 24]], [0.62, [255, 152, 52]], [0.82, [255, 214, 130]], [1, [255, 248, 236]]];
  for (let i = 1; i < stops.length; i++) {
    if (a <= stops[i][0]) {
      const [a0, c0] = stops[i - 1], [a1, c1] = stops[i], t = (a - a0) / (a1 - a0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    }
  }
  return stops[stops.length - 1][1];
}

// une orbite dans un cadre ; phase φ ∈ [0, 2π)
function drawOrbit(g, W, H, orbit, curve, phase, { rotating = true, scale = 1, fine = true } = {}) {
  const { N, omega } = orbit.params, n = curve.length / 2;
  const R = (0.43 * Math.min(W, H)) / orbit.info.size;
  const cx = W / 2, cy = H / 2;
  const rot = rotating ? 0 : omega * phase;
  const P = (i, extraRot = 0) => {
    const k = ((i % n) + n) % n, x = curve[2 * k], y = curve[2 * k + 1];
    const a = rot - extraRot, c = Math.cos(a), s = Math.sin(a);
    return [cx + R * (c * x - s * y), cy - R * (s * x + c * y)];
  };
  const head = (phase / TAU) * n;

  // le verre refroidi : toute la courbe, à peine visible (repère tournant seulement)
  if (rotating) {
    g.lineWidth = 1.2 * scale; g.strokeStyle = 'rgba(120,150,190,0.16)';
    g.beginPath();
    for (let i = 0; i <= n; i++) { const [x, y] = P(i); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // les sillages : un N-ième de période derrière chaque corps
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  const len = Math.floor(n / N), step = fine ? 1 : 2;
  for (let j = 0; j < N; j++) {
    const h0 = head + (j * n) / N;
    for (let s = 0; s < len; s += step) {
      const a = 1 - s / len;
      const i0 = Math.floor(h0 - s), i1 = i0 - step;
      // repère fixe : la traîne est déposée dans l'espace, tournée de ω·(retard)
      const lag0 = rotating ? 0 : (-(s / n) * TAU) * omega, lag1 = rotating ? 0 : (-((s + step) / n) * TAU) * omega;
      const [x0, y0] = P(i0, -lag0), [x1, y1] = P(i1, -lag1);
      const [r, gg, b] = heat(a);
      g.strokeStyle = `rgba(${r},${gg},${b},${0.25 + 0.75 * a * a})`;
      g.lineWidth = (0.8 + 2.6 * a * a) * scale;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  }
  // les astres
  for (let j = 0; j < N; j++) {
    const [x, y] = P(Math.floor(head + (j * n) / N));
    const rg = g.createRadialGradient(x, y, 0, x, y, 16 * scale);
    rg.addColorStop(0, 'rgba(255,250,240,1)'); rg.addColorStop(0.18, 'rgba(255,214,150,0.85)');
    rg.addColorStop(0.5, 'rgba(255,140,60,0.18)'); rg.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, 16 * scale, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

// la descente en cours : la courbe qui se cherche
function drawSearch(g, W, H, dpr) {
  const live = [...state.snaps.entries()].sort((a, b) => a[0] - b[0]);
  if (!live.length) return;
  const all = live.flatMap(([, s]) => [s]);
  const main = all[0];
  let size = 0;
  for (let i = 0; i < main.pts.length; i += 2) size = Math.max(size, Math.hypot(main.pts[i], main.pts[i + 1]));
  const R = (0.43 * Math.min(W, H)) / (size || 1);
  // les autres essais, en filigrane ; le premier en clair
  all.forEach((s, k) => {
    g.strokeStyle = k ? 'rgba(217,181,108,0.12)' : 'rgba(255,226,170,0.85)';
    g.lineWidth = (k ? 1 : 1.5) * dpr;
    g.beginPath();
    const n = s.pts.length / 2;
    for (let i = 0; i <= n; i++) {
      const q = i % n, x = W / 2 + R * s.pts[2 * q], y = H / 2 - R * s.pts[2 * q + 1];
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  });
  $('status').textContent = `essai ${live[0][0]} · ${main.stage} · itération ${main.it} · action ${main.action.toFixed(4)} · gradient ${main.gnorm.toExponential(1)}`;
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (!state.paused) state.phase = (state.phase + dt * (TAU / 9)) % TAU; // une période en 9 s
  if (!state.gallery) {
    const dpr = fit(view), W = view.width, H = view.height;
    ctx.fillStyle = '#050403'; ctx.fillRect(0, 0, W, H);
    if (state.orbit) {
      drawOrbit(ctx, W, H, state.orbit, state.curve, state.phase, { rotating: state.rotating, scale: dpr });
      $('status').textContent = `graine ${state.seed}`;
    } else drawSearch(ctx, W, H, dpr);
  } else {
    for (const tile of state.tiles) {
      const dpr = fit(tile.canvas), g = tile.canvas.getContext('2d'), W = tile.canvas.width, H = tile.canvas.height;
      g.fillStyle = '#050403'; g.fillRect(0, 0, W, H);
      if (tile.orbit) drawOrbit(g, W, H, tile.orbit, tile.curve, state.phase, { rotating: state.rotating, scale: dpr * 0.6, fine: false });
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- galerie

async function openGallery() {
  state.gallery = true;
  const run = ++state.run;
  const el = $('gallery');
  el.classList.add('on'); el.innerHTML = '';
  $('grid').classList.add('on');
  url.searchParams.set('gallery', ''); history.replaceState(null, '', url);
  state.tiles = Array.from({ length: 12 }, (_, i) => {
    const seed = `${state.seed}${i ? `-${i}` : ''}`;
    const div = document.createElement('div'), canvas = document.createElement('canvas'), label = document.createElement('span');
    label.textContent = `${seed} · recherche…`;
    div.append(canvas, label);
    div.onclick = () => { closeGallery(); find(seed); };
    el.append(div);
    return { seed, canvas, label, orbit: null };
  });
  $('status').textContent = '';
  for (const tile of state.tiles) {
    const r = await pool.search(tile.seed);
    if (run !== state.run) return;
    if (!r.ok) { tile.label.textContent = `${tile.seed} · rien`; continue; }
    tile.orbit = r.orbit; tile.curve = sample(r.orbit, 512);
    tile.label.textContent = `${tile.seed} · ${r.params.N} corps · ω ${r.params.omega} · ${(r.ms / 1000).toFixed(1)} s`;
  }
}

function closeGallery() {
  state.gallery = false; state.run++;
  $('gallery').classList.remove('on'); $('grid').classList.remove('on');
  url.searchParams.delete('gallery'); history.replaceState(null, '', url);
}

// ---------------------------------------------------------------- commandes

$('go').onclick = () => { closeGallery(); find($('seed').value.trim() || randomSeed()); };
$('seed').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); e.stopPropagation(); };
$('new').onclick = () => { if (state.gallery) { state.seed = randomSeed(); $('seed').value = state.seed; openGallery(); } else find(randomSeed()); };
$('frame').onclick = () => { state.rotating = !state.rotating; $('frame').textContent = state.rotating ? 'Repère tournant' : 'Repère fixe'; };
$('grid').onclick = () => (state.gallery ? (closeGallery(), find(state.seed)) : openGallery());
addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') $('new').click();
  else if (e.key === 'r' || e.key === 'R') $('frame').click();
  else if (e.key === 'g' || e.key === 'G') $('grid').click();
  else if (e.key === ' ') { state.paused = !state.paused; e.preventDefault(); }
});

$('seed').value = state.seed;
if (state.gallery) openGallery(); else find(state.seed);
requestAnimationFrame(frame);
