# Planétaire v2 : Chorégraphies

Un planétaire est une machine qui calcule le ciel. Celui-ci calcule des ciels qui n'existent pas encore : chaque graine lance la recherche d'une **chorégraphie** du problème à N corps, N masses égales qui se poursuivent sur une même courbe fermée (le huit de Moore, Chenciner et Montgomery en est la plus célèbre). Plus tard, l'orbite trouvée deviendra un mécanisme à engrenages : une série de Fourier est un train d'épicycles, et chaque harmonique k est une roue de rapport entier.

**État : première scène 3D** (three.js WebGPU / TSL) sur le solveur ; la page de test du solveur reste dans `proto/`.

## Lancer

```sh
python3 -m http.server 8040        # dans planetaire_v2/
# → http://localhost:8040/          la scène (?seed=…, ?period=10, ?debug)
# → http://localhost:8040/proto/    le solveur seul (?seed=…, ?gallery)
node tools/bench.mjs 0 300 sortie.json   # banc d'essai : 300 graines en parallèle
```

Touches de la scène : **N** nouvelle orbite · **Espace** pause · **← / →** pas à pas · **E** vidéo MP4 de la boucle · **P** image · **H** masquer · **F** plein écran.
Touches du prototype : **N** nouvelle graine · **R** repère tournant / fixe · **G** galerie de 12 graines.

## La scène (`src/main.js`, `src/scene/`)

**Le plateau tourne.** Une orbite trouvée dans un repère tournant à ω est une vraie solution dans le repère fixe. On la montre ainsi : un plateau de bronze, sur un pied, tourne à ω comme une platine ; sur le plateau, la courbe de la chorégraphie est fixe, et les astres la parcourent. Vus du studio, ils suivent exactement la solution newtonienne. ω est rationnel (p/q, q ≤ 5) : après q périodes, le plateau a fait p tours et tout revient, ce qui donne une **boucle parfaite** (vérifiée : écart < 10⁻⁷ entre le début et la fin, astres, plateau, caméra et verre compris). Une période dure 10 s (`?period=`), la boucle q × 10 s.

**La machine de Fourier** (`epicycles.js`, `machine.js`). La courbe z(t) = Σ c_k e^{ikt} est une somme de cercles : pour chaque astre, une chaîne de bras de longueurs |c_k| qui tournent aux vitesses entières k par rapport au plateau (on garde les plus longs jusqu'à 0,3 % de la taille de l'orbite, 8 au plus). Une roue dentée à chaque pivot rend le rapport lisible : plus k est grand, plus elle a de dents. Les N chaînes sont identiques, déphasées d'un N-ième de période, et étagées pour ne jamais se toucher ; une goupille d'acier porte l'astre au bout de la chaîne. Dans les classes de symétrie, deux ou trois bras suffisent souvent.

**Le verre filé** (`orbit3d.js`). Un seul tube, fixe sur le plateau, suit toute la courbe. Au point d'abscisse s, le dernier passage d'un astre date de fract(N·(φ − s)) / N période : la chaleur se calcule dans le shader à partir de la seule phase φ. Le verre rougeoie derrière l'astre, refroidit (couleur de corps noir, puis fil de verre sombre et brillant), et l'astre suivant arrive pour le ranimer. Le verre encore mou est un peu plus épais.

**Les astres.** Un cœur incandescent et une lumière ponctuelle chacun (ombres portées pour les trois premiers) : leurs flaques de lumière et les ombres des bras balaient le plateau.

**Le studio.** Sol de velours, pied et socle de laiton, lampe principale (ombres), contre-jour froid, environnement HDR calculé (celui de Hollow, « Atelier »). Chaîne d'image de Hollow : bloom, halation, traînées, poussière sur la lentille, étalonnage, AgX, grain, SMAA.

