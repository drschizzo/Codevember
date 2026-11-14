# Melt, troisième version : le fjord

Thème : **« melt »**. Sous-titre : *la colonne sans fin*.

Ce document prend la suite de `concept-pinacles.md`, qui garde la trace des essais en eau douce et des prototypes P0 à P5. Le choix du fjord a été fait le 14 novembre, après le bilan de ces prototypes. P6 (`proto/p6/RESULTS.md`) en est la première épreuve.

## Pourquoi le fjord

En eau douce, à l'échelle d'une colonne de quelques centimètres, rien ne montre l'eau qui sculpte la glace :
- l'ombroscopie, parce que l'indice de l'eau ne varie que de 2,6·10⁻⁶ par °C ;
- les bulles, trop petites ou trop rapides ;
- la turbidité, parce que l'eau de fonte n'est qu'une gaine de quelques millimètres.

Le film se réduisait à une forme qui change lentement.

Dans une eau stratifiée en sel, l'eau de fonte, douce, ne peut pas monter jusqu'en haut. Elle quitte la glace et **s'étale en nappes horizontales**, empilées tout le long de la colonne (Huppert et Turner, *JFM* 1980). Ces nappes sont épaisses de quelques millimètres, larges de plusieurs centimètres, et assez différentes en sel pour dévier la lumière deux mille fois plus qu'un écart de température. Pour la première fois, la cause et l'effet sont dans l'image : la glace fond, l'eau de fonte s'empile.

## L'image

Une colonne de glace bulleuse, blanche et translucide, pend de la surface d'un fjord, qu'on voit de dessous comme un plafond d'argent. Autour d'elle, dans l'eau, des **feuillets** d'eau de fonte s'empilent comme les pages d'un livre ouvert ou les étages d'une pagode.

Ces feuillets sont visibles :
- au soleil, par leur ombre ondulée sur le fond clair ;
- à contre-jour, par la déformation de ce qu'on voit à travers eux ;
- dans une eau trouble, comme des bandes plus claires, puisque l'eau de fonte est limpide.

Ce dernier point reste à vérifier (P7).

## La liberté (une seule)

La colonne n'a pas de fin. Elle descend de la surface sans support visible : en hiver, à la vitesse où l'eau la mange, et en été, elle s'arrête.

## Le geste : les nappes suivent les saisons

C'est le résultat de P6.

| u | Saison | T∞ | Ce qu'on voit |
| --- | --- | --- | --- |
| 0 – 0,2 | hiver | 3–4 °C | la colonne descend ; l'eau de fonte reste collée à la glace ; aucune nappe ; lumière basse et bleue |
| 0,2 – 0,4 | printemps | 5–9 °C | les premières nappes quittent la paroi, en bas d'abord, puis tout le long ; elles s'étalent |
| 0,4 – 0,65 | été | 9–10 °C | **le temps fort** : 9 à 10 nappes empilées, espacées de 4 à 16 mm, ouvertes en éventail ; la lumière du soleil les dessine sur le fond |
| 0,65 – 0,85 | automne | 9 → 4 °C | les nappes se referment, se dissipent ; de petites crêtes de glace restent aux hauteurs où elles partaient |
| 0,85 – 1 | hiver | 3 °C | retour (= u 0) |

La boucle se referme par construction : toute la glace visible est neuve à chaque période. P6 mesure une convergence d'environ ×2 par période, il faudra donc 6 à 8 périodes au chargement.

**Le temps fort** est la floraison de l'été. C'est un temps fort lent, une ouverture et non un choc. Pour un geste bref, deux pistes à éprouver :
1. **Le col d'été** (P8). Les fjords ont l'été une couche de surface plus chaude et douce, qui vient des rivières. Elle doit creuser une encoche à la ligne d'eau, comme celles des icebergs. La colonne s'y détache, le fuseau libéré bascule (P2) et se couche à la surface, puis la colonne neuve redescend à l'automne.
2. Sinon, le film reste sans rupture, et son rythme vient de la respiration des nappes. Ce serait une exception dans le dépôt, à assumer.

## Les familles

Toutes viennent du même solveur (P4 et P6). Elles se distinguent par la forme de la stratification, et chacune a son propre mouvement.

| Famille | Eau | Mouvement propre | État |
| --- | --- | --- | --- |
| **La pagode** | gradient de sel régulier | une dizaine de nappes fines, tout le long de la colonne, qui fleurissent et se referment | P6 : oui |
| **Le seuil** | deux couches : douce au-dessus, salée au-dessous, séparées par une halocline nette | une seule nappe, épaisse, qui s'étale à l'halocline ; la glace se creuse en taille à cette hauteur | à tester |
| **Le col d'été** | gradient, plus une couche de surface chaude l'été | les nappes, puis l'encoche à la ligne d'eau, le détachement, la bascule | à tester (P8) |
| **Le lac** | eau douce, sans sel (la famille témoin) | pas de nappes ; seule la forme change (cône, bout arrondi) | P1 : oui, mais faible |

## Les humeurs : comment on voit les nappes

| Humeur | Ce qui montre les nappes | Lumière | Valeur |
| --- | --- | --- | --- |
| **Plein soleil** | leur ombre ondulée sur un fond de sable pâle (le soleil, dans l'eau, est à plus de 41° sous l'horizontale) | soleil haut, eau claire | claire |
| **Contre-jour** | la déformation d'un fond structuré (galets, algues, lumière filtrée) vu à travers elles | ciel derrière, fenêtre de Snell | moyenne |
| **Farine de roche** | des bandes plus claires dans une eau trouble (l'eau de fonte est limpide) | jour diffus | moyenne, turquoise |
| **Nuit** (Sugimoto) | le liseré qu'elles dessinent en déviant une boîte à lumière | une boîte douce de côté | très sombre |
| **Tourbe** | comme le contre-jour, dans une eau ambrée | soleil bas | sombre et chaude |
| **Fenêtre de Snell** | les reflets du plafond d'argent ondulés par les nappes juste sous la surface | plein jour, vu d'en dessous | claire en haut |

Ce que P7 doit vérifier : pour chaque humeur, l'écart à l'image entre les nappes simulées et une eau sans nappes. Le seuil d'acceptation : plus de 15 niveaux sur 255 sur une surface lisible.

## Ce qui reste des versions précédentes

- La glace bulleuse (P3) : la glace claire est invisible dans l'eau.
- La colonne qui avance, et la boucle qui se referme par construction (P1).
- Le solveur axisymétrique, à 2 ms par pas, en Node, et à porter en WebGPU.
- La bascule en corps rigide (P2), si le col d'été tient.
- Le lancer de rayons de P3 et P5, avec la glace d'après le profil simulé et un champ volumique dans l'eau.

## Les risques

- **Des nappes invisibles** (le risque principal, le même que pour les bulles). On le tranche par la mesure, en P7, avant tout le reste.
- **Une forme de glace pauvre** : un long cône. Les petites crêtes d'hiver sont à peine marquées. Le seuil et le col d'été doivent apporter la forme.
- **Un temps fort trop lent**, si le col d'été échoue.
- **La boîte fermée** : l'eau de fonte s'accumule au fond et en surface (P6). Il faut une éponge plus forte ou un domaine plus grand.
- **Le = 10 au lieu de 100**, une équation d'état linéaire, pas d'abaissement du point de fusion : à documenter comme approximations.

## Plan

- **P7** : les nappes à l'image, dans quatre humeurs (plein soleil, contre-jour, farine de roche, nuit), à partir des champs de P6.
- **P8** : le col d'été (couche de surface chaude) et la famille du seuil (halocline).
- Ensuite : la scène.
