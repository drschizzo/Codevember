// Cinématique de l'armature dans le vertex shader : exactement celle de
// gen/kin.js (la simulation de la membrane s'est heurtée à cette armature-là).
//
//   q  = b + (p − b)·(1 + sc·e_s) + dir·ext·e_x
//   p' = b + R(a, th·e_r)·(q − b)
//
// Attributs : rigA = (b, th), rigB = (a, ext), rigC = (delay, sc, nature,
// tirage), rigD = (dir). Uniformes de la couche : t (temps de
// l'éclosion), tPrev (à l'image précédente : vecteurs vitesse), dur.
import { Fn, attribute, vec3, float, mix, step, cos, sin, cross, dot, clamp, length, floor, fract, pow, max, positionGeometry, normalLocal, tangentLocal, positionPrevious } from 'three/tsl';

const E = (u) => { const v = clamp(u, 0, 1); return v.mul(v).mul(v).mul(v.mul(v.mul(6).sub(15)).add(10)); };
// les assauts (voir gen/kin.js) ; M.sn, M.sa, M.sf (f = 0 : aucun)
export const struggleNode = (u, M) => {
  const f = max(M.sf, 1e-5), n = max(M.sn, 1);
  const w = u.div(f).mul(n), k = floor(w), v = fract(w);
  const pulse = M.sa.mul(k.add(1).div(n).mul(0.55).add(0.45)).mul(sin(pow(v, 0.75).mul(Math.PI)).pow(2));
  const fin = u.sub(M.sf).div(float(1).sub(M.sf));
  return mix(fin, pulse, step(u, M.sf).mul(step(1e-4, M.sf)));
};

export function rigPosition(M, full) {
  return Fn(() => {
    const A = attribute('rigA', 'vec4'), B = attribute('rigB', 'vec4'), C = attribute('rigC', 'vec4'), Dd = attribute('rigD', 'vec4');
    const m1 = step(0.5, C.z);
    const dir = Dd.xyz;
    const pose = (t) => {
      const u = struggleNode(clamp(t.sub(C.x).div(M.dur), 0, 1), M);
      const ex = mix(E(u), E(u.div(0.45)), m1);
      const er = mix(E(u), E(u.sub(0.35).div(0.65)), m1);
      const th = A.w.mul(er), c = cos(th), s = sin(th), a = B.xyz;
      const rot = (v) => v.mul(c).add(cross(a, v).mul(s)).add(a.mul(dot(a, v)).mul(c.oneMinus()));
      const sig = C.y.mul(ex).add(1);
      const q = positionGeometry.sub(A.xyz).mul(sig).add(A.xyz).add(dir.mul(B.w.mul(ex)));
      return { rot, p: A.xyz.add(rot(q.sub(A.xyz))) };
    };
    const now = pose(M.t);
    const p = now.p.toVar('rigP');
    if (full) {
      normalLocal.assign(now.rot(normalLocal));
      tangentLocal.assign(now.rot(tangentLocal));
      positionPrevious.assign(pose(M.tPrev).p);
    }
    return p;
  })();
}

export { vec3, float };
