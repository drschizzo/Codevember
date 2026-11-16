// La vapeur et le nuage : UN volume, lu dans la simulation du panache
// (gen/plume.js : une texture 3D (r, z, temps) du traceur) et marché dans la
// chaîne d'image, après la passe de scène, avant l'anticrénelage temporel qui
// lisse le tramage.
//
// La simulation est axisymétrique et lisse. Le rendu lui rend le désordre d'un
// vrai panache sans toucher à sa dynamique : les coordonnées de lecture sont
// déformées par un bruit qui dérive (les volutes), puis la densité est érodée
// par deux échelles de Worley inversé (les bourgeons, d'après Schneider,
// « The real-time volumetric cloudscapes of Horizon Zero Dawn »). La colonne
// de vapeur et le nuage passent par la même fonction : il n'y a pas de couture.
//
// Sous le niveau de condensation (z = 1), le traceur est en partie invisible
// (c'est encore de la vapeur) : la base du nuage est plate.
//
// Lumière : deux prélèvements vers la lampe (loi de Beer), une ambiance qui
// fonce quand le nuage se charge, et les éclairs comme sources ponctuelles à
// l'intérieur (le nuage devient une lanterne).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, uniformArray, vec2, vec3, vec4, float, screenUV, screenCoordinate, perspectiveDepthToViewZ, texture3D,
  normalize, cross, length, dot, exp, sqrt, smoothstep, mix, select, min as tMin, max as tMax, fract, clamp, step, sin, cos,
} from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export const N_LIGHTS = 6;

