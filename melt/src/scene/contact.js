// Le contact : ce qui pose le cristal et les gouttes sur leur support.
//
// Sous une plaque de glace posée à plat, ou sous une goutte, le support reçoit
// moins de lumière diffuse (le ciel est en partie masqué) : une ombre de
// contact, serrée et sombre au bord, plus douce à l'intérieur. On la calcule
// dans la matière du support (et des fibres de laine), à partir de :
//  - la carte d'emprise du cristal (gen/crystal.js : instants d'attachement
//    et de fonte par texel) lue à l'instant t — exactement là où la glace est ;
//  - la liste des perles (leurs centres et rayons de base), calottes posées.
// Elle s'ajoute à l'ombre portée par le soleil (scene/stage.js, doubles
// opaques de la glace et des gouttes).
import * as THREE from 'three/webgpu';
import { uniform, uniformArray, texture, vec2, vec3, float, positionWorld, smoothstep, cos, sin, Loop, int, length, max as tmax, min as tmin, Fn, If } from 'three/tsl';
import { MAX_BLOBS } from '../gen/crystal.js';

export function createContact() {
  const blank = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  // perles présentes, rangées en tête (le shader ne parcourt que celles-là)
  const packed = Array.from({ length: MAX_BLOBS }, () => new THREE.Vector4());
  return { tex: texture(blank), ext: uniform(2), spin: uniform(0), on: uniform(1), blank, packed, PB: uniformArray(packed, 'vec4'), nB: uniform(0, 'int') };
}

// (appelé à chaque image) range les perles visibles en tête
export function packBlobs(CT, blobs) {
  let n = 0;
  for (const b of blobs) if (b.z > 0.004) CT.packed[n++].copy(b);
  CT.PB.array = CT.packed;
  CT.nB.value = n;
}

export function setCover(CT, cover) {
  const t = new THREE.DataTexture(cover.data, cover.size, cover.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  const old = CT.tex.value;
  CT.tex.value = t;
  CT.ext.value = cover.ext;
  if (old && old !== CT.blank) old.dispose();
}

// facteur d'occlusion (1 : rien ; < 1 : sous le cristal ou une goutte)
export function contactAO(CT, IU, WU) {
  return Fn(() => {
    // monde → repère du cristal (couché par −π/2 sur x, tourné de spin)
    const X = positionWorld.x, Y = positionWorld.z.negate();
    const c = cos(CT.spin), s = sin(CT.spin);
    const p = vec2(X.mul(c).add(Y.mul(s)), Y.mul(c).sub(X.mul(s)));
    const height = positionWorld.y.max(0).add(0.01); // (au-dessus du plan, moins d'occlusion)
    const covAt = (o) => {
      const t = CT.tex.sample(p.add(o).div(CT.ext).mul(0.5).add(0.5));
      const grown = smoothstep(t.r.sub(0.01), t.r.add(0.01), IU.tg);
      const left = smoothstep(IU.sm.sub(0.02), IU.sm.add(0.02), t.g);
      return t.a.mul(grown).mul(left);
    };
    const ice = float(0).toVar();
    If(length(p).lessThan(CT.ext), () => {
      const r1 = 0.035, r2 = 0.09;
      let near = covAt(vec2(0, 0));
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) near = near.add(covAt(vec2(a * r1, b * r1)));
      let wide = float(0);
      for (const [a, b] of [[1, 0.5], [-0.5, 1], [-1, -0.5], [0.5, -1]]) wide = wide.add(covAt(vec2(a * r2, b * r2)));
      ice.assign(near.div(5).mul(0.6).add(wide.div(4).mul(0.4)));
    });
    // perles : un anneau d'ombre serré à leur pied, plus clair au centre (la
    // lentille y concentre la lumière) ; seulement sous l'emprise du cristal,
    // et sur les perles présentes
    const w = float(0).toVar();
    If(length(p).lessThan(CT.ext), () => {
     Loop({ start: int(0), end: CT.nB }, ({ i }) => {
      const b = CT.PB.element(i);
      const d = length(p.sub(b.xy));
      const a = b.z;
      w.assign(tmax(w, smoothstep(a.mul(1.15), a.mul(0.9), d).mul(smoothstep(a.mul(0.3), a.mul(0.85), d).mul(0.6).add(0.4)).mul(smoothstep(0.004, 0.02, a))));
     });
    });
    const occ = tmax(ice.mul(0.5), w.mul(0.45)).mul(smoothstep(0.12, 0.0, height.sub(0.01)));
    return float(1).sub(occ.mul(CT.on));
  })();
}
