# Direction artistique

Ces règles viennent de retours précis de l'utilisateur sur Orrery et Tesseract. Elles se vérifient sur des **rendus**, jamais sur la liste des matières. Elles **bornent**, elles ne dictent pas une palette ni des décors : chaque projet compose ses propres accords et invente ses propres humeurs (ne reprends pas telles quelles Atelier, Studio, Clinique, Nuit, Serre, Velours…), propres à son thème.

## Ce que l'utilisateur a refusé

- **Le tout-or** : « presque entièrement couvert d'or », jugé surchargé et peu élégant (Orrery, graine 17 dorée du plateau aux goupilles). Cause : matières tirées rôle par rôle + lampes orangées qui font lire l'acier, l'argent et la fonte comme du laiton.
- **Le trop chargé** : plusieurs motifs qui se mélangent, « trop chargé, pas très élégant » (Tesseract : ~3 motifs par scène, deux panneaux ornés dos à dos sur chaque paroi → moiré illisible).
- **Le trop vide** : des pièces aux murs tous unis.
- **Le flou** : verre dépoli qui noie tout ce qui est derrière.
- **La caméra nerveuse** : coupes franches, inserts, recadrages ; voir loop.md.

## Les règles

1. **Accords composés à la main**, 4 à 6 par humeur, comme une palette : `[structure, motif, contrepoint, [matières riches], [objets]]` (Tesseract) ou `plateau, bâti, bras, roues, goupilles, montures` (Orrery). Le tirage choisit un accord, pas des matières.
2. **Un fond, une structure, un accent** : les grandes surfaces sombres, pâles ou colorées ; un métal de structure ; l'or, le bronze ou le cuivre en **accent**, sur moins de la moitié de la scène (Orrery : 18 % en moyenne, 37 % au plus), jamais à la fois sur deux rôles majeurs.
3. **Au moins trois familles de matières** par scène (métal froid, métal chaud, céramique, pierre, laque, verre, textile…).
4. **Une seule couleur d'accent** par scène (anodisation, laque, émail) et une seule teinte de verre.
5. **Une image, une idée** : un motif signature par scène, parfois un contrepoint de nature opposée (un écran qui laisse voir contre un relief plein), et pas d'autre ; tous les éléments d'un motif ont le même dessin. Une pièce porte soit un motif sur un jeu uni, soit une matière riche (marbre, émail guilloché, laque, damas, vert-de-gris), jamais les deux, jamais ni l'un ni l'autre. Un seul élément orné par paroi partagée.
6. **L'objet tranche sur son fond** : pas de nacre dans la nacre, d'or devant le laiton, de noir dans le noir ; contraste de valeur d'abord, puis de famille.
7. **Verre clair** (teinté, jamais dépoli) ; cristaux massifs rares (une graine sur trois) mais à vraie épaisseur optique.
8. **Lampes presque blanches** (≥ 4700 K, `kelvinToHex`) : la chaleur d'une humeur vient de son fond, de sa brume, de ses contre-jours, de ses accents et de son étalonnage. C'est un garde-fou contre le tout-or, pas une interdiction : une lumière colorée que le thème justifie (vitrail, four, néon, lumière noire) est permise si l'objet garde ses matières lisibles.
9. **Étalonnage par humeur** (`grade`) : contraste, saturation, teinte des ombres et des hautes lumières (ombres froides et lumières chaudes à l'Atelier, ombres bleues la Nuit, aubergine dans l'Écrin), par-dessus les réglages du panneau.
10. **Humeurs successives différentes** quand une scène en enchaîne plusieurs (Orrery : trois mondes, trois humeurs, au moins une froide ou claire).
11. **Variété d'une graine à l'autre**, pas dans l'image : une scène évite de montrer deux fois le même objet ; aucune matière sur plus de la moitié des pièces.
12. **Patine, pas propreté** : variation lente de rugosité et de teinte de quelques pour cent, encrassement aux jonctions et dans les coins, traces de doigts sur les surfaces polies, usure des arêtes qui révèle la tranche ; jamais de dessin qui se répète à l'œil.
13. **Le fond sert le sujet, il n'est pas un paysage** : un arrière-plan d'accessoires (troncs, herbes, objets lointains) qui n'est pas travaillé au niveau du sujet fait décor de carton et distrait — préfère un fond neutre (dégradé, cyclorama, brume) dont la valeur et la teinte changent d'une humeur à l'autre ; une lueur ou des trouées colorées dans le fond se remarquent comme des défauts dès qu'elles bougent. **Le fond n'est pas un vide** non plus : cyclorama ou coque dont le sol se fond (pas d'horizon net), brume au ras du sol, fond qui prend une version très sombre de la teinte de la scène ; une humeur claire (Clinique) baisse ses lampes et son studio (`keyScale` 0,6, studio 0,32–0,45) au lieu d'être brûlée.

