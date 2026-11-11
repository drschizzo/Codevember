// Allures : comment chaque famille avance en changeant ses tensions, et la
// boucle refermée par point fixe. Fonctions pures (worker, tests, Node).
//
// Le film d'une scène est l'enregistrement d'un pas complet, au repos au
// début et à la fin ; la fin est le début déplacé (translation et léger lacet)
// et, pour le Culbute, ré-étiqueté par une symétrie du prisme (toutes les
// barres se ressemblent : l'image est la même). La simulation tourne pas après
// pas jusqu'à son cycle limite : l'état d'arrivée, recalé sur l'état de départ
// (Horn / Kabsch, permutation comprise), devient le départ suivant.
import { buildTopology } from './topology.js';
import { formFind, createSim, align3D, rms, planarFit } from './sim.js';
import { CULBUTE_TABLE } from './culbuteTable.js';

export const REC_HZ = 240; // images enregistrées par seconde (temps physique)

// une rampe lisse de 0 à 1 (dérivée nulle aux deux bouts)
export const ramp = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// pose la structure sur le sol et la laisse se poser
export function settle(T, opt, time = 2.5) {
  const miny = Math.min(...T.nodes.map((nd) => nd.p[1] - nd.r));
  const T2 = { ...T, nodes: T.nodes.map((nd) => ({ ...nd, p: [nd.p[0], nd.p[1] - miny + 0.003, nd.p[2]] })) };
  const S = createSim(T2, opt);
  S.run(time);
  return S;
}
const centroid = (x, N) => { let a = 0, b = 0, c = 0; for (let i = 0; i < N; i++) { a += x[i * 3]; b += x[i * 3 + 1]; c += x[i * 3 + 2]; } return [a / N, b / N, c / N]; };
// lacet d'une matrice de rotation (autour de y), en radians
const yawOf = (R) => Math.atan2(R[0][2], R[0][0]);
const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// ── Culbute ─────────────────────────────────────────────────────────────────
// Un basculement : deux câbles raccourcissent de la part k (leurs treuils
// enroulent), tiennent, puis se relâchent. Profil fixé dans le temps.
export const TIP = { pull: 1.5, hold: 0.3, release: 0.75, rest: 0.8 };
export const tipDuration = (P = TIP) => P.pull + P.hold + P.release + P.rest;
export function tipK(t, k, P = TIP) {
  if (t <= 0) return 0;
  if (t < P.pull) return k * ramp(t / P.pull);
  if (t < P.pull + P.hold) return k;
  return k * (1 - ramp((t - P.pull - P.hold) / P.release));
}

// permutations des étiquettes du prisme par son groupe de symétrie D_n :
// rotations autour de l'axe (a_i → a_{i+r}) et retournements (a_i ↔ b_{r−i})
export function prismPerms(n) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(Array.from({ length: 2 * n }, (_, i) => (i < n ? (i + r) % n : n + ((i - n + r) % n))));
    out.push(Array.from({ length: 2 * n }, (_, i) => (i < n ? n + (((r - i) % n) + n) % n : (((r - (i - n)) % n) + n) % n)));
  }
  return out;
}
// le câble qui relie les images (par perm) des extrémités du câble c
export function mapCable(T, c, perm) {
  const a = perm[T.cables[c].i], b = perm[T.cables[c].j];
  return T.cables.findIndex((q) => (q.i === a && q.j === b) || (q.i === b && q.j === a));
}
// la symétrie (et le déplacement rigide) qui envoie l'état X sur l'état de référence X0
function matchSym(X0, X, N, perms) {
  let best = null;
  for (const perm of perms) { const A = align3D(X0, X, N, perm); if (!best || A.rms < best.rms) best = { ...A, perm }; }
  return best;
}

function runTip(S, pair, k) {
  const L = pair.map((c) => S.cables[c].L0), t0 = S.t;
  S.run(tipDuration(), (S) => { const kk = tipK(S.t - t0, k); pair.forEach((c, i) => (S.cables[c].rest = L[i] * (1 - kk))); });
}

