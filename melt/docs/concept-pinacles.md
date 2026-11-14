# Melt, seconde version — document de travail

Thème : **« melt »**. Le projet garde son nom et son dossier (`melt/`). Ce document remplacera `concept.md` si la piste est adoptée. L'ancien concept (le dégel d'une étoile) reste dans l'historique git.

Sous-titre proposé : *la colonne sans fin*.

**Révision du 14 novembre, après les prototypes P0 et P3** (comptes rendus dans `proto/p0/RESULTS.md` et `proto/p3/RESULTS.md`) :
- **les festons sont retirés.** La simulation ne les produit pas (voir « Ce que les prototypes ont montré ») ;
- **la glace est bulleuse**, car la glace claire est invisible dans l'eau ;
- **la cause visible de l'écoulement passe aux bulles libérées par la fonte.** Le panache d'eau de fonte ne se voit pas en eau douce ;
- **le col se forme à la ligne d'eau, et la colonne s'y détache.** C'est devenu le temps fort.

**Révision du 14 novembre, après P1, P2, P4 et P5** (voir « Bilan des prototypes » plus bas) :
- **l'avance est saisonnière.** La colonne descend l'hiver et s'arrête l'été ; sans cet arrêt, elle devient un cône en toute saison, sans col ni détachement ;
- **la bascule est validée.** Le fuseau libre se couche en 0,5 s, à 8,3 % émergé ; il lui faut une brise pour dégager la souche ;
- **les bulles ne montrent pas le courant.** En eau douce, rien ne le montre : ni les bulles, ni l'ombroscopie, ni la turbidité ;
- **la Pagode tient.** Ses nappes d'eau de fonte se voient pour de vrai, mais la glace ne se creuse pas en gradins.

## 0. Pourquoi refaire le concept

La revue de la version actuelle (planche de 6 décors × 3 instants, 14 novembre 2026) donne cinq défauts, qui viennent du concept et pas du rendu :

1. **Un sujet invisible par nature.** Une plaque de glace de 30 µm se voit à peine. Tout l'éclairage sert à la faire exister, et le résultat ressemble à du plexiglas dépoli.
2. **L'icône la plus usée.** Le flocon évoque la carte de Noël. Sur Rheinberg, l'étoile dorée et ses perles sont des boules de sapin.
3. **Un temps fort minuscule, qui aboutit à une goutte banale.** À u = 0,9, l'image est presque vide dans les six décors, pendant un tiers de la boucle.
4. **Des décors qui ne sont que des nappes.** Le sujet est posé sur le support, sans y jouer de rôle.
5. **Un récit dispersé.** Sept événements, deux régimes de temps, et aucun geste qui se lise en vignette.

La nouvelle piste cherche l'inverse sur chaque point :
- un objet qui remplit le cadre ;
- une forme abstraite, de la famille de la sculpture moderne ;
- un geste unique et continu : **l'eau taille la glace** ;
- un décor qui est la cause elle-même : l'eau, sa température, sa lumière.

## a. Le thème en largeur (compléments)

Les six angles de `concept.md` restent valables. Voici ce que la nouvelle piste y ajoute.

**Physique**
- **L'anomalie de densité de l'eau.** L'eau douce est la plus dense à T* ≈ 4 °C. On écrit ρ(T) = ρ*[1 − β(T − T*)²], avec β ≈ 8·10⁻⁶ °C⁻². L'eau de fonte, à 0 °C, est *plus légère* qu'une eau à 3 °C et *plus lourde* qu'une eau à 9 °C. Le sens de l'écoulement le long de la glace dépend donc de la température du bain.
- **Weady, Tong, Zidovska, Ristroph, *PRL* 128, 044502 (2022).**
  - T∞ ≲ 5 °C : une pointe dirigée vers le bas.
  - 5 ≲ T∞ ≲ 7 °C : des festons.
  - T∞ ≳ 7 °C : une pointe dressée.
  - Les arêtes vives coïncident avec les points d'arrêt de l'écoulement, et la pointe s'affûte en temps fini.
