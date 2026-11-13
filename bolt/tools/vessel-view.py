import json, sys
from PIL import Image, ImageDraw
B = json.load(open(sys.argv[1])); W = 300; H = 300
im = Image.new('RGB', (W * 5, H * 2), (240, 240, 236)); d = ImageDraw.Draw(im)
for k, b in enumerate(B):
    ox, oy = (k % 5) * W + W / 2, (k // 5) * H + H - 20
    for x, y, z, m in b['pts']:
        if z < -0.0: continue
        c = [(60, 60, 70), (200, 60, 40), (190, 140, 60)][m]
        im.putpixel((int(ox + x * 110), int(oy - y * 110)), c)
    s = b['meta']['strike']
    if s: d.ellipse([ox + s[0] * 110 - 3, oy - s[1] * 110 - 3, ox + s[0] * 110 + 3, oy - s[1] * 110 + 3], outline=(0, 90, 255))
    L = b['meta']['liquid']; d.line([ox - L['r'] * 110, oy - L['y'] * 110, ox + L['r'] * 110, oy - L['y'] * 110], fill=(0, 150, 90))
    d.text((ox - 40, oy - H + 30), b['v'], fill=(0, 0, 0))
im.save(sys.argv[2])
