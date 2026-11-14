# Melt, version retenue : eau douce et bascule

Thème : **« melt »**. Sous-titre : *la colonne sans fin*.

Cette version a été choisie le 14 novembre, après huit prototypes (P0 à P7, `proto/*/RESULTS.md`). Elle ne garde que ce qui s'est montré à la fois exact et visible :
- une colonne de glace bulleuse, qui se lit dans l'eau ;
- sa forme, que l'eau change au fil des saisons ;
- son détachement à la ligne d'eau ;
- sa bascule.

L'écoulement qui sculpte la glace ne se voit pas à cette échelle : ni par les bulles, ni par la turbidité, ni par l'ombroscopie en lumière naturelle (P3, P5, P7). Le film ne le montre donc pas. **Sa cause visible, c'est la saison** (la lumière, la température du lac), et son effet visible, c'est **la forme**.

Les versions précédentes restent comme historique : `concept-pinacles.md` (eau douce, festons, bulles) et `concept-fjord.md` (nappes salées).

## L'image

Une colonne de glace blanche et translucide, de 2 à 3 cm de diamètre, pend de la surface d'un lac de montagne, qu'on voit de dessous comme un plafond d'argent où elle se reflète. Elle remplit la hauteur du cadre.

L'hiver, elle descend lentement, et son bout s'arrondit. L'été, elle s'arrête, et l'eau l'amincit juste sous la ligne d'eau. Elle finit par s'en détacher : le fuseau libéré bascule en une demi-seconde, se couche contre son reflet, puis dérive avec la brise. À l'automne, une colonne neuve traverse le miroir.

## La liberté (une seule)

La colonne n'a pas de fin. Elle descend de la surface sans support visible l'hiver, et s'arrête l'été.

## Les causes visibles

- **La saison** : la lumière (basse et bleue l'hiver, rayons de soleil l'été) et la température du lac (de 3 à 9 °C), qui fixe le sens de l'écoulement. L'eau froide fait monter la couche limite et arrondit le bas de la colonne. L'eau chaude la fait descendre depuis la surface, et c'est la ligne d'eau qui fond le plus.
- **La gravité et la poussée d'Archimède**, pour la bascule. Elle est exacte : le fuseau se couche avec 8,3 % de son volume émergé.
- **La brise**, pour la dérive : les rides de la surface.

## Les familles (des mouvements distincts au temps fort)

La bascule dépend de l'élancement D/L du fuseau libéré. Un cylindre de glace ne flotte debout que si D/L > 0,78.

| Famille | Colonne | Temps fort |
| --- | --- | --- |
| **Le chavirement** | fine, avance rapide : fuseau long (D/L ≈ 0,2) | il s'incline, bascule en 0,5 s, dépasse jusqu'à ≈ 105°, se couche (P2) |
| **La révérence** | moyenne : D/L ≈ 0,6–0,8 | il penche jusqu'à un équilibre incliné et y oscille (à calculer) |
| **Le bouchon** | épaisse, avance lente : fuseau trapu (D/L > 0,8) | il remonte et flotte debout, en pilonnant, sans basculer (à calculer) |

Les autres axes de variation :
- la section du fût (ronde, carrée, hexagonale) ;
- la glace (bulleuse fine, à chapelets, stratifiée, bleue de glacier) ;
- la plage de température du lac ;
- l'humeur.

## Les humeurs

Ce sont celles de P3, qui ont toutes été rendues :
- **Nuit** (Sugimoto) : fond noir, une boîte douce de côté ;
- **Fenêtre de Snell** : la bascule vue d'en dessous, le fuseau rejoignant son reflet ;
- **Ombre de lentille** : lumière parallèle, l'ombre de la glace sur un fond clair à côté de la colonne presque invisible ;
- **Lait glaciaire** ;
- **Tourbe** ;
- **Bassin de pierre**.

## La boucle

Elle suit la méthode de P1 :
- avance pendant la saison froide, arrêt l'été, raccords doux ;
- détachement à phase fixe (±0,003 d'une période à l'autre) ;
- toute la glace visible est neuve à chaque période ;
- l'écart d'une période à la suivante tombe à environ 0,15 mm.

Le fuseau libéré est un corps rigide (P2) qui sort du cadre avant la fin de la boucle.

**Le défaut à corriger (P8)** : après le détachement, un quart de la boucle restait sans sujet. Le fuseau qui flotte et dérive doit remplir ce temps, et la colonne doit redescendre plus tôt.

## Le cœur technique

- **Le solveur axisymétrique** de P0 et P1 : Boussinesq avec l'anomalie de densité, glace par enthalpie, Brinkman, avance et lac. Il coûte 2 ms par pas en Node, soit environ 35 s par période. Il est à porter en WebGPU, ou à calculer pendant l'écran de chargement.
- **Le corps rigide** de P2, à passer en 3D, avec la brise.
- **Le lancer de rayons** de P3, avec le profil simulé (P5).

## Plan

- **P8** : régler l'avance pour qu'il n'y ait plus de quart de boucle sans sujet. Mesurer l'élancement du fuseau au détachement.
- **La planche du film** : huit images de la boucle, rendues d'après la simulation.
- Ensuite : la scène, avec la skill `codevember-scene`.
