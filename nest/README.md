# Nest

*la saison de papier.* Un nid de guêpe sous une poutre, une saison entière en une boucle de 64 secondes. Au printemps, une reine se pose sur la tache grise qu'a laissée le nid de l'an passé, bâtit un pétiole, une dizaine de cellules, puis une première coupe de papier. Les ouvrières arrivent, et le nid enfle cloche après cloche : chaque nouvelle enveloppe descend comme une jupe par-dessus la précédente, écaille après écaille, bande après bande. Au cœur de l'été, le film ralentit jusqu'au temps réel : une ouvrière recule le long du bord d'une écaille en y posant une bande de pâte bleue, humide. Puis la colonie s'éteint, l'hiver fonce le papier, le givre prend sur les lèvres des écailles, le pétiole mouillé cède et le nid tombe. La poutre retrouve sa tache, la lumière du printemps revient.

![Gros plan au temps fort : une ouvrière jaune et noire au bord d'une écaille de papier rayé, la bande bleue qu'elle vient de poser encore humide et luisante (graine n29)](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md) : le thème exploré en largeur, les clichés écartés (le nid gris vu de loin, le nid coupé en deux sur fond noir, l'essaim menaçant), huit pistes notées, la piste retenue avec ses références et ses épreuves.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…` (une scène), `?mood=…`, `?family=…`, `?village=…` (imposer l'humeur, la famille, le village), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?mobile=1` / `?mobile=0` (version mobile imposée / interdite), `?debug` (outils dans `window.nest` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)`, `film(u0, u1, n)`, `meter()`, `bench(phase, n)`, `seam()` ; et `stage.only = k` pour ne montrer qu'une cloche).

Le panneau règle l'humeur, la famille et le village (nouvelle scène de la même graine), la durée de la boucle ; le dossier **Le nid** règle la forme (demi-largeur, demi-hauteur, bosses), la taille des écailles, la fidélité des ouvrières à leur source et les couleurs des sources. Viennent ensuite la caméra, la lumière et le rendu. L'export produit une boucle MP4 (H.264) rendue image par image, éventuellement accumulée, et une image PNG.

## Principe : une saison qui revient à la poutre nue

**La liberté** (la seule chose impossible du film) : les guêpes ne raclent que les volets, les portes et les bancs peints du village, si bien que chaque bande de papier garde la couleur de sa planche. Tout le reste suit ce qu'on sait des *Vespula* : le pétiole et le premier rayon de la reine, les coupes emboîtées du nid de fondation, l'enveloppe faite d'écailles en coquille, une bande par charge de pâte, la colonie qui croît puis meurt aux premières gelées, le nid jamais réutilisé, la chute du papier mouillé.

### La boucle

La saison s(u) est une fonction croissante de la phase u, avec s(0) = 0 et s(1) = 1 (`src/season.js`). L'état du nid ne dépend que de s : avant l'arrivée de la reine et après la chute, il ne reste que la cicatrice, une géométrie fixe qui n'a pas d'âge. Les guêpes sont absentes aux deux bouts, la lumière, l'humidité et le givre reviennent à zéro au printemps. L'état à u = 1 est donc exactement celui de u = 0 (`seam()` mesure 3·10⁻¹⁶).

### Le scénario

