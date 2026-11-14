# Melt

*le bain de bismuth.* Dans une marmite de fonte, le bismuth fondu est lisse comme un miroir. Au fond, sur la grille d'un panier à long manche, des cristaux ont poussé pendant que le bain refroidissait, et sa surface s'est couverte d'une peau d'oxyde dorée. On lève le panier : sa grille déchire la peau et sort la grappe du bain. Ce sont des cristaux en trémie, des cubes aux faces creusées en escaliers. À l'air, le métal s'oxyde aussitôt, et les couleurs apparaissent, du haut vers le bas : or, magenta, bleu, vert. On allume le brûleur, puis on replonge la grappe par crans : à chaque arrêt, la grappe est immobile et le bain la ronge. Une encoche se creuse à la ligne de flottaison, les parois minces fondent d'abord, un cristal dont la taille a cédé bascule et glisse dans le bain. La peau d'oxyde de chaque cristal englouti s'étale un instant sur le miroir, puis se défait. Le métal ne quitte jamais la marmite : on éteint le feu, le bain refroidit, la grappe repousse au fond.

![La grappe descend dans son bain et fond à sa ligne de flottaison (graine j4s5i6, humeur Tente claire, gros plan : la grappe suspendue au-dessus du bain, sur sa grille)](docs/capture.jpg)

Rendu en three.js (WebGPU), entièrement procédural : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md), avec l'historique des versions abandonnées. L'essai d'image qui a décidé du sujet est dans `proto/b0`, celui de la fonte calculée dans `proto/s0`.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL :
- `?seed=…` ;
- `#r=…` (scène retouchée, « Copier le lien ») ;
- `?ui=0` ;
- `?mobile=1` / `?mobile=0` ;
- `?debug` (outils dans `window.melt`), avec `&sink=port` pour le collecteur d'images.

Le panneau règle l'humeur, le port des cristaux, la grappe, la gamme et la vitesse d'oxydation, la durée, le cadrage, la caméra et le rendu. Export MP4 image par image et PNG.

## Principe : on sort la grappe, puis on l'y replonge

Une seule horloge (`src/cycle.js`). Le bain est fixe, à LB : le métal ne quitte jamais la marmite. C'est la grappe qui bouge, sur la grille d'un panier.

| t | Ce qu'on voit | Cause, à l'écran |
| --- | --- | --- |
| 0 – 0,01 | le miroir, couvert d'une peau d'oxyde dorée ; la grappe a repoussé au fond | le bain refroidit |
| 0,01 – 0,20 | la grille déchire la peau du centre vers les bords et sort la grappe du bain, le haut d'abord | on lève le panier par son manche |
| 0,20 – 0,32 | la grappe suspendue au-dessus du bain ; les couleurs mûrissent | l'air chaud ; on allume le brûleur |
| 0,32 – 0,94 | la grappe redescend par quatre crans ; à chaque arrêt, immobile, elle fond à sa ligne de flottaison ; les cristaux dont la taille a fondu basculent | on replonge le panier ; le bain chauffé par le brûleur frémit |
| 0,94 – 1 | les peaux d'oxyde des cristaux engloutis s'étalent et se défont ; le bain se couvre peu à peu d'une nouvelle peau | on éteint le brûleur, le bain refroidit |

La boucle affichée commence à t = 0,26 du cycle (`SHIFT`) : sa première image, et la vignette, montrent la grappe suspendue, pas un miroir vide.

Vue de la grappe, la ligne du bain ℓ(t) vaut LH au repos (0,14 cm au-dessus du plus haut cristal), LOW = −0,3 cm une fois la grappe suspendue (la grille 0,3 cm au-dessus du bain), et remonte par crans pendant la fonte : chaque cran dure 0,07 du temps de fonte, puis le cadre s'arrête. Dans le monde, la grille est à o(t) = LB − ℓ(t). Chaque cristal y ajoute son propre tassement, calculé par la simulation. La caméra suit la grappe à moitié. Le temps de la fonte est calé sur la simulation : les paliers montrés s'arrêtent quand le dernier cristal a disparu sous le bain (`meltEndOf`), puis la grille vide regagne le fond en 1,4 s. Sans cela, une grappe qui fond vite laissait le bain vide pendant les derniers paliers, plus de dix secondes.

