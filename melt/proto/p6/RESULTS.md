# P6 : la colonne sans fin dans le fjord

On reprend P1 (avance de la colonne, cycle des saisons, détachement), mais dans l'eau stratifiée en sel de P4 :
- salinité de 12 g/kg au fond à 4 en surface ;
- α = 10⁻⁴ °C⁻¹, Le = 10, F = 4 ;
- T∞ de 3 à 10 °C sur une période P = 500 s simulées ;
- maille de 0,5 mm.

L'image (`out/fjord_*.png`) montre l'eau de fonte, moins salée que l'eau du large à la même hauteur, en clair.

```
node p6.js --name=fjord_E --F=4 --P=500 --v=1.5e-4 --T0=3 --T1=10 --periods=4
```

| Cas | avance | écart 1→2 | écart 2→3 | détachements |
| --- | --- | --- | --- | --- |
| C | 0,25 mm/s, arrêt l'été | 1,25 mm | 0,53 mm | aucun |
| D | 0,15 mm/s, arrêt l'été | 1,99 | 1,03 | aucun |
| E | 0,15 mm/s, continue | 1,08 | 0,44 | aucun |

Le coût est de 2,4 ms par pas, soit 21 000 pas par période.

## Ce qu'on voit

**Les nappes suivent les saisons.** C'est le geste du fjord, et il se lit.

| Phase | T∞ | nappes (cas C) | espacement |
| --- | --- | --- | --- |
| 0 | 3 °C | 0 | |
| 0,12 | 4 °C | 0 | |
| 0,38 | 9 °C | 4 | 9 à 16 mm |
| 0,5 | 10 °C | 9 | 4 à 13 mm, 8,5 mm en moyenne |
| 0,62 | 9 °C | 10 | 4 à 16 mm |
| 0,88 | 4 °C | 0 | |

- L'hiver, l'eau de fonte reste une gaine collée à la glace.
- Dès que le lac se réchauffe, elle quitte la paroi en nappes horizontales, empilées tout le long de la colonne, qui s'étalent sur 1 à 2 cm.
- À l'automne, elles se dissipent.

C'est conforme à Huppert et Turner : l'épaisseur des nappes est proportionnelle à l'écart de densité dû à la température, presque nul vers 3–4 °C. Il y a enfin une cause visible (la saison) et un effet visible dans l'eau elle-même.

**La glace devient un long cône**, comme en eau douce avec une avance continue (P1) : la forme dépend de l'âge de la glace. En hiver, de petites crêtes de glace restent aux hauteurs où les nappes partaient. C'est l'amorce des gradins, à peine marquée.

**Il n'y a pas de détachement**, même avec l'arrêt de l'été. En eau salée, l'eau de fonte monte toujours le long de la glace, quelle que soit la température : la fonte la plus forte est en bas, pas à la ligne d'eau. Le col et la bascule ne viennent pas d'eux-mêmes dans le fjord.

**La boucle converge plus lentement qu'en eau douce** : environ ×2 par période, contre ×5. Il faudra 6 à 8 périodes au chargement, ou un départ depuis un état déjà périodique enregistré.

## Limites

- **La boîte est fermée.** L'eau de fonte s'accumule au fond et sous la surface malgré l'éponge (bandes claires en haut et en bas des images). Il faut une éponge plus forte, ou un domaine plus grand.
- **Le = 10, équation d'état linéaire**, pas d'abaissement du point de fusion.
- **Les relevés de la dernière période** ne donnent que 7 images au lieu de 8 (un arrondi dans l'échantillonnage).

## Pour la suite

1. Le cœur du film du fjord, ce sont **les nappes qui fleurissent l'été et se résorbent l'hiver**, autour d'un cône de glace qui descend sans fin. P7 doit vérifier qu'elles se voient à l'image : réfraction et ombre au soleil.
2. **La bascule n'arrive pas d'elle-même dans le fjord.** Pour la garder, il faudrait :
   - une couche de surface plus chaude et douce, qui crée un col à la ligne d'eau (une vraie stratification thermique d'été dans les fjords) ;
   - ou renoncer à la bascule dans cette famille.
