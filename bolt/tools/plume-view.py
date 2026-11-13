# Planche : 12 images de la simulation, le demi-plan (r, z) complété par symétrie
import json, sys
from PIL import Image
raw = open(sys.argv[1], 'rb').read(); M = json.load(open(sys.argv[1] + '.json')); NR, NZ, NF = M['NR'], M['NZ'], M['NF']
k = 3; cols = 12; S = Image.new('L', (cols * NR * 2 * k, NZ * k))
for c in range(cols):
    f = min(NF - 1, round((c + 1) * NF / cols) - 1)
    im = Image.frombytes('L', (NR, NZ), raw[f * NR * NZ:(f + 1) * NR * NZ]).transpose(Image.FLIP_TOP_BOTTOM)
    full = Image.new('L', (NR * 2, NZ)); full.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (0, 0)); full.paste(im, (NR, 0))
    S.paste(full.resize((NR * 2 * k, NZ * k)), (c * NR * 2 * k, 0))
S.save(sys.argv[2])
