// Le voyage intérieur : la caméra dans l'hypersphère (voir math4.js).
//
// Tout est exprimé dans l'espace projeté (repère local du groupe du
// tesseract), où le centre du cube intérieur est l'origine. Pendant le voyage,
// la caméra ne quitte pas les abords de l'origine : c'est l'univers qui se
// déplace (les quarts de tour 4D), et la caméra le regarde passer.
//
// À chaque traversée i, la pièce qui arrive vient d'une direction Dᵢ (le long
// d'un axe : l'image d'un grand cercle passant par l'origine est une droite).
// La caméra se tient à l'écart de cet axe, à une distance r selon une diagonale
// Oᵢ de la porte (le plus loin possible des barres de l'ossature), et regarde
// presque droit devant : l'objet exposé de la pièce suivante arrive par l'axe
// et passe sous elle, la paroi s'ajoure et se laisse traverser.
//
// Pendant une halte, la caméra tourne autour de l'objet de la pièce (repère
// interpolé de la traversée précédente à la suivante), le regard passe de la
// porte d'arrivée à l'objet, puis à la porte suivante.
import * as THREE from 'three/webgpu';
import { cellTransforms, apply, normalOf, smoother, ROOT, hash01 } from '../math4.js';

const sm = (a, b, x) => smoother((x - a) / (b - a));

// part de la projection stéréographique (kp) et de la caméra intérieure (kc)
export function voyageBlend(st) {
  if (st?.seg === undefined) return { kp: 0, kc: 0 };
  const f = st.f;
  switch (st.phase) {
    case 'plunge': return { kp: sm(0, 0.5, f), kc: sm(0.28, 1, f) };
    case 'dwell': case 'travel': return { kp: 1, kc: 1 };
    case 'surface': return { kp: 1 - sm(0.5, 1, f), kc: 1 - sm(0, 0.72, f) };
    default: return { kp: 0, kc: 0 };
  }
}

// repères des traversées : direction d'arrivée D et diagonale O de la porte
export function voyageFrames(R, cache) {
  const n = R.moves.length, out = [];
  let Oprev = [0.5, 0.7, 0.5];
  for (let i = 0; i < n; i++) {
    const base = { theta: new Array(8).fill(0), move: null, turn: 0 };
    const T0 = cellTransforms({ ...base, Q: cache.Q[i] }, R.net.parent);
    const T1 = cellTransforms({ ...base, Q: cache.Q[i + 1] }, R.net.parent);
    let c = 0;
    for (let k = 0; k < 8; k++) if (apply(T1[k], normalOf(k))[3] < apply(T1[c], normalOf(c))[3]) c = k;
    const p = apply(T0[c], normalOf(c));
    const D = new THREE.Vector3(p[0], p[1], p[2]).normalize();
    // diagonales de la porte (perpendiculaires à D) : tirées au hasard, en
    // préférant le haut et la proximité de la précédente
    const ax = [0, 1, 2].filter((a) => Math.abs([D.x, D.y, D.z][a]) < 0.5);
    let best = null, score = -Infinity, j = 0;
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      const v = [0, 0, 0]; v[ax[0]] = sb; v[ax[1]] = sc;
      const O = new THREE.Vector3(...v).normalize();
      const s = O.y * 0.6 + O.dot(new THREE.Vector3(...Oprev)) * 0.3 + 1.6 * hash01(`${R.seed}:diag${i}:${j++}`);
      if (s > score) { score = s; best = O; }
    }
    Oprev = best.toArray();
    // allure de la traversée, jamais deux fois la même de suite
    let style = pickStyle(R.seed, i, 0);
    for (let k = 1; i > 0 && style === out[i - 1].style && k < 6; k++) style = pickStyle(R.seed, i, k);
    const turn = hash01(`${R.seed}:sens${i}`) < 0.5 ? -1 : 1;
    out.push({ D, O: best, cell: c, style, ...STYLES[style](turn) });
  }
  // pièce de chaque halte : le cube intérieur au départ et à l'arrivée, puis
  // la cellule arrivée à chaque traversée
  out.rooms = [ROOT, ...out.map((F) => F.cell)];
  out.rooms[n] = ROOT;
  return out;
}

