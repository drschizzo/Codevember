// Le décor : la table (ou le sol continu du cyclorama), le fond peint de
// chaque humeur, la terre du pot, le verre, l'eau.
//
// Le fond est un cyclorama complet (la caméra peut en faire le tour) : un sol
// qui se courbe en paroi, sans horizon. Chaque humeur y peint son décor —
// vitrages d'une serre, boiseries d'un cabinet, carreaux de laboratoire,
// shōji rétroéclairés, fenêtre de lune, velours — et la paroi émet une part
// de sa lumière (`wall`) : le fond n'est jamais un vide.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, attribute, positionGeometry, positionWorld, positionLocal, vec2, vec3, vec4, float, mix, smoothstep, step, abs, fract, floor,
  length, atan, sin, cos, max as tmax, min as tmin, clamp, normalView, positionViewDirection, dot, pow, mrt, Loop, int, select, sqrt, exp,
  screenUV, viewportSharedTexture,
} from 'three/tsl';
import { noise, noise2, fbm, worley, stableVelocity, isLite } from './materials.js';
import { instancedPosition } from './plant.js';

const TAU = Math.PI * 2;

// ── Fond peint ───────────────────────────────────────────────────────────────
// Rw : rayon de la paroi ; y0 : hauteur du sol
export function buildCyclorama(Rw = 8, y0 = -1, H = 11, gorge = 1.4) {
  const prof = [];
  // sol plat → gorge (quart de cercle) → paroi
  const rF = Rw - gorge;
  for (let i = 0; i <= 12; i++) { const a = (Math.PI / 2) * (i / 12); prof.push([rF + gorge * Math.sin(a), y0 + gorge * (1 - Math.cos(a)), 0]); }
  prof.push([Rw, y0 + H, 0]);
  // longueur d'arc (coordonnée v du décor : hauteur « dépliée »)
  let acc = 0;
  for (let i = 1; i < prof.length; i++) { acc += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]); prof[i][2] = acc; }
  const M = 256, pos = [], nor = [], uv = [], idx = [];
  for (let j = 0; j < prof.length; j++) {
    const [r, y, v] = prof[j];
    const a = prof[Math.max(0, j - 1)], b = prof[Math.min(prof.length - 1, j + 1)];
    const tr = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tr, ty);
    const nr = -ty / l, ny = tr / l; // (vers l'intérieur : la normale regarde le centre)
    for (let i = 0; i <= M; i++) {
      const t = (TAU * i) / M;
      pos.push(Math.cos(t) * r, y, Math.sin(t) * r);
      nor.push(0, 1, 0); // (recalculée plus bas)
      uv.push(t * Rw, y); // (abscisse le long de la paroi, hauteur)
    }
  }
  // normales : vers l'axe
  for (let k = 0; k < nor.length; k += 3) {
    const x = pos[k], z = pos[k + 2], rr = Math.hypot(x, z) || 1;
    const j = Math.floor(k / 3 / (M + 1));
    const [r0, yy] = prof[j];
    const a = prof[Math.max(0, j - 1)], b = prof[Math.min(prof.length - 1, j + 1)];
    const tr = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tr, ty);
    // normale du profil tournée vers l'intérieur et vers le haut
    let n0 = ty / l, n1 = -tr / l;
    if (n0 > 0) { n0 = -n0; n1 = -n1; }
    nor[k] = (x / rr) * n0; nor[k + 1] = Math.abs(n1); nor[k + 2] = (z / rr) * n0;
  }
  for (let j = 0; j + 1 < prof.length; j++) for (let i = 0; i < M; i++) {
    const a = j * (M + 1) + i, b = a + 1, c = a + M + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('dec', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// matériau du fond, selon le décor ; U : uniformes (couleur du fond, lumière
// de la paroi, azimut de la fenêtre…)
export function backdropMaterial(kind, U) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const d = attribute('dec', 'vec2');
  const x = d.x, y = d.y.sub(U.y0); // (y : hauteur au-dessus du sol, le long de la paroi)
  const az = atan(positionLocal.z, positionLocal.x);
  let color = vec3(U.base), emit = vec3(0), rough = float(0.9);
  const grid = (u, v, w) => { const fu = abs(fract(u).sub(0.5)).mul(2), fv = abs(fract(v).sub(0.5)).mul(2); return smoothstep(1 - w[0], 1 - w[0] * 0.6, fu).max(w[1] > 0 ? smoothstep(1 - w[1], 1 - w[1] * 0.6, fv) : float(0)); }; // (w : demi-largeurs des traits, en part de cellule)
  if (kind === 'serre') {
    // vitrages à petits bois de fonte blanche ; le ciel, plus clair en haut ;
    // en bas, la verdure de la serre, floue, traversée de lumière
    const knee = smoothstep(1.25, 1.15, y);
    const bars = grid(x.div(4.6), y.sub(1.2).div(5.6), [0.025, 0.02]).max(knee);
    const sky = mix(vec3(0.82, 0.88, 0.86), vec3(1.0, 0.99, 0.94), smoothstep(1, 14, y));
    const leaves = smoothstep(0.42, 0.62, fbm(vec3(x.mul(0.16), y.mul(0.2), 1.7), 4).add(smoothstep(9, 1.5, y).mul(0.5)).sub(0.15));
    const green = mix(vec3(0.16, 0.3, 0.1), vec3(0.42, 0.55, 0.2), noise(vec3(x.mul(0.5), y.mul(0.5), 3)).mul(0.5).add(0.5));
    const pane = mix(sky, green.mul(0.65), leaves);
    // (en bas, un muret de briques chaulées)
    const brick = grid(x.div(0.24).add(floor(y.div(0.08)).mul(0.5)), y.div(0.08), [0.06, 0.1]);
    color = mix(mix(pane.mul(0.6), vec3(0.88, 0.88, 0.85), bars), mix(vec3(0.78, 0.74, 0.68), vec3(0.6, 0.57, 0.52), brick), knee);
    emit = pane.mul(bars.oneMinus()).mul(U.wall).add(color.mul(knee).mul(U.wall).mul(0.35));
    rough = mix(float(0.1), float(0.6), bars);
  } else if (kind === 'cabinet') {
    // boiseries de noyer : panneaux moulurés, cimaise, plinthe
    const pu = fract(x.div(6.5)), pv = fract(y.sub(3.2).div(8.5));
    const frame = smoothstep(0.05, 0.035, pu).max(smoothstep(0.95, 0.965, pu)).max(smoothstep(0.04, 0.025, pv)).max(smoothstep(0.96, 0.975, pv)).max(smoothstep(3.25, 3.1, y).mul(smoothstep(2.6, 2.75, y)));
    const grain = noise(vec3(x.mul(0.15), y.mul(3), 2)).mul(0.5).add(0.5);
    const wood = mix(vec3(0.11, 0.06, 0.035), vec3(0.2, 0.12, 0.07), grain);
    color = mix(wood, wood.mul(0.55), frame).mul(smoothstep(0.0, 2.5, y).mul(0.3).add(0.7));
    emit = vec3(U.base).mul(U.wall);
    rough = mix(float(0.42), float(0.6), frame);
  } else if (kind === 'tiles') {
    // carreaux de faïence vert d'eau, joints gris ; paillasse en dessous
    const g2 = grid(x.div(1.5), y.div(1.5), [0.03, 0.03]);
    const tint = noise2(vec3(floor(x.div(1.5)), floor(y.div(1.5)), 5)).mul(0.06);
    color = mix(vec3(0.62, 0.72, 0.66).add(tint), vec3(0.42, 0.43, 0.42), g2).mul(smoothstep(0.0, 2.0, y).mul(0.4).add(0.6));
    emit = color.mul(U.wall).mul(0.35);
    rough = mix(float(0.12), float(0.8), g2);
  } else if (kind === 'shoji') {
    // shōji : papier rétroéclairé tendu sur un quadrillage (kumiko), cadre,
    // panneau de bois plein en bas (koshi-ita)
    const k = grid(x.div(2.2), y.sub(1.1).div(2.8), [0.02, 0.016]);
    const panel = grid(x.div(8.8), float(0.5), [0.012, 0]);
    const low = smoothstep(1.1, 1.0, y);
    const paper = vec3(1.0, 0.97, 0.9).mul(noise2(vec3(x.mul(6), y.mul(6), 1)).mul(0.05).add(0.95));
    const wood = vec3(0.36, 0.27, 0.18);
    const solid = k.max(panel).max(low);
    color = mix(paper.mul(0.75), wood, solid);
    emit = paper.mul(solid.oneMinus()).mul(U.wall).mul(smoothstep(18, 4, y).mul(0.5).add(0.5));
    rough = mix(float(0.9), float(0.5), solid);
  } else if (kind === 'night') {
    // mur bleu nuit, une fenêtre de lune (croisée), la lune
    const da = abs(fract(az.sub(U.winAz).div(TAU).add(0.5)).sub(0.5)).mul(TAU).mul(U.Rw);
    const inWin = smoothstep(5.2, 5.1, da).mul(smoothstep(3.0, 3.1, y)).mul(smoothstep(16, 15.9, y));
    const mull = smoothstep(0.16, 0.1, abs(da)).max(smoothstep(0.16, 0.1, abs(y.sub(10.5))));
    const sky = mix(vec3(0.1, 0.13, 0.24), vec3(0.3, 0.36, 0.52), smoothstep(3, 16, y)); // (heure bleue)
    const moon = float(0); // (pas de lune en pastille : un disque blanc collé au fond faisait décor de théâtre)
    color = mix(vec3(0.09, 0.1, 0.14).mul(noise(vec3(x.mul(0.1), y.mul(0.1), 4)).mul(0.2).add(0.9)), vec3(0.02), inWin);
    emit = sky.add(vec3(0.9, 0.92, 1.0).mul(moon).mul(4)).mul(inWin.mul(mull.oneMinus())).mul(U.wall.mul(8).add(0.5));
    rough = float(0.85);
  } else if (kind === 'velvet') {
    // velours tendu en fond de studio : noir au sol, une nappe de lumière
    // grise qui monte dans la paroi (le fond n'est jamais un vide)
    color = vec3(0.012, 0.011, 0.012);
    emit = vec3(0.05, 0.048, 0.046).mul(smoothstep(0.5, 4.5, y)).mul(smoothstep(15, 6, y)).mul(noise(vec3(x.mul(0.08), y.mul(0.08), 7)).mul(0.25).add(1));
    m.sheenNode = vec3(0.08);
    m.sheenRoughnessNode = float(0.35);
    rough = float(0.98);
  } else {
    // cyclorama blanc (Planche), ou carton gris moyen (Blossfeldt, « card ») : la teinte est celle du fond de l’humeur
    color = vec3(U.base);
    emit = vec3(U.base).mul(U.wall).mul(0.3);
    rough = float(0.95);
  }
  m.colorNode = color;
  m.emissiveNode = emit;
  m.roughnessNode = rough;
  m.metalnessNode = float(0);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Terre du pot ─────────────────────────────────────────────────────────────
// terreau sombre, mottes, gravillons, brindilles de mousse ; taches humides
// (uniformArray : x, z, rayon, intensité) plus sombres et plus brillantes
export const WET_MAX = 24;
export function soilMaterial(U) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry;
  const w = worley(p.mul(38));
  const pebble = smoothstep(0.28, 0.18, w.x).mul(step(0.62, noise2(p.mul(9).floor().add(0.5))));
  const crumb = noise2(p.mul(160)).mul(0.5).add(0.5);
  let col = mix(vec3(0.12, 0.08, 0.055), vec3(0.2, 0.14, 0.09), crumb.mul(0.6).add(noise(p.mul(6)).mul(0.25))).mul(U.peat.mul(-0.55).add(1));
  col = mix(col, vec3(0.42, 0.38, 0.34).mul(noise(p.mul(80)).mul(0.2).add(0.9)), pebble);
  const moss = smoothstep(0.55, 0.75, fbm(p.mul(3.2).add(9), 3)).mul(U.moss);
  col = mix(col, vec3(0.14, 0.22, 0.07).mul(crumb.mul(0.4).add(0.8)), moss);
  // taches humides
  const wet = Fn(() => {
    const acc = float(0).toVar();
    Loop(WET_MAX, ({ i }) => {
      const s = U.wet.element(i);
      const dd = length(p.xz.sub(s.xy)).div(tmax(s.z, 1e-4));
      acc.assign(acc.max(smoothstep(1.0, 0.55, dd.add(noise(p.mul(70)).mul(0.25))).mul(s.w)));
    });
    return acc;
  })();
  m.colorNode = col.mul(wet.mul(-0.45).add(1));
  m.roughnessNode = mix(float(0.92), float(0.35), wet).sub(pebble.mul(0.2));
  m.metalnessNode = float(0);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Paillage (akadama, gravier, sphaigne) ────────────────────────────────────
// Couleur tirée par grain (attribut `grain` : teinte, choix, tirage), grain de
// surface (piqûres de l'argile cuite, mouchetures du galet, fibres de la
// mousse), assombri et lustré là où l'eau est tombée.
export function mulchMaterial(U, kind) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const gr = attribute('grain', 'vec4'), p = positionGeometry;
  const tone = gr.x, pick = gr.y;
  let col, rough;
  if (kind === 'akadama') {
    const pits = smoothstep(0.25, 0.1, worley(p.mul(260)).x);
    col = mix(vec3(0.42, 0.2, 0.08), vec3(0.62, 0.36, 0.17), tone).mul(pits.mul(-0.35).add(1)).mul(noise(p.mul(90)).mul(0.12).add(1));
    rough = float(0.92);
  } else if (kind === 'gravel') {
    const base = mix(mix(vec3(0.36, 0.35, 0.33), vec3(0.6, 0.55, 0.47), tone), mix(vec3(0.6, 0.57, 0.52), vec3(0.2, 0.19, 0.19), step(0.5, tone)), step(0.78, pick));
    const speck = smoothstep(0.62, 0.8, noise2(p.mul(320)));
    col = base.mul(noise(p.mul(40)).mul(0.14).add(1)).mul(speck.mul(-0.4).add(1));
    rough = float(0.5);
    m.clearcoatNode = float(0.15); m.clearcoatRoughnessNode = float(0.35);
  } else if (kind === 'perlite') {
    // perlite : verre volcanique expansé, d'un blanc mat, criblé de bulles
    const pores = smoothstep(0.3, 0.12, worley(p.mul(420)).x);
    col = mix(vec3(0.6, 0.6, 0.58), vec3(0.72, 0.71, 0.69), tone).mul(pores.mul(-0.3).add(1));
    rough = float(0.95);
  } else {
    // sphaigne : têtes de mousse, vert pâle à blond, quelques pointes rougies
    const fib = smoothstep(0.3, 0.9, sin(atan(p.z.sub(gr.z), p.x).mul(23).add(noise(p.mul(120)).mul(4))).mul(0.5).add(0.5));
    col = mix(vec3(0.1, 0.2, 0.04), vec3(0.32, 0.4, 0.1), tone).mul(fib.mul(0.3).add(0.8)).mul(smoothstep(-0.005, 0.04, p.y).mul(0.6).add(0.4));
    col = mix(col, vec3(0.6, 0.25, 0.18), smoothstep(0.88, 1, pick).mul(0.6));
    rough = float(0.8);
    m.sheenNode = vec3(0.08, 0.1, 0.05); m.sheenRoughnessNode = float(0.4); // (un voile : plus fort, la mousse devenait des perles grises)
  }
  const wet = Fn(() => {
    const acc = float(0).toVar();
    Loop(WET_MAX, ({ i }) => {
      const sp = U.wet.element(i);
      acc.assign(acc.max(smoothstep(1.0, 0.55, length(p.xz.sub(sp.xy)).div(tmax(sp.z, 1e-4))).mul(sp.w)));
    });
    return acc;
  })();
  m.colorNode = col.mul(wet.mul(-0.4).add(1));
  m.roughnessNode = mix(rough, float(0.2), wet);
  m.metalnessNode = float(0);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Verre mince (cloche, caisse, burette) ────────────────────────────────────
// Une lame mince et claire : seulement ses reflets (et une légère absorption),
// sans copie de l'image ; mélange « un + (1 − α) » : les reflets s'ajoutent,
// le fond est à peine assombri. Les gouttelettes de condensation (cloche,
// caisse) accrochent la lumière.
export function glassMaterial(U, { condensation = false, graduations = false, presence = 1 } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const p = positionGeometry;
  const fres = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(5);
  let drops = float(0);
  if (condensation) {
    const c = worley(p.mul(42));
    const big = worley(p.mul(9).add(3));
    // gouttelettes : plus serrées en haut (la vitre froide), quelques grosses
    drops = smoothstep(0.2, 0.12, c.x).mul(smoothstep(0.45, 0.75, noise(p.mul(2.4)).mul(0.5).add(0.5).add(p.y.mul(0.05)))).max(smoothstep(0.12, 0.07, big.x).mul(0.6));
  }
  let tint = vec3(U.glassTint);
  if (graduations) {
    // traits de graduation (tous les 0,02 u, un plus long tous les 0,1 u)
    const g = smoothstep(0.08, 0.02, abs(fract(p.y.div(0.02)).sub(0.5)).sub(0.42));
    tint = mix(tint, vec3(0.02), g.mul(0.9));
  }
  m.colorNode = vec3(0);
  m.metalnessNode = float(0);
  m.roughnessNode = mix(float(0.02), float(0.08), drops);
  m.specularIntensityNode = float(0.32).add(drops.mul(0.5));
  // absorption (teinte) + Fresnel ; les gouttelettes diffusent un peu
  // (en gros plan, à incidence rasante, la vitre ne doit pas voiler le sujet)
  m.opacityNode = clamp(float(0.025).add(fres.mul(0.16)).add(drops.mul(0.08)), 0, 1).mul(presence);
  m.emissiveNode = tint.mul(drops.mul(U.dropGlow));
  m.mrtNode = isLite() ? null : mrt({ velocity: vec4(0), refl: vec4(0), normal: vec4(0) });
  return m;
}

// eau dans la burette : teintée, à peine opaque, ménisque brillant
export function liquidMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false });
  m.colorNode = vec3(0.55, 0.78, 0.86);
  m.roughnessNode = float(0.05);
  m.metalnessNode = float(0);
  m.opacityNode = float(0.32).add(float(1).sub(abs(dot(normalView, positionViewDirection))).pow(3).mul(0.4));
  m.mrtNode = isLite() ? null : mrt({ velocity: vec4(0), refl: vec4(0), normal: vec4(0) });
  return m;
}

