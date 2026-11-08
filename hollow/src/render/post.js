// Chaîne de rendu : passe de scène (MRT : couleur HDR, normales, vitesses),
// rayons volumétriques du cœur (raymarching de sa carte d'ombre), occlusion
// ambiante (GTAO), anticrénelage temporel, flou de mouvement, profondeur de
// champ, bloom, étalonnage (balance, contraste, saturation, vignettage),
// traînées anamorphiques, halation, poussière sur la lentille, aberration
// chromatique, tone mapping, grain.
//
// Les réglages continus sont des uniformes ; seules les options qui changent
// la structure (activer un effet, changer d'anticrénelage) reconstruisent la
// chaîne.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, uniform, vec2, vec3, vec4, float,
  dot, mix, max, smoothstep, length, select, screenUV, screenCoordinate, hash, uint, time, fract, renderOutput, pow, uv, floor, mx_cell_noise_float, screenSize,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

export const TONE_MAPPINGS = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping };

// Poussière sur la lentille : des taches rondes et douces, de tailles et
// d'intensités variées, à deux échelles (proportions de l'écran conservées)
function lensDirt() {
  const a = screenSize.x.div(screenSize.y);
  const p = vec2(screenUV.x.mul(a), screenUV.y);
  let d = float(0);
  for (const [scale, w] of [[6, 0.7], [15, 0.45], [33, 0.3]]) {
    const q = p.mul(scale), cell = floor(q), f = fract(q);
    const h = mx_cell_noise_float(cell), h2 = mx_cell_noise_float(cell.add(17.3)), h3 = mx_cell_noise_float(cell.add(41.9));
    const c = vec2(h.mul(0.6).add(0.2), h2.mul(0.6).add(0.2));
    const r = h3.mul(0.3).add(0.12);
    d = d.add(smoothstep(r, r.mul(0.3), length(f.sub(c))).mul(step05(h3)).mul(h.mul(0.6).add(0.4)).mul(w));
  }
  return d;
}
const step05 = (x) => smoothstep(0.45, 0.55, x);

