# Planche des décharges de tools/bolt-view.mjs : vue de face, canaux en blanc, branches en gris
import json, sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
B = json.load(open(src)); W = 300; H = 420
im = Image.new('RGB', (W * len(B), H), (8, 8, 12)); d = ImageDraw.Draw(im)
for k, b in enumerate(B):
    s = b['seg']
    for i in range(0, len(s), 12):
        ax, ay, az, tb, bx, by, bz, ss, m, w = s[i:i + 10]
        X = lambda x: k * W + W / 2 + x * 190; Y = lambda y: H - 30 - y * 230
        if tb > 1.2: col = (200, 120, 40)
        elif m: col = (255, 255, 255)
        else: g = int(70 + 150 * w); col = (g, g, int(g * 1.1) if g < 230 else 255)
        d.line([X(ax), Y(ay), X(bx), Y(by)], fill=col, width=2 if m else 1)
im.save(out)