// Allures d'une traversée : regard (β), roulis autour de l'axe (τ : la caméra
// tourne aussi autour de l'axe, à la distance r), au départ (0) et à
// l'arrivée (1).
//   avant : droit devant, l'objet suivant arrive et passe sous la caméra ;
//   arrière : on regarde la pièce que l'on quitte s'éloigner, l'objet
//     suivant entre dans le champ par derrière et se pose ;
//   côté : le regard sur l'axe, l'objet suivant traverse le champ en frôlant ;
//   tonneau : un tour complet autour de l'axe ;
//   spirale : un quart de tour autour de l'axe, regard plongeant.
const STYLES = {
  avant: () => ({ b0: 0.13, b1: 0.13, t0: 0, t1: 0, r: 0.42 }),
  arriere: (s) => ({ b0: Math.PI - 0.22, b1: Math.PI - 0.5, t0: 0, t1: 0.3 * s, r: 0.4 }),
  cote: (s) => ({ b0: 1.25, b1: 1.4, t0: 0, t1: 0.5 * s, r: 0.46 }),
  tonneau: (s) => ({ b0: 0.18, b1: 0.18, t0: 0, t1: 2 * Math.PI * s, r: 0.4 }),
  spirale: (s) => ({ b0: 0.5, b1: 0.35, t0: 0, t1: (Math.PI / 2) * s, r: 0.48 }),
};
const STYLE_W = [['avant', 1.6], ['arriere', 1.2], ['cote', 1.4], ['tonneau', 1], ['spirale', 1.3]];
function pickStyle(seed, i, k) {
  const tot = STYLE_W.reduce((a, [, w]) => a + w, 0);
  let x = hash01(`${seed}:allure${i}:${k}`) * tot;
  for (const [n, w] of STYLE_W) if ((x -= w) < 0) return n;
  return 'avant';
}
// (angle ramené dans ]−π, π] : un tour complet ne se défait pas à l'arrivée)
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

const basisQ = (D, O) => {
  const Z = new THREE.Vector3().crossVectors(D, O);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(D, O, Z));
};
// ── Entrée et sortie ─────────────────────────────────────────────────────────
// La projection ne fait que multiplier (x, y, z) par un nombre positif : la
// direction depuis l'origine d'un point du tesseract ne dépend que de lui. Or
// toutes les arêtes (l'ossature) ont deux coordonnées de même valeur absolue,
// et chaque objet exposé est sur un axe. Un rayon issu de l'origine dans la
// direction (1, 0.38, 0.38) (ou l'une de ses images par symétrie) ne croise
// donc aucune barre, quelle que soit la projection, et passe loin des objets.
// La caméra rejoint ce rayon à l'extérieur, en glissant sur une sphère qui
// englobe tout, puis le suit jusqu'au cube du centre, le regard sur son objet.
export function entryAxis(posL) {
  const a = [posL.x, posL.y, posL.z], k = a.reduce((m, v, i) => (Math.abs(v) > Math.abs(a[m]) ? i : m), 0);
  const u = a.map((v, i) => (i === k ? Math.sign(v) || 1 : 0.38 * (Math.sign(v) || 1)));
  return new THREE.Vector3(...u).normalize();
}
const ENTRY_R = 0.6; // (arrêt à l'intérieur, entre l'objet et la paroi)
const _q = new THREE.Quaternion();
// g : 0 (pose extérieure) → 1 (dans le cube du centre) ; upL : le haut du
// monde dans le repère local
export function dockPose(g, out, u, upL) {
  const a = sm(0, 0.35, g), b = sm(0.3, 1, g);
  const R0 = Math.max(out.pos.length(), 6);
  const d0 = out.pos.clone().normalize();
  const dir = d0.clone().applyQuaternion(_q.setFromUnitVectors(d0, u).slerp(new THREE.Quaternion(), 1 - a));
  // (approche à vitesse relative constante : logarithmique)
  const rho = R0 * (ENTRY_R / R0) ** b;
  const pos = dir.multiplyScalar(rho);
  const look = pos.clone().normalize().negate();
  const fwd = out.fwd.clone().lerp(look, a).normalize();
  const up = upL.clone().addScaledVector(fwd, -upL.dot(fwd));
  if (up.lengthSq() < 1e-6) up.copy(out.up);
  return { pos, fwd, up: up.normalize() };
}
// repère de la pièce à l'arrivée de la plongée : O le long du rayon, D vers le haut
const frameOnAxis = (u, upL) => {
  const D = upL.clone().addScaledVector(u, -upL.dot(u));
  if (D.lengthSq() < 1e-6) D.set(1, 0, 0).addScaledVector(u, -u.x);
  return { D: D.normalize(), O: u.clone() };
};