14. **Des décors, pas des teintes.** Une humeur se définit d'abord par son décor (fond clair ou noir, sol, accessoires, atmosphère), sa lumière (soleil dur, boîte à lumière, stroboscope de côté, lueur de four, rayons colorés, lumière noire) et sa valeur, avant sa couleur. Calcin, premier essai : six humeurs, un seul décor (fond sombre et lueur colorée) : « les scènes se ressemblent beaucoup ». Chaque humeur a aussi son cadrage (gros plan bas, plongée, plan large).
16. **La couleur d'une lumière reste celle d'une lumière** : fond sombre et lumière chaude ou claire, ou dégradé doux ; jamais deux couleurs saturées complémentaires en aplats (Melt, Rheinberg vert et rose : « fausse couleur »). **Un objet transparent sur un fond clair est invisible** : fond sombre ou moyen (Melt, « Verre » : table lumineuse blanche abandonnée pour une vitre devant le ciel de l'heure bleue). Une humeur peut avoir une exposition fixe propre (`grade.exposure`, appliquée par la chaîne d'image) : réglée au posemètre, elle ne casse pas la boucle.
15. **Crédible avant d'être beau**, sauf la liberté poétique de la scène (SKILL.md, règle 21), qui est déclarée, unique et traitée avec la même rigueur : le support de chaque objet est visible (sol, socle, plateau, fil, pince), chaque événement a sa cause à l'écran, la gravité s'applique à tout ce qui n'est pas tenu. Une image belle mais impossible (un objet qui flotte, une poussière qui monte seule) est refusée.

## Les tests

Écris-les dans `test/accords.test.mjs` (modèle : `tesseract/test/accords.test.mjs`, `planetaire_v2/tools/accords.mjs`) :
- sur **tous les accords** : jeux existants et tirables, familles ≥ 3, l'or pas sur deux rôles majeurs, motif et contrepoint de familles différentes ;
- sur **400 graines** : part de métal chaud ≤ 50 %, un motif signature au plus (+ contrepoint), aucune matière sur plus de N pièces, l'objet tranche sur son fond (familles ou valeurs différentes), chaque humeur tirée.

## Les références

Mets les premiers rendus à côté des photographies de référence du sujet (SKILL.md, règle 15) : échelle, densité, forme d'ensemble, couleur dominante, lumière. Les écarts d'échelle et de densité se corrigent avant tout le reste ; aucun réglage de matière ne rattrape une forme d'ensemble fausse.

## Le jugement sur image

Les tests empêchent les dérives ; ils ne disent pas si c'est beau. Fais une planche (8 graines × 5 phases, `sheet()`), regarde chaque image et note ce qui est : vide, chargé, plat (pas de modelé), brûlé, bouché, illisible (forme qu'on ne comprend pas), répétitif d'une graine à l'autre. Corrige la règle ou le catalogue, pas l'image d'une graine. Mesure au posemètre avant de juger une exposition (voir rendering.md).

## La collection

Une scène se juge aussi à côté des autres (SKILL.md, règles 21 à 25) : `scripts/planche.py` mesure chaque capture (médiane, amplitude, part d'ambre, teinte, saturation) et signale les images « sépia », « plates » et « bouchées ». Le 13 novembre, onze captures sur vingt et un étaient sépia : les humeurs d'ouverture des projets suivants vont chercher ailleurs (jour blanc, bleu de l'heure bleue, vert d'eau, noir et blanc, couleur franche d'un émail).
