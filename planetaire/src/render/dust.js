// Poussière : un million de sprites instanciés qui lisent directement les
// buffers de simulation (aucune copie).
import * as THREE from 'three/webgpu';
import {
  instanceIndex, float, vec2, vec3, vec4, length, exp, max, mix, uv, smoothstep, varying, hash,
  select, clamp, sin, cos, cameraPosition, cameraViewMatrix, abs, uint, atan,
} from 'three/tsl';
import { cellOf, diskH } from '../sim.js';
import { provenanceTSL, ROCK, ICE } from '../palette.js';
import { additive } from './common.js';

// Sur écran haute densité, des grains plus petits en unités-monde gardent la
// même taille apparente pour ~2,8× moins de pixels à remplir (le coût du rendu
// est dominé par ce remplissage additif) ; l'éclat est compensé.
export const DUST_K = Math.min(1, 1.2 / Math.min(devicePixelRatio, 2));

export function createDust(sim, V) {
  const { pPos, pVel, pHeat, tau } = sim.buffers;
  const U = sim.U, hop = U.hopper;
  const mat = new THREE.SpriteNodeMaterial(additive());
  const P = pPos.element(instanceIndex);
  const Vv = pVel.element(instanceIndex);

  // ── Trémie (DA mécanique) ──
  // Versement : un grain en attente (chaleur < 0) vole de la buse à sa place
  // le long d'une courbe qui descend l'axe puis s'évase, en tournant avec le nuage.
  // Aspiration (fin de cycle) : le même chemin à l'envers, vers la buse.
  const Hraw = pHeat.element(instanceIndex);
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

  // ── Éclairage : ombre du disque (profondeur optique depuis l'étoile) ──
  const R = length(P.xz);
  const t = tau.element(cellOf(P.xyz));
  // les grains au-dessus du plan médian échappent à l'ombre du disque
  const lift = exp(P.y.div(diskH(R).mul(0.55)).pow(2).negate());
  const shade = exp(t.mul(lift).negate());
  const irr = shade.div(R.mul(0.55).add(V.innerSoft.add(0.35)));

  // ── Couleur : provenance / roche-glace / température (touche C) ──
  const prov = provenanceTSL(P.w);
  const comp = mix(vec3(...ROCK), vec3(...ICE), Vv.w);
  const temp = mix(vec3(1.0, 0.25, 0.08), vec3(1.0, 0.92, 0.75), smoothstep(5.0, 0.4, R));
  const base = select(V.colorMode.equal(0), prov, select(V.colorMode.equal(1), comp, temp));
  // lueur thermique du disque interne, même à l'ombre
  const thermal = vec3(1.0, 0.35, 0.1).mul(smoothstep(1.4, 0.35, R)).mul(0.25);
  // éjecta d'impact : chauffés à blanc puis refroidissant vers l'orange
  const heat = max(Hraw, 0.0);
  const hot = vec3(1.0, 0.42, 0.12).mul(heat.mul(heat).mul(6.0)).add(vec3(1.0, 0.9, 0.7).mul(heat.pow(6.0).mul(10.0)));
  // moins lumineux tout près de la caméra : pas de voile devant la planète suivie
  const camD = length(P.xyz.sub(cameraPosition));
  const nearK = smoothstep(0.05, 1.2, camD).mul(0.85).add(0.15);
  const lightC = V.starCol.mul(V.lightK.min(1.2)); // (plafonné : sinon la poussière sature devant une géante)
  const col = varying(base.mul(irr.mul(V.light).mul(lightC).add(V.ambient)).add(thermal.mul(V.lightK.min(1.0)))
    .mul(V.alpha.mul(V.dustK)).mul(nearK).add(hot.mul(0.5)));

  // Taille plafonnée en pixels : vus de près, les grains restent des points
  // fins au lieu de devenir des taches (utile quand on suit une planète).
  const sz = V.size.mul(hash(instanceIndex).mul(0.8).add(0.6)).mul(heat.mul(1.6).add(1.0)).mul(clamp(camD.div(4.0), 0.06, 1.0))
    .mul(V.sizeK).mul(select(P.w.greaterThanEqual(0.0), select(hidden, 0.0, 1.0), 0.0)); // grain retiré (ou dans la trémie) : pas dessiné

  // ── Objectif appliqué aux grains (ils n'écrivent ni profondeur ni vitesse) ──
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
  // grain net : cœur plein, bord court ; flou : disque doux
  const shape = smoothstep(0.5, mix(0.28, 0.0, soft), length(uv().sub(0.5)));
  // (dans le filet de la trémie, des centaines de milliers de grains se superposent : on les atténue)
  mat.colorNode = vec4(col.mul(float(1).sub(inFlight.mul(0.8))).mul(energy), shape);

  const dust = new THREE.Sprite(mat);
  dust.count = sim.N;
  dust.frustumCulled = false;
  return dust;
}