// pose de la caméra dans un repère (D, O) : à r de l'axe, regard incliné de
// β vers l'axe (β = 0 : droit devant ; β = π/2 : vers l'origine), roulis τ
// autour de D
function poseIn(q, r, beta, tau) {
  const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tau);
  const qq = q.clone().multiply(t);
  const c = Math.cos(beta), s = Math.sin(beta);
  return {
    pos: new THREE.Vector3(0, r, 0).applyQuaternion(qq),
    fwd: new THREE.Vector3(c, -s, 0).applyQuaternion(qq),
    up: new THREE.Vector3(s, c, 0).applyQuaternion(qq),
  };
}

// pose intérieure (repère local), pour l'état st ; out : pose extérieure
// exprimée dans le même repère (entrée et sortie s'y raccordent)
export function insidePose(st, R, frames, out) {
  const V = R.voyage, n = R.moves.length;
  // (out.uIn, out.uOut : rayons d'entrée et de sortie ; out.upL : le haut)
  const fin = frameOnAxis(out.uIn, out.upL), fout = frameOnAxis(out.uOut, out.upL);
  const qIn = basisQ(fin.D, fin.O), qOut = basisQ(fout.D, fout.O);
  const qOf = (i) => (i < 0 ? qIn : i >= n ? qOut : basisQ(frames[i].D, frames[i].O));
  const bT = 0.13, bL = 1.45; // regard : droit devant / sur l'objet
  const rT = V.radius, rL = V.orbitR, k = rT / 0.42; // (écart réglable)
  const io0 = { b0: Math.PI / 2, b1: Math.PI / 2, t0: 0, t1: 0, r: (ENTRY_R * 0.42) / rT };
  const P = (i) => (i < 0 || i >= n ? io0 : frames[i]);
  const f = st.f, lerp = (a, b, t) => a + (b - a) * t;
  switch (st.phase) {
    case 'plunge': return dockPose(f, out, out.uIn, out.upL);
    case 'surface': return dockPose(1 - f, out, out.uOut, out.upL);
    case 'travel': {
      const S = P(st.room), e = smoother(f);
      // (un peu de vie : le regard plonge vers l'objet qui passe)
      const b = lerp(S.b0, S.b1, sm(0.15, 0.85, f)) + 0.08 * Math.sin(Math.PI * f) ** 2 * Math.sign(Math.PI / 2 - S.b0 + 1e-6);
      return poseIn(qOf(st.room), S.r * k, b, lerp(S.t0, S.t1, e) + 0.08 * Math.sin(Math.PI * f));
    }
    case 'dwell': {
      const i = st.room, A = P(i - 1), B = P(i);
      const qa = qOf(i - 1), qb = qOf(i);
      // (pièce vide : le regard ne s'attarde pas sur son centre)
      const empty = R.cells[frames.rooms?.[i] ?? ROOT]?.content.type === 'none';
      const w = empty ? 0.45 : 1;
      const lIn = sm(0, 0.3, f) * w, lOut = sm(0.68, 1, f);
      // regard et distance : fin de la traversée → objet → début de la suivante
      const bMid = lerp(A.b1, bL, lIn), rMid = lerp(A.r * k, rL, lIn);
      const b = lerp(bMid, B.b0, lOut), r = lerp(rMid, B.r * k, lOut);
      const q = qa.clone().slerp(qb, sm(0.18, 0.82, f));
      // tour de l'objet : sens et ampleur propres à chaque halte
      const same = qa.angleTo(qb) < 0.2 ? 1 : 0.35;
      const orb = (hash01(`${R.seed}:orbite${i}`) * 2 - 1) * 1.4 * same;
      const tau = lerp(wrap(A.t1), B.t0, sm(0.18, 0.82, f)) + orb * Math.sin(Math.PI * f) * (1 - Math.abs(2 * f - 1) ** 3);
      return poseIn(q, r, b, tau);
    }
    default: return { pos: out.pos.clone(), fwd: out.fwd.clone(), up: out.up.clone() };
  }
}
