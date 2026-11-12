// Les sporanges : un gabarit par espèce (gen/sporangia.js), instancié sur les
// perles du site. L'état de chaque sporange (fruit.js : perle, levée,
// maturité, ouverture, usure, flexion) est calculé sur le CPU à chaque image et
// envoyé dans des tableaux d'uniformes (courant et précédent : vecteurs
// vitesse) ; le vertex shader replie le gabarit en perle, le dresse, l'ouvre
// selon la famille, le fléchit (poutre encastrée) et le pose sur le bois.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniformArray, uniform, float, vec2, vec3, vec4, instanceIndex, positionLocal, positionPrevious, normalLocal, positionGeometry,
  normalize, mix, smoothstep, clamp, sin, cos, abs, max as tmax, min as tmin, varying, color, hash, fract, length, pow, sqrt, select, dot, normalGeometry,
} from 'three/tsl';
import { stableVelocity, isLite, worley, noise, ditherThreshold } from './materials.js';
import { fruitState } from '../fruit.js';

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
  const vSt = varying(vec4(0), 'vSt'), vTp = varying(vec4(0), 'vTp'), vRnd = varying(float(0), 'vRnd');
  const yc = float(fam === 'lamproderma' ? D.headC : D.stalkH + D.headH / 2);
  const top = float(D.top);
  const isPart = (k) => abs(part.sub(k)).lessThan(0.5);
  const hsh = (x) => fract(sin(x.mul(12.9898).add(4.1)).mul(43758.5453));

  // le gabarit à la pose (s, b) d'un sporange : renvoie [position, normale] locales
  const pose = (S4, B4, write) => {
    const grow = S4.x, mature = S4.y, open = S4.z, wear = S4.w, bead = B4.z;
    let p = positionGeometry.toVar(), nn = normalGeometry.toVar();
    // 1. le geste d'ouverture propre à la famille (sur la forme mûre)
    if (fam === 'arcyria') {
      const e = open.add(sin(open.mul(Math.PI)).mul(0.18).mul(float(1).sub(open)));
      const E = float(1).add(float(sp.expand - 1).mul(e));
      const above = tmax(p.y.sub(D.cupTop), 0);
      const isNet = isPart(3);
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
      // la cage n'apparaît qu'à maturité (avant, elle est dans la masse)
      const k3 = mix(float(0.8), float(1), sst(0.55, 0.95, mature));
      p.assign(isPart(3).select(vec3(p.x.mul(k3), p.y, p.z.mul(k3)), p));
    } else if (fam === 'lamproderma') {
      // écailles : chacune se détache à son instant, s'écarte et tombe
      const tf = hsh(tp.z.mul(97).add(a1.y.mul(31))).mul(0.55).add(0.08);
      const f = clamp(open.sub(tf).div(0.3), 0, 1);
      const dir = normalize(vec3(p.x, p.y.sub(D.headC), p.z));
      const fall = vec3(dir.x.mul(f.mul(D.headR * 0.9)), f.mul(f).mul(-D.headC * 1.1), dir.z.mul(f.mul(D.headR * 0.9)));
      p.assign(isPart(2).select(p.add(fall), p));
      // la masse sombre s'effrite au vent
      const k3 = float(1).sub(sst(0.35, 1, open).mul(0.55));
      p.assign(isPart(3).select(vec3(p.x.mul(k3), float(D.headC).add(p.y.sub(D.headC).mul(k3)), p.z.mul(k3)), p));
    }
    // 2. la levée : perle (sphère de rayon rb posée) → sporange dressé
    const rb = float(D.beadR).mul(tmax(bead, 0.001).pow(1 / 3));
    const lift = sst(0, 0.85, grow);
    const cNow = mix(rb.mul(0.78), yc, lift);                    // centre de la tête
    const m = sst(0.3, 1, grow);                                  // forme de la tête
    const isHead = isPart(2).or(isPart(3)).or(isPart(4));
    const q = p.sub(vec3(0, yc, 0));
    const qs = normalize(q.add(vec3(0, 1e-5, 0))).mul(rb);
    const headP = vec3(0, cNow, 0).add(mix(qs, q, m));
    const stemK = cNow.div(yc);
    const stemW = sst(0.05, 0.5, grow);
    const stemP = vec3(p.x.mul(stemW), p.y.mul(stemK), p.z.mul(stemW));
    const hypK = sst(0, 1, bead);
    const hypP = vec3(p.x.mul(hypK), p.y, p.z.mul(hypK));
    p.assign(isHead.select(headP, isPart(0).select(hypP, stemP)));
    nn.assign(isHead.select(normalize(mix(normalize(q.add(vec3(0, 1e-5, 0))), nn, m)), nn));
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
    const t = clamp(p.y.div(Hn), 0, 1);
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

  const mat = new THREE.MeshPhysicalNodeMaterial();
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
  const ripe = (k) => mix(mix(C(K.young), C(K.mid), sst(0, 0.5, mature)), C(k), sst(0.45, 1, mature));
  // couleurs par partie
  const stalkC = mix(C(K.young), C(K.stalk), sst(0.1, 0.8, mature));
  let headC = ripe(K.ripe);
  const netC = mix(ripe(K.net), C(K.net).mul(1.15), open);
  const hypoC = mix(C(ctx.sp.plasmodium), C(K.hypo), sst(0, 0.8, mature));
  // l'usure pâlit tout (les spores parties, le soleil)
  const pale = (c) => mix(c, c.mul(0.6).add(vec3(0.22, 0.2, 0.18)), wear.mul(0.7));
  let col = is(0).select(hypoC, is(1).or(is(5)).select(stalkC, is(3).select(netC, is(4).select(ripe(K.ripe).mul(0.8), headC))));
  // Stemonitis : la masse qui fume s'éclaircit ; Arcyria : le filet détendu est un coton lumineux
  mat.colorNode = pale(col);
  const wet = float(1).sub(sst(0.1, 0.6, mature));
  mat.roughnessNode = mix(float(0.62), float(0.28), wet).add(is(1).select(float(-0.3), float(0)).mul(sp.whiteStalk ? 0 : 1)).clamp(0.12, 0.95);
  mat.clearcoatNode = wet.mul(wet).mul(0.9);
  mat.clearcoatRoughnessNode = float(0.08);
  mat.metalnessNode = float(0);
  mat.sheenNode = is(3).select(float(1), float(0)).mul(mature);
  mat.sheenColorNode = netC;
  mat.sheenRoughnessNode = float(0.5);
  // translucidité des perles jeunes (lumière qui ressort teintée)
  // translucidité des perles jeunes ; coton du filet détendu (lumière diffusée dans les fibres)
  mat.emissiveNode = col.mul(col).mul(0.12).mul(wet).add(is(3).select(netC.mul(netC).mul(0.08).mul(open), vec3(0)));
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
  if (fam === 'arcyria' || fam === 'stemonitis') {
    const ang = vTp.w.mul(Math.PI * 2 * D.netR), yy = positionGeometry.y;
    const cell = worley(vec3(ang.mul(fam === 'arcyria' ? 60 : 85), yy.mul(fam === 'arcyria' ? 60 : 85), vRnd.mul(9)));
    const thread = cell.y.sub(cell.x);
    // (fils le long des bords de cellules : gardés si près d'un bord ; le
    // filet serré est plein, détendu il s'ajoure)
    const w = fam === 'arcyria' ? mix(float(1.2), float(0.2), sst(0.05, 0.7, open)) : mix(float(1.2), float(0.08), sst(0.1, 0.8, open));
    mat.maskNode = is(3).not().or(thread.lessThan(w));
  }
  if (fam === 'lamproderma') {
    // écailles tombées : elles s'effacent en touchant le bois
    const tf = hsh(vTp.z.mul(97).add(vRnd.mul(31))).mul(0.55).add(0.08);
    const f = clamp(open.sub(tf).div(0.3), 0, 1);
    mat.maskNode = is(2).not().or(f.lessThan(ditherThreshold(3).mul(0.25).add(0.75)));
  }
  mat.mrtNode = stableVelocity();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;

  const prev = [];
  return {
    meshes: [mesh],
    update(s) {
      for (let i = 0; i < n; i++) {
        const b = beads[i], f = fruitState(b, s, R, sp);
        stP.array[i].copy(st.array[i]); bdP.array[i].copy(bd.array[i]);
        // (une petite inclinaison propre, tirée une fois, s'ajoute à la flexion)
        const H = (D.top) * b.size * f.grow;
        st.array[i].set(f.grow, f.mature, f.open, f.wear);
        bd.array[i].set(f.bx + b.tilt * H * Math.cos(b.az) * 0.5, f.bz + b.tilt * H * Math.sin(b.az) * 0.5, f.bead, 0);
      }
    },
    beads, dims: D,
  };
}
