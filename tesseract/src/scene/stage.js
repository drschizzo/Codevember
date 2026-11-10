// Le plateau : sol (matériau procédural, reçoit les ombres) et éclairage
// (projecteur principal avec ombres douces, deux contre-jours). Les lumières
// sont fixes dans le monde : la caméra tourne, les ombres restent.
import * as THREE from 'three/webgpu';
import {
  positionWorld, vec2, vec3, vec4, float, mix, smoothstep, abs, floor, fract, length, sin, uniform, normalViewGeometry, max as tmax, lights,
} from 'three/tsl';
import { noise, noise2, fbm, worley, perturb, stableVelocity } from './materials.js';

// ── Sol ──────────────────────────────────────────────────────────────────────
// kind : gloss (laque noire), concrete (béton ciré), checker (damier de
// marbre), cyclo (blanc mat, se perd dans le fond), oak (parquet de chêne),
// velvet (velours) ; lightsNode : les lumières qui l'éclairent
function floorMaterial(kind, U, lightsNode) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.lightsNode = lightsNode;
  const p = positionWorld.xz, p3 = vec3(p.x, 0, p.y);
  let color = vec3(0.02), rough = float(0.5), h = float(0);
  switch (kind) {
    case 'gloss': {
      // laque satinée gris anthracite : assez claire pour que l'ombre s'y lise,
      // reflets adoucis (un miroir noir renvoyait des traînées du studio)
      color = vec3(0.055, 0.053, 0.052).mul(U.tint);
      rough = float(0.26).add(fbm(p3.mul(0.6), 3).mul(0.05));
      h = noise(p3.mul(9)).mul(0.25); // peau d'orange de la laque
      m.clearcoatNode = float(0.45);
      m.clearcoatRoughnessNode = float(0.16);
      break;
    }
    case 'concrete': {
      const n = fbm(p3.mul(0.5), 4), n2 = noise2(p3.mul(7));
      const pits = worley(p3.mul(24)).x;
      color = mix(vec3(0.16, 0.155, 0.15), vec3(0.24, 0.23, 0.215), n.mul(0.5).add(0.5)).mul(n2.mul(0.06).add(1)).mul(U.tint);
      rough = float(0.42).add(n.mul(0.12)).add(smoothstep(0.12, 0.0, pits).mul(0.3));
      h = n2.mul(0.2).sub(smoothstep(0.15, 0.0, pits).mul(1.2));
      m.clearcoatNode = float(0.35);
      m.clearcoatRoughnessNode = float(0.12);
      break;
    }
    case 'checker': {
      const sz = float(1.1), q = p.div(sz), cell = floor(q), f = fract(q);
      const odd = fract(cell.x.add(cell.y).mul(0.5)).mul(2); // (0 ou 1, aussi pour les cases négatives)
      const n = fbm(p3.mul(1.3).add(vec3(odd.mul(17), 0, 0)), 4);
      const vein = smoothstep(0.08, 0, abs(sin(p.x.mul(2.3).add(p.y.mul(1.4)).add(n.mul(6))))).mul(0.8);
      const white = mix(vec3(0.82, 0.8, 0.77), vec3(0.45, 0.44, 0.42), vein);
      const black = mix(vec3(0.04, 0.038, 0.035), vec3(0.6, 0.55, 0.48), vein.mul(0.7));
      const grout = smoothstep(0.012, 0.004, tmax(abs(f.x.sub(0.5)), abs(f.y.sub(0.5))).oneMinus());
      color = mix(mix(white, black, odd), vec3(0.3, 0.28, 0.25), grout);
      rough = mix(float(0.16), float(0.6), grout).add(n.mul(0.02));
      h = grout.negate();
      m.clearcoatNode = float(0.6);
      m.clearcoatRoughnessNode = float(0.1);
      break;
    }
    case 'cyclo': {
      color = vec3(0.78, 0.775, 0.765).mul(U.tint);
      rough = float(0.85);
      break;
    }
    case 'oak': { // lames de chêne verni : fil du bois, cernes, joints
      const L = float(0.22), q = vec2(p.x, p.y.div(L)), row = floor(q.y);
      const off = fract(sin(row.mul(12.9898)).mul(43758.5));
      const plankX = q.x.add(off.mul(3)).div(2.4), plank = floor(plankX);
      const seed = fract(sin(plank.mul(78.233).add(row.mul(12.9898))).mul(43758.5));
      const grain = fbm(vec3(p.x.mul(0.6), p.y.mul(18), seed.mul(40)), 4);
      const rings = sin(p.y.mul(60).add(grain.mul(8)).add(seed.mul(30))).mul(0.5).add(0.5);
      const fx = fract(plankX), fy = fract(q.y);
      const joint = smoothstep(0.004, 0.0, fx.min(fx.oneMinus()).mul(2.4)).max(smoothstep(0.02, 0.0, fy.min(fy.oneMinus())));
      color = mix(vec3(0.32, 0.2, 0.11), vec3(0.2, 0.12, 0.06), rings.mul(0.6).add(grain.mul(0.3))).mul(seed.mul(0.25).add(0.85)).mul(joint.mul(-0.6).add(1));
      rough = float(0.35).add(rings.mul(0.1)).add(joint.mul(0.4));
      h = rings.mul(0.15).sub(joint.mul(1.5));
      m.clearcoatNode = float(0.7);
      m.clearcoatRoughnessNode = float(0.08);
      break;
    }
    case 'velvet': {
      const n = noise2(p3.mul(40)), blot = fbm(p3.mul(0.8), 3);
      color = mix(vec3(0.03, 0.006, 0.012), vec3(0.06, 0.012, 0.022), blot.mul(0.5).add(0.5)).mul(U.tint);
      rough = float(0.95);
      m.sheenNode = vec3(0.6, 0.25, 0.3).mul(n.mul(0.2).add(0.8));
      m.sheenRoughnessNode = float(0.35);
      break;
    }
    default: break;
  }
  m.colorNode = vec4(color, 1);
  m.roughnessNode = rough;
  m.metalnessNode = float(0);
  m.normalNode = perturb(h.mul(0.004), normalViewGeometry);
  m.mrtNode = stableVelocity();
  return m;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _r = new THREE.Vector3();
