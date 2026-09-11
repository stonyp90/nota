# 51. Le texto est un canal de consentement exprès

- Status: Accepted
- Date: 2026-09-11

## Contexte

Le propriétaire, le 2026-09-10 : « notification, in-app notification, email
notification, text notification are fully implemented ». Trois canaux, tous
livrés. Le courriel l'était (59 gabarits, `sendOnce`, registre SENT#, retrait
LCAP, surcharges admin). L'avis dans l'application l'était en partie (la cloche,
un catalogue fermé de six sortes). Le texto ne l'était pas du tout : un port
existait (`apps/api/src/sms-port.js`, SNS direct-to-phone, factice, fichier),
un `domain.toE164`, la plomberie Terraform (`infra/sms.tf`, éteinte par
défaut) — et RIEN ne l'appelait. Aucun consentement n'était enregistré nulle
part, et le panneau d'alertes du notaire refusait explicitement l'interrupteur
texto : décision du 2026-09-03, « no SMS », que le test
`notary-mise-en-relation.test.mjs` figeait en asseyant `pref-ch-sms === null`.

Cette décision-là est renversée. Mais pas son motif, qui tient toujours : un
texto est un message électronique commercial au sens de la LCAP (L.C. 2010,
ch. 23), et Nota ne lit dans l'art. 6(6) AUCUNE exemption transactionnelle pour
le texto. Le courriel « un notaire a retenu votre demande » part à quiconque a
donné son adresse pour cet acte ; le texto, lui, ne part qu'à qui l'a demandé.

## Décision

1. **Le consentement est exprès, par destinataire, et il a la clé de toute
   préférence : le courriel.** `repo.getSmsConsent(email) → { telephone,
   consent, at } | null` et `repo.putSmsConsent(email, { telephone, consent,
   at })`, dans les deux dépôts (mémoire : une Map ; DynamoDB : PK
   `SMSCONSENT#<sha256(courriel normalisé)>`, SK `CONSENT`, à la manière de
   MAILPREF#). Un item écrasable : la DERNIÈRE décision compte, et le retrait
   (`consent: false`) s'écrit comme l'octroi — c'est un geste, pas une absence.
   `deleteSmsConsent(email)` existe pour l'effacement (Loi 25, art. 28).

2. **Deux gestes de consentement, un par audience.**
   - *Client* : une case à l'étape 4 du formulaire, sous le téléphone —
     « Me prévenir aussi par texto (SMS) aux moments clés… ». Décochée par
     défaut, inerte tant que le numéro n'est pas composable
     (`domain.toE164`), décochée dès que le numéro s'efface (le motif de
     `#o-account`, qui suit son courriel). Elle voyage comme `smsConsent`,
     booléen strict, toujours envoyé : publier est le moment où la personne
     s'est prononcée. Le domaine le valide (`validateSmsConsent` : absent ou
     nul = faux ; tout non-booléen = `sms_consent_invalide`) ; consentir sans
     numéro composable = `telephone_requis_sms`. Jamais un attribut de
     l'offre, jamais dans une projection.
   - *Notaire* : `alertes.sms` (booléen strict, faux par défaut — un profil
     antérieur lit faux) et l'interrupteur « Alertes par texto — Envoyées au
     numéro de votre profil ». Pas de second numéro à saisir : le téléphone du
     profil (ADR 0033) EST le numéro. Sans numéro composable,
     `telephone_requis_sms`. Chaque sauvegarde qui porte `alertes` réécrit le
     registre : « on » octroie, « off » retire.
   - *Depuis les préférences* (`/notification-preferences`) : `sms: { consent,
     telephone: masqué }` en lecture (`domain.maskTelephone`, quatre derniers
     chiffres), `smsConsent` en écriture, sur le numéro DÉJÀ enregistré.