// primitives : depuis la pose de départ, toutes les paires de câbles qui font
// basculer d'une face entière (le centre se déplace d'au moins `minMove`),
// chacune à la plus petite contraction (plus une marge), avec leur déplacement
// et leur changement de cap (lacet modulo la symétrie)
export function findPrimitives(S, perms, { minMove = 0.6, ks = [0.2, 0.27, 0.35, 0.45] } = {}) {
  const snap = S.snapshot(), N = S.N, X0 = Float64Array.from(S.x), c0 = centroid(X0, N);
  const NC = S.cables.length, out = [];
  const trial = (a, b, k) => {
    S.restore(snap); runTip(S, [a, b], k);
    const c = centroid(S.x, N), dx = c[0] - c0[0], dz = c[2] - c0[2];
    if (Math.hypot(dx, dz) < minMove || S.kinetic() > 0.5) return null;
    const M = matchSym(X0, S.x, N, perms);
    if (M.rms > 0.08) return null;
    return { dx, dz, yaw: yawOf(M.R), rms: M.rms };
  };
  for (let a = 0; a < NC; a++) for (let b = a + 1; b < NC; b++) {
    let hit = null, kHit = 0;
    for (const k of ks) { const r = trial(a, b, k); if (r) { hit = r; kHit = k; break; } }
    if (!hit) continue;
    // affiner : la plus petite contraction qui bascule encore, plus 12 %
    let lo = kHit === ks[0] ? 0.1 : ks[ks.indexOf(kHit) - 1], hi = kHit;
    for (let it = 0; it < 4; it++) { const mid = (lo + hi) / 2; if (trial(a, b, mid)) hi = mid; else lo = mid; }
    const k = Math.min(0.55, hi * 1.12 + 0.015);
    const r = trial(a, b, k);
    if (!r) continue;
    out.push({ pair: [a, b], k, ...r });
  }
  S.restore(snap);
  return out;
}

// ── Chenille ────────────────────────────────────────────────────────────────
// Une onde : les câbles axiaux du module k raccourcissent puis reviennent,
// de la queue (x faible) vers la tête, chaque module décalé d'un retard.
export function waveK(m, P, t) {
  const out = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const s = (t - k * P.lag) / P.pulse;
    out[k] = s <= 0 || s >= 1 ? 0 : P.amp * Math.sin(Math.PI * s) ** 2;
  }
  return out;
}

// ── Cerceau ─────────────────────────────────────────────────────────────────
// angle de roulement de la jante et son centre (nœuds de jante seulement)
function rimState(S, T) {
  let cx = 0, cy = 0, n = 0;
  for (let i = 0; i < 2 * T.m; i++) { cx += S.x[i * 3]; cy += S.x[i * 3 + 1]; n++; }
  cx /= n; cy /= n;
  let s = 0, c = 0;
  for (let k = 0; k < T.m; k++) {
    const i = k * 2, a = Math.atan2(S.x[i * 3 + 1] - cy, S.x[i * 3] - cx) - (2 * Math.PI * (k + 0.5)) / T.m;
    s += Math.sin(a); c += Math.cos(a);
  }
  return { a: Math.atan2(s, c), cx, cy };
}

