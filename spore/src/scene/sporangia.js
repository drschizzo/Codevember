// Les sporanges : un gabarit par espèce (gen/sporangia.js), instancié sur les
// perles du site. L'état de chaque sporange (fruit.js : perle, levée,
// maturité, ouverture, usure, flexion) est calculé sur le CPU à chaque image et
// envoyé dans des tableaux d'uniformes (courant et précédent : vecteurs
// vitesse) ; le vertex shader replie le gabarit en perle, le dresse, l'ouvre
// selon la famille, le fléchit (poutre encastrée) et le pose sur le bois.
import * as THREE from 'three/webgpu';
import {
  Fn, If, attribute, uniformArray, uniform, float, vec2, vec3, vec4, instanceIndex, positionLocal, positionPrevious, normalLocal, positionGeometry,
  normalize, mix, smoothstep, clamp, sin, cos, abs, max as tmax, min as tmin, varying, color, hash, fract, length, pow, sqrt, select, dot, normalGeometry, normalWorld,
  normalView, positionViewDirection, normalViewGeometry,
} from 'three/tsl';
import { stableVelocity, isLite, worley, noise, NZ, ditherThreshold, perturb } from '../../../shared/scene/materials.js';

import { fruitState } from '../fruit.js';
import { nzAA } from './nz.js';

const sst = (a, b, x) => smoothstep(float(a), float(b), x);
const C = (h) => color(new THREE.Color(h));