// ── Eau (gouttes, perles) ────────────────────────────────────────────────────
// Une goutte est une lentille : on y voit le fond renversé et grossi (image
// d'écran lue à l'opposé de la normale), un liseré sombre au bord (réflexion
// totale), et les reflets nets des lampes et du studio par-dessus.
export function waterMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.positionNode = instancedPosition(true);
  m.castShadowPositionNode = instancedPosition(false);
  m.colorNode = vec3(0);
  m.metalnessNode = float(0);
  m.roughnessNode = float(0.03);
  m.specularIntensityNode = float(1.2);
  const nv = normalView, facing = dot(nv, positionViewDirection).abs().clamp(0, 1);
  const rim = smoothstep(0.05, 0.55, facing);
  if (isLite()) {
    m.emissiveNode = vec3(0.12, 0.15, 0.16).mul(rim);
  } else {
    // (renversement : la lentille montre ce qui est derrière, de l'autre côté)
    const uv = screenUV.sub(nv.xy.mul(vec2(-0.06, 0.06)));
    const behind = viewportSharedTexture(uv).rgb;
    m.emissiveNode = behind.mul(vec3(0.86, 0.93, 0.96)).mul(rim.mul(0.9).add(0.05));
  }
  m.mrtNode = stableVelocity();
  return m;
}