Le scénario précédent vidait le bain par le fond puis le remplissait d'une louche. Il ne tenait pas : les cristaux refondus dans le peu de bain resté ne pouvaient pas le faire remonter, et la grappe, qui descendait sans s'arrêter, semblait couler plutôt que fondre. Ici, la grappe s'arrête, et c'est le bain qui la ronge sous nos yeux.

- **L'oxyde naît à la sortie du bain.** Un point de hauteur y sort du bain à t_e(y). Son oxyde s'épaissit en racine du temps passé à l'air : e = r · 300 nm · √(t − t_e). Il est plus épais sur l'arête de chaque terrasse, plus exposée, que au pied du gradin suivant : chaque marche porte son propre dégradé, au lieu d'une bande de couleur par gradin. La chaleur du bain l'épaissit juste au-dessus de la ligne pendant la fonte : les couleurs défilent devant elle.
- **La peau du bain qui refroidit.** Après la fonte, le bain se couvre d'une peau d'oxyde qui s'épaissit, plus vite au bord, contre la fonte froide. Elle reste dans les premières couleurs, paille, or et magenta pâle : plus épaisse, elle virait au brun sale. La grille qui sort la déchire du centre vers les bords.
- **La fonte est calculée** (`src/melt/model.js`, `src/scene/melt.js`). C'est un problème de Stefan, résolu par la méthode de l'enthalpie sur une grille 3D par cristal, au chargement, sur le GPU. Dans le repère du cristal, le bain monte par crans : sous la ligne, le métal brassé chauffe fort, au prorata de la part noyée d'une cellule. Au-dessus, un panache d'air chaud retombe vers l'air de l'atelier, sous le point de fusion. La grille, plus froide, tient le pied. Une cellule qui a reçu la moitié de sa chaleur latente fond ; au-dessus du bain, le liquide s'égoutte.
- **Ce qui en sort sans réglage à la main** : les parois minces et les arêtes fondent d'abord, et une encoche se creuse à la ligne, comme à la ligne de flottaison d'un iceberg. Quand la section au ras du bain tombe sous 15 % de ce qu'elle était à cette hauteur, la partie haute n'est plus portée que du côté du centre de la grappe : elle **bascule** sur ce bord, son côté extérieur tombe dans le bain en accélérant (son centre de gravité descend), s'y enfonce presque à fleur (le bismuth solide, 9,8 g/cm³, flotte à peine sur le liquide, 10,05 g/cm³), sans plus laisser dépasser que des bribes, et y fond tout entière avant la fin de la fonte. Quand il ne reste plus que 20 % du solide qui a été hors du bain (des arêtes minces, le cadre d'une trémie creuse), ces restes ne tiennent plus : ils s'effondrent dans le bain en une demi-seconde, ce qui le ride (plus lents, ils restaient en l'air comme des débris flottants). Sans cela, ces parois d'une ou deux cellules fondaient d'un coup, en l'air, d'une image à l'autre. Les petits cristaux fondent pendant qu'ils s'enfoncent.
- **On garde un seul champ par cristal** : l'instant τ où chaque point fond, et la vitesse du front v = 1/|∇τ|. Ce champ est lissé (cinq passes : la tension superficielle lisse les faces fondues) et rangé dans un atlas 3D. Le cristal à l'instant u de la fonte est { trémie } ∩ { τ > u }.
- **La peau d'oxyde** du cristal englouti s'étale depuis l'endroit où il a disparu. Le bain, chauffé par le bas, s'écoule en surface du centre vers les bords et l'emporte. Elle se fend, et ses plaques rapetissent jusqu'à rien avant la fin de sa vie : elle ne surgit pas d'un bloc, et aucune plaque ne disparaît encore visible.

**La boucle est parfaite par construction.** À t = 0 et t = 1, le bain couvre tout, la grappe a repoussé sous lui, et sa peau est entière. La peau d'oxyde d'un cristal englouti tard vit moins longtemps, pour être défaite avant la fin de la boucle. Un test vérifie, sur 200 graines, qu'aucun coin de cristal ne dépasse du bain à ces instants.

## Rendu

L'image est un lancer de rayons en shader de calcul WebGPU (`src/scene/tracer.js`). Il écrit l'image HDR dans une texture three.js, puis la chaîne d'image commune passe dessus.

