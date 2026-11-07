// Caméra : vols entre points de vue, suivi d'une planète, secousse.
//
// Suivie, une planète est accompagnée sur son orbite dans un repère qui tourne
// avec elle autour de l'étoile : son éclairage ne change pas (sinon on finit
// côté nuit). On peut toujours tourner autour et zoomer.
import * as THREE from 'three/webgpu';

export const CLOUD_VIEW = new THREE.Vector3(0, 13, 30); // vue large du nuage (début de cycle)
const HOME = new THREE.Vector3(0, 6.5, 12.5);           // vue d'ensemble du disque
const TARGET = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const MIN_DIST = 0.6, MIN_DIST_FOLLOW = 0.04;

export function createCameraRig(camera, controls) {
  let move = null;                         // vol en cours
  const last = new THREE.Vector3();        // dernière position de la planète suivie
  const shakeOff = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const angleOf = (v) => Math.atan2(v.z, v.x);
  const startMove = (opts) => { move = { t: 0, dur: 1.6, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), ...opts }; };

  const rig = {
    follow: -1, // index de la planète suivie (-1 : aucune)

    // glisse jusqu'à la planète i (position `at`, rayon affiché `radius`) puis la suit
    focus(i, at, radius) {
      rig.follow = i;
      // de côté, un peu vers l'étoile et au-dessus : la planète apparaît éclairée
      // aux trois quarts (vue de l'extérieur, on ne verrait que sa face de nuit)
      const d = 0.3 + 7 * radius;
      const radial = at.clone().setY(0).normalize();
      const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
      const offset = tangent.multiplyScalar(-0.9).addScaledVector(radial, -0.25).add(new THREE.Vector3(0, 0.4, 0)).normalize().multiplyScalar(d);
      startMove({ offset });
      controls.minDistance = MIN_DIST_FOLLOW;
      last.copy(at);
    },

    // retour à la vue d'ensemble ; false s'il n'y avait rien à faire
    overview() {
      if (rig.follow < 0 && !move) return false;
      rig.follow = -1;
      startMove({ home: true });
      return true;
    },

    // vol vers un point de vue large (dest, ou la vue d'ensemble), sauf pendant un suivi
    flyHome(dest = null, dur = 3) {
      if (rig.follow >= 0) return;
      startMove({ home: true, dest, dur });
    },

    // here : position de la planète suivie à l'instant présent (ou null)
    update(real, here) {
      if (rig.follow >= 0 && !here && move && !move.home) return; // attend la première prédiction
      if (move) {
        move.t += real;
        if (here && !move.home) move.offset.applyAxisAngle(UP, -(angleOf(here) - angleOf(last)));
        const k = Math.min(1, move.t / move.dur), e = k * k * (3 - 2 * k);
        const toTarget = move.home ? TARGET : here;
        const toPos = move.home ? (move.dest || HOME) : here.clone().add(move.offset);
        controls.target.lerpVectors(move.fromTarget, toTarget, e);
        camera.position.lerpVectors(move.fromPos, toPos, e);
        if (k >= 1) { if (move.home) controls.minDistance = MIN_DIST; move = null; }
      } else if (here) {
        _v.subVectors(camera.position, controls.target).applyAxisAngle(UP, -(angleOf(here) - angleOf(last)));
        controls.target.copy(here);
        camera.position.copy(here).add(_v);
      }
      if (here) last.copy(here);
    },

    // secousse (k ∈ [0, 1]) appliquée le temps d'un rendu
    shake(k) {
      const a = k * k * 0.04 * camera.position.length() / 14;
      shakeOff.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      camera.position.add(shakeOff);
    },
    unshake() { camera.position.sub(shakeOff); },
  };
  return rig;
}
