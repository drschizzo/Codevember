// Les décors : le support du coussin (souche, granit, bloc, muret, tourbe,
// terre), le sol, le ciel et les accessoires de chaque humeur. Tout est
// calculé ; la profondeur de champ du macro les fond dans le flou, mais ils
// donnent sa lumière, sa valeur et son lieu à chaque scène.
//
// Le support est construit sur la MÊME fonction que celle où les tiges sont
// plantées (gen/colony.js, makeSubstrate) : la mousse y est posée exactement.
// Il se mouille avec elle (plus sombre, plus brillant), d'après l'eau moyenne
// du coussin.
import * as THREE from 'three/webgpu';
import { Fn, atan, attribute, texture, positionPrevious, normalGeometry, modelViewMatrix, positionWorld, positionGeometry, normalWorld, vec2, vec3, vec4, float, mix, smoothstep, uniform, abs, sin, cos, pow, clamp, normalViewGeometry, max as tmax, color, positionLocal, cameraPosition, length, normalize, dot } from 'three/tsl';
import { noise, worley, fbm, perturb, stableVelocity, isLite } from '../../../shared/scene/materials.js';
import { makeSubstrate } from '../gen/colony.js';
import { supportSurface } from '../gen/support.js';
import { createRng, createNoise3 } from '../../../shared/rng.js';
import { DECOR_FINISHES } from '../recipe.js';
import { Buffers, norm, add as vadd, mul, cross } from '../../../shared/gen/mesh.js';

const sst = (a, b, x) => smoothstep(float(a), float(b), x);

export function createDecorLook(FIELD = null) {
  return {
    FIELD,
    wet: uniform(0),           // mouillure du décor (0…1)
    skyLow: uniform(new THREE.Color()), skyHigh: uniform(new THREE.Color()),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)), sunColor: uniform(new THREE.Color()), sunGlow: uniform(0), gaps: uniform(0),
  };
}

// matière minérale ou organique d'après un motif (bark, granite, stone, peat)
function decorMaterial(fin, DU, { scale = 1, field = false } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry.mul(scale);
  const base = color(new THREE.Color(fin.color));
  let col = base, h = float(0), rough = float(fin.rough);
  switch (fin.pattern) {
    case 'bark': { // écorce : sillons longitudinaux (le long de x), plaques, lichens
      const n1 = noise(p.mul(vec3(0.25, 2.2, 2.2)));
      const groove = sst(0.15, -0.2, sin(p.z.mul(5).add(p.y.mul(5)).add(n1.mul(4))));
      const plates = worley(p.mul(vec3(0.3, 1.2, 1.2))).x;
      h = groove.mul(-1).add(plates.mul(0.5));
      col = col.mul(groove.mul(-0.45).add(1)).mul(noise(p.mul(3)).mul(0.12).add(1));
      break;
    }
    case 'granite': { // granit : grains clairs et sombres, cristaux de mica
      const g1 = worley(p.mul(9)).x, g2 = noise(p.mul(14));
      col = col.mul(sst(0.0, 0.35, g1).mul(0.35).add(0.75)).mul(g2.mul(0.18).add(1)).mul(fbm(p.mul(0.6), 3).mul(0.25).add(1));
      h = g1.mul(0.4).add(fbm(p.mul(2), 3).mul(0.8));
      break;
    }
    case 'stone': { // calcaire, grès : surface piquetée, veines, taches
      const f = fbm(p.mul(1.4), 4);
      col = col.mul(f.mul(0.35).add(1)).mul(worley(p.mul(5)).x.mul(0.2).add(0.9));
      h = f.add(worley(p.mul(7)).x.mul(0.4));
      break;
    }
    case 'peat': { // tourbe, terre, litière : fibres, grumeaux, aiguilles mortes
      const f = fbm(p.mul(2.5), 4), fib = sin(p.x.mul(30).add(f.mul(12))).mul(0.5).add(0.5);
      col = col.mul(f.mul(0.5).add(1)).mul(fib.mul(0.15).add(0.92));
      h = f.add(fib.mul(0.3));
      break;
    }
    default: break;
  }
  // lichens : taches à bord net (crustacés), seulement sur ce qui regarde le ciel
  if (fin.lichen) {
    const w = worley(p.mul(0.9).add(vec3(3.1, 0, 1.7)));
    const patch = sst(0.32, 0.26, w.x).mul(sst(0.2, 0.6, normalWorld.y)).mul(fbm(p.mul(3), 2).mul(0.5).add(0.6).clamp(0, 1));
    col = mix(col, color(new THREE.Color(fin.lichen)), patch);
    rough = mix(rough, float(0.9), patch);
  }
  // mouillé : plus sombre et plus lisse (un film d'eau) ; sur la pierre qui
  // porte la mousse, l'eau et le voile vert de protonéma viennent du champ
  let wet = DU.wet;
  if (field && DU.FIELD) {
    const F = DU.FIELD, uv = positionWorld.xz.div(F.E.mul(2)).add(0.5);
    const inside = smoothstep(0.5, 0.47, abs(uv.x.sub(0.5)).max(abs(uv.y.sub(0.5))));
    const f = texture(F.tex, uv.clamp(0, 1));
    wet = mix(DU.wet, f.y, inside);
    col = mix(col, mix(vec3(0.16, 0.26, 0.05), vec3(0.08, 0.2, 0.03), f.y), smoothstep(0.03, 0.35, f.x).mul(inside).mul(0.75));
  }
  m.colorNode = col.mul(wet.mul(-0.38).add(1));
  m.roughnessNode = mix(rough, float(0.22), wet.mul(0.8));
  m.metalnessNode = float(0);
  m.normalNode = perturb(h.mul(0.012 * (fin.relief ?? 0.5)), normalViewGeometry);
  m.mrtNode = stableVelocity();
  return m;
}

