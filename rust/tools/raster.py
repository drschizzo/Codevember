# Rendu logiciel d'une pièce (z-buffer, Lambert + reflet) pour juger la géométrie :
#   python3 tools/raster.py piece.bin sortie.png [az°] [el°] [taille] [zoom] [cible x,y,z]
import sys, json, struct, numpy as np
from PIL import Image
f = open(sys.argv[1], 'rb').read()
n = struct.unpack('<I', f[:4])[0]; head = json.loads(f[4:4+n]); off = 4 + n
az = float(sys.argv[3]) if len(sys.argv) > 3 else 30; el = float(sys.argv[4]) if len(sys.argv) > 4 else 20
W = int(sys.argv[5]) if len(sys.argv) > 5 else 900; zoom = float(sys.argv[6]) if len(sys.argv) > 6 else 1
H = int(W * 0.66)
parts = []
for p in head['parts']:
    nv, ni = p['nv'], p['ni']
    pos = np.frombuffer(f, np.float32, nv*3, off).reshape(-1,3); off += nv*12
    nor = np.frombuffer(f, np.float32, nv*3, off).reshape(-1,3); off += nv*12
    surf = np.frombuffer(f, np.uint8, nv*4, off).reshape(-1,4); off += nv*4
    idx = np.frombuffer(f, np.uint32, ni, off).reshape(-1,3); off += ni*4
    parts.append((pos, nor, surf, idx))
allp = np.concatenate([p[0] for p in parts])
lo, hi = allp.min(0), allp.max(0)
tgt = (lo + hi) / 2
if len(sys.argv) > 7: tgt = np.array([float(x) for x in sys.argv[7].split(',')])
rad = np.linalg.norm(hi - lo) / 2
a, e = np.radians(az), np.radians(el)
fwd = -np.array([np.sin(a)*np.cos(e), np.sin(e), np.cos(a)*np.cos(e)])
eye = tgt - fwd * rad * 3.2 / zoom
right = np.cross(fwd, [0,1,0]); right /= np.linalg.norm(right); up = np.cross(right, fwd)
fov = np.radians(30); fy = (H/2) / np.tan(fov/2)
zb = np.full((H, W), np.inf); img = np.zeros((H, W, 3))
L = np.array([0.5, 0.8, 0.6]); L /= np.linalg.norm(L)
cols = [np.array([[0.62,0.62,0.64],[0.38,0.37,0.36],[0.85,0.65,0.3]]), np.array([[0.55,0.38,0.22],[0.25,0.32,0.4],[0.5,0.5,0.5]])]
for pi_, (pos, nor, surf, idx) in enumerate(parts):
    d = pos - eye
    x = d @ right; y = d @ up; z = d @ fwd
    sx = W/2 + x / z * fy; sy = H/2 - y / z * fy
    w = surf[:, :3].astype(np.float64) / 255.0
    base = w if head.get('color') else w @ cols[pi_]
    sh = np.clip(nor @ L, 0, 1) * 0.75 + 0.25 * (0.5 + 0.5 * nor[:,1])
    vv = -fwd
    hv = (L + vv) / np.linalg.norm(L + vv)
    spec = np.clip(nor @ hv, 0, 1) ** 40 * 0.5
    c = base * sh[:, None] + spec[:, None]
    for t in idx:
        if np.any(z[t] < 0.05): continue
        xs, ys = sx[t], sy[t]
        x0, x1 = int(max(0, np.floor(xs.min()))), int(min(W-1, np.ceil(xs.max())))
        y0, y1 = int(max(0, np.floor(ys.min()))), int(min(H-1, np.ceil(ys.max())))
        if x0 > x1 or y0 > y1: continue
        X, Y = np.meshgrid(np.arange(x0, x1+1) + 0.5, np.arange(y0, y1+1) + 0.5)
        (ax, bx, cx), (ay, by, cy) = xs, ys
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den
        l2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not m.any(): continue
        zz = l1 * z[t[0]] + l2 * z[t[1]] + l3 * z[t[2]]
        sub = zb[y0:y1+1, x0:x1+1]
        mm = m & (zz < sub)
        sub[mm] = zz[mm]
        cc = l1[..., None] * c[t[0]] + l2[..., None] * c[t[1]] + l3[..., None] * c[t[2]]
        img[y0:y1+1, x0:x1+1][mm] = cc[mm]
bg = np.isinf(zb)
img[bg] = [0.12, 0.12, 0.13]
Image.fromarray((np.clip(img, 0, 1) ** (1/1.6) * 255).astype(np.uint8)).save(sys.argv[2])
print(head['dt'], 'ms', head['parts'], [round(v,3) for v in lo], [round(v,3) for v in hi])
