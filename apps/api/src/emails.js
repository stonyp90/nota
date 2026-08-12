'use strict';

/**
 * Email templates — fr-CA, conversion-optimized, presentation only.
 *
 * This is an adapter (the "view" of the notification vertical): it turns
 * primitive context into `{ subject, html, text }`. It may use @nota/domain for
 * formatting (money, service names, tier labels) but holds NO business rules and
 * does NO I/O. The notifier (notifications.js) decides who gets what and when;
 * this file decides only how it reads.
 *
 * Every template follows the same conversion + compliance checklist:
 *   - a short, specific subject (no spammy words, no ALL CAPS);
 *   - hidden preheader text (the inbox preview line);
 *   - ONE primary call-to-action button;
 *   - mobile-friendly, inline-CSS HTML (email clients strip <style>/tokens);
 *   - a plain-text alternative;
 *   - a CASL / Law-25 footer: sender identification (Nota + mailing address)
 *     and a working unsubscribe link, on EVERY message.
 *
 * Transactional messages (offer confirmation, receipt, acceptance) are exempt
 * from some CASL consent rules, but we still carry sender ID + unsubscribe on
 * all of them for consistency and because lifecycle/marketing ones require it.
 */

const domain = require('@nota/domain');

// --- Sender identity (CASL requirement (a)) ----------------------------------
// A real mailing address is legally required in commercial email. This is a
// PLACEHOLDER; replace with Nota's registered mailing address before go-live.
const SENDER = {
  name: 'Nota',
  address: 'Nota — 000, rue Placeholder, bureau 000, Québec (Québec) G0X 0X0, Canada',
  supportEmail: 'bonjour@nota.ca',
  privacyEmail: 'confidentialite@nota.ca',
};

// Colors defined once (single source), then referenced inline. Inline styles are
// mandatory for email; centralizing them here keeps values configurable rather
// than scattered literals.
const PALETTE = {
  ink: '#16232f',
  muted: '#5b6b7b',
  bg: '#eef2f5',
  card: '#ffffff',
  border: '#dce4ea',
  brand: '#0b6b5b',
  brandInk: '#ffffff',
  footer: '#8a97a4',
  rule: '#eef2f5',
};

// --- formatting helpers ------------------------------------------------------
const money = (m) => domain.money(m);
const svcNom = (id) => {
  const s = domain.serviceById(id);
  return s ? s.nom : String(id || '');
};
const tierNom = (t) => {
  const x = domain.tierById(t);
  return x ? x.nom : '';
};
const dateFmt = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
function fmtDate(iso) {
  return domain.isISODate(iso) ? dateFmt.format(new Date(iso + 'T00:00:00Z')) : String(iso || '');
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function linksFor(baseUrl) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  return {
    carnet: (b || '') + '/',
    dossier: (b || '') + '/#dossier',
    notaires: (b || '') + '/#notaires',
    compte: (b || '') + '/#notaires',
  };
}

