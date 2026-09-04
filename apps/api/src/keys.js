'use strict';

const { createHash } = require('node:crypto');

/**
 * Single-table key design.
 *
 * Partition by month so the public calendar reads exactly one partition per
 * month it displays:
 *
 *   PK = MONTH#YYYY-MM        (all bids that month, one Query)
 *   SK = BID#YYYY-MM-DD#<id>  (sorted by day then id within the partition)
 *
 * A future notary console adds SUB#<notaryId> and DOSSIER#<bidId> items in the
 * same table; those keys are reserved here but unused until continue-prompt #3.
 *
 * Billing adds two more item shapes in the same single table:
 *
 *   PK = NOTARY#<id>          SK = PROFILE   (a notary's subscription profile)
 *   PK = EVENT#<stripeId>     SK = EVENT     (a processed webhook event, for
 *                                             idempotent delivery)
 *
 * Notifications add two more item shapes in the same single table:
 *
 *   PK = SENT#<refId>#<kind>  SK = SENT      (one notification/reminder already
 *                                             sent — the idempotency ledger so a
 *                                             kind is never sent twice)
 *   PK = UNSUB#<email>        SK = UNSUB     (a recorded CASL/Law-25 opt-out; the
 *                                             sender checks it before every send)
 */

function monthOf(dateISO) {
  return String(dateISO).slice(0, 7);
}

function bidPK(dateISO) {
  return 'MONTH#' + monthOf(dateISO);
}

function bidSK(bid) {
  return `BID#${bid.dateISO}#${bid.id}`;
}

function monthPK(month) {
  return 'MONTH#' + month;
}

// Notary subscription profile.
function notaryPK(id) {
  return 'NOTARY#' + id;
}
const NOTARY_SK = 'PROFILE';

// Processed webhook event (idempotency ledger).
function eventPK(stripeEventId) {
  return 'EVENT#' + stripeEventId;
}
const EVENT_SK = 'EVENT';

// Sent-notification ledger: one item per (bid|subscription id, kind) already
// mailed, so a reminder/notification is never sent twice.
function sentPK(refId, kind) {
  return `SENT#${refId}#${kind}`;
}
const SENT_SK = 'SENT';

// Recorded opt-out. Email is lowercased so lookups are case-insensitive.
function unsubPK(email) {
  return 'UNSUB#' + String(email).trim().toLowerCase();
}
const UNSUB_SK = 'UNSUB';

// --- Notary console -----------------------------------------------------------
// A notary declining a bid: a single marker item looked up by GetItem, so a
// declined bid drops out of that notary's list without a Scan.
//
//   PK = DECLINE#<notaryId>#<bidId>   SK = DECLINE
//
// A notary retaining (accepting) a bid: a pointer item under the notary's own
// partition, so their calendar feed is one Query (begins_with) — no Scan, which
// the API Lambda role deliberately lacks (Get/Put/Query only, see infra).
//
//   PK = NOTARY#<notaryId>   SK = RETAINED#<dateISO>#<bidId>
function declinePK(notaryId, bidId) {
  return `DECLINE#${notaryId}#${bidId}`;
}
const DECLINE_SK = 'DECLINE';

function retainedSK(dateISO, bidId) {
  return `RETAINED#${dateISO}#${bidId}`;
}
const RETAINED_PREFIX = 'RETAINED#';

// A client evaluation, anonymized, under the rated notary's own partition
// (ADR 0021): their whole track record is one Query (begins_with, newest
// first) — no Scan, no month walk over BID items. `createdAt` leads the SK so
// lexical order IS chronological order; `bidId` keeps two same-instant
// evaluations distinct.
//
//   PK = NOTARY#<notaryId>   SK = EVAL#<createdAt>#<bidId>
function notaryEvalSK(createdAt, bidId) {
  return `EVAL#${createdAt}#${bidId}`;
}
const NOTARY_EVAL_PREFIX = 'EVAL#';

// --- Notary console magic-link login (MAIN table) ----------------------------
// A single-use passwordless challenge that proves a notary owns the mailbox
// BEFORE any session token is minted (the old sign-in trusted a bare request
// email — see admin.js:6-9). These live in the MAIN `nota-main` table (the
// public API Lambda's own table) — deliberately NOT the admin LOGIN#/RL# records
// in the separate `nota-admin` table, which the public Lambda cannot reach. The
// distinct `NOTARY_LOGIN#`/`NRL#` prefixes also mean an admin and a notary
// challenge can never be confused for one another.
//
//   PK = NOTARY_LOGIN#<cid>   SK = NOTARY_LOGIN   (a single-use magic link; TTL)
//   PK = NRL#<scope>#<key>    SK = NRL#<window>   (a login rate-limit counter; TTL)
function notaryLoginPK(cid) {
  return 'NOTARY_LOGIN#' + String(cid);
}
const NOTARY_LOGIN_SK = 'NOTARY_LOGIN';

function notaryRlPK(scope, key) {
  return `NRL#${scope}#${String(key).trim().toLowerCase()}`;
}
const NOTARY_RL_SK = 'NRL';

