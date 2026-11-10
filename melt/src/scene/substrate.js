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
  fract, floor, length, exp, positionViewDirection, dot, fwidth, atan,
} from 'three/tsl';
import { noise, noise2, fbm, perturb, worley, isLite, stableVelocity } from './materials.js';

export function createSubstrate(scene, gen, { lite = false, contact = null } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const U = {
    color: uniform(new THREE.Color()), color2: uniform(new THREE.Color()), field: uniform(new THREE.Color()), frost: uniform(0), fwd: uniform(new THREE.Vector2(1, 0)),
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
  // Le support se relève en cyclorama derrière le sujet (comme un drap posé
  // contre un mur, ou une feuille qui se courbe) : pas d'horizon, et dans la
  // profondeur de champ d'une macro, un dégradé doux de la même matière.
  // fwd : direction de la caméra vers le sujet (dans le plan du support)
  const sweep = (fwd, y = 0, v0 = 6, Rc = 9) => {
    const nu = 120, nv = 160, W = 40;
    const side = [-fwd[1], fwd[0]];
    const pos = [], idx = [];
    const S = v0 + (Math.PI / 2) * Rc + 30; // (longueur dépliée vers le fond)
    for (let j = 0; j <= nv; j++) {
      const t = j / nv, v = -25 + (S + 25) * t * t * 0.4 + (S + 25) * t * 0.6; // (plus serré près du sujet)
      let f, h;
      if (v <= v0) { f = v; h = 0; }
      else if (v <= v0 + (Math.PI / 2) * Rc) { const a = (v - v0) / Rc; f = v0 + Rc * Math.sin(a); h = Rc * (1 - Math.cos(a)); }
      else { f = v0 + Rc; h = Rc + (v - v0 - (Math.PI / 2) * Rc); }
      for (let i = 0; i <= nu; i++) {
        const l = -W + (2 * W * i) / nu;
        pos.push(fwd[0] * f + side[0] * l, y + h, fwd[1] * f + side[1] * l);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // (faces tournées vers le haut et vers la caméra)
    const n = g.attributes.normal;
    if (n.getY(0) < 0) { g.index.array.reverse(); g.computeVertexNormals(); }
    return g;
  };
  // atténuation d'un motif de fréquence f (cycles / mm) à l'approche de la
  // fréquence du pixel : pas de moiré au loin
  const aaF = (p, f) => smoothstep(0.45, 0.12, fwidth(p.x).add(fwidth(p.z)).mul(f));
  // givre : un semis de petits cristaux (20 à 60 µm), jeté au hasard (une
  // grille décalée aléatoirement, deux échelles tournées l'une par rapport à
  // l'autre : aucune trame), qui pousse au froid et fond au premier soleil ;
  // chaque cristal a sa facette, qui scintille
  const h21 = (c) => fract(sin(dot(c, vec2(127.1, 311.7))).mul(43758.5453));
  const h22 = (c) => vec2(h21(c), h21(c.add(vec2(17.3, 9.1))));
  const sprinkle = (q, scale, density, size) => {
    const g = q.mul(scale), cell = floor(g), f = fract(g);
    const r = h22(cell), keep = smoothstep(density.oneMinus(), density.oneMinus().add(0.02), h21(cell.add(vec2(3.7, 5.9))));
    const d = length(f.sub(r.mul(0.7).add(0.15)));
    const sz = size.mul(h21(cell.add(vec2(8.2, 1.3))).mul(0.7).add(0.5));
    return { m: smoothstep(sz, sz.mul(0.5), d).mul(keep), id: r.x };
  };
  const rime = (p) => {
    const q1 = vec2(p.x, p.z), q2 = vec2(p.x.mul(0.8).sub(p.z.mul(0.6)), p.x.mul(0.6).add(p.z.mul(0.8))).add(vec2(3.1, 7.7));
    const dens = U.frost.mul(0.1);
    const a = sprinkle(q1, 7, dens, float(0.16)), b = sprinkle(q2, 15, dens.mul(0.7), float(0.2));
    const cover = a.m.max(b.m).mul(aaF(p, 12).mul(0.6).add(0.4));
    // (facette : une pente propre à chaque cristal)
    const tilt = a.id.mul(a.m).add(b.id.mul(b.m)).sub(0.5);
    return { cover, h: tilt.mul(cover).mul(0.004).add(cover.mul(0.003)) };
  };

  function planeMaterial(k) {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const pw = positionWorld;
    const p3 = vec3(pw.x, pw.y.mul(0.999), pw.z); // (le cyclorama : la matière continue sur la paroi)
    m.metalnessNode = float(0);
    const R_ = rime(p3);
    if (k === 'velvet') {
      // le poil : des pointes de fibres de ~20 µm, serrées (c'est elles qui
      // donnent l'échelle en macro), couchées par plages (velours écrasé)
      const crush = fbm(p3.mul(0.35), 3).mul(0.5).add(0.5);
      const pile = noise(p3.mul(45)).mul(0.5).mul(aaF(p3, 45)).add(noise2(p3.mul(110)).mul(0.5).mul(aaF(p3, 110))).mul(0.5).add(0.5);
      m.colorNode = vec4(mix(U.color, U.color2, crush.mul(0.4).add(pile.mul(0.6))), 1);
      m.roughnessNode = float(1);
      m.specularIntensityNode = float(0.02);
      m.sheenNode = mix(float(0.08), float(0.4), crush.mul(0.5).add(pile.mul(0.5)));
      m.sheenColorNode = U.color2.mul(0.45).add(0.002);
      m.sheenRoughnessNode = float(0.3);
      if (!isLite()) m.normalNode = perturb(pile.mul(0.004).add(fbm(p3.mul(0.35), 3).mul(0.04)).add(R_.h), normalView);
    } else if (k === 'glass' || k === 'sapphire') {
      // le champ lumineux vu à travers la plaque ; le verre lui-même ne se voit
      // que par ses reflets (vernis)
      m.colorNode = vec4(0, 0, 0, 1);
      m.roughnessNode = float(0.4);
      const r = length(vec2(pw.x, pw.z));
      // sur la plaque, nettes dans le plan du cristal : des poussières et de
      // fines rayures, sombres en lumière transmise (elles donnent l'échelle)
      const q2 = vec3(pw.x, 0, pw.z);
      const dust = smoothstep(0.9, 0.97, noise2(q2.mul(9))).mul(0.55).add(smoothstep(0.93, 0.99, noise(q2.mul(26))).mul(0.4));
      const grime = float(1).sub(dust.mul(aaF(q2, 26)).clamp(0, 0.8));
      if (k === 'sapphire') {
        // le diaphragme de champ du microscope, projeté sur la lame : un
        // polygone à dix lamelles, au bord adouci ; au-delà, le noir
        // (décagone régulier : distance au bord d'un polygone à dix côtés)
        const ang = atan(pw.z, pw.x).add(0.3);
        const seg = 2 * Math.PI / 10;
        const local = ang.sub(floor(ang.div(seg)).mul(seg)).sub(seg / 2);
        const poly = r.mul(cos(local)).div(Math.cos(seg / 2));
        const stop = smoothstep(2.95, 2.8, poly);
        // (un champ un peu plus vif au centre, comme sous un vrai condenseur)
        const hot = float(1.12).sub(r.mul(r).mul(0.02));
        m.emissiveNode = U.field.mul(stop.mul(0.97).add(0.03)).mul(hot).mul(grime);
      } else {
        // la vitre : derrière elle, le ciel d'hiver flou, en dégradé — clair
        // devant (vers le bas de l'image), plus soutenu au loin ; la vitre
        // elle-même ne se voit que par ses poussières et ses reflets
        const far = clamp(dot(vec2(pw.x, pw.z), U.fwd).add(3).div(8), 0, 1);
        const lat = noise2(vec3(pw.x, 0, pw.z).mul(0.12)).mul(0.08);
        m.emissiveNode = mix(U.color, U.color2, smoothstep(0, 1, far.add(lat))).mul(grime);
        // (la vitre ne doit pas renvoyer la boîte à lumière qui fait briller le
        // cristal : elle voilerait toute l'image)
        m.specularIntensityNode = float(0.02);
        m.roughnessNode = float(0.3);
      }
      m.specularIntensityNode = float(0.12); // (la plaque ne renvoie que le ciel, en reflet doux)
    } else if (k === 'slate') {
      // ardoise en macro : un grain serré de quelques dizaines de µm (micas,
      // quartz), des paillettes qui scintillent, et les marches des feuillets
      // (quelques µm de haut, au mm)
      const q = p3.mul(0.6);
      const a = noise(q).add(noise(q.mul(2.3)).mul(0.4));
      const plate = smoothstep(-0.03, 0.03, a).mul(0.5).add(smoothstep(0.35, 0.39, a).mul(0.5));
      const grain = noise(p3.mul(28)).mul(0.5).mul(aaF(p3, 28)).add(noise2(p3.mul(70)).mul(0.35).mul(aaF(p3, 70))).add(noise(p3.mul(150)).mul(0.15).mul(aaF(p3, 150)));
      const h = plate.mul(0.008).add(grain.mul(0.0025)).add(fbm(p3.mul(0.15), 3).mul(0.02));
      const mica = smoothstep(0.8, 0.95, noise2(p3.mul(55))).mul(aaF(p3, 55));
      m.colorNode = vec4(mix(U.color, U.color2, plate.mul(0.25).add(grain.mul(0.5).add(0.3))).mul(mica.mul(0.35).add(1)), 1);
      m.roughnessNode = mix(float(0.8), float(0.22), mica);
      if (!isLite()) m.normalNode = perturb(h.add(R_.h), normalView);
    } else if (k === 'leaf') {
      // feuille de houx : nervure médiane (le long de x), nervures secondaires,
      // cuticule cireuse brillante
      const x = pw.x.add(2.1), z = pw.z.sub(0.6);
      const mid = exp(z.mul(z).div(0.06).negate());
      const sec = exp(pow(sin(x.mul(0.9).sub(abs(z).mul(0.7)).mul(3.1416 / 2)), 2).mul(-24).sub(0)).mul(smoothstep(0.1, 0.5, abs(z)));
      const blis = fbm(p3.mul(0.6), 3);
      // cellules de l'épiderme (~40 µm), bombées sous la cuticule
      const cellF = worley(p3.mul(25));
      const cells = smoothstep(0, 0.35, cellF.y.sub(cellF.x)).mul(aaF(p3, 25));
      const h = mid.mul(0.06).sub(sec.mul(0.018)).add(blis.mul(0.03)).add(cells.mul(0.0012));
      m.colorNode = vec4(mix(U.color, U.color2, mid.mul(0.8).add(sec.mul(0.3))).mul(blis.mul(0.15).add(1)), 1);
      m.roughnessNode = float(0.5);
      m.clearcoatNode = float(0.2);
      m.clearcoatRoughnessNode = float(0.38);
      m.specularIntensityNode = float(0.25);
      if (!isLite()) m.normalNode = perturb(h.add(R_.h), normalView);
    } else { // fond du tricot (entre les mailles, dans l'ombre)
      m.colorNode = vec4(U.color.mul(0.12), 1);
      m.roughnessNode = float(0.9);
    }
    if (k === 'velvet' || k === 'slate' || k === 'leaf' || k === 'glass') {
      // le givre : blanc, lisse, chaque petit cristal renvoie le ciel à sa façon
      const c = R_.cover;
      m.colorNode = vec4(mix(m.colorNode.xyz, vec3(0.6, 0.65, 0.72), c), 1);
      m.roughnessNode = mix(m.roughnessNode, float(0.16), c);
      m.specularIntensityNode = mix(m.specularIntensityNode ?? float(0.5), float(1), c);
      if (m.sheenNode) m.sheenNode = m.sheenNode.mul(c.oneMinus());
    }
    // ombre de contact du cristal et des gouttes (pas sur la table lumineuse :
    // la lumière y vient d'en dessous)
    if (contact && k !== 'glass' && k !== 'sapphire') {
      const ao = contact();
      m.aoNode = ao;
      m.colorNode = vec4(m.colorNode.xyz.mul(mix(float(1), ao, 0.55)), 1);
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
    if (contact) {
      const ao = contact();
      m.aoNode = ao;
      m.colorNode = vec4(m.colorNode.xyz.mul(mix(float(1), ao, 0.55)), 1);
    }
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
    const fwd = [-Math.cos(R.camera.az), -Math.sin(R.camera.az)]; // (de la caméra vers le sujet)
    U.fwd.value.set(fwd[0], fwd[1]);
    U.color.value.set(R.sub.color); U.color2.value.set(R.sub.color2);
    U.field.value.set(R.sub.color);
    if (kind === 'wool') {
      add(sweep(fwd, -1.25, 9, 10), planeMaterial('base'), { shadow: false });
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
      add(kind === 'glass' || kind === 'sapphire' ? disc(0) : sweep(fwd, 0), planeMaterial(kind), { shadow: false });
      // givre : à plat sur le support, dressé vers le haut
      const pts = [];
      let h = R.crystal.seed;
      const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
      // (sur les supports plats, le givre est dans la matière : rime())
      frostPoints = new Float32Array(pts);
    }
  }

  return {
    group, U, setRecipe,
    backlit: () => kind === 'sapphire',
    ready: () => pending === 0,
    get frostPoints() { return frostPoints; },
    update(k) { U.frost.value = k.frost; },
  };
}