| Temps (u) | Ce qu'on voit | Cause | Convention de temps |
| --- | --- | --- | --- |
| 0 – 0,035 | la poutre nue, la tache de l'an passé, lumière de printemps | | accéléré |
| 0,035 – 0,066 | la reine arrive en vol, se retourne et se pose sous la poutre | la reine | **temps réel** |
| 0,07 – 0,12 | le pétiole, puis les cellules du premier rayon, une à une | la reine (fantôme de l'accéléré) | accéléré |
| 0,1 – 0,58 | six cloches emboîtées, chacune bâtie du haut vers le bas | les ouvrières, de plus en plus nombreuses (jusqu'à 110), posées sur le front | accéléré (×3·10⁵), guêpes vues 12 fois par seconde |
| 0,395 – 0,445 | une ouvrière pose une bande bleue au bord d'une écaille | l'ouvrière | **ralenti ×0,5** |
| 0,58 – 0,70 | la colonie s'éteint, le soleil d'automne baisse | | accéléré |
| 0,70 – 0,85 | le papier boit l'humidité, le givre prend | l'hiver | accéléré |
| 0,85 – 0,87 | le nid s'affaisse, penche et tombe hors du cadre | le pétiole mouillé cède, g = 9,81 m/s² | **temps réel** |
| 0,87 – 1 | la caméra revient vers la tache, le printemps revient | | accéléré |

Une seule horloge commande tout : la croissance, la lumière (le soleil d'été monte et déplace sur le mur la tache de la fenêtre), l'humidité, le givre, la colonie et la caméra.

## Génération (`src/gen/`, dans des Web Workers)

**L'enveloppe** (`envelope.js`). Chaque cloche k, d'échelle λₖ ∈ {0,17 ; 0,3 ; 0,46 ; 0,63 ; 0,82 ; 1}, est une enveloppe complète :

- une **base** étoilée autour du centre, ρ(direction) : un ellipsoïde en bas et une superellipse en haut (|ρh/a|² + |ρy/b|^p = 1, résolue par Newton), si bien que le nid reste large jusqu'à la poutre ; de petites cloches en boule, pendues à leur pétiole ;
- des **racines** en semis de Poisson sur la base (espacement ∝ λ^0,75 : les petites cloches ont des écailles plus petites) ;
- chaque **écaille** est un demi-disque en superellipse (|X|^2,6 + Y^2,6 = 1 : un bord libre large et plat), posé dans le plan tangent à sa racine et projeté sur la base, puis soulevé d'autant plus qu'on va vers son bord libre (poche profonde, lèvre relevée et roulée), taille log-normale, biais et bord effrangé propres ;
- le **drapage** : les écailles sont posées de bas en haut ; chacune épouse ce qui est déjà posé, hauteur = max(profil, pile + jeu), où la pile est une grille (θ, φ) des hauteurs déjà posées, **prise au maximum sur un voisinage d'un pas de sommet**. Sans cette dilatation, la lèvre fine d'une écaille du bas tombait entre deux sommets d'une écaille du haut et la perçait (des traits blancs) ; un test la vérifie, avec un témoin sans dilatation qui doit échouer ;
- chaque écaille devient une **lame épaisse fermée** (dessus, dessous, tranche en demi-rond aux normales calculées), 0,3 mm de papier ;
- les **bandes** : 25 à 45 par écaille, une par charge (2 à 3 mm), dont la source est tirée par une chaîne de Markov (probabilité 0,3 à 0,45 de rester sur la même planche) ;
- les **naissances** : un front descend de l'attache vers le trou de vol ; une écaille ne naît que lorsque celle qui la recouvre a poussé jusqu'à sa racine (sinon son amorce flotterait sous le front), jamais avant celles nettement plus haut ; le corps (la feuille sous les écailles) paraît après la dernière écaille de sa rangée.

**La fondation** (`comb.js`) : un pétiole torsadé évasé sur la poutre, puis douze cellules hexagonales en spirale autour de lui, parois en lames épaisses qui s'allongent.

**La cicatrice** (`buildScar`) : la plaque de papier délavée, déchirée, qui reste collée à la poutre ; la même aux deux bouts de la boucle.

**La guêpe** (`wasp.js`) : un modèle anatomique de *Vespula* — tête large et plate, resserrée vers le clypéus, dont les yeux sont un bombement de la capsule même, placés au bord de la face (contour réniforme échancré au bord avant, redessiné au pixel par la même formule que la géométrie, facettes hexagonales), orbites et échancrure jaunes, front noir au-dessus des antennes, tempes jaunes, trois ocelles, clypéus, mandibules dentées, antennes coudées (scape, flagelle de dix articles annelés), mésosome découpé (propodéum, scutellum, scutum en dôme, collerette du pronotum), gastre de six tergites distincts qui se recouvrent et aiguillon, six pattes (hanche trapue, fémur renflé et aplati, tibia qui s'évase, éperons, cinq articles de tarse, griffes), ~3 400 soies, chacune sa nuance (brun sombre sur la tête et le thorax, dorées sur le gastre) ; quatre ailes nervurées (cellules marginale et sous-marginales, ptérostigma), pliées en long au repos. Deux niveaux de détail : 35 600 sommets de près, 3 800 de loin (sans soies, sections deux fois plus grossières).

**Le squelette** (`skeleton()`) : douze chaînes — six pattes de quatre articulations (balayage à la hanche, fémur, genou, cheville), deux antennes, deux mandibules, la tête, le gastre — dont les pivots et les axes viennent du même module que la géométrie. Le vertex shader fait la cinématique directe, de l'articulation la plus lointaine à la plus proche ; antennes et mandibules suivent ensuite la tête. Chaque famille de chaîne a sa branche : un sommet ne calcule que les angles de la sienne.

## Scène (`src/scene/`)

- **Papier** (`paper.js`) : la coordonnée de croissance t = |(X, Y)|_2,6 / E est calculée **au pixel** à partir de coordonnées planes qui varient linéairement (une interpolation de t par triangle dessinait des anneaux polygonaux) ; bords de bande ondulés et fibreux, fibres couchées le long de la bande, crête de chaque bande et sillon entre deux, pâte humide plus sombre et plus brillante, humidité d'hiver par plaques, givre sur les lèvres ; translucidité (`MeshSSSNodeMaterial`, faible). Le masque de croissance (t ≤ g) se lit au pixel ; une écaille pas encore née est écrasée en un point dans le vertex shader.
- **Deux tracés par cloche** : les écailles finies, sans masque (le test de profondeur élimine les couches cachées), et le front, seul à porter le `discard`. À 1080p, la cloche pleine passait ainsi de 38 à 16 ms.
- **Le temps fort** : une écaille presque finie, tournée vers la caméra et dont le bord libre n'est recouvert par aucune autre (vérifié sur les sommets), reçoit un tiers de bande de plus, déposé le long du bord devant les mandibules de l'ouvrière, qui recule. L'ouvrière est enveloppée de quatre volumes (gastre, thorax, tête, ailes repliées) confrontés à tous les sommets du papier proches : pour chaque point de la course, le plus petit déplacement vers le dehors et vers le bord libre qui les dégage, calculé une fois puis interpolé. Chaque tarse est ensuite posé sur le papier (`legs.js`) : le squelette du shader refait en JavaScript donne le bout de chaque patte, la hauteur du papier dessous est lue sur la couche où se tient l'ouvrière (poids continus, sans marche), et une correction du fémur, trouvée en quelques itérations, l'y amène ; au-delà du bord libre, la patte va chercher le bord. Les corrections sont calculées image par image sur toute la course, comblées dans le temps quand une patte est au-dessus du vide, dilatées puis lissées : elles ne sautent pas d'une image à l'autre, et un tarse ne s'enfonce jamais dans le papier. La caméra la suit, de trois quarts, sous un angle choisi pour que la ligne de visée ne traverse pas l'enveloppe.
- **Guêpes** (`wasps.js`, `flight.js`) : corps et ailes instanciés (32 flottants par guêpe : pose et gestes courants et précédents, pour les vecteurs vitesse) ; la pose est une fonction du temps physique t = s·T : arrivée en courbe de Bézier sur le front de construction ou au trou de vol, marche (trépied, balayage de ±0,42 rad, foulée de ~3,4 mm liée au chemin parcouru : les pieds ne glissent pas), envol ; antennes qui palpent, mandibules qui mâchent, gastre qui pompe. Les ouvrières se posent sur une carte du relief réel de la cloche (rayon maximal du dessus des écailles), pas sur un ellipsoïde. Dans l'accéléré, une prise de vue toutes les 1/12 s de film : chaque guêpe se lit, nette, entre deux prises. En vol, chaque aile est tracée à cinq instants du battement, à un tiers d'opacité : le flou d'une aile à 150 Hz, sans scintillement. Les seize guêpes les plus grandes à l'écran prennent le modèle complet, les autres le modèle allégé (squelette réduit, sans ombre).
- **La reine** : elle arrive en temps réel, se retourne et se pose (le corps à la hauteur de ses pattes), fait quelques pas jusqu'au site et y râpe le bois. Le pétiole pousse ensuite de la poutre vers le bas, au bout de ses mandibules, jamais sous elle ; dans l'accéléré, elle se tient au bord du rayon, qu'elle suit à mesure qu'il s'élargit (un test confronte tous les sommets du chantier au corps de la reine, à chaque instant de la fondation).
- **Décor** (`decor.js`) : poutre de chêne altéré (cernes, fibres, fentes de séchage, badigeon resté dans le fil), mur de chaux, rameau à écorce, fond de brume pour les humeurs du dehors.
- **Lumière** : une lampe (la fenêtre, dont le cadre et les croisillons sont projetés par un `colorNode` de la `SpotLight` ; ou le soleil, ou une lampe de porche), un contre-jour, un studio HDR calculé ; la lampe suit la saison.
- **Chute** : chute libre réelle (½·g·t², 1 unité = 10 cm), précédée d'un affaissement de 1,2 mm et d'une bascule autour de l'attache.

## Familles et humeurs (`src/recipe.js`)

- **Familles** : *boule* (Vespula sous une poutre : sphère d'écailles en coquille, large attache) et *lanterne* (Dolichovespula : poire allongée, attache étroite, feuilles plus grandes et plus plates, bandes plus larges).
- **Villages** (les sources de papier, le bois d'abord, la peinture en accent) : Provence (bleu de volet), Falun (rouge de Falun), Bois seul, Rivage (bleu outremer), Verger (vert).
- **Humeurs**, chacune un décor, une lumière, une valeur, un cadrage :
  - *Comble* d'après Hammershøi : poutre de chêne grisée, mur de chaux, la fenêtre hors champ et ses croisillons sur la poutre et le mur ;
  - *Midi* : avant-toit blanchi, mur ocre clair, soleil dur d'en haut, ciel bleu, forte contre-plongée ;
  - *Haie* : un rameau dans la brume vert-gris, ciel couvert, de trois quarts ;
  - *Contre-jour* : poutre sombre, la fenêtre derrière le nid ;
  - *Nuit* : lampe de porche chaude sur le côté, ombres bleues de la lune ;
  - *Givre* : poutre peinte au rouge de Falun, jour blanc de neige.

## Tests

```bash
node --test 'nest/test/*.test.mjs'
```

17 tests (sur l'horloge de 64 s) : la recette (déterminisme, JSON, tirages, direction artistique : le papier est d'abord du bois, contraste de valeur des bandes, lampes presque blanches sauf la lampe de porche, six décors distincts) ; l'horloge (s croissant, raccord, ralentis au temps réel, plan ordonné, temps fort au milieu de sa cloche, colonie à une seule montée) ; la caméra (raccord, moins de 25°/s, aucun saut, à 120 i/s) ; les guêpes (absentes au raccord, quaternions unitaires) ; l'enveloppe (aucun NaN, **aucune écaille sous une écaille posée avant elle, et le témoin sans dilatation échoue**, naissances dans leur fenêtre, front qui ne remonte pas, corps jamais en avance) ; la cicatrice identique aux deux bouts.

## Performances mesurées

MacBook (Apple Silicon), Chrome, 1920 × 1080, qualité Haute (TRAA, GTAO, ombres 2048, profondeur de champ ; sans SSR) : **16 à 18 ms par image** mesurées sur une machine au calme (graine a1, phases 0,2 à 0,7). Les mesures suivantes, faites pendant que d'autres onglets occupaient le GPU, triplaient tout, scène vide comprise : elles sont à refaire.

| Poste | Mesure |
| --- | --- |
| génération des six cloches (workers en parallèle) | 0,8 à 1,8 s chacune (6,5 s de calcul en tout), ~2 s au chargement |
| géométrie | 2,4 M sommets (six cloches), deux visibles à la fois |
| cloche pleine, un seul tracé avec masque | 38 ms par image |
| cloche pleine, deux tracés (finies + front) | 16 ms |
| SSR (coupé par défaut : le papier est mat) | +16 ms |
| GTAO | ~6 ms |

## Version mobile

`?mobile=1` : écailles 1,25 × plus grandes (deux fois moins nombreuses), grille d'écaille 6 × 14, chaîne d'image allégée (FXAA, sans GTAO), résolution dynamique, 60 i/s plafonnés.

## Ce qui n'est pas vérifié

- La lecture fluide en direct dans un navigateur affiché (les vérifications ont été faites en images fixes et en mesures, dans un Chrome sans tête).
- Les temps d'image ont été mesurés pendant que d'autres onglets occupaient le GPU : à refaire au calme.
- L'appui des pattes ne règle que le fémur, et seulement pour l'ouvrière du temps fort : un tarse peut flotter de quelques dixièmes de millimètre (0,2 mm en médiane, jusqu'à 1,4 mm, mesuré par `nest.stage.heroLegs(u)` en `?debug`), le pied ne reste pas cloué au papier pendant l'appui, et les ouvrières de l'accéléré gardent la pose nominale.
- L'humeur *Contre-jour* ne fait pas encore briller le papier comme un vrai contre-jour.
- Les familles *ombrelle* (Polistes) et *clocher* (Chartergus) du concept ne sont pas faites.