// --- Analytics rollups (STATS#) ----------------------------------------------
// Admin analytics are computed WITHOUT a Scan (the API role deliberately lacks
// it). Marketplace history is folded into rollup items on the SAME main table
// as it happens: each fact (a bid posted, a retain, an act completed) does an
// atomic UpdateItem ADD on a small counter item, so concurrent writers never
// race and there is never a read-modify-write. The admin reads them back with
// bounded range Queries:
//
//   PK = STATS#GLOBAL          SK = D#YYYY-MM-DD  (a day's counters: offers,
//                                                  retenues, actes, commission¢)
//   PK = STATS#SVC#<serviceId> SK = D#YYYY-MM-DD  (the same, per service)
//   PK = STATS#GAUGE           SK = GAUGE         (present-tense running totals:
//                                                  notaires actifs / en intégration)
//
// Writes are best-effort in the public Lambda — a rollup failure must never
// break a bid/retain/act — so counters can drift on partial failure; a later
// reconcile pass (admin phase 4) heals them from the source MONTH# partitions.
// Write-sharding for the hot day counters. Every marketplace write ADDs to ONE
// of STATS_SHARDS shard partitions (chosen at random per fact), so no single
// item absorbs the whole write rate — a DynamoDB item caps at ~1000 WCU/s and
// on-demand adaptive capacity cannot split a single item. The admin read sums
// all shards (K small range Queries, on the rare dashboard load). K is a fixed
// structural constant so the read and write sides never skew; raising it needs a
// reconcile of historical shards.
const STATS_SHARDS = 10;
function shardIndex(shard) {
  const k = STATS_SHARDS;
  return ((Number(shard) % k) + k) % k;
}
function statsGlobalPK(shard) {
  return 'STATS#GLOBAL#' + shardIndex(shard);
}
function statsServicePK(serviceId, shard) {
  return 'STATS#SVC#' + String(serviceId) + '#' + shardIndex(shard);
}
function statsDaySK(dateISO) {
  return 'D#' + String(dateISO).slice(0, 10);
}
const STATS_DAY_PREFIX = 'D#';
const STATS_GAUGE_PK = 'STATS#GAUGE';
const STATS_GAUGE_SK = 'GAUGE';

// Completed-act ledger (idempotency): one write-once item per retained act, so
// re-submitting the same completion never double-charges or double-counts.
//   PK = ACT#<bidId>   SK = ACT
function actPK(bidId) {
  return 'ACT#' + String(bidId);
}
const ACT_SK = 'ACT';

// --- Live support messaging (ADR 0026) ----------------------------------------
// One item per chat thread, keyed by the thread id minted at the first message;
// the widget's signed token carries that id, so reads are a single GetItem and
// no listing index is needed.
//   PK = SUPPORT#<id>   SK = THREAD
function supportPK(id) {
  return 'SUPPORT#' + String(id);
}
const SUPPORT_SK = 'THREAD';

// --- Partner referral registry (ADR 0011) ------------------------------------
// A professional claiming their referral code self-serve (POST /partenaires):
// one item per code, keyed by the NORMALIZED code so uniqueness is the key
// itself — the write-once conditional put IS the "already taken" check, no
// Query needed. Never exposed publicly; the admin ledger joins it by GetItem.
//   PK = PARTNER#<CODE>   SK = PARTNER
function partnerPK(code) {
  return 'PARTNER#' + String(code).trim().toUpperCase();
}
const PARTNER_SK = 'PARTNER';

// Registered partners also carry sparse GSI1 attributes (GSI1PK = 'PARTNER',
// GSI1SK = code) so the admin ledger can enumerate every CLAIMED code with one
// Query — a partner with zero referrals is still a row the operator must see.
// Items written before this overload lack the attributes and simply do not
// appear until rewritten; the ledger degrades to activity-only rows for them.
// A PARTNER# item is written ONLY once the claimant's email is verified (it
// carries a `confirmedAt` stamp): claiming a code is a two-step, mailbox-proven
// act (see the claim challenge below), so a squatter's unverified claim never
// becomes a PARTNER# record, an owner-of-record, or a payee.
const PARTNER_GSI1PK = 'PARTNER';

// --- Partner code claim: email verification (ADR 0011, fraud-hardening) -------
// Claiming a code is a TWO-step, mailbox-proven handshake — mirroring the notary
// magic link — so an unverified claim never becomes the payee of record. It
// closes two referral fraud vectors: CODE SQUATTING (grabbing a real broker's
// obvious code before they register, then collecting their genuine referrals)
// and HARVEST-THEN-CLAIM (farming earnings on a vanity code, then claiming it):
//   • POST /partenaires        mints a single-use challenge tied to (code,email)
//     and emails a confirmation link. NO PARTNER# record is written yet.
//   • POST /partenaires/verify redeems the link, atomically consumes the
//     challenge, and only THEN writes the confirmed PARTNER# record.
// The challenge lives on the MAIN table under its own prefix (distinct from the
// notary NOTARY_LOGIN#/NRL# records, so a notary and a partner challenge can
// never be confused). Keyed by the challenge id so verify consumes it by cid.
//   PK = PARTNER_CLAIM#<cid>   SK = PARTNER_CLAIM   (a single-use claim; TTL)
//   PK = PRL#<scope>#<key>     SK = PRL#<window>    (a per-IP claim rate limit; TTL)
function partnerClaimPK(cid) {
  return 'PARTNER_CLAIM#' + String(cid);
}
const PARTNER_CLAIM_SK = 'PARTNER_CLAIM';

