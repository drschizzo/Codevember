// Le plateau de Veil : le cyclorama, le socle, le voile, son cordon et sa
// bague, les lumières. Et l'orchestration des simulations (workers) :
//   1. les formes (leur sommet : hauteur de pose de la bague) et la pendaison
//      de référence H, en parallèle ;
//   2. pour chaque forme, la descente depuis H (vent compris), puis la montée
//      depuis la fin de la descente, jusqu'à H (formes en parallèle).
// update(tf, tfPrev) ne dépend que de la recette et du temps du film.
import * as THREE from 'three/webgpu';
import { Fn, If, Loop, texture3D, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, exp, pow, abs, select, uniform, positionWorld, positionLocal, fract, mix, smoothstep, vec3, vec4, float, length, uv, color as tColor, normalWorld, max, sin, cos, dot, normalize, mrt, instancedBufferAttribute } from 'three/tsl';
import { createRng } from '../../../shared/rng.js';
import { G } from '../../../shared/scene/globals.js';
import { buildPieceMaterial, finishUniforms, signature, noise, stableVelocity } from '../../../shared/scene/materials.js';
import { createVeil, SUBDIV, LACE_KINDS } from './veil.js';
import { createFine } from './fine.js';
import { createGpuCloth } from './gpucloth.js';
import { quantize } from '../gen/quant.js';
import { plinthDims, plinthCollider } from '../gen/forms.js';
import { lum } from '../recipe.js';
import { buildTimeline, locate } from '../timeline.js';
import { RC, knotDesc, smoother } from '../gen/cloth.js';
import { deq, QS } from '../gen/quant.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
export { FINE } from '../gen/fineParams.js';
import { FINE } from '../gen/fineParams.js';

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });

// réglages de la matière du voile (une dentelle de fil retors : mate, un
// lustre léger, une part de lumière qui la traverse)
export const FABRIC_LOOK = {
  dentelle: { rough: 0.7, sheen: 0.4, sheenRough: 0.55, trans: 0.4, relief: 0.5, spec: 0.5 },
};

