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

  // --- Daily carnet digest (newMatchingBids) --------------------------------
  // Yesterday's live demands, mailed once per active notary per day, filtered
  // to each notary's déplacement perimeter (ADR 0017). "Yesterday" — the
  // Québec business day of createdAt — gives exactly-once membership: a
  // demand posted after this morning's run waits for tomorrow's digest rather
  // than appearing twice. Guarded so an older repo without the sparse notary
  // index simply skips the digest.
  const digest = { notaries: 0, sent: 0 };
  if (typeof repo.listActiveNotaries === 'function' && typeof notifier.onNotaryDigest === 'function') {
    const yesterdayISO = domain.addDays(todayISO, -1);
    const tz = process.env.NOTA_TIMEZONE;
    const fresh = open.filter(
      (bid) => isLive(bid) && bid.createdAt && domain.businessDay(bid.createdAt, tz) === yesterdayISO
    );
    if (fresh.length) {
      const notaries = await repo.listActiveNotaries();
      for (const notary of notaries) {
        if (!notary || !notary.email) continue;
        const mine = fresh.filter((bid) =>
          domain.notaryCanServe((bid.pricing || {})[domain.DEPLACEMENT_CRITERION_ID], notary)
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