function partnerRlPK(scope, key) {
  return `PRL#${scope}#${String(key).trim().toLowerCase()}`;
}
const PARTNER_RL_SK = 'PRL';

// --- Durable referral earnings (ADR 0011) -------------------------------------
// The money owed to a partner is recorded at EVENT time — the retain — as a
// write-once item in the partner's own partition, so the admin ledger is
// ALL-TIME and monotonic instead of an artifact of the live month window:
//
//   PK = PARTNER#<CODE>   SK = EARN#CLIENT#<bidId>     (a referred demand was
//                                                       retained: +REFERRAL.client)
//   PK = PARTNER#<CODE>   SK = EARN#NOTAIRE#<notaryId> (a referred notary retained
//                                                       their FIRST act:
//                                                       +REFERRAL.notaire, once ever)
//
// The key IS the idempotency: attribute_not_exists rejects a replayed accept.
// Every earning also joins a second sparse GSI1 overload (GSI1PK = 'REFEARN',
// GSI1SK = <CODE>#<TRACK>#<ref>) so the ledger reads all earnings in one
// bounded Query — earnings are rare, real-money events, never a table walk.
function referralEarnSK(track, refId) {
  return `EARN#${String(track).toUpperCase()}#${refId}`;
}
const REFEARN_PREFIX = 'EARN#';
const REFEARN_GSI1PK = 'REFEARN';
function referralEarnGSI1SK(code, track, refId) {
  return `${String(code).trim().toUpperCase()}#${String(track).toUpperCase()}#${refId}`;
}

// --- Admin-editable email subject overrides (ADR 0018) -------------------------
// One item per template key, all under a single CONFIG#EMAIL partition. Product
// configuration lives WITH the product data on the MAIN table on purpose: the
// notifier runs inside the public API Lambda, which already reads this table on
// every send, so an override lookup is a same-table GetItem — no cross-table
// plumbing, no second repo. The admin Lambda (read-only on customer data) gets
// a narrowly-SCOPED write door instead: its IAM policy allows writes only when
// dynamodb:LeadingKeys = ["CONFIG#EMAIL"] (infra/admin.tf, ADR 0018 §6), so the
// admin console can edit templates but can never touch a customer item.
//
//   PK = CONFIG#EMAIL   SK = TPL#<templateKey>
function emailOverridePK() {
  return 'CONFIG#EMAIL';
}
function emailOverrideSK(key) {
  return 'TPL#' + String(key);
}
const EMAIL_OVERRIDE_PREFIX = 'TPL#';

// --- Le prix de Nota, décidé par Nota (ADR 0031) -------------------------------
// UN item : le montant fixe, en cents, que la tarification ajoute à toute offre.
// Ce partition remplace CONFIG#COMMISSION, qui portait un barème de taux :
// l'art. 29.1 du Code de déontologie interdit au notaire toute convention
// mettant en péril son désintéressement, et un prix indexé sur sa cote en était
// une. Même dessin que CONFIG#EMAIL — la configuration produit vit avec les
// données produit sur la table PRINCIPALE (la facturation la lit à chaque
// tarification), et la porte d'écriture de la Lambda admin, bornée par
// LeadingKeys, gagne exactement cette partition (infra/admin.tf).
//
//   PK = CONFIG#PRIX   SK = PRIX
function prixConfigPK() {
  return 'CONFIG#PRIX';
}
const PRIX_CONFIG_SK = 'PRIX';

// --- Admin-decided cancellation fee barème (ADR 0023) --------------------------
// ONE item: the days-before-signing paliers the cancel route prices a retained
// withdrawal with. Same design as CONFIG#PRIX — the cancel route reads it
// through the repo it already owns, and the admin Lambda's LeadingKeys-scoped
// write door gains exactly this partition (infra/admin.tf).
//
//   PK = CONFIG#ANNULATION   SK = BAREME
function cancellationConfigPK() {
  return 'CONFIG#ANNULATION';
}
const CANCELLATION_CONFIG_SK = 'BAREME';

