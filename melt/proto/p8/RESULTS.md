# P8 : le réglage de l'avance et la planche du film

## Le réglage (solveur de P1, `../p1/out/p8/`)

Le but : réduire la part de la boucle « sans sujet », où moins de 15 mm de glace est sous l'eau. Avant ce réglage (P1, `meta_inter`), elle était d'environ 25 %.

| Cas | T∞ | avance | arrêt (phases) | sans sujet | détachement | écart 2→3 | fuseau libéré |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | 3 → 9 °C | 0,5 mm/s | 0,35 – 0,6 | 25 % | 0,592–0,594 | 0,14 mm | 1,4 cm³, 6,2 cm |
| b | 3 → 9 | 0,6 | 0,4 – 0,62 | 19 % | 0,609–0,612 | 0,26 | 2,7 cm³, 8,6 cm |
| **c** | **1,5 → 9** | **0,5** | **0,38 – 0,6** | **11 %** | **0,641–0,649** | **0,11** | **2,4 cm³, 7,7 cm** |
| d | 1,5 → 9,5 | 0,7 | 0,42 – 0,6 | 14 % | 0,610–0,613 | 0,17 | 7,7 cm³, 12,2 cm (bout à 4 cm du fond : trop long pour le domaine) |

**On retient c.** Un hiver plus froid ralentit la fonte, si bien que la colonne descend plus loin. Le détachement arrive plus tard (phase 0,645), et l'arrêt finit juste avant. La part sans sujet tombe à 11 %, et c'est justement le temps où le fuseau couché flotte et dérive dans le cadre.

Longueur immergée sur la boucle (mm), aux 16 phases : 38, 46, 57, 66, 74, 82, 87, 87, 86, 84, 82, puis le détachement, puis 8, 14, 19, 24, 30.

Le fuseau libéré fait D/L ≈ 0,08. Il est donc très élancé : c'est la famille du chavirement. Pour les familles de la révérence et du bouchon, il faudra une colonne plus épaisse et une avance plus lente. Cela reste à régler.

## La planche du film (`out/planche-nuit.jpg`, `out/planche-snell.jpg`)

Le rendu est le lancer de rayons de P3, avec la glace bulleuse (0,5 cm⁻¹) et le profil de la colonne tiré de la simulation c. Le fuseau libéré est une forme analytique, de la longueur et du volume mesurés, posée selon la trajectoire de P2 : incliné à 52° pendant la bascule, couché à 8,3 % émergé ensuite.

Les huit images :
1. **Hiver** (u = 0,02) : une souche courte au bout arrondi.
2. **Descente** (0,2).
3. **Printemps** (0,4) : la colonne longue, au bout arrondi.
4. **Été, arrêt** (0,55) : la colonne s'amincit vers la ligne d'eau et s'effile en bas.
5. **Le col** (0,635) : un fil de glace à la ligne d'eau.
6. **La bascule** (0,647).
7. **Couché** (0,72) : le fuseau flotte contre son reflet, et la souche est revenue.
8. **Renaissance** (0,86) : le fuseau sort du cadre, et la colonne redescend.

**Ce que la planche montre** :
- En humeur **Nuit**, le miroir de la surface double chaque forme. La colonne et son reflet font un fuseau symétrique. La bascule dessine un chevron avec son reflet, et le fuseau couché se referme sur le sien. C'est l'image la plus graphique de la série.
- En **Fenêtre de Snell**, on lit le mieux le récit : la colonne qui sort du disque du ciel, le col, la chute de biais, le fuseau à la surface.
- Les images 1 à 3 changent peu d'une à l'autre : la colonne s'allonge, et son bout reste arrondi. Le geste de l'hiver est faible.

## Limites

- Le fuseau est analytique, pas le vrai profil au détachement.
- La bascule est posée image par image : P2 est en 2D, la scène la fera en 3D.
- Il n'y a ni vaguelettes à la surface, ni brise visible.