// ── La roche cuite (gen/rock.js) : déplacement des sommets, normal map,
// couleur minérale et rugosité, occlusion des creux ; micro-relief
// procédural au pixel pour le macro ; eau et voile de protonéma du champ ──
export function rockTextures(maps) {
  const rel = new THREE.DataTexture(maps.rel, maps.M, maps.M, THREE.RGBAFormat, THREE.HalfFloatType);
  const col = new THREE.DataTexture(maps.col, maps.M, maps.M, THREE.RGBAFormat, THREE.UnsignedByteType);
  col.colorSpace = THREE.SRGBColorSpace;
  for (const t of [rel, col]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; }
  return { rel, col, X: maps.X };
}
function rockMaterial(T, DU, logR = 0) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const X = float(T.X);
  // (souche couchée le long de x, axe en y = −R : coordonnées (x, arc))
  const coord = (p) => (logR ? vec2(p.x, atan(p.z, p.y.add(logR)).mul(logR)) : p.xz);
  const uvOf = (p) => coord(p).add(X).div(X.mul(2));
  const fadeOf = (p) => smoothstep(0.5, 0.46, abs(uvOf(p).x.sub(0.5)).max(abs(uvOf(p).y.sub(0.5))));
  const up = (p) => (logR ? normalize(vec3(0, p.y.add(logR), p.z)) : vec3(0, 1, 0));
  const disp = (p) => p.add(up(p).mul(texture(T.rel, uvOf(p)).level(0).x.mul(fadeOf(p))));
  m.positionNode = Fn(() => { if (!isLite()) positionPrevious.assign(disp(positionLocal)); return disp(positionLocal); })();
  m.castShadowPositionNode = disp(positionLocal);
  const g = positionGeometry, uv = uvOf(g), fade = fadeOf(g);
  const rel = texture(T.rel, uv), alb = texture(T.col, uv);
  // normale : celle de la forme d'ensemble, inclinée par la pente du relief cuit
  const n0 = normalGeometry;
  // (pente du relief : le long de x, et en travers — z pour la roche, l'arc pour la souche)
  const across = logR ? normalize(vec3(0, g.z.negate(), g.y.add(logR))) : vec3(0, 0, 1);
  const nW = normalize(n0.add(vec3(rel.y.negate(), 0, 0).add(across.mul(rel.z.negate())).mul(fade)));
  const nV = normalize(modelViewMatrix.mul(vec4(nW, 0)).xyz);
  // micro-relief (grains sous le texel) pour le gros plan
  m.normalNode = perturb(noise(g.mul(55)).mul(0.0012).add(noise(g.mul(140)).mul(0.0005)), nV);
  let wet = DU.wet, col = alb.rgb;
  if (DU.FIELD) {
    const F = DU.FIELD, fu = coord(g).div(F.E.mul(2)).add(0.5);
    const inside = smoothstep(0.5, 0.47, abs(fu.x.sub(0.5)).max(abs(fu.y.sub(0.5))));
    const f = texture(F.tex, fu.clamp(0, 1));
    wet = mix(DU.wet, f.y, inside);
    // voile vert de protonéma devant le front ; algues dans les creux humides
    col = mix(col, mix(vec3(0.13, 0.22, 0.04), vec3(0.07, 0.17, 0.025), f.y), smoothstep(0.03, 0.3, f.x).mul(inside).mul(0.7));
  }
  // mouillé : la roche fonce (l'eau remplit les pores) et brille, d'abord dans les creux
  const pooled = wet.mul(rel.w.oneMinus().mul(0.6).add(0.4));
  m.colorNode = col.mul(wet.mul(-0.45).add(1));
  m.roughnessNode = mix(alb.a, float(0.18), pooled.clamp(0, 1));
  m.metalnessNode = float(0);
  m.aoNode = rel.w;
  m.mrtNode = stableVelocity();
  return m;
}

