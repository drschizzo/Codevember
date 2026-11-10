---
name: codevember-scene
description: Crée de bout en bout, en autonomie, un nouveau projet Codevember à partir d'un simple thème — une scène three.js WebGPU/TSL entièrement procédurale (une graine = une scène), animée en boucle parfaite, au rendu physique très soigné (matériaux, lumière, post-traitement), avec un vrai cœur technique (simulation, mathématiques, géométrie générative), écran de chargement, panneau de réglages sobre, export MP4/PNG et version mobile. À utiliser quand l'utilisateur demande un « nouveau projet », une « nouvelle scène », une « expérience » ou un « Codevember » sur un thème (« fais-moi un projet sur les vitraux », « une scène sur les marées »), ou veut décliner Hollow, Membrane, Tesseract ou Orrery sur un autre sujet.
---

# Codevember : une scène procédurale en boucle parfaite, à partir d'un thème

Les projets de référence sont dans ce dépôt : `hollow/` (coquilles emboîtées, plongée), `membrane/` (éclosion simulée sur GPU), `tesseract/` (hypercube replié, voyage 4D), `planetaire_v2/` (orbites à N corps et machines à engrenages), `calcin/` (verre soufflé, brisé par une machine, caméra rapide), `fold/` (plantes sensibles qui plient leurs feuilles : familles aux gestes distincts, vrai pli dans le vertex shader, scénario de touchers, appareil de laboratoire, paillage grain par grain). Leurs README sont la meilleure documentation de ce qu'on attend : lis celui du projet le plus proche du thème avant de concevoir. `calcin/` et `fold/` sont les plus récents : ils appliquent toutes les règles ci-dessous, et leurs `docs/concept.md` montrent les révisions demandées par l'utilisateur.