- **Les trémies** sont des cubes dont chaque face est creusée d'au plus neuf gradins, larges en moyenne de 0,075 du demi-côté, chacun plus profond de 0,6 fois sa largeur. Leur largeur varie d'un gradin à l'autre (une déformation monotone de la distance au bord), comme sur un cristal qui a poussé par à-coups. Le creux s'arrête à 0,4 du demi-côté : le cristal reste plein au centre, ce n'est pas une cage de cadres. Le solide est l'intersection de la boîte et, pour chaque face, de « sous le fond de son gradin » : un max de distances, continu partout. L'ancienne version choisissait la face par l'axe dominant, ce qui faisait des coutures sur les plans diagonaux (des fenêtres noires au milieu des faces). Les variantes : en spirale (chaque gradin tourne de 0,07 rad) ou allongées (une boîte 1,6 fois plus longue, aux gradins de même largeur).
- **Les couleurs sont la réflectance d'une couche mince** : formule d'Airy, oxyde d'indice 2,2 sur le bismuth d'indice 1,9 + 3,4 i, à six longueurs d'onde, plus le terme de Fresnel (Schlick) qui rend tout métal miroir en incidence rasante. Aucune couleur n'est peinte. Les terrasses sont satinées : un léger dépoli tiré à chaque image, que l'anticrénelage moyenne.
- **La fonte** : la distance au cristal est max(trémie, (u − τ) · v). Cette distance n'est juste que près du front : là où le bain fond tout d'un coup, |∇τ| est presque nul, v monte à 30, et la marche traversait la surface (les dents de scie à la ligne de flottaison, les lambeaux, les déchirures noires). Elle est désormais bornée à quatre cellules de la grille. Une face fondue est du métal liquide, sans oxyde ; sa normale se prend à l'échelle d'une cellule, sinon les couches d'une cellule du champ τ se lisent en zébrures.
- **Le bain** est un miroir qui mouille le cristal (un ménisque), borné par la marmite. La peau d'oxyde y flotte, une seule pellicule en dégradé fendue en plaques de Voronoï ; un cristal qui bascule y fait des rides courtes et amorties ; il frémit quand le brûleur chauffe.
- **La grille** : un treillis d'acier (pas de 0,42 cm, fils de 0,04 cm) tendu dans un cerceau, dans la marche des rayons. Les cristaux reposent sur ses fils sans les traverser : le point le plus bas de chaque cube incliné (au plus 0,15 rad) touche le dessus des fils, et la grille dépasse le coin le plus éloigné de chaque pied. On voit le bain au travers. Une plaque pleine (la croûte figée), quoi qu'on en fasse, se lisait en socle ou en neige. C'est le fond d'un **panier à long manche**, comme un panier à friture : une fourche de deux tiges part du cerceau, au fond à gauche, et rejoint un montant d'acier de 4 mm qui monte au-dessus du bord de la marmite, puis se coude et part vers l'arrière, presque à plat, vers une main hors champ. Deux fils fins tendus vers un crochet ne se lisaient pas comme un outil capable de porter la grappe ; un manche droit à 68° se lisait en poteau ; sur le côté, il sortait du cadre des gros plans, et la grille semblait suspendue à rien.
- **Le creuset et l'atelier**, analytiques : la marmite de fonte (paroi intérieure et extérieure, bord à lèvre arrondie, assez haute pour faire le fond de l'image), le manche du panier, le brûleur, l'établi d'acier huilé avec l'ombre de la marmite. Ces matières rugueuses reçoivent l'éclairement analytique du dôme et des boîtes de lumière, plus un reflet adouci. La marmite est assez large pour que la caméra soit au-dessus de son fond : sa paroi du fond et son bord ferment l'image (plus de miroir infini). Le plan « Le creuset sur le feu » la montre entière, du dehors, avec les flammes du brûleur (une nappe bleue sous le fond, des langues qui lèchent la paroi, intégrées le long du rayon).
- **Le studio** est un dôme sombre, complété par des boîtes de lumière à bords doux, propres à chaque humeur : le bain se lit comme un miroir de métal, et un bord dur ne coupe plus les faces planes.
- **Le flou de mise au point** (lentille mince, point fait sur la grappe) n'est rendu qu'à l'export, où chaque sous-image tire son point de la lentille. En lecture, un tirage par image faisait trembler le flou, ce qu'on lisait comme une caméra qui bouge.

**Une distance juste pour les gradins.** La distance au cristal tient compte de la paroi du gradin extérieur voisin, pas seulement du fond du gradin. Sans elle, la marche traversait les parois, et les faces sortaient noires et piquées de points. Un rayon encore pris dans les gradins au dernier rebond voit le studio, pas le noir.

