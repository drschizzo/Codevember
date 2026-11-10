# Architecture

Sans étape de construction : modules ES servis tels quels, `importmap` vers three@0.186.1 (WebGPU + TSL), lil-gui@0.20.0, mp4-muxer@5.1.3 (chargé à la demande). Serveur de développement : `.claude/serve.py <port> <dossier>` (sans cache), déclaré dans `.claude/launch.json` (l'échafaudage s'en charge), lancé par `preview_start`.

## Arborescence

```
<projet>/
  index.html            importmap, titre, indice clavier, toast, progression d'export, écran de chargement
  style.css             commun (verre dépoli, Fraunces + Inter) — copié de Tesseract
  README.md             documentation complète (modèle : les quatre projets)
  docs/capture.jpg      image de la page d'accueil du dépôt
  src/
    main.js             intégration : moteur, recette, chargement, renderAt, export, clavier, ?debug
    recipe.js           graine → recette JSON : humeurs, accords, tirages, upgrade()
    rng.js              sfc32, fork, pick, weighted, gauss, dir, bruit CPU, jitter (rendu accumulé)
    finishes.js         ~40 finitions (F0 mesurés) et ~30 jeux [externe, interne, tranche]
    app/ui.js           panneau lil-gui (ne connaît que la recette, les réglages et des rappels)
    app/settings.js     qualités (Mobile, Brouillon, Standard, Haute, Cinéma), réglages mémorisés
    app/mobile.js       détection, résolution dynamique, cadence plafonnée, gestes tactiles
    app/capture.js      PNG, MP4 H.264 image par image (WebCodecs + mp4-muxer)
    render/post.js      chaîne d'image (pré-passe, GTAO, MRT, SSR, TRAA, flou, DoF, bloom…)
    render/accum.js     rendu accumulé (moyenne de N rendus décalés)
    scene/globals.js    uniformes partagés (phase, image, micro-relief…)
    scene/materials.js  matériau TSL d'une pièce à trois finitions, volume de bruit, mode allégé
    scene/env.js        studio HDR calculé (boîtes à lumière, bandes, rebond du sol), par humeur
    scene/rig.js        déformation des sommets (pièces articulées)
    scene/stage.js      (gabarit) lumières, sol, pièces ; à remplacer par la scène du thème
    gen/worker.js       constructeurs (géométrie, simulation CPU) hors du fil principal
    gen/client.js       pool de workers avec cache
    gen/mesh.js         tampons de maillage et primitives (attributs position, normal, tangent, surf)
    gen/noisevol.js     volume de bruit périodique 128³ (Perlin ×2, Worley F1, F2−F1)
  test/*.test.mjs       invariants (node --test), sans navigateur
  tools/                bancs d'essai Node, collecteur d'images (sink.py)
```

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

## main.js : le contrat

- `renderAt(u, sub?)` : pose caméra, uniformes, scène, puis `post.update(...)` et `post.render()`. `sub` : décalages d'un rendu accumulé (lentille, pixel, lampe).
- `renderStep(u)` = `renderer._nodes.nodeFrame.update()` + `renderAt(u)` : tout rendu hors de `setAnimationLoop`.
- `tick(now)` : boucle (pause, cadence, résolution dynamique, chargement, FPS dans le panneau).
- Écran de chargement : géométrie complète → `warm()` (pipelines asynchrones, rendus aux phases qui comptent, `frustumCulled` coupé) → quelques images (historique TRAA) → fondu.
- Mode allégé fixé au chargement (`setLite` avant le premier matériau) ; en changer recharge la page.

## Paramètres d'URL et clavier (communs)

`?seed=…`, `#r=…`, `?ui=0`, `?mobile=1|0`, `?debug`, `?syncpipes` ; propres au projet : `?fast` (simulation grossière), `?export` (panneau d'export ouvert)…
Touches : N nouvelle scène, Espace pause, ← → pas à pas, H masquer l'interface, F plein écran ; propres au projet (S son, L légendes, A analogie, E export, P image).

## Outils de mise au point (`?debug`, `window.<nom>`)

`shot(ph)` image fixe (12 rendus : historique TRAA), `send(nom)` image vers le collecteur, `sheet(graines, phases)` planche, `meter()` posemètre, `bench(ph, n)` temps GPU, `seam(u)` raccord, `run(s)` boucle à la main (panneau masqué), `renderAt`, `renderAccum`, `R`, `errors` (console.error capturées dès le chargement), `pipes`, plus ce qu'exige le thème (Hollow : `view(couche, x)` ; Membrane : `level(j, x)` ; Tesseract : `at('travel', 1, 0.5)`).
