// La scène : lumières (ordre fixe, au premier niveau), cyclorama (sol et mur
// qui se raccordent en gorge, sans horizon), la machine, et le film (les
// transitions résolues dans les workers, relues à chaque image).
//
// update(ph) ne dépend que de la recette, des tables et de la phase.
import * as THREE from 'three/webgpu';
import { uniform, float, abs, fract, smoothstep, mix, step } from 'three/tsl';
import { buildPieceMaterial, finishUniforms } from './materials.js';
import { pieceFinish } from '../finishes.js';
import { createMachine, GHOSTS, GHOST_DT } from './machine.js';
import { createTrace } from './trace.js';
import { systemOf } from '../gen/machines.js';
import { buildFilm, movesOf, tremor } from '../film.js';
import { MOODS } from '../recipe.js';
import { planShots } from '../camera.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const { sin, cos, PI } = Math;

// cyclorama : sol plat (z > −D), gorge de rayon rc, mur vertical ; deux maillages
function cycloGeometry(part, D, rc, W = 14, Hm = 9, front = 14) {
  const pos = [], nor = [], tan = [], surf = [], idx = [];
  const rows = [];
  const prof = [];
  if (part === 'floor') { for (let i = 0; i <= 24; i++) { const z = front - ((front + D) * i) / 24; prof.push([0, z, 0, 1, 0]); } }
  else {
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * (PI / 2); prof.push([rc - rc * cos(a), -D - rc * sin(a), 0, cos(a), sin(a)]); }
    for (let i = 1; i <= 12; i++) prof.push([rc + ((Hm - rc) * i) / 12, -D - rc, 0, 0, 1]);
  }
  const nx = 40;
  for (const [y, z, , ny, nz] of prof) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const x = -W + (2 * W * i) / nx;
      row.push(pos.length / 3);
      pos.push(x, y, z); nor.push(0, ny, nz); tan.push(1, 0, 0, 1); surf.push(255, 0, 0, 128);
    }
    rows.push(row);
  }
  for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i < nx; i++) {
    const a = rows[j][i], b = rows[j][i + 1], c = rows[j + 1][i + 1], d = rows[j + 1][i];
    // (orientées vers le haut / l'avant)
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(new Uint8Array(surf), 4, true));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ── Gobo de la lampe principale : la lumière a une cause visible ──
// Cabinet : une grande fenêtre à meneaux ; Atelier : la verrière du toit. Le
// motif est projeté par la lampe (coordonnées de sa carte d'ombre, [0, 1]², la
// fenêtre centrée sur la machine) : ses barres d'ombre tombent sur la machine,
// le sol et le mur, et la chaîne qui balance les traverse. Hors de la fenêtre,
// presque rien (un peu de lumière diffusée).
//
// (Pas de light.colorNode / light.map : SpotLightNode les applique par un
// select(), compilé en if/else, et des variables partagées de l'éclairage n'y
// sont calculées que dans une branche — des quadrilatères à bords droits, le
// carré de projection de la lampe, mal éclairés partout, même sans motif. Ici
// le motif multiplie l'atténuation du cône, sans branche.)
class GoboSpotLight extends THREE.SpotLight {}
class GoboSpotLightNode extends THREE.SpotLightNode {
  static get type() { return 'GoboSpotLightNode'; }
  getSpotAttenuation(builder, angleCosine) {
    const a = super.getSpotAttenuation(builder, angleCosine);
    return this.light.gobo ? a.mul(this.light.gobo(this.getLightCoord(builder))) : a;
  }
}

