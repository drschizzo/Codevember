// Rendu : poussière (sprites instanciés lus directement dans les buffers de
// simulation), étoile, embryons éclairés, orbites, tête de lecture, post-process.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, uniform, float, vec3, vec4, length, exp, max, mix, uv,
  smoothstep, varying, hash, positionLocal, normalLocal, normalize, dot, select, min,
  pass, screenUV, pow, clamp, instancedArray, cbrt, sin, cos, time, cameraPosition, abs, uint,
  mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2, positionWorld, normalWorld,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { cellOf, diskH, M, R_IN, R_OUT, M_EARTH } from './sim.js';
import { provenanceTSL, ROCK, ICE } from './palette.js';

const DUST_K = Math.min(1, 1.2 / Math.min(devicePixelRatio, 2));

export function createVisuals(renderer, scene, camera, sim) {
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
    alpha: uniform(0.14 / DUST_K ** 2),
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
  };

  // ── Poussière ──────────────────────────────────────────────────────────────
  {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const P = pPos.element(instanceIndex);
    const Vv = pVel.element(instanceIndex);
    mat.positionNode = P.xyz;

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
    const heat = pHeat.element(instanceIndex);
    const hot = vec3(1.0, 0.42, 0.12).mul(heat.mul(heat).mul(6.0)).add(vec3(1.0, 0.9, 0.7).mul(heat.pow(6.0).mul(10.0)));
    // (moins lumineux tout près de la caméra : pas de voile devant la planète suivie)
    const camD = length(P.xyz.sub(cameraPosition));
    const nearK = smoothstep(0.05, 1.2, camD).mul(0.85).add(0.15);
    const lightC = V.starCol.mul(V.lightK.min(1.2)); // (plafonné : sinon la poussière sature devant une géante)
    const col = varying(base.mul(irr.mul(V.light).mul(lightC).add(V.ambient)).add(thermal.mul(V.lightK.min(1.0))).mul(V.alpha.mul(V.dustK)).mul(nearK).div(V.sizeK).add(hot.mul(0.5)));

    // Grain net : cœur plein, bord court (plus de halo flou)
    const d = length(uv().sub(0.5));
    const shape = smoothstep(0.5, 0.28, d);
    mat.colorNode = vec4(col, shape);
    // Taille plafonnée en pixels : vus de près, les grains restent des points
    // fins au lieu de devenir des taches (utile quand on suit une planète).
    mat.scaleNode = V.size.mul(hash(instanceIndex).mul(0.8).add(0.6)).mul(heat.mul(1.6).add(1.0)).mul(clamp(camD.div(4.0), 0.06, 1.0))
      .mul(V.sizeK).mul(select(P.w.greaterThanEqual(0.0), 1.0, 0.0)); // grain retiré : plus dessiné

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
    h.scale.setScalar(3.2);
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
    const hotC = varying(mix(mix(vec3(1.0, 0.2, 0.25), vec3(0.25, 0.95, 0.85), smoothstep(-0.25, 0.35, zone)), vec3(1.0, 0.6, 0.25), smoothstep(0.4, 0.7, abs(mx_noise_float(nrm.add(warp).mul(6.0))))));
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
    const visR = select(E.w.greaterThan(0), pow(Rp, 0.75).mul(0.013).max(0.005), 0.0)
      .mul(pulseBuf.element(instanceIndex).mul(0.35).add(1.0)); // la planète « bat » quand elle sonne
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
    const flux = clamp(float(0.75).mul(V.lightK).div(pow(aV.max(0.4), 0.8)), 0.03, 2.0);
    const ndl = max(dot(n, toStar), 0.0);
    const lit = smoothstep(-0.05, 0.6, dot(n, toStar)).mul(0.35).add(ndl.mul(0.65));
    // liseré (Fresnel) : seulement au bord du disque vu depuis la caméra
    const rim = float(1).sub(max(dot(n, normalize(cameraPosition.sub(positionWorld))), 0)).pow(4);
    const dayRim = smoothstep(-0.2, 0.4, dot(n, toStar));
    mat.colorNode = albedo.mul(lit.mul(flux).mul(V.starCol.mul(0.5).add(0.5)).add(0.015))
      .add(lava.mul(float(1).sub(isGas)))                                   // visible aussi côté nuit
      .add(vec3(0.9, 0.3, 0.1).mul(heat.mul(isGas).mul(0.25)))             // géante jeune : lueur
      .add(hazeCol.mul(rim).mul(atmo).mul(dayRim).mul(flux).mul(0.9))      // limbe atmosphérique
      .add(vec3(1.0, 0.45, 0.15).mul(glow))
      .add(vec3(0.6, 0.9, 1.0).mul(sel).mul(rim).mul(0.5))
      .add(vec3(1.0, 0.95, 0.85).mul(pulse).mul(rim.mul(3.0).add(0.5)));

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
  scene.add(orbits);

  function updateOrbits(planets) {
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

  // ── Tête de lecture (fixe, φ = 0 → axe +X) ─────────────────────────────────
  {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(R_IN, 0, 0), new THREE.Vector3(R_OUT, 0, 0)]);
    const m = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.colorNode = vec4(0.5, 0.8, 1.0, 0.6);
    scene.add(new THREE.Line(g, m));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 16), new THREE.MeshBasicNodeMaterial());
    head.material.colorNode = vec3(1.2, 2.0, 3.0);
    head.position.set(R_OUT + 0.2, 0, 0);
    head.rotation.z = Math.PI / 2;
    scene.add(head);
  }

  // ── Post-process : bloom + vignette ────────────────────────────────────────
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const vig = smoothstep(1.25, 0.35, length(screenUV.sub(0.5)).mul(1.6));
  const useBloom = !new URLSearchParams(location.search).has('nobloom');
  // Seuil haut : seuls l'étoile, les planètes et les impacts « débordent »,
  // la poussière reste nette.
  pipeline.outputNode = (useBloom ? color.add(bloom(color, 0.7, 0.45, 0.85)) : color).mul(vig);

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
    star.userData.halo.scale.setScalar(3.2 * Math.min(3, Math.max(0.35, Math.pow(p.L, 0.3))) + 2 * R);
    V.starCol.value.setRGB(p.color[0], p.color[1], p.color[2]);
    V.lightK.value = Math.min(2.5, Math.max(0.12, Math.pow(p.L, 0.35)));
    V.ambient.value = p.ambient;
    V.jets.value = Math.max(p.jets, p.pulsar || 0);
    const pv = star.userData.pivot;
    if (p.pulsar > 0) { pv.rotation.x = 0.7; pv.rotation.y += 0.25; pv.scale.set(0.6, 2.2, 0.6); }
    else { pv.rotation.set(0, 0, 0); pv.scale.set(1, 1, 1); }
    V.sizeK.value = p.sizeK;
    V.shell.value = p.shell;
    shell.visible = p.shell > 0.002;
    if (shell.visible) shell.scale.setScalar(Math.max(0.1, p.shellR));
  }

  return { V, star, flyStar, updateOrbits, pipeline, impact, pulse, updateFx, setEvo, setStar };
}
