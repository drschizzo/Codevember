// Tangle — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// On regarde la corde de la scène pendant que la simulation la calcule : le
// worker de génération envoie en route quelques états de la tige de Cosserat
// (gen/sim.js), relayés ici ; on les rejoue à un pas plus calme que le calcul
// (jamais en avance sur lui). Le mandrin tourne, la rayure s'enroule en hélice,
// puis, au seuil, la corde flambe en boucle et s'enroule en torsade ; la
// glissière s'écarte, le balancier tourne et la torsade se défait. Une fois la
// simulation finie, la boucle enregistrée tourne en rond pendant que la
// lumière se prépare ; la corde, d'abord gris de mine, prend ses couleurs.
// À la fin, on s'approche d'elle en s'effaçant.
//
// Avant les premières données (le moteur se télécharge) : la corde pend,
// droite, et sa rayure commence à peine à tourner.
import { rodSpec, makePlan } from '../plan.js';
import { Q_DOWN, yRot } from '../gen/rod.js';

const TAU = Math.PI * 2;
const ARM = 0.235, HUB_R = 0.024, HUB_H = 0.05;

// sommets et segments de chaque brin (gen/rod.js, gen/sim.js : la ligne d'un état)
function topology(family) {
  const spec = rodSpec(family);
  const strands = [];
  let nv = 0, ns = 0;
  for (const st of spec.strands) { strands.push({ n: st.n, v0: nv, s0: ns, top: st.top }); nv += st.n + 1; ns += st.n; }
  return { strands, nv, ns, stride: nv * 3 + ns * 4 + 4, L: spec.L, r: spec.r, rail: spec.rail };
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const rgba = (c, a) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
const GRAPHITE = [0.72, 0.71, 0.69], IVORY = [0.93, 0.91, 0.87];
// couleurs d'une palette de corde [gaine, tressage, rayure], lisibles sur le noir
function palette(c) {
  let body = hex(c[0]);
  const L = lum(body);
  if (L < 0.32) body = mix(body, IVORY, (0.32 - L) / (0.95 - L)); // (une corde sombre s'éclaircit, sans perdre sa teinte)
  let stripe = hex(c[2]);
  if (Math.abs(lum(stripe) - lum(body)) < 0.18) stripe = lum(body) > 0.5 ? [0.08, 0.08, 0.09] : IVORY;
  return { body, stripe };
}

export default function createArt() {
  let topo = topology('cordon');
  let cols = [palette(['#e6dfd0', '#cfc6b2', '#b3261e']), palette(['#1d2b4a', '#121c33', '#eae6dc'])];
  let stripes = 1, side = 0.5, plan = null;
  // états connus : en route (live) puis la boucle enregistrée (replay)
  let src = { taus: [], rows: [] }, P = 0, done = false;
  let tauD = 0, y0 = null, buckles = [], lit = 0.2, shown = 0, t0Data = -1;
  let cur = new Float64Array(topo.stride);
  const segs = [];

  function reset() {
    src = { taus: [], rows: [] }; P = plan?.P ?? 0; done = false;
    tauD = 0; y0 = null; buckles = [];
    cur = new Float64Array(topo.stride);
  }
  // premier flambage de chaque cycle : le balancier remonte de 1 cm (comme gen/sim.js)
  function scan(tau, row) {
    if (y0 === null) y0 = row[topo.stride - 4];
    if (!plan) return;
    plan.cycles.forEach((c, k) => {
      if (buckles[k] === undefined && tau > c.t0 && tau < c.free0 && row[topo.stride - 4] - y0 > 0.01) buckles[k] = tau;
    });
  }
  function add(taus, rows) {
    const n = taus.length, st = topo.stride;
    if (rows.length !== n * st) return; // (une autre corde : données d'un chargement remplacé)
    for (let i = 0; i < n; i++) {
      const row = rows.subarray(i * st, (i + 1) * st);
      src.taus.push(taus[i]); src.rows.push(row);
      scan(taus[i], row);
    }
  }

  // ── vitesse de lecture en temps physique : calme pendant la torsion, lente au
  // flambage, rapide pendant les longs retours au repos ──
  function speed(tau) {
    if (!plan) return 1.6;
    for (let k = 0; k < plan.cycles.length; k++) {
      const c = plan.cycles[k];
      if (tau < c.t0) return 4;
      if (tau < c.free0) {
        const b = buckles[k];
        if (b !== undefined && tau > b - 0.6 && tau < b + 1.4) return 0.9;
        return 2.2;
      }
      if (tau < c.free1) return tau - c.free0 < 3.2 ? 1.5 : 5;
    }
    return 5;
  }

  // état à τ : interpolé entre deux états connus (positions, repères, balancier)
  function sample(tau) {
    const T = src.taus, n = T.length, st = topo.stride;
    if (!n) return synth(tau);
    let lo = 0, hi = n - 1;
    if (tau <= T[0]) hi = 0; else if (tau >= T[n - 1]) lo = hi = n - 1;
    else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= tau) lo = m; else hi = m; } }
    const a = src.rows[lo], b = src.rows[hi], u = hi > lo ? (tau - T[lo]) / (T[hi] - T[lo]) : 0;
    const q0 = topo.nv * 3, q1 = q0 + topo.ns * 4;
    for (let k = 0; k < q0; k++) cur[k] = a[k] + (b[k] - a[k]) * u;
    for (let o = q0; o < q1; o += 4) {
      const sg = a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3] < 0 ? -1 : 1;
      let x = a[o] + (sg * b[o] - a[o]) * u, y = a[o + 1] + (sg * b[o + 1] - a[o + 1]) * u, z = a[o + 2] + (sg * b[o + 2] - a[o + 2]) * u, w = a[o + 3] + (sg * b[o + 3] - a[o + 3]) * u;
      const s = 1 / Math.hypot(x, y, z, w);
      cur[o] = x * s; cur[o + 1] = y * s; cur[o + 2] = z * s; cur[o + 3] = w * s;
    }
    for (let k = q1; k < st; k++) cur[k] = a[k] + (b[k] - a[k]) * u;
    return cur;
  }
  // (sans données : la corde pend, droite, et sa rayure commence à tourner)
  const qq = new Float64Array(4);
  function synth(t) {
    const { strands, L, nv, stride } = topo, turn = 0.35 * Math.min(1, t / 6) + 0.12 * Math.sin(t * 0.5);
    for (const s of strands) {
      for (let i = 0; i <= s.n; i++) {
        const o = (s.v0 + i) * 3;
        cur[o] = s.top[0]; cur[o + 1] = -L * (i / s.n); cur[o + 2] = s.top[2];
      }
      for (let i = 0; i < s.n; i++) { yRot(turn * (1 - (i + 0.5) / s.n), Q_DOWN, qq); cur.set(qq, nv * 3 + (s.s0 + i) * 4); }
    }
    cur[stride - 4] = -L - 0.012; cur[stride - 3] = 0; cur[stride - 2] = turn;
    return cur;
  }

  // ── projection : vue de face, un peu plongeante, qui se balance lentement ──
  let cyaw = 1, syaw = 0, cpit = 1, spit = 0, sc = 1, cx = 0, cy = 0, persp = 2.4;
  const out = [0, 0, 0];
  function proj(x, y, z) {
    const xr = x * cyaw - z * syaw, zr = x * syaw + z * cyaw;
    const yc = y + 0.33, yr = yc * cpit - zr * spit, zz = yc * spit + zr * cpit;
    const f = persp / (persp - zz);
    out[0] = cx + xr * sc * f; out[1] = cy - yr * sc * f; out[2] = zz;
    return out;
  }
  // direction (sans translation) : composante vers l'observateur
  const towards = (x, y, z) => { const zr = x * syaw + z * cyaw; return y * spit + zr * cpit; };

  function axis(q, o, k) {
    const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
    if (k === 0) return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  }

  return {
    data(d) {
      if (d.kind === 'recipe') {
        topo = topology(d.family);
        plan = makePlan({ cycles: d.cycles });
        cols = d.colors.map(palette);
        stripes = d.stripes || 1; side = d.side ?? 0.5;
        reset();
        t0Data = -1;
      } else if (d.kind === 'live') {
        if (done) return;
        P = d.P; add(d.taus, d.rows);
      } else if (d.kind === 'replay') {
        // (la boucle enregistrée, corrigée à son raccord, remplace les états en route)
        const keepT = tauD;
        src = { taus: [], rows: [] }; y0 = null; buckles = [];
        P = d.P; done = true;
        add(d.taus, d.rows);
        tauD = keepT;
      }
      if (d.then) this.data(d.then); // (plusieurs messages en un : planches de contrôle)
    },
    draw(ctx, S) {
      const { w, h, dpr, dt, t } = S;
      // ── le temps de la corde ──
      if (src.taus.length) {
        if (t0Data < 0) t0Data = t;
        const v = speed(tauD) * (S.error ? 0.15 : 1);
        if (done) { tauD += dt * v; if (P > 0 && tauD >= P) tauD -= P; }
        else {
          const ahead = src.taus[src.taus.length - 1] - 0.15 - tauD; // (jamais en avance sur le calcul)
          tauD += dt * Math.max(0, Math.min(v, ahead * 2));
        }
      }
      const fr = sample(src.taus.length ? tauD : t);
      const { strands, nv, stride, r } = topo;
      // couleur : gris de mine pendant le calcul, la scène s'allume pendant la préparation
      const target = S.stepIdx >= 3 ? 1 : S.stepIdx === 2 ? 0.6 + 0.3 * S.real : S.stepIdx === 1 ? 0.28 : 0.18;
      lit += (target - lit) * Math.min(1, dt * 1.6);
      shown = Math.min(1, shown + dt * 1.5);

      // ── cadrage ──
      const d = S.done, zoom = 1 + 0.55 * d * d, alpha = (1 - d) * (0.25 + 0.75 * shown);
      const yaw = -0.35 * Math.sign(side || 1) + 0.22 * Math.sin(t * 0.11), pitch = 0.16 + 0.03 * Math.sin(t * 0.07);
      cyaw = Math.cos(yaw); syaw = Math.sin(yaw); cpit = Math.cos(pitch); spit = Math.sin(pitch);
      sc = Math.min((h * 0.7) / 0.72, (w * 0.86) / 0.56) * zoom;
      cx = w / 2; cy = h * 0.43 + d * d * h * 0.04;
      const lw = Math.max(1, dpr * 0.8);
      ctx.globalAlpha = alpha;

      // halo : la lumière de la scène qui se prépare
      const hy = proj(0, -0.33, 0)[1];
      const halo = ctx.createRadialGradient(cx, hy, 0, cx, hy, Math.min(w, h) * 0.5);
      const warm = mix([1, 0.86, 0.66], cols[0].body, 0.25);
      halo.addColorStop(0, rgba(warm, 0.03 + 0.07 * lit)); halo.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);

      const line = (c, a) => rgba(c, a);
      const fly = { y: fr[stride - 4], phi: fr[stride - 3], theta: fr[stride - 2] };
      // ── le bâti, en traits fins : traverse, colonnes qui s'effacent vers le bas ──
      ctx.lineCap = 'round'; ctx.lineWidth = lw;
      for (const sx of [-1, 1]) {
        const a = [...proj(sx * 0.34, 0.07, 0.024)], b = [...proj(sx * 0.34, -0.62, 0.024)];
        const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
        g.addColorStop(0, line(IVORY, 0.16)); g.addColorStop(1, line(IVORY, 0));
        ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.strokeStyle = line(IVORY, 0.2);
      let a = [...proj(-0.4, 0.07, 0.024)], b = [...proj(0.4, 0.07, 0.024)];
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();

      // le mandrin : un cylindre, et un repère qui tourne avec lui (le compte des tours)
      const ring = (y, R, alphaBack, alphaFront) => {
        ctx.beginPath();
        for (let i = 0; i <= 48; i++) { const p = proj(Math.cos((i / 48) * TAU) * R, y, Math.sin((i / 48) * TAU) * R); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
        ctx.strokeStyle = line(IVORY, alphaFront); ctx.stroke();
      };
      ctx.fillStyle = S.bg ?? '#050506';
      ring(0.065, 0.02, 0, 0.22); ring(0.002, 0.02, 0, 0.32);
      for (const sx of [-1, 1]) { a = [...proj(sx * 0.02 * cyaw, 0.065, -sx * 0.02 * syaw)]; b = [...proj(sx * 0.02 * cyaw, 0.002, -sx * 0.02 * syaw)]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      {
        // repère du mandrin : un point sur sa bague, du côté visible seulement
        const th = fly.theta, mx = Math.cos(th) * 0.02, mz = -Math.sin(th) * 0.02, vis = towards(mx, 0, mz) / 0.02;
        if (vis > -0.2) {
          const p = proj(mx, 0.002, mz);
          ctx.fillStyle = rgba(mix(cols[0].stripe, [1, 0.85, 0.6], 0.3), (0.35 + 0.65 * Math.max(0, vis)) * 0.9);
          ctx.beginPath(); ctx.arc(p[0], p[1], 2.2 * dpr, 0, TAU); ctx.fill();
        }
      }

      // ── la corde : segments triés par profondeur (les croisements se lisent) ──
      segs.length = 0;
      const q0 = nv * 3, rs = r * sc * 0.92;
      // rayure : pour chaque segment, le point de surface à l'angle φ du repère
      // matériel (décalage à l'écran) et sa visibilité (face à nous ou non)
      const byStrand = strands.map((s, k) => {
        const list = [];
        for (let i = 0; i < s.n; i++) {
          const o0 = (s.v0 + i) * 3, o1 = o0 + 3, qo = q0 + (s.s0 + i) * 4;
          const pa = [...proj(fr[o0], fr[o0 + 1], fr[o0 + 2])], pb = [...proj(fr[o1], fr[o1 + 1], fr[o1 + 2])];
          const d1 = axis(fr, qo, 0), d2 = axis(fr, qo, 1), st = [];
          for (let j = 0; j < stripes; j++) {
            const ph = Math.PI / 2 + j * Math.PI + k * 0.9, c = Math.cos(ph), sn = Math.sin(ph);
            const nr = [c * d1[0] + sn * d2[0], c * d1[1] + sn * d2[1], c * d1[2] + sn * d2[2]];
            const ox = (nr[0] * cyaw - nr[2] * syaw) * rs, oy = -(nr[1] * cpit - (nr[0] * syaw + nr[2] * cyaw) * spit) * rs;
            st.push({ x: (pa[0] + pb[0]) / 2 + ox, y: (pa[1] + pb[1]) / 2 + oy, vis: towards(...nr) });
          }
          const g = { k, i, pa, pb, z: (pa[2] + pb[2]) / 2, st };
          list.push(g); segs.push(g);
        }
        return list;
      });
      segs.sort((p, q) => p.z - q.z);
      const W = 2 * r * sc, gap = 1.6 * dpr;
      const bg = S.bg ?? '#050506';
      for (const g of segs) {
        const c = cols[g.k] ?? cols[0];
        const depth = Math.max(0, Math.min(1, 0.5 + g.z * 6));
        const body = mix(mix(GRAPHITE, c.body, lit), [0.02, 0.02, 0.03], 0.35 * (1 - depth));
        const [ax, ay] = g.pa, [bx, by] = g.pb;
        // (l'interstice : le fond, un peu plus large, sous chaque segment)
        ctx.lineCap = 'butt'; ctx.strokeStyle = bg; ctx.lineWidth = W + 2 * gap;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.lineCap = 'round'; ctx.strokeStyle = rgba(body, 1); ctx.lineWidth = W;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        // reflet le long du bord éclairé
        let nx = -(by - ay), ny = bx - ax;
        const ln = Math.hypot(nx, ny) || 1; nx /= ln; ny /= ln;
        if (nx > 0) { nx = -nx; ny = -ny; }
        ctx.strokeStyle = rgba([1, 0.97, 0.92], 0.1 + 0.22 * lit * depth); ctx.lineWidth = W * 0.22;
        ctx.beginPath(); ctx.moveTo(ax + nx * W * 0.24, ay + ny * W * 0.24); ctx.lineTo(bx + nx * W * 0.24, by + ny * W * 0.24); ctx.stroke();
        // la rayure : une ligne continue d'un milieu de segment à l'autre (l'hélice), vue seulement de face
        const L = byStrand[g.k], pv = L[g.i - 1], nx2 = L[g.i + 1];
        for (let j = 0; j < stripes; j++) {
          const m = g.st[j], vis = m.vis;
          if (vis < 0.08) continue;
          const p0 = pv ? pv.st[j] : null, p1 = nx2 ? nx2.st[j] : null;
          const sx0 = p0 && p0.vis > 0 ? (p0.x + m.x) / 2 : m.x - (bx - ax) / 2, sy0 = p0 && p0.vis > 0 ? (p0.y + m.y) / 2 : m.y - (by - ay) / 2;
          const sx1 = p1 && p1.vis > 0 ? (p1.x + m.x) / 2 : m.x + (bx - ax) / 2, sy1 = p1 && p1.vis > 0 ? (p1.y + m.y) / 2 : m.y + (by - ay) / 2;
          ctx.strokeStyle = rgba(mix(GRAPHITE, c.stripe, 0.35 + 0.65 * lit), Math.min(1, (vis - 0.08) * 3) * (0.55 + 0.45 * depth));
          ctx.lineWidth = Math.max(0.7 * dpr, W * 0.34 * vis); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(m.x, m.y); ctx.lineTo(sx1, sy1); ctx.stroke();
        }
      }

      // ── le balancier : moyeu, bras à boules (qui tourne quand la glissière s'ouvre) ──
      let hx = 0, hz = 0;
      for (const s of strands) { const o = (s.v0 + s.n) * 3; hx += fr[o]; hz += fr[o + 2]; }
      hx /= strands.length; hz /= strands.length;
      const yA = fly.y + 0.012, ya = yA - 0.025;
      const ex = Math.cos(fly.phi), ez = -Math.sin(fly.phi);
      const arm = (sx) => {
        const p = [...proj(hx, ya, hz)], q = [...proj(hx + sx * ARM * ex, ya, hz + sx * ARM * ez)];
        ctx.strokeStyle = line(IVORY, 0.42); ctx.lineWidth = lw * 1.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        const kr = 0.008 * sc * (persp / (persp - q[2]));
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(q[0], q[1], kr, 0, TAU); ctx.fill();
        ctx.strokeStyle = line(mix(IVORY, [0.91, 0.77, 0.54], lit), 0.5 + 0.3 * lit); ctx.lineWidth = lw;
        ctx.stroke();
        return q[2];
      };
      const zNear = towards(ex, 0, ez);
      // (le bras du fond, le moyeu, puis le bras de devant)
      arm(zNear >= 0 ? -1 : 1);
      {
        const top = yA - 0.004, bot = yA - HUB_H;
        const rim = (y, half) => {
          ctx.beginPath();
          for (let i = 0; i <= 40; i++) { const an = (half ? Math.PI : 0) + (i / 40) * (half ? Math.PI : TAU); const p = proj(hx + Math.cos(an) * HUB_R, y, hz + Math.sin(an) * HUB_R); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
        };
        // corps du moyeu : rempli de fond (il cache la corde derrière), contour fin
        const l0 = [...proj(hx - HUB_R * cyaw, top, hz + HUB_R * syaw)], l1 = [...proj(hx - HUB_R * cyaw, bot, hz + HUB_R * syaw)];
        const r0 = [...proj(hx + HUB_R * cyaw, top, hz - HUB_R * syaw)], r1 = [...proj(hx + HUB_R * cyaw, bot, hz - HUB_R * syaw)];
        ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.lineTo(l1[0], l1[1]); ctx.closePath(); ctx.fill();
        rim(top, false); ctx.fill();
        rim(bot, false); ctx.fill();
        ctx.strokeStyle = line(IVORY, 0.36); ctx.lineWidth = lw;
        rim(top, false); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) { const an = (i / 24) * Math.PI; const p = proj(hx + Math.cos(an) * HUB_R * cyaw + Math.sin(an) * HUB_R * syaw, bot, hz - Math.cos(an) * HUB_R * syaw + Math.sin(an) * HUB_R * cyaw); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
        ctx.stroke();
      }
      arm(zNear >= 0 ? 1 : -1);

      // la glissière : une tige fine que la came écarte (elle pivote en haut)
      if (plan) {
        const tw = done || src.taus.length ? tauD : 0, op = plan.bar(tw), ang = (topo.rail.maxAngle ?? 0.14) * op;
        const rx = topo.rail.x, rz = topo.rail.z, py = ya + 0.06;
        const p = [...proj(rx, py, rz)], q = [...proj(rx + Math.sin(ang) * 0.1, py - Math.cos(ang) * 0.1, rz)];
        ctx.strokeStyle = line(IVORY, 0.18 + 0.12 * op); ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
    },
    end() { /* (le geste final : approche et fondu, dans draw via S.done) */ },
  };
}