export function createCloud() {
  const U = {
    c: uniform(new THREE.Vector3(0, 1.8, 0)),      // centre de la base (le niveau de condensation)
    R: uniform(1), H: uniform(0.9),
    vis: uniform(1), visOld: uniform(0), rag: uniform(0), ragOld: uniform(0), dark: uniform(0), dens: uniform(1),
    tint: uniform(new THREE.Color('#ffffff')), shade: uniform(new THREE.Color('#556070')), amb: uniform(0.5),
    sun: uniform(new THREE.Vector3(0.5, 0.7, 0.3)), sunCol: uniform(new THREE.Color('#ffffff')),
    drift: uniform(0), seed: uniform(0), frame: uniform(0),
    steamP: uniform(new THREE.Vector3(0, 0.5, 0)), span: uniform(1), kr: uniform(0.6),
    simT: uniform(0), simSize: uniform(new THREE.Vector3(1.6, 1.7, 72)), // étendue (r, z) de la simulation, nombre d'images
    lights: uniformArray(Array.from({ length: N_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'), // xyz, intensité
    lcol: uniform(new THREE.Color('#bcd0ff')),
    camPos: uniform(new THREE.Vector3()), camWorld: uniform(new THREE.Matrix4()), projInv: uniform(new THREE.Matrix4()), near: uniform(0.05), far: uniform(80),
  };

  // la simulation : texture 3D (r, z, temps), remplacée à chaque scène
  const blank = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2);
  blank.format = THREE.RedFormat; blank.needsUpdate = true;
  const sim = texture3D(blank);
  // les volumes de bruit du nuage (gen/cloudnoise.js), posés une fois
  const blank4 = new THREE.Data3DTexture(new Uint8Array(32).fill(128), 2, 2, 2);
  blank4.needsUpdate = true;
  const shapeT = texture3D(blank4), detailT = texture3D(blank4);
  function setNoise(N) {
    const mk = (data, n) => {
      const t = new THREE.Data3DTexture(data, n, n, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
      t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    };
    shapeT.value = mk(N.shape, N.shapeSize); detailT.value = mk(N.detail, N.detailSize);
  }
  function setSimulation(P) {
    const t = new THREE.Data3DTexture(P.frames, P.NR, P.NZ, P.NF);
    t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    const old = sim.value;
    sim.value = t;
    old?.dispose();
    U.simSize.value.set(P.NR * P.DX, P.NZ * P.DX, P.NF);
  }

  // densité au point p (monde) : la vapeur et le nuage, un seul champ
  // (fine = false : pour les prélèvements vers la lampe — ni volutes ni petite
  // échelle de bourgeons, deux lectures de texture au lieu de quatre)
  const density = (p, fine = true) => {
    // (piège TSL : un nœud est émis à sa première lecture, dans la portée de
    // cette lecture ; les grandeurs lues dans plusieurs branches (If) sont donc
    // des variables posées ici, sinon la lecture du champ change quand une
    // branche cesse d'être prise — le nuage « sautait » à u = 0,65 et au raccord)
    const V = (x) => (fine ? x.toVar() : x);
    const z0 = V(p.y.sub(U.steamP.y).div(U.span));
    // l'axe du panache : de la source (la tasse, le bec) à l'aplomb du nuage
    const o = vec3(U.seed, U.drift, U.seed.mul(1.7));
    // (la colonne serpente : elle ne monte jamais droit, et pas deux fois pareil)
    const snake = vec2(sin(z0.mul(5.3).add(U.seed.mul(3.1)).add(U.drift.mul(1.5708))), sin(z0.mul(4.1).add(U.seed.mul(5.3)))).mul(U.span.mul(0.05)).mul(smoothstep(0.04, 0.4, z0)).mul(smoothstep(1.05, 0.75, z0));
    const ctr = V(mix(U.steamP.xz, U.c.xz, smoothstep(0, 0.85, z0)).add(snake));
    // volutes : la lecture est déformée par un bruit lent, davantage dans le nuage
    const wn = fine ? V(NZ(p.mul(1.15).add(o)).level(0)) : vec4(0);
    const amt = smoothstep(0.02, 0.6, z0).mul(0.7).add(0.3);
    // La simulation est axisymétrique : lue telle quelle, le nuage est un palet.
    // Son plan est donc lobé (trois harmoniques de l'azimut, phases tirées de la
    // graine : un côté s'étale en enclume, l'autre se creuse), et son sommet
    // bourgeonne (les dômes d'un Worley de basse fréquence soulèvent la lecture).
    // Dans la colonne, la vapeur est turbulente à plus petite échelle que le
    // nuage : une deuxième déformation, plus serrée en travers qu'en hauteur,
    // la tord en volutes (le panache simulé, lui, reste lisse : 64 cellules)
    // (et près de l'axe, en s'effaçant vers le bord : la colonne n'occupe qu'une
    // fraction de la boîte de marche, et la déformation ne doit pas y faire de couture)
    const colW = V(smoothstep(0.95, 0.5, z0).mul(smoothstep(U.span.mul(U.kr).mul(0.75), U.span.mul(U.kr).mul(0.45), length(p.xz.sub(ctr)))));
    // (lue seulement dans la colonne : au-dessus, elle ne compte plus)
    let wc = vec4(0);
    if (fine) {
      wc = vec4(0).toVar();
      If(colW.greaterThan(0.002), () => { wc.assign(NZ(vec3(p.x.mul(3.4), p.y.mul(1.3), p.z.mul(3.4)).add(vec3(o.x.mul(0.8), o.y, o.z.mul(0.8)))).level(0)); }); // (dérive entière : un nombre entier de périodes par boucle)
    }
    const q = p.xz.sub(ctr).add(wn.xy.mul(0.16).mul(amt).mul(U.span)).add(wc.xy.mul(0.075).mul(colW).mul(U.span)), ql = length(q).max(1e-4);
    const cs = q.div(ql), c1 = cs.x, s1 = cs.y, s2 = s1.mul(c1).mul(2), c2 = c1.mul(c1).sub(s1.mul(s1)), s3 = s1.mul(3).sub(s1.mul(s1).mul(s1).mul(4));
    const f1 = U.seed.mul(2.4), f2 = U.seed.mul(4.1).add(1), f3 = U.seed.mul(1.3).add(2);
    const lobes = s1.mul(cos(f1)).add(c1.mul(sin(f1))).mul(0.2).add(s2.mul(cos(f2)).add(c2.mul(sin(f2))).mul(0.15)).add(s3.mul(cos(f3)).mul(0.08));
    const inCloud = smoothstep(0.8, 1.15, z0);
    const r = V(ql.div(U.span.mul(U.kr)).div(lobes.mul(inCloud).add(1)));
    const dome = fine ? wn.z.min(1).oneMinus().sub(0.45).mul(0.42).mul(smoothstep(1.0, 1.35, z0)) : float(0);
    // (les étages du panache simulé, rendus nets, se lisaient en strates : la lecture verticale est tordue plus fort dans le nuage)
    const z = V(z0.add(wn.x.mul(0.07).add(wn.y.mul(0.1).mul(smoothstep(0.9, 1.2, z0))).mul(amt)).sub(dome));
    const inside = V(step(r, U.simSize.x.mul(0.985)).mul(step(0.004, z)).mul(step(z, U.simSize.y.mul(0.995))));
    // Le champ est lu à deux instants : le cycle en cours (simT) et la dernière
    // image du cycle précédent — son nuage, vidé par la pluie, qui se défait
    // pendant que la colonne suivante monte. Mêmes coordonnées, même bruit,
    // même lumière : une seule matière, à deux âges.
    const tw = U.simT.mul(U.simSize.z.sub(1)).add(0.5).div(U.simSize.z), twOld = U.simSize.z.sub(0.5).div(U.simSize.z);
    const roof = U.simSize.y.mul(0.995).sub(r.div(U.simSize.x).pow2().mul(0.42));
    // (le cœur du panache monte jusqu'au couvercle : au-dessus du nuage, il
    // perçait le sommet en cheminée. Dans le haut du nuage, il s'efface et
    // prend la hauteur de la couronne)
    const chimney = smoothstep(0.32, 0.1, r).mul(smoothstep(roof.sub(0.45), roof.sub(0.15), z)).mul(smoothstep(1.15, 1.35, z)).mul(0.85).oneMinus(); // (seulement sous le toit : plus bas, il étranglait la jonction de la colonne et du nuage)
    const read = (t) => {
      const at = (dz) => sim.sample(vec3(r.div(U.simSize.x), z.add(dz).div(U.simSize.y), t)).level(0).r;
      // (dans la colonne, le champ est lissé en hauteur : la source bat, et ses
      // bouffées régulières, rendues nettes, empilaient des anneaux)
      const v0 = (fine ? mix(at(0), at(-0.06).add(at(0)).add(at(0.06)).div(3), smoothstep(0.98, 0.7, z)) : at(0)).mul(chimney);
      // (le panache simulé s'étale en couronne, plus haute que son cœur : au-dessus de la base, le cœur prend aussi
      // ce que la couronne a à sa hauteur — un sommet bombé, pas un cratère)
      return fine ? v0.max(sim.sample(vec3(r.max(0.8).div(U.simSize.x), z.div(U.simSize.y), t)).level(0).r.mul(smoothstep(1.05, 1.3, z0))) : v0;
    };
    // (la seconde lecture n'a lieu que pendant que le nuage précédent se défait :
    // un branchement sur un uniforme, le même pour tous les pixels)
    // (pour l'ombre — fine = false, quatre lectures par point éclairé — une
    // seule lecture suffit : celle du cycle qui domine)
    let sv, wOld;
    if (fine) {
      const svA = V(read(tw).mul(U.vis));
      const svB = float(0).toVar();
      If(U.visOld.greaterThan(0), () => { svB.assign(read(twOld).mul(U.visOld)); });
      sv = V(svA.max(svB)); wOld = V(svB.div(svA.add(svB).add(1e-3)));
    } else {
      const old = U.visOld.greaterThan(U.vis);
      sv = read(select(old, twOld, tw)).mul(U.vis.max(U.visOld)); wOld = select(old, float(1), float(0));
    }
    // (enregistré en racine carrée : 8 bits suffisent pour les voiles minces ;
    // le plafond du domaine est adouci, sinon le sommet serait une table. Un
    // nuage qui se défait voit son enveloppe baisser : le bruit le ronge par
    // lambeaux, il ne pâlit pas d'un bloc)
    // (le plafond simulé est un couvercle plat : le nuage mûr le remplit en
    // dalle, et son ombre propre tirait une ligne droite en travers du sommet.
    // Lu à travers un toit en dôme, plus bas vers le bord, avec une rampe
    // longue que les dômes du Worley découpent : un sommet bombé)
    const env = V(sv.mul(inside).mul(smoothstep(roof, roof.sub(0.32), z)));
    // Le modèle de densité des nuages temps réel (Schneider 2015) : le champ
    // simulé est la « couverture » ; un Perlin-Worley de basse fréquence en
    // dessine les bourgeons (ses creux sont ceux d'un Worley : des choux liés,
    // pas des billes), puis un Worley fractal fin, lu dans un volume de 32³ qui
    // tient dans le cache, ronge la peau — en mèches à la base du nuage, en
    // volutes arrondies au sommet. Une déformation lente (le gradient du bruit
    // commun) tord la lecture du détail : les bords bouillonnent.
    // (dérive : un nombre entier de tuiles par boucle — drift vaut ±4 tours)
    const dr = U.drift.mul(0.25);
    const erode = () => {
      const col = smoothstep(0.95, 0.55, z);                 // la colonne de vapeur
      const rim = smoothstep(U.R.mul(0.6), U.R.mul(1.08), length(p.xz.sub(U.c.xz)));
      const ragE = mix(U.rag, U.ragOld, wOld);                // effilochement (pluie, dislocation)
      // forme : Perlin-Worley remappé par son propre Worley fractal
      const sN = shapeT.sample(p.mul(0.85).add(vec3(o.x.mul(0.37), dr, o.z.mul(0.29)))).level(0);
      const fbm = sN.g.mul(0.625).add(sN.b.mul(0.25)).add(sN.a.mul(0.125));
      const base = sN.r.sub(fbm.sub(1)).div(fbm.oneMinus().add(1));       // remap(r, fbm − 1, 1, 0, 1)
      // couverture : l'enveloppe simulée, réduite sur le pourtour, sous la pluie, dans la colonne
      const cov = env.mul(ragE.mul(0.45).add(rim.mul(0.25)).add(col.mul(0.32)).oneMinus()).clamp(0, 1);
      // (l'enveloppe et la forme se soustraient comme des distances : au cœur,
      // la forme ne creuse rien ; vers le bord, elle découpe des bourgeons francs)
      // (remap de Schneider : là où la couverture est faible, seuls les sommets
      // du bruit restent — des bourgeons ; au cœur, tout reste. La couverture ne
      // sature qu'en profondeur, sinon un champ dense donne un galet lisse)
      const c2 = smoothstep(0.02, 0.85, cov);
      const shaped = base.sub(c2.oneMinus()).div(c2.max(0.02)).clamp(0, 1).mul(c2);
      if (!fine) return shaped.sub(0.1).div(0.9).clamp(0, 1);   // (pour l'ombre : le détail moyen)
      const out = float(0).toVar();
      If(shaped.greaterThan(0.002), () => {
        // détail : trois octaves de Worley, la lecture tordue par le bruit lent ;
        // dans la colonne, étiré dans le sens de la montée (des filaments)
        const curl = vec3(wn.x, wn.y, wc.x.add(wn.x).mul(0.5)).mul(0.11).add(vec3(wc.x, wc.z.sub(0.5), wc.y).mul(colW.mul(0.12)));
        const q = p.add(curl);
        const stretch = vec3(col.mul(0.5).add(1), col.mul(-0.3).add(1), col.mul(0.5).add(1));
        const dN = detailT.sample(q.mul(stretch).mul(4.2).add(vec3(o.x.mul(0.7), dr.mul(3), o.z.mul(0.53)))).level(0);
        const hf = dN.r.mul(0.625).add(dN.g.mul(0.25)).add(dN.b.mul(0.125));
        // Une seule matière de la tasse au sommet : la vapeur qui monte est faite
        // des mêmes bourgeons que le nuage qu'elle forme (des bouffées
        // arrondies, avec un peu de mèches), et le nuage n'en diffère que par
        // ce qu'il a accumulé. (Une colonne en mèches sous un nuage en
        // bourgeons se lisait comme deux objets : une boule de coton sur un bâton.)
        const hfrac = z.sub(1).div(U.simSize.y.sub(1)).clamp(0, 1);
        const mod = mix(hf, hf.oneMinus(), hfrac.mul(4).add(0.6).clamp(0, 1));
        const er = ragE.mul(0.25).add(0.5).add(col.mul(0.08)).add(rim.mul(0.08));
        // (contraste final : la peau d'un cumulus est nette — le passage de l'air au nuage tient en quelques centimètres ; la colonne garde un voile)
        const e0 = shaped.sub(mod.mul(er)).div(mod.mul(er).oneMinus()).clamp(0, 1);
        out.assign(smoothstep(0, col.mul(0.3).add(0.22), e0)); // (la vapeur, plus diffuse, a une rampe plus longue : même fonction)
      });
      return out;
    };

    let d;
    if (fine) {
      d = float(0).toVar();
      If(env.greaterThan(0.02), () => { d.assign(erode()); });
    } else d = erode();
    // condensation : sous le niveau z = 1, la vapeur ne se voit qu'en partie
    const cond = smoothstep(0.45, 1.1, z).mul(0.55).add(0.45); // (rampe longue : pas de frontière au niveau de condensation)
    // (la colonne est plus légère que le nuage : c'est dans la densité, continue
    // en hauteur — et non dans le coefficient d'extinction de chaque marche, qui
    // faisait une ligne à leur couture)
    const light = float(1);
    // (gain : un cumulus est opaque à quelques centimètres de sa peau ; la vapeur reste un voile)
    return d.mul(cond).mul(light).mul(U.dens).mul(mix(float(1.5), float(4), smoothstep(0.35, 1.15, z))); // (transition longue : une tête de colonne qui franchit la base n'« éclot » pas d'un coup)
  };

  // intersection rayon / boîte alignée (bmin, bmax) → vec2(t0, t1)
  const slab = (ro, rd, bmin, bmax) => {
    const inv = vec3(1).div(rd);
    const a = bmin.sub(ro).mul(inv), b = bmax.sub(ro).mul(inv);
    const lo = tMin(a, b), hi = tMax(a, b);
    return vec2(tMax(tMax(lo.x, lo.y), lo.z).max(0), tMin(tMin(hi.x, hi.y), hi.z));
  };

  // haze(depth, lite, rgb) → rgb vu à travers le nuage et la vapeur
  const haze = (depthTex, lite, rgb) => Fn(() => {
    const N = lite ? 22 : 64, NS = lite ? 12 : 40; // (itérations au plus ; le pas fin est la longueur de la boîte / 72)
    // rayon de la caméra et distance du premier obstacle. Deux pièges : dans
    // une passe plein écran, les nœuds « caméra » de three.js (cameraPosition,
    // cameraWorldMatrix…) désignent la caméra du quad, pas celle de la scène —
    // elle est donc passée par des uniformes ; et getViewPosition suppose une
    // profondeur OpenGL.
    const dz = depthTex.sample(screenUV).r;
    const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1));
    const far = U.projInv.mul(vec4(ndc, 1, 1));
    const vdir = normalize(far.xyz.div(far.w));
    const ro = U.camPos, rd = normalize(U.camWorld.mul(vec4(vdir, 0)).xyz);
    const tScene = perspectiveDepthToViewZ(dz, U.near, U.far).div(vdir.z);
    // tramage entrelacé (Jimenez), renouvelé à chaque image : le TRAA le lisse
    const j = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189).add(U.frame.mul(0.618034)));
    const col = vec3(rgb).toVar();

    // ── lumière d'un point du volume ──
    // Fonction de phase : Henyey-Greenstein à deux lobes (normalisée à 1 en
    // moyenne) — une goutte diffuse surtout vers l'avant (le liseré d'argent à
    // contre-jour), un peu vers l'arrière.
    const hg = (c, g) => float(1 - g * g).div(float(1 + g * g).sub(c.mul(2 * g)).pow(1.5));
    const cosV = dot(rd, U.sun);
    const ph = (k) => mix(hg(cosV, 0.6 * k), hg(cosV, -0.25 * k), 0.4).min(5);
    const ph0 = ph(1), ph1 = ph(0.5), ph2 = ph(0.25);
    // le cône vers la lampe (Schneider) : six prélèvements de plus en plus
    // espacés, écartés de l'axe d'un noyau fixe (une ombre douce, pas un fil)
    const cone = [[0.05, 0.2, -0.1, 0.12], [0.1, -0.3, 0.2, 0.1], [0.16, 0.1, 0.3, -0.25], [0.23, -0.25, -0.2, 0.3], [0.31, 0.3, -0.05, -0.2], [0.5, 0, 0, 0]];
    const tang = normalize(vec3(U.sun.z, 0, U.sun.x.negate()).add(vec3(0.001, 0, 0))), bit = normalize(cross(U.sun, tang));
    const shade = (p, d, col) => {
      // (distances tramées : à pas fixes, l'ombre dessine les courbes de niveau du champ)
      const sj = j.mul(0.5).add(0.75);
      let od = float(0);
      if (lite) od = d.mul(2.2);
      else {
        let prev = 0;
        for (const [t, a, b, c] of cone) {
          const q = p.add(U.sun.add(tang.mul(a)).add(bit.mul(b)).add(U.sun.mul(c)).mul(sj.mul(t)));
          od = od.add(density(q, false).mul(t - prev));
          prev = t;
        }
        od = od.mul(sj).mul(6.5); // (la densité rendue vaut jusqu'à 4 : ≈ 8 à travers un mètre de nuage)
      }
      // diffusion multiple (Hillaire 2016) : trois octaves, chacune moins
      // éteinte, moins anisotrope et plus faible — le cœur reste gris, pas noir
      const sun = exp(od.negate()).mul(ph0).add(exp(od.mul(-0.5)).mul(ph1).mul(0.5)).add(exp(od.mul(-0.25)).mul(ph2).mul(0.25));
      // « poudre » (Beer-poudre) : une surface juste entamée diffuse peu vers
      // l'arrière — les bourgeons ont un bord sombre et des creux clairs ;
      // à contre-jour, elle disparaît
      const powder = mix(exp(od.mul(-1.6)).oneMinus(), float(1), cosV.mul(0.5).add(0.5).pow2()).mul(0.7).add(0.3);
      // le ciel : l'ambiance vient d'en haut ; ce qui a du nuage au-dessus de
      // soi en reçoit moins (le ventre d'un cumulus est gris) ; un peu de
      // lumière renvoyée par la table éclaire le dessous
      const up = lite ? float(1) : exp(density(p.add(vec3(0, sj.mul(0.22), 0)), false).mul(-2.6));
      // (et ce qui a du nuage autour de soi, vers l'extérieur, aussi : les
      // creux entre les bourgeons s'assombrissent, les bosses s'éclairent —
      // c'est ce qui modèle un nuage vu dans son ombre, à contre-jour)
      const outw = normalize(vec3(p.x.sub(U.c.x), p.y.sub(U.c.y.add(U.H.mul(0.35))).mul(0.6), p.z.sub(U.c.z)).add(vec3(0, 0.001, 0)));
      const side = lite ? float(1) : exp(density(p.add(outw.mul(sj.mul(0.14))), false).mul(-2.4));
      const yn = p.y.sub(U.c.y).div(U.H).clamp(0, 1);
      const sky = mix(U.shade, U.tint.mul(0.85), U.dark.mul(0.75).oneMinus().mul(yn.mul(0.6).add(0.4))).mul(up.mul(0.45).add(0.55)).mul(side.mul(0.75).add(0.25));
      const litc = U.tint.mul(U.sunCol).mul(U.dark.mul(0.35).oneMinus()).mul(1.35);
      col.assign(sky.mul(0.6).add(litc.mul(sun).mul(powder).mul(1.25)).mul(U.amb));
      for (let k = 0; k < N_LIGHTS; k++) { // les éclairs, de l'intérieur
        const Lk = U.lights.element(k), v = Lk.xyz.sub(p);
        col.addAssign(U.lcol.mul(Lk.w.div(dot(v, v).mul(14).add(1))));
      }
    };
    // Marche adaptative : grands pas dans l'air, petits dans le nuage. À pas
    // fixes, un milieu à peau nette se lisait en tranches (des stries fines,
    // parallèles, que l'anticrénelage temporel ne lissait pas). Dès qu'un grand
    // pas touche du nuage, on recule d'un grand pas et on repart à petits pas.
    const march = (bmin, bmax, steps, sigma, fineDiv) => {
      const tc = slab(ro, rd, bmin, bmax);
      const t0 = tc.x, t1 = tMin(tc.y, tScene);
      If(t1.greaterThan(t0).and(U.vis.max(U.visOld).greaterThan(0.001)), () => {
        const small = t1.sub(t0).div(fineDiv).max(0.006), big = small.mul(3);
        const t = t0.add(small.mul(j)).toVar(), T = float(1).toVar(), L = vec3(0).toVar(), inside = float(0).toVar();
        Loop(steps, () => {
          If(t.lessThan(t1).and(T.greaterThan(0.01)), () => {
            const p = ro.add(rd.mul(t));
            const d = density(p);
            If(d.greaterThan(0.004), () => {
              If(inside.lessThan(0.5), () => {
                // (on entre : on recule pour ne pas sauter la peau)
                inside.assign(1); t.subAssign(big.sub(small));
              }).Else(() => {
                const c = vec3(0).toVar();
                shade(p, d, c);
                const a = exp(d.mul(small).mul(-sigma)).oneMinus();
                L.addAssign(c.mul(a).mul(T));
                T.mulAssign(a.oneMinus());
                t.addAssign(small);
              });
            }).Else(() => {
              // (dans l'air : grands pas, après quelques petits pour sortir d'un creux)
              inside.assign(inside.sub(0.25).max(0));
              t.addAssign(select(inside.greaterThan(0), small, big));
            });
          });
        });
        col.assign(col.mul(T).add(L));
      });
    };
    // deux domaines de marche pour un même champ : la colonne (étroite, sous le
    // nuage), puis le nuage (large). La couture est à 0,72 de la montée, dans
    // la colonne : les deux côtés lisent la même densité.
    // (les dômes soulèvent la lecture au-dessus du plafond simulé : la boîte doit les contenir, sinon le sommet est coupé net)
    const top = U.steamP.y.add(U.simSize.y.add(0.25).mul(U.span)), cut = U.steamP.y.add(U.span.mul(0.62));
    const rc = U.span.mul(U.kr).mul(0.62).add(0.12);
    const lo = tMin(U.steamP.xz, U.c.xz).sub(rc), hi = tMax(U.steamP.xz, U.c.xz).add(rc);
    march(vec3(lo.x, U.steamP.y, lo.y), vec3(hi.x, cut, hi.y), NS, 13, lite ? 12 : 44);
    const ext = U.R.mul(1.45); // (les lobes du plan élargissent le nuage jusqu'à 1,4 fois son rayon : une boîte plus étroite les coupait d'un trait vertical)
    march(vec3(U.c.x.sub(ext), cut, U.c.z.sub(ext)), vec3(U.c.x.add(ext), top, U.c.z.add(ext)), N, 13, lite ? 24 : 72);
    return clamp(col, 0, 1e4);
  })();

  return { U, haze, setSimulation, setNoise };
}
