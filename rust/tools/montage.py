# Planche : assemble les images d'un préfixe en grille, nom en surimpression.
#   python3 tools/montage.py <dossier> <préfixe> <sortie.jpg> [colonnes=3] [largeur=520]
import sys, glob, os
from PIL import Image, ImageDraw
d, pre, out = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
w = int(sys.argv[5]) if len(sys.argv) > 5 else 520
fs = sorted(glob.glob(os.path.join(d, pre + '*.jpg')))
ims = [Image.open(f) for f in fs]
if not ims: sys.exit('aucune image')
h = int(ims[0].height * w / ims[0].width)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * h), (20, 20, 20))
for i, (f, im) in enumerate(zip(fs, ims)):
    im = im.resize((w, h))
    dr = ImageDraw.Draw(im)
    dr.text((6, 4), os.path.basename(f)[len(pre):-4], fill=(255, 255, 0))
    S.paste(im, ((i % cols) * w, (i // cols) * h))
S.save(out, quality=88)
print(len(ims), 'images')
