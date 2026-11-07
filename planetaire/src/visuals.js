// Rendu : poussière (sprites instanciés lus directement dans les buffers de
// simulation), étoile, embryons éclairés, orbites, tête de lecture, post-process.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, uniform, float, vec3, vec4, length, exp, max, mix, uv,
  smoothstep, varying, hash, positionLocal, normalLocal, normalize, dot, select, min,
  pass, screenUV, pow, clamp, instancedArray, cbrt, sin, cos, time, cameraPosition, abs, uint,
  mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2, positionWorld, normalWorld, vec2, fract, screenCoordinate,
  cameraViewMatrix, atan,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { mrt, output, velocity } from 'three/tsl';
import { cellOf, diskH, M, R_IN, R_OUT, M_EARTH } from './sim.js';
import { provenanceTSL, ROCK, ICE } from './palette.js';

const DUST_K = Math.min(1, 1.2 / Math.min(devicePixelRatio, 2));

export function createVisuals(renderer, scene, camera, sim, opts = {}) {
  const HDR = !!opts.hdr;
  const { pPos, pVel, pHeat, ePos, eTot, eGas, tau } = sim.buffers;
  // Pulsation de chaque planète quand elle passe sous la tête (écrite par le CPU)
  const pulseBuf = instancedArray(M, 'float');
  const pulseArr = pulseBuf.value.array;
  // État d'évolution de chaque planète (sous-simulation de main.js) :
  //   [2i]   = chaleur interne, océans, banquise, cratères
  //   [2i+1] = atmosphère, atmosphère chaude, âge (0..1), T_eq / 1000 K
  const evoBuf = instancedArray(M * 2, 'vec4');
  const evoArr = evoBuf.value.array;
  let evoDirty = false;
  function setEvo(i, a, b) { evoArr.set(a, i * 8); evoArr.set(b, i * 8 + 4); evoDirty = true; }

  const V = {
    colorMode: uniform(0, 'int'),
    // Sur écran haute densité, des grains plus petits en unités-monde gardent
    // la même taille apparente en points… pour 2,8× moins de pixels à
    // remplir (le coût du rendu est dominé par ce remplissage additif).
    // L'éclat est compensé pour garder la même lumière totale.
    alpha: uniform(0.19 / DUST_K ** 2),
    dustK: uniform(1.0),   // éclat global de la poussière (baisse quand le disque s'épuise)
    size: uniform(0.0085 * DUST_K * Math.min(3, Math.sqrt((1 << 20) / sim.N))),
    light: uniform(1.5),
    ambient: uniform(0.04),
    // étoile (pilotée par le cycle de vie)
    starCol: uniform(new THREE.Color(1.0, 0.82, 0.62)), // couleur de la lumière
    starI: uniform(6.0),          // éclat du disque stellaire
    lightK: uniform(1.0),         // éclairement relatif (luminosité, adoucie)
    jets: uniform(0.0),
    sizeK: uniform(1.0),          // grossissement des grains (nuage en effondrement)
    shell: uniform(0.0),          // rémanent de supernova : intensité
    selected: uniform(-1, 'int'),
    snow: sim.U.snow,
    exposure: uniform(1.45),
    // pic de l'écran HDR, en multiples du blanc de l'interface (?peak=)
    peak: uniform(Number(new URLSearchParams(location.search).get('peak')) || 4.0),
    planetK: uniform(1.0),   // grossissement des planètes (DA mécanique : billes sur leurs tiges)
    // objectif : distance de mise au point, profondeur de champ, flou de mouvement
    focus: uniform(30.0),
    focusRange: uniform(9.0),
    bokeh: uniform(1.0),
    blurK: uniform(0.5),
    collect: uniform(0.0),   // fin de cycle : les débris sont aspirés par la trémie (0 → 1)
    // objectif appliqué aux grains eux-mêmes (ils n'écrivent ni profondeur ni vitesse) :
    aperture: uniform(0.0),  // cercle de confusion (unités monde) loin du plan net
    shutter: uniform(0.0),   // temps d'obturation (unités de simulation) : traînées de mouvement
    camVel: uniform(new THREE.Vector3()), // vitesse de la caméra (unités / unité de temps simulé)
    planetFlux: uniform(4.0), // éclairement maximal des planètes (abaissé en DA mécanique)
  };

  // ── Poussière ──────────────────────────────────────────────────────────────
  {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const P = pPos.element(instanceIndex);
    const Vv = pVel.element(instanceIndex);
    // ── Trémie (DA mécanique) ──
    // Versement : un grain en attente (chaleur < 0) vole de la buse à sa place
    // le long d'une courbe qui descend l'axe puis s'évase, en tournant avec le nuage.
    // Aspiration (fin de cycle) : le même chemin à l'envers, vers la buse.
    const Hraw = pHeat.element(instanceIndex);
    const U = sim.U, hop = U.hopper;
    const jit = vec3(hash(instanceIndex.add(uint(31))).sub(0.5), 0, hash(instanceIndex.add(uint(57))).sub(0.5));
    const along = (from, to, s) => { // de la buse (s=0) au grain (s=1)
      const mid = vec3(0, to.y.mul(0.7).add(from.y.mul(0.3)), 0).add(jit.mul(0.35));
      const u = float(1).sub(s);
      const b = from.mul(u.mul(u)).add(mid.mul(u.mul(s).mul(2.0))).add(to.mul(s.mul(s)));
      const sw = u.mul(1.8), cs = cos(sw), sn = sin(sw); // tourbillon
      return vec3(b.x.mul(cs).sub(b.z.mul(sn)), b.y, b.x.mul(sn).add(b.z.mul(cs)));
    };
    const waiting = Hraw.lessThan(0.0);
    const sPour = clamp(U.pourT.add(Hraw).div(U.pourFly), 0.0, 1.0);          // (Hraw = −heure de départ)
    const dly = hash(instanceIndex.add(uint(911))).mul(0.6);
    const sCol = clamp(V.collect.sub(dly).div(0.4), 0.0, 1.0);               // 0 = en place, 1 = aspiré
    const pourPos = along(hop, P.xyz, smoothstep(0.0, 1.0, sPour));
    const colPos = along(hop, P.xyz, float(1).sub(sCol.mul(sCol)));
    const posW = select(waiting, pourPos, select(sCol.greaterThan(0.0), colPos, P.xyz));
    mat.positionNode = posW;
    const inFlight = select(waiting, float(1).sub(sPour), sCol);              // pour l'éclat
    const hidden = select(waiting, sPour.lessThanEqual(0.0), sCol.greaterThanEqual(1.0));

    const R = length(P.xz);
    const t = tau.element(cellOf(P.xyz));
    // Les grains au-dessus du plan médian échappent à l'ombre du disque.
    const lift = exp(P.y.div(diskH(R).mul(0.55)).pow(2).negate());
    const shade = exp(t.mul(lift).negate());
    const irr = shade.div(R.mul(0.55).add(0.35));

    const prov = provenanceTSL(P.w);
    const comp = mix(vec3(...ROCK), vec3(...ICE), Vv.w);
    const temp = mix(vec3(1.0, 0.25, 0.08), vec3(1.0, 0.92, 0.75), smoothstep(5.0, 0.4, R));
    const base = select(V.colorMode.equal(0), prov, select(V.colorMode.equal(1), comp, temp));
    // lueur thermique du disque interne, même à l'ombre
    const thermal = vec3(1.0, 0.35, 0.1).mul(smoothstep(1.4, 0.35, R)).mul(0.25);
    // Éjecta d'impact : chauffés à blanc puis refroidissant vers l'orange
    const heat = max(Hraw, 0.0);
    const hot = vec3(1.0, 0.42, 0.12).mul(heat.mul(heat).mul(6.0)).add(vec3(1.0, 0.9, 0.7).mul(heat.pow(6.0).mul(10.0)));
    // (moins lumineux tout près de la caméra : pas de voile devant la planète suivie)
    const camD = length(P.xyz.sub(cameraPosition));
    const nearK = smoothstep(0.05, 1.2, camD).mul(0.85).add(0.15);
    const lightC = V.starCol.mul(V.lightK.min(1.2)); // (plafonné : sinon la poussière sature devant une géante)
    const col = varying(base.mul(irr.mul(V.light).mul(lightC).add(V.ambient)).add(thermal.mul(V.lightK.min(1.0))).mul(V.alpha.mul(V.dustK)).mul(nearK).add(hot.mul(0.5))); // (grains du nuage plus gros ET pas atténués : la nébuleuse se voit)

    // Taille plafonnée en pixels : vus de près, les grains restent des points
    // fins au lieu de devenir des taches (utile quand on suit une planète).
    const sz = V.size.mul(hash(instanceIndex).mul(0.8).add(0.6)).mul(heat.mul(1.6).add(1.0)).mul(clamp(camD.div(4.0), 0.06, 1.0))
      .mul(V.sizeK).mul(select(P.w.greaterThanEqual(0.0), select(hidden, 0.0, 1.0), 0.0)); // grain retiré (ou dans la trémie) : plus dessiné
    // ── Objectif sur les grains ──
    //  · profondeur de champ : hors du plan net, le grain s'étale en disque
    //    (cercle de confusion ∝ |d − f| / f), plus doux et moins lumineux ;
    //  · flou de mouvement : il s'étire le long de son déplacement à l'écran
    //    pendant le temps d'obturation (les grains internes, rapides, filent).
    //  L'énergie (surface × éclat) est conservée.
    const vp = cameraViewMatrix.mul(vec4(posW, 1.0)).xyz;
    const depth = vp.z.negate().max(0.01);
    const coc = abs(depth.sub(V.focus)).div(V.focus.max(0.5)).mul(V.aperture).min(depth.mul(0.012));
    const moving = select(waiting.or(sCol.greaterThan(0.0)), 0.0, 1.0);
    // (vitesse RELATIVE à la caméra : quand elle suit une planète, les grains
    //  qui l'accompagnent sont immobiles à l'écran et ne doivent pas filer)
    const vd = cameraViewMatrix.mul(vec4(Vv.xyz.sub(V.camVel).mul(V.shutter).mul(moving), 0.0)).xyz;
    const streak = length(vd.xy).min(depth.mul(0.025));
    const sx = sz.add(coc).add(streak), sy = sz.add(coc);
    mat.scaleNode = vec2(sx, sy);
    mat.rotationNode = atan(vd.y, vd.x.add(1e-9));
    const energy = varying(sz.mul(sz).div(sx.mul(sy).max(1e-12)));
    const soft = varying(coc.div(sz.add(coc).max(1e-9)));
    // Grain net : cœur plein, bord court ; flou : disque doux
    const d = length(uv().sub(0.5));
    const shape = smoothstep(0.5, mix(0.28, 0.0, soft), d);
    // (dans le filet, des centaines de milliers de grains se superposent : on les atténue)
    mat.colorNode = vec4(col.mul(float(1).sub(inFlight.mul(0.8))).mul(energy), shape);

    const dust = new THREE.Sprite(mat);
    dust.count = sim.N;
    dust.frustumCulled = false;
    scene.add(dust);
  }

  // ── Fond d'étoiles ─────────────────────────────────────────────────────────
  {
    const NS = 6000;
    const sb = instancedArray(NS, 'vec4');
    const a = sb.value.array;
    for (let i = 0; i < NS; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      a.set([s * Math.cos(th) * 300, u * 300, s * Math.sin(th) * 300, Math.random() ** 6], i * 4);
    }
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const S = sb.element(instanceIndex);
    mat.positionNode = S.xyz;
    // Le disque est opaque à la lumière des étoiles du fond : on calcule où le
    // rayon caméra → étoile traverse le plan du disque et on l'éteint selon la
    // densité de surface de la poussière à cet endroit (et l'obliquité).
    const dir = normalize(S.xyz.sub(cameraPosition));
    const tCross = cameraPosition.y.negate().div(dir.y);
    const hit = cameraPosition.add(dir.mul(tCross));
    const Rh = length(hit.xz);
    const sigma = smoothstep(R_OUT * 1.15, R_OUT * 0.75, Rh).mul(smoothstep(R_IN * 0.6, R_IN * 1.2, Rh)).div(pow(Rh.max(0.3), 0.8));
    const depth = select(tCross.greaterThan(0.0), sigma.mul(V.dustK).mul(5.0).div(abs(dir.y).add(0.03)), float(0.0));
    const extinct = varying(exp(depth.negate()));
    const shape = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
    // plus discrètes : la plupart à peine visibles, quelques-unes brillantes
    mat.colorNode = vec4(mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.85, 0.7), hash(instanceIndex)).mul(S.w.mul(1.2).add(0.05)).mul(extinct), shape);
    mat.scaleNode = float(0.5).add(S.w.mul(1.2));
    const stars = new THREE.Sprite(mat);
    stars.count = NS;
    stars.frustumCulled = false;
    scene.add(stars);
  }

  // ── Étoile centrale + halo ─────────────────────────────────────────────────
  const makeStar = (radius, hot, halo) => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.MeshBasicNodeMaterial());
    core.material.colorNode = vec3(...hot).mul(sin(time.mul(3.0)).mul(0.04).add(1.0));
    g.add(core);
    const hm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const d = length(uv().sub(0.5)).mul(2.0);
    hm.colorNode = vec4(vec3(...hot).mul(0.25), exp(d.mul(6.0).negate()).sub(Math.exp(-6.0)).max(0));
    const h = new THREE.Sprite(hm);
    h.scale.setScalar(halo);
    g.add(h);
    return g;
  };
  // Étoile centrale pilotable : couleur, éclat, rayon (protoétoile rouge,
  // étoile jaune-blanc, supergéante rouge, étoile à neutrons…)
  const star = new THREE.Group();
  {
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicNodeMaterial());
    // granulation : la surface bouillonne (surtout visible sur la géante)
    const gran = mx_fractal_noise_float(normalLocal.mul(6.0).add(vec3(time.mul(0.05), 0, 0)), 3, 2.0, 0.5);
    const limb = max(dot(normalize(normalLocal), normalize(cameraPosition.sub(positionWorld))), 0.0).pow(0.4);
    core.material.colorNode = V.starCol.mul(V.starI).mul(sin(time.mul(3.0)).mul(0.03).add(1.0)).mul(gran.mul(0.25).add(1.0)).mul(limb.mul(0.6).add(0.4));
    core.scale.setScalar(0.15);
    star.add(core);
    star.userData.core = core;
    const hm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const d = length(uv().sub(0.5)).mul(2.0);
    hm.colorNode = vec4(V.starCol.mul(V.starI).mul(0.25), exp(d.mul(6.0).negate()).sub(Math.exp(-6.0)).max(0));
    const h = new THREE.Sprite(hm);
    h.scale.setScalar(1.3);
    star.add(h);
    star.userData.halo = h;
    // jets bipolaires de la protoétoile (le long de l'axe de rotation)
    const jm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ju = uv();
    const along = float(1).sub(ju.y);           // 0 à la base (contre l'étoile), 1 au bout
    const knots = sin(along.mul(40.0).sub(time.mul(6.0))).mul(0.3).add(0.7); // nœuds de choc qui s'éloignent
    const across = abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))).pow(2.0); // plus dense au centre du jet
    jm.colorNode = vec4(vec3(0.55, 0.75, 1.0).mul(V.jets).mul(1.3).mul(knots), across.mul(float(1).sub(along)).mul(smoothstep(0.0, 0.05, along)));
    // (dans un pivot : après la supernova, les mêmes faisceaux deviennent ceux
    //  du pulsar, inclinés et en rotation rapide)
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    for (const sgn of [1, -1]) {
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 5.5, 24, 1, true), jm);
      jet.geometry.translate(0, -2.75, 0); // base à l'origine, s'étend vers −y…
      jet.rotation.x = sgn > 0 ? Math.PI : 0; // …et vers +y pour l'autre
      pivot.add(jet);
    }
    star.add(pivot);
    star.userData.pivot = pivot;
  }
  scene.add(star);

  // ── Pulsar (étoile à neutrons en rotation) ────────────────────────────────
  // Axe magnétique incliné sur l'axe de rotation : les deux faisceaux balaient
  // le ciel comme un phare. Lignes de champ dipolaires qui tournent avec
  // l'étoile, nébuleuse de vent en tore dans le plan équatorial (comme au cœur
  // de la nébuleuse du Crabe). Rotation ralentie : un vrai pulsar jeune tourne
  // ~30 fois par seconde.
  const PU = { k: uniform(0), flash: uniform(0) };
  const pulsar = new THREE.Group();       // tourne autour de l'axe de rotation (y)
  const magAxis = new THREE.Group();      // incliné : porte l'axe magnétique
  magAxis.rotation.z = 1.0; // ~57° : les faisceaux passent près de la ligne de visée
  pulsar.scale.setScalar(2.4);
  pulsar.add(magAxis);
  pulsar.visible = false;
  scene.add(pulsar);
  {
    const add = () => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // faisceaux : cônes fins, plus intenses au centre et près de l'étoile,
    // parcourus de stries qui filent vers l'extérieur
    const bm = new THREE.MeshBasicNodeMaterial({ ...add(), side: THREE.DoubleSide });
    const along = float(1).sub(uv().y);                     // 0 à l'étoile, 1 au bout
    const core = abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld)))).pow(3.0);
    const streaks = sin(along.mul(60.0).sub(time.mul(14.0))).mul(0.25).add(0.75)
      .mul(mx_noise_float(vec3(uv().x.mul(12.0), along.mul(8.0).sub(time.mul(3.0)), 0)).mul(0.3).add(0.85));
    const fade = pow(float(1).sub(along), 1.6).mul(smoothstep(0.0, 0.02, along));
    bm.colorNode = vec4(vec3(0.65, 0.85, 1.0).mul(PU.k).mul(PU.flash.mul(2.0).add(1.2)).mul(streaks), core.mul(fade).mul(PU.k));
    for (const sgn of [1, -1]) {
      const g = new THREE.ConeGeometry(0.75, 9, 32, 1, true);
      g.translate(0, -4.5, 0);              // apex à l'origine, s'ouvre vers −y…
      const beam = new THREE.Mesh(g, bm);
      if (sgn > 0) beam.rotation.x = Math.PI; // …et vers +y
      magAxis.add(beam);
    }
    // lignes de champ dipolaires r = Lsin²θ, dans des plans contenant l'axe
    // magnétique ; de la lumière circule le long des lignes
    const pts = [], sPar = [];
    for (const Lk of [0.35, 0.6, 0.95, 1.4]) {
      for (let a = 0; a < 6; a++) {
        const az = (a / 6) * Math.PI * 2 + Lk;
        const n = 64;
        for (let i = 0; i < n; i++) {
          const t0 = 0.12 + (Math.PI - 0.24) * i / n, t1 = 0.12 + (Math.PI - 0.24) * (i + 1) / n;
          for (const th of [t0, t1]) {
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
    const fm = new THREE.LineBasicNodeMaterial(add());
    const flow = sin(uv().x.mul(40.0).sub(time.mul(5.0)).add(uv().y.mul(9.0))).mul(0.5).add(0.5).pow(3.0);
    fm.colorNode = vec4(vec3(0.4, 0.75, 1.0).mul(PU.k).mul(flow.mul(1.6).add(0.25)), PU.k.mul(float(0.9).div(uv().y.add(0.4))));
    magAxis.add(new THREE.LineSegments(fg, fm));
    // nébuleuse de vent : tore équatorial, ondes qui s'éloignent
    const tm = new THREE.MeshBasicNodeMaterial({ ...add(), side: THREE.DoubleSide });
    const ringR = length(positionLocal.xz);
    const waves = sin(ringR.mul(9.0).sub(time.mul(2.2))).mul(0.5).add(0.5).pow(2.0);
    const wisp = mx_fractal_noise_float(positionLocal.mul(3.0).add(vec3(0, time.mul(0.2), 0)), 3, 2.0, 0.5).mul(0.5).add(0.6);
    const tRim = float(1).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))).pow(1.5);
    tm.colorNode = vec4(vec3(0.45, 0.6, 1.0).mul(PU.k).mul(1.2), waves.mul(wisp).mul(tRim.mul(0.7).add(0.15)).mul(PU.k).mul(0.6));
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.42, 24, 96), tm);
    torus.rotation.x = Math.PI / 2;
    pulsar.add(torus);
    // halo de l'étoile à neutrons, qui flashe à chaque passage d'un faisceau
    const hm = new THREE.SpriteNodeMaterial(add());
    const hd = length(uv().sub(0.5)).mul(2.0);
    hm.colorNode = vec4(vec3(0.7, 0.85, 1.0).mul(PU.k).mul(PU.flash.mul(6.0).add(1.0)), exp(hd.mul(hd).mul(-30.0)).add(exp(hd.mul(-9.0)).mul(0.5)).mul(smoothstep(1.0, 0.85, hd)));
    const halo = new THREE.Sprite(hm);
    halo.scale.setScalar(1.6);
    pulsar.add(halo);
  }
  let pulsarSpin = 0, pulsarPrevFlash = 0;
  const _bd = new THREE.Vector3(), _toCam = new THREE.Vector3();
  // Renvoie true au moment où un faisceau passe face à la caméra (pour le son)
  function updatePulsar(dtReal, k) {
    pulsar.visible = k > 0.002;
    PU.k.value = k;
    if (!pulsar.visible) return false;
    pulsarSpin += dtReal * 2 * Math.PI * 0.75; // 0,75 tour par seconde (ralenti)
    pulsar.rotation.y = pulsarSpin;
    pulsar.updateMatrixWorld();
    _bd.set(0, 1, 0).transformDirection(magAxis.matrixWorld);
    _toCam.copy(camera.position).normalize();
    const c = Math.abs(_bd.dot(_toCam));                 // un des deux faisceaux vers nous
    const flash = Math.pow(Math.max(0, (c - 0.75) / 0.25), 4);
    PU.flash.value = flash;
    const tick = flash > 0.35 && pulsarPrevFlash <= 0.35;
    pulsarPrevFlash = flash;
    return tick;
  }

  // Rémanent de supernova : coquille en expansion, filamenteuse
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  {
    // Bulle vivante :
    //  · forme : chaque direction s'étend à sa propre vitesse (bosses qui
    //    gonflent et ondulent au cours du temps) ;
    //  · filaments : bruit « en crête » dont le domaine est déformé par un
    //    second bruit qui dérive (turbulence) — ils se tordent et glissent ;
    //  · lente rotation d'ensemble et scintillement.
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
    const flick = varying(mx_noise_float(nrm.add(warp).mul(3.0).add(vec3(0, 0, time.mul(0.4)))));
    const filaments = r1.add(r2.mul(0.6)).mul(flick.mul(0.35).add(0.85));
    // brillance au limbe (on voit la coquille par la tranche sur les bords),
    // presque invisible de face : depuis l'intérieur, pas de voile
    const rimS = float(1).sub(abs(dot(normalize(normalWorld), normalize(cameraPosition.sub(positionWorld))))).pow(1.6);
    // raies d'émission : hydrogène (rouge Hα), oxygène (bleu-vert [O III]), soufre (orangé)
    const zone = mx_noise_float(nrm.add(warp).mul(2.5).add(vec3(tt.mul(0.3))));
    const hotC = varying(mix(mix(vec3(1.0, 0.2, 0.25), vec3(0.35, 0.55, 1.0), smoothstep(-0.25, 0.35, zone)), vec3(1.0, 0.6, 0.25), smoothstep(0.4, 0.7, abs(mx_noise_float(nrm.add(warp).mul(6.0))))));
    const bulgeV = varying(bulge);
    // front de choc lumineux qui balaie la bulle (pulsations)
    const front = smoothstep(0.75, 1.0, sin(bulgeV.mul(6.0).sub(time.mul(1.5))).mul(0.5).add(0.5)).mul(0.6);
    shell.material.colorNode = vec4(hotC.mul(V.shell).mul(1.4).add(vec3(0.9, 0.95, 1.0).mul(front).mul(V.shell)), filaments.add(front.mul(0.15)).mul(rimS.mul(0.9).add(0.05)).mul(V.shell));
    shell.visible = false;
    scene.add(shell);
  }
  const flyStar = makeStar(0.06, [3.0, 4.0, 7.0], 2.2);
  flyStar.visible = false;
  scene.add(flyStar);

  // ── Embryons / planètes ────────────────────────────────────────────────────
  {
    const mat = new THREE.MeshBasicNodeMaterial();
    const E = ePos.element(instanceIndex);
    const T = eTot.element(instanceIndex);
    const G = eGas.element(instanceIndex);
    const m = max(E.w, 1e-30);
    // Relation masse–rayon (Chen & Kipping 2017) : rocheuses ∝ M^0.28,
    // neptuniennes ∝ M^0.59, géantes gazeuses ≈ 11 R⊕ quelle que soit la masse.
    // Rayon affiché ∝ R^0.75 : exagéré pour rester visible, mais une Jupiter
    // reste bien plus petite que l'étoile.
    const mE = m.div(M_EARTH);
    const Rp = select(mE.lessThan(2.0), pow(mE, 0.28), pow(mE.div(2.0), 0.59).mul(1.21).min(11.5));
    const visR = select(E.w.greaterThan(0), pow(Rp, 0.75).mul(0.013).max(0.005), 0.0).mul(V.planetK)
      .mul(pulseBuf.element(instanceIndex).mul(0.06).add(1.0)); // la planète « bat » (à peine) quand elle sonne
    mat.positionNode = positionLocal.mul(visR).add(E.xyz);

    const solid = max(m.sub(G.y), 1e-30);
    const gasF = clamp(G.y.div(m), 0, 1);
    const ice = clamp(T.x.div(solid), 0, 1);
    const meanR = T.y.div(solid);
    // Couleur de surface = composition (la provenance, elle, se lit dans la coupe) :
    // roche riche en fer (rouille) si la matière vient du disque interne chaud,
    // basalte gris-brun sinon ; la glace éclaircit et bleuit.
    const rockBase = mix(vec3(0.62, 0.3, 0.17), vec3(0.47, 0.42, 0.37), smoothstep(0.5, 2.0, meanR));
    const rocky = varying(mix(rockBase, vec3(0.72, 0.8, 0.88), smoothstep(0.1, 0.7, ice)));
    const gasV = varying(gasF);
    const iceV = varying(ice);
    const aV = varying(length(E.xz));
    const seed = varying(hash(instanceIndex.add(uint(77))).mul(100.0));
    const toStar = varying(normalize(E.xyz.negate()));
    const glow = varying(clamp(T.z.mul(0.004), 0, 0.15)); // (la chaleur est surtout rendue par la lave)
    const sel = varying(select(instanceIndex.toInt().equal(V.selected), 1.0, 0.0));
    const pulse = varying(pulseBuf.element(instanceIndex));

    const EA = varying(evoBuf.element(instanceIndex.mul(2)));        // chaleur, océans, banquise, cratères
    const EB = varying(evoBuf.element(instanceIndex.mul(2).add(1))); // atmo, chaude, âge, T_eq
    const heat = EA.x, ocean = EA.y, iceSurf = EA.z, craters = EA.w;
    const atmo = EB.x, hotAtm = EB.y, age = EB.z;

    // ── Surface procédurale (coordonnées de la sphère, qui tourne sur elle-même)
    const n = normalize(normalLocal);
    const spin = time.mul(0.15).add(seed);
    const cs = cos(spin), sn = sin(spin);
    const q = vec3(n.x.mul(cs).sub(n.z.mul(sn)), n.y, n.x.mul(sn).add(n.z.mul(cs)));
    const qs = q.add(vec3(seed, seed.mul(0.37), seed.mul(0.61)));

    // relief : continents et bassins
    const h = mx_fractal_noise_float(qs.mul(2.2), 5, 2.0, 0.5);
    const fine = mx_noise_float(qs.mul(14.0));
    // cratères (deux tailles) : fond sombre, rempart clair ; l'âge les accumule
    const w1 = mx_worley_noise_vec2(qs.mul(5.0)).x;
    const w2 = mx_worley_noise_vec2(qs.mul(13.0)).x;
    const pit = smoothstep(0.32, 0.12, w1).add(smoothstep(0.3, 0.1, w2).mul(0.6));
    const rimC = smoothstep(0.22, 0.34, w1).mul(smoothstep(0.45, 0.34, w1));
    const crater = craters.mul(smoothstep(0.0, 0.25, craters));
    // mers / océans : le niveau monte avec la quantité d'eau liquide
    const seaLevel = mix(float(-0.8), float(0.28), ocean.max(iceSurf));
    const land = smoothstep(seaLevel.sub(0.03), seaLevel.add(0.05), h);
    let rockCol = mix(rocky.mul(0.32), rocky.mul(0.85), smoothstep(-0.3, 0.5, h)).mul(fine.mul(0.15).add(1.0));
    rockCol = rockCol.mul(float(1).sub(pit.mul(crater).mul(0.45))).add(rimC.mul(crater).mul(0.08));
    const seaCol = mix(vec3(0.02, 0.07, 0.2), vec3(0.04, 0.16, 0.3), smoothstep(seaLevel.sub(0.4), seaLevel, h));
    const iceCol = vec3(0.78, 0.84, 0.9).mul(fine.mul(0.08).add(0.95));
    const lowCol = select(iceSurf.greaterThan(ocean), iceCol, seaCol);
    let solidCol = mix(lowCol, rockCol, land);
    // calottes polaires si de l'eau gèle aux pôles (monde tempéré ou froid)
    const capEdge = float(1.05).sub(ocean.max(iceSurf).mul(0.3)).sub(iceSurf.mul(0.25)).add(h.mul(0.12));
    solidCol = mix(solidCol, iceCol, smoothstep(capEdge, capEdge.add(0.06), abs(q.y)));
    // planète glacée (riche en glace, loin) : croûte de glace fracturée
    // (type Europe / Ganymède : terrains anciens sombres et sales, glace jeune
    //  claire, linéaments brun-rouge ; les vieux terrains se cratérisent)
    const icyWorld = smoothstep(0.35, 0.8, iceV).mul(float(1).sub(gasV));
    const wi = mx_worley_noise_vec2(qs.mul(3.5));
    const lineae = smoothstep(0.05, 0.0, wi.y.sub(wi.x));
    const young = smoothstep(-0.1, 0.25, h.add(fine.mul(0.15)).add(smoothstep(0.3, 0.7, heat).mul(0.6)));
    const dirty = vec3(0.42, 0.38, 0.34), clean = vec3(0.78, 0.82, 0.86);
    const iceTerr = mix(dirty.mul(float(1).sub(pit.mul(crater).mul(0.5))), clean, young);
    const icySurf = mix(iceTerr, vec3(0.55, 0.32, 0.2), lineae.mul(0.7).mul(young));
    solidCol = mix(solidCol, icySurf, icyWorld);
    // océan de magma : croûte noire et fissures incandescentes
    // (un monde glacé chauffé ne fait pas de lave : il se resurface de glace jeune)
    const molten = smoothstep(0.3, 0.65, heat).mul(float(1).sub(icyWorld));
    const wl = mx_worley_noise_vec2(qs.mul(6.0));
    const cracks = smoothstep(0.09, 0.0, wl.y.sub(wl.x));
    solidCol = mix(solidCol, vec3(0.07, 0.05, 0.045), molten);
    const lava = vec3(1.0, 0.32, 0.06).mul(cracks.add(float(1).sub(land).mul(0.5)).mul(molten).mul(heat).mul(2.2));

    // géante : bandes déformées par la turbulence + une tempête ovale ;
    // jeune et chaude, ses bandes sont floues ; elles se contrastent en vieillissant
    const turb = mx_fractal_noise_float(qs.mul(vec3(1.5, 6.0, 1.5)), 4, 2.0, 0.55);
    const lat = q.y.add(turb.mul(0.07));
    const bands = sin(lat.mul(22.0).add(seed)).mul(0.5).add(0.5).mul(sin(lat.mul(7.0).add(seed.mul(1.7))).mul(0.25).add(0.75));
    const gasA = mix(vec3(0.82, 0.68, 0.5), vec3(0.55, 0.62, 0.78), smoothstep(3.0, 7.0, aV)); // plus bleutées au loin
    const contrast = mix(0.15, 0.5, age).mul(float(1).sub(heat.mul(0.6)));
    const gasCol0 = mix(gasA.mul(float(1).sub(contrast)), gasA, bands);
    const stormLat = varying(hash(instanceIndex.add(uint(3))).mul(0.8).sub(0.4));
    const sd = vec3(q.x.sub(0.9), q.y.sub(stormLat).mul(2.6), q.z).length();
    const storm = smoothstep(0.3, 0.12, sd).mul(age);
    const gasCol = mix(gasCol0, vec3(0.75, 0.38, 0.25), storm.mul(0.8));
    const isGas = smoothstep(0.15, 0.6, gasV);
    let albedo = mix(solidCol, gasCol, isGas);

    // atmosphère : voile qui adoucit la surface ; épaisse et jaune si chaude
    // (couches nuageuses : une atmosphère chaude et épaisse cache le sol, type Vénus)
    const hazeCol = mix(vec3(0.45, 0.65, 1.0), vec3(0.95, 0.78, 0.45), hotAtm);
    const clouds = mx_fractal_noise_float(qs.mul(vec3(2.0, 5.0, 2.0)).add(vec3(time.mul(0.02), 0, 0)), 4, 2.0, 0.5);
    const cloudCol = mix(hazeCol.mul(0.7), hazeCol, smoothstep(-0.3, 0.4, clouds));
    // nuages blancs épars sur un monde tempéré à océans
    const wisps = smoothstep(0.15, 0.45, clouds).mul(ocean.min(0.6)).mul(float(1).sub(hotAtm));
    albedo = mix(albedo, cloudCol, atmo.mul(float(1).sub(isGas)).mul(mix(0.08, 0.9, hotAtm)));
    albedo = mix(albedo, vec3(0.85, 0.88, 0.9), wisps.mul(float(1).sub(isGas)));

    // ── Éclairage : flux ∝ 1/a (adouci), terminateur doux, pas de surexposition
    // (décroissance très adoucie : en vrai ∝ 1/a², mais les planètes lointaines
    //  doivent rester lisibles ; en HDR la face éclairée peut dépasser le blanc)
    const flux = clamp(float(2.4).mul(V.lightK).div(pow(aV.max(0.4), 0.5)), 0.3, V.planetFlux);
    const ndl = max(dot(n, toStar), 0.0);
    const lit = smoothstep(-0.05, 0.6, dot(n, toStar)).mul(0.35).add(ndl.mul(0.65));
    // liseré (Fresnel) : seulement au bord du disque vu depuis la caméra
    const rim = float(1).sub(max(dot(n, normalize(cameraPosition.sub(positionWorld))), 0)).pow(4);
    const dayRim = smoothstep(-0.2, 0.4, dot(n, toStar));
    mat.colorNode = albedo.mul(lit.mul(flux).mul(V.starCol.mul(0.5).add(0.5)).add(0.05))
      .add(lava.mul(float(1).sub(isGas)))                                   // visible aussi côté nuit
      .add(vec3(0.9, 0.3, 0.1).mul(heat.mul(isGas).mul(0.25)))             // géante jeune : lueur
      .add(hazeCol.mul(rim).mul(atmo).mul(dayRim).mul(flux).mul(0.9))      // limbe atmosphérique
      .add(vec3(1.0, 0.45, 0.15).mul(glow))
      .add(vec3(0.6, 0.9, 1.0).mul(sel).mul(rim).mul(0.5))
      .add(vec3(1.0, 0.92, 0.8).mul(pulse).mul(rim).mul(0.7)); // note jouée : liseré discret (un éclair, lui, signale une collision)

    const geo = new THREE.IcosahedronGeometry(1, 5);
    const planets = new THREE.Mesh(geo, mat);
    planets.count = M;
    planets.frustumCulled = false;
    scene.add(planets);
  }

  // ── Orbites (mises à jour depuis les lectures CPU) ─────────────────────────
  const SEG = 128;
  const orbitPos = new Float32Array(M * SEG * 2 * 3);
  const orbitCol = new Float32Array(M * SEG * 2 * 3);
  const orbitGeo = new THREE.BufferGeometry();
  orbitGeo.setAttribute('position', new THREE.BufferAttribute(orbitPos, 3));
  orbitGeo.setAttribute('color', new THREE.BufferAttribute(orbitCol, 3));
  const orbitMat = new THREE.LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
  const orbits = new THREE.LineSegments(orbitGeo, orbitMat);
  orbits.frustumCulled = false;
  orbits.visible = false; // (lignes d'orbite retirées : elles alourdissaient l'image)

  function updateOrbits(planets) {
    if (!orbits.visible) return;
    orbitPos.fill(0); orbitCol.fill(0);
    for (const pl of planets) {
      const o = pl.index * SEG * 6;
      // orbites discrètes et neutres ; seule la planète choisie est soulignée
      const k = pl.selected ? 0.7 : 0.05;
      const c = pl.selected ? [0.6, 0.9, 1.0] : [0.7, 0.8, 1.0];
      for (let s = 0; s < SEG; s++) {
        const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
        orbitPos.set([pl.a * Math.cos(a0), 0, pl.a * Math.sin(a0), pl.a * Math.cos(a1), 0, pl.a * Math.sin(a1)], o + s * 6);
        orbitCol.set([c[0] * k, c[1] * k, c[2] * k, c[0] * k, c[1] * k, c[2] * k], o + s * 6);
      }
    }
    orbitGeo.attributes.position.needsUpdate = true;
    orbitGeo.attributes.color.needsUpdate = true;
  }

  // (La tête de lecture n'est plus dessinée : elle reste un principe sonore,
  //  visible dans le panneau « Sillon ».)

  // ── Post-process : bloom + vignette ────────────────────────────────────────
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const qp = new URLSearchParams(location.search);
  // Objectif (désactivable avec ?nolens) :
  //  · flou de mouvement : vecteurs vitesse écrits par les objets opaques (les
  //    roues qui tournent, les bras, la caméra qui orbite) ; les matériaux
  //    additifs (poussière, halos, verre) n'écrivent pas de vitesse ;
  //  · profondeur de champ : la poussière n'écrit pas de profondeur, donc là
  //    où il n'y a que le fond on fait comme si c'était le plan net — le
  //    disque reste net, la machine au premier et à l'arrière-plan se floute.
  const lens = !qp.has('nolens');
  if (lens) scenePass.setMRT(mrt({ output, velocity }));
  const sharp = scenePass.getTextureNode('output');
  let color = sharp;
  if (lens) {
    const vel = scenePass.getTextureNode('velocity');
    const mb = motionBlur(color, vel.mul(V.blurK), 10);
    const vz = scenePass.getViewZNode();
    const vzF = select(vz.lessThan(-400.0), V.focus.negate(), vz);
    color = dof(mb, vzF, V.focus, V.focusRange, V.bokeh);
  }
  const useBloom = !qp.has('nobloom');
  const cine = !qp.has('nocine');
  // Rendu « cinéma » (désactivable avec ?nocine) :
  //  · bloom doux et large, seuil haut (la poussière reste nette) ;
  //  · traînée anamorphique horizontale sur les sources intenses (étoile,
  //    éclairs, supernova), légèrement bleutée ;
  //  · étalonnage : ombres froides, hautes lumières chaudes, contraste en S ;
  //  · vignettage ovale et grain de pellicule animé.
  const ctr = screenUV.sub(0.5);
  // (pas d'aberration chromatique : sur des grains d'un ou deux pixels, décaler
  //  R et B en laissant G en place fabriquait un fantôme vert pour chaque grain)
  let out = color.rgb;
  if (useBloom) {
    const bl = bloom(color, 0.55, 0.65, 0.85);
    out = out.add(bl);
    if (cine) {
      // traînée anamorphique : échantillonnée dans l'image nette (pas dans le
      // bloom flou) pour rester une ligne fine ; seules les hautes lumières comptent
      let streak = float(0);
      for (let i = 1; i <= 12; i++) {
        const o = vec2(i * i * 0.0016, 0);
        const w = Math.exp(-i * 0.28);
        const a1 = dot(sharp.sample(screenUV.add(o)).rgb, vec3(0.2126, 0.7152, 0.0722));
        const a2 = dot(sharp.sample(screenUV.sub(o)).rgb, vec3(0.2126, 0.7152, 0.0722));
        streak = streak.add(max(a1.sub(1.5), 0.0).add(max(a2.sub(1.5), 0.0)).mul(w));
      }
      out = out.add(vec3(0.5, 0.72, 1.0).mul(streak.min(4.0)).mul(0.06));
    }
  }
  out = out.mul(V.exposure);
  if (cine) {
    const l = dot(out, vec3(0.2126, 0.7152, 0.0722));
    const tint = mix(vec3(0.97, 0.95, 1.06), vec3(1.05, 0.98, 0.93), smoothstep(0.02, 0.6, l)); // ombres bleutées (sans vert) → hautes lumières chaudes
    out = out.mul(tint);
    out = out.sub(vec3(l, l, l)).mul(1.08).add(vec3(l, l, l));                                     // saturation légère
    out = out.mul(smoothstep(0.0, 0.02, l).mul(0.1).add(0.9));           // noirs un peu plus profonds
    const vig = smoothstep(1.0, 0.25, length(ctr.mul(vec2(1.25, 1.6))));
    // (hachage entier par pixel et par image : pas de motif, contrairement à fract(sin(·)))
    const pix = screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(8191)));
    const grain = hash(pix.add(fract(time.mul(0.37)).mul(1.0e6).toUint().mul(uint(131071)))).sub(0.5).mul(0.035);
    out = out.mul(vig.mul(0.4).add(0.6)).add(grain.mul(float(1).sub(l.min(1.0).mul(0.6))).mul(0.5));
  } else {
    out = out.mul(smoothstep(1.25, 0.35, length(ctr).mul(1.6)));
  }
  out = max(out.xyz, vec3(0));
  if (HDR) {
    // Courbe HDR : linéaire jusqu'à 0,7 (le blanc de l'interface vaut 1), puis
    // épaule exponentielle vers le pic de l'écran. Calculée sur la composante
    // max : la teinte est conservée ; les sources très intenses blanchissent
    // un peu, comme sur un vrai capteur.
    const K = 0.7;
    const m = max(out.r, max(out.g, out.b));
    const span = V.peak.sub(K);
    const mt = select(m.lessThan(K), m, float(K).add(span.mul(float(1).sub(exp(m.sub(K).div(span).negate())))));
    const toned = out.mul(mt.div(m.max(1e-5)));
    out = mix(toned, vec3(mt, mt, mt), smoothstep(V.peak.mul(0.6), V.peak.mul(3.0), m).mul(0.7));
  }
  pipeline.outputNode = vec4(out, 1.0);

  // ── Effets ──────────────────────────────────────────────────────────────────
  // · Impact géant : éclair + deux ondes de choc ORANGE, accrochés à la planète
  //   survivante (position exacte fournie à chaque image par main.js).
  // · Note jouée : la planète elle-même s'illumine et grossit un instant, et un
  //   repère s'allume SUR la tête de lecture, au rayon de la planète.
  const ringShader = (mat, U, width) => {
    const d = length(uv().sub(0.5)).mul(2.0);
    const x = d.sub(0.82).div(width);
    mat.colorNode = vec4(U.color.mul(U.k), exp(x.mul(x).negate()).mul(smoothstep(1.0, 0.95, d)));
  };
  const additive = () => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const makeRing = (width, rgb) => {
    const U = { color: uniform(new THREE.Color(...rgb)), k: uniform(0) };
    const m = new THREE.MeshBasicNodeMaterial({ ...additive(), side: THREE.DoubleSide });
    ringShader(m, U, width);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, U };
  };
  const impacts = Array.from({ length: 6 }, () => {
    const U = { color: uniform(new THREE.Color(1, 0.6, 0.3)), k: uniform(0) };
    const fm = new THREE.SpriteNodeMaterial(additive());
    const dd = length(uv().sub(0.5)).mul(2.0);
    fm.colorNode = vec4(U.color.mul(U.k), exp(dd.mul(dd).mul(-9.0)).add(exp(dd.mul(-14.0)).mul(2.0)).mul(smoothstep(1.0, 0.8, dd)));
    const flash = new THREE.Sprite(fm);
    flash.visible = false;
    scene.add(flash);
    return { flash, U, r1: makeRing(0.06, [1, 0.7, 0.4]), r2: makeRing(0.14, [1, 0.45, 0.2]), t: -1, pos: [0, 0, 0] };
  });
  // repères sur la tête de lecture
  const ticks = Array.from({ length: 12 }, () => {
    const U = { color: uniform(new THREE.Color()), k: uniform(0) };
    const m = new THREE.SpriteNodeMaterial(additive());
    const d = length(uv().sub(0.5)).mul(2.0);
    m.colorNode = vec4(U.color.mul(U.k), exp(d.mul(d).mul(-12.0)));
    const sp = new THREE.Sprite(m);
    sp.visible = false;
    scene.add(sp);
    return { sp, U, t: -1 };
  });
  const pulses = new Map(); // index → âge (s)
  const SHOW_TICKS = false;
  const _p = new THREE.Vector3();

  // strength ~ masse de l'impacteur en M⊕
  function impact(index, pos, strength) {
    const fx = impacts.reduce((b, f) => (f.t < 0 ? f : b.t < 0 ? b : f.t > b.t ? f : b));
    fx.t = 0; fx.index = index; fx.pos = pos.slice(); fx.s = Math.min(1.6, 0.3 + 0.5 * Math.cbrt(strength));
    fx.k = Math.min(1, 0.2 + strength / 2); // intensité : une collision d'embryons n'aveugle pas
    fx.flash.visible = fx.r1.mesh.visible = fx.r2.mesh.visible = true;
  }
  function pulse(index, a, rgb) {
    pulses.set(index, 0);
    if (!SHOW_TICKS) return; // repères sur la tête de lecture : masqués
    const k = ticks.find((q) => q.t < 0) || ticks[0];
    k.t = 0;
    k.sp.position.set(a, 0.004, 0);
    k.U.color.value.setRGB(0.4 + 0.6 * rgb[0], 0.4 + 0.6 * rgb[1], 0.4 + 0.6 * rgb[2]);
    k.sp.visible = true;
  }
  function updateFx(dtReal, getPos) {
    for (const f of impacts) {
      if (f.t < 0) continue;
      f.t += dtReal;
      const q = getPos(f.index);
      if (q) f.pos = q; // sinon (planète disparue) l'effet reste sur place
      const [x, y, z] = f.pos, t = f.t;
      // vu de près (suivi d'une planète), l'effet est réduit pour ne pas tout blanchir
      const near = Math.min(1, Math.max(0.07, camera.position.distanceTo(_p.set(x, y, z)) / 9));
      const S = f.s * near;
      // éclair : blanc → orange
      const fl = Math.exp(-t * 1.8);
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
      if (t > 6) { f.t = -1; f.flash.visible = f.r1.mesh.visible = f.r2.mesh.visible = false; }
    }
    pulseArr.fill(0);
    for (const [i, age] of pulses) {
      const a = age + dtReal;
      if (a > 0.9) { pulses.delete(i); continue; }
      pulses.set(i, a);
      pulseArr[i] = Math.exp(-a * 5) * Math.min(1, a * 40);
    }
    pulseBuf.value.needsUpdate = true;
    if (evoDirty) { evoBuf.value.needsUpdate = true; evoDirty = false; }
    for (const k of ticks) {
      if (k.t < 0) continue;
      k.t += dtReal;
      k.U.k.value = 5 * Math.exp(-k.t * 3.5);
      k.sp.scale.setScalar(0.12 + 0.25 * (1 - Math.exp(-k.t * 6)));
      if (k.t > 1.2) { k.t = -1; k.sp.visible = false; }
    }
  }

  // Paramètres de l'étoile fournis par le cycle de vie (lifecycle.js)
  function setStar(p) {
    const R = p.starVisR;
    star.userData.core.scale.setScalar(R);
    // éclat de surface ∝ (L / R²)^¼ (température effective) ; halo ∝ luminosité
    V.starI.value = p.starI;
    star.userData.halo.scale.setScalar(1.3 * Math.min(3, Math.max(0.35, Math.pow(p.L, 0.3))) + 2 * R);
    V.starCol.value.setRGB(p.color[0], p.color[1], p.color[2]);
    V.lightK.value = Math.min(2.5, Math.max(0.12, Math.pow(p.L, 0.35)));
    V.ambient.value = p.ambient;
    V.jets.value = p.jets;
    pulsarK = p.pulsar || 0;
    V.sizeK.value = p.sizeK;
    V.shell.value = p.shell;
    shell.visible = p.shell > 0.002;
    if (shell.visible) shell.scale.setScalar(Math.max(0.1, p.shellR));
  }

  let pulsarK = 0;
  // les matériaux additifs n'écrivent pas de vitesse (sinon un million de
  // grains additionneraient leurs vecteurs)
  if (lens) {
    const zeroVel = mrt({ velocity: vec4(0) });
    scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      // (ni les planètes : elles bougent par leur buffer, que le vecteur vitesse
      //  ignore — suivies par la caméra, elles seraient étalées jusqu'à disparaître)
      for (const m of ms) if (m.blending === THREE.AdditiveBlending || m.transparent || o.isInstancedMesh || o.count > 1) m.mrtNode = zeroVel;
    });
  }
  return { V, star, flyStar, updateOrbits, pipeline, impact, pulse, updateFx, setEvo, setStar, updatePulsar: (dt) => updatePulsar(dt, pulsarK) };
}
