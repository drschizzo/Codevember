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
//   - dès que les machines sont conçues, le centre montre le monde sur lequel
//     la scène va s'ouvrir, tel qu'on le verra : son orbite, parcourue dans le
//     même sens et à la même allure, sur son plateau qui tourne, orientée comme
//     la caméra la verra, avec les bras de sa machine (les épicycles : des
//     cercles portés par des cercles). À la fin du chargement, le schéma se
//     couche dans la perspective de la caméra et se cale sur l'instant où la
//     scène commence : chaque point du schéma est alors sur son astre, et
//     l'image s'ouvre sur le même mouvement ;
//   - sous la couronne, trois médaillons : les trois mondes de la plongée.
//     Celui dont on cherche l'orbite palpite ; une orbite trouvée vient s'y
//     ranger, en petit ;
//   - un anneau fin en quatre arcs suit le chargement : trajectoires, machines,
//     construction, rendu.
const TAU = Math.PI * 2;
const GOLD = [255, 214, 150], AMBER = [233, 196, 138], DIM = [150, 140, 128], FAIL = [190, 120, 105];
let canvas = null, ctx = null, dpr = 1, W = 0, H = 0;
const tries = new Map();
let maxTries = 24, found = null, running = false, step = 0, stepT = 0, error = false;
let prog = null, progShown = 0; // avancement réel de l'étape en cours, quand il est connu
// les mondes de la plongée : la couche en cours, celles qui ont déjà leur
// orbite, et les courbes trouvées ({ pts, f, t })
const worlds = { cur: 0, have: [false, false, false], kept: [] };
// l'orbite trouvée de la couche en cours rejoint son médaillon
const keep = () => {
  const tr = found !== null ? tries.get(found) : null;
  if (tr?.pts && !worlds.kept[worlds.cur]) worlds.kept[worlds.cur] = { pts: tr.pts, f: frame(tr.pts), t: now() };
};
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

