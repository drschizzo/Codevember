#!/usr/bin/env python3
# Planche d'images du collecteur : python3 tools/board.py <dossier> <préfixe> [colonnes] [échelle]
# Les images <préfixe>-*.jpg sont rangées par nom (graine, puis phase), une ligne par graine.
import sys, glob, os
from PIL import Image, ImageDraw
d, prefix = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
sc = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
files = sorted(glob.glob(os.path.join(d, prefix + '-*.jpg')))
if not files: sys.exit('aucune image')
ims = [Image.open(f) for f in files]
w, h = int(ims[0].width * sc), int(ims[0].height * sc)
rows = (len(ims) + cols - 1) // cols
B = Image.new('RGB', (w * cols, h * rows))
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    B.paste(im.resize((w, h)), (x, y))
    ImageDraw.Draw(B).text((x + 4, y + 4), os.path.basename(f)[len(prefix) + 1:-4], fill=(255, 220, 0))
out = os.path.join(d, prefix + '-board.jpg')
B.save(out, quality=88)
print(out, len(ims))
