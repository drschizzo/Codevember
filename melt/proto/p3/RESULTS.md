# P3 : la glace se voit-elle dans l'eau ?

Prototype de rendu sans three.js : un seul shader WebGPU qui lance des rayons sur une colonne de glace de révolution à profil fixe (aiguille, festons, col), sans simulation. Les indices sont les vrais : glace 1,309, eau 1,333, air 1. Une image de 1280 × 800 à 16 passes se calcule en moins de 0,1 s.

```
http://localhost:8120/melt/proto/p3/index.html?mood=nuit&shape=festons
```

Les images sont dans `out/`. Les profils sont dessinés à la main d'après la description de Weady et al. ; ils ne sortent pas de P0.

## Verdicts

**1. La glace claire est invisible dans l'eau** (`out/1-glace-claire-6-humeurs.jpg`).

Dans les six humeurs, on ne voit que le cœur laiteux et les chapelets de bulles. La forme taillée (les festons, la pointe, le col) disparaît, ce qui est le vrai comportement physique :
- le liseré de réflexion totale existe, mais il ne fait que 1,8 % du rayon (≈ 0,2 mm, un pixel) ;
- la réflexion vaut 10⁻⁴ ailleurs ;
- devant le mur de pierre, la déviation du fond par la glace est imperceptible.

Seules les eaux troubles (Lait glaciaire, Tourbe) laissent deviner la silhouette, en « trou » dans le brouillard : la glace ne diffuse pas, l'eau autour si.

**2. La glace bulleuse se lit partout** (`out/2-claire-contre-bulleuse.jpg`, `out/3-gros-plans-densite.jpg`).

Dès un coefficient de diffusion de 0,5 cm⁻¹ (une glace de lac ou de névé, à petites bulles), la forme se lit dans toutes les humeurs : festons, col, pointe. Elle est modelée par la lumière qui traverse la glace et diffuse dedans.

Le risque est l'aspect plâtre ou polystyrène à 1,6 cm⁻¹. À 0,5 cm⁻¹, la glace reste translucide et les bulles se voient en profondeur. C'est le meilleur réglage, mais il manque encore des indices de « glace mouillée » :
- un reflet spéculaire net ;
- des zones claires ;
- des bulles plus grosses qui accrochent la lumière.

**3. L'ombroscopie de la glace est l'image la plus forte** (`out/4-ombroscopie-glace.jpg`, et la ligne Ombroscopie de la planche 2).

Un faisceau parallèle traverse la colonne. La glace, d'indice relatif 0,982, agit comme une lentille divergente : sur le mur, son ombre devient un objet d'argent poli, festons et col compris. C'est très lisible et très beau, et c'est physiquement exact. La seule approximation est le jacobien évalué au point d'arrivée, qui ne montre pas la frange claire rejetée hors de l'ombre.

Avec un faisceau oblique, l'ombre tombe à côté de la colonne. On voit les deux dans le même cadre : l'objet presque invisible et son ombre très nette. Cela rejoint le geste de Mirage (le même objet deux fois, dont un seul se voit).

**4. Le panache d'eau de fonte ne se voit pas à l'ombroscopie** (`out/5-ombroscopie-couche-limite-seule.jpg`).

Entre 0 et 10 °C, l'indice de l'eau ne varie que de 2,6·10⁻⁶ par °C. Pour une couche limite de 1 à 2 mm à 5,6 °C :
- avec 11 cm entre la colonne et le mur, la couche limite seule ne laisse aucune trace visible ;
- à 1 m de distance, il reste un fil à peine visible.

L'idée du concept (« le panache de sa propre eau de fonte qui la double comme une ombre mouvante ») **n'est pas crédible dans l'eau douce**. Elle le reste dans l'eau salée (famille Pagode) : 35 g/kg de sel donnent Δn ≈ 6·10⁻³, deux mille fois plus.

## Ce que cela change au concept

1. **La glace du sujet est bulleuse**, autour de 0,5 cm⁻¹. Ce n'est plus une glace claire à cœur laiteux. C'est la glace d'un lac ou d'un glacier, et le seul choix qui fait voir la forme.
2. **La cause visible de l'écoulement n'est plus l'ombroscopie du panache.** Ce sont les bulles libérées par la fonte : elles quittent la surface quand elle les atteint, puis la couche limite les entraîne (vers le haut en eau froide, vers le bas en eau chaude, avant qu'elles ne remontent au large). Ce traceur est naturel, et il dit le sens de l'écoulement, qui est tout le sujet.
3. **L'ombroscopie devient une humeur, la plus graphique.** Une lumière parallèle et oblique (un soleil bas dans une eau claire, ou une lampe hors champ), avec l'ombre de lentille de la glace sur un fond clair. Pour qu'elle soit vraie au soleil, il faut la refaire avec un faisceau descendant (le soleil, dans l'eau, est à plus de 41° sous l'horizontale) et une ombre sur le fond plutôt que sur un mur.
4. **L'eau salée (Pagode)** est la seule famille où les nappes d'eau de fonte se voient directement en ombroscopie.

## Limites du prototype

- Les profils sont dessinés, pas simulés.
- La couche limite est un champ synthétique (T = T∞(1 − e^(−d/δ)), δ ∝ s^(1/4)).
- La diffusion dans la glace est simple : isotrope, ombre calculée le long d'une corde horizontale.
- Il n'y a ni ménisque, ni caustiques sur la glace, ni rayons de soleil volumétriques.
- Les humeurs Lait et Tourbe sont encore trop plates.
