// Rendu : poussière (sprites instanciés lus directement dans les buffers de
// simulation), étoile, embryons éclairés, orbites, tête de lecture, post-process.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, uniform, float, vec3, vec4, length, exp, max, mix, uv,
  smoothstep, varying, hash, positionLocal, normalLocal, normalize, dot, select, min,
  pass, screenUV, pow, clamp, instancedArray, cbrt, sin, time, cameraPosition, abs,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { cellOf, diskH, M, R_IN, R_OUT, M_EARTH } from './sim.js';
import { provenanceTSL, ROCK, ICE } from './palette.js';

export function createVisuals(renderer, scene, camera, sim) {
  const { pPos, pVel, pHeat, ePos, eTot, eGas, tau } = sim.buffers;
  // Pulsation de chaque planète quand elle passe sous la tête (écrite par le CPU)
  const pulseBuf = instancedArray(M, 'float');
  const pulseArr = pulseBuf.value.array;

  const V = {
    colorMode: uniform(0, 'int'),
    alpha: uniform(0.14),
    dustK: uniform(1.0),   // éclat global de la poussière (baisse quand le disque s'épuise)
    size: uniform(0.0085 * Math.min(3, Math.sqrt((1 << 20) / sim.N))),
    light: uniform(1.5),
    ambient: uniform(0.04),
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
    const col = varying(base.mul(irr.mul(V.light).add(V.ambient)).add(thermal).mul(V.alpha.mul(V.dustK)).add(hot.mul(0.5)));

    // Grain net : cœur plein, bord court (plus de halo flou)
    const d = length(uv().sub(0.5));
    const shape = smoothstep(0.5, 0.28, d);
    mat.colorNode = vec4(col, shape);
    // Taille plafonnée en pixels : vus de près, les grains restent des points
    // fins au lieu de devenir des taches (utile quand on suit une planète).
    const camD = length(P.xyz.sub(cameraPosition));
    mat.scaleNode = V.size.mul(hash(instanceIndex).mul(0.8).add(0.6)).mul(heat.mul(1.6).add(1.0)).mul(clamp(camD.div(4.0), 0.06, 1.0));

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
  const star = makeStar(0.15, [6.0, 4.6, 3.2], 3.2);
  scene.add(star);
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
    const rocky = varying(mix(provenanceTSL(meanR), vec3(0.9, 0.95, 1.0), ice.mul(0.35)));
    const gasV = varying(gasF);
    const bands = sin(normalLocal.y.mul(17.0).add(sin(normalLocal.y.mul(5.0)).mul(1.5))).mul(0.5).add(0.5);
    const gasCol = mix(vec3(0.85, 0.72, 0.55), vec3(0.6, 0.48, 0.38), bands);
    const albedo = mix(rocky, gasCol, smoothstep(0.15, 0.6, gasV));
    const toStar = varying(normalize(E.xyz.negate()));
    const glow = varying(clamp(T.z.mul(0.08), 0, 3.0));
    const sel = varying(select(instanceIndex.toInt().equal(V.selected), 1.0, 0.0));
    const pulse = varying(pulseBuf.element(instanceIndex));
    const n = normalize(normalLocal);
    const ndl = max(dot(n, toStar), 0.0);
    const rim = float(1).sub(max(dot(n, normalize(vec3(0, 1, 0).add(toStar.negate()))), 0)).pow(3);
    mat.colorNode = albedo.mul(ndl.mul(1.8).add(0.03))
      .add(vec3(1.0, 0.45, 0.15).mul(glow))
      .add(vec3(0.6, 0.9, 1.0).mul(sel).mul(rim).mul(2.0))
      .add(vec3(1.0, 0.95, 0.85).mul(pulse).mul(rim.mul(4.0).add(0.8)));

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
  pipeline.outputNode = (useBloom ? color.add(bloom(color, 0.7, 0.45, 0.6)) : color).mul(vig);

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
    fx.t = 0; fx.index = index; fx.pos = pos.slice(); fx.s = Math.min(1.6, 0.55 + 0.45 * Math.cbrt(strength));
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
      f.U.k.value = 14 * fl;
      f.U.color.value.setRGB(1, 0.55 + 0.4 * fl, 0.25 + 0.6 * fl * fl);
      // ondes de choc dans le plan du disque
      f.r1.mesh.position.set(x, y + 0.001, z);
      f.r1.mesh.scale.setScalar(0.05 * near + S * 3.2 * (1 - Math.exp(-t * 1.6)));
      f.r1.U.k.value = 7 * Math.exp(-t * 1.0);
      f.r2.mesh.position.set(x, y + 0.001, z);
      f.r2.mesh.scale.setScalar(0.05 * near + S * 6 * (1 - Math.exp(-t * 0.6)));
      f.r2.U.k.value = 3 * Math.exp(-t * 0.7) * Math.min(1, t * 4);
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
    for (const k of ticks) {
      if (k.t < 0) continue;
      k.t += dtReal;
      k.U.k.value = 5 * Math.exp(-k.t * 3.5);
      k.sp.scale.setScalar(0.12 + 0.25 * (1 - Math.exp(-k.t * 6)));
      if (k.t > 1.2) { k.t = -1; k.sp.visible = false; }
    }
  }

  return { V, star, flyStar, updateOrbits, pipeline, impact, pulse, updateFx };
}
