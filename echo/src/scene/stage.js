// La scène d'Echo : la pièce, la table, la nature morte, la lampe, le
// réflecteur, la poussière, et les lumières à retard.
//
// Principes (gabarit de la skill) :
//  - update(ph) ne dépend que de la recette et de la phase ;
//  - un maillage reçoit un matériau neuf quand SA géométrie arrive ;
//  - toutes les lumières sont créées une fois, dans un ordre fixe, au premier
//    niveau de la scène (fenêtre, lampe, glace, foyer, facettes, deux rebonds) ;
//    une famille absente éteint les siennes (visible = false), ce qui ne
//    recompile qu'au changement de scène, sous l'écran de chargement.
import * as THREE from 'three/webgpu';
import { uniform, vec2, vec3, vec4, float, attribute, positionLocal, sin, cos, length, positionWorld, reflector, dot, max, abs, mix, smoothstep } from 'three/tsl';
import { fbm, noise2 } from '../../../shared/scene/materials.js';
import { MATS, MOODS } from '../recipe.js';
import { derive, frontRange, TABLE_H } from '../gen/layout.js';
import { createFilm, cameraAt } from '../film.js';
import { P, gate } from './paths.js';
import { GatedLight, MirrorLight, FocusLight, FacetLight, registerLights } from './lights.js';
import { surfaceMaterial, ceramicMaterial } from './surfaces.js';
import { capSolidAngle } from '../gen/optics.js';
import { createHaze, HZ } from './haze.js';

const SHADOW = { mobile: 512, low: 512, medium: 1024, high: 1024, ultra: 2048 };

function toGeometry(o, extra = []) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  for (const [k, n] of extra) g.setAttribute(k, new THREE.BufferAttribute(o[k], n));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const lin = (h) => new THREE.Color(h);

