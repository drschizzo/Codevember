# Melt

*le bain de bismuth.* Dans un bain de bismuth fondu, lisse comme un miroir, le métal se retire et découvre des cristaux en trémie : des cubes aux faces creusées en escaliers. À l'air, le métal s'oxyde aussitôt, et les couleurs apparaissent, du haut vers le bas : or, magenta, bleu, vert. Puis le métal chaud remonte. Une bande de couleurs court devant lui, les arêtes s'arrondissent, les gradins se comblent d'argent liquide, un coin cède et tombe dans le bain, des gouttes perlent. La peau d'oxyde de chaque cristal englouti reste un instant à la surface, puis se fend en écailles irisées.

![Une trémie fond dans le bain ; sa peau d'oxyde se fend en écailles (graine b92, humeur Forge, t = 0,73)](docs/capture.jpg)

Rendu en three.js (WebGPU), entièrement procédural : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md), avec l'historique des versions abandonnées. L'essai d'image qui a décidé du sujet est dans `proto/b0`.

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

## Principe : une marée de métal

Une seule horloge (`src/cycle.js`). Le niveau du bain baisse linéairement de LH à LL = 0,22 cm entre t = 0,06 et 0,30, et remonte entre 0,60 et 0,86. La remontée suit x^1,5 : lente au pied des cristaux, plus vive au-dessus. La marée haute LH se règle sur la grappe : 0,14 cm au-dessus de son plus haut cristal. Une marée unique, taillée pour le plus grand cristal, engloutissait les petites grappes à mi-remontée.

- **L'oxyde naît à la sortie du bain.** Un point de hauteur y sort du bain à t_e(y). Son oxyde s'épaissit en racine du temps passé à l'air : e = r · 300 nm · √(t − t_e), plus un peu plus sur les gradins du fond.
- **La chaleur du métal qui remonte** épaissit l'oxyde juste au-dessus de la ligne (+220 nm · e^(−(y − L)/0,9)) : les couleurs défilent devant la ligne.
- **La fonte.** La part fondue m = r(t) · e^(−(y − L)/0,55) arrondit les arêtes, comble les gradins et change la surface en argent liquide, sans oxyde.
- **Le cycle.js calcule une fois par image** l'affaissement (quand la ligne atteint le pied d'un cristal, il s'enfonce de 0,3 demi-côté et penche), le coin de gradin qui cède quand la fonte atteint le milieu du cristal, les gouttes, la peau d'oxyde (qui apparaît quand le haut passe sous la ligne) et les rides de la chute.

**La boucle est parfaite par construction.** À t = 0 et t = 1, le bain couvre tout, et les cristaux repoussent dessous. Un test vérifie qu'aucun coin de cristal ne dépasse du bain à ces instants.

## Rendu

L'image est un lancer de rayons en shader de calcul WebGPU (`src/scene/tracer.js`). Il écrit l'image HDR dans une texture three.js, puis la chaîne d'image commune passe dessus.

- **Les trémies** sont des cubes dont chaque face est creusée en gradins, larges de 0,11 du demi-côté, chacun 0,75 fois plus profond que le précédent. Les variantes : en spirale (chaque gradin tourne de 0,07 rad) ou allongées.
- **Les couleurs sont la réflectance d'une couche mince** : formule d'Airy, oxyde d'indice 2,2 sur le bismuth d'indice 1,9 + 3,4 i, à six longueurs d'onde. Aucune couleur n'est peinte.
- **Le bain** est un miroir. La peau d'oxyde y flotte, une seule pellicule dont la couleur varie en dégradé, et se fend en grandes plaques de Voronoï ; les chutes y font des rides courtes et amorties (forte tension superficielle).
- **Le studio** est un dôme : sombre près de l'horizon, pour que le bain, vu en rasant, reste un miroir noir, et clair en hauteur, pour que les faces des cristaux attrapent la lumière. Il est complété par des boîtes de lumière, propres à chaque humeur.

**Une distance juste pour les gradins.** La distance au cristal tient compte de la paroi du gradin extérieur voisin, pas seulement du fond du gradin. Sans elle, la marche traversait les parois, et les faces sortaient noires et piquées de points. Un rayon encore pris dans les gradins au dernier rebond voit le studio, pas le noir. Les miroirs sont nets : sans anticrénelage temporel, un dépoli aléatoire n'est que du bruit.

**La performance.** L'essai d'image prenait environ 215 ms par passe en 1280 × 800. La scène prend environ 11 ms par image, pour trois raisons :
- tout ce qui bouge est calculé une fois par image en JavaScript ;
- chaque rayon ne visite que les cristaux dont la sphère englobante le croise ;
- un rayon qui ne croise aucun cristal touche le bain analytiquement, sans marche.

## Variations

| Axe | Valeurs |
| --- | --- |
| Humeur | Studio, Forge, Tente claire, Heure bleue |
| Port | trémie, spirale, allongée |
| Gamme d'oxyde | or et magenta, arc-en-ciel, bleus et verts, presque argent |
| Grappe | grappe, druse dense, un grand cristal et ses satellites |
| Cadrage | plan large, au ras du bain, gros plan, plongée ; le cadre suit la taille de la grappe |

## Tests

```bash
node --test melt/test/*.test.mjs
```

Les tests vérifient :
- la recette (déterministe, JSON, tous les choix tirés) ;
- la marée (continue, périodique, monotone) ;
- le raccord : aucun cristal ne dépasse du bain au début et à la fin de la boucle, sur 200 graines ;
- la grappe : des cristaux posés, sans interpénétration franche ;
- l'ordre de la fonte (affaissement, peau après engloutissement) ;
- la caméra, périodique, lente et toujours au-dessus du métal, même à marée haute ;
- la marée de chaque grappe : à mi-remontée, au moins un cristal dépasse encore.

## Performances

Environ 11 ms par image en 1280 × 800, mesuré dans le panneau de navigateur de l'application, panneau masqué. Rien n'est précalculé : la scène s'affiche dès que les shaders sont compilés. Ce n'est vérifié ni sur un écran visible, ni sur mobile.

## Version mobile

`?mobile=1` : résolution réduite et dynamique, cadence plafonnée à 60 i/s. Elle n'a pas été vérifiée sur un appareil réel.