// la grande courbe d'un essai et ses astres (pendant la recherche)
function hero(tr, X, Y, R, t, gold) {
  const f = tr.f || (tr.f = frame(tr.pts)), k = R / f.s, n = tr.pts.length / 2;
  const col = gold ? GOLD : [255, 224, 170];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(col, gold ? 0.1 : 0.05); ctx.lineWidth = 7 * dpr;
  path(tr.pts, X, Y, k, f); ctx.stroke();
  ctx.strokeStyle = rgba(col, gold ? 0.8 : 0.5); ctx.lineWidth = 1.2 * dpr;
  path(tr.pts, X, Y, k, f); ctx.stroke();
  const N = tr.N || 3, ph = (t / 9000) % 1;
  for (let j = 0; j < N; j++) {
    const u = (ph + j / N) % 1;
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

// ── le monde sur lequel la scène va s'ouvrir ─────────────────────────────────
// sc : { N, omega, rate, rot, k, L, phi, pts, size } et son état : tau (temps
// de l'orbite), off (décalage de l'angle du plateau), e (0 : schéma à plat ;
// 1 : dans la perspective de la caméra), pose ({ M, y } : matrice de projection
// de la scène et hauteur des astres), slaved (la scène donne le temps).
// La courbe z(τ) = Σ Lᵢ e^{i(kᵢτ + φᵢ)} est dans le repère du plateau, qui a
// tourné de ω·τ ; l'astre j est en τ + 2πj/N : ce sont les formules de la scène.
let sc = null;
const hermite = (x, p0, p1, m) => (2 * x * x * x - 3 * x * x + 1) * p0 + (x * x * x - 2 * x * x + x) * m + (-2 * x * x * x + 3 * x * x) * p1 + (x * x * x - x * x) * m;
function sceneHero(t, X, Y, R) {
  const dt = Math.min(0.1, (t - sc.last) / 1000); sc.last = t;
  if (sc.land) {
    // atterrissage : le temps rejoint l'instant où la scène commence (sans
    // s'arrêter : même allure au départ et à l'arrivée), le plateau son angle
    const A = sc.land, x = Math.min(1, (t - A.t0) / A.D), e = ease(x);
    sc.tau = hermite(x, A.from, A.to, sc.rate * A.D / 1000);
    sc.off = A.off * e; sc.e = e;
    if (x >= 1) sc.land = null;
  } else if (!sc.slaved) sc.tau += sc.rate * dt;
  const th = sc.slaved ? sc.th : sc.omega * sc.tau + sc.off;
  const e = sc.e, show = ease((t - sc.t0) / 1200), kf = R / sc.size;
  const c = Math.cos(th), s = Math.sin(th), c2 = Math.cos(th + sc.rot), s2 = Math.sin(th + sc.rot);
  const M = sc.pose?.M, y0 = sc.pose?.y || 0;
  const out = [0, 0];
  // un point du plateau → l'écran : à plat (orienté comme la caméra le verra),
  // ou projeté comme la scène, ou entre les deux
  const map = (x, y) => {
    let px = X + kf * (x * c2 - y * s2), py = Y - kf * (x * s2 + y * c2);
    if (e > 0 && M) {
      const xw = x * c - y * s, zw = -(x * s + y * c);
      const w = M[3] * xw + M[7] * y0 + M[11] * zw + M[15];
      const qx = ((M[0] * xw + M[4] * y0 + M[8] * zw + M[12]) / w * 0.5 + 0.5) * W;
      const qy = (0.5 - (M[1] * xw + M[5] * y0 + M[9] * zw + M[13]) / w * 0.5) * H;
      px += (qx - px) * e; py += (qy - py) * e;
    }
    out[0] = px; out[1] = py;
    return out;
  };
  const pts = sc.pts, n = pts.length / 2;
  const trace = () => {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const q = i % n, p = map(pts[2 * q], pts[2 * q + 1]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(GOLD, 0.1 * show); ctx.lineWidth = 7 * dpr; trace(); ctx.stroke();
  ctx.strokeStyle = rgba(GOLD, 0.8 * show); ctx.lineWidth = 1.2 * dpr; trace(); ctx.stroke();
  for (let j = 0; j < sc.N; j++) {
    const tj = sc.tau + (TAU * j) / sc.N;
    // les bras : la chaîne de cercles qui porte l'astre
    let x = 0, y = 0;
    ctx.lineWidth = dpr;
    for (let i = 0; i < sc.L.length; i++) {
      const a = sc.k[i] * tj + sc.phi[i], x2 = x + sc.L[i] * Math.cos(a), y2 = y + sc.L[i] * Math.sin(a);
      const p = map(x, y), sx = p[0], sy = p[1], q = map(x2, y2), ex = q[0], ey = q[1];
      const w = Math.max(0.15, 1 - i / sc.L.length);
      if (j === 0 && e < 1 && sc.L[i] * kf > 3 * dpr) {
        ctx.strokeStyle = rgba(AMBER, 0.14 * show * w * (1 - e) * (1 - e));
        ctx.beginPath(); ctx.arc(sx, sy, sc.L[i] * kf, 0, TAU); ctx.stroke();
      }
      ctx.strokeStyle = rgba(AMBER, (j === 0 ? 0.75 : 0.32) * show * w);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = rgba(AMBER, (j === 0 ? 0.8 : 0.35) * show * w);
      ctx.beginPath(); ctx.arc(sx, sy, 1.6 * dpr * w, 0, TAU); ctx.fill();
      x = x2; y = y2;
    }
    // l'astre (au bout de sa chaîne) et sa traîne (le long de la courbe)
    for (let q = 14; q >= 0; q--) {
      const v = (((tj / TAU - q * 0.006) % 1) + 1) % 1, i = Math.floor(v * n) % n;
      const p = q ? map(pts[2 * i], pts[2 * i + 1]) : map(x, y);
      const a = (q ? 0.5 * (1 - q / 15) : 1) * show, r = (q ? 2.2 : 3.4) * dpr * (1 - q / 22);
      if (!q) glow(p[0], p[1], 16 * dpr, GOLD, 0.55 * show);
      ctx.fillStyle = rgba(q ? GOLD : [255, 246, 230], a);
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
    }
  }
}

let frames = 0; // (images dessinées : contrôle de fluidité, ?debug)
// (trous de plus de 40 ms entre deux images : { at : horloge absolue, ms })
let lastDraw = 0;
const gaps = [];
// (?debug) sonde du processus graphique : une lecture d'un pixel WebGL fait
// l'aller-retour jusqu'à lui ; si elle tarde, c'est qu'il est bloqué (par la
// compilation d'un shader, par exemple), et l'affichage de la page avec lui,
// même si ce worker, lui, continue de tourner
const stalls = [];
function probe() {
  const gl = new OffscreenCanvas(4, 4).getContext('webgl');
  if (!gl) return;
  const px = new Uint8Array(4);
  setInterval(() => {
    const t0 = now();
    gl.clear(gl.COLOR_BUFFER_BIT); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const d = now() - t0;
    if (d > 25 && stalls.length < 400) stalls.push({ at: Math.round(performance.timeOrigin + t0), ms: Math.round(d) });
  }, 20);
}

function draw(t) {
  if (!running) return;
  raf(draw);
  frames++;
  const n = now();
  if (lastDraw && n - lastDraw > 40 && gaps.length < 200) gaps.push({ at: Math.round(performance.timeOrigin + n), ms: Math.round(n - lastDraw) });
  lastDraw = n;
  if (!ctx) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.clearRect(0, 0, W, H);
  const X = W / 2, Y = H * 0.47, R = Math.min(W * 0.3, H * 0.24);
  const fade = error ? 0.35 : 1;
  ctx.globalAlpha = fade;

  // ── au centre : le monde qui va s'ouvrir, sinon l'orbite trouvée, sinon l'essai en tête
  if (sc) sceneHero(t, X, Y, R * 0.78);
  else {
    let lead = found !== null ? tries.get(found) : null;
    if (!lead) for (const i of [...tries.keys()].sort((a, b) => a - b)) { const tr = tries.get(i); if (tr.state === 'run' && tr.pts) { lead = tr; break; } }
    if (lead?.pts) hero(lead, X, Y, R * 0.78, t, lead.state === 'ok');
  }
  // (à l'atterrissage, tout le reste s'efface : il ne reste que l'orbite, sur la scène)
  ctx.globalAlpha = fade * (sc ? (1 - sc.e) * (1 - sc.e) : 1);

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

  // ── les mondes de la plongée : un médaillon par couche
  {
    const n = worlds.have.length, r = R * 0.105, y = Y + R * 1.62, dx = r * 3.4;
    for (let i = 0; i < n; i++) {
      const x = X + (i - (n - 1) / 2) * dx, k = worlds.kept[i];
      const searching = step === 0 && i === worlds.cur && !k;
      ctx.lineWidth = dpr;
      ctx.strokeStyle = rgba(k || worlds.have[i] ? AMBER : DIM, k || worlds.have[i] ? 0.4 : searching ? 0.3 + 0.25 * Math.sin(t / 260) : 0.16);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      if (k) {
        const e = ease((t - k.t) / 700);
        ctx.strokeStyle = rgba(GOLD, 0.85 * e); ctx.lineWidth = 0.9 * dpr; ctx.lineJoin = 'round';
        path(k.pts, x, y, (r * 0.74 * (1.6 - 0.6 * e)) / k.f.s, k.f); ctx.stroke();
      } else if (worlds.have[i]) {
        ctx.fillStyle = rgba(AMBER, 0.6);
        ctx.beginPath(); ctx.arc(x, y, 1.6 * dpr, 0, TAU); ctx.fill();
      }
      // (un trait relie les médaillons : chaque monde est dans les astres du précédent)
      if (i < n - 1) {
        ctx.strokeStyle = rgba(DIM, 0.2);
        ctx.beginPath(); ctx.moveTo(x + r * 1.25, y); ctx.lineTo(x + dx - r * 1.25, y); ctx.stroke();
      }
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
    if (s === step && !error) {
      // (durée inconnue : l'arc avance en ralentissant ; connue : il suit l'avancement réel)
      if (prog === null) p = 1 - Math.exp(-(t - stepT) / 2500);
      else { progShown += (prog - progShown) * 0.12; p = progShown; }
    }
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
  else if (m.type === 'start') { if (!running) { running = true; lastDraw = 0; raf(draw); } }
  else if (m.type === 'stop') { running = false; tries.clear(); found = null; sc = null; if (ctx) ctx.clearRect(0, 0, W, H); }
  else if (m.type === 'layer') { keep(); worlds.cur = m.layer; worlds.have = m.have; worlds.kept[m.layer] = null; tries.clear(); found = null; sc = null; }
  else if (m.type === 'begin') { tries.clear(); found = null; sc = null; maxTries = m.max; error = false; }
  else if (m.type === 'clear') { tries.clear(); found = null; sc = null; step = 0; stepT = now(); error = false; prog = null; progShown = 0; worlds.kept = []; worlds.cur = 0; }
  else if (m.type === 'step') { if (m.step > 0) keep(); if (m.step !== step) { step = m.step; stepT = now(); prog = null; progShown = 0; } }
  else if (m.type === 'progress') prog = m.f;
  else if (m.type === 'error') error = m.on;
  else if (m.type === 'scene') {
    const { k, L, phi } = m.scene, n = 720, pts = new Float32Array(2 * n);
    let size = 1e-6;
    for (let q = 0; q < n; q++) {
      const t = (q / n) * TAU;
      let x = 0, y = 0;
      for (let i = 0; i < L.length; i++) { x += L[i] * Math.cos(k[i] * t + phi[i]); y += L[i] * Math.sin(k[i] * t + phi[i]); }
      pts[2 * q] = x; pts[2 * q + 1] = y; size = Math.max(size, Math.hypot(x, y));
    }
    sc = { ...m.scene, pts, size, tau: 0, off: 0, e: 0, th: 0, pose: null, land: null, slaved: false, t0: now(), last: now() };
  } else if (m.type === 'land' && sc) {
    // l'instant visé : celui de la scène (τ₀, angle du plateau θ₀), à un
    // échange d'astres près (τ₀ + 2πi/N : mêmes positions). On prend celui
    // qu'on atteint à peu près à l'allure normale, avec le moins de plateau à
    // rattraper.
    const { tau, th, M, y } = m.pose, stepT = TAU / sc.N, want = sc.tau + sc.rate * m.ms / 1000;
    const wrap = (a) => a - TAU * Math.round(a / TAU);
    let best = null;
    const i0 = Math.ceil((sc.tau - tau) / stepT);
    for (let i = i0; i < i0 + 6 * sc.N; i++) {
      const to = tau + i * stepT, off = wrap(th - sc.omega * to);
      const cost = Math.abs(to - want) / Math.max(1e-6, Math.abs(sc.rate)) + Math.abs(off) * 0.5;
      if (!best || cost < best.cost) best = { to, off, cost };
    }
    sc.pose = { M, y };
    sc.land = { t0: now(), D: m.ms, from: sc.tau, to: best.to, off: best.off };
  } else if (m.type === 'pose' && sc) {
    // (pendant le fondu : la scène donne le temps, l'angle et la projection)
    if (!sc.land) { sc.slaved = true; sc.tau = m.pose.tau; sc.th = m.pose.th; sc.e = 1; }
    sc.pose = { M: m.pose.M, y: m.pose.y };
  }
  else if (m.type === 'stats') self.postMessage({ type: 'stats', frames, t: now(), gaps: gaps.splice(0), stalls: stalls.splice(0) });
  else if (m.type === 'probe') probe();
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
