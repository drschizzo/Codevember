// La scène : un cyclorama, deux ou trois feuilles de papier sur leur tige, la
// lumière. Le film de chaque feuille (positions et normales, image par image)
// vient du worker ; la carte graphique le relit, et calcule ce que chaque pan
// renvoie de couleur sur le pan d'en face.
import * as THREE from 'three/webgpu';
import { Fn, Loop, uniform, float, ivec2, vec2, vec3, vec4, mix, mx_noise_vec3, fwidth, smoothstep, attribute, frontFacing, select, textureLoad, max, abs, dot, normalize, length, floor, fract, sqrt, cos, sin, atan, mod, transformNormalToView, mx_noise_float } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MOODS, PATTERNS } from '../recipe.js';
import { createTower } from './tower.js';

const TAU = Math.PI * 2;
const KEY_DIR = new THREE.Vector3(-3.2, 5.5, 2.4).normalize();
const lin = (hex) => vec3(...new THREE.Color(hex).toArray());
const dataTex = (arr, w, h) => { const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };

// ── Caméra : un lent va-et-vient, périodique sur la boucle ──
export function cameraAt(R, ph, aspect = 16 / 9) {
  // (écran étroit : la caméra recule jusqu'à garder les trois pièces dans le cadre)
  const C = R.camera, a = C.side * 0.28 + C.sway * Math.sin(TAU * ph), d = Math.max(C.dist, 8.6 / aspect) - 0.45 * Math.cos(TAU * ph);
  // (la cible : le milieu de la composition, bords des feuilles compris)
  let x0 = 1e9, x1 = -1e9, z1 = 0;
  for (const s of R.sheets) { x0 = Math.min(x0, s.at[0] - s.size); x1 = Math.max(x1, s.at[0] + s.size); z1 = Math.max(z1, s.at[1]); }
  const tgt = [(x0 + x1) / 2, 0.76, z1 * 0.4], y = 1.36 + C.lift + 0.1 * Math.sin(2 * TAU * ph);
  const pos = [tgt[0] + d * Math.sin(a), y, tgt[2] + d * Math.cos(a)];
  // (mise au point sur la pièce du centre : le centre d'une feuille, le milieu de la hauteur d'une tour)
  const H = R.sheets[0], hy = H.pattern === 'tour' ? (H.base + H.y) / 2 : H.y;
  return { pos, tgt, fov: 26, dist: Math.hypot(pos[0] - H.at[0], pos[1] - hy, pos[2] - H.at[1]) };
}

// profil tourné à arêtes adoucies (socles, pieds)
function turned(r, h, b = 0.012, seg = 64) {
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r - b, 0)];
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(r - b + b * Math.sin(a), b - b * Math.cos(a))); }
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(r - b + b * Math.cos(a), h - b + b * Math.sin(a))); }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, seg);
}

