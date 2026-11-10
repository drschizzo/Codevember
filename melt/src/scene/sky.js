// Le ciel de la macro (studio HDR calculé, demi-flottants). Une plaque de
// glace de 30 µm ne se voit que par ce qu'elle reflète : comme les
// photographes de flocons (anneau lumineux autour de l'objectif, boîte à
// lumière), on place une grande source douce dans la direction où la face plane
// du cristal renvoie le regard de la caméra (azimut opposé, même hauteur). Les
// faces planes s'allument, les nervures et les pentes renvoient le ciel plus
// sombre à côté : elles se dessinent en traits. Une bande étroite, ailleurs,
// fait scintiller les arêtes quand la caméra se balance.
import * as THREE from 'three/webgpu';
import { smoothstep as ss } from '../rng.js';

const hex = (c) => c; // (couleurs HDR linéaires [r, g, b])

// R : recette. Le ciel suit la caméra du film (sa direction moyenne).
export function makeSky(R, W = 1024) {
  const H = W / 2;
  const data = new Uint16Array(W * H * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const S = R.sky;
  const camAz = R.camera.az, camEl = (R.camera.el * Math.PI) / 180;
  const boxAz = camAz + Math.PI, boxEl = camEl;
  const amb = hex(S.ambient), box = hex(S.box), strip = hex(S.strip), floor = hex(S.floor);
  // (boîte : demi-largeurs angulaires, un peu plus larges près du zénith)
  const bw = S.boxW, bh = S.boxH;
  const stripAz = camAz + Math.PI + S.stripOff;
  for (let j = 0; j < H; j++) {
    const elev = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(elev);
    for (let i = 0; i < W; i++) {
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      const dx = Math.cos(elev) * Math.cos(phi), dz = Math.cos(elev) * Math.sin(phi);
      const up = Math.max(0, y);
      let r = amb[0] * (0.4 + up), g = amb[1] * (0.4 + up), b = amb[2] * (0.4 + up);
      const fl = ss(0.02, -0.35, y);
      r += fl * floor[0]; g += fl * floor[1]; b += fl * floor[2];
      // boîte à lumière : distance angulaire au centre de la boîte, en
      // coordonnées locales (azimut × hauteur), bords adoucis
      const cx = Math.cos(boxEl) * Math.cos(boxAz), cy = Math.sin(boxEl), cz = Math.cos(boxEl) * Math.sin(boxAz);
      const dot = dx * cx + y * cy + dz * cz;
      if (dot > 0.3) {
        // repère tangent de la boîte
        const tx = -Math.sin(boxAz), tz = Math.cos(boxAz);
        const ux = -Math.sin(boxEl) * Math.cos(boxAz), uy = Math.cos(boxEl), uz = -Math.sin(boxEl) * Math.sin(boxAz);
        const a = Math.atan2(dx * tx + dz * tz, dot), e = Math.atan2(dx * ux + y * uy + dz * uz, dot);
        // (un diffuseur ovale aux bords très doux : dans une goutte, un reflet de
        // fenêtre floue, pas un rectangle)
        const q = Math.hypot(a / bw, e / bh);
        const k = ss(1.25, 0.55, q);
        const c = k * (0.8 + 0.2 * Math.cos(Math.min(1, q) * 1.57));
        r += c * box[0]; g += c * box[1]; b += c * box[2];
      }
      // bande étroite (arêtes)
      let d = Math.abs(phi - (((stripAz + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI));
      d = Math.min(d, Math.PI * 2 - d);
      const ks = ss(0.05, 0.02, d * Math.cos(elev)) * ss(0.65, 0.5, Math.abs(elev - S.stripEl));
      r += ks * strip[0]; g += ks * strip[1]; b += ks * strip[2];
      const o = (j * W + i) * 4;
      data[o] = half(r); data[o + 1] = half(g); data[o + 2] = half(b); data[o + 3] = half(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export const skyKey = (R) => JSON.stringify([R.sky, R.camera.az, R.camera.el]);
