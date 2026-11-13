#!/usr/bin/env python3
"""Compare deux séries d'images de tools/regress.html.

    python3 tools/regress.py <avant> <apres> [--bruit <avant-bis>] [--seuil 1.5] [--planche ecarts.jpg]

Deux rendus du même code ne sont pas identiques au pixel (grain, tramage de
l'anticrénelage temporel, simulations sur GPU) : les images sont d'abord
moyennées par blocs de 8 × 8 pixels, ce qui efface le grain et garde tout ce
qui compte (exposition, couleur, lumière, pièce absente ou déplacée). Pour
chaque image présente dans les deux dossiers : écart absolu moyen et plus
grand écart d'un bloc (sur 255). Avec --bruit (une deuxième série « avant »,
rendue sans rien changer), l'écart est comparé au bruit propre de l'image :
elle régresse si son écart moyen dépasse seuil × bruit + 0,1 ou si son plus
grand bloc dépasse seuil × celui du bruit + 4. Sans --bruit, les planchers
sont 0,1 et 4.

Une image signalée se regarde avant de conclure : --planche écrit, pour chacune,
une bande « avant | après | écart × 8 ». Un écart localisé sur ce qui bouge
tout seul (poussières, étincelles, particules réglées sur l'horloge) n'est pas
une régression ; une teinte, une exposition, une pièce qui change en est une.
Code de sortie 1 s'il y a une régression ou une image manquante.
"""
import os, sys
import numpy as np
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {sys.argv[i]: sys.argv[i + 1] for i in range(1, len(sys.argv) - 1) if sys.argv[i].startswith('--')}
if len(args) < 2:
    sys.exit(__doc__)
# (les valeurs des options ne sont pas des dossiers)
args = [a for a in args if a not in opt.values()]
A, B = args[:2]
noise_dir, k = opt.get('--bruit'), float(opt.get('--seuil', 1.5))

def diff(p, q):
    a, b = Image.open(p).convert('RGB'), Image.open(q).convert('RGB')
    if a.size != b.size:
        return None
    small = (a.size[0] // 8, a.size[1] // 8)
    a = np.asarray(a.resize(small, Image.Resampling.BOX), dtype=np.float32)
    b = np.asarray(b.resize(small, Image.Resampling.BOX), dtype=np.float32)
    d = np.abs(a - b)
    return float(d.mean()), float(d.max())

bad = 0
flagged = []
print(f"{'image':28} {'moy':>7} {'max':>7} {'bruit':>7} {'max':>7}")
for f in sorted(os.listdir(A)):
    if not f.endswith('.png'):
        continue
    if not os.path.exists(os.path.join(B, f)):
        print(f'{f:28} MANQUANTE'); bad += 1; continue
    d = diff(os.path.join(A, f), os.path.join(B, f))
    if d is None:
        print(f'{f:28} TAILLE DIFFÉRENTE'); bad += 1; continue
    n = None
    if noise_dir and os.path.exists(os.path.join(noise_dir, f)):
        n = diff(os.path.join(A, f), os.path.join(noise_dir, f))
    flag = '  RÉGRESSION' if d[0] > (k * n[0] if n else 0) + 0.1 or d[1] > (k * n[1] if n else 0) + 4 else ''
    bad += bool(flag)
    if flag: flagged.append(f)
    print(f"{f:28} {d[0]:7.3f} {d[1]:7.1f} {(f'{n[0]:7.3f} {n[1]:7.1f}' if n else '      –       –')}{flag}")
if opt.get('--planche') and flagged:
    from PIL import ImageChops, ImageDraw
    rows = []
    for f in flagged:
        a, b = Image.open(os.path.join(A, f)).convert('RGB'), Image.open(os.path.join(B, f)).convert('RGB')
        d = ImageChops.difference(a, b).point(lambda v: min(255, v * 8))
        w, h = a.size
        row = Image.new('RGB', (w * 3, h))
        for i, im in enumerate((a, b, d)): row.paste(im, (i * w, 0))
        row = row.resize((1800, round(h * 1800 / (3 * w))))
        ImageDraw.Draw(row).text((8, 6), f, fill=(255, 255, 0))
        rows.append(row)
    sheet = Image.new('RGB', (1800, sum(r.size[1] for r in rows)))
    y = 0
    for r in rows: sheet.paste(r, (0, y)); y += r.size[1]
    sheet.save(opt['--planche'], quality=85)
print(f"\n{bad} image(s) en écart" if bad else '\naucune régression')
sys.exit(1 if bad else 0)
