// Le papier de guêpe : fibres de bois mâchées, déposées en bandes.
//
// Chaque sommet porte `pat` = (t, a, id, rôle) (voir gen/envelope.js). La
// couleur d'une bande vient de la table des bandes (une rangée par écaille :
// source, nuance, largeur ; le nombre de bandes de l'écaille dans l'alpha du
// premier texel) et de la palette des sources (les volets du village).
// Le relief : chaque bande est une crête basse (la pâte pressée par les
// mandibules), séparée de la suivante par un sillon fin ; des fibres au
// pixel, effacées avant la fréquence du pixel.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, textureLoad, ivec2, int, float, vec3, vec4, floor, fract, mix, smoothstep, clamp, step, abs,
  uniformArray, uniform, positionGeometry, positionLocal, atan, normalWorld, dot, normalViewGeometry, faceDirection, length, fwidth, hash, sin, max as tmax, min as tmin,
} from 'three/tsl';
import { noise, noise2, fbm, perturb, stableVelocity } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';
import { MAXB, SP } from '../gen/envelope.js';
import { nzIf } from './nz.js';

// table des bandes → texture (RGBA8, lue texel par texel)
export function bandTexture(bands, nScales) {
  const t = new THREE.DataTexture(bands, MAXB, Math.max(1, nScales), THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// L'horloge du nid, commune à toutes les cloches (core.js la règle à chaque image)
export const SEASON_U = { s: uniform(0), dry: uniform(0.004), wet: uniform(0), damp: uniform(0), frost: uniform(0) };

// Le temps fort : une écaille (hero.id) reçoit au ralenti une bande neuve, de
// g0 à g0 + w, déposée le long du bord jusqu'à l'angle aFront (0 → 1)
export const heroUniforms = () => ({ id: uniform(-1), g0: uniform(0), w: uniform(0), a: uniform(0), a0: uniform(0), wet: uniform(0), color: uniform(new THREE.Color()) });

// part : 'done' — les écailles finies et le corps, sans masque (le test de
// profondeur élimine les couches cachées) ; 'front' — les écailles en train de
// pousser (et celle du temps fort), seules à porter le masque de croissance ;
// 'all' — tout, avec le masque (la cicatrice, déchirée). Une écaille qui n'est
// pas de la part est écrasée en un point dans le vertex shader.
export function buildPaper({ bandTex, palette, nPal, hero = heroUniforms(), part = 'all' }) {
  const P = attribute('pat', 'vec4');
  const GR = attribute('grow', 'vec2');
  const code = P.w, idc = floor(code.mul(0.25).add(0.01));
  const id = idc.sub(1).max(0), role = code.sub(idc.mul(4));
  const body = step(2.5, role);
  // écaille : t au pixel (|(X, Y)| / E) et angle ; corps : (X, Y) directement
  const t = mix(abs(P.x).pow(SP).add(abs(P.y).pow(SP)).pow(1 / SP).div(P.z), P.x, body), a = mix(atan(P.x, P.y).div(Math.PI).add(0.5), P.y, body);
  // ── croissance : l'écaille est faite jusqu'à g (part de sa longueur) ; le
  // corps paraît d'un coup derrière le front (il est sous les écailles) ──
  const g = SEASON_U.s.sub(GR.x).div(GR.y).clamp(0, 1);
  const torn = step(0.0, noise(positionGeometry.mul(9)).add(noise2(positionGeometry.mul(40)).mul(0.3)).add(0.35).sub(t.mul(0.9)));
  const isHero = step(abs(id.sub(hero.id)), 0.5).mul(body.oneMinus()).mul(step(0, hero.id));
  const inStrip = step(hero.g0, t).mul(step(t, hero.g0.add(hero.w))).mul(step(hero.a0, a)).mul(step(a, hero.a.max(hero.a0))).mul(isHero);
  const heroKeep = step(t, hero.g0.add(hero.w)).mul(step(hero.a0, a)).mul(step(a, hero.a)).mul(isHero);
  const keep = mix(step(t, g.mul(1.0001)).max(heroKeep), step(GR.x, SEASON_U.s), body).mul(mix(float(1), torn, step(1.5, P.z).mul(step(2.5, role))));
  // âge de la pâte en ce point (en saison) : la bande fraîche est humide, sombre
  const age = SEASON_U.s.sub(GR.x.add(t.mul(GR.y)));
  const wet = smoothstep(SEASON_U.dry, 0, age).mul(body.oneMinus()).max(SEASON_U.wet).max(inStrip.mul(hero.wet));
  const pos = positionGeometry;
  const pf = length(fwidth(pos)); // (taille du pixel en unités : effacer ce qui est plus fin)
  const fade = (scale) => smoothstep(0.5, 0.15, pf.mul(scale)); // 1 : motif net ; 0 : sous le pixel

  // ── coordonnée de bande ──
  const row = int(id);
  const nb = textureLoad(bandTex, ivec2(int(0), row)).a.mul(255);
  // (bords de bande ondulés et fibreux : une bande n'est jamais un trait de règle)
  const tw = t.add(noise(vec3(t.mul(3.0), id.mul(0.53), 1.7)).mul(0.07)); // (largeurs inégales)
  // (les lectures du bruit ne se font que là où elles comptent : sur les
  // écailles et non sur le corps, et pas quand leur détail est sous le pixel —
  // nz.js ; le résultat est le même, sans saturer le cache de textures)
  const sc = body.oneMinus(), f260 = fade(260).mul(sc);
  const wob = noise(vec3(a.mul(3.0), id.mul(0.371), t.mul(1.2))).mul(0.9)
    .add(noise(vec3(a.mul(11.0), id.mul(0.29), t.mul(4.0))).mul(0.3))
    .add(noise2(pos.mul(55)).mul(0.16))
    .add(nzIf(pos.mul(260), f260).x.mul(0.07).mul(f260));
  const btS = tw.mul(nb).add(wob);
  // corps (feuille précédente) : bandes en anneaux autour du nid, collerette du trou en cercles serrés
  const btB = t.mul(46).add(nzIf(pos.mul(6), body).x.mul(1.3)).add(nzIf(pos.mul(55), body).y.mul(0.2));
  const bt = mix(btS, btB, body);
  const k = floor(bt), f = fract(bt);
  const tx = textureLoad(bandTex, ivec2(int(clamp(k, 0, 47)), row));
  const hb = hash(k.add(311.7).mul(7.31).add(floor(a.mul(9)).mul(0.0))); // (corps : source tirée par anneau)
  const srcS = tx.r.mul(255).add(0.5).floor(), srcB = hb.mul(nPal).floor();
  const src = int(mix(srcS, srcB, body));
  const tone = mix(tx.g, hash(k.mul(1.7).add(5.1)), body).sub(0.5);

  // bord de bande : les fibres de la charge suivante débordent sur celle-ci
  const tx2 = textureLoad(bandTex, ivec2(int(clamp(k.add(1), 0, 47)), row));
  const src2 = int(mix(tx2.r.mul(255).add(0.5).floor(), srcB, body));
  const mixN = smoothstep(0.78, 1.0, f.add(nzIf(pos.mul(340), fade(340)).x.mul(0.12).mul(fade(340))));
  const pal = mix(mix(palette.element(src), palette.element(src2), mixN.mul(0.7)), hero.color, inStrip.mul(step(0.001, hero.w)));
  // nuance de la charge (±7 %), plus sombre au bord pressé de la bande
  const press = smoothstep(0.0, 0.35, f).mul(0.06).add(0.94);
  // fibres couchées le long de la bande (la mandibule étire la pâte en
  // travers de son pas) : bruit étiré selon l'angle autour de la racine
  const ang = atan(P.x, P.y);
  const f600 = fade(600).mul(sc), f1500 = fade(1500).mul(sc), f500 = fade(500).mul(body);
  const fibA = nzIf(vec3(ang.mul(70), t.mul(nb).mul(9), id.mul(0.77)), f600).x.mul(f600);
  const fibB = nzIf(vec3(ang.mul(190), t.mul(nb).mul(26), id.mul(1.31)), f1500).y.mul(f1500);
  const fibre = mix(fibA.mul(0.6).add(fibB.mul(0.4)), nzIf(pos.mul(500), f500).x.mul(f500), body);
  const mottle = nzIf(pos.mul(160), fade(160)).x.mul(0.06).mul(fade(160));
  // grains : éclats de fibres plus clairs ou plus sombres
  const fl = nzIf(pos.mul(620), fade(620)).y;
  const speck = smoothstep(0.42, 0.7, fl).mul(0.1).sub(smoothstep(-0.42, -0.7, fl).mul(0.12)).mul(fade(620));
  // voile lent (la pâte n'est jamais uniforme)
  const veil = fbm(pos.mul(14), 3).mul(0.07);
  let col = pal.mul(tone.mul(0.14).add(1)).mul(press).mul(speck.add(1)).mul(veil.add(1)).mul(fibre.mul(0.09).add(mottle).add(1));
  // dessous et tranche : la même pâte, un peu plus sombre (moins exposée, plus fibreuse)
  col = col.mul(mix(float(1), float(0.82), step(0.5, role).mul(step(role, 1.5))));
  col = col.mul(mix(float(1), float(0.7), body)); // (le corps : la feuille d'en dessous, à l'ombre des écailles)
  // la cicatrice : un hiver de plus, délavée, grise, trouée
  const scarF = step(1.5, P.z).mul(body);
  const luma = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(luma).mul(vec3(1.0, 0.98, 0.95)), scarF.mul(0.7));
  col = col.mul(wet.mul(-0.45).add(1)); // (pâte humide : plus sombre)
  // hiver : le papier boit l'humidité (plus sombre, par plaques) ; la gelée
  // blanche prend sur les lèvres des écailles et les faces tournées vers le haut
  const dampN = smoothstep(-0.3, 0.4, nzIf(pos.mul(5), SEASON_U.damp).x.add(SEASON_U.damp.mul(1.6).sub(0.8)));
  col = col.mul(dampN.mul(SEASON_U.damp).mul(-0.5).add(1));
  const rimF = smoothstep(0.9, 1.0, t).mul(body.oneMinus()).mul(0.8).max(smoothstep(0.5, 0.95, normalWorld.y).mul(0.5));
  const frostM = smoothstep(0.45, 0.9, rimF.mul(nzIf(pos.mul(260), SEASON_U.frost).y.mul(0.6).add(0.6))).mul(SEASON_U.frost).mul(0.75);
  const glint = step(0.97, hash(floor(pos.mul(900)).dot(vec3(1, 57, 113)))).mul(frostM);
  col = mix(col, vec3(0.78, 0.82, 0.86), frostM.mul(0.6)).add(glint.mul(0.5));

  // ── relief (en unités monde) ──
  const ridge = f.mul(2).sub(1).abs().oneMinus().pow(0.6).mul(0.0006);
  const seam = smoothstep(0.1, 0.0, f).mul(-0.0004);
  const fib = fibre.mul(0.00028).add(nzIf(pos.mul(900), fade(900)).x.mul(0.00008).mul(fade(900)));
  const bump = nzIf(pos.mul(120), fade(120)).x.mul(0.00025).mul(fade(120));
  const H = ridge.add(seam).mul(fade(nb.max(1).mul(8))).add(fib).add(bump).mul(G.microDetail);
  const N0 = normalViewGeometry.mul(faceDirection);

  // papier mince : la lumière qui le traverse (contre-jour, lèvres des écailles)
  const m = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide });
  m.thicknessColorNode = col.mul(mix(float(0.35), float(0.08), body));
  m.thicknessDistortionNode = float(0.2);
  m.thicknessAmbientNode = float(0.0);
  m.thicknessAttenuationNode = float(1.0);
  m.thicknessPowerNode = float(8.0);
  m.thicknessScaleNode = float(0.8);
  m.colorNode = vec4(col, 1);
  m.roughnessNode = float(0.78).add(noise(pos.mul(40)).mul(0.08)).sub(wet.mul(0.35)).sub(SEASON_U.damp.mul(dampN).mul(0.25)).sub(frostM.mul(0.2));
  if (part !== 'done') { m.maskNode = keep.greaterThan(0.5); m.maskShadowNode = keep.greaterThan(0.5); }
  if (part !== 'all') {
    // (par sommet : toute l'écaille partage sa naissance)
    const sc = step(abs(id.sub(hero.id)), 0.5).mul(step(0, hero.id)).mul(body.oneMinus());
    const done = mix(step(GR.x.add(GR.y), SEASON_U.s).mul(sc.oneMinus()), step(GR.x, SEASON_U.s), body);
    const front = step(GR.x.add(GR.y.mul(0.03)), SEASON_U.s).mul(body.oneMinus()).mul(done.oneMinus()).max(sc);
    m.positionNode = positionLocal.mul(part === 'done' ? done : front);
  }
  m.metalnessNode = float(0);
  m.specularIntensityNode = float(0.45);
  m.normalNode = perturb(H, N0);
  m.sheenNode = vec3(0.07, 0.07, 0.065); // (faible : au contre-jour, un lustre fort blanchit tout le papier)
  m.sheenRoughnessNode = float(0.55);
  m.mrtNode = stableVelocity();
  return m;
}

