# Melt

*le dégel d'une étoile.* En macro, un cristal de neige de trois millimètres pousse d'une gouttelette gelée, puis fond au soleil. Ses branches se rétractent en perles d'eau qui remontent vers le centre et s'y rassemblent en une goutte, qui regèle en pointe.

Au début, une perle de glace laiteuse, dressée en pointe, est posée sur un gant de laine (ou un velours, une vitre, une feuille de houx, une ardoise, une lame de microscope). L'air est glacé : le givre hérisse les fibres, de la poussière de diamant tombe en scintillant. Un petit hexagone transparent sort de la perle et s'élargit, puis six bras partent de ses coins et se ramifient, en accéléré. La caméra recule pour garder l'étoile dans le cadre. Le soleil sort ensuite de côté. Le givre des fibres s'éteint, le cristal se mouille et brille comme verni. Des perles naissent au bout des branches et remontent les bras en les avalant, les branches latérales d'abord, jusqu'à ce que toute l'étoile se rassemble en une goutte au centre. Cette fonte se déroule en temps réel, avec un ralenti au rassemblement. La goutte s'évapore, le soleil passe, et elle gèle de bas en haut, devient laiteuse et se dresse en pointe : c'est la perle du début.

![La fougère sur la laine, au moment où le soleil entre (graine k2)](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md) : le thème exploré sous six angles, les clichés écartés (le glaçon, la bougie, les montres molles), dix pistes notées, les épreuves de crédibilité, de variété et d'ambition, les photographies de référence.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?mood=…` (laine, verre, velours, houx, rheinberg, ardoise), `?family=…` (star, plate, column), `?ui=0`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.melt` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)` (une graine peut s'écrire `graine:humeur:famille`), `meter()`, `meters(graines)`, `bench()`, `seam()`, `run()`).

Le panneau règle :
- l'humeur, la famille et la forme (nouvelle scène de la même graine), la durée ;
- le cristal : diamètre, graine de la forme, asymétrie des bras, orientation ;
- l'eau : angles de contact sur le support et sur la glace, rayon de la perle gelée ;
- la caméra ;
- le soleil, le ciel froid, le contre-jour, la boîte à lumière qui se reflète dans le cristal, les couleurs du support, la brume ;
- le rendu.

Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : un cycle de transformations