- **La glace dans l'eau salée stratifiée (Huppert et Turner, *JFM* 1980).** L'eau de fonte s'étale en couches horizontales d'épaisseur ≈ 0,65·Δρ/|dρ/dz|, et la paroi se creuse en gradins.
- **La stabilité d'un corps qui flotte.** Un cylindre de glace (s = 0,917) ne flotte debout que si D/L > √(8 s (1 − s)) ≈ 0,78. Une forme élancée qui se libère bascule et se couche à la surface.
- **L'optique de la glace dans l'eau.**
  - n_glace ≈ 1,309 et n_eau ≈ 1,333 : la glace claire est presque invisible dans l'eau (vérifié en P3).
  - Une glace bulleuse diffuse la lumière et montre sa forme.
  - En lumière parallèle, la glace agit comme une lentille divergente et projette une ombre très dessinée.
  - En eau douce, la couche limite thermique ne dévie presque pas la lumière (2,6·10⁻⁶ par °C). En eau salée, elle la dévie deux mille fois plus.
- **La fenêtre de Snell.** Vue de dessous, la surface montre le ciel dans un cône de 48,6° de demi-angle. Au-delà, c'est un miroir d'argent qui renvoie le monde immergé.

**Art et regard**
- Brancusi, *L'Oiseau dans l'espace*, *Le Commencement du monde* : des formes de révolution polies et effilées. Ce sont les formes des deux pointes de Weady. Les œuvres servent de références ; on ne les reproduit pas.
- Hiroshi Sugimoto, *Conceptual Forms* (2004) : des modèles mathématiques en plâtre, photographiés à la chambre sur fond noir, avec une seule lumière douce. La glace bulleuse a ce même blanc translucide.

**Vocabulaire**
- pinacle, pointe, fuseau, col, fût, souche, point d'arrêt, couche limite, ligne d'eau, chavirement, gradin.

## b. Les clichés

- le glaçon qui fond dans un verre ;
- la bougie ;
- les montres molles ;
- la crème glacée ;
- le métal liquide ;
- l'iceberg-paysage (la carte postale de lagune glaciaire).

## c. Les pistes

Le problème central est **la boucle** : la glace qui fond disparaît.

| # | Piste | Boucle | Défaut |
| --- | --- | --- | --- |
| 1 | **La colonne sans fin** : une colonne de glace entre dans l'eau par la surface, à la vitesse où l'eau la mange ; la température du bain fait un cycle | cycle forcé, périodique par construction (voir e) | la colonne qui avance est une liberté |
| 2 | Un bloc posé qui fond jusqu'à disparaître | aucune (fondu) | interdit |
| 3 | Procession d'icebergs flottants à âges décalés | phases décalées | iceberg-paysage |
| 4 | Le sablier : un bloc retourné à chaque phase | cycle de symétries | le volume diminue |
| 5 | Plongée dans la pointe (singularité en temps fini) | plongée | auto-similaire seulement asymptotiquement |
| 6 | La pagode seule (eau salée stratifiée) | cycle forcé | un seul geste |
| 7 | Un bonbon qui se dissout (Davies Wykes et al. 2018) | — | dissolution et non fonte |
| 8 | La glace en chandelles du printemps | cycle saisonnier | autre geste, pour une autre fois |

| # | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Regard | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Colonne sans fin | 5 | 4 | 4 | 5 | 3 | 4 | 5 | **30** |
| 3 Procession | 3 | 4 | 5 | 4 | 3 | 3 | 2 | 24 |
| 4 Sablier | 4 | 4 | 2 | 4 | 3 | 3 | 3 | 23 |
| 6 Pagode seule | 4 | 4 | 4 | 4 | 2 | 3 | 3 | 24 |

**Retenue : 1.** La piste 6 devient une famille de la 1.

Par rapport à la première version, l'esthétique et les variations perdent un point (plus de festons). La faisabilité en gagne un : P0 a mesuré le coût et reproduit les deux pointes.

