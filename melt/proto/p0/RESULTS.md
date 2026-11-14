# P0 : fonte axisymétrique d'un cylindre de glace, résultats

Porte de faisabilité de `docs/concept-pinacles.md`. Deux questions : la simulation reproduit-elle les trois régimes de Weady et al. (PRL 128, 044502, 2022), et combien coûte-t-elle ?

Verdict court. Les deux pointes sortent nettement, convergées en résolution et peu sensibles au gonflement de Stefan. Les festons ne sortent pas : à 5,6 °C on obtient un fût bombé avec une seule entaille sous le support, pas un train d'ondes. La colonne suspendue à 8 °C s'amincit au ras de la surface et s'en détache. Le coût est compatible avec un calcul au chargement à Δx = 0,5 mm, limite à Δx = 0,25 mm.

## Méthode

- Navier-Stokes Boussinesq incompressible en (r, z), sans swirl, grille MAC uniforme. Équation d'état ρ = ρ*[1 − β(T − T*)²], T* = 4 °C, β = 8·10⁻⁶ °C⁻². La flottabilité est gβ[(T − T*)² − (T∞ − T*)²].
- Projection : Poisson axisymétrique (opérateur en flux pondéré par r) résolu par multigrille, V-cycles avec Gauss-Seidel rouge-noir, prolongation bilinéaire, départ à chaud. Un seul V-cycle par pas suffit : les formes sont identiques au centième de millimètre près à celles obtenues avec deux (`c_A35_F4` contre `c_A35_F4b`), et la divergence résiduelle reste sous 10⁻⁵ U/Δx.
- Glace : méthode d'enthalpie. h = T dans l'eau ; h ∈ [−L/F, 0] dans une maille en fonte, à T = 0. La condition de Stefan est contenue dans le bilan d'énergie de la maille. L = ρ_i L/(ρ_w c_p) = 72,9 °C. Pas de conduction dans la glace (intérieur à 0 °C).
- Pénalisation de Brinkman −η f_s² u, implicite, η = 10⁶ s⁻¹, f_s = fraction solide moyennée sur la face.
- Advection MUSCL (limiteur de van Leer), forme conservative pour la température. Diffusion explicite. Euler explicite, dt = 0,16 Δx²/ν (limite visqueuse ; 0,2 divergeait sur l'axe).
- Bords : axe symétrique ; paroi externe, fond et surface en glissement libre et adiabatiques. Une éponge de 8 mm (couronne externe, plus tranches haute et basse) rappelle T vers T∞ en 2 s pour imiter un grand bain. Pour la colonne suspendue, pas d'éponge en haut : la surface est une paroi libre adiabatique que la glace touche.
- Support : mailles solides isolantes, du rayon de la glace, entre la glace et le bord (en haut ou en bas).
- Géométrie : cylindre de 2,8 cm de diamètre et 9 cm de haut, domaine de 4 cm de rayon et 14,4 cm de haut. Grilles 80 × 288 (Δx = 0,5 mm) et 160 × 576 (Δx = 0,25 mm).
- Ra = gβT∞²H³/(νκ). Avec H = 9 cm, Ra/T∞² = 2,4·10⁵ °C⁻², dix fois moins que l'article (2,5·10⁶, soit H ≈ 20 cm avec nos constantes). Une variante haute (H = 20 cm, domaine de 26 cm) atteint la valeur de l'article.
- F désigne le gonflement de St par rapport au physique : F = 4 donne St/T∞ = 0,055 °C⁻¹, la valeur de l'article ; F = 20 donne 0,27.

Code : `sim.js` (solveur), `run.js` (un cas, images et profils), `png.js`, `launch.sh` (tâche de fond), `prof.mjs`, `cmp.mjs`, `waves.mjs` (analyse), `bench.mjs` (coût).

## Sorties

Dans `out/`, pour chaque cas `<nom>` : `<nom>.png` (six instants à V/V0 = 1 ; 0,8 ; 0,6 ; 0,4 ; 0,25 ; 0,12 ; silhouette symétrisée), `<nom>.json` (profils r(z) de chaque instant et sondes de vitesse), `<nom>_profile.csv` (profil final), `<nom>.log` (grille, dt, pas, temps, ms/pas).

Lecture des images : glace en blanc ; support en gris ; eau colorée de cyan (0 °C) à presque noir (T∞) ; trait jaune = isotherme 4 °C (maximum de densité) ; traits clairs = lignes de courant ; trait rouge = contour initial.

Préfixes : `c_` grille 0,5 mm ; `f_` grille 0,25 mm ; `s_` balayage en température ; `n_` avec bruit thermique ; `w_` domaine de 8 cm de rayon ; `tall` colonne de 20 cm.

## Les régimes

### T∞ = 3,5 °C, glace tenue par le haut : pointe vers le bas. Oui.

`c_A35_F4.png`, `c_A35_F20.png`, `f_A35_F20.png`.

L'eau de fonte monte le long de la paroi. La couche limite est la plus mince en bas, donc la fonte y est la plus forte. Le cylindre devient un doigt effilé vers le bas. À V/V0 = 0,12 : r = 0,7 mm à z = 42 mm, 3 mm à 48 mm, 5 mm à 73 mm, 6 mm à 104 mm, 9 mm sous le support. Au milieu de la fonte, le retrait suit la loi de couche limite laminaire en h^(−1/4) : rapport 1,6 entre h = 14 mm et h = 83 mm, contre 1,56 attendu. L'eau froide s'accumule sous la surface et protège le haut, ce qui accentue la forme.

Écart avec l'article : notre pointe reste arrondie (rayon de l'ordre de 1 à 2 mm, quelques mailles). On ne voit pas l'affûtage en temps fini jusqu'à 100 µm. C'est attendu : la maille de 250 µm est trop grosse et la méthode d'enthalpie étale l'interface sur une maille. La loi κ ∝ (1 − t/tₛ)^(−4/5) n'est pas testable ici.

