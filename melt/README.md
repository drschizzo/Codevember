# Melt

<!-- Deux ou trois phrases : l'image, le geste, pourquoi la boucle est parfaite par construction. -->

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène, et l'on peut en générer autant que l'on veut.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…` (une scène), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?mobile=1` / `?mobile=0` (version mobile imposée / interdite), `?debug` (outils dans `window.melt` : `shot(phase)`, `send(nom)`, `sheet(graines)`, `meter()`, `bench()`, `seam()`).

Le panneau règle tout : <!-- dossiers, du général au particulier -->.

L'export produit une boucle MP4 (H.264) rendue image par image, éventuellement en rendu accumulé (8 à 64 passes : vrai flou de mouvement, profondeur de champ, anticrénelage), et une image PNG.

## Principe

<!-- Le geste et la boucle : la formule qui rend la boucle parfaite. -->

## Génération (`src/gen/`, dans des Web Workers)

## Matériaux (`src/scene/materials.js`)

## Scène

- **Humeurs** :
- **Direction artistique** (`src/recipe.js`) :
- **Lumière** :
- **Post-traitement** :

## Tests

```bash
node --test 'melt/test/*.test.mjs'
```

## Performances

<!-- Mesuré à … Mpx en qualité Haute, graine … : … ms par image ; postes principaux. -->

## Version mobile

<!-- Ce qui change, du plus au moins coûteux ; différences visibles. -->
