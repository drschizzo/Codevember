# Membrane

L'éclosion sans fin. Un solide géométrique dort dans une membrane translucide : vaisseaux, film humide, lumière qui la traverse. L'armature se déploie (sépales, lames, mâchoires, baleines, épingles ou polyèdre) et tend la membrane, qui s'amincit, blanchit puis se déchire. Les lèvres s'enroulent, des filaments s'étirent et claquent, les lambeaux se retroussent comme des pétales. La caméra plonge par l'ouverture vers l'œuf suivant, enveloppé lui aussi. Après quelques couches, la scène se retrouve identique à elle-même : la boucle est parfaite par construction.

Rendu physique en three.js (WebGPU, TSL). Scène entièrement procédurale : une graine produit une scène, et l'on peut en générer autant que l'on veut. Les déchirures sont simulées sur le GPU (dynamique par positions, shaders de calcul WebGPU), pas animées à la main. WebGPU est requis.

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
- `?debug` : outils dans `window.membrane`, dont `shot(u)` (une image fixe à une phase donnée) et `level(j, x)` (une couche seule, vue de l'extérieur, à la profondeur x) ;
- `?fast` : simulation grossière, pour la mise au point.

Le panneau règle tout :
- **Scène** : humeur, nombre de couches différentes, durée.
- **Plongée et chorégraphie** : rapport entre couches, début et fin de l'éclosion, respiration des œufs clos, ralenti au moment de la déchirure.
- **Caméra**.
- **Chaque couche** :
  - l'armature (nature, nombre de pièces, largeur, pointe, charnière, ouverture, vrille, gonflement, ordre d'ouverture, matériaux) ;
  - l'aspect de la membrane (couleurs diffusée et transmise, densité, netteté et flou au travers, réfraction, translucidité, film humide, lustre, irisation, feuille de métal, vaisseaux et capillaires, fibres, plis, blanchiment sous tension, lèvres) ;
  - son comportement (épaisseur, précontrainte, souplesse, résistance, hétérogénéité, enroulement des lèvres, viscosité, air, frémissement, fuite de la pression, adhérence, filaments, tracé des coupures, embranchements, retroussement, fatigue, dégrafage) ;
  - le mouvement.
- **Simulation** : finesse du maillage, images enregistrées, sous-pas, durée physique.
- **Lumière et fond** : studio HDR, lampe, contre-jour, cœur, brume.
- **Rendu** : qualité, anticrénelage, ombres, vue au travers des membranes, translucidité, tone mapping, bloom, occlusion, reflets en espace écran, flou de mouvement, profondeur de champ, traînées, halation, aberration chromatique, grain.

Une retouche d'aspect est immédiate. Une retouche de comportement ou d'armature relance la simulation de la couche, et l'ancienne version reste affichée jusqu'à l'arrivée de la nouvelle. L'export produit une boucle MP4 (H.264) rendue image par image, et une image PNG.

## Principe

