# Planche : assemble des JPEG en grille, avec leur nom en surimpression.
#   python3 board.py <sortie.jpg> <colonnes> <largeur> img1 img2 …
import sys
from PIL import Image, ImageDraw
out, cols, W = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
h = int(W * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
o = Image.new('RGB', (cols * W + (cols - 1) * 6, rows * h + (rows - 1) * 6), 'black')
for k, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    im = im.resize((W, h))
    d = ImageDraw.Draw(im)
    d.text((6, 4), p.split('/')[-1], fill=(255, 255, 0))
    o.paste(im, ((k % cols) * (W + 6), (k // cols) * (h + 6)))
o.save(out, quality=88)
