# Tesseract

Le cabinet replié. Un écrin de huit cubes, couché à plat en patron (la croix du *Corpus Hypercubus* de Dalí, ou une autre forme), se replie dans une direction qui n'existe pas. L'hypercube tourne d'un quart de tour en 4D : le cube intérieur passe à l'extérieur. Puis il se déplie à nouveau. Le patron est le même, mais les cellules ont changé de place. Après quelques étapes, chacune a retrouvé la sienne : la boucle est parfaite par construction.

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène, et l'on peut en générer autant que l'on veut.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Paramètres d'URL :
- `?seed=…` : une scène ;
- `#r=…` : une scène retouchée, produite par « Copier le lien » ;
- `?ui=0` : sans panneau ;
- `?debug` : outils dans `window.tess`, dont `shot(phase)`, une image fixe à une phase donnée.

Le panneau règle tout :
- **Scène** : humeur, durée, patron, séquence de rotations 4D.
- **Chorégraphie** : durée de chaque temps, décalage entre cellules, anticipation et rebond.
- **Projection 4D** : distance de l'œil 4D, gonflement stéréographique, écart entre cellules, ajourage, cadrage, inclinaison.
- **Caméra**.
- **Ossature** : profil, épaisseur, chanfrein, nœuds, matériaux.
- **Chaque cellule** : archétype, nature de chaque face, perforations, persiennes, grille, matériaux des trois faces, verre, objet exposé.
- **Lumière et plateau**.
- **Rendu**.

L'export produit une boucle MP4 (H.264) rendue image par image, et une image PNG.

## Principe

**Les cellules.** Le tesseract est [-1, 1]⁴. Ses huit cellules sont des cubes, repérés par leur normale ±eₖ. Chaque pièce (ossature, panneaux, verre, objet) est construite une fois, en coordonnées locales de sa cellule. Une matrice 4D propre au maillage, recalculée à chaque image, l'emmène dans l'espace à quatre dimensions. Cette matrice compose le plongement de la cellule dans son hyperplan, le dépliage, la rotation 4D et la rotation de l'objet exposé.

**La projection** (`src/scene/project.js`, dans le vertex shader) :
1. un gonflement facultatif vers la 3-sphère, qui courbe les arêtes en arcs ;
2. une perspective depuis l'œil 4D (0, 0, 0, d).

