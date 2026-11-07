# Hollow

Une plongée sans fond. Des coquilles creuses s’emboîtent les unes dans les autres ; la caméra traverse chacune par son oculus et découvre la suivante, toujours différente, jusqu’à retrouver la première : la boucle est parfaite par construction. Au centre, un cœur de lumière dont les rayons filtrent à travers les ajours.

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

Paramètres d’URL : `?seed=…` (une scène), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?debug` (outils de mesure dans `window.hollow`, dont `view(couche, x)` : une couche à une profondeur donnée, en image fixe).

Le panneau règle tout : graine et humeur, boucle (durée, plongée ou profondeur fixe), nid (rapport entre couches, taille du cœur, brouillard), caméra, lumières (cœur, lampe frontale, studio HDR), chaque couche (type, forme, matériaux des trois faces, mouvement), et le rendu (qualité, anticrénelage, ombres, détail, tone mapping, bloom, rayons, occlusion, flou de mouvement, profondeur de champ, aberration chromatique, grain). L’export produit une boucle MP4 (H.264) rendue image par image à la résolution et à la cadence choisies, et une image PNG.

## Principe

**La plongée.** Une coquille à la profondeur relative *x* a pour rayon D·kˣ (D : distance de la caméra, k : rapport entre couches) ; *x* = *d* − τ, où *d* est l’indice de la couche et τ l’avancée. La couche *d* utilise le modèle *d* mod N, donc la scène à τ + N est identique à la scène à τ. Tout — taille, éclairage, brouillard, niveau de détail, ombres — ne dépend que de *x* : la boucle ne présente aucune couture.

**Le passage.** Chaque coquille a un oculus sur son pôle +z. Elles culbutent pendant leur remontée et se stabilisent, oculus face à la caméra, à l’approche du passage (seule la rotation autour de l’axe de visée reste libre). La lampe frontale, solidaire de la caméra, franchit les oculus avec elle : aucune coquille ne change jamais de côté par rapport à elle, donc ses ombres ne sautent jamais.

**Les instances.** Chaque coquille visible est une instance d’un modèle ; une instance garde sa couche d’une boucle à l’autre (phase « déroulée »), et une instance qui réapparaît a un vecteur vitesse nul à sa première image — sinon le flou de mouvement et l’anticrénelage temporel produisent un éclair. Toutes les coquilles rendues projettent l’ombre des deux lumières : aucune ne cesse d’en projeter en cours de route.

**Le chargement.** Chaque couche demande tous ses niveaux de détail (et ses cristaux) en même temps et bascule d'un coup quand le dernier arrive : on ne voit jamais une forme se transformer. Une nouvelle scène reste derrière un écran de chargement (avec sa progression) jusqu'à ce que toutes ses couches soient prêtes et que quelques images aient été rendues.

**Les niveaux de détail.** Trois niveaux affichés, tous biseautés (rien n'apparaît ni ne disparaît d'un niveau à l'autre), choisis selon la taille de la coquille à l'écran en pixels ; un quatrième, grossier et à arêtes vives, ne sert qu'aux cartes d'ombre.

**Le halo du cœur.** Près du cœur, les coquilles baignent dans sa lumière (émission qui ne dépend que du rayon) ; elles sont affichées dès l'intérieur du cœur, qui les cache, et en émergent fondues dans le rayonnement — la naissance d'une couche ne se voit jamais.

**Les pièces animées.** Diaphragmes, éclats, écailles et anneaux sont des pièces rigides du maillage : chaque sommet porte un pivot, un axe, une amplitude et une nature (`rigA`, `rigB`), et le vertex shader applique la rotation et la translation, qui ne dépendent que de la profondeur relative *x* de la coquille et de la phase (`src/scene/rig.js`). La carte d’ombre subit la même déformation ; les motifs des matériaux restent attachés aux pièces (position au repos).

**La chorégraphie.** La plongée ralentit au passage de chaque oculus (l’avancée est remappée sur chaque couche, f − a·sin(2πf)/2π) et le champ s’ouvre légèrement à ce moment-là ; tout reste périodique.

**La naissance au cœur.** Les coquilles naissent dans le cœur lumineux. Pour que la lumière du cœur ne saute pas quand une nouvelle coquille commence à faire de l’ombre, celle-ci « pousse » dans la carte d’ombre : ses barreaux s’y élargissent progressivement depuis leur axe (masque d’ombre sur la proximité du bord), entièrement à l’intérieur du cœur.

## Géométrie (`src/gen/`, dans des Web Workers)

- **Alvéoles** : dual d’une icosphère géodésique (cellules de Goldberg), désordre réglable, centres écartés du pôle pour former l’oculus.
- **Voronoï** : vrai pavage de Voronoï sphérique (enveloppe convexe incrémentale des germes) ; germes en spirale de Fibonacci, en bruit bleu ou à densité graduée.
- **Fentes** : grille latitude × longitude, éventuellement en spirale (les arêtes partagées entre rangs décalés sont subdivisées des deux côtés).
- Chaque cellule est percée d’un trou : contour rétréci de la demi-largeur du barreau (barreaux d’égale largeur), arrondi (polygone → cercle), puis découpé selon une forme — ellipse orientée (jusqu’au tourbillon), étoile, diaphragme. Les trous traversent une vraie épaisseur, avec biseau arrondi ou chanfrein plat, éventuellement un chambrage (trou à épaulement) ; biseau et épaulement sont réduits localement là où ils se replieraient (limites lissées le long du bord).
- Le bord du trou est une courbe exacte (polygone arrondi par somme de Minkowski, congé lisse avec la forme), rééchantillonnée selon la longueur d’arc et la courbure : chaque pointe, chaque congé reçoit les points qu’il lui faut. Biseau, paroi et épaulement en sont des décalages le long de la normale exacte ; les faces suivent des colonnes normales au bord, cousues au contour de la cellule (partagé avec la voisine) par fusion d’angles. Pas de triangle nul, retourné ni en aiguille.
- Détails usinés : barreaux bombés, rivets aux jonctions, gravure qui suit le contour des trous (dans le matériau). Maillage étanche, trois niveaux de détail. La normale de la tranche (biseaux, parois, épaulements) est recalculée à chaque pixel à partir de l’angle du profil : biseaux parfaitement ronds, sans diagonale de quadrilatère dans les reflets.
- **Surfaces minimales** (gyroïde, Schwarz P, diamant, Neovius, I-WP, Fischer–Koch) taillées dans la coquille, en feuille ou en réseau : surface nets, reprojection sur la surface (gradient analytique, fausse position), relaxation des sommets, congés par maximum lisse, alésage de l’oculus. Dans le shader, leur normale est recalculée à chaque pixel à partir du champ : les reflets ne trahissent pas la triangulation.
- **Géode** : peu d’ouvertures, larges et irrégulières ; druse de cristaux prismatiques sur la face interne, jamais dans un trou.
- **Moucharabieh** : entrelacs étoilés construits par la méthode de Hankin sur les alvéoles (rayons inclinés de l’angle de contact au milieu de chaque arête) ; chaque cellule est redécoupée en polygone central, pointes d’étoile et cerfs-volants, tous convexes, percés comme n’importe quel pavage.
- **Éclatée (kintsugi)** : Voronoï fêlé en éclats, chacun bordé d’une paroi de cassure dorée et séparé de ses voisins par un joint fin ; écartés et tournés au fond, réassemblés au passage.
- **Sphère armillaire** : lunette d’oculus cloutée, anneau austral et méridiens fixes ; équateur gradué, tropiques et écliptiques qui tournent autour de l’axe de l’oculus (jamais à travers), perles-planètes. Rubans balayés à section arrondie (`sweep.js`).
- **Écailles** : plaques bombées en phyllotaxie, articulées sur leur bord haut, qui respirent (plus ouvertes près du cœur, une onde descend du pôle).
- **Vannerie** : deux familles de rubans tressés dessus-dessous (soulèvement en cosinus, alterné d’un croisement au suivant), coupés au bord de l’oculus sous une lunette.
- **Radiolaire** : barreaux larges et bombés, percés de pores (Worley dans le shader, sur les deux faces et dans la carte d’ombre : des points de lumière sur la couche suivante), épines aux jonctions.
- **Corail de Turing** : réaction-diffusion de Gray-Scott simulée sur une icosphère (corail cerveau, labyrinthe, vers, taches, mitoses), lue par interpolation exacte sur le réseau triangulaire, taillée dans la coquille et maillée comme les surfaces minimales.
- **Vitrail** : moucharabieh ou alvéoles aux plombs fins, un verre teinté et martelé dans chaque trou ; rétroéclairé par le cœur, il projette une ombre colorée (ombres transmises de three.js).
- **Ornements** : diaphragme de l’oculus (lames spiralées qui se recouvrent en tuiles, ouverture cherchée pour dégager tout le trou), rivets ou pierres taille brillant serties dans des chatons, épines. Pierres, épines et cristaux sont des instances.

## Matériaux (`src/scene/materials.js`)

Trois finitions par coquille — face externe, face interne, tranche — choisies parmi une quarantaine (métaux au F0 mesuré : laiton, or, cuivre, titane, chrome… ; émail craquelé, porcelaine, biscuit, velours, carbone sergé, nacre, obsidienne, basalte, druse, agate, verres). Le modèle physique est exploité en entier : vernis et sa propre normale, lustre, irisation à épaisseur variable, anisotropie (brossage circulaire), transmission avec dispersion et absorption, usure des bords révélant la tranche.

Anticrénelage spéculaire (Kaplanyan) : là où la normale varie vite d'un pixel à l'autre, le lobe spéculaire s'élargit au lieu de scintiller ; le relief s'annule à la frontière entre deux finitions.

Les motifs sont procéduraux mais ne calculent aucun bruit : ils échantillonnent un volume de bruit périodique (Perlin ×2, Worley F1 et F2−F1) précalculé au démarrage. Chaque pixel n’évalue que la finition de sa face. Les reliefs sont atténués à l’approche de la fréquence des pixels.

Métiers d’art : émail grand feu sur guilloché (vernis plat sur sillons « grain d’orge »), acier damassé, marbres de Carrare et Nero Marquina, laque urushi saupoudrée d’or (paillettes métalliques en nuées), céramiques, film de savon (irisation qui coule en boucle). Phosphorescence des tranches (humeur Abysses) : des fronts de lumière partent du cœur.

## Scène

- **Humeurs** : Atelier, Studio, Écrin, Nuit, Pastel, Irisé, et Clinique (porcelaine sur cyclorama blanc : la profondeur se perd dans le blanc), Abysses (cœur cyan, tranches phosphorescentes), Sacré (or, émail et vitraux, brouillard d’encens). Chaque humeur favorise ses jeux de matériaux et ses pièces d’exception.
- **Cœur** : étoile avec sa couronne, perle de lumière irisée, ou gyroscope (trois anneaux qui tournent autour de la source : leurs ombres balaient les coquilles).
- **Poussière d’or** : des paillettes métalliques en suspension, entraînées par la plongée (même loi que les coquilles), éclairées par le cœur et prises dans ses ombres.
- **Objectif** : traînées anamorphiques, halation, poussière sur la lentille, en plus du bloom, des rayons, de la profondeur de champ et de l’aberration chromatique.
- **Son** (`src/app/sound.js`) : nappe de l’humeur dont le filtre respire avec la boucle, cloche à chaque passage d’oculus, cliquetis d’horlogerie à l’ouverture des diaphragmes, réverbération de nef.

## Organisation

Un type de couche se déclare à un seul endroit, `src/types.js` (tirage de la forme, réglages du panneau, jeux de matériaux préférés) ; s’il a son propre maillage, son constructeur s’inscrit dans `src/gen/worker.js`. Les tampons de maillage (`gen/mesh.js`), les rubans balayés (`gen/sweep.js`), le diaphragme (`gen/iris.js`) et les ornements (`gen/jewels.js`) sont partagés par tous les constructeurs.

## Performances

Toutes options actives, ≈ 11 ms par image à 1× (≈ 1,1 Mpx) et ≈ 23 ms à 2× selon les scènes (le verre transmissif est le plus coûteux) ; la qualité « Haute » rend à 1,5×. Ombres : les cartes d’ombre ne voient que des maillages simplifiés (calques dédiés) ; le cœur n’y inclut que les coquilles situées entre lui et la caméra. Géométrie générée hors du fil principal, en parallèle, avec cache.