// --- Campagnes ciblées (segments.js) ------------------------------------------
// Trois familles d'items, TOUTES sur la table PRINCIPALE et toutes rangées sous
// une partition FIXE — un seul item par identifiant/adresse, adressé par sa clé
// de tri. Le dessin n'est pas un choix de commodité : la porte d'écriture de la
// Lambda admin est bornée par `dynamodb:LeadingKeys` (infra/admin.tf), une
// condition qui compare la clé de PARTITION à une liste de valeurs exactes. Une
// clé par adresse (`CAMPAGNE#<courriel>`, à la manière d'UNSUB#) serait donc
// impossible à autoriser sans ouvrir la table entière — c'est-à-dire sans
// défaire l'isolement qui fait que la console ne peut pas toucher un item
// client. Le prix de ce dessin est une partition qui grossit ; il est
// acceptable ici parce que chaque lecture est adressée par clé complète
// (GetItem / BatchGetItem), jamais par un parcours de la partition.
//
//   PK = AUDIENCE#GROUPES   SK = GROUP#<id>       (une liste de destinataires)
//   PK = CONSENT#COURRIEL   SK = EMAIL#<courriel> (la base de consentement LCAP)
//   PK = CAMPAGNE#ENVOIS    SK = EMAIL#<courriel> (la dernière campagne reçue)
//
// Le groupe d'AUDIENCE n'est pas le groupe RBAC (GROUPS / GROUP#<id>, table
// admin) : l'un réunit des permissions d'administrateurs, l'autre des adresses
// de destinataires. Deux partitions, deux tables, et jamais le même item.
//
// Le registre des envois est ce qui donne son sens au plafond de fréquence de
// segments.js — art. 56 1° du Code de déontologie, « inciter quelqu'un de façon
// pressante ou répétée ». Un seul item par adresse, écrasé à chaque campagne,
// comme UNSUB# : ce qu'on doit savoir, c'est la DERNIÈRE fois, pas l'historique.
const normalizedEmail = (email) => String(email == null ? '' : email).trim().toLowerCase();

function audienceGroupsPK() {
  return 'AUDIENCE#GROUPES';
}
function audienceGroupSK(groupId) {
  return 'GROUP#' + String(groupId);
}
const AUDIENCE_GROUP_PREFIX = 'GROUP#';

function emailConsentPK() {
  return 'CONSENT#COURRIEL';
}
function emailConsentSK(email) {
  return 'EMAIL#' + normalizedEmail(email);
}

function campaignLogPK() {
  return 'CAMPAGNE#ENVOIS';
}
function campaignLogSK(email) {
  return 'EMAIL#' + normalizedEmail(email);
}

// --- Registre de CONSENTEMENT (Loi 25, LCAP) ----------------------------------
// La partition CONSENT#COURRIEL juste au-dessus porte l'ÉTAT COURANT : un item
// par adresse, écrasé. Un état écrasé ne prouve rien — or l'art. 13 LCAP met la
// preuve du consentement à la charge de l'expéditeur, et la Loi 25 (art. 8, 12)
// exige de pouvoir dire à quoi la personne a consenti, QUAND, et sur quelle
// version du texte. D'où un JOURNAL append-only, une partition par personne :
//
//   PK = CONSENT#<courriel minuscule>   SK = <at>#<id>
//
// L'instant mène la clé de tri, donc l'ordre lexical EST l'ordre chronologique
// et la chaîne se relit d'un bout à l'autre par une seule Query ; `<id>` garde
// distincts deux événements du même instant. L'écriture est conditionnelle
// (attribute_not_exists), comme les écrivains d'audit : un rejeu ne réécrit
// jamais un consentement déjà donné.
//
// Les deux partitions ne peuvent pas se confondre : celle de l'état courant est
// le littéral MAJUSCULE `CONSENT#COURRIEL`, celles du journal sont des adresses
// minuscules — et une adresse contient toujours un « @ ».
function consentJournalPK(email) {
  return 'CONSENT#' + normalizedEmail(email);
}
function consentJournalSK(at, id) {
  return `${at}#${id}`;
}

