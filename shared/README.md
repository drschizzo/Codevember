# shared : les modules communs aux projets

Tout ce qui ne dépend pas du thème d'une scène vit ici, une seule fois. Les
projets l'importent par un chemin relatif (`../../shared/rng.js` depuis
`<projet>/src/`), sans étape de construction : le navigateur, Node (tests et
bancs) et les workers lisent les mêmes fichiers. L'arborescence reprend celle
de `<projet>/src/`.

| Module | Rôle |
| --- | --- |
| `style.css` | interface commune (verre dépoli, Fraunces + Inter), liée par `../shared/style.css` |
| `rng.js` | hasard à graine (`sfc32`), `fork`, tirages, bruit CPU, décalages du rendu accumulé |
| `finishes.js` | finitions (F0 mesurés) et jeux `[externe, interne, tranche]` |
| `app/mobile.js` | détection, résolution dynamique, cadence plafonnée, gestes tactiles |
| `app/capture.js` | PNG, MP4 H.264 image par image (WebCodecs + mp4-muxer) |
| `app/loader.js`, `app/loaderWorker.js` | écran de chargement ; le dessin du thème reste dans `<projet>/src/app/loaderArt.js` |
| `app/warmup.js` | pipelines asynchrones, préparation sans gel |
| `app/debug.js` | outils de mise au point (`?debug`) : image fixe, collecteur, planches, film, posemètre, épreuve de l'affiche, temps d'image, raccord ; `sleep` sans minuterie ; recette dans l'ancre |
| `render/post.js` | chaîne d'image (GTAO, SSR, TRAA, MSAA, flou, profondeur de champ, bloom, étalonnage, grain) |
| `render/accum.js` | rendu accumulé |
| `scene/globals.js` | uniformes partagés (phase, image, micro-relief) |
| `scene/materials.js` | matériau TSL d'une pièce à trois finitions |
| `scene/rig.js` | déformation des sommets |
| `scene/env.js`, `gen/envmap.js` | studio HDR calculé |
| `gen/client.js` | pool de workers avec cache ; le worker du thème reste dans `<projet>/src/gen/worker.js` |
| `gen/mesh.js` | tampons de maillage et primitives |
| `gen/noisevol.js` | volume de bruit périodique |

Deux modules trouvent un fichier du projet par convention, depuis l'adresse de
la page (`document.baseURI`) : `app/loader.js` charge `src/app/loaderArt.js`,
`gen/client.js` lance `src/gen/worker.js`.

## Ce qui reste dans un projet

- Ce qui est propre au thème : `recipe.js`, `main.js`, `app/ui.js`,
  `app/settings.js` (réglages par défaut et clé de stockage), `app/loaderArt.js`,
  `gen/worker.js`, la scène.
- **Une variante locale d'un module commun**, quand un projet a besoin d'un
  comportement que les autres n'ont pas (l'objectif à hublot de Kelp dans sa
  chaîne d'image, les finitions de verre de Shatter…). Le fichier garde son nom
  et sa place (`<projet>/src/render/post.js`) et le projet n'importe pas celui
  d'ici. `npm run check` signale une copie devenue identique à l'original.

## Changer un module d'ici

Un changement ici touche tous les projets qui l'importent : aucun ne doit
changer d'image sans qu'on l'ait voulu.

1. **Ajouter, ne pas modifier.** Une nouveauté entre par une option dont la
   valeur par défaut redonne exactement l'ancien rendu (`createPost(…, { haze })`,
   `cfg.msaa` absent = pas de MSAA). Un comportement qui ne peut pas être une
   option reste une variante locale du projet qui le demande.
2. **Tests** : `npm test` (dont `shared/test/`, qui fige les tirages de `rng.js` :
   les changer changerait toutes les scènes de toutes les graines).
3. **Images avant / après** : `tools/regress.html` rend chaque projet à taille
   et phases fixes, `tools/regress.py` compare les deux séries au bruit propre
   de chaque rendu.

   ```bash
   git worktree add /tmp/avant HEAD                    # l'état d'avant, à part
   python3 tools/sink.py /tmp/regress 8199 &           # collecteur d'images
   (cd /tmp/avant && python3 .claude/serve.py 8121 .) &
   python3 .claude/serve.py 8120 . &
   # ouvrir http://localhost:8121/tools/regress.html?out=avant puis ?out=bruit
   # ouvrir http://localhost:8120/tools/regress.html?out=apres
   python3 tools/regress.py /tmp/regress/avant /tmp/regress/apres --bruit /tmp/regress/bruit --planche /tmp/regress/ecarts.jpg
   ```

   L'en-tête de `tools/regress.html` dit ce qui rend les deux séries
   comparables (serveur sans cache, onglet au premier plan, machine au repos).

   Une image signalée se regarde (`--planche`) : un liseré sur les contours ou
   des particules qui bougent seules sont du bruit ; sinon l'écart est soit voulu (et alors le projet
   concerné est nommé dans le commit), soit une régression.