**Différence avec le dépôt.** Erosion fait creuser du sable par un écoulement imposé, sur une table de laboratoire. Ici, il n'y a ni courant imposé ni machine : la glace est sculptée par le froid qu'elle crée elle-même, et c'est un objet unique dans un volume. Kelp filme à la ligne d'eau sous un hublot en dôme. Ici, la caméra est entièrement immergée et la surface est un plafond-miroir.

## e. La piste retenue : *la colonne sans fin*

**L'image.** Une colonne de glace blanche et translucide, de 2 à 4 cm de diamètre, descend dans une eau sombre et calme depuis la surface, qu'on voit de dessous comme un plafond d'argent où elle se reflète. L'eau la taille en une forme de révolution : une aiguille, un fuseau, une colonne amincie à la ligne d'eau. Elle remplit la hauteur du cadre. Sa glace est bulleuse : elle diffuse la lumière, et ses bulles, libérées à mesure qu'elle fond, dessinent le courant qui la sculpte.

**La liberté (une seule).** La colonne n'a pas de fin. Elle entre par la surface, sans support visible, exactement à la vitesse où l'eau la mange.

**Les causes visibles.**
- La température du bain, rendue par la lumière : les saisons d'un lac glaciaire, en accéléré.
  - Hiver : eau à 2–3 °C, lumière bleue, basse, diffuse.
  - Été : eau à 8–9 °C, rayons de soleil dans l'eau.
- ~~Le sens de l'écoulement, rendu par les bulles libérées.~~ Abandonné après P5. La physique est juste (en eau chaude, 73 % des bulles de 10 à 30 µm descendent), mais ces bulles sont sous le pixel et restent collées à la glace. En eau douce, le courant ne se voit pas : seule la forme en garde la trace.

Le temps est une convention : environ une heure de fonte réelle montrée en 40–50 s (accéléré × 75). La physique reste exacte à chaque instant pour la température du moment.

### Formule de la boucle

La colonne avance à la vitesse v(u) : constante pendant la saison froide, nulle l'été, avec des raccords doux (P1). La température du bain T∞(u) est périodique de période 1.
- **La glace.** Chaque tranche entre dans l'eau à l'instant u₀ et y vit moins d'une boucle (on choisit v pour que v·L dépasse la longueur immergée maximale). À la phase u + 1, toute la glace visible est neuve, entrée pendant la dernière boucle, et elle a subi exactement le même forçage que celle de la phase u. **La boucle se referme par construction.**
- **L'écoulement** s'ajuste en quelques dizaines de secondes à la forme et à T∞, contre une heure pour la forme. Un test mesure l'écart entre la deuxième et la troisième période simulée. Si un résidu subsiste, on applique la méthode de Tension (plancher périodique, résidu absorbé d'abord sur la partie rigide).
- **Les bulles** sont attachées à la glace jusqu'à ce que le front de fonte les atteigne. Leur motif a une période qui divise v·L.
- **Le fragment libéré** (familles *Le fuseau* et *La métamorphose*) sort du cadre avant la fin de la boucle.

### Ce que les prototypes ont montré (14 novembre)

