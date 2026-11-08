# Codevember

Expériences de creative coding, publiées sur [drschizzo.github.io/Codevember](https://drschizzo.github.io/Codevember/).

## [Tesseract](tesseract/)

Le cabinet replié : un écrin de huit cubes posé à plat en patron se replie dans une quatrième direction pour former un hypercube, tourne d’un quart de tour en 4D (le cube intérieur passe à l’extérieur), puis se déplie. Scènes procédurales à partir d’une graine, matériaux physiques (three.js WebGPU / TSL), boucle parfaite exportable en MP4, et des aides pour suivre le pliage : fantôme de la forme pliée, liserés des faces appariées, profondeur 4D en couleur, analogie 3D.

[Démo en ligne](https://drschizzo.github.io/Codevember/tesseract/) · [documentation](tesseract/README.md)

[![Tesseract](tesseract/docs/capture.jpg)](https://drschizzo.github.io/Codevember/tesseract/)

## [Hollow](hollow/)

Une plongée sans fond : des coquilles creuses emboîtées — alvéoles, fentes, surfaces minimales, géode — générées de façon procédurale à partir d’une graine, rendues en matériaux physiques (three.js WebGPU / TSL) et animées en boucle parfaite, exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/hollow/) · [documentation](hollow/README.md)

[![Hollow](hollow/docs/capture.jpg)](https://drschizzo.github.io/Codevember/hollow/)

## [Planétaire](planetaire/)

La vie d’un système planétaire, du nuage à la supernova, simulée sur GPU (WebGPU, three.js TSL) et présentée comme portée par un planétaire en laiton. Chaque grain de poussière conserve son rayon de naissance, qui détermine sa couleur ; le disque peut être sonifié comme un vinyle.

[Démo en ligne](https://drschizzo.github.io/Codevember/planetaire/) · [documentation](planetaire/README.md)

[![Planétaire](planetaire/docs/capture.jpg)](https://drschizzo.github.io/Codevember/planetaire/)

## Déploiement

Le site est publié par GitHub Actions (`.github/workflows/pages.yml`) à chaque push sur `main`.