// ── Géométries ───────────────────────────────────────────────────────────────
// grille (x, z) sur [−X, X] × [−Z, Z], hauteur f(x, z)
// maillage cuit par un worker (gen/support.js : positions, normales, uv, indices)
function bakedGeometry(b) {
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(b.index, 1));
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
  return g;
}
function heightfield(f, X, Z, nx, nz, warp = null) {
  const g = new THREE.PlaneGeometry(2 * X, 2 * Z, nx, nz).rotateX(-Math.PI / 2);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), z = P.getZ(i);
    if (warp) [x, z] = warp(x, z);
    P.setXYZ(i, x, f(x, z), z);
  }
  g.computeVertexNormals();
  return g;
}
// souche couchée le long de x : cylindre de rayon R dont le dessus suit le substrat
function logGeometry(sub, R, len) {
  const g = new THREE.CylinderGeometry(R, R * 1.05, len, 96, 40, true).rotateZ(Math.PI / 2);
  const P = g.attributes.position, N = createNoise3('log');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const a = Math.atan2(y, z), rr = R * (1 + 0.025 * N.fbm(x * 0.2, Math.cos(a) * 2, Math.sin(a) * 2, 3));
    // dessus : exactement le substrat (là où pousse la mousse)
    const top = Math.max(0, Math.sin(a));
    const yy = Math.sin(a) * rr - R, zz = Math.cos(a) * rr;
    const ys = sub.y(x, zz);
    P.setXYZ(i, x, yy * (1 - top ** 6) + ys * top ** 6, zz);
  }
  g.computeVertexNormals();
  return g;
}