// --- layout primitives -------------------------------------------------------
function preheaderHtml(text) {
  return (
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">' +
    esc(text) +
    '</div>'
  );
}
function button(label, url) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">' +
    '<tr><td style="border-radius:10px;background:' +
    PALETTE.brand +
    ';">' +
    '<a href="' +
    esc(url) +
    '" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:' +
    PALETTE.brandInk +
    ';text-decoration:none;border-radius:10px;">' +
    esc(label) +
    '</a></td></tr></table>'
  );
}
function footer(unsubscribeUrl) {
  return (
    '<tr><td style="padding:18px 24px 0;">' +
    '<div style="border-top:1px solid ' +
    PALETTE.border +
    ';padding-top:14px;font-size:12px;line-height:1.6;color:' +
    PALETTE.footer +
    ';">' +
    '<p style="margin:0 0 6px;">' +
    esc(SENDER.name) +
    ' · ' +
    esc(SENDER.address) +
    '</p>' +
    '<p style="margin:0 0 6px;">Vous recevez ce courriel de Nota au sujet de votre activité sur la place de marché.</p>' +
    '<p style="margin:0;">' +
    '<a href="' +
    esc(unsubscribeUrl) +
    '" style="color:' +
    PALETTE.footer +
    ';text-decoration:underline;">Se désabonner</a>' +
    ' · <a href="mailto:' +
    esc(SENDER.privacyEmail) +
    '" style="color:' +
    PALETTE.footer +
    ';text-decoration:underline;">Confidentialité (Loi 25)</a>' +
    '</p></div></td></tr>'
  );
}
function layout({ preheader, heading, lead, bodyHtml, ctaLabel, ctaUrl, unsubscribeUrl }) {
  return (
    preheaderHtml(preheader || '') +
    '<div style="background:' +
    PALETTE.bg +
    ";padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">' +
    '<tr><td style="padding:0 24px 16px;">' +
    '<span style="font-size:20px;font-weight:700;color:' +
    PALETTE.brand +
    ';letter-spacing:-0.02em;">Nota</span>' +
    '</td></tr>' +
    '<tr><td style="background:' +
    PALETTE.card +
    ';border:1px solid ' +
    PALETTE.border +
    ';border-radius:12px;padding:28px 24px;">' +
    '<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:' +
    PALETTE.ink +
    ';">' +
    esc(heading) +
    '</h1>' +
    (lead
      ? '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:' + PALETTE.muted + ';">' + esc(lead) + '</p>'
      : '') +
    (bodyHtml || '') +
    (ctaLabel && ctaUrl ? button(ctaLabel, ctaUrl) : '') +
    '</td></tr>' +
    footer(unsubscribeUrl) +
    '</table></div>'
  );
}
function textLayout({ heading, lead, lines, ctaLabel, ctaUrl, unsubscribeUrl }) {
  const parts = [heading, ''];
  if (lead) parts.push(lead, '');
  (lines || []).forEach((l) => parts.push(l));
  if (lines && lines.length) parts.push('');
  if (ctaLabel && ctaUrl) parts.push(ctaLabel + ' : ' + ctaUrl, '');
  parts.push('—', SENDER.name + ' · ' + SENDER.address);
  parts.push('Se désabonner : ' + unsubscribeUrl);
  return parts.join('\n');
}
function para(text) {
  return '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:' + PALETTE.ink + ';">' + esc(text) + '</p>';
}
function callout(text) {
  return (
    '<div style="margin:0 0 16px;padding:12px 14px;background:' +
    PALETTE.rule +
    ';border-radius:8px;font-size:14px;line-height:1.5;color:' +
    PALETTE.ink +
    ';">' +
    esc(text) +
    '</div>'
  );
}
function build(opts) {
  return {
    subject: opts.subject,
    html: layout(opts),
    text: textLayout(opts),
  };
}

// --- offer summary line (reused across client templates) ---------------------
function offerLine(ctx) {
  return svcNom(ctx.serviceId) + ' · ' + fmtDate(ctx.dateISO) + ' · ' + money(ctx.montant);
}

// =============================================================================
// CLIENT templates
// =============================================================================

