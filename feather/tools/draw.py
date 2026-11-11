# Dessine les contours de tools/shapes.mjs : vue de face (x, y) et de profil (z, y).
import json, sys
from PIL import Image, ImageDraw
data = json.load(sys.stdin); out = sys.argv[1]
fams = sorted(set(d['fam'] for d in data), key=lambda f: [d['fam'] for d in data].index(f))
us = sorted(set(d['u'] for d in data))
C = 150
img = Image.new('RGB', (C * len(us) * 2, C * len(fams)), (245, 243, 238))
dr = ImageDraw.Draw(img)
for d in data:
    r = fams.index(d['fam']); c = us.index(d['u'])
    sc = C * 0.85 / (d['L'] * 1.05)
    for view in (0, 1):
        ox = (c * 2 + view) * C + C / 2; oy = r * C + C - 8
        for ln in d['lines']:
            pts = [(ox + (p[0] if view == 0 else p[2]) * sc, oy - p[1] * sc) for p in ln]
            if len(pts) > 1: dr.line(pts, fill=(40, 40, 60), width=1)
    dr.text(((c * 2) * C + 4, r * C + 2), f"{d['fam']} u={d['u']}", fill=(150, 0, 0))
img.save(out)
