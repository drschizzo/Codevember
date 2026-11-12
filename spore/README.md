# Spore

*le relais.* Sur du bois mort, une génération de myxomycètes (des organismes unicellulaires qui rampent sur le bois puis fructifient comme des champignons) en une boucle. Une poussière de spores se pose et germe en un plasmodium jaune, une cellule géante qui s'étend en réseau pulsant. À l'aube, il se condense en perles, qui se dressent en une forêt de sporanges (de petites capsules à spores sur pied). Ils mûrissent puis s'ouvrent au souffle, et la caméra suit le nuage de spores jusqu'au site suivant, où elles germent à leur tour.

Au début, la caméra arrive en glissant le long du bois et ralentit. Une fumée brune descend en biais et poudre le bois nu. Dans la poudre, des gouttelettes jaunes naissent, gonflent et se rejoignent en une nappe. La nappe s'étend vers l'aval en éventail, et derrière son bord elle se creuse en veines qui battent. La lumière monte, les veines se vident dans des perles alignées, et les perles se dressent sur leurs pieds, blanches, toutes ensemble. Elles foncent et se dessèchent. Un souffle passe, elles s'inclinent et s'ouvrent, et leurs spores partent avec lui. La caméra suit la fumée, laissant à gauche les sporanges vides, et la fumée se pose sur la première image.

