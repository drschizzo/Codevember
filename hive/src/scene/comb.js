// Le rayon : les alvéoles d'un pavage isoèdre, dessinées par instances.
//
// Une seule alvéole est cuite (gen/bake.js) : son contour à chaque instant de
// la boucle, dans une texture ; chaque instance est son image par un élément
// du groupe. Le vertex shader lit le contour à la phase locale ψ du point (la
// phase de la boucle, retardée par l'onde qui descend le rayon) et bâtit la
// paroi : face intérieure, bord roulé jusqu'à l'axe du mur (la voisine fait
// l'autre moitié). Le fond, le miel et l'opercule sont un rectangle par
// alvéole, découpé au pixel par la distance signée au contour.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, textureLoad, texture, texture3D, ivec2, int, float, vec2, vec3, vec4, floor, fract, mix, smoothstep, clamp, step, select,
  uniform, uniformArray, positionLocal, positionPrevious, normalLocal, varyingProperty, normalize, length, dot, max as tmax, min as tmin,
  normalView, exp, sin, cos, positionWorld, fwidth, transformNormalToView, cameraPosition, reflect, pow,
} from 'three/tsl';
import { noise, fbm, perturb, stableVelocity, isLite } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';

export const MAXL = 5, MAXLEG = 2; // (langues, étapes du chemin)
export const RINGS = 6; // (fond, haut de la paroi, trois crans du bord roulé, axe)