// --- Avis EN APPLICATION (le carnet et la console notaire) ---------------------
// Un avis par item, rangé sous son destinataire, l'instant en tête du tri :
//
//   PK = NOTIF#<sujet>   SK = <at>#<id>
//
// Le SUJET d'un notaire est son courriel : il a un compte, une identité stable.
// Un client n'en a pas — il ne possède qu'un jeton porteur, remis une fois à la
// publication de son offre. Ce jeton est un SECRET : le ranger tel quel dans une
// clé de partition le rendrait lisible dans un export, un journal de requêtes
// lentes ou une sauvegarde, et quiconque le lit devient ce client. Le sujet est
// donc le HACHÉ du jeton — déterministe (le même porteur retrouve ses avis),
// irréversible (la table ne contient rien qui permette de rejouer le jeton).
//
// Un sujet est une CLÉ, donc il se normalise comme toutes les autres clés
// dérivées d'une adresse (`normalizedEmail`) : sans cela, « Roy@Etude.CA » et
// « roy@etude.ca » sont deux boîtes d'avis pour la même personne, et l'avis
// écrit par un chantier reste invisible au chantier qui le lit. Un haché de
// jeton est déjà minuscule : la normalisation le laisse intact.
//
// Et un sujet VIDE est refusé. La partition `NOTIF#` seule serait une boîte
// COMMUNE : tous les visiteurs sans sujet y liraient les avis des autres, et
// un « tout marquer lu » cocherait ceux de tout le monde.
function notifSubject(sujet) {
  const clean = normalizedEmail(sujet);
  if (!clean) throw new Error('notifSubject : un sujet vide vaudrait une boîte d’avis COMMUNE');
  return clean;
}
function notifPK(sujet) {
  return 'NOTIF#' + notifSubject(sujet);
}
function notifSK(at, id) {
  return `${at}#${id}`;
}
// Les deux dérivations refusent le vide plutôt que de le hacher : `String(null)`
// et `String('')` donnent le MÊME haché, donc la même partition — deux clients
// sans jeton partageraient leur boîte d'avis. C'est le réflexe de
// `campaignRecipientsPK` : une clé refuse plutôt que de corrompre.
function notaryNotifSubject(email) {
  const clean = normalizedEmail(email);
  if (!clean) throw new Error('notaryNotifSubject : un sujet de notaire est son adresse, et elle est requise');
  return clean;
}
function clientNotifSubject(jeton) {
  const brut = String(jeton == null ? '' : jeton);
  if (!brut.trim()) throw new Error('clientNotifSubject : sans jeton porteur, il n’y a pas de sujet à hacher');
  // Le jeton est haché TEL QUEL — le rogner changerait la partition d'un
  // porteur qui, lui, présente toujours la même chaîne.
  return 'client:' + createHash('sha256').update(brut).digest('hex');
}

// --- Journal PAR SUJET : ce qui est parti vers cette personne -------------------
//
//   PK = SUJET#<sujet>   SK = <at>#<id>
//
// Le registre `SENT#<refId>#<kind>` répond « ce courriel-là est-il déjà parti ? »
// (idempotence) ; il est rangé par ÉVÉNEMENT, donc il ne peut pas répondre à la
// question inverse — « qu'a-t-on envoyé à cette personne ? » — que la Loi 25
// (art. 27, droit d'accès) rend un jour obligatoire. Même dessin que le journal
// de consentement : append-only, instant en tête du tri, une Query par personne.
function subjectJournalPK(sujet) {
  return 'SUJET#' + notifSubject(sujet);
}
function subjectJournalSK(at, id) {
  return `${at}#${id}`;
}

// --- Registre des DESTINATAIRES d'une campagne ---------------------------------
//
//   PK = CAMPAGNE#<campagneId>   SK = EMAIL#<courriel minuscule>
//
// À ne pas confondre avec `CAMPAGNE#ENVOIS` (plus haut) : celui-là est l'ÉTAT —
// un item par adresse, écrasé, qui porte le plafond de fréquence de l'art. 56 1°
// C.déont. Celui-ci est l'HISTOIRE : qui a reçu quoi, dans quelle campagne, avec
// quel résultat. Une ligne par (campagne, adresse), écrite une seule fois — le
// rejeu d'un envoi ne doit pas repeindre un « refusé » en « envoyé ».
//
// La partition étant nommée par l'identifiant de campagne, un identifiant qui
// vaudrait `ENVOIS` viserait la partition du plafond de fréquence et écraserait
// la dernière date d'envoi de chaque destinataire. La clé refuse plutôt que de
// corrompre : c'est le seul identifiant réservé du schéma.
// AVANT DE BRANCHER CE REGISTRE, LIRE CECI. La partition est nommée par
// l'identifiant de campagne, donc elle est NOUVELLE à chaque campagne — et la
// porte d'écriture de la Lambda admin est bornée par `dynamodb:LeadingKeys`
// (infra/admin.tf), une condition qui compare la clé de partition à une LISTE
// DE VALEURS EXACTES. Aucune liste finie ne couvre des identifiants qu'on mint
// à l'envoi : telle quelle, la console admin ne peut PAS écrire ici sans que
// l'on élargisse sa permission à toute la table — c'est-à-dire sans défaire
// l'isolement qui fait qu'elle ne peut pas toucher un item client. Deux issues,
// et le chantier qui branchera tranchera : soit l'écriture part de la Lambda
// PUBLIQUE (qui a déjà PutItem sur la table), soit la forme devient une
// partition FIXE `CAMPAGNE#DESTINATAIRES` avec SK `<campagneId>#<courriel>`,
// autorisable par LeadingKeys exactement comme AUDIENCE#GROUPES ci-dessus.
const CAMPAIGN_ID_RESERVE = 'ENVOIS';
function campaignRecipientsPK(campagneId) {
  const id = String(campagneId == null ? '' : campagneId).trim();
  if (id.toUpperCase() === CAMPAIGN_ID_RESERVE) {
    throw new Error(`campaignRecipientsPK: « ${CAMPAIGN_ID_RESERVE} » est réservé au registre de fréquence`);
  }
  return 'CAMPAGNE#' + id;
}
function campaignRecipientSK(email) {
  return 'EMAIL#' + normalizedEmail(email);
}