### T∞ = 5,6 °C, glace tenue par le haut : festons. Non.

`c_S56_F4.png`, `c_S56_F20.png`, `f_S56_F20.png`, `c_S56tall_F4.png`, `n_S56_F4.png`, `n_S56tall_F4.png`, `w_S56_F4.png`, `f_S56_F4.png`.

L'écoulement bidirectionnel est bien là. La sonde à mi-hauteur donne une couche montante de 2 mm contre la glace (0,2 mm/s), puis une couche descendante plus large (1 mm/s), l'isotherme 4 °C à 5 ou 6 mm de la paroi. Mais il reste stationnaire et laminaire. La glace prend une forme de fût, plus large au milieu, avec une seule entaille profonde sous le support (z ≈ 108 mm), qui finit en col. Aucun train d'ondes, et donc aucune mesure de λ(h).

Ce qui a été essayé, sans changer ce résultat :
- grille deux fois plus fine (0,25 mm) : même forme à 0,1 mm près ;
- colonne de 20 cm, au Ra de l'article : même structure, une entaille sous le support, puis détachement ;
- bruit thermique ambiant (0,05 °C/√s) pour amorcer une instabilité convective : écart de forme inférieur à 0,1 mm, le bruit est amorti ;
- domaine deux fois plus large (R = 8 cm) : même forme, 0,3 mm d'écart RMS.

Balayage en température (F = 4, grille 0,5 mm, `s_T*.png`) : 4,6 et 5,0 °C donnent la pointe vers le bas ; 5,3 °C un fût presque droit avec une faible entaille sous le support ; 5,6 °C le fût bombé ; 6,2 et 7,0 °C la pointe vers le haut, avec un col sous le support. Le changement de sens se fait donc entre 5,3 et 6,2 °C, ce qui est cohérent avec la fenêtre de l'article (5 à 7 °C). Mais entre les deux on obtient une forme de transition lisse, pas des festons.

