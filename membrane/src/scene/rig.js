// Cinématique de l'armature dans le vertex shader : exactement celle de
// gen/kin.js (la simulation de la membrane s'est heurtée à cette armature-là).
//
//   q  = p·(1 + sc·e_s) + dir·ext·e_x
//   p' = b + R(a, th·e_r)·(q − b)
//
// Attributs : rigA = (b, th), rigB = (a, ext), rigC = (delay, sc, nature,
// tirage), rigD = (dir). Uniformes de la couche : t (temps de
// l'éclosion), tPrev (à l'image précédente : vecteurs vitesse), dur.
import { Fn, attribute, vec3, float, mix, step, cos, sin, cross, dot, clamp, length, positionGeometry, normalLocal, tangentLocal, positionPrevious } from 'three/tsl';

const E = (u) => { const v = clamp(u, 0, 1); return v.mul(v).mul(v).mul(v.mul(v.mul(6).sub(15)).add(10)); };

export function rigPosition(M, full) {
  return Fn(() => {
    const A = attribute('rigA', 'vec4'), B = attribute('rigB', 'vec4'), C = attribute('rigC', 'vec4'), Dd = attribute('rigD', 'vec4');
    const m1 = step(0.5, C.z);
    const dir = Dd.xyz;
    const pose = (t) => {
      const u = clamp(t.sub(C.x).div(M.dur), 0, 1);
      const ex = mix(E(u), E(u.div(0.45)), m1);
      const er = mix(E(u), E(u.sub(0.35).div(0.65)), m1);
      const th = A.w.mul(er), c = cos(th), s = sin(th), a = B.xyz;
      const rot = (v) => v.mul(c).add(cross(a, v).mul(s)).add(a.mul(dot(a, v)).mul(c.oneMinus()));
      const sig = C.y.mul(ex).add(1);
      const q = positionGeometry.mul(sig).add(dir.mul(B.w.mul(ex)));
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
