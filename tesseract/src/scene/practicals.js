// Lumières d'écrin : une petite source dans chaque cellule, qui éclaire la
// doublure, fait briller l'objet exposé et filtre par les ajours.
//
// La source est placée sous le « plafond » de la cellule, au-dessus de
// l'objet : au centre, elle serait dans l'objet (toutes ses normales lui
// tourneraient le dos, et il ne recevrait rien). Dehors, le plafond est le
// haut du monde ; pendant le voyage intérieur, c'est l'axe y de la pièce
// (la caméra n'a plus de haut fixe).
//
// Elle s'éteint quand la cellule passe à l'extérieur (son objet s'est rentré).
// En voyage, chaque pièce est éclairée à sa taille projetée (les pièces
// voisines, plus loin de la caméra, sont projetées plus grandes) : on les voit
// éclairées avant d'y entrer, et chacune a sa nuance.
//
// Chaque cellule a aussi une lumière de vedette, réservée à son objet exposé
// (éclairage sélectif, voir tesseract.js) : une source principale placée du
// côté de la caméra et au-dessus, qui détache l'objet de sa doublure sans
// éclairer celle-ci. C'est l'objet qui porte le plus fort contraste local.
import * as THREE from 'three/webgpu';
import { apply, normalOf, project, embedLocal, smoothstep } from '../math4.js';
import { G } from './globals.js';

const CEILING = 0.72; // hauteur de la source, en demi-côtés de cellule (l'objet en fait au plus 0,55)
// En voyage, chaque pièce n'est éclairée que par sa propre lampe (éclairage
// sélectif, voir tesseract.js) : elle doit remplacer celles des six pièces
// voisines, qui traversaient autrefois les parois.
const VOYAGE_GAIN = 3.5;
// lumière de vedette (intensité : R.view.hero × celle de la lumière d'écrin) :
// distance à l'objet (en demi-côtés de cellule, dehors / en voyage, où l'objet
// est réduit) et élévation de sa direction au-dessus de celle de la caméra
const HERO = { far: 0.8, near: 0.42, lift: 0.8 };

function pointLight(scene) {
  const L = new THREE.PointLight(0xffffff, 0, 1, 2);
  L.castShadow = false;
  scene.add(L);
  return L;
}

export function createPracticals(group, scene) {
  const lights = Array.from({ length: 8 }, () => pointLight(scene));
  const heroes = Array.from({ length: 8 }, () => pointLight(scene));
  // ce que la lumière de vedette retient de la dernière image : centre de
  // l'objet (monde), demi-côté projeté de la cellule (monde)
  const centers = Array.from({ length: 8 }, () => new THREE.Vector3()), halves = new Array(8).fill(1);
  const _up = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _tint = new THREE.Color();
  const proj = (x) => project(x, G.d.value, G.inflate.value);

  return {
    lights, heroes,
    // T : transformations des cellules ; scale : échelle du groupe (dont la
    // rotation doit déjà être à jour)
    update(R, T, scale) {
      const V = R.view, kv = G.voyageK.value;
      // le haut du monde, dans le repère du groupe (espace projeté)
      _up.set(0, 1, 0).applyQuaternion(_q.copy(group.quaternion).invert());
      for (let c = 0; c < 8; c++) {
        const ctr = apply(T[c], normalOf(c));
        const p0 = proj(ctr);
        // échelle locale de la projection au centre de la cellule
        const p1 = proj(apply(T[c], embedLocal(c, [0.3, 0, 0])));
        const lam = Math.min(4, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / 0.3);
        // plafond : haut du monde dehors, axe y de la pièce dedans
        const pIn = proj(apply(T[c], embedLocal(c, [0, CEILING, 0])));
        const h = CEILING * lam * (1 - kv);
        _v.set(
          p0[0] + _up.x * h + (pIn[0] - p0[0]) * kv,
          p0[1] + _up.y * h + (pIn[1] - p0[1]) * kv,
          p0[2] + _up.z * h + (pIn[2] - p0[2]) * kv,
        );
        group.localToWorld(_v);
        group.localToWorld(centers[c].set(p0[0], p0[1], p0[2]));
        halves[c] = lam * scale;

        const out = smoothstep(0.3, 0.9, ctr[3]) * (R.proj.reveal ?? 1);
        const size = 1 + (lam - 1) * kv;
        const L = lights[c];
        L.position.copy(_v);
        L.color.set(V.practicalColor);
        if (kv > 0) L.color.lerp(_tint.setHSL((c * 0.137 + 0.05) % 1, 0.55, 0.62), 0.35 * kv);
        L.intensity = V.practical * (1 - out) * scale * scale * size ** 1.6 * (1 + (VOYAGE_GAIN - 1) * kv);
        L.distance = 2.4 * scale * size * (1 + 0.25 * kv);
        const H = heroes[c];
        H.color.copy(L.color);
        H.intensity = L.intensity * V.hero;
      }
    },
    // place les lumières de vedette pour la caméra du film (position monde)
    aim(camPos) {
      const kv = G.voyageK.value, reach = HERO.far + (HERO.near - HERO.far) * kv;
      _up.set(0, 1, 0);
      for (let c = 0; c < 8; c++) {
        const H = heroes[c], r = reach * halves[c];
        _v.subVectors(camPos, centers[c]).normalize().addScaledVector(_up, HERO.lift).normalize();
        H.position.copy(centers[c]).addScaledVector(_v, r);
        H.distance = 3 * r;
      }
    },
  };
}
