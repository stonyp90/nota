'use strict';

const domain = require('@nota/domain');

// One conversation store and append path for the widget, admin console and
// inbound email. Transport authentication belongs to each caller; validation,
// revision merging, human ownership and message idempotency are shared here.
function createSupportConversations({ repo, nowMs = Date.now, newId = () => require('node:crypto').randomUUID(), notifier, notifyFlushMs = 5000 } = {}) {
  if (!repo) throw new Error('createSupportConversations: repo is required');
  const messageView = m => ({ id: m.id, de: m.de, texte: m.texte, createdAt: m.createdAt });
  const state = thread => ({
    escalade: domain.supportThreadSummary(thread).escalade,
    humain: (thread.messages || []).some(m => m && m.de === domain.SUPPORT_FROM.NOTA),
  });
  const summarize = thread => {
    const summary = domain.supportThreadSummary(thread);
    return {
      ...thread, dernierAt: summary.dernierAt, dernierDe: summary.dernierDe,
      nb: summary.nb, statut: summary.statut,
      escalade: summary.escalade, escaladeMotif: summary.escaladeMotif,
    };
  };
  async function update(thread, change) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const changed = change(thread);
      if (changed === thread) return thread;
      const candidate = summarize(changed);
      const saved = await repo.putSupportThread(candidate, { expectedRevision: Number(thread.supportRevision) || 0 });
      if (saved !== false) return saved || candidate;
      thread = await repo.getSupportThread(thread.id);
      if (!thread) return null;
    }
    return false;
  }
  const error = (status, code, message) => ({ ok: false, status, errors: [{ code, message }] });
  const writeError = thread => thread === null
    ? error(404, 'introuvable', 'Conversation introuvable.')
    : error(409, 'conversation_occupee', 'La conversation a changé pendant l’envoi. Réessayez votre message.');
  const validMessageId = id => typeof id === 'string' && /^[A-Za-z0-9_.:@-]{1,160}$/.test(id);

  // Claim delivery inside the existing support item. Concurrent duplicate
  // requests cannot send together; a failed callback releases the claim, and
  // an expired lease lets a redelivered email recover after a process crash.
  async function deliver(thread, messageId, de, extra = {}) {
    const claimId = newId();
    let claimed = false, waiting = false, completed = false;
    let port;
    try { port = typeof notifier === 'function' ? notifier() : notifier; } catch { return { thread, notification: { ok: false, retryable: true } }; }
    const method = de === domain.SUPPORT_FROM.NOTA ? 'onSupportReply' : 'onSupportMessage';
    if (de === domain.SUPPORT_FROM.NOTA && !thread.courriel) return { thread, notification: null };
    if (!port || typeof port[method] !== 'function') return { thread, notification: { ok: false, retryable: true } };
    const currentThread = await update(thread, current => {
      claimed = false; waiting = false; completed = false;
      const item = (current.messages || []).find(m => m.id === messageId);
      if (!item) return current;
      const delivery = item.delivery || {};
      if (delivery.state === 'complete') { completed = true; return current; }
      if (delivery.state === 'sending' && delivery.claimId === claimId) { claimed = true; return current; }
      if (delivery.state === 'sending' && delivery.leaseUntil > nowMs()) { waiting = true; return current; }
      claimed = true;
      return {
        ...current,
        messages: current.messages.map(m => m.id === messageId ? { ...m, delivery: { state: 'sending', claimId, leaseUntil: nowMs() + 120000 } } : m),
      };
    });
    if (!currentThread) return { thread, notification: { ok: false, retryable: true } };
    thread = currentThread;
    if (!claimed) return { thread, notification: completed ? { ok: true, duplicate: true } : { ok: false, retryable: true, pending: waiting } };
    const message = thread.messages.find(m => m.id === messageId);
    const context = { ...extra, threadId: thread.id, message: messageView(message), courriel: thread.courriel };
    if (de === domain.SUPPORT_FROM.VISITEUR) Object.assign(context, {
      historique: thread.messages.map(messageView), escalade: state(thread).escalade, motif: thread.escaladeMotif || null,
    });
    const send = Promise.resolve().then(() => port[method](context)).catch(() => ({ ok: false, retryable: true }));
    let timer;
    const bound = new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, retryable: true, timedOut: true }), Math.max(1, Math.min(5000, Number(notifyFlushMs) || 5000))); });
    const outcome = await Promise.race([send, bound]);
    clearTimeout(timer);
    async function finish(result) {
      const delivered = !result || result.ok !== false;
      try {
      const saved = await update(thread, current => {
        const item = current.messages.find(m => m.id === messageId);
        if (!item || !item.delivery || item.delivery.claimId !== claimId) return current;
        const nextState = delivered ? 'complete' : 'pending';
        if (item.delivery.state === nextState) return current;
        return { ...current, messages: current.messages.map(m => m.id === messageId ? { ...m, delivery: { state: nextState, claimId } } : m) };
      });
      if (!saved) return { thread, notification: { ok: false, retryable: true } };
      thread = saved;
      } catch { return { thread, notification: { ok: false, retryable: true } }; }
      return { thread, notification: result || { ok: true } };
    }
    if (outcome && outcome.timedOut) {
      // Keep the sending lease while the timed-out callback may still finish.
      // A live process records its result; a crash recovers after lease expiry.
      send.then(finish).catch(() => {});
      return { thread, notification: outcome };
    }
    return finish(outcome);
  }

  async function append({ threadId, texte, messageId, author, de, expectedEmail }) {
    const validated = domain.validateSupportMessage({ texte });
    if (!validated.ok) return { ok: false, status: 422, errors: validated.errors };
    if (messageId !== undefined && !validMessageId(messageId)) {
      return error(422, 'message_id_invalide', 'L’identifiant du message n’est pas valide.');
    }
    let thread = await repo.getSupportThread(threadId);
    if (!thread) return writeError(null);
    const message = {
      id: messageId || newId(), de, texte: validated.texte,
      createdAt: new Date(nowMs()).toISOString(),
      writeId: newId(),
      ...(author ? { author: String(author).slice(0, 160) } : {}),
    };
    let duplicate = false, collision = false, unauthorized = false;
    thread = await update(thread, current => {
      if (expectedEmail !== undefined && String(current.courriel || '').trim().toLowerCase() !== String(expectedEmail).trim().toLowerCase()) {
        unauthorized = true;
        return current;
      }
      const existing = (current.messages || []).find(item => item.id === message.id);
      if (existing) {
        duplicate = existing.writeId !== message.writeId;
        collision = existing.de !== de || existing.texte !== message.texte;
        return current;
      }
      duplicate = false;
      return {
        ...current, messages: [...(current.messages || []), {
          ...message,
          ...(de === domain.SUPPORT_FROM.VISITEUR || current.courriel ? { delivery: { state: 'pending' } } : {}),
        }], closLe: null,
        ...(de === domain.SUPPORT_FROM.NOTA ? { escaladeLe: null, escaladeMotif: null } : {}),
      };
    });
    if (!thread) return writeError(thread);
    if (unauthorized) return error(403, 'expediteur_invalide', 'L’expéditeur ne correspond pas à cette conversation.');
    if (collision) return error(409, 'message_id_conflit', 'Cet identifiant appartient déjà à un autre message.');
    const stored = thread.messages.find(item => item.id === message.id);
    const delivery = await deliver(thread, stored.id, de);
    thread = delivery.thread;
    const notification = delivery.notification;
    return { ok: true, status: 200, thread, message: messageView(stored), duplicate, notification, ...state(thread) };
  }
  async function close({ threadId }) {
    let thread = await repo.getSupportThread(threadId);
    if (!thread) return writeError(null);
    let duplicate = false;
    thread = await update(thread, current => {
      const summary = domain.supportThreadSummary(current);
      duplicate = summary.statut === domain.SUPPORT_STATUT.CLOS;
      if (duplicate) return current;
      // Keep the close event at least as recent as the last accepted message,
      // including the assistant's logical +1ms timestamp and clock skew.
      const at = Math.max(nowMs(), Date.parse(summary.dernierAt || '') || 0);
      return { ...current, closLe: new Date(at).toISOString(), escaladeLe: null, escaladeMotif: null };
    });
    if (!thread) return writeError(thread);
    return { ok: true, status: 200, thread, duplicate, ...state(thread) };
  }
  return {
    state, summarize, messageView, update, writeError, validMessageId,
    close,
    notifyVisitor: ({ thread, messageId, replyUrl }) => deliver(thread, messageId, domain.SUPPORT_FROM.VISITEUR, { replyUrl }),
    reply: input => append({ ...input, de: domain.SUPPORT_FROM.NOTA }),
    appendVisitor: input => append({ ...input, de: domain.SUPPORT_FROM.VISITEUR }),
  };
}

module.exports = { createSupportConversations };