export function createPost(renderer, scene, camera, lights) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // (tone mapping dans la chaîne, avant l'anticrénelage)
  const U = {
    godrays: uniform(0.6), godraysColor: uniform(new THREE.Color()), aoStrength: uniform(0.8),
    blur: uniform(0.6), focus: uniform(4), focusRange: uniform(2), bokeh: uniform(2),
    exposure: uniform(1), contrast: uniform(1), saturation: uniform(1), warmth: uniform(0), vignette: uniform(0.35),
    ca: uniform(0.2), grain: uniform(0.04), hiCap: uniform(3),
    streaks: uniform(0.3), streakLen: uniform(6), halation: uniform(0.3), dirt: uniform(0.4),
  };
  let nodes = {};
  let key = '';

  function build(cfg) {
    // (les rayons lisent la carte d'ombre du cœur : elle n'existe qu'après le premier rendu)
    const rays = cfg.godrays && !!lights.core.shadow.map;
    const k = [cfg.aa, cfg.bloom, rays, cfg.ao, cfg.dof, cfg.motionBlur > 0, cfg.ca > 0, cfg.streaks > 0].join();
    if (k === key) return;
    key = k;
    for (const n of Object.values(nodes)) n?.dispose?.();
    nodes = {};

    const needVel = cfg.aa === 'traa' || cfg.motionBlur > 0;
    const scenePass = pass(scene, camera);
    const outs = { output };
    if (cfg.ao) outs.normal = normalView; // (cibles en demi-flottants : pas d'encodage)
    if (needVel) outs.velocity = velocity;
    scenePass.setMRT(mrt(outs));
    nodes.scenePass = scenePass;
    const depth = scenePass.getTextureNode('depth');

    const base = scenePass.getTextureNode('output');
    // (vitesse lue sous garde : NaN ou démesurée → nulle)
    const vel = needVel ? (() => { const v = scenePass.getTextureNode('velocity').xy.mul(vec2(0.5, -0.5)); return select(length(v).lessThan(0.25), v, vec2(0)); })() : null; // NDC → UV
    // flou d'obturateur centré, sur une texture
    const shutter = (tex) => {
      const v = vel.mul(U.blur), n = 10;
      let acc = tex.sample(uv());
      for (let i = 1; i < n; i++) acc = acc.add(tex.sample(uv().add(v.mul(i / (n - 1) - 0.5))));
      return acc.div(n);
    };
    let color = cfg.motionBlur > 0 ? shutter(base) : base;
    if (cfg.ao) {
      const aoPass = ao(depth, scenePass.getTextureNode('normal'), camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.35;
      aoPass.thickness.value = 0.6;
      aoPass.useTemporalFiltering = cfg.aa === 'traa';
      nodes.ao = aoPass;
      const a = aoPass.getTextureNode().sample(screenUV).r;
      color = vec4(color.rgb.mul(mix(float(1), a, U.aoStrength)), color.a);
    }
    if (rays) {
      const g = godrays(depth, camera, lights.core);
      g.raymarchSteps.value = 48;
      nodes.godrays = g;
      const r = g.getTextureNode().sample(screenUV).r;
      color = vec4(color.rgb.add(U.godraysColor.mul(r).mul(U.godrays)), color.a);
    }
    if (cfg.aa === 'traa') {
      // garde-fou : un pixel invalide (NaN, infini) ne doit jamais entrer dans
      // l'historique, il y resterait jusqu'à son renouvellement complet
      color = select(dot(color.rgb, color.rgb).lessThan(1e8), color, vec4(0, 0, 0, 1));
      const t = traa(color, depth, scenePass.getTextureNode('velocity'), camera);
      nodes.traa = t;
      color = t;
    }
    if (cfg.dof) {
      const d = dof(color, scenePass.getViewZNode(), U.focus, U.focusRange, U.bokeh);
      nodes.dof = d;
      color = d;
    }
    // Hautes lumières : épaule douce sur la composante max (la teinte est
    // conservée) — au-delà de cap/2 les valeurs tendent vers cap. Le bloom ne
    // reçoit donc jamais de pics extrêmes (pas de halos d'un reflet ponctuel).
    let c = color.rgb;
    {
      const m = max(c.r, max(c.g, c.b)).max(1e-5), k = U.hiCap.mul(0.5);
      const over = m.sub(k).max(0);
      const mt = m.min(k).add(over.div(over.div(U.hiCap.sub(k)).add(1)));
      c = c.mul(mt.div(m));
    }
    if (cfg.bloom) {
      const b = bloom(vec4(c, 1), cfg.bloomStrength, cfg.bloomRadius, cfg.bloomThreshold);
      nodes.bloom = b;
      // halation (pellicule : un liseré rouge orangé autour des hautes lumières)
      // et poussière sur la lentille (révélée par la lumière diffusée)
      c = c.add(b.rgb.mul(vec3(1, 0.32, 0.12).mul(U.halation).add(lensDirt().mul(U.dirt)).add(1)));
    }
    if (cfg.streaks > 0) {
      // traînées anamorphiques : seules les lumières les plus vives (le cœur, un
      // reflet franc) s'étirent à l'horizontale, en un filet à peine bleuté
      const hi = max(c.sub(vec3(U.hiCap.mul(0.75))), vec3(0));
      const st = gaussianBlur(vec4(hi, 1), vec2(U.streakLen, 0), 10, { resolutionScale: 0.25 });
      nodes.streaks = st;
      c = c.add(st.rgb.mul(vec3(0.8, 0.88, 1)).mul(U.streaks));
    }

    // étalonnage (linéaire, avant tone mapping)
    c = c.mul(U.exposure);
    c = c.mul(vec3(U.warmth.mul(0.08).add(1), 1, U.warmth.mul(-0.08).add(1)));
    const l0 = dot(c, LUMA).max(1e-5);
    // contraste autour du gris moyen, sur la luminance (la teinte ne bouge pas)
    c = c.mul(pow(l0.div(0.18), U.contrast.sub(1)));
    const l = dot(c, LUMA);
    c = mix(vec3(l, l, l), c, U.saturation);
    const ctr = screenUV.sub(0.5);
    c = c.mul(mix(float(1), smoothstep(0.95, 0.2, length(ctr.mul(vec2(1.2, 1.45)))), U.vignette));
    c = max(c, vec3(0));

    let out = renderOutput(vec4(c, 1));
    if (cfg.ca > 0) out = chromaticAberration(out, U.ca, vec2(0.5, 0.5), 1.1);
    // grain (après tone mapping, plus discret dans les hautes lumières)
    const pix = screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(8191)));
    const g = hash(pix.add(fract(time.mul(0.37)).mul(1e6).toUint().mul(uint(131071)))).sub(0.5);
    const lo = dot(out.rgb, LUMA);
    out = vec4(out.rgb.add(g.mul(U.grain).mul(float(1).sub(lo.mul(0.6)))), 1);
    if (cfg.aa === 'smaa') out = smaa(out);
    else if (cfg.aa === 'fxaa') out = fxaa(out);
    pipeline.outputNode = out;
    pipeline.needsUpdate = true;
  }

  function update(cfg, R) {
    build(cfg);
    U.godrays.value = cfg.godraysIntensity;
    U.godraysColor.value.set(R.core.color);
    U.aoStrength.value = cfg.aoStrength;
    U.blur.value = cfg.motionBlur;
    U.exposure.value = cfg.exposure;
    U.contrast.value = cfg.contrast;
    U.saturation.value = cfg.saturation;
    U.warmth.value = cfg.warmth;
    U.vignette.value = cfg.vignette;
    U.ca.value = cfg.ca;
    U.grain.value = cfg.grain;
    U.hiCap.value = cfg.hiCap;
    U.streaks.value = cfg.streaks ?? 0;
    U.streakLen.value = cfg.streakLen ?? 6;
    U.halation.value = cfg.halation ?? 0;
    U.dirt.value = cfg.dirt ?? 0;
    U.focus.value = cfg.focus;
    U.focusRange.value = cfg.focusRange;
    U.bokeh.value = cfg.bokeh;
    if (nodes.bloom) {
      nodes.bloom.strength.value = cfg.bloomStrength;
      nodes.bloom.radius.value = cfg.bloomRadius;
      nodes.bloom.threshold.value = cfg.bloomThreshold;
    }
    if (nodes.godrays) {
      nodes.godrays.density.value = cfg.godraysDensity;
      nodes.godrays.maxDensity.value = cfg.godraysMax;
    }
    if (nodes.ao) nodes.ao.radius.value = cfg.aoRadius;
    renderer.toneMapping = TONE_MAPPINGS[cfg.toneMapping] ?? THREE.AgXToneMapping;
  }

  return { pipeline, update, render: () => pipeline.render(), U, get nodes() { return nodes; } };
}