**L'anticrénelage.** Les arêtes des gradins, fines et brillantes, crénelaient. Chaque image est décalée d'une fraction de pixel (suite de Halton) et fondue dans un historique, borné par le voisinage 3 × 3 de l'image courante, pour que ce qui bouge ne laisse pas de traînée. Le bornage se fait sur des couleurs compressées (c / (1 + max c)), pour qu'un reflet très clair ne l'élargisse pas à lui seul. La caméra et la grappe vont lentement : sans reprojection, l'historique converge vers une image suréchantillonnée. Il repart de zéro après un saut de temps, de position ou de taille.

**La performance.** L'essai d'image prenait environ 215 ms par passe en 1280 × 800. La scène prend environ 15 ms par image (graine sal7va, au ras du bain), et jusqu'à 25 ms en gros plan quand toute la grappe est suspendue hors du bain (graine j4s5i6), anticrénelage compris. C'est plus que la toute première version (9 et 7 ms) : les gradins sont plus fins et plus nombreux, et la grappe entière se montre. Ce qui tient ce coût :
- tout ce qui bouge est calculé une fois par image en JavaScript, et la fonte une fois pour toutes ;
- chaque rayon ne visite que les cristaux dont la sphère englobante le croise ;
- un rayon qui ne croise aucun cristal touche le bain, le creuset et l'atelier analytiquement, sans marche ;
- une seule face par paire de faces opposées est évaluée (leurs creux ne se rejoignent pas), et une partie basculée a sa propre sphère englobante, qui disparaît quand elle a fini de fondre ;
- loin du plan de la grille, sa distance se borne sans calculer le treillis.

La résolution suit la cadence (résolution dynamique, aussi sur ordinateur).

La simulation de la fonte prend une à trois secondes au chargement (au plus 2,5 · 10¹⁰ cellules × pas ; le pas de la grille grandit pour les grosses grappes).

## Variations

| Axe | Valeurs |
| --- | --- |
| Humeur | Studio, Forge, Tente claire, Heure bleue |
| Port | trémie, spirale, allongée |
| Gamme d'oxyde | or et magenta, arc-en-ciel, bleus et verts, presque argent |
| Grappe | grappe, druse dense, un grand cristal et ses satellites |
| Cadrage | plan large, au ras du bain, gros plan, plongée, le creuset sur le feu (vu du dehors, environ une graine sur sept) ; le cadre suit la taille de la grappe |

## Tests

```bash
node --test melt/test/*.test.mjs
```

Les tests vérifient :
- la recette (déterministe, JSON, tous les choix tirés) ;
- le cycle : le bain ne bouge jamais ; la ligne vue de la grappe est continue et périodique, la grappe monte pendant la récolte, redescend pendant la fonte, et le cadre est immobile au milieu de chaque palier ;
- le raccord : aucun cristal ne dépasse du bain au début et à la fin de la boucle, sur 200 graines ;
- la grappe : des cristaux posés sur la grille, leur point le plus bas sur le dessus des fils (ni dessous, ni au-dessus), sans interpénétration franche ;
- la fonte : la grappe ne bouge pas pendant l'attente, regagne le fond à la fin, et la peau vient après ;
- le modèle thermique (en Node, sur une grille grossière) : le front suit de près la ligne de métal, et les parties minces fondent d'abord ;
- les grilles de fonte : elles contiennent chaque cristal et tiennent dans le budget ;
- la caméra, périodique, lente, toujours au-dessus du bain, même quand elle suit la grappe ; au-dessus du fond de la marmite (sa paroi proche hors champ), ou dehors pour le plan du creuset sur le feu ;
- l'appareillage : le brûleur s'allume pendant l'attente, avant la descente, brûle pendant la fonte et s'éteint après ;

## Performances

Environ 15 ms par image, jusqu'à 25 ms en gros plan quand la grappe est suspendue, en 1280 × 800, mesuré dans le panneau de navigateur de l'application. La résolution dynamique baisse la définition au-delà de 22 ms. La simulation de la fonte prend une à trois secondes au chargement ; elle est plus grossière sur mobile. Ce n'est vérifié ni sur mobile, ni sur un autre GPU.

## Version mobile

`?mobile=1` : résolution réduite et dynamique, cadence plafonnée à 60 i/s. Elle n'a pas été vérifiée sur un appareil réel.
