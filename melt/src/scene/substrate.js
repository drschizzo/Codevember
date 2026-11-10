// Le support du cristal, une matière par humeur. Repère du monde (mm,
// y vers le haut) : le cristal se pose sur le plan y = 0.
//
//   wool     tricot de laine : fibres une à une près du cristal (gen/wool.js)
//   velvet   velours noir : un lustre rasant, des plis de poil écrasé
//   glass    plaque de verre sur une table lumineuse (champ lumineux uniforme)
//   sapphire lame de saphir sous un éclairage de Rheinberg (champ coloré)
//   slate    ardoise : feuillets, paillettes de mica, mate
//   leaf     feuille de houx : cuticule vernissée, nervures en relief
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, vec2, vec3, vec4, float, mix, smoothstep, abs, sin, cos, clamp, normalView, positionWorld, pow, max as tmax,
  fract, floor, length, exp, positionViewDirection, dot,
} from 'three/tsl';
import { noise, noise2, fbm, perturb, worley, isLite, stableVelocity } from './materials.js';

export function createSubstrate(scene, gen, { lite = false } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const U = {
    color: uniform(new THREE.Color()), color2: uniform(new THREE.Color()), field: uniform(new THREE.Color()), frost: uniform(0),
  };
  let meshes = [], pending = 0, kind = '', version = 0, frostPoints = null;
  const clear = () => {
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    meshes = [];
  };
  const add = (geo, mat, { shadow = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = shadow;
    group.add(m);
    meshes.push(m);
    return m;
  };
  const disc = (y = 0, r = 70) => {
    const g = new THREE.CircleGeometry(r, 128).rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };

  function planeMaterial(k) {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const pw = positionWorld;
    const p3 = vec3(pw.x, 0, pw.z);
    m.metalnessNode = float(0);
    if (k === 'velvet') {
      // le poil : des pointes de fibres de ~20 µm, serrées (c'est elles qui
      // donnent l'échelle en macro), couchées par plages (velours écrasé)
      const crush = fbm(p3.mul(0.35), 3).mul(0.5).add(0.5);
      const pile = noise(p3.mul(45)).mul(0.5).add(noise2(p3.mul(110)).mul(0.5)).mul(0.5).add(0.5);
      m.colorNode = vec4(mix(U.color, U.color2, crush.mul(0.4).add(pile.mul(0.6))), 1);
      m.roughnessNode = float(1);
      m.specularIntensityNode = float(0.02);
      m.sheenNode = mix(float(0.08), float(0.4), crush.mul(0.5).add(pile.mul(0.5)));
      m.sheenColorNode = U.color2.mul(0.8).add(0.004);
      m.sheenRoughnessNode = float(0.3);
      if (!isLite()) m.normalNode = perturb(pile.mul(0.004).add(fbm(p3.mul(0.35), 3).mul(0.04)), normalView);
    } else if (k === 'glass' || k === 'sapphire') {
      // le champ lumineux vu à travers la plaque ; le verre lui-même ne se voit
      // que par ses reflets (vernis)
      m.colorNode = vec4(0, 0, 0, 1);
      m.roughnessNode = float(0.4);
      const r = length(vec2(pw.x, pw.z));
      m.emissiveNode = U.field.mul(smoothstep(30, 6, r).mul(0.25).add(0.75));
      m.clearcoatNode = float(0.3);
      m.clearcoatRoughnessNode = float(0.08);
      m.specularIntensityNode = float(0.2);
    } else if (k === 'slate') {
      // ardoise en macro : un grain serré de quelques dizaines de µm (micas,
      // quartz), des paillettes qui scintillent, et les marches des feuillets
      // (quelques µm de haut, au mm)
      const q = p3.mul(0.6);
      const a = noise(q).add(noise(q.mul(2.3)).mul(0.4));
      const plate = smoothstep(-0.03, 0.03, a).mul(0.5).add(smoothstep(0.35, 0.39, a).mul(0.5));
      const grain = noise(p3.mul(28)).mul(0.5).add(noise2(p3.mul(70)).mul(0.35)).add(noise(p3.mul(150)).mul(0.15));
      const h = plate.mul(0.008).add(grain.mul(0.0025)).add(fbm(p3.mul(0.15), 3).mul(0.02));
      const mica = smoothstep(0.8, 0.95, noise2(p3.mul(55)));
      m.colorNode = vec4(mix(U.color, U.color2, plate.mul(0.25).add(grain.mul(0.5).add(0.3))).mul(mica.mul(0.35).add(1)), 1);
      m.roughnessNode = mix(float(0.8), float(0.22), mica);
      if (!isLite()) m.normalNode = perturb(h, normalView);
    } else if (k === 'leaf') {
      // feuille de houx : nervure médiane (le long de x), nervures secondaires,
      // cuticule cireuse brillante
      const x = pw.x.add(2.1), z = pw.z.sub(0.6);
      const mid = exp(z.mul(z).div(0.06).negate());
      const sec = exp(pow(sin(x.mul(0.9).sub(abs(z).mul(0.7)).mul(3.1416 / 2)), 2).mul(-24).sub(0)).mul(smoothstep(0.1, 0.5, abs(z)));
      const blis = fbm(p3.mul(0.6), 3);
      // cellules de l'épiderme (~40 µm), bombées sous la cuticule
      const cellF = worley(p3.mul(25));
      const cells = smoothstep(0, 0.35, cellF.y.sub(cellF.x));
      const h = mid.mul(0.06).sub(sec.mul(0.018)).add(blis.mul(0.03)).add(cells.mul(0.0012));
      m.colorNode = vec4(mix(U.color, U.color2, mid.mul(0.8).add(sec.mul(0.3))).mul(blis.mul(0.15).add(1)), 1);
      m.roughnessNode = float(0.5);
      m.clearcoatNode = float(0.2);
      m.clearcoatRoughnessNode = float(0.38);
      m.specularIntensityNode = float(0.25);
      if (!isLite()) m.normalNode = perturb(h, normalView);
    } else { // fond du tricot (entre les mailles, dans l'ombre)
      m.colorNode = vec4(U.color.mul(0.12), 1);
      m.roughnessNode = float(0.9);
    }
    m.mrtNode = stableVelocity();
    return m;
  }

  // Fibres de laine (gen/wool.js, d'après Zhao et al. 2016 et Wu et Yuksel 2017).
  // Reflet : un tube (Sadeghi et al. 2010) — anisotropie le long de la fibre ;
  // fibre de cœur : striée en hélice (les fibres du centre du brin, au pas α),
  // relief compris ; ombre ambiante : distance au centre du fil, rangs voisins.
  function fiberMaterial(far = false) {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const fb = attribute('fb', 'vec4');
    const occ = fb.z, isLoose = smoothstep(1.5, 2, fb.w), isCore = smoothstep(0.5, 0, fb.w);
    // cœur : phase de l'hélice des fibres (en tours) = angle − longueur / α
    const phase = fb.x.sub(fb.y.div(1.3));
    const n1 = noise(vec3(fb.x.mul(6), fb.y.mul(3), 0));
    const stripes = cos(phase.mul(26 * 2 * Math.PI).add(n1.mul(2.5))).mul(0.5).add(0.5);
    const shade = mix(fb.x.mul(0.6).add(1.0), stripes.mul(0.6).add(0.5), isCore)
      .mul(mix(float(1), float(0.18), occ.pow(1.2)));
    m.colorNode = vec4(U.color.mul(shade).mul(mix(float(1), float(1.2), isLoose)), 1);
    m.metalnessNode = float(0);
    m.roughnessNode = float(0.42);
    m.specularIntensityNode = mix(float(0.35), float(0.04), occ);
    if (!isLite()) {
      m.anisotropyNode = vec2(0.85, 0); // (le long de la tangente : la fibre)
      if (!far) m.normalNode = perturb(stripes.mul(0.004).mul(isCore), normalView);
    }
    // duvet à contre-jour
    m.sheenNode = mix(float(0.3), float(0.04), occ);
    m.sheenColorNode = U.color.mul(1.6).add(vec3(0.01, 0.01, 0.012));
    m.sheenRoughnessNode = float(0.5);
    m.mrtNode = stableVelocity();
    return m;
  }

  function woolGeometry(o) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
    if (o.tangent) g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
    g.setAttribute('fb', new THREE.BufferAttribute(o.fb, 4));
    g.setIndex(new THREE.BufferAttribute(o.index, 1));
    g.computeBoundingSphere();
    return g;
  }

  function setRecipe(R, clearR) {
    const v = ++version;
    clear();
    frostPoints = null;
    kind = R.sub.kind;
    U.color.value.set(R.sub.color); U.color2.value.set(R.sub.color2);
    U.field.value.set(R.sub.color);
    if (kind === 'wool') {
      add(disc(-1.25), planeMaterial('base'), { shadow: false });
      pending = 1;
      gen.request({ seed: R.crystal.seed % 97, clear: clearR, lite }, 'wool').then((o) => {
        if (v !== version) return;
        add(woolGeometry(o.near), fiberMaterial(false), { shadow: false });
        add(woolGeometry(o.far), fiberMaterial(true), { shadow: false });
        // ombres portées : les brins en tubes simples, vus de la seule carte d'ombre
        const sh = add(woolGeometry(o.shadow), new THREE.MeshBasicNodeMaterial(), { shadow: true });
        sh.layers.set(2);
        frostPoints = o.frost;
        pending = 0;
      }).catch((e) => { console.error(e); pending = 0; });
    } else {
      pending = 0;
      add(disc(0), planeMaterial(kind), { shadow: false });
      // givre : à plat sur le support, dressé vers le haut
      const pts = [];
      let h = R.crystal.seed;
      const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
      // (en touffes, comme le givre qui prend sur les aspérités ; rien sur le verre éclairé par-dessous)
      if (kind !== 'glass' && kind !== 'sapphire') {
        for (let c = 0; c < 260; c++) {
          const r = 1 + 6 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
          const k = 3 + Math.floor(rnd() * 14);
          for (let i = 0; i < k; i++) pts.push(cx + (rnd() - 0.5) * 0.12, 0, cz + (rnd() - 0.5) * 0.12, 0, 1, 0);
        }
      }
      frostPoints = new Float32Array(pts);
    }
  }

  return {
    group, U, setRecipe,
    backlit: () => kind === 'glass' || kind === 'sapphire',
    ready: () => pending === 0,
    get frostPoints() { return frostPoints; },
    update(k) { U.frost.value = k.frost; },
  };
}
