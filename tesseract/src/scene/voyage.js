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
import { cellTransforms, apply, normalOf, smoother, ROOT } from '../math4.js';

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
    // diagonales de la porte (perpendiculaires à D) : la plus haute, et proche
    // de la précédente
    const ax = [0, 1, 2].filter((a) => Math.abs([D.x, D.y, D.z][a]) < 0.5);
    let best = null, score = -Infinity;
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      const v = [0, 0, 0]; v[ax[0]] = sb; v[ax[1]] = sc;
      const O = new THREE.Vector3(...v).normalize();
      const s = O.y * 1.5 + O.dot(new THREE.Vector3(...Oprev)) * 0.6 + (O.x + O.z) * 0.01;
      if (s > score) { score = s; best = O; }
    }
    Oprev = best.toArray();
    out.push({ D, O: best, cell: c });
  }
  // pièce de chaque halte : le cube intérieur au départ et à l'arrivée, puis
  // la cellule arrivée à chaque traversée
  out.rooms = [ROOT, ...out.map((F) => F.cell)];
  out.rooms[n] = ROOT;
  return out;
}

const basisQ = (D, O) => {
  const Z = new THREE.Vector3().crossVectors(D, O);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(D, O, Z));
};
// repère d'entrée / de sortie : déduit de la caméra extérieure
const frameFromOutside = (out) => {
  const D = out.fwd.clone().normalize();
  const O = out.up.clone().addScaledVector(D, -out.up.dot(D));
  if (O.lengthSq() < 1e-6) O.set(0, 1, 0).addScaledVector(D, -D.y);
  return { D, O: O.normalize() };
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
  const io = frameFromOutside(out);
  const qIO = basisQ(io.D, io.O);
  const qOf = (i) => (i < 0 || i >= n ? qIO : basisQ(frames[i].D, frames[i].O));
  const bT = 0.13, bL = 1.45; // regard : droit devant / sur l'objet
  const rT = V.radius, rL = V.orbitR;
  const f = st.f;
  switch (st.phase) {
    case 'plunge': case 'surface': return poseIn(qIO, rT, bT, 0);
    case 'travel': {
      // (un peu de vie : le regard plonge vers l'objet qui passe, léger roulis)
      const b = bT + 0.1 * Math.sin(Math.PI * f) ** 2;
      return poseIn(qOf(st.room), rT, b, 0.12 * Math.sin(Math.PI * f));
    }
    case 'dwell': {
      const i = st.room;
      const qa = qOf(i - 1), qb = qOf(i);
      // (pièce vide : le regard ne s'attarde pas sur son centre)
      const empty = R.cells[frames.rooms?.[i] ?? ROOT]?.content.type === 'none';
      const look = (sm(0, 0.3, f) - sm(0.68, 1, f)) * (empty ? 0.45 : 1);
      const q = qa.clone().slerp(qb, sm(0.18, 0.82, f));
      // (même porte à l'arrivée et au départ : un petit tour de l'objet quand même)
      const same = qa.angleTo(qb) < 0.2 ? 1 : 0.35;
      return poseIn(q, rT + (rL - rT) * look, bT + (bL - bT) * look, same * 0.9 * Math.sin(Math.PI * f) * look);
    }
    default: return poseIn(qIO, rT, bT, 0);
  }
}
