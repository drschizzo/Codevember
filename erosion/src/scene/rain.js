// La pluie (famille « Ravines ») : des gouttes qui tombent des aiguilles de
// la rampe jusqu'au sable. Chaque goutte est une instance dont la position
// est une fonction de la phase : la goutte i, à son n-ième cycle, part d'un
// point tiré par hachage (i, n) — le caisson à aiguilles oscille, comme ceux des
// simulateurs de pluie, pour que les gouttes ne tombent pas toujours au même endroit —,
// tombe à 4,6 m/s (gouttes de 2 mm après 1,3 m de chute) et s'arrête sur le vrai
// relief (lu dans la texture du lit courant). La période d'un cycle divise la
// durée de la boucle : la pluie est périodique. Hors des averses, les gouttes
// sont réduites à rien (taille nulle) : rien n'apparaît d'un coup.
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, vec2, float, int, ivec2, uniform, attribute, positionGeometry, textureLoad, floor, fract, clamp, min as tmin, max as tmax,
  hash, sin, mix, smoothstep, positionPrevious,
} from 'three/tsl';
import { TABLE } from '../gen/table.js';
import { stableVelocity } from './materials.js';

export const RAIN_TOP = 1.4;    // hauteur des aiguilles (m) : au-dessus de toutes les caméras du film

export function createRain(gs, { lite = false } = {}) {
  const COUNT = lite ? 700 : 1600;
  const U = { t: uniform(0), tPrev: uniform(0), period: uniform(0.32), on: uniform(0), speed: uniform(4.6), x1: uniform(TABLE.Lx) };
  // une goutte : un fuseau étroit (6 côtés), long de 1 (étiré dans le shader)
  const base = new THREE.CylinderGeometry(0.00035, 0.00035, 1, 6, 1, true);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('normal', base.attributes.normal);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) seeds[i] = i;
  geo.setAttribute('drop', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.instanceCount = COUNT;

  const { NX, NY, l } = gs;
  const ld = (x, y) => textureLoad(gs.terrainTex, ivec2(clamp(x, int(0), int(NX - 1)), clamp(y, int(0), int(NY - 1))));

  const mat = new THREE.MeshPhysicalNodeMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false });
  // position d'un sommet de la goutte au temps t (s)
  const at = (t) => {
    const i = attribute('drop', 'float');
    const ph = t.div(U.period).add(hash(i.add(0.5)));
    const n = floor(ph), f = fract(ph);
    const hx = hash(i.mul(1.37).add(n.mul(7.13)).add(1)), hz = hash(i.mul(2.11).add(n.mul(3.71)).add(2));
    const x = hx.mul(U.x1), z = hz.mul(TABLE.Ly - 0.01).add(0.005);
    // le sol sous la goutte (lit courant, plus proche voisin)
    const g = ld(int(floor(x.div(l))), int(floor(z.div(l)))).x;
    const fall = f.mul(U.period).mul(U.speed);
    const y = float(RAIN_TOP).sub(fall);
    const len = tmin(0.028, tmax(0, y.sub(g)));
    const live = float(1).sub(smoothstep(0.0, 0.004, g.sub(y))).mul(hash(i.mul(0.731).add(9)).lessThan(U.on).select(float(1), float(0)));
    const p = positionGeometry;
    return vec3(p.x.mul(live).add(x.sub(TABLE.Lx / 2)), p.y.mul(len).mul(live).add(tmax(y, g)), p.z.mul(live).add(z.sub(TABLE.Ly / 2)));
  };
  // la pose à l'image précédente : la goutte a une vraie vitesse (traînée de
  // l'obturateur dans le flou de mouvement, reprojection juste du TRAA)
  mat.positionNode = Fn(() => { positionPrevious.assign(at(U.tPrev)); return at(U.t); })();
  if (!lite) mat.mrtNode = stableVelocity(); // (une goutte qui renaît en haut ne doit pas tirer un trait)
  mat.opacityNode = float(0.55);
  mat.emissiveNode = vec3(0.12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  return {
    mesh, U,
    update(F, ph, duration, S) {
      const on = F.rain > 0 ? Math.min(1, F.rain / (S.rain?.rate || 1)) : 0;
      U.on.value = on;
      const t = ph * duration;
      // (saut de lecture, boucle qui recommence : pas de vitesse démesurée)
      U.tPrev.value = Math.abs(t - U.t.value) < 0.1 ? U.t.value : t;
      U.t.value = t;
      U.period.value = duration / Math.round(duration / 0.32); // (un nombre entier de cycles par boucle ; la chute dure moins d'un cycle)
      U.x1.value = S.rain?.x1 ?? TABLE.Lx;
    },
  };
}