![Spore : des Trichia dorés dans leur nuage de spores (graine s9)](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL). Tout est calculé : une graine (un code court) produit toujours la même scène. La démarche (le thème exploré sous six angles, cinq clichés écartés, neuf pistes notées, les épreuves) est dans [docs/concept.md](docs/concept.md). Les défis techniques, avec des démonstrations interactives, sont dans [explainer.html](explainer.html).

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?ui=0`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.spore` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)` (une graine peut s'écrire `graine:décor:famille`), `meter()`, `meters()`, `bench()`, `seam()`, `run()` ; `?sink=…` : adresse du collecteur d'images).

Le panneau règle :
- le décor et la famille (nouvelle scène de la même graine), l'espèce, la durée ;
- la caméra (champ, distance, plongée sur le réseau, hauteur sur la forêt, azimut) ;
- le plasmodium (forme du réseau, μ de Tero, exploration, points de germination, anisotropie, festons) ;
- la fructification (ordre de maturation, densité, étalement, penchant vers la lumière) et le vent (rafales, force, montée des spores) ;
- la lumière, le studio, le fond ;
- le rendu.

Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : la boucle avance d'un site au suivant

À chaque tour, la boucle fait avancer la scène d'un cran. Les spores d'un site germent sur le site suivant, la caméra les suit, et ce qu'elle trouve en arrivant est exactement ce qu'elle a vu au début. Pour cela, le bois se répète à l'identique tous les L = 4,4 cm le long du vent : sa carte de relief est cuite avec un bruit périodique en x (un nombre entier de cellules sur L). Le site j vit son cycle à la phase locale s = u − j :

    état(site j, u) = S(clamp(u − j, 0, 2))

S(0) est le bois nu, S(0 → 1) le cycle (germination, réseau, condensation, forêt, dissémination), S(1 → 2) l'usure des sporanges vides. Les spores du site j se posent sur le site j + 1 à sa phase ~0, et ce sont elles qui germent. La caméra avance de L par boucle (`camera.js` : une vitesse faite d'une dérive et d'une bosse, le voyage). Le monde à u + 1 est donc le monde à u translaté de L, la caméra aussi, et l'image à u + 1 est l'image à u. Dans le cadre, la gauche montre le passé (les sporanges vides, dans le flou), le centre le présent, la droite le bois nu qui attend.

**Une seule horloge** (`timeline.js`) donne ses bornes au jour (la lumière principale baisse la nuit, monte à l'aube), au vent, à la croissance et à la caméra. À l'intérieur d'un temps, chaque grandeur est monotone (testé).

| Temps (part de boucle) | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- |
| les spores se posent (0,90 → 0,05) | le nuage du site précédent | vent moyen intégré, tourbillons, chute de Stokes (≈ 0,3 cm/s) | temps réel |
| germination (0,04 → 0,20) | les spores posées, la nuit | gouttelettes qui croissent et fusionnent | très accéléré |
| le réseau (0,10 → 0,42) | le front qui avance | adaptation de Tero, navette péristaltique | accéléré |
| condensation (0,42 → 0,52) | l'aube : la lumière monte | perles le long des veines, volume conservé | accéléré |
| la forêt se lève (0,48 → 0,62) | les perles | pied sécrété, tête formée | accéléré |
| maturation (0,58 → 0,74) | le jour, le séchage | couleur, vernis qui s'éteint | accéléré |
| dissémination (0,74 → 0,93) | le souffle (les têtes s'inclinent) | flexion d'une poutre encastrée, geste de la famille | temps réel |
| le voyage (0,84 → 1,04) | le nuage | — | temps réel |

## Le plasmodium (`src/gen/plasmodium.js`)

1. **Germination et front.** Les spores posées germent à des instants tirés. L'instant d'arrivée du plasmodium T(x, z) est une distance de Dijkstra multi-sources sur une grille de 0,11 mm à seize voisins (avec huit, les fronts seraient des octogones). Le pas est anisotrope (le front court plus vite le long du fil du bois), la vitesse modulée par un bruit (les festons), la distance bornée à un territoire au bord bruité et remappée pour que le front ralentisse en fin de course. La nappe est une courbe de niveau de T, si bien que son bord reste net à toute distance.
2. **Le réseau de Tero** (Tero et al., 2007) sur un treillis triangulaire de 0,45 mm qui couvre le territoire. À chaque pas, le protoplasme part du corps (les nœuds âgés) vers quelques nœuds tirés au front. Pressions par Kirchhoff, Σ_j D_ij/l_ij (p_i − p_j) = b_i (gradient conjugué préconditionné, bilan nul dans chaque composante connexe : les gouttelettes avant leur fusion), flux Q = D/l Δp, puis dD/dt = f(|Q|) − D avec f(q) = q^μ/(1 + q^μ). Les tubes traversés s'épaississent et les autres s'effacent. μ ≈ 1,8 donne un arbre, μ ≈ 1 des mailles. Quand le front s'arrête, les puits sont tirés au bord (exploration). Rayon des veines par Poiseuille (D ∝ r⁴). Enregistré en 32 instantanés, relus dans le vertex shader.
3. **La condensation.** Les perles (futurs sporanges) sont placées selon l'espèce : en grappes autour des nœuds les plus chargés (*Arcyria*), en touffes (*Stemonitis*), le long des veines à l'espacement de Plateau-Rayleigh (λ ≈ 9 r ; *Lamproderma*, *Comatricha*), ou nulle part (*Hemitrichia* : les veines maîtresses deviennent le fruit). Chaque veine verse son volume à la perle la plus proche (Σ perles = réseau, testé), et se vide d'autant plus tôt qu'elle en est loin. Pour que deux têtes ne se traversent pas, une perle trop proche d'une autre y est fondue, ou à défaut les deux rétrécissent juste assez.

À l'écran (`scene/plasmodium.js`), la nappe est un gel jaune translucide qui remplit les creux du bois (sa surface suit le bois lissé, jamais sous le bois), épaisse au front (0,28 mm), film de 50 µm derrière, striée de canaux dans le sens de l'avancée. Les veines sont des tubes posés, à section en demi-ellipse, lissés le long de chaque brin. Des granules coulent dans le sens du flux et une onde péristaltique court de l'arrière vers le front (Alim et al., 2013).

## Les sporanges (`src/gen/sporangia.js`, `src/fruit.js`, `scene/sporangia.js`)

Un gabarit usiné par espèce (solides fermés : hypothallus, pied évasé, calice à lèvre roulée, péridium, capillitium, columelle), dans sa forme mûre. Le vertex shader le replie en perle (sphère de même volume), le dresse (le pied s'allonge, la tête prend forme), l'ouvre selon la famille, le fléchit sous le vent (poutre encastrée chargée en bout, ∝ U²) et le pose sur la même surface de bois que tout le reste. L'état de chaque sporange (perle, levée, maturité, ouverture, usure, flexion) est calculé par une seule fonction (`fruitState`) sur le CPU et envoyé au GPU dans des tableaux d'uniformes (courant et précédent : vecteurs vitesse).

**Les familles et leurs gestes :**
- ***Arcyria*** : des coupes serrées. À l'ouverture, le haut du péridium tombe et le filet comprimé se détend vers le haut (2 à 3,6 fois sa hauteur, avec un rebond), ses mailles s'ajourent. *A. obvelata* retombe.
- ***Stemonitis*** : de hautes colonnes en touffes qui plient sous le souffle et fument. La masse de spores s'amincit du sommet vers le pied et laisse la cage claire autour de la columelle. *Comatricha* pousse en semis le long des veines.
- ***Hemitrichia*** : sans pieds, le réseau lui-même devient le fruit. Les veines maîtresses gonflent en tubes dorés et les petites se vident en elles. Mûrs, les tubes se fendent et moussent d'élatères.
- ***Lamproderma*** : des sphères sur pieds fins, iridescentes (interférences dans une couche mince, Inchaussandague et al., 2010). Le péridium s'écaille en plaquettes qui tombent, la masse sombre s'effrite.
- ***Trichia*** : des toupies dorées et luisantes. Le péridium se fend en plaques et les élatères jaillissent en houppe ronde, deux fois plus large, que le vent peigne.
- ***Lycogala*** : des coussins sans pied, corail puis gris rosé. Le sommet se perce, chaque rafale aspire une bouffée par l'ouverture, et le coussin se dégonfle.

**La rosée** : dans les décors humides, des gouttelettes se posent à l'aube sur les perles qui montent (elles font partie du gabarit et suivent la tête quand elle se replie) et sèchent pendant la maturation. Noires et brillantes, elles portent la tache de lumière réfractée du côté opposé au soleil.

## Le nuage (`src/gen/smoke.js`, `scene/smoke.js`)

**Une simulation de fluide.** Une grille 3D de cellules de 1 mm (71 × 25 × 29) couvre le site et l'aval jusqu'au site suivant. L'air y suit les équations d'Euler incompressibles, résolues par la méthode de Stam (« Stable Fluids », 1999) : forces, advection semi-lagrangienne, projection (pression par Jacobi, repartie de la précédente). Le bois est un obstacle.
- **Le vent du lieu** : profil logarithmique de couche limite au-dessus du bois, rappelé vers la vitesse du souffle de l'horloge. Des tourbillons passent avec lui (forçage à divergence nulle, tables séparables), et le confinement de vorticité (Fedkiw et al., 2001) garde les volutes.
- **L'émission** : chaque tête verse dans l'air exactement ce qu'elle perd en s'ouvrant, avec une impulsion propre à la famille. Chez *Lycogala*, chaque rafale aspire une bouffée par l'ouverture (débit ∝ U², effet Venturi).
- **La chute et le dépôt** : la concentration est transportée par l'air et par la chute de Stokes (v_s = 0,3 (d / 10 µm)² cm/s, d selon l'espèce, de 6 à 13 µm). Le flux ρ·v_s qui traverse la surface du bois quitte l'air et s'ajoute à une carte de dépôt, la poussière que le plasmodium suivant traverse et absorbe.
- **Le bilan** : émis = en l'air + déposé + sorti, exact (l'advection, non conservative, est renormalisée à chaque pas d'après ce bilan). Typiquement, 45 à 95 % du nuage se dépose, le reste quitte le domaine par l'aval ou par le haut.
- **Les grains** : 6 000 spores suivies une à une dans le même champ (Runge-Kutta 2), qui se posent là où la poussière se dépose. Chaque germination du site suivant est la chute d'un grain : le grain qui tombe le plus près de chaque point de germination (translaté de L) y est mené exactement, par une correction appliquée pendant son vol.
- Calculé une fois dans le worker (126 pas, ≈ 2,5 à 3 s), enregistré en 64 images (densité, transmission vers le soleil, vitesse, dépôt cumulé, positions des grains), et le centre de masse du nuage, que la caméra suit pendant le voyage.

**Le rendu.** Une boîte resserrée à chaque image autour de la fumée visible (calculée par le worker) où chaque pixel marche le long de son rayon (22 pas, départ tramé lissé par l'anticrénelage temporel), jusqu'à la surface opaque la plus proche (profondeur de la scène). Entre deux images, la densité est interpolée avec compensation de mouvement (chaque image est lue là où la vitesse enregistrée amène la fumée), si bien qu'elle glisse au lieu de se fondre d'une image à l'autre. Un bruit de détail (deux canaux du volume de bruit), entraîné par le vent, érode les bords. Lumière : diffusion simple (Henyey-Greenstein, g = 0,55, le nuage s'allume à contre-jour), ombre propre précalculée par image le long de la direction du soleil, ambiance qui imite la diffusion multiple, albédo clair teinté par le pigment des spores. Les grains, relus en Catmull-Rom, sont des points d'un demi-pixel au moins, d'opacité égale à leur couverture réelle.

## Le bois (`src/gen/wood.js`, `scene/wood.js`)

Un relief de 1 024² texels sur une période (43 µm × 51 µm par texel), cuit dans un worker, lu deux fois : en déplacement vertical d'un maillage dense du dessus de la bûche (cylindre de 6,5 cm de rayon, plus dense au sommet) et en normal map, avec un micro-relief procédural pour le gros plan, une hauteur lissée (le niveau du gel) et l'occlusion des creux. Tout le bruit est périodique en x.
- **bois flotté** : le fil relevé par l'érosion (cernes d'été debout, bois de printemps creusé), fibres, gerces effilées ;
- **tronc gris** : id., plus de gerces, fibres arrachées par plaques ;
- **charbon** : une croûte en Voronoï anisotrope fortement déformé (plus large en travers du fil), dessus bombés luisants, fentes fines secondaires ;
- **pourriture cubique** : petites cellules, fibres, humide ;
- **bois échauffé** : lignes noires de zone (une courbe de niveau), une teinte par zone ;
- **cèdre débité** : cernes en cathédrales (courbes de niveau de la distance au cœur, qui s'enfonce et remonte le long de la planche), traits de scie, rayons.

## Les décors

Le fond est neutre : un dégradé (plus clair à l'horizon) et le halo du soleil dans sa direction, qu'on voit à contre-jour. La brume prend la teinte du lieu. Chaque décor se distingue par son bois, sa lumière, sa valeur et son cadrage. **Le support** change toute la composition : une bûche presque plate (rayon 6,5 cm) qui file vers l'horizon, une branche (2,1 cm) dont le dos se détache sur le fond, un rameau (1,05 cm) vu de profil, la forêt en crête sur sa ligne.

| Décor | Support | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Grève | bois flotté | soleil rasant et dur | très claire, fond pâle | plongée |
| Brûlis | bois carbonisé | douce d'en haut, fort contre-jour | très sombre, fond noir | ras du bois |
| Humus | bois pourri mouillé | lampe frontale, la nuit | sombre, flaque de lumière | rapproché, plongeant |
| Brume | tronc gris | brouillard laiteux à contre-jour | claire et douce | contre-jour rasant |
| Sous-bois | bûche échauffée | ciel couvert, de côté | moyenne | trois-quarts |
| Cèdre | planche de cèdre | soleil bas de trois-quarts arrière | contrastée, fond sombre et chaud | contre-plongée légère |

**La caméra** voyage avec le vent : elle s'attarde au-dessus du site (dérive lente) en plongée sur le réseau, descend au ras du bois quand la forêt se lève (sa distance passe à l'échelle des sporanges), puis suit le centre de masse du nuage (calculé par la simulation) jusqu'au site suivant. Trajectoire échantillonnée, partie périodique lissée par un noyau gaussien périodique (σ = 0,8 s), relue en Catmull-Rom. La translation est ajoutée ensuite, exacte.

## L'écran de chargement

Le plasmodium de la scène pousse en direct, calculé dans le worker du chargement par le vrai modèle, en plus petit : les spores tombent et germent, le front s'étend, le réseau de Tero s'organise (un pas de Kirchhoff par image). Quand la scène est prête, le réseau se vide en perles.

## Tests

```bash
node --test spore/test/*.test.mjs
```

La boucle (la caméra à u + 1 est la caméra à u translatée de L) ; la caméra lente et lisse (pointe < 25°/s, accélération bornée à 120 i/s), y compris quand elle suit le nuage ; Kirchhoff et conservation des volumes du réseau aux perles ; le front qui couvre le territoire avant l'aube ; chaque germination part d'un grain posé par le nuage du site précédent ; le nuage : bilan de masse exact, dépôt qui ne décroît jamais, grains jamais sous le bois ; la projection rend le champ (presque) sans divergence ; l'horloge monotone (le jour boucle, l'aube monte, le soir baisse, le souffle précède l'ouverture) ; les têtes ne se traversent pas ; les gabarits sont orientés (chaque triangle tourne sa face avant du côté de ses normales) ; la recette déterministe et JSON ; les décors différents par le support, la lumière et la valeur ; les lampes presque blanches ; six familles aux gestes distincts ; la variété sur 400 graines (décors, familles, supports, réseaux, ordres).

## Performances

Génération d'une scène : ≈ 5 à 8 s dans le worker du site (front et réseau de Tero ≈ 1,5 à 2,5 s, nuage ≈ 2,5 à 3 s : 126 pas de Stable Fluids sur 51 k cellules, 6 000 grains, 64 images, ombre propre), le bois (0,4 à 1 s) en parallèle. Ces temps sont mesurés dans Node, et nettement plus longs quand l'onglet est en arrière-plan. Temps d'image mesuré dans le panneau de navigateur de l'application (GPU d'un Mac, panneau masqué), qualité Haute, ≈ 1,8 Mpx, graine s9 : 11,3 ms pendant le réseau, 15,8 ms quand le nuage occupe l'écran (marche de rayons de 22 pas dans la boîte resserrée ; elle coûtait 64 ms avec 48 pas dans toute la boîte). Les autres postes lourds : le maillage déplacé du bois (≈ 390 k sommets) et les veines (60 k à 220 k sommets).

## Version mobile

Imposée par `?mobile=1`, ou choisie d'office sur téléphone : bois cuit en 640², maillage plus lâche, 2 500 grains, nuage en 14 pas à trame fixe, chaîne d'image allégée (sans profondeur de champ), résolution dynamique. Mesurée dans le navigateur de l'application : 6,5 ms par image à 1,2 Mpx avec le nuage à l'écran, console propre. Pas vérifiée sur un appareil réel.
