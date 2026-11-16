# Kelp — revue cinéma (direction artistique et technical art)

> **Revue datée du 12 novembre 2026, corrigée depuis.** Elle garde la trace des défauts relevés et de leur correction ; le détail du diagnostic est dans l'historique git. L'état actuel est décrit dans le [README](../README.md).

Rendus de la graine d'ouverture k39 (Couchant, cochayuyo) à dix instants, et de trois humeurs de plus (Ploumanac'h / digitée, Étretat / palmier de mer, Midi / boa). Planche annotée : [revue-defauts.jpg](revue-defauts.jpg) ; le pire cas, Midi : [revue-midi.jpg](revue-midi.jpg) ; après les corrections : [revue-avant-apres.jpg](revue-avant-apres.jpg).

## Verdict

Le cœur technique était solide, mais l'image se lisait comme une maquette en plastique, pour trois raisons : la matière des laminaires (caramel, tubes ouverts, crampons clonés), une eau qui ne se lisait pas comme de l'eau au moment où elle compte (vague sans volume, dessous en aplat sarcelle, écume en filet), et un objectif trop parfait (ligne d'eau nette et en escalier, gouttes piquées, exposition fixe, caméra immobile).

## Défauts et corrections

| Défaut | Cause | Correction |
| --- | --- | --- |
| Grands triangles gris sous la ligne d'eau, ligne d'eau en escalier, liserés et pans verticaux sur les gradins (Midi) | sommets de la surface plongés sous la roche ; poids 8 bits du filtrage au dôme | sommets au niveau de l'eau, mouillé et sec au pixel ; niveau au dôme interpolé en pleine précision |
| Flou général, roche étalée à la verticale | roche déplacée sans `positionPrevious` : vecteurs vitesse égaux à tout le relief | position précédente fournie |
| Lames immergées en néons | transmission non atténuée par l'eau | contre-jour éteint sous l'eau |
| Flou de mouvement en copies | 10 prises régulières | 12 prises décalées par un bruit, traînée plafonnée |
| Stipe en tube ouvert, crampons en presse-agrume, boa en fermeture éclair | géométrie trop régulière | stipe fermé aplati en paume, haptères ramifiés irréguliers, lamelles irrégulières |
| Lames rigides en poutres dans l'air | une image enregistrée tous les `round(100/30)` = 3 sous-pas : les laminaires prenaient jusqu'à 3 s de retard sur la mer | sous-pas multiples de la cadence ; caisson qui ne repousse qu'à l'horizontale ; lames du cochayuyo plus souples |
| Flaque à bord en marches | champ des flaques à −9 hors flaque | champ continu |
| Écume en filet de Worley | bords de cellules d'épaisseur constante | plaques déchirées trouées de bulles |
| Roche en pâte à modeler, ombre limitée à ±3,5 m | la roche ne portait pas d'ombre | la roche porte ses ombres, l'ombre du soleil couvre 10 m dans l'axe |
| Laminaires caramel, translucides partout | couleurs sRGB claires | albédo sombre, reflets étirés, translucidité aux marges et aux pointes |
| Dessous en aplat sarcelle, ciel sans structure | ni diffusion vers le soleil, ni rayons, ni particules | Henyey-Greenstein, rayons, particules ; nuages ombrés, cirrus |
| Objectif trop parfait | | ménisque et gouttes flous, lame d'eau qui grossit, profondeur de champ et bascule de point, exposition qui rattrape la plongée, choc du caisson, respiration du trépied, images fantômes |
| Platier trop propre | | balanes, patelles, moules (aucune à moins de 60 cm de l'objectif) |
| Ardoise en tôle ondulée ; étoiles en taches de 5 px ; ciel d'Étretat en crépi | pas et profil constants ; étoiles dans la carte du ciel | feuillets inégaux rompus de joints obliques ; étoiles au pixel ; ciel couvert doux |

## Resté ouvert

Le cadrage n'a pas été modifié : l'horizon est déjà au-dessus du centre pour la plupart des humeurs, et le cap n'a pas été touché (règle du projet : ne pas toucher la caméra sans raison).
