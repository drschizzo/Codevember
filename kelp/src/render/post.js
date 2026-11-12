// Chaîne de rendu : pré-passe (profondeur, normales) et occlusion ambiante
// (GTAO, appliquée à l'éclairage indirect pendant la passe de scène), passe de
// scène (MRT : couleur HDR, vitesses, réflectance), réflexions en espace écran
// (SSR), anticrénelage temporel, flou de mouvement, profondeur de champ,
// bloom, traînées anamorphiques, halation, poussière sur la lentille,
// étalonnage (balance, contraste, saturation, vignettage), tone mapping,
// aberration chromatique, anticrénelage d'image (SMAA, FXAA), grain.
//
// Version mobile (cfg.lite) : une seule passe de scène, une seule cible (ni
// pré-passe, ni normales, ni vitesses, ni réflectance), bloom en quart de
// résolution, pas de traînées, de poussière sur la lentille ni d'aberration
// chromatique ; l'étalonnage, la halation et le grain tiennent dans la passe
// finale. (L'occlusion ambiante est imitée dans les matériaux, voir
// materials.js ; les réflexions en espace écran cèdent la place à
// l'environnement.)
//
// Les réglages continus sont des uniformes ; seules les options qui changent
// la structure (activer un effet, changer d'anticrénelage) reconstruisent la
// chaîne.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, uniform, vec2, vec3, vec4, float,
  dot, mix, max, smoothstep, length, select, screenUV, screenCoordinate, hash, uint, time, fract, renderOutput, pow, uv, floor, mx_cell_noise_float, screenSize,
  roughness, specularColorBlended, positionViewDirection, builtinAOContext,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
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

