# CRM et conversion first-party

La console admin expose `CRM / leads` comme registre opérationnel. La source de
vérité est la base Nota :

- les leads sont lus depuis les partitions `MONTH#YYYY-MM` du carnet;
- les retenues viennent de l’état persistant de l’offre;
- les actes complétés viennent du ledger idempotent des actes;
- l’attribution conservée avec la demande (`first` / `last`) est utilisée pour
  les ventilations par source;
- l’étape CRM, la note et la prochaine relance sont stockées dans la table
  admin, avec une révision conditionnelle et une trace d’audit.

Les compteurs de cette section sont donc exacts pour les faits persistés dans la
fenêtre `dateISO` choisie. GA4 et les autres outils d’analytique restent
complémentaires : ils servent à comprendre les visites, les campagnes et les
parcours consentis, mais ne doivent pas remplacer le registre des leads ni
inventer des visiteurs uniques. Les données personnelles restent masquées sans
`pii:read`.

Le fonctionnement recommandé est volontairement court : traiter les leads à
l’étape « Prêt », noter chaque contact, programmer la relance suivante, puis
marquer « Converti » uniquement quand l’acte est complété dans le système.