export function createStage(scene, gen, { lite = false } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const G = { keyI: uniform(3.4), amb: uniform(0.4), bleed: uniform(1.8), thru: uniform(0.2) };
  // La lampe : un projecteur de studio, haut et de côté. Sa nappe de lumière
  // tombe sur les pièces et s'éteint doucement vers les bords du cyclorama.
  const KEY_D = 8.5;
  const key = new THREE.SpotLight(0xffffff, 3.4 * KEY_D * KEY_D, 0, 0.6, 0.9, 2);
  key.target.position.set(0, 0.6, 0.4); key.position.copy(KEY_DIR).multiplyScalar(KEY_D).add(key.target.position);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3; key.shadow.camera.far = 16;
  key.shadow.radius = 5; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012;
  // un contre-jour froid, faible ; le reste de la lumière vient des rebonds (chaîne d'image)
  const fill = new THREE.DirectionalLight(0xcfe4ff, 0.9); fill.position.set(4, 1.6, -2.5); fill.target.position.set(0, 1, 0);
  const bounce = new THREE.DirectionalLight(0xffffff, 0.35); bounce.position.set(0.8, -4, 1.5); bounce.target.position.set(0, 1, 0);
  scene.add(key, key.target, fill, fill.target, bounce, bounce.target);

  let R = null, sheets = [], towers = [], prog = [], built = 0, token = 0;
  const gaps = [];
  const brass = new THREE.MeshStandardNodeMaterial({ color: '#e6d3ad', metalness: 1, roughness: 0.3 });
  const matte = (c) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.58 });
  const cast = (m, recv = true) => { m.castShadow = true; m.receiveShadow = recv; return m; };

  function clear() {
    for (const o of [...group.children]) { group.remove(o); o.traverse?.((c) => { c.geometry?.dispose(); if (c.material && c.material !== brass) c.material.dispose(); }); }
    for (const s of sheets) { s.posTex.dispose(); s.norTex.dispose(); s.nearTex.dispose(); }
    sheets = []; towers = []; // (les tours sont dans le groupe : leurs géométries et matériaux viennent d'être libérés)
  }

  // ── Le décor : cyclorama, fond, socles ──
  function decor() {
    const M = MOODS[R.mood], D = R.decor;
    const pts = [new THREE.Vector2(0, 0)], R0 = 14, f = 2.5;
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; pts.push(new THREE.Vector2(R0 - f + f * Math.sin(a), f - f * Math.cos(a))); }
    pts.push(new THREE.Vector2(R0, 12));
    const cyc = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), new THREE.MeshStandardNodeMaterial({ color: M.floor, roughness: 0.62, side: THREE.DoubleSide }));
    cyc.receiveShadow = true; group.add(cyc);
    // (le fond reste derrière : sa couleur est rabattue vers celle du mur)
    const tone = (c) => new THREE.Color(c).lerp(new THREE.Color(M.wall), 0.45);
    const col = tone(M.blocks[D.color]), x = D.side * 1.35, z = -2.3;
    if (R.backdrop === 'disque') {
      const d = cast(new THREE.Mesh(turned(D.size, 0.07, 0.02, 128), matte(col)));
      d.rotation.x = Math.PI / 2 - 0.1; d.position.set(x, D.size * 0.995, z - 0.25); group.add(d);
    } else if (R.backdrop === 'arche') {
      const w = D.size * 0.62, h = D.size * 1.05, t = 0.26, sh = new THREE.Shape();
      sh.moveTo(-w, 0); sh.lineTo(-w, h); sh.absarc(0, h, w, Math.PI, 0, true); sh.lineTo(w, 0); sh.lineTo(w - t, 0); sh.lineTo(w - t, h); sh.absarc(0, h, w - t, 0, Math.PI, false); sh.lineTo(-w + t, 0); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 4, curveSegments: 48 });
      const a = cast(new THREE.Mesh(g, matte(col))); a.position.set(x, 0, z); a.rotation.y = -D.side * 0.22; group.add(a);
    } else if (R.backdrop === 'paravent') {
      // (un paravent : trois panneaux pliés en accordéon, le thème en grand)
      const w = D.size * 0.5, h = D.size * 1.25;
      for (let i = 0; i < 3; i++) {
        const p = cast(new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.05, 4, 0.02), matte(tone(M.blocks[(D.color + i) % 3]))));
        const a = (i % 2 ? 1 : -1) * 0.5;
        p.position.set(x + (i - 1) * w * Math.cos(0.5), h / 2, z); p.rotation.y = a; group.add(p);
      }
    }
    for (const S of R.sheets) {
      const [sx, sz] = S.at, P = S.plinth, top = P?.h ?? 0;
      if (P) {
        // (socles dans la valeur du décor, un ton plus clair ou plus sombre : c'est le papier qu'on regarde)
        const fl = new THREE.Color(M.floor), dark = fl.r + fl.g + fl.b < 0.3; // (linéaire : un décor sombre garde des socles sombres)
        const m = matte(fl.clone().lerp(new THREE.Color(P.color ? '#ffffff' : '#201830'), P.color ? (dark ? 0.1 : 0.4) : 0.16));
        const b = P.kind === 'bloc' ? new THREE.Mesh(new RoundedBoxGeometry(P.r * 1.7, P.h, P.r * 1.7, 4, 0.014), m) : new THREE.Mesh(turned(P.r, P.h, 0.014), m);
        b.position.set(sx, P.kind === 'bloc' ? P.h / 2 : 0, sz); b.rotation.y = P.kind === 'bloc' ? S.rot : 0; group.add(cast(b));
      }
      if (S.pattern === 'tour') continue; // (une tour repose sur son plateau de laiton, sans tige)
      // la tige, son pied tourné et sa bague
      const foot = cast(new THREE.Mesh(turned(0.085, 0.016, 0.006, 48), brass)); foot.position.set(sx, top, sz);
      const rod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, S.y - top, 20), brass), false); rod.position.set(sx, (S.y + top) / 2, sz);
      const cap = cast(new THREE.Mesh(new THREE.SphereGeometry(0.02, 24, 16), brass), false); cap.position.set(sx, S.y, sz);
      const col2 = cast(new THREE.Mesh(turned(0.02, 0.03, 0.006, 24), brass), false); col2.position.set(sx, top + 0.014, sz);
      group.add(foot, rod, cap, col2);
    }
    key.color.set(M.key); key.intensity = M.keyI * KEY_D * KEY_D; G.keyI.value = M.keyI;
    bounce.color.set(M.floor);
  }

  // ── Une feuille ──
  function addSheet(S, M) {
    const A = MOODS[R.mood], { RN, F1, K } = M;
    const posTex = dataTex(M.pos, RN, F1), norTex = dataTex(M.nor, RN, F1), nearTex = dataTex(M.near, RN, K);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(M.rest, 3));
    geo.setAttribute('crease', new THREE.BufferAttribute(M.crease, 2));
    geo.setAttribute('rid', new THREE.BufferAttribute(Float32Array.from({ length: RN }, (_, i) => i), 1));
    geo.setIndex(new THREE.BufferAttribute(M.index, 1));
    const U = { frame: uniform(0), turn: uniform(new THREE.Vector2(1, 0)), mir: uniform(0), L: uniform(new THREE.Vector3()) };
    const paper = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    const f0 = floor(U.frame).toInt(), ft = fract(U.frame);
    const at = (tex, id) => mix(textureLoad(tex, ivec2(id, f0)).xyz, textureLoad(tex, ivec2(id, f0.add(1))).xyz, ft);
    const rid = attribute('rid').toInt();
    const P = at(posTex, rid), Nl = normalize(at(norTex, rid));
    const rest = attribute('position'), rr = length(rest.xz);
    // (une ombrelle retournée montre son autre face : dans le repère du film, les deux couleurs échangent leur place)
    const top0 = mix(lin(A.papers[S.top][0]), lin(A.papers[S.top][1]), smoothstep(0.1, 1.0, rr)), bot0 = mix(lin(A.papers[S.bot][0]), lin(A.papers[S.bot][1]), smoothstep(0.2, 1.1, rr));
    const top = mix(top0, bot0, U.mir), bot = mix(bot0, top0, U.mir);
    // ce que les pans d'en face renvoient sur ce sommet, côté recto (+1) ou verso (−1)
    const bleed = (side) => Fn(() => {
      const acc = vec3(0).toVar();
      Loop(K, ({ i }) => {
        const e = textureLoad(nearTex, ivec2(rid, i)), j = e.x.toInt(), a = e.y;
        const d = at(posTex, j).sub(P), r2 = dot(d, d).add(1e-7), dh = d.div(sqrt(r2)), m = normalize(at(norTex, j));
        const ci = dot(Nl, dh).mul(side), cj = dot(m, dh);
        const sj = select(cj.lessThan(0), float(1), float(-1)); // (la face du voisin tournée vers ce sommet)
        const E = max(dot(m, U.L).mul(sj), 0).mul(G.keyI).add(G.amb);
        const F = max(ci, 0).mul(abs(cj)).mul(a).div(r2.mul(Math.PI).add(a));
        acc.addAssign(select(sj.greaterThan(0), top, bot).mul(E).mul(F));
      });
      return acc;
    })().toVarying();
    const bF = bleed(1), bB = bleed(-1), crv = attribute('crease', 'vec2').toVarying(), cr = crv.x;
    // (le film est écrit dans le repère de la bascule en cours : un tour de h × w le remet en
    // place ; pour une ombrelle, une bascule sur deux est le film retourné, haut en bas)
    const sg = float(1).sub(U.mir.mul(2));
    const turn = (v) => vec3(v.x.mul(U.turn.x).sub(v.z.mul(U.turn.y)), v.y.mul(sg), v.x.mul(U.turn.y).add(v.z.mul(U.turn.x)));
    const nF = Nl.toVarying(), nV = turn(Nl).mul(sg).toVarying();
    paper.positionNode = turn(P);
    // face vue, dans le repère du film : le recto, sauf retournement
    const front = abs(select(frontFacing, float(1), float(0)).sub(U.mir)).greaterThan(0.5);
    // le papier : grain, pliures marquées (la fibre blanchit là où elle a été cassée).
    // Le grain est lu dans un secteur replié en éventail : il ne change pas quand la selle a tourné d'un cran.
    const rv = rest.toVarying(), ang = atan(rv.z, rv.x), wd = abs(mod(ang, M.w).sub(M.w / 2)), rl = length(rv.xz);
    const gp = vec3(rl.mul(cos(wd)), rl.mul(sin(wd)), 0.37);
    const grain = mx_noise_float(gp.mul(260)).mul(0.5).add(mx_noise_float(gp.mul(900)).mul(0.5)).mul(smoothstep(1.2, 0.3, fwidth(gp.x).add(fwidth(gp.y)).mul(500)));
    // pliure : un filet où la fibre, cassée, blanchit ; tranche : le bord coupé montre l'âme blanche du papier
    const line = float(1).sub(smoothstep(0.0, 0.07, cr));
    const rim = smoothstep(float(1).sub(fwidth(crv.y).mul(0.9)), float(1), crv.y).mul(0.55);
    const base = select(front, top, bot);
    const mottle = mx_noise_float(gp.mul(38)).mul(0.035).add(1); // (nuage de la pâte, à l'échelle du centimètre)
    const col = mix(mix(base, base.mul(0.6).add(0.4), line.mul(0.3)), vec3(0.93, 0.92, 0.9), rim).mul(grain.mul(0.05).add(1)).mul(mottle);
    paper.colorNode = col;
    paper.roughnessNode = float(0.82).add(grain.mul(0.08)).sub(line.mul(0.12));
    // le grain du papier : une dent très fine, qui accroche la lumière rasante
    // (elle s'efface quand un pixel couvre plusieurs grains : de loin elle ne ferait que scintiller)
    const tooth = smoothstep(1.2, 0.3, fwidth(gp.x).add(fwidth(gp.y)).mul(700));
    paper.normalNode = transformNormalToView(normalize(nV.add(mx_noise_vec3(gp.mul(700)).mul(tooth.mul(0.04)))));
    const facing = select(front, float(1), float(-1));
    const through = max(dot(nF, U.L).mul(facing).negate(), 0).mul(G.keyI).mul(G.thru);
    // (la lumière qui traverse la feuille garde la teinte de la face qu'on regarde : le produit des deux encres, du jaune
    //  par du bleu, donnait des taches vertes sur le dos des plis)
    paper.emissiveNode = col.mul(select(front, bF, bB)).mul(G.bleed).add(col.mul(col.add(0.25)).mul(through.mul(0.6)));
    paper.sheen = 0.1; paper.sheenRoughness = 0.75;
    // l'ombre d'une feuille n'est pas noire : un cinquième de la lumière la traverse et prend sa couleur
    paper.castShadowNode = vec4(top0.mul(bot0).pow(vec3(0.5)).add(top0.add(bot0).mul(0.25)).mul(0.3), 1);
    // … mais sur le papier lui-même cette lumière colorée fait des taches (du jaune à travers du bleu : du vert).
    // Une feuille reçoit donc une ombre neutre, un peu plus dense : seuls le sol et les socles voient l'ombre teintée.
    paper.receivedShadowNode = Fn(([shadow]) => { const l = dot(vec3(shadow), vec3(0.2126, 0.7152, 0.0722)); return vec3(l.mul(l.sqrt())); });
    const mesh = new THREE.Mesh(geo, paper);
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.scale.setScalar(S.size); mesh.position.set(S.at[0], S.y, S.at[1]); mesh.rotation.y = S.rot;
    group.add(mesh);
    // lampe dans le repère de la feuille au repos
    const L0 = key.position.clone().sub(mesh.position).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -S.rot);
    sheets.push({ S, M, U, mesh, posTex, norTex, nearTex, L0 });
  }

  // Ce que le worker calcule pour chaque pièce de la recette : la même
  // demande donne le même résultat (le pool le garde en cache, par demande)
  function pieces(R) {
    return R.sheets.map((S) => {
      const P = PATTERNS[S.pattern];
      // (le film d'une tour dure une boucle ; les imperfections de raideur fixent l'ordre des claquements)
      if (P.kind === 'tour') return { what: 'tour', spec: { tower: { units: S.units, loop: R.loop.duration, spread: S.spread } } };
      return { what: 'sheet', spec: { sheet: { n: S.n, rings: S.rings, sub: 2, m: lite ? Math.round(S.m * 0.8) : S.m, hole: S.hole, twist: P.twist ?? 0, star: P.star ?? 0, rhythm: S.rhythm, kind: P.kind ?? 'rings', lobes: P.lobes ?? 2 },
        film: { amp: S.amp, open: S.open, eps: P.eps ?? 0.02 } } };
    });
  }

  function setRecipe(r) {
    R = r; built = 0;
    const my = ++token;
    clear(); decor();
    prog = R.sheets.map(() => 0);
    pieces(R).forEach(({ what, spec }, i) => {
      const S = R.sheets[i];
      gen.request(spec, what, (f) => { if (my === token) prog[i] = f; }).then((M) => {
        if (my !== token) return;
        if (what === 'tour') {
          const T = createTower(S, M, MOODS[R.mood], G, key.position, brass);
          group.add(T.group); towers.push(T); T.update(0, G); gaps[i] = 0;
        } else {
          // (les tampons d'un résultat gardé en cache servent à plusieurs scènes : textures sur des copies partagées, jamais cédées)
          addSheet(S, M); gaps[i] = M.gap;
        }
        prog[i] = 1; built++;
      });
    });
  }

  // Préparer une scène à l'avance : ses pièces sont calculées et gardées en
  // cache ; quand elle viendra, elle s'affichera sans attendre.
  function prefetch(r) {
    for (const { what, spec } of pieces(r)) gen.request(spec, what).catch(() => {});
  }

  // ph : phase de la boucle (deux bascules)
  function update(ph) {
    for (const t of towers) t.update(ph, G);
    for (const s of sheets) {
      const t = (2 * ph + s.S.phase) % 2, h = Math.floor(t), u = t - h, a = h * s.M.w, c = Math.cos(a), sn = Math.sin(a), my = h && s.M.mirror ? -1 : 1;
      s.U.frame.value = Math.min(u * (s.M.F1 - 1), s.M.F1 - 1.001);
      s.U.turn.value.set(c, sn);
      s.U.mir.value = my < 0 ? 1 : 0;
      // (la lampe, vue du repère du film : le tour inverse, et le retournement)
      s.U.L.value.set(s.L0.x * c + s.L0.z * sn, s.L0.y * my, -s.L0.x * sn + s.L0.z * c);
    }
  }

  return {
    group, setRecipe, prefetch, update, G, key, gaps,
    ready: () => !!R && built === R.sheets.length, progress: () => (prog.length ? prog.reduce((a, b) => a + b, 0) / prog.length : 0),
    setShadowQuality(q) { const s = { mobile: 1024, low: 1024, medium: 2048, high: 4096, ultra: 4096 }[q] ?? 2048; if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; } },
  };
}
