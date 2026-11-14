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

## Passe de DA (14 novembre)

Une planche de seize graines montrait trois défauts. Seule la planche les révélait, aucune image isolée.

- **Des faces noires, piquées de points.** La distance au cristal ignorait la paroi du gradin voisin : la marche la traversait et les normales devenaient du bruit. De plus, un rayon pris dans les gradins après trois rebonds rendait du noir, et le dépoli aléatoire des miroirs, sans anticrénelage temporel pour le moyenner, faisait du grain. Corrigés tous les trois, les gradins montrent enfin leurs couleurs.
- **Un bain vide pendant la fonte.** La marée montait à 2,9 cm pour toutes les grappes, et l'affaissement enfonçait chaque cristal de 0,55 demi-côté. À t = 0,72, tout était englouti pour la plupart des graines. Désormais, la marée haute se règle sur la grappe, l'affaissement est plus doux (0,3 demi-côté, sur 5,6 s) et la remontée est lente au pied des cristaux. La fonte dure jusqu'à t ≈ 0,79.
- **Une caméra sous le métal.** Au ras du bain, elle était à 1,3 cm sous une marée de 2,9 cm. Elle reste maintenant au-dessus de la marée haute (vérifié par un test), et le cadre suit la taille de la grappe.
- **Des peaux en confettis.** Chaque plaque avait une couleur tirée au hasard. La peau est maintenant une seule pellicule en dégradé, fendue en grandes plaques.

## Prototype s0 : la vraie fonte (14 novembre)

La fonte de la scène est une imitation : un arrondi et un comblement des gradins réglés à la main au-dessus de la ligne, un affaissement tiré au hasard, un coin qui tombe. L'utilisateur : « calculer une vraie simulation… je rappelle que c'est LE thème », avec une meilleure interaction avec le sol. `proto/s0` essaie de calculer la fonte au lieu de la dessiner.

**Le modèle (problème de Stefan, méthode de l'enthalpie)**, sur une grille 3D de 160 × 110 × 160 (pas 0,02 cm) autour d'une trémie :
- le solide, à peine sorti du bain, est juste sous le point de fusion ;
- sous la ligne, le bain chaud (brassé) échange fortement avec lui. Une cellule en partie noyée échange au prorata, faute de quoi la fonte se strie par couches ;
- au-dessus, l'air reçoit un panache chaud né du bain, qui retombe vers l'air de l'atelier (sous la fusion) ;
- la croûte du fond, plus froide, tient le pied du cristal (le creuset gèle par le bas) ;
- le solide conduit la chaleur. Une cellule qui a reçu la moitié de sa chaleur latente fond : au-dessus du bain le liquide s'égoutte, dessous il rejoint le bain ;
- l'appui : quand la section du solide au ras du bain tombe sous 15 % de celle du cristal (la taille a fondu, comme l'encoche à la ligne de flottaison d'un iceberg), le bloc au-dessus n'est plus porté et s'enfonce jusqu'à reposer sur une section plus large. La chaleur est calculée dans le repère du cristal.

**Ce qu'on garde** : pour chaque cellule, l'instant τ où elle fond. Le cristal à l'instant u est la trémie d'origine (faces nettes) ∩ { τ > u }, rendu par la distance φ = (u − τ)·v, avec v = 1/|∇τ|, la vitesse du front. Le champ est lissé (trois passes) : la méthode de l'enthalpie fond une cellule à la fois, et la tension superficielle lisse les faces fondues. Une face fondue est du métal liquide, sans oxyde. Il suffit d'une texture 3D par cristal, relue à chaque image. Le calcul prend 0,7 s sur le GPU (5 878 pas) ; `sim.mjs` est la même chose en Node, pour régler le modèle (`lead.mjs` mesure l'avance de la fonte sur la ligne de métal).

**Ce qui en sort sans réglage à la main** : les parois minces et les arêtes fondent d'abord, les gradins s'amollissent et pendent en franges de métal fondu le long de la ligne. Une encoche se creuse à la ligne, puis le bloc s'assoit dans son bain. La chaleur du métal fait défiler les couleurs de l'oxyde devant la fonte. Le film est dans `proto/s0/fonte.gif`.

**Pas encore fait** : la peau d'oxyde et la surface du bain (une simulation 2D en hauteur, qui porterait la peau et les rides) ; plusieurs cristaux ; l'intégration dans la scène (une grille par cristal, plus grossière pour les satellites) ; le crènelage des reflets.

## Ce qui reste perfectible

- **L'affaissement est un mouvement d'ensemble du cristal**, plus un coin qui tombe. Les gradins ne s'effondrent pas un à un.
- **Les reflets de gradins fins crènellent** (des escaliers de pixels), faute d'anticrénelage temporel ou de suréchantillonnage.
- **Les restes de cristaux allongés**, très arrondis en fin de fonte, deviennent des gélules lisses.
