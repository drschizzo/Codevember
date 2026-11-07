// Pièces animées d'une coquille : chaque sommet d'une pièce porte un mouvement
// rigide (attributs rigA = pivot b, amplitude ; rigB = axe a, nature + tirage
// propre à la pièce ; voir gen/mesh.js), appliqué dans le vertex shader :
//
//   p' = b + rotation(a, θ)·(p − b) + t·b̂
//
// θ et t ne dépendent que de la profondeur relative x de la coquille (uniforme
// par objet) et de la phase de la boucle : la boucle reste parfaite, et la
// carte d'ombre (même déformation) suit exactement l'image.
//
// Natures (RIG dans gen/mesh.js) :
//   iris  : lame du diaphragme, θ = amplitude × ouverture(x) ; fermé au cœur,
//           ouvert à l'approche du passage
//   burst : éclat d'une coquille éclatée, écarté et tourné loin du passage,
//           réassemblé à l'approche
//   hinge : écaille soulevée autour de sa charnière, qui respire
//   spin  : anneau qui tourne d'un nombre entier de tours par boucle
//
// Les motifs restent attachés aux pièces : le matériau les calcule sur la
// position au repos (positionGeometry).
import {
  Fn, attribute, uniform, vec4, float, floor, fract, step, abs, cos, sin, cross, dot, normalize, length, smoothstep, mix,
  positionGeometry, normalLocal, tangentLocal, positionPrevious, varyingProperty, modelScale, log,
} from 'three/tsl';
import { G } from './globals.js';

const TAU = Math.PI * 2;

// Profondeur relative de la coquille rendue, déduite de son échelle D·kˣ.
// (Pas d'uniforme par objet : des exemplaires d'une même couche recevaient
// parfois la valeur d'un autre — un diaphragme restait alors fermé au passage.)
export const layerX = log(modelScale.x.div(G.D)).div(log(G.ratio));

// normale de tranche et direction radiale tournées avec la pièce (fragment)
export const rigBev = varyingProperty('vec4', 'vRigBev');
export const rigRadial = varyingProperty('vec3', 'vRigRadial');

// réglages d'une couche animée
export const rigUniforms = () => ({ burst: uniform(0) });
export function applyRig(U, geo) { U.burst.value = geo.burst || 0; }

// Courbes de mouvement selon la profondeur x (0 : coquille traversée)
export const irisOpen = (x) => smoothstep(1.3, 0.45, x);
export const burstSpread = (x) => smoothstep(0.25, 1.7, x).add(smoothstep(-0.5, -1.8, x).mul(0.5));

// Position déformée (et, si `full`, normale, tangente, normale de tranche et
// direction radiale : pour le matériau d'affichage ; l'ombre n'a besoin que de
// la position).
export function rigPosition(U, phase, full) {
  return Fn(() => {
    const A = attribute('rigA', 'vec4'), Bv = attribute('rigB', 'vec4');
    const kind = floor(Bv.w.add(0.001)), rnd = fract(Bv.w);
    const is = (n) => step(abs(kind.sub(n)), 0.5);
    const axis = Bv.xyz, b = A.xyz;
    // transformation de la pièce pour une profondeur x et une phase données
    const pose = (x, ph) => {
      const breath = sin(ph.mul(TAU * 2).add(rnd.mul(TAU))).mul(0.25).add(0.75);
      const lift = mix(float(0.3), float(1), smoothstep(0.6, 3.0, x)).mul(breath);
      const e = burstSpread(x);
      const theta = A.w.mul(
        is(1).mul(irisOpen(x)).add(is(2).mul(e).mul(rnd.add(0.3))).add(is(3).mul(lift)).add(is(4).mul(ph).mul(TAU)),
      );
      const t = is(2).mul(U.burst).mul(rnd.add(0.5)).mul(e);
      const c = cos(theta), s = sin(theta);
      const rot = (v) => v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(c.oneMinus()));
      return { rot, p: b.add(rot(positionGeometry.sub(b))).add(b.div(length(b).max(1e-4)).mul(t)) };
    };
    const now = pose(layerX, phase);
    const p = now.p.toVar('rigP');
    if (full) {
      const rot = now.rot;
      normalLocal.assign(rot(normalLocal));
      tangentLocal.assign(rot(tangentLocal));
      const bev = attribute('bev', 'vec4');
      rigBev.assign(vec4(rot(bev.xyz), bev.w));
      rigRadial.assign(rot(normalize(positionGeometry)));
      // position à l'image précédente (profondeur et phase d'alors) : le
      // mouvement propre des pièces entre dans les vecteurs vitesse, sinon
      // l'anticrénelage temporel garde l'image de lames qui ont déjà bougé
      positionPrevious.assign(pose(layerX.add(G.dTau), G.phasePrev).p);
    }
    return p;
  })();
}

// la couche a-t-elle des pièces animées ?
export const isRigged = (geo) => !!(geo.iris?.blades || geo.burst || geo.type === 'armillary' || geo.type === 'scales');
