# Documentation : README, page « défis techniques », entrée de l'accueil

Chaque projet publie trois choses en plus de la scène, et les **tient à jour** à chaque modification du projet, dans le même commit que le code :

| Quoi | Où | Pour qui |
| --- | --- | --- |
| README | `<projet>/README.md` | le dépôt : utilisation, principe, génération, matériaux, scène, tests, performances, mobile |
| Page « défis techniques » | `<projet>/explainer.html` | le site : un article illustré, lien « documentation » de l'accueil |
| Carte de l'accueil | `index.html`, `home/<nom>-art.jpg`, `home/<nom>-scene.jpg`, `README.md` racine | la page d'accueil et le dépôt |

## La page « défis techniques » (`explainer.html`)

L'échafaudage la pose depuis `template/explainer.html` (structure, en-tête, sommaire, une section et une démo d'exemple, budget, pied). Modèle complet à lire avant d'écrire : **`tangle/explainer.html`** ; d'autres exemples : `orrery` (`planetaire_v2/explainer.html`), `moss/`, `melt/`, `tesseract/`.

**Ce qu'elle raconte.** Les défis *propres au projet*, du cœur du sujet vers le rendu : 6 à 9 sections, puis « Budget ». Pas les généralités communes à tous les projets (panneau, export MP4, chaîne d'image standard), sauf si elles ont ici une solution particulière.

**Comment.** Le ton d'un article technique sérieux, pour un développeur graphique curieux :
- chaque section est un défi, avec un **titre qui affirme** (« La came est usinée d'après le plan », pas « Came ») et le fichier source en étiquette (`<span class="src">src/gen/rod.js · inextensible()</span>`) ;
- le problème concret, **pourquoi l'approche naïve échoue**, puis la solution retenue et ses constantes réelles ;
- précis et dense : vrais nombres (pas, tailles, seuils, temps mesurés), formules en LaTeX (KaTeX, `\( \)` et `\[ \]`) quand elles éclairent, un court extrait de code quand une ligne dit tout ;
- voix impersonnelle, sûre, sans superlatifs ; encadrés `.note` (idée), `.note.trap` (piège rencontré), `.note.check` (ce qu'un test ou une mesure vérifie) ;
- **rien d'inventé** : chaque nombre vient du code, du README, d'un test ou d'une mesure faite pour l'occasion (et dite comme telle). Les pièges racontés dans les commits et dans `docs/concept.md` sont la meilleure matière.

**Des démos interactives**, au moins cinq, sous les idées clés : canvas 2D (jamais WebGPU), curseurs, boutons, glisser, avec l'API de `home/explainer.js` (`demo('#fig-id', { title, aspect, controls, buttons, animate, setup, draw, pointer })`, aides `C`, `label`, `arrow`, `alpha`, `lerp`, `clamp`, `smooth`, `rng`, `TAU`). **Importer les modules purs du projet** (`import { … } from './src/gen/….js'`) plutôt que les recopier : la démo reste juste quand le code change. Chaque légende dit ce que la démo simplifie. Une démo lourde se calcule à demi-résolution dans un canvas hors écran ; un calcul de plus d'une seconde va dans un worker.

**Contraintes.** Style commun `home/explainer.css` (ne pas le modifier pour un projet : un style propre va dans un `<style>` local). Couverture `docs/capture.jpg` à ses dimensions réelles (`sips -g pixelWidth -g pixelHeight`). Liens vers le README et `docs/concept.md` **en URL GitHub** (`https://github.com/drschizzo/Codevember/blob/main/<projet>/README.md`) : la publication exclut les `.md` et `tools/` (voir `.github/workflows/pages.yml`) — une démo ne peut donc rien importer de `tools/`.

**Vérification.** Le panneau de navigateur masqué donne des captures périmées : capturer la page entière en Chrome sans tête depuis un serveur qui sert tout le dépôt (`site` dans `.claude/launch.json`, port 8120) :

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --user-data-dir=$(mktemp -d) --window-size=900,9000 --virtual-time-budget=8000 \
  --screenshot=<scratchpad>/explainer.png http://localhost:8120/<projet>/explainer.html
```

Un profil Chrome neuf par capture (deux captures sur le même profil échouent sans message) ; au-delà de ~16 000 px de haut, la capture échoue : capturer en deux fois. Découper en tuiles de ~1 500 px et les regarder toutes : chaque démo dessinée, aucun texte superposé, aucun débordement, formules rendues. Contrôler les erreurs JS par un piège temporaire (`addEventListener('error', …)` qui écrit dans la page), retiré ensuite. Le temps virtuel n'avance presque pas les animations : vérifier leurs états avancés par un paramètre provisoire, ou dans Node.

## Maintenir

Toute modification d'un projet qui change ce que la page affirme (une constante, un algorithme, un piège corrigé, une mesure du budget) met à jour **dans le même commit** le README et `explainer.html`. Avant de committer, relire les sections touchées et recapturer la page si une démo importe un module modifié. Une page qui contredit le code est un bug. Quand un mécanisme est retiré ou remplacé, cherche ses mentions dans le README, `explainer.html` et `docs/concept.md` (noms de fonctions, chiffres, « vérifié ») et réécris-les ; n'écris pas qu'une chose est vérifiée si aucun test ou mesure ne la vérifie, et dis ce qui reste non résolu.

## La carte de l'accueil et l'écran de chargement

L'accueil (`index.html` à la racine) montre chaque jour par **le dessin de son écran de chargement**, remplacé au survol par une image de la scène. Un projet sans écran de chargement dessiné (le calcul ou le sujet, propre au thème, voir interface.md) n'a pas sa place sur l'accueil : le texte seul « préparation de la scène… » ne suffit pas.

1. **Vignettes** `home/<nom>-art.jpg` (le dessin du chargement, pris quand le geste est bien engagé, vers 40 à 70 % de l'avancement) et `home/<nom>-scene.jpg` (une belle image de la graine par défaut), **640 × 400**, JPEG de 20 à 50 Ko. Le dessin du chargement vit dans un worker (`OffscreenCanvas`) : Chrome sans tête ne le dessine pas (le temps virtuel ne fait pas tourner le worker) ; le capturer dans le panneau de navigateur visible, ou faire envoyer une image par `loaderArt.js` en `?debug` au collecteur (`tools/sink.py`).
2. **Carte** dans `index.html`, à la suite des autres et sur leur modèle exact : `<li class="day" id="dNN" data-dir="<dossier>">`, le lien vers la scène (dessin `.art`, image `.scene` en `data-src`), `Day NN` (numéro du jour de novembre du thème), le nom, l'accroche en italique (`.tag`), une phrase « ce qu'on voit : comment c'est calculé » (`.how`), puis les deux liens `.lite` : `version légère` (`<dossier>/?mobile=1`) et `documentation` (`<dossier>/explainer.html`).
3. **README racine** : une section `## [Nom](<dossier>/)` en tête de liste, sur le modèle des autres (phrase, liens Démo en ligne · version légère · documentation · concept, capture).
