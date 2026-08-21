'use strict';

/**
 * Email templates — bilingual (fr-CA first, en-CA second), conversion-optimized,
 * presentation only.
 *
 * This is an adapter (the "view" of the notification vertical): it turns
 * primitive context into `{ subject, html, text }`. It may use @nota/domain for
 * formatting (money/moneyEn, service names, tier labels) but holds NO business
 * rules and does NO I/O. The notifier (notifications.js) decides who gets what
 * and when; this file decides only how it reads.
 *
 * Bilingual contract — recipients' language preference is not tracked, so EVERY
 * message carries both languages, French first:
 *   - subject: 'FR / EN' (each side kept short);
 *   - preheader: 'FR · EN';
 *   - HTML: the full French block (heading, lead, body, CTA button), a subtle
 *     divider, then the full English block with its own CTA to the same URL;
 *   - plain text: the French lines, a '----' separator, then the English lines;
 *   - amounts via domain.money() (fr) and domain.moneyEn() (en); dates via the
 *     fr-CA and en-CA formatters; service/tier names via nom/nomCourt (fr) and
 *     nomEn/nomCourtEn (en) — never hardcoded here.
 *
 * Every template also follows the same conversion + compliance checklist:
 *   - a short, specific subject (no spammy words, no ALL CAPS);
 *   - hidden preheader text (the inbox preview line);
 *   - ONE primary call-to-action per language block;
 *   - mobile-friendly, inline-CSS HTML (email clients strip <style>/tokens);
 *   - a plain-text alternative;
 *   - a CASL / Law-25 footer: bilingual sender identification (Nota + mailing
 *     address) and a working 'Se désabonner / Unsubscribe' link, on EVERY
 *     message.
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
  address: 'Nota — 000, rue à confirmer, bureau 000, Québec (Québec) G0X 0X0, Canada',
  supportEmail: 'bonjour@nota.ca',
  privacyEmail: 'confidentialite@nota.ca',
};

// Colors defined once (single source), then referenced inline. Inline styles are
// mandatory for email; centralizing them here keeps values configurable rather
// than scattered literals. These mirror the Nota web brand (hunter-green ramp).
const PALETTE = {
  ink: '#0b1220', // brand ink
  muted: '#4d5b6e', // brand muted (AA on white)
  bg: '#f4f7f4', // inset panel — frames the white card
  card: '#ffffff', // brand background/surface
  border: '#dbe2ea', // brand border
  brand: '#2c5f34', // hunter green — primary
  brandBright: '#50b848', // hunter green — bright accent
  brandDark: '#244c2a', // hunter green — dark
  brandInk: '#ffffff', // text on brand
  footer: '#6b7a8a', // muted small print
  rule: '#f4f7f4', // neutral inset background
  tint: '#f0f9f0', // hunter-50 — soft brand wash for callouts
};

// Nota web font stack. Email clients that lack Inter fall back gracefully.
const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

// The plain-text FR/EN block separator.
const TEXT_SEPARATOR = '----';

// --- formatting helpers ------------------------------------------------------
const money = (m) => domain.money(m);
const moneyEn = (m) => domain.moneyEn(m);
const svcNom = (id) => {
  const s = domain.serviceById(id);
  return s ? s.nom : String(id || '');
};
const svcNomEn = (id) => {
  const s = domain.serviceById(id);
  return s ? s.nomEn : String(id || '');
};
const svcNomCourt = (id) => {
  const s = domain.serviceById(id);
  return s ? s.nomCourt : String(id || '');
};
const svcNomCourtEn = (id) => {
  const s = domain.serviceById(id);
  return s ? s.nomCourtEn : String(id || '');
};
const tierNom = (t) => {
  const x = domain.tierById(t);
  return x ? x.nom : '';
};
const tierNomEn = (t) => {
  const x = domain.tierById(t);
  return x ? x.nomEn : '';
};
const dateFmt = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateFmtEn = new Intl.DateTimeFormat('en-CA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
function fmtDate(iso) {
  return domain.isISODate(iso) ? dateFmt.format(new Date(iso + 'T00:00:00Z')) : String(iso || '');
}
function fmtDateEn(iso) {
  return domain.isISODate(iso) ? dateFmtEn.format(new Date(iso + 'T00:00:00Z')) : String(iso || '');
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
// Hidden inbox-preview line. The trailing run of zero-width joiners + spaces
// pushes body copy out of the preview so only the preheader shows.
const PREHEADER_SPACER = '&#847; &zwnj; &nbsp; '.repeat(24);
function preheaderHtml(text) {
  return (
    '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">' +
    esc(text) +
    PREHEADER_SPACER +
    '</div>'
  );
}
// Bulletproof, VML-free, table-based CTA. Hunter green with white text; the
// padding + line-height guarantee a >=44px touch target on mobile, and
// mso-padding-alt keeps Outlook honest about the padding.
function button(label, url) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 6px;border-collapse:separate;">' +
    '<tr><td align="center" bgcolor="' +
    PALETTE.brand +
    '" style="border-radius:10px;background-color:' +
    PALETTE.brand +
    ';">' +
    '<a href="' +
    esc(url) +
    '" target="_blank" style="display:inline-block;padding:14px 32px;mso-padding-alt:14px 32px;min-height:20px;line-height:20px;font-family:' +
    FONT +
    ';font-size:16px;font-weight:600;letter-spacing:0.01em;color:' +
    PALETTE.brandInk +
    ';text-decoration:none;border-radius:10px;border:1px solid ' +
    PALETTE.brandDark +
    ';">' +
    esc(label) +
    '</a></td></tr></table>'
  );
}
// Header band: the Nota "N" mark rendered WITHOUT images/SVG (many clients block
// them) — a hunter-green rounded square holding a bold white "N" — next to the
// "Nota" wordmark in brand green and a small bilingual tagline. border-radius
// degrades gracefully to a square. Sits at the top of the card, above a
// hairline rule.
function logoHeader() {
  return (
    '<tr><td style="padding:26px 30px 22px;border-bottom:1px solid ' +
    PALETTE.border +
    ';">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background-color:' +
    PALETTE.brand +
    ';border-radius:11px;font-family:' +
    FONT +
    ';font-size:22px;line-height:40px;font-weight:800;color:' +
    PALETTE.brandInk +
    ';text-align:center;">N</td>' +
    '<td valign="middle" style="padding-left:12px;">' +
    '<div style="font-family:' +
    FONT +
    ';font-size:21px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;color:' +
    PALETTE.brand +
    ';">Nota</div>' +
    '<div style="font-family:' +
    FONT +
    ';font-size:12px;line-height:1.5;font-weight:500;letter-spacing:0.02em;color:' +
    PALETTE.footer +
    ';">La place de marché notariale · The notarial marketplace</div>' +
    '</td></tr></table>' +
    '</td></tr>'
  );
}
// CASL / Law-25 footer, inside the card on a top hairline: sender name +
// registered mailing address, a plain-language bilingual reason for the
// message, and a working bilingual unsubscribe link alongside support +
// privacy contacts.
function footer(unsubscribeUrl) {
  return (
    '<tr><td style="padding:22px 30px 26px;border-top:1px solid ' +
    PALETTE.border +
    ';">' +
    '<div style="font-family:' +
    FONT +
    ';font-size:12px;line-height:1.6;color:' +
    PALETTE.footer +
    ';">' +
    '<p style="margin:0 0 4px;font-weight:700;color:' +
    PALETTE.muted +
    ';">' +
    esc(SENDER.name) +
    '</p>' +
    '<p style="margin:0 0 10px;">' +
    esc(SENDER.address) +
    '</p>' +
    '<p style="margin:0 0 4px;">Vous recevez ce courriel de Nota au sujet de votre activité sur la place de marché notariale du Québec.</p>' +
    '<p style="margin:0 0 10px;">You are receiving this email from Nota about your activity on Québec’s notarial marketplace.</p>' +
    '<p style="margin:0;">' +
    '<a href="' +
    esc(unsubscribeUrl) +
    '" style="color:' +
    PALETTE.footer +
    ';text-decoration:underline;">Se désabonner / Unsubscribe</a>' +
    ' &nbsp;·&nbsp; <a href="mailto:' +
    esc(SENDER.supportEmail) +
    '" style="color:' +
    PALETTE.footer +
    ';text-decoration:underline;">Nous écrire / Contact us</a>' +
    ' &nbsp;·&nbsp; <a href="mailto:' +
    esc(SENDER.privacyEmail) +
    '" style="color:' +
    PALETTE.footer +
    ';text-decoration:underline;">Confidentialité (Loi 25) / Privacy (Law 25)</a>' +
    '</p></div></td></tr>'
  );
}
// Subtle hairline between the French and English blocks.
function divider() {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 26px;">' +
    '<tr><td style="border-top:1px solid ' +
    PALETTE.border +
    ';font-size:0;line-height:0;">&nbsp;</td></tr></table>'
  );
}
// One language block: heading, optional lead, body, its own CTA button.
function sectionHtml({ heading, lead, bodyHtml, ctaLabel }, ctaUrl) {
  return (
    '<h1 style="margin:0 0 12px;font-family:' +
    FONT +
    ';font-size:22px;line-height:1.3;font-weight:700;color:' +
    PALETTE.ink +
    ';">' +
    esc(heading) +
    '</h1>' +
    (lead
      ? '<p style="margin:0 0 18px;font-family:' +
        FONT +
        ';font-size:15px;line-height:1.6;color:' +
        PALETTE.muted +
        ';">' +
        esc(lead) +
        '</p>'
      : '') +
    (bodyHtml || '') +
    (ctaLabel && ctaUrl ? button(ctaLabel, ctaUrl) : '')
  );
}
// One shared, robust shell for every template. A full-bleed neutral background
// table frames a single light card (header + FR block + divider + EN block +
// footer) so all text sits on a stable light surface — legible with images off
// and safe in dark-mode clients. The MSO ghost table pins the width to 600px in
// Outlook, where max-width is ignored; everywhere else the card is fluid up to
// 600px, one column, mobile-friendly.
function layout({ preheader, fr, en, ctaUrl, unsubscribeUrl }) {
  return (
    '<!doctype html><html lang="fr-CA"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + esc(fr.heading || 'Nota') + ' — Nota</title></head><body style="margin:0;padding:0;">' +
    preheaderHtml(preheader || '') +
    '<div style="background-color:' +
    PALETTE.bg +
    ';margin:0;padding:0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' +
    PALETTE.bg +
    '" style="width:100%;background-color:' +
    PALETTE.bg +
    ';border-collapse:collapse;">' +
    '<tr><td align="center" style="padding:28px 12px;font-family:' +
    FONT +
    ';">' +
    '<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;background-color:' +
    PALETTE.card +
    ';border:1px solid ' +
    PALETTE.border +
    ';border-top:3px solid ' +
    PALETTE.brand +
    ';border-radius:14px;border-collapse:separate;overflow:hidden;">' +
    logoHeader() +
    '<tr><td style="padding:26px 30px 30px;">' +
    sectionHtml(fr, ctaUrl) +
    divider() +
    sectionHtml(en, ctaUrl) +
    '</td></tr>' +
    footer(unsubscribeUrl) +
    '</table>' +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '</td></tr></table></div>' +
    '</body></html>'
  );
}
function sectionText({ heading, lead, textLines, ctaLabel }, ctaUrl) {
  const parts = [heading, ''];
  if (lead) parts.push(lead, '');
  const body = textLines || [];
  body.forEach((l) => parts.push(l));
  if (body.length) parts.push('');
  if (ctaLabel && ctaUrl) parts.push(ctaLabel + ' : ' + ctaUrl, '');
  return parts;
}
function textLayout({ fr, en, ctaUrl, unsubscribeUrl }) {
  const parts = [
    ...sectionText(fr, ctaUrl),
    TEXT_SEPARATOR,
    '',
    ...sectionText(en, ctaUrl),
  ];
  parts.push('—', SENDER.name, SENDER.address, '');
  parts.push('Se désabonner / Unsubscribe : ' + unsubscribeUrl);
  parts.push('Nous écrire / Contact us : ' + SENDER.supportEmail);
  return parts.join('\n');
}
function para(text) {
  return (
    '<p style="margin:0 0 16px;font-family:' +
    FONT +
    ';font-size:15px;line-height:1.6;color:' +
    PALETTE.ink +
    ';">' +
    esc(text) +
    '</p>'
  );
}
// Emphasis panel (offer summary, key fact). Table-based so the tint background +
// padding survive Outlook; a brand left rule ties it to the accent.
function callout(text) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:separate;">' +
    '<tr><td style="padding:13px 16px;background-color:' +
    PALETTE.tint +
    ';border-left:3px solid ' +
    PALETTE.brand +
    ';border-radius:6px;font-family:' +
    FONT +
    ';font-size:14px;line-height:1.5;font-weight:600;color:' +
    PALETTE.ink +
    ';">' +
    esc(text) +
    '</td></tr></table>'
  );
}
// Every message: 'FR / EN' subject, 'FR · EN' preheader, FR-then-EN html/text.
function build({ subjectFr, subjectEn, preheaderFr, preheaderEn, fr, en, ctaUrl, unsubscribeUrl }) {
  const preheader = preheaderFr + ' · ' + preheaderEn;
  return {
    subject: subjectFr + ' / ' + subjectEn,
    html: layout({ preheader, fr, en, ctaUrl, unsubscribeUrl }),
    text: textLayout({ fr, en, ctaUrl, unsubscribeUrl }),
  };
}

// --- offer summary line (reused across client templates) ---------------------
function offerLine(ctx) {
  return svcNom(ctx.serviceId) + ' · ' + fmtDate(ctx.dateISO) + ' · ' + money(ctx.montant);
}
function offerLineEn(ctx) {
  return svcNomEn(ctx.serviceId) + ' · ' + fmtDateEn(ctx.dateISO) + ' · ' + moneyEn(ctx.montant);
}

// =============================================================================
// CLIENT templates
// =============================================================================

// The #1 conversion lever: a published offer is only sellable once the dossier
// is complete, so the CTA drives straight to the dossier.
function offerPublished(ctx) {
  return build({
    subjectFr: 'Votre offre est en ligne : ' + money(ctx.montant),
    subjectEn: 'Your offer is live: ' + moneyEn(ctx.montant),
    preheaderFr: 'Complétez votre dossier — une demande prête est retenue beaucoup plus vite.',
    preheaderEn: 'Complete your file — a ready request gets taken much faster.',
    fr: {
      heading: 'Votre offre est publiée',
      lead: 'Votre offre pour votre acte — ' + svcNom(ctx.serviceId) + ' — le ' + fmtDate(ctx.dateISO) + ' est maintenant sur le carnet Nota.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(
          'Un notaire retient une demande d’autant plus vite qu’elle est prête. Complétez votre dossier (documents et consentement de partage) pour être retenu rapidement — votre identité, elle, sera vérifiée par le notaire à la signature.'
        ),
      textLines: [offerLine(ctx), 'Complétez votre dossier pour être retenu plus vite.'],
      ctaLabel: 'Compléter mon dossier',
    },
    en: {
      heading: 'Your offer is posted',
      lead: 'Your offer for your deed — ' + svcNomEn(ctx.serviceId) + ' — on ' + fmtDateEn(ctx.dateISO) + ' is now on the Nota carnet.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(
          'A notary takes a request all the faster when it is ready. Complete your file (documents and sharing consent) to be taken quickly — your identity will be verified by the notary at signing.'
        ),
      textLines: [offerLineEn(ctx), 'Complete your file to be taken faster.'],
      ctaLabel: 'Complete my file',
    },
    ctaUrl: linksFor(ctx.baseUrl).dossier,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function dossierIncomplete(ctx) {
  return build({
    subjectFr: 'Il reste une étape à votre dossier',
    subjectEn: 'One step left in your file',
    preheaderFr: 'Terminez vos documents et le consentement pour devenir retenable.',
    preheaderEn: 'Finish your documents and consent so a notary can take you on.',
    fr: {
      heading: 'Votre dossier est presque prêt',
      lead: 'Pour votre ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ', il manque encore quelques éléments.',
      bodyHtml:
        para(
          'Ajoutez les documents demandés et cochez le consentement de partage. C’est ce qui permet à un notaire de retenir votre demande — sans cela, votre offre reste visible mais pas encore « prête ».'
        ) + callout(offerLine(ctx)),
      textLines: [offerLine(ctx), 'Ajoutez vos documents et le consentement de partage.'],
      ctaLabel: 'Terminer mon dossier',
    },
    en: {
      heading: 'Your file is almost ready',
      lead: 'For your ' + svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) + ', a few items are still missing.',
      bodyHtml:
        para(
          'Add the requested documents and check the sharing consent. That is what lets a notary take your request — without it, your offer stays visible but not yet “ready”.'
        ) + callout(offerLineEn(ctx)),
      textLines: [offerLineEn(ctx), 'Add your documents and the sharing consent.'],
      ctaLabel: 'Finish my file',
    },
    ctaUrl: linksFor(ctx.baseUrl).dossier,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Tier-aware. Same template for j7/j3/j1; the copy adapts to the days left and
// the tier's market range.
function dateApproaching(ctx) {
  const days = Number(ctx.days);
  const dLabel = days <= 0 ? 'aujourd’hui' : days === 1 ? 'demain' : 'dans ' + days + ' jours';
  const dLabelEn = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  const t = domain.tierById(ctx.tier);
  const dec = (n) => n.toFixed(1).replace('.', ','); // fr-CA decimal comma
  const decEn = (n) => n.toFixed(1); // en-CA decimal point
  const range = t ? dec(t.apercuMin) + '× à ' + dec(t.apercuMax) + '×' : '';
  const rangeEn = t ? decEn(t.apercuMin) + '× to ' + decEn(t.apercuMax) + '×' : '';
  return build({
    subjectFr: 'Votre signature approche — ' + dLabel,
    subjectEn: 'Your signing is coming up — ' + dLabelEn,
    preheaderFr: 'Une offre plus forte est retenue plus vite. Vérifiez la vôtre.',
    preheaderEn: 'A stronger offer gets taken faster. Check yours.',
    fr: {
      heading: 'Votre date approche',
      lead:
        'Votre rendez-vous — ' +
        svcNom(ctx.serviceId) +
        ' — est prévu ' +
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
    },
    en: {
      heading: 'Your date is coming up',
      lead:
        'Your appointment — ' +
        svcNomEn(ctx.serviceId) +
        ' — is scheduled ' +
        dLabelEn +
        ' (' +
        fmtDateEn(ctx.dateISO) +
        '). Your date is approaching; a stronger offer gets taken faster.',
      bodyHtml:
        callout(offerLineEn(ctx) + (tierNomEn(ctx.tier) ? ' · ' + tierNomEn(ctx.tier) + ' tier' : '')) +
        para(
          rangeEn
            ? 'At this notice, the market usually settles between ' +
                rangeEn +
                ' the starting price. If your offer sits below that range, raising it sharply improves your chances of being taken in time.'
            : 'If no offer has been taken yet, raising yours improves your chances of being taken in time.'
        ),
      textLines: [
        offerLineEn(ctx),
        tierNomEn(ctx.tier) ? 'Tier: ' + tierNomEn(ctx.tier) : '',
        rangeEn ? 'Market range at this notice: ' + rangeEn + '.' : '',
      ].filter(Boolean),
      ctaLabel: 'Check my offer',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function offerRetained(ctx) {
  return build({
    subjectFr: 'Un notaire a retenu votre demande',
    subjectEn: 'A notary has taken your request',
    preheaderFr: 'Voici les prochaines étapes vers votre signature.',
    preheaderEn: 'Here are the next steps toward your signing.',
    fr: {
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
    },
    en: {
      heading: 'Good news — your request is taken',
      lead:
        'A notary has taken your ' +
        svcNomEn(ctx.serviceId) +
        ' request for ' +
        fmtDateEn(ctx.dateISO) +
        '.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(
          'The notary will contact you to arrange the signing and will verify your identity at that time. Make sure your file is complete so everything moves quickly.'
        ),
      textLines: [offerLineEn(ctx), 'The notary will contact you about the signing.'],
      ctaLabel: 'See the next steps',
    },
    ctaUrl: linksFor(ctx.baseUrl).dossier,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function dateMissedNoUptake(ctx) {
  return build({
    subjectFr: 'Votre date approche — aucune offre retenue',
    subjectEn: 'Your date is near — no offer taken yet',
    preheaderFr: 'Bonifier votre offre attire un notaire plus rapidement.',
    preheaderEn: 'Raising your offer attracts a notary faster.',
    fr: {
      heading: 'Il est encore temps d’attirer un notaire',
      lead:
        'Votre demande — ' +
        svcNom(ctx.serviceId) +
        ' — du ' +
        fmtDate(ctx.dateISO) +
        ' approche et aucun notaire ne l’a encore retenue.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(
          'Aux dates rapprochées, une offre plus généreuse est retenue nettement plus vite. Vous pouvez bonifier votre offre en quelques secondes — dans la limite du plafond permis.'
        ),
      textLines: [offerLine(ctx), 'Bonifiez votre offre pour attirer un notaire à temps.'],
      ctaLabel: 'Bonifier mon offre',
    },
    en: {
      heading: 'There is still time to attract a notary',
      lead:
        'Your request — ' +
        svcNomEn(ctx.serviceId) +
        ' — for ' +
        fmtDateEn(ctx.dateISO) +
        ' is coming up and no notary has taken it yet.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(
          'At close dates, a more generous offer gets taken much faster. You can raise your offer in seconds — within the allowed cap.'
        ),
      textLines: [offerLineEn(ctx), 'Raise your offer to attract a notary in time.'],
      ctaLabel: 'Raise my offer',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Pay-on-accept, step 1 confirmed — the client's card hold succeeded and the
// offer just went live on the carnet. Reassurance-first: nothing is charged
// until a notary accepts.
function offerAuthorized(ctx) {
  return build({
    subjectFr: 'Paiement autorisé — votre offre est visible',
    subjectEn: 'Payment authorized — your offer is visible',
    preheaderFr: 'Rien n’est débité tant qu’un notaire n’accepte pas votre demande.',
    preheaderEn: 'Nothing is charged until a notary accepts your request.',
    fr: {
      heading: 'Votre offre est maintenant visible',
      lead:
        'Votre paiement est autorisé. Votre demande — ' +
        svcNom(ctx.serviceId) +
        ' — le ' +
        fmtDate(ctx.dateISO) +
        ' est visible sur le carnet.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(
          'Le montant est simplement réservé sur votre carte — il ne sera débité qu’au moment où un notaire retient votre demande. Si personne ne la retient, la réservation prend fin d’elle-même, sans frais.'
        ),
      textLines: [offerLine(ctx), 'Rien n’est débité tant qu’un notaire n’accepte pas.'],
      ctaLabel: 'Voir le carnet',
    },
    en: {
      heading: 'Your offer is now visible',
      lead:
        'Your payment is authorized. Your request — ' +
        svcNomEn(ctx.serviceId) +
        ' — on ' +
        fmtDateEn(ctx.dateISO) +
        ' is visible on the carnet.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(
          'The amount is simply held on your card — it is only charged when a notary takes your request. If no one takes it, the hold ends on its own, at no cost.'
        ),
      textLines: [offerLineEn(ctx), 'Nothing is charged until a notary accepts.'],
      ctaLabel: 'View the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// The authorization lapsed or was cancelled before any notary accepted — the
// offer silently left the carnet, so tell the client and offer the one fix.
function offerAuthorizationVoided(ctx) {
  return build({
    subjectFr: 'Votre offre n’est plus visible',
    subjectEn: 'Your offer is no longer visible',
    preheaderFr: 'L’autorisation de paiement a pris fin — republiez en quelques secondes.',
    preheaderEn: 'The payment hold ended — repost in seconds.',
    fr: {
      heading: 'Votre offre a quitté le carnet',
      lead:
        'L’autorisation de paiement liée à votre demande — ' +
        svcNom(ctx.serviceId) +
        ' — du ' +
        fmtDate(ctx.dateISO) +
        ' a pris fin.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(
          'Aucun montant n’a été débité. Pour revenir sur le carnet, republiez votre demande — cela ne prend que quelques secondes et votre date redevient visible aussitôt.'
        ),
      textLines: [offerLine(ctx), 'Aucun montant débité. Republiez pour revenir sur le carnet.'],
      ctaLabel: 'Republier ma demande',
    },
    en: {
      heading: 'Your offer left the carnet',
      lead:
        'The payment hold tied to your request — ' +
        svcNomEn(ctx.serviceId) +
        ' — for ' +
        fmtDateEn(ctx.dateISO) +
        ' has ended.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(
          'No amount was charged. To return to the carnet, repost your request — it takes seconds and your date becomes visible again right away.'
        ),
      textLines: [offerLineEn(ctx), 'Nothing was charged. Repost to return to the carnet.'],
      ctaLabel: 'Repost my request',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// =============================================================================
// NOTARY templates
// =============================================================================

// Weekly-style digest of open, high-value bids. The bid table is rendered once
// per language block, each side with its own service names, dates and amounts.
function bidRows(bids, lang) {
  return bids
    .map(
      (b) =>
        '<tr>' +
        '<td style="padding:8px 0;border-bottom:1px solid ' +
        PALETTE.border +
        ';font-size:14px;color:' +
        PALETTE.ink +
        ';">' +
        esc(
          lang === 'en'
            ? svcNomEn(b.serviceId) + ' · ' + fmtDateEn(b.dateISO)
            : svcNom(b.serviceId) + ' · ' + fmtDate(b.dateISO)
        ) +
        '</td>' +
        '<td style="padding:8px 0;border-bottom:1px solid ' +
        PALETTE.border +
        ';font-size:14px;font-weight:600;text-align:right;color:' +
        PALETTE.ink +
        ';">' +
        esc(lang === 'en' ? moneyEn(b.montant) : money(b.montant)) +
        '</td>' +
        '</tr>'
    )
    .join('');
}
function bidTable(bids, lang) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">' +
    bidRows(bids, lang) +
    '</table>'
  );
}
function newMatchingBids(ctx) {
  const bids = Array.isArray(ctx.bids) ? ctx.bids : [];
  const n = bids.length;
  return build({
    subjectFr: (n || 'De') + ' nouvelle' + (n === 1 ? '' : 's') + ' demande' + (n === 1 ? '' : 's') + ' sur le carnet',
    subjectEn: (n === 1 ? '1 new request' : (n ? n + ' new requests' : 'New requests')) + ' on the carnet',
    preheaderFr: 'Des demandes ouvertes attendent d’être retenues.',
    preheaderEn: 'Open requests are waiting to be taken.',
    fr: {
      heading: 'De nouvelles demandes vous attendent',
      lead: 'Un aperçu des demandes ouvertes que vous pourriez retenir.',
      bodyHtml:
        para('Voici les demandes ouvertes à plus forte valeur sur le carnet en ce moment :') +
        bidTable(bids, 'fr'),
      textLines: bids.map((b) => svcNom(b.serviceId) + ' · ' + fmtDate(b.dateISO) + ' · ' + money(b.montant)),
      ctaLabel: 'Voir le carnet',
    },
    en: {
      heading: 'New requests are waiting for you',
      lead: 'A look at the open requests you could take.',
      bodyHtml:
        para('Here are the highest-value open requests on the carnet right now:') +
        bidTable(bids, 'en'),
      textLines: bids.map((b) => svcNomEn(b.serviceId) + ' · ' + fmtDateEn(b.dateISO) + ' · ' + moneyEn(b.montant)),
      ctaLabel: 'View the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subWelcome(ctx) {
  return build({
    subjectFr: 'Bienvenue sur Nota',
    subjectEn: 'Welcome to Nota',
    preheaderFr: 'Votre abonnement est actif — accédez au carnet dès maintenant.',
    preheaderEn: 'Your subscription is active — access the carnet now.',
    fr: {
      heading: 'Votre abonnement est actif',
      lead: 'Merci de vous être abonné. Vous avez maintenant accès à toutes les demandes du carnet.',
      bodyHtml: para(
        'Nota facture un abonnement mensuel fixe pour l’accès à la place de marché — jamais un pourcentage de l’acte. Retenez autant de demandes que vous le souhaitez, sans frais par dossier.'
      ),
      textLines: ['Votre abonnement mensuel fixe est actif. Aucun frais par dossier.'],
      ctaLabel: 'Accéder au carnet',
    },
    en: {
      heading: 'Your subscription is active',
      lead: 'Thank you for subscribing. You now have access to every request on the carnet.',
      bodyHtml: para(
        'Nota charges a flat monthly subscription for marketplace access — never a percentage of the deed. Take as many requests as you like, with no per-file fees.'
      ),
      textLines: ['Your flat monthly subscription is active. No per-file fees.'],
      ctaLabel: 'Go to the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Welcome a CLIENT who just signed up — conversion-first: one clear next step
// (publish a demand). Sent once per email (idempotent in the notifier).
function clientWelcome(ctx) {
  return build({
    subjectFr: 'Bienvenue sur Nota — un notaire à la date qu’il vous faut',
    subjectEn: 'Welcome to Nota — a notary on the date you need',
    preheaderFr: 'Publiez votre première demande en quelques minutes — gratuit pour vous.',
    preheaderEn: 'Post your first request in minutes — free for you.',
    fr: {
      heading: 'Bienvenue sur Nota',
      lead: 'Vous êtes à quelques clics d’un notaire à Québec, à la date qui vous convient.',
      bodyHtml: para(
        'Choisissez votre date sur le carnet public, proposez votre prix, et un notaire de la région retient votre demande. Plus votre échéance est proche, plus votre offre se démarque. Vous ne payez que le notaire, à la signature — utiliser Nota est gratuit.'
      ),
      textLines: [
        '1) Choisissez votre date.  2) Proposez votre prix.  3) Un notaire vous retient.',
        'Gratuit pour vous — vous payez le notaire à la signature.',
      ],
      ctaLabel: 'Publier ma demande',
    },
    en: {
      heading: 'Welcome to Nota',
      lead: 'You are a few clicks away from a notary in Québec, on the date that suits you.',
      bodyHtml: para(
        'Pick your date on the public carnet, name your price, and a notary in the region takes your request. The closer your deadline, the more your offer stands out. You only pay the notary, at signing — using Nota is free.'
      ),
      textLines: [
        '1) Pick your date.  2) Name your price.  3) A notary takes you on.',
        'Free for you — you pay the notary at signing.',
      ],
      ctaLabel: 'Post my request',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subReceipt(ctx) {
  return build({
    subjectFr: 'Reçu — votre abonnement Nota',
    subjectEn: 'Receipt — your Nota subscription',
    preheaderFr: 'Confirmation de votre abonnement mensuel.',
    preheaderEn: 'Confirmation of your monthly subscription.',
    fr: {
      heading: 'Merci — voici votre reçu',
      lead: 'Votre abonnement mensuel à Nota a été confirmé.',
      bodyHtml: para(
        'Il s’agit d’un abonnement fixe pour l’accès à la place de marché. Le détail complet (montant, taxes, date) est disponible sur la facture Stripe qui accompagne ce reçu.'
      ),
      textLines: ['Abonnement mensuel confirmé. Facture détaillée fournie par Stripe.'],
      ctaLabel: 'Voir mon compte',
    },
    en: {
      heading: 'Thank you — here is your receipt',
      lead: 'Your monthly Nota subscription has been confirmed.',
      bodyHtml: para(
        'This is a flat subscription for marketplace access. The full details (amount, taxes, date) are on the Stripe invoice that accompanies this receipt.'
      ),
      textLines: ['Monthly subscription confirmed. Detailed invoice provided by Stripe.'],
      ctaLabel: 'View my account',
    },
    ctaUrl: linksFor(ctx.baseUrl).compte,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subRenewalReminder(ctx) {
  return build({
    subjectFr: 'Votre abonnement se renouvelle bientôt',
    subjectEn: 'Your subscription renews soon',
    preheaderFr: 'Aucune action requise — voici un rappel avant le renouvellement.',
    preheaderEn: 'No action needed — a reminder ahead of the renewal.',
    fr: {
      heading: 'Votre abonnement se renouvelle bientôt',
      lead: 'Votre abonnement mensuel à Nota sera renouvelé automatiquement sous peu.',
      bodyHtml: para(
        'Aucune action n’est nécessaire si vous souhaitez continuer. Vous pouvez gérer ou annuler votre abonnement à tout moment depuis votre compte.'
      ),
      textLines: ['Renouvellement automatique à venir. Gérez votre abonnement quand vous voulez.'],
      ctaLabel: 'Gérer mon abonnement',
    },
    en: {
      heading: 'Your subscription renews soon',
      lead: 'Your monthly Nota subscription will renew automatically shortly.',
      bodyHtml: para(
        'No action is needed if you wish to continue. You can manage or cancel your subscription at any time from your account.'
      ),
      textLines: ['Automatic renewal coming up. Manage your subscription whenever you like.'],
      ctaLabel: 'Manage my subscription',
    },
    ctaUrl: linksFor(ctx.baseUrl).compte,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Dunning — recover a churning subscription after a failed payment.
function subPaymentFailed(ctx) {
  return build({
    subjectFr: 'Action requise : votre paiement a été refusé',
    subjectEn: 'Action required: your payment was declined',
    preheaderFr: 'Mettez à jour votre paiement pour conserver l’accès au carnet.',
    preheaderEn: 'Update your payment to keep access to the carnet.',
    fr: {
      heading: 'Nous n’avons pas pu renouveler votre abonnement',
      lead: 'Le dernier paiement de votre abonnement Nota a échoué.',
      bodyHtml: para(
        'Pour conserver l’accès aux demandes du carnet, mettez à jour votre moyen de paiement. Nous réessaierons automatiquement, mais une mise à jour évite toute interruption.'
      ),
      textLines: ['Paiement refusé. Mettez à jour votre moyen de paiement pour éviter une interruption.'],
      ctaLabel: 'Mettre à jour mon paiement',
    },
    en: {
      heading: 'We could not renew your subscription',
      lead: 'The latest payment for your Nota subscription failed.',
      bodyHtml: para(
        'To keep access to the carnet’s requests, update your payment method. We will retry automatically, but updating it avoids any interruption.'
      ),
      textLines: ['Payment declined. Update your payment method to avoid an interruption.'],
      ctaLabel: 'Update my payment',
    },
    ctaUrl: linksFor(ctx.baseUrl).compte,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function subCanceledWinback(ctx) {
  return build({
    subjectFr: 'Votre place sur Nota vous attend',
    subjectEn: 'Your spot on Nota is waiting',
    preheaderFr: 'Réactivez votre abonnement quand vous voulez — rien n’est perdu.',
    preheaderEn: 'Reactivate your subscription anytime — nothing is lost.',
    fr: {
      heading: 'On vous garde une place',
      lead: 'Votre abonnement à Nota est résilié, mais vous pouvez le réactiver à tout moment.',
      bodyHtml: para(
        'Les demandes continuent d’arriver sur le carnet chaque jour. Réabonnez-vous en un instant pour recommencer à les retenir — toujours au même abonnement fixe, sans frais par dossier.'
      ),
      textLines: ['Réactivez votre abonnement quand vous voulez.'],
      ctaLabel: 'Réactiver mon abonnement',
    },
    en: {
      heading: 'We are keeping you a spot',
      lead: 'Your Nota subscription is canceled, but you can reactivate it at any time.',
      bodyHtml: para(
        'Requests keep arriving on the carnet every day. Resubscribe in an instant to start taking them again — always the same flat subscription, no per-file fees.'
      ),
      textLines: ['Reactivate your subscription whenever you like.'],
      ctaLabel: 'Reactivate my subscription',
    },
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Free Connect onboarding opened — the hosted verification link doubles as the
// CTA so a notary who closed the tab can resume from their inbox.
function notaryOnboardingStarted(ctx) {
  return build({
    subjectFr: 'Terminez votre inscription à Nota',
    subjectEn: 'Finish your Nota registration',
    preheaderFr: 'Une dernière étape sécurisée — ensuite, le carnet est à vous.',
    preheaderEn: 'One last secure step — then the carnet is yours.',
    fr: {
      heading: 'Votre inscription est presque terminée',
      lead: 'Il reste une étape sécurisée pour activer votre compte de notaire.',
      bodyHtml: para(
        'Complétez la vérification en ligne (identité et compte de dépôt). Dès que c’est fait, vous accédez au carnet et pouvez retenir des demandes — l’inscription est gratuite.'
      ),
      textLines: ['Complétez la vérification en ligne pour activer votre compte. Inscription gratuite.'],
      ctaLabel: 'Terminer mon inscription',
    },
    en: {
      heading: 'Your registration is almost done',
      lead: 'One secure step remains to activate your notary account.',
      bodyHtml: para(
        'Complete the online verification (identity and deposit account). As soon as it is done, you can access the carnet and take requests — registration is free.'
      ),
      textLines: ['Complete the online verification to activate your account. Registration is free.'],
      ctaLabel: 'Finish my registration',
    },
    ctaUrl: ctx.onboardingUrl || linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Connect verification cleared — the account can now take requests and be paid.
function notaryActive(ctx) {
  return build({
    subjectFr: 'Votre compte notaire est actif',
    subjectEn: 'Your notary account is active',
    preheaderFr: 'Le carnet est ouvert — remplissez votre semaine.',
    preheaderEn: 'The carnet is open — fill your week.',
    fr: {
      heading: 'Bienvenue — votre compte est actif',
      lead: 'Votre vérification est terminée. Vous pouvez maintenant retenir des demandes sur le carnet.',
      bodyHtml: para(
        'Choisissez les demandes qui conviennent à votre horaire et soyez payé à la signature. Ajustez vos préférences de réception pour être averti dès qu’une demande vous correspond.'
      ),
      textLines: ['Retenez les demandes qui conviennent à votre horaire. Payé à la signature.'],
      ctaLabel: 'Ouvrir le carnet',
    },
    en: {
      heading: 'Welcome — your account is active',
      lead: 'Your verification is complete. You can now take requests on the carnet.',
      bodyHtml: para(
        'Pick the requests that fit your schedule and get paid at signing. Adjust your delivery preferences to be alerted as soon as a request matches you.'
      ),
      textLines: ['Take the requests that fit your schedule. Paid at signing.'],
      ctaLabel: 'Open the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// A completed act was captured and the transfer is on its way. The exact
// net/fee breakdown lives on the Stripe statement — no amounts are computed
// here (presentation only).
function actPaidNotary(ctx) {
  const amount = ctx.actAmount != null ? ctx.actAmount : ctx.montant;
  const line = svcNom(ctx.serviceId) + ' · ' + fmtDate(ctx.dateISO) + ' · ' + money(amount);
  const lineEn = svcNomEn(ctx.serviceId) + ' · ' + fmtDateEn(ctx.dateISO) + ' · ' + moneyEn(amount);
  return build({
    subjectFr: 'Versement en route : ' + money(amount),
    subjectEn: 'Payout on the way: ' + moneyEn(amount),
    preheaderFr: 'L’acte est payé — votre versement arrive à votre compte.',
    preheaderEn: 'The act is paid — your transfer is heading to your account.',
    fr: {
      heading: 'Votre acte est payé',
      lead: 'Le paiement du client a été encaissé et votre versement est en route vers votre compte.',
      bodyHtml:
        callout(line) +
        para(
          'Le détail complet du versement figure sur votre relevé Stripe. Aucune action n’est requise de votre part.'
        ),
      textLines: [line, 'Détail complet sur votre relevé Stripe. Aucune action requise.'],
      ctaLabel: 'Voir mes revenus',
    },
    en: {
      heading: 'Your act is paid',
      lead: 'The client’s payment was collected and your transfer is on its way to your account.',
      bodyHtml:
        callout(lineEn) +
        para('The full transfer details are on your Stripe statement. No action is needed on your part.'),
      textLines: [lineEn, 'Full details on your Stripe statement. No action needed.'],
      ctaLabel: 'View my earnings',
    },
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Sign-in link for the notary console. Single CTA per language = the link
// itself; short validity is stated so an old email is never trusted.
function notaryMagicLink(ctx) {
  const ttl = ctx.ttlMinutes || 15;
  return build({
    subjectFr: 'Votre lien de connexion — Espace notaire',
    subjectEn: 'Your sign-in link — Notary console',
    preheaderFr: 'Lien à usage unique, valide ' + ttl + ' minutes.',
    preheaderEn: 'Single-use link, valid for ' + ttl + ' minutes.',
    fr: {
      heading: 'Connexion à votre espace notaire',
      lead: 'Voici votre lien de connexion sécurisé.',
      bodyHtml: para(
        'Ce lien est valide ' +
          ttl +
          ' minutes et à usage unique. Si vous n’avez pas demandé cette connexion, ignorez ce courriel — personne ne peut se connecter sans lui.'
      ),
      textLines: ['Lien à usage unique, valide ' + ttl + ' minutes.'],
      ctaLabel: 'Ouvrir mon espace',
    },
    en: {
      heading: 'Sign in to your notary console',
      lead: 'Here is your secure sign-in link.',
      bodyHtml: para(
        'This link is valid for ' +
          ttl +
          ' minutes and single-use. If you did not request this sign-in, ignore this email — no one can sign in without it.'
      ),
      textLines: ['Single-use link, valid for ' + ttl + ' minutes.'],
      ctaLabel: 'Open my console',
    },
    ctaUrl: ctx.link || linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// =============================================================================
// ADMIN templates
// =============================================================================

// Magic link for the admin console (admin.nota.ca). Same branded shell as every
// other message — an operator should never receive an unbranded one-off.
function adminMagicLink(ctx) {
  const ttl = ctx.ttlMinutes || 15;
  return build({
    subjectFr: 'Votre lien de connexion — Nota Admin',
    subjectEn: 'Your sign-in link — Nota Admin',
    preheaderFr: 'Lien à usage unique, valide ' + ttl + ' minutes.',
    preheaderEn: 'Single-use link, valid for ' + ttl + ' minutes.',
    fr: {
      heading: 'Connexion à la console d’administration',
      lead: 'Voici votre lien de connexion sécurisé.',
      bodyHtml: para(
        'Ce lien est valide ' +
          ttl +
          ' minutes et à usage unique. Si vous n’avez pas demandé cette connexion, ignorez ce courriel — personne ne peut se connecter sans lui.'
      ),
      textLines: ['Lien à usage unique, valide ' + ttl + ' minutes.'],
      ctaLabel: 'Ouvrir la console',
    },
    en: {
      heading: 'Sign in to the admin console',
      lead: 'Here is your secure sign-in link.',
      bodyHtml: para(
        'This link is valid for ' +
          ttl +
          ' minutes and single-use. If you did not request this sign-in, ignore this email — no one can sign in without it.'
      ),
      textLines: ['Single-use link, valid for ' + ttl + ' minutes.'],
      ctaLabel: 'Open the console',
    },
    ctaUrl: ctx.link || linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// =============================================================================
// OPERATOR (Nota) templates
// =============================================================================

function operatorNotarySubscribed(ctx) {
  return build({
    subjectFr: 'Nouveau notaire abonné',
    subjectEn: 'New notary subscriber' + (ctx.notaryEmail ? ': ' + ctx.notaryEmail : ''),
    preheaderFr: 'Un notaire vient de s’abonner à Nota.',
    preheaderEn: 'A notary just subscribed to Nota.',
    fr: {
      heading: 'Un notaire vient de s’abonner',
      lead: 'Un nouvel abonnement notaire vient d’être activé.',
      bodyHtml: callout('Courriel : ' + (ctx.notaryEmail || '—')),
      textLines: ['Nouveau notaire abonné : ' + (ctx.notaryEmail || '—')],
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'A notary just subscribed',
      lead: 'A new notary subscription has just been activated.',
      bodyHtml: callout('Email: ' + (ctx.notaryEmail || '—')),
      textLines: ['New notary subscriber: ' + (ctx.notaryEmail || '—')],
      ctaLabel: 'Open Nota',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

function operatorNewLead(ctx) {
  return build({
    subjectFr: 'Nouvelle offre : ' + money(ctx.montant) + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'New offer: ' + moneyEn(ctx.montant) + ' · ' + svcNomCourtEn(ctx.serviceId),
    preheaderFr: 'Une nouvelle offre a été publiée sur le carnet.',
    preheaderEn: 'A new offer was posted on the carnet.',
    fr: {
      heading: 'Nouvelle offre publiée',
      lead: 'Une offre vient d’être publiée sur le carnet Nota.',
      bodyHtml: callout(offerLine(ctx) + (tierNom(ctx.tier) ? ' · ' + tierNom(ctx.tier) : '')),
      textLines: [offerLine(ctx)],
      ctaLabel: 'Voir le carnet',
    },
    en: {
      heading: 'New offer posted',
      lead: 'An offer has just been posted on the Nota carnet.',
      bodyHtml: callout(offerLineEn(ctx) + (tierNomEn(ctx.tier) ? ' · ' + tierNomEn(ctx.tier) : '')),
      textLines: [offerLineEn(ctx)],
      ctaLabel: 'View the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// A revenue event: an act completed and the platform fee was collected.
function operatorActCompleted(ctx) {
  const amount = ctx.actAmount != null ? ctx.actAmount : ctx.montant;
  const line = svcNom(ctx.serviceId) + ' · ' + fmtDate(ctx.dateISO) + ' · ' + money(amount);
  const lineEn = svcNomEn(ctx.serviceId) + ' · ' + fmtDateEn(ctx.dateISO) + ' · ' + moneyEn(amount);
  return build({
    subjectFr: 'Acte complété : ' + money(amount) + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'Act completed: ' + moneyEn(amount) + ' · ' + svcNomCourtEn(ctx.serviceId),
    preheaderFr: 'Un acte vient d’être complété et payé sur Nota.',
    preheaderEn: 'An act was just completed and paid on Nota.',
    fr: {
      heading: 'Un acte vient d’être complété',
      lead: 'Le paiement a été encaissé et le versement au notaire est en route.',
      bodyHtml: callout(line + ' · ' + (ctx.notaryEmail || '—')),
      textLines: [line, 'Notaire : ' + (ctx.notaryEmail || '—')],
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'An act was just completed',
      lead: 'The payment was collected and the notary’s transfer is on its way.',
      bodyHtml: callout(lineEn + ' · ' + (ctx.notaryEmail || '—')),
      textLines: [lineEn, 'Notary: ' + (ctx.notaryEmail || '—')],
      ctaLabel: 'Open Nota',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });
}

// Registry — the notifier looks templates up by name; tests iterate it to assert
// every template carries a bilingual subject, an unsubscribe link and sender ID.
const TEMPLATES = {
  // client — offer lifecycle
  clientWelcome,
  offerPublished,
  dossierIncomplete,
  dateApproaching,
  offerRetained,
  dateMissedNoUptake,
  // client — pay-on-accept lifecycle
  offerAuthorized,
  offerAuthorizationVoided,
  // notary — marketplace lifecycle
  newMatchingBids,
  notaryMagicLink,
  notaryOnboardingStarted,
  notaryActive,
  actPaidNotary,
  // notary — subscription lifecycle (legacy Stripe billing events)
  subWelcome,
  subReceipt,
  subRenewalReminder,
  subPaymentFailed,
  subCanceledWinback,
  // admin console
  adminMagicLink,
  // operator alerts
  operatorNotarySubscribed,
  operatorNewLead,
  operatorActCompleted,
};

module.exports = {
  SENDER,
  TEMPLATES,
  fmtDate,
  fmtDateEn,
  ...TEMPLATES,
};
