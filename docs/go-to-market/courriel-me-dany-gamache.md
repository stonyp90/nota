# Courriel d'introduction — Me Dany Gamache

**À :** dgamache@gamachenotaires.com
**Objet :** Nota : rééquilibrer l'offre et la demande des actes notariaux simples
**État :** brouillon Gmail, non envoyé
**Registre :** corporatif, sans tiret cadratin ni point-virgule
**Relecture :** 2026-09-02, trois lentilles (langue, droit, produit) + sceptiques — voir « Relecture » ci-dessous

---

Bonjour Me Gamache,

Je suis Anthony Paquet, entrepreneur et développeur logiciel. J'ai développé Nota, une plateforme qui vise à rééquilibrer l'offre et la demande des actes notariaux simples, soit le financement et le refinancement hypothécaires pour commencer.

Le fonctionnement est le suivant. Le client publie gratuitement sa demande en précisant le service, la date souhaitée, le secteur et le montant offert. Le notaire ajoute le carnet Nota à son agenda professionnel (Outlook, Google ou Apple), où les demandes apparaissent à leur date. Il peut ensuite accepter, formuler une contre-offre ou passer son tour.

Un point mérite d'être précisé d'emblée, puisqu'il s'agit de la première question qui se pose. Les honoraires demeurent entièrement les vôtres. Nota facture son propre service, séparément, au client. Il s'agit d'une contrainte de conception et non d'une politique commerciale, l'article 32 du Code de déontologie des notaires interdisant le partage d'honoraires, et l'article 32.1 de la Loi sur le notariat visant l'intermédiaire qui obtiendrait d'un notaire l'abandon d'une partie des siens.

Le tarif de base ne relève pas de l'estimation. Il se construit à partir d'un court questionnaire que le client remplit au moment de publier, portant sur des faits objectifs du dossier, notamment le montant du prêt, l'état de l'approbation bancaire, le prêteur, la présence d'une succession et les modalités de déplacement. Ces réponses accompagnent la demande jusqu'à vous, avec la liste des pièces encore manquantes, de sorte que vous connaissez le dossier avant de vous engager.

Le montant offert s'élève ensuite avec la proximité de la date souhaitée, jusqu'à un plafond de cinq fois ce tarif. Cette prime correspond à la célérité exceptionnelle que l'article 49 (4°) du Code de déontologie reconnaît expressément parmi les facteurs de fixation des honoraires.

Version bêta : https://d1s1h4894dau0c.cloudfront.net/
Mon parcours : anthonypaquet.com

À terme, je souhaite démontrer à la Chambre des notaires qu'un tel dossier peut se mener à distance en toute sécurité, ce qui augmenterait considérablement l'offre. C'est le sujet sur lequel votre avis me serait le plus utile.

Au-delà des utilisateurs, je cherche un notaire qui accepte de m'accompagner dans cette aventure et dont le jugement professionnel façonnera Nota avant son ouverture au public.

Auriez-vous vingt minutes à m'accorder cette semaine ou la suivante ? Je me ferais un plaisir de me déplacer à Loretteville ou de le faire en vidéoconférence.

Bien à vous,

**Anthony Paquet**
Fondateur, Nota
418-564-6162
anthonypaquet.com

---

## Chiffres cités, vérifiés dans le code

| Affirmation | Source |
| --- | --- |
| Plafond de **cinq fois** le tarif de base | `PREMIUM_CAP = 5`, appliqué client **et** serveur |
| Tarif de base refinancement **2 000 $** | `SERVICES.refinancement.prixDepart` |
| Tarif de base financement **1 800 $** | `SERVICES.financement.prixDepart` |
| Accepter / contre-offre / passer | routes `/notary/bids/{accept,propose,decline}` |
| Honoraires entiers au notaire | ADR 0031 : `honorairesCents` vs `prixNotaCents` |
| Carnet dans Outlook, Google, Apple | `/carnet/feed.ics`, webcal sans jeton |
| Les demandes apparaissent à leur date | `buildCarnetFeed`, un VEVENT par offre |

**Non cité volontairement** (matière à rencontre, pas à courriel) : succession
+400 $, prêteur privé +300 $, échelle de déplacement 0 à +400 $, tranches de
valeur du prêt 0 / +150 / +350 / +600 $.

**Deux nuances à connaître si Gamache creuse.** Le flux d'agenda montre tout le
carnet, pas seulement son secteur : le filtrage par territoire se fait dans la
console. Et l'événement d'agenda ramène désormais au carnet (propriété `URL`,
livrée le 2026-09-02), mais pas encore à l'acte précis.

## Relecture du 2026-09-02 (workflow à trois lentilles, sceptique par erreur)

| Lentille | Relevé | Sort |
| --- | --- | --- |
| Langue | « Il me ferait plaisir de » — tournure impersonnelle déconseillée (OQLF BDL 21455, Usito, Multidictionnaire, Bureau de la traduction) | **Erreur confirmée**, corrigée en « Je me ferais un plaisir de » |
| Langue | espace avant « ? » | Réfutée : convention majoritaire, uniforme dans tout le produit |
| Langue | « drastiquement » — emprunt sémantique déconseillé (OQLF BDL 21985) | Suggestion **appliquée** : « considérablement » |
| Langue | « 418-564-6162 » → « 418 564-6162 » (OQLF BDL 23293) | Suggestion **non appliquée** : format de l'auteur, usage courant |
| Droit | art. 32.1 ne « interdit » pas le partage, il fait présumer l'usurpation chez l'intermédiaire qui obtient l'abandon d'une partie des honoraires | Suggestion **appliquée**, en une proposition courte |
| Droit | art. 49 (4°) sans instrument nommé, après une citation de la Loi | Suggestion **appliquée** : « du Code de déontologie » |
| Produit | « à mesure que l'échéance se rapproche » laisse croire que le montant grimpe après publication ; le palier est fixé UNE fois, à la publication (`tierForDays`) | Suggestion **appliquée** : « avec la proximité de la date souhaitée » |
| Produit | « soit » lit la liste des cinq critères comme exhaustive ; les optionnels s'ajoutent, et le financement pose d'autres questions | Suggestion **appliquée** : « notamment » |

Vérifié exact, sans réserve : art. 32 (l. 141 du texte officiel), art. 49 al. 2 4°
« célérité exceptionnelle » (l. 195 à 207), publication sans frais, les quatre
champs d'une demande, `/carnet/feed.ics` en webcal sans jeton avec un VEVENT par
demande, les trois routes accept / propose / decline, `missing` exposé au
notaire avant l'acceptation, `PREMIUM_CAP = 5` sur le tarif de base, catalogue
limité à financement et refinancement.
