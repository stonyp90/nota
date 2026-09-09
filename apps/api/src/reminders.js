'use strict';

const crypto = require('node:crypto');

/**
 * Reminder scheduler use-case. Pure orchestration over two ports (Repo +
 * Notifier); no framework, no SDK, no clock of its own (injected). Driven daily
 * by the EventBridge Scheduler → Lambda (see infra/notifications.tf) and unit-
 * tested with the in-memory repo + fake mailer.
 *
 * The cadence itself lives in @nota/domain (dueReminders / REMINDER_OFFSETS):
 * this file encodes NO schedule of its own. It only asks the domain which
 * reminders are due today for each open bid, then sends them idempotently.
 *
 * Since ADR 0035 the same daily pass carries a MONEY gesture: placing the
 * caution (the client's card authorization) on every offer whose signing date
 * has entered the window the domain defines (CAUTION_LEAD_DAYS). The billing
 * port is optional — without it (demo, tests, no Stripe) the pass is skipped
 * and this file behaves exactly as it did before.
 */

const domain = require('@nota/domain');

async function runReminders({ repo, notifier, billing, now } = {}) {
  if (!repo) throw new Error('runReminders: repo is required');
  if (!notifier) throw new Error('runReminders: notifier is required');
  // Default clock = the Québec civil day (not the UTC day of the Lambda host),
  // so "J-1 demain" reminders fire on the client's calendar, not UTC's.
  const todayISO = (now || (() => domain.businessDay(null, process.env.NOTA_TIMEZONE)))();

  const open = await repo.listOpenBids();
  let due = 0;
  let sent = 0;
  const errors = [];

  // Pay-on-accept: an offer that never went live — its card authorization is
  // still pending, or it lapsed/was voided — is invisible to clients AND to
  // the notary digest alike.
  const isLive = (bid) => !domain.isOfferExpired(bid, todayISO) && bid.paymentStatus !== 'pending' && bid.paymentStatus !== 'void';

  for (const bid of open) {
    // Only new leads opt in to recovery; do not replay legacy confirmations.
    // sendOnce owns delivery deduplication, including each recipient separately.
    if (bid.paymentStatus !== 'void' && bid.notificationRecoveryVersion === 1 && typeof notifier.onOfferCreated === 'function') {
      try {
        const result = await notifier.onOfferCreated(bid);
        if (result && result.ok === false) errors.push({ bidId: bid.id, kind: 'offerCreated', error: result.error || 'notification_failed' });
      } catch (err) {
        errors.push({ bidId: bid.id, kind: 'offerCreated', error: String(err.message || err) });
      }
    }
    if (!isLive(bid)) continue;
    const kinds = domain.dueReminders(bid, todayISO);
    for (const kind of kinds) {
      due += 1;
      try {
        const r = await notifier.onReminderDue(bid, kind, todayISO);
        if (r && r.sent) sent += 1;
      } catch (err) {
        // One bad send must not abort the batch.
        errors.push({ bidId: bid.id, kind, error: String((err && err.message) || err) });
      }
    }
  }

  // --- Carnet digest (newMatchingBids) --------------------------------------
  // Fresh live demands, mailed once per active notary per day, filtered to
  // each notary's déplacement perimeter (ADR 0017) and, since ADR 0033 §7, to
  // the PACE they asked for: « daily » (the default) gets yesterday's demands;
  // « weekly » gets the past week's, on Mondays only; « instant » already heard
  // of each demand as it landed and « off » hears nothing. "Yesterday" — the
  // Québec business day of createdAt — gives exactly-once membership: a demand
  // posted after this morning's run waits for tomorrow's digest rather than
  // appearing twice. Guarded so an older repo without the sparse notary index
  // simply skips the digest.
  const digest = { notaries: 0, sent: 0 };
  if (typeof repo.listActiveNotaries === 'function' && typeof notifier.onNotaryDigest === 'function') {
    const tz = process.env.NOTA_TIMEZONE;
    const live = open.filter((bid) => isLive(bid) && bid.createdAt);
    // The demands created in the `days` civil days before today (never today's).
    // `POST /bids` écrit `createdAt` en JOURNÉE nue (`2026-09-06`), parce que
    // l'horloge du handler est déjà `businessDay`. La relire comme un instant
    // la placerait à minuit UTC — donc la VEILLE à Québec — et reculerait
    // chaque demande d'un jour : publiée après le tour de 9 h, elle manquait
    // le digest du jour puis celui du lendemain, c'est-à-dire tous. Une
    // journée est donc prise telle quelle ; seul un instant est converti.
    // (Même garde, mêmes termes, que segments.js:450.)
    const jourDe = (v) => {
      const brut = String(v == null ? '' : v);
      return /^\d{4}-\d{2}-\d{2}$/.test(brut) ? brut : domain.businessDay(brut, tz);
    };
    const createdSince = (days) => {
      const from = domain.addDays(todayISO, -days);
      return live.filter((bid) => {
        const day = jourDe(bid.createdAt);
        return day >= from && day < todayISO;
      });
    };
    // Monday in the Québec civil calendar — todayISO already is that date.
    const isMonday = new Date(todayISO + 'T00:00:00Z').getUTCDay() === 1;
    const daily = createdSince(1);
    const weekly = isMonday ? createdSince(7) : [];
    // The notary's alert preference, normalized by the domain (absent → daily).
    const alertesOf = (n) =>
      typeof domain.notaryAlertes === 'function'
        ? domain.notaryAlertes(n)
        : { pace: (n.alertes && n.alertes.pace) || 'daily', urgentOnly: !!(n.alertes && n.alertes.urgentOnly) };
    const elevated = (bid) => !!(domain.tierById(bid.tier) || {}).eleve;
    if (daily.length || weekly.length) {
      const notaries = await repo.listActiveNotaries();
      for (const notary of notaries) {
        if (!notary || !notary.email) continue;
        const alertes = alertesOf(notary);
        const pool = alertes.pace === 'daily' ? daily : alertes.pace === 'weekly' ? weekly : [];
        if (!pool.length) continue;
        // Same three-argument reach rule as the live feed (ADR 0025): with
        // both sectors known the measured distance decides — the digest must
        // never email a demand the feed would hide, nor hide one it shows.
        const mine = pool.filter(
          (bid) =>
            domain.notaryCanServe((bid.pricing || {})[domain.DEPLACEMENT_CRITERION_ID], notary, bid.prefixe) &&
            (!alertes.urgentOnly || elevated(bid))
        );
        if (!mine.length) continue;
        digest.notaries += 1;
        try {
          const r = await notifier.onNotaryDigest(notary, mine, todayISO);
          if (r && r.sent) digest.sent += 1;
        } catch (err) {
          errors.push({ notaryId: notary.id, kind: 'newMatchingBids', error: String((err && err.message) || err) });
        }
      }
    }
  }

  // --- La caution (ADR 0035) -------------------------------------------------
  // LE geste quotidien d'argent : poser, sur les offres dont la date entre dans
  // la fenêtre, l'autorisation de carte qui doit vivre jusqu'à la signature.
  // Elle ne peut pas être posée à la publication — une autorisation Stripe
  // expire en ~7 jours et le palier « standard » du carnet commence à 15.
  //
  // Deux exigences tiennent tout ce bloc :
  //   • il lit `listByMonth`, PAS `listOpenBids` : celui-ci exclut les actes
  //     RETENUS, et c'est précisément là que la caution compte le plus ;
  //   • une carte refusée ne lève jamais : elle se compte, s'inscrit sur
  //     l'offre et prévient les deux parties une seule fois. Un lot de rappels
  //     ne tombe pas parce qu'une banque a dit non.
  //
  // LE JOURNAL COMPTE DES CHOSES DIFFÉRENTES SÉPARÉMENT, parce qu'elles
  // appellent des gestes opposés : `refusee` (la banque a dit non) se répare en
  // relançant des clients ; `sansCarte` (aucun moyen de paiement connu) se
  // répare dans la console Stripe ou pas du tout ; `expiree` compte les offres
  // héritées dont la réservation avait dépassé sa durée de vie. Un seul
  // compteur pour les trois ne dirait à l'opérateur ni quoi faire, ni où.
  const caution = { due: 0, posee: 0, refusee: 0, sansCarte: 0, expiree: 0 };
  // Les DEUX gestes du port sont exigés : poser la caution, et dire quelles
  // offres l'attendent. Un port qui n'offrirait que le premier ferait tenter la
  // pose sur tout le mois — la passe est alors sautée, comme sans Stripe.
  if (billing && typeof billing.placeCaution === 'function' && typeof billing.attendCaution === 'function'
    && typeof repo.listByMonth === 'function') {
    // La fenêtre chevauche au plus deux mois (la couture de fin de mois).
    const months = [...new Set([todayISO.slice(0, 7), domain.addDays(todayISO, domain.CAUTION_LEAD_DAYS).slice(0, 7)])];
    const candidates = [];
    for (const m of months) candidates.push(...(await repo.listByMonth(m)));
    for (const bid of candidates) {
      if (!bid || bid.status === domain.STATUS.ANNULEE || domain.isOfferExpired(bid, todayISO)) continue;
      // Le port de facturation dit LUI-MÊME quelles offres attendent leur
      // caution : celles dont la carte est enregistrée sans qu'aucune somme
      // soit réservée — y compris un acte renégocié (`a_reautoriser`), dont
      // l'autorisation d'origine portait l'ancien montant et a été relâchée.
      // Le moyen de paiement, lui, n'est PAS vérifié ici : son absence est un
      // symptôme à rapporter (voir `carte_absente` plus bas), pas une offre à
      // écarter en silence.
      // Le jour est passé : c'est lui qui décide si une offre marquée
      // `authorized` porte encore une garantie ou une autorisation périmée —
      // le cas ORDINAIRE d'avant l'ADR 0035, qu'il faut recautionner et non
      // déclarer « posée ».
      if (!billing.attendCaution(bid, todayISO)) continue;
      if (!domain.cautionDue(bid.dateISO, todayISO)) continue;
      caution.due += 1;
      if (bid.paymentStatus === 'authorized') caution.expiree += 1;
      try {
        const r = await billing.placeCaution({ bid, todayISO });
        if (r && r.ok) {
          caution.posee += 1;
          continue;
        }
        // Prévenir UNE fois : la fenêtre dure trois jours et le geste est
        // quotidien — répéter la mauvaise nouvelle chaque matin serait de
        // l'insistance (art. 56 1°), pas de l'information.
        if (r && r.code === 'caution_refusee') {
          caution.refusee += 1;
          if (!bid.cautionRefus && typeof notifier.onCautionRefusee === 'function') {
            await notifier.onCautionRefusee(bid, r.refus);
          }
          continue;
        }
        // `carte_absente` ne vient PAS du client. Sur une offre « enregistrée »
        // il manque le moyen de paiement, donc l'abonnement au webhook
        // `setup_intent.succeeded` (ADR 0035, réglage de production) ; sur une
        // offre héritée, aucune carte n'a jamais été enregistrée et le
        // règlement gardera son repli (créance, ADR 0029). Les deux se
        // rapportent, sinon la caution ne se pose jamais en silence — mais
        // JAMAIS dans le même compteur qu'un refus bancaire.
        if (r && r.code === 'carte_absente') {
          caution.sansCarte += 1;
          errors.push({
            bidId: bid.id,
            kind: 'caution',
            error: r.heritee
              ? 'carte_absente — caution expirée et aucune carte enregistrée (offre antérieure à l’ADR 0035 : le règlement retombe sur la créance)'
              : 'carte_absente — moyen de paiement inconnu (setup_intent.succeeded non reçu ?)',
          });
          continue;
        }
        // La réservation existe chez Stripe mais n'a pas pu être inscrite. Elle
        // a normalement été relâchée : c'est un incident, pas un refus.
        errors.push({
          bidId: bid.id,
          kind: 'caution',
          error: (r && r.code ? r.code : 'caution_non_posee') + (r && r.relachee === false ? ' — RÉSERVATION ORPHELINE, à relâcher à la main' : ''),
        });
      } catch (err) {
        // Un incident d'infrastructure se rapporte, il n'arrête pas le lot.
        errors.push({ bidId: bid.id, kind: 'caution', error: String((err && err.message) || err) });
      }
    }
  }

  // --- Les indemnités échues (ADR 0041) --------------------------------------
  // Un client a annulé un acte retenu près de la signature : le notaire avait
  // `delaiJours` pour réclamer, en justifiant, une indemnité sous le plafond.
  // Le délai passé sans réclamation, rien n'est prélevé : la réservation du
  // client est libérée, l'acte quitte la console, la décision se journalise
  // et le client est prévenu. Lu sur `listByMonth` (les actes ANNULÉS n'y sont
  // pas filtrés), sur les mois que la date de signature d'une annulation
  // tardive peut porter : le mois courant, le précédent, le suivant.
  const indemnites = { echues: 0 };
  if (typeof repo.listByMonth === 'function' && typeof repo.update === 'function') {
    const months = [...new Set([
      domain.addDays(todayISO, -31).slice(0, 7), todayISO.slice(0, 7), domain.addDays(todayISO, 31).slice(0, 7),
    ])];
    const seen = new Set();
    for (const m of months) {
      let bids = [];
      try { bids = await repo.listByMonth(m); } catch (err) { errors.push({ kind: 'indemnite', error: String((err && err.message) || err) }); continue; }
      for (const bid of bids) {
        if (!bid || seen.has(bid.id)) continue;
        seen.add(bid.id);
        const a = bid.annulation;
        if (bid.status !== domain.STATUS.ANNULEE || !a || a.statut !== 'en_attente') continue;
        if (!a.echeanceISO || todayISO <= a.echeanceISO) continue;
        indemnites.echues += 1;
        try {
          const annulation = { ...a, statut: 'expiree', frais: 0, percu: false, justification: null, dedommagement: null, decideeLe: todayISO };
          const updated = { ...bid, annulation };
          await repo.update(updated);
          if (billing && typeof billing.cancelAuthorization === 'function' && bid.paymentIntentId && bid.paymentStatus !== 'void') {
            await Promise.resolve(billing.cancelAuthorization({ paymentIntentId: bid.paymentIntentId, bidId: bid.id })).catch(() => {});
          }
          if (bid.notaryId && typeof repo.removeRetained === 'function') {
            await repo.removeRetained(bid.notaryId, { id: bid.id, dateISO: bid.dateISO });
          }
          await journalIndemniteEchue(repo, updated, todayISO);
          if (typeof notifier.onIndemniteDecidee === 'function') {
            let notary = null;
            try { notary = bid.notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(bid.notaryId) : null; } catch { /* moins de faits dans le courriel */ }
            await notifier.onIndemniteDecidee(updated, { notary });
          }
        } catch (err) {
          errors.push({ bidId: bid.id, kind: 'indemnite', error: String((err && err.message) || err) });
        }
      }
    }
  }

  return { todayISO, openBids: open.length, due, sent, digest, caution, indemnites, errors };
}

// La même pièce que la route du notaire écrit à sa décision, avec le même
// acteur « système » que le handler emploie quand personne n'a agi : un
// registre conservé sept ans ne porte aucun renseignement personnel.
async function journalIndemniteEchue(repo, bid, todayISO) {
  const write = typeof repo.appendTxAudit === 'function' ? repo.appendTxAudit : repo.appendAudit;
  if (typeof write !== 'function') return;
  const a = bid.annulation || {};
  try {
    await write.call(repo, {
      id: crypto.randomUUID(), ts: new Date().toISOString(), day: todayISO, action: 'annulation_indemnite',
      adminId: null, email: null, ip: null,
      acteur: { type: 'systeme', id: null },
      meta: {
        bidId: bid.id, dateISO: bid.dateISO, notaryId: bid.notaryId || null, montant: bid.montant,
        taux: a.taux != null ? a.taux : null, plafond: a.plafond != null ? a.plafond : null,
        joursAvant: a.joursAvant != null ? a.joursAvant : null, echeanceISO: a.echeanceISO || null,
        statut: 'expiree', frais: 0,
      },
    });
  } catch { /* l'audit ne bloque jamais le geste quotidien */ }
}

module.exports = { runReminders };
