// Fold — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// La plante de la scène, en planche botanique au trait : la même (archétype
// et graine de la recette, gen/plant.js), poussée dans un worker à part
// (loaderPlant.js) pendant qu'une graine germe à l'écran. Puis :
//  - génération : elle pousse dans l'ordre de son graphe vasculaire, du
//    collet vers les pointes ; chaque foliole sort pliée et s'ouvre en
//    grandissant (comme une jeune feuille de sensitive) ;
//  - lumière : le signal du coup de marteau part du collet et court le long
//    des faisceaux, à la vitesse de chaque organe (physio.js) ; sur son
//    passage les folioles se ferment par paires, les pinnules se
//    rapprochent, les pétioles tombent et rebondissent (mêmes cinétiques
//    que la scène) ;
//  - à la fin, la plante se rouvre en s'approchant, et la scène apparaît.
// Le pot est esquissé d'après son profil réel (container.js).
import { pinnaPose, leafletFrames, interpFrame, rachisPoint, petiolePoint, halfPoint, rot, v3 } from '../gen/plant.js';
import { closeCurve, closeDur, kineticsOf } from '../physio.js';

const { sin, cos, min, max, PI, hypot } = Math;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
const UP = [0, 1, 0];

export default function createArt() {
  let d = null, plant = null, pot = null, grow = null, sig = null, K = null, half = null;
  let tPlant = 0, gMax = 1, sigMax = 1, sigEnd = 1, W = 0, waveOn = false, fit = null, worker = null, req = 0;
  let stemNode = [];
  const spr = { a: 1 }; // (la graine du départ : opacité)

  function receive(m) {
    if (m.error) { console.warn('plante du chargement :', m.error); return; }
    plant = m.plant; pot = m.pot; grow = m.grow; sig = m.sig;
    K = kineticsOf(plant.family);
    half = plant.family === 'oxalis' ? 'oxalis' : plant.family === 'dionaea' ? 'trap' : null;
    // nœuds des tiges : rangés juste après le collet, tige après tige (gen/plant.js)
    let id = 1;
    stemNode = plant.stems.map((S) => { const o = id; id += S.pts.length; return o; });
    gMax = 0; for (const g of grow) gMax = max(gMax, g);
    sigMax = 0; for (const s of sig) sigMax = max(sigMax, s);
    // délai du pulvinus primaire : le pétiole tombe quand ses folioles sont
    // fermées (plan.js)
    sigEnd = sigMax;
    for (const L of plant.leaves) {
      let last = sig[L.nodeS] + closeDur('pinna', K);
      for (const P of L.pinnae) for (const q of P.pairs) last = max(last, sig[q.node] + closeDur('leaflet', K));
      L.delayP = last - sig[L.nodeP] + 0.25;
      L.dMax = L.droopMax * 0.6; // (plan.js le limite encore : rien ne touche rien)
      sigEnd = max(sigEnd, sig[L.nodeP] + (L.dMax > 0 ? L.delayP + 2.5 : 0), last);
    }
    // cadrage : toute la plante (et son pot), quel que soit l'azimut
    let R = pot.rimR, top = 0.3;
    for (const L of plant.leaves) {
      const pl = max(...L.pinnae.map((P) => P.len));
      R = max(R, hypot(L.tip[0], L.tip[2]) + pl * 0.9);
      top = max(top, L.tip[1] + pl * 0.9);
    }
    for (const S of plant.stems) for (const p of S.pts) { R = max(R, hypot(p[0], p[2])); top = max(top, p[1]); }
    // (une plante basse — la dionée — ne laisse voir que le haut du pot)
    fit = { R, top, bottom: max(pot.potBottom, -0.9 * top), floor: pot.potBottom };
    tPlant = -1; W = 0; waveOn = false;
  }

  // ── projection (orthographique : une planche) ──
  let bx = [1, 0, 0], by = [0, 1, 0], sc = 1, ox = 0, oy = 0;
  const px = (p) => ox + sc * (p[0] * bx[0] + p[1] * bx[1] + p[2] * bx[2]);
  const py = (p) => oy - sc * (p[0] * by[0] + p[1] * by[1] + p[2] * by[2]);
  const dx = (v) => sc * (v[0] * bx[0] + v[1] * bx[1] + v[2] * bx[2]);
  const dy = (v) => -sc * (v[0] * by[0] + v[1] * by[1] + v[2] * by[2]);
  function basis(az, el) {
    const dir = [cos(az) * cos(el), sin(el), sin(az) * cos(el)]; // (de la plante vers l'œil)
    bx = v3.norm(v3.cross(UP, dir));
    by = v3.cross(dir, bx);
  }

  // ── la graine qui germe (avant que la plante n'arrive) ──
  function sprout(ctx, S, a) {
    const { w, h, t, dpr } = S, m = min(w, h);
    const x0 = w / 2, y0 = h * 0.46 + m * 0.12, s = m * 0.1;
    ctx.lineCap = 'round';
    ctx.lineWidth = dpr;
    // le sol : un trait qui s'efface vers les bords
    const g = ctx.createLinearGradient(x0 - s * 3, 0, x0 + s * 3, 0);
    g.addColorStop(0, 'rgba(236,232,225,0)'); g.addColorStop(0.5, `rgba(236,232,225,${0.28 * a})`); g.addColorStop(1, 'rgba(236,232,225,0)');
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.moveTo(x0 - s * 3, y0); ctx.lineTo(x0 + s * 3, y0); ctx.stroke();
    // l'hypocotyle en crosse, qui se soulève lentement ; les deux cotylédons, pliés
    const lift = 0.5 + 0.5 * sin(t * 0.9), hh = s * (0.55 + 0.25 * lift);
    const tipX = x0 + s * 0.32, tipY = y0 - hh * 0.55;
    ctx.strokeStyle = `rgba(214,226,200,${0.75 * a})`;
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 - s * 0.05, y0 - hh * 0.9, x0 + s * 0.2, y0 - hh * 1.25, tipX, tipY);
    ctx.stroke();
    ctx.lineWidth = dpr;
    const ang = 1.1 + 0.25 * lift;
    for (const sg of [1, -1]) {
      const ax = cos(ang + sg * 0.32), ay = sin(ang + sg * 0.32), L = s * 0.3;
      ctx.beginPath(); ctx.moveTo(tipX, tipY);
      ctx.quadraticCurveTo(tipX + ax * L * 0.5 - ay * L * 0.2 * sg, tipY + ay * L * 0.5 + ax * L * 0.2 * sg, tipX + ax * L, tipY + ay * L);
      ctx.stroke();
    }
    // la racine, sous le sol
    ctx.strokeStyle = `rgba(236,232,225,${0.22 * a})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 - s * 0.06, y0 + s * 0.3, x0 + s * 0.02, y0 + s * 0.55); ctx.stroke();
    // au collet, le point d'où partira le signal : il respire
    collar(ctx, x0, y0, S, a * (0.6 + 0.4 * sin(t * 2.2)));
  }
  function collar(ctx, x, y, S, a) {
    const r = 9 * S.dpr;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(250,226,184,${0.7 * a})`); g.addColorStop(1, 'rgba(250,226,184,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); ctx.fill();
  }

  // ── la plante ──
  // tracés regroupés : un chemin par style (le canevas trace tout d'un coup)
  const HOT = 4;
  let hot = [];
  const heat = (s) => { // part de chaleur d'un point dont le signal arrive à s
    if (!waveOn || !(s >= 0) || s > W) return 0;
    return 1 - (W - s) / (0.35 + sigMax * 0.12);
  };
  const hotSeg = (x0, y0, x1, y1, k) => { if (k > 0) hot[min(HOT - 1, (k * HOT) | 0)].push(x0, y0, x1, y1); };

  function drawPlant(ctx, S, G, reopen, alpha) {
    const { dpr, lite } = S;
    hot = Array.from({ length: HOT }, () => []);
    const ink = (a) => `rgba(232,228,218,${a * alpha})`;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // le pot : son profil réel, des deux côtés, et les ellipses de la lèvre et du sol
    {
      const pa = 0.2 * ease((tPlant - 0.1) / 0.8);
      if (pa > 0.005) {
        ctx.save();
        ctx.strokeStyle = ink(pa); ctx.lineWidth = dpr;
        if (fit.floor < fit.bottom - 0.05) { // (pot coupé : il s'efface vers le bas)
          const yt = oy - pot.rimY * by[1] * sc, yb = oy - fit.bottom * by[1] * sc;
          ctx.beginPath(); ctx.rect(0, 0, S.w, yb); ctx.clip();
          const g = ctx.createLinearGradient(0, yt, 0, yb);
          g.addColorStop(0, ink(pa)); g.addColorStop(1, ink(0));
          ctx.strokeStyle = g;
        }
        ctx.beginPath();
        for (const sg of [1, -1]) {
          pot.outer.forEach(([r, y], i) => { const X = ox + sg * r * sc, Y = oy - (y * by[1]) * sc; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        }
        ctx.stroke();
        // (un cercle horizontal vu sous l'élévation el : petit axe r · sin el)
        const squash = Math.sqrt(max(0, 1 - by[1] * by[1]));
        const ell = (r, y, a) => { ctx.strokeStyle = ink(a); ctx.beginPath(); ctx.ellipse(ox, oy - y * by[1] * sc, r * sc, max(0.5, r * sc * squash), 0, 0, 2 * PI); ctx.stroke(); };
        ell(pot.outer[pot.outer.length - 1][0], pot.outer[pot.outer.length - 1][1], pa);
        ell(pot.soilR, 0, pa * 0.6);
        ctx.restore();
      }
    }

    // tiges : un trait dont l'épaisseur suit le rayon de la tige
    ctx.strokeStyle = ink(0.72);
    plant.stems.forEach((St, si) => {
      const n0 = stemNode[si];
      ctx.lineWidth = max(0.9 * dpr, St.rad[0] * sc * 0.7);
      ctx.beginPath();
      let x0 = px(St.pts[0]), y0 = py(St.pts[0]);
      ctx.moveTo(x0, y0);
      for (let j = 1; j < St.pts.length; j++) {
        const g0 = grow[n0 + j - 1], g1 = grow[n0 + j];
        if (g0 > G) break;
        const f = g1 <= G ? 1 : (G - g0) / max(1e-6, g1 - g0);
        const p = f >= 1 ? St.pts[j] : v3.lerp(St.pts[j - 1], St.pts[j], f);
        const x1 = px(p), y1 = py(p);
        ctx.lineTo(x1, y1);
        hotSeg(x0, y0, x1, y1, heat(sig[n0 + j]));
        x0 = x1; y0 = y1;
        if (f < 1) break;
      }
      ctx.stroke();
    });

    // feuilles
    const leafPath = new Path2D(), rodPath = new Path2D(), snapPath = new Path2D(), flowerPath = new Path2D();
    const hue = d?.hue ?? 100, sat = Math.round((d?.sat ?? 0.5) * 45);
    for (const L of plant.leaves) {
      const gP = grow[L.nodeP];
      if (gP > G) continue;
      // fermeture : cinétiques de la scène, au temps du signal (reopen : la fin)
      const keep = 1 - reopen;
      const aP = sig[L.nodeP], aS = sig[L.nodeS];
      const dp = L.dMax > 0 && waveOn && aP >= 0 ? closeCurve('petiole', W - aP - L.delayP, K) * keep : 0;
      const fp = waveOn && aS >= 0 ? closeCurve('pinna', W - aS, K) * keep : 0;
      const axis = v3.norm(v3.cross(L.dir, UP)), ang = -L.dMax * dp;
      const Rp = ang ? (p) => v3.add(L.base, rot(v3.sub(p, L.base), axis, ang)) : (p) => p;
      const Rv = ang ? (v) => rot(v, axis, ang) : (v) => v;
      // pétiole arqué
      const gS = grow[L.nodeS], fpet = clamp01((G - gP) / max(1e-6, gS - gP));
      const np = 8;
      let p0 = Rp(petiolePoint(L, 0)), x0 = px(p0), y0 = py(p0);
      rodPath.moveTo(x0, y0);
      for (let k = 1; k <= np && k / np <= fpet + 1e-6; k++) {
        const p = Rp(petiolePoint(L, k / np)), x1 = px(p), y1 = py(p);
        rodPath.lineTo(x1, y1);
        hotSeg(x0, y0, x1, y1, heat(aP + (aS - aP) * (k / np)));
        x0 = x1; y0 = y1;
      }
      if (fpet < 1) continue;
      const tip = Rp(L.tip);
      for (const P of L.pinnae) {
        const pr = pinnaPose(P, fp);
        const t = Rv(pr.t), n = Rv(pr.n);
        const frames = [1, -1].map((sg) => leafletFrames(pr.t, pr.n, sg, P.fold ?? P.down));
        // rachis, jusqu'où la croissance est arrivée
        const rp = (s) => v3.add(v3.add(tip, v3.mul(t, s * P.len)), v3.mul(n, (P.sag ?? 0) * s * s));
        let X0 = px(tip), Y0 = py(tip), sPrev = 0;
        rodPath.moveTo(X0, Y0);
        for (const q of P.pairs) {
          const gq = grow[q.node];
          if (gq > G + 0.02) break;
          if (!half) {
            const p = rp(q.s), X1 = px(p), Y1 = py(p);
            rodPath.lineTo(X1, Y1);
            hotSeg(X0, Y0, X1, Y1, heat(sig[q.node]));
            X0 = X1; Y0 = Y1;
          }
          sPrev = q.s;
          // la foliole : sort pliée, s'ouvre en grandissant ; se ferme au signal
          const u = easeOut((G - gq) / (0.12 + 0.1 * gMax));
          if (u <= 0.01) continue;
          const aq = sig[q.node];
          const fs = waveOn && aq >= 0 ? closeCurve('leaflet', W - aq, K) : 0;
          const fl = clamp01(max(1 - u, fs * keep));
          const B = half ? tip : rp(q.s);
          const bX = px(B), bY = py(B);
          const snapping = waveOn && fs > 0.02 && fs < 0.97 && keep > 0.5;
          const path = snapping ? snapPath : leafPath;
          const Ls = q.len * (0.35 + 0.65 * u), Ws = q.wid * (0.35 + 0.65 * u);
          for (let side = 0; side < 2; side++) {
            const fr = interpFrame(frames[side], fl);
            const X = Rv(fr[0]), Y = Rv(fr[1]), Z = Rv(fr[2]);
            const xx = dx(X), xy = dy(X), yx = dx(Y), yy = dy(Y);
            if (half) {
              // demi-limbe (trèfle, dionée) : son contour, tourné autour de la nervure
              const zx = dx(Z), zy = dy(Z), sg = side ? -1 : 1, N = lite ? 7 : 12;
              path.moveTo(bX, bY);
              for (let i = 1; i <= N; i++) {
                const [a, b, c] = halfPoint(half, i / N, 1, sg);
                path.lineTo(bX + a * Ls * xx + b * Ws * yx + c * Ws * zx, bY + a * Ls * xy + b * Ws * yy + c * Ws * zy);
              }
              path.lineTo(bX + Ls * xx, bY + Ls * xy);
              if (half === 'trap' && !lite) { // les cils du piège
                for (let i = 1; i < N; i++) {
                  const [a, b, c] = halfPoint(half, i / N, 1, sg), [a2, b2, c2] = halfPoint(half, i / N, 1.35, sg);
                  path.moveTo(bX + a * Ls * xx + b * Ws * yx + c * Ws * zx, bY + a * Ls * xy + b * Ws * yy + c * Ws * zy);
                  path.lineTo(bX + a2 * Ls * xx + b2 * Ws * yx + c2 * Ws * zx, bY + a2 * Ls * xy + b2 * Ws * yy + c2 * Ws * zy);
                }
              }
            } else {
              // foliole oblongue : deux arcs, la moitié côté pointe plus large
              const tx = bX + Ls * xx, ty = bY + Ls * xy, mx = bX + 0.45 * Ls * xx, my = bY + 0.45 * Ls * xy;
              if (lite) { path.moveTo(bX, bY); path.lineTo(tx, ty); continue; }
              const wl = 0.58 * 1.25 * Ws, wr = 0.42 * 1.25 * Ws;
              path.moveTo(bX, bY);
              path.quadraticCurveTo(mx + wl * yx, my + wl * yy, tx, ty);
              path.quadraticCurveTo(mx - wr * yx, my - wr * yy, bX, bY);
            }
          }
        }
        if (half) { const p = rp(1); rodPath.lineTo(px(p), py(p)); }
      }
    }
    ctx.lineWidth = 0.9 * dpr;
    ctx.strokeStyle = ink(0.6);
    ctx.stroke(rodPath);
    ctx.lineWidth = 0.75 * dpr;
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, 74%, ${0.62 * alpha})`;
    ctx.stroke(leafPath);
    ctx.strokeStyle = `rgba(250, 222, 176, ${0.9 * alpha})`;
    ctx.stroke(snapPath);

    // fleurs (houppes) et gousses, à l'aisselle des feuilles du haut
    for (const F of plant.flowers) {
      const L = plant.leaves[F.leaf];
      if (!L || grow[L.nodeS] > G) continue;
      const hx = px(F.head), hy = py(F.head), r = F.r * sc * 0.8 * ease((G - grow[L.nodeS]) / 0.2);
      flowerPath.moveTo(px(F.base), py(F.base)); flowerPath.lineTo(hx, hy);
      const nr = lite ? 8 : 16;
      for (let i = 0; i < nr; i++) { const a = (i / nr) * 2 * PI; flowerPath.moveTo(hx + cos(a) * r * 0.25, hy + sin(a) * r * 0.25); flowerPath.lineTo(hx + cos(a) * r, hy + sin(a) * r); }
    }
    for (const Q of plant.pods) {
      const L = plant.leaves[Q.leaf];
      if (!L || grow[L.nodeS] > G) continue;
      flowerPath.moveTo(px(Q.base), py(Q.base)); flowerPath.lineTo(px(Q.head), py(Q.head));
      const e = v3.add(Q.head, v3.mul(Q.dir, Q.len));
      flowerPath.lineTo(px(e), py(e));
    }
    ctx.lineWidth = 0.8 * dpr;
    ctx.strokeStyle = d?.flower ? hexA(d.flower, 0.55 * alpha) : `rgba(240,170,205,${0.55 * alpha})`;
    ctx.stroke(flowerPath);

    // le front du signal : un trait chaud, plus vif là où il vient d'arriver
    if (waveOn) {
      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < HOT; b++) {
        const seg = hot[b];
        if (!seg.length) continue;
        const k = (b + 0.5) / HOT;
        const path = new Path2D();
        for (let i = 0; i < seg.length; i += 4) { path.moveTo(seg[i], seg[i + 1]); path.lineTo(seg[i + 2], seg[i + 3]); }
        if (!lite) { ctx.lineWidth = 5 * dpr; ctx.strokeStyle = `rgba(240, 190, 120, ${0.08 * k * k * alpha})`; ctx.stroke(path); }
        ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = `rgba(255, 226, 180, ${0.7 * k * k * alpha})`; ctx.stroke(path);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  const hexA = (hex, a) => { const v = parseInt(hex.slice(1), 16); return `rgba(${v >> 16}, ${(v >> 8) & 255}, ${v & 255}, ${a})`; };

  return {
    data(data) {
      d = data;
      plant = null; tPlant = 0; spr.a = 1;
      const id = ++req;
      try {
        worker?.terminate();
        worker = new Worker(new URL('./loaderPlant.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data: m }) => { if (id === req) receive(m); worker?.terminate(); worker = null; };
        worker.postMessage({ plant: data.plant, container: data.container });
      } catch (e) { console.warn('plante du chargement :', e); }
    },
    draw(ctx, S) {
      const { w, h, dt } = S, m = min(w, h);
      const fade = 1 - S.done;
      // la graine, tant que la plante n'a pas commencé à pousser
      if (plant) spr.a = max(0, spr.a - dt * 2.2);
      if (spr.a > 0.005) sprout(ctx, S, spr.a * fade);
      if (!plant) return;
      if (tPlant < 0) tPlant = 0;
      tPlant += dt;
      // horloges : la croissance (environ 2,6 s), puis l'onde du signal, qui
      // suit l'avancement de la préparation de la lumière
      const G = gMax * 1.04 * ease(tPlant / (S.lite ? 2.2 : 2.8)) + (tPlant > 0 ? 1e-4 : 0);
      const grown = tPlant > (S.lite ? 2.2 : 2.8);
      const n = max(1, S.steps.length), ic = S.steps.indexOf('compile');
      if (grown && ic >= 0 && S.stepIdx >= ic) waveOn = true;
      if (waveOn) {
        const c = clamp01((S.p * n - ic) / 0.92);
        const target = S.stepIdx > ic || S.done > 0 ? sigEnd : sigEnd * (0.08 + 0.9 * c);
        // (vers la cible, jamais à l'arrêt tant qu'elle est devant)
        if (W < target) W = min(target, W + max(sigEnd * 0.04, (target - W) * 1.6) * dt);
      }
      // la planche tourne lentement autour de la plante
      basis((d?.az ?? 0) + 0.32 + 0.07 * S.t, max(0.08, (d?.el ?? 0.12) + 0.06));
      const span = fit.top - fit.bottom;
      const zoom = 1 + 0.22 * S.done * S.done;
      sc = min((w * 0.44) / fit.R, (h * 0.68) / span) * zoom;
      ox = w / 2;
      oy = h * 0.46 + ((fit.top + fit.bottom) / 2) * sc * by[1];
      // un halo très doux derrière la plante
      const hx = w / 2, hy = h * 0.46, hr = m * 0.45;
      const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      halo.addColorStop(0, `rgba(180, 200, 170, ${0.05 * fade})`); halo.addColorStop(1, 'rgba(180, 200, 170, 0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      // au collet : le point qui attend le choc, puis l'éclat du coup
      const cx = px([0, 0, 0]), cy = py([0, 0, 0]);
      const pulse = waveOn ? max(0, 1 - W / 1.2) : 0.35 + 0.25 * sin(S.t * 2.2);
      if (pulse > 0.01) collar(ctx, cx, cy, S, pulse * fade * min(1, tPlant * 2));
      const reopen = ease(S.done * 1.25);
      drawPlant(ctx, S, G, reopen, fade * min(1, tPlant * 3));
    },
  };
}