La boucle passe par trois états (la perle gelée, l'étoile, la goutte) et prend pour chacun un chemin différent : une croissance qui se ramifie, une fonte qui rassemble, un gel qui dresse une pointe. Une seule horloge (`src/timeline.js`) règle ces trois passages, ainsi que la lumière et le givre. Dans le tableau, u est la position dans la boucle, de 0 à 1 :

| u | Ce qu'on voit | Cause visible | Loi | Temps |
| --- | --- | --- | --- | --- |
| 0 – 0,03 | la perle gelée | l'air glacé : givre sur les fibres, poussière de diamant | — | accéléré |
| 0,03 – 0,44 | l'étoile pousse | la vapeur de l'air sursaturé (plus chargé en vapeur que ce que l'air peut tenir) | diffusion et attachement (Gravner-Griffeath) | accéléré, rayon à vitesse constante |
| 0,45 – 0,52 | le soleil entre, le givre s'éteint | le soleil | le givre, plus fin, fond le premier | accéléré |
| 0,52 – 0,78 | la fonte, le rassemblement | le soleil | chaleur latente ; tension superficielle | temps réel, ralenti au rassemblement |
| 0,79 – 0,88 | la goutte s'évapore | le soleil | évaporation | accéléré |
| 0,88 – 0,97 | la goutte gèle en pointe | le froid revient | front de gel de bas en haut, dilatation de 9 % : pointe d'angle ≈ 139° (Marín et al. 2014) | accéléré |

La boucle est parfaite par construction : à u = 0 comme à u = 1, il n'y a pas de cristal (avant sa croissance d'un côté, après sa fonte de l'autre). La goutte a le volume de la perle et elle est gelée, le soleil est couché, le givre a la même hauteur. La caméra suit une fonction périodique lissée.

## Le cœur : pousser, puis fondre

**La croissance** (`src/gen/growth.js`) suit le modèle mésoscopique de Gravner et Griffeath (*Physica D* 237, 2008) sur un réseau hexagonal. La vapeur diffuse et se dépose sur les cellules du bord, en partie en glace, en partie en couche quasi liquide. Une cellule s'attache selon le nombre de ses voisines attachées (seuils β, α, θ), et une part fond. Les pointes, qui voient plus de vapeur, avancent plus vite et se ramifient, tandis que les faces planes avancent ensemble. Selon les paramètres, on obtient des dendrites stellaires, des fougères, des peignes, des échelles, de larges branches. Un second jeu de paramètres pris en cours de croissance donne les étoiles à centre en plaque, les plaques à secteurs prolongés de dendrites et les étoiles prises dans une plaque, comme les cristaux dont l'air change pendant la chute. Aucune plaque n'est un simple hexagone qui grandit. La masse de glace de chaque cellule fait le relief : nervures, arêtes des secteurs, marques des étapes de croissance.

**Le maillage animé** (`src/gen/crystal.js`, `src/scene/ice.js`). Chaque cellule est un sommet. Le vertex shader calcule son épaisseur à l'instant t d'une valeur signée v = (h + ½h₀)·g(t − T)·(1 − m(s − M)) − ½h₀, où T est l'instant d'attachement de la cellule et M son instant de fonte. Le bord du cristal est la ligne v = 0, interpolée dans les triangles : il avance et recule entre les cellules, sans marches. La normale est recomposée à partir des gradients de h, T et M rangés dans les attributs. Le film fait avancer le rayon à vitesse constante, alors que la simulation accélère à mesure que les pointes s'allongent. On garde donc la réciproque exacte, cellule par cellule, du rayon atteint en fonction de T.

**La fonte.** L'ordre de fonte dépend de la distance au centre le long du cristal, de la finesse et du côté du soleil. Il croît toujours vers le centre le long de l'arbre des plus courts chemins.

**L'eau.** Chaque cellule qui fond donne son eau (0,917 × le volume de glace) à la perle qui se tient sur le front de son bras. Une perle avance avec ce front, vers le centre, et deux perles dont les calottes se touchent fusionnent. Le résultat est enregistré (160 images, 96 emplacements stables) et relu par le vertex shader des perles. Ce sont des calottes sphériques à angle de contact mesuré, exactes normales comprises (une goutte sur la laine perle à plus de 90°).

**Trois familles, trois gestes** (`src/families.js`) :
- l'**étoile** pousse par ses pointes qui se ramifient. À la fonte, des perles naissent aux pointes et remontent les bras en les avalant ;
- la **plaque** pousse par ses faces. À la fonte, un bourrelet d'eau en fait le tour et se resserre comme un collier de perles ;
- la **colonne** (colonne creuse, aiguille, gaine : un prisme hexagonal couché, aux bouts creusés) pousse en longueur. À la fonte, elle s'amincit et l'eau qui la gaine se rompt en chapelet de perles espacées de neuf rayons (instabilité de Plateau-Rayleigh), qui restent chacune à sa place et s'évaporent.

## La lumière : ce qui fait voir un cristal

Une plaque de glace de 30 µm ne se voit que par sa surface. Comme les photographes de flocons, on place une grande boîte à lumière dans la direction où la face plane renvoie le regard de la caméra (`src/scene/sky.js`). Les faces planes s'allument, les nervures et les pentes renvoient le ciel plus sombre et se dessinent. La lumière qui ressort après des réflexions totales sur les nervures donne au cristal son éclat argenté (une part diffuse, plus forte sur les pentes).

Sur le verre et sous le microscope, la lumière vient d'en dessous. On calcule la **déviation** du rayon par les deux faces de la plaque (ou de la perle) et on lit la lumière du dessous dans cette direction (`src/scene/backlight.js`). Cela donne des traits sombres sur la table lumineuse, la couleur de l'anneau en **éclairage de Rheinberg** et des perles en lentilles cerclées. Quand la fonte commence, un film d'eau vernit la glace.

## Les décors

Le fond est le support lui-même, flou dans la profondeur de champ d'une macro.

| Humeur | Support | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Laine | jersey de laine au niveau des fibres | boîte douce de face, soleil bas | sombre | plongée oblique |
| Verre | une vitre en hiver, ses poussières ; derrière, le ciel flou de l'heure bleue | de face, diffuseur ovale | moyenne, froide | plongée |
| Velours | velours noir (Bentley) | rasante et dure | très sombre | ras du support |
| Houx | feuille de houx vernissée, nervures | plein jour, d'en haut | moyenne, verte | oblique bas |
| Rheinberg | lame de saphir au microscope, diaphragme de champ à dix lamelles | champ sombre, anneau de lumière chaude | sombre, lumineuse | plongée |
| Ardoise | ardoise feuilletée, paillettes de mica | ciel couvert | gris moyen | oblique |

**La laine** (`src/gen/wool.js`) suit le modèle de fil procédural de Zhao, Luan et Bala (SIGGRAPH 2016) dans la forme qu'en donnent Wu et Yuksel (*Real-time fiber-level cloth rendering*, I3D 2017). Le tricot est un jersey : des rangs de mailles en V, jambes en avant, têtes passées derrière. Chaque fil a deux brins retordus de section elliptique. Les fibres, de 17 µm, s'enroulent en hélice et leur distance à l'axe migre (R(θ) = Rᵢ/2·(R_max + R_min + (R_max − R_min)·cos(θᵢ + sθ)), Rᵢ selon la densité de Zhao et al.). Certaines périodes forment des boucles, d'autres se rompent en poils. Les fibres du centre sont remplacées par une « fibre de cœur » unique striée en hélice. Le rendu ajoute un reflet de tube anisotrope le long de la fibre, une ombre ambiante selon la distance au centre du fil et des ombres portées calculées sur de simples tubes. Le cristal repose sur les fibres les plus hautes de son emprise.

**Les causes du froid.** Un givre pousse au retour du froid et fond au premier soleil, avant le cristal. Sur la laine, ce sont des aiguilles de 20 à 60 µm à la pointe des fibres (`src/scene/frost.js`). Sur les supports plats, c'est un semis clairsemé de petits cristaux dans la matière, jeté au hasard, dont les facettes scintillent (pastilles de bokeh dans le flou). Une poussière de diamant ne se voit que quand une facette renvoie la lumière, en un nombre entier de passages par boucle.

**Le contact** (`src/scene/contact.js`). La glace porte une ombre par un double opaque qui laisse passer une part de la lumière (la transmission physique de three.js n'en porte pas). La matière du support et des fibres calcule une ombre de contact exactement sous la glace à l'instant t, grâce à une carte d'emprise du cristal qui donne, par texel, ses instants d'attachement et de fonte. Elle en calcule une aussi au pied de chaque perle. Derrière le sujet, le support se relève en cyclorama : il n'y a pas d'horizon, seulement un dégradé de la même matière dans le flou de la macro.

**La caméra** (`src/camera.js`) est une macro sur rail qui suit le sujet. Elle recule pendant que l'étoile pousse et avance pendant qu'elle se rassemble en goutte (rapport des distances ≤ 2,5), avec un seul balancement lent en azimut. La trajectoire est lissée par un noyau gaussien périodique, sa vitesse de rotation reste sous 25°/s et son accélération est bornée (test à 120 i/s).

**L'écran de chargement** montre le cristal de la scène pousser en direct : le même modèle, en plus petit, calculé et dessiné dans un worker sur un `OffscreenCanvas` pendant que le fil principal compile les shaders.

## Tests

```bash
node --test melt/test/*.test.mjs
```

Treize tests vérifient :
- la croissance a la symétrie d'ordre 6 sans bruit, et l'attachement est définitif ;
- chaque cellule fond avant son chemin vers le centre, le centre en dernier ;
- l'eau est conservée ; l'étoile et la plaque finissent en une goutte au centre, la colonne en chapelet ;
- calottes (volume ↔ rayon de base) ;
- l'horloge raccorde exactement et chaque temps est monotone ;
- la caméra est périodique, lente, sans à-coups, au-dessus du support ;
- le cristal pose sur les fibres de la laine sans qu'aucune dépasse dans son emprise ;
- la glace n'existe pas au raccord ;
- recette déterministe et JSON ;
- toutes les humeurs, familles et formes sont tirées ;
- un décor par humeur, du très clair au très sombre, du ras du support à la vue de dessus ;
- lampes presque blanches ;
- taille réelle du cristal.

## Performances

Génération d'une scène : 0,5 à 3,5 s pour la croissance, le maillage et la fonte enregistrée, 0,5 s pour la laine (workers).

Temps d'image mesuré dans le panneau de navigateur de l'application (GPU d'un Mac, panneau masqué) :
- qualité Haute, 1,8 Mpx, graine k2 (laine, le décor le plus lourd : ~570 000 sommets de fibres, profondeur de champ et ombre de contact comprises) : 9,2 ms ;
- version mobile (graine k6, velours) : 3,5 ms.

Raccord de boucle : écart des matrices ≤ 2·10⁻⁸. 207 pipelines sont compilées sous l'écran de chargement.

## Version mobile

Imposée par `?mobile=1`, ou choisie d'office sur téléphone. Elle a moitié moins de fibres et une zone de fibres plus petite, un réseau du cristal plus grossier (rayon 76 au lieu de 104), des calottes moins subdivisées, moins de givre et de poussière. La glace et l'eau passent en transparence composée (sans transmission physique), il y a une lumière de moins, la chaîne d'image est allégée et la résolution dynamique. Non vérifiée sur un appareil réel.
