// Post-traitement : flou de mouvement et profondeur de champ (objectif),
// bloom, étalonnage « cinéma », vignettage, grain, courbe HDR, anticrénelage.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, length, exp, max, mix, smoothstep, hash, select, pass, screenUV, pow, dot, fract,
  screenCoordinate, time, uint, mrt, output, velocity,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

export function createPost(renderer, scene, camera, V, cfg) {
  const pipeline = new THREE.RenderPipeline(renderer);
  // Anticrénelage des arêtes fines (tringles, tiges, dents d'engrenage) :
  // SMAA en fin de chaîne par défaut ; MSAA 4× (plus propre, ~35 % plus lent :
  // le million de grains est rendu en 4 échantillons) ; ou aucun.
  const scenePass = pass(scene, camera, { samples: cfg.aa === 'msaa' ? 4 : 0 });
  // Objectif : vecteurs vitesse écrits par les objets opaques (roues, bras,
  // caméra qui orbite) ; la poussière n'écrit pas de profondeur, donc là où il
  // n'y a que le fond on fait comme si c'était le plan net.
  if (cfg.lens) scenePass.setMRT(mrt({ output, velocity }));
  const sharp = scenePass.getTextureNode('output');
  let color = sharp;
  if (cfg.lens) {
    const mb = motionBlur(color, scenePass.getTextureNode('velocity').mul(V.blurK), 10);
    const vz = scenePass.getViewZNode();
    color = cfg.dof ? dof(mb, select(vz.lessThan(-400.0), V.focus.negate(), vz), V.focus, V.focusRange, V.bokeh) : mb;
  }

  let out = color.rgb;
  if (cfg.bloom) {
    // bloom doux et large, seuil haut (la poussière reste nette) ; plafonné en HDR
    const bl = bloom(vec4(color.rgb.min(V.bloomCap), color.a), 0.55, 0.65, 0.85);
    // halation : le halo des hautes lumières revient teinté de rouge-orangé, comme sur la pellicule
    out = out.add(bl.rgb.mul(cfg.cine ? vec3(1.1, 0.9, 0.74) : vec3(1)));
    // traînée anamorphique (?streak), échantillonnée dans l'image nette : une ligne fine
    if (cfg.cine && cfg.streak) {
      let streak = float(0);
      for (let i = 1; i <= 24; i++) {
        const o = vec2(i * 0.0055, 0), w = Math.exp(-i * 0.13) * 0.5;
        const a1 = dot(sharp.sample(screenUV.add(o)).rgb, LUMA), a2 = dot(sharp.sample(screenUV.sub(o)).rgb, LUMA);
        streak = streak.add(max(a1.sub(1.5), 0.0).add(max(a2.sub(1.5), 0.0)).mul(w));
      }
      out = out.add(vec3(0.5, 0.72, 1.0).mul(streak.min(4.0)).mul(0.06));
    }
  }
  out = out.mul(V.exposure);

  const ctr = screenUV.sub(0.5);
  if (cfg.cine) {
    // Étalonnage dans l'espace linéaire (avant le tone mapping) :
    //  · contraste « pellicule » dans les ombres, sur la luminance seule (la teinte ne bouge pas) ;
    //  · split-toning : ombres sarcelle, hautes lumières ambre ;
    //  · noirs teintés : un plancher bleu nuit très bas.
    const l0 = dot(out, LUMA).max(1e-5);
    out = out.mul(select(l0.lessThan(0.18), pow(l0.div(0.18), 1.12).mul(0.18), l0).div(l0));
    const l = dot(out, LUMA);
    const hi = smoothstep(0.03, 0.9, l);
    out = out.mul(mix(vec3(0.94, 0.99, 1.07), vec3(1.06, 0.99, 0.9), hi));
    const L3 = vec3(l, l, l);
    out = out.sub(L3).mul(mix(float(1.0), float(1.1), hi)).add(L3); // saturation surtout dans la lumière
    out = out.add(vec3(0.0006, 0.001, 0.0019).mul(float(1).sub(smoothstep(0.0, 0.02, l))));
    const vig = smoothstep(1.0, 0.25, length(ctr.mul(vec2(1.25, 1.6))));
    // grain : hachage entier par pixel et par image (pas de motif)
    const pix = screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(8191)));
    const grain = hash(pix.add(fract(time.mul(0.37)).mul(1.0e6).toUint().mul(uint(131071)))).sub(0.5).mul(0.035).mul(V.grainK);
    out = out.mul(vig.mul(0.4).add(0.6)).add(grain.mul(float(1).sub(l.min(1.0).mul(0.6))).mul(0.5));
  } else {
    out = out.mul(smoothstep(1.25, 0.35, length(ctr).mul(1.6)));
  }
  out = max(out.xyz, vec3(0));

  if (cfg.hdr) {
    // Courbe HDR : linéaire jusqu'à 0,7 (le blanc de l'interface vaut 1), puis
    // épaule exponentielle vers le pic de l'écran, sur la composante max (la
    // teinte est conservée ; les sources très intenses blanchissent un peu).
    const K = 0.7;
    const m = max(out.r, max(out.g, out.b));
    const span = V.peak.sub(K);
    const mt = select(m.lessThan(K), m, float(K).add(span.mul(float(1).sub(exp(m.sub(K).div(span).negate())))));
    out = mix(out.mul(mt.div(m.max(1e-5))), vec3(mt, mt, mt), smoothstep(V.peak.mul(0.6), V.peak.mul(3.0), m).mul(0.7));
  }
  pipeline.outputNode = cfg.aa === 'smaa' ? smaa(vec4(out, 1.0)) : vec4(out, 1.0);
  return pipeline;
}