// Le papier du rayon et du pétiole : la même pâte, en bandes horizontales (une
// cellule s'allonge charge après charge) ; le pétiole, verni de salive, plus
// sombre et lustré. Attributs : grow (naissance, durée), cell (h, cellule, —, rôle).
export function buildCombPaper({ palette, nPal }) {
  const GR = attribute('grow', 'vec2'), C = attribute('cell', 'vec4');
  const h = C.x, cid = C.y, role = C.w;
  const pet = step(2.5, role).mul(step(role, 3.5)), fond = step(3.5, role);
  const g = SEASON_U.s.sub(GR.x).div(GR.y).clamp(0, 1);
  const keep = mix(step(h, g.mul(1.0001)), step(GR.x, SEASON_U.s), fond); // (le pétiole aussi pousse : de la poutre vers le bas)
  const pos = positionGeometry;
  const pf = length(fwidth(pos));
  const fade = (scale) => smoothstep(0.5, 0.15, pf.mul(scale));
  // bandes : ~1,5 mm de haut, source tirée par bande et par cellule
  const k = floor(pos.y.mul(-65).add(noise(pos.mul(40)).mul(0.5)).add(noise2(vec3(pos.x.mul(3), pos.y.mul(0), pos.z.mul(3)).add(cid)).mul(0.6)));
  const src = int(hash(k.add(cid.mul(37.1))).mul(nPal).floor());
  const fl = nzIf(pos.mul(620), fade(620)).y;
  let col = palette.element(src).mul(hash(k.mul(3.1).add(cid)).sub(0.5).mul(0.12).add(1)).mul(smoothstep(0.42, 0.7, fl).mul(0.08).add(1).mul(fade(620)).add(fade(620).oneMinus()));
  col = mix(col, col.mul(0.45), pet);
  col = mix(col, col.mul(0.1), fond); // (le fond d'une cellule : au bout du tube, dans l'ombre)
  // l'œuf (rôle 5) : blanc nacré, lisse
  const egg = step(4.5, role);
  col = mix(col, vec3(0.86, 0.84, 0.76).mul(noise2(pos.mul(900)).mul(0.04).add(1)), egg);
  // (pâte fibreuse : des fibres couchées le long de la paroi, un grain)
  col = col.mul(nzIf(vec3(pos.x.mul(900), pos.y.mul(160), pos.z.mul(900)), fade(900)).x.mul(0.12).mul(fade(900)).add(noise2(pos.mul(240)).mul(0.08)).add(1));
  // (le rayon : la même pâte, un peu plus sombre que l'enveloppe — elle a été
  // mâchée plus longtemps ; parois intérieures dans l'ombre de la cellule ;
  // la lèvre, plus claire, fraîche)
  const inner = step(0.5, role).mul(step(role, 1.5)), lip = step(1.5, role).mul(step(role, 2.5));
  // (l'intérieur d'une cellule s'assombrit vers le fond : la carte d'ombres ne
  // résout pas une cellule de 5 mm, c'est l'occlusion qui la creuse)
  col = col.mul(mix(float(0.3), h.mul(h).mul(0.3).add(0.03), inner)).mul(lip.mul(0.3).add(1));
  const age = SEASON_U.s.sub(GR.x.add(h.mul(GR.y)));
  const wet = smoothstep(SEASON_U.dry, 0, age).mul(pet.oneMinus()).max(SEASON_U.wet).mul(egg.oneMinus());
  col = col.mul(wet.mul(-0.45).add(1));
  const H = nzIf(pos.mul(400), fade(400)).x.mul(0.0002).mul(fade(400)).add(fract(pos.y.mul(-65)).mul(0.0004).mul(fade(65)));
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  m.colorNode = vec4(col, 1);
  m.roughnessNode = mix(mix(float(0.88), float(0.35), pet).sub(wet.mul(0.3)), float(0.28), egg);
  m.specularIntensityNode = mix(mix(float(0.35), float(0.8), pet), float(0.7), egg);
  m.metalnessNode = float(0);
  m.normalNode = perturb(H.add(nzIf(vec3(pos.x.mul(900), pos.y.mul(160), pos.z.mul(900)), fade(900)).x.mul(0.00012).mul(fade(900))).mul(G.microDetail), normalViewGeometry.mul(faceDirection));
  m.maskNode = keep.greaterThan(0.5);
  m.maskShadowNode = keep.greaterThan(0.5);
  m.mrtNode = stableVelocity();
  return m;
}
