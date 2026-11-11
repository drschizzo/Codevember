// Tesseract — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// Le patron de la scène, en fil de fer, calculé ici même par math4.js (les
// mêmes charnières, le même ordre de pliage, les mêmes quarts de tour 4D que
// le film) :
//  - au départ (le moteur se charge), l'idée seule : un hypercube froid qui
//    tourne en 4D ;
//  - dès que la recette arrive, il se déplie en patron (celui de la graine),
//    et chaque cellule s'allume quand ses pièces sont construites ;
//  - pendant la préparation de la lumière, le patron se replie, feuilles
//    d'abord ;
//  - aux premières images, il fait ses quarts de tour, et la pièce du centre
//    s'éclaire ;
//  - à la fin, on plonge dans cette pièce, comme le voyage du film.
// Traits fins, plus pâles au loin ; tout est projeté comme dans la scène
// (perspective depuis l'œil 4D, gonflement éventuel vers la 3-sphère).
import { DALI, ROOT, cellTransforms, embedLocal, apply, project, moveMatrix, easeBack, foldOrder, ident, compose, linear } from '../math4.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mulM = (A, B) => compose(linear(A), linear(B)).m;
const hexRGB = (h, f = [255, 224, 192]) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : f;
};

// les 12 arêtes d'un cube local [-1, 1]³ (paires de sommets, indice = bits xyz)
const CORNERS = [...Array(8).keys()].map((i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
const EDGES = [];
for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) EDGES.push([i, i | b]);

const COLD = [128, 158, 198], WARM = [240, 214, 170];

export default function createArt() {
  // recette (avant son arrivée : le patron de Dalí, un seul plan de rotation)
  let net = [...DALI], order = foldOrder(DALI), moves = [{ a: 0, s: 1 }], proj = { d: 3, inflate: 0, inset: 0.93, tiltX: -0.2, tiltZ: 0 };
  let az0 = 0.5, elev = 0.24, antic = 0.25, stagger = 0.5, lamp = [255, 224, 192], has = false;
  // état animé
  let fold = 1, Q = ident().m, k = 0, turnT = -1.2, turning = false, frameLit = 0, room = 0;
  const lit = new Float32Array(8), want = new Float32Array(8), flash = new Float32Array(8);
  let radius = 2.8, firstFit = true, ox = 0, oy = 0;
  let last = '';

  const cube = new Float32Array(8 * 8 * 3); // sommets projetés de chaque cellule (x, y, z écran)

  function state(theta, turn) {
    if (turning) return { Q, theta: new Array(8).fill(0), move: moves[k % moves.length], turn };
    return { Q, theta, move: null, turn: 0 };
  }

  return {
    data(d) {
      const sig = d.recipe && JSON.stringify(d.recipe);
      if (d.recipe && sig !== last) { // (la même recette renvoyée : rien ne change)
        const r = d.recipe;
        last = sig;
        net = r.parent; order = foldOrder(net); moves = r.moves?.length ? r.moves : moves;
        proj = { ...proj, ...r.proj }; az0 = r.az ?? az0; elev = r.elev ?? elev;
        antic = r.antic ?? antic; stagger = r.stagger ?? stagger; lamp = hexRGB(r.lamp, lamp);
        has = true; k = 0; lit.fill(0); want.fill(0); flash.fill(0); frameLit = 0; room = 0;
        // (l'hypercube est symétrique : on peut repartir de l'orientation de la scène sans que rien ne saute)
        if (!turning) Q = ident().m;
      }
      if (d.cells) for (let c = 0; c < 8; c++) { if (d.cells[c] > want[c]) flash[c] = 1; want[c] = d.cells[c]; }
      if (d.frame !== undefined) frameLit = Math.max(frameLit, d.frame);
    },
    draw(ctx, S) {
      const { w, h, t, dt, dpr } = S;
      const m = Math.min(w, h), cx = w / 2, cy = h * 0.46;
      const step = S.step, compiling = step === 'compile', settling = step === 'settle' || S.done > 0;

      // ── la chorégraphie ──
      // pliage visé : l'hypercube (avant la recette), le patron à plat (pendant
      // la construction), replié au rythme de la compilation
      let target = 1;
      if (has) target = compiling ? 0.12 + 0.88 * clamp01(S.real) : settling ? 1 : 0;
      if (!turning) {
        const v = Math.sign(target - fold) * Math.min(Math.abs(target - fold), dt * (target > fold ? 0.55 : 0.7));
        fold = clamp01(fold + v);
      }
      // quarts de tour : une fois replié (l'idée seule, ou la scène prête)
      const canTurn = fold > 0.999 && (!has || settling);
      if (turning || canTurn) {
        turnT += dt / 2.3;
        if (!turning && turnT >= 0) turning = true;
        if (turning && turnT >= 1) {
          Q = mulM(moveMatrix(moves[k % moves.length]), Q);
          k++; turning = false; turnT = -0.45; // (une pause entre deux quarts de tour)
        }
      } else turnT = Math.min(turnT, -0.3);
      const turn = turning ? easeBack(turnT, 0.18) : 0;
      // charnières : les feuilles se replient d'abord (comme le film)
      const theta = new Array(8).fill(Math.PI / 2);
      for (let s = 0; s < 8; s++) {
        if (s === ROOT) continue;
        const d0 = (stagger * order[s]) / 7, f = easeBack((fold - d0) / (1 - stagger), antic * 0.6);
        theta[s] = (Math.PI / 2) * (1 - f);
      }
      const T = cellTransforms(state(theta, turn), net);
      // (gonflement : seulement plié, comme la scène — déplié, le patron reste fait de cubes)
      const inflate = proj.inflate * fold * fold;

      // cellules allumées (un éclat bref à l'arrivée de leurs pièces)
      for (let c = 0; c < 8; c++) {
        lit[c] += (want[c] - lit[c]) * Math.min(1, dt * 5);
        flash[c] = Math.max(0, flash[c] - dt * 1.6);
      }
      const light = has ? (compiling ? 0.35 + 0.4 * clamp01(S.real) : settling ? 1 : 0.3 * frameLit) : 0;
      room += ((settling ? 1 : 0) - room) * Math.min(1, dt * 1.2);

      // ── projection : 4D → 3D (comme le shader), puis la vue ──
      const yaw = az0 + t * 0.11, pitch = elev - proj.tiltX * 0.5, roll = proj.tiltZ;
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      let rmax = 0, sx = 0, sy = 0;
      for (let c = 0; c < 8; c++) for (let i = 0; i < 8; i++) {
        const p = project(apply(T[c], embedLocal(c, CORNERS[i], proj.inset)), proj.d, inflate);
        let x = cyw * p[0] + syw * p[2], z = -syw * p[0] + cyw * p[2], y = p[1];
        const y2 = cp * y - sp * z; z = sp * y + cp * z; y = y2;
        const x2 = cr * x - sr * y; y = sr * x + cr * y; x = x2;
        const o = (c * 8 + i) * 3;
        cube[o] = x; cube[o + 1] = y; cube[o + 2] = z;
        sx += x; sy += y;
      }
      // cadrage : le patron centré sur son milieu, et tenu dans le cadre par
      // son étendue à l'écran (replié, le milieu est le centre de la pièce intérieure)
      sx /= 64; sy /= 64;
      for (let o = 0; o < cube.length; o += 3) rmax = Math.max(rmax, Math.hypot(cube[o] - sx, cube[o + 1] - sy) * 1.12);
      // cadrage : tout le patron tient dans le cadre (en douceur)
      if (firstFit) { radius = rmax; ox = sx; oy = sy; firstFit = false; } else {
        const kf = Math.min(1, dt * 1.5);
        radius += (rmax - radius) * kf; ox += (sx - ox) * kf; oy += (sy - oy) * kf;
      }
      // fin : on plonge dans la pièce du centre
      const dive = S.done * S.done * (3 - 2 * S.done);
      const scale = ((m * 0.3) / Math.max(1.2, radius)) * (1 + 7 * dive * dive), cam = 9, alpha = 1 - S.done;
      const P2 = (o) => { const f = cam / (cam - cube[o + 2] * (1 - 0.6 * dive)); return [cx + (cube[o] - ox) * scale * f, cy - (cube[o + 1] - oy) * scale * f]; };

      // halo : froid, puis la lampe de la pièce du centre
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.45);
      halo.addColorStop(0, `rgba(${COLD.join(',')}, ${0.07 * alpha})`); halo.addColorStop(1, `rgba(${COLD.join(',')}, 0)`);
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      if (room > 0.01) {
        const r0 = m * 0.11 * (1 + 3 * dive) * (1 + 0.04 * Math.sin(t * 1.7));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0);
        g.addColorStop(0, `rgba(${lamp.join(',')}, ${0.16 * room * (1 - 0.5 * S.done)})`); g.addColorStop(1, `rgba(${lamp.join(',')}, 0)`);
        ctx.fillStyle = g; ctx.fillRect(cx - r0, cy - r0, 2 * r0, 2 * r0);
      }

      // ── les arêtes : trois passes (halo large, trait moyen, filet), plus
      // pâles au loin ; la couleur passe du froid au chaud quand la cellule s'allume ──
      ctx.lineCap = 'round';
      const passes = S.lite ? [[3.2, 0.1], [1, 1]] : [[5, 0.05], [2.2, 0.13], [0.9, 1]];
      const zr = Math.max(0.5, radius);
      for (const [lw, ka] of passes) {
        ctx.lineWidth = lw * dpr;
        for (let c = 0; c < 8; c++) {
          const L = clamp01(lit[c]), fl = flash[c] * flash[c];
          const col = COLD.map((v, i) => Math.round(v + (WARM[i] - v) * L));
          const base = (0.2 + 0.18 * frameLit + 0.45 * L + 0.25 * L * light + 0.4 * fl) * alpha * ka;
          for (const [a, b] of EDGES) {
            const oa = (c * 8 + a) * 3, ob = (c * 8 + b) * 3;
            const zm = (cube[oa + 2] + cube[ob + 2]) / 2;
            const depth = 0.22 + 0.78 * ss(0.5 + zm / (2 * zr)); // (plus pâle au loin)
            const A = Math.min(1, base * depth);
            if (A < 0.004) continue;
            const pa = P2(oa), pb = P2(ob);
            ctx.strokeStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${A})`;
            ctx.beginPath(); ctx.moveTo(pa[0], pa[1]);
            if (inflate > 0) { // (gonflé : les arêtes sont des arcs)
              for (let j = 1; j <= 6; j++) {
                const u = j / 6, l = CORNERS[a].map((v, i) => v + (CORNERS[b][i] - v) * u);
                const p = project(apply(T[c], embedLocal(c, l, proj.inset)), proj.d, inflate);
                let x = cyw * p[0] + syw * p[2], z = -syw * p[0] + cyw * p[2], y = p[1];
                const y2 = cp * y - sp * z; z = sp * y + cp * z; y = y2;
                const x2 = cr * x - sr * y; y = sr * x + cr * y; x = x2;
                const f = cam / (cam - z * (1 - 0.6 * dive));
                ctx.lineTo(cx + (x - ox) * scale * f, cy - (y - oy) * scale * f);
              }
            } else ctx.lineTo(pb[0], pb[1]);
            ctx.stroke();
          }
        }
      }
      // nœuds de l'ossature : un point chaud à chaque sommet des cellules allumées
      if (!S.lite) for (let c = 0; c < 8; c++) {
        const L = clamp01(lit[c]) * (0.35 + 0.65 * light) * alpha;
        if (L < 0.02) continue;
        for (let i = 0; i < 8; i++) {
          const o = (c * 8 + i) * 3, [x, y] = P2(o), depth = 0.25 + 0.75 * ss(0.5 + cube[o + 2] / (2 * zr));
          ctx.fillStyle = `rgba(255, 236, 206, ${0.5 * L * depth})`;
          ctx.beginPath(); ctx.arc(x, y, 1.3 * dpr, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