function cylinderTrunk(B, base, h, r) {
  const pts = [];
  for (let k = 0; k <= 8; k++) pts.push([base[0] + Math.sin(k * 0.7) * 0.3, base[1] + (h * k) / 8, base[2]]);
  const nr = 16, rows = [];
  for (let k = 0; k <= 8; k++) {
    const row = [];
    for (let i = 0; i < nr; i++) { const a = (2 * Math.PI * i) / nr, n = [Math.cos(a), 0, Math.sin(a)]; row.push(B.vert(vadd(pts[k], mul(n, r * (1 + (k === 0 ? 0.25 : 0)))), n, [255, 0, 0])); }
    rows.push(row);
  }
  B.grid(rows, true);
}
// galet (icosphère aplatie et bosselée)
function pebble(B, c, r, rng, flat = 0.6) {
  const ico = new THREE.IcosahedronGeometry(1, 2), P = ico.attributes.position;
  const sx = r * rng.range(0.8, 1.3), sy = r * flat * rng.range(0.8, 1.1), sz = r * rng.range(0.8, 1.3), a = rng.range(0, 6.28);
  const ca = Math.cos(a), sa = Math.sin(a), base = [];
  const seen = new Map();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    const bump = 1 + 0.08 * Math.sin(x * 5 + y * 3) * Math.cos(z * 4);
    const px = x * sx * bump, py = y * sy * bump, pz = z * sz * bump;
    const q = [c[0] + px * ca - pz * sa, c[1] + py, c[2] + px * sa + pz * ca];
    const n = norm([x / sx * ca - z / sz * sa, y / sy, x / sx * sa + z / sz * ca]);
    if (!seen.has(key)) seen.set(key, B.vert(q, n, [255, 0, 0]));
    base.push(seen.get(key));
  }
  for (let i = 0; i < base.length; i += 3) B.tri(base[i], base[i + 1], base[i + 2]);
}
// brin (herbe, bruyère, linaigrette) : lame effilée courbée
function blade(B, base, h, w, lean, az) {
  const dir = [Math.cos(az), 0, Math.sin(az)], side = [-Math.sin(az), 0, Math.cos(az)];
  const rows = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6, p = vadd(vadd(base, [0, h * t, 0]), mul(dir, lean * h * t * t));
    const ww = w * (1 - t) + 0.002;
    const n = norm(vadd(mul(dir, -1), [0, lean * t, 0]));
    rows.push([B.vert(vadd(p, mul(side, -ww)), n, [255, 0, 0]), B.vert(vadd(p, mul(side, ww)), n, [255, 0, 0]), B.vert(vadd(p, mul(dir, ww * 0.6)), mul(n, -1), [255, 0, 0])]);
  }
  B.grid(rows, true);
}
const toGeo = (o) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
};

// ciel : dôme dont le dégradé suit l'humeur et le temps (pluie / soleil)
function skyMaterial(DU) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const d = normalize(positionWorld.sub(cameraPosition));
  const up = d.y.clamp(-0.2, 1);
  const base = mix(DU.skyLow, DU.skyHigh, pow(up.max(0), 0.6));
  const sun = pow(dot(d, DU.sunDir).max(0), 24).mul(DU.sunGlow);
  // trouées du couvert (sous-bois) : des taches de ciel éclatantes entre les
  // feuilles, que la profondeur de champ change en bokeh
  const q = d.mul(9);
  const leaves = smoothstep(0.25, 0.6, noise(q).add(noise(q.mul(2.7)).mul(0.5))).mul(smoothstep(-0.05, 0.25, d.y));
  m.colorNode = base.add(DU.sunColor.mul(sun)).add(DU.sunColor.mul(leaves.mul(DU.gaps).mul(2.2)));
  return m;
}

