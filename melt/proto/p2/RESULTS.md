# P2 : le fuseau libéré bascule

Corps rigide plan (x, y, θ). Le profil est un fuseau de 7 cm, au bout émoussé en bas et effilé vers le haut (la forme de la colonne suspendue de P0 à 8 °C), avec D/L = 0,19.

Ce que le modèle prend en compte :
- la poussée d'Archimède exacte par tranches : chaque disque est coupé par le plan d'eau, et le centre de poussée est le centroïde du segment immergé ;
- la masse ajoutée et l'inertie ajoutée d'un corps élancé ;
- la traînée quadratique par tranche ;
- l'amortissement du pilonnement, du roulis et du tangage par les vagues rayonnées (ζ = 0,15) ;
- un contact sans frottement avec la souche, c'est-à-dire la colonne restée à la ligne d'eau.

```
node p2.js --name=libre --nostub --tilt=8 --T=8
node p2.js --name=souche --tilt=8 --Uc=0.01 --T=8
```

## Résultats

**Libre (sans souche), `out/libre.png`** :
- Le corps remonte, s'incline, et passe 45° à **t = 0,53 s**.
- Il dépasse jusqu'à ≈ 105°, revient, et se couche à l'horizontale en ≈ 1,5 s.
- À l'équilibre, **8,3 % de son volume émerge**, la valeur exacte (1 − 0,917).
- Il dérive avec le courant de surface.

Le geste est franc, rapide et amorti : c'est le temps fort du film. Il se filme en temps réel, avec un ralenti au contact du miroir.

**Avec la souche, `out/souche.png`** :
- Le corps bascule de la même façon (45° à t = 0,46 s).
- Il s'enfonce d'au plus 0,11 mm dans la souche : le contact reste propre.
- Mais il finit couché **juste sous la souche**, maintenu à 5 % émergé, et ne s'en dégage pas, même avec un courant de 1 cm/s.

Ce coincement vient du modèle plan :
- le courant pousse le long de l'axe du corps couché, là où sa traînée est la plus faible ;
- le corps ne peut pas s'échapper hors du plan.

En trois dimensions, un contact ponctuel sans frottement ne retient rien contre une dérive latérale. Il reste que la souche est juste au-dessus du point où le corps se couche : sans courant, ou par vent nul, il resterait contre elle.

## Ce que cela impose au film

1. **La bascule est crédible et lisible** en une demi-seconde, avec un dépassement visible et un retour amorti.
2. **Il faut un courant de surface** (une brise), modéré, perpendiculaire au plan de la caméra ou de biais, pour que le fuseau dégage la souche et dérive hors du cadre. Ce n'est pas une liberté : la brise est naturelle et se montre par les rides de la surface. Elle vit dans la même horloge que le reste.
3. **Le basculement doit partir d'une inclinaison du col** (une fonte asymétrique, ou un pont de glace qui cède d'un côté). Plus l'inclinaison de départ est forte, plus le corps s'écarte de la souche en se couchant (15 mm contre 2 mm entre 15° et 1°).
4. Le prochain pas, dans la scène elle-même, est un corps rigide en 3D (six degrés de liberté) avec le même modèle de forces, plus la dérive par le courant.

## Limites

- Le modèle est plan.
- Il n'y a ni vagues calculées, ni fonte du fuseau pendant la bascule (elle dure 1 s, contre des minutes pour la fonte).
- La souche est un cône idéal.
- Le profil du fuseau est analytique ; P1 devra fournir la vraie forme au détachement.