**La plongée.** Une couche à la profondeur relative *x* a pour rayon D·qˣ, avec *x* = *d* − τ (*d* : indice de la couche, τ : l'avancée). La couche *d* utilise le modèle *d* mod N : la scène à τ + N est identique à la scène à τ. Tout ne dépend que de *x* : taille, orientation (les œufs lointains culbutent, puis présentent leur pôle à la caméra), instant de l'éclosion, visibilité.

**L'éclosion.** Elle se joue entre *x* = début et *x* = fin. La simulation, enregistrée image par image dans un tampon du GPU, et l'armature avancent avec *x*. Le ralenti autour de la déchirure est une déformation du temps τ(*t*) dont la vitesse reste positive et continue, et qui retombe sur ses pieds à chaque couche.

**Rien ne flotte.** Chaque œuf repose dans une coupe, au centre de l'armature de la couche précédente. Une tige relie cette coupe au pôle arrière de la membrane, que la coupe de la couche précédente reçoit à son tour. Des rayons relient la coupe à la couronne de charnières (ou aux sommets bas de la cage). Toutes les couches tournent à la même vitesse : leur orientation relative est fixe, rien ne glisse. Un contrôle automatique vérifie, à plusieurs instants de l'ouverture, qu'aucune pièce ne pénètre une autre ni l'œuf suivant. C'est ce qui a conduit à monter les lames de l'iris en persienne, à les ouvrir ensemble et à limiter leur rotation.

**Les instances.** M emplacements, M multiple de N ; l'emplacement *j* montre toujours le modèle *j* mod N. Il ne change de couche qu'en passant de derrière la caméra au cœur lumineux, invisible aux deux bouts : jamais de changement de géométrie, jamais de saut visible.

## Simulation

**La préparation** (`src/gen/`, dans un Web Worker) :
- **le maillage** : une sphère géodésique, désordonnée puis détendue ;
- **le motif de déchirure** (`tear.js`) : chaque triangle reçoit l'étiquette du lambeau auquel il appartiendra (entre deux lames ; en spirale pour l'iris ; une perforation autour de chaque tête d'épingle et une cellule de Voronoï au-delà ; du centre de chaque face de la cage vers ses sommets). Les étiquettes sont calculées sur une direction déformée par un bruit fractal, et un réseau secondaire greffe des embranchements ;
- **le lissage des coupures** : chaque sommet d'un tracé glisse vers le milieu de ses voisins sur le tracé, puis les autres sommets se détendent autour. Le zigzag à l'échelle du maillage disparaît : la fissure est une courbe, l'irrégularité voulue demeure ;
- **les coutures** : sommets dédoublés le long des tracés, tenus par des liens ;
- **les tables de voisinage** de chaque particule (arêtes, flexion, liens, triangles), les lèvres, les fibrilles, la géométrie de rendu ;
- **la pose de l'armature** à chaque sous-pas.

**La dynamique** (`scene/gpusim.js`, shaders de calcul WebGPU). C'est de l'XPBD à petits pas, résolu particule par particule : chaque fil de calcul rassemble les corrections de toutes les contraintes qui touchent sa particule et les moyenne (Jacobi pondéré, deux tampons alternés). Pas d'atomiques, pas de coloration de graphe, résultat déterministe. Les contraintes :
- étirement, avec des longueurs au repos raccourcies (précontrainte) ;
- flexion ;
- pression intérieure, réglée pendant la mise en place, qui monte (cage) puis fuit dès la première rupture ;
- collisions avec l'armature et avec l'œuf suivant, avec frottement ;
- freinage de l'air et frémissement des lambeaux.

Un fil par lien décide des ruptures : étirement autour du lien, seuil propre à chaque lien, fatigue, dégrafage de l'avant. La rupture se propage d'elle-même. Les lèvres s'enroulent, les lambeaux se relâchent et se retroussent.

Une couche de 20 000 particules (120 images, 16 sous-pas, 6 passes) se simule en moins de 3 s.

**L'enregistrement et la pose.** Le GPU enregistre la position de chaque particule à chaque image. À l'affichage, un autre shader de calcul pose chaque couche visible :
- positions interpolées, et position à l'image précédente (vecteurs vitesse) ;
- normales soudées à travers les coutures encore intactes ;
- dilatation de surface J : la membrane s'amincit en 1/J ;
- endommagement près des déchirures ;
- sommets des lèvres : un demi-tube autour du bord libre, replié tant que la couture tient.

Le rendu lit ces tampons directement. Les instants de rupture et de claquage des fibrilles sont calculés une fois, sur le GPU.

**Les vaisseaux** (`vessels.js`). Ils sont obtenus par colonisation de l'espace à partir de racines près du pédoncule, et leur rayon suit le modèle des tuyaux. Le réseau est rastérisé dans une carte octaédrique de la direction au repos.

**L'armature** (`armature.js`, `kin.js`). Chaque pièce est rigide, à un facteur d'échelle près, et suit une loi de déploiement (gonflement, extension) puis d'ouverture autour d'une charnière. Les natures :
- **calice** : lames bombées en quartiers ;
- **iris** : lames vrillées qui pivotent presque à plat, comme un diaphragme ;
- **gousse** : deux à quatre mâchoires nervurées ;
- **ombrelle** : des baleines le long des méridiens ;
- **couronne** : des épingles montées sur la couronne de charnières, qui coulissent (la tête perlée tend puis perce la membrane) puis s'inclinent ;
- **cage** : un icosaèdre, un dodécaèdre ou un octaèdre fixe, sous la membrane ; c'est la membrane qui gonfle et cède au milieu des faces.

## Rendu (`src/scene/`)

**La membrane** (`membrane.js`). Le vertex shader lit la simulation (deux images interpolées) et place les milieux d'arête sur le patch cubique des triangles PN : les silhouettes et les lambeaux enroulés restent courbes, quatre fois plus fins que le maillage simulé. La position à l'image précédente donne les vecteurs vitesse.

La matière est une couche mince diffusante :
- l'épaisseur relative vaut irrégularité × vaisseaux × fibres / J ;
- la transmission suit la loi de Beer-Lambert, avec l'absorption du sang (forte dans les gros vaisseaux, faible dans les capillaires) et un halo de sang diffus ;
- la membrane blanchit sous la tension et près des déchirures ;
- l'albédo est la part de lumière qui ne traverse pas.

**Lisibilité.** Une couche mince vue de biais est traversée sur une épaisseur h / cos : la silhouette d'une peau est plus dense que son centre, et l'on distingue la membrane de ce qu'elle contient. Le flou de ce qui est vu au travers dépend de la distance (une copie de la profondeur, propre à chaque couche) : une lame qui touche la membrane reste nette, le lointain se dissout. Seules deux ou trois couches profondes sont visibles à la fois.

Ce qui est derrière la membrane est une copie de l'image, propre à chaque couche et prise au moment où elle est dessinée. Les couches intérieures sont déjà là, et l'ordre de dessin le garantit : faces arrière de l'extérieur vers l'intérieur, puis faces avant de l'intérieur vers l'extérieur. La part non diffusée y est vue nette, la part diffusée floue (niveaux de mipmap), le tout réfracté selon la normale et l'épaisseur.

Le modèle physique s'ajoute par-dessus :
- translucidité de la lumière venue de derrière : les lames se dessinent en ombres chinoises ;
- film humide, un vernis à sa propre normale ondulante ;
- lustre ;
- irisation, dont l'épaisseur du film suit 1/J : la couleur change quand la bulle s'étire ;
- feuille de métal : l'or battu transmet le vert, froissé en permanence ;
- plis de compression, fibres du vélin et de la soie ;
- anticrénelage spéculaire.

**Les fibrilles.** Elles sont construites dans le vertex shader. Le filament s'étire et s'amincit à volume constant, ploie, puis claque ; chaque moitié se rétracte vers sa lèvre en oscillant et s'épaissit.

**L'armature.** Elle reprend les quarante finitions de Hollow et Tesseract : métaux au F0 mesuré, émail guilloché, damas, laque urushi, marbres, céramiques, nacre, carbone…

**Lumières.**
- **La lampe**, solidaire de la caméra, sans atténuation, avec les ombres de l'armature.
- **Le contre-jour**, derrière le nid, qui fait de chaque membrane un écran d'ombres chinoises.
- **Le cœur**, une lueur au centre d'où naissent les couches et que l'on devine au travers de toutes.

Le studio HDR fournit les reflets. Le post-traitement est repris de Tesseract.

## Membranes

- **Chorion** : amnios vascularisé, humide.
- **Cire** : pétale épais, très diffusant.
- **Latex** rouge ou noir : fortement précontraint, il claque et s'enroule.
- **Vélin** : fibreux et cassant, il libère beaucoup de fibres.
- **Gel d'agar** : épais et réfringent, il file en longs filaments.
- **Feuille d'or** : froissée, elle transmet le vert.
- **Bulle** : film lipidique irisé, dont le bord se rétracte en bourrelet.
- **Organza de soie** : avec son lustre, il s'effiloche.

## Humeurs

Chaque humeur favorise ses membranes, ses armatures, ses matériaux, son studio et ses lumières :
- Organique ;
- Clinique ;
- Abysses ;
- Joaillerie ;
- Atelier ;
- Irisé ;
- Rouge.

Une scène tire une matière dominante, parfois une seconde, et des armatures différentes d'une couche à l'autre.

## Performances

- **Préparation** d'une couche dans le worker : 0,4 s pour 20 000 particules (mesuré dans Node).
- **Simulation** sur le GPU : 2,6 à 2,8 s par couche ; une scène de trois couches est prête en 14 s environ, mesurée dans un panneau de navigateur masqué, donc ralenti.
- **Rendu** : environ 24 ms par image à 1,8 Mpx, poses, copies de l'image et de la profondeur comprises.
- **Mémoire** : les images enregistrées pèsent environ 38 Mo par couche différente.

[![Membrane](docs/capture.jpg)](https://drschizzo.github.io/Codevember/membrane/)