function simOptions(T) {
  if (T.family === 'chenille') {
    const nodes = new Set(T.nodes.map((nd, i) => i));
    const n = T.n, m = T.m;
    // direction avant : de l'anneau de queue vers l'anneau de tête
    const fwd = (i, x) => {
      let tx = 0, tz = 0, hx = 0, hz = 0;
      for (let q = 0; q < n; q++) { tx += x[q * 3]; tz += x[q * 3 + 2]; hx += x[(m * n + q) * 3]; hz += x[(m * n + q) * 3 + 2]; }
      const dx = hx - tx, dz = hz - tz, l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    return { damp: 0.8, skid: { nodes, front: 0.06, back: 1.2, side: T.side ?? 0.9, fwd } };
  }
  if (T.family === 'cerceau') return { damp: 1.5, mu: 1.0, muK: 0.8, iters: 2, h: 1 / 8000 };
  return { damp: 0.7 };
}

// un pas complet, éventuellement enregistré
function runStep(T, init, prog, opt, { record = false } = {}) {
  const S = createSim(T, opt);
  S.restore(init);
  const frames = [], rests = [], events = [];
  let nextRec = S.t, calm = 0;
  const rec = () => { frames.push(Float32Array.from(S.x)); rests.push(Float32Array.from(S.cables.map((c) => c.rest))); };
  while (true) {
    if (record && S.t >= nextRec - 1e-9) { rec(); nextRec += 1 / REC_HZ; }
    prog.ctrl(S, events);
    S.step();
    if (S.t >= prog.end) {
      calm = S.kinetic() < 3e-4 ? calm + S.h : 0;
      if (calm > 0.35 || S.t > prog.end + 2.5) break;
    }
  }
  if (record) rec();
  return { S, frames, rests, events, time: S.t };
}

// ── Préparation d'une scène : forme, allure, cycle limite, enregistrement ──
export function prepare(spec, onProgress = () => {}) {
  const T0 = buildTopology(spec);
  const T = formFind(T0, { pre: spec.pre ?? 0.04, k: spec.k ?? 2500, h: T0.family === 'cerceau' ? 1 / 8000 : 1 / 6000 });
  if (spec.side) T.side = spec.side;
  const opt = simOptions(T);
  const N = T.nodes.length;
  onProgress(0.04, 'form');
  let S = settle(T, opt, 2.5);
  let init = { ...S.snapshot(), t: 0 };
  let program, perms = [Array.from({ length: N }, (_, i) => i)];

  if (T.family === 'culbute') {
    perms = prismPerms(T.n);
    // (table précalculée par tools/precompute.mjs pour les prismes du catalogue ;
    //  sinon, recherche complète — plusieurs dizaines de secondes)
    const tab = spec.table === false ? null : (spec.table ?? CULBUTE_TABLE[`${T.n}`]);
    const prims = tab?.prims ?? findPrimitives(S, perms);
    onProgress(0.3, 'gait');
    if (prims.length < 2) throw new Error('aucun basculement trouvé');
    // séquence : à chaque basculement, la primitive qui avance vers +x du
    // monde et ramène le cap vers 0 ; on s'arrête au nombre de basculements
    // (entre kMin et kMax) dont le cap final est le plus proche de 0
    const X0 = Float64Array.from(init.x);
    const kMin = spec.tipsMin ?? 6, kMax = spec.tipsMax ?? 14;
    const seq = [], heads = [];
    const plan = (S, j = null) => {
      const M = matchSym(X0, S.x, N, perms);
      // +x du monde vu dans le repère de départ
      const fx = M.R[0][0], fz = M.R[2][0], heading = -yawOf(M.R);
      if (j === null) {
        let best = null;
        for (let q = 0; q < prims.length; q++) {
          const p = prims[q], dl = Math.hypot(p.dx, p.dz), cos = (p.dx * fx + p.dz * fz) / dl;
          if (cos < 0.8) continue;
          const h = wrapPi(heading - p.yaw);
          // (cap ramené dans (−π/2, π/2] pour la direction de marche : la pose de repos
          //  a une symétrie d'ordre 2 verticale, à peu près)
          const hm = Math.abs(h) > Math.PI / 2 ? Math.PI - Math.abs(h) : Math.abs(h);
          const score = -hm * 4 - p.k + 0.2 * cos;
          if (!best || score > best.score) best = { q, score };
        }
        j = best ? best.q : 0;
      }
      return { j, pair: prims[j].pair.map((c) => mapCable(T, c, M.perm)), k: prims[j].k };
    };
    // recherche de la séquence
    S.restore(init);
    if (tab?.seq) seq.push(...tab.seq);
    else for (let t = 0; t < kMax; t++) {
      const p = plan(S);
      seq.push(p.j);
      runTip(S, p.pair, p.k);
      // cap vrai (modulo 2π) : la boucle doit finir dans le même cap qu'elle commence,
      // pas retournée de 180° (la pose de repos n'est symétrique qu'à peu près)
      const M = matchSym(X0, S.x, N, perms);
      heads.push(wrapPi(-yawOf(M.R)));
      onProgress(0.3 + 0.2 * (t + 1) / kMax, 'gait');
    }
    if (!tab?.seq) {
      let K = kMin;
      for (let t = kMin; t <= kMax; t++) if (Math.abs(heads[t - 1]) < Math.abs(heads[K - 1]) - 0.004) K = t;
      seq.length = K;
    }
    const lead = spec.lead ?? 0.4, dur = tipDuration();
    program = () => {
      let k = -1, cur = null;
      return {
        ctrl(S, events) {
          const kk = Math.floor((S.t - lead) / dur);
          if (kk !== k && kk < seq.length && S.t >= lead) {
            k = kk; cur = plan(S, seq[k]); cur.t0 = S.t; cur.L = cur.pair.map((c) => S.cables[c].L0);
            events.push({ t: S.t, pair: cur.pair, k: cur.k });
          }
          if (cur) { const c = tipK(S.t - cur.t0, cur.k); cur.pair.forEach((q, i) => (S.cables[q].rest = cur.L[i] * (1 - c))); }
        },
        end: lead + seq.length * dur,
      };
    };
    program.seq = seq;
    program.heads = heads;
    program.prims = prims;
  } else if (T.family === 'chenille') {
    const P = { amp: spec.amp ?? 0.34, pulse: spec.pulse ?? 1.1, lag: spec.lag ?? 0.45, waves: spec.waves ?? 4, gap: spec.gap ?? 0.35, lead: 0.3, steer: spec.steer ?? 0, trim: spec.trim ?? 0, alt: spec.alt ?? 1 };
    const axial = T.cables.map((c, i) => (c.kind === 'axial' ? i : -1)).filter((i) => i >= 0);
    const waveDur = P.pulse + (T.m - 1) * P.lag + P.gap;
    const n = T.n, m = T.m;
    // cap du corps (de la queue vers la tête) ; les câbles d'un côté se
    // contractent un peu plus que ceux de l'autre pour tenir le cap (on
    // corrige la dérive due à la chiralité des modules, comme un ver qui se
    // redresse)
    const axis = (x) => {
      let tx = 0, tz = 0, hx = 0, hz = 0;
      for (let q = 0; q < n; q++) { tx += x[q * 3]; tz += x[q * 3 + 2]; hx += x[(m * n + q) * 3]; hz += x[(m * n + q) * 3 + 2]; }
      return { a: Math.atan2(hz - tz, hx - tx), cx: (tx + hx) / (2 * n), cz: (tz + hz) / (2 * n) };
    };
    program = () => {
      let h0 = null;
      return {
        ctrl(S, events) {
          const ax = axis(S.x);
          if (h0 === null) h0 = ax.a;
          const e = Math.atan2(Math.sin(ax.a - h0), Math.cos(ax.a - h0));
          const t = S.t - P.lead;
          const w = Math.floor(t / waveDur);
          if (t < 0 || w >= P.waves) { for (const c of axial) S.cables[c].rest = S.cables[c].L0; return; }
          if (events.length < w + 1) events.push({ t: S.t });
          let kk = waveK(T.m, P, t - w * waveDur);
        // (une onde sur deux part de la tête : la chiralité des modules fait
        //  tourner le corps d'un côté dans un sens, de l'autre dans l'autre)
        if (P.alt && w % 2 === 1) kk = kk.slice().reverse();
          const ux = Math.cos(ax.a), uz = Math.sin(ax.a);
          for (const c of axial) {
            const C = S.T.cables[c], i = C.i, j = C.j;
            // côté du câble : produit vectoriel (axe × position relative), signe de y
            const px = (S.x[i * 3] + S.x[j * 3]) / 2 - ax.cx, pz = (S.x[i * 3 + 2] + S.x[j * 3 + 2]) / 2 - ax.cz;
            const side = Math.max(-1, Math.min(1, (uz * px - ux * pz) / (T.w * 0.5)));
            const g = 1 + P.steer * e * side + P.trim * side;
            S.cables[c].rest = S.cables[c].L0 * (1 - Math.max(0, Math.min(0.5, kk[C.mod] * g)));
          }
        },
        end: P.lead + P.waves * waveDur,
      };
    };
  } else {
    // Cerceau : commande en angle. Le moyeu est placé, par la longueur de ses
    // rayons, à un décalage o du centre de la jante ; son poids décalé fait
    // rouler la jante. o suit une consigne (proportionnelle, dérivée) à travers
    // un filtre du premier ordre (les bobines ont une vitesse finie).
    const P = { dur: spec.dur ?? 8, start: 0.5, omax: spec.omax ?? 1.25, kp: 1.4, kd: 0.6, tau: 0.22, pre: 0.02, drop: 0.25 };
    const spokes = T.cables.map((c, i) => (c.kind === 'spoke' ? i : -1)).filter((i) => i >= 0);
    const [h0, h1] = T.hub;
    const turns = spec.turns ?? 1;
    // géométrie nominale (forme d'équilibre, moyeu au centre) : la longueur de
    // consigne d'un rayon ne dépend que de l'angle de la jante et du décalage
    // voulu, jamais des positions déformées (sinon le rayon n'a plus de raideur)
    const hubC = [(T.nodes[h0].p[0] + T.nodes[h1].p[0]) / 2, (T.nodes[h0].p[1] + T.nodes[h1].p[1]) / 2];
    const nom = spokes.map((c) => {
      const C = T.cables[c], q = T.nodes[C.j].p, hz = T.nodes[C.side ? h1 : h0].p[2];
      return { c, px: q[0] - hubC[0], py: q[1] - hubC[1], dz: q[2] - hz, L0: T.cables[c].L0 };
    });
    const aRef = (() => { let s = 0, c = 0; for (let k = 0; k < T.m; k++) { const q = T.nodes[k * 2].p, a = Math.atan2(q[1] - hubC[1], q[0] - hubC[0]) - (2 * Math.PI * (k + 0.5)) / T.m; s += Math.sin(a); c += Math.cos(a); } return Math.atan2(s, c); })();
    program = () => {
      const st = { turns: 0, prev: null, ox: 0, oy: 0, w: 0, rp: 0 };
      return {
        ctrl(S, events) {
          const { a } = rimState(S, T);
          if (st.prev === null) { st.prev = a; events.push({ t: P.start }); }
          let da = a - st.prev; da -= 2 * Math.PI * Math.round(da / (2 * Math.PI)); st.prev = a;
          st.turns += da;
          const rolled = -st.turns; // (rouler vers +x : sens horaire vu de +z)
          const w = (rolled - st.rp) / S.h; st.rp = rolled;
          st.w += (w - st.w) * Math.min(1, S.h / 0.03);
          const s = (S.t - P.start) / P.dur;
          const ref = 2 * Math.PI * turns * ramp(s);
          const wref = s > 0 && s < 1 ? (2 * Math.PI * turns * 6 * s * (1 - s)) / P.dur : 0;
          let ox = P.kp * (ref - rolled) + P.kd * (wref - st.w);
          ox = Math.max(-1, Math.min(1, ox)) * P.omax;
          // fin du tour : le moyeu revient au centre, la jante se pose sur un plat ;
          // les moteurs du moyeu freinent (le balancement s'éteint vite)
          if (s > 0.97) ox *= 1 - ramp((s - 0.97) / 0.08);
          S.damp = s > 1.02 ? 1.5 + 4 * ramp((s - 1.02) / 0.1) : 1.5;
          const oy = -P.drop * Math.abs(ox);
          const f = Math.min(1, S.h / P.tau);
          st.ox += (ox - st.ox) * f; st.oy += (oy - st.oy) * f;
          // rim nominale tournée de l'angle courant ; moyeu décalé de (ox, oy) dans le repère du monde
          if (spec.trace && Math.abs(S.t * 4 - Math.round(S.t * 4)) < S.h * 2) { const c = S.com(); console.log(S.t.toFixed(2), 'rolled', rolled.toFixed(2), 'ref', ref.toFixed(2), 'ox', st.ox.toFixed(2), 'com', c.map((v) => v.toFixed(2)).join(' ')); }
          const th = a - aRef, ct = Math.cos(th), sn = Math.sin(th);
          for (const q of nom) {
            const px = ct * q.px - sn * q.py, py = sn * q.px + ct * q.py;
            const L = Math.hypot(px - st.ox, py - st.oy, q.dz);
            S.cables[q.c].rest = q.L0 * (L / Math.hypot(q.px, q.py, q.dz));
          }
        },
        end: P.start + P.dur,
      };
    };
  }

  // ── point fixe : pas après pas jusqu'au cycle limite ──
  let residual = Infinity, it = 0;
  const maxIt = spec.iters ?? 6;
  const back = new Float64Array(3 * N);
  // l'arrivée, ramenée sur le départ par la symétrie et le déplacement plan
  // (lacet et translation : le sol est plat, rien d'autre n'est permis) ;
  // parmi les symétries, celle qui colle le mieux (match 3D), puis l'ajustement plan
  const relabel = (Xend) => {
    const M = matchSym(init.x, Xend, N, perms);
    const fit = planarFit(Xend, init.x, N, invPerm(M.perm)); // (Xend[i] ↔ init[inv[i]])
    const inv = invPerm(M.perm);
    for (let i = 0; i < N; i++) {
      const x = fit.c * Xend[i * 3] - fit.s * Xend[i * 3 + 2] + fit.t[0], z = fit.s * Xend[i * 3] + fit.c * Xend[i * 3 + 2] + fit.t[1];
      const q = inv[i];
      back[q * 3] = x; back[q * 3 + 1] = Xend[i * 3 + 1]; back[q * 3 + 2] = z;
    }
    return { ...M, fit };
  };
  for (it = 0; it < maxIt; it++) {
    const r = runStep(T, init, program(), opt);
    relabel(r.S.x);
    residual = rms(back, init.x, N);
    onProgress(0.5 + 0.4 * (it + 1) / maxIt, 'cycle');
    init = { x: Float64Array.from(back), v: new Float64Array(3 * N), t: 0, rest: T.cables.map((c) => c.L0) };
    if (spec.verbose) console.log('it', it, 'res', residual.toExponential(2), 'time', r.time.toFixed(2));
    if (residual < 2e-4) break;
  }
  const r = runStep(T, init, program(), opt, { record: true });
  onProgress(0.97, 'record');
  const M = relabel(r.S.x);
  const cA = centroid(init.x, N), cB = centroid(r.S.x, N);
  // symétrie du raccord : celle qui laisse le moins de lacet (le film doit
  // finir dans le même cap qu'il commence), parmi celles qui collent bien
  let seamPerm = M.perm, best = null;
  for (const perm of perms) {
    const f = planarFit(init.x, r.S.x, N, perm);
    if (Math.abs(f.th) > Math.PI / 6) continue;
    if (!best || f.rms < best.rms) best = { ...f, perm };
  }
  if (best) seamPerm = best.perm;
  return {
    T: { ...T, nodes: T.nodes.map((nd, i) => ({ ...nd, p: [init.x[i * 3], init.x[i * 3 + 1], init.x[i * 3 + 2]] })) },
    frames: r.frames, rests: r.rests, events: r.events, time: r.time,
    d: [cB[0] - cA[0], cB[2] - cA[2]], yaw: best ? best.th : 0, perm: seamPerm, seamRms: best ? best.rms : null, 
    residual, iters: it + 1, finalErr: rms(back, init.x, N), seq: program.seq ?? null, heads: program.heads ?? null, prims: program.prims ?? null,
  };
}

function invPerm(p) { const q = new Array(p.length); p.forEach((j, i) => (q[j] = i)); return q; }