export function createStage(scene, gen, { lite = false, renderer = null } = {}) {
  let fine = null; // (l'étage fin du GPU ; absent en version mobile)
  // la simulation grossière : sur le GPU quand il y en a un (calculée au
  // chargement, bien plus vite que le temps réel) ; sinon dans les workers
  // (gen/cloth.js, la référence). ?cpu impose les workers, pour comparer.
  const useCpu = typeof location !== 'undefined' && new URLSearchParams(location.search).has('cpu');
  const gpuCloth = !useCpu && renderer?.backend?.device ? createGpuCloth(renderer.backend.device) : null;
  let gpuTurn = Promise.resolve(); // (un morceau à la fois sur le GPU)
  const timings = {}, healths = {}; // (mise au point : ms et santé par morceau)
  // finesse de la simulation : la recette (81 × 81) sur le GPU ; 53 × 53 au
  // plus dans les workers (le CPU paierait chaque particule) ; 41 en mobile
  const simN = () => lite ? Math.min(R.sim.n, 41) : gpuCloth ? R.sim.n : Math.min(R.sim.n, 53);
  // ── Lumières (ordre fixe, au premier niveau de la scène) ──
  const key = new THREE.SpotLight(0xffffff, 100, 0, 0.5, 0.8, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 12;
  key.shadow.focus = 0.8;
  const fill = new THREE.SpotLight(0xffffff, 20, 0, 0.9, 1, 2);
  const rim = new THREE.SpotLight(0xffffff, 40, 0, 0.6, 0.9, 2);
  for (const l of [key, fill, rim]) { scene.add(l); scene.add(l.target); }

  // ── Décor ──
  const U = { bg: uniform(new THREE.Color()), bg2: uniform(new THREE.Color()), fl: uniform(new THREE.Color()), fl2: uniform(new THREE.Color()), glow: uniform(0.5), floorY: uniform(-1), win: uniform(0), winSide: uniform(1), winCol: uniform(new THREE.Color('#ffffff')) };
  const cycloMat = new THREE.MeshStandardNodeMaterial();
  {
    const p = positionWorld;
    const d = length(p.xz);
    const n = noise(p.mul(3.1)).mul(0.5).add(noise(p.mul(17.3)).mul(0.25)).add(0.5);
    const floorCol = mix(U.fl2, U.fl, n.clamp(0, 1));
    const h = p.y.sub(U.floorY);
    const wall = mix(U.bg, U.bg2, smoothstep(0.2, 3.5, h));
    const far = smoothstep(1.4, 4.2, d).max(smoothstep(0.3, 1.2, h));
    cycloMat.colorNode = mix(floorCol, wall, far);
    cycloMat.roughnessNode = mix(float(0.62), float(0.9), far);
    // le fond lointain garde sa valeur quelle que soit la lumière (la paroi
    // n'est pas un décor éclairé : c'est la couleur du film)
    // une haute fenêtre hors champ, à petits bois, dont la lumière tombe en
    // biais sur la paroi du fond (adoucie : elle est loin) ; la nuit, un clair
    // de lune à peine
    const pl = positionLocal, wx = pl.x.mul(U.winSide).sub(0.85).add(h.mul(0.3)), wy = h.sub(0.35);
    const soft = float(0.16);
    const inside = smoothstep(soft.negate(), soft, float(0.55).sub(wx.abs()).min(float(2.3).sub(wy).min(wy)));
    const gx = fract(wx.div(0.55).add(0.5)).sub(0.5).abs(), gy = fract(wy.div(0.575).add(0.5)).sub(0.5).abs();
    const bars = smoothstep(0.02, 0.09, gx.mul(0.55)).mul(smoothstep(0.015, 0.085, gy.mul(0.575)));
    const back = smoothstep(-1.0, -2.2, pl.z);
    const win = inside.mul(bars).mul(back).mul(far);
    cycloMat.emissiveNode = wall.mul(far).mul(U.glow).add(U.winCol.mul(win).mul(U.win));
    const v = stableVelocity(); if (v) cycloMat.mrtNode = v;
  }
  // ── Le cartel : une plaque de laiton vissée à la corniche du socle, qui
  // nomme l'œuvre… « momentanément absente », comme on l'affiche dans les
  // musées quand une pièce est prêtée. Il reste quand la statue s'efface. ──
  const MEDIUM = { bust: 'marbre de Carrare', torso: 'marbre, d\u2019après l\u2019antique', cat: 'bronze patiné, vers 1900', horse: 'marbre du Pentélique', teapot: 'porcelaine tendre de Sèvres', amphora: 'terre cuite, Apulie', lyre: 'érable et ivoire, d\u2019après l\u2019antique', lovers: 'pierre de Caen', muse: 'bronze poli, 1910', hands: 'plâtre d\u2019atelier', still: 'plâtre patiné', chair: 'hêtre courbé, 1859', organ: 'étain et chêne', spheres: 'granit poli', blocks: 'pierre de Volvic' };
  const TITLE = { bust: 'Buste de femme', torso: 'Torse', cat: 'Chat faisant le gros dos', horse: 'Tête de cheval', teapot: 'Verseuse', amphora: 'Cratère à volutes', lyre: 'Lyre', lovers: 'Les Amants', muse: 'Muse endormie', hands: 'Mains jointes', still: 'Nature morte', chair: 'Chaise', organ: 'Orgue positif', spheres: 'Trois sphères', blocks: 'Trois blocs' };
  function cartelTexture(kind, num) {
    const c = document.createElement('canvas'); c.width = 600; c.height = 260;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 600, 260);
    gr.addColorStop(0, '#b8955c'); gr.addColorStop(0.5, '#a98549'); gr.addColorStop(1, '#9a7840');
    g.fillStyle = gr; g.fillRect(0, 0, 600, 260);
    // brossé : des traits fins, horizontaux
    for (let i = 0; i < 260; i += 2) { g.fillStyle = `rgba(255,240,210,${0.03 + 0.04 * ((i * 7919) % 13) / 13})`; g.fillRect(0, i, 600, 1); }
    g.strokeStyle = 'rgba(60,40,20,0.55)'; g.lineWidth = 3; g.strokeRect(14, 14, 572, 232);
    g.fillStyle = '#2e2216'; g.textAlign = 'center';
    g.font = '300 50px Fraunces, Georgia, serif';
    g.fillText(TITLE[kind] ?? kind, 300, 96);
    g.font = 'italic 300 30px Fraunces, Georgia, serif';
    g.fillText(MEDIUM[kind] ?? '', 300, 142);
    g.font = '300 22px Fraunces, Georgia, serif';
    g.fillText(`inv. ${num}`, 300, 180);
    g.font = 'italic 300 24px Fraunces, Georgia, serif';
    g.fillText('œuvre momentanément absente', 300, 222);
    // les deux vis
    for (const x of [34, 566]) { g.fillStyle = '#6d5530'; g.beginPath(); g.arc(x, 130, 9, 0, 6.3); g.fill(); g.strokeStyle = '#3a2c18'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 6, 130); g.lineTo(x + 6, 130); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  const cartelMat = new THREE.MeshStandardNodeMaterial({ metalness: 0.75, roughness: 0.42 });
  const cartel = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.046, 0.0016), cartelMat);
  cartel.castShadow = true; cartel.receiveShadow = true; cartel.visible = false;
  scene.add(cartel);
  let cartelTex = [], cartelK = -1;
  function placeCartel() {
    cartelTex.forEach((t) => t.dispose()); cartelTex = []; cartelK = -1;
    const P = R.plinth, D = plinthDims(P);
    // (une face plane à hauteur de corniche : le dé, le bloc ; pas les socles ronds)
    const top = D.parts[0];
    if (top.t !== 'box') { cartel.visible = false; return; }
    const n = Math.floor(1000 + (parseInt(String(R.seed).replace(/\D/g, '') || '7', 10) * 37) % 8000);
    cartelTex = R.forms.map((f, i) => cartelTexture(f.kind, `${n + i * 13}`));
    // la face la plus tournée vers la caméra
    const az = R.camera.az, faces = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let best = faces[0], bd = -2;
    for (const f of faces) { const d = f[0] * Math.sin(az) + f[1] * Math.cos(az); if (d > bd) { bd = d; best = f; } }
    const ext = best[0] ? top.h[0] : top.h[2];
    cartel.position.set(best[0] * (ext + 0.0009), top.h[1] > 0.05 ? -0.05 : top.c[1], best[1] * (ext + 0.0009)); // (sur un bloc, près du haut)
    cartel.rotation.set(0, Math.atan2(best[0], best[1]), 0);
    cartel.scale.setScalar(Math.min(1, (top.h[1] * 2 - 0.01) / 0.046));
    cartel.visible = true;
  }
  // ── La poussière : des grains en suspension, visibles seulement dans le
  // faisceau de la lampe principale ; chacun tourne sur une petite boucle
  // fermée (un et deux tours par film), si bien que la boucle reste exacte ──
  const D = { pos: uniform(new THREE.Vector3()), dir: uniform(new THREE.Vector3(0, -1, 0)), cos: uniform(0.9), soft: uniform(0.05), col: uniform(new THREE.Color()), lux: uniform(0) };
  let dust;
  {
    const NM = 380, rd = createRng('veil:poussiere');
    const base = new Float32Array(NM * 3), ph = new Float32Array(NM * 3);
    for (let i = 0; i < NM; i++) {
      { const a = rd.range(0, 6.283), r = 0.6 * Math.sqrt(rd.next()); base.set([Math.cos(a) * r, rd.range(-0.05, 1.1), Math.sin(a) * r], i * 3); } // (autour du sujet : au loin, sur le fond, la poussière se lisait comme du bruit)
      ph.set([rd.range(0, 6.283), rd.range(0, 6.283), rd.range(0, 1)], i * 3);
    }
    const b = instancedBufferAttribute(new THREE.InstancedBufferAttribute(base, 3)), q = instancedBufferAttribute(new THREE.InstancedBufferAttribute(ph, 3));
    const t = G.phase.mul(2 * Math.PI);
    const ctr = b.add(vec3(sin(t.add(q.x)).mul(0.05), sin(t.mul(2).add(q.y)).mul(0.03), cos(t.add(q.x)).mul(0.05)));
    const sm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    sm.positionNode = ctr;
    sm.scaleNode = float(0.0022).add(q.z.mul(0.0018));
    const disc = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
    const inBeam = smoothstep(D.cos.sub(D.soft), D.cos, dot(normalize(ctr.sub(D.pos)), D.dir));
    sm.colorNode = vec3(D.col).mul(D.lux).mul(inBeam).mul(disc).mul(q.z.mul(0.6).add(0.4));
    sm.opacityNode = disc;
    sm.mrtNode = mrt({ velocity: vec4(0) });
    dust = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sm);
    dust.count = NM; dust.frustumCulled = false; dust.renderOrder = 4;
    dust.castShadow = dust.receiveShadow = false;
    scene.add(dust);
  }
  // ── L'hologramme : la statue absente luit par à-coups sous le linge qui
  // vient de la couvrir, comme un signal instable, puis s'éteint (idée de
  // l'utilisateur : « ça aiderait à vraiment réaliser la forme »). C'est un
  // modèle détaillé de l'objet (gen/forms.js : show), cuit en champ de distance
  // dans un volume de 4 mm sur 8 bits et marché par rayon dans sa boîte :
  // liseré de Fresnel, lignes de balayage, et une bande claire qui le parcourt
  // une fois de haut en bas. Il ne se voit QUE sous le voile : le fragment
  // écrit la profondeur du point touché et ne passe que si quelque chose (un
  // fil de dentelle) est devant lui. La bande éclaire aussi la dentelle
  // qu'elle longe (scene/veil.js lit le même volume).
  const HO = { org: uniform(new THREE.Vector3()), size: uniform(new THREE.Vector3(1, 1, 1)), n: uniform(new THREE.Vector3(2, 2, 2)), amp: uniform(0), scan: uniform(0), col: uniform(new THREE.Color('#7fd0ff')), t: uniform(0), gl: uniform(0), gs: uniform(0) };
  const holoBlank = new THREE.Data3DTexture(new Uint8Array(8).fill(255), 2, 2, 2);
  holoBlank.format = THREE.RedFormat; holoBlank.needsUpdate = true;
  const holoT = texture3D(holoBlank);
  // distance à la statue en un point q ∈ [0, 1]³ de sa boîte (centre des texels)
  // (8 bits codés en racine, fins près de la surface : d = 0,1 e |e|, e = 1,5 v − 0,5)
  const holoSd = (q) => { const e = holoT.sample(q.mul(HO.n.sub(1)).add(0.5).div(HO.n)).level(0).r.mul(1.5).sub(0.5); return e.mul(abs(e)).mul(0.1); };
  const HOLO = { U: HO, sd: holoSd };
  let holoTex = [], holoK = -1;
  const holoMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, premultipliedAlpha: true });
  holoMat.depthFunc = THREE.GreaterDepth;
  {
    const rnd = (x) => fract(sin(x.mul(12.9898)).mul(43758.5453));
    const res = Fn(() => {
      const o = vec4(0).toVar(); // (rgb, profondeur du point touché ; 0 : rien)
      If(HO.amp.greaterThan(0.002), () => {
        const rd = normalize(positionWorld.sub(cameraPosition)).toVar();
        // (parasites : par instants, des tranches horizontales se décalent)
        const sl = positionWorld.y.mul(38).floor(), r1 = rnd(sl.add(HO.gs.mul(7.31)));
        const shift = select(r1.greaterThan(0.72), rnd(sl.mul(1.7).add(HO.gs)).sub(0.5).mul(0.07), float(0)).mul(HO.gl);
        const ro = positionWorld.add(vec3(shift, 0, 0)).toVar();
        const t = float(0.002).toVar(), hit = float(0).toVar();
        Loop(72, () => {
          If(hit.lessThan(0.5), () => {
            const q = ro.add(rd.mul(t)).sub(HO.org).div(HO.size).toVar();
            If(q.x.lessThan(0).or(q.y.lessThan(0)).or(q.z.lessThan(0)).or(q.x.greaterThan(1)).or(q.y.greaterThan(1)).or(q.z.greaterThan(1)), () => { hit.assign(2); }).Else(() => {
              const d = holoSd(q).toVar();
              If(d.lessThan(0.0007), () => { hit.assign(1); }).Else(() => { t.addAssign(d.max(0.0012)); });
            });
          });
        });
        If(hit.greaterThan(0.5).and(hit.lessThan(1.5)), () => {
          const p = ro.add(rd.mul(t)).toVar(), q = p.sub(HO.org).div(HO.size).toVar();
          const e = vec3(0.004).div(HO.size);
          const g = vec3(holoSd(q.add(vec3(e.x, 0, 0))).sub(holoSd(q.sub(vec3(e.x, 0, 0)))), holoSd(q.add(vec3(0, e.y, 0))).sub(holoSd(q.sub(vec3(0, e.y, 0)))), holoSd(q.add(vec3(0, 0, e.z))).sub(holoSd(q.sub(vec3(0, 0, e.z)))));
          const nrm = normalize(g.add(vec3(0, 1e-5, 0)));
          const fres = pow(float(1).sub(abs(dot(nrm, rd))), 2.4);
          const lines = sin(p.y.mul(1100).add(HO.t.mul(7))).mul(0.5).add(0.5).pow(2);
          const band = exp(abs(p.y.sub(HO.scan)).mul(-42));
          const a = float(0.1).add(fres.mul(0.9)).add(lines.mul(0.045)).add(band.mul(0.8)).mul(HO.amp).clamp(0, 1.4);
          const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p.sub(vec3(shift, 0, 0)), 1));
          o.assign(vec4(HO.col.mul(a).mul(2.0), clip.z.div(clip.w).clamp(1e-6, 1)));
        });
      });
      return o;
    });
    // (deux sorties : la couleur, et la profondeur qui décide si le fragment passe)
    const R4 = res();
    holoMat.colorNode = R4.xyz;
    holoMat.opacityNode = select(R4.w.greaterThan(0), float(0.42), float(0)).mul(HO.amp.clamp(0, 1));
    holoMat.depthNode = R4.w;
    holoMat.mrtNode = mrt({ velocity: vec4(0) });
  }
  const holo = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), holoMat);
  holo.frustumCulled = false; holo.renderOrder = 3; holo.castShadow = holo.receiveShadow = false;
  scene.add(holo);
  // volumes des formes de la scène (cuits dans les workers : gen/worker.js, « show »)
  function setHolo(k, f) {
    holoTex[k]?.tex.dispose();
    const [mx, my, mz] = f.dims;
    const tex = new THREE.Data3DTexture(f.D, mx, my, mz);
    tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1; tex.needsUpdate = true;
    holoTex[k] = { tex, org: f.origin, size: [(mx - 1) * f.h, (my - 1) * f.h, (mz - 1) * f.h], n: [mx, my, mz] };
    if (holoK === k) holoK = -1;
  }
  // l'hologramme au temps du film : il s'allume 0,35 s après la pose et dure
  // 2,6 s, par à-coups — instable au début et à la fin, presque tenu au
  // milieu ; tout découle du temps local (la boucle reste exacte)
  const rnd1 = (x) => { const v = Math.sin(x * 127.1) * 43758.5453; return v - Math.floor(v); };
  function holoAt(tf) {
    const { seg, local } = locate(TL, tf), Td = R.timing.desc;
    if (seg.kind !== 'desc') return null;
    const u = local - (Td.pre + Td.lower + 0.35), dur = Math.min(2.6, Td.settle - 0.6);
    if (u <= 0 || u >= dur) return null;
    const env = smoother(u / 0.25) * (1 - smoother((u - (dur - 0.5)) / 0.5));
    const slot = Math.floor(u * 16) + seg.k * 31, mid = Math.sin((Math.PI * u) / dur);
    const on = rnd1(slot) < 0.3 + 0.68 * mid * mid;
    return { k: seg.k, u, dur, amp: env * (on ? 0.72 + 0.28 * rnd1(slot * 3.1) : 0.04), gl: rnd1(slot * 5.7) > 0.7 ? 1 : 0, gs: slot };
  }
  const cyclo = new THREE.Mesh(new THREE.BufferGeometry(), cycloMat);
  cyclo.receiveShadow = true;
  scene.add(cyclo);
  const plinth = new THREE.Mesh(new THREE.BufferGeometry());
  plinth.castShadow = plinth.receiveShadow = true;
  plinth.visible = false;
  scene.add(plinth);
  let plinthFin = null;

  // cordon et bague
  // (cordon de soie torse de 3 mm, sombre : la cause du geste doit se voir)
  const cordMat = new THREE.MeshStandardNodeMaterial({ color: '#3a2a22', roughness: 0.6 });
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 1, 10, 1).translate(0, 0.5, 0), cordMat);
  cord.castShadow = true;
  const ringMat = new THREE.MeshPhysicalNodeMaterial({ color: '#e8cf8e', metalness: 1, roughness: 0.22 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0032, 12, 40).rotateX(Math.PI / 2), ringMat);
  ring.castShadow = true;
  scene.add(cord, ring);
  // pose « hamac » (simulation GPU) : quatre cordons, un par coin
  const cords4 = [0, 1, 2, 3].map(() => { const c = new THREE.Mesh(cord.geometry, cordMat); c.castShadow = true; c.visible = false; scene.add(c); return c; });
  const corners = gpuCloth && !new URLSearchParams(location.search).has('center') ? 'corners' : 'center';

  let R = null, veil = null, data = null, TL = null, version = 0;
  let total = 1, done = 0, failed = null;
  const prog = new Map(); // (avancement des morceaux en cours)

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    TL = buildTimeline(R);
    data = null; failed = null;
    const n = simN();
    if (!veil || veil.n !== n) {
      if (veil) { scene.remove(veil.group); veil.dispose(); }
      fine?.dispose(); fine = null;
      if (!lite && renderer?.backend?.device) fine = createFine(renderer, n, SUBDIV);
      veil = createVeil(n, fine, HOLO);
      scene.add(veil.group);
    }
    veil.group.visible = false;
    syncLook();
    // décor
    placeCartel();
    const P = R.plinth;
    gen.request({ y: -P.height }, 'cyclo').then((o) => { if (v !== version) return; cyclo.geometry.dispose(); cyclo.geometry = toGeometry(o); }).catch((e) => console.error(e));
    gen.request(P, 'plinth').then((o) => {
      if (v !== version) return;
      plinth.geometry.dispose(); plinth.geometry = toGeometry(o);
      const fk = signature(R.plinthFinish);
      if (!plinthFin || plinthFin.key !== fk) {
        plinth.material?.dispose?.();
        plinthFin = { key: fk, U: finishU(R.plinthFinish), M: { seedOff: uniform(new THREE.Vector3(3, 1, 7)) } };
        plinth.material = buildPieceMaterial(R.plinthFinish, plinthFin.U, plinthFin.M);
      }
      plinth.visible = true;
    }).catch((e) => console.error(e));
    simulateAll(v).catch((e) => { if (v === version) { failed = e; console.error(e); } });
  }

  // ── Les simulations ──
  async function simulateAll(v) {
    // (version mobile : un voile plus grossier, environ trois fois moins de calcul)
    const n = simN(), sub = lite ? Math.min(R.sim.sub, 360) : R.sim.sub;
    const L = R.veil.L, fabric = R.fabric, fps = R.sim.fps;
    const N = R.forms.length;
    // avancement : pendaison 1, puis descente 3 et montée 2 par forme (≈ temps de calcul)
    total = 1 + N * 5; done = 0; prog.clear();
    const track = (id, w) => (p) => prog.set(id, p * w);
    const finish = (id, w) => { prog.delete(id); done += w; };
    const key = (o) => `${R.seed}|${JSON.stringify(o)}`;
    const wa = R.wind.az;
    const wind = R.wind.speed > 0 ? { dir: [-Math.sin(wa), -0.05, -Math.cos(wa)], speed: R.wind.speed, breath: R.wind.breath, phase: R.wind.phase } : null;
    const wet = R.wind.wet ?? 0;
    const plinthSpec = R.plinth;
    const floorY = -R.plinth.height;

    // un morceau : sur le GPU (au tour de chacun) ou dans un worker
    const runCloth = (spec, big, id, wgt, sdf) => {
      if (!gpuCloth) { const { cornerAt, ...rest } = big; void cornerAt; return gen.request({ ...spec, ...rest }, 'cloth', track(id, wgt), { key: key({ ...spec, H: 'h' + R.veil.rot }), cache: false }).then((r) => { finish(id, wgt); return r; }); }
      // (au-delà de la descente 0, le film joue déjà : le calcul se règle sur
      // l'avance qu'il a sur la lecture, en secondes)
      // (au-delà de la descente 0, le film joue déjà : débit de calcul à tenir,
      // en sous-pas par seconde, pour que ce morceau et tous les suivants
      // soient prêts avant que la lecture ne les atteigne, avec 1 s de marge)
      const order = TL.segs.map((q) => q), idx = id[0] === 'h' ? -1 : order.findIndex((q) => q.kind === (id[0] === 'd' ? 'desc' : 'rise') && q.k === +id.slice(1));
      const pace = idx > 0 && !new URLSearchParams(location.search).has('nopace') ? (rem) => { // (?nopace : à pleine vitesse, pour les mesures panneau masqué)
        const T = TL.total, tf = G.phase.value * T;
        let cum = rem, rate = 0;
        for (let j = idx; j < order.length; j++) {
          if (j > idx) cum += Math.round(order[j].dur * sub);
          const lead = Math.max(0.3, ((((order[j].t0 - tf) % T) + T) % T) - 1.0);
          rate = Math.max(rate, cum / lead);
        }
        return rate;
      } : null;
      // Un morceau à la fois, et seulement pour la scène en cours : une scène
      // demandée entre-temps arrête le calcul de l'ancienne au sous-pas près
      // (alive) au lieu d'attendre derrière lui. Un morceau malsain (valeur
      // non finie, point hors de la boîte, fil démesuré) est repris une fois,
      // plus amorti, sans les vitesses de départ ; on garde le meilleur.
      const alive = () => v === version;
      const attempt = (safe) => gpuCloth.simulate({ ...spec, ...big, ...(safe ? { startVel: null } : {}), sdf, pace, quantized: true, safe, alive }, track(id, wgt));
      const run = gpuTurn.then(async () => {
        if (!alive()) return null;
        let r = await attempt(false);
        if (r && !r.health.ok) {
          console.warn(`veil : morceau ${id} malsain, repris`, r.health);
          const r2 = await attempt(true);
          if (r2 && (r2.health.ok || (r2.health.bad < 0 && (r.health.bad >= 0 || r2.health.stretch < r.health.stretch)))) r = r2;
          if (r) r.retried = true;
        }
        return r;
      });
      gpuTurn = run.catch(() => {});
      return run.then((r) => { finish(id, wgt); if (r) { timings[id] = Math.round(r.ms); healths[id] = r.health; } return r && { ...r, frames: r.frames instanceof Int16Array ? r.frames : quantize(r.frames) }; });
    };
    // la pose « hamac » : les quatre coins tenus sur un cercle de rayon RA,
    // dans la direction qu'ils ont sur le voile à plat (tourné de rot)
    const RA = 0.42, cr = Math.cos(R.veil.rot), sr = Math.sin(R.veil.rot);
    const ring = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, w]) => { const x = cr * u - sr * w, z = sr * u + cr * w, l = Math.hypot(x, z); return [(x / l) * RA, (z / l) * RA]; });
    const pose = corners === 'corners' ? { pins: 'corners', rot: R.veil.rot } : {};
    const hangSpec = { mode: 'hang', n, L, fabric, seed: R.seed, rot: R.veil.rot, T: { total: 3.5 }, floorY: -10, sub, fps, wet, ...pose };
    // (les coins partent du voile à plat et rejoignent le cercle en 1 s)
    const R0 = (L / 2) * Math.SQRT2;
    const hangBig = corners === 'corners' ? { cornerAt: (t, c) => { const f = 1 + (R0 / RA - 1) * (1 - smoother(Math.min(1, t))); return [ring[c][0] * f, 0, ring[c][1] * f, 2]; } } : {};
    const [hang, ...tops] = await Promise.all([
      runCloth(hangSpec, hangBig, 'h', 1, null),
      ...R.forms.map((f) => gen.request(f, 'form')),
    ]);
    if (v !== version || !hang) return;
    let lowest = 0;
    for (let k = 0; k < hang.N; k++) lowest = Math.min(lowest, hang.final[k * 3 + 1]);
    // (la pendaison passe 8 cm au-dessus du point le plus haut de toutes les
    // formes, même loin de l'axe : une tête inclinée monte plus haut à côté)
    const yTop = Math.max(...tops.map((t) => Math.max(t.top, t.box[4] - 0.04)));
    const yH = yTop + RC - lowest + 0.08;
    const H = hang.final.slice();
    for (let k = 0; k < hang.N; k++) H[k * 3 + 1] += yH;
    const segs = new Map();
    const Td = R.timing.desc, Tr = R.timing.rise;
    // les morceaux s'enchaînent : la descente k part de la fin de la montée
    // k − 1 (positions et vitesses), et seule la dernière montée est ramenée
    // sur H ; le voile ne se recale qu'une fois par boucle, et doucement
    const NF = R.forms.length;
    let prev = { final: H, vel: null };
    // (le film commence dès que la descente 0 est prête : les morceaux
    // suivants se calculent pendant qu'il joue, environ quatre fois plus
    // vite que le temps réel ; la page retient la phase si elle les rattrape)
    data = { H, yH, tops: tops.map((t) => t.top), segs };
    if (fine) { fine.setForms(tops.map((t) => t.sdf)); fine.setPlinth(plinthCollider(R.plinth)); }
    // (les modèles détaillés des statues, pour l'hologramme : cuits à part, sans retenir le film)
    holoTex.forEach((h) => h?.tex.dispose()); holoTex = []; holoK = -1;
    R.forms.forEach((f, k) => gen.request(f, 'show').then((o) => { if (v === version) setHolo(k, o); }).catch((e) => console.error(e)));
    for (let k = 0; k < NF; k++) {
      const form = R.forms[k];
      const y1 = tops[k].top + RC;
      const dSpec = { mode: 'desc', n, L, fabric, sub, fps, form, formTop: tops[k].top, plinth: plinthSpec, yH, y1, T: Td, wind, wet, floorY, ...pose };
      // (les coins descendent jusqu'à ce que le ventre du hamac se pose sur la
      // tête — 3 cm de plus, sans tension —, puis sont lâchés : le linge tombe
      // de lui-même autour de la forme ; tendu, il la traversait)
      const yc = tops[k].top + RC - lowest - 0.03, tRel = Td.pre + Td.lower;
      const dBig = { start: prev.final, startVel: prev.vel, cornerAt: (t, c) => [ring[c][0], knotDesc(t, yH, yc, Td), ring[c][1], t < tRel ? 2 : 0] };
      const d = await runCloth(dSpec, dBig, `d${k}`, 3, tops[k].sdf);
      if (v !== version || !d) return;
      segs.set(`desc:${k}`, d);
      buildCameraCurve();
      // (filet : un état final non fini ne se transmet pas — la montée repart
      // alors de la pendaison ; le film saute, mais la boucle reste saine)
      if (d.health && d.health.bad >= 0) { d.final = H.slice(); d.vel = null; }
      // (en hamac, la statue s'est évanouie au bout du repos et le linge
      // s'est effondré sur le socle : la montée se fait sans elle)
      const rSdf = corners === 'corners' ? null : tops[k].sdf;
      const rSpec = { mode: 'rise', n, L, fabric, sub, fps, form, plinth: plinthSpec, y0: y1, yH, T: Tr, wind, windT0: Td.pre + Td.lower + Td.settle, wet, floorY, ...pose };
      // (les coins sont repris là où ils reposent, et ramenés au hamac)
      const cidx = [0, n - 1, n * (n - 1), n * n - 1];
      const p0 = cidx.map((q) => [d.final[q * 3], d.final[q * 3 + 1], d.final[q * 3 + 2]]);
      // (on tire d'abord les coins vers l'extérieur, au ras du socle : le
      // linge effondré s'ouvre, puis on les monte en les écartant vers le
      // hamac)
      const bx = tops[k].box, Rout = Math.max(-bx[0], bx[3], -bx[2], bx[5]) + 0.03;
      // (un coin tenu ignore les contacts : s'il pend sous le dessus du socle,
      // on l'écarte d'abord au-delà du socle, sinon il traverserait le plateau)
      // (au-delà du coin d'un socle carré, ou du bord d'un socle rond : √2 pour un guéridon écartait les coins à 57 cm)
      const pd = plinthDims(R.plinth), pa = pd.a * (pd.parts[0].t === 'box' ? Math.SQRT2 : 1) + 0.06;
      // (…et on le remonte en même temps au-dessus du plateau : tenu plus bas,
      // il tirait le linge posé en ligne droite à travers l'arête du socle —
      // les fils s'y étiraient de six mailles et des points passaient dans le marbre)
      const out = p0.map((p) => { const r = Math.hypot(p[0], p[2]) || 1e-6, f = Math.max(1, Math.max(Rout, p[1] < 0.02 ? pa : 0) / r); return [p[0] * f, Math.max(p[1] + 0.01, p[1] < 0.02 ? 0.03 : 0), p[2] * f]; });
      // Les coins ne s'écartent jamais plus que le linge ne le permet : deux
      // coins voisins à moins d'un côté (à 94 %), deux coins opposés à moins
      // d'une diagonale. Un linge retombé de travers a parfois deux coins
      // voisins de part et d'autre du socle : écartés chacun de son côté, ils
      // étiraient les fils de trois à cinq mailles pendant toute la reprise.
      for (let it = 0; it < 30; it++) {
        let worst = 1;
        for (const [a, b, lim] of [[0, 1, L], [1, 3, L], [3, 2, L], [2, 0, L], [0, 3, L * Math.SQRT2], [1, 2, L * Math.SQRT2]]) worst = Math.max(worst, Math.hypot(out[a][0] - out[b][0], out[a][1] - out[b][1], out[a][2] - out[b][2]) / (0.94 * lim));
        if (worst <= 1.0001) break;
        for (const o of out) { o[0] /= Math.min(worst, 1.05); o[2] /= Math.min(worst, 1.05); }
      }
      const T1 = 0.35 * (Tr.tug + Tr.lift);
      const rBig = { start: d.final, startVel: d.vel, target: null, cornerAt: (t, c) => {
        if (t < T1) { const e = smoother(t / T1); return [p0[c][0] + (out[c][0] - p0[c][0]) * e, p0[c][1] + (out[c][1] - p0[c][1]) * e, p0[c][2] + (out[c][2] - p0[c][2]) * e, 1 + 0.3 * e]; }
        const s = (t - T1) / (Tr.tug + Tr.lift - T1), e = smoother(s), eh = smoother((s - 0.2) / 0.8);
        return [out[c][0] + (ring[c][0] - out[c][0]) * eh, out[c][1] + (yH - out[c][1]) * e, out[c][2] + (ring[c][1] - out[c][2]) * eh, 1.3 + 0.7 * eh];
      } };
      const r = await runCloth(rSpec, rBig, `r${k}`, 2, rSdf);
      if (v !== version || !r) return;
      segs.set(`rise:${k}`, r);
      if (k === NF - 1 && !(r.health && r.health.bad >= 0)) easeSeam(segs.get('desc:0'), r, H, Td);
      buildCameraCurve();
      prev = r.health && r.health.bad >= 0 ? { final: H, vel: null } : r;
    }
  }

  // ── Le raccord de la boucle. La dernière montée finit comme les autres :
  // le hamac balance et se calme de lui-même, sans rappel. Il ne s'arrête pas
  // exactement sur la pendaison de référence H d'où part la descente 0 (un pli
  // tombe 1 ou 2 cm à côté). Ramener le linge PENDU sur H se voyait : une
  // étoffe au repos qui se recale sans cause (« manque de naturel »). L'écart
  // est donc porté par le début de la descente 0, qui part de la vraie fin de
  // la montée (même position, même vitesse) et le résorbe pendant que le
  // hamac descend : dans un linge qui bouge de 20 cm, 2 cm ne se lisent pas.
  // Cette partie du film ne se joue qu'en fin de boucle, quand tout est calculé.
  function easeSeam(d0, r, H, Td) {
    if (!d0 || !r) return;
    const F = d0.frames, M = d0.N * 3, T0 = Td.pre + Td.lower, tau = 0.25;
    const E = r.final, V = r.vel;
    for (let f = 0; f < d0.count; f++) {
      const t = f / d0.fps, w = 1 - smoother(t / T0);
      if (w <= 0) break;
      const e = tau * (1 - Math.exp(-t / tau)); // (la vitesse de fin de montée s'éteint en un quart de seconde)
      for (let i = 0; i < M; i++) {
        const c = i % 3, v = V ? Math.max(-0.3, Math.min(0.3, V[i])) : 0;
        const q = F[f * M + i] + Math.round(((E[i] - H[i] + v * e) * w) / QS[c]);
        F[f * M + i] = q < -32768 ? -32768 : q > 32767 ? 32767 : q;
      }
    }
  }

  // ── La caméra suit le geste : « ouverture » o(t) ∈ [0, 1] (0 : la bague sur
  // la forme, 1 : la bague en haut), lissée par un noyau gaussien périodique ──
  let camCurve = null;
  const _k = new THREE.Vector3();
  function buildCameraCurve() {
    const S = 480, raw = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      const tf = (i / S) * TL.total;
      // point le plus haut du voile (la bague, ou les coins du hamac),
      // ramené entre la pose et la pendaison
      const { seg, local } = locateTL(tf);
      const s = data.segs.get(`${seg.kind}:${seg.k}`);
      if (!s) { raw[i] = 1; continue; } // (pas encore calculé : le voile en l'air)
      const f = Math.min(s.count - 1, Math.round(local * s.fps));
      let y = -1;
      for (let k = 0; k < veil.N; k += 3) y = Math.max(y, deq(s.frames[(f * veil.N + k) * 3 + 1], 1));
      const y1 = data.tops[seg.k] + RC;
      raw[i] = Math.min(1, Math.max(0, (y - y1) / (data.yH - y1)));
    }
    const sig = (0.9 / TL.total) * S, r = Math.ceil(sig * 3);
    const out = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      let a = 0, w = 0;
      for (let j = -r; j <= r; j++) { const g = Math.exp(-(j * j) / (2 * sig * sig)); a += g * raw[(i + j + S) % S]; w += g; }
      out[i] = a / w;
    }
    camCurve = out;
  }
  const locateTL = (tf) => locate(TL, tf);
  // la marque du linge mouillé après l'effacement : s'estompe en 0,8 s
  function formFade(tf) {
    const { seg, local } = locateTL(tf), Td = R.timing.desc;
    if (corners !== 'corners' || !Td.fall || seg.kind !== 'desc') return 0;
    const s = (local - (Td.pre + Td.lower + Td.settle)) / 0.8;
    return s < 0 || s >= 1 ? 0 : 1 - smoother(s);
  }
  // la statue est-elle encore là ? (en hamac, elle s'évanouit au bout du repos)
  function formShown(tf) {
    const { seg, local } = locateTL(tf), Td = R.timing.desc;
    if (corners !== 'corners' || !Td.fall) return true;
    return seg.kind === 'desc' && local < Td.pre + Td.lower + Td.settle;
  }
  // ouverture au temps du film (interpolée)
  function openness(tf) {
    if (!camCurve) return 0;
    const S = camCurve.length, x = (((tf / TL.total) % 1 + 1) % 1) * S, i = Math.floor(x), t = x - i;
    return camCurve[i % S] * (1 - t) + camCurve[(i + 1) % S] * t;
  }

  function syncLook() {
    if (!veil) return;
    const F = FABRIC_LOOK.dentelle, V = veil.U;
    V.color.value.set(R.veil.color);
    // (le cordon tranche sur le fond : chanvre clair dans la nuit, brun sur
    // un fond clair — invisible, il laisse le hamac flotter)
    cordMat.color.set(lum(R.bg.color) < 0.25 ? '#b9ab96' : '#3a2a22');
    // (lustre : la teinte de l'étoffe éclaircie, jamais du blanc sur une étoffe sombre)
    V.sheenColor.value.set(R.veil.color).multiplyScalar(1.25).addScalar(0.02); // (à 1,5 et 0,04, le lustre délavait les fils teints : un vermillon devenait saumon)
    V.rough.value = F.rough; V.sheen.value = F.sheen * R.veil.sheen; V.sheenRough.value = F.sheenRough;
    V.relief.value = F.relief; V.spec.value = F.spec; V.wet.value = R.wind.wet ?? 0.7; V.trans.value = F.trans;
    V.h.value = R.veil.L / (veil.n - 1);
    const La = R.veil.lace;
    V.lace.value = Math.max(0, LACE_KINDS.indexOf(La.kind));
    V.color2.value.set(La.color2); V.mScale.value = La.scale; V.scW.value = R.veil.L / La.scallops; V.L.value = R.veil.L;
    U.bg.value.set(R.bg.color); U.bg2.value.set(R.bg.color2);
    U.fl.value.set(R.floor.finish.outer.color); U.fl2.value.set(R.floor.finish.outer.color2);
    U.floorY.value = -R.plinth.height;
    const c = new THREE.Color(R.veil.color); // (linéaire)
    const alb = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    dose = Math.min(1.3, Math.max(0.55, Math.sqrt(0.32 / Math.max(alb, 0.01))));
  }

  // ── Lumières : placées par rapport à la caméra (azimut de la recette) ──
  const place = (l, az, el, r, ty = 0.3) => {
    l.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    l.target.position.set(0, ty, 0);
  };
  // dosage : une même lampe brûle une mousseline blanche et laisse un satin
  // noir dans le noir ; on vise la même luminance de sujet (≈ albédo × E)
  let dose = 1;
  const lastFine = { k: 0, coarse: null }; // (mise au point : la dernière image passée à l'étage fin)
  function lights() {
    const L = R.light, ca = R.camera.az;
    const k = L.kind;
    // dureté et ouverture selon le dispositif
    const hard = { skylight: [0.55, 1, 8], window: [0.35, 0.5, 3], spot: [0.22, 0.35, 2], overcast: [0.8, 1, 10], backlight: [0.45, 0.8, 5], softbox: [0.6, 1, 9] }[k];
    place(key, ca + L.az, L.el, 4.2);
    key.angle = hard[0]; key.penumbra = hard[1]; key.shadow.radius = hard[2];
    key.color.set(L.color); key.intensity = 175 * L.key * dose; // (une lampe franche et un ciel deux fois plus faible : les plis se modèlent ; à parts égales, le voile était plat)
    place(fill, ca + (k === 'backlight' ? 0.3 : -L.az * 0.6 + 0.4), 0.25, 4, 0.35);
    fill.color.set(L.color); fill.intensity = 140 * L.fill * dose;
    place(rim, ca + Math.PI + (k === 'backlight' ? 0.25 : -Math.sign(L.az || 1) * 0.6), k === 'backlight' ? 0.35 : 0.6, 4, 0.4);
    rim.color.set(L.color); rim.intensity = 140 * L.rim * dose;
    if (veil) {
      const V = veil.U;
      V.keyDir.value.copy(key.position).sub(key.target.position).normalize();
      V.keyE.value = key.intensity / key.position.distanceToSquared(key.target.position);
      V.keyCol.value.set(L.color);
      V.ambE.value = (fill.intensity + rim.intensity) / 16 * 0.3 + R.env.intensity * 0.3;
    }
    // poussière : le faisceau de la lampe principale (plus visible sur un fond sombre)
    D.pos.value.copy(key.position); D.dir.value.copy(key.target.position).sub(key.position).normalize();
    D.cos.value = Math.cos(key.angle * 0.8); D.soft.value = 0.008 + 0.02 * key.penumbra; D.col.value.set(L.color);
    D.lux.value = { nuit: 0.22, atelier: 0.3, amants: 0.18, galerie: 0.15, platre: 0.1, contrejour: 0.25 }[R.mood] ?? 0.2;
    U.glow.value = R.mood === 'nuit' ? 0.2 : 0.6;
    // (la fenêtre : du côté d'où vient la lumière principale ; aucune à
    // contre-jour, où le fond est déjà la lumière)
    const W = { galerie: [0.2, '#fbf6ec'], atelier: [0.3, '#f6f0e4'], platre: [0.14, '#fffbf2'], amants: [0.16, '#eef2f6'], nuit: [0.025, '#8fa6cf'], contrejour: [0, '#ffffff'] }[R.mood] ?? [0, '#ffffff'];
    U.win.value = W[0]; U.winCol.value.set(W[1]); U.winSide.value = (R.light.az ?? -1) < 0 ? 1 : -1;
  }

  // tf, tfPrev : temps du film (secondes)
  function update(tf, tfPrev) {
    if (!R) return;
    lights();
    cyclo.rotation.y = R.camera.az;
    if (!data) return;
    veil.group.visible = veil.upload(data, TL, tf, tfPrev);
    {
      const h = (R.veil.holo ?? 1) > 0 ? holoAt(tf) : null, F = h && holoTex[h.k];
      HO.amp.value = F ? h.amp * (R.veil.holo ?? 1) : 0;
      veil.depthTwin.visible = !!h; // (pendant toute l'apparition, à-coups compris)
      if (F) {
        if (holoK !== h.k) { holoK = h.k; holoT.value = F.tex; HO.org.value.set(...F.org); HO.size.value.set(...F.size); HO.n.value.set(...F.n); holo.scale.set(...F.size); holo.position.set(F.org[0] + F.size[0] / 2, F.org[1] + F.size[1] / 2, F.org[2] + F.size[2] / 2); }
        HO.t.value = h.u; HO.gl.value = h.gl; HO.gs.value = h.gs % 97;
        HO.scan.value = F.org[1] + F.size[1] * (1.05 - (h.u - 0.2) / 1.1); // (la bande descend une fois, en 1,1 s)
        HO.col.value.set(R.forms[h.k].holo ?? '#5fb8ff');
      }
    }
    if (cartelTex.length) { const k = locate(TL, tf).seg.k; if (k !== cartelK) { cartelK = k; cartelMat.map = cartelTex[k]; cartelMat.needsUpdate = true; } }
    if (fine && veil.group.visible) {
      // l'étage fin : posé sur la surface grossière de cette image, amené à
      // l'équilibre contre la statue de ce morceau (soumis avant le rendu)
      const { seg } = locate(TL, tf);
      lastFine.k = seg.k; lastFine.coarse = veil.positions();
      const device = renderer.backend.device, enc = device.createCommandEncoder();
      const fade = formFade(tf);
      fine.encode(enc, veil.positions(), formShown(tf) || fade > 0 ? seg.k : -1, { fade: formShown(tf) ? null : fade, pin: corners === 'corners' ? -1 : SUBDIV, L: R.veil.L, iters: FINE.iters, adh: FINE.adh * (R.wind.wet ?? 0), RA: FINE.RA, anchor: FINE.anchor, maxN: FINE.maxN, bend: FINE.bend, shear: FINE.shear, seed: 1 });
      device.queue.submit([enc.finish()]);
    }
    if (corners === 'corners') {
      ring.visible = cord.visible = false;
      // (lâchés à la fin de la descente, les cordons remontent hors champ ;
      // ils redescendent reprendre les coins au début de la montée)
      const { seg, local } = locate(TL, tf), Td = R.timing.desc;
      const held = seg.kind === 'rise' || local < Td.pre + Td.lower;
      const P = veil.positions(), n = veil.n, cidx = [0, n - 1, n * (n - 1), n * n - 1];
      cords4.forEach((c, i) => { const q = cidx[i] * 4; c.visible = held; c.position.set(P[q], P[q + 1] + 0.002, P[q + 2]); c.scale.y = Math.max(0.01, 5 - P[q + 1]); });
    } else {
      veil.knot(_k);
      ring.position.copy(_k); ring.position.y += 0.002;
      cord.position.copy(_k); cord.position.y += 0.004;
      cord.scale.y = Math.max(0.01, 5 - _k.y);
    }
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, syncLook, setShadowQuality, openness,
    get TL() { return TL; }, get data() { return data; }, get veil() { return veil; }, get fine() { return fine; }, lastFine, timings, healths,
    key, fill, rim, cyclo, plinth, cord, ring,
    group: veil?.group ?? new THREE.Group(),
    syncFinishes: () => syncLook(),
    error: () => failed,
    ready: () => !!data && data.segs.has('desc:0') && plinth.visible,
    // le morceau du temps tf est-il calculé ? (le film attend sinon)
    has: (tf) => { if (!data) return false; const { seg } = locate(TL, tf); return data.segs.has(`${seg.kind}:${seg.k}`); },
    complete: () => !!data && data.segs.size === 2 * R.forms.length,
    progress: () => { let p = done; for (const x of prog.values()) p += x; return Math.min(1, p / 4); }, // (l'écran de chargement attend la pendaison et la descente 0 : poids 1 + 3)
  };
}
