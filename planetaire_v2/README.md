# Planétaire v2 : Chorégraphies

Un planétaire est une machine qui calcule le ciel. Celui-ci calcule des ciels qui n'existent pas encore : chaque graine lance la recherche de **chorégraphies** du problème à N corps (N masses égales qui se poursuivent sur une même courbe fermée, solutions exactes des équations de Newton), conçoit pour chacune la machine à engrenages qui la trace pour de bon, et la met en abîme : **chaque astre est une boule de verre qui contient la même scène**, et la caméra y plonge sans fin, en boucle parfaite. Rendu physique en three.js (WebGPU, TSL). Rien n'est téléchargé hors three.js : orbites, machines, matières et studios sont calculés en quelques secondes à partir de la graine.

La page de test du solveur seul reste dans `proto/`.

## Utilisation

```sh
python3 -m http.server 8040        # dans planetaire_v2/
# → http://localhost:8040/          la scène
# → http://localhost:8040/proto/    le solveur seul (?seed=…, ?gallery)
node tools/bench.mjs 0 300 sortie.json   # banc d'essai du solveur : 300 graines en parallèle (ARMS=14 : critère de la machine)
```

| Touche | Action |
| --- | --- |
| N | nouvelle orbite (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | pas à pas dans la boucle |
| E | vidéo MP4 de la boucle |
| P | image PNG |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle orbite, un appui long masque l'interface.

Paramètres d'URL : `?seed=…` (une scène), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?mobile=1` / `?mobile=0` (version mobile imposée / interdite), `?debug` (outils dans `window.chor`).

Le panneau règle tout :
- **Orbite** : contraintes du solveur (nombre de corps, classe de symétrie, rotation du plateau p/q) ; chaque changement relance la recherche, sous les yeux ;
- **Plongée** : durée d'une couche, part avant la plongée, caméra libre ;
- **Couche** (le monde) : orbite, humeur, archétype de machine, plateau, matières, astres (monture, verre, irisation, lumière), trace, rythme et caméra, lumières ;
- **Lumières** et **Rendu** (qualité, résolution dynamique, ombres, étalonnage, bloom, profondeur de champ…) ; **Export** (MP4, PNG).

## La recette (`src/recipe.js`)

Une scène, c'est un monde (chaque astre en contient une copie exacte) et le rythme de la plongée. Le monde tire, à partir de la graine :
- son **orbite** (nombre de corps, classe de symétrie, rotation du plateau p/q, tirés ou imposés) ;
- son **humeur** : Atelier d'horloger, Observatoire, Clinique (porcelaine et chrome sur fond clair), Cabinet de curiosités, Forge, Sacré. Elle choisit le studio, les lumières, et oriente les tirages suivants ;
- son **archétype de machine** : mouvement d'horlogerie, planétaire classique, atelier, astrolabe ;
- ses **astres** : boule de verre (claire, fumée, bleutée, ambrée, verte, plus ou moins irisée) dans une monture (jonc, cardan à deux anneaux, cage armillaire, sertie à griffes, lanterne) ;
- son **plateau** (vingt-quatre matières, finitions guilloché, soleil, perlage), ses **matières**, sa **trace** (verre filé, fil d'or, gravure rougeoyante, aucune), son rythme (ralentis, périodes par couche) et l'angle de sa caméra.

## La scène (`src/main.js`, `src/scene/`)

**La plongée** (`main.js`, `scene/world.js`). Le monde est complet (machine, sol, coque de studio vue de l'intérieur, lampe et contre-jour, matières et studio HDR propres). Chaque astre est une boule de verre sur cardan (elle reste droite quand le plateau tourne) qui contient **la même scène**, réduite d'un facteur k = rayon de la boule / rayon de la coque : la boule visée en contient un exemplaire complet, les autres sa miniature. Trois exemplaires du monde sont emboîtés à la fois. Dans chaque couche, on regarde d'abord la machine, puis la caméra entre dans la boule la plus proche. C'est le monde qui subit une similitude A(s)⁻¹, A(s) = translation p·(1 − kˢ)/(1 − k) ∘ homothétie kˢ, de point fixe la boule visée : elle grandit en glissant vers le centre de l'image, et à s = 1 la couche suivante occupe exactement la place de la précédente (vérifié : position et échelle identiques à 10⁻¹⁴ près aux trois raccords, bouclage compris). Vue de l'intérieur, la boule montre la coque du monde suivant, qui cache la machine géante qu'on quitte. Tout ne dépend que de τ et chaque monde ne dépend que de sa profondeur relative, comme dans Hollow : la scène à τ + 1 est identique à la scène à τ (vérifié : écart nul), la boucle dure une couche et la plongée est infinie. Chaque monde n'est éclairé que par ses propres lumières (lampe, contre-jour, une lumière par astre), à l'échelle de sa couche (intensité × échelle²), et sa lampe n'ombre que lui (un calque par monde) : un monde emboîté n'est jamais inondé par celles du monde qui le contient, rien ne s'allume ni ne s'éteint pendant la plongée, l'éclairage est lui aussi auto-similaire. Les lumières sont rangées dans des gréements placés directement dans la scène, dans un ordre fixe, qui recopient à chaque image la position de leur monde : three.js calcule la clé de ses shaders à partir de l'ordre des lumières de la scène, et ré-emboîter les mondes à chaque raccord recompilait sinon tous les matériaux (un gel à chaque plongée). En approchant de la boule visée, sa monture livre passage : ses anneaux ralentissent et s'arrêtent, la cage pivote autour de la verticale jusqu'à présenter un vide sur la trajectoire de la caméra (calculée d'avance, puisque tout ne dépend que de τ), le couvercle de la lanterne se soulève ; la caméra passe entre les montants et la monture sort du cadre d'elle-même. Le verre s'efface quand il remplit l'image. Le verre est presque invisible de face et réfléchissant vers le bord (Fresnel), avec un fin liseré. Le sol se fond dans la coque (cyclorama, brume au ras du sol) : ni bord ni horizon nets. La coque est fermée sous le sol par une calotte tournée vers l'extérieur : invisible de l'intérieur, elle cache, vue du dehors, le chaton et la goupille qu'on verrait sinon au travers de la boule ; la boule repose sur le chaton sans y entrer.

**L'atmosphère** (`scene/atmosphere.js`). Des poussières qui dansent et s'allument dans le cône de la lampe, le faisceau lui-même (un cône de lumière diffusée, nul avant d'atteindre la machine), des nappes de fumée au ras du sol qui tournent lentement l'une contre l'autre et, à la forge, des braises qui montent du plateau et s'éteignent en montant. Sans aucun tampon : chaque particule tire sa position d'un hachage de son indice, sa trajectoire ne dépend que du temps local du monde (la boucle reste parfaite). Dosage par humeur (Clinique presque nette, Sacré embrumé d'encens, Forge enfumée), réglable dans le panneau (Couche → Atmosphère). Environ 2 ms par image.

**Le plateau tourne.** Une orbite trouvée dans un repère tournant à ω est une vraie solution dans le repère fixe : le plateau tourne à ω comme une platine ; sur lui, la courbe est fixe, et la machine la trace. ω est rationnel (p/q, q ≤ 5).

**La machine** (`mech/design.js`, `scene/machine.js`), conçue et vérifiée par le calcul :
- *Épicycles.* La courbe z(t) = Σ c_k e^{ikt} est une somme de cercles : pour chaque astre, une chaîne de bras de longueurs |c_k| qui tournent aux vitesses entières k par rapport au plateau. On garde les plus longs jusqu'à 0,3 % de la taille de l'orbite (14 au plus) ; la recherche écarte les orbites qu'une telle machine ne tracerait pas à 1 % près. Les astres sont au bout des chaînes.
- *Trains.* Le bras i doit tourner à kᵢ − kᵢ₋₁ par rapport au bras qui le porte : roue A solidaire du bras i−2 (la roue solaire du plateau pour le premier), renvois sur tenons le long du bras porteur, roue B solidaire du bras mené ; rapport exact, rationnel, dents entières, parité des renvois imposée par le sens, module calculé pour que la chaîne tombe sur la longueur du bras, dents calées dans les creux (vérifié : 1 014 paires, écart < 10⁻¹² de pas). En atelier, la transmission est une courroie, ouverte ou croisée selon le sens.
- *Étages.* L'étoile des bras 0 juste au-dessus du plateau, chaque bras un étage plus haut, les astres au sommet. Répartition par coloration d'un graphe de conflits échantillonné sur la période. Les éléments verticaux imposent un ordre dans chaque rang : la goupille d'un astre et l'axe qui monte du bout d'un bras au bras suivant traversent les dalles plus hautes (elles doivent les éviter), la colonne d'un galet et l'axe qui monte jusqu'au pivot d'un bras traversent les plus basses ; deux chaînes qui partagent un bras de l'étoile ont des axes coaxiaux (montage concentrique, pas une collision). Quand ces contraintes forment un cycle (deux axes qui montent chacun à travers le bras de l'autre), on renonce à la plus brève, et l'on essaie jusqu'à 24 ordres de sommation des bras pour réduire la durée de collision restante.
- *Contrôle.* `node tools/collide.mjs [graine] [nombre] [N]` vérifie chaque machine indépendamment de sa conception, sur la vraie forme des pièces (barre, contrepoids, roues) : sur les graines 0 à 29, 14 machines sur 25 sont sans aucune pénétration ; les autres, à 11 bras ou plus, n'ont plus que des contacts brefs entre petites pièces du haut de la pile.
- *Supports.* Tout est porté. L'étoile roule sur deux galets par bras dont les patins glissent dans deux sillons circulaires du plateau ; les bras supérieurs reçoivent une colonne et un sillon là où aucune pièce ne la croise, sinon ils sont en porte-à-faux sur leurs axes. Sous le plateau : couronne, canon, pont, tube central, arbre de renvoi.
- *Archétypes* (roues, bras, transmission) : **horlogerie** (roues à cinq bras, ponts ajourés), **planétaire classique** (roues à ajours ronds, bras en lyre, sphère armillaire au sommet si aucun astre n'y passe), **atelier** (roues pleines, bras en treillis, courroies ouvertes ou croisées selon le sens), **astrolabe** (roues à huit bras, bras ajourés).

**Le mouvement** (`mech/drive.js`). Ce qui fait tourner la machine est posé sur un bâti fixe autour du plateau, et chaque pièce sert. Un arbre de sortie engrène, par un petit pignon, la **denture taillée au bord du plateau** (le plateau tourne à ω) et, par-dessous, la roue du tube central (l'étoile des bras 0, à ω + k₀) ; ses vitesses découlent de celle du plateau par des rapports de dents exacts.
- *Horlogerie, classique, astrolabe* : le **barillet** (l'énergie, avec rochet, cliquet et clé de remontoir) mène l'arbre par un rouage ; de l'autre côté, un pignon de l'arbre, une roue de champ et son pignon (démultiplication composée) mènent la **roue d'échappement** ; l'ancre et le **balancier spiral** règlent la marche (le balancier bat au rythme des dents, environ 2 Hz) ; des **cadrans émaillés** sont menés par des roues du rouage ; roues sous des ponts vissés sur rubis, posés sur des piliers. Classique : anneau zodiacal sur le bâti, parcouru par un index fixé au plateau.
- *Atelier* : une **machine à vapeur** (cylindre, piston, crosse, bielle, manivelle) fait tourner un **volant**, qui mène l'arbre par une **courroie** ; une courroie croisée entraîne le **régulateur à boules** ; un compteur est mené par un pignon du volant.
- *Satellites.* Tout autour du bâti, des pignons engrènent la couronne dentée et mènent chacun un petit mécanisme : cadran des tours, phase de lune (deux lunes d'or sous un guichet), réserve de marche, ou, en atelier, poulie, courroie et volant. La couronne est la roue de distribution de toute la machine ; quand le plateau est fixe (ω = 0), elle est montée sur le bâti et tourne seule, menée par l'arbre.
- Chaque roue est calée sur celle qui la mène (arbre cinématique) : rien ne tourne pour rien, rien ne glisse.
- *Proportions.* Le plateau ne porte que ce qui repose sur lui : l'étoile des bras 0 et les sillons des galets (calculés sur une période), plus 6 cm ; les bras supérieurs et les astres le survolent librement, au-dessus du bâti (les pièces du bâti dans l'anneau qu'ils balaient restent 9 mm plus bas qu'eux) ; les pièces ont des épaisseurs d'horlogerie de grand volume (bras de 12 mm, roues de 9, plateau de 6 cm, tenons et colonnes doublés), les roues des trains peuvent atteindre la moitié de la longueur du bras.

**Le verre filé** (`orbit3d.js`). Un seul tube, fixe sur le plateau, suit toute la courbe ; il naît de chaque boule et s'y résorbe (son rayon s'annule sous elle) au lieu de traverser sa goupille. La gravure, au ras du plateau, devient du verre filé en hauteur quand la courbe sort du plateau (elle flotterait sinon dans le vide). Au point d'abscisse s, le dernier passage d'un astre date de fract(N·(φ − s)) / N période : la chaleur se calcule dans le shader à partir de la seule phase φ. Le verre rougeoie derrière l'astre, refroidit (couleur de corps noir, puis fil de verre sombre et brillant), et l'astre suivant arrive pour le ranimer. Le verre encore mou est un peu plus épais.

**Le studio.** Sol, lampe principale (ombres), contre-jour, environnement HDR calculé (ceux de Hollow). Chaîne d'image de Hollow : bloom, halation, traînées, poussière sur la lentille, étalonnage, AgX, grain, profondeur de champ.

**Le rythme** (`choreo.js`). Le temps de chaque orbite est déformé autour des passages serrés (plus courtes approches entre deux astres) avec le noyau de Hollow, τ(t) = t − Σ a·w·K((t − t_b)/w), K(x) = x − 3x³ + 3x⁵ − x⁷ : la vitesse tombe au passage, se rattrape de part et d'autre, sans changer la durée totale. Par symétrie, un passage serré revient N fois par période : une pulsation dictée par la physique, dont la graine choisit les accents ; les astres s'embrasent quand ils se frôlent.

**Les finitions** (`scene/machine.js`). Sur les faces supérieures, un décor propre à chaque rôle : côtes de Genève sur les bras et les ponts, soleillage sur les roues, tournage sur le bâti ; sur les chants et les biseaux, l'anglage poli miroir ; partout une variation lente de la rugosité. Les décors sont à l'échelle des pièces (quelques millimètres), ne marquent que les métaux et s'effacent sous le pixel (pas de moiré) ; couleur, rugosité et métal restent ceux de la matière choisie.

**L'écran de génération** (`app/loader.js`, dessin dans `app/loaderWorker.js`). Il est dessiné dans un worker, sur un OffscreenCanvas : il reste fluide (environ 110 images/s mesurées) même pendant que le thread principal construit les machines ou compile les shaders (plusieurs secondes pour une grande machine). La conception de la machine (étages, trains, galets : jusqu'à une seconde) est elle aussi calculée dans un worker, une seule fois pour les trois mondes. L'écran dit ce que fait le moteur : une phrase explique ce qu'est une chorégraphie et comment un essai la cherche ; une légende décrit l'étape de l'essai en tête (descente, astres qui se repoussent encore, polissage de Newton) ; chaque rejet est expliqué en clair (polygone de Lagrange, collision, trop serrée, trop complexe pour une machine…) ; une barre suit les quatre étapes du chargement (trajectoire, machine, construction, rendu). Le panneau s'efface pendant le chargement. Au centre, l'essai en tête, sa courbe qui se tortille pendant la descente, déjà parcourue par ses N astres et leur traîne ; dessous, une vignette par essai de la graine : en cours, écarté (la courbe s'éteint, avec la raison : collision, Lagrange, frôlement, trop de bras…) ou trouvé (encadré d'or). L'orbite trouvée reste au centre pendant la construction des machines. Une graine sans orbite passe la main à une autre.

**Cadence.** Les pièces fixes de chaque bras, du plateau et du bâti sont fusionnées par matière (repérées en faisant tourner la machine à trois instants) ; les chaînes dont les pièces sont exactement les mêmes (d'une chaîne à l'autre, un même bras peut être à un autre étage, et ses goupilles, axes et colonnes changent alors de hauteur) sont dessinées par instanciation (une pièce = un dessin pour ces chaînes) ; le troisième monde n'est dessiné que lorsqu'il dépasse quelques pixels (sa miniature le remplace). Une scène de 7 corps à 11 bras passe de 1 250 à 170 objets dessinés par monde et de ~60 à ~14 ms par image. Les matériaux des trois mondes sont compilés pendant l'écran de chargement : aucun gel aux raccords.

**Échecs.** Une recherche sans orbite, un essai qui plante, une recherche de plus de 40 s ou une machine impossible à construire s'affichent sur l'écran de génération, avec trois issues : une autre graine, réessayer, ou revenir à la dernière scène qui marchait.

## Version mobile (`src/app/mobile.js`)

Choisie d'office sur téléphone ou tablette, imposée par `?mobile=1`, ou par la qualité « Mobile » du panneau (rechargement), avec ses propres réglages mémorisés : base 1,25 × CSS ajustée par la résolution dynamique (cible 45 i/s, de 50 à 100 %), 60 i/s au plus, FXAA, bloom en quart de résolution, sans profondeur de champ, traînées ni aberration, astres sans ombre portée, studio en 512, trois workers au plus.

## Le solveur (`src/orbit/`)

**La courbe.** Dans un repère qui tourne à ω autour de z, x(t) = Σₖ Aₖ cos kt + Bₖ sin kt, de période 2π ; le corps j est en R(ωt)·x(t + 2πj/N). Les harmoniques multiples de N sont nulles (centre de masse fixe) : la symétrie choisit déjà les engrenages.

**L'action** (`action.js`). A = ∫ ½|ẋ + ω e_z × x|² + ½ Σⱼ 1/|x(t) − x(t + 2πj/N)| dt, évaluée sur Q points (Q multiple de N, un décalage de corps est un décalage d'indice), avec son gradient exact (vérifié par différences finies à 10⁻⁸ près). Ses points critiques sont les chorégraphies.

**Les classes de symétrie** (`symmetry.js`). En complexe, z(t) = Σ c_k e^{ikt}. La graine impose souvent z(t + 2π/m) = e^{2iπl/m}·z(t) (m pétales identiques : seules les fréquences k ≡ l mod m survivent), et parfois un miroir (c_k réels). L'action étant invariante par ces symétries, un point critique dans la classe est une vraie chorégraphie (principe de criticité symétrique de Palais), et le minimum de la classe est en général un point selle de l'action complète, hors d'atteinte d'une descente libre. Le choix de la classe n'est pas libre : le minimum d'une classe est presque toujours le polygone de Lagrange tournant à sa plus basse fréquence permise kmin… sauf si ce polygone est une collision (kmin et N ont un diviseur commun). Ces classes réussissent dans 100 % des cas, les autres dans 0 à 37 % : on tire les premières (elles n'existent que pour N = 4, 6, 8, 9), et pour N premier une classe à ±1 ou aucune. Passé 12 essais (4 pour une classe faible, où le polygone gagne presque toujours), la classe est abandonnée.

**La descente** (`lbfgs.js`, `search.js`).
1. Une courbe de départ tirée de la graine, dans sa classe : quelques fréquences dominantes, mise à l'échelle optimale (λ³ = P / 2T).
2. Descente sous **force forte** ε/r² décroissante (0,2 → 0,05 → 0,01 → 0), l'astuce de Moore (1993) : aucune collision ne peut être traversée, la courbe garde la tresse de son départ.
3. L-BFGS **préconditionné en 1/k²** (la courbure de l'action croît comme k² : sans cela, le problème est conditionné à ~10⁴ et la descente piétine ; temps divisé par 6).

**Le polissage** (`newton.js`). Newton–Krylov : chaque pas résout H·δ = −∇A par MINRES préconditionné (H symétrique, indéfini, singulier à cause du décalage du temps et de la rotation), produits H·v par différences du gradient exact. Convergence quadratique (le huit en 4 itérations et 6 ms, gradient 3·10⁻¹³) ; on double le nombre d'harmoniques (32, 64, 128) tant que la loi de Newton n'est pas satisfaite. Newton ne quitte pas un point selle, contrairement à une descente.

**Les épreuves.** Une orbite n'est retenue que si :
- le gradient de l'action est quasi nul ;
- les corps ne se frôlent pas (plus courte approche > 3 % de la taille) ;
- ce n'est ni le polygone de Lagrange (une seule harmonique), ni une orbite plus simple parcourue plusieurs fois (pgcd des harmoniques > 1 : c'est ainsi que le huit revenait, parcouru deux fois, action × 2^(2/3)) ;
- **certificat** : le résidu de la loi de Newton le long de la courbe, relatif à l'accélération la plus forte, est < 10⁻⁴.

**La contre-épreuve** (`integrate.js`). Intégration Dormand–Prince 5(4) par **tirs multiples** (24 segments partant chacun de la courbe) : écart de raccord. Une intégration d'un seul tenant ne prouve rien : presque toutes ces orbites sont instables, et la moindre erreur de troncature y est amplifiée d'un facteur 10³ à 10⁸ sur une période. La même méthode donne la **stabilité** : matrice de monodromie (produit des jacobiennes des segments), rayon spectral par puissance itérée.

**Déterminisme.** Les essais d'une graine sont indépendants ; ils sont répartis entre les workers (`client.js`), et le premier essai réussi par ordre d'indice fait foi. Même graine, même orbite, quel que soit le nombre de workers ou le navigateur (vérifié : graines 17 et 22 identiques sous Node et dans Chrome).

## Résultats (banc de 300 graines, `tools/bench.mjs`)

| | |
| --- | --- |
| réussite | 86 % des graines (N = 4, 6, 8, 9 : 98 à 100 % ; N = 3 : 42 %, presque tout y retombe sur le cercle ou le huit) |
| temps par graine, un seul cœur | médiane 0,6 s, p90 2,8 s ; un essai réussi : ~20 ms |
| temps dans le navigateur, 8 workers | de quelques dizaines de ms à ~2 s par orbite |
| certificat | résidu de Newton < 10⁻⁴ ; raccord des tirs p90 ~5·10⁻⁶ |
| variété | 229 orbites distinctes sur 259 ; croisements : médiane 5, p90 21, 109 orbites à 8 croisements ou plus (sans les classes de symétrie : médiane 1, p90 4) |
| engrenages pour 0,2 % de précision | médiane 4 dans une classe de symétrie, 12 sans |
| orbites stables | 61 : 24 sont le huit (redécouvert) ; **37 sont des orbites à 4 corps, dont 36 dans des classes de symétrie, 33 d'actions distinctes** |
| téléchargement | aucun : quelques centaines de nombres calculés sur place |

La stabilité (rayon spectral de la monodromie ≈ 1) a été contre-vérifiée sur 13 de ces orbites par une méthode indépendante : état perturbé de 10⁻⁹, intégré sur 20 périodes. L'écart reste borné et ne croît que linéairement, sans aucune explosion exponentielle. Deux exemples, au moment du banc : **graine 17** (4 corps, étoile à 7 branches bouclées, 14 croisements, 3 engrenages : harmoniques 2, 5, 9) et une rosace à 9 pétales (4 corps, 4 engrenages). Depuis que ω est rationnel, les graines ne donnent plus les mêmes orbites, sauf celles à ω = 0 (la graine 17 est inchangée). Les orbites stables sont réputées rares ; celles-ci sont des **candidates** à comparer à la littérature (Simó, Kapela–Simó, Calleja–Doedel–García-Azpeitia) avant toute annonce.

**Essais sans suite** (gardés dans `search.js`, option `mode`) : la *continuation* (minimum sous force forte suivi par Newton jusqu'à ε = 0) retrouve exactement les mêmes orbites que la descente ; le mode *selle* (Newton directement depuis une courbe aléatoire, à la manière de Simó) trouve d'autres points critiques, mais moins souvent et moins variés (55 % de réussite, 30 familles contre 55). Le levier de la variété n'était pas l'algorithme mais la topologie du départ : d'où les classes de symétrie.

## Ce qui reste à faire

**Scène**
- **Mise en scène, suite** : vue embarquée dans le repère d'un astre ; plans pilotés par les temps forts (couper sur un passage serré) ; anticipation des fondus.
- **La plongée** : entrer dans la boule au moment d'un passage serré (l'embrasement) ; varier la boule visée et la trajectoire d'approche.
- **Matières** : vrai verre (transmission, dispersion) pour le sillage et les gemmes ; les finitions à motifs de la famille (émail grand feu, damas, urushi…).
- **Son** : comme Hollow, avec le spectre de Fourier de l'orbite comme timbre.
- **Supports** : les bras supérieurs restent le plus souvent en porte-à-faux ; une piste serait des chariots sur l'étoile elle-même plutôt que sur le plateau.
- L'export MP4 (touche E) est câblé mais n'a pas encore été essayé de bout en bout.

**Solveur**

- **N premier.** Pour N = 3, 5, 7, aucune classe de symétrie n'exclut le polygone : la variété y reste plus pauvre (N = 3 surtout). Piste : symétries qui mêlent rotation et renumérotation des corps.
- **Familles continues.** Une orbite en repère tournant appartient à une famille continue en ω ; deux graines peuvent tomber dans la même famille à des ω voisins. La variété « à l'œil » est meilleure que ne le dit le compte des familles, mais une vraie déduplication demanderait de suivre les familles par continuation.
- **L'espace.** 0 % en 3D : sans symétrie imposée, la minimisation aplatit toute courbe gauche (dans l'espace, les collisions ne font plus barrière topologique). Piste : classes de symétrie qui excluent les solutions planes (orbites « hip-hop », Ferrario–Terracini) ou continuation depuis les bifurcations verticales du polygone.
- **Nouveauté.** Vérifier les orbites remarquables contre les catalogues existants (surtout fournis pour N = 3 : Šuvakov–Dmitrašinović, Li–Liao). Pour N ≥ 4 en repère tournant, les catalogues sont rares : les orbites stables à 4 corps (graines 17, 22, 139…) sont des candidates, rien de plus tant qu'elles ne sont pas comparées.
