// Le bloc de gel et ce qu'il contient : un lancer de rayons au pixel, sur les
// faces du bloc.
//
// Le rayon de l'œil entre dans le gel (n = 1,335) et le traverse par pas
// égaux à la distance signée au terrier (texture 3D). Quand il touche une
// paroi du terrier :
// - s'il y a du métal à cet endroit, c'est la peau du moulage, éclairée
//   (studio de la pièce, soleil de la fenêtre) ;
// - sinon, il passe dans l'air du vide : réflexion de Fresnel (totale au-delà
//   de 48,5° : le liseré argenté d'un vide dans un gel), réfraction, et marche
//   dans l'air jusqu'à la surface libre du métal, au filet, ou à la paroi d'en
//   face, où il revient dans le gel.
// À la sortie du bloc, il réfracte encore et lit ce qu'il y a derrière dans
// l'image déjà dessinée (les objets opaques sont rendus avant).
//
// Le métal : jour 1, il occupe un voxel quand la fraction versée F dépasse sa
// fraction de remplissage (la surface libre est l'isosurface : horizontale par
// construction) ; jour 2, tant que la fraction vidée D n'a pas atteint sa
// fraction de vidange. Il est solide (argent bleuté à facettes) derrière le
// front de prise, liquide (miroir) devant le front de fonte.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, texture, texture3D, vec2, vec3, vec4, float, int, positionLocal, cameraPosition, modelWorldMatrix,
  modelWorldMatrixInverse, cameraProjectionMatrix, cameraViewMatrix, normalize, dot, reflect, refract, sqrt, max, min, abs, exp, mix,
  clamp, smoothstep, step, select, length, equirectUV, viewportTexture, screenUV, pow, fract, floor, sin,
} from 'three/tsl';
import { BLOCK } from '../gen/burrows.js';
import { NZ } from '../../../../shared/scene/materials.js';

const IOR = 1.335;

