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

**La liberté (une seule) : le creuset qu'on vide puis qu'on chauffe.** On vide le bain pour découvrir les cristaux, puis le creuset chauffe par le bas et la croûte fond sous la grappe, qui descend dans son bain. Tout le reste suit la physique, et la fonte est calculée.

**Le cycle** (`src/cycle.js`, une seule horloge, durée 40 s) :

| t | Ce qu'on voit | Cause | Loi |
| --- | --- | --- | --- |
| 0 – 0,06 | le miroir seul ; sous lui, les cristaux ont repoussé pendant que le métal refroidissait | le froid | croissance en trémie |
| 0,06 – 0,30 | on vide le bain ; les cristaux sortent, le haut en premier ; le métal neuf s'oxyde aussitôt : les couleurs descendent avec le niveau | l'air chaud | oxyde en racine du temps passé à l'air |
| 0,30 – 0,52 | le bain bas ; les couleurs mûrissent (or, magenta, bleu) | l'air | couche mince d'Airy |
| 0,52 – 0,86 | **la fonte** : la grappe descend dans le bain, qui ne bouge pas ; la chaleur fait défiler les couleurs devant la ligne ; les parois minces et les arêtes fondent d'abord ; les gradins pendent en franges d'argent liquide ; une encoche se creuse à la ligne et le cristal se tasse quand sa taille cède, ce qui ride le bain | le creuset chauffe par le bas | problème de Stefan (simulé) |
| 0,86 – 0,90 | la peau d'oxyde de chaque cristal englouti s'étale sur le miroir, se fend, et ses plaques rapetissent jusqu'à rien | | |
| 0,90 – 0,97 | le bain se remplit, rien ne dépasse | | |

**La boucle se referme par construction.** À t = 0 et à t = 1, le bain couvre tout, et la grappe, descendue de toute la marée, a repoussé sous le miroir. Un test vérifie, pour 200 graines, qu'aucun coin de cristal ne dépasse.

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

**Le repère.** Premier film : le bain montait autour d'un cristal immobile. L'utilisateur : « on a plutôt l'impression que le sol monte plutôt que le cristal qui descend dans le sol en fondant ». La simulation calcule la même chose dans les deux cas (un bain qui monte le long du cristal, c'est un cristal qui descend dans son bain), mais l'image doit montrer le cristal qui descend. La cause : la croûte du fond, chauffée par le creuset, fond sous la grappe, et les cristaux qui y sont soudés s'enfoncent avec elle. Le rendu remet donc le bain et la caméra fixes, et fait descendre le cristal de L(u) − L_L, plus son tassement quand la taille cède.

**Ce qu'on garde** : pour chaque cellule, l'instant τ où elle fond. Le cristal à l'instant u est la trémie d'origine (faces nettes) ∩ { τ > u }, rendu par la distance φ = (u − τ)·v, avec v = 1/|∇τ|, la vitesse du front. Le champ est lissé (trois passes) : la méthode de l'enthalpie fond une cellule à la fois, et la tension superficielle lisse les faces fondues. Une face fondue est du métal liquide, sans oxyde. Il suffit d'une texture 3D par cristal, relue à chaque image. Le calcul prend 0,7 s sur le GPU (5 878 pas) ; `sim.mjs` est la même chose en Node, pour régler le modèle (`lead.mjs` mesure l'avance de la fonte sur la ligne de métal).

**Ce qui en sort sans réglage à la main** : les parois minces et les arêtes fondent d'abord, les gradins s'amollissent et pendent en franges de métal fondu le long de la ligne. Une encoche se creuse à la ligne, puis le bloc s'assoit dans son bain. La chaleur du métal fait défiler les couleurs de l'oxyde devant la fonte. Le film est dans `proto/s0/fonte.gif` : le cristal descend dans un bain fixe.

**Fait depuis** (voir « Intégration ») : plusieurs cristaux, l'intégration dans la scène, l'anticrénelage. **Pas fait** : la surface du bain (une simulation 2D en hauteur, qui porterait la peau et les rides).

## Intégration de la fonte calculée (14 novembre)

La scène calcule maintenant la fonte au chargement, une grille par cristal (`src/melt/model.js` pour le modèle et sa version de référence en Node, `src/scene/melt.js` pour le GPU). Le traceur lit chaque cristal dans un atlas 3D. Trois choses ont changé en route :
- **Le critère d'appui.** Il compare la section au ras du bain à la section **d'origine à la même hauteur**, et non à celle d'un cube plein. Une trémie creuse a une petite section à bien des hauteurs sans que rien n'ait fondu : avec l'ancien critère, les petits cristaux se tassaient sans fin dès le début.
- **Le panache d'air chaud** est moins chaud à la ligne (0,45 de la chaleur du bain au lieu de 0,85) et plus court. Les petits cristaux, aux parois de deux cellules, fondaient entiers dans l'air avant d'avoir commencé à descendre. Ils fondent maintenant pendant qu'ils s'enfoncent.
- **Le budget de calcul.** Au plus 2,5 · 10¹⁰ cellules × pas : le pas de la grille grandit pour les grosses grappes (une à trois secondes de calcul).

Les anciennes fontes dessinées (arrondi au-dessus de la ligne, coin qui tombe, gouttes, affaissement tiré au hasard) sont retirées. L'anticrénelage est temporel, sans reprojection : décalage de Halton et historique borné par le voisinage.

## Les derniers restes (14 novembre)

L'utilisateur : « les derniers résidus disparaissent de manière trop abrupte ». Les derniers restes d'un cristal (des arêtes, le cadre d'une trémie creuse) n'ont qu'une ou deux cellules d'épaisseur : tout leur métal fond au même pas, en l'air, d'une image à l'autre. Un tel squelette ne tient pas : quand il reste moins de 20 % du solide qui a été hors du bain, la simulation le fait s'effondrer dans le bain (4 cm par unité de u, soit environ une seconde et demie). Il disparaît en s'enfonçant, comme englouti, et le bain se ride à cet instant ; la peau d'oxyde s'étale ensuite depuis là.

## Les peaux qui s'éteignaient d'un coup (14 novembre)

L'utilisateur : des motifs « qui réduisent progressivement et puis en une frame ne sont plus là ». Les plaques de la peau d'oxyde rapetissaient, mais pas jusqu'à zéro : la vie de la peau (0,14 boucle) finissait alors que de grandes plaques restaient visibles. Désormais, la fente entre les plaques dépasse le plus grand écart possible entre deux germes de Voronoï avant 0,12 : tout a disparu avant la fin de la vie. Pour que le mouvement ait une cause, le bain, chauffé par le bas, s'écoule en surface du centre vers les bords et emporte la peau. Ses plis partent avec elle.

## Ce qui reste perfectible

- **Le tassement et l'effondrement** regardent le cristal entier, pas ses morceaux détachés un à un.
- **Les franges** des gradins latéraux, très régulières sur les grands cristaux, font parfois des peignes.
- **Les peaux d'oxyde** restent dessinées : la surface du bain n'est pas simulée.
- **Non vérifié :** mobile, et autres GPU que celui de cette machine.