// R : recette ; C : colonie (sortie du worker) ; group : groupe du décor
// baked : le maillage fin du support, cuit par un worker (gen/support.js) ;
// sans lui, il est calculé ici (même résultat, sur le fil principal)
export function buildDecor(group, R, C, DU, rockT = null, baked = null) {
  const out = [];
  const add = (geo, mat, { cast = false, receive = true } = {}) => { const o = new THREE.Mesh(geo, mat); o.castShadow = cast; o.receiveShadow = receive; group.add(o); out.push(o); return o; };
  const D = R.decor, acc = D.accord, sub = makeSubstrate(R.colony.support), rng = createRng(`decor:${D.seed}`);
  const fin = (k) => DECOR_FINISHES[k];
  const Rc = R.colony.radius, surf = supportSurface(R, sub);
  // support
  switch (D.support) {
    case 'log': {
      if (rockT) {
        // souche : cylindre fin dont le dessus suit la forme du substrat ; l'écorce cuite en relief
        const Rl = surf.Rl;
        let g = baked && bakedGeometry(baked);
        if (!g) {
          g = new THREE.CylinderGeometry(Rl, Rl, surf.len, isLite() ? 480 : 900, isLite() ? 260 : 520, true).rotateZ(Math.PI / 2).translate(0, -Rl, 0);
          const P = g.attributes.position;
          for (let i = 0; i < P.count; i++) {
            const x = P.getX(i), y = P.getY(i), z = P.getZ(i), top = Math.max(0, (y + Rl) / Rl) ** 4;
            P.setY(i, y + top * (surf.top(x, z) - y) * (Math.abs(z) < Rl * 0.95 ? 1 : 0));
          }
          g.computeVertexNormals();
        }
        add(g, rockMaterial(rockT, DU, Rl), { cast: true });
      } else add(logGeometry(sub, 1 / 0.2, 60), decorMaterial(fin(acc.support), DU, { field: true }), { cast: true });
      break;
    }
    case 'granite': case 'boulder': case 'wall': case 'peat': case 'ground': {
      // le dessus suit le substrat, puis le bloc s'arrondit et plonge vers le sol (gen/support.js)
      const f = (x, z) => surf.f(x, z, !!rockT);
      const res = rockT ? (isLite() ? 360 : 720) : 220;
      add((rockT && baked && bakedGeometry(baked)) || heightfield((x, z) => Math.max(-14, f(x, z)), 22, 22, res, res), rockT ? rockMaterial(rockT, DU) : decorMaterial(fin(acc.support), DU, { field: true }), { cast: true });
      break;
    }
    default: { // tourbe, terre : le substrat s'étend, avec une houle douce au loin
      const f = (x, z) => surf.f(x, z, !!rockT);
      if (rockT) {
        // près : grille fine et relief cuit ; loin : grille grossière, sous la fine
        add((baked && bakedGeometry(baked)) || heightfield(f, 14, 14, isLite() ? 360 : 720, isLite() ? 360 : 720), rockMaterial(rockT, DU), { cast: true });
        add(heightfield((x, z) => f(x, z) - (Math.max(Math.abs(x), Math.abs(z)) < 13.5 ? 0.3 : 0), 90, 90, 120, 120), decorMaterial(fin(acc.support), DU));
      } else add(heightfield(f, 90, 90, 160, 160, (x, z) => { const r = Math.hypot(x, z), k = r < 1e-6 ? 1 : (r < 12 ? 1 : 1 + (r - 12) * 0.02); return [x * k, z * k]; }), decorMaterial(fin(acc.support), DU, { field: true }), { cast: true });
    }
  }
  // accessoires
  const B = new Buffers(1 << 14), BT = new Buffers(1 << 10);
  const props = new Set(D.props);
  const groundAt = (x, z) => (D.support === 'log' ? -9 : ['granite', 'boulder', 'wall'].includes(D.support) ? -14 : sub.y(x, z) * Math.exp(-Math.max(0, Math.hypot(x, z) - Rc - 4) * 0.05));
  if (props.has('trunks')) {
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, 6.28), d = rng.range(45, 110);
      cylinderTrunk(BT, [Math.cos(a) * d, -10, Math.sin(a) * d], 160, rng.range(4, 11));
    }
  }
  if (props.has('gravel')) {
    // gravier ratissé autour du granit
    for (let k = 0; k < 900; k++) {
      const a = rng.range(0, 6.28), d = rng.range(Rc + 6, 40);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      pebble(B, [x, -14 + 0.25 + 0.25 * Math.sin(z * 1.4), z], rng.range(0.25, 0.45), rng, 0.55);
    }
  }
  if (props.has('stones')) {
    // muret : pierres plates empilées derrière et sous le coussin
    for (let row = 0; row < 4; row++) for (let k = 0; k < 9; k++) {
      const x = -24 + k * 6 + rng.range(-1, 1) + (row % 2) * 3;
      pebble(B, [x, -4.5 - row * 3.4, rng.range(-4.5, -3.5)], rng.range(2.6, 3.4), rng, 0.45);
    }
  }
  if (props.has('grass') || props.has('heather')) {
    for (let k = 0; k < 220; k++) {
      const a = rng.range(0, 6.28), d = rng.range(Rc + 1.5, 26);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = ['granite', 'boulder', 'wall'].includes(D.support) && d > Rc + 4 ? -14 : groundAt(x, z);
      blade(B, [x, y - 0.1, z], rng.range(3, 9), rng.range(0.06, 0.12), rng.range(0.1, 0.5), rng.range(0, 6.28));
    }
  }
  if (props.has('cottongrass')) {
    for (let k = 0; k < 28; k++) {
      const a = rng.range(0, 6.28), d = rng.range(Rc + 4, 30), x = Math.cos(a) * d, z = Math.sin(a) * d, h = rng.range(10, 22);
      blade(B, [x, groundAt(x, z) - 0.2, z], h, 0.08, rng.range(0.02, 0.12), rng.range(0, 6.28));
      pebble(B, [x, groundAt(x, z) + h, z], rng.range(0.9, 1.4), rng, 1.25);
    }
  }
  if (props.has('needles') || props.has('litter')) {
    for (let k = 0; k < 160; k++) {
      const a = rng.range(0, 6.28), d = rng.range(Rc + 0.8, 14), x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = groundAt(x, z);
      if (props.has('needles')) {
        const az = rng.range(0, 6.28), l = rng.range(2, 4), dir = [Math.cos(az), 0.02, Math.sin(az)];
        const pts = [[x, y + 0.05, z], vadd([x, y + 0.05, z], mul(dir, l))];
        const rows = [];
        for (const p of pts) { const row = []; for (let i = 0; i < 4; i++) { const ph = i * Math.PI / 2, n = [Math.cos(ph) * -dir[2], Math.sin(ph), Math.cos(ph) * dir[0]]; row.push(B.vert(vadd(p, mul(n, 0.05)), n, [255, 0, 0])); } rows.push(row); }
        B.grid(rows, true);
      } else pebble(B, [x, y + 0.05, z], rng.range(0.8, 1.6), rng, 0.08);
    }
  }
  if (props.has('pool')) {
    // mare : eau sombre et lisse au-delà du tapis
    const g = new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2).translate(18 + Rc, -0.35, -6);
    const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x0a0c0c, roughness: 0.04, metalness: 0 });
    m.mrtNode = stableVelocity();
    add(g, m);
  }
  if (props.has('lantern')) {
    // pied de lanterne de pierre (tōrō) : socle, fût, au loin
    const pts = [[0, 0], [7, 0], [7, 2], [5.5, 2.4], [3, 3], [3, 20], [4.2, 21], [4.2, 22], [0, 22]];
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24).translate(-30, -14, -38);
    add(g, decorMaterial(fin('granite'), DU), { cast: false });
  }
  if (props.has('cones')) {
    for (let k = 0; k < 3; k++) { const a = rng.range(0, 6.28), d = rng.range(Rc + 2, 10), x = Math.cos(a) * d, z = Math.sin(a) * d; pebble(B, [x, groundAt(x, z) + 1, z], 1.6, rng, 0.7); }
  }
  if (false) { // (fougères, érable : à refaire en vraies frondes)
    for (let k = 0; k < 40; k++) {
      const a = rng.range(0, 6.28), d = rng.range(20, 45), x = Math.cos(a) * d, z = Math.sin(a) * d;
      blade(B, [x, groundAt(x, z), z], rng.range(12, 25), rng.range(0.8, 1.6), rng.range(0.3, 0.9), rng.range(0, 6.28));
    }
  }
  // (accessoires : pierres et galets dans la matière du lieu, brins dans la teinte de l'accent)
  if (B.n) add(toGeo(B.out()), decorMaterial(props.has('stones') || props.has('gravel') ? fin(acc.support) : { ...fin(acc.accent), pattern: fin(acc.accent).pattern ?? 'stone', relief: 0.3 }, DU, { scale: 1 }), { cast: false });
  if (BT.n) add(toGeo(BT.out()), decorMaterial(fin('bark'), DU, { scale: 0.3 }), { cast: false });
  // ciel
  add(new THREE.SphereGeometry(400, 48, 24), skyMaterial(DU), { receive: false });
  return out;
}