export function createGel({ lite = false } = {}) {
  const blank = new THREE.Data3DTexture(new Uint16Array(8 * 4), 2, 2, 2);
  blank.format = THREE.RGBAFormat; blank.type = THREE.HalfFloatType;
  const tA = texture3D(blank), tB = texture3D(blank);
  const envBlank = new THREE.DataTexture(new Uint16Array(4 * 4), 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const tEnv = texture(envBlank);
  const v3 = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));
  const U = {
    gMin: v3(), gScale: v3(1, 1, 1), h: uniform(0.012), lo: v3(-1, -1, -1), hi: v3(1, 1, 1),
    F: uniform(0), D: uniform(0), G: uniform(0), M: uniform(0), mode: uniform(0), stream: uniform(0), streamR: uniform(0.011),
    meltDir: v3(1, 0, 0), meltLo: uniform(-1), meltHi: uniform(1),
    envI: uniform(1), sigma: v3(0.05, 0.04, 0.04),
    sunDir: v3(0.6, 0.5, 0.2), sunCol: v3(0, 0, 0),
    // la fenêtre (repère monde) : plan x = winX, ouverture [y0, y1] × [z0, z1], croisillons nx × ny
    winX: uniform(-3), win: uniform(new THREE.Vector4(0.3, 4, -0.9, 0.9)), winBars: uniform(new THREE.Vector2(2, 3)), barW: uniform(0.035),
    liquid: uniform(new THREE.Color(0.72, 0.73, 0.75)), solid: uniform(new THREE.Color(0.56, 0.6, 0.66)),
    bgDist: uniform(0.7), debug: uniform(0),
  };
  const H = [BLOCK.hx, BLOCK.hy, BLOCK.hz];

  // ── lectures du champ ──
  const uvw = (p) => p.sub(U.gMin).mul(U.gScale); // (gScale = 1 / (n·h), décalé d'un demi-texel dans gMin)
  const A = (p) => tA.sample(uvw(p)).level(0);
  const Bf = (p) => tB.sample(uvw(p)).level(0);
  const gradA = (p, ch) => { // gradient par quatre prélèvements en tétraèdre
    const e = U.h.mul(0.5);
    const k1 = vec3(1, -1, -1), k2 = vec3(-1, -1, 1), k3 = vec3(-1, 1, -1), k4 = vec3(1, 1, 1);
    const g = (k) => A(p.add(k.mul(e)))[ch];
    return k1.mul(g(k1)).add(k2.mul(g(k2))).add(k3.mul(g(k3))).add(k4.mul(g(k4)));
  };
  const gradB = (p) => {
    const e = U.h.mul(0.5);
    const k1 = vec3(1, -1, -1), k2 = vec3(-1, -1, 1), k3 = vec3(-1, 1, -1), k4 = vec3(1, 1, 1);
    const g = (k) => Bf(p.add(k.mul(e))).x;
    return k1.mul(g(k1)).add(k2.mul(g(k2))).add(k3.mul(g(k3))).add(k4.mul(g(k4)));
  };
  // métal à p (dans le vide) : 1 par la surface libre, 2 par le filet, 0 sinon
  const metalAt = (a, b) => {
    const pool = select(U.mode.lessThan(0.5), a.y.lessThan(U.F), a.z.greaterThan(U.D));
    const riv = U.stream.greaterThan(0.5).and(U.mode.lessThan(0.5)).and(b.x.lessThan(U.streamR)).and(U.F.greaterThanEqual(b.y)).and(U.F.lessThan(b.z));
    return select(pool, float(1), select(riv, float(2), float(0)));
  };
  // part solide du métal à p
  const solidAt = (p, a) => {
    const frozen = smoothstep(U.G.add(0.004), U.G.sub(0.004), a.w).mul(step(0.0001, U.G));
    const mc = dot(p, U.meltDir).sub(U.meltLo).div(U.meltHi.sub(U.meltLo));
    const unmelted = smoothstep(U.M.sub(0.01), U.M.add(0.01), mc);
    return select(U.mode.lessThan(0.5), frozen, unmelted);
  };

  const toWorldDir = (d) => modelWorldMatrix.mul(vec4(d, 0)).xyz;
  const env = (dW, rough) => tEnv.sample(equirectUV(normalize(dW))).level(rough.mul(7)).rgb.mul(U.envI);
  // la fenêtre laisse-t-elle passer le soleil jusqu'au point (monde) ?
  const sunLit = (pW) => {
    // (sunDir pointe vers le soleil ; la fenêtre est dans le mur de gauche, x = winX < 0)
    const q = pW.add(U.sunDir.mul(U.winX.sub(pW.x).div(min(U.sunDir.x, float(-1e-4)))));
    const inY = smoothstep(U.win.x, U.win.x.add(0.02), q.y).mul(smoothstep(U.win.y, U.win.y.sub(0.02), q.y));
    const inZ = smoothstep(U.win.z, U.win.z.add(0.02), q.z).mul(smoothstep(U.win.w, U.win.w.sub(0.02), q.z));
    // croisillons (nx montants, ny traverses)
    const uy = q.y.sub(U.win.x).div(U.win.y.sub(U.win.x)).mul(U.winBars.y), uz = q.z.sub(U.win.z).div(U.win.w.sub(U.win.z)).mul(U.winBars.x);
    const by = abs(fract(uy.add(0.5)).sub(0.5)).mul(U.win.y.sub(U.win.x)).div(U.winBars.y);
    const bz = abs(fract(uz.add(0.5)).sub(0.5)).mul(U.win.w.sub(U.win.z)).div(U.winBars.x);
    const bars = smoothstep(U.barW.mul(0.5), U.barW.mul(0.5).add(0.01), min(by, bz));
    return inY.mul(inZ).mul(bars).mul(step(U.sunDir.x, float(0))).mul(step(float(0), U.sunDir.y));
  };
  // la peau du métal : normale (repère du bloc), point, direction du rayon
  const shadeMetal = (p, nL, d, s) => {
    // facettes du solide : la normale penche selon la cellule (Worley du volume de bruit)
    const q = p.mul(26);
    const w = NZ(q), we = U.h;
    const fac = vec3(NZ(q.add(vec3(0.07, 0, 0))).z.sub(w.z), NZ(q.add(vec3(0, 0.07, 0))).z.sub(w.z), NZ(q.add(vec3(0, 0, 0.07))).z.sub(w.z)).mul(6);
    const n = normalize(nL.add(fac.mul(s).mul(0.55)));
    const nW = normalize(toWorldDir(n)), dW = normalize(toWorldDir(d));
    const r = reflect(dW, nW);
    const rough = mix(float(0.035), float(0.26), s);
    const F0 = mix(vec3(U.liquid), vec3(U.solid), s);
    const c = clamp(dot(nW, dW).negate(), 0, 1);
    const Fr = F0.add(vec3(1).sub(F0).mul(pow(float(1).sub(c), 5)));
    // joints de grains (F2 − F1 petit) : un trait plus mat
    const grain = smoothstep(0.0, 0.06, w.w).mul(0.35).add(0.65);
    let col = env(r, rough).mul(Fr).mul(mix(float(1), grain, s));
    // soleil : lobe spéculaire, à travers la fenêtre
    const pW = modelWorldMatrix.mul(vec4(p, 1)).xyz;
    const sh = max(dot(r, normalize(U.sunDir)), 0);
    const lobe = pow(sh, mix(float(1800), float(60), s)).mul(mix(float(60), float(3), s));
    col = col.add(vec3(U.sunCol).mul(lobe).mul(sunLit(pW)).mul(Fr));
    return col;
  };
  // Fresnel diélectrique exact (non polarisé), de n1 vers n2
  const fresnel = (cosi, eta) => {
    const s2 = float(1).sub(cosi.mul(cosi)).mul(eta.mul(eta));
    const cost = sqrt(max(float(1).sub(s2), 0));
    const rs = eta.mul(cosi).sub(cost).div(eta.mul(cosi).add(cost));
    const rp = cosi.sub(eta.mul(cost)).div(cosi.add(eta.mul(cost)));
    return select(s2.greaterThanEqual(1), float(1), rs.mul(rs).add(rp.mul(rp)).mul(0.5));
  };
  // sortie de la boîte du bloc (depuis l'intérieur)
  const boxExit = (p, d) => {
    const t = vec3(BLOCK.hx, BLOCK.hy, BLOCK.hz).mul(vec3(d.x.sign(), d.y.sign(), d.z.sign())).sub(p).div(select(abs(d).lessThan(1e-5), vec3(1e-5), d));
    return min(t.x, min(t.y, t.z));
  };
  const boxNormal = (p) => {
    const q = abs(p).div(vec3(BLOCK.hx, BLOCK.hy, BLOCK.hz));
    return select(q.x.greaterThan(q.y).and(q.x.greaterThan(q.z)), vec3(p.x.sign(), 0, 0), select(q.y.greaterThan(q.z), vec3(0, p.y.sign(), 0), vec3(0, 0, p.z.sign())));
  };
  const ndc = (pL) => { const c = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix.mul(vec4(pL, 1))); return c.xy.div(c.w); };

  // ce que voit un rayon du gel qui sort du bloc depuis p dans la direction d :
  // l'image déjà dessinée derrière (ou le studio en réflexion totale)
  const behind = (p, d, p0) => {
    const te = boxExit(p, d).max(0);
    const pe = p.add(d.mul(te));
    const nb = boxNormal(pe);
    const dOut = refract(d, nb.negate(), IOR);
    const tir = dot(dOut, dOut).lessThan(0.5);
    const uv = screenUV.add(ndc(pe.add(dOut.mul(U.bgDist))).sub(ndc(p0)).mul(vec2(0.5, -0.5)));
    return select(tir, env(reflect(toWorldDir(d), toWorldDir(nb.negate())), float(0.1)), viewportTexture(uv.clamp(0.001, 0.999)).rgb).mul(exp(U.sigma.mul(te).negate()));
  };

  const STEPS = lite ? 96 : 160;
  const colorNode = Fn(() => {
    const ro = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const p0 = positionLocal;
    const d0 = normalize(p0.sub(ro));
    const nf = boxNormal(p0);
    // la face du bloc : reflet du verre, puis réfraction dans le gel
    const ci = dot(d0, nf).negate().max(0);
    const R0 = fresnel(ci, float(1 / 1.5)).max(0.04);
    const col = env(reflect(toWorldDir(d0), toWorldDir(nf)), float(0.02)).mul(R0).toVar();
    const T = vec3(float(1).sub(R0)).toVar();
    const d = refract(d0, nf, 1 / IOR).toVar();
    const p = p0.add(d.mul(0.0005)).toVar();
    const inAir = float(0).toVar(), done = float(0).toVar(), prevP = p.toVar();
    Loop(STEPS, () => {
      If(done.lessThan(0.5), () => {
        const a = A(p);
        If(inAir.lessThan(0.5), () => {
          // hors de la boîte du terrier : on sort du bloc
          const out = p.lessThan(U.lo).any().or(p.greaterThan(U.hi).any());
          If(out.and(dot(d, p.sub(U.lo.add(U.hi).mul(0.5))).greaterThan(0)), () => { done.assign(2); }).ElseIf(a.x.lessThan(0), () => {
            // on touche une paroi : recaler sur la surface (quelques bissections)
            const lo2 = prevP.toVar(), hi2 = p.toVar();
            Loop(5, () => { const m = lo2.add(hi2).mul(0.5); If(A(m).x.lessThan(0), () => { hi2.assign(m); }).Else(() => { lo2.assign(m); }); });
            const ps = hi2;
            const as = A(ps), bs = Bf(ps);
            const N = normalize(gradA(ps, 'x'));
            If(metalAt(as, bs).greaterThan(0.5), () => {
              col.addAssign(T.mul(shadeMetal(ps, N, d, solidAt(ps, as))));
              done.assign(1);
            }).Else(() => {
              const c = dot(d, N).negate().max(1e-4);
              const Rf = fresnel(c, float(IOR));
              col.addAssign(T.mul(Rf).mul(behind(ps, reflect(d, N), p0)));
              If(Rf.greaterThan(0.999), () => { done.assign(1); }).Else(() => {
                T.mulAssign(float(1).sub(Rf));
                d.assign(refract(d, N, IOR));
                inAir.assign(1);
                p.assign(ps.add(d.mul(0.001)));
              });
            });
          }).Else(() => {
            const dt = max(a.x.mul(0.9), 0.0015);
            T.mulAssign(exp(U.sigma.mul(dt).negate()));
            prevP.assign(p);
            p.addAssign(d.mul(dt));
          });
        }).Else(() => {
          // dans l'air du vide
          const b = Bf(p);
          const mt = metalAt(a, b);
          If(a.x.greaterThan(0), () => {
            // retour dans le gel
            const N = normalize(gradA(p, 'x'));
            d.assign(refract(d, N.negate(), 1 / IOR));
            inAir.assign(0);
            prevP.assign(p);
            p.addAssign(d.mul(0.001));
          }).ElseIf(mt.greaterThan(0.5), () => {
            // la surface libre (ou le filet) : recaler, puis la peau
            const lo2 = prevP.toVar(), hi2 = p.toVar();
            Loop(5, () => { const m = lo2.add(hi2).mul(0.5); If(metalAt(A(m), Bf(m)).greaterThan(0.5), () => { hi2.assign(m); }).Else(() => { lo2.assign(m); }); });
            const ps = hi2, as = A(ps);
            const gPool = select(U.mode.lessThan(0.5), gradA(ps, 'y'), gradA(ps, 'z').negate());
            const N = normalize(select(mt.greaterThan(1.5), gradB(ps), gPool));
            col.addAssign(T.mul(shadeMetal(ps, N, d, solidAt(ps, as))));
            done.assign(1);
          }).Else(() => {
            prevP.assign(p);
            p.addAssign(d.mul(clamp(a.x.negate(), 0.002, 0.01)));
          });
        });
      });
    });
    // sortie du bloc : réfraction, puis l'image déjà dessinée derrière
    If(done.lessThan(0.5).or(done.greaterThan(1.5)), () => {
      const te = boxExit(p, d).max(0);
      const pe = p.add(d.mul(te));
      T.mulAssign(exp(U.sigma.mul(te).negate()));
      const nb = boxNormal(pe);
      const dOut = refract(d, nb.negate(), IOR);
      const tir = dot(dOut, dOut).lessThan(0.5);
      const uv = screenUV.add(ndc(pe.add(dOut.mul(U.bgDist))).sub(ndc(p0)).mul(vec2(0.5, -0.5)));
      const bg = select(tir, env(reflect(toWorldDir(d), toWorldDir(nb.negate())), float(0.1)), viewportTexture(uv).rgb);
      col.addAssign(T.mul(bg));
    });
    return vec4(col, 1);
  })();

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.NoBlending, depthWrite: true });
  material.colorNode = colorNode;
  material.fog = false;
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2 * BLOCK.hx, 2 * BLOCK.hy, 2 * BLOCK.hz), material);
  mesh.renderOrder = 10;

  // le double d'ombre : le maillage du vide, masqué hors du métal
  const shadowMat = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false });
  const shadowMesh = new THREE.Mesh(new THREE.BufferGeometry(), shadowMat);
  shadowMesh.castShadow = true;
  shadowMesh.layers.set(2);
  shadowMat.maskShadowNode = Fn(() => {
    const p = positionLocal, a = A(p), b = Bf(p);
    return metalAt(a, b).greaterThan(0.5);
  })();
  mesh.add(shadowMesh);

  function setNest(o) {
    const mk = (data) => {
      const t = new THREE.Data3DTexture(data, o.n[0], o.n[1], o.n[2]);
      t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    };
    tA.value?.dispose?.(); tB.value?.dispose?.();
    tA.value = mk(o.A); tB.value = mk(o.B);
    U.h.value = o.h;
    // texel (i, j, k) au point min + (i, j, k)·h : uvw = (p − min + h/2) / (n·h)
    U.gMin.value.set(o.min[0] - o.h / 2, o.min[1] - o.h / 2, o.min[2] - o.h / 2);
    U.gScale.value.set(1 / (o.n[0] * o.h), 1 / (o.n[1] * o.h), 1 / (o.n[2] * o.h));
    U.lo.value.set(o.bounds[0], o.bounds[1], o.bounds[2]);
    U.hi.value.set(o.bounds[3], o.bounds[4], o.bounds[5]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(o.shadow.position, 3));
    g.setIndex(new THREE.BufferAttribute(o.shadow.index, 1));
    shadowMesh.geometry.dispose();
    shadowMesh.geometry = g;
  }
  function setEnv(tex) { tEnv.value = tex; }

  return { mesh, shadowMesh, U, setNest, setEnv, H };
}
