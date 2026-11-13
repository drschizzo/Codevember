#!/usr/bin/env python3
"""Planche de la collection : toutes les captures côte à côte, et leurs mesures.

    python3 .claude/skills/codevember-scene/scripts/planche.py [--out planche.jpg] [--candidat image.jpg]
    python3 .claude/skills/codevember-scene/scripts/planche.py --dossier <images d'un projet> [--out planche.jpg]

La variété se juge sur la collection, pas seulement d'une graine à l'autre
(SKILL.md, « Le regard », règle 25). Pour chaque `*/docs/capture.jpg` du dépôt
(ou l'image candidate), le script mesure :

- `méd`    : luminance médiane (0–1) ;
- `ampl`   : amplitude des valeurs, p99,5 − p1 (une image « plate » < 0,45 ; une image
             en clé basse, un trait clair sur du noir, passe) ;
- `ambre`  : part des pixels colorés dont la teinte tombe dans 15–55° (sépia,
             ambre, brun, orangé) ;
- `teinte` : teinte dominante des pixels saturés (en degrés) ;
- `sat`    : saturation moyenne.

Une image est « sépia » si `ambre` > 0,6 et `sat` < 0,45. Le script imprime la
part de la collection qui l'est, et pour une candidate, ses trois voisines les
plus proches en palette (histogramme teinte × valeur) : si la plus proche est à
moins de 0,25, la candidate refait une image déjà vue.

Avec `--dossier`, le script mesure à la place les images d'un dossier — une
planche `sheet()` d'un projet, une image par humeur ou par famille et par
phase — et dit ce que la capture d'ouverture seule ne dit pas : si les humeurs
sont des films différents (distance de palette entre images : sous 0,25, deux
images se confondent en vignette) et si chaque image passe l'épreuve de
l'affiche (règle 23 : amplitude > 0,5, ni « plate » ni « bouchée »).
"""
import argparse
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
W, H = 480, 270


def load(path):
    im = Image.open(path).convert('RGB')
    r = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.Resampling.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def measure(im):
    a = np.asarray(im, dtype=np.float32) / 255.0
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    hsv = np.asarray(im.convert('HSV'), dtype=np.float32) / 255.0
    h, s, v = hsv[..., 0] * 360.0, hsv[..., 1], hsv[..., 2]
    colored = (s > 0.18) & (v > 0.08)
    hc = h[colored]
    amber = float(((hc >= 15) & (hc <= 55)).mean()) if hc.size else 0.0
    if hc.size:
        ang = np.deg2rad(hc)
        hue = float(np.rad2deg(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360)
    else:
        hue = float('nan')
    hist, _, _ = np.histogram2d(h.ravel(), v.ravel(), bins=(12, 6), range=((0, 360), (0, 1)),
                                weights=(0.15 + s).ravel())
    hist = hist.ravel() / hist.sum()
    p1, p50, p99 = np.percentile(lum, [1, 50, 99.5])
    return dict(med=float(p50), ampl=float(p99 - p1), ambre=amber, teinte=hue,
                sat=float(s[v > 0.08].mean() if (v > 0.08).any() else 0), hist=hist)


def sepia(m):
    return m['ambre'] > 0.6 and m['sat'] < 0.45


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=None)
    ap.add_argument('--candidat', default=None)
    ap.add_argument('--dossier', default=None)
    args = ap.parse_args()

    if args.dossier:
        paths = sorted(p for p in glob.glob(os.path.join(args.dossier, '*')) if p.lower().endswith(('.jpg', '.jpeg', '.png')))
        names = [os.path.splitext(os.path.basename(p))[0][-16:] for p in paths]
        if not paths:
            sys.exit(f'aucune image dans {args.dossier}')
    else:
        paths = sorted(glob.glob(os.path.join(ROOT, '*', 'docs', 'capture.jpg')),
                       key=lambda p: os.path.getmtime(p))
        names = [p.split(os.sep)[-3] for p in paths]
    ims = [load(p) for p in paths]
    ms = [measure(im) for im in ims]

    print(f"{'projet':16s} {'méd':>5s} {'ampl':>5s} {'ambre':>6s} {'teinte':>6s} {'sat':>5s}")
    for n, m in zip(names, ms):
        flags = []
        if sepia(m):
            flags.append('SÉPIA')
        if m['ampl'] < 0.45:
            flags.append('PLATE')
        if m['med'] < 0.08:
            flags.append('BOUCHÉE')
        print(f"{n:16s} {m['med']:5.2f} {m['ampl']:5.2f} {m['ambre']:6.2f} {m['teinte']:6.0f} {m['sat']:5.2f}  {' '.join(flags)}")
    k = sum(sepia(m) for m in ms)
    print(f"\nsépia : {k}/{len(ms)} ({100 * k / max(1, len(ms)):.0f} %) — viser moins d'un tiers")

    if args.dossier and len(ms) > 1:
        # variété du jeu d'images : distances de palette deux à deux
        pairs = sorted((0.5 * float(np.abs(ms[i]['hist'] - ms[j]['hist']).sum()), names[i], names[j])
                       for i in range(len(ms)) for j in range(i + 1, len(ms)))
        close = [p for p in pairs if p[0] < 0.25]
        print(f"variété : distance moyenne {np.mean([p[0] for p in pairs]):.2f}, minimale {pairs[0][0]:.2f}"
              f" ; {len(close)}/{len(pairs)} paires se confondent (< 0,25)")
        for dist, a, b in close[:8]:
            print(f"  {a:16s} ≈ {b:16s} {dist:.2f}")
        weak = [n for n, m in zip(names, ms) if m['ampl'] < 0.5 or m['med'] < 0.08]
        print(f"affiche : {len(ms) - len(weak)}/{len(ms)} images tiennent (amplitude ≥ 0,5 et médiane ≥ 0,08)"
              + (f" ; à revoir : {', '.join(weak[:10])}" if weak else ''))

    if args.candidat:
        c = measure(load(args.candidat))
        own = os.path.abspath(args.candidat).split(os.sep)[-3] if args.candidat.endswith(os.path.join('docs', 'capture.jpg')) else None
        d = sorted((0.5 * np.abs(c['hist'] - m['hist']).sum(), n) for n, m in zip(names, ms) if n != own)
        print(f"\ncandidate : méd {c['med']:.2f} ampl {c['ampl']:.2f} ambre {c['ambre']:.2f}"
              f" teinte {c['teinte']:.0f} sat {c['sat']:.2f}{'  SÉPIA' if sepia(c) else ''}")
        for dist, n in d[:3]:
            print(f"  voisine {n:16s} distance {dist:.2f}{'  (trop proche)' if dist < 0.25 else ''}")

    if args.out:
        cols = 4
        rows = (len(ims) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * W, rows * H), (12, 12, 12))
        try:
            font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
        except OSError:
            font = ImageFont.load_default()
        for i, (n, im, m) in enumerate(zip(names, ims, ms)):
            x, y = (i % cols) * W, (i // cols) * H
            sheet.paste(im, (x, y))
            dr = ImageDraw.Draw(sheet)
            label = f"{n}{'  sépia' if sepia(m) else ''}"
            dr.rectangle((x, y, x + 12 + 10 * len(label), y + 26), fill=(0, 0, 0))
            dr.text((x + 6, y + 4), label, fill=(255, 255, 255), font=font)
        sheet.save(args.out, quality=88)
        print(f"\nplanche : {args.out}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
