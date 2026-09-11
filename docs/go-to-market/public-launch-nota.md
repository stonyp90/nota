# Lancement public de Nota — le plan le plus simple

## La décision

Oui : partager une courte vidéo de vous **et** une démonstration YouTube. La
vidéo de vous crée la confiance; la démo montre que l’offre fonctionne
réellement. Une seule vidéo de 45 à 60 secondes suffit pour le lancement. Elle
doit commencer par le problème, montrer un vrai parcours Nota et finir par une
seule action : « Essayez sur gonota.ca ».

Ne publiez rien avant la fin des animations. Pour l’instant, les anciennes
vidéos restent en place et les nouvelles versions restent privées.

## Les 4 étapes

### 1. Préparer une seule fois

- Finir et approuver les animations, la voix douce, les sous-titres et les
  miniatures.
- Garder trois démos principales : client, notaire, partenaire. Les versions
  anglaises suivent le même traitement.
- Utiliser le générateur local :
  `npm run marketing:launch:kit -- --write output/nota-launch-kit.md`.

### 2. Publier le jour du lancement

- Publier votre vidéo de présentation courte sur YouTube, LinkedIn, Facebook,
  Instagram et TikTok avec les sous-titres.
- Publier ensuite la démo client en français sur YouTube et utiliser le lien de
  la page correspondante dans tous les appels à l’action.
- Ne pas publier six vidéos d’un coup : ajouter les démos notaire, partenaire et
  anglaises une par jour, selon les premières demandes reçues.

### Règle bilingue pour les liens

Il n’existe pas de routage fiable et universel qui remplace automatiquement une
URL YouTube française par une URL anglaise dans chaque réseau social. Facebook
peut offrir une publication multilingue pour les Pages, selon l’interface et le
compte, et les vidéos peuvent recevoir des sous-titres dans plusieurs langues;
cela ne doit toutefois pas être notre seul mécanisme.

- Facebook et LinkedIn : une publication FR avec le lien FR, puis une
  publication EN avec le lien EN. Si Facebook affiche l’option multilingue,
  elle peut servir pour le texte, mais on conserve les deux liens explicites.
- Instagram et TikTok : utiliser une page Nota bilingue avec deux boutons
  « Français » et « English » dans le lien de profil.
- YouTube : renseigner la langue originale, les titres/descriptions traduits et
  les sous-titres; si le compte offre l’audio multilingue, l’utiliser pour une
  seule vidéo. Sinon, conserver les deux vidéos FR/EN.

Le générateur de kit de lancement produit déjà la paire de liens FR/EN et les
UTM correspondants. Ne partager les URL v2 qu’après leur approbation et leur
publication.

### 3. Répondre et convertir

- Répondre personnellement aux commentaires et messages le jour même.
- Une réponse = une question comprise, un lien UTM, une invitation à publier la
  demande. Ne promettre ni date garantie, ni économie, ni résultat juridique.
- Pour un notaire, envoyer vers `#t=notaires`; pour un partenaire, vers
  `#t=partenaires`; pour un client, vers la page financement ou refinancement
  qui correspond au message.

### 4. Mesurer pendant 7 jours

- Chaque jour, regarder seulement : demandes réelles publiées, demandes
  retenues par un notaire, source et langue.
- Garder le message et le canal qui produisent des demandes retenues; mettre en
  pause ceux qui produisent seulement des vues ou des demandes hors territoire.
- Après le lancement, ajouter les URL YouTube publiques au générateur et
  redéployer le site. Soumettre le sitemap à Google/Bing et exécuter l’aperçu
  IndexNow déjà prévu; ne jamais soumettre une vidéo privée.

## Ce qui est automatisé

Le site déclare maintenant ses profils officiels YouTube et LinkedIn dans les
données structurées, le pied de page et `llms.txt`. Le générateur crée les
textes FR/EN, les liens UTM et la séquence de diffusion à partir du manifeste
vidéo. Il valide aussi que les vidéos, sous-titres et miniatures préparés
existent.

La publication YouTube, la suppression des anciennes vidéos et l’envoi sur les
réseaux sociaux restent manuels : ils modifient des comptes externes et doivent
attendre votre approbation finale.

## Règle SEO à retenir

Un titre précis, une miniature lisible, les premières secondes utiles, une
description claire, des sous-titres FR/EN et une page Nota pertinente comptent
davantage que de remplir des mots-clés. Après publication seulement, chaque
page qui présente réellement une vidéo pourra recevoir ses propres données
`VideoObject` avec l’URL publique, la miniature, la durée et la date; aucun
identifiant privé ne doit être exposé.

Références : [YouTube — optimiser une vidéo](https://support.google.com/youtube/answer/11908409?hl=fr),
[YouTube — titres et descriptions traduits](https://support.google.com/youtube/answer/6289575?hl=fr),
[Google Search Central — données structurées vidéo](https://developers.google.com/search/docs/appearance/structured-data/video?hl=fr).
