# 0037 — Les décisions du 4 septembre : ce qui se paie, ce qui se dit, ce qui attend

Date : 2026-09-04

Statut : accepté — décisions prises par délégation du propriétaire (« prendre
les décisions à ma place … meilleures d'un point de vue financier,
optimisation et produit »), après la revue adverse de f45a2e1.

## Décisions

1. **Un désabonnement ne coupe plus les avis transactionnels.** `sendOnce`
   n'applique la liste de suppression qu'aux gabarits `transactionnel: false`
   (résumé quotidien, nouvelle demande, campagnes). Un client qui a refusé le
   marketing apprend quand même qu'un notaire a retenu sa demande, lui a
   écrit, ou que son offre est annulée. LCAP art. 6(6) exempte ces messages ;
   les taire coûterait des signatures. Le lien de retrait reste sur chaque
   courriel.
2. **La récompense de parrainage se verse à la signature.** Acquise à la
   rétention comme avant (EARN write-once), payable une fois l'acte réglé
   (ACT#) — amendement de l'ADR 0011. Cela ferme sans mécanisme de reprise
   l'abus « retenir, annuler, encaisser », et aligne le coût marketing sur un
   revenu réellement encaissé par Nota. La page Partenaires, la FAQ, le
   courriel de récompense et la console admin (colonnes Acquis / Payable)
   disent la même chose.
3. **Les frais d'annulation tardive restent versés au notaire** (ADR 0033).
   Financièrement neutre pour Nota — ces frais n'ont jamais été un revenu
   légitime (art. 32.1 L.N.) — et décisif pour la confiance des notaires.
4. **La tuile art. 49 garde sa formulation prudente** (« Vos honoraires
   restent les vôtres… »), la seule que la note juridique du dépôt soutient.
5. **`billing:write` gouverne le prix de Nota** : la permission publiée est
   enfin appliquée sur PUT/DELETE /admin/prix (avec `settings:write`), et le
   test des permissions compare le catalogue au code plutôt qu'à lui-même.
6. **Les icônes PNG suivent la marque** : régénérées depuis favicon.svg (le
   vert des jetons du site).
7. **Les pages légales gardent leur estampille « brouillon »** jusqu'à une
   révision juridique — un geste et une dépense du propriétaire, pas un
   correctif de code.
8. **Les sujets des alertes opérateur restent bilingues** : la cohérence des
   invariants de marque vaut plus que quelques caractères gagnés.

## Ce qui attend explicitement le propriétaire

**Le secret des documents dans l'infrastructure** — politique de clé KMS
réservant le déchiffrement au rôle Lambda de l'API, et CloudTrail sur le seau
des documents. Sans cela, deux phrases de la politique de confidentialité
(« lisible uniquement par vous et ce notaire », « chaque ouverture est
journalisée ») restent plus fortes que ce que le compte AWS garantit. Le
propriétaire a répondu « do not proceed, wait for next instruction » à cette
proposition le 2026-09-04 dans une autre session ; cette décision-là n'est
donc PAS prise ici, et aucun fichier Terraform n'a été ajouté. Quand il la
prendra : un fichier autonome (politique de clé + piste), à appliquer avec
ses identifiants, après lecture du plan — une politique de clé mal écrite
verrouille la clé.

## Conséquences

- `notifications.js` lit `emails.TEMPLATE_META[key].transactionnel` : un
  nouveau gabarit doit se déclarer ; par défaut il est suppressible.
- `analytics.overview().parrainages.codes[].payable` ; l'opérateur verse
  `payable`, jamais `du`.
- Tests : notifications, chat-notifications, BDD `notifications.feature`,
  `analytics-parrainage-payable`, `admin-permissions-gate` (plus d'exception).
