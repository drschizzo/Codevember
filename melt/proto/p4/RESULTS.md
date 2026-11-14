# P4 : la pagode (eau salée stratifiée)

Variante salée du solveur de P0 (`simS.js`) :
- équation d'état linéaire ρ = ρ0[1 − α(T − T∞) + βS(S − S∞(z))], avec α = 10⁻⁴ °C⁻¹ et βS = 7,8·10⁻⁴ ;
- sel transporté, sans flux à travers la glace pleine ; la glace est douce, donc une maille qui fond donne de l'eau douce ;
- κS = κT/10, soit Le = 10 au lieu de ≈ 100, pour que la couche limite de sel reste résolue à 0,5 mm ;
- pas d'abaissement du point de fusion.

Le cas étudié : une colonne de 10 cm pend de la surface dans une eau à 10 °C, dont la salinité passe de 12 g/kg au fond à 4 en surface. Huppert et Turner prévoient des nappes d'épaisseur 0,65·Δρ_T/|dρ/dz| ≈ 15 mm.

```
node p4.js --name=pagode_F4 --F=4 --tmax=240
```

## Résultats (`out/pagode_F4.png`, 7 instants jusqu'à V/V0 = 0,5)

- **Les nappes se forment.** L'eau de fonte, douce et froide, monte le long de la glace, puis quitte la paroi en nappes horizontales légèrement inclinées vers le haut, empilées tout le long de la colonne. C'est l'image des ombroscopies de Huppert et Turner.
- **Leur espacement** est de 7 à 12,5 mm (minima de sel à 6 mm de la glace), 10 mm en moyenne, contre ≈ 15 mm prévus. C'est le bon ordre de grandeur. Le coefficient 0,65 est empirique, et notre Le est dix fois trop faible.
- **La glace, elle, ne se creuse pas en gradins.** Le profil reste lisse jusqu'à mi-fonte : aucun creux de plus de 0,15 mm. Le bas s'arrondit, le haut s'amincit.
- **La fonte est bien plus rapide qu'en eau douce**, à cause de la convection due au sel. 50 % fondent en 240 s simulées à F = 4, contre environ 400 s en eau douce à 8 °C.
- Le coût est le même qu'en eau douce, plus environ 15 % pour le second scalaire.

## Ce que cela change au concept

1. La famille **Pagode** tient, mais **son geste n'est pas dans la glace**. Il est dans l'eau : des nappes qui s'empilent et s'étalent autour d'une colonne lisse.
2. Ces nappes sont **visibles pour de vrai**. L'écart de sel (plusieurs g/kg) dévie la lumière environ deux mille fois plus que l'écart de température en eau douce, ce qui les rend nettes à l'ombroscopie. Elles le sont aussi dans une eau trouble, comme une eau plus claire. C'est la seule famille où l'eau de fonte elle-même se voit.
3. Elle remplace avantageusement la Colonne sans fin festonnée, abandonnée : c'est un empilement, mais dans l'eau autour de la glace.

## Limites

- Le = 10 au lieu de 100.
- Pas d'abaissement du point de fusion, pas d'équilibre de sel à l'interface (le modèle à trois équations).
- La boîte est fermée.
- Le cas n'a pas été couplé à l'avance de la colonne ni au cycle des saisons (P1).
- Les gradins de glace observés en laboratoire demandent peut-être une fonte plus longue, ou un Le réaliste.
