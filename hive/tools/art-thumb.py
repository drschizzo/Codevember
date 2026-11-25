import json, sys
from PIL import Image, ImageDraw
tiles = json.load(sys.stdin); W, H, S = 640, 400, 3
im = Image.new('RGB', (W * S, H * S), (17, 16, 15)); d = ImageDraw.Draw(im, 'RGBA')
m = min(W, H) * S; cx, cy, k, R = W * S / 2, H * S * 0.47, m * 0.105, m * 0.44
for t in tiles:
    if t['d'] * k > R: continue
    a = min(1, (R - t['d'] * k) / (m * 0.08)) * (0.5 if t['fresh'] else 1)
    pts = [(cx + t['q'][i] * k, cy - t['q'][i + 1] * k) for i in range(0, len(t['q']), 2)]
    if t['honey']: d.polygon(pts, fill=(214, 150, 50, int(40 * a)))
    d.line(pts + [pts[0]], fill=(236, 226, 205, int(217 * a)), width=4, joint='curve')
im.resize((W, H), Image.LANCZOS).save(sys.argv[1], quality=85)
