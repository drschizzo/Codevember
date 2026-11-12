// Le sable et l'eau : un seul maillage, un seul matériau.
//
// Le maillage (2 sommets par cellule de simulation) est déplacé dans le
// vertex shader : le lit b, lu dans la texture du relief courant (scene/
// gpusim.js) en interpolation bicubique (Catmull-Rom), et la surface libre
// de l'eau η là où elle le recouvre — la ligne d'eau est l'intersection
// d'une surface lisse (η, demi-résolution) et du lit fin : elle est nette.
//
// Au pixel :
//   – la couleur du sable vient de ce que la surface montre : la couche dont
//     on a atteint la profondeur sous la surface de départ (strates parallèles
//     au gabarit), ou un dépôt frais (lamines obliques), ou la surface neuve ;
//     grains de couleurs (minéraux lourds sombres, quartz clairs) effacés
//     avant la fréquence du pixel ;
//   – le relief fin : rides de courant (là où l'eau a longtemps coulé, crêtes
//     perpendiculaires à la pente), grain, stries du gabarit sur le sable neuf ;
//   – l'humidité : le sable mouillé fonce et se lustre, sèche des crêtes vers
//     les creux pendant le séchage ;
//   – l'eau est un vernis (clearcoat) à sa propre normale (gradient de η et
//     rides entraînées par le courant, en boucle) ; sous elle, le fond est
//     atténué (Beer-Lambert) et voilé par la turbidité.
import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, ivec2, int, uniform, uniformArray, positionGeometry, textureLoad, texture, floor, fract, clamp,
  mix, smoothstep, max as tmax, min as tmin, sqrt, exp, sin, cos, dot, normalize, length, abs, varyingProperty, cameraViewMatrix,
  fwidth, Loop, If, select, positionView, step, pow, positionPrevious,
} from 'three/tsl';
import { TABLE, MAX_LAYERS } from '../gen/table.js';
import { G } from './globals.js';
import { noise, NZ, perturb, isLite, stableVelocity } from './materials.js';

const srgb = (hex) => new THREE.Color(hex); // (THREE.Color convertit en linéaire)

