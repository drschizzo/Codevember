// L'atmosphère d'un monde : poussières qui dansent dans le faisceau de la
// lampe, le faisceau lui-même (un cône de lumière diffusée), des nappes de
// brume au ras du sol et, à la forge, des braises qui montent.
//
// Tout est dans le repère du monde (donc à son échelle, emboîté avec lui) et ne
// dépend que de t, le temps local du monde (proportionnel à sa profondeur
// relative u) : la plongée reste auto-similaire et la boucle parfaite. Les
// particules n'ont aucun tampon : chaque instance tire sa position de départ
// d'un hachage de son indice, et sa trajectoire est une fonction de t.
//
// Rien n'est éclairé par les lumières de la scène : la diffusion est calculée
// à partir du cône de la lampe (position et axe dans la scène, mis à jour à
// chaque image), ce qui ne dépend pas de l'échelle du monde.
import * as THREE from 'three/webgpu';
import {
  uniform, float, vec2, vec3, mix, smoothstep, fract, sin, cos, normalize, dot, length, uv, hash, instanceIndex,
  positionWorld, positionLocal, normalView, positionViewDirection, abs, pow, texture, atan, max, clamp,
} from 'three/tsl';

const TAU = Math.PI * 2;

// texture de fumée : des taches douces superposées (tirage fixe, la même partout)
let smokeTex = null;
function smokeTexture() {
  if (smokeTex) return smokeTex;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const r = S * (0.05 + 0.18 * rnd()), x = S * (0.15 + 0.7 * rnd()), y = S * (0.15 + 0.7 * rnd());
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + 0.1 * rnd();
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  smokeTex = new THREE.CanvasTexture(c);
  smokeTex.wrapS = smokeTex.wrapT = THREE.RepeatWrapping;
  return smokeTex;
}

