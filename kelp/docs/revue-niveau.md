# Kelp — revue « changement de niveau » (direction artistique et technical art)

> **Revue datée du 14 novembre 2026, traitée le 15 novembre.** Elle garde la trace des propositions et de ce qui en a été fait ; le détail est dans l'historique git. L'état actuel est décrit dans le [README](../README.md).

Rendus : graine d'ouverture k39 (Couchant, cochayuyo) à dix instants en 960 × 540, puis Ploumanac'h / digitée (p7), Midi / boa (m3) et Étretat / palmier de mer (e5). Planche : [revue-niveau.jpg](revue-niveau.jpg).

## Verdict

Après la revue cinéma, ce qui retenait l'image tenait à l'architecture : **le monde était un profil extrudé.** La mer était un calcul 1D décalé par l'obliquité, la roche ce même profil avec un relief ajouté, la frange un semis de 64 plantes. Le front de la vague était une règle, le bord du platier une bordure de trottoir, la frange une plantation.

## Propositions et suite donnée

| Proposition | État | Ce qui a été fait |
| --- | --- | --- |
| Bord du platier déchiqueté | fait | trois ondulations, un chenal, un éperon (la même formule dans la mer, la roche et le shader), arête rompue au mètre, blocs éboulés |
| Faisceau de profils | fait | un profil tous les 0,9 m, en texture 3D, fondu avec le profil fin de la caméra ; écart du front à sa droite de 0 à 0,2–0,4 m (`tools/front.mjs`) |
| Clones décalés dans le temps | fait | 100 à 240 touffes, 0,4 ms par image |
| Crampons cachés et mats, palmier de mer en colonies | fait | |
| Déferlement en objet | fait | déferlement relevé par profil et par image ; lèvre en volute au tombant ; crête traversée par le soleil ; 8 000 grappes d'embruns |
| Écume transportée | fait | ~100 000 flocons suivis un par un, en îlots, échoués en voile |
| Torsion des lames (tiges de Cosserat) | fait autrement | un angle de torsion par nœud, tordu par le courant (médiane en pointe : 96° pour le cochayuyo, 39° pour la digitée) ; Cosserat aurait allongé la génération |
| Paume de la digitée | fait | une étoffe entre doigts voisins qui suit les deux splines |
| Houle de fond, structure sous l'eau | fait | houle périodique, panaches de bulles, sable soulevé, 6 000 grains en suspension |
| Ombres de la canopée sous l'eau | fait | les rayons et les grains relisent la carte d'ombre du soleil |
| Dispersion (Serre-Green-Naghdi) | écarté | une résolution tridiagonale à chaque pas allongerait le démarrage |
| Démarrage | amélioré | mer et roche en parallèle sur le pool de workers ; k39 17,3 → ~12 s, e5 20,7 → ~15 s, p7 22,5 → ~18,5 s |

## Points à surveiller

- Les embruns ne se voient bien que lorsque la caméra est à l'air et que la vague casse dans le champ ; sur k39, la grande vague casse quand la caméra est déjà sous l'eau.
- Le palmier de mer reste lisible comme un palmier dans les colonies proches ; des colonies plus denses coûteraient en contacts.
- Les clones n'épousent pas exactement la roche de leur nouvelle place (6 cm de tolérance) ; au loin, cela ne se voit pas.