// --- Index CLIENT : retrouver une personne par son adresse ---------------------
//
//   PK = CLIENT#<courriel minuscule>   SK = BID#<dateISO>#<bidId>
//
// Les offres se rangent par MOIS (MONTH#YYYY-MM) : c'est ce que le carnet lit.
// Personne, donc, ne peut répondre « quelles offres cette personne a-t-elle
// posées ? » sans parcourir tous les mois — c'est-à-dire un Scan, que le rôle
// IAM refuse. Ce pointeur, écrit à la publication, rend la personne trouvable
// par une Query. C'est aussi ce qui rend une demande d'accès ou d'effacement
// (Loi 25, art. 27 et 28) exécutable.
//
// Ce n'est PAS un journal : sa clé porte déjà l'unicité, une réindexation est
// la même ligne réécrite. La date mène la clé de tri, donc la lecture est
// chronologique sans tri côté client.
function clientIndexPK(email) {
  return 'CLIENT#' + normalizedEmail(email);
}
function clientBidSK(dateISO, bidId) {
  return `BID#${dateISO}#${bidId}`;
}
const CLIENT_BID_PREFIX = 'BID#';

// --- Marque d'EFFACEMENT (Loi 25, art. 28) -------------------------------------
// Un effacement demandé est un fait à conserver : sans marque, rien ne distingue
// « nous avons effacé cette personne » de « nous ne l'avons jamais connue », et
// une réimportation la ferait revenir. Un item, adressé par sa clé.
//
//   PK = ERASURE#<courriel minuscule>   SK = ERASURE
function erasurePK(email) {
  return 'ERASURE#' + normalizedEmail(email);
}
const ERASURE_SK = 'ERASURE';

// AVANT DE BRANCHER LE RÉABONNEMENT, LIRE CECI. Le rôle IAM de la Lambda
// PUBLIQUE accorde GetItem, PutItem, Query et UpdateItem — PAS DeleteItem
// (infra/lambda.tf). Toute porte qui efface un item lève donc AccessDenied en
// production, et le dépôt en compte déjà : `removeRetained`, appelé par
// l'annulation (handler.js), n'a jamais retiré un rendez-vous annulé du flux
// d'agenda du notaire ailleurs qu'en test. `deleteUnsubscribe` bute sur le
// même mur : le brancher demande un `terraform apply` qui ajoute DeleteItem.

// --- Rétentions et bornes de lecture, partagées par les DEUX adaptateurs --------
// Elles vivent ici parce que `repo-memory` et `repo-dynamo` doivent s'accorder
// au chiffre près : une borne recopiée des deux côtés finit par diverger, et la
// divergence ne se voit qu'en production.
//
// Aucune de ces valeurs n'est gravée : elles se surchargent par
// l'environnement, comme tout ce que l'exploitation doit pouvoir régler sans
// redéployer du code. Une surcharge illisible (vide, négative, non numérique)
// est IGNORÉE — un déploiement ne tombe pas sur une variable mal tapée.
function entierEnv(nom, defaut) {
  const brut = process.env[nom];
  if (brut === undefined || brut === null || String(brut).trim() === '') return defaut;
  const n = Number(brut);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaut;
}

// Un pointeur d'index doit mourir avec ce qu'il indexe — un index qui survit à
// l'offre pointe dans le vide, un index qui meurt avant la rend introuvable.
// C'est la MÊME rétention que le ttl de l'offre (apps/api/src/handler.js).
//
// CELLE-CI N'A PAS DE SURCHARGE, et c'est délibéré : `handler.js` calcule
// encore le ttl de l'offre en clair (`+ 400 * 86400`) au lieu d'appeler
// `bidTtl`. Une variable d'environnement désaccorderait donc l'index de ce
// qu'il indexe sans que rien ne le dise. Elle s'ouvrira le jour où le handler
// passera par cette maison commune — la garde de
// `registres-persistance.test.mjs` compare déjà les deux par la porte.
const BID_RETENTION_DAYS = 400;
function bidTtl(dateISO) {
  const ms = Date.parse(String(dateISO) + 'T00:00:00Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) + BID_RETENTION_DAYS * 86400 : null;
}

// Un avis en application est une copie de courtoisie d'un fait qui vit ailleurs
// (l'offre, l'acte, le fil de messages) : il n'a pas à survivre à la saison où
// il servait. Minimisation (Loi 25, art. 3.2) plutôt que conservation par défaut.
const NOTIF_RETENTION_DAYS = entierEnv('NOTA_NOTIF_RETENTION_DAYS', 180);
function notifTtl(atISO) {
  const ms = Date.parse(String(atISO));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) + NOTIF_RETENTION_DAYS * 86400 : null;
}