export function createSporangia(ctx) {
  const { R, sp, S, U, Wn } = ctx;
  const tpl = S.template, D = S.dims, n = S.nBeads;
  const fam = R.family;
  // ── géométrie : gabarit + attributs d'instance ──
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tpl.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(tpl.normal, 3));
  g.setAttribute('tp', new THREE.BufferAttribute(tpl.tp, 4));
  g.setIndex(new THREE.BufferAttribute(tpl.index, 1));
  const ib0 = new Float32Array(n * 4), ib1 = new Float32Array(n * 4);
  const beads = [];
  for (let i = 0; i < n; i++) {
    const b = S.beads.subarray(i * 8, i * 8 + 8);
    beads.push({ x: b[0], z: b[1], size: b[2], delay: b[3], az: b[4], rnd: b[5], tilt: b[6], spin: b[7] });
    ib0.set([b[0], b[1], b[2], b[3]], i * 4); ib1.set([b[4], b[5], b[6], b[7]], i * 4);
  }
  g.setAttribute('ib0', new THREE.InstancedBufferAttribute(ib0, 4));
  g.setAttribute('ib1', new THREE.InstancedBufferAttribute(ib1, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);

  // ── état (CPU → uniformes) ──
  const N = Math.max(1, n);
  const mk = () => Array.from({ length: N }, () => new THREE.Vector4());
  const st = uniformArray(mk(), 'vec4'), bd = uniformArray(mk(), 'vec4');
  const stP = uniformArray(mk(), 'vec4'), bdP = uniformArray(mk(), 'vec4');

  const tp = attribute('tp', 'vec4'), a0 = attribute('ib0', 'vec4'), a1 = attribute('ib1', 'vec4');
  const part = tp.x, hy = tp.y;
  const uDew = uniform(0), uSunD = uniform(new THREE.Vector3(0, 1, 0)), uSunE = uniform(new THREE.Color());
  const vSt = varying(vec4(0), 'vSt'), vTp = varying(vec4(0), 'vTp'), vRnd = varying(float(0), 'vRnd');
  const round = fam === 'lamproderma' || fam === 'trichia' || fam === 'lycogala';
  const yc = float(round ? D.headC : D.stalkH + D.headH / 2);
  const top = float(D.top);
  const isPart = (k) => abs(part.sub(k)).lessThan(0.5);
  // (le filet : la coque, partie 3, et ses fibres, partie 7)
  const isNetP = isPart(3).or(isPart(7));
  const hsh = (x) => fract(sin(x.mul(12.9898).add(4.1)).mul(43758.5453));

  // 0. l'individu : aucun sporange n'est la copie d'un autre. Tête bosselée
  // (bruit basse fréquence de la direction, tiré par sporange), Trichia en
  // toupie (la tête s'effile vers le pied), pied cannelé et vrillé,
  // hypothallus en membrane lobée, plus large que le pied et qui rejoint
  // celle des voisins. Ne dépend pas de l'instant : calculé une fois pour les
  // deux poses (courante et précédente), avec une seule lecture de bruit.
  const shaped = (() => {
    const p0 = positionGeometry;
    const headPart = isPart(2).or(isNetP).or(isPart(4)).or(isPart(6));
    const q = p0.sub(vec3(0, yc, 0));
    const dq = normalize(q.add(vec3(0, 1e-5, 0)));
    const ang = tp.w.mul(Math.PI * 2);
    const seed = vec3(a1.y.mul(17.3), a1.w.mul(3.1), a1.x.mul(1.7));
    // (une lecture : la direction pour la tête, l'angle pour l'hypothallus)
    const at = isPart(0).select(vec3(cos(ang).mul(1.6), sin(ang).mul(1.6), a1.y.mul(9)), dq.mul(1.7).add(seed));
    const nz4 = NZ(at).level(0);
    const lump = nz4.x.mul(0.75).add(nz4.y.mul(0.25));
    const amp = fam === 'stemonitis' ? 0.05 : fam === 'lycogala' ? 0.09 : 0.075;
    let qk = q.mul(lump.mul(amp).add(1));
    if (fam === 'trichia') {
      const t = clamp(q.y.negate().div(D.headR), 0, 1).pow(1.4);
      qk = vec3(qk.x.mul(float(1).sub(t.mul(0.38))), qk.y.mul(t.mul(0.32).add(1)), qk.z.mul(float(1).sub(t.mul(0.38))));
    }
    // pied : cannelures vrillées
    const flute = cos(ang.mul(7).add(hy.mul(4)).add(a1.y.mul(20))).mul(0.1).add(1);
    const lobes = nz4.x.mul(0.5).add(1.5);
    return headPart.select(vec3(0, yc, 0).add(qk),
      isPart(1).select(vec3(p0.x.mul(flute), p0.y, p0.z.mul(flute)),
        isPart(0).select(vec3(p0.x.mul(lobes), p0.y.mul(0.7), p0.z.mul(lobes)), p0)));
  })();

  // le gabarit à la pose (s, b) d'un sporange : renvoie [position, normale] locales
  const pose = (S4, B4, write) => {
    const grow = S4.x, mature = S4.y, open = S4.z, wear = S4.w, bead = B4.z;
    let p = shaped.toVar(), nn = normalGeometry.toVar();
    // 1. le geste d'ouverture propre à la famille (sur la forme mûre)
    if (fam === 'arcyria') {
      const e = open.add(sin(open.mul(Math.PI)).mul(0.18).mul(float(1).sub(open)));
      const E = float(1).add(float(sp.expand - 1).mul(e));
      const above = tmax(p.y.sub(D.cupTop), 0);
      const isNet = isNetP;
      const ny = float(D.cupTop).add(above.mul(E));
      const rr = float(1).add(e.mul(0.28).mul(sst(D.cupTop - 0.005, D.cupTop + 0.02, p.y)));
      p.assign(isNet.select(vec3(p.x.mul(rr), ny, p.z.mul(rr)), p));
      // (filet très long d'A. obvelata : il retombe)
      const droop = float(sp.droop ?? 0).mul(e).mul(above.mul(E).div(D.headH * sp.expand).pow(2)).mul(D.headH * 1.2);
      p.assign(isNet.select(p.add(vec3(droop.mul(cos(a1.x).mul(0.35).add(0.8)), droop.mul(-0.35), droop.mul(sin(a1.x).mul(0.35)))), p));
      // péridium fugace : il s'effondre sur le calice dès l'ouverture
      const gone = sst(0.02, 0.25, open);
      p.assign(isPart(2).select(vec3(p.x.mul(float(1).sub(gone.mul(0.2))), mix(p.y, float(D.cupTop), gone), p.z.mul(float(1).sub(gone.mul(0.2)))), p));
    } else if (fam === 'stemonitis') {
      // la masse de spores part par le haut : elle s'amincit du sommet vers le pied
      const ol = clamp(open.mul(1.7).sub(float(1).sub(hy).mul(0.7)), 0, 1);
      const k2 = float(1).sub(ol.mul(0.78));
      p.assign(isPart(2).select(vec3(p.x.mul(k2), p.y, p.z.mul(k2)), p));
      // la cage reste dehors : un filet fin sur la masse, qui s'ajoure quand
      // la masse part (rentrée dans la masse puis ressortie, elle la
      // traversait et dessinait des bandes sombres sur les têtes)
    } else if (fam === 'lamproderma' || fam === 'trichia') {
      // écailles : chacune se détache à son instant, s'écarte et tombe
      const tf = hsh(tp.z.mul(97).add(a1.y.mul(31))).mul(0.55).add(0.08);
      const f = clamp(open.sub(tf).div(0.3), 0, 1);
      const dir = normalize(vec3(p.x, p.y.sub(D.headC), p.z));
      const fall = vec3(dir.x.mul(f.mul(D.headR * 0.9)), f.mul(f).mul(-D.headC * 1.1), dir.z.mul(f.mul(D.headR * 0.9)));
      p.assign(isPart(2).select(p.add(fall), p));
      if (fam === 'lamproderma') {
        // la masse sombre s'effrite au vent
        const k3 = float(1).sub(sst(0.35, 1, open).mul(0.55));
        p.assign(isNetP.select(vec3(p.x.mul(k3), float(D.headC).add(p.y.sub(D.headC).mul(k3)), p.z.mul(k3)), p));
      } else {
        // Trichia : les élatères comprimés jaillissent en houppe ronde (rebond)
        const e = open.add(sin(open.mul(Math.PI)).mul(0.22).mul(float(1).sub(open)));
        const E = float(1).add(float(sp.expand - 1).mul(e));
        const q3 = p.sub(vec3(0, D.headC, 0));
        const lifted = vec3(0, float(D.headC).add(q3.y.max(0).mul(E.sub(1)).mul(0.25)), 0);
        p.assign(isNetP.select(lifted.add(vec3(q3.x.mul(E), q3.y.mul(E), q3.z.mul(E))), p));
      }
    } else if (fam === 'lycogala') {
      // le coussin se dégonfle à mesure que les rafales l'aspirent
      const k3 = float(1).sub(sst(0.1, 1, open).mul(0.42));
      p.assign(isNetP.select(vec3(p.x.mul(k3.mul(0.5).add(0.5)), p.y.mul(k3), p.z.mul(k3.mul(0.5).add(0.5))), p));
      const k2 = float(1).sub(sst(0.2, 1, open).mul(0.16));
      p.assign(isPart(2).select(vec3(p.x, p.y.mul(k2), p.z), p));
    }
    // rosée : chaque gouttelette grossit puis sèche autour de son centre
    // (figé AVANT l'affectation de p : une expression paresseuse, relue plus
    // bas après p.assign, donnait à chaque goutte son plein rayon même sans
    // rosée ni perle — des billes d'eau blanches semées sur le bois nu, en
    // avant du front)
    const dc = p.sub(nn.mul(tp.z)).toVar();
    p.assign(isPart(6).select(dc.add(nn.mul(tp.z.mul(uDew).mul(hsh(tp.w.mul(17).add(a1.y)).mul(0.6).add(0.6)))), p));
    // 2. la levée : perle (sphère de rayon rb posée) → sporange dressé
    // (avant la condensation, la perle n'existe pas : bornée à 0,001 de son
    // volume, elle restait une bille de 10 % de son rayon — des points blancs
    // semés sur le bois nu)
    const rb = float(D.beadR).mul(tmax(bead, 1e-6).pow(1 / 3)).mul(sst(0, 0.04, bead));
    const lift = sst(0, 0.85, grow);
    const cNow = mix(rb.mul(0.78), yc, lift);                    // centre de la tête
    const m = sst(0.3, 1, grow);                                  // forme de la tête
    const isHead = isPart(2).or(isNetP).or(isPart(4)).or(isPart(6));
    const q = p.sub(vec3(0, yc, 0)).toVar(); // (figé : relu après p.assign pour la normale)
    // (perle : la tête repliée en sphère. Les pièces internes — filet, fibres,
    // columelle — restent un peu en dedans, sinon elles affleurent la même
    // sphère que le péridium et s'y battent ; chaque goutte de rosée garde sa
    // forme, posée sur la perle au-dessus de son centre)
    const inner = isNetP.or(isPart(5)).select(float(0.92), float(1));
    const qsDew = normalize(dc.sub(vec3(0, yc, 0)).add(vec3(0, 1e-5, 0))).mul(rb).add(p.sub(dc));
    const qs = isPart(6).select(qsDew, normalize(q.add(vec3(0, 1e-5, 0))).mul(rb).mul(inner));
    const headP = vec3(0, cNow, 0).add(mix(qs, q, m));
    const stemK = cNow.div(yc);
    const stemW = sst(0.05, 0.5, grow);
    const stemP = vec3(p.x.mul(stemW), p.y.mul(stemK), p.z.mul(stemW));
    const hypK = sst(0, 1, bead);
    const hypP = vec3(p.x.mul(hypK), p.y, p.z.mul(hypK));
    p.assign(isHead.select(headP, isPart(0).select(hypP, stemP)));
    nn.assign(isHead.and(isPart(6).not()).select(normalize(mix(normalize(q.add(vec3(0, 1e-5, 0))), nn, m)), nn));
    // (le pied n'est jamais une baguette : il s'arque un peu, d'un côté tiré
    // par sporange ; ses deux bouts restent en place)
    const bow = sin(hy.clamp(0, 1).mul(Math.PI)).mul(float(D.stalkH).mul(a1.y.mul(0.05).add(0.025))).mul(lift);
    p.assign(isPart(1).select(p.add(vec3(cos(a1.x.add(1.3)).mul(bow), 0, sin(a1.x.add(1.3)).mul(bow))), p));
    // 3. l'usure : le sporange vide s'effrite (rétrécit vers son pied)
    const crumble = float(1).sub(sst(0.7, 1, wear));
    p.assign(p.mul(crumble));
    // 4. taille, rotation propre
    const sz = a0.z, sp0 = a1.w;
    const cs = cos(sp0), sn = sin(sp0);
    p.assign(vec3(p.x.mul(cs).sub(p.z.mul(sn)), p.y, p.x.mul(sn).add(p.z.mul(cs))).mul(sz));
    nn.assign(vec3(nn.x.mul(cs).sub(nn.z.mul(sn)), nn.y, nn.x.mul(sn).add(nn.z.mul(cs))));
    // 5. flexion (poutre encastrée chargée en bout) : bx, bz au sommet (cm)
    // (hauteur courante du sporange ; filet détendu compris : la flexion se
    // répartit sur toute sa longueur)
    const ext = fam === 'arcyria' ? float(1).add(float((sp.expand - 1) * (D.top - D.cupTop) / D.top).mul(open)) : float(1);
    const Hn = tmax(mix(rb.mul(2), top, lift).mul(sz).mul(ext), 0.002);
    const t = clamp(p.y.div(Hn), 0, 1).toVar(); // (figé : la pente de la normale est celle d'avant la flexion)
    const shape = t.mul(t).mul(float(3).sub(t)).mul(0.5), slope = t.mul(float(2).sub(t)).mul(1.5).div(Hn);
    const isBent = isPart(0).not();
    p.assign(isBent.select(p.add(vec3(B4.x.mul(shape), shape.mul(B4.x.mul(B4.x).add(B4.y.mul(B4.y))).mul(-0.5).div(Hn), B4.y.mul(shape))), p));
    const sx = B4.x.mul(slope), sz2 = B4.y.mul(slope);
    nn.assign(isBent.select(normalize(nn.add(vec3(sx.mul(nn.y), sx.mul(nn.x).add(sz2.mul(nn.z)).negate(), sz2.mul(nn.y)))), nn));
    // 6. posé sur le bois (la même hauteur que tout le reste)
    const xw = a0.x.add(ctx.U.xoff);
    const base = vec3(xw, Wn.height(xw, a0.y), a0.y);
    if (write) { vSt.assign(S4); vTp.assign(tp); vRnd.assign(a1.y); normalLocal.assign(nn); }
    return p.add(base);
  };

  // (matériau à diffusion sous la surface : une perle jeune est une goutte de
  // protoplasme laiteux que la lumière traverse)
  const mat = new THREE.MeshSSSNodeMaterial();
  mat.positionNode = Fn(() => {
    const q = pose(st.element(instanceIndex), bd.element(instanceIndex), true);
    if (!isLite()) positionPrevious.assign(pose(stP.element(instanceIndex), bdP.element(instanceIndex), false));
    return q;
  })();
  mat.castShadowPositionNode = Fn(() => pose(st.element(instanceIndex), bd.element(instanceIndex), false))();

  // ── matières ──
  const K = sp.colors;
  const grow = vSt.x, mature = vSt.y, open = vSt.z, wear = vSt.w, P = vTp.x, hy2 = vTp.y;
  const is = (k) => abs(P.sub(k)).lessThan(0.5);
  const isNetF = is(3).or(is(7));
  const ripe = (k) => mix(mix(C(K.young), C(K.mid), sst(0, 0.4, mature)), C(k), sst(0.35, 0.85, mature));
  // couleurs par partie
  // (le pied se teinte avant la tête : sécrété d'abord, il sèche le premier)
  const stalkC = mix(C(K.young), C(K.stalk), sst(0.0, 0.5, mature));
  let headC = ripe(K.ripe);
  const netC = mix(ripe(K.net), C(K.net).mul(1.15), open);
  const hypoC = mix(C(ctx.sp.plasmodium), C(K.hypo), sst(0, 0.8, mature));
  // l'usure pâlit tout (les spores parties, le soleil)
  const pale = (c) => mix(c, c.mul(0.6).add(vec3(0.22, 0.2, 0.18)), wear.mul(0.7));
  let col = is(0).select(hypoC, is(1).or(is(5)).select(stalkC, isNetF.select(netC, is(4).select(ripe(K.ripe).mul(0.8), headC))));
  // marbrure : les têtes ne sont jamais d'une teinte unie (masse de spores
  // granuleuse, verrues du péridium)
  // (lu seulement sur la tête : nzAA, gate)
  const onHead = is(2).or(is(4));
  const mott = nzAA(positionGeometry.mul(160).add(vec3(vRnd.mul(13), 0, 0)), 0.25, 0.6, undefined, onHead).x.mul(0.16).add(nzAA(positionGeometry.mul(45), 0.25, 0.6, undefined, onHead).x.mul(0.1)).add(1);
  col = onHead.select(col.mul(mott), col);
  // Stemonitis : la masse qui fume s'éclaircit ; Arcyria : le filet détendu est un coton lumineux
  mat.colorNode = pale(col);
  const wet = float(1).sub(sst(0.1, 0.6, mature));
  // (vernis humide léger et pas tout à fait lisse : un vernis miroir reflétait
  // le studio — haut clair, horizon noir — et les perles devenaient des billes
  // de chrome ou de verre)
  mat.roughnessNode = mix(float(0.62), float(0.34), wet).add(is(1).select(float(-0.15), float(0)).mul(sp.whiteStalk ? 0 : 1)).clamp(0.25, 0.95);
  mat.clearcoatNode = wet.mul(wet).mul(0.4);
  mat.clearcoatRoughnessNode = float(0.2);
  mat.metalnessNode = float(0);
  mat.sheenNode = isNetF.select(float(1), float(0)).mul(mature);
  mat.sheenColorNode = netC;
  mat.sheenRoughnessNode = float(0.5);
  // translucidité des perles jeunes (lumière qui ressort teintée)
  // translucidité des perles jeunes ; coton du filet détendu (lumière diffusée dans les fibres)
  mat.emissiveNode = col.mul(col).mul(0.04).mul(wet).add(isNetF.select(netC.mul(netC).mul(0.08).mul(open), vec3(0)));
  // translucidité (Barré-Brisebois) : forte sur les perles et les têtes
  // jeunes, éteinte à maturité ; le pied jeune et l'hypothallus en gardent un peu
  const headF = is(2).or(is(4)).select(float(1), float(0)), thinF = is(0).or(is(1)).select(float(0.5), float(0));
  // (le coton du filet et les élatères ouverts s'allument à contre-jour)
  mat.thicknessColorNode = col.mul(wet.mul(headF.add(thinF))).mul(0.9).add(netC.mul(isNetF.select(float(0.25), float(0)).mul(open)));
  mat.thicknessDistortionNode = float(0.18);
  mat.thicknessAmbientNode = float(0.02);
  mat.thicknessAttenuationNode = float(0.9);
  mat.thicknessPowerNode = float(3);
  mat.thicknessScaleNode = float(5);
  // micro-relief : verrues du péridium (plus fortes chez Lycogala), stries du
  // pied ; rien sur les gouttes
  {
    const g = positionGeometry, rk = vec3(vRnd.mul(31), 0, 0);
    // (octaves éteintes, et non lues, sous le pixel ; les verrues lues sur la
    // tête seulement, les stries sur le pied : scene/nz.js)
    const head = is(2).or(is(4)), stalk = is(1);
    const wart = fam === 'lycogala' ? float(1).sub(nzAA(g.mul(55).add(rk), 0.25, 0.6, undefined, head).z.clamp(0, 1)).pow(3).mul(0.0035) : nzAA(g.mul(230).add(rk), 0.25, 0.6, undefined, head).x.mul(0.0004).add(nzAA(g.mul(700).add(rk), 0.25, 0.6, undefined, head).x.mul(0.00012));
    const stri = nzAA(vec3(g.x.mul(900), g.y.mul(60), g.z.mul(900)).add(rk), 0.25, 0.6, undefined, stalk).x.mul(0.00008);
    const hM = mix(float(0), wart, headF).add(mix(float(0), stri, is(1).select(float(1), float(0))));
    mat.normalNode = perturb(hM.mul(float(1).sub(wet.mul(0.6))), normalViewGeometry);
  }
  if (fam === 'lamproderma') {
    // péridium lisse et brillant (la couche mince ne se voit que dans le reflet)
    mat.roughnessNode = is(2).select(mix(float(0.3), float(0.14), mature), mat.roughnessNode);
    // couche mince du péridium : interférences (Inchaussandague et al., 2010)
    const film = sp.film;
    mat.iridescenceNode = is(2).select(sst(0.35, 0.95, mature), float(0));
    mat.specularIntensityNode = float(1);
    mat.iridescenceIORNode = float(2.0);
    mat.iorNode = float(1.45);
    mat.iridescenceThicknessNode = mix(float(film[0]), float(film[1]), hsh(vTp.z.mul(13).add(vRnd.mul(7))));
  }
  // filet : des mailles (Worley sur la surface déroulée) ; plus ouvertes quand il se détend
  let keep = null;
  const andKeep = (k) => { keep = keep ? keep.and(k) : k; };
  if (fam === 'arcyria' || fam === 'stemonitis' || fam === 'trichia') {
    const ang = vTp.w.mul(Math.PI * 2 * D.netR), yy = positionGeometry.y;
    const sc = fam === 'arcyria' ? 60 : fam === 'trichia' ? 70 : 85;
    // (Worley exact — 27 cellules — calculé sur le filet seulement : évalué
    // partout puis écarté, il coûtait à toutes les faces)
    const thread = Fn(() => {
      const t = float(9).toVar();
      If(is(3), () => { const cell = worley(vec3(ang.mul(sc), yy.mul(sc), vRnd.mul(9))); t.assign(cell.y.sub(cell.x)); });
      return t;
    })();
    // (fils le long des bords de cellules : gardés si près d'un bord ; le
    // filet serré est plein, détendu il s'ajoure)
    const w = fam === 'stemonitis' ? mix(mix(float(1.2), float(0.3), sst(0.3, 0.8, mature)), float(0.08), sst(0.1, 0.8, open)) : mix(float(1.2), float(0.2), sst(0.05, 0.7, open));
    andKeep(is(3).not().or(thread.lessThan(w)));
  }
  if (fam === 'lamproderma' || fam === 'trichia') {
    // écailles tombées : elles s'effacent en touchant le bois
    const tf = hsh(vTp.z.mul(97).add(vRnd.mul(31))).mul(0.55).add(0.08);
    const f = clamp(open.sub(tf).div(0.3), 0, 1);
    andKeep(is(2).not().or(f.lessThan(ditherThreshold(3).mul(0.25).add(0.75))));
    // l'écaille du pixel (Voronoï des germes du gabarit) : chaque copie d'un
    // quadrilatère de bord ne garde que les pixels de son écaille ; près
    // d'une frontière, la ligne de déhiscence fonce à maturité
    if (D.flakes) {
      // (Voronoï des écailles : sur le péridium seulement)
      const fl = Fn(() => {
        const o = vec3(-2, -2, 0).toVar();
        If(is(2), () => {
          const dq = normalize(positionGeometry.sub(vec3(0, D.headC, 0)));
          let bd = float(-2), sd = float(-2), bi = float(0);
          D.flakes.forEach((c, k) => {
            const v = dot(dq, vec3(...c));
            const win = v.greaterThan(bd);
            sd = win.select(bd, tmax(sd, v));
            bi = win.select(float(k), bi);
            bd = tmax(bd, v);
          });
          o.assign(vec3(bd, sd, bi));
        });
        return o;
      })();
      const bd = fl.x, sd = fl.y, bi = fl.z;
      const own = vTp.z.mul(D.flakes.length).floor();
      andKeep(is(2).not().or(abs(bi.sub(own)).lessThan(0.5)));
      const seam = float(1).sub(sst(0.004, 0.03, bd.sub(sd))).mul(sst(0.4, 0.9, mature)).mul(is(2).select(float(1), float(0)));
      mat.colorNode = mat.colorNode.mul(float(1).sub(seam.mul(0.45)));
    }
  }
  if (fam === 'lycogala') {
    // le sommet se perce : un trou irrégulier qui s'agrandit
    const nn = Fn(() => { const t = float(0).toVar(); If(is(2), () => { t.assign(worley(vec3(vTp.w.mul(9), hy2.mul(4), vRnd.mul(5))).x); }); return t; })();
    andKeep(is(2).not().or(hy2.lessThan(float(1).sub(open.mul(0.1).mul(nn.mul(0.8).add(0.6))))));
  }
  if (keep) mat.maskNode = keep;
  // gouttes d'eau : claires. On voit au travers la tête qu'elles couvrent
  // (un peu assombrie et grossie), cerclée d'un bord sombre où la goutte
  // réfléchit le fond (Fresnel), avec un reflet net et, du côté opposé au
  // soleil, la tache de lumière réfractée. (Noires, elles se lisaient comme
  // des taches de moisissure.)
  {
    const water = is(6), wF = water.select(float(1), float(0));
    const base = mat.colorNode;
    // (sans branche : une normale lue pour la première fois dans un select —
    // compilé en if/else — n'est calculée que dans une branche, et toutes les
    // autres faces s'éclairent avec une normale fausse)
    const nv = clamp(dot(normalize(normalView), positionViewDirection), 0, 1);
    const rimW = pow(float(1).sub(nv), 2.2);
    const seen = base.mul(0.8).mul(float(1).sub(rimW.mul(0.85))).add(vec3(0.015));
    mat.colorNode = mix(base, seen, wF);
    mat.roughnessNode = mix(mat.roughnessNode, float(0.02), wF);
    mat.clearcoatNode = mix(mat.clearcoatNode, float(1), wF);
    mat.sheenNode = mix(mat.sheenNode, float(0), wF);
    const em = mat.emissiveNode;
    const wE = uSunE.mul(smoothstep(0.55, 0.97, dot(normalize(normalWorld), uSunD.negate()))).mul(2.6).add(base.mul(uSunE).mul(0.25).mul(nv));
    mat.emissiveNode = mix(em, wE, wF);
  }
  mat.mrtNode = stableVelocity();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;

  const prev = [];
  return {
    meshes: [mesh],
    update(s) {
      // la rosée : déposée à l'aube sur les perles qui montent, séchée par le jour
      const dewy = { brume: 1, sousbois: 0.85, humus: 1, greve: 0.35, cedre: 0.3, brulis: 0 }[R.mood] ?? 0;
      const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      uDew.value = dewy * sm(0.45, 0.53, s) * (1 - sm(0.63, 0.72, s));
      if (ctx.stage) { uSunD.value.copy(ctx.stage.sunDir).normalize(); uSunE.value.copy(ctx.stage.sunCol).multiplyScalar(0.6); }
      for (let i = 0; i < n; i++) {
        const b = beads[i], f = fruitState(b, s, R, sp);
        stP.array[i].copy(st.array[i]); bdP.array[i].copy(bd.array[i]);
        // (une petite inclinaison propre, tirée une fois, s'ajoute à la flexion)
        const H = (D.top) * b.size * f.grow;
        st.array[i].set(f.grow, f.mature, f.open, f.wear);
        // (sur un support courbe, le sporange pousse à peu près selon la normale du bois)
        const nl = (b.z / R.site.logR) * H * 0.8;
        bd.array[i].set(f.bx + b.tilt * H * Math.cos(b.az) * 0.5, f.bz + b.tilt * H * Math.sin(b.az) * 0.5 + nl, f.bead, 0);
      }
    },
    beads, dims: D,
  };
}
