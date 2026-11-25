import json, sys
from PIL import Image, ImageDraw
rows = json.load(sys.stdin); S = 300; R = 2.6
W = max(len(r) for r in rows) * S; H = len(rows) * S
im = Image.new('RGB', (W * 2, H * 2), (245, 240, 228)); d = ImageDraw.Draw(im)
for j, row in enumerate(rows):
    for i, tiles in enumerate(row):
        ox, oy = (i + .5) * S * 2, (j + .5) * S * 2; k = S / R
        for t in tiles:
            pts = [(ox + t[a] * k, oy - t[a + 1] * k) for a in range(0, len(t), 2)]
            if all(abs(x - ox) < S * 1.05 and abs(y - oy) < S * 1.05 for x, y in pts):
                d.polygon(pts, outline=(60, 40, 20), fill=(250, 214, 120), width=5)
        d.rectangle([i * S * 2, j * S * 2, (i + 1) * S * 2 - 1, (j + 1) * S * 2 - 1], outline=(245, 240, 228), width=16)
im.resize((W, H), Image.LANCZOS).save(sys.argv[1], quality=88)