export function createStage(scene, gen, { lite = false, renderer = null } = {}) {
  renderer?.library.addLight(GoboSpotLightNode, GoboSpotLight);
  // ── Lumières (ordre fixe) ──
  const key = new (renderer ? GoboSpotLight : THREE.SpotLight)(0xffffff, 400, 0, 0.5, 0.8, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  const rims = [new THREE.SpotLight(0xffffff, 200, 0, 0.6, 0.9, 2), new THREE.SpotLight(0xffffff, 80, 0, 0.7, 0.9, 2)];
  if (lite) rims[1].visible = false;
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }

  // (tout est uniforme : changer de scène ne recompile rien ; kind = 0 : pas de gobo)
  const GOBO = {
    kind: uniform(0), grid: uniform(new THREE.Vector2(3, 3)), half: uniform(new THREE.Vector2(0.3, 0.3)),
    bar: uniform(0.01), soft: uniform(0.01), leak: uniform(0.04),
  };
  key.gobo = (lc) => {
    const q = lc.xy.sub(0.5);
    const edge = (d, h, s) => smoothstep(h.add(s), h.sub(s), d);
    const inside = edge(abs(q.x), GOBO.half.x, GOBO.soft).mul(edge(abs(q.y), GOBO.half.y, GOBO.soft));
    // distance aux meneaux (lignes de la grille), en unités de la carte
    const pane = GOBO.half.mul(2).div(GOBO.grid);
    const g = q.add(GOBO.half).div(pane);
    const d = abs(fract(g.add(0.5)).sub(0.5)).mul(pane);
    const bars = smoothstep(GOBO.bar.sub(GOBO.soft), GOBO.bar.add(GOBO.soft), d.x).mul(smoothstep(GOBO.bar.sub(GOBO.soft), GOBO.bar.add(GOBO.soft), d.y));
    const v = mix(GOBO.leak, float(1), inside.mul(bars));
    return mix(float(1), v, step(0.5, GOBO.kind));
  };

  // ── Cyclorama ──
  const floor = new THREE.Mesh(), wall = new THREE.Mesh();
  floor.receiveShadow = wall.receiveShadow = true;
  scene.add(floor, wall);
  let cycloKey = '';
  const surfaceMat = (k, salt) => {
    const f = pieceFinish(k);
    return buildPieceMaterial(f, { outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(0) }, { seedOff: uniform(new THREE.Vector3(salt, salt * 0.3, salt * 0.7)) });
  };

  // ── Machine et film ──
  const machine = createMachine(gen);
  scene.add(machine.group);
  const trace = createTrace();
  scene.add(trace.group);
  let R = null, film = null, shots = null, sys = null, version = 0, solved = 0, nMoves = 0, failed = null;
  const hooks = { art: null, error: null };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    film = null; shots = null; failed = null;
    sys = systemOf(R.machine);
    machine.setRecipe(R);
    trace.setRecipe(R);
    const D = R.stage.sun ? 1.15 : 1.8;
    // Une pièce (sol et mur de matières différentes : parquet et mur peint,
    // terre et chaux, béton) a un angle franc au pied du mur ; seul un studio
    // a une gorge de cyclorama. (Une gorge d'un mètre dans la matière du mur,
    // posée sur un parquet, se lit comme une rampe molle au raccord net.)
    // Le plan du mur reste au même endroit dans les deux cas.
    // (Plein soleil : le mur est tout près, à 1,1 m de l'axe de la machine —
    // l'ombre portée du soleil bas monte dessus, comme promis par le décor)
    const rc = MOODS[R.mood]?.room ? 0.012 : 1.1, Dw = (R.stage.sun ? 1.1 : D + 1.1) - rc;
    const ck = `${R.stage.floor}|${R.stage.wall}|${Dw}|${rc}`;
    if (ck !== cycloKey) {
      cycloKey = ck;
      floor.geometry.dispose(); wall.geometry.dispose();
      floor.material?.dispose?.(); wall.material?.dispose?.();
      floor.geometry = cycloGeometry('floor', Dw, rc);
      wall.geometry = cycloGeometry('wall', Dw, rc);
      floor.material = surfaceMat(R.stage.floor, 3.3);
      wall.material = surfaceMat(R.stage.wall, 7.1);
    }
    // transitions : résolues en parallèle dans le pool
    const moves = movesOf(R);
    nMoves = moves.length; solved = 0;
    const spec = { machine: R.machine, film: R.film };
    Promise.all(moves.map((mv) => gen.request({ ...spec, i: mv.i }, 'move', (p, label, art) => { if (art && v === version) hooks.art?.(art); }).then((r) => { if (v === version) solved++; return r; })))
      .then((res) => {
        if (v !== version) return;
        film = buildFilm(R, sys, res.map((r) => r.tab));
        film.solutions = res.map(({ tab, ...rest }) => rest);
        shots = null;
      })
      .catch((e) => { if (v !== version) return; failed = e; hooks.error?.(e); });
  }

  // tenues ou ralentis retouchés : le film seul est recalculé (mêmes tables)
  function retime() {
    if (!film) return;
    const sol = film.solutions, tabs = film.steps.filter((x) => x.kind === 'move').map((x) => x.tab);
    film = buildFilm(R, sys, tabs);
    film.solutions = sol;
    shots = null;
  }

  const place = (l, target, az, el, d) => {
    l.position.set(target[0] + sin(az) * cos(el) * d, target[1] + sin(el) * d, target[2] + cos(az) * cos(el) * d);
    l.target.position.set(...target);
  };

  const state = {}, ghostStates = [];
  function update(ph) {
    if (!R || !film) return null;
    const E = machine.extent();
    const target = [0, E.H * 0.85, 0.1];
    const L = R.light;
    const unit = (d) => 330 * (d / 6.5) ** 2; // (candelas : même éclairement à toute distance)
    place(key, target, L.key.az, L.key.el, L.key.dist);
    key.color.set(L.key.color); key.intensity = unit(L.key.dist) * L.key.power; key.angle = L.key.angle; key.penumbra = L.key.penumbra;
    // (carte d'ombre resserrée sur la machine, quelle que soit l'ouverture du faisceau)
    // (avec un gobo, la carte couvre tout le faisceau : le motif est lu dans ses coordonnées)
    const gb = L.key.gobo;
    key.shadow.focus = gb ? 1 : Math.min(1, Math.atan((Math.max(E.w, E.h) * 0.75) / L.key.dist) / L.key.angle);
    GOBO.kind.value = gb ? 1 : 0;
    if (gb) { GOBO.grid.value.set(...gb.grid); GOBO.half.value.set(...gb.half); GOBO.bar.value = gb.bar; GOBO.soft.value = gb.soft; GOBO.leak.value = gb.leak; }
    key.shadow.camera.near = Math.max(0.5, L.key.dist - 4); key.shadow.camera.far = L.key.dist + 5;
    rims.forEach((l, i) => { const r = L.rim[i]; place(l, target, r.az, r.el, 6.5); l.color.set(r.color); l.intensity = unit(6.5) * r.power * (lite && i === 0 ? 1.4 : 1); });
    film.at(ph, state);
    tremor(R, state); // (les corrections d'un équilibre tenu : voir film.js)
    machine.update(state);
    if (R.stage.ghosts) {
      for (let k = 0; k < GHOSTS; k++) ghostStates[k] = film.at(ph - ((k + 1) * GHOST_DT) / film.duration, ghostStates[k] ?? {});
      machine.updateGhosts(state, ghostStates);
    }
    trace.update(ph, film, state);
    return state;
  }

  // caméra : le découpage en plans (voir camera.js), recalculé quand le film
  // ou la recette de la caméra changent (cadrages échantillonnés sur le film)
  let shotKey = '';
  function plan() {
    const k = JSON.stringify(R.camera);
    if (!shots || k !== shotKey) { shots = planShots(R, film, machine.extent()); shotKey = k; }
    return shots;
  }
  function cameraAt(ph, aspect, out) {
    if (!film) return out;
    return plan().at(ph, aspect, out);
  }
  const shotIndex = (ph) => (film ? plan().index(ph) : 0);

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, retime, update, cameraAt, shotIndex, setShadowQuality, syncFinishes: () => machine.syncFinishes(),
    group: machine.group, floor, wall, key, rims, machine, trace, hooks,
    get film() { return film; }, get sys() { return sys; },
    ready: () => machine.ready() && !!film,
    failed: () => failed,
    progress: () => 0.7 * (nMoves ? solved / nMoves : 0) + 0.3 * machine.progress(),
  };
}