**Des principes, pas des recettes.** Les exemples de cette skill viennent des projets passés : ils illustrent une exigence, ils ne sont pas des modèles à reproduire. Chaque nouveau projet invente ses propres objets, causes, montures, décors, lumières, grammaire de caméra et structure de boucle, et évite de reprendre ceux des projets précédents (pas de marteau, de cloche, de pendule, de pot de terre, de goutte, de révolution de caméra ou de ralenti « parce que ça a marché ») sauf si le thème l'exige vraiment. Les nombres donnés sont des **bornes** (à ne pas dépasser) ou des ordres de grandeur mesurés sur un projet, jamais des cibles. À reprendre tels quels : seulement les exigences non négociables, les contrats d'architecture et les outils (échafaudage, chaîne d'image, vérification).

Ce qui fait un projet de cette famille, et que chaque nouveau projet doit tenir :

1. **Une idée, un geste.** Un thème devient UNE image forte et UN mouvement qui se répète : plonger dans des coquilles, déchirer une membrane, replier un hypercube, entrer dans une boule de verre. Tout le reste sert ce geste.
2. **Un vrai cœur technique**, pas un décor : une simulation (XPBD sur GPU, réaction-diffusion), une construction mathématique exacte (projection 4D, chorégraphies de Newton, engrenages calculés), une géométrie générative usinée (Voronoï sphérique, surfaces minimales, entrelacs). Il se vérifie par des tests et se raconte dans le README.
3. **La boucle est parfaite par construction**, jamais par fondu : l'état à u = 1 est exactement l'état à u = 0 (auto-similarité, symétrie dont le produit est l'identité, nombres entiers de tours).
4. **Une graine = une scène**, tirée d'une recette JSON partageable ; des humeurs et des accords de matières composés à la main, jamais du hasard pièce par pièce.
5. **Le rendu est physique et dosé** : finitions au F0 mesuré (une quarantaine fournies, à compléter selon le thème), trois finitions par pièce, lumière dosée, studio HDR calculé, chaîne d'image complète (GTAO, SSR, TRAA, bloom, halation, étalonnage par humeur, grain). Par défaut, des lampes presque blanches et des contre-jours ; un thème peut demander tout autre chose (lumière colorée d'un vitrail, lueur d'un four, lumière noire, éclairage interne) tant que c'est dosé et justifié.
6. **Le chargement ne gèle pas, l'interface se tait** : écran de chargement qui ne montre la scène que prête, panneau en verre dépoli replié, titre en Fraunces, touches N / espace / ← → / H / F, export MP4 image par image, version mobile à 60 i/s.
7. **Des scènes vraiment variées.** Deux graines doivent donner deux films qu'on ne confond pas, même en vignette : pas seulement une autre teinte, mais un autre **décor** (fond clair ou noir, matière du sol, accessoires, atmosphère), une autre **lumière** (dure ou douce, de côté, d'en haut, à contre-jour, soleil, lueur d'un four), une autre **valeur** (high key, low key, pénombre colorée), un autre **cadrage**. Une planche « une image par humeur » doit ressembler à des films différents.
8. **Le concept se décline, il ne se répète pas.** L'idée trouvée doit prendre des formes vraiment différentes d'une graine à l'autre : d'autres objets, d'autres mécanismes, d'autres mouvements du même geste (Fold, premier essai sous le nom de Sensitive : sept « archétypes » qui restaient tous la même sensitive, « c'est toujours globalement la même plante »). Le catalogue décline le geste par familles qui ne se ressemblent ni en silhouette ni en mouvement (pour le pli d'une feuille : la sensitive qui ferme ses folioles en peigne, le trèfle qui replie ses trois folioles en parapluie, la dionée qui claque ses deux lobes) ; une planche « une image par famille, au temps fort » doit montrer des gestes différents, pas seulement des proportions différentes.
9. **Une ambition d'objet de musée.** L'objet principal n'est pas une primitive : il a une construction (pied, jambe, anse, bouchon, côtes, torsade, bord festonné, décor appliqué, filigrane, parties assemblées), des proportions d'artisan, un niveau de détail qui récompense le gros plan. Si l'objet tient en une seule surface lisse, ce n'est pas encore assez. **Rien de « low poly »** : aucune nappe sans épaisseur (une feuille, un pétale, une lame de papier est une lame épaisse à tranche arrondie, biseautée, qui accroche un filet de lumière), courbure et irrégularité (une pointe qui s'incurve, un bord qui ondule), sections assez fines pour que les silhouettes soient rondes, et des matières travaillées pour elles-mêmes : translucidité (SSS) d'une feuille, nervures en relief, cuticule lustrée, duvet (sheen), glandes (Fold, premier rendu : « encore trop low poly »). **Le vivant n'est pas rectiligne** : tiges qui zigzaguent aux nœuds et ondulent irrégulièrement (plusieurs fréquences, deux plans), pétioles arqués et déviés, rachis qui fléchissent sous leur charge, chaque pièce à sa façon — mais la même courbe pour le rendu, les contacts et les tests (Fold : « trop rectiligne et uniforme… ça manque de désordre »). Un appareil se dessine comme un vrai : chaque pièce portée par une autre (socle, colonne, potence, chape, axe), rien qui flotte, rien qui se traverse, un principe de fonctionnement lisible.
10. **Tout est physiquement crédible**, même l'abstrait : chaque événement a une **cause visible** (exemples passés : un pendule, un marteau, un haut-parleur, une flamme, une goutte, la gravité ; chaque projet trouve les siennes — jamais un objet qui se brise tout seul ou une force sortie de nulle part) ; rien ne flotte sans support ; la gravité, les chocs, les frottements, la chaleur suivent leurs lois ; les matières se comportent comme elles-mêmes (le verre en fusion coule et rougeoie, le verre froid casse net, le métal sonne) ; les libertés avec le temps sont celles du cinéma et se lisent comme telles (ralenti de caméra rapide, accéléré pour les processus lents), jamais une physique inventée. Une transition abstraite doit passer par un processus plausible (refonte, écoulement, condensation…), pas par de la magie.
11. **La cause et l'effet coïncident, et se lisent.** Un événement provoqué (choc, contact, déclenchement, passage) commence à l'image exacte où sa cause l'atteint : le contact est calculé sur la vraie géométrie (rayons, épaisseurs, demi-largeurs), pas sur des points centraux, et un test vérifie que l'écart est nul à l'instant de l'événement et positif juste avant. Chaque cause doit se comprendre en une seconde sans légende : son action est visible (amplitude, chaleur, trajectoire, déformation), elle est montrée sous l'angle où elle se lit (de profil plutôt que de face), et l'effet part visiblement de l'endroit où elle agit. Une cause qu'on doit expliquer est à revoir.
12. **La boucle est originale et lisible.** Le film raconte une histoire qu'on suit sans légende — sa forme est à inventer pour chaque thème (Fold : cause, effet entier, retour, puis la suivante, en crescendo ; ailleurs ce sera une transformation continue, une réaction en chaîne, un contrepoint, une accumulation…) — chaque effet cadré pour qu'on voie toute l'unité qui réagit (la feuille entière qui se ferme, toute la plante qui s'affaisse), jamais un effet partiel ou hors champ. Pas de juxtaposition d'événements dont on ne comprend ni l'ordre ni la portée (Fold, premier essai : marteau, gouttes, quelques folioles qui se plient « pas forcément de manière compréhensible »). Écris le découpage comme un scénario et vérifie-le sur un film image par image : à chaque instant, peut-on dire ce qui se passe et pourquoi ? La structure de la boucle elle-même doit surprendre (crescendo, réponse en chaîne, contrepoint), pas seulement répéter.
13. **Le geste du thème est le spectacle.** Ce qui donne son nom au projet est montré là où il se lit le mieux : à l'échelle qui le fait remplir l'image, dans l'axe où il se comprend, au tempo qui le rend visible (ralenti d'un geste bref, accéléré d'un processus lent, ou temps réel), sous la lumière qui le sculpte. Exemple (Fold) : l'organe qui plie plutôt que la plante entière, un pli en V filmé depuis la pointe, les 0,2 s du claquement d'une dionée étirées sur 2 s. Fold, deuxième version : « le pliage n'est pas assez flagrant… il doit vraiment être mis en avant de manière spectaculaire et esthétique ».
14. **Tout est posé, ombré, et rien ne se traverse.** Chaque objet proche d'une surface y porte une ombre lisible (c'est elle qui le pose ; sans elle, il flotte), y compris les matières transparentes. Aucun objet ne pénètre un autre ni le sol, à aucun instant de la boucle : vérifié par un test sur tous les sommets (pas seulement les centres) et sur des vues rasantes. **Tout l'appareil, toute la course, tous les instants** : le bras d'un marteau (pas seulement sa tête), les socles des appareils (orientés comme l'appareil, hors de la soucoupe et l'un de l'autre), les feuilles pendant le pli (pas seulement ouvertes et fermées : à mi-course, contre les pétioles voisins), avec des points témoins à pas fixe (pas un nombre fixe par pièce : une grande feuille en demande plus). Fold : bras du marteau à travers la lèvre roulée, socle dans la soucoupe, folioles de trèfle qui traversaient un pétiole à mi-pli. Et tout objet doit dire ce qu'il est : un statif dont la burette ne se voit pas n'est qu'une tige inexplicable.

## Déroulé

Travaille en autonomie : le thème suffit. N'interromps l'utilisateur que si le thème est vraiment ambigu ; sinon annonce ton concept en quelques lignes et avance. Tiens la liste des étapes avec `update_plan`. Écris en français (code commenté, README, panneau), comme les autres projets.

### 1. Concept (avant toute ligne de code)

Lis `references/concept.md` et suis son **protocole d'idéation** jusqu'au bout, par écrit, dans `<projet>/docs/concept.md` : exploration du thème sous au moins cinq angles, clichés nommés et écartés, au moins huit pistes notées sur six critères (originalité, esthétique, boucle, cœur technique, variations, faisabilité), puis découpage temporel, matrice de variations (≥ 5 axes × ≥ 4 valeurs), trois images clés décrites et risques de la piste retenue. Ne saute pas cette étape et ne retiens pas la première idée : c'est elle qui fait la différence entre une démo et une œuvre. Ensuite, reporte dans le README (section d'ouverture et « Principe ») :
- le titre et le sous-titre (une locution en italique, « le cabinet replié »). **Quand l'utilisateur donne un thème, le projet porte le nom du thème** : dossier, titre et entrées de l'index (thème « fold » → `fold/`, « Fold ») ; le titre évocateur trouvé pendant l'idéation peut devenir le sous-titre, jamais le nom (Sensitive, premier nom de Fold, a dû être renommé) ;
- le **geste** et la **formule de la boucle** (voir `references/loop.md` : choisis le schéma — plongée auto-similaire, cycle de symétries, éclosion en couches, périodique pur — et écris la formule) ;
- le **cœur technique** et ses invariants vérifiables ;
- le **catalogue** (et sa différence avec les projets du dépôt : un catalogue qui reprend leurs objets, causes ou décors est à revoir) : au moins trois **familles** de l'objet principal qui accomplissent le geste chacune autrement (silhouette, mécanisme, tempo — voir la règle 8), déclinées en 6 à 12 variantes ; 6 à 8 humeurs contrastées (au moins une claire, une froide, une sombre), chacune un décor ;
- le **scénario** de la boucle, écrit comme un film muet (règle 12) ;
- ce que montre l'**écran de chargement** (un texte court, ou mieux, le calcul lui-même dessiné).

Avant de coder, fais passer au concept les épreuves écrites dans `docs/concept.md` (et les deux de `references/concept.md`, e ter : déclinaison, scénario) :
- **crédibilité** : pour chaque temps du film, quelle est la cause physique visible, et quelle loi gouverne le mouvement ? Chaque réponse « ça se fait tout seul » ou « ça flotte » doit être remplacée par un mécanisme, un support ou un processus réel ;
- **variété** : décris une image de chaque humeur en une phrase qui ne parle pas de couleur (décor, lumière, valeur, cadrage) ; si deux phrases se ressemblent, revois les humeurs ;
- **ambition** : liste les éléments de construction de l'objet principal et de ses variantes ; s'il y en a moins de cinq, enrichis le catalogue.

Relis ce concept face aux premières images (étape 5) et face à un **film** (étape 4, images à quelques dixièmes de seconde autour de chaque temps fort) : si une image clé n'est pas belle à l'écran, corrige le rendu ou le concept, pas la description.

### 2. Échafaudage

```bash
node .claude/skills/codevember-scene/scripts/scaffold.mjs <dossier> "<Titre>" "<sous-titre>"
```

Il copie les modules éprouvés et indépendants du thème (hasard `sfc32`, réglages et qualités, mobile, export MP4 / rendu accumulé, chaîne d'image, studio HDR, volume de bruit, pool de workers, maillage, 40 finitions et leur matériau TSL), pose le gabarit (`main.js`, `ui.js`, `recipe.js`, `scene/stage.js`, `gen/worker.js`, tests, README) et inscrit le serveur dans `.claude/launch.json`. Lance `preview_start` sur ce nom (si le navigateur intégré refuse un serveur de plus parce que d'autres conversations en occupent les places, lance `python3 .claude/serve.py <port> <dossier>` en arrière-plan et ouvre l'URL avec `preview_start {url}`) et vérifie que la pièce de démonstration se charge et tourne (voir `references/verification.md`) **avant** de toucher au thème. L'architecture et les contrats des modules : `references/architecture.md`.

### 3. Le cœur : génération et simulation

Dans `src/gen/` (workers, fonctions pures importables depuis Node) ou en shaders de calcul. Itère dans Node avec des scripts de mesure : c'est dix fois plus rapide que dans le navigateur. Écris les tests d'invariants dans `test/` au fur et à mesure (`node --test '<dossier>/test/*.test.mjs'`). Géométrie usinée : arêtes arrondies aux normales exactes, trois rôles de surface (externe, interne, tranche) dans l'attribut `surf`, maillage étanche, niveaux de détail sans saut. Voir `references/rendering.md` (géométrie).

### 4. La boucle et la chorégraphie

`renderAt(u)` ne dépend que de la recette et de la phase. Respirations (ralentis, accélérations) par le noyau K₇ qui retombe sur ses pieds ; anticipation et rebond ; tempo propre au geste du thème (règle 13) ; une grammaire de caméra choisie pour ce film (immobile, travelling, plongée, révolution, suivi…), périodique, lisse et lente — bornes : pointe < 25°/s, accélération bornée image par image (un test à 120 i/s), pas de recul par paliers devant un obstacle (un plancher de distance continu). Vérifie le raccord (`seam()`) et ne laisse rien apparaître, disparaître ou changer de géométrie à l'écran : tout naît caché (derrière la caméra, dans une lueur, en fondu tramé). `references/loop.md`.

### 5. Matières, humeurs, direction artistique

Accords composés à la main par humeur, une idée par image, l'or en accent, l'objet qui tranche sur son fond, verre clair, lampes presque blanches, étalonnage par humeur. Écris les règles en tests sur 400 graines. **Juge sur des images, pas sur la liste des matières.** `references/art-direction.md`.

### 6. Lumière et image

Lampe à ombres douces, contre-jours, éclairage sélectif, lumières dosées au posemètre (`meter()`), studio HDR propre à l'humeur, chaîne d'image complète. Exposition fixe (le film doit boucler). `references/rendering.md`.

### 7. Interface, chargement, export

Panneau complet (tout ce que tire la recette est réglable), « Copier le lien », écran de chargement sans gel (pipelines asynchrones, préchauffage des moments qui comptent), export MP4 et PNG, rendu accumulé. `references/interface.md`.

### 8. Performance et mobile

Budget : ≤ 16 ms à ~2 Mpx en qualité Haute sur un GPU de portable récent ; mobile ≈ 4 × moins cher. Mesure avant d'optimiser (`bench()`), poste par poste. `references/performance-mobile.md`. Lis **`references/three-tsl-pitfalls.md` avant d'écrire du TSL** : la plupart des heures perdues sur les projets précédents y sont.

### 9. Revue finale et livraison

- Planche de 8 graines × 5 phases envoyée au collecteur, regardée image par image ; corrige ce qui est vide, chargé, illisible, brûlé ou noir. Choisis la graine d'ouverture parmi les plus belles (`DEFAULT_SEED`).
- Console sans erreur (`errors` en `?debug`), y compris en `?mobile=1` ; raccord de boucle exact ; aucune compilation après le chargement ; tests verts (dont : aucune interpénétration à aucun instant, contact exact des causes, continuité de la caméra) ; un export MP4 court essayé.
- Un film image par image autour de chaque temps fort, pour au moins une graine par famille ; et un gros plan rasant de chaque appareil et de chaque monture (c'est là que l'utilisateur voit les pièces qui flottent ou se traversent).
- README complet sur le modèle des autres (Utilisation, Principe, Génération, Matériaux, Scène, Tests, Performances mesurées, Version mobile), avec une capture `docs/capture.jpg`.
- Entrée dans `index.html` et `README.md` à la racine (lien, version légère, une phrase).
- Ne committe que si l'utilisateur le demande ; dis clairement ce qui n'a pas été vérifié (lecture en direct quand le panneau est masqué, notamment). Quand l'utilisateur désigne une graine (« celle-ci par défaut »), mets-la dans `DEFAULT_SEED`.

## Exigences non négociables

- Pas de texture téléchargée, pas de modèle importé : tout est calculé (sauf three.js, lil-gui, mp4-muxer et les polices, par CDN, sans étape de construction : `importmap`).
- Tous les tirages passent par `createRng(seed).fork('…')` ; jamais `Math.random()` dans la scène.
- Tout ce qui varie à l'image est un uniforme ; seuls les choix de structure (motif, vernis, transmission…) recompilent, et seulement hors de la lecture.
- Aucun gel après le chargement : tout shader susceptible de servir est compilé sous l'écran de chargement.
- Pas d'erreur de pipeline silencieuse : un objet qui « disparaît » est d'abord une pipeline invalide (limite de varyings, de tampons de sommets), pas un problème de lumière.
- Ne touche pas aux autres projets du dépôt, sauf pour l'entrée à la racine.

## Références

- `references/concept.md` — du thème au concept : protocole d'idéation, épreuves (crédibilité, variété, ambition, déclinaison, scénario), le geste, le cœur technique, les catalogues.
- `references/loop.md` — schémas de boucle parfaite, chorégraphie, caméra, apparitions invisibles.
- `references/architecture.md` — arborescence, contrats des modules, recette, workers, paramètres d'URL, outils de mise au point.
- `references/art-direction.md` — humeurs, accords, règles et tests de direction artistique.
- `references/rendering.md` — géométrie usinée, matériaux TSL, lumière, post-traitement.
- `references/interface.md` — panneau, chargement, export, clavier et tactile.
- `references/performance-mobile.md` — budgets, mesures, mode allégé, chargement sans gel.
- `references/three-tsl-pitfalls.md` — pièges three.js 0.186 WebGPU / TSL rencontrés et leurs remèdes.
- `references/verification.md` — voir ce qu'on fait quand le panneau est masqué : collecteur, planches, posemètre, raccord, banc.
