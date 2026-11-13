// La caméra du film : un plan large pendant les averses (toute la pièce, la
// pluie), un rapprochement lent quand la machine se met en place, le gros
// plan qui accompagne le front pendant le décapage, puis le recul. Aucune
// coupe. La trajectoire brute est échantillonnée sur la boucle, lissée par un
// noyau gaussien périodique (elle se referme), puis interpolée : la pose ne
// dépend que de la recette et de u. Module pur (tests : vitesse angulaire et
// accélération bornées).
import { sstep } from './timeline.js';

const { PI, sin, cos, exp, max, min, floor, hypot, atan2, asin } = Math;
const N = 720;

// focus(u) : point suivi pendant le décapage (monde) ; box : boîte de la pièce
// (monde, au repos) ; extra : boîte élargie (machine) pour le plan large
export function cameraPath(R, { box, focus, frameBox = box }) {
  const C = R.camera, T = R.timing;
  const c = [0, 1, 2].map((k) => (frameBox.lo[k] + frameBox.hi[k]) / 2);
  const ext = [0, 1, 2].map((k) => frameBox.hi[k] - frameBox.lo[k]);
  const fovV = (C.fov * PI) / 180;
  // distance qui cadre la boîte (largeur et hauteur, écran 16:9 supposé)
  const halfW = Math.max(ext[0], ext[2] * 0.6) / 2, halfH = ext[1] / 2;
  const dWide = C.fit * Math.max(halfH / Math.tan(fovV / 2), halfW / (Math.tan(fovV / 2) * 1.6)) + ext[2] * 0.5;
  const el = (C.el * PI) / 180;
  const raw = [];
  for (let i = 0; i < N; i++) {
    const u = i / N;
    // rapprochement : de la mise en place au retrait
    const close = sstep(T.setup0 - 0.02, T.clean0 + 0.03, u) * (1 - sstep(T.clean1 - 0.01, T.retract1 + 0.01, u));
    const f = focus(u) ?? c;
    const tgt = [0, 1, 2].map((k) => c[k] + (f[k] - c[k]) * close * 0.5);
    const d = dWide * (1 - (1 - C.close) * close);
    // (laser : le gros plan reste dans l'ouverture du portique — décalé de
    // côté, il passait derrière un pied, qui barrait l'image)
    const side = (C.side ?? 0.38) * (R.machine?.kind === 'laser' ? 0.35 : 1);
    const az = C.az + C.sway * sin(2 * PI * u) + side * close * (C.az >= 0 ? 1 : -1);
    const e = el * (1 - 0.25 * close);
    raw.push([...tgt, d, az, e]);
  }
  // lissage gaussien périodique (σ en part de boucle)
  const sig = 0.022, K = Math.ceil(3 * sig * N), w = [];
  for (let j = -K; j <= K; j++) w.push(exp(-0.5 * ((j / N) / sig) ** 2));
  const ws = w.reduce((a, b) => a + b, 0);
  const sm = raw.map((_, i) => { const o = [0, 0, 0, 0, 0, 0]; for (let j = -K; j <= K; j++) { const r = raw[(i + j + N) % N]; for (let k = 0; k < 6; k++) o[k] += r[k] * w[j + K]; } return o.map((v) => v / ws); });
  const at = (u) => {
    const x = (((u % 1) + 1) % 1) * N, i = floor(x), t = x - i;
    const p0 = sm[(i - 1 + N) % N], p1 = sm[i % N], p2 = sm[(i + 1) % N], p3 = sm[(i + 2) % N];
    const cr = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    const tg = [cr(0), cr(1), cr(2)], d = cr(3), az = cr(4), e = cr(5);
    const pos = [tg[0] + d * cos(e) * sin(az), tg[1] + d * sin(e), tg[2] + d * cos(e) * cos(az)];
    // (jamais sous le sol)
    pos[1] = Math.max(pos[1], 0.25);
    return { pos, target: tg, fov: C.fov };
  };
  return { at, dWide };
}

// mesures : vitesse angulaire de pointe (°/s) et accélération (u/s²) à 120 i/s
export function cameraStats(path, duration) {
  const dt = 1 / 120, n = Math.round(duration / dt);
  let wMax = 0, aMax = 0, prev = null, prevV = null;
  for (let i = 0; i <= n; i++) {
    const u = i / n, P = path.at(u);
    const dir = [P.target[0] - P.pos[0], P.target[1] - P.pos[1], P.target[2] - P.pos[2]];
    const l = hypot(...dir), d = dir.map((v) => v / l);
    if (prev) {
      const dot = Math.max(-1, Math.min(1, d[0] * prev.d[0] + d[1] * prev.d[1] + d[2] * prev.d[2]));
      wMax = max(wMax, (Math.acos(dot) * 180) / PI / dt);
      const v = P.pos.map((x, k) => (x - prev.pos[k]) / dt);
      if (prevV) aMax = max(aMax, hypot(...v.map((x, k) => (x - prevV[k]) / dt)));
      prevV = v;
    }
    prev = { d, pos: P.pos };
  }
  return { wMax, aMax };
}
