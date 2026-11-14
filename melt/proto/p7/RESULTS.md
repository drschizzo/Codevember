# P7 : les nappes du fjord se voient-elles ?

Le rendu est le lancer de rayons de `../p3/p3.js`, nourri par les champs de P6 (cas C, `../p6/out/fjord_C_fields.json`) :
- l'écart de sel au large, S − S∞ ;
- la fraction de glace ;
- deux phases : l'été (u = 0,5, 10 °C, 9 nappes) et l'hiver (u = 0, 3 °C, aucune nappe).

Le profil de la glace est tiré de la fraction de glace, et l'indice de l'eau suit n = n0 + 1,9·10⁻⁴·(S − S∞).

Quatre façons de voir les nappes ont été mises en place :
1. **Plein soleil** : l'ombre portée sur un fond de sable. Faisceau parallèle descendant (le soleil dans l'eau), déplacement intégré le long du faisceau, intensité par le jacobien.
2. **Contre-jour** : les rayons de la caméra sont déviés en traversant les nappes, devant un mur de pierre texturé.
3. **Farine de roche** : l'eau de fonte est limpide (fraction c = −ΔS/S∞), dans une eau trouble.
4. **Nuit** : déviation des rayons, avec une boîte à lumière.

Pour chaque cas, on compare le rendu avec les nappes au même rendu où S − S∞ = 0, la glace restant identique.

## Résultats

| Humeur | écart au 99,5ᵉ centile (été) | où |
| --- | --- | --- |
| Plein soleil | 10 / 255 | au bord de l'ombre de la glace |
| Contre-jour | 16 | au contour de la glace |
| Farine de roche | 1 | nulle part |
| Nuit | 70 | au contour de la glace |

**Les nappes ne se voient dans aucune des quatre humeurs** (`out/1-…jpg`, `out/2-…jpg`).
- Tout l'écart mesuré se trouve au contour de la glace. C'est la gaine d'eau douce, collée à la paroi, qui dévie la lumière et fait onduler la silhouette.
- L'hiver, sans nappes, l'écart est même plus grand.
- Le fond vu à travers les nappes, à côté de la colonne, ne bouge pas.
- Au soleil, le faisceau descend à plus de 41° sous l'horizontale. Il traverse les nappes, horizontales, presque de face, et elles ne le dévient presque pas.

**Même en ombroscopie de laboratoire** (`out/3-…jpg`), c'est-à-dire un faisceau horizontal, un écran à 1 m et des différences finies sur 2 à 4 mailles :
- les nappes n'apparaissent qu'en ondulations pâles, en arcs à côté de la moitié haute de la colonne ;
- l'image est dominée par l'ombre de lentille de la glace : un fuseau sombre, avec des bandes de lumière là où le profil change ;
- les artefacts de grille (rayures, hachures) sont du même ordre que les nappes avec un pas de 0,4 mm. Il faut lisser le champ ou l'interpoler en bicubique.

## Pourquoi

- L'écart de sel d'une nappe est fixé par l'écart de température, et non par la stratification : ΔS ≈ 0,65·Δρ_T/(ρ0 βS) ≈ 0,8 g/kg, soit Δn ≈ 1,6·10⁻⁴.
- Une nappe ne s'étend qu'à 1 ou 2 cm de la glace, sur quelques millimètres d'épaisseur.
- Un rayon qui la traverse est dévié de quelques milliradians au plus, ce qui donne quelques dixièmes de millimètre sur un fond à 10 cm.
- Les photographies de Huppert et Turner montrent ces nappes parce qu'elles sont prises en ombroscopie, avec un faisceau horizontal, une grande distance et des cuves plus grandes.

## Conclusion

À l'échelle d'une colonne de quelques centimètres et en lumière naturelle, **ni l'eau douce (P3, P5) ni l'eau salée (P7) ne montrent l'eau de fonte**. Le fjord n'apporte donc pas, à l'image, ce qui justifiait son choix.

Il reste trois choses visibles :
- la forme de la glace ;
- la gaine d'eau douce au contour, qui fait onduler la silhouette ;
- et, en ombroscopie, l'ombre de lentille de la glace, très graphique, avec les nappes en ondulations pâles.