// En voyage, le projecteur (le seul à porter une ombre) quitte le plateau
// pour le plafond de la pièce où l'on se tient : une douche, décalée vers la
// caméra (part du rayon), qui modèle l'objet et pose son ombre sur le mur du
// fond. Portée par la caméra, comme auparavant, elle éclairait de face comme
// un flash : ni modelé, ni ombre visible.
// reach : portée (en échelles du tesseract) — la pièce et ses abords ; au-delà,
// ni lumière ni ombre : la carte d'ombre ne rend que les cellules proches.
const TOP = { toward: 0.38, angle: 0.88, power: 2.4, reach: 3.4 };

// lite (mobile) : le second contre-jour, le plus faible des trois, n'éclaire plus
// rien (une lumière de moins évaluée à chaque pixel de chaque pièce et du sol) ;
// le premier reprend une part de sa lumière. Carte d'ombre de 1024².
export function createStage(scene, { lite = false } = {}) {
  const U = { tint: uniform(new THREE.Color(1, 1, 1)) };
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 1, 1).rotateX(-Math.PI / 2), null);
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
  let floorKind = '';

  const key = new THREE.SpotLight(0xffffff, 200, 0, 0.5, 0.75, 2);
  key.castShadow = true;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.01;
  const rim = new THREE.SpotLight(0xffffff, 100, 0, 0.55, 0.9, 2);
  const rim2 = new THREE.SpotLight(0xffffff, 40, 0, 0.6, 0.9, 2);
  rim.castShadow = false; rim2.castShadow = false;
  scene.add(key, key.target, rim, rim.target, rim2, rim2.target);
  // le sol n'est éclairé que par le plateau (les lumières des cellules, sans
  // ombre, le traverseraient depuis l'intérieur des cellules fermées)
  if (lite) rim2.visible = false;
  const studio = lite ? [key, rim] : [key, rim, rim2];
  const studioLights = lights(studio);

  const SHADOW_SIZES = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
  const place = (L, az, el, dist) => {
    L.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    L.target.position.set(0, 0, 0);
  };

  return {
    floor: floorMesh, key, rim, rim2, studio,
    setShadowQuality(q) { const s = SHADOW_SIZES[q] || 2048; key.shadow.mapSize.set(s, s); },
    // vc : voyage intérieur (kc : part de la caméra intérieure, kp : de la
    // projection stéréographique ; scale : échelle du tesseract). Le
    // projecteur principal devient une lampe portée par la caméra : sa lumière
    // passe par les ajours et dessine leurs ombres dans les pièces suivantes.
    update(R, floorY, vc = {}) {
      const kind = R.floor.kind;
      if (kind !== floorKind) {
        floorKind = kind;
        const old = floorMesh.material;
        floorMesh.material = kind === 'none' ? null : floorMaterial(kind, U, studioLights);
        old?.dispose();
      }
      const k = R.key;
      key.color.set(k.color); key.intensity = k.intensity; key.angle = k.angle; key.penumbra = k.penumbra;
      key.shadow.radius = k.soft;
      place(key, k.az, k.el, 11);
      // (rendu accumulé : le projecteur a une taille, son ombre une pénombre)
      if (vc.jitter) key.position.addScaledVector(vc.jitter, 0.45);
      const r = R.rim;
      const kc = vc.kc ?? 0, kp = vc.kp ?? 0;
      rim.color.set(r.color); rim.intensity = r.intensity * (1 - kp) ** 2 * (lite ? 1 + 0.5 * R.rim2.intensity / Math.max(1, r.intensity) : 1);
      place(rim, r.az, r.el, 10);
      const r2 = R.rim2;
      rim2.color.set(r2.color); rim2.intensity = r2.intensity * (1 - kp) ** 2;
      place(rim2, r2.az, r2.el, 10);
      // (le sol s'éloigne : il n'y a pas de sol dans l'hypersphère)
      floorMesh.position.y = floorY - 60 * kp * kp;
      floorMesh.visible = kind !== 'none' && kp < 0.999;
      const sc = key.shadow.camera;
      if (kc > 0 && vc.top) {
        // vc.top : { pos : plafond de la pièce, target : son objet } (monde)
        const s = vc.scale ?? 1, T = vc.top;
        const axis = _a.subVectors(T.pos, T.target), h = axis.length();
        const side = _b.subVectors(vc.camera.position, T.target);
        side.addScaledVector(axis, -side.dot(axis) / Math.max(1e-9, h * h));
        if (side.lengthSq() > 1e-9) side.normalize(); else side.set(0, 0, 0);
        _c.copy(T.pos).addScaledVector(side, TOP.toward * h);
        // (échantillon de lentille de l'export accumulé : la source a une taille, l'ombre une pénombre)
        if (vc.jitter) _c.addScaledVector(vc.jitter, 0.06 * h);
        key.position.lerp(_c, kc);
        key.target.position.lerp(T.target, kc);
        key.intensity = k.intensity * (1 - kc) + (vc.lamp ?? 1) * TOP.power * (vc.gain ?? 1) * (k.intensity / 700) * s * s * kc;
        key.angle = k.angle + (TOP.angle - k.angle) * kc;
        key.penumbra = k.penumbra + (1 - k.penumbra) * kc;
        key.shadow.radius = k.soft * (1 - kc) + 3 * kc;
        sc.near = 3 + (0.05 * s - 3) * kc;
        sc.far = 30 + (TOP.reach * s - 30) * kc;
        key.distance = 80 + (TOP.reach * s - 80) * kc;
      } else { sc.near = 3; sc.far = 30; key.distance = 0; }
      sc.updateProjectionMatrix();
    },
  };
}
