# P1 : la colonne sans fin, le cycle des saisons

Solveur de P0 (axisymétrique, Boussinesq avec l'anomalie de densité, glace par enthalpie, Brinkman ; F = 20, maille de 0,5 mm), avec trois ajouts :
- **l'avance** : la glace descend d'une rangée exacte chaque fois qu'elle a avancé d'une maille ;
- **le lac** : au-delà de a + 8 mm, l'eau est rappelée vers T∞(t), qui fait un cycle en cosinus de période P = 400 s simulées (≈ 1 h physique) ;
- **le détachement** : la glace qui n'est plus reliée à la surface est retirée, et l'événement est noté.

On simule 4 à 6 périodes et on mesure l'écart de forme d'une période à la suivante, à phase égale.

```
node p1.js --name=meta_inter --T0=3 --T1=9 --P=400 --v=5e-4 --feedOff=0.3,0.72 --periods=4
```

Le coût est de 1,9 à 2,1 ms par pas : 17 000 pas, soit environ 35 s par période, sur un fil.

## 1. La boucle se referme d'elle-même

| Cas | écart 0→1 | 1→2 | 2→3 | 3→4 | 4→5 |
| --- | --- | --- | --- | --- | --- |
| aiguille, 1 → 4,5 °C, v = 0,18 mm/s (`aiguille2b`) | 4,2 mm | 1,6 | 0,35 | 0,07 | **0,014 mm** |
| métamorphose, avance intermittente (`meta_inter`) | 5,2 | 0,16 | 0,15 (max 8,5) | | |
| fuseau, avance intermittente (`fuseau_inter`) | 4,3 | 0,14 | 0,12 (max 7,9) | | |

- **Sans détachement**, l'écart est divisé par environ 5 à chaque période. Après 5 périodes, il reste sous la taille d'une maille, et l'état périodique est atteint par construction (toute la glace visible est neuve).
- **Avec détachement**, l'écart moyen tombe à 0,15 mm, mais l'écart maximal reste de 8 à 10 mm. Ce sont quelques relevés autour de l'instant où la colonne cède, qui varie d'un relevé (2 s) d'une période à l'autre. Pour la scène, on prendra la dernière période et on fixera l'instant du détachement, puis on absorbera le reste par la méthode du plancher périodique de Tension.

## 2. Avance continue : la forme ne dépend plus que de l'âge de la glace

Résultats dans `out/continu/`.

Quand la colonne avance sans arrêt, la glace de la ligne d'eau est toujours neuve, et la glace profonde est la plus vieille, donc la plus fine. **La colonne devient un cône pointé vers le bas, quelle que soit la saison** :
- à 7–9 °C (`fuseau`), un cône droit d'environ 4 cm, avec un panache froid qui tombe de la pointe ;
- à 1–4,5 °C, un cône plus long, aux flancs concaves.

Il n'y a **plus de col à la ligne d'eau, ni de détachement** après la première période. La famille « fuseau » disparaît, et les familles se ressemblent : un cône plus ou moins effilé.

De plus, `meta_continu` (3 → 9 °C) diverge (NaN à t = 536 s, sans réduction de pas). L'instabilité n'est pas élucidée ; les autres cas sont stables.

## 3. Avance intermittente : le col et le détachement reviennent

La colonne descend pendant la saison froide et s'arrête l'été (`--feedOff=0.3,0.72`, raccords de 0,05). C'est toujours la même liberté, la colonne sans fin, mais elle avance par saisons.

Pendant l'arrêt, le comportement de P0 revient : la colonne s'amincit à la ligne d'eau, puis **se détache à la même phase à chaque période** :
- 0,58 pour la métamorphose, 0,505 pour le fuseau, à ±0,003 d'une période à l'autre ;
- la souche neuve redescend ensuite.

Le cycle de la métamorphose (`out/meta_inter.png`, 8 phases) :
1. une souche arrondie entre ;
2. la colonne descend, au bout arrondi ;
3. elle s'amincit en haut et en bas et devient un fuseau suspendu ;
4. elle se détache ;
5. puis il n'y a plus que la souche à la surface, pendant **environ un quart de la boucle** ;
6. la souche redescend.

## Ce que cela change au concept

1. **L'avance est saisonnière.** La colonne descend l'hiver et s'arrête l'été. Sans cet arrêt, il n'y a ni col, ni détachement, ni bascule.
2. **L'aiguille d'hiver ne sort pas dans la métamorphose.** La glace qui vient d'entrer est trop jeune, et le bout reste arrondi. Elle n'existe que dans la famille Aiguille, avec une avance lente. Mais dans cette famille, la forme change peu au cours du cycle : le cône s'allonge et se raccourcit à peine. Le geste est faible.
3. **Un quart de boucle sans sujet**, entre le détachement et la redescente. C'est le défaut de l'ancienne version (l'image vide à u = 0,9). Il faut le remplir : le fragment qui flotte et dérive dans le cadre (P2), une redescente plus tôt, ou un arrêt plus court.
4. **Les familles se différencient moins que prévu.** Elles donnent toutes un cône ou un fuseau, avec ou sans détachement. Les vraies différences visibles seraient la Pagode (P4) et la bascule.

## Limites

- Le fragment détaché est retiré de la grille. Son eau froide et son écoulement disparaissent avec lui.
- Des « micro-détachements » de 0,01 à 0,1 cm³ apparaissent à la reprise de l'avance. C'est un artefact du remplissage de la rangée du haut.
- F = 20 partout. P0 a montré que les pointes y sont peu sensibles, mais pas le régime intermédiaire.
