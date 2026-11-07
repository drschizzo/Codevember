// Rendu de la simulation : poussière, fond d'étoiles, étoile, planètes,
// effets et post-traitement. Les uniformes V sont partagés par tous les
// shaders et pilotés depuis main.js.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createDust, DUST_K } from './dust.js';
import { createSky } from './sky.js';
import { createStar } from './star.js';
import { createPlanets } from './planets.js';
import { createFx } from './fx.js';
import { createPost } from './post.js';
import { noVelocity } from './common.js';

export function createVisuals(renderer, scene, camera, sim, cfg) {
  const V = {
    colorMode: uniform(0, 'int'),   // 0 provenance, 1 roche / glace, 2 température
    alpha: uniform(0.19 / DUST_K ** 2),
    dustK: uniform(1.0),            // éclat global de la poussière
    size: uniform(0.0085 * DUST_K * Math.min(3, Math.sqrt((1 << 20) / sim.N))),
    light: uniform(1.5),
    ambient: uniform(0.04),
    // étoile (pilotée par le cycle de vie)
    starCol: uniform(new THREE.Color(1.0, 0.82, 0.62)),
    starI: uniform(6.0),            // éclat du disque stellaire
    lightK: uniform(1.0),           // éclairement relatif (luminosité, adoucie)
    jets: uniform(0.0),
    sizeK: uniform(1.0),            // grossissement des grains (nuage en effondrement)
    shell: uniform(0.0),            // rémanent de supernova : intensité
    selected: uniform(-1, 'int'),
    exposure: uniform(cfg.exposure),
    peak: uniform(cfg.peak),        // pic de l'écran HDR, en multiples du blanc de l'interface
    planetK: uniform(1.0),          // grossissement des planètes (DA mécanique : billes sur leurs tiges)
    // objectif : mise au point, profondeur de champ, flou de mouvement
    focus: uniform(30.0),
    focusRange: uniform(9.0),
    bokeh: uniform(1.0),
    blurK: uniform(0.5),
    collect: uniform(0.0),          // fin de cycle : les débris sont aspirés par la trémie (0 → 1)
    aperture: uniform(0.0),         // cercle de confusion des grains loin du plan net
    shutter: uniform(0.0),          // temps d'obturation (unités de simulation) : traînées des grains
    camVel: uniform(new THREE.Vector3()), // vitesse de la caméra (traînées relatives à elle)
    planetFlux: uniform(4.0),       // éclairement maximal des planètes
    starK: uniform(1.0),            // éclat de l'étoile (abaissé en DA mécanique)
    // HDR : le disque stellaire monte vers le pic de l'écran ; le bloom ne voit
    // pas ce surplus (bloomCap), sinon le halo noierait les planètes proches
    starHdr: uniform(cfg.starHdr),
    limbAmt: uniform(cfg.hdr ? 0.3 : 0.6),
    bloomCap: uniform(1e4),
    grainK: uniform(1.0),           // grain de pellicule (coupé pour l'export vidéo)
    innerSoft: uniform(0.0),        // adoucit l'éclairement des grains tout près de l'étoile
  };

  const dust = createDust(sim, V);
  scene.add(dust, createSky(V));
  const star = createStar(scene, camera, V);
  const planets = createPlanets(sim, V);
  scene.add(planets.mesh);
  const fx = createFx(scene, camera);
  const pipeline = createPost(renderer, scene, camera, V, cfg);

  // Les matériaux additifs ou transparents n'écrivent pas de vitesse (sinon un
  // million de grains additionneraient leurs vecteurs), ni les objets
  // instanciés qui bougent par leur buffer (les planètes suivies par la caméra
  // seraient étalées jusqu'à disparaître).
  if (cfg.lens) {
    const zeroVel = noVelocity();
    scene.traverse((o) => {
      for (const m of o.material ? [].concat(o.material) : []) {
        if (m.blending === THREE.AdditiveBlending || m.transparent || o.count > 1) m.mrtNode = zeroVel;
      }
    });
  }

  return {
    V, pipeline, dust, planets: planets.mesh,
    star: star.star, pulsar: star.pulsar, shell: star.shell, flyStar: star.flyStar,
    setStar: star.set, updatePulsar: star.updatePulsar,
    setEvo: planets.setEvo, pulse: planets.pulse,
    impact: fx.impact,
    updateFx(dtReal, getPos) { fx.update(dtReal, getPos); planets.update(dtReal); },
  };
}
