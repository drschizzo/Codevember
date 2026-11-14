# Melt — document de travail (version de la colonne de glace, abandonnée)

> **Abandonnée le 14 novembre** : juste physiquement, mais « n'évoque rien ». Remplacée par le bain de bismuth (`concept.md`).

Thème donné : **« melt »**. Le projet garde son nom et son dossier (`melt/`). Sous-titre : *la colonne sans fin*.

## Historique

Ce document est la quatrième version du concept. Les précédentes sont gardées pour la trace :
- **le dégel d'une étoile** (le flocon en macro sur six supports) : l'historique git, avant le 14 novembre. Il a été abandonné : trop terre à terre, icône usée, décors-nappes, temps fort minuscule ;
- **les pinacles** (eau douce, festons, bulles comme traceurs) : `concept-pinacles.md`. Les festons ne sortent pas de la simulation (P0), et les bulles ne montrent pas le courant (P5) ;
- **le fjord** (nappes d'eau de fonte en eau salée) : `concept-fjord.md`. Les nappes ne se voient pas à cette échelle (P7).

Les neuf prototypes (`proto/p0` à `proto/p8`, chacun avec son `RESULTS.md`) ont décidé de ce qui reste. On ne garde que **ce qui est à la fois exact et visible**.

## a. Le thème en largeur

Les angles détaillés sont dans `concept-pinacles.md` (section a). L'essentiel pour la version retenue :
- **Physique.**
  - L'anomalie de densité de l'eau douce : densité maximale à 4 °C.
  - La couche limite de convection naturelle le long d'une paroi de glace, et la fonte qui en résulte (Weady, Tong, Zidovska et Ristroph, *PRL* 128, 044502, 2022). Elle monte en eau froide et arrondit le bas. Elle descend depuis la surface en eau chaude, et amincit la ligne d'eau.
  - La condition de Stefan.
  - La stabilité de flottaison : un cylindre de glace (s = 0,917) ne flotte debout que si D/L > √(8 s (1 − s)) ≈ 0,78.
  - La fenêtre de Snell, de 48,6° de demi-angle, et le miroir de réflexion totale au-delà.
- **Optique de la glace dans l'eau.** La glace claire y est invisible (indices 1,309 et 1,333). La glace bulleuse diffuse la lumière et se lit. En lumière parallèle, la glace agit en lentille divergente.
- **Regard.**
  - Hiroshi Sugimoto, *Conceptual Forms* : une forme blanche unique, sur fond noir, sous une seule lumière douce.
  - Brancusi : *L'Oiseau dans l'espace*, les formes de révolution effilées.
  - Les photographies d'icebergs vus sous la surface : le miroir, la fenêtre de ciel.
- **Cycles.** Les saisons d'un lac de montagne. La glace qui fond, se détache et flotte, et la surface qui rend une colonne neuve.

## b. Les clichés (interdits comme idée principale)

1. Le glaçon qui fond dans un verre, le bloc dans une flaque.
2. La bougie qui coule.
3. Les montres molles de Dalí.
4. La crème glacée, le bonhomme de neige.
5. Le métal liquide.
6. L'iceberg-paysage : la carte postale de lagune glaciaire, le bloc bleu sous le ciel.

## c. Les pistes

| # | Piste | Boucle | Sort |
| --- | --- | --- | --- |
| 1 | Le dégel d'une étoile (flocon en macro) | cycle de transformations | réalisé, puis abandonné |
| 2 | Les pinacles : une colonne d'eau douce taillée en festons | cycle forcé | festons absents de la simulation |
| 3 | Le fjord : nappes d'eau de fonte en eau salée | cycle forcé | nappes invisibles à l'image |
| 4 | **La colonne sans fin : eau douce, saisons, détachement, bascule** | cycle forcé, périodique par construction | **retenue** |
| 5 | Procession d'icebergs à âges décalés | phases décalées | iceberg-paysage |
| 6 | Le sablier : un bloc retourné à chaque phase | cycle de symétries | le volume diminue |
| 7 | Lame mince entre polariseurs croisés | cycle de transformations | proposée, non retenue par l'utilisateur |
| 8 | Recalescence d'une goutte de métal en lévitation | cycle | trop proche de Bolt |

| # | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Regard | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 Colonne sans fin | 4 | 4 | 4 | 5 | 3 | 4 | 4 | **28** |
| 5 Procession | 3 | 4 | 5 | 4 | 3 | 3 | 2 | 24 |
| 7 Lame mince | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 30 (écartée par l'utilisateur) |

## e. La piste retenue

**L'image.** Une colonne de glace blanche et translucide (bulleuse, diffusion ≈ 0,5 cm⁻¹), de 2 à 4 cm de diamètre, pend de la surface d'un lac de montagne. On la voit de dessous : la surface est un plafond d'argent où elle se reflète, et la colonne et son reflet forment un fuseau symétrique. L'eau la taille au fil des saisons. L'été, la ligne d'eau s'amincit jusqu'à ce que la colonne s'en détache. Le fuseau libéré bascule en une demi-seconde et se couche contre son reflet, puis la brise l'emporte. À l'automne, une colonne neuve traverse le miroir.

**La liberté (une seule)** : la colonne n'a pas de fin. Elle descend de la surface sans support visible l'hiver, et s'arrête l'été.

**Le regard** : Hiroshi Sugimoto, *Conceptual Forms*.
- La valeur : le fond domine, et une seule forme claire occupe la hauteur.
- La lumière : une source douce, qui modèle par la courbure.
- Le cadrage : frontal, calme, sans contexte.

L'humeur Nuit le suit strictement. Les autres en gardent la sobriété. Le miroir de la surface y ajoute ce que Sugimoto n'a pas : chaque forme et son double.

**L'appareil** : aucun. Les causes sont la saison (lumière, température), la gravité, la poussée d'Archimède et la brise.

**Le lien avec la collection** : la glace devient de l'eau, et la surface rend une colonne neuve. On revient au départ par un autre chemin.

### Formule de la boucle (prototypes P1 et P8)

- **La température du lac** suit T∞(u) = ½(T₀ + T₁) − ½(T₁ − T₀) cos 2πu, de 1,5 à 9 °C pour le réglage de référence.
- **L'avance** v(u) est constante (0,5 mm/s simulés) pendant la saison froide, et nulle de u = 0,38 à 0,6, avec des raccords doux de 0,05.
- **La glace** se recalcule à chaque instant par le solveur. Toute la glace visible est neuve à chaque période, donc la boucle se referme d'elle-même : l'écart entre périodes tombe à 0,11 mm après trois périodes.
- **Le détachement** revient à phase fixe : 0,645 (±0,004) à 0,5 mm de maille (P8), 0,613 à 1 mm, la grille de la scène. Sa phase exacte est fixée sur la dernière période simulée.
- **Le fuseau libéré** est un corps rigide. Il bascule, se couche et dérive, et sort du cadre avant u = 1.
- **La caméra** suit une fonction périodique lissée.

### Découpage temporel (durée par défaut 48 s)

| u | Ce qu'on voit | Ce que l'œil suit | Temps |
| --- | --- | --- | --- |
| 0 – 0,2 | hiver, lumière basse et bleue ; une souche courte, au bout arrondi, descend du miroir | la colonne qui naît | accéléré |
| 0,2 – 0,38 | printemps ; la colonne s'allonge jusqu'à 8 cm, le bout reste arrondi (couche limite montante) | la descente | accéléré |
| 0,38 – 0,6 | été, rayons de soleil ; la colonne s'arrête ; elle s'effile vers le bas, puis s'amincit à la ligne d'eau | l'amincissement | accéléré, qui ralentit |
| 0,6 – 0,645 | le col n'est plus qu'un fil | le fil | ralenti |
| ≈ 0,6 | **le temps fort** : le fuseau se détache, s'incline, glisse le long de la souche, bascule et se couche contre son reflet (vers 90°) | la bascule | **ralenti** : plateau où une seconde de film vaut environ 1,9 s physique ; la bascule dure 2 à 3 s physiques |
| 0,66 – 0,85 | automne ; le fuseau flotte et dérive avec la brise ; la colonne neuve traverse le miroir | la dérive, la renaissance | accéléré |
| 0,85 – 1 | retour de l'hiver (= u 0) | | accéléré |

### Déclinaison : trois familles, trois temps forts

La bascule dépend de l'élancement D/L du fuseau libéré, qui dépend du calibre de la colonne et de la durée de l'arrêt.

| Famille | Fuseau | Mouvement au temps fort |
| --- | --- | --- |
| **Le chavirement** | long et fin (D/L ≈ 0,1–0,3) | il s'incline, bascule, se couche ; c'est la seule famille que la simulation produit (D/L de 0,08 à 0,26 sur tous les réglages) |
| **La révérence** | moyen (D/L ≈ 0,5–0,75) | il penche lentement jusqu'à un angle d'équilibre, oscille, puis se couche en roulant |
| **Le bouchon** | trapu (D/L > 0,8) | il remonte d'un coup et flotte debout en pilonnant, sans basculer |

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | chavirement, révérence, bouchon |
| Section du fût | ronde, carrée (arêtes que l'eau arrondit avec la profondeur), hexagonale, cannelée |
| Glace | bulleuse fine (0,5 cm⁻¹) ; à chapelets verticaux ; stratifiée (bandes de bulles) ; bleue de glacier (bulles rares, bleue dans l'épaisseur) |
| Lac | froid (1 → 7 °C), tempéré (1,5 → 9 °C), chaud (3 → 11 °C) : il change la forme d'hiver et la date du détachement |
| Humeur | six, voir l'épreuve de variété |
| Cadrage | profil plein cadre, contre-plongée sous le miroir, plongée oblique |

3 × 4 × 4 × 3 × 6 × 3 ≈ 2 600 combinaisons. La famille et l'humeur se lisent en vignette.

### Les humeurs (épreuve de variété)

| Humeur | Eau | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Nuit** (Sugimoto) | pure, noire au-delà de 20 cm | une boîte douce de côté | très sombre | profil, la colonne et son reflet |
| **Fenêtre de Snell** | claire | plein jour, disque du ciel au-dessus, miroir autour | claire en haut, sombre en bas | contre-plongée |
| **Ombre** | claire | soleil en lumière parallèle ; l'ombre de lentille de la glace sur un fond de sable pâle | très claire | plongée oblique vers le fond |
| **Lait glaciaire** | turquoise laiteux (farine de roche) | jour diffus | moyenne, froide | profil |
| **Tourbe** | brune et ambrée | soleil bas, rayons obliques | sombre et chaude | oblique |
| **Bassin de pierre** | claire, mur de calcaire à 30 cm | soleil filtré par une surface ridée : caustiques sur le mur | claire, plein jour | profil oblique |

Une phrase sans couleur par humeur :
- *une forme et son double dans le noir* ;
- *une colonne qui sort d'un disque de ciel cerné d'un miroir* ;
- *un objet presque invisible et son ombre très nette sur le sable* ;
- *une forme qui se perd dans un brouillard d'eau* ;
- *des rayons obliques dans une eau chaude et sombre* ;
- *un filet de lumière sur la pierre derrière la glace*.

L'humeur d'ouverture est Nuit ou Fenêtre de Snell. Elle n'est pas dans la gamme sépia, que la collection a déjà en excès.

### Images clés

1. **Le fuseau et son double, Nuit** (u ≈ 0,62). Fond noir, une boîte douce à gauche. La colonne, amincie à la ligne d'eau, et son reflet dans le plafond d'argent forment deux fuseaux pointe contre pointe, reliés par un fil de glace.
2. **Le chevron, Nuit** (u ≈ 0,65). Le fuseau en pleine bascule, à 50°, et son reflet dessinent un chevron. La souche, au-dessus, pend dans le vide.
3. **Le ciel, Fenêtre de Snell** (u ≈ 0,7). Vu d'en dessous, le fuseau couché flotte au bord du disque du ciel, la souche neuve au centre.

### Références

1. **Weady et al. 2022**, figures 1 et 2 : des cylindres de glace taillés à 4 °C et 8 °C. Elles imposent l'échelle (quelques centimètres) et des formes douces, sans arêtes vives sauf aux pointes.
2. **Photographies sous-marines de glace de lac et d'icebergs d'eau douce** : glace blanche et bulleuse, bulles visibles en profondeur, fenêtre de Snell, miroir de surface.
3. **Glaçons qui basculent dans un verre** (vidéos) : la bascule d'un corps élancé dure moins d'une seconde, avec un dépassement et deux ou trois oscillations amorties.
4. **Sugimoto, *Conceptual Forms*** : le noir, une seule lumière, la forme pleine hauteur.

### Risques et parades

- **Un hiver monotone** (P8 : les images 1 à 3 changent peu). La colonne qui traverse le miroir doit être lisible (les traits de scie, les bulles qui descendent avec elle), et la caméra peut s'approcher du bout pendant la descente.
- **Des pointes molles** (1 à 2 mm à 0,5 mm de maille). Le contour vient de la ligne de niveau de la fraction de glace, interpolée sous la maille. On n'affûte jamais à la main.
- **Le coût de la simulation** : environ 35 s par période en Node à 0,5 mm. Il faut une grille plus grossière en worker, ou un portage en WebGPU, montré sur l'écran de chargement.
- **Le fuseau coincé sous la souche** (P2, en 2D). La bascule se fait en 3D, avec la brise et un col qui cède de biais.
- **Un temps fort trop court.** La bascule dure 0,5 s physiques. Elle est filmée en temps réel, avec un ralenti au contact du miroir, dans une boucle par ailleurs accélérée.

## e bis. Les épreuves

### Crédibilité

| Temps | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| la colonne descend | (la liberté) | — | accéléré |
| le bout s'arrondit l'hiver | eau froide, lumière d'hiver | couche limite montante (anomalie de densité), retrait en h^(−1/4) | accéléré |
| la ligne d'eau s'amincit l'été | eau chaude, rayons de soleil | couche limite descendante, née à la surface | accéléré |
| le détachement | le col fond jusqu'au bout | Stefan | ralenti |
| la bascule | la gravité, la poussée d'Archimède | stabilité de flottaison (D/L < 0,78), masse ajoutée, traînée | temps réel |
| la dérive | la brise, les rides de la surface | traînée | accéléré |

Rien ne flotte sans raison : la colonne pend de la surface, et le fuseau libéré flotte avec 8,3 % de son volume émergé (P2).

### Ambition (éléments de construction)

- le fût, sa section, les traits de scie de la glace neuve ;
- la glace bulleuse : un fond diffus, des chapelets, de grosses bulles ;
- la traversée du miroir : ménisque, reflet, partie émergée givrée ;
- le bout arrondi, l'effilement d'été, le col ;
- le fuseau libéré, qui flotte et dérive ;
- les rides de la brise ;
- l'ombre de lentille (humeur Ombre).

### Échelle

- **Plan large** : 15 à 18 cm de haut, soit la colonne entière, la ligne d'eau et son reflet.
- **Gros plan** : 5 cm, soit le col ou le bout.
- **Ce qui donne l'échelle** : les bulles (0,1 à 1 mm), les traits de scie (1 mm), les rides de la surface (1 cm).

## e ter. Scénario (film muet, famille du chavirement)

1. Hiver. Dans le noir, une souche de glace blanche traverse un plafond d'argent et descend. Son reflet descend avec elle.
2. Elle s'allonge, ronde du bout. La lumière tiédit.
3. L'été entre en rayons. La colonne s'arrête. Son bout s'effile, et sa ligne d'eau se creuse jusqu'à n'être plus qu'un fil.
4. Le fil cède. Le fuseau s'incline, bascule et se couche contre son reflet. Il oscille deux fois.
5. La brise ride la surface et l'emporte hors du cadre. Une colonne neuve traverse le miroir. L'hiver revient (= 1).

La forme du film : une lente montée (la descente, l'effilement), un fil tendu, une rupture, un apaisement et un retour.