**La mise en scène** (`choreo.js`). Tout est fonction de la seule phase L de la boucle :
- *Les ralentis.* Le temps de l'orbite est déformé autour des passages serrés (plus courtes approches entre deux astres) avec le noyau de Hollow, τ(t) = t − Σ a·w·K((t − t_b)/w), K(x) = x − 3x³ + 3x⁵ − x⁷ : la vitesse tombe à 1 − a au passage, se rattrape de part et d'autre, et le temps total de la boucle est conservé. Par symétrie, un passage serré revient N fois par période : c'est une **pulsation dictée par la physique** (au plus ~4 temps par période), dont la graine choisit les accents (forts, faibles, quelques silences). La vitesse du temps reste entre ~0,3 et ~1,4.
- *Le temps double.* La caméra vit en temps réel : pendant un ralenti, le monde ralentit, pas elle ; le champ s'ouvre un peu. Les astres s'embrasent quand ils en frôlent un autre (cœur et lumière jusqu'à ~2,8 fois plus vifs).
- *Les plans.* Une suite de plans tirée de la graine, un toutes les ~6 s : **ensemble** (légère plongée), **rasant** (à hauteur du plateau, les astres en rangée de lanternes), **zénith** (la courbe comme un dessin), **astre** (on en suit un de près), **machine** (contre-plongée sur les roues). Fondus en coordonnées sphériques (azimut par le plus court chemin, élévation, distance, cible) : la caméra tourne autour de la machine sans la traverser. Les azimuts de départ sont répartis pour que la suite se referme sur un nombre entier de tours (sans saut à la couture). Profondeur de champ : mise au point sur la cible du plan.
- Mesuré sur six graines : couture < 10⁻¹¹, vitesse de caméra ~0,6 unité/s en moyenne, 2,2 au plus (pendant un fondu).

**L'écran de génération** (`app/loader.js`). Pas de barre de progression : on regarde la recherche, les courbes des essais en cours qui se tortillent puis se posent sur une solution. Une graine sans orbite passe la main à une autre.

**Cadence.** ~120 images/s en 1920 × 1080 (Mac, Chrome) ; aucune ressource téléchargée hors three.js et les polices.

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
- **Cadence** avec la profondeur de champ : à mesurer de nouveau (le panneau du navigateur était masqué pendant les essais, ce qui suspend l'animation).
- **Matières** : vrai verre (transmission, dispersion) pour le sillage et une coque autour des astres ; plateau guilloché ou gravé de la courbe ; vraie denture engrenée entre roues voisines ; finitions et humeurs tirées de la graine (les quarante finitions de la famille).
- **Panneau, son, version mobile** : comme les autres projets (et le spectre de Fourier de l'orbite comme timbre).
- L'export MP4 (touche E) est câblé mais n'a pas encore été essayé de bout en bout.

**Solveur**

- **N premier.** Pour N = 3, 5, 7, aucune classe de symétrie n'exclut le polygone : la variété y reste plus pauvre (N = 3 surtout). Piste : symétries qui mêlent rotation et renumérotation des corps.
- **Familles continues.** Une orbite en repère tournant appartient à une famille continue en ω ; deux graines peuvent tomber dans la même famille à des ω voisins. La variété « à l'œil » est meilleure que ne le dit le compte des familles, mais une vraie déduplication demanderait de suivre les familles par continuation.
- **L'espace.** 0 % en 3D : sans symétrie imposée, la minimisation aplatit toute courbe gauche (dans l'espace, les collisions ne font plus barrière topologique). Piste : classes de symétrie qui excluent les solutions planes (orbites « hip-hop », Ferrario–Terracini) ou continuation depuis les bifurcations verticales du polygone.
- **Nouveauté.** Vérifier les orbites remarquables contre les catalogues existants (surtout fournis pour N = 3 : Šuvakov–Dmitrašinović, Li–Liao). Pour N ≥ 4 en repère tournant, les catalogues sont rares : les orbites stables à 4 corps (graines 17, 22, 139…) sont des candidates, rien de plus tant qu'elles ne sont pas comparées.