export function createStage(scene, gen, { lite = false, renderer = null } = {}) {
  registerLights(renderer);
  // ── Lumières (ordre fixe) ──
  const win = new THREE.DirectionalLight(0xffffff, 0.5);
  win.castShadow = true;
  win.shadow.mapSize.set(2048, 2048);
  Object.assign(win.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.1, far: 8 });
  win.shadow.bias = -0.0005; win.shadow.normalBias = 0.02; win.shadow.radius = 8;
  const lamp = new GatedLight(0xffffff, 2, 0, 2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 0.03; lamp.shadow.camera.far = 6;
  lamp.shadow.bias = -0.0015; lamp.shadow.normalBias = 0.01; lamp.shadow.radius = 4;
  const mirrorL = new MirrorLight(0xffffff, 2, 0, 0.8, 0, 2);
  mirrorL.castShadow = true;
  mirrorL.shadow.mapSize.set(2048, 2048);
  mirrorL.shadow.bias = -0.0008; mirrorL.shadow.normalBias = 0.01; mirrorL.shadow.radius = 4;
  const focusL = new FocusLight(0xffffff, 0, 0, 2);
  const facetL = new FacetLight(0xffffff, 0, 0, 2);
  const vpl = [new GatedLight(0xffffff, 0, 0, 2), new GatedLight(0xffffff, 0, 0, 2)];
  const LIGHTS = [win, lamp, mirrorL, focusL, facetL, ...vpl];
  for (const l of LIGHTS) { scene.add(l); if (l.target) scene.add(l.target); }

  const root = new THREE.Group();
  scene.add(root);
  let R = null, D = null, film = null, version = 0, pending = 0, meshes = [], mats = [];
  let cord = null, ball = null, dust = null, mirrorTarget = null, pivot = [0, 0, 0];
  const U = {
    realPhase: uniform(0), // (phase du temps réel : dérive de la poussière, figée au ralenti)
    lampColor: uniform(new THREE.Color(1, 1, 1)),
    bulbGlow: uniform(1),
  };

  function clear() {
    for (const m of meshes) { root.remove(m); m.geometry.dispose(); }
    for (const m of mats) m.dispose();
    for (const g of [cord, ball]) if (g) root.remove(g);
    meshes = []; mats = [];
    cord = ball = dust = null;
    if (mirrorTarget) { scene.remove(mirrorTarget); mirrorTarget = null; }
  }
  const add = (o, mat, { cast = true, receive = true, extra = [], parent = root } = {}) => {
    const mesh = new THREE.Mesh(toGeometry(o, extra), mat);
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    parent.add(mesh);
    if (parent === root) meshes.push(mesh); else meshes.push(mesh);
    return mesh;
  };
  const own = (m) => { mats.push(m); return m; };

  // ── la lampe : verre, filament, culot ──
  // l'émission suit le front (L = distance au filament, vue par la caméra qui
  // rend l'image : dans le miroir, l'ampoule s'allume en retard)
  const lampGate = () => gate(length(positionWorld.sub(P.lamp)), positionWorld);
  function bulbMaterials(kind) {
    const glass = new THREE.MeshPhysicalNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const frosted = kind === 'globe';
    glass.colorNode = vec4(0.9, 0.9, 0.9, 1);
    glass.roughnessNode = float(frosted ? 0.35 : 0.04);
    glass.metalnessNode = float(0);
    glass.opacityNode = float(frosted ? 0.55 : 0.12);
    glass.emissiveNode = U.lampColor.mul(U.bulbGlow).mul(frosted ? 9 : 0.9).mul(lampGate());
    const fil = new THREE.MeshBasicNodeMaterial();
    fil.colorNode = vec4(U.lampColor.mul(lampGate().mul(240)).add(vec3(0.03, 0.025, 0.02)), 1);
    const stem = new THREE.MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false });
    stem.colorNode = vec4(0.8, 0.8, 0.8, 1);
    stem.roughnessNode = float(0.1);
    stem.opacityNode = float(0.4);
    stem.emissiveNode = U.lampColor.mul(lampGate().mul(1.2));
    return { glass, fil, stem };
  }

  // ── le miroir : la pièce rendue depuis la caméra symétrique ──
  function mirrorMaterial(Pl) {
    const refl = reflector({ resolutionScale: lite ? 0.5 : 0.85, bounces: false });
    mirrorTarget = refl.target;
    mirrorTarget.position.set(...Pl.c);
    mirrorTarget.lookAt(Pl.c[0] + Pl.n[0], Pl.c[1] + Pl.n[1], Pl.c[2] + Pl.n[2]);
    scene.add(mirrorTarget);
    const m = new THREE.MeshStandardNodeMaterial();
    // une glace ancienne : le tain s'oxyde par plaques depuis les bords (piqûres
    // grises et brunes), la poussière se dépose sur le verre. Les deux sont
    // éclairées par les lumières à retard : on voit le front passer SUR la glace
    const pw = positionWorld, r = pw.sub(P.mc);
    const a = dot(r, P.mu).div(P.mhw), b = dot(r, P.mv).div(P.mhh);
    const edge = float(1).sub(max(abs(a), abs(b)).max(length(vec2(a, b)).mul(0.92)));
    const blot = fbm(pw.mul(9).add(3.1), 4).mul(0.5).add(0.5);
    const fox = smoothstep(0.1, 0.0, edge).mul(smoothstep(0.55, 0.75, blot)).mul(0.8)
      .add(smoothstep(0.9, 0.93, noise2(pw.mul(140)).mul(0.5).add(0.5)).mul(0.5)).clamp(0, 1);
    const dust = fbm(pw.mul(26).add(7.7), 3).mul(0.5).add(0.5);
    m.colorNode = vec4(mix(vec3(0.01, 0.011, 0.011).add(dust.mul(0.012)), vec3(0.14, 0.12, 0.1), fox), 1);
    m.roughnessNode = mix(float(0.18), float(0.7), fox);
    m.metalnessNode = float(0);
    // tain d'argent (≈ 90 %, à peine verdi par l'épaisseur de la glace), terni où il s'oxyde
    m.emissiveNode = refl.rgb.mul(vec3(0.86, 0.9, 0.88)).mul(float(1).sub(fox.mul(0.75)));
    return m;
  }

  // ── la poussière : de minuscules grains, éclairés par les mêmes lumières ──
  function dustMesh(o) {
    const n = o.a.length / 4;
    const base = new THREE.IcosahedronGeometry(1, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    g.setAttribute('da', new THREE.InstancedBufferAttribute(o.a, 4));
    g.setAttribute('db', new THREE.InstancedBufferAttribute(o.b, 4));
    g.instanceCount = n;
    // (mélange additif : un grain dans l'ombre n'ajoute rien, il n'apparaît
    // que quand la lumière le touche — jamais un point noir sur un mur clair)
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const a = attribute('da', 'vec4'), b = attribute('db', 'vec4');
    // dérive lente dans l'air de la pièce : un nombre entier de périodes par
    // boucle de temps réel (elle s'arrête pendant les ralentis)
    const ph = U.realPhase.mul(2 * Math.PI);
    const drift = vec3(sin(ph.add(b.x)).mul(0.03), sin(ph.mul(2).add(b.y)).mul(0.012).add(ph.mul(0)), cos(ph.add(b.z)).mul(0.03)).mul(b.w);
    m.positionNode = a.xyz.add(drift).add(positionLocal.mul(a.w.mul(0.00055)));
    m.colorNode = vec4(0.45, 0.44, 0.43, 1);
    m.roughnessNode = float(1);
    m.metalnessNode = float(0);
    own(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = true;
    root.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  function build(o) {
    clear();
    const Md = MATS;
    const wallM = own(surfaceMaterial(Md[R.room.wall], { tile: true }));
    add(o.room.wall, wallM, { cast: false });
    if (o.room.panels) add(o.room.panels, wallM, { cast: false });
    add(o.room.skirting, wallM, { cast: false });
    const floorS = Md[R.room.floor];
    add(o.room.floor, own(surfaceMaterial(floorS, { boards: floorS.kind === 'wood', floor: true })), { cast: false });
    const cloth = R.table.mat === 'linen';
    // la table a vécu : des ronds de verres et de pots, plus sombres
    const stains = R.objects.slice(0, 3).map((ob, i) => [ob.x + 0.09 * Math.cos(ob.rot + i), ob.z + 0.07 * Math.sin(ob.rot * 2 + i), ob.r * (0.8 + 0.3 * ((i * 0.37) % 1))]);
    add(o.table.table, own(surfaceMaterial(Md[cloth ? 'oak' : R.table.mat], { stains: cloth ? null : stains })));
    if (o.table.cloth) add(o.table.cloth, own(surfaceMaterial(Md.linen, { side: THREE.DoubleSide })));
    add(o.vessels, own(ceramicMaterial()), { extra: [['col', 3], ['cr', 4], ['vc', 3]] });
    // lampe
    const bm = bulbMaterials(R.lamp.kind);
    own(bm.glass); own(bm.fil); own(bm.stem);
    add(o.lamp.glass, bm.glass, { cast: false, receive: false });
    add(o.lamp.filament, bm.fil, { cast: false, receive: false });
    add(o.lamp.stem, bm.stem, { cast: false, receive: false });
    const sockM = own(surfaceMaterial(Md[R.lamp.socket]));
    add(o.lamp.socket, sockM, { cast: false });
    const cordM = own(surfaceMaterial({ ...Md.blackVelvet, color: '#2a2622', color2: '#1a1714', sheen: 0.4 }));
    add(o.lamp.wire, cordM, { cast: false });
    cord = new THREE.Group();
    pivot = o.lamp.cordPivot;
    cord.position.set(...pivot);
    root.add(cord);
    add(o.lamp.cord, cordM, { parent: cord });
    // réflecteur
    if (o.mirror) {
      add(o.mirror.glass, own(mirrorMaterial(R.reflector.plane)), { cast: false });
      add(o.mirror.bevel, own(surfaceMaterial({ ...Md.silverFrame, rough: 0.06 })), { cast: false });
      // (usure aux arêtes saillantes : le bol rouge sous la dorure, le bois sous le noir)
      const fr = Md[R.reflector.frame];
      const wear = fr.kind === 'metal' ? (R.reflector.frame === 'giltFrame' ? '#7c3523' : '#3a3a38') : '#6b4a30';
      const fm = own(surfaceMaterial(fr, { wear }));
      add(o.mirror.frame, fm, { cast: R.family === 'psyche' });
      add(o.mirror.stand, fm);
    }
    if (o.ardent) {
      // (argent poli : il reflète la pièce sombre ; un faible rendu d'ambiance,
      // teinté par la lampe quand elle est allumée, empêche un trou noir)
      const capM = surfaceMaterial({ ...Md.silverFrame, rough: 0.06, color: '#f2f0ec' }, { flat: true });
      capM.emissiveNode = U.lampColor.mul(gate(length(positionWorld.sub(P.lamp)), positionWorld)).mul(0.04);
      add(o.ardent.cap, own(capM));
      const mm = own(surfaceMaterial(Md[R.lamp.socket === 'brass' ? 'brass' : 'nickel']));
      add(o.ardent.back, mm);
      add(o.ardent.metal, mm);
    }
    if (o.ball) {
      ball = new THREE.Group();
      ball.position.set(...R.reflector.ballC);
      root.add(ball);
      add(o.ball.facets, own(surfaceMaterial({ ...Md.silverFrame, rough: 0.05, color: '#f4f3f0' }, { local: true, flat: true })), { parent: ball });
      add(o.ball.core, own(surfaceMaterial({ ...Md.bakelite, color: '#121212' }, { local: true })), { parent: ball });
      add(o.ball.chain, own(surfaceMaterial(Md.nickel, { local: true })), { parent: ball, cast: false });
    }
    dust = dustMesh(o.dust);
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    D = derive(R);
    const fr = frontRange(R);
    film = createFilm({
      duration: R.film.duration, rhoStart: fr.rhoStart, rhoEnd: fr.rhoEnd,
      cord: { length: R.lamp.cord.length, damping: R.lamp.cord.damping, pull: 0.25, hold: 0.12, depth: 0.025, swing: R.lamp.cord.swing, dir: R.lamp.cord.dir },
    });
    pending = 1;
    gen.request({ R, opts: { dust: lite ? 2000 : 4500 } }, 'scene').then((o) => {
      if (v !== version) return;
      build(o);
      applyLights();
      pending = 0;
    }).catch((e) => { console.error(e); pending = 0; });
  }

  // ── Dosage des lumières (fixe pour une recette) ──
  function applyLights() {
    const s = D.s;
    const Lc = lin(R.lamp.color);
    U.lampColor.value.copy(Lc);
    const I = R.lamp.intensity;
    lamp.color.copy(Lc); lamp.intensity = I;
    lamp.position.set(...s);
    lamp.gPos.value.set(...s); lamp.gOff.value = 0;
    P.lamp.value.set(...s);
    // fenêtre hors champ
    const W = R.window;
    win.visible = W.intensity > 0.001;
    win.color.set(W.color); win.intensity = W.intensity;
    win.position.set(Math.sin(W.az) * Math.cos(W.el) * 4, Math.sin(W.el) * 4 + 0.2, Math.cos(W.az) * Math.cos(W.el) * 4);
    win.target.position.set(0, 0.1, -0.1);
    // miroir plan : la source image
    mirrorL.visible = !!D.plane;
    if (D.plane) {
      const Pl = D.plane;
      P.mc.value.set(...Pl.c); P.mn.value.set(...Pl.n); P.mu.value.set(...Pl.u); P.mv.value.set(...Pl.v);
      P.mhw.value = Pl.hw; P.mhh.value = Pl.hh; P.mshape.value = { rect: 0, oval: 1, arch: 2 }[Pl.shape] ?? 0;
      P.msv.value.set(...D.sv);
      mirrorL.position.set(...D.sv);
      mirrorL.target.position.set(...Pl.c);
      const dist = Math.hypot(D.sv[0] - Pl.c[0], D.sv[1] - Pl.c[1], D.sv[2] - Pl.c[2]);
      mirrorL.angle = Math.min(1.45, Math.atan(Math.hypot(Pl.hw, Pl.hh) / dist) + 0.08);
      mirrorL.penumbra = 0;
      mirrorL.color.copy(Lc).multiply(new THREE.Color(0.86, 0.9, 0.88));
      mirrorL.intensity = I;
      mirrorL.shadow.camera.near = Math.max(0.02, dist * 0.98);
      mirrorL.shadow.camera.far = 7;
      mirrorL.shadow.focus = 1;
      mirrorL.shadow.camera.updateProjectionMatrix();
    }
    focusL.visible = !!D.E;
    if (D.E) {
      const E = D.E;
      P.ef1.value.set(...E.f1); P.ef2.value.set(...E.f2); P.ea.value = E.a; P.eaxis.value.set(...E.axis); P.ecos.value = E.cosCap;
      focusL.position.set(...E.f2);
      // image du filament (≈ 18 mm) au grandissement |f₂M| / |f₁M|
      const dm = (q) => Math.hypot(q[0] - E.M[0], q[1] - E.M[1], q[2] - E.M[2]);
      P.efMin.value = 0.009 * (dm(E.f2) / dm(E.f1)) + 0.004;
      // puissance reçue par la calotte, rendue dans le cône de f₂ (argent poli, 92 %)
      const O1 = capSolidAngle(E, E.f1, 24), O2 = 2 * Math.PI * (1 - E.cosCap);
      focusL.color.copy(Lc); focusL.intensity = (0.92 * I * O1) / O2;
    }
    facetL.visible = !!D.B;
    if (D.B) {
      const B = D.B;
      P.bc.value.set(...B.c); P.br.value = B.r; P.brows.value = B.rows; P.bcols.value = B.cols;
      P.bsize.value = 0.88 * B.r * Math.min((2 * 1.25) / B.rows, (2 * Math.PI) / B.cols);
      facetL.position.set(...B.c);
      facetL.color.copy(Lc); facetL.intensity = 0.9 * I;
    }
    // brume : couleur × intensité de chaque source (0 si la famille ne l'a pas)
    const cI = (u, l, on) => (on ? u.value.set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity) : u.value.set(0, 0, 0));
    cI(P.cLamp, lamp, true);
    cI(P.cMirror, mirrorL, !!D.plane);
    cI(P.cFocus, focusL, !!D.E);
    cI(P.cFacet, facetL, !!D.B);
    P.haze.value = (MOODS[R.mood].haze ?? 0.1) * (lite ? 0.8 : 1);
    // rebonds diffus : la table sous la lampe, le mur près de la lampe ;
    // I_v = albédo · E · A / π, avec une aire utile de l'ordre de 2d²
    const alb = (k) => { const S = MATS[k]; const c = lin(S.color); return c; };
    const surfs = [R.table.mat === 'linen' ? 'linen' : R.table.mat, R.room.wall];
    vpl.forEach((l, i) => {
      const v = D.vpl[i];
      const d = Math.hypot(v.p[0] - s[0], v.p[1] - s[1], v.p[2] - s[2]);
      const c = alb(surfs[i]);
      l.visible = true;
      l.position.set(v.p[0] + v.n[0] * 0.02, v.p[1] + v.n[1] * 0.02, v.p[2] + v.n[2] * 0.02);
      l.color.copy(c).multiply(Lc);
      l.intensity = (I * 2 * c.getHSL({}).l) / Math.PI * (i === 0 ? 0.8 : 1.0);
      l.gPos.value.copy(l.position); l.gOff.value = d;
    });
  }

  const _c = new THREE.Vector3();
  function update(ph, camera) {
    if (!R || !film) return;
    const r = film.rho(ph);
    P.rhoOn.value = r.on; P.rhoOff.value = r.off;
    U.realPhase.value = film.realPhase(ph);
    // cordon : il coulisse (tirage) et se balance
    if (cord) {
      const c = film.cordAt(ph);
      cord.position.set(...cordPivot()).add(_c.set(0, c.y, 0));
      cord.rotation.set(c.sz, 0, -c.sx);
    }
    if (ball) ball.rotation.y = -2 * Math.PI * film.realPhase(ph) * (R.reflector.ballSpin ?? 1);
    if (D?.B) P.bspin.value = 2 * Math.PI * film.realPhase(ph) * (R.reflector.ballSpin ?? 1);
    if (camera) {
      P.eye.value.copy(camera.position);
      camera.updateMatrixWorld();
      HZ.projInv.value.copy(camera.projectionMatrixInverse);
      HZ.camWorld.value.copy(camera.matrixWorld);
      HZ.near.value = camera.near; HZ.far.value = camera.far;
    }
    P.frame.value = (P.frame.value + 1) % 4096;
  }
  const cordPivot = () => pivot;

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 1024;
    for (const [l, k] of [[lamp, 2], [mirrorL, 2], [win, 2]]) {
      if (l.shadow.mapSize.x !== s * k) { l.shadow.mapSize.set(s * k, s * k); l.shadow.map?.dispose(); l.shadow.map = null; }
    }
  }

  return {
    setRecipe, update, setShadowQuality, group: root, lights: LIGHTS,
    syncFinishes: () => {},
    get film() { return film; },
    get derived() { return D; },
    camera: (u) => (R ? cameraAt(R.camera, u) : null),
    ready: () => pending === 0 && !!film,
    progress: () => (pending ? 0.3 : 1),
    U,
    haze: createHaze(),
  };
}
