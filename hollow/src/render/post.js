// Chaîne de rendu : passe de scène (MRT : couleur HDR, normales, vitesses),
// rayons volumétriques du cœur (raymarching de sa carte d'ombre), occlusion
// ambiante (GTAO), anticrénelage temporel, flou de mouvement, profondeur de
// champ, bloom, étalonnage (balance, contraste, saturation, vignettage),
// aberration chromatique, tone mapping, grain.
//
// Les réglages continus sont des uniformes ; seules les options qui changent
// la structure (activer un effet, changer d'anticrénelage) reconstruisent la
// chaîne.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, uniform, vec2, vec3, vec4, float,
  dot, mix, max, smoothstep, length, screenUV, screenCoordinate, hash, uint, time, fract, renderOutput, pow, uv,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

export const TONE_MAPPINGS = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping };

export function createPost(renderer, scene, camera, lights) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // (tone mapping dans la chaîne, avant l'anticrénelage)
  const U = {
    godrays: uniform(0.6), godraysColor: uniform(new THREE.Color()), aoStrength: uniform(0.8),
    blur: uniform(0.6), focus: uniform(4), focusRange: uniform(2), bokeh: uniform(2),
    exposure: uniform(1), contrast: uniform(1), saturation: uniform(1), warmth: uniform(0), vignette: uniform(0.35),
    ca: uniform(0.2), grain: uniform(0.04),
  };
  let nodes = {};
  let key = '';

  function build(cfg) {
    // (les rayons lisent la carte d'ombre du cœur : elle n'existe qu'après le premier rendu)
    const rays = cfg.godrays && !!lights.core.shadow.map;
    const k = [cfg.aa, cfg.bloom, rays, cfg.ao, cfg.dof, cfg.motionBlur > 0, cfg.ca > 0].join();
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
    const vel = needVel ? scenePass.getTextureNode('velocity').xy.mul(vec2(0.5, -0.5)) : null; // NDC → UV
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
      const t = traa(color, depth, scenePass.getTextureNode('velocity'), camera);
      nodes.traa = t;
      color = t;
    }
    if (cfg.dof) {
      const d = dof(color, scenePass.getViewZNode(), U.focus, U.focusRange, U.bokeh);
      nodes.dof = d;
      color = d;
    }
    let c = color.rgb;
    if (cfg.bloom) {
      const b = bloom(color, cfg.bloomStrength, cfg.bloomRadius, cfg.bloomThreshold);
      nodes.bloom = b;
      c = c.add(b.rgb);
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

  return { pipeline, update, render: () => pipeline.render(), U };
}
