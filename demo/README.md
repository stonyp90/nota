# `demo/` — la vidéo de démonstration de la salle de signature

Pour l’animation Gmail / Google Agenda / Outlook et l’ajout de Nota, voir
[`video-calendrier-notaire.md`](../docs/go-to-market/video-calendrier-notaire.md).
Son export se lance avec `node demo/render-calendar.mjs`.


Un seul geste :

```sh
npm run demo:salle
```

Il joue la cérémonie complète dans **deux navigateurs réels** — le notaire et
la personne — et dépose dans `demo/sortie/` :

| Fichier | Ce que c'est |
| --- | --- |
| `notaire.webm` | ce que le notaire voit, du début à la fin |
| `client.webm` | ce que la personne voit, en même temps |
| `chapitres.json` | l'horodatage de chaque moment, pour le montage |
| `salle-demo.webm` | les deux côtés en un master 1080p, **si `ffmpeg` est installé** |

Sans `ffmpeg`, les deux premiers fichiers existent quand même et la commande de
montage est imprimée à l'écran, prête à coller.

Rien n'est mis en scène : les deux navigateurs se joignent par la vraie salle,
la vraie API et la vraie signalisation, et le lien vidéo est un vrai lien pair à
pair. La caméra est la mire de Chromium — aucune personne réelle n'est filmée
pour une démonstration. Un filigrane « bêta · démonstration · aucun acte réel »
est incrusté dans la page, donc dans la vidéo, donc dans toute capture qu'on en
tirera.

Ce n'est **pas** une suite de tests : ce fichier ne défend aucune exigence et il
ne tourne jamais en CI. Les exigences sont tenues par `e2e/salle-signature.spec.js`,
`features/salle_signature.feature` et les trois suites unitaires — voir
[`docs/salle-signature-exigences-tenues.md`](../docs/salle-signature-exigences-tenues.md).

Le scénario, la narration, les chapitres et le texte de publication :
[`docs/go-to-market/video-salle-signature.md`](../docs/go-to-market/video-salle-signature.md).

## Réglages

| Variable | À quoi elle sert |
| --- | --- |
| `DEMO_CHROMIUM` | chemin d'un Chromium à utiliser, quand celui que Playwright épingle n'est pas installé |
| `FFMPEG` | chemin de `ffmpeg`, quand il n'est pas sur le `PATH` |
| `DEMO_API_PORT` / `DEMO_WEB_PORT` | ports de la pile locale (8821 / 4321 par défaut) |