/** Uniformes du rayon (une scène) ; les textures arrivent avec la cuisson. */
export function combUniforms() {
  return {
    cell: uniform(0.07),           // taille d'une alvéole (côté du carré d'aire égale), en unités de scène
    depth: uniform(0.13),          // profondeur des alvéoles
    tilt: uniform(0.19),           // pente des alvéoles vers le haut (tan)
    edge: uniform(0.22),           // largeur de la lisière (les parois y montent de 0 à leur hauteur)
    rim: uniform(0.012),           // rayon du bord roulé
    wave: uniform(1),              // multiplicateur du retard de l'onde
    waveDir: uniform(new THREE.Vector3(0, -0.45, 0)), // ψ = u − wave·clamp(dot(p, dir.xy) + dir.z)
    RL: uniform(48), rows: uniform(96), M: uniform(96), sdfN: uniform(64),
    // par langue (chacune a son pavage) : (étapes, première rangée, demi-épaisseur des parois, retard de l'onde)
    lobeP: uniformArray(Array.from({ length: MAXL }, () => new THREE.Vector4(2, 0, 0.04, 0.3)), 'vec4'),
    relay: uniformArray(Array.from({ length: MAXL * 3 }, () => new THREE.Vector4(1, 0, 0, 0)), 'vec4'), // h⁰, h⁻¹, h⁻² par langue
    boxes: uniformArray(Array.from({ length: MAXL * MAXLEG }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4'),
    lobeBox: uniformArray(Array.from({ length: MAXL }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4'),
    // le point fixe du relais (le centre autour duquel l'alvéole tourne), par langue, dans le repère du pavage
    // cintrage de chaque langue : z = c·x² + l·x − v·x·y + o·sin(f·y + φ) — (c, l, v, o) et (f, φ)
    warpA: uniformArray(Array.from({ length: MAXL }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
    warpB: uniformArray(Array.from({ length: MAXL }, () => new THREE.Vector4(1, 0, 0, 0)), 'vec4'),
    ringC: uniformArray(Array.from({ length: MAXL }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),
    nLobes: uniform(1),
    // matières
    wax: uniform(new THREE.Color('#e9dfc4')), waxDeep: uniform(new THREE.Color('#c9a25a')), waxOld: uniform(new THREE.Color('#6e4a22')), waxGold: uniform(new THREE.Color('#d9a441')), zoning: uniform(0.75),
    honey: uniform(new THREE.Color('#c8861e')), honeyDeep: uniform(new THREE.Color('#5a2a06')), capCol: uniform(new THREE.Color('#efe6cf')),
    keyDir: uniform(new THREE.Vector3(0, 0, 1)), keyCol: uniform(new THREE.Color(1, 1, 1)), skyCol: uniform(new THREE.Color(0.2, 0.2, 0.2)), // (direction et radiance de la fenêtre, pour le reflet du miel)
    trans: uniform(0.6), sss: uniform(0.08), honeyFill: uniform(0.8),
  };
}

/** Cintrage d'une langue au point p (repère de la langue) : (z, ∂z/∂x, ∂z/∂y). */
export function warpOf(U, p, k) {
  const A = U.warpA.element(int(k.add(0.5))), B = U.warpB.element(int(k.add(0.5)));
  const ph = B.x.mul(p.y).add(B.y);
  return vec3(
    A.x.mul(p.x).mul(p.x).add(A.y.mul(p.x)).sub(A.z.mul(p.x).mul(p.y)).add(A.w.mul(sin(ph))),
    A.x.mul(p.x).mul(2).add(A.y).sub(A.z.mul(p.y)),
    A.z.mul(p.x).negate().add(A.w.mul(B.x).mul(cos(ph))),
  );
}
/** Couleur de la cire selon son âge (0 : fraîche, 1 : cœur ancien). */
export const ageRamp = (U, fresh, age) => mix(mix(fresh, U.waxGold, smoothstep(0.06, 0.5, age).mul(U.zoning.mul(0.6).add(0.4))), U.waxOld, smoothstep(0.45, 0.95, age).mul(U.zoning));
const iso = (m, p) => vec2(m.x.mul(p.x).sub(m.y.mul(p.y)).add(m.z), m.y.mul(p.x).add(m.x.mul(p.y)).add(m.w));
const isoInv = (m, p) => { const q = p.sub(m.zw); return vec2(m.x.mul(q.x).add(m.y.mul(q.y)), m.x.mul(q.y).sub(m.y.mul(q.x))); };
const ease = (x) => x.mul(x).mul(x).mul(x.mul(x.mul(6).sub(15)).add(10));

export function buildComb(U, tex, { lod = 1 } = {}) {
  const lite = isLite();
  // phase de l'image précédente, déroulée autour de la phase courante (le raccord 1 → 0 n'est pas un saut)
  const phasePrev = G.phase.sub(fract(G.phase.sub(G.phasePrev).add(0.5)).sub(0.5));
  // ── phase locale ── (k : n° de langue ; LP = lobeP[k])
  const waveAt = (p, LP) => U.wave.mul(LP.w).mul(clamp(dot(p, U.waveDir.xy).add(U.waveDir.z), 0, 1));
  // rangée de la texture pour ψ : (r0, r1, f, n)
  const rowOf = (psi, LP) => {
    const n = floor(psi), f = psi.sub(n);
    const x = f.mul(LP.x), leg = tmin(floor(x), LP.x.sub(1));
    const base = LP.y.add(leg.mul(U.RL));
    const row = base.add(ease(x.sub(leg)).mul(U.RL.sub(1)));
    const r0 = floor(row), r1 = tmin(r0.add(1), base.add(U.RL.sub(1)));
    return { r0, r1, fr: row.sub(r0), n, leg };
  };
  // bornes de l'étape où se trouve ψ
  const legLo = (psi, LP) => { const n = floor(psi); return n.add(tmin(floor(psi.sub(n).mul(LP.x)), LP.x.sub(1)).div(LP.x)); };
  const legHi = (psi, LP) => legLo(psi, LP).add(float(1).div(LP.x)).sub(1e-4);
  const relayOf = (n, k) => U.relay.element(int(k.mul(3).add(clamp(n.negate(), 0, 2)).add(0.5)));
  // deux courbes du contour au point j, à la phase ψ, dans le repère du pavage
  const curveAt = (j, psi, LP, k) => {
    const R = rowOf(psi, LP);
    const a = textureLoad(tex.curves, ivec2(int(j), int(R.r0))), b = textureLoad(tex.curves, ivec2(int(j), int(R.r1)));
    const c = mix(a, b, R.fr), h = relayOf(R.n, k);
    return vec4(iso(h, c.xy), iso(h, c.zw));
  };
  const I = attribute('iIso', 'vec4'), Lb = attribute('iLobe', 'vec4');
  const lobeBox = U.lobeBox.element(int(Lb.w));
  const LPv = U.lobeP.element(int(Lb.w)); // (paramètres du pavage de cette langue, côté sommets)
  // atlas de la langue au point p (repère de la langue) : (distance au bord, miel, opercule, âge)
  const atlasAt = (p) => {
    const uv = clamp(p.sub(lobeBox.xy).div(lobeBox.z), 0.004, 0.996); // (jamais dans la case de la langue voisine)
    return texture(tex.atlas, vec2(uv.x.add(Lb.w).div(U.nLobes), uv.y)).level(0);
  };
  // (les parois sont plus basses à la lisière, jamais nulles : une alvéole du bord est entière)
  const heightAt = (E) => U.depth.mul(smoothstep(0, U.edge, E).mul(0.68).add(0.32));
  // Une alvéole existe ou non selon sa rosette : la distance au bord se lit au centre de rotation
  // du relais, qui ne bouge pas. Le bord du rayon est donc fait d'alvéoles entières, toujours les
  // mêmes. Découpé au pixel par le contour du rayon, il entamait des alvéoles qui se déplacent :
  // on les voyait s'ouvrir et se refermer.
  const existsV = () => step(U.cell.mul(0.5), atlasAt(iso(I, U.ringC.element(int(Lb.w)).xy).mul(U.cell)).x);

  // ── parois ──
  const vWall = varyingProperty('vec4', 'vWall'); // (hauteur relative, distance au bord, cran du bord, âge)
  const wallPos = (phase, withNormal) => {
    const j = positionLocal.x, k = positionLocal.y;
    // première estimation de ψ au centre de l'instance, puis au point lui-même
    const c0 = iso(I, textureLoad(tex.curves, ivec2(int(U.M), int(LPv.y))).xy).mul(U.cell);
    // (l'étape est toujours celle de l'image courante : la position précédente,
    // qui donne le vecteur de mouvement, se lit avec la même numérotation des
    // points — sinon l'anticrénelage temporel dédouble l'alvéole à la porte)
    const psiNow = G.phase.sub(waveAt(c0, LPv));
    const psi0 = clamp(phase.sub(waveAt(c0, LPv)), legLo(psiNow, LPv), legHi(psiNow, LPv));
    const p0 = iso(I, curveAt(j, psi0, LPv, Lb.w).xy).mul(U.cell);
    // (tous les points d'une alvéole restent dans l'étape de son centre : à une
    // porte, les deux étapes décrivent la même forme mais ne numérotent pas ses
    // points pareil ; la vitesse y est nulle, la borne ne se voit pas)
    const psi = clamp(phase.sub(waveAt(p0, LPv)), legLo(psiNow, LPv), legHi(psiNow, LPv));
    const C = curveAt(j, psi, LPv, Lb.w);
    const axis = iso(I, C.xy).mul(U.cell), inner = iso(I, C.zw).mul(U.cell);
    const at = atlasAt(axis);
    // (bâti à la main : le bord des parois n'est pas à hauteur constante)
    const wob = sin(axis.x.mul(41).add(axis.y.mul(23))).mul(sin(axis.y.mul(57).sub(axis.x.mul(19)))).mul(0.035).add(sin(axis.x.mul(7.3).add(axis.y.mul(5.1)).add(Lb.w.mul(2))).mul(0.03));
    const H = heightAt(at.x).mul(wob.add(1));
    const r = tmin(U.rim, H.mul(0.5));
    // crans : 0 fond, 1 haut de paroi, 2‥5 bord roulé (30°, 60°, 90°)
    const a = clamp(k.sub(1).div(RINGS - 2), 0, 1).mul(Math.PI / 2);
    const w = float(1).sub(cos(a));
    // (hors de la langue, la paroi se réduit à une ligne : ni surface, ni ombre)
    const xy = mix(inner, axis, w);
    const z = select(k.lessThan(0.5), float(0), H.sub(r).add(r.mul(sin(a))));
    const Wp = warpOf(U, xy, Lb.w);
    const pos = vec3(xy.x.add(Lb.x), xy.y.add(Lb.y).add(z.mul(U.tilt)), z.add(Wp.x).add(Lb.z));
    if (withNormal) {
      const e = normalize(inner.sub(axis).add(vec2(1e-6, 0)));
      const nz = sin(a).add(1e-4);
      normalLocal.assign(normalize(vec3(e.mul(cos(a)).sub(Wp.yz.mul(nz)), nz))); // (la normale suit le cintrage)
      vWall.assign(vec4(z.div(U.depth), at.x, a, at.w));
    }
    return pos.mul(existsV());
  };
  // (double face : la paroi extérieure d'une alvéole du bord, sans voisine, se voit aussi de dehors)
  const wall = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide });
  wall.positionNode = Fn(() => {
    if (!lite) positionPrevious.assign(wallPos(phasePrev, false));
    return wallPos(G.phase, true);
  })();
  {
    const pw = positionWorld;
    const up = vWall.x, fresh = smoothstep(0.2, 0.0, vWall.y); // (cire fraîche de la lisière)
    const old = vWall.w;                                       // (vieille cire, vers l'attache)
    // grain : nuages larges (pollen, propolis), mouchetures, et les écailles de cire pétries
    // (chaque grain s'efface avant la fréquence du pixel : le volume de bruit n'a pas de mipmaps)
    const px = length(fwidth(pw));
    const cloud = fbm(pw.mul(7), 3), fleck = noise(pw.mul(95)).mul(smoothstep(0.5, 0.2, px.mul(95))), knead = fbm(pw.mul(34), 3).mul(smoothstep(0.25, 0.08, px.mul(34)));
    const stain = smoothstep(0.15, 0.6, cloud.add(old.mul(0.35)));
    const oldAmt = smoothstep(0.45, 0.95, old).mul(U.zoning);
    let col = ageRamp(U, mix(U.waxDeep, U.wax, smoothstep(0.05, 0.9, up).mul(0.85).add(0.15)), old);
    // la cire vieillit de l'attache vers la lisière : jaunie par le miel et le passage en haut, presque blanche en bas
    col = mix(col, col.mul(U.waxGold).mul(1.15), stain.mul(0.35).mul(fresh.oneMinus()));
    col = mix(col, U.wax.mul(1.05), fresh.mul(0.8)).mul(knead.mul(0.1).add(fleck.mul(0.04)).add(1));
    // le fond d'une alvéole est une cavité : la carte d'ombres ne la résout pas
    // (et la lumière qui y entre rebondit dans la cire : le fond est plus chaud et plus saturé, pas gris)
    const cav = smoothstep(0.12, 1.0, up);
    // (les alvéoles du cœur ancien sont des trous sombres : la vieille cire ne renvoie presque rien)
    wall.colorNode = col.mul(mix(mix(U.waxDeep.mul(0.3).add(0.02), U.waxOld.mul(0.32), oldAmt), vec3(1), cav.mul(cav))).mul(0.86);
    // le bord roulé est poli par le passage, les flancs sont mats
    const onRim = smoothstep(0.5, 1.4, vWall.z);
    wall.roughnessNode = mix(float(0.62), float(0.3), onRim).add(knead.mul(0.12)).clamp(0.12, 1);
    wall.metalnessNode = float(0);
    wall.normalNode = perturb(knead.mul(0.0011).add(fleck.mul(0.0003)).add(cloud.mul(0.0012)).mul(G.microDetail), normalView);
    // translucidité : le haut des parois, mince, laisse passer le contre-jour
    // translucidité : la cire laisse passer la lumière à travers ses parois minces
    // (terme directionnel, plus fort en haut des parois) et la diffuse en elle
    // (terme ambiant : les ombres portées sur la cire ne sont jamais grises)
    wall.thicknessColorNode = mix(U.waxDeep, U.wax, 0.32).mul(U.trans).mul(mix(float(0.45), float(1), smoothstep(0.2, 1, up))).mul(stain.mul(-0.35).add(1)).mul(oldAmt.mul(-0.85).add(1)).mul(fresh.mul(0.8).add(1));
    wall.thicknessDistortionNode = float(0.6);
    wall.thicknessAmbientNode = U.sss;
    wall.thicknessAttenuationNode = float(1);
    wall.thicknessPowerNode = float(2);
    wall.thicknessScaleNode = float(2.0);
    if (!lite) wall.mrtNode = stableVelocity();
  }

  // ── intérieur : fond, miel, opercule ──
  // un rectangle par alvéole (la boîte de l'étape), découpé par la distance signée
  const vIn = varyingProperty('vec4', 'vIn');   // (x, y dans le repère de la langue ; miel ; opercule)
  const vIso = varyingProperty('vec4', 'vIso'); // (l'isométrie de l'instance)
  const vH = varyingProperty('vec4', 'vH');     // (hauteur des parois ici, âge, z relatif, n° de langue)
  const cellState = (phase) => {
    const c0 = iso(I, textureLoad(tex.curves, ivec2(int(U.M), int(LPv.y))).xy).mul(U.cell);
    const psiNow = G.phase.sub(waveAt(c0, LPv));
    const psi = clamp(phase.sub(waveAt(c0, LPv)), legLo(psiNow, LPv), legHi(psiNow, LPv)); // (même étape que l'image courante)
    const R = rowOf(psi, LPv);
    // centre de l'alvéole (colonne M de la texture)
    const ca = textureLoad(tex.curves, ivec2(int(U.M), int(R.r0))), cb = textureLoad(tex.curves, ivec2(int(U.M), int(R.r1)));
    const cen = iso(I, iso(relayOf(R.n, Lb.w), mix(ca, cb, R.fr).xy)).mul(U.cell);
    // boîte de l'alvéole à cet instant (colonne M + 1), élargie d'un rien : le rectangle
    // ne couvre que l'alvéole, pas tout le chemin qu'elle parcourt pendant l'étape
    const ba = textureLoad(tex.curves, ivec2(int(U.M.add(1)), int(R.r0))), bb = textureLoad(tex.curves, ivec2(int(U.M.add(1)), int(R.r1)));
    const tight = vec4(tmin(ba.xy, bb.xy).sub(0.03), tmax(ba.zw, bb.zw).add(0.03));
    return { psi, R, cen, tight };
  };
  const innerPos = (phase, layer, assign) => {
    const S = cellState(phase);
    const local = mix(S.tight.xy, S.tight.zw, positionLocal.xy);
    const xy = iso(I, iso(relayOf(S.R.n, Lb.w), local)).mul(U.cell);
    const at = atlasAt(S.cen);
    // le contenu (miel, opercule) est celui de la rosette : il se lit au centre de rotation du
    // relais, qui ne bouge pas. Lu au centre de l'alvéole, qui se déplace d'une place par boucle,
    // il ferait s'ouvrir et se refermer les opercules en bordure. L'état est le même pour
    // l'alvéole et pour celle qui la remplace : la boucle reste exacte.
    const ring = atlasAt(iso(I, U.ringC.element(int(Lb.w)).xy).mul(U.cell));
    const H = heightAt(at.x);
    const cap = step(0.5, ring.z);                         // (un opercule est entier ou absent)
    const honey = tmax(ring.y, cap).mul(U.honeyFill);     // (sous un opercule, l'alvéole est pleine)
    const z = layer === 'cap' ? H.mul(0.93).mul(step(0.01, cap)) : H.mul(honey).mul(0.72);
    if (assign) {
      vIn.assign(vec4(xy, honey, cap));
      vIso.assign(I);
      vH.assign(vec4(H, at.w, z.div(U.depth), Lb.w));
    }
    // (rien à dessiner hors de la langue, ni d'opercule sans opercule)
    const keep = layer === 'cap' ? step(0.01, cap).mul(existsV()) : existsV();
    return vec3(xy.x.add(Lb.x), xy.y.add(Lb.y).add(z.mul(U.tilt)), z.add(warpOf(U, xy, Lb.w).x).add(Lb.z)).mul(keep);
  };
  // distance signée au contour (en unités d'alvéole) au point p de la langue
  const kF = floor(vH.w.add(0.5));                 // (n° de langue, côté pixels)
  const LPf = U.lobeP.element(int(kF));
  // au point p de la langue : (distance signée, ménisque, gradient du ménisque en x et y de la langue)
  const rot = (m, v) => vec2(m.x.mul(v.x).sub(m.y.mul(v.y)), m.y.mul(v.x).add(m.x.mul(v.y)));
  const fieldAt = (p, phase) => {
    const psi = phase.sub(waveAt(p, LPf));
    const R = rowOf(psi, LPf);
    const h = relayOf(R.n, kF);
    const q = isoInv(h, isoInv(vIso, p.div(U.cell)));
    const box = U.boxes.element(int(kF.mul(MAXLEG).add(R.leg).add(0.5)));
    const uv = clamp(q.sub(box.xy).div(box.z), 0, 1);
    // (une seule lecture par point : le filtrage de la texture interpole entre les deux
    // rangées ; la rangée ne dépasse jamais la dernière de son étape)
    const wz = R.r0.add(R.fr.mul(R.r1.sub(R.r0))).add(0.5).div(U.rows);
    const S = (o) => texture3D(tex.sdf, vec3(uv.add(o), wz)).level(0);
    const c = S(vec2(0, 0));
    // gradient par différences centrées à 1,5 texel : continu d'un texel à l'autre (une
    // dérivée d'écran de la texture donnerait des facettes dans le reflet)
    const e = float(1.5).div(U.sdfN);
    const g = vec2(S(vec2(e, 0)).y.sub(S(vec2(e.negate(), 0)).y), S(vec2(0, e)).y.sub(S(vec2(0, e.negate())).y)).div(e.mul(2).mul(box.z));
    return vec4(c.x, c.y, rot(vIso, rot(h, g)));
  };
  // distance au bord de la langue, au pixel (l'intérieur s'arrête à la lisière)
  const edgeAt = (p) => {
    const lb = U.lobeBox.element(int(vH.w.add(0.5)));
    const uv = clamp(p.sub(lb.xy).div(lb.z), 0.004, 0.996);
    return texture(tex.atlas, vec2(uv.x.add(floor(vH.w.add(0.5))).div(U.nLobes), uv.y)).level(0).x;
  };
  const makeInner = (layer) => {
    const m = new THREE.MeshSSSNodeMaterial({ side: THREE.FrontSide });
    m.positionNode = Fn(() => {
      if (!lite) positionPrevious.assign(innerPos(phasePrev, layer, false));
      normalLocal.assign(vec3(0, 0, 1)); // (la normale du cintrage est ajoutée au pixel)
      return innerPos(G.phase, layer, true);
    })();
    const F = fieldAt(vIn.xy, G.phase);
    const Wf = warpOf(U, vIn.xy, kF).yz;            // (pente du cintrage ici)
    const ageF = vH.y, oldF = smoothstep(0.45, 0.95, ageF).mul(U.zoning);
    const d = F.x.sub(LPf.z); // (distance à la face intérieure de la paroi)
    const dw = d.mul(U.cell);                       // en unités de scène
    const pw = positionWorld;
    const honey = vIn.z, cap = vIn.w;
    if (layer === 'cap') {
      // l'opercule se ferme du bord vers le centre, comme un iris
      const wr = fbm(pw.mul(140), 3).mul(smoothstep(0.12, 0.04, length(fwidth(pw)).mul(140)));
      m.maskNode = d.greaterThan(LPf.z.mul(-0.9)).and(cap.greaterThan(0.5));
      // bombé : l'opercule s'appuie sur les parois et se creuse à leur pied (le même champ lisse
      // que le ménisque, pente inversée), avec les plis de la cire tirée
      m.normalNode = perturb(wr.mul(0.0014).mul(G.microDetail), transformNormalToView(normalize(vec3(F.zw.mul(0.16).sub(Wf), 1))));
      const wet = smoothstep(0.1, 0.5, fbm(pw.mul(5.5), 2)).mul(0.22);
      m.colorNode = ageRamp(U, mix(U.capCol, U.wax, wr.mul(0.3).add(0.3)), ageF.mul(0.85)).mul(smoothstep(-0.02, 0.07, d).mul(0.3).add(0.7)).mul(mix(vec3(1), U.honey.mul(0.5).add(0.5), wet)).mul(0.9);
      m.roughnessNode = float(0.62).add(wr.mul(0.1));
      m.thicknessColorNode = mix(U.waxDeep, U.capCol, 0.5).mul(U.trans).mul(0.6);
    } else {
      m.maskNode = d.greaterThan(LPf.z.mul(-0.9));
      const hasHoney = smoothstep(0.02, 0.1, honey);
      // surface : le ménisque cuit (lisse), creusé en cuvette pour le fond de cire, plus
      // doucement pour le miel ; la normale vient de son gradient, dans le plan de la langue
      const amp = mix(float(0.3), float(0.2), hasHoney);
      const slope = F.zw.mul(amp);
      const ripple = noise(pw.mul(22)).mul(0.0003);
      m.normalNode = perturb(ripple.mul(hasHoney), transformNormalToView(normalize(vec3(slope.negate().sub(Wf), 1))));
      // le miel se voit par absorption : sombre où il est profond (le centre),
      // clair où il est mince (le ménisque, contre la paroi), et il laisse voir le fond
      const depthH = honey.mul(vH.x);
      const thin = smoothstep(0.25, 1.0, F.y);
      const absorb = exp(depthH.div(-0.05)).mul(0.35).add(thin.mul(0.6)).add(0.12).clamp(0, 1);
      const floorCol = ageRamp(U, mix(U.waxDeep, U.wax, 0.3), ageF).mul(mix(float(0.1), float(0.28), smoothstep(1.0, 0.3, F.y))).mul(oldF.mul(-0.2).add(1)); // (une alvéole est deux fois plus profonde que large : son fond ne reçoit presque rien)
      // (les parois font de l'ombre dans l'alvéole : plus sombre contre elles, sous le ménisque)
      const honeyCol = mix(U.honeyDeep, U.honey, absorb).mul(mix(float(0.7), float(1), smoothstep(0.0, 0.22, d)));
      m.colorNode = mix(floorCol, honeyCol, hasHoney);
      m.roughnessNode = mix(float(0.6), float(0.11), hasHoney); // (assez pour qu'une lumière parallèle n'y fasse pas un point qui scintille)
      // le reflet de la fenêtre : la lampe est une source étendue (0,3 rad), que le miel
      // creusé renvoie en une tache nette par alvéole (une lumière ponctuelle n'y laisserait
      // qu'un point, ou rien) ; Fresnel de Schlick, indice 1,49
      const Nw = normalize(vec3(slope.negate().sub(Wf), 1));
      const V = normalize(cameraPosition.sub(pw)), Rv = reflect(V.negate(), Nw);
      const win = smoothstep(Math.cos(0.46), Math.cos(0.12), dot(Rv, U.keyDir));
      const fres = float(0.039).add(float(0.961).mul(pow(float(1).sub(dot(Nw, V).clamp(0, 1)), 5)));
      const sky = U.skyCol.mul(smoothstep(-0.2, 0.9, Rv.y)).mul(fres).mul(2.5);
      m.emissiveNode = U.keyCol.mul(win.mul(win)).mul(fres).add(sky).mul(hasHoney).mul(smoothstep(0.0, 0.04, d));
      m.thicknessColorNode = mix(U.waxDeep.mul(0.9), U.honey.mul(absorb.mul(0.7).add(0.3)), hasHoney).mul(U.trans).mul(mix(oldF.mul(-0.9).add(1).mul(0.3), float(0.12), hasHoney)); // (la vieille cire est opaque : le cœur ne s'allume pas à contre-jour)
    }
    m.metalnessNode = float(0);
    m.thicknessDistortionNode = float(0.25);
    // (la cire diffuse la lumière ; le miel, limpide, non : il se voit par son reflet)
    m.thicknessAmbientNode = layer === 'cap' ? U.sss : U.sss.mul(smoothstep(0.1, 0.02, vIn.z)).mul(0.35);
    m.thicknessAttenuationNode = float(1);
    m.thicknessPowerNode = float(2);
    m.thicknessScaleNode = float(1.6);
    m.maskShadowNode = float(1).greaterThan(0.5);
    if (!lite) m.mrtNode = stableVelocity();
    return m;
  };
  return { wall, floor: makeInner('floor'), cap: makeInner('cap') };
}

/** Géométries d'instances : l'anneau de la paroi (M points × RINGS crans) et le rectangle intérieur. */
export function combGeometries(M, isoArr, lobeArr, count, step = 1) {
  const Mi = M / step;
  const pos = new Float32Array(Mi * RINGS * 3), idx = [];
  for (let k = 0; k < RINGS; k++) for (let j = 0; j < Mi; j++) { const o = (k * Mi + j) * 3; pos[o] = j * step; pos[o + 1] = k; }
  for (let k = 0; k < RINGS - 1; k++) for (let j = 0; j < Mi; j++) {
    const a = k * Mi + j, b = k * Mi + (j + 1) % Mi, c = a + Mi, d = b + Mi;
    idx.push(a, c, b, b, c, d); // (face tournée vers l'intérieur de l'alvéole)
  }
  const mk = (g) => {
    g.setAttribute('iIso', new THREE.InstancedBufferAttribute(isoArr, 4));
    g.setAttribute('iLobe', new THREE.InstancedBufferAttribute(lobeArr, 4));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    return g;
  };
  const ring = new THREE.InstancedBufferGeometry();
  ring.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ring.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  ring.setIndex(idx);
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
  quad.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  quad.setIndex([0, 1, 2, 1, 3, 2]);
  return { ring: mk(ring), quad: mk(quad) };
}
