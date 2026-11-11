# Planche : assemble les JPEG d'un préfixe (ordre alphabétique), nom en surimpression.
#   python3 montage.py <dossier> <préfixe> <sortie> [colonnes] [largeur]
import sys, glob, os
from PIL import Image, ImageDraw
d, pre, out = sys.argv[1:4]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
W = int(sys.argv[5]) if len(sys.argv) > 5 else 400
fs = sorted(glob.glob(os.path.join(d, pre + '*.jpg')))
ims = [Image.open(f) for f in fs]
if not ims: sys.exit('aucune image')
h = int(W * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * h), (30, 30, 30))
dr = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(fs, ims)):
    x, y = (i % cols) * W, (i // cols) * h
    sheet.paste(im.resize((W, h)), (x, y))
    dr.text((x + 4, y + 3), os.path.basename(f)[len(pre):-4], fill=(255, 60, 60))
sheet.save(out, quality=88)
