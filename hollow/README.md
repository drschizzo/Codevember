# Hollow

Une plongée sans fond. Des coquilles creuses s’emboîtent les unes dans les autres. La caméra traverse chacune par son oculus, une ouverture ronde au sommet, et découvre la suivante, toujours différente, jusqu’à retrouver la première : la boucle est parfaite par construction. Au centre, un cœur de lumière dont les rayons filtrent à travers les ajours.

Rendu physique en three.js (WebGPU, TSL). Scène entièrement procédurale : une graine produit une scène, et l’on peut en générer autant que l’on veut.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| S | son / silence |
| H | masquer l’interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l’interface (le panneau reste replié au démarrage).

Paramètres d’URL : `?seed=…` (une scène), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?mobile=1` / `?mobile=0` (version mobile imposée / interdite), `?debug` (outils de mesure dans `window.hollow`, dont `view(couche, x)` : une couche à une profondeur donnée, en image fixe).

Le panneau règle :
- graine et humeur ;
- boucle (durée, plongée ou profondeur fixe) ;
- nid (rapport entre couches, taille du cœur, brouillard) ;
- caméra ;
- lumières (cœur, lampe frontale, studio HDR) ;
- chaque couche (type, forme, matériaux des trois faces, mouvement) ;
- le rendu (qualité, anticrénelage, ombres, détail, tone mapping, bloom, rayons, occlusion, flou de mouvement, profondeur de champ, aberration chromatique, grain).

L’export produit une boucle MP4 (H.264) rendue image par image à la résolution et à la cadence choisies, et une image PNG.

## Principe

**La plongée.** La caméra reste à distance fixe du centre, et ce sont les coquilles qui grossissent et passent à travers elle, ce qui donne l’impression de tomber. Chaque couche a pour rayon une fraction fixe de celui de la précédente. Une coquille à la profondeur relative *x* a pour rayon D·kˣ (D : distance de la caméra, k : rapport entre couches), avec *x* = *d* − τ, où *d* est l’indice de la couche et τ l’avancée. La couche *d* utilise le modèle *d* mod N : la scène à τ + N est donc identique à la scène à τ. Taille, éclairage, brouillard, niveau de détail et ombres ne dépendent que de *x*, ce qui supprime toute couture.

**Le passage.** Chaque coquille a un oculus sur son pôle +z. Elles culbutent pendant leur remontée et se stabilisent, oculus face à la caméra, à l’approche du passage (seule la rotation autour de l’axe de visée reste libre). La lampe frontale, solidaire de la caméra, franchit les oculus avec elle. Aucune coquille ne change donc jamais de côté par rapport à elle, et ses ombres ne sautent jamais.

**Les instances.** Chaque coquille visible est une instance d’un modèle. Une instance garde sa couche d’une boucle à l’autre (phase « déroulée »), et une instance qui réapparaît a un vecteur vitesse nul à sa première image : sans cela, le flou de mouvement et l’anticrénelage temporel produisent un éclair. Toutes les coquilles rendues projettent l’ombre des deux lumières, et aucune ne cesse d’en projeter en cours de route.

**Le chargement.** Chaque couche demande tous ses niveaux de détail (et ses cristaux) en même temps et bascule d’un coup quand le dernier arrive : on ne voit jamais une forme se transformer. Une nouvelle scène reste derrière un écran de chargement (avec sa progression) jusqu’à ce que toutes ses couches soient prêtes et que quelques images aient été rendues.

**Les niveaux de détail.** Trois niveaux affichés, choisis selon la taille de la coquille à l’écran en pixels. Tous sont biseautés, si bien que rien n’apparaît ni ne disparaît d’un niveau à l’autre. Un quatrième, grossier et à arêtes vives, ne sert qu’aux cartes d’ombre.

**Le halo du cœur.** Près du cœur, les coquilles baignent dans sa lumière (une émission qui ne dépend que du rayon). Elles sont affichées dès l’intérieur du cœur, qui les cache, et en émergent fondues dans le rayonnement : la naissance d’une couche ne se voit jamais.

**Les pièces animées.** Diaphragmes, éclats, écailles et anneaux sont des pièces rigides du maillage. Chaque sommet porte un pivot, un axe, une amplitude et une nature (`rigA`, `rigB`), et le vertex shader applique la rotation et la translation, qui ne dépendent que de la profondeur relative *x* de la coquille et de la phase (`src/scene/rig.js`). La carte d’ombre subit la même déformation. Les motifs des matériaux restent attachés aux pièces (position au repos).

**La chorégraphie.** Chaque passage d’oculus a sa propre respiration, de durée variable : ralenti plus ou moins appuyé, passage filé ou accélération. Le temps de la scène s’écrit τ = t − Σ a·w·K((t − k)/w), avec K(x) = x − 3x³ + 3x⁵ − x⁷, dont la dérivée (1 − 7x²)(1 − x²)² est d’intégrale nulle. La vitesse reste positive et continue, et chaque passage tombe sur un entier. Le champ s’ouvre un peu dans les ralentis.

**La naissance au cœur.** Les coquilles naissent dans le cœur lumineux. Pour que la lumière du cœur ne saute pas quand une nouvelle coquille commence à faire de l’ombre, celle-ci « pousse » dans la carte d’ombre : ses barreaux s’y élargissent progressivement depuis leur axe (masque d’ombre sur la proximité du bord), entièrement à l’intérieur du cœur.

## Géométrie (`src/gen/`, dans des Web Workers)

- **Alvéoles** : dual d’une icosphère géodésique (cellules de Goldberg), désordre réglable, centres écartés du pôle pour former l’oculus.
- **Voronoï** : pavage de Voronoï sphérique exact (enveloppe convexe incrémentale des germes), germes en spirale de Fibonacci, en bruit bleu ou à densité graduée.
- **Fentes** : grille latitude × longitude, éventuellement en spirale (les arêtes partagées entre rangs décalés sont subdivisées des deux côtés).
- Chaque cellule est percée d’un trou. Son contour est rétréci de la demi-largeur du barreau (barreaux d’égale largeur), arrondi (polygone → cercle), puis découpé selon une forme : ellipse orientée (jusqu’au tourbillon), étoile, diaphragme. Les trous traversent une épaisseur réelle, avec biseau arrondi ou chanfrein plat, éventuellement un chambrage (trou à épaulement). Biseau et épaulement sont réduits localement là où ils se replieraient (limites lissées le long du bord).
- Le bord du trou est une courbe exacte (polygone arrondi par somme de Minkowski, congé lisse avec la forme), rééchantillonnée selon la longueur d’arc et la courbure : chaque pointe et chaque congé reçoivent les points qu’il leur faut. Biseau, paroi et épaulement en sont des décalages le long de la normale exacte. Les faces suivent des colonnes normales au bord, cousues au contour de la cellule (partagé avec la voisine) par fusion d’angles. Aucun triangle nul, retourné ou en aiguille.
- Détails usinés : barreaux bombés, rivets aux jonctions, gravure qui suit le contour des trous (dans le matériau). Maillage étanche, trois niveaux de détail. La normale de la tranche (biseaux, parois, épaulements) est recalculée à chaque pixel à partir de l’angle du profil : les biseaux sont parfaitement ronds, sans diagonale de quadrilatère dans les reflets.
- **Surfaces minimales** (gyroïde, Schwarz P, diamant, Neovius, I-WP, Fischer–Koch) taillées dans la coquille, en feuille ou en réseau : surface nets, reprojection sur la surface (gradient analytique, fausse position), relaxation des sommets, congés par maximum lisse, alésage de l’oculus. Dans le shader, leur normale est recalculée à chaque pixel à partir du champ, et les reflets ne trahissent pas la triangulation.
- **Géode** : peu d’ouvertures, larges et irrégulières ; druse de cristaux prismatiques sur la face interne, jamais dans un trou.
- **Moucharabieh** : entrelacs étoilés construits par la méthode de Hankin sur les alvéoles (rayons inclinés de l’angle de contact au milieu de chaque arête). Chaque cellule est redécoupée en polygone central, pointes d’étoile et cerfs-volants, tous convexes, percés comme n’importe quel pavage.
- **Éclatée (kintsugi)** : Voronoï fêlé en éclats, chacun bordé d’une paroi de cassure dorée et séparé de ses voisins par un joint fin. Les éclats sont écartés et tournés au fond, réassemblés au passage.
- **Sphère armillaire** : lunette d’oculus cloutée, anneau austral et méridiens fixes ; équateur gradué, tropiques et écliptiques qui tournent autour de l’axe de l’oculus (jamais à travers) ; perles-planètes. Rubans balayés à section arrondie (`sweep.js`).
- **Écailles** : plaques bombées en phyllotaxie, articulées sur leur bord haut, qui respirent (plus ouvertes près du cœur, une onde descend du pôle).
- **Vannerie** : deux familles de rubans tressés dessus-dessous (soulèvement en cosinus, alterné d’un croisement au suivant), coupés au bord de l’oculus sous une lunette.
- **Radiolaire** : barreaux larges et bombés, épines aux jonctions. Les barreaux sont percés de pores (Worley dans le shader, sur les deux faces et dans la carte d’ombre), qui font des points de lumière sur la couche suivante.
- **Corail de Turing** : réaction-diffusion de Gray-Scott simulée sur une icosphère (corail cerveau, labyrinthe, vers, taches, mitoses), lue par interpolation exacte sur le réseau triangulaire, taillée dans la coquille et maillée comme les surfaces minimales.
- **Vitrail** : moucharabieh ou alvéoles aux plombs fins, un verre teinté et martelé dans chaque trou. Rétroéclairé par le cœur, il projette une ombre colorée (ombres transmises de three.js).
- **Ornements** : diaphragme de l’oculus (lames spiralées qui se recouvrent en tuiles, ouverture cherchée pour dégager tout le trou), rivets ou pierres taille brillant serties dans des chatons, épines. Pierres, épines et cristaux sont des instances.

## Matériaux (`src/scene/materials.js`)

Trois finitions par coquille (face externe, face interne, tranche), choisies parmi une quarantaine : métaux au F0 mesuré (laiton, or, cuivre, titane, chrome…), émail craquelé, porcelaine, biscuit, velours, carbone sergé, nacre, obsidienne, basalte, druse, agate, verres. Le modèle physique est exploité en entier : vernis et sa propre normale, lustre, irisation à épaisseur variable, anisotropie (brossage circulaire), transmission avec dispersion et absorption, usure des bords révélant la tranche.

Anticrénelage spéculaire (Kaplanyan) : là où la normale varie vite d’un pixel à l’autre, le lobe spéculaire s’élargit au lieu de scintiller. Le relief s’annule à la frontière entre deux finitions.

Les motifs sont procéduraux sans calculer de bruit : ils échantillonnent un volume de bruit périodique (Perlin ×2, Worley F1 et F2−F1) précalculé au démarrage. Chaque pixel n’évalue que la finition de sa face. Les reliefs sont atténués à l’approche de la fréquence des pixels.

Métiers d’art : émail grand feu sur guilloché (vernis plat sur sillons « grain d’orge »), acier damassé, marbres de Carrare et Nero Marquina, laque urushi saupoudrée d’or (paillettes métalliques en nuées), céramiques, film de savon (irisation qui coule en boucle). Dans l’humeur Abysses, les tranches sont phosphorescentes : des fronts de lumière partent du cœur.

## Scène

- **Humeurs** : Atelier, Studio, Écrin, Nuit, Pastel, Irisé, Clinique (porcelaine sur cyclorama blanc, où la profondeur se perd dans le blanc), Abysses (cœur cyan, tranches phosphorescentes), Sacré (or, émail et vitraux, brouillard d’encens). Chaque humeur favorise ses jeux de matériaux et ses pièces d’exception.
- **Cœur** : étoile avec sa couronne, perle de lumière irisée, ou gyroscope (trois anneaux qui tournent autour de la source et dont les ombres balaient les coquilles).
- **Poussière d’or** : des paillettes métalliques en suspension, entraînées par la plongée (même loi que les coquilles), éclairées par le cœur et prises dans ses ombres.
- **Objectif** : traînées anamorphiques, halation, poussière sur la lentille, en plus du bloom, des rayons, de la profondeur de champ et de l’aberration chromatique.
- **Son** (`src/app/sound.js`) : nappe de l’humeur dont le filtre respire avec la boucle, cloche à chaque passage d’oculus, cliquetis d’horlogerie à l’ouverture des diaphragmes, réverbération de nef.

## Organisation

Un type de couche se déclare à un seul endroit, `src/types.js` (tirage de la forme, réglages du panneau, jeux de matériaux préférés). S’il a son propre maillage, son constructeur s’inscrit dans `src/gen/worker.js`. Les tampons de maillage (`gen/mesh.js`), les rubans balayés (`gen/sweep.js`), le diaphragme (`gen/iris.js`) et les ornements (`gen/jewels.js`) sont partagés par tous les constructeurs.

## Performances

Toutes options actives, ≈ 11 ms par image à 1× (≈ 1,1 Mpx) et ≈ 23 ms à 2× selon les scènes (le verre transmissif est le plus coûteux). La qualité « Haute » rend à 1,5×. Les cartes d’ombre ne voient que des maillages simplifiés (calques dédiés), et celle du cœur n’inclut que les coquilles situées entre lui et la caméra. La géométrie est générée hors du fil principal, en parallèle, avec cache.

## Version mobile

Choisie d’office sur un téléphone ou une tablette (écran tactile et petit écran), imposée par `?mobile=1`, ou par la qualité « Mobile » du panneau (la page se recharge, car les matériaux sont compilés autrement). Elle a ses propres réglages mémorisés. Ce qui change, du plus au moins coûteux :

- **Résolution** : base 1,25 × CSS au lieu des 3 × d’un téléphone (≈ 6 fois moins de pixels), puis *résolution dynamique*. La taille de rendu suit le temps d’image mesuré (cible ≈ 45 i/s) entre 50 et 100 % de cette base, par paliers, avec un plafond mémorisé pour ne pas osciller. Cadence plafonnée à 60 i/s (écrans 90 / 120 Hz).
- **Chaîne d’image** : une seule cible de scène (ni normales ni vecteurs vitesse, donc plus de MRT), FXAA au lieu de l’anticrénelage temporel, ni occlusion ambiante ni flou de mouvement. Rayons du cœur et bloom en quart de résolution (18 pas de raymarching au lieu de 48). Ni traînées anamorphiques, ni poussière sur la lentille, ni aberration chromatique. Étalonnage, halation et grain restent dans la passe finale.
- **Ombres** : cube du cœur en 512. La lampe frontale ne projette plus d’ombre : elle est presque à l’œil, et son ombre se cache derrière ce qui la projette. Cela fait une passe d’ombre de moins.
- **Matériaux** :
  - Worley lu dans le volume de bruit (canaux F1, F2 − F1) au lieu de 27 cellules évaluées par pixel (martelé, émail, basalte, pores) ;
  - fBm limité à deux octaves ;
  - verre, cristaux et vitraux en verre composité, teinté, plus opaque de biais (Fresnel), au lieu de la transmission physique (copie de l’image et mipmaps à chaque image, objets rendus deux fois) ;
  - pierres serties en cabochons opaques à feu irisé ;
  - normale des surfaces minimales par différences avant (4 évaluations du champ au lieu de 6).
- **Géométrie** : le niveau de détail le plus fin n’est jamais généré (seuils de détail à 0,6) ; quatre fois moins de paillettes d’or, un peu plus grandes ; sphères du cœur et anneaux allégés ; studio HDR en 512 × 256 ; trois workers au plus.