// Plafonds de page. Une lecture non bornée finit par ramener une partition
// entière dans la mémoire d'une Lambda ; ces cinq nombres sont la borne dure,
// et AUCUNE lecture de ces registres ne s'en dispense.
//
// Deux d'entre elles bornent une lecture qui se veut exhaustive — la chaîne de
// consentement, les offres d'une personne. La fenêtre s'y prend donc par le
// bout RÉCENT et se rend dans l'ordre chronologique : si une partition devait
// un jour déborder, ce qui tombe est le passé lointain, jamais le dernier fait
// (le retrait de consentement décide seul si l'on peut encore démarcher).
const NOTIF_PAGE_MAX = entierEnv('NOTA_NOTIF_PAGE_MAX', 50);
const SUBJECT_PAGE_MAX = entierEnv('NOTA_SUBJECT_PAGE_MAX', 50);
const CAMPAIGN_PAGE_MAX = entierEnv('NOTA_CAMPAIGN_PAGE_MAX', 100);
const CONSENT_PAGE_MAX = entierEnv('NOTA_CONSENT_PAGE_MAX', 50);
const CLIENT_BID_PAGE_MAX = entierEnv('NOTA_CLIENT_BID_PAGE_MAX', 100);

// Un curseur de page voyage : il sort du dépôt, traverse une réponse HTTP et
// revient. Il doit donc être une CHAÎNE opaque, identique en forme d'un
// adaptateur à l'autre — pas un `LastEvaluatedKey` DynamoDB nu, qui fuiterait
// la forme des clés et ne survivrait pas à l'adaptateur mémoire. Un curseur
// illisible se lit `null` : une page repart du début plutôt que de lever.
function encodeCursor(clef) {
  return clef ? Buffer.from(JSON.stringify(clef), 'utf8').toString('base64') : null;
}
function decodeCursor(curseur) {
  if (!curseur) return null;
  try {
    const clef = JSON.parse(Buffer.from(String(curseur), 'base64').toString('utf8'));
    return clef && typeof clef === 'object' ? clef : null;
  } catch {
    return null;
  }
}

// --- Admin table (admin.nota.ca) ---------------------------------------------
// Identity, revocable sessions, single-use magic-link challenges, the immutable
// audit log and rate-limit counters live in a SEPARATE `nota-admin` table, so
// the admin surface can never read or write customer data and its blast radius
// is isolated (Law 25). Same single-table prefix design, distinct table.
//
//   PK = ADMIN#<adminId>     SK = PROFILE            (an admin's identity + role)
//   PK = LOGIN#<challengeId> SK = LOGIN              (a single-use magic link; TTL)
//   PK = SESSION#<sessionId> SK = SESSION            (a revocable session; TTL)
//   PK = AUDIT#<YYYY-MM-DD>  SK = <isoTs>#<id>       (append-only action log)
//   PK = RL#<scope>#<key>    SK = RL                 (a rate-limit counter; TTL)
// --- Groupes d'administrateurs (RBAC découplé) ------------------------------
// Un groupe réunit des permissions et s'attribue à des utilisateurs. Il vit sur
// la table ADMIN, avec les identités : un groupe EST une donnée d'identité, et
// la table principale — celle des offres, lisible par la Lambda publique — ne
// doit jamais porter de quoi décider d'une autorisation.
//
// UNE seule partition, un item par groupe :
//   PK = GROUPS   SK = GROUP#<id>
//
// Même dessin que CONFIG#EMAIL : la liste se lit par UNE Query sur une
// partition, jamais par un Scan. Le dépôt n'en fait aucun, et ce n'est pas un
// détail de performance — un Scan sur la table des identités élargirait la
// permission IAM de la Lambda admin à toute la table.
function groupsPK() {
  return 'GROUPS';
}
function groupSK(groupId) {
  return 'GROUP#' + String(groupId);
}
const GROUP_PREFIX = 'GROUP#';

function adminPK(adminId) {
  return 'ADMIN#' + String(adminId);
}
const ADMIN_SK = 'PROFILE';

function adminLoginPK(challengeId) {
  return 'LOGIN#' + String(challengeId);
}
const ADMIN_LOGIN_SK = 'LOGIN';

function adminSessionPK(sessionId) {
  return 'SESSION#' + String(sessionId);
}
const ADMIN_SESSION_SK = 'SESSION';

function auditPK(dayISO) {
  return 'AUDIT#' + String(dayISO).slice(0, 10);
}
function auditSK(isoTs, id) {
  return String(isoTs) + '#' + String(id);
}

function adminRlPK(scope, key) {
  return `RL#${scope}#${String(key).trim().toLowerCase()}`;
}
const ADMIN_RL_SK = 'RL';

// GSI1 attribute names — a sparse, overloaded global secondary index on the
// main table. The GSI1 index itself IS created (see infra/dynamodb.tf); admin
// phase 2 can overload it further (notary/act enumeration) by adding its own
// GSI1PK namespaces alongside the OPENBID# one below.
const GSI1_PK = 'GSI1PK';
const GSI1_SK = 'GSI1SK';

