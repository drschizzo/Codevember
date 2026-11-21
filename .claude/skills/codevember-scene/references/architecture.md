# Architecture

Sans étape de construction : modules ES servis tels quels, `importmap` vers three@0.186.1 (WebGPU + TSL), lil-gui@0.20.0, mp4-muxer@5.1.3 (chargé à la demande). Serveur de développement : `.claude/serve.py <port> <dossier>` (sans cache ; il sert aussi `/shared/` quand le dossier est celui d'un projet), déclaré dans `.claude/launch.json` (l'échafaudage s'en charge), lancé par `preview_start`. **N'utilise pas `python -m http.server`** : sans l'en-tête `no-store`, le navigateur garde d'anciens modules et en mélange deux versions (un même module chargé deux fois : écran de chargement en erreur, volume de bruit absent).

## Arborescence

Ce qui ne dépend pas du thème est dans **`shared/`** à la racine du dépôt, une seule fois, et s'importe par un chemin relatif (`../../shared/rng.js` depuis `src/`). Un projet ne contient que ce qui lui est propre.

```
shared/                 modules communs (voir shared/README.md)
  style.css             interface (verre dépoli, Fraunces + Inter)
  rng.js                sfc32, fork, pick, weighted, gauss, dir, bruit CPU, jitter (rendu accumulé)
  finishes.js           ~40 finitions (F0 mesurés) et ~30 jeux [externe, interne, tranche]
  app/mobile.js         détection, résolution dynamique, cadence plafonnée, gestes tactiles
  app/capture.js        PNG, MP4 H.264 image par image (WebCodecs + mp4-muxer)
  app/loader.js         écran de chargement (+ loaderWorker.js) ; charge <projet>/src/app/loaderArt.js
  app/warmup.js         pipelines asynchrones, préparation sans gel
  app/debug.js          outils de mise au point (?debug), attentes sans minuterie, partage d'une recette (#r=)
  render/post.js        chaîne d'image (pré-passe, GTAO, MRT, SSR, TRAA, MSAA, flou, DoF, bloom…)
  render/accum.js       rendu accumulé (moyenne de N rendus décalés)
  scene/globals.js      uniformes partagés (phase, image, micro-relief…)
  scene/materials.js    matériau TSL d'une pièce à trois finitions, volume de bruit, mode allégé
  scene/env.js          studio HDR calculé (+ gen/envmap.js : les pixels, dans un worker)
  scene/rig.js          déformation des sommets (pièces articulées)
  gen/client.js         pool de workers avec cache ; lance <projet>/src/gen/worker.js
  gen/mesh.js           tampons de maillage et primitives (attributs position, normal, tangent, surf)
  gen/noisevol.js       volume de bruit périodique 128³ (Perlin ×2, Worley F1, F2−F1)

<projet>/
  index.html            importmap, titre, indice clavier, toast, progression d'export, écran de chargement
  README.md             documentation complète (modèle : les quatre projets)
  docs/capture.jpg      image de la page d'accueil du dépôt
  src/
    core.js             le cœur : scène, application de la recette, rendu d'une phase (source unique)
    main.js             la page : moteur, recette, chargement, interface, export, clavier, ?debug
    day.js              le jour du relais (mega/) : branche core.js sur le kit de la méga-scène
    recipe.js           graine → recette JSON : humeurs, accords, tirages, upgrade()
    app/ui.js           panneau lil-gui (ne connaît que la recette, les réglages et des rappels)
    app/settings.js     qualités (Mobile, Brouillon, Standard, Haute, Cinéma), réglages par défaut, clé de stockage
    app/loaderArt.js    le dessin de l'écran de chargement, propre au thème
    scene/stage.js      (gabarit) lumières, sol, pièces ; à remplacer par la scène du thème
    gen/worker.js       constructeurs (géométrie, simulation CPU) hors du fil principal
  test/*.test.mjs       invariants (node --test), sans navigateur
  tools/                bancs d'essai Node propres au projet
```

**Un module de `shared/` ne se modifie pas pour un projet.** Si le thème demande un comportement que les autres n'ont pas : soit c'est une option dont le défaut redonne l'ancien rendu (`createPost(renderer, scene, camera, { haze })`), ajoutée à `shared/` et vérifiée par `tools/regress.html` sur tous les projets ; soit c'est une variante locale, copiée sous le même nom dans `<projet>/src/` (Kelp : sa chaîne d'image à hublot). Des studios HDR propres au projet s'ajoutent sans copie : `src/gen/envmap.js` importe `ENV_PRESETS` de `shared/` et y ajoute les siens (Erosion, Spore, Mirage). `shared/README.md` donne la marche à suivre ; `npm run check` signale les imports cassés et les copies inutiles.

Outils à la racine : `npm test` (tous les projets), `npm run check` (cohérence du dépôt), `tools/sink.py` (collecteur d'images), `tools/regress.html` + `tools/regress.py` (non-régression du rendu).

Les projets plus riches découpent la scène par rôle : `scene/nest.js` (les couches et leurs instances), `scene/lights.js`, `scene/dust.js`, `scene/practicals.js` (lumières d'écrin), `scene/dose.js` (dosage), `scene/probe.js` (sonde de pièce), `scene/gpusim.js` (simulation WebGPU), `app/loader.js` + `app/loaderWorker.js` (écran de génération dessiné dans un worker), `app/overlay.js` (légendes, encart), `app/sound.js` (Web Audio). Un type d'objet se déclare à **un seul endroit** (Hollow : `src/types.js` donne tirage, réglages du panneau et jeux préférés ; son constructeur s'inscrit dans `gen/worker.js`).

Les catalogues (matières, verres, formes, humeurs) vivent dans des **modules purs**, sans import de three : la recette et les tests Node les chargent (Calcin : `glasses.js` séparé de `scene/glass.js`, sinon `node --test` échoue sur `import 'three'`).

## La recette

- `generate(seed, overrides)` → objet JSON pur ; `overrides.mood` impose l'humeur. Chaque famille de tirages a son flux (`rng.fork('camera')`, `rng.fork('accord')`…) : ajouter un tirage ne change pas les autres.
- Arrondis (`r2`, `r3`) : la recette est lisible et compacte dans le lien ; `Math.round(x * 100) / 100 || 0` (sans le `|| 0`, un −0 ne survit pas à l'aller-retour JSON et casse le test de déterminisme).
- `upgrade(R)` complète une recette ancienne (lien partagé) avec les champs ajoutés depuis.
- « Copier le lien » : JSON → `CompressionStream('deflate-raw')` → base64url dans `#r=` ; la graine reste dans `?seed=`.
- Le panneau modifie la recette en place puis appelle un rappel : `recipeChanged` (rien à faire, renderAt relit tout), `finishChanged` (uniformes, ou nouveau matériau si la signature change), `layerGeometry(i)` (nouvelle requête au worker ; l'ancienne version reste affichée jusqu'à l'arrivée de la nouvelle).

## Génération

- Workers modules (`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`), pool de `hardwareConcurrency − 1` (2–6 ; 2–3 en mobile), cache LRU par `JSON.stringify(spec)`, tampons transférés.
- Format compact : normales snorm16, tangentes snorm8, indices 16 bits quand c'est possible (Tesseract).
- Déterminisme : même graine, même résultat quel que soit le nombre de workers (Orrery : le premier essai réussi par ordre d'indice fait foi).
- Simulation sur GPU : WGSL brut via `renderer.backend.device`, tampons partagés avec three par `StorageBufferAttribute` (voir three-tsl-pitfalls.md) ; préparation (maillage, tables de voisinage) dans le worker.
- Échec : une recherche sans solution, une erreur, un délai dépassé s'affichent sur l'écran de chargement avec des issues (autre graine, réessayer, revenir à la dernière scène).

## core.js, main.js, day.js : une seule source pour la page et le relais

Chaque projet est aussi un jour de la méga-scène (`mega/`, « le relais » : les
jours en un seul plan, un seul moteur, le suivant préparé pendant que l'autre
joue). Pour qu'une retouche vaille pour les deux, **tout ce qui fait l'image vit
dans `core.js`** ; la page et le relais ne font que l'appeler.

- `core.js` : `createCore({ renderer, width, height, gen, lite, RENDER })` →
  `{ scene, camera, stage, post, R, setRecipe, syncEnv, renderAt, isReady,
  progress, duration, warmPhases, applyRender }`. La scène, la caméra, le
  plateau, la chaîne d'image, le volume de bruit, le studio, l'application de la
  recette, et `renderAt(u, { push, sub, free })` : la caméra du film, les
  uniformes, le brouillard, la mise au point. `RENDER` est passé par référence
  (le panneau de la page le modifie en place). `free` : caméra libre (la page la
  pose elle-même) ; `sub` : décalages d'un rendu accumulé ; `push` ∈ [0, 1) :
  la caméra avance vers ce qu'elle regarde (passages du relais).
- `main.js` : ce qui n'est qu'à la page — écran de chargement, panneau, URL,
  export, résolution dynamique, caméra libre (OrbitControls), outils `?debug`,
  boucle. Il crée le pool de workers et `RENDER`, puis le cœur.
- `day.js` : `meta = { id, name, subtitle, seed, enter }` et
  `createDay({ renderer, pipes, width, height, nextFrame })` → `makeDay(…)`
  (kit de `mega/src/kit.js`) : réglages par défaut, pas de mode léger, la
  graine d'ouverture de la page. `enter` choisit le passage par lequel on entre
  dans ce jour (`mega/src/transitions.js`), tiré de son geste.

Ce que le relais impose au cœur (une seule page tient plusieurs projets) :
rien ne lit la page (`location`, `document`, `innerWidth`, le canvas : tailles
par `renderer.domElement`) ; `G` (`shared/scene/globals.js`) est commun aux
jours, donc la phase précédente se garde localement (`lastPh`) ; tout calcul
lourd de la génération va dans le worker (une seconde de fil principal passe
sous un écran de chargement, elle fige le jour qui joue dans le relais) ; un
long calcul GPU de génération accepte un rythme (`nextFrame`, petits lots) ; ce
qui est créé hors de three.js (`device.createBuffer`) se rend par
`extraDispose`. Détail et pièges : `mega/README.md`.

## main.js : le contrat

- `renderAt(u, sub?)` : la caméra libre si elle est active, puis `core.renderAt(u, { sub, free })` (pose caméra, uniformes, scène, puis `post.update(...)` et `post.render()`). `sub` : décalages d'un rendu accumulé (lentille, pixel, lampe).
- `renderStep(u)` = `renderer._nodes.nodeFrame.update()` + `renderAt(u)` : tout rendu hors de `setAnimationLoop`.
- `tick(now)` : boucle (pause, cadence, résolution dynamique, chargement, FPS dans le panneau).
- Écran de chargement : géométrie complète → `warm()` (pipelines asynchrones, rendus aux phases qui comptent, `frustumCulled` coupé) → quelques images (historique TRAA) → fondu.
- Mode allégé fixé au chargement (`setLite` avant le premier matériau) ; en changer recharge la page.

## Paramètres d'URL et clavier (communs)

`?seed=…`, `#r=…`, `?ui=0`, `?mobile=1|0`, `?debug`, `?syncpipes` ; propres au projet : `?fast` (simulation grossière), `?export` (panneau d'export ouvert)…
Touches : N nouvelle scène, Espace pause, ← → pas à pas, H masquer l'interface, F plein écran ; propres au projet (S son, L légendes, A analogie, E export, P image).

## Outils de mise au point (`?debug`, `window.<nom>`)

Ils viennent de `shared/app/debug.js` (`createDebugTools`, branché par le gabarit) : le projet n'en réécrit aucun, il ajoute seulement les siens. `film(u0, u1, n)` filme un temps fort image par image ; `poster()` mesure l'épreuve de l'affiche (médiane, amplitude, part de noir) sur l'image affichée ; `size(w, h)` impose une taille d'image.

`shot(ph)` image fixe (12 rendus : historique TRAA), `send(nom)` image vers le collecteur, `sheet(graines, phases)` planche, `meter()` posemètre, `bench(ph, n)` temps GPU, `seam(u)` raccord, `run(s)` boucle à la main (panneau masqué), `renderAt`, `renderAccum`, `R`, `errors` (console.error capturées dès le chargement), `pipes`, plus ce qu'exige le thème (Hollow : `view(couche, x)` ; Membrane : `level(j, x)` ; Tesseract : `at('travel', 1, 0.5)`).