// atmo : { dust, beam, haze, embers } (0 : absent, 1 : normal)
export function createAtmosphere({ atmo, keyColor, bg, floorY, plateY, plateR, RG, keyPos, keyTarget, keyAngle, lite = false }) {
  const group = new THREE.Group();
  const mats = [], geos = [];
  const U = { t: uniform(0), keyW: uniform(new THREE.Vector3()), axisW: uniform(new THREE.Vector3(0, -1, 0)) };
  const key = new THREE.Color(keyColor);
  const keyU = uniform(key);
  const cosA = Math.cos(keyAngle);
  // part de la lumière de la lampe qui atteint un point (cône aux bords doux)
  const inCone = (p) => smoothstep(cosA, Math.cos(keyAngle * 0.45), dot(normalize(p.sub(U.keyW)), U.axisW));

  // ── poussières (et braises) : des points doux, en mélange additif
  function motes({ count, size, color, rise, sway, y0, y1, r, glow, flicker = 0, ambient = 0.12, cool = 0 }) {
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const i = float(instanceIndex);
    const h = (k) => hash(i.mul(7.31).add(k));
    // départ : un disque de rayon r, entre y0 et y1
    const a = h(1).mul(TAU), rr = h(2).sqrt().mul(r);
    const H = y1 - y0, ph = h(3).mul(TAU), sp = h(4).mul(0.6).add(0.7);
    const t = U.t.mul(sp);
    // dérive : une montée lente (repliée sur la hauteur) et des volutes
    const fy = fract(h(5).add(t.mul(rise / H)));
    const x = cos(a).mul(rr).add(sin(t.mul(0.37).add(ph)).mul(sway)).add(sin(t.mul(0.11).add(ph.mul(2))).mul(sway * 2));
    const z = sin(a).mul(rr).add(cos(t.mul(0.29).add(ph)).mul(sway)).add(cos(t.mul(0.13).add(ph.mul(3))).mul(sway * 2));
    const pos = vec3(x, fy.mul(H).add(y0), z);
    m.positionNode = pos;
    // apparition et disparition aux deux bouts de la hauteur (repli invisible)
    // (cool : les braises s'éteignent en montant)
    const life = smoothstep(0, 0.12, fy).mul(smoothstep(1, 0.75, fy)).mul(cool ? pow(float(1).sub(fy), cool) : float(1));
    const sz = h(6).mul(0.7).add(0.5).mul(size);
    m.scaleNode = vec2(sz, sz);
    const d = length(uv().sub(0.5)).mul(2);
    const disc = pow(clamp(float(1).sub(d), 0, 1), 2);
    const tw = flicker ? sin(U.t.mul(9).add(ph.mul(5))).mul(0.5).add(0.5).mul(flicker).add(1 - flicker) : float(1);
    const lit = glow ? float(1) : mix(float(ambient), float(1), inCone(positionWorld));
    m.colorNode = vec3(...color).mul(lit).mul(life).mul(disc).mul(tw);
    m.opacityNode = float(1);
    m.userData.unlit = true;
    const sp2 = new THREE.Sprite(m);
    sp2.count = count;
    sp2.frustumCulled = false;
    mats.push(m);
    group.add(sp2);
  }
  const k = lite ? 0.4 : 1;
  if (atmo.dust > 0) {
    motes({
      count: Math.round(1400 * k * Math.min(2, atmo.dust)), size: 0.0055, rise: 0.012, sway: 0.03, y0: floorY + 0.05, y1: 2.2, r: 2.6,
      color: [key.r * 0.9 * atmo.dust, key.g * 0.9 * atmo.dust, key.b * 0.9 * atmo.dust], glow: false,
    });
  }
  if (atmo.embers > 0) {
    motes({
      count: Math.round(150 * k * Math.min(2, atmo.embers)), size: 0.006, rise: 0.11, sway: 0.06, y0: plateY - 0.05, y1: 1.1, r: plateR * 0.95,
      color: [4.5 * atmo.embers, 1.0 * atmo.embers, 0.2 * atmo.embers], glow: true, flicker: 0.7, cool: 2.2,
    });
  }

  // ── le faisceau : un cône ouvert de la lampe vers le plateau, en lumière
  // diffusée (plus dense au cœur du cône vu de face, nul sur ses bords et avant
  // d'atteindre la machine : pas de ligne d'intersection)
  if (atmo.beam > 0) {
    const kp = new THREE.Vector3(...keyPos), kt = new THREE.Vector3(...keyTarget);
    const dir = kt.clone().sub(kp), dist = dir.length(); dir.normalize();
    const h = dist * 0.92, rad = h * Math.tan(keyAngle);
    const geo = new THREE.ConeGeometry(rad, h, 64, 1, true);
    geos.push(geo);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const tAx = float(h / 2).sub(positionLocal.y).div(h); // 0 à la lampe, 1 au bout
    const along = smoothstep(0, 0.2, tAx).mul(smoothstep(1, 0.55, tAx));
    const face = pow(abs(dot(normalView, positionViewDirection)), 2.5);
    const th = atan(positionLocal.z, positionLocal.x);
    const streak = sin(th.mul(9).add(U.t.mul(0.21))).mul(sin(th.mul(4).sub(U.t.mul(0.13)).add(1.7))).mul(0.25).add(0.85);
    m.colorNode = keyU.mul(along.mul(face).mul(streak).mul(0.045 * atmo.beam));
    m.userData.unlit = true;
    mats.push(m);
    const cone = new THREE.Mesh(geo, m);
    cone.position.copy(kp).addScaledVector(dir, h / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
    cone.renderOrder = 6;
    group.add(cone);
  }

  // ── brume basse : des nappes horizontales de fumée, qui tournent lentement
  // l'une contre l'autre, plus claires dans le faisceau
  if (atmo.haze > 0) {
    const tex = smokeTexture();
    const R = RG * 0.75;
    const geo = new THREE.PlaneGeometry(2 * R, 2 * R);
    geos.push(geo);
    const bgC = new THREE.Color(bg);
    const layers = lite ? 2 : 4;
    for (let l = 0; l < layers; l++) {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const spin = (l % 2 ? -1 : 1) * (0.006 + 0.004 * l);
      const ang = U.t.mul(spin).add(l * 1.9), ca = cos(ang), sa = sin(ang);
      const q = uv().sub(0.5);
      const ruv = vec2(q.x.mul(ca).sub(q.y.mul(sa)), q.x.mul(sa).add(q.y.mul(ca))).mul(1.6 + 0.5 * l).add(0.5 + 0.13 * l);
      const n = texture(tex, ruv).r.mul(texture(tex, ruv.mul(2.3).add(vec2(U.t.mul(0.004), 0.3))).r.add(0.4));
      const radial = smoothstep(0.5, 0.12, length(q));
      const lit = mix(float(0.25), float(1), inCone(positionWorld));
      m.colorNode = mix(vec3(bgC.r, bgC.g, bgC.b).mul(1.4), keyU.mul(0.35), lit.mul(0.6)).mul(max(lit, 0.3));
      // (des volutes : le seuil creuse la texture en filets de fumée)
      m.opacityNode = clamp(smoothstep(0.18, 0.75, n).mul(radial).mul(0.32 * atmo.haze), 0, 0.3);
      m.userData.unlit = true;
      mats.push(m);
      const p = new THREE.Mesh(geo, m);
      p.rotation.x = -Math.PI / 2;
      // (la plus haute reste 10 cm sous le plateau : à sa hauteur exacte, elle
      // scintillait contre lui, en triangles, surtout sur un plateau de métal)
      p.position.y = Math.min(floorY + 0.02 + 0.05 * l + 0.012 * l * l, plateY - 0.1 + 0.01 * (l - layers + 1));
      p.renderOrder = 4;
      group.add(p);
    }
  }

  return {
    group,
    // t : temps local du monde ; matrixWorld : celle du monde, pour la lampe
    update(t) { U.t.value = t; },
    sync(matrixWorld, keyLocal, targetLocal) {
      U.keyW.value.copy(keyLocal).applyMatrix4(matrixWorld);
      U.axisW.value.copy(targetLocal).applyMatrix4(matrixWorld).sub(U.keyW.value).normalize();
    },
    dispose() { for (const m of mats) m.dispose(); for (const g of geos) g.dispose(); },
  };
}
