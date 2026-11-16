# Mirage — document de travail

Thème donné : « mirage ». Le projet s'appelle **Mirage**, sous-titre *l'objet qui n'est pas là*.

Les deux premiers concepts, un horizon au très long foyer (Fata Morgana au soleil de minuit) puis un cabinet de physique (cuve de sirop, plaque chaude), sont abandonnés. Leur idéation (le thème en largeur, les clichés, dix pistes notées, les épreuves) et leurs mesures sont dans [concept-horizon.md](concept-horizon.md). Le premier était juste mais illisible : la cause était invisible et la seconde apparence une simple déformation. Le second était lisible mais restait une démonstration de laboratoire. Ce que le mot doit donner à voir : **une chose qu'on voit nettement, et qui n'est pas là**.

## La piste retenue : le mirascope en abyme

### Le mirascope

Deux miroirs paraboliques concaves, posés l'un sur l'autre, faces argentées en regard. Le sommet de chacun est au foyer de l'autre, et celui du haut est percé d'une ouverture. Un petit objet posé au fond, invisible de l'extérieur, se montre au-dessus de l'ouverture, en relief et éclairé : on tend la main et on ne touche rien. L'objet a été inventé et breveté sous le nom de « Mirage » (Elings et Landry, 1972). On l'appelle aussi « miroir fantôme ».

Pourquoi c'est la bonne piste :
- **On voit une chose qui n'est pas là**, au sens propre : l'image réelle flotte dans l'air, en trois dimensions, et change avec le point de vue comme un vrai objet.
- **La cause est un objet qu'on voit** : deux coupes d'argent. Une coupe dans le couvercle montre dans le même cadre l'objet posé au fond et son image qui flotte.
- **Le cœur technique est exact** : un lancer de rayons au pixel entre deux paraboloïdes, sans approximation de reflet. L'image réelle se forme d'elle-même.
- **Un objet de musée** : coupes d'argent guillochées, émaux, laque, nacre, couronnes de perles.

Références : les photographies du mirascope (Optigone), une coupe de 15 cm, une ouverture de 5 cm, une figurine qui semble posée sur l'ouverture ; l'image se voit sous un cône d'environ 30 à 60° au-dessus de l'horizontale ; de profil, l'ouverture est vide.

### L'abyme

Au fond du mirascope, l'objet est un autre mirascope, vingt fois plus petit (K = 0,05), posé tourné d'un demi-tour ; au fond de celui-ci, un plus petit encore. Au-dessus de l'ouverture flotte l'image du petit, qui fait flotter le suivant au-dessus de la sienne. La caméra plonge dans l'image jusqu'à ce que le petit emplisse l'écran comme le grand au début : la boucle reprend un niveau plus bas.

### La boucle (24 s par défaut, `src/timeline.js`)

| u | ce qu'on voit |
| --- | --- |
| 0 – 0,045 | raccord : le morphing efface l'écart entre l'image du petit et le grand ; la plongée est rapide |
| 0,06 – 0,16 | une fente s'ouvre dans le couvercle, face à la caméra, et s'élargit en éventail jusqu'au quart |
| 0,12 – 0,42 | la caméra avance lentement : par la coupe, le vrai petit au fond ; au-dessus de l'ouverture, son image |
| 0,44 – 0,60 | la coupe se referme |
| 0,42 – 1 | la caméra accélère et plonge dans l'image, coupée elle aussi, avec le suivant au fond |

La lumière ne change pas. Le niveau λ suit une courbe de Hermite monotone, avec la même vitesse des deux côtés du raccord. L'azimut se balance de 6 à 12°, une fois par niveau.

### Variations

Une graine tire le décor du dôme (la famille, ce qui se répète d'un niveau à l'autre) parmi cinq, une gravure pour l'argent guilloché (vagues, soleil, spirale), la paire de pierres de la couronne, un décor de pièce parmi quatre, la finition des coupes parmi celles du décor, l'émail de la bande, le projecteur et le balancement de la caméra. Les tableaux sont dans le [README](../README.md#familles-et-décors).

## Ce que les essais ont appris

Dix versions, de la Fata Morgana au mirascope en abyme. Ce qui en reste utile :

- **L'image d'un mirascope est coupée au-delà de ~14 mm** au-dessus du fond : vu de ~40°, la ligne de visée prolongée manque l'ouverture. Un vrai mirascope coupe aussi ses objets trop hauts. Le petit reste sous 11,5 mm (un test le garde).
- **L'image n'est pas une copie réduite** : elle paraît plus profonde que large, et ce qu'on en voit sous un angle vient de rayons partis sous un autre. Le raccord s'ajuste donc pixel à pixel (`tools/seamfit.mjs`, Nelder–Mead), pas en réduisant la pose. Réduire K réduit l'écart (7,9 % de pixels et 1,8 mm à K = 0,1 ; 6,9 % et 1,0 mm à K = 0,05).
- **Un champ qui ne fait que se resserrer** : le premier ajustement donnait 39° au grand pour 26° à l'image, la caméra aurait élargi puis resserré son champ. Avec 18° pour l'image, le grand tombe à 20,7°.
- **Rendre le raccord exact par construction** pour tout ce qui n'est pas la géométrie : la même salle dans le repère de chaque niveau, et un rayon qui ressort de la cavité d'un petit après s'y être réfléchi voit la salle comme s'il sortait du grand.
- **La gravure s'efface selon la taille d'un pixel à la distance de la visée**, ramenée à l'échelle du niveau, pas selon le chemin du rayon : l'image est réelle, les miroirs refocalisent. Mesurée par le chemin, la gravure disparaissait de l'image du petit.
- **Un scénario en actes** (noir, lumière, levée du couvercle, plongée, nuit) était trop compliqué et le raccord s'y voyait. Une seule plongée, lumière fixe.
- **Une plongée seule ne dit pas que c'est un mirage** : des dômes dans des dômes. Une aiguille qui traversait l'image était juste mais muette. Ce qui se lit : l'objet réel à côté de son image, par une coupe de maquette de musée.
- **Un écorché permanent ne se comprend pas** : la coupe s'ouvre et se referme pendant la boucle, et elle est fermée au raccord.
- **La caméra ne tourne pas** : avec l'entaille, une spirale d'un demi-tour par niveau aurait regardé, à mi-chemin, le côté entier, et l'image se serait formée par l'entaille, éteinte. Chaque petit est donc posé tourné d'un demi-tour, et son image a l'orientation du grand.
- **La coupe du bas reste entière** : par l'entaille on ne voit que l'intérieur, jamais la table, que le petit n'a pas.
- **Un fondu donne une double image** ; un morphing, où chaque pixel vise d'abord le point que montrait la vue d'avant, ne la donne pas. Le raccord se fait en mouvement.
- **Les perles tranchées** : la couronne est tracée avec la lèvre en *sphere tracing*, privée du coin de la coupe, pour que chaque perle soit coupée à mesure que la coupe passe au lieu d'apparaître et disparaître d'un coup.
- **Piège TSL** : une valeur émise paresseusement dans la première branche qui la lit reste nulle dans les autres (normale nulle, nacre grise, martelé lisse). Les entrées sont figées en variables avant le choix du décor.
- **Piège TSL** : le tracé écrit une fois comme fonction WGSL (`setLayout`) et appelé pour deux caméras perdait ses uniformes à la recompilation. Il est écrit deux fois, en ligne.
