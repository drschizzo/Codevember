# Performance et version mobile

## Budgets et mesures de référence

| Projet | Mesure (qualité Haute) |
| --- | --- |
| Hollow | ≈ 11 ms à 1,1 Mpx, ≈ 23 ms à 2× (le verre transmissif coûte le plus) |
| Tesseract | 8,4 ms dehors, 14 ms en halte, 15,5 ms en traversée à 2,1 Mpx |
| Membrane | ≈ 26 ms à 1,9 Mpx (copies d'image, SSR, simulation relue) |
| Orrery | ~14 ms (une scène de 7 corps passée de 1 250 à 170 objets dessinés) |

Vise ≤ 16 ms à ~2 Mpx en Haute sur un GPU de portable récent, et ≈ 4 × moins en Mobile. Note les mesures (graine, résolution, phase) dans le README, poste par poste.

**Mesurer** : boucle arrêtée, N rendus d'affilée puis `device.queue.onSubmittedWorkDone()` (`bench()`) ; retirer les postes un à un ; ne jamais mesurer juste après un changement de réglage (compilation asynchrone en cours). Le panneau de navigateur masqué ralentit le JS (~10×) mais les écarts A/B mesurés ainsi restent cohérents.

## Ce qui coûte, ce qui a marché

- Les scènes sont **limitées par les fragments** : le nombre de lumières évaluées par pixel compte bien plus que les sommets (éclairage sélectif : −5 à −10 ms).
- Bruit procédural → volume de bruit 128³ précalculé : 50 ms → 0,7 ms (Hollow).
- Travail coûteux par pixel derrière `If` dans un `Fn`, avec les dérivées écran calculées hors de la branche (plis de Membrane : 3,2 → 0,6 ms).
- Une copie d'image (`viewportMipTexture`) coûte ~0,6 ms à 1,9 Mpx quelle que soit la taille de l'objet ; mélanger par le matériel ce qui n'a pas besoin de réfraction (−3,5 ms).
- GTAO à 8 échantillons sous TRAA (−1 ms) ; SSR en demi-résolution ; bloom en quart de résolution en mobile.
- Ombres : maillages simplifiés dans les cartes d'ombre, calques dédiés, seuls les objets utiles par lumière ; rien d'autre ne projette.
- Objets : fusion des pièces fixes par matière, instanciation par attributs (pas d'`InstancedMesh` : un shader par objet), élimination de ce qui est hors champ ou trop petit (un monde lointain remplacé par sa miniature).
- Caches : géométrie par spécification (workers), poses immobiles non recalculées.
- Plafonner les éléments coûteux par scène (Tesseract : tôle perforée sur 18 faces au plus).

## Chargement sans gel

Tout passe par les modules communs `src/app/warmup.js`, `loader.js`, `loaderWorker.js` (copiés tels quels par l'échafaudage depuis melt/ ; identiques dans tous les projets — une correction se reporte partout).

1. **Pipelines asynchrones** pendant le chargement (`asyncPipelines(renderer)`) : `createRenderPipelineAsync`, objet sauté tant que sa pipeline n'est pas prête. Sans cela, chaque compilation bloque le processus graphique, donc tout l'affichage de la page, même un écran dessiné dans un worker. Orrery : blocages de l'affichage 1,4 s → 0,1 s.
2. **Préchauffage** (`warmScene({ phases, … })`) : rendre les phases qui montrent des objets ou des états absents du début (plongée, halte, traversée…), `frustumCulled` coupé ; sans cela, la première image d'un moment nouveau gèle (Tesseract : 0,5 s à la plongée).
3. **Construction découpée** : la traduction TSL → WGSL des matériaux se fait sur le fil principal (jusqu'à plusieurs centaines de ms par matériau ; Calcin : 4,6 s d'un bloc). `warmScene` limite chaque image à ~100 ms de construction (les objets nouveaux au-delà sont sautés le temps d'une image, sans toucher à `visible`) et rend la main entre deux images par `MessageChannel` (jamais `setTimeout` : ralenti à 1/s ou 1/min en arrière-plan).
4. Refaire le préfiltrage du studio après (fait par `warmScene`, `needsPMREMUpdate`).
5. **L'écran de chargement est dessiné dans un worker** (`OffscreenCanvas`) et démarre avant le téléchargement de three.js (`<script type="module" src="src/app/loader.js">` avant main.js) ; three.js en version `.min` et `modulepreload` dans `index.html`.
6. Après le chargement, rien ne se compile : une boucle entière sans image de plus de ~34 ms. Les lumières restent au premier niveau de la scène, dans un ordre fixe (un réordonnancement recompile tout).

## Version mobile (mode allégé)

Choisie d'office sur téléphone ou tablette (écran tactile et petit écran), imposée par `?mobile=1`, interdite par `?mobile=0`, ou par la qualité « Mobile » du panneau (rechargement : les matériaux sont compilés autrement). Réglages mémorisés à part. Du plus au moins coûteux :

- **Résolution** : base 1,25 × CSS (au lieu de 3×), puis résolution dynamique (cible ~45 i/s, 50–100 %, par paliers, plafond mémorisé, sans oscillation) ; cadence plafonnée à 60 i/s.
- **Chaîne d'image** : une seule passe, une seule cible (ni pré-passe, ni normales, ni vitesses), FXAA, ni GTAO, ni SSR, ni TRAA, ni flou de mouvement, ni traînées, ni poussière, ni aberration ; bloom en quart de résolution ; étalonnage, halation et grain conservés.
- **Matériaux** (`setLite`) : Worley lu dans le volume, fBm à 2 octaves, verre composité, pierres en cabochons, occlusion imitée aux jonctions, pas de seconde pose par sommet (vitesses).
- **Lumières et ombres** : une lumière de moins (la plus faible, l'autre renforcée), cartes d'ombre en 1024, studio en 512.
- **Géométrie et simulation** : niveau de détail le plus fin jamais généré, ~2/3 des particules, moins d'images enregistrées, 2–3 workers.

Écris dans le README les différences visibles qui restent. Vérifie `?mobile=1` comme le reste : console propre, images, temps d'image.
