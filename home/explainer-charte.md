# Pages d'explication : la charte

Ces pages expliquent le fonctionnement de chaque projet. Le modèle est
*The Nature of Code* de Daniel Shiffman : on part d'un phénomène qu'on peut
observer, on écrit la règle la plus simple qui le reproduit, on regarde où
elle échoue, puis on la corrige. Le pilote est `erosion/explainer.html`.

## Le lecteur

Quelqu'un qui sait programmer un peu (une boucle, un tableau, une fonction)
mais qui n'a pas de bagage en physique numérique ni en rendu. L'expert doit
aussi y trouver son compte : les détails de production (budgets, pièges du
GPU, filtrages, tests) restent, mais dans des encadrés repliés « Pour aller
plus loin ».

## Le déroulé d'une section

Une section explique une seule idée, dans cet ordre :

1. **Ce qu'on observe**, sur la table, dans la scène ou dans le monde réel,
   en une ou deux phrases.
2. **La règle la plus simple** qui pourrait le produire, dite en français.
3. **Une démo** qui applique cette règle, avec un réglage qui permet de la
   mettre en défaut.
4. **Ce qui ne va pas**, constaté dans la démo, puis **la correction**.
   Les échecs réels du projet (les encadrés « Le piège ») ont leur place ici.
5. **La formule**, en résumé de ce qui vient d'être compris, jamais avant.
   Chaque symbole est défini juste après, avec son unité et la valeur du
   projet.
6. **Un extrait de code** court (moins de quinze lignes), simplifié à partir
   du vrai module, avec les mêmes noms de variables. Le fichier est cité.
7. **« À essayer »** : deux ou trois manipulations précises sur la démo, avec
   ce qu'on doit observer ou une question à laquelle elle répond.

Les sections s'enchaînent du plus simple au plus compliqué. Une notion
n'est utilisée qu'après avoir été introduite.

## Les démos

- Une démo par idée. Elle isole le mécanisme au lieu de montrer le résultat
  final (on peut garder une démo du résultat en tête de page).
- Elle importe les constantes et, si possible, le code du projet.
- Ses réglages permettent de casser le phénomène : couper un terme, agrandir
  le pas de temps, changer de méthode. Le bandeau affiche la grandeur qui
  permet de juger (volume, minimum, angle, écart).
- Elle reste lisible sur mobile.

### Une démo doit montrer la différence

Quand une démo compare deux méthodes ou deux réglages, l'écart doit sauter
aux yeux sans lire le bandeau. Le pilote Erosion avait une démo où les deux
options donnaient la même image : elle n'expliquait rien.

- Avant d'écrire le dessin, on se demande : *qu'est-ce qui, à l'écran, sera
  différent entre les deux options ?* Si la réponse tient seulement dans un
  chiffre, on ajoute une représentation qui le montre : une courbe qui
  devrait rester plate et qui chute, des points qui se raréfient, une barre
  « perdu » qui monte, une trace rouge là où le calcul devient faux.
- On dessine la grandeur qui révèle le mécanisme, pas seulement l'état
  (le débit le long du canal plutôt que la seule teinte de l'eau).
- Chaque option visible a une étiquette, et le bouton actif est marqué.
- La démo atteint son régime en quelques secondes ; sinon elle accélère le
  temps, et le bandeau donne le temps simulé.

### Une démo doit marcher

- L'état qui doit survivre à `d.reset()` (méthode, famille, mode) vit hors
  de `d.state`, que `reset()` vide avant d'appeler `setup()`. Un bouton qui
  écrit dans `d.state` puis appelle `reset()` ne fait rien : c'était le bug
  des boutons d'Erosion.
- Le modèle de la démo est d'abord écrit et mesuré dans Node (scratchpad) :
  chaque option est lancée, et l'on note ce qui doit différer (volume,
  minimum, pertes, divergence, angle). Ces chiffres fixent ce que disent la
  légende et les « À essayer » ; rien n'y est promis qui n'ait été mesuré.
- Ensuite, dans le navigateur, **chaque bouton et chaque curseur** est
  actionné, la démo est laissée tourner jusqu'à son régime, et l'on fait une
  capture par option. On vérifie sur les captures que l'écart annoncé est
  visible, que rien ne déborde, que les étiquettes ne se chevauchent pas, et
  que la console est vide.
- Le panneau du navigateur masqué gèle les animations et rend des captures
  périmées : on le fait afficher, ou l'on capture avec Chrome sans interface
  à travers une page qui fait défiler jusqu'à la figure et clique le bouton.
  Une capture où le temps n'a pas avancé ne prouve rien.

## La rédaction

On écrit pour être compris, sans chercher l'effet.

- Une idée par phrase, des phrases complètes. Le deux-points sert à annoncer
  une liste ou une explication, pas à créer un suspense.
- Chaque terme technique est défini à sa première apparition. Le mot courant
  vient d'abord, le terme savant entre parenthèses ensuite. Un concept garde
  le même nom dans toute la page.
- « On » pour le récit de la construction, « vous » dans les « À essayer ».
- Les chiffres sont ceux du code, avec leur unité.
- Une analogie seulement si elle est exacte et qu'elle sert plus loin dans le
  raisonnement (la différence de niveau joue le rôle d'une force, comme chez
  Newton). Pas d'image décorative.

À éviter, parce que cela sonne comme un texte généré ou publicitaire :

- les phrases-choc et les chutes de paragraphe (« Et tout change. »,
  « Le résultat est saisissant. ») ;
- les annonces dramatiques avec deux-points (« Le secret : … »,
  « Le problème ? … ») et les questions rhétoriques en série ;
- les tournures « Ce n'est pas X, c'est Y », « et c'est là que »,
  « tout simplement », « littéralement », « véritable », « la magie » ;
- les adjectifs de réclame (bluffant, élégant, saisissant, puissant) ;
- les énumérations rythmées par trois quand il n'y a pas trois choses ;
- les tirets cadratins en cascade ; une incise se met entre virgules ou
  entre parenthèses ;
- les métaphores filées et les conclusions morales.

## La justesse

Simplifier ne doit pas rendre faux. Chaque affirmation, chaque formule et
chaque chiffre est relu contre le code du projet. Si l'explication simplifiée
diffère du code (une démo à une dimension, un modèle sans un terme), la page
le dit.