export function createSand(gs) {
  const lite = isLite();
  const { NX, NY, HX, HY, l } = gs;
  const Lx = TABLE.Lx, Ly = TABLE.Ly;
  const MX = (lite ? 1 : 2) * NX, MY = (lite ? 1 : 2) * NY;

  // ── Maillage : grille au repos (X, 0, Z) ──
  const geo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(MX * MY * 3), nor = new Float32Array(MX * MY * 3);
    for (let j = 0; j < MY; j++) for (let i = 0; i < MX; i++) {
      const o = (j * MX + i) * 3;
      pos[o] = (i / (MX - 1)) * Lx - Lx / 2; pos[o + 1] = 0.09; pos[o + 2] = (j / (MY - 1)) * Ly - Ly / 2;
      nor[o + 1] = 1;
    }
    const idx = new Uint32Array((MX - 1) * (MY - 1) * 6);
    let k = 0;
    for (let j = 0; j < MY - 1; j++) for (let i = 0; i < MX - 1; i++) {
      const a = j * MX + i, b = a + 1, c = a + MX, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.08, 0), 0.8);
  }

  // ── Uniformes ──
  const U = {
    layerBottom: uniformArray(new Array(MAX_LAYERS).fill(1), 'float'),
    layerColor: uniformArray(Array.from({ length: MAX_LAYERS }, () => new THREE.Color(0.6, 0.5, 0.4)), 'color'),
    nLayers: uniform(1, 'int'),
    deposit: uniform(new THREE.Color(0.6, 0.55, 0.45)),
    meanTone: uniform(new THREE.Color(0.6, 0.5, 0.4)), // (ton moyen des strates : le voile de grains roulés)
    pits: uniform(0),           // cratères des gouttes (0–1 : la pluie a commencé à cribler le sable)
    grainDark: uniform(new THREE.Color(0.08, 0.07, 0.06)),
    grainAmt: uniform(0.18),
    dry: uniform(0),            // séchage (0 humide → 1 sec)
    dryLift: uniform(1.28),     // éclaircissement du sable sec
    wetDark: uniform(0.55),     // assombrissement du sable mouillé
    mud: uniform(new THREE.Color(0.42, 0.33, 0.22)),
    mudScale: uniform(1),
    turbK: uniform(3600),       // opacité de la turbidité (par m d'eau, par fraction volumique)
    absorb: uniform(new THREE.Vector3(3.2, 1.6, 1.1)), // absorption de l'eau (1/m) — une eau claire de quelques cm
    rippleAmp: uniform(0.0003),
    flowPhase: uniform(0),      // phase des rides d'eau (tours entiers par boucle)
    waterOn: uniform(1),
  };

  const tTerr = gs.terrainTex, tWat = gs.waterTex, tNrm = gs.normalTex;
  const ld = (tex, x, y, nx, ny) => textureLoad(tex, ivec2(clamp(x, int(0), int(nx - 1)), clamp(y, int(0), int(ny - 1))));

  // bilinéaire « à la main » (textures en flottants 32 bits, non filtrables)
  const bilin = (tex, nx, ny, cx, cy) => {
    const ix = int(floor(cx)), iy = int(floor(cy));
    const fx = fract(cx), fy = fract(cy);
    const a = ld(tex, ix, iy, nx, ny), b = ld(tex, ix.add(1), iy, nx, ny);
    const c = ld(tex, ix, iy.add(1), nx, ny), d = ld(tex, ix.add(1), iy.add(1), nx, ny);
    return mix(mix(a, b, fx), mix(c, d, fx), fy);
  };
  // B-spline bicubique par quatre lectures bilinéaires (Sigg et Hadwiger) : C² continu,
  // les normales ne dessinent plus la grille sous une lumière rasante
  const bspline = (tex, c) => {
    const f = fract(c), i = floor(c);
    const w0 = float(1).sub(f).pow(3).div(6);
    const w1 = f.mul(f).mul(f.mul(3).sub(6)).add(4).div(6);
    const w2 = f.mul(f).mul(f.mul(-3).add(3)).add(f.mul(3)).add(1).div(6);
    const w3 = f.pow(3).div(6);
    const g0 = w0.add(w1), g1 = w2.add(w3);
    const h0 = w1.div(g0).sub(1).add(i).add(0.5), h1 = w3.div(g1).add(1).add(i).add(0.5);
    const inv = vec2(1 / NX, 1 / NY);
    const s00 = texture(tex, vec2(h0.x, h0.y).mul(inv)), s10 = texture(tex, vec2(h1.x, h0.y).mul(inv));
    const s01 = texture(tex, vec2(h0.x, h1.y).mul(inv)), s11 = texture(tex, vec2(h1.x, h1.y).mul(inv));
    return mix(mix(s11, s10, g0.y), mix(s01, s00, g0.y), g0.x);
  };
  const cellOf = (X, Z) => vec2(X.add(Lx / 2).div(l).sub(0.5), Z.add(Ly / 2).div(l).sub(0.5));
  const hcellOf = (X, Z) => vec2(X.add(Lx / 2).div(2 * l).sub(0.5), Z.add(Ly / 2).div(2 * l).sub(0.5));

  // ── Vertex : lit bicubique, surface libre ──
  const vB = varyingProperty('float', 'vBed');
  const positionNode = Fn(() => {
    const p = positionGeometry;
    const c = cellOf(p.x, p.z);
    const ix = int(floor(c.x)), iy = int(floor(c.y));
    const fx = fract(c.x), fy = fract(c.y);
    const wts = (t) => [
      t.mul(t.mul(float(2).sub(t)).sub(1)).mul(0.5),
      t.mul(t).mul(t.mul(3).sub(5)).add(2).mul(0.5),
      t.mul(t.mul(float(4).sub(t.mul(3))).add(1)).mul(0.5),
      t.sub(1).mul(t).mul(t).mul(0.5),
    ];
    const wx = wts(fx), wy = wts(fy);
    let b = float(0);
    const inner = [];
    for (let j = 0; j < 4; j++) {
      let row = float(0);
      for (let i = 0; i < 4; i++) {
        const v = ld(tTerr, ix.add(i - 1), iy.add(j - 1), NX, NY).x;
        if ((i === 1 || i === 2) && (j === 1 || j === 2)) inner.push(v);
        row = row.add(v.mul(wx[i]));
      }
      b = b.add(row.mul(wy[j]));
    }
    // Catmull-Rom borné par les quatre cellules qui entourent le sommet : pas de
    // dépassement au bord d'une berge (le dépassement arrondissait les crêtes en
    // bourrelets et creusait un sillon au pied des parois)
    b = clamp(b, tmin(tmin(inner[0], inner[1]), tmin(inner[2], inner[3])), tmax(tmax(inner[0], inner[1]), tmax(inner[2], inner[3])));
    vB.assign(b);
    const h = hcellOf(p.x, p.z);
    const eta = bilin(tWat, HX, HY, h.x, h.y).x;
    const P = vec3(p.x, tmax(b, eta.mul(U.waterOn).sub(float(1).sub(U.waterOn))), p.z);
    // pose précédente = pose courante (le relief bouge de quelques µm par image) :
    // sans elle, three prend la grille plate pour la pose précédente, et la vitesse
    // vaut tout le relief (flou de mouvement et anticrénelage temporel faussés)
    positionPrevious.assign(P);
    return P;
  })();

  // ── Couleur du sable ──
  const layerColorAt = Fn(([depth]) => {
    const col = vec3(U.layerColor.element(0)).toVar();
    const top = float(0).toVar();
    const w = tmax(fwidth(depth), 0.00025); // (frontières adoucies au pixel)
    Loop({ start: int(0), end: U.nLayers.sub(1), type: 'int', condition: '<' }, ({ i }) => {
      const bot = U.layerBottom.element(i);
      col.assign(mix(col, vec3(U.layerColor.element(i.add(1))), smoothstep(bot.sub(w), bot.add(w), depth)));
    });
    // lamines dans chaque couche (quelques dixièmes de mm), très peu contrastées
    const lam = sin(depth.mul(2 * Math.PI / 0.0011).add(noise(positionGeometry.mul(40)).mul(2.5))).mul(0.035);
    return col.mul(lam.add(1));
  });

  const material = new THREE.MeshPhysicalNodeMaterial();
  material.positionNode = positionNode;
  if (!lite) material.mrtNode = stableVelocity();

  const waterNormal = Fn(([p, h, Wt, film]) => {
    const n = vec3(0, 1, 0).toVar();
    If(film.greaterThan(0.001), () => {
      const e = 0.5;
      const ex = bilin(tWat, HX, HY, h.x.add(e), h.y).x, ez = bilin(tWat, HX, HY, h.x, h.y.add(e)).x;
      const gwx = ex.sub(Wt.x).div(e * 2 * l), gwz = ez.sub(Wt.x).div(e * 2 * l);
      const vel = Wt.zw;
      // rides : deux lectures du bruit advectées par le courant, décalées d'une demi-période (en boucle)
      const ph0 = fract(U.flowPhase), ph1 = fract(U.flowPhase.add(0.5));
      const wv = abs(ph0.sub(0.5)).mul(2);
      const q0 = vec3(p.x.sub(vel.x.mul(ph0).mul(0.8)), 0.2, p.z.sub(vel.y.mul(ph0).mul(0.8))).mul(160);
      const q1 = vec3(p.x.sub(vel.x.mul(ph1).mul(0.8)), 3.7, p.z.sub(vel.y.mul(ph1).mul(0.8))).mul(160);
      const amp = smoothstep(0.03, 0.25, length(vel)).mul(0.07);
      const rx = mix(noise(q0), noise(q1), wv).mul(amp), rz = mix(noise(q0.add(vec3(17.3, 0, 5.1))), noise(q1.add(vec3(17.3, 0, 5.1))), wv).mul(amp);
      n.assign(normalize(vec3(gwx.negate().add(rx), 1, gwz.negate().add(rz))));
    });
    return n;
  });
  const shade = () => {
    const p = positionGeometry;
    const c = cellOf(p.x, p.z);
    const T = bilin(tTerr, NX, NY, c.x, c.y);       // b, profondeur atteinte sous b₀, dépôt, sable frais
    const A = bspline(tNrm, c);                        // nx, nz, humidité, rides (B-spline bicubique : normales lisses)
    const h = hcellOf(p.x, p.z);
    const Wt = bilin(tWat, HX, HY, h.x, h.y);          // η, turbidité, vx, vy
    const bed = vB;
    const wd = Wt.x.sub(bed).mul(U.waterOn).max(0);    // hauteur d'eau au pixel
    const film = smoothstep(0.00008, 0.0006, wd);

    // ce que montre la surface
    const depth = T.y, dep = T.z;
    const isDep = smoothstep(0.0002, 0.0006, dep);
    // pente : 0 à plat, 1 sur une paroi (normale du lit, B-spline)
    const steep = smoothstep(0.88, 0.6, sqrt(tmax(0.0001, float(1).sub(A.x.mul(A.x)).sub(A.y.mul(A.y)))));
    // la strate se lit à la hauteur vraie du pixel sous la surface de départ
    // (b₀ − y) : sur une paroi, la profondeur interpolée en plan mêlait toutes
    // les couches en un seul ton ; le contact est ondulé de quelques dixièmes de mm
    const b0p = T.x.sub(T.z).add(T.y);
    const contact = noise(vec3(p.x.mul(180), 3.1, p.z.mul(180))).mul(0.0006).add(noise(vec3(p.x.mul(40), 8.3, p.z.mul(40))).mul(0.0008));
    // (à plat, la profondeur atteinte lue en B-spline dans une texture filtrable : seuillée
    // en bilinéaire, elle dessinait les marches de la grille aux contacts des strates)
    const depthS = bspline(gs.occTex, c).z;
    const depthV = mix(depthS, tmax(0, b0p.sub(bed)), steep).add(contact);
    const strat0 = layerColorAt(tmax(0, depthV));
    // à plat, un voile de grains roulés mêle un peu les couches (contraste des affleurements adouci)
    const strat = mix(strat0, vec3(U.meanTone), float(0.32).mul(float(1).sub(steep.mul(0.7))).mul(smoothstep(0.0005, 0.002, depth)));
    // dépôt : lamines obliques (litage entrecroisé) dans l'épaisseur
    const lamD = sin(dep.mul(2 * Math.PI / 0.0009).add(p.x.mul(160)).add(noise(p.mul(22)).mul(3))).mul(0.06);
    let alb = mix(strat, vec3(U.deposit).mul(lamD.add(1)), isDep);
    // marbrure : le tri des grains fait des taches à quelques mm et quelques cm
    const fine = noise(vec3(p.x.mul(720), 7.7, p.z.mul(720))).mul(0.07).mul(smoothstep(0.9, 0.3, fwidth(p.x.mul(720))));
    const mott = noise(vec3(p.x.mul(90), 0.37, p.z.mul(90))).mul(0.05).add(noise(vec3(p.x.mul(260), 2.1, p.z.mul(260))).mul(0.04)).add(noise(vec3(p.x.mul(22), 5.3, p.z.mul(22))).mul(0.04)).add(fine);
    alb = alb.mul(mott.add(1));
    // grains : couleurs du sable (minéraux sombres, quartz clairs), effacés avant le pixel
    const gp = p.xz.div(0.00032);
    const gcell = floor(gp);
    const gh = fract(sin(dot(gcell, vec2(127.1, 311.7))).mul(43758.5453));
    const gh2 = fract(sin(dot(gcell, vec2(269.5, 183.3))).mul(43758.5453));
    const fade = smoothstep(1.2, 0.35, fwidth(gp.x));
    const dark = step(0.86, gh).mul(U.grainAmt.mul(2.2));
    const light = step(gh, 0.1).mul(U.grainAmt);
    alb = alb.mul(float(1).add(gh2.sub(0.5).mul(U.grainAmt).mul(fade)));
    alb = mix(alb, vec3(U.grainDark), dark.mul(fade));
    alb = alb.add(light.mul(fade).mul(0.25));

    // humidité : sable humide (de base), mouillé (là où l'eau est passée), sec (séchage)
    const wetMem = tmax(A.z, film);
    const fresh = T.w;
    // les crêtes sèchent d'abord : le séchage local avance selon la hauteur au-dessus de la mémoire d'eau
    const dryL = clamp(U.dry.mul(1.6).sub(wetMem.mul(0.5)), 0, 1).mul(float(1).sub(fresh));
    const moist = float(1).sub(dryL);
    alb = alb.mul(mix(U.dryLift, float(1), moist));
    const wetL = wetMem.mul(moist);
    alb = mix(alb, alb.mul(alb).mul(1.15).add(alb.mul(0.25)).mul(U.wetDark), wetL);

    // sous l'eau : atténuation et turbidité
    const att = exp(U.absorb.mul(wd).negate().mul(2));
    const tOp = float(1).sub(exp(U.turbK.mul(Wt.y).mul(wd).negate())).mul(film).mul(0.92);
    alb = mix(alb.mul(att), vec3(U.mud), tOp);

    // ── relief fin (hauteur en m, perturbation de Mikkelsen) ──
    const ny = sqrt(tmax(0.0001, float(1).sub(A.x.mul(A.x)).sub(A.y.mul(A.y))));
    const nBed = normalize(vec3(A.x, ny, A.y));
    // rides de courant : crêtes perpendiculaires à la descente, longueur d'onde ~13 mm
    // (tirée vers l'aval : sur un fond presque plat, la normale bruitée faisait tourner les crêtes en volutes)
    const down = normalize(vec2(A.x, A.y).add(vec2(0.05, 0)));
    // (phase sur un axe fixe du bac — le courant y va vers l'aval — et non sur la
    // pente locale : le produit scalaire de la position avec une direction qui varie
    // faisait tourner les crêtes en volutes, un degré décalant la phase d'un cycle)
    const rp = p.x.div(0.013).add(noise(vec3(p.x.mul(22), 0.5, p.z.mul(22))).mul(0.8)).add(noise(vec3(p.z.mul(9), 1.7, p.x.mul(9))).mul(0.5));
    // profil asymétrique lisse (flanc amont long, flanc aval plus raide), sans
    // marche ni cassure : une marche dans le profil dessinait un trait noir le
    // long de chaque crête. Les rides ne naissent que là où un courant a longtemps
    // coulé (chenaux, delta) : une lame de pluie n'en fait pas.
    const th = rp.mul(2 * Math.PI);
    const rprof = sin(th.add(sin(th).mul(0.4)));
    const ripple = rprof.mul(0.5).mul(U.rippleAmp).mul(smoothstep(0.75, 0.98, A.w)).mul(smoothstep(0.0008, 0.003, depth.add(dep)));
    const rFade = smoothstep(0.3, 0.08, fwidth(rp)); // (effacées bien avant la fréquence du pixel : pas de moiré)
    // stries du gabarit sur le sable neuf
    const neuf = float(1).sub(smoothstep(0.0001, 0.0005, depth.add(dep)));
    const streak = noise(vec3(p.z.mul(900), 0.3, p.x.mul(12))).mul(0.000025).mul(neuf).mul(smoothstep(0.6, 0.2, fwidth(p.z.mul(900))));
    // grain en relief : bruit continu (un hachage par cellule faisait des marches,
    // dessinées en pointillés noirs par la perturbation de normale)
    const grainH = noise(vec3(p.x.div(0.0005), 0.71, p.z.div(0.0005))).mul(0.00005).mul(smoothstep(1.0, 0.3, fwidth(p.x.div(0.0005))));
    // parois : stries d'éboulement le long de la plus grande pente, et lamines
    // de la stratification soulignées en relief (les bancs se lisent à la lumière)
    // (deux jeux de stries sur les axes fixes du bac, mêlés selon l'orientation de la
    // paroi : une phase prise sur la pente locale tournait en volutes)
    const gx = vec3(p.z.mul(420), p.x.mul(45), 2.3), gz = vec3(p.x.mul(420), p.z.mul(45), 6.1);
    const wz = down.y.mul(down.y);
    const grooves = mix(noise(gx).mul(smoothstep(0.5, 0.15, fwidth(gx.x))), noise(gz).mul(smoothstep(0.5, 0.15, fwidth(gz.x))), wz).mul(0.00009);
    const lamR = sin(depthV.mul(2 * Math.PI / 0.0016)).mul(0.00003).mul(smoothstep(0.5, 0.15, fwidth(depthV.mul(1 / 0.0016))));
    const wall = grooves.add(lamR).mul(steep).mul(float(1).sub(isDep));
    // cratères des gouttes : le sable criblé par la pluie (effacés par le courant et par la lame)
    const pq = vec3(p.x.div(0.0042), 9.1, p.z.div(0.0042));
    // (tailles et profondeurs variées, cratères clairsemés par endroits : une grille régulière se lisait en tôle perforée)
    const pv = NZ(pq.mul(0.23).add(4.4));
    const pq2 = pq.add(pv.xyz.mul(0.7)); // (germes déplacés : plus d'alignements)
    const pit = smoothstep(pv.x.mul(0.12).add(0.32), 0.0, NZ(pq2).z).mul(smoothstep(-0.25, 0.35, pv.y)).mul(-0.00009).mul(U.pits).mul(float(1).sub(T.w))
      .mul(float(1).sub(smoothstep(0.3, 0.7, A.w))).mul(float(1).sub(steep)).mul(smoothstep(0.6, 0.2, fwidth(pq.x)));
    const H = ripple.mul(rFade).add(streak).add(grainH).add(wall).add(pit).mul(float(1).sub(tOp));
    const nBedV = normalize(cameraViewMatrix.mul(vec4(nBed, 0)).xyz);
    const nV = perturb(H, nBedV);

    // ── l'eau : normale de la surface libre (gradient de η) et rides entraînées,
    //    calculées seulement là où il y a de l'eau (branche : la plupart des pixels sont secs)
    const nWV = normalize(cameraViewMatrix.mul(vec4(waterNormal(p, h, Wt, film), 0)).xyz);
    const occ = texture(gs.occTex, vec2(p.x.add(Lx / 2).div(Lx), p.z.add(Ly / 2).div(Ly)));
    // une lame mince (ruissellement, moins de ~1 mm) n'est pas un miroir : du sable
    // mouillé qui scintille ; au-delà, la surface libre devient un plan d'eau
    const deep = smoothstep(0.0004, 0.0025, wd).mul(film);
    // écume : flocons entraînés par le courant, là où l'eau va vite et peu profonde
    const vel = Wt.zw;
    const fq = vec3(p.x.sub(vel.x.mul(fract(U.flowPhase)).mul(0.8)), 1.3, p.z.sub(vel.y.mul(fract(U.flowPhase)).mul(0.8))).mul(420);
    const fq2 = vec3(p.x.sub(vel.x.mul(fract(U.flowPhase.add(0.5))).mul(0.8)), 4.9, p.z.sub(vel.y.mul(fract(U.flowPhase.add(0.5))).mul(0.8))).mul(420);
    const fw = abs(fract(U.flowPhase).sub(0.5)).mul(2);
    const foamN = mix(noise(fq), noise(fq2), fw);
    const foam = smoothstep(0.35, 0.7, foamN).mul(smoothstep(0.18, 0.45, length(vel))).mul(film).mul(float(1).sub(smoothstep(0.004, 0.012, wd))).mul(0.55);
    const albF = mix(alb, vec3(0.78, 0.76, 0.72), foam);
    return { alb: albF.mul(mix(float(1), float(0.82), clamp(occ.y, 0, 1))), nV, nWV, film, deep, foam, tOp, wetL, moist, ao: occ.x };
  };

  // (un seul appel : la structure renvoyée est partagée par tous les canaux)
  let S = null;
  const get = () => (S ??= shade());
  const s = get();
  material.colorNode = s.alb;
  material.normalNode = normalize(mix(s.nV, s.nWV, s.tOp));
  // sable mouillé : sombre et satiné, jamais verni (un vernis faisait des
  // falaises en chocolat) ; l'eau seule porte le vernis, miroir quand elle est profonde
  material.roughnessNode = mix(mix(mix(0.9, 0.97, float(1).sub(s.moist)), 0.66, s.wetL), 0.9, s.foam);
  material.metalnessNode = float(0);
  material.aoNode = s.ao;
  material.specularIntensityNode = mix(float(0.5), float(0.08), s.deep);
  material.clearcoatNode = tmax(s.film.mul(0.45), s.deep).mul(float(1).sub(s.foam));
  material.clearcoatRoughnessNode = mix(0.22, 0.05, s.deep);
  material.clearcoatNormalNode = normalize(mix(s.nV, s.nWV, s.film));

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;

  // ── La coupe contre les parois d'acrylique ──
  // Trois bandes verticales (les deux longues parois, la paroi amont), du fond
  // du bac au lit courant de la première rangée intérieure de la simulation.
  // Une hauteur Y y montre : un dépôt au-dessus du plus bas atteint (bmin),
  // sinon la couche de la profondeur b₀ − Y (les strates suivent le gabarit).
  const skirtGeo = new THREE.BufferGeometry();
  {
    const P = [], Nn = [], I = [];
    const strip = (n, at, nrm) => {
      const base = P.length / 3;
      for (let k = 0; k <= n; k++) for (const v of [0, 1]) { const [x, z] = at(k / n); P.push(x, v, z); Nn.push(...nrm); }
      for (let k = 0; k < n; k++) { const a = base + 2 * k; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    };
    const e = 0.0006;
    strip(MX, (s) => [s * Lx - Lx / 2, -Ly / 2 + e], [0, 0, -1]);
    strip(MX, (s) => [s * Lx - Lx / 2, Ly / 2 - e], [0, 0, 1]);
    strip(MY, (s) => [-Lx / 2 + e, s * Ly - Ly / 2], [-1, 0, 0]);
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    skirtGeo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    skirtGeo.setIndex(I);
  }
  const edgeCell = (p) => { const c = cellOf(p.x, p.z); return vec2(clamp(c.x, 1, NX - 2), clamp(c.y, 1, NY - 2)); };
  const vY = varyingProperty('float', 'vSkirtY');
  const skirtMat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.92, metalness: 0 });
  skirtMat.positionNode = Fn(() => {
    const p = positionGeometry, c = edgeCell(p);
    const b = bilin(tTerr, NX, NY, c.x, c.y).x;
    const y = p.y.mul(b);
    vY.assign(y);
    const P = vec3(p.x, y, p.z);
    positionPrevious.assign(P);
    return P;
  })();
  skirtMat.colorNode = Fn(() => {
    const p = positionGeometry, c = edgeCell(p);
    const T = bilin(tTerr, NX, NY, c.x, c.y);
    const bmin = T.x.sub(T.z), b0 = bmin.add(T.y);
    const y = vY;
    const strat = layerColorAt(b0.sub(y));
    const lamD = sin(y.mul(2 * Math.PI / 0.0009).add(p.x.mul(90)).add(p.z.mul(90))).mul(0.06);
    let col = mix(strat, vec3(U.deposit).mul(lamD.add(1)), smoothstep(-0.0002, 0.0002, y.sub(bmin)));
    // grain vu au travers de la paroi
    const g = noise(vec3(p.x.add(p.z).mul(500), y.mul(500), 0.3)).mul(0.06);
    col = col.mul(g.add(1));
    // sable humide (le bac est humide sous la surface)
    return col.mul(0.78);
  })();
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.frustumCulled = false;
  skirt.receiveShadow = true;

  function setStrata(R) {
    const L = R.strata;
    U.nLayers.value = Math.min(MAX_LAYERS, L.length);
    for (let k = 0; k < MAX_LAYERS; k++) {
      const Lk = L[Math.min(k, L.length - 1)];
      U.layerBottom.array[k] = Lk.bottom;
      U.layerColor.array[k].copy(srgb(R.sand.tones[Lk.tone % R.sand.tones.length]));
    }
    U.deposit.value.copy(srgb(R.sand.deposit));
    U.meanTone.value.setRGB(0, 0, 0);
    for (const t of R.sand.tones) U.meanTone.value.add(srgb(t).multiplyScalar(1 / R.sand.tones.length));
    U.grainDark.value.copy(srgb(R.sand.grain ?? '#2a2622'));
    U.mud.value.copy(srgb(R.sand.mud ?? '#6b5a44')).lerp(srgb(R.sand.deposit), 0.35); // (l'eau chargée prend la teinte du sable fin, éclaircie)
  }

  return { mesh, material, skirt, skirtMat, U, setStrata };
}
