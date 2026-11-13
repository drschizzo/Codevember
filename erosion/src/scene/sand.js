// Le sable et l'eau : un seul maillage, un seul matériau.
//
// Le maillage (2 sommets par cellule de simulation) est déplacé dans le
// vertex shader : le lit b, lu dans le relief aux sommets (scene/gpusim.js ·
// hires : Hermite monotone moyenné le long des crêtes), et la surface libre
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
import { noise, NZ, perturb, isLite, stableVelocity, hash33 } from './materials.js';

const srgb = (hex) => new THREE.Color(hex); // (THREE.Color convertit en linéaire)

export function createSand(gs) {
  const lite = isLite();
  const { NX, NY, HX, HY, l } = gs;
  const Lx = TABLE.Lx, Ly = TABLE.Ly;
  const { MX, MY } = gs; // (un sommet par texel du relief aux sommets, scene/gpusim.js · hires)

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
  const bspline = (tex, c, W = NX, H = NY) => {
    const f = fract(c), i = floor(c);
    const w0 = float(1).sub(f).pow(3).div(6);
    const w1 = f.mul(f).mul(f.mul(3).sub(6)).add(4).div(6);
    const w2 = f.mul(f).mul(f.mul(-3).add(3)).add(f.mul(3)).add(1).div(6);
    const w3 = f.pow(3).div(6);
    const g0 = w0.add(w1), g1 = w2.add(w3);
    const h0 = w1.div(g0).sub(1).add(i).add(0.5), h1 = w3.div(g1).add(1).add(i).add(0.5);
    const inv = vec2(1 / W, 1 / H);
    const s00 = texture(tex, vec2(h0.x, h0.y).mul(inv)), s10 = texture(tex, vec2(h1.x, h0.y).mul(inv));
    const s01 = texture(tex, vec2(h0.x, h1.y).mul(inv)), s11 = texture(tex, vec2(h1.x, h1.y).mul(inv));
    return mix(mix(s11, s10, g0.y), mix(s01, s00, g0.y), g0.x);
  };
  // B-spline cubique « à la main » sur la composante x d'une texture en flottants 32
  // bits : valeur et gradient (en cellules), 16 lectures. (La surface libre en
  // bilinéaire montrait ses cellules de 5 mm en facettes dans les reflets.)
  const bsp = (tex, nx, ny, cx, cy) => {
    const ix = int(floor(cx)).toVar(), iy = int(floor(cy)).toVar(), fx = fract(cx).toVar(), fy = fract(cy).toVar();
    const W = (t) => { const s1 = float(1).sub(t); return [s1.mul(s1).mul(s1).div(6), t.mul(t).mul(t.mul(3).sub(6)).add(4).div(6), t.mul(t).mul(t.mul(-3).add(3)).add(t.mul(3)).add(1).div(6), t.mul(t).mul(t).div(6)]; };
    const D = (t) => { const s1 = float(1).sub(t); return [s1.mul(s1).mul(-0.5), t.mul(t).mul(1.5).sub(t.mul(2)), t.mul(t).mul(-1.5).add(t).add(0.5), t.mul(t).mul(0.5)]; };
    const wx = W(fx).map((w) => w.toVar()), wy = W(fy).map((w) => w.toVar()), dx = D(fx).map((w) => w.toVar()), dy = D(fy).map((w) => w.toVar());
    let v = float(0), gx = float(0), gy = float(0);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const q = ld(tex, ix.add(i - 1), iy.add(j - 1), nx, ny).x.toVar();
      v = v.add(q.mul(wx[i].mul(wy[j]))); gx = gx.add(q.mul(dx[i].mul(wy[j]))); gy = gy.add(q.mul(wx[i].mul(dy[j])));
    }
    return { v, gx, gy };
  };
  const cellOf = (X, Z) => vec2(X.add(Lx / 2).div(l).sub(0.5), Z.add(Ly / 2).div(l).sub(0.5));
  const hcellOf = (X, Z) => vec2(X.add(Lx / 2).div(2 * l).sub(0.5), Z.add(Ly / 2).div(2 * l).sub(0.5));

  // Le lit : Hermite cubique monotone (pentes de Fritsch–Carlson) — passe par les
  // valeurs simulées, sans dépassement ni facette ; une B-spline arrondissait chaque
  // crête en cire fondue — moyenné le long des crêtes, évalué une fois par image aux
  // sommets du maillage sur le GPU (scene/gpusim.js · hires) : hauteur et normale.

  // ── Vertex : lit, surface libre ──
  const vB = varyingProperty('float', 'vBed');
  const vE = varyingProperty('float', 'vEta'); // (surface libre au sommet : la même que le maillage)
  const vW = varyingProperty('vec2', 'vEtaGrad'); // (pente de la surface libre, au sommet : 16 lectures de moins par pixel mouillé)
  const positionNode = Fn(() => {
    const p = positionGeometry;
    // (le relief aux sommets : l'Hermite moyenné le long des crêtes, calculé une fois par image)
    const vi = int(p.x.add(Lx / 2).div(Lx).mul(MX - 1).round()), vj = int(p.z.add(Ly / 2).div(Ly).mul(MY - 1).round());
    const b = textureLoad(gs.hiTex, ivec2(vi, vj)).x;
    vB.assign(b);
    const h = hcellOf(p.x, p.z);
    const EB = bsp(tWat, HX, HY, h.x, h.y);
    const eta = EB.v;
    vE.assign(eta);
    vW.assign(vec2(EB.gx, EB.gy).div(2 * l));
    const P = vec3(p.x, tmax(b, eta.mul(U.waterOn).sub(float(1).sub(U.waterOn))), p.z);
    // pose précédente = pose courante (le relief bouge de quelques µm par image) :
    // sans elle, three prend la grille plate pour la pose précédente, et la vitesse
    // vaut tout le relief (flou de mouvement et anticrénelage temporel faussés)
    positionPrevious.assign(P);
    return P;
  })();
  // Normale du lit au pixel : celle de la même surface que les sommets (dérivée de
  // l'Hermite moyenné le long des crêtes), lue en B-spline bicubique dans la texture
  // filtrable des sommets — interpolée par triangle, le terminateur d'une crête
  // vive suivait les arêtes des triangles, toutes de même diagonale.
  const bedNormal = Fn(() => {
    const p = positionGeometry;
    const ch = vec2(p.x.add(Lx / 2).div(Lx).mul(MX - 1), p.z.add(Ly / 2).div(Ly).mul(MY - 1));
    const n = bspline(gs.hiNTex, ch, MX, MY).xy;
    return normalize(vec3(n.x, sqrt(tmax(0.0001, float(1).sub(dot(n, n)))), n.y));
  });

  // ── Couleur du sable ──
  const layerColorAt = Fn(([depth]) => {
    const col = vec3(U.layerColor.element(0)).toVar();
    const top = float(0).toVar();
    const w = tmax(fwidth(depth), 0.0005); // (frontières adoucies : un fond posé sur un banc ne se découpe pas en taches)
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
      const gwx = vW.x, gwz = vW.y;
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
    const wd = vE.sub(bed).mul(U.waterOn).max(0);      // hauteur d'eau au pixel (surface du maillage)
    const film = smoothstep(0.00008, 0.0006, wd);

    // ce que montre la surface
    const depth = T.y, dep = T.z;
    // (un placage de sable transporté se mêle à son lit : quelques grains épars sur
    // le fond, puis une couverture pleine à quelques mm ; seuillé à 0,6 mm, le
    // moindre voile basculait toute sa couleur et dessinait des aplats de camouflage)
    const veneer = noise(vec3(p.x.mul(140), 6.7, p.z.mul(140))).mul(0.0004);
    const isDep = smoothstep(0.0002, 0.0025, dep.add(veneer)).pow(0.8);
    // pente : 0 à plat, 1 sur une paroi (normale du lit, B-spline)
    const nG = bedNormal().toVar(); // (normale du lit : dérivée exacte de l'interpolation, au pixel)
    const steep = smoothstep(0.88, 0.6, nG.y);
    // la strate se lit à la hauteur vraie du pixel sous la surface de départ
    // (b₀ − y) : sur une paroi, la profondeur interpolée en plan mêlait toutes
    // les couches en un seul ton ; le contact est ondulé de quelques dixièmes de mm
    const b0p = T.x.sub(T.z).add(T.y);
    const contact = noise(vec3(p.x.mul(120), 3.1, p.z.mul(120))).mul(0.0003).add(noise(vec3(p.x.mul(30), 8.3, p.z.mul(30))).mul(0.0004));
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
    const mott = noise(vec3(p.x.mul(90), 0.37, p.z.mul(90))).mul(0.05).add(noise(vec3(p.x.mul(260), 2.1, p.z.mul(260))).mul(0.04)).add(noise(vec3(p.x.mul(22), 5.3, p.z.mul(22))).mul(0.04));
    alb = alb.mul(mott.add(1));
    // mottes de sable humide (1 à 3 mm) : Worley du volume, germes déplacés
    const cq = vec3(p.x.div(0.0019), 2.7, p.z.div(0.0019));
    const cw = NZ(cq.add(NZ(cq.mul(0.31)).xyz.mul(0.8)));
    const clumpF = smoothstep(0.6, 0.15, fwidth(cq.x));
    // grains (~0,28 mm) : cellules de Voronoï à germes déplacés (hachage sans sinus),
    // chacun sa teinte, son relief en dôme, des pores entre eux ; minéraux lourds
    // sombres, quartz clairs. (Des carrés de grille et un bruit très agrandi
    // dessinaient une trame de tissu.) Effacés avant la fréquence du pixel.
    const gp = p.xz.div(0.00028);
    const fade = smoothstep(1.1, 0.35, fwidth(gp.x));
    const gi = floor(gp), gf = fract(gp);
    // (seulement de près : au-delà, les grains sont effacés et ne coûtent rien ;
    // If() n'existe que dans un Fn)
    const G4 = Fn(([fd, gi_, gf_]) => {
      const gd = float(0.3).toVar(), gid = vec3(0.5).toVar();
      If(fd.greaterThan(0.002), () => {
        gd.assign(9);
        for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
          const o = vec2(x, y);
          const hh = hash33(vec3(gi_.add(o), 17.3));
          const r = o.add(hh.xy.mul(0.8).add(0.1)).sub(gf_);
          const d2 = dot(r, r);
          gid.assign(select(d2.lessThan(gd), hh, gid));
          gd.assign(tmin(gd, d2));
        }
      });
      return vec4(gid, gd);
    })(fade, gi, gf).toVar();
    const gid = G4.xyz, gd = G4.w;
    const gF1 = sqrt(gd);
    const dark = step(0.9, gid.z).mul(U.grainAmt.mul(2.4));
    const light = step(gid.z, 0.08).mul(U.grainAmt);
    const pore = smoothstep(0.42, 0.7, gF1);
    alb = alb.mul(float(1).add(gid.x.sub(0.5).mul(U.grainAmt).mul(1.4).mul(fade)));
    alb = mix(alb, vec3(U.grainDark), dark.mul(fade));
    alb = alb.add(light.mul(fade).mul(0.22));
    alb = alb.mul(float(1).sub(pore.mul(0.22).mul(fade)));

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
    // caustiques : sous une eau claire et peu profonde, les rides de la surface
    // concentrent la lumière en un réseau de filets qui suit le courant
    const cv = Wt.zw;
    const cph0 = fract(U.flowPhase), cph1 = fract(U.flowPhase.add(0.5)), cwv = abs(cph0.sub(0.5)).mul(2);
    const cqa = vec3(p.x.sub(cv.x.mul(cph0).mul(0.6)), 0.4, p.z.sub(cv.y.mul(cph0).mul(0.6))).div(0.0045);
    const cqb = vec3(p.x.sub(cv.x.mul(cph1).mul(0.6)), 1.9, p.z.sub(cv.y.mul(cph1).mul(0.6))).div(0.0045);
    // (domaine déformé : des filets ondulés, pas un réseau de cellules qui se lirait en boue craquelée)
    // (une eau calme n'a pas de rides, donc pas de caustiques : seulement là où elle coule)
    const cAmt = smoothstep(0.04, 0.18, length(cv)).mul(smoothstep(0.0004, 0.003, wd)).mul(float(1).sub(smoothstep(0.015, 0.04, wd))).mul(float(1).sub(tOp)).mul(smoothstep(0.6, 0.2, fwidth(cqa.x)));
    const caust = Fn(([amt, qa, qb, wv]) => {
      const c = float(0).toVar();
      If(amt.greaterThan(0.001), () => {
        const cwa = NZ(qa.mul(0.27)).xyz.mul(0.9), cwb = NZ(qb.mul(0.27)).xyz.mul(0.9);
        c.assign(mix(smoothstep(0.2, 0.0, NZ(qa.add(cwa)).w), smoothstep(0.2, 0.0, NZ(qb.add(cwb)).w), wv).pow(2));
      });
      return c;
    })(cAmt, cqa, cqb, cwv).toVar();
    alb = alb.mul(float(1).add(caust.mul(cAmt).mul(0.3)));
    // ménisque : à la ligne d'eau, une frange plus sombre (le sable boit)
    const edge = film.mul(float(1).sub(smoothstep(0.0002, 0.0012, wd)));
    alb = alb.mul(float(1).sub(edge.mul(0.18)));

    // ── relief fin (hauteur en m, perturbation de Mikkelsen) ──
    const nBed = nG;
    // rides de courant : crêtes perpendiculaires à la descente, longueur d'onde ~13 mm
    // (tirée vers l'aval : sur un fond presque plat, la normale bruitée faisait tourner les crêtes en volutes)
    const down = normalize(nG.xz.add(vec2(0.05, 0)));
    // (phase sur un axe fixe du bac — le courant y va vers l'aval — et non sur la
    // pente locale : le produit scalaire de la position avec une direction qui varie
    // faisait tourner les crêtes en volutes, un degré décalant la phase d'un cycle)
    const rp = p.x.div(0.013).add(noise(vec3(p.x.mul(22), 0.5, p.z.mul(22))).mul(0.8)).add(noise(vec3(p.z.mul(6), 1.7, p.x.mul(6))).mul(2.2)).add(noise(vec3(p.z.mul(2.5), 3.3, p.x.mul(2.5))).mul(3.0)); // (crêtes sinueuses, raccords en Y)
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
    // (stries de la lame : quelques sillons irréguliers, pas une trame)
    const sq = vec3(p.z.mul(260), 0.3, p.x.mul(6));
    const streak = noise(sq.add(vec3(noise(vec3(p.x.mul(40), 1.1, p.z.mul(40))).mul(0.6), 0, 0))).mul(0.00003).mul(neuf).mul(smoothstep(0.5, 0.15, fwidth(sq.x)));
    // grain en relief : bruit continu (un hachage par cellule faisait des marches,
    // dessinées en pointillés noirs par la perturbation de normale)
    const grainH = float(1).sub(gd.mul(1.6)).max(0).mul(0.00006).mul(fade)
      .add(smoothstep(0.55, 0.0, cw.z).mul(0.00005).mul(clumpF).mul(moist.mul(0.7).add(0.3)).mul(float(1).sub(film))); // (sous l'eau, pas de mottes)
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

  // Ombre de la lampe principale sur le sable : celle de la carte d'ombre (la lame,
  // les objets) multipliée par l'ombre portée du relief, tracée sur la carte de
  // hauteur (scene/gpusim.js) ; le sable ne se projette pas lui-même dans la carte
  // d'ombre (escaliers en lumière rasante, et une passe de 1 M de sommets en moins).
  // (lue en B-spline bicubique : en bilinéaire, le bord d'ombre dessinait la grille des cellules de 2,5 mm en gros plan)
  material.receivedShadowNode = Fn(([sh]) => sh.mul(bspline(gs.occTex, cellOf(positionGeometry.x, positionGeometry.z)).w));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

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