// The #1 conversion lever: a published offer is only sellable once the dossier
// is complete, so the CTA drives straight to the dossier.
function offerPublished(ctx) {
  return build({
    subject: 'Votre offre est en ligne : ' + money(ctx.montant),
    preheader: 'Complétez votre dossier — une demande prête est retenue beaucoup plus vite.',
    heading: 'Votre offre est publiée',
    lead: 'Votre offre pour un ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ' est maintenant sur le carnet Nota.',
    bodyHtml:
      callout(offerLine(ctx)) +
      para(
        'Un notaire retient une demande d’autant plus vite qu’elle est prête. Complétez votre dossier (documents et consentement de partage) pour être retenu rapidement — votre identité, elle, sera vérifiée par le notaire à la signature.'
      ),
    textLines: [offerLine(ctx), 'Complétez votre dossier pour être retenu plus vite.'],
    ctaLabel: 'Compléter mon dossier',
    ctaUrl: linksFor(ctx.baseUrl).dossier,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function dossierIncomplete(ctx) {
  return build({
    subject: 'Il reste une étape à votre dossier',
    preheader: 'Terminez vos documents et le consentement pour devenir retenable.',
    heading: 'Votre dossier est presque prêt',
    lead: 'Pour votre ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ', il manque encore quelques éléments.',
    bodyHtml:
      para(
        'Ajoutez les documents demandés et cochez le consentement de partage. C’est ce qui permet à un notaire de retenir votre demande — sans cela, votre offre reste visible mais pas encore « prête ».'
      ) + callout(offerLine(ctx)),
    textLines: [offerLine(ctx), 'Ajoutez vos documents et le consentement de partage.'],
    ctaLabel: 'Terminer mon dossier',
    ctaUrl: linksFor(ctx.baseUrl).dossier,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Tier-aware. Same template for j7/j3/j1; the copy adapts to the days left and
// the tier's market range.
function dateApproaching(ctx) {
  const days = Number(ctx.days);
  const dLabel = days <= 1 ? 'demain' : 'dans ' + days + ' jours';
  const t = domain.tierById(ctx.tier);
  const range = t ? t.apercuMin.toFixed(1) + '× à ' + t.apercuMax.toFixed(1) + '×' : '';
  return build({
    subject: 'Votre signature approche — ' + dLabel,
    preheader: 'Une offre plus forte est retenue plus vite. Vérifiez la vôtre.',
    heading: 'Votre date approche',
    lead:
      'Votre ' +
      svcNom(ctx.serviceId) +
      ' est prévu ' +
      dLabel +
      ' (' +
      fmtDate(ctx.dateISO) +
      '). Votre date approche; une offre plus forte est retenue plus vite.',
    bodyHtml:
      callout(offerLine(ctx) + (tierNom(ctx.tier) ? ' · palier ' + tierNom(ctx.tier) : '')) +
      para(
        range
          ? 'À ce délai, le marché se conclut généralement entre ' +
              range +
              ' le prix de départ. Si votre offre est sous cette fourchette, la bonifier augmente nettement vos chances d’être retenu à temps.'
          : 'Si aucune offre n’est encore retenue, la bonifier augmente vos chances d’être retenu à temps.'
      ),
    textLines: [
      offerLine(ctx),
      tierNom(ctx.tier) ? 'Palier : ' + tierNom(ctx.tier) : '',
      range ? 'Fourchette du marché à ce délai : ' + range + '.' : '',
    ].filter(Boolean),
    ctaLabel: 'Vérifier mon offre',
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function offerRetained(ctx) {
  return build({
    subject: 'Un notaire a retenu votre demande',
    preheader: 'Voici les prochaines étapes vers votre signature.',
    heading: 'Bonne nouvelle — votre demande est retenue',
    lead:
      'Un notaire a retenu votre demande de ' +
      svcNom(ctx.serviceId) +
      ' pour le ' +
      fmtDate(ctx.dateISO) +
      '.',
    bodyHtml:
      callout(offerLine(ctx)) +
      para(
        'Le notaire vous contactera pour organiser la signature et vérifiera votre identité à ce moment. Assurez-vous que votre dossier est complet pour que tout aille vite.'
      ),
    textLines: [offerLine(ctx), 'Le notaire vous contactera pour la signature.'],
    ctaLabel: 'Voir les prochaines étapes',
    ctaUrl: linksFor(ctx.baseUrl).dossier,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function dateMissedNoUptake(ctx) {
  return build({
    subject: 'Votre date approche — aucune offre retenue',
    preheader: 'Bonifier votre offre attire un notaire plus rapidement.',
    heading: 'Il est encore temps d’attirer un notaire',
    lead:
      'Votre ' +
      svcNom(ctx.serviceId) +
      ' du ' +
      fmtDate(ctx.dateISO) +
      ' approche et aucun notaire ne l’a encore retenu.',
    bodyHtml:
      callout(offerLine(ctx)) +
      para(
        'Aux dates rapprochées, une offre plus généreuse est retenue nettement plus vite. Vous pouvez bonifier votre offre en quelques secondes — dans la limite du plafond permis.'
      ),
    textLines: [offerLine(ctx), 'Bonifiez votre offre pour attirer un notaire à temps.'],
    ctaLabel: 'Bonifier mon offre',
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// =============================================================================
// NOTARY templates
// =============================================================================

// Weekly-style digest of open, high-value bids.
function newMatchingBids(ctx) {
  const bids = Array.isArray(ctx.bids) ? ctx.bids : [];
  const rowsHtml = bids
    .map(
      (b) =>
        '<tr>' +
        '<td style="padding:8px 0;border-bottom:1px solid ' +
        PALETTE.border +
        ';font-size:14px;color:' +
        PALETTE.ink +
        ';">' +
        esc(svcNom(b.serviceId) + ' · ' + fmtDate(b.dateISO)) +
        '</td>' +
        '<td style="padding:8px 0;border-bottom:1px solid ' +
        PALETTE.border +
        ';font-size:14px;font-weight:600;text-align:right;color:' +
        PALETTE.ink +
        ';">' +
        esc(money(b.montant)) +
        '</td>' +
        '</tr>'
    )
    .join('');
  const bodyHtml =
    para('Voici les demandes ouvertes à plus forte valeur sur le carnet en ce moment :') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">' +
    rowsHtml +
    '</table>';
  return build({
    subject: (bids.length || 'De') + ' nouvelle' + (bids.length === 1 ? '' : 's') + ' demande' + (bids.length === 1 ? '' : 's') + ' sur le carnet',
    preheader: 'Des demandes ouvertes attendent d’être retenues.',
    heading: 'De nouvelles demandes vous attendent',
    lead: 'Un aperçu des demandes ouvertes que vous pourriez retenir.',
    bodyHtml,
    textLines: bids.map((b) => svcNom(b.serviceId) + ' · ' + fmtDate(b.dateISO) + ' · ' + money(b.montant)),
    ctaLabel: 'Voir le carnet',
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subWelcome(ctx) {
  return build({
    subject: 'Bienvenue sur Nota',
    preheader: 'Votre abonnement est actif — accédez au carnet dès maintenant.',
    heading: 'Votre abonnement est actif',
    lead: 'Merci de vous être abonné. Vous avez maintenant accès à toutes les demandes du carnet.',
    bodyHtml: para(
      'Nota facture un abonnement mensuel fixe pour l’accès à la place de marché — jamais un pourcentage de l’acte. Retenez autant de demandes que vous le souhaitez, sans frais par dossier.'
    ),
    textLines: ['Votre abonnement mensuel fixe est actif. Aucun frais par dossier.'],
    ctaLabel: 'Accéder au carnet',
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subReceipt(ctx) {
  return build({
    subject: 'Reçu — votre abonnement Nota',
    preheader: 'Confirmation de votre abonnement mensuel.',
    heading: 'Merci — voici votre reçu',
    lead: 'Votre abonnement mensuel à Nota a été confirmé.',
    bodyHtml: para(
      'Il s’agit d’un abonnement fixe pour l’accès à la place de marché. Le détail complet (montant, taxes, date) est disponible sur la facture Stripe qui accompagne ce reçu.'
    ),
    textLines: ['Abonnement mensuel confirmé. Facture détaillée fournie par Stripe.'],
    ctaLabel: 'Voir mon compte',
    ctaUrl: linksFor(ctx.baseUrl).compte,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subRenewalReminder(ctx) {
  return build({
    subject: 'Votre abonnement se renouvelle bientôt',
    preheader: 'Aucune action requise — voici un rappel avant le renouvellement.',
    heading: 'Votre abonnement se renouvelle bientôt',
    lead: 'Votre abonnement mensuel à Nota sera renouvelé automatiquement sous peu.',
    bodyHtml: para(
      'Aucune action n’est nécessaire si vous souhaitez continuer. Vous pouvez gérer ou annuler votre abonnement à tout moment depuis votre compte.'
    ),
    textLines: ['Renouvellement automatique à venir. Gérez votre abonnement quand vous voulez.'],
    ctaLabel: 'Gérer mon abonnement',
    ctaUrl: linksFor(ctx.baseUrl).compte,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Dunning — recover a churning subscription after a failed payment.
function subPaymentFailed(ctx) {
  return build({
    subject: 'Action requise : votre paiement a été refusé',
    preheader: 'Mettez à jour votre paiement pour conserver l’accès au carnet.',
    heading: 'Nous n’avons pas pu renouveler votre abonnement',
    lead: 'Le dernier paiement de votre abonnement Nota a échoué.',
    bodyHtml: para(
      'Pour conserver l’accès aux demandes du carnet, mettez à jour votre moyen de paiement. Nous réessaierons automatiquement, mais une mise à jour évite toute interruption.'
    ),
    textLines: ['Paiement refusé. Mettez à jour votre moyen de paiement pour éviter une interruption.'],
    ctaLabel: 'Mettre à jour mon paiement',
    ctaUrl: linksFor(ctx.baseUrl).compte,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subCanceledWinback(ctx) {
  return build({
    subject: 'Votre place sur Nota vous attend',
    preheader: 'Réactivez votre abonnement quand vous voulez — rien n’est perdu.',
    heading: 'On vous garde une place',
    lead: 'Votre abonnement à Nota est résilié, mais vous pouvez le réactiver à tout moment.',
    bodyHtml: para(
      'Les demandes continuent d’arriver sur le carnet chaque jour. Réabonnez-vous en un instant pour recommencer à les retenir — toujours au même abonnement fixe, sans frais par dossier.'
    ),
    textLines: ['Réactivez votre abonnement quand vous voulez.'],
    ctaLabel: 'Réactiver mon abonnement',
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// =============================================================================
// OPERATOR (Nota) templates
// =============================================================================

function operatorNotarySubscribed(ctx) {
  return build({
    subject: 'Nouveau notaire abonné' + (ctx.notaryEmail ? ' : ' + ctx.notaryEmail : ''),
    preheader: 'Un notaire vient de s’abonner à Nota.',
    heading: 'Un notaire vient de s’abonner',
    lead: 'Un nouvel abonnement notaire vient d’être activé.',
    bodyHtml: callout('Courriel : ' + (ctx.notaryEmail || '—')),
    textLines: ['Nouveau notaire abonné : ' + (ctx.notaryEmail || '—')],
    ctaLabel: 'Ouvrir Nota',
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function operatorNewLead(ctx) {
  return build({
    subject: 'Nouvelle offre : ' + money(ctx.montant) + ' · ' + svcNom(ctx.serviceId),
    preheader: 'Une nouvelle offre a été publiée sur le carnet.',
    heading: 'Nouvelle offre publiée',
    lead: 'Une offre vient d’être publiée sur le carnet Nota.',
    bodyHtml: callout(offerLine(ctx) + (tierNom(ctx.tier) ? ' · ' + tierNom(ctx.tier) : '')),
    textLines: [offerLine(ctx)],
    ctaLabel: 'Voir le carnet',
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Registry — the notifier looks templates up by name; tests iterate it to assert
// every template carries a subject, an unsubscribe link and sender ID.
const TEMPLATES = {
  offerPublished,
  dossierIncomplete,
  dateApproaching,
  offerRetained,
  dateMissedNoUptake,
  newMatchingBids,
  subWelcome,
  subReceipt,
  subRenewalReminder,
  subPaymentFailed,
  subCanceledWinback,
  operatorNotarySubscribed,
  operatorNewLead,
};

module.exports = {
  SENDER,
  TEMPLATES,
  fmtDate,
  ...TEMPLATES,
};
