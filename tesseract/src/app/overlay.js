// Couche 2D au-dessus de l'image : légendes de la chorégraphie et analogie
// 3D. Dessinée sur un canevas superposé à l'écran, et composée sur chaque
// image de la vidéo exportée (même fonction de dessin).
//
// L'analogie : ce que le tesseract est à notre espace, le cube l'est à un
// monde plat. Un cube vu de face, en perspective, est un petit carré (la face
// du fond) dans un grand (la face avant), reliés par quatre trapèzes —
// exactement l'image d'un tesseract : un petit cube dans un grand, reliés par
// six troncs de pyramide. L'encart déroule la même histoire un cran plus bas :
// la croix de six carrés se replie en cube, le cube fait un quart de tour (le
// carré du fond passe devant), puis se déplie. Couleurs : la profondeur, comme
// sur l'objet (froid loin de l'œil, chaud tout près).

import { AXES, CELL_NAMES } from '../math4.js';

const COLD = [59, 123, 255], WARM = [255, 138, 59];
const mixc = (t) => COLD.map((c, i) => Math.round(c + (WARM[i] - c) * Math.min(1, Math.max(0, t))));
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// ── Analogie 3D : un cube [-1, 1]³ ; faces repérées par leur normale ±eₖ ────
// Patron en croix latine dans le plan z = −1, socle −Z ; vue depuis (0, 0, d).
const FACES = [0, 1, 2, 3, 4, 5]; // 2k + (σ > 0)
const nrm = (f) => { const n = [0, 0, 0]; n[f >> 1] = f & 1 ? 1 : -1; return n; };
const BASE = 4; // −Z
const PARENT = [BASE, BASE, BASE, BASE, -1, 2]; // +Z pend sous −Y (la croix latine)
const rotPlane = (u, v, th) => (x) => { // rotation dans le plan (u, v) portant u vers v
  const c = Math.cos(th), s = Math.sin(th), a = x[0] * u[0] + x[1] * u[1] + x[2] * u[2], b = x[0] * v[0] + x[1] * v[1] + x[2] * v[2];
  return x.map((xi, i) => xi + (c - 1) * (a * u[i] + b * v[i]) + s * (a * v[i] - b * u[i]));
};
function faceCorners(f) {
  const k = f >> 1, s = f & 1 ? 1 : -1, u = (k + 1) % 3, v = (k + 2) % 3;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const p = [0, 0, 0]; p[k] = s; p[u] = a; p[v] = b; return p; });
}
function cubeAt(fold, turn, move) {
  // dépliage : chaque face pivote autour de l'arête partagée avec son parent
  const th = (1 - fold) * Math.PI / 2;
  const T = (f, p) => {
    if (PARENT[f] < 0) return p;
    const np = nrm(PARENT[f]), ns = nrm(f), h = np.map((x, i) => x + ns[i]);
    const R = rotPlane(np.map((x) => -x), ns, th);
    const q = R(p.map((x, i) => x - h[i])).map((x, i) => x + h[i]);
    return T(PARENT[f], q);
  };
  let faces = FACES.map((f) => faceCorners(f).map((p) => T(f, p)));
  if (move) { // quart de tour dans le plan (axe du mouvement, z) : z joue le rôle de w
    const a = [0, 0, 0]; a[move.a === 2 ? 0 : move.a] = 1;
    const R = rotPlane(a, [0, 0, move.s], (turn * Math.PI) / 2);
    faces = faces.map((F) => F.map(R));
  }
  return faces;
}

