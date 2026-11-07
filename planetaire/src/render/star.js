// L'étoile et ses avatars : protoétoile et jets, étoile, supergéante, puis
// rémanent de supernova et pulsar. Plus l'étoile vagabonde (touche E).
import * as THREE from 'three/webgpu';
import {
  uniform, float, vec3, vec4, exp, max, mix, uv, smoothstep, varying, positionLocal, normalLocal, normalize,
  dot, pow, sin, cos, time, abs, mx_fractal_noise_float, mx_noise_float, normalWorld,
} from 'three/tsl';
import { additive, toCamera, spriteRadius } from './common.js';

// halo radial d'un sprite (couleur déjà multipliée)
const haloShape = () => exp(spriteRadius().mul(6.0).negate()).sub(Math.exp(-6.0)).max(0);

export function createStar(scene, camera, V) {
  // ── Étoile centrale : couleur, éclat et rayon pilotés par le cycle de vie
  const star = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicNodeMaterial());
  {
    // granulation : la surface bouillonne (surtout visible sur la géante)
    const gran = mx_fractal_noise_float(normalLocal.mul(6.0).add(vec3(time.mul(0.05), 0, 0)), 3, 2.0, 0.5);
    const limb = max(dot(normalize(normalLocal), toCamera()), 0.0).pow(0.4);
    core.material.colorNode = V.starCol.mul(V.starI).mul(V.starK).mul(sin(time.mul(3.0)).mul(0.03).add(1.0))
      .mul(gran.mul(0.25).add(1.0)).mul(limb.sub(1.0).mul(V.limbAmt).add(1.0)).mul(V.starHdr);
    core.scale.setScalar(0.15);
    star.add(core);
  }
  const halo = new THREE.Sprite(new THREE.SpriteNodeMaterial(additive()));
  halo.material.colorNode = vec4(V.starCol.mul(V.starI).mul(V.starK).mul(0.25), haloShape());
  halo.scale.setScalar(1.3);
  star.add(halo);
  {
    // jets bipolaires de la protoétoile, le long de l'axe de rotation
    const jm = new THREE.MeshBasicNodeMaterial(additive({ side: THREE.DoubleSide }));
    const along = float(1).sub(uv().y);                                      // 0 contre l'étoile, 1 au bout
    const knots = sin(along.mul(40.0).sub(time.mul(6.0))).mul(0.3).add(0.7); // nœuds de choc qui s'éloignent
    const across = abs(dot(normalWorld, toCamera())).pow(2.0);              // plus dense au centre du jet
    jm.colorNode = vec4(vec3(0.55, 0.75, 1.0).mul(V.jets).mul(1.3).mul(knots), across.mul(float(1).sub(along)).mul(smoothstep(0.0, 0.05, along)));
    for (const sgn of [1, -1]) {
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 5.5, 24, 1, true).translate(0, -2.75, 0), jm);
      jet.rotation.x = sgn > 0 ? Math.PI : 0;
      star.add(jet);
    }
  }
  scene.add(star);

  // ── Pulsar : axe magnétique incliné sur l'axe de rotation, les deux faisceaux
  // balaient le ciel comme un phare. Lignes de champ dipolaires, nébuleuse de
  // vent en tore équatorial (comme au cœur de la nébuleuse du Crabe). Rotation
  // ralentie : un vrai pulsar jeune tourne ~30 fois par seconde.
  const PU = { k: uniform(0), flash: uniform(0) };
  const pulsar = new THREE.Group();       // tourne autour de l'axe de rotation (y)
  const magAxis = new THREE.Group();      // incliné : porte l'axe magnétique
  magAxis.rotation.z = 1.0;               // ~57° : les faisceaux passent près de la ligne de visée
  pulsar.scale.setScalar(2.4);
  pulsar.add(magAxis);
  pulsar.visible = false;
  scene.add(pulsar);
  {
    // faisceaux : cônes fins, plus intenses au centre et près de l'étoile, parcourus de stries
    const bm = new THREE.MeshBasicNodeMaterial(additive({ side: THREE.DoubleSide }));
    const along = float(1).sub(uv().y);
    const coreK = abs(dot(normalWorld, toCamera())).pow(3.0);
    const streaks = sin(along.mul(60.0).sub(time.mul(14.0))).mul(0.25).add(0.75)
      .mul(mx_noise_float(vec3(uv().x.mul(12.0), along.mul(8.0).sub(time.mul(3.0)), 0)).mul(0.3).add(0.85));
    const fade = pow(float(1).sub(along), 1.6).mul(smoothstep(0.0, 0.02, along));
    bm.colorNode = vec4(vec3(0.65, 0.85, 1.0).mul(PU.k).mul(PU.flash.mul(2.0).add(1.2)).mul(streaks), coreK.mul(fade).mul(PU.k));
    for (const sgn of [1, -1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 9, 32, 1, true).translate(0, -4.5, 0), bm);
      if (sgn > 0) beam.rotation.x = Math.PI;
      magAxis.add(beam);
    }
    // lignes de champ dipolaires r = L sin²θ ; de la lumière circule le long des lignes
    const pts = [], sPar = [];
    for (const Lk of [0.35, 0.6, 0.95, 1.4]) {
      for (let a = 0; a < 6; a++) {
        const az = (a / 6) * Math.PI * 2 + Lk, n = 64;
        for (let i = 0; i < n; i++) {
          for (const th of [0.12 + (Math.PI - 0.24) * i / n, 0.12 + (Math.PI - 0.24) * (i + 1) / n]) {
            const r = Lk * Math.sin(th) ** 2;
            pts.push(r * Math.sin(th) * Math.cos(az), r * Math.cos(th), r * Math.sin(th) * Math.sin(az));
            sPar.push(th / Math.PI, Lk);
          }
        }
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(sPar, 2));
    const fm = new THREE.LineBasicNodeMaterial(additive());
    const flow = sin(uv().x.mul(40.0).sub(time.mul(5.0)).add(uv().y.mul(9.0))).mul(0.5).add(0.5).pow(3.0);
    fm.colorNode = vec4(vec3(0.4, 0.75, 1.0).mul(PU.k).mul(flow.mul(1.6).add(0.25)), PU.k.mul(float(0.9).div(uv().y.add(0.4))));
    magAxis.add(new THREE.LineSegments(fg, fm));
    // nébuleuse de vent : tore équatorial, ondes qui s'éloignent
    const tm = new THREE.MeshBasicNodeMaterial(additive({ side: THREE.DoubleSide }));
    const ringR = positionLocal.xz.length();
    const waves = sin(ringR.mul(9.0).sub(time.mul(2.2))).mul(0.5).add(0.5).pow(2.0);
    const wisp = mx_fractal_noise_float(positionLocal.mul(3.0).add(vec3(0, time.mul(0.2), 0)), 3, 2.0, 0.5).mul(0.5).add(0.6);
    const tRim = float(1).sub(abs(dot(normalWorld, toCamera()))).pow(1.5);
    tm.colorNode = vec4(vec3(0.45, 0.6, 1.0).mul(PU.k).mul(1.2), waves.mul(wisp).mul(tRim.mul(0.7).add(0.15)).mul(PU.k).mul(0.6));
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.42, 24, 96), tm);
    torus.rotation.x = Math.PI / 2;
    pulsar.add(torus);
    // halo de l'étoile à neutrons, qui flashe à chaque passage d'un faisceau
    const hm = new THREE.SpriteNodeMaterial(additive());
    const hd = spriteRadius();
    hm.colorNode = vec4(vec3(0.7, 0.85, 1.0).mul(PU.k).mul(PU.flash.mul(6.0).add(1.0)), exp(hd.mul(hd).mul(-30.0)).add(exp(hd.mul(-9.0)).mul(0.5)).mul(smoothstep(1.0, 0.85, hd)));
    const nsHalo = new THREE.Sprite(hm);
    nsHalo.scale.setScalar(1.6);
    pulsar.add(nsHalo);
  }

  // ── Rémanent de supernova : bulle vivante, filamenteuse
  //  · forme : chaque direction s'étend à sa propre vitesse (bosses qui gonflent) ;
  //  · filaments : bruit « en crête » dont le domaine est déformé par un second
  //    bruit qui dérive (turbulence) — ils se tordent et glissent ;
  //  · raies d'émission : hydrogène (Hα), oxygène ([O III]), soufre.
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshBasicNodeMaterial(additive({ side: THREE.DoubleSide })));
  {
    const tt = time.mul(0.12);
    const nrm0 = normalize(normalLocal);
    const ca = cos(time.mul(0.03)), sa = sin(time.mul(0.03));
    const nrm = vec3(nrm0.x.mul(ca).sub(nrm0.z.mul(sa)), nrm0.y, nrm0.x.mul(sa).add(nrm0.z.mul(ca)));
    const bulge = mx_fractal_noise_float(nrm.mul(1.6).add(vec3(0, tt.mul(0.5), 0)), 3, 2.0, 0.5);
    shell.material.positionNode = positionLocal.mul(bulge.mul(0.22).add(1.0));
    // (basses fréquences calculées par sommet : même rendu, bien moins de calcul par pixel)
    const warp = varying(vec3(
      mx_noise_float(nrm.mul(2.0).add(vec3(tt, 0, 0))),
      mx_noise_float(nrm.mul(2.0).add(vec3(0, tt, 5.2))),
      mx_noise_float(nrm.mul(2.0).add(vec3(1.7, 0, tt))),
    ).mul(0.35));
    const q = nrm.add(warp);
    const r1 = float(1).sub(abs(mx_fractal_noise_float(q.mul(4.0).add(vec3(tt.mul(0.6))), 3, 2.0, 0.5))).pow(10.0);
    const r2 = float(1).sub(abs(mx_noise_float(q.mul(11.0).sub(vec3(tt.mul(1.3), 0, 3.1))))).pow(14.0);
    const flick = varying(mx_noise_float(q.mul(3.0).add(vec3(0, 0, time.mul(0.4)))));
    const filaments = r1.add(r2.mul(0.6)).mul(flick.mul(0.35).add(0.85));
    // brillance au limbe ; presque invisible de face (depuis l'intérieur, pas de voile)
    const rimS = float(1).sub(abs(dot(normalize(normalWorld), toCamera()))).pow(1.6);
    const zone = mx_noise_float(q.mul(2.5).add(vec3(tt.mul(0.3))));
    const hotC = varying(mix(mix(vec3(1.0, 0.2, 0.25), vec3(0.35, 0.55, 1.0), smoothstep(-0.25, 0.35, zone)), vec3(1.0, 0.6, 0.25), smoothstep(0.4, 0.7, abs(mx_noise_float(q.mul(6.0))))));
    // front de choc lumineux qui balaie la bulle (pulsations)
    const front = smoothstep(0.75, 1.0, sin(varying(bulge).mul(6.0).sub(time.mul(1.5))).mul(0.5).add(0.5)).mul(0.6);
    shell.material.colorNode = vec4(hotC.mul(V.shell).mul(1.4).add(vec3(0.9, 0.95, 1.0).mul(front).mul(V.shell)),
      filaments.add(front.mul(0.15)).mul(rimS.mul(0.9).add(0.05)).mul(V.shell));
    shell.visible = false;
    scene.add(shell);
  }

  // ── Étoile vagabonde : petite étoile bleue et son halo
  const flyStar = new THREE.Group();
  {
    const hot = vec3(3.0, 4.0, 7.0);
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.06, 48, 24), new THREE.MeshBasicNodeMaterial());
    c.material.colorNode = hot.mul(sin(time.mul(3.0)).mul(0.04).add(1.0));
    const h = new THREE.Sprite(new THREE.SpriteNodeMaterial(additive()));
    h.material.colorNode = vec4(hot.mul(0.25), haloShape());
    h.scale.setScalar(2.2);
    flyStar.add(c, h);
    flyStar.visible = false;
    scene.add(flyStar);
  }

  let pulsarK = 0, pulsarSpin = 0, pulsarPrevFlash = 0;
  const _bd = new THREE.Vector3(), _toCam = new THREE.Vector3();

  return {
    star, pulsar, shell, flyStar,

    // paramètres fournis par le cycle de vie (lifecycle.js)
    set(p) {
      const R = p.starVisR;
      core.scale.setScalar(R);
      // éclat de surface ∝ (L / R²)^¼ (température effective) ; halo ∝ luminosité
      V.starI.value = p.starI;
      halo.scale.setScalar(1.3 * Math.min(3, Math.max(0.35, Math.pow(p.L, 0.3))) + 2 * R);
      V.starCol.value.setRGB(p.color[0], p.color[1], p.color[2]);
      V.lightK.value = Math.min(2.5, Math.max(0.12, Math.pow(p.L, 0.35)));
      V.ambient.value = p.ambient;
      V.jets.value = p.jets;
      V.sizeK.value = p.sizeK;
      V.shell.value = p.shell;
      pulsarK = p.pulsar || 0;
      shell.visible = p.shell > 0.002;
      if (shell.visible) shell.scale.setScalar(Math.max(0.1, p.shellR));
    },

    // fait tourner le pulsar ; true au moment où un faisceau passe face à la caméra (pour le son)
    updatePulsar(dtReal) {
      pulsar.visible = pulsarK > 0.002;
      PU.k.value = pulsarK;
      if (!pulsar.visible) return false;
      pulsarSpin += dtReal * 2 * Math.PI * 0.75; // 0,75 tour par seconde (ralenti)
      pulsar.rotation.y = pulsarSpin;
      pulsar.updateMatrixWorld();
      _bd.set(0, 1, 0).transformDirection(magAxis.matrixWorld);
      _toCam.copy(camera.position).normalize();
      const flash = Math.pow(Math.max(0, (Math.abs(_bd.dot(_toCam)) - 0.75) / 0.25), 4);
      PU.flash.value = flash;
      const tick = flash > 0.35 && pulsarPrevFlash <= 0.35;
      pulsarPrevFlash = flash;
      return tick;
    },
  };
}