// --- Open-bid enumeration (reminder scheduler, no Scan) -----------------------
// The daily reminder worker needs "every open (not-retained) bid" across all
// month partitions. Rather than Scan the whole table (which bills for every
// item each day), OPEN bids carry sparse GSI1 attributes so the worker reads
// them with a single Query on GSI1PK = OPENBID_GSI1PK. A retained bid omits
// these attributes and therefore falls out of the sparse index automatically.
//
//   GSI1PK = "OPENBID"            (one partition holding all open bids)
//   GSI1SK = "<dateISO>#<id>"     (sorted by signing date, then id)
//
// Single partition is fine here: bid creation is low-rate and the read is one
// Query/day. If open-bid write volume ever approaches a single GSI partition's
// ceiling, shard OPENBID_GSI1PK by month and fan the daily read across shards.
const OPENBID_GSI1PK = 'OPENBID';
function openBidGSI1SK(bid) {
  return `${bid.dateISO}#${bid.id}`;
}

// --- Active-notary enumeration (daily carnet digest, no Scan) -----------------
// The daily digest worker needs "every ACTIVE notary" to mail them the new
// matching demands. Same sparse-GSI1 overload pattern as OPENBID/PARTNER:
// only a notary whose status is 'active' carries the attributes, so a pending
// or deauthorized profile falls out of the index automatically on its next
// putNotary. One partition is fine — the roster is read once a day.
//
//   GSI1PK = "NOTARY"    GSI1SK = "<id>"
const NOTARY_GSI1PK = 'NOTARY';
function notaryGSI1SK(notary) {
  return String(notary.id);
}

module.exports = {
  monthOf,
  bidPK,
  bidSK,
  monthPK,
  notaryPK,
  NOTARY_SK,
  eventPK,
  EVENT_SK,
  sentPK,
  SENT_SK,
  unsubPK,
  UNSUB_SK,
  notaryLoginPK,
  NOTARY_LOGIN_SK,
  notaryRlPK,
  NOTARY_RL_SK,
  declinePK,
  DECLINE_SK,
  retainedSK,
  RETAINED_PREFIX,
  // notary evaluation ledger (ADR 0021)
  notaryEvalSK,
  NOTARY_EVAL_PREFIX,
  actPK,
  ACT_SK,
  supportPK,
  SUPPORT_SK,
  partnerPK,
  PARTNER_SK,
  PARTNER_GSI1PK,
  partnerClaimPK,
  PARTNER_CLAIM_SK,
  partnerRlPK,
  PARTNER_RL_SK,
  referralEarnSK,
  REFEARN_PREFIX,
  REFEARN_GSI1PK,
  referralEarnGSI1SK,
  // analytics rollups (write-sharded day counters)
  STATS_SHARDS,
  statsGlobalPK,
  statsServicePK,
  statsDaySK,
  STATS_DAY_PREFIX,
  STATS_GAUGE_PK,
  STATS_GAUGE_SK,
  // admin-editable email overrides (ADR 0018)
  emailOverridePK,
  emailOverrideSK,
  EMAIL_OVERRIDE_PREFIX,
  // le prix de Nota, décidé par Nota (ADR 0031)
  prixConfigPK,
  PRIX_CONFIG_SK,
  cancellationConfigPK,
  CANCELLATION_CONFIG_SK,
  // campagnes ciblées (segments.js)
  audienceGroupsPK,
  audienceGroupSK,
  AUDIENCE_GROUP_PREFIX,
  emailConsentPK,
  emailConsentSK,
  campaignLogPK,
  campaignLogSK,
  // registre de consentement (Loi 25 / LCAP)
  consentJournalPK,
  consentJournalSK,
  // avis en application
  notifPK,
  notifSK,
  notifSubject,
  notaryNotifSubject,
  clientNotifSubject,
  // journal par sujet
  subjectJournalPK,
  subjectJournalSK,
  // destinataires d'une campagne
  CAMPAIGN_ID_RESERVE,
  campaignRecipientsPK,
  campaignRecipientSK,
  // index client
  clientIndexPK,
  clientBidSK,
  CLIENT_BID_PREFIX,
  // marque d'effacement (Loi 25)
  erasurePK,
  ERASURE_SK,
  // rétentions et bornes partagées par les deux adaptateurs
  BID_RETENTION_DAYS,
  bidTtl,
  NOTIF_RETENTION_DAYS,
  notifTtl,
  NOTIF_PAGE_MAX,
  SUBJECT_PAGE_MAX,
  CAMPAIGN_PAGE_MAX,
  CONSENT_PAGE_MAX,
  CLIENT_BID_PAGE_MAX,
  encodeCursor,
  decodeCursor,
  // admin table
  adminPK,
  ADMIN_SK,
  groupsPK,
  groupSK,
  GROUP_PREFIX,
  adminLoginPK,
  ADMIN_LOGIN_SK,
  adminSessionPK,
  ADMIN_SESSION_SK,
  auditPK,
  auditSK,
  adminRlPK,
  ADMIN_RL_SK,
  GSI1_PK,
  GSI1_SK,
  OPENBID_GSI1PK,
  openBidGSI1SK,
  NOTARY_GSI1PK,
  notaryGSI1SK,
};