Hypothèses, de la plus probable à la moins probable :
1. Le nombre de Reynolds de la couche cisaillée est très faible : ΔU ≈ 1,2 mm/s sur ≈ 3 mm donne Re ≈ 2. Une instabilité de Kelvin-Helmholtz ne peut pas croître à ce Re. Les festons de l'article viennent donc soit d'un écoulement plus vigoureux que le nôtre, soit d'un autre mécanisme (instabilité thermique de la couche bidirectionnelle, ou rétroaction forme-écoulement qui demande une interface plus nette que la nôtre). Ce point est à vérifier dans le matériel supplémentaire de l'article (vitesses, taille de domaine, η, épaisseur d'interface).
2. L'interface d'une maille de l'enthalpie, avec sa marche d'escalier, pourrait amortir la rétroaction entre une petite bosse de la glace et la couche limite. Le champ de phase de l'article a une interface lisse sur plusieurs mailles. Ce serait le prochain test : un champ de phase ou un level set avec flux interpolé à la position sous-maille.
3. La boîte. Elle est fermée, et l'eau de fonte mêlée (vers 3 à 4 °C, la plus dense) s'accumule au fond malgré l'éponge. Le domaine large ne change rien, ce qui rend cette piste moins probable.
4. Le gonflement de St : F = 4 et F = 20 donnent ici des formes différentes (voir plus bas), mais aucune des deux ne festonne.

Je n'ai pas réglé les paramètres pour faire apparaître des festons.

### T∞ = 8 °C, glace tenue par le bas : pointe vers le haut. Oui.

`c_C8_F4.png`, `c_C8_F20.png`, `f_C8_F20.png`, `c_C8_F1.png`.

L'eau de fonte, mêlée vers 4 °C, est plus dense et descend. La couche limite naît en haut, la fonte y est la plus forte, et le cylindre devient un cône dressé. À V/V0 = 0,12 : r = 8,7 mm au pied, 5,5 mm à mi-hauteur, 2,8 mm à 7 mm du sommet, sommet à z = 101 mm (contre 117 au départ). C'est la forme la plus propre des trois. Elle est convergée : 0,1 mm d'écart RMS entre 0,5 et 0,25 mm, et le même temps de fonte. Le sommet reste arrondi, pour la même raison qu'à 3,5 °C.

## Colonne suspendue à la surface, T∞ = 8 °C

`c_H8_F4.png`, `f_H8_F20.png`.

Oui, un col se forme, et il est exactement à la ligne d'eau. La couche limite descendante naît à la surface, donc le haut fond le plus vite. Le point le plus mince est toujours le point d'attache. Rayon à la surface et rayon maximal du fût (F = 4) :

| V/V0 | t (s) | r surface | r 5 mm sous la surface | r max du fût |
|---|---|---|---|---|
| 0,8 | 56 | 11,8 mm | 12,1 mm | 12,7 mm |
| 0,6 | 136 | 9,1 | 9,6 | 11,3 |
| 0,4 | 231 | 6,0 | 6,7 | 9,6 |
| 0,25 | 320 | 2,9 | 3,8 | 8,0 |
| 0,12 | 419 | 0 | 0 | 6,1 |

La colonne se sépare de la surface vers V/V0 ≈ 0,18, soit environ 370 s à F = 4 (environ 20 min en temps réel). Ensuite le corps libre devient un fuseau pointé vers le haut, avec un fond plat. Le fond plat est un artefact : notre glace détachée reste fixée par la pénalisation, alors qu'en vrai elle remonterait (et sa flottaison décide si elle bascule). La grille fine avec F = 20 donne le même scénario, avec la même chronologie relative.

Le col n'est donc pas un étranglement quelques centimètres sous la surface, avec un chapiteau au-dessus. C'est un amincissement continu vers la ligne d'eau. Pour obtenir un vrai col avec un chapiteau, il faudrait que le haut soit protégé, par exemple par un support ou une couche d'eau plus froide en surface. Ce cas est visible à 6,2 et 7 °C sous le support (`s_T6.2_F4.png`, `s_T7.0_F4.png`), et à 5,6 °C (entaille sous le support).

## Gonflement du nombre de Stefan

Écart de profil r(z) à volume égal (V/V0 = 0,12), et rapport des temps physiques :

| cas | comparaison | écart RMS | écart max | rapport de temps |
|---|---|---|---|---|
| 8 °C bas | F = 1 contre F = 4 | 0,12 mm | 0,8 mm | 3,5 |
| 8 °C bas | F = 4 contre F = 20 | 0,23 mm | 1,4 mm | 3,25 |
| 3,5 °C haut | F = 4 contre F = 20 | 0,49 mm | 2,0 mm | 4,2 |
| 5,6 °C haut | F = 4 contre F = 20 | 1,45 mm | 4,7 mm (6,6 mm en cours de fonte) | 3,4 |

Aux deux pointes, les formes sont pratiquement insensibles au facteur de Stefan : écarts inférieurs à une maille grossière en moyenne. Le régime intermédiaire, lui, est sensible. À 5,6 °C, le débit d'eau de fonte pèse dans la balance entre la couche montante et la couche descendante. Avec F = 20 le fût est plus droit et l'entaille sous le support plus tardive. Le temps n'est pas compressé du facteur F : F = 20 raccourcit la fonte d'environ 11,5 fois par rapport au physique (et non 20), parce que la chaleur sensible et le soufflage de l'eau de fonte comptent davantage quand St grandit.

## Coût

Mesures sur un seul fil Node 25 (machine chargée par d'autres calculs, donc plutôt pessimistes) :

| grille | dt | ms/pas (1 V-cycle) | ms/pas (2 V-cycles) | ns/maille |
|---|---|---|---|---|
| 80 × 288 (0,5 mm) | 0,0235 s | 1,8 | 2,4 | 76 |
| 160 × 576 (0,25 mm) | 0,0059 s | 6,9 | 9,1 | 75 |

La part sans projection coûte 44 ns par maille, un V-cycle 30 ns.

Pas nécessaires pour fondre 88 % du cylindre :
- 8 °C, F = 20 : 5 800 pas (0,5 mm), 23 600 pas (0,25 mm) ;
- 8 °C, F = 4 : 18 800 pas ; 8 °C, F = 1 : 66 500 pas (0,5 mm) ;
- 3,5 °C et 5,6 °C, F = 20 : 51 000 pas (0,25 mm), environ 8 min de calcul.

La grille de 0,5 mm suffit pour les deux pointes : 0,1 à 0,3 mm d'écart RMS avec la grille fine. La grille fine n'apporte rien sur les festons absents.

## Faisabilité au chargement dans le navigateur

Estimation pour une boucle d'environ 1 h physique d'une colonne alimentée, avec F = 20 (compression mesurée d'environ 11,5, donc environ 310 s simulées) :

| grille | pas par période | JS, un worker | WebGPU (estimation) |
|---|---|---|---|
| 0,5 mm | 13 000 | 23 s | 3 à 9 s |
| 0,25 mm | 53 000 | 6 min | 15 à 35 s |

L'estimation WebGPU n'est pas mesurée. Elle suppose environ 45 dispatchs par pas (advection, quantité de mouvement, enthalpie, un V-cycle sur 5 à 6 niveaux), soit 0,3 à 0,7 ms par pas, limité par le lancement des noyaux plutôt que par le calcul à ces tailles. Une boucle périodique demande en plus d'oublier la condition initiale, soit deux à trois périodes. Il faut donc multiplier ces chiffres par 2 ou 3.

Mon avis :
- À 0,5 mm, le calcul tient dans un écran de chargement : 1 à 2 min dans un worker, 10 à 30 s en WebGPU. Les deux pointes y sont bien rendues. C'est faisable.
- À 0,25 mm, c'est faisable en WebGPU seulement, et ce n'est utile que si la finesse des pointes compte à l'écran.
- Deux leviers sûrs, non testés ici : une viscosité implicite (le pas est limité par ν, pas par la CFL, qui permettrait 3 à 5 fois plus grand) et F = 20 ou plus aux régimes de pointe.
- Le blocage n'est pas le coût, c'est le régime de festons. La famille de concept qui en dépend n'a pas de simulation qui la produise aujourd'hui. Il faut soit un meilleur modèle d'interface (champ de phase lisse), soit le repli prévu par le plan (modèle de couche limite avec festons imposés, λ ∝ h^(−3/4)).
- La colonne alimentée et la périodicité (P1) n'ont pas été testées.

## Doutes sur la justesse

- Fuite de Brinkman : la vitesse maximale dans les mailles entièrement solides atteint 0,2 à 0,3 mm/s, contre 4 mm/s dans l'eau (5 à 8 %), aux mailles d'interface. La projection après pénalisation réintroduit un peu de vitesse dans le solide. Une projection pondérée par la porosité corrigerait cela.
- L'interface d'enthalpie fait une marche d'une maille, et le flux est évalué comme si la paroi était au centre de la maille de fonte. Le front avance par sauts d'une maille. C'est sans effet visible sur les pointes, mais c'est un suspect pour les festons.
- La boîte est fermée et l'eau froide stagne en bas ou en haut malgré l'éponge. La forme près des extrémités en dépend un peu, surtout à 5,6 °C.
- Ni la différence de densité glace-eau, ni la flottaison, ni le détachement ne sont modélisés : un morceau détaché reste en place.
- La sonde de vitesse et la loi en h^(−1/4) sont cohérentes avec la théorie de couche limite laminaire. Les temps de fonte (environ 25 min à 8 °C en temps réel pour 88 % d'un cylindre de 2,8 cm) sont plausibles, mais pas comparés à des mesures.
