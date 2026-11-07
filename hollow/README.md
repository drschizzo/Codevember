# Hollow

Une plongée sans fond. Des coquilles creuses s’emboîtent les unes dans les autres ; la caméra traverse chacune par son oculus et découvre la suivante, toujours différente, jusqu’à retrouver la première : la boucle est parfaite par construction. Au centre, un cœur de lumière dont les rayons filtrent à travers les ajours.

Rendu physique en three.js (WebGPU, TSL). Scène entièrement procédurale : une graine produit une scène, et l’on peut en générer autant que l’on veut.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l’interface |
| F | plein écran |

Paramètres d’URL : `?seed=…` (une scène), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?debug` (outils de mesure dans `window.hollow`).

Le panneau règle tout : graine et humeur, boucle (durée, plongée ou profondeur fixe), nid (rapport entre couches, taille du cœur, brouillard), caméra, lumières (cœur, lampe frontale, studio HDR), chaque couche (type, forme, matériaux des trois faces, mouvement), et le rendu (qualité, anticrénelage, ombres, détail, tone mapping, bloom, rayons, occlusion, flou de mouvement, profondeur de champ, aberration chromatique, grain). L’export produit une boucle MP4 (H.264) rendue image par image à la résolution et à la cadence choisies, et une image PNG.

## Principe

**La plongée.** Une coquille à la profondeur relative *x* a pour rayon D·kˣ (D : distance de la caméra, k : rapport entre couches) ; *x* = *d* − τ, où *d* est l’indice de la couche et τ l’avancée. La couche *d* utilise le modèle *d* mod N, donc la scène à τ + N est identique à la scène à τ. Tout — taille, éclairage, brouillard, niveau de détail, ombres — ne dépend que de *x* : la boucle ne présente aucune couture.

**Le passage.** Chaque coquille a un oculus sur son pôle +z. Elles culbutent pendant leur remontée et se stabilisent, oculus face à la caméra, à l’approche du passage (seule la rotation autour de l’axe de visée reste libre). La lampe frontale, solidaire de la caméra, franchit les oculus avec elle : aucune coquille ne change jamais de côté par rapport à elle, donc ses ombres ne sautent jamais.

**Les instances.** Chaque coquille visible est une instance d’un modèle ; une instance garde sa couche d’une boucle à l’autre (phase « déroulée »), et une instance qui réapparaît a un vecteur vitesse nul à sa première image — sinon le flou de mouvement et l’anticrénelage temporel produisent un éclair. Toutes les coquilles rendues projettent l’ombre des deux lumières : aucune ne cesse d’en projeter en cours de route.

**Le chargement.** Chaque couche demande tous ses niveaux de détail (et ses cristaux) en même temps et bascule d'un coup quand le dernier arrive : on ne voit jamais une forme se transformer. Une nouvelle scène reste derrière un écran de chargement (avec sa progression) jusqu'à ce que toutes ses couches soient prêtes et que quelques images aient été rendues.

**Les niveaux de détail.** Trois niveaux affichés, tous biseautés (rien n'apparaît ni ne disparaît d'un niveau à l'autre), choisis selon la taille de la coquille à l'écran en pixels ; un quatrième, grossier et à arêtes vives, ne sert qu'aux cartes d'ombre.

**Le halo du cœur.** Près du cœur, les coquilles baignent dans sa lumière (émission qui ne dépend que du rayon) ; elles sont affichées dès l'intérieur du cœur, qui les cache, et en émergent fondues dans le rayonnement — la naissance d'une couche ne se voit jamais.

**La naissance au cœur.** Les coquilles naissent dans le cœur lumineux. Pour que la lumière du cœur ne saute pas quand une nouvelle coquille commence à faire de l’ombre, celle-ci « pousse » dans la carte d’ombre : ses barreaux s’y élargissent progressivement depuis leur axe (masque d’ombre sur la proximité du bord), entièrement à l’intérieur du cœur.

## Géométrie (`src/gen/`, dans des Web Workers)

- **Alvéoles** : dual d’une icosphère géodésique (cellules de Goldberg), désordre réglable, centres écartés du pôle pour former l’oculus.
- **Voronoï** : vrai pavage de Voronoï sphérique (enveloppe convexe incrémentale des germes) ; germes en spirale de Fibonacci, en bruit bleu ou à densité graduée.
- **Fentes** : grille latitude × longitude, éventuellement en spirale (les arêtes partagées entre rangs décalés sont subdivisées des deux côtés).
- Chaque cellule est percée d’un trou : contour rétréci de la demi-largeur du barreau (barreaux d’égale largeur), arrondi (polygone → cercle), puis découpé selon une forme — ellipse orientée (jusqu’au tourbillon), étoile, diaphragme. Les trous traversent une vraie épaisseur, avec biseau arrondi ou chanfrein plat, éventuellement un chambrage (trou à épaulement) ; biseau et épaulement sont réduits localement là où ils se replieraient.
- Détails usinés : barreaux bombés, rivets aux jonctions, gravure qui suit le contour des trous (dans le matériau). Maillage étanche, trois niveaux de détail.
- **Surfaces minimales** (gyroïde, Schwarz P, diamant, Neovius, I-WP, Fischer–Koch) taillées dans la coquille, en feuille ou en réseau : surface nets, reprojection de Newton, relaxation des sommets, congés par maximum lisse, alésage de l’oculus. Dans le shader, leur normale est recalculée à chaque pixel à partir du champ : les reflets ne trahissent pas la triangulation.
- **Géode** : peu d’ouvertures, larges et irrégulières ; druse de cristaux prismatiques sur la face interne, jamais dans un trou.

## Matériaux (`src/scene/materials.js`)

Trois finitions par coquille — face externe, face interne, tranche — choisies parmi une trentaine (métaux au F0 mesuré : laiton, or, cuivre, titane, chrome… ; émail craquelé, porcelaine, biscuit, velours, carbone sergé, nacre, obsidienne, basalte, druse, agate, verres). Le modèle physique est exploité en entier : vernis et sa propre normale, lustre, irisation à épaisseur variable, anisotropie (brossage circulaire), transmission avec dispersion et absorption, usure des bords révélant la tranche.

Anticrénelage spéculaire (Kaplanyan) : là où la normale varie vite d'un pixel à l'autre, le lobe spéculaire s'élargit au lieu de scintiller ; le relief s'annule à la frontière entre deux finitions.

Les motifs sont procéduraux mais ne calculent aucun bruit : ils échantillonnent un volume de bruit périodique (Perlin ×2, Worley F1 et F2−F1) précalculé au démarrage. Chaque pixel n’évalue que la finition de sa face. Les reliefs sont atténués à l’approche de la fréquence des pixels.

## Performances

Toutes options actives, ≈ 11 ms par image à 1× (≈ 1,1 Mpx) et ≈ 23 ms à 2× selon les scènes (le verre transmissif est le plus coûteux) ; la qualité « Haute » rend à 1,5×. Ombres : les cartes d’ombre ne voient que des maillages simplifiés (calques dédiés) ; le cœur n’y inclut que les coquilles situées entre lui et la caméra. Géométrie générée hors du fil principal, en parallèle, avec cache.
