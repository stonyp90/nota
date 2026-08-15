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
  const todayISO = (now || (() => new Date().toISOString().slice(0, 10)))();

  const openBids = await repo.scanOpenBids();
  let due = 0;
  let sent = 0;
  const errors = [];

  for (const bid of openBids) {
    // Pay-on-accept: never remind a client about an offer that never went live —
    // its card authorization is still pending, or it lapsed/was voided.
    if (bid.paymentStatus === 'pending' || bid.paymentStatus === 'void') continue;
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

  return { todayISO, scanned: openBids.length, due, sent, errors };
}

module.exports = { runReminders };
