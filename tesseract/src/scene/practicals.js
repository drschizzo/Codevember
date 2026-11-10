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
//
// Le dosage. Une même lampe brûlait une pièce de marbre blanc et laissait
// dans le noir une pièce de laque sombre (posemètre : parois à 4–7 d'un côté,
// 0,01 de l'autre, pour un blanc à 1). Comme sur un plateau, chaque pièce a
// donc sa puissance, réglée sur la clarté de sa doublure (roomGain) : la pièce
// claire reste claire et la sombre reste sombre, mais toutes deux tiennent
// dans la plage de l'image. De même la lumière de vedette se règle sur la
// clarté de l'objet (heroGain) : une perle de nacre ne reçoit pas ce qu'il
// faut à un bronze.
//
// La gorge lumineuse : un filet de lumière au pourtour du plafond de chaque
// pièce du voyage. C'est d'elle que la lumière semble venir (une source
// invisible laissait sur les murs une tache sans cause), et elle dessine la
// courbure de l'espace.
import * as THREE from 'three/webgpu';
import { Fn, vec4, positionGeometry, uniform } from 'three/tsl';
import { apply, normalOf, project, embedLocal, smoothstep, cellMatrix } from '../math4.js';
import { meshUniforms, setMatrix, mapPoint } from './project.js';
import { G } from './globals.js';
import { PROBE_LAYER } from './probe.js';
import { roomGain, heroGain } from './dose.js';

export { roomGain, heroGain };

const CEILING = 0.72; // hauteur de la source, en demi-côtés de cellule (l'objet en fait au plus 0,55)
// En voyage, chaque pièce n'est éclairée que par sa propre lampe (éclairage
// sélectif, voir tesseract.js) : elle doit remplacer celles des six pièces
// voisines, qui traversaient autrefois les parois.
const VOYAGE_GAIN = 1.5; // (appoint : le projecteur du plafond porte la lumière de la pièce, voir stage.js)

// rotations (ligne-major) qui amènent l'axe +y sur chaque face (−x, +x, −y, +y, −z, +z)
const TO_FACE = [
  [0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 1, 0, -1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, -1, 0, 0, 0, -1], [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 0, -1, 0], [1, 0, 0, 0, 0, -1, 0, 1, 0],
];
// gorge lumineuse : un cadre mince sous le plafond (face +y de la cellule)
function coveGeometry(y, half, w) {
  const pos = [], idx = [], N = 12;
  for (let side = 0; side < 4; side++) {
    const rot = (a, b) => [[a, b], [-b, a], [-a, -b], [b, -a]][side];
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = -1 + (2 * i) / N;
      for (const r of [half, half - w]) { const [a, b] = rot(t * r, r); pos.push(a, y, b); }
    }
    for (let i = 0; i < N; i++) { const a = base + 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  return g;
}
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
  // gorges lumineuses (une par cellule ; visibles pendant le voyage)
  const coveGeo = coveGeometry(0.86, 0.84, 0.022);
  const coves = Array.from({ length: 8 }, () => {
    const M = meshUniforms(), color = uniform(new THREE.Color(0, 0, 0));
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    m.positionNode = Fn(() => mapPoint(positionGeometry, M.A, G.d, G.inflate))();
    m.colorNode = vec4(color, 1);
    const mesh = new THREE.Mesh(coveGeo, m);
    mesh.frustumCulled = false; mesh.visible = false;
    mesh.layers.enable(PROBE_LAYER); // (la sonde de pièce la voit : c'est une source)
    group.add(mesh);
    return { mesh, M, color };
  });

  return {
    lights, heroes, centers, halves, coves,
    // T : transformations des cellules ; scale : échelle du groupe (dont la
    // rotation doit déjà être à jour)
    // ceil : face du plafond de chaque cellule (2 × axe + signe)
    update(R, T, scale, ceil = null) {
      const V = R.view, kv = G.voyageK.value, inset = R.proj.inset;
      // le haut du monde, dans le repère du groupe (espace projeté)
      _up.set(0, 1, 0).applyQuaternion(_q.copy(group.quaternion).invert());
      for (let c = 0; c < 8; c++) {
        const ctr = apply(T[c], normalOf(c));
        const p0 = proj(ctr);
        // échelle locale de la projection au centre de la cellule
        const p1 = proj(apply(T[c], embedLocal(c, [0.3, 0, 0])));
        const lam = Math.min(4, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / 0.3);
        // plafond : haut du monde dehors, face du plafond de la pièce dedans
        const face = ceil?.[c] ?? 3, lc = [0, 0, 0];
        lc[face >> 1] = (face & 1 ? 1 : -1) * CEILING;
        const pIn = proj(apply(T[c], embedLocal(c, lc)));
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
        const base = V.practical * (1 - out) * scale * scale * size ** 1.6;
        // (dehors, les cellules sont vues de loin et par leurs ajours : demi-dosage)
        const dose = roomGain(R.cells[c]) ** (0.5 + 0.5 * kv);
        L.intensity = base * (1 + (VOYAGE_GAIN - 1) * kv) * dose;
        L.distance = 2.4 * scale * size * (1 + 0.25 * kv);
        // (la vedette ne prend pas le gain du voyage, fait pour les parois, et
        // compense son rapprochement : l'objet reçoit autant que dehors ; sinon
        // il recevait une dizaine de fois plus et brûlait, surtout clair)
        const H = heroes[c], reach = HERO.far + (HERO.near - HERO.far) * kv;
        H.color.copy(L.color);
        H.intensity = base * V.hero * (reach / HERO.far) ** 2 * heroGain(R.cells[c].content);
        // gorge lumineuse : la couleur de la lampe, vive (elle doit lire comme
        // une source), à la mesure de la pièce
        const cove = coves[c];
        cove.mesh.visible = kv > 0.01 && out < 0.98;
        if (cove.mesh.visible) {
          setMatrix(cove.M.A, cellMatrix(T[c], c, inset, { m3: TO_FACE[face], t3: [0, 0, 0] }));
          cove.color.value.copy(L.color).multiplyScalar(5 * kv * (1 - out) * (V.cove ?? 1) * dose ** 0.5);
        }
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
