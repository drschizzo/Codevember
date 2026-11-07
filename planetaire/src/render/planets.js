// Planètes : sphères instanciées (une par embryon) à surface procédurale,
// lues directement dans les buffers de simulation.
import * as THREE from 'three/webgpu';
import {
  instanceIndex, instancedArray, float, vec3, max, mix, smoothstep, varying, hash, positionLocal, normalLocal,
  normalize, dot, select, pow, clamp, sin, cos, abs, time, uint, length, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2,
} from 'three/tsl';
import { M, M_EARTH, planetRadiusNode } from '../sim.js';
import { toCamera } from './common.js';

export function createPlanets(sim, V) {
  const { ePos, eTot, eGas } = sim.buffers;
  // pulsation de chaque planète quand elle sonne (écrite par le CPU)
  const pulseBuf = instancedArray(M, 'float');
  const pulseArr = pulseBuf.value.array;
  // état d'évolution de chaque planète (app/planets.js) :
  //   [2i]   = chaleur interne, océans, banquise, cratères
  //   [2i+1] = atmosphère, atmosphère chaude, âge (0..1), T_eq / 1000 K
  const evoBuf = instancedArray(M * 2, 'vec4');
  const evoArr = evoBuf.value.array;
  let evoDirty = false, pulsing = false;
  const pulses = new Map(); // index → âge (s)

  const mat = new THREE.MeshBasicNodeMaterial();
  const E = ePos.element(instanceIndex);
  const T = eTot.element(instanceIndex);
  const G = eGas.element(instanceIndex);
  const m = max(E.w, 1e-30);
  const visR = select(E.w.greaterThan(0), planetRadiusNode(m.div(M_EARTH)), 0.0).mul(V.planetK)
    .mul(pulseBuf.element(instanceIndex).mul(0.06).add(1.0)); // la planète « bat » (à peine) quand elle sonne
  mat.positionNode = positionLocal.mul(visR).add(E.xyz);

  const solid = max(m.sub(G.y), 1e-30);
  const gasF = clamp(G.y.div(m), 0, 1);
  const ice = clamp(T.x.div(solid), 0, 1);
  const meanR = T.y.div(solid);
  // Couleur de surface = composition (roche riche en fer si la matière vient du
  // disque interne chaud, basalte sinon ; la glace éclaircit et bleuit)
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

  const EA = varying(evoBuf.element(instanceIndex.mul(2)));
  const EB = varying(evoBuf.element(instanceIndex.mul(2).add(1)));
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
  // planète glacée : croûte de glace fracturée (type Europe / Ganymède : terrains
  // anciens sombres, glace jeune claire, linéaments brun-rouge)
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

  // atmosphère : voile qui adoucit la surface ; épaisse et jaune si chaude (type Vénus)
  const hazeCol = mix(vec3(0.45, 0.65, 1.0), vec3(0.95, 0.78, 0.45), hotAtm);
  const clouds = mx_fractal_noise_float(qs.mul(vec3(2.0, 5.0, 2.0)).add(vec3(time.mul(0.02), 0, 0)), 4, 2.0, 0.5);
  const cloudCol = mix(hazeCol.mul(0.7), hazeCol, smoothstep(-0.3, 0.4, clouds));
  const wisps = smoothstep(0.15, 0.45, clouds).mul(ocean.min(0.6)).mul(float(1).sub(hotAtm)); // nuages épars sur un monde à océans
  albedo = mix(albedo, cloudCol, atmo.mul(float(1).sub(isGas)).mul(mix(0.08, 0.9, hotAtm)));
  albedo = mix(albedo, vec3(0.85, 0.88, 0.9), wisps.mul(float(1).sub(isGas)));

  // ── Éclairage : flux ∝ 1/√a (très adouci : en vrai ∝ 1/a², mais les planètes
  // lointaines doivent rester lisibles), terminateur doux
  const flux = clamp(float(2.4).mul(V.lightK).div(pow(aV.max(0.4), 0.5)), 0.3, V.planetFlux);
  const ndl = max(dot(n, toStar), 0.0);
  const lit = smoothstep(-0.05, 0.6, dot(n, toStar)).mul(0.35).add(ndl.mul(0.65));
  const rim = float(1).sub(max(dot(n, toCamera()), 0)).pow(4); // liseré (Fresnel)
  const dayRim = smoothstep(-0.2, 0.4, dot(n, toStar));
  mat.colorNode = albedo.mul(lit.mul(flux).mul(V.starCol.mul(0.5).add(0.5)).add(0.05))
    .add(lava.mul(float(1).sub(isGas)))                                   // visible aussi côté nuit
    .add(vec3(0.9, 0.3, 0.1).mul(heat.mul(isGas).mul(0.25)))             // géante jeune : lueur
    .add(hazeCol.mul(rim).mul(atmo).mul(dayRim).mul(flux).mul(0.9))      // limbe atmosphérique
    .add(vec3(1.0, 0.45, 0.15).mul(glow))
    .add(vec3(0.6, 0.9, 1.0).mul(sel).mul(rim).mul(0.5))
    .add(vec3(1.0, 0.92, 0.8).mul(pulse).mul(rim).mul(0.7));             // note jouée : liseré discret

  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), mat);
  mesh.count = M;
  mesh.frustumCulled = false;

  return {
    mesh,
    setEvo(i, a, b) { evoArr.set(a, i * 8); evoArr.set(b, i * 8 + 4); evoDirty = true; },
    pulse(i) { pulses.set(i, 0); },
    update(dtReal) {
      if (pulses.size || pulsing) {
        pulseArr.fill(0);
        for (const [i, age] of pulses) {
          const a = age + dtReal;
          if (a > 0.9) { pulses.delete(i); continue; }
          pulses.set(i, a);
          pulseArr[i] = Math.exp(-a * 5) * Math.min(1, a * 40);
        }
        pulseBuf.value.needsUpdate = true;
        pulsing = pulses.size > 0; // (une dernière mise à zéro après la fin des pulsations)
      }
      if (evoDirty) { evoBuf.value.needsUpdate = true; evoDirty = false; }
    },
  };
}