export function createPost(renderer, scene, camera, opts = {}) { // opts.lens(sample) : déformation de l'image par l'objectif (voir finish)
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // (tone mapping dans la chaîne, avant l'anticrénelage)
  const U = {
    aoStrength: uniform(0.8), ssrMix: uniform(1),
    blur: uniform(0.6), focus: uniform(4), focusRange: uniform(2), bokeh: uniform(2),
    exposure: uniform(1), contrast: uniform(1), saturation: uniform(1), warmth: uniform(0), vignette: uniform(0.35),
    // virage de l'humeur : teinte des ombres et des hautes lumières (voir recipe.js, grade)
    shadowTint: uniform(new THREE.Color(1, 1, 1)), highTint: uniform(new THREE.Color(1, 1, 1)),
    ca: uniform(0.2), grain: uniform(0.04), hiCap: uniform(3),
    streaks: uniform(0.3), streakLen: uniform(6), halation: uniform(0.3), dirt: uniform(0.4), ghosts: uniform(0.6),
  };
  let nodes = {};
  let key = '';

  function build(cfg) {
    const k = [cfg.aa, cfg.bloom, cfg.ao, cfg.ssr, cfg.ssrRes, cfg.dof, cfg.motionBlur > 0, cfg.ca > 0, cfg.streaks > 0, cfg.dirt > 0, !!cfg.lite].join();
    if (k === key) return;
    key = k;
    for (const n of Object.values(nodes)) n?.dispose?.();
    nodes = {};

    const useTraa = cfg.aa === 'traa', needVel = useTraa || cfg.motionBlur > 0;
    const scenePass = pass(scene, camera);
    nodes.scenePass = scenePass;

    // Occlusion ambiante : elle n'assombrit que l'éclairage indirect (studio,
    // ambiance), jamais la lumière directe ni les reflets. Elle doit donc être
    // connue pendant la passe de scène : une pré-passe de profondeur et de
    // normales la calcule, et la passe de scène la lit dans ses matériaux.
    // (La pré-passe n'évalue pas l'éclairage : son seul rendu est la normale.)
    let normals = null;
    if (cfg.ao) {
      const prePass = pass(scene, camera);
      prePass.transparent = false;
      prePass.setMRT(mrt({ output: normalView })); // (cible en demi-flottants : pas d'encodage)
      nodes.prePass = prePass;
      normals = prePass.getTextureNode('output');
      const aoPass = ao(prePass.getTextureNode('depth'), normals, camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.35;
      aoPass.thickness.value = 0.6;
      aoPass.useTemporalFiltering = useTraa;
      if (useTraa && aoPass.samples) aoPass.samples.value = 8; // (sous l'anticrénelage temporel, 8 échantillons suffisent : −1 ms)
      nodes.ao = aoPass;
      scenePass.contextNode = builtinAOContext(mix(float(1), aoPass.getTextureNode().sample(screenUV).r, U.aoStrength));
    }

    const outs = { output };
    if (cfg.ssr && !normals) outs.normal = normalView;
    if (needVel) outs.velocity = velocity;
    // pour les réflexions en espace écran : la réflectance (Fresnel de Schlick
    // à partir de F0 — couleur de base d'un métal, ~4 % d'un diélectrique) et
    // la rugosité, dans une seule cible 8 bits (WebGPU limite à 32 octets par
    // pixel le total des cibles, et une cible 8 bits en compte 8)
    if (cfg.ssr) {
      const f0 = specularColorBlended, k = float(1).sub(normalView.dot(positionViewDirection).abs().clamp(0, 1)).pow(5);
      outs.refl = vec4(f0.add(vec3(1).sub(f0).mul(k)), roughness);
    }
    scenePass.setMRT(mrt(outs));
    if (outs.refl) scenePass.getTexture('refl').type = THREE.UnsignedByteType;
    normals ??= outs.normal ? scenePass.getTextureNode('normal') : null;
    const depth = scenePass.getTextureNode('depth');
    const base = scenePass.getTextureNode('output');

    // Flou d'obturateur centré, sur une texture. Il vient après l'anticrénelage
    // temporel : celui-ci reprojette alors une image nette, sans traînées
    // fantômes sur les barres fines.
    // (vitesse lue sous garde : NaN ou démesurée → nulle ; NDC → UV)
    const vel = needVel ? (() => { const v = scenePass.getTextureNode('velocity').xy.mul(vec2(0.5, -0.5)); return select(length(v).lessThan(0.25), v, vec2(0)); })() : null;
    // (traînée plafonnée à 3 % de l'écran, et prises décalées au pixel par un
    // bruit entrelacé : régulières et espacées de plus d'un pixel, elles
    // dessinaient des copies distinctes des lames proches de l'objectif)
    const N_BLUR = 12;
    const ign = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
    const blurVec = () => { const v = vel.mul(U.blur), l = length(v); return v.mul(float(0.03).div(l.max(0.03))); };
    const blurAt = (tex, uvn) => {
      if (!(cfg.motionBlur > 0)) return tex.sample(uvn);
      const v = blurVec();
      let acc = vec4(0);
      for (let i = 0; i < N_BLUR; i++) acc = acc.add(tex.sample(uvn.add(v.mul(ign.add(i).div(N_BLUR).sub(0.5)))));
      return acc.div(N_BLUR);
    };
    const blur = (tex) => (cfg.motionBlur > 0 ? blurAt(tex, uv()) : tex);

    // (même flou, lu à des coordonnées données : l'objectif propre à la scène
    // — Kelp : les gouttes et la nappe d'eau sur le dôme — y déforme l'image)
    const finish = (tex) => (opts.lens ? opts.lens((uvn) => blurAt(tex, uvn)) : blur(tex));
    // (sans anticrénelage temporel, le flou porte sur la passe de scène)
    let color = useTraa ? base : finish(base);
    if (cfg.ssr) {
      // Réflexions en espace écran : les objets exposés et les doublures
      // reflètent ce qui est réellement autour d'eux (parois de la cellule,
      // voisins, plateau), pas seulement l'environnement de studio. Le reflet
      // est prémultiplié par la réflectance : il s'ajoute à l'image.
      const refl = scenePass.getTextureNode('refl');
      // Reflet miroir (sans bruit), adouci par un flou selon la rugosité ;
      // la passe le pondère par un scalaire, la teinte (l'or reflète doré) est
      // rendue ensuite. Au-delà d'une rugosité moyenne, le reflet est laissé à
      // l'environnement.
      const w = max(refl.r, max(refl.g, refl.b)).mul(smoothstep(0.6, 0.25, refl.a));
      const r = ssr(base, depth, normals, { metalnessNode: w, roughnessNode: refl.a, reflectNonMetals: false, camera });
      const tint = refl.rgb.div(max(refl.r, max(refl.g, refl.b)).max(1e-3));
      r.resolutionScale = cfg.ssrRes;
      nodes.ssr = r;
      color = vec4(color.rgb.add(r.rgb.mul(tint).mul(U.ssrMix)), color.a);
    }
    if (useTraa) {
      // garde-fou : un pixel invalide (NaN, infini) ne doit jamais entrer dans
      // l'historique, il y resterait jusqu'à son renouvellement complet
      color = select(dot(color.rgb, color.rgb).lessThan(1e8), color, vec4(0, 0, 0, 1));
      const t = traa(color, depth, scenePass.getTextureNode('velocity'), camera);
      nodes.traa = t;
      color = finish(t.getTextureNode());
    }
    if (cfg.dof) {
      // (cercle de confusion physique : il suit 1/distance et sature à
      // l'infini — le nœud de three.js floute sans limite au-delà de la
      // plage, et les étoiles devenaient de gros disques ; on lui donne une
      // profondeur remappée : focus + (1 − focus/z)·focus·0,14)
      const zv = scenePass.getViewZNode().negate().max(0.01);
      const zPhys = U.focus.add(float(1).sub(U.focus.div(zv)).mul(U.focus).mul(0.14)).negate();
      const d = dof(color, zPhys, U.focus, U.focusRange, U.bokeh);
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
      if (cfg.lite) b.setResolutionScale(0.25); // (un halo large : le quart de résolution ne se voit pas)
      nodes.bloom = b;
      // halation (pellicule : un liseré rouge orangé autour des hautes lumières)
      // et poussière sur la lentille (révélée par la lumière diffusée)
      const glow = vec3(1, 0.32, 0.12).mul(U.halation);
      c = c.add(b.rgb.mul((cfg.dirt > 0 ? glow.add(lensDirt().mul(U.dirt)) : glow).add(1)));
      // images fantômes du hublot : les reflets entre le dôme et l'objectif
      // renvoient le soleil en petits disques colorés, sur la droite qui joint
      // le soleil au centre de l'image, de l'autre côté
      if (!cfg.lite) {
        const bt = b.getTextureNode();
        const ghost = (k, tint) => bt.sample(vec2(0.5).add(vec2(0.5).sub(uv()).mul(k))).rgb.mul(tint);
        c = c.add(ghost(0.55, vec3(0.25, 0.32, 0.4)).add(ghost(1.25, vec3(0.38, 0.26, 0.12))).add(ghost(0.25, vec3(0.12, 0.3, 0.22))).mul(U.ghosts));
      }
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
    // virage : les ombres tirent vers une teinte, les lumières vers une autre
    c = c.mul(mix(U.shadowTint, U.highTint, smoothstep(0.02, 0.55, l)));
    const ctr = screenUV.sub(0.5);
    c = c.mul(mix(float(1), smoothstep(0.95, 0.2, length(ctr.mul(vec2(1.2, 1.45)))), U.vignette));
    c = max(c, vec3(0));

    let out = renderOutput(vec4(c, 1));
    if (cfg.ca > 0) out = chromaticAberration(out, U.ca, vec2(0.5, 0.5), 1.1);
    if (cfg.aa === 'smaa') out = smaa(out);
    else if (cfg.aa === 'fxaa') out = fxaa(out);
    // grain, en dernier (l'anticrénelage le lisserait) : après tone mapping,
    // plus discret dans les hautes lumières
    const pix = screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(8191)));
    const g = hash(pix.add(fract(time.mul(0.37)).mul(1e6).toUint().mul(uint(131071)))).sub(0.5);
    const lo = dot(out.rgb, LUMA);
    out = vec4(out.rgb.add(g.mul(U.grain).mul(float(1).sub(lo.mul(0.6)))), 1);
    pipeline.outputNode = out;
    pipeline.needsUpdate = true;
  }

  function update(cfg, R) {
    build(cfg);
    U.aoStrength.value = cfg.aoStrength;
    U.blur.value = cfg.motionBlur;
    U.exposure.value = cfg.exposure * (R?.grade?.exposure ?? 1); // (exposition fixe de l'humeur)
    // (étalonnage de l'humeur, par-dessus les réglages du panneau)
    const gr = R?.grade ?? {};
    U.contrast.value = cfg.contrast * (gr.contrast ?? 1);
    U.saturation.value = cfg.saturation * (gr.saturation ?? 1);
    U.warmth.value = cfg.warmth;
    U.shadowTint.value.setRGB(...(gr.shadows ?? [1, 1, 1]));
    U.highTint.value.setRGB(...(gr.highlights ?? [1, 1, 1]));
    U.vignette.value = cfg.vignette;
    U.ca.value = cfg.ca;
    U.grain.value = cfg.grain;
    U.hiCap.value = cfg.hiCap;
    U.streaks.value = cfg.streaks ?? 0;
    U.streakLen.value = cfg.streakLen ?? 6;
    U.halation.value = cfg.halation ?? 0;
    U.dirt.value = cfg.dirt ?? 0;
    U.ghosts.value = cfg.ghosts ?? 0.6;
    U.focus.value = cfg.focus;
    U.focusRange.value = cfg.focusRange;
    U.bokeh.value = cfg.bokeh;
    if (nodes.bloom) {
      nodes.bloom.strength.value = cfg.bloomStrength;
      nodes.bloom.radius.value = cfg.bloomRadius;
      nodes.bloom.threshold.value = cfg.bloomThreshold;
    }
    if (nodes.ao) nodes.ao.radius.value = cfg.aoRadius;
    if (nodes.ssr) {
      const r = nodes.ssr;
      U.ssrMix.value = cfg.ssrIntensity;
      r.quality.value = cfg.ssrQuality;
      r.maxDistance.value = cfg.ssrDistance;
      r.thickness.value = cfg.ssrThickness;
      r.maxLuminance.value = cfg.hiCap * 2;
      if (r.blurQuality !== cfg.ssrBlur) r.blurQuality = cfg.ssrBlur;
    }
    renderer.toneMapping = TONE_MAPPINGS[cfg.toneMapping] ?? THREE.AgXToneMapping;
  }

  return { pipeline, update, render: () => pipeline.render(), U, get nodes() { return nodes; } };
}
