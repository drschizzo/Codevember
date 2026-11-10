# Vérifier : voir ce qu'on fait

On ne livre rien jugé sur la liste des matières ou sur le code : on regarde des images, on mesure, on teste.

## Le panneau de navigateur masqué

Quand `tabs_context` dit que le panneau est masqué : `requestAnimationFrame` est suspendu ou réduit à 1–4 i/s, les captures d'écran du canevas WebGPU (et même du DOM) sont périmées, et le JS tourne ~10 × plus lentement. Donc :

- fais tourner la boucle à la main : `await <nom>.run()` (jusqu'à la fin du chargement), `<nom>.shot(ph)` (image fixe, 12 rendus) ;
- récupère les images par le **collecteur** : `python3 <projet>/tools/sink.py <dossier du scratchpad> <port>` en arrière-plan (8099 par défaut ; si le port est pris par une autre session, prends-en un autre et passe l'URL à `send(nom, 0.5, 'http://127.0.0.1:<port>/')`), puis `Read` les JPEG ; assemble des planches avec PIL ;
- les appels `javascript_tool` expirent à 45 s alors que le script continue : lance les longs travaux en IIFE détachée qui écrit dans `window.__job`, rends la main, puis interroge par de courts appels ;
- tu ne peux pas juger la **fluidité** en direct dans ces conditions : dis-le à l'utilisateur au lieu de conclure sur des images fixes, ou demande-lui d'afficher le panneau.

## La séquence de vérification

1. **Console** : `errors` vide après chargement, en qualité Haute et en `?mobile=1` (les erreurs de pipeline apparaissent au premier dessin).
2. **Chargement** : `pipes.made` (shaders compilés sous l'écran), aucune compilation après (relancer `pipes.made` après une boucle complète : inchangé).
3. **Raccord** : `seam(u)` < 1e-6 à plusieurs u ; test Node du raccord de la cinématique.
4. **Planche** : `sheet(['a1', …8 graines], [0, 0.2, 0.4, 0.6, 0.8])`, assemblée et regardée image par image (voir art-direction.md, « Le jugement sur image »). Au moins une graine par humeur.
5. **Posemètre** : `meter()` sur chaque humeur — brûlé < 2–3 %, médiane du centre cohérente avec l'humeur, pas de sujet perdu dans le noir.
6. **Temps d'image** : `bench(ph)` aux phases les plus chargées ; noter les chiffres dans le README.
7. **Tests** : `node --test '<projet>/test/*.test.mjs'` (invariants du cœur, recette, direction artistique sur 400 graines).
8. **Export** : un MP4 court (petite résolution) et un PNG, au moins une fois.

## Filmer une graine

Le plus utile est de voir le film d'une graine étape par étape, et plusieurs humeurs côte à côte. En `?debug`, définis une fois un petit outil qui parcourt une liste `[graine, étape, part, nom]`, régénère si besoin, rend (`run`, `shot`) et envoie (`send`), puis assemble les images en planches (PIL, nom en surimpression) et regarde-les. Une planche « 4 graines × 4 temps » après chaque correction visuelle ; une planche « 10 temps » d'une graine pour juger la chorégraphie. Ce sont ces planches qui ont montré, sur Calcin, le verre invisible sur fond noir, les reflets du studio dans le sol et la fluorescence plate — aucun test ne les aurait vus.

## Les courbes avant les images

Un modèle animé (simulation, champ, plan de mouvements) s'inspecte d'abord en **courbes** dans Node : une ligne par grandeur (couverture, ouverture moyenne, eau, intensité du soleil, distance de la caméra) échantillonnée sur toute la boucle. Un aller-retour non voulu, un temps trop bref suivi d'un long vide, un état qui ne revient pas à son départ s'y voient en une seconde, alors qu'il faut un film entier pour les voir à l'image (et l'utilisateur les prend pour des bugs). Écris ensuite la forme attendue en test : intervalles où la grandeur croît, décroît, reste basse.

## Planches ciblées

Garde dans l'outil de planche la possibilité d'**imposer** l'humeur ou la famille d'une graine (par exemple `graine:humeur:famille`), pour comparer toutes les humeurs ou toutes les familles d'un coup après une correction. Quand le panneau est masqué et qu'une planche prend plusieurs minutes, lance-la en tâche détachée et avance sur autre chose (README, tests) pendant qu'elle tourne.

## Ce que les planches ne montrent pas d'elles-mêmes

- **Les événements** : filme une fenêtre de ± 0,5 s autour de chaque cause, à quelques images d'écart. Un décalage de quelques dixièmes entre la cause et l'effet casse tout, et ne se voit qu'ainsi (ou en direct).
- **L'ancrage** : une vue rasante (caméra libre, au ras du sol) après chaque chute ou chaque pose montre les pénétrations et les objets qui flottent faute d'ombre.
- **La lisibilité** : montre une planche à quelqu'un, ou relis-la comme quelqu'un qui ne connaît pas le projet. Peut-il dire ce qui provoque l'événement ?

## Itérer vite

- Les algorithmes lourds (simulation, recherche, maillage) s'itèrent dans Node : les modules ES s'importent tels quels ; un script dans `tools/` imprime des métriques (temps, résidus, collisions, qualité du maillage) sur des dizaines de graines.
- Pour comparer avant / après sur une même image : même graine, même phase, `shot` + `send` avec des noms suffixés, et une planche côte à côte.
- Pour un réglage de caméra ou d'animation validé par l'utilisateur, garde une signature (somme des matrices de caméra et des pièces sur 50 phases) et vérifie qu'elle ne change pas quand tu travailles sur autre chose.

## Avant de dire « fini »

Dis ce qui a été vérifié et comment (images, mesures, tests), et ce qui ne l'a pas été (lecture en direct, appareil mobile réel, export long). Pas de capture de l'écran de chargement présentée comme une capture de la scène.
