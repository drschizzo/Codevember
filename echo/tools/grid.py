#!/usr/bin/env python3
# Planche : les images d'un préfixe, une rangée par graine, une colonne par phase.
#   python3 echo/tools/grid.py <dossier> <préfixe> <sortie.jpg> [largeur d'une case]
import sys, glob, os, re
from PIL import Image, ImageDraw
d, pre, out = sys.argv[1:4]
cw = int(sys.argv[4]) if len(sys.argv) > 4 else 480
fs = sorted(glob.glob(os.path.join(d, pre + '*.jpg')))
rows = {}
for f in fs:
    m = re.match(re.escape(pre) + r'-(.*)-(\d+)\.jpg', os.path.basename(f))
    if m: rows.setdefault(m.group(1), []).append((int(m.group(2)), f))
ims = {k: [Image.open(f) for _, f in sorted(v)] for k, v in rows.items()}
w0, h0 = next(iter(ims.values()))[0].size
ch = int(cw * h0 / w0)
nc = max(len(v) for v in ims.values())
S = Image.new('RGB', (cw * nc, ch * len(ims)), (20, 20, 20))
dr = ImageDraw.Draw(S)
for r, (k, v) in enumerate(ims.items()):
    for c, im in enumerate(v):
        S.paste(im.resize((cw, ch)), (c * cw, r * ch))
    dr.text((6, r * ch + 6), k, fill=(255, 230, 0))
S.save(out, quality=86)
