// Rendu : poussière (sprites instanciés lus directement dans les buffers de
// simulation), étoile, embryons éclairés, orbites, tête de lecture, post-process.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, uniform, float, vec3, vec4, length, exp, max, mix, uv,
  smoothstep, varying, hash, positionLocal, normalLocal, normalize, dot, select,
  pass, screenUV, pow, clamp, instancedArray, cbrt, sin, time,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { cellOf, diskH, M, R_IN, R_OUT, M_EARTH } from './sim.js';
import { provenanceTSL, ROCK, ICE } from './palette.js';

export function createVisuals(renderer, scene, camera, sim) {
  const { pPos, pVel, ePos, eTot, tau } = sim.buffers;

  const V = {
    colorMode: uniform(0, 'int'),
    alpha: uniform(0.065),
    size: uniform(0.02 * Math.min(3, Math.sqrt((1 << 20) / sim.N))),
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
    const col = varying(base.mul(irr.mul(V.light).add(V.ambient)).add(thermal).mul(V.alpha));

    const d = length(uv().sub(0.5));
    const shape = smoothstep(0.5, 0.0, d).pow(1.5);
    mat.colorNode = vec4(col, shape);
    mat.scaleNode = V.size.mul(hash(instanceIndex).mul(0.9).add(0.55));

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
    const shape = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
    mat.colorNode = vec4(mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.85, 0.7), hash(instanceIndex)).mul(S.w.mul(2.0).add(0.15)), shape);
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
  const star = makeStar(0.08, [6.0, 4.6, 3.2], 3.0);
  scene.add(star);
  const flyStar = makeStar(0.06, [3.0, 4.0, 7.0], 2.2);
  flyStar.visible = false;
  scene.add(flyStar);

  // ── Embryons / planètes ────────────────────────────────────────────────────
  {
    const mat = new THREE.MeshBasicNodeMaterial();
    const E = ePos.element(instanceIndex);
    const T = eTot.element(instanceIndex);
    const m = max(E.w, 1e-30);
    const visR = select(E.w.greaterThan(0), cbrt(m.div(M_EARTH)).mul(0.028).max(0.008), 0.0);
    mat.positionNode = positionLocal.mul(visR).add(E.xyz);

    const ice = clamp(T.x.div(m), 0, 1);
    const meanR = T.y.div(m);
    const albedo = varying(mix(provenanceTSL(meanR), vec3(0.9, 0.95, 1.0), ice.mul(0.35)));
    const toStar = varying(normalize(E.xyz.negate()));
    const glow = varying(clamp(T.z.mul(0.08), 0, 3.0));
    const sel = varying(select(instanceIndex.toInt().equal(V.selected), 1.0, 0.0));
    const n = normalize(normalLocal);
    const ndl = max(dot(n, toStar), 0.0);
    const rim = float(1).sub(max(dot(n, normalize(vec3(0, 1, 0).add(toStar.negate()))), 0)).pow(3);
    mat.colorNode = albedo.mul(ndl.mul(1.8).add(0.03))
      .add(vec3(1.0, 0.45, 0.15).mul(glow))
      .add(vec3(0.6, 0.9, 1.0).mul(sel).mul(rim).mul(2.0));

    const geo = new THREE.IcosahedronGeometry(1, 4);
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
      const k = pl.selected ? 0.9 : pl.resonant ? 0.35 : 0.1;
      const c = pl.selected ? [0.6, 0.9, 1.0] : pl.color;
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
    m.colorNode = vec4(0.5, 0.8, 1.0, 0.35);
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
  pipeline.outputNode = (useBloom ? color.add(bloom(color, 0.75, 0.5, 0.3)) : color).mul(vig);

  return { V, star, flyStar, updateOrbits, pipeline };
}