La normale est transportée par la jacobienne de la projection (n' = cof(J)·n). Une cellule vue « de l'autre côté » en 4D se projette en miroir. Ses triangles changent alors de sens, et le sens de la face (matériaux double face) retourne la normale une seconde fois : elle sort toujours de la matière. Le même calcul, avec les paramètres de l'image précédente, donne les vecteurs vitesse (flou de mouvement, anticrénelage temporel). La carte d'ombre reçoit la même déformation.

**Le patron** (`src/math4.js`). Un patron est un arbre couvrant des cellules, de racine −W. Chaque cellule pivote autour du carré qu'elle partage avec son parent, dans le plan de leurs deux normales. À π/2, toutes sont couchées dans l'hyperplan w = −1. Un patron tiré au hasard est vérifié : deux cellules n'y tombent jamais au même endroit. Il existe 261 patrons du tesseract à symétrie près.

**La boucle.** Chaque étape fait un quart de tour dans un plan contenant w, éventuellement doublé d'un quart de tour dans le plan orthogonal (rotation isocline). C'est une symétrie de l'hypercube. La séquence est tirée de façon que le produit des mouvements soit l'identité, sans aller-retour ni retour à un état déjà vu. Chaque étape suit le même déroulé :
1. pause dépliée ;
2. pliage échelonné, les feuilles de l'arbre d'abord ;
3. pause ;
4. rotation ;
5. pause ;
6. dépliage.

Les courbes ont de l'anticipation et du rebond (le mouvement recule un peu avant de partir, et dépasse un peu avant de se poser).

**L'ajourage.** Plié, le tesseract est enveloppé par sa cellule extérieure et par les faces des cellules latérales qui la touchent : elles cacheraient tout. Les panneaux se percent de trous ronds, sur une trame à 45°, qui grandissent avec la coordonnée w du centre de leur face. La coque tournée vers l'œil 4D s'efface, les faces latérales s'ajourent à moitié et le cube intérieur reste plein. Tout se referme quand les cellules reviennent se coucher dans le patron. L'objet exposé de la cellule extérieure se rétracte : projeté, il se superposerait à celui de la cellule intérieure.

**Le cadrage.** L'objet reste centré, à une taille qui ne suit qu'en partie l'étendue du patron (déplié, il est bien plus grand que plié). Il est soulevé au besoin pour ne jamais traverser le sol.

## Géométrie (`src/gen/`, dans des Web Workers)

- **Ossature** : barres profilées balayées le long des arêtes, subdivisées pour que la projection gonflée puisse les courber. Cinq profils :
  - carré chanfreiné ou à congés polis ;
  - rond ;
  - tube à bagues ;
  - cornière, dont les ailes portent les panneaux ;
  - profilé d'aluminium rainuré.

  Nœuds d'angle en boîte arrondie, sphère ou pommeau. Les chanfreins et congés reçoivent la finition polie, les plats la finition brossée (brossage le long de la barre).
- **Panneaux** : plaques (faces externe et interne, chant), verre teinté, persiennes inclinées, grille de joncs tissés dessus-dessous, et tôle perforée. Cette dernière a des trous en superellipse (rond, carré, losange, étoile), à chanfrein poli et paroi usinée. Leur taille suit un motif : centre, bord, diagonale, vague ou hasard. Les carreaux voisins partagent exactement leurs points de bord.
- **Objets exposés** : perle, pierre taille brillant, gyroscope à trois anneaux, cube, Saturne, et un petit cube d'ossature en mise en abyme. Chacun tourne d'un nombre entier de tours par boucle.

## Matériaux (`src/scene/materials.js`)

Ce sont ceux de Hollow : une quarantaine de finitions et vingt-six jeux. On y trouve des métaux au F0 mesuré, de l'émail grand feu guilloché, de l'acier damassé, des marbres, de la laque urushi saupoudrée d'or, de la nacre, du titane bleui au feu, du film de savon, du velours et du carbone sergé.

Chaque pièce porte trois finitions (externe, interne, tranche). Les motifs sont calculés dans le repère de la pièce et restent attachés à la matière pendant le pliage 4D : chaque face a son propre veinage, et chaque barre ou latte sa nuance. Le modèle physique est exploité en entier : vernis, lustre, irisation, anisotropie, transmission avec dispersion et absorption, usure. Le verre et les pierres projettent des ombres colorées.

Le sol est procédural : laque noire, béton ciré, damier de marbre, parquet de chêne verni, velours ou cyclorama.

## Scène

- **Humeurs** : chacune favorise ses jeux de matériaux, ses archétypes de cellules, son sol et sa lumière.
  - Atelier ;
  - Studio ;
  - Écrin (or, guilloché, pierres) ;
  - Clinique (céramique blanche sur cyclorama) ;
  - Nuit ;
  - Surréaliste (damier de marbre, patron de Dalí) ;
  - Irisé.
- **Archétypes de cellule** : vitrine, écrin, moucharabieh, persiennes, grille tissée, squelette.
- **Lumière** : un projecteur avec ombres douces et deux contre-jours, fixes dans le monde (la caméra tourne, les ombres restent), et un studio HDR pour les reflets.
- **Post-traitement** (repris de Hollow) :
  - occlusion ambiante ;
  - anticrénelage temporel ;
  - flou de mouvement ;
  - profondeur de champ ;
  - bloom, halation, traînées anamorphiques ;
  - poussière sur la lentille ;
  - aberration chromatique, grain.

## Performances

Environ 16 ms par image à 2,6 Mpx (≈ 760 000 triangles, ombres, anticrénelage temporel). La tôle perforée est plafonnée à dix-huit faces par scène.
