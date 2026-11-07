// Impact géant : éclair et deux ondes de choc orange, accrochés à la planète
// survivante (sa position exacte est fournie à chaque image).
import * as THREE from 'three/webgpu';
import { uniform, vec4, exp, smoothstep } from 'three/tsl';
import { additive, spriteRadius } from './common.js';

const POOL = 6;

export function createFx(scene, camera) {
  const makeRing = (width) => {
    const U = { color: uniform(new THREE.Color()), k: uniform(0) };
    const m = new THREE.MeshBasicNodeMaterial(additive({ side: THREE.DoubleSide }));
    const d = spriteRadius(), x = d.sub(0.82).div(width);
    m.colorNode = vec4(U.color.mul(U.k), exp(x.mul(x).negate()).mul(smoothstep(1.0, 0.95, d)));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, U };
  };
  const impacts = Array.from({ length: POOL }, () => {
    const U = { color: uniform(new THREE.Color(1, 0.6, 0.3)), k: uniform(0) };
    const fm = new THREE.SpriteNodeMaterial(additive());
    const d = spriteRadius();
    fm.colorNode = vec4(U.color.mul(U.k), exp(d.mul(d).mul(-9.0)).add(exp(d.mul(-14.0)).mul(2.0)).mul(smoothstep(1.0, 0.8, d)));
    const fx = { flash: new THREE.Sprite(fm), U, r1: makeRing(0.06), r2: makeRing(0.14), t: -1, pos: [0, 0, 0], group: new THREE.Group() };
    fx.r1.U.color.value.setRGB(1, 0.7, 0.4);
    fx.r2.U.color.value.setRGB(1, 0.45, 0.2);
    fx.group.add(fx.flash, fx.r1.mesh, fx.r2.mesh);
    fx.group.visible = false;
    scene.add(fx.group);
    return fx;
  });
  const _p = new THREE.Vector3();

  return {
    // strength ~ masse de l'impacteur en M⊕
    impact(index, pos, strength) {
      const fx = impacts.reduce((b, f) => (f.t < 0 ? f : b.t < 0 ? b : f.t > b.t ? f : b)); // libre, sinon le plus ancien
      fx.t = 0; fx.index = index; fx.pos = pos.slice();
      fx.s = Math.min(1.6, 0.3 + 0.5 * Math.cbrt(strength));
      fx.k = Math.min(1, 0.2 + strength / 2); // une collision d'embryons n'aveugle pas
      fx.group.visible = true;
    },

    // getPos(index) → position actuelle de la planète, ou undefined si elle a disparu
    update(dtReal, getPos) {
      for (const f of impacts) {
        if (f.t < 0) continue;
        f.t += dtReal;
        const q = getPos(f.index);
        if (q) f.pos = q;
        const [x, y, z] = f.pos, t = f.t;
        // vu de près (suivi d'une planète), l'effet est réduit pour ne pas tout blanchir
        const near = Math.min(1, Math.max(0.07, camera.position.distanceTo(_p.set(x, y, z)) / 9));
        const S = f.s * near;
        const fl = Math.exp(-t * 1.8); // éclair : blanc → orange
        f.flash.position.set(x, y, z);
        f.flash.scale.setScalar(S * (0.6 + 2.6 * (1 - Math.exp(-t * 5))));
        f.U.k.value = 14 * fl * f.k;
        f.U.color.value.setRGB(1, 0.55 + 0.4 * fl, 0.25 + 0.6 * fl * fl);
        // ondes de choc dans le plan du disque
        f.r1.mesh.position.set(x, y + 0.001, z);
        f.r1.mesh.scale.setScalar(0.05 * near + S * 3.2 * (1 - Math.exp(-t * 1.6)));
        f.r1.U.k.value = 7 * Math.exp(-t * 1.0) * f.k;
        f.r2.mesh.position.set(x, y + 0.001, z);
        f.r2.mesh.scale.setScalar(0.05 * near + S * 6 * (1 - Math.exp(-t * 0.6)));
        f.r2.U.k.value = 3 * Math.exp(-t * 0.7) * Math.min(1, t * 4) * f.k;
        if (t > 6) { f.t = -1; f.group.visible = false; }
      }
    },
  };
}
