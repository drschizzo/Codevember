#!/usr/bin/env python3
# Planche : assemble des images (motif glob) en grille, avec leur nom.
#   python3 tools/board.py <dossier> <motif> <sortie> [colonnes] [largeur]
import glob, os, sys
from PIL import Image, ImageDraw
d, pat, out = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
W = int(sys.argv[5]) if len(sys.argv) > 5 else 400
files = sorted(glob.glob(os.path.join(d, pat)))
ims = [Image.open(f).convert('RGB') for f in files]
if not ims: sys.exit('aucune image')
H = int(W * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
o = Image.new('RGB', (cols * W, rows * H), (0, 0, 0))
dr = ImageDraw.Draw(o)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * W, (i // cols) * H
    o.paste(im.resize((W, H)), (x, y))
    dr.text((x + 6, y + 4), os.path.basename(f).rsplit('.', 1)[0], fill=(255, 220, 120))
o.save(out, quality=90)
print(out, len(ims))