**P0, la simulation** (axisymétrique, Boussinesq avec l'anomalie de densité, glace par enthalpie, Brinkman ; détails dans `proto/p0/RESULTS.md`) :
- **3,5 °C, colonne tenue par le haut : une pointe vers le bas.** Le retrait suit la loi de couche limite laminaire en h^(−1/4) (rapport 1,6 mesuré, 1,56 attendu). La pointe reste arrondie à 1–2 mm à cette résolution.
- **8 °C, tenue par le bas : un cône dressé**, avec la même forme sur les deux grilles (0,1 mm d'écart).
- **8 °C, colonne qui pend de la surface : elle s'amincit continûment vers la ligne d'eau et s'en détache** vers V/V0 ≈ 0,18. Ce n'est pas un étranglement sous un chapiteau, c'est un fuseau qui se libère.
- **5,6 °C : pas de festons.** On obtient un fût bombé avec une entaille sous le support, et le résultat ne change ni avec une grille plus fine, ni avec une colonne plus haute, du bruit ou un domaine plus large. Le changement de sens de l'écoulement se fait entre 5,3 et 6,2 °C, par une forme de transition lisse.
- **Gonfler le nombre de Stefan ne change presque pas les deux pointes** (écart RMS de 0,1 à 0,5 mm entre ×4 et ×20).
- **Le coût est compatible avec l'écran de chargement.** À 0,5 mm de maille, une boucle demande environ 13 000 pas : 23 s dans un worker, 3 à 9 s en WebGPU d'après une estimation non mesurée. Il faut deux à trois périodes pour que la boucle oublie son départ.

**P3, le rendu** (lancer de rayons WebGPU, indices vrais ; détails dans `proto/p3/RESULTS.md`) :
- **La glace claire est invisible dans l'eau.** On ne voit que le cœur laiteux et les bulles.
- **La glace bulleuse se lit dans toutes les humeurs** dès une diffusion de 0,5 cm⁻¹, sans aspect plâtre. À 1,6 cm⁻¹, elle ressemble à du plâtre.
- **L'ombre de la glace en lumière parallèle oblique est l'image la plus forte.** La glace agit en lentille divergente et projette une ombre comme un objet d'argent poli.
- **Le panache ne se voit pas à l'ombroscopie en eau douce.** Il se voit en eau salée.

### Déclinaison : quatre familles, quatre mouvements

| Famille | Bain | Mouvement propre | État |
| --- | --- | --- | --- |
| **L'aiguille** | lac glaciaire, 1 → 4,5 → 1 °C | les bulles montent le long de la glace ; le bas s'effile en aiguille vers le bas, s'émousse quand le bain approche de 4,5 °C, et recommence : *s'effiler, s'émousser* | P0 : oui |
| **Le fuseau** | lac d'été, 7 → 9 → 7 °C | les bulles descendent ; la colonne s'amincit à la ligne d'eau jusqu'à s'en détacher ; le fuseau libéré bascule, se couche à la surface et dérive ; la colonne neuve redescend : *s'amincir, se libérer* | P0 : oui jusqu'au détachement ; la flottaison et la bascule sont à faire (P2) |
| **La métamorphose** | 3 → 9 → 3 °C | l'aiguille d'hiver ; puis le courant s'inverse (les bulles changent de sens), l'aiguille s'émousse, le haut s'amincit, le fuseau se libère : *s'inverser* | P0 : les deux régimes et la transition lisse entre eux ; le cycle complet est à faire (P1) |
| **La pagode** | fjord : eau douce sur eau salée, en strates | l'eau de fonte s'étale en nappes horizontales, visibles directement (le sel dévie la lumière) ; des gradins se creusent un à un : *s'étager* | à tester (P4) : sel et température, deux scalaires |

Un seul module de simulation produit les quatre (la Pagode ajoute la salinité). Si la Pagode ne sort pas non plus, il ne reste que trois familles, dont deux partagent le détachement. Dans ce cas, on revoit la matrice plutôt que d'imposer une forme.

### Découpage temporel (famille *La métamorphose* ; durée par défaut 48 s)

| u | Ce qu'on voit | Ce que l'œil suit | Temps |
| --- | --- | --- | --- |
| 0 – 0,25 | Hiver, 3 °C. La colonne descend du miroir. Les bulles libérées montent collées à la glace. Le bas s'effile en aiguille. | l'aiguille qui s'affûte | accéléré |
| 0,25 – 0,4 | Le bain se réchauffe et passe 5–6 °C. Les bulles hésitent, puis repartent vers le bas avant de remonter au large. L'aiguille s'émousse, la colonne devient un fût lisse. | le courant qui s'inverse | accéléré |
| 0,4 – 0,58 | Été, 8–9 °C, rayons de soleil. Les bulles descendent le long du fût. La colonne s'amincit à la ligne d'eau et s'effile vers le haut en fuseau. | l'amincissement à la ligne d'eau | accéléré, qui ralentit |
| 0,58 – 0,66 | **Temps fort.** Le fuseau se détache du miroir. Libre, il monte de quelques millimètres, s'incline (D/L ≪ 0,78), bascule et se couche à la surface, à 92 % immergé. Son reflet le referme en losange, et une vaguelette parcourt le miroir. | le chavirement | **temps réel**, ralenti au contact du miroir |
| 0,66 – 0,82 | Automne. Le fuseau dérive hors du cadre. La colonne neuve, aux arêtes nettes et chargée de bulles, traverse le miroir et descend. | la colonne qui renaît | accéléré |
| 0,82 – 1 | Retour du froid. Les bulles remontent, le bas s'effile de nouveau (= u 0). | | accéléré |

Le temps fort est le chavirement. Les respirations sont l'aiguille formée (0,22) et la colonne neuve (0,75).

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | aiguille, fuseau, métamorphose, pagode (à valider) |
| Section du fût | ronde, hexagonale, carrée (arêtes vives que l'eau arrondit avec la profondeur), cannelée, en losange |
| Glace | bulleuse fine (0,5 cm⁻¹) ; bulleuse à chapelets verticaux ; stratifiée (bandes de bulles des gels successifs) ; bleue de glacier (bulles rares et grosses, bleue dans l'épaisseur) ; blanche de névé (1 cm⁻¹) |
| Humeur | six, voir l'épreuve de variété |
| Calibre et avance | diamètre de 1,5 à 4 cm ; rapport entre la vitesse d'avance et la fonte (colonne longue et effilée, ou courte et trapue) |
| Cadrage | profil plein cadre (Sugimoto) ; contre-plongée sous le miroir ; plongée le long du fût ; gros plan de la pointe ou de la ligne d'eau |

4 × 5 × 5 × 6 × 4 × 4 ≈ 9 600 combinaisons (7 200 sans la Pagode).

### Images clés

1. **L'aiguille, profil, humeur Nuit** (u ≈ 0,22). Fond noir, une lumière douce à gauche. Une colonne blanche translucide pend du miroir et s'effile en aiguille. Le côté éclairé est plein, le côté d'ombre laisse voir les bulles en profondeur. Des chapelets de bulles libérées montent le long de la paroi en filets d'argent. En haut, le miroir la renvoie : elle continue dans son reflet.
2. **Le chavirement, contre-plongée, humeur Fenêtre de Snell** (u ≈ 0,62). Au-dessus, le disque clair du ciel ; tout autour, le miroir. Le fuseau libéré bascule de biais, et son reflet bascule vers lui. Les deux se rejoignent quand il se couche.
3. **L'ombre, humeur Ombroscopie** (u ≈ 0,5). Fond clair. À droite, la colonne, presque invisible. À gauche, sur le fond, son ombre de lentille : un fuseau d'argent poli, plus net que l'objet.

### Risques et parades

- **L'aspect plâtre de la glace bulleuse.** Diffusion autour de 0,5 cm⁻¹, reflet spéculaire net (la glace qui fond est mouillée), quelques grosses bulles, des zones plus claires selon le type de glace.
- **Un aspect tourné au tour.** Sections non circulaires, bulles, traits de scie sur la glace neuve, légère inclinaison de l'axe.
- **Des pointes molles.** À 0,5 mm de maille, les pointes restent arrondies à 1–2 mm. Il faut soit la grille fine (0,25 mm, en WebGPU seulement), soit une ligne de niveau sous-maille interpolée pour le maillage. On n'affûte jamais la forme à la main.
- **L'abstraction illisible** (leçon de Mirage). La première seconde doit dire « de la glace dans l'eau » : la ligne d'eau, des bulles qui montent, la partie émergée givrée.
- **La relecture qui bouillonne** (leçons de Rust et d'Erosion). Enregistrer finement, puis filtrer à phase nulle.
- **La collision du fragment avec la souche.** Corps rigide, poussée d'Archimède, masse ajoutée, traînée, et un test de distance positive pendant toute la boucle.
- **Le fragment fixé par la simulation.** Dans P0, la glace détachée reste en place, tenue par la pénalisation. Il faut la libérer : passer au corps rigide dès le détachement, et retirer la glace de la grille.

## e bis. Les trois épreuves

### Crédibilité

| Temps | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| l'aiguille vers le bas | eau froide (lumière d'hiver), bulles qui montent | anomalie de densité ; couche limite montante, plus mince et donc plus active en bas (retrait en h^(−1/4)) | accéléré |
| le courant qui s'inverse | lumière qui se réchauffe, bulles qui changent de sens | passage de T∞ au-dessus de ≈ 5,5 °C | accéléré |
| l'amincissement à la ligne d'eau | eau chaude (rayons de soleil), bulles qui descendent | couche limite descendante, née à la surface | accéléré |
| le détachement, le chavirement | la colonne qui se rompt au miroir | la glace n'est plus retenue ; stabilité de flottaison D/L > 0,78 non satisfaite | temps réel, ralenti au contact du miroir |
| la colonne qui renaît | (la liberté) | — | accéléré |

Rien ne flotte sans raison : la glace est retenue par la colonne tant qu'elle y tient, puis elle flotte vraiment, à 92 % immergée. L'eau de fonte est conservée : un test vérifie que son débit vaut 0,917 fois le volume de glace perdu.

### Variété (une humeur = une eau et une lumière, pas une teinte)

| Humeur | Eau | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Nuit (Sugimoto) | eau pure, noire au-delà de 20 cm | une boîte douce de côté, rien d'autre | très sombre | profil plein cadre |
| Ombroscopie | eau pure | faisceau parallèle oblique ; fond clair où tombe l'ombre de lentille de la glace, à côté d'elle | très claire | profil, la colonne et son ombre |
| Lait glaciaire | turquoise laiteux (farine de roche) | jour diffus d'en haut | moyenne, froide | plongée le long du fût |
| Fenêtre de Snell | eau claire | plein jour : disque du ciel au-dessus, miroir tout autour | claire en haut, sombre en bas | contre-plongée |
| Tourbe | brun ambré (tanins) | soleil bas en rayons obliques | sombre et chaude | oblique |
| Bassin de pierre | eau claire, mur de calcaire pâle à 30 cm | soleil à travers une surface ridée au loin : caustiques sur le mur et sur la glace | claire, plein jour | profil oblique |

Ce que P3 a montré sur les humeurs :
- **L'Ombroscopie, faite au soleil, doit utiliser un faisceau descendant.** Dans l'eau, le soleil est à plus de 41° sous l'horizontale, et l'ombre tombe donc sur le fond plutôt que sur un mur. Le prototype utilisait un faisceau horizontal.
- **Lait glaciaire et Tourbe sont encore trop plats.**

### Ambition (éléments de construction)

- le fût, sa section, et les traits de scie sur la glace neuve ;
- la traversée du miroir : ménisque, reflet, partie émergée givrée ;
- la glace bulleuse (fond diffus, chapelets, grosses bulles) ;
- les bulles libérées, qui montent ou sont entraînées ;
- l'aiguille, le fuseau, la ligne d'eau amincie ;
- les gradins de la pagode ;
- le fragment qui flotte, les vaguelettes du chavirement ;
- l'ombre de lentille (humeur Ombroscopie).

## e ter. Scénario (film muet, famille *La métamorphose*)

1. Hiver. Une colonne blanche descend d'un plafond d'argent, dans le noir. Des bulles se détachent de sa paroi et montent collées à elle. Le bas s'effile en aiguille.
2. L'eau se réchauffe. Les bulles hésitent, puis glissent vers le bas avant de remonter au large. L'aiguille s'émousse.
3. L'été entre en rayons obliques. La colonne s'amincit au ras du miroir et s'effile vers le haut.
4. Elle se détache. Le fuseau libre s'incline, bascule et se couche contre son reflet.
5. Il dérive hors du cadre. Une colonne neuve traverse le miroir. Le froid revient, et elle s'effile (= 1).

La forme du film : une lente métamorphose en trois états (s'effiler, s'inverser, s'amincir), une libération, un retour par un autre chemin.

## e quater. Les références (à rassembler avant de coder)

1. **Weady et al. 2022, figures 1 et 2.** Cylindres de glace sculptés à 4 °C et 8 °C. Elles imposent l'échelle et la douceur des pointes.
2. **Huppert et Turner 1980.** Couches d'intrusion le long d'un bloc de glace dans un gradient salin. Elles imposent l'espacement des gradins (famille Pagode).
3. **Photographies sous-marines de glace de lac et d'icebergs d'eau douce.** Elles imposent la diffusion de la glace bulleuse, les bulles, la lumière dans l'eau et le miroir de surface.
4. **Vidéos de bulles libérées par de la glace qui fond.** Elles imposent la taille et le rythme des bulles, et leur trajectoire.
5. **Sugimoto, *Conceptual Forms*.** Le noir, une seule lumière, la forme pleine hauteur.

## e quinquies. Le regard

- **La liberté** : la colonne n'a pas de fin ; elle entre par la surface à la vitesse où l'eau la mange.
- **Le regard** : Hiroshi Sugimoto, *Conceptual Forms*.
  - La valeur : le fond noir domine, et une forme blanche et translucide unique occupe la hauteur.
  - La lumière : une seule source douce, qui modèle la forme par la courbure.
  - Le cadrage : frontal, fixe, sans contexte.

  L'humeur Nuit le suit strictement. Les autres en gardent le cadrage et la sobriété.
- **L'appareil** : aucun. La surface, la lumière et les bulles portent la cause.
- **Le lien avec la collection** : la glace devient de l'eau. La surface rend une colonne neuve, et l'on revient au départ par un autre chemin.

## Bilan des prototypes (14 novembre)

| Test | Verdict | Ce qui tient | Ce qui tombe |
| --- | --- | --- | --- |
| P0, simulation | partiel | aiguille, cône dressé, détachement de la colonne suspendue ; coût de 2 ms par pas | les festons |
| P3, rendu | partiel | la glace bulleuse se lit ; l'ombre de lentille | la glace claire ; le panache à l'ombroscopie |
| P1, colonne et saisons | partiel | la boucle se referme d'elle-même (0,014 mm après 5 périodes) ; avec un arrêt l'été, détachement à phase fixe | avance continue : un cône en toute saison ; l'aiguille d'hiver ne sort pas dans la métamorphose ; un quart de boucle sans sujet |
| P2, bascule | oui | bascule en 0,5 s, dépassement, 8,3 % émergé | coincé sous la souche sans brise ni col incliné |
| P4, pagode | partiel | nappes d'intrusion espacées d'environ 10 mm (15 mm prévus), visibles | pas de gradins dans la glace |
| P5, traceurs | non | — | bulles et turbidité invisibles en eau douce |

**Ce qui reste solide :**
- une colonne de glace bulleuse, translucide, qui se lit dans toutes les humeurs ;
- une métamorphose de forme réelle : bout arrondi, fuseau, amincissement à la ligne d'eau, détachement ;
- une bascule franche ;
- une boucle qui se referme par construction ;
- des nappes d'eau de fonte visibles en eau salée ;
- l'ombre de lentille comme humeur graphique.

**Ce qui est faible :**
- **Le geste est lent et discret** jusqu'au détachement. La forme change de quelques millimètres sur des dizaines de secondes, sans cause visible autre que la lumière.
- **Les familles se ressemblent** (un cône ou un fuseau). Seules la Pagode et la bascule se distinguent vraiment.
- **Un quart de boucle sans sujet** suit le détachement.
- **L'avance saisonnière** est une liberté moins évidente que l'avance continue.

**Recommandation.** Le concept tient debout, mais il tient surtout par deux moments : la bascule et les nappes salées. Deux voies pour la suite, à trancher avant de construire :
1. **Recentrer sur l'eau salée** (« le fjord »). La colonne pend dans une eau stratifiée. Les nappes d'eau de fonte s'empilent autour d'elle et se voient ; la colonne s'amincit, se détache et bascule. On garde une seule cause, la saison, et l'eau de fonte enfin visible porte le geste.
2. **Garder l'eau douce et tout miser sur la forme et la bascule.** Avance saisonnière, humeur ombre de lentille, quart de boucle rempli par le fuseau qui flotte et dérive. Le risque : un film beau en images fixes, mais lent à lire.

## Le cœur technique

**La simulation** (dans un worker ou en calcul GPU, pendant l'écran de chargement, qui la montre en direct). C'est la méthode de P0, à compléter :
- domaine axisymétrique (r, z), Boussinesq avec l'équation d'état quadratique (plus la salinité pour la Pagode) ;
- glace par enthalpie, pénalisation de Brinkman, condition de Stefan dans le bilan d'énergie de chaque maille ;
- maille de 0,5 mm (0,25 mm en WebGPU si les pointes le demandent) ;
- nombre de Stefan gonflé ×4 à ×20 (les pointes y sont insensibles) ;
- **à ajouter :** la colonne qui entre en haut à la vitesse v, T∞(u) cyclique, le détachement suivi du passage en corps rigide (flottaison, bascule, dérive), une projection pondérée par la porosité (P0 relève une fuite de 5 à 8 % de la vitesse dans la glace), une viscosité implicite pour des pas 3 à 5 fois plus grands.

**Les invariants (les futurs tests)** :
- les deux pointes sur un cylindre de référence (3,5 °C et 8 °C), comparées aux profils de P0 ;
- la loi de retrait en h^(−1/4) ;
- la conservation de la masse ;
- la périodicité (deuxième période contre troisième) ;
- la durée de vie de chaque tranche, inférieure à la boucle ;
- la stabilité de flottaison ;
- aucune collision entre le fragment et la souche.

**L'image** (le lancer de rayons de P3 sert de base) :
- la glace : surface de révolution tirée de la ligne de niveau de l'enthalpie, réfraction d'indice relatif 0,982, diffusion volumique de la glace bulleuse, éclairage le long de la corde vers chaque lumière ;
- les bulles : piégées dans la glace jusqu'au passage du front, puis portées par la vitesse enregistrée de la couche limite et par leur propre remontée ;
- la surface : un miroir de réflexion totale hors de la fenêtre de Snell ;
- l'humeur Ombroscopie : l'ombre de lentille calculée par la hessienne de la phase traversée.

**Ce qu'on garde de la version actuelle** :
- `timeline.js` (une horloge) ;
- `camera.js` (rail lissé par noyau périodique, bornes de vitesse) ;
- le schéma du chargement en worker ;
- `sky.js` et `env.js` ;
- le panneau, l'export, les outils de capture.

**Ce qu'on abandonne** : la croissance de Gravner-Griffeath, le maillage du cristal, la laine, le givre, les supports, le contact.

## Plan

Tous les prototypes sont faits (voir le bilan). Les comptes rendus sont dans `proto/p0` à `proto/p5`, dans les fichiers `RESULTS.md`.

Prochaine décision : la voie 1 (le fjord) ou la voie 2 (eau douce, forme et bascule). Ensuite :
- corriger l'instabilité de `meta_continu` (NaN à t = 536 s) ;
- coupler la Pagode à l'avance saisonnière ;
- passer la bascule en 3D avec la brise ;
- mesurer le solveur en WebGPU.

## Sources

- Weady, Tong, Zidovska, Ristroph, *Anomalous convective flows carve pinnacles and scallops in melting ice*, PRL 128, 044502 (2022) : https://arxiv.org/abs/2111.09937 ; résumé APS : https://physics.aps.org/articles/v15/13
- Huppert, Turner, *Ice blocks melting into a salinity gradient*, JFM 100 (1980).
- Davies Wykes, Huang, Hajjar, Ristroph, *Self-sculpting of a dissolvable body due to gravitational convection*, PRFluids 3 (2018).
