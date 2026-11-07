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

**La naissance au cœur.** Les coquilles naissent dans le cœur lumineux. Pour que la lumière du cœur ne saute pas quand une nouvelle coquille commence à faire de l’ombre, celle-ci « pousse » dans la carte d’ombre : ses barreaux s’y élargissent progressivement depuis leur axe (masque d’ombre sur la proximité du bord), entièrement à l’intérieur du cœur.

## Géométrie (`src/gen/`, dans des Web Workers)

- **Alvéoles** : dual d’une icosphère géodésique (cellules de Goldberg), désordre réglable (vers un pavage de Voronoï), centres écartés du pôle pour former l’oculus.
- **Fentes** : grille latitude × longitude, éventuellement en spirale (les arêtes partagées entre rangs décalés sont subdivisées des deux côtés).
- Chaque cellule est percée d’un trou : contour rétréci de la demi-largeur du barreau (barreaux d’égale largeur), puis arrondi (polygone → cercle). Les trous traversent une vraie épaisseur, avec biseau arrondi ou chanfrein plat ; maillage étanche, trois niveaux de détail.
- **Surfaces minimales** (gyroïde, Schwarz P, diamant) taillées dans la coquille, en feuille ou en réseau : surface nets, reprojection de Newton, congés par maximum lisse, alésage de l’oculus.
- **Géode** : peu d’ouvertures, larges et irrégulières ; druse de cristaux prismatiques sur la face interne, jamais dans un trou.

## Matériaux (`src/scene/materials.js`)

Trois finitions par coquille — face externe, face interne, tranche — choisies parmi une trentaine (métaux au F0 mesuré : laiton, or, cuivre, titane, chrome… ; émail craquelé, porcelaine, biscuit, velours, carbone sergé, nacre, obsidienne, basalte, druse, agate, verres). Le modèle physique est exploité en entier : vernis et sa propre normale, lustre, irisation à épaisseur variable, anisotropie (brossage circulaire), transmission avec dispersion et absorption, usure des bords révélant la tranche.

Les motifs sont procéduraux mais ne calculent aucun bruit : ils échantillonnent un volume de bruit périodique (Perlin ×2, Worley F1 et F2−F1) précalculé au démarrage. Chaque pixel n’évalue que la finition de sa face. Les reliefs sont atténués à l’approche de la fréquence des pixels.

## Performances

Mesuré à 2× (≈ 4,5 Mpx), toutes options actives : ≈ 10 ms par image. Ombres : les cartes d’ombre ne voient que des maillages simplifiés (calques dédiés) ; le cœur n’y inclut que les coquilles situées entre lui et la caméra. Géométrie générée hors du fil principal, en parallèle, avec cache.