3. **Le texto est la seconde jambe d'un envoi, jamais un envoi à part.** Dans
   `sendOnce`, APRÈS les gardes du courriel (retrait marketing, préférence par
   gabarit, doublon SENT#, gabarit éteint par l'admin) et après le courriel
   parti et inscrit : si un port `sms` est composé, si `TEMPLATE_META[key].sms
   === true`, si le consentement de CE destinataire est au registre avec un
   numéro composable, et si `<kind>:sms` n'est pas déjà dans SENT# — alors
   `sms.send({ to: e164, text })`, `markNotificationSent(refId, kind + ':sms')`,
   et une ligne au journal Loi 25 (`appendSubjectEvent`, kind `…:sms`). Un
   texto qui échoue ne coûte JAMAIS le courriel : le résultat porte
   `sms: { sent: false, reason: 'sms-failed' }` et le texto reste dû. Un
   gabarit éteint, un désabonnement, un doublon taisent les DEUX canaux — parce
   que la jambe court après ces gardes, pas à côté.

4. **Le texte est UNE ligne, calculée par le domaine.** `domain.smsText({ lang,
   subject, url })` : « Nota : » / « Nota: » selon la langue du destinataire
   (la même que le courriel), le sujet tel qu'envoyé (surcharge admin comprise,
   ADR 0018), « — », le lien que le bouton du courriel porte (le lien signé du
   client, ADR 0033 §2.7, ou la console du notaire sur l'acte). 320 caractères
   au plus ; quand il faut couper, c'est le sujet qui cède, jamais le lien. Un
   texto est un signal d'ouvrir le courriel ou l'application, pas une seconde
   copie.

5. **Dix-sept gabarits textent, et pas un de plus** — liés à un acte, sensibles
   au temps : `offerRetained`, `dateApproaching`, `dateMissedNoUptake`,
   `propositionRecue`, `messageDuNotaire`, `documentsDemandes`,
   `offerCancelled`, `actReleased`, `cautionRefusee` (client) ;
   `demandeRetenueNotaire`, `propositionAcceptee`, `propositionRefusee`,
   `messageDuClient`, `documentDuClient`, `offerCancelledNotary`,
   `nouvelleDemande`, `cautionRefuseeNotaire` (notaire). Jamais un lien
   magique, jamais un avis opérateur/admin/partenaire, jamais une campagne. Le
   test `sms-notifications.test.mjs` fige la liste exacte.

6. **Composition.** Handler et lot de rappels : `NOTA_SMS_ENABLED === 'true'`
   branche `createSnsSmsAdapter` (type Transactional, `NOTA_SMS_SENDER_ID`) ;
   sinon `sms: null` et le notifieur est exactement ce qu'il était. Pile locale
   : `createFileSms` écrit un `.json` par texto à côté des courriels
   (`NOTA_LOCAL_SMS_DIR`, par défaut `.local-mail/`) et imprime la ligne.

## Conséquences

- **Infra, opt-in.** `var.sms_enabled` (infra/sms.tf) reste faux par défaut ;
  l'activer pose le `sns:Publish` et le plafond mensuel de dépense. Rien ne
  texte tant que le propriétaire ne l'a pas allumé — et même allumé, rien ne
  texte sans consentement.
- **Loi 25.** Le numéro était déjà au dossier (offre, profil) ; le consentement
  est un attribut NOUVEAU, daté, par personne. Le droit d'accès le voit par le
  journal (`…:sms`) ; le droit d'effacement a sa porte (`deleteSmsConsent`).
  **Ouvert :** `domain.erasurePlan` et `admin.js eraseUserFile` ne connaissent
  pas encore la famille SMSCONSENT#, et la console admin est en lecture seule
  sur la table client (`MainTableReadOnly`, infra/admin.tf) : comme pour
  MAILPREF# et UNSUB#, l'effacement de ce registre demande une porte
  `LeadingKeys SMSCONSENT#*` ET son inscription au plan. À faire dans la même
  passe que les autres familles nominatives que le plan annonce déjà comme
  « non exécutables ».
- **LCAP art. 13, la preuve.** Le registre SMSCONSENT# porte la dernière
  décision et sa date, pas l'historique. Le journal de consentement
  (`appendConsentEvent`) ne reçoit pas encore un événement « texto » distinct ;
  si un litige exige l'histoire complète des octrois/retraits texto, c'est la
  prochaine pièce.
- **Le test de 2026-09-03** (`pref-ch-sms` doit être nul) est inversé, avec le
  motif ci-dessus dans le test.
- **Le web** envoie `alertes.sms` dans chaque POST /notary/profile : un client
  ancien qui ne l'envoie pas obtient le défaut (faux), jamais un consentement
  déduit.
