# Assemble les PPM d'un dossier en une planche (une ligne) : python3 sheet.py <dossier> [motif]
import sys, glob
from PIL import Image
d = sys.argv[1]; pat = sys.argv[2] if len(sys.argv) > 2 else '*.ppm'
fs = sorted(glob.glob(f'{d}/{pat}')); ims = [Image.open(f) for f in fs]
W, H = ims[0].size; s = Image.new('RGB', (W * len(ims), H))
for i, im in enumerate(ims): s.paste(im, (i * W, 0))
s.save(f'{d}/sheet.jpg', quality=88)
