# Melt — document de travail

Thème : **« melt »**. Sous-titre : *le bain de bismuth*.

## Historique

C'est la cinquième version du concept. Les précédentes sont gardées pour la trace :
- **le flocon** qui fond en perles : l'historique git avant le 14 novembre ;
- **les pinacles** (`concept-pinacles.md`) ;
- **le fjord** (`concept-fjord.md`) ;
- **la colonne de glace** (`concept-colonne.md`), réalisée puis abandonnée : juste physiquement, mais « n'évoque rien », avec dix secondes de calcul pour une image pauvre.

**La leçon retenue** : on fait l'image d'abord, la physique ensuite. Cette version est partie d'un essai d'image (`proto/b0`), validé par l'utilisateur à chaque étape (cristaux, couleurs, fonte), avant toute construction.

## Le thème en largeur (ce qui a décidé du bismuth)

- **Le bismuth fond à 271 °C.** Refroidi lentement, il donne des **cristaux en trémie** : des cubes dont les faces sont creusées en escaliers, parce que les arêtes et les coins poussent plus vite que le milieu des faces. La diffusion y empêche mieux l'accumulation qui freine la croissance (Scientific Reports, 2023).
- **Ses couleurs viennent d'une couche mince d'oxyde** (Bi₂O₃, quelques dizaines à quelques centaines de nanomètres), qui fait interférer la lumière : or, magenta, bleu, vert. C'est la même physique que les couleurs de revenu de l'acier.
- **Le métal fondu est un miroir**, couvert d'une peau d'oxyde grise que l'on écume. Les cristaux refondus perdent leur peau.
- **Le bismuth solide est moins dense que le liquide** (il se dilate en gelant, comme l'eau).

## La piste retenue

**L'image.** Un bain de bismuth fondu, noir et lisse comme un miroir, sous un studio de photographe. Des trémies irisées s'y dressent et s'y reflètent, chaque cristal et son double formant une figure.

**La liberté (une seule) : la marée de métal.** Le bain se retire et découvre les cristaux, puis remonte et les refond. Tout le reste suit la physique.

**Le cycle** (`src/cycle.js`, une seule horloge, durée 40 s) :

| t | Ce qu'on voit | Cause | Loi |
| --- | --- | --- | --- |
| 0 – 0,06 | le miroir seul ; sous lui, les cristaux ont repoussé pendant que le métal refroidissait | le froid | croissance en trémie |
| 0,06 – 0,30 | le bain se retire ; les cristaux sortent, le haut en premier ; le métal neuf s'oxyde aussitôt : les couleurs descendent avec la marée | l'air chaud | oxyde en racine du temps passé à l'air |
| 0,30 – 0,60 | le bain bas ; les couleurs mûrissent (or, magenta, bleu) | l'air | couche mince d'Airy |
| 0,60 – 0,86 | **la fonte** : le métal chaud remonte ; une bande de couleurs court devant lui ; les arêtes s'arrondissent, les gradins se comblent en argent liquide ; les cristaux s'affaissent et penchent quand leur pied fond ; un coin de gradin cède, tombe et ride le bain ; des gouttes perlent et glissent ; la peau d'oxyde de chaque cristal englouti flotte un instant, se fend en écailles irisées et se dissout | la chaleur du métal | chaleur, tension superficielle, gravité |
| 0,86 – 1 | le miroir (= t 0) | | |

**La boucle se referme par construction.** À t = 0 et à t = 1, le bain couvre tout. Un test vérifie, pour 200 graines, qu'aucun coin de cristal ne dépasse. Les cristaux repoussent sous le miroir.

**Le regard** : la photographie de minéraux de musée. Un studio sombre, des boîtes de lumière, l'objet qui tranche sur le fond, et le reflet comme second sujet.

## Variations

| Axe | Valeurs |
| --- | --- |
| Humeur (le studio que le métal reflète) | Studio (dôme clair au zénith, fond noir), Forge (lueur orangée sous l'horizon), Tente claire (high key), Heure bleue |
| Port des cristaux | trémie, trémie en spirale, allongée |
| Gamme d'oxyde (vitesse d'oxydation) | or et magenta, arc-en-ciel, bleus et verts, presque argent |
| Grappe | grappe, druse dense, un grand cristal et ses satellites |
| Cadrage | plan large, au ras du bain, gros plan, plongée |

4 × 3 × 4 × 3 × 4 = 576 combinaisons, plus la graine de chaque grappe.

## Ce qui reste perfectible (au 14 novembre)

- **La qualité est inégale selon les graines.** Certains cadrages en gros plan sont trop serrés pour le grand cristal du port « solitaire ». Beaucoup de facettes restent noires (des parois de gradins qui reflètent l'horizon sombre).
- **L'affaissement est un mouvement d'ensemble du cristal**, plus un coin qui tombe. Les gradins ne s'effondrent pas un à un.
- **La peau d'oxyde garde une mosaïque régulière** dans les plans larges.
