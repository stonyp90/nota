'use strict';

/**
 * Reminder scheduler use-case. Pure orchestration over two ports (Repo +
 * Notifier); no framework, no SDK, no clock of its own (injected). Driven daily
 * by the EventBridge Scheduler → Lambda (see infra/notifications.tf) and unit-
 * tested with the in-memory repo + fake mailer.
 *
 * The cadence itself lives in @nota/domain (dueReminders / REMINDER_OFFSETS):
 * this file encodes NO schedule of its own. It only asks the domain which
 * reminders are due today for each open bid, then sends them idempotently.
 */

const domain = require('@nota/domain');

async function runReminders({ repo, notifier, now } = {}) {
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
  const isLive = (bid) => bid.paymentStatus !== 'pending' && bid.paymentStatus !== 'void';

  for (const bid of open) {
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
    const createdSince = (days) => {
      const from = domain.addDays(todayISO, -days);
      return live.filter((bid) => {
        const day = domain.businessDay(bid.createdAt, tz);
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

  return { todayISO, openBids: open.length, due, sent, digest, errors };
}

module.exports = { runReminders };