function drawAnalogy(ctx, x0, y0, S, st, alpha, clip) {
  if (!st) return;
  const d = 4.5;
  const fold = st.fold, move = st.move, turn = st.turn;
  const faces = cubeAt(fold, turn, move);
  // centrage : le patron déplié est plus grand, on le ramène dans le cadre
  const k = S * (0.08 + 0.13 * smooth(fold));
  const P = (p) => { const s = d / Math.max(0.2, d - p[2]); return [x0 + p[0] * s * k, y0 - p[1] * s * k + (1 - smooth(fold)) * S * 0.08]; };
  const order = faces.map((F, i) => [i, F.reduce((a, p) => a + p[2], 0) / 4]).sort((a, b) => a[1] - b[1]);
  ctx.save();
  if (clip) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(...clip) : ctx.rect(...clip.slice(0, 4)); ctx.clip(); }
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  for (const [i, z] of order) {
    const [r, g, b] = mixc((z + 1) / 2);
    ctx.beginPath();
    faces[i].forEach((p, j) => { const [x, y] = P(p); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = `rgba(${r},${g},${b},0.16)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
    ctx.lineWidth = Math.max(1, S * 0.008);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Légendes ─────────────────────────────────────────────────────────────────
// Une légende par mouvement visible (repli, quart de tour, dépliage). Elle
// apparaît quand le mouvement commence, reste pendant la pause qui le suit
// (le résultat est à l'écran) et s'efface à la fin de cette pause : le texte ne
// change jamais pendant que l'image est immobile.
const ACT = { fold: 'fold', hold: 'fold', turn: 'turn', rest: 'turn', unfold: 'unfold', open: 'unfold' };
function captionFor(act, st, R) {
  const n = R.moves.length, k = act === 'unfold' && st.phase === 'open' ? (st.step + n - 1) % n : st.step;
  const mv = R.moves[k];
  const plane = mv ? `${AXES[mv.a]}–w${mv.b !== undefined ? ` et ${AXES[mv.b]}–${AXES[mv.c]}` : ''}` : 'x–w';
  switch (act) {
    case 'fold': return ['Le repli', 'chaque cube pivote autour d’une face partagée, vers une direction perpendiculaire aux trois autres'];
    case 'turn': return [`Quart de tour dans le plan ${plane}`, 'rien ne se déforme : c’est l’ombre en 3D d’une rotation en 4D — le cube du fond (bleu) vient devant (orange)'];
    case 'unfold': return ['Le dépliage', 'le même patron revient… mais chaque cube a changé de place'];
    default: return ['', ''];
  }
}
// opacité : entrée au début du mouvement, sortie à la fin de la pause suivante
function captionAlpha(act, st, tl) {
  const at = (k) => tl.find((p) => p.k === k);
  const F = 0.03;
  if (act === 'unfold') { // le dépliage termine l'étape, sa pause (« open ») ouvre la suivante
    if (st.phase === 'unfold') return smooth((st.v - at('unfold').a) / F);
    return smooth((at('open').b - st.v) / F);
  }
  const mv = at(act), still = at(act === 'fold' ? 'hold' : 'rest');
  return smooth((st.v - mv.a) / F) * smooth((still.b - st.v) / F);
}

// Légendes du voyage intérieur : une par moment (repli, plongée, traversée,
// halte, remontée, dépliage), qui reste jusqu'à la fin du moment suivant
// quand celui-ci n'a pas la sienne.
function voyageCaption(st, R, tl) {
  const seg = tl[st.seg], n = R.moves.length, F = 0.012;
  const fade = (a, b) => smooth((st.v - a) / F) * smooth((b - st.v) / F);
  const mv = R.moves[seg.i];
  const plane = (m) => `${AXES[m.a]}–w${m.b !== undefined ? ` et ${AXES[m.b]}–${AXES[m.c]}` : ''}`;
  const next = tl[st.seg + 1], prev = tl[st.seg - 1];
  switch (seg.k) {
    case 'fold': case 'hold': {
      const a = tl.find((p) => p.k === 'fold'), b = tl.find((p) => p.k === 'hold');
      return ['Le repli', 'chaque cube pivote autour d’une face partagée, vers une direction perpendiculaire aux trois autres', fade(a.a, b.b)];
    }
    case 'plunge': return ['Entrer dans l’hypercube', 'l’œil 4D se pose sur l’hypersphère : le cube du centre devient une pièce, et l’on y entre', fade(seg.a, next.b)];
    case 'travel': return [`Quart de tour dans le plan ${plane(mv)}`, 'vu de l’intérieur, une rotation 4D est un voyage : l’univers glisse, on passe dans la pièce voisine', fade(seg.a, seg.i < n - 1 ? next.b : seg.b)];
    case 'dwell': {
      if (seg.i === 0) return ['Entrer dans l’hypercube', 'l’œil 4D se pose sur l’hypersphère : le cube du centre devient une pièce, et l’on y entre', fade(prev.a, seg.b)];
      if (seg.i < n) return [`Quart de tour dans le plan ${plane(R.moves[seg.i - 1])}`, 'vu de l’intérieur, une rotation 4D est un voyage : l’univers glisse, on passe dans la pièce voisine', fade(prev.a, seg.b)];
      return [`De retour dans la cellule ${CELL_NAMES[6]}`, 'huit pièces, chacune accolée à six autres : sans jamais revenir sur ses pas, on est revenu au point de départ', fade(seg.a, seg.b)];
    }
    case 'surface': return ['La remontée', 'l’œil 4D quitte l’hypersphère : les pièces redeviennent un cube dans un cube', fade(seg.a, seg.b)];
    case 'unfold': case 'open': {
      const a = tl.find((p) => p.k === 'unfold'), b = tl.find((p) => p.k === 'open');
      if (seg.k === 'open') return ['Le dépliage', 'le même patron revient, garni des mêmes cubes', smooth((b.b - st.v) / F)];
      return ['Le dépliage', 'le même patron revient, garni des mêmes cubes', smooth((st.v - a.a) / F)];
    }
    default: return ['', '', 0];
  }
}

// dessine la couche sur un contexte 2D de taille W × H (pixels) ; S : réglages
// d'affichage (captions, analogy)
export function drawOverlay(ctx, W, H, info, R, S) {
  const st = info?.state, tl = info?.timeline;
  if (!st || !S || (!S.captions && !S.analogy)) return;
  const u = Math.min(W, H) / 1000;
  if (S.captions && tl) {
    let title, sub, alpha;
    if (st.seg !== undefined) [title, sub, alpha] = voyageCaption(st, R, tl);
    else { const act = ACT[st.phase]; [title, sub] = captionFor(act, st, R); alpha = captionAlpha(act, st, tl); }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(245,240,232,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12 * u;
    ctx.font = `300 ${Math.round(34 * u)}px Fraunces, Georgia, serif`;
    ctx.fillText(title, W / 2, H - 92 * u);
    ctx.font = `italic 300 ${Math.round(19 * u)}px Fraunces, Georgia, serif`;
    ctx.fillStyle = 'rgba(230,224,214,0.82)';
    ctx.fillText(sub, W / 2, H - 58 * u);
    ctx.restore();
  }
  if (S.analogy) {
    const S = 230 * u, bx = S * 0.1, by = S * 0.08, bw = S * 1.12, bh = S * 1.2;
    const x0 = bx + bw / 2, y0 = by + S * 0.52;
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,10,0.38)';
    ctx.strokeStyle = 'rgba(255,240,220,0.12)';
    ctx.beginPath();
    ctx.roundRect?.(bx, by, bw, bh, 12 * u);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    drawAnalogy(ctx, x0, y0, S, st, 1, [bx, by, bw, bh, 12 * u]);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `italic 300 ${Math.round(13 * u)}px Fraunces, Georgia, serif`;
    ctx.fillStyle = 'rgba(230,224,214,0.75)';
    ctx.fillText('la même chose, une dimension plus bas', x0, by + bh - 30 * u);
    ctx.font = `400 ${Math.round(10.5 * u)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(230,224,214,0.5)';
    ctx.fillText('un cube vu de face : un carré dans un carré', x0, by + bh - 13 * u);
    // légende de la profondeur
    const gx = bx + 14 * u, gy = by + 14 * u, gw = 60 * u;
    const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
    grad.addColorStop(0, `rgb(${COLD})`); grad.addColorStop(1, `rgb(${WARM})`);
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, 3 * u);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(230,224,214,0.55)';
    ctx.fillText('loin · près de l’œil', gx, gy + 15 * u);
    ctx.restore();
  }
}

export function createOverlay() {
  const cv = document.createElement('canvas');
  cv.id = 'overlay';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  return {
    draw(info, R, S) {
      const dpr = Math.min(2, devicePixelRatio), W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      ctx.clearRect(0, 0, W, H);
      document.body.classList.toggle('captions', !!S?.captions); // le titre cède la place aux légendes
      drawOverlay(ctx, W, H, info, R, S);
    },
  };
}
