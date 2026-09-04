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
 * Every template also follows the same conversion + compliance checklist —
 * each line is an invariant apps/api/test/emails-brand.test.mjs enforces on
 * the WHOLE registry, so a new template inherits it by being registered:
 *   - a short, specific 'FR / EN' subject (≤ 78 characters, never ALL CAPS);
 *   - a hidden 'FR · EN' preheader (≤ 110 characters a side) that adds to the
 *     subject instead of repeating it;
 *   - ONE primary call-to-action per language block, verb-first, ≤ 40
 *     characters, both buttons on the same absolute URL;
 *   - a consistent sign-off — « L’équipe Nota » / « The Nota team »;
 *   - the brand shell: PALETTE mirrors the web light-theme tokens key by key,
 *     every radius sits on the web square scale (no pills), the logo is text
 *     (no image of any kind), tables all the way down, ≤ 600 px;
 *   - mobile-friendly, inline-CSS HTML (email clients strip <style>/tokens);
 *   - a plain-text alternative carrying every link the HTML carries;
 *   - a CASL / Law-25 footer: bilingual sender identification (Nota + mailing
 *     address), the contact and privacy addresses from domain.CONTACT, and a
 *     working 'Se désabonner / Unsubscribe' link, on EVERY message;
 *   - no jargon in client copy (lead, hold, capture, payout, Stripe), never a
 *     rating value about a named notary in client copy (ADR 0030), never a
 *     percentage of honoraires in notary copy (art. 29.1 / 32 — the only « % »
 *     is the cancellation barème, « du montant »).
 *
 * CASL, on the unsubscribe: s. 6(6) lifts the CONSENT requirement for a
 * message that solely completes a transaction, not the form requirements of
 * s. 6(2) (sender identification + unsubscribe mechanism) — and a pure service
 * notice is not a commercial electronic message at all. Carrying the link on
 * every message is therefore always compliant, and one shell keeps it so.
 */

const domain = require('@nota/domain');

// --- Sender identity (CASL requirement (a)) ----------------------------------
// A real mailing address is legally required in commercial email (LCAP /
// CASL: full identification of the sender). `NOTA_SENDER_ADDRESS` supplies it;
// the fallback below is a PLACEHOLDER and is deliberately recognizable so a
// test can refuse it — an audit found the previous test locking the
// placeholder IN, checking only that *some* address was present.
const PLACEHOLDER_ADDRESS = 'Nota — 000, rue à confirmer, bureau 000, Québec (Québec) G0X 0X0, Canada';
const SENDER = {
  name: 'Nota',
  address: process.env.NOTA_SENDER_ADDRESS || PLACEHOLDER_ADDRESS,
  // The contact and privacy addresses are the domain's (the same ones the
  // site's footer and legal panes show) — one place to change them.
  supportEmail: domain.CONTACT.courriel,
  privacyEmail: domain.CONTACT.confidentialite,
};

// Colors defined once (single source), then referenced inline. Inline styles
// are mandatory for email, so this is the ONE flattened copy of the web's
// light-theme tokens (apps/web/public/styles.css :root) — emails-brand.test.mjs
// reads that file and holds every key here to it, so the mail can never drift
// from the site. The card is light-only on purpose (see layout()).
const PALETTE = {
  ink: '#111614', // --ink (hunter-black)
  muted: '#4f5e57', // --ink-muted (AA on every light surface)
  bg: '#f0f2f1', // --bg — the page canvas the card floats on
  card: '#fdfdfd', // --surface — a whisper off pure white
  border: '#dde2df', // --border
  brand: '#315b43', // --brand (hunter-700) — fills, rules, links
  brandDark: '#254633', // --brand-hover (hunter-800) — the button's edge
  brandInk: '#ffffff', // --brand-ink — text on the brand fill
  tint: '#f0f8f1', // hunter-50 — the callout wash
};
// The web square scale (--radius-lg / --radius / --radius-sm): the card, the
// mark and the button, the callout. No pills, no circles.
const RADIUS = { card: '12px', control: '8px', panel: '6px' };

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
    // The client's own space (their offer, propositions, document requests).
    profil: (b || '') + '/#t=profil',
    // ADR 0033 — the notary console opened on ONE act: a retained card, or an
    // open demand the console resolves to its card.
    acte: (bidId) => (b || '') + '/#notaires&acte=' + encodeURIComponent(String(bidId == null ? '' : bidId)),
  };
}

// --- Where each audience's CTA lands (ADR 0033 §2.7) --------------------------
// A client has no account: the notifier mints a signed, device-independent
// deep link to THEIR act (`clientUrl`) — the same act on any phone or laptop.
// Without one (an older caller, a test), the CTA falls back to their space,
// or to the `fallback` a template names (the dossier pane, for the two mails
// whose whole point is completing the file).
function clientActeUrl(ctx, fallback) {
  return ctx.clientUrl || fallback || linksFor(ctx.baseUrl).profil;
}
// A notary's act mail opens the console ON that act when the id is known.
function notaryActeUrl(ctx) {
  return ctx.bidId ? linksFor(ctx.baseUrl).acte(ctx.bidId) : linksFor(ctx.baseUrl).notaires;
}
// Operator alerts land on the admin console when one is configured
// (`adminUrl`, from NOTA_ADMIN_URL), else on the public carnet as before.
function operatorUrl(ctx) {
  return ctx.adminUrl || linksFor(ctx.baseUrl).carnet;
}
// A dialable href for a phone number, as the domain spells it (null when empty).
function telHref(raw) {
  const href = domain.telHref(raw);
  // `+1` is right for a dialer; the tests and the web card show the bare
  // national digits, so strip the country code we just assumed.
  return href ? href.replace(/^tel:\+1(\d{10})$/, 'tel:$1') : null;
}
// A rate as people read it: « 30 % » (fr-CA, no-break space) / « 30% » (en).
const NBSP = '\u00a0';
function pct(taux) {
  return Math.round(Number(taux) * 100) + NBSP + '%';
}
function pctEn(taux) {
  return Math.round(Number(taux) * 100) + '%';
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
    '" style="border-radius:' + RADIUS.control + ';background-color:' +
    PALETTE.brand +
    ';">' +
    '<a href="' +
    esc(url) +
    '" target="_blank" style="display:inline-block;padding:14px 32px;mso-padding-alt:14px 32px;min-height:20px;line-height:20px;font-family:' +
    FONT +
    ';font-size:16px;font-weight:600;letter-spacing:0.01em;color:' +
    PALETTE.brandInk +
    ';text-decoration:none;border-radius:' + RADIUS.control + ';border:1px solid ' +
    PALETTE.brandDark +
    ';">' +
    esc(label) +
    '</a></td></tr></table>'
  );
}
// Header band: the Nota "N" mark rendered WITHOUT images/SVG (many clients block
// them) — a hunter-green square holding a bold white "N" — next to the "Nota"
// wordmark in brand green and a small bilingual tagline. The mark is decoration
// (aria-hidden): the wordmark IS the accessible name, so a screen reader says
// « Nota », not « N Nota ». border-radius degrades gracefully to a square. Sits
// at the top of the card, above a hairline rule.
function logoHeader() {
  return (
    '<tr><td style="padding:26px 30px 22px;border-bottom:1px solid ' +
    PALETTE.border +
    ';">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="40" height="40" align="center" valign="middle" aria-hidden="true" style="width:40px;height:40px;background-color:' +
    PALETTE.brand +
    ';border-radius:' + RADIUS.control + ';font-family:' +
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
    PALETTE.muted +
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
  const link = (href, label) =>
    '<a href="' + esc(href) + '" style="color:' + PALETTE.muted + ';text-decoration:underline;">' + label + '</a>';
  return (
    '<tr><td style="padding:22px 30px 26px;border-top:1px solid ' +
    PALETTE.border +
    ';">' +
    '<div style="font-family:' +
    FONT +
    ';font-size:12px;line-height:1.6;color:' +
    PALETTE.muted +
    ';">' +
    '<p style="margin:0 0 4px;font-weight:700;">' +
    esc(SENDER.name) +
    '</p>' +
    '<p style="margin:0 0 10px;">' +
    esc(SENDER.address) +
    '</p>' +
    '<p style="margin:0 0 4px;">Vous recevez ce courriel de Nota au sujet de votre activité sur la place de marché notariale du Québec.</p>' +
    '<p style="margin:0 0 10px;">You are receiving this email from Nota about your activity on Québec’s notarial marketplace.</p>' +
    '<p style="margin:0;">' +
    link(unsubscribeUrl, 'Se désabonner / Unsubscribe') +
    ' &nbsp;·&nbsp; ' +
    link('mailto:' + SENDER.supportEmail, 'Nous écrire / Contact us') +
    ' &nbsp;·&nbsp; ' +
    link('mailto:' + SENDER.privacyEmail, 'Confidentialité (Loi 25) / Privacy (Law 25)') +
    '</p></div></td></tr>'
  );
}
// The sign-off that closes every language block — one voice on every message.
const SIGNOFF = { fr: 'L’équipe Nota', en: 'The Nota team' };
function signoffHtml(lang) {
  return (
    '<p style="margin:22px 0 0;font-family:' +
    FONT +
    ';font-size:14px;line-height:1.6;color:' +
    PALETTE.muted +
    ';">' +
    esc(SIGNOFF[lang] || SIGNOFF.fr) +
    '</p>'
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
// One language block: heading, optional lead, body, its own CTA button, the
// sign-off in that language.
function sectionHtml({ heading, lead, bodyHtml, ctaLabel }, ctaUrl, lang) {
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
    (ctaLabel && ctaUrl ? button(ctaLabel, ctaUrl) : '') +
    signoffHtml(lang)
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
    // The card is deliberately light-only (stable, legible everywhere); these
    // metas tell Apple Mail and friends not to auto-invert it in dark mode.
    '<meta name="color-scheme" content="light" />' +
    '<meta name="supported-color-schemes" content="light" />' +
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
    ';border-radius:' + RADIUS.card + ';border-collapse:separate;overflow:hidden;">' +
    logoHeader() +
    '<tr><td style="padding:26px 30px 30px;">' +
    sectionHtml(fr, ctaUrl, 'fr') +
    divider() +
    // The document is fr-CA; the English block declares its own language so
    // screen readers switch pronunciation.
    '<div lang="en-CA">' +
    sectionHtml(en, ctaUrl, 'en') +
    '</div>' +
    '</td></tr>' +
    footer(unsubscribeUrl) +
    '</table>' +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '</td></tr></table></div>' +
    '</body></html>'
  );
}
function sectionText({ heading, lead, textLines, ctaLabel }, ctaUrl, lang) {
  const parts = [heading, ''];
  if (lead) parts.push(lead, '');
  const body = (textLines || []).filter((l) => l != null && String(l).trim() !== '');
  body.forEach((l) => parts.push(l));
  if (body.length) parts.push('');
  if (ctaLabel && ctaUrl) parts.push(ctaLabel + ' : ' + ctaUrl, '');
  parts.push(SIGNOFF[lang] || SIGNOFF.fr, '');
  return parts;
}
function textLayout({ fr, en, ctaUrl, unsubscribeUrl }) {
  const parts = [
    ...sectionText(fr, ctaUrl, 'fr'),
    TEXT_SEPARATOR,
    '',
    ...sectionText(en, ctaUrl, 'en'),
  ];
  parts.push('—', SENDER.name, SENDER.address, '');
  parts.push('Se désabonner / Unsubscribe : ' + unsubscribeUrl);
  parts.push('Nous écrire / Contact us : ' + SENDER.supportEmail);
  parts.push('Confidentialité (Loi 25) / Privacy (Law 25) : ' + SENDER.privacyEmail);
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
    ';border-radius:' + RADIUS.panel + ';font-family:' +
    FONT +
    ';font-size:14px;line-height:1.5;font-weight:600;color:' +
    PALETTE.ink +
    ';">' +
    esc(text) +
    '</td></tr></table>'
  );
}
// A label / value block — the contact card of the mise en relation (ADR 0033),
// the facts of a demand. Rows without a value vanish; a row may carry an href
// (tel:, mailto:, the fiche at the Chambre). Table-based like everything else.
function detailRows(rows) {
  const cells = (rows || [])
    .filter((r) => r && r.value)
    .map(
      (r) =>
        '<tr><td style="padding:5px 14px 5px 0;font-family:' +
        FONT +
        ';font-size:14px;line-height:1.5;color:' +
        PALETTE.muted +
        ';white-space:nowrap;vertical-align:top;">' +
        esc(r.label) +
        '</td><td style="padding:5px 0;font-family:' +
        FONT +
        ';font-size:14px;line-height:1.5;font-weight:600;color:' +
        PALETTE.ink +
        ';vertical-align:top;">' +
        (r.href
          ? '<a href="' + esc(r.href) + '" style="color:' + PALETTE.brand + ';text-decoration:underline;">' + esc(r.value) + '</a>'
          : esc(r.value)) +
        '</td></tr>'
    )
    .join('');
  return cells
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-collapse:collapse;">' + cells + '</table>'
    : '';
}
// The text twin of detailRows — « Notaire : … » in French (space before the
// colon), « Notary: … » in English.
function detailText(rows, lang) {
  const sep = lang === 'en' ? ': ' : ' : ';
  return (rows || [])
    .filter((r) => r && r.value)
    .map((r) => r.label + sep + r.value + (r.href && /^https?:/.test(r.href) ? ' — ' + r.href : ''));
}
// A short list of facts (a barème, what an engagement means).
function bullets(items) {
  const li = (items || []).filter(Boolean);
  return li.length
    ? '<ul style="margin:0 0 16px;padding-left:20px;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:' + PALETTE.ink + ';">' +
      li.map((t) => '<li>' + esc(t) + '</li>').join('') +
      '</ul>'
    : '';
}

// Every message: 'FR / EN' subject, 'FR · EN' preheader, FR-then-EN html/text.
//
// `ctx` is the same context the template received. It may carry `__override`,
// the admin record read by the notifier — this is the ONE place a stored
// override becomes copy, so a template rendered anywhere (a send, an admin
// preview) reads the same. Everything the override supplies is plain text and
// travels through esc() like any other dynamic value; the button URL, the
// heading, the CASL footer and the unsubscribe link are structure, not copy,
// and stay out of reach.
function build(spec, ctx) {
  const { fr, en, ctaUrl, unsubscribeUrl } = spec;
  const o = overrideCopy(ctx && ctx.__override, ctx || {});
  const preheader = (o.preheaderFr || spec.preheaderFr) + ' · ' + (o.preheaderEn || spec.preheaderEn);
  const frBlock = applyCopy(fr, o.corpsFr, o.ctaFr);
  const enBlock = applyCopy(en, o.corpsEn, o.ctaEn);
  return {
    subject: o.subject || spec.subjectFr + ' / ' + spec.subjectEn,
    html: layout({ preheader, fr: frBlock, en: enBlock, ctaUrl, unsubscribeUrl }),
    text: textLayout({ fr: frBlock, en: enBlock, ctaUrl, unsubscribeUrl }),
  };
}
// One language block with the overridden copy folded in. The body is a single
// paragraph — the same para() every template uses, so it is escaped there.
function applyCopy(block, corps, cta) {
  if (!corps && !cta) return block;
  return {
    ...block,
    bodyHtml: corps ? para(corps) : block.bodyHtml,
    textLines: corps ? [corps] : block.textLines,
    ctaLabel: cta || block.ctaLabel,
  };
}

// --- offer summary line (reused across client templates) ---------------------
// « Refinancement · mardi 19 août 2026 · 1 500 $ ». A part the context does
// not carry (a campaign, an admin preview) is dropped rather than rendered as
// an empty slot between separators.
const joinLine = (parts) => parts.filter((p) => p != null && String(p).trim() !== '').join(' · ');
function offerLine(ctx) {
  return joinLine([svcNom(ctx.serviceId), fmtDate(ctx.dateISO), ctx.montant != null ? money(ctx.montant) : null]);
}
function offerLineEn(ctx) {
  return joinLine([svcNomEn(ctx.serviceId), fmtDateEn(ctx.dateISO), ctx.montant != null ? moneyEn(ctx.montant) : null]);
}

// --- The cancellation barème, as sentences (ADR 0023 / ADR 0033) --------------
// `bareme` is a list of paliers ALREADY priced upstream on this act's montant
// by cancellation-config: { maxJours, taux, frais }. The mail lays them out in
// ascending order and closes with the free window; an empty barème reads as
// free everywhere. Nothing is computed here.
function baremeLines(bareme, lang) {
  const en = lang === 'en';
  const paliers = Array.isArray(bareme) ? [...bareme].sort((a, b) => a.maxJours - b.maxJours) : [];
  if (!paliers.length) return [en ? 'no fee, whenever it happens' : 'aucuns frais, quel que soit le moment'];
  const lines = [];
  let prev = -1;
  for (const p of paliers) {
    const when = en
      ? p.maxJours === 0 ? 'On the day of the signing' : prev < 0 ? p.maxJours + ' days or fewer before the date' : 'From ' + (prev + 1) + ' to ' + p.maxJours + ' days before'
      : p.maxJours === 0 ? 'Le jour même de la signature' : prev < 0 ? 'À ' + p.maxJours + ' jours ou moins de la date' : 'De ' + (prev + 1) + ' à ' + p.maxJours + ' jours avant';
    const amount = p.frais != null ? ' (' + (en ? moneyEn(p.frais) : money(p.frais)) + ')' : '';
    lines.push(when + (en ? ': ' + pctEn(p.taux) + ' of the amount' : ' : ' + pct(p.taux) + ' du montant') + amount);
    prev = p.maxJours;
  }
  lines.push(en ? 'Beyond ' + prev + ' days: free' : 'Au-delà de ' + prev + ' jours : gratuit');
  return lines;
}

// The lender behind a demand, named for a notary: the catalogue name, or the
// name the client typed for « Autre prêteur » when it travels (`preteurNom`).
function lenderNom(ctx) {
  if (ctx.preteurNom) return String(ctx.preteurNom);
  const l = ctx.preteur ? domain.lenderById(ctx.preteur) : null;
  return l ? l.nom : null;
}
function deplacementNom(id) {
  const d = id ? domain.deplacementById(id) : null;
  return d ? d.nom : null;
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
    preheaderFr: 'Complétez votre dossier — un notaire ne peut retenir qu’une demande prête.',
    preheaderEn: 'Complete your file — a notary can only take a request that is ready.',
    fr: {
      heading: 'Votre offre est publiée',
      lead: 'Votre offre pour votre acte — ' + svcNom(ctx.serviceId) + ' — le ' + fmtDate(ctx.dateISO) + ' est maintenant sur le carnet Nota.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(
          'Un notaire ne peut retenir votre demande que si elle est prête. Complétez votre dossier (documents et consentement de partage) pour qu’il puisse le faire — votre identité, elle, sera vérifiée par le notaire à la signature.'
        ),
      textLines: [offerLine(ctx), 'Complétez votre dossier pour qu’un notaire puisse retenir votre demande.'],
      ctaLabel: 'Compléter mon dossier',
    },
    en: {
      heading: 'Your offer is posted',
      lead: 'Your offer for your deed — ' + svcNomEn(ctx.serviceId) + ' — on ' + fmtDateEn(ctx.dateISO) + ' is now on the Nota carnet.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(
          'A notary can only take your request once it is ready. Complete your file (documents and sharing consent) so they can — your identity will be verified by the notary at signing.'
        ),
      textLines: [offerLineEn(ctx), 'Complete your file so a notary can take your request.'],
      ctaLabel: 'Complete my file',
    },
    ctaUrl: clientActeUrl(ctx, linksFor(ctx.baseUrl).dossier),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

function dossierIncomplete(ctx) {
  return build({
    subjectFr: 'Il reste une étape à votre dossier',
    subjectEn: 'One step left in your file',
    preheaderFr: 'Terminez vos documents et le consentement pour que votre demande puisse être retenue.',
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
    ctaUrl: clientActeUrl(ctx, linksFor(ctx.baseUrl).dossier),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Tier-aware. Same template for j7/j3/j1; the copy adapts to the days left and
// the tier's band.
//
// Art. 68 et art. 14 du Code de déontologie — aucune publicité incomplète, et
// aucune fausse représentation quant à l'efficacité du service. Aucun acte n'a
// encore été conclu sur la plateforme : ni « retenu plus vite », ni « le marché
// se conclut à », ni un pourcentage de chances ne repose sur une observation.
// La copie dit donc le MÉCANISME — à quelques jours de la date, un notaire doit
// réorganiser sa semaine, et c'est l'offre qui lui en donne la raison — et la
// fourchette est attribuée à qui la fixe : Nota la suggère, le marché ne l'a
// pas encore prononcée. Même règle que `OBTAIN_CHANCE` dans le domaine.
function dateApproaching(ctx) {
  // Without a day count (a campaign, a preview) the copy says « bientôt »
  // rather than leaking « dans NaN jours ».
  const days = Number.isFinite(Number(ctx.days)) && ctx.days != null ? Number(ctx.days) : null;
  const dLabel = days == null ? 'bientôt' : days <= 0 ? 'aujourd’hui' : days === 1 ? 'demain' : 'dans ' + days + ' jours';
  const dLabelEn = days == null ? 'soon' : days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  const t = domain.tierById(ctx.tier);
  // Two decimals, trailing zero trimmed: 1.25 stays « 1,25 », 1.7 stays « 1,7 » —
  // toFixed(1) used to round the tier bands (1,25 → « 1,3 ») and misquote the market.
  const dec = (n) => n.toFixed(2).replace(/0$/, '').replace('.', ','); // fr-CA decimal comma
  const decEn = (n) => n.toFixed(2).replace(/0$/, ''); // en-CA decimal point
  // A flat band (min === max, the standard tier) is not a range — say « au prix
  // de départ » instead of « entre 1× et 1× ».
  const flat = t && t.apercuMin === t.apercuMax;
  const range = t && !flat ? dec(t.apercuMin) + '× et ' + dec(t.apercuMax) + '×' : '';
  const rangeEn = t && !flat ? decEn(t.apercuMin) + '× and ' + decEn(t.apercuMax) + '×' : '';
  return build({
    subjectFr: days != null && days <= 0 ? 'Votre signature est aujourd’hui' : 'Votre signature approche : ' + dLabel,
    subjectEn: days != null && days <= 0 ? 'Your signing is today' : 'Your signing is ' + dLabelEn,
    preheaderFr: 'Plus la date approche, moins de notaires peuvent s’organiser. Vérifiez votre offre.',
    preheaderEn: 'The closer the date, the fewer notaries can free it up. Check your offer.',
    fr: {
      heading: 'Votre date approche',
      lead:
        'Votre rendez-vous — ' +
        svcNom(ctx.serviceId) +
        ' — est prévu ' +
        dLabel +
        ' (' +
        fmtDate(ctx.dateISO) +
        ').',
      bodyHtml:
        callout(offerLine(ctx) + (tierNom(ctx.tier) ? ' · palier ' + tierNom(ctx.tier) : '')) +
        para(
          range
            ? 'À ce délai, Nota suggère entre ' +
                range +
                ' le prix de départ. Si votre offre est sous cette fourchette, la bonifier donne à un notaire une raison de réorganiser sa semaine pour votre date.'
            : flat
              ? 'À ce délai, Nota suggère le prix de départ. Une offre plus élevée donne à un notaire une raison de réorganiser sa semaine pour votre date.'
              : 'Si aucune offre n’est encore retenue, la bonifier donne à un notaire une raison de réorganiser sa semaine pour votre date.'
        ),
      textLines: [
        offerLine(ctx),
        tierNom(ctx.tier) ? 'Palier : ' + tierNom(ctx.tier) : '',
        range ? 'Fourchette suggérée à ce délai : ' + range + '.' : '',
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
        ').',
      bodyHtml:
        callout(offerLineEn(ctx) + (tierNomEn(ctx.tier) ? ' · ' + tierNomEn(ctx.tier) + ' tier' : '')) +
        para(
          rangeEn
            ? 'At this notice, Nota suggests between ' +
                rangeEn +
                ' of the starting price. If your offer sits below that range, raising it gives a notary a reason to rearrange their week for your date.'
            : flat
              ? 'At this notice, Nota suggests the starting price. A higher offer gives a notary a reason to rearrange their week for your date.'
              : 'If no offer has been taken yet, raising yours gives a notary a reason to rearrange their week for your date.'
        ),
      textLines: [
        offerLineEn(ctx),
        tierNomEn(ctx.tier) ? 'Tier: ' + tierNomEn(ctx.tier) : '',
        rangeEn ? 'Suggested range at this notice: ' + rangeEn + '.' : '',
      ].filter(Boolean),
      ctaLabel: 'Check my offer',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The mise en relation is complete (ADR 0033): the client learns WHO retained
// their act — name, étude, phone (dialable), address, courriel, fiche at the
// Chambre — and that the conversation lives in their Nota space. Then what may
// still change (the notary can withdraw; the act returns to the carnet as
// posted) and what cancelling would cost: the barème in force, priced upstream
// on this montant, which goes to the notary as compensation — never to Nota.
// Context: bid fields + `notaire` { nom, etude, telephone, adresse, courriel,
// lienCNQ } + `bareme` [{ maxJours, taux, frais }] + `clientUrl`.
function offerRetained(ctx) {
  const n = ctx.notaire || {};
  const nom = n.nom || null;
  const etude = n.etude || ctx.etude || null;
  const who = nom || etude || null;
  const rows = [
    { label: 'Notaire', value: nom },
    { label: 'Étude', value: etude },
    { label: 'Téléphone', value: n.telephone, href: telHref(n.telephone) },
    { label: 'Adresse', value: n.adresse },
    { label: 'Courriel', value: n.courriel, href: n.courriel ? 'mailto:' + n.courriel : null },
    { label: 'Chambre des notaires', value: n.lienCNQ ? 'Vérifier sa fiche' : null, href: n.lienCNQ || null },
  ];
  const rowsEn = [
    { label: 'Notary', value: nom },
    { label: 'Practice', value: etude },
    { label: 'Phone', value: n.telephone, href: telHref(n.telephone) },
    { label: 'Address', value: n.adresse },
    { label: 'Email', value: n.courriel, href: n.courriel ? 'mailto:' + n.courriel : null },
    { label: 'Chambre des notaires', value: n.lienCNQ ? 'Check their fiche' : null, href: n.lienCNQ || null },
  ];
  const contact = detailRows(rows);
  const contactEn = detailRows(rowsEn);
  const bareme = baremeLines(ctx.bareme, 'fr');
  const baremeEn = baremeLines(ctx.bareme, 'en');
  const conversation = 'Écrivez-lui dans votre espace Nota : la conversation reste attachée à votre dossier, avec vos documents et votre rendez-vous. Le notaire vérifie votre identité à la signature.';
  const conversationEn = 'Write to them in your Nota space: the conversation stays attached to your file, with your documents and your appointment. The notary verifies your identity at the signing.';
  const desistement = 'Le notaire peut encore se désister si un détail du dossier (un prêteur inhabituel, un conflit d’intérêts) rend l’acte impossible de son côté. Votre offre revient alors au carnet telle quelle — même date, même montant — et vous en êtes averti aussitôt.';
  const desistementEn = 'The notary may still withdraw if a detail of the file (an unusual lender, a conflict of interest) makes the act impossible on their side. Your offer then returns to the carnet as is — same date, same amount — and you are told right away.';
  const fraisIntro = 'Si vous annulez, une part du montant est retenue sur votre carte et versée au notaire en dédommagement :';
  const fraisIntroEn = 'If you cancel, a share of the amount is kept on your card and transferred to the notary as compensation:';
  return build({
    subjectFr: 'Un notaire a retenu votre demande',
    subjectEn: 'A notary has taken your request',
    preheaderFr: (who ? who + ' — ' : '') + 'voici comment le joindre, et les prochaines étapes.',
    preheaderEn: (who ? who + ' — ' : '') + 'here is how to reach them, and the next steps.',
    fr: {
      heading: 'Bonne nouvelle — votre demande est retenue',
      lead: (who || 'Un notaire') + ' a retenu votre demande de ' + svcNom(ctx.serviceId) + ' pour le ' + fmtDate(ctx.dateISO) + '.',
      bodyHtml:
        callout(offerLine(ctx)) +
        (contact ? para('Voici comment joindre votre notaire :') + contact : '') +
        para(conversation) +
        para(desistement) +
        para(fraisIntro) +
        bullets(bareme),
      textLines: [offerLine(ctx)]
        .concat(detailText(rows))
        .concat([conversation, desistement, fraisIntro])
        .concat(bareme.map((l) => '- ' + l)),
      ctaLabel: 'Ouvrir mon dossier',
    },
    en: {
      heading: 'Good news — your request is taken',
      lead: (who || 'A notary') + ' has taken your ' + svcNomEn(ctx.serviceId) + ' request for ' + fmtDateEn(ctx.dateISO) + '.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        (contactEn ? para('Here is how to reach your notary:') + contactEn : '') +
        para(conversationEn) +
        para(desistementEn) +
        para(fraisIntroEn) +
        bullets(baremeEn),
      textLines: [offerLineEn(ctx)]
        .concat(detailText(rowsEn, 'en'))
        .concat([conversationEn, desistementEn, fraisIntroEn])
        .concat(baremeEn.map((l) => '- ' + l)),
      ctaLabel: 'Open my file',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

function dateMissedNoUptake(ctx) {
  return build({
    subjectFr: 'Votre date approche, aucune offre retenue',
    subjectEn: 'Your date is near, no offer taken',
    preheaderFr: 'Bonifier votre offre donne à un notaire une raison de libérer la date.',
    preheaderEn: 'Raising your offer gives a notary a reason to free up the date.',
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
          'À quelques jours de la date, un notaire doit réorganiser sa semaine pour vous prendre : une offre plus généreuse lui en donne la raison. Vous pouvez bonifier votre offre en quelques secondes — dans la limite du plafond permis.'
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
          'A few days out, a notary has to rearrange their week to take you: a more generous offer is what gives them the reason. You can raise your offer in seconds — within the allowed cap.'
        ),
      textLines: [offerLineEn(ctx), 'Raise your offer to attract a notary in time.'],
      ctaLabel: 'Raise my offer',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Pay-on-accept, step 1 confirmed — the client's card hold succeeded and the
// offer just went live on the carnet. Reassurance-first: nothing is charged
// until a notary accepts.
//
// Art. 68 — ce qui est réservé sur la carte est `devis.totalCents` (ADR 0031),
// pas le seul montant affiché dans l'encadré. Le courriel nomme donc les deux
// lignes ; il ne peut pas encore en donner la somme, faute de la recevoir dans
// son contexte.
function offerAuthorized(ctx) {
  return build({
    subjectFr: 'Paiement autorisé — offre visible',
    subjectEn: 'Payment authorized — offer visible',
    preheaderFr: 'Rien n’est débité tant qu’un notaire n’a pas retenu votre demande.',
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
          'Votre offre et le prix du service de Nota sont simplement réservés sur votre carte — rien ne sera débité avant qu’un notaire retienne votre demande. Si personne ne la retient, la réservation prend fin d’elle-même, sans frais.'
        ),
      textLines: [offerLine(ctx), 'Rien n’est débité tant qu’un notaire n’accepte pas.'],
      ctaLabel: 'Suivre mon offre',
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
          'Your offer and the price of Nota’s service are simply reserved on your card — nothing is charged before a notary takes your request. If no one takes it, the reservation ends on its own, at no cost.'
        ),
      textLines: [offerLineEn(ctx), 'Nothing is charged until a notary accepts.'],
      ctaLabel: 'Track my offer',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The authorization lapsed or was cancelled before any notary accepted — the
// offer silently left the carnet, so tell the client and offer the one fix.
function offerAuthorizationVoided(ctx) {
  return build({
    subjectFr: 'Votre offre n’est plus visible',
    subjectEn: 'Your offer is no longer visible',
    preheaderFr: 'L’autorisation de paiement a pris fin — republiez en quelques secondes.',
    preheaderEn: 'The card authorization ended — repost in seconds.',
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
        'The card authorization tied to your request — ' +
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
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
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
  // The subject announces every matching demand (ctx.n) even when the table
  // shows only the top rows the sender chose to list.
  const n = Number.isFinite(ctx.n) ? ctx.n : bids.length;
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
  }, ctx);
}

// Welcome a CLIENT who just signed up — conversion-first: one clear next step
// (publish a demand). Sent once per email (idempotent in the notifier).
//
// Art. 68 du Code de déontologie — aucune publicité incomplète. Depuis l'ADR
// 0031, une offre porte DEUX lignes : le montant offert, qui va en entier au
// notaire, et le prix du service de Nota, que le client paie en plus. Promettre
// que Nota « ne coûte rien de plus » serait taire la seconde ligne. Le prix
// lui-même n'est pas écrit ici : il est configurable (`prix-nota-config.js`) et
// s'affiche à l'écran avant que le client confirme.
function clientWelcome(ctx) {
  return build({
    subjectFr: 'Bienvenue sur Nota',
    subjectEn: 'Welcome to Nota',
    preheaderFr: 'Publiez votre première demande en quelques minutes — publier ne coûte rien.',
    preheaderEn: 'Post your first request in minutes — posting costs nothing.',
    fr: {
      heading: 'Bienvenue sur Nota',
      lead: 'Vous êtes à quelques clics d’un notaire à Québec, à la date qui vous convient.',
      bodyHtml: para(
        'Choisissez votre date sur le carnet public, proposez votre prix, et un notaire de la région retient votre demande. Plus votre échéance est proche, plus votre offre se démarque. À la signature, vous payez deux lignes : le montant que vous avez offert, qui va en entier au notaire, et le prix du service de Nota, affiché avant que vous confirmiez.'
      ),
      textLines: [
        '1) Choisissez votre date. 2) Proposez votre prix. 3) Un notaire retient votre demande.',
        'Deux lignes à la signature : votre offre, qui va en entier au notaire, et le prix du service de Nota.',
      ],
      ctaLabel: 'Publier ma demande',
    },
    en: {
      heading: 'Welcome to Nota',
      lead: 'You are a few clicks away from a notary in Québec, on the date that suits you.',
      bodyHtml: para(
        'Pick your date on the public carnet, name your price, and a notary in the region takes your request. The closer your deadline, the more your offer stands out. At signing you pay two lines: the amount you offered, which goes to the notary in full, and the price of Nota’s service, shown before you confirm.'
      ),
      textLines: [
        '1) Pick your date. 2) Name your price. 3) A notary takes your request.',
        'Two lines at signing: your offer, which goes to the notary in full, and the price of Nota’s service.',
      ],
      ctaLabel: 'Post my request',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Win-back after the notary disconnects their payment account from Nota.
//
// Art. 32 du Code de déontologie — le notaire ne peut partager ses honoraires
// avec une personne qui n'est pas membre d'un ordre professionnel ; art. 32.1
// 2° de la Loi sur le notariat — est présumée usurper les fonctions de notaire
// la personne qui obtient d'un notaire qu'il abandonne une partie de ses
// honoraires. Depuis l'ADR 0031, Nota ne prélève plus rien sur le montant
// offert : promettre « une commission seulement sur les actes complétés »
// décrirait à un notaire une opération que le Code lui interdit, et que le code
// ne fait plus.
function notaryDisconnectedWinback(ctx) {
  return build({
    subjectFr: 'Votre place sur Nota vous attend',
    subjectEn: 'Your spot on Nota is waiting',
    preheaderFr: 'Reconnectez votre compte quand vous voulez — rien n’est perdu.',
    preheaderEn: 'Reconnect your account anytime — nothing is lost.',
    fr: {
      heading: 'On vous garde une place',
      lead: 'Votre compte de paiement est déconnecté de Nota, mais vous pouvez le reconnecter à tout moment.',
      bodyHtml: para(
        'Les demandes continuent d’arriver sur le carnet chaque jour. Reconnectez votre compte en un instant pour recommencer à les retenir — le montant offert vous revient en entier, et Nota facture son propre prix au client.'
      ),
      textLines: ['Reconnectez votre compte quand vous voulez. Le montant offert vous revient en entier ; Nota facture son prix au client.'],
      ctaLabel: 'Reconnecter mon compte',
    },
    en: {
      heading: 'We are keeping you a spot',
      lead: 'Your payment account is disconnected from Nota, but you can reconnect it at any time.',
      bodyHtml: para(
        'Requests keep arriving on the carnet every day. Reconnect your account in an instant to start taking them again — the amount offered comes to you in full, and Nota bills the client its own price.'
      ),
      textLines: ['Reconnect your account whenever you like. The amount offered comes to you in full; Nota bills the client its own price.'],
      ctaLabel: 'Reconnect my account',
    },
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
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
  }, ctx);
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
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'Welcome — your account is active',
      lead: 'Your verification is complete. You can now take requests on the carnet.',
      bodyHtml: para(
        'Pick the requests that fit your schedule and get paid at signing. Adjust your delivery preferences to be alerted as soon as a request matches you.'
      ),
      textLines: ['Take the requests that fit your schedule. Paid at signing.'],
      ctaLabel: 'Open my console',
    },
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// A completed act was captured and the transfer is on its way. The exact
// net/fee breakdown lives on the Stripe statement — no amounts are computed
// here (presentation only).
function actPaidNotary(ctx) {
  const amount = ctx.actAmount != null ? ctx.actAmount : ctx.montant;
  const line = offerLine({ ...ctx, montant: amount });
  const lineEn = offerLineEn({ ...ctx, montant: amount });
  return build({
    subjectFr: 'Acte payé — versement en route',
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
  }, ctx);
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
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'Sign in to your notary console',
      lead: 'Here is your secure sign-in link.',
      bodyHtml: para(
        'This link is valid for ' +
          ttl +
          ' minutes and can be used only once. If you did not request this sign-in, ignore this email — no one can sign in without it.'
      ),
      textLines: ['Single-use link, valid for ' + ttl + ' minutes.'],
      ctaLabel: 'Open my console',
    },
    ctaUrl: ctx.link || linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
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
          ' minutes and can be used only once. If you did not request this sign-in, ignore this email — no one can sign in without it.'
      ),
      textLines: ['Single-use link, valid for ' + ttl + ' minutes.'],
      ctaLabel: 'Open the console',
    },
    ctaUrl: ctx.link || linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// OPERATOR (Nota) templates
// =============================================================================

function operatorNotaryActive(ctx) {
  return build({
    // Operator alerts: the FR side carries the detail, the EN side stays the
    // short label — the subject has to fit an inbox line with an address in it.
    subjectFr: 'Nouveau notaire actif' + (ctx.notaryEmail ? ' : ' + ctx.notaryEmail : ''),
    subjectEn: 'New active notary',
    preheaderFr: 'Un notaire vient d’activer son compte sur Nota.',
    preheaderEn: 'A notary just activated their account on Nota.',
    fr: {
      heading: 'Un notaire vient d’activer son compte',
      lead: 'Un nouveau compte notaire vient de terminer sa configuration de paiement.',
      bodyHtml: callout('Courriel : ' + (ctx.notaryEmail || '—')),
      textLines: ['Nouveau notaire actif : ' + (ctx.notaryEmail || '—')],
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'A notary just activated their account',
      lead: 'A new notary account has just completed its payment onboarding.',
      bodyHtml: callout('Email: ' + (ctx.notaryEmail || '—')),
      textLines: ['New active notary: ' + (ctx.notaryEmail || '—')],
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
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
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// A revenue event: an act completed and the platform fee was collected.
function operatorActCompleted(ctx) {
  const amount = ctx.actAmount != null ? ctx.actAmount : ctx.montant;
  const line = offerLine({ ...ctx, montant: amount });
  const lineEn = offerLineEn({ ...ctx, montant: amount });
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
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// NOTARY ACTIONS on an open offer — propositions (a higher price) and document
// requests. The client has no account: the CTA leads to their profil/dossier.
// =============================================================================

// Context: the bid fields + `proposition: { montant, delta, message, etude }`.
function propositionRecue(ctx) {
  const p = ctx.proposition || {};
  const amount = Number.isFinite(Number(p.montant)) ? Number(p.montant) : ctx.montant;
  const delta = Number.isFinite(Number(p.delta)) ? Number(p.delta) : null;
  const etude = p.etude || null;
  const line = offerLine(ctx);
  const lineEn = offerLineEn(ctx);
  const prop = 'Proposition du notaire : ' + money(amount) + (delta != null ? ' (+' + money(delta) + ')' : '');
  const propEn = 'Notary’s proposal: ' + moneyEn(amount) + (delta != null ? ' (+' + moneyEn(delta) + ')' : '');
  return build({
    subjectFr: 'Un notaire vous propose ' + money(amount),
    subjectEn: 'A notary proposes ' + moneyEn(amount),
    preheaderFr: 'Acceptez ou déclinez la proposition depuis votre profil.',
    preheaderEn: 'Accept or decline the proposal from your profile.',
    fr: {
      heading: 'Un notaire a répondu à votre offre',
      lead:
        (etude ? etude + ' propose' : 'Un notaire propose') +
        ' de signer votre ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) +
        ' à un prix différent du vôtre.',
      bodyHtml:
        callout(prop) +
        para('Votre offre actuelle : ' + line + '.') +
        (p.message ? para('Message du notaire : « ' + p.message + ' »') : '') +
        para('Si vous acceptez, votre demande est retenue par ce notaire à ce nouveau montant. Sinon, votre offre reste en ligne telle quelle.'),
      textLines: [prop, 'Votre offre actuelle : ' + line].concat(p.message ? ['Message du notaire : ' + p.message] : []),
      ctaLabel: 'Voir la proposition',
    },
    en: {
      heading: 'A notary answered your offer',
      lead:
        (etude ? etude + ' proposes' : 'A notary proposes') +
        ' to sign your ' + svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) +
        ' at a different price than yours.',
      bodyHtml:
        callout(propEn) +
        para('Your current offer: ' + lineEn + '.') +
        (p.message ? para('Message from the notary: “' + p.message + '”') : '') +
        para('If you accept, your request is taken by this notary at the new amount. Otherwise your offer stays live as it is.'),
      textLines: [propEn, 'Your current offer: ' + lineEn].concat(p.message ? ['Message from the notary: ' + p.message] : []),
      ctaLabel: 'See the proposal',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Context: the bid fields + `demande: { documents: [{ id, nom }], message, etude }`.
function documentsDemandes(ctx) {
  const d = ctx.demande || {};
  const items = Array.isArray(d.documents) ? d.documents.map((x) => (x && x.nom) || String(x)) : [];
  const etude = d.etude || null;
  const listHtml = items.length
    ? '<ul style="margin:0 0 16px;padding-left:20px;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:' + PALETTE.ink + ';">' +
      items.map((n) => '<li>' + esc(n) + '</li>').join('') +
      '</ul>'
    : '';
  const listText = items.map((n) => '- ' + n);
  return build({
    subjectFr: 'Un notaire vous demande des documents',
    subjectEn: 'A notary is asking you for documents',
    preheaderFr: 'Ajoutez les éléments demandés à votre dossier pour faire avancer votre demande.',
    preheaderEn: 'Add the requested items to your file to move your request forward.',
    fr: {
      heading: 'Des documents sont demandés',
      lead:
        (etude ? etude + ' a besoin' : 'Un notaire a besoin') +
        ' des éléments suivants pour votre ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + '.',
      bodyHtml:
        listHtml +
        (d.message ? para('Message du notaire : « ' + d.message + ' »') : '') +
        callout(offerLine(ctx)) +
        para('Ajoutez-les à votre dossier : un notaire ne peut avancer que sur une demande complète.'),
      textLines: listText.concat(d.message ? ['Message du notaire : ' + d.message] : [], [offerLine(ctx)]),
      ctaLabel: 'Compléter mon dossier',
    },
    en: {
      heading: 'Documents are requested',
      lead:
        (etude ? etude + ' needs' : 'A notary needs') +
        ' the following items for your ' + svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) + '.',
      bodyHtml:
        listHtml +
        (d.message ? para('Message from the notary: “' + d.message + '”') : '') +
        callout(offerLineEn(ctx)) +
        para('Add them to your file: a notary can only move forward on a complete request.'),
      textLines: listText.concat(d.message ? ['Message from the notary: ' + d.message] : [], [offerLineEn(ctx)]),
      ctaLabel: 'Complete my file',
    },
    ctaUrl: clientActeUrl(ctx, linksFor(ctx.baseUrl).dossier),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// To the notary: the client accepted their proposition — the offer is now
// retained by them at the proposed amount. Context: bid fields (montant = the
// new amount) + `proposition: { montant }`.
function propositionAcceptee(ctx) {
  const p = ctx.proposition || {};
  const amount = Number.isFinite(Number(p.montant)) ? Number(p.montant) : ctx.montant;
  const line = offerLine({ ...ctx, montant: amount });
  const lineEn = offerLineEn({ ...ctx, montant: amount });
  return build({
    subjectFr: 'Proposition acceptée : ' + money(amount),
    subjectEn: 'Proposal accepted: ' + moneyEn(amount),
    preheaderFr: 'La demande vous est confiée au montant proposé.',
    preheaderEn: 'The request is yours at the proposed amount.',
    fr: {
      heading: 'Le client a accepté votre proposition',
      lead: 'La demande de ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ' vous est maintenant confiée.',
      bodyHtml:
        callout(line) +
        para('Le dossier et le courriel du client sont disponibles dans votre console. Contactez-le pour organiser la signature.'),
      textLines: [line, 'Le dossier du client est disponible dans votre console.'],
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'The client accepted your proposal',
      lead: 'The ' + svcNomEn(ctx.serviceId) + ' request on ' + fmtDateEn(ctx.dateISO) + ' is now yours.',
      bodyHtml:
        callout(lineEn) +
        para('The client’s file and email are available in your console. Contact them to arrange the signing.'),
      textLines: [lineEn, 'The client’s file is available in your console.'],
      ctaLabel: 'Open my console',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// To the notary: the client declined. The offer stays open at its price.
function propositionRefusee(ctx) {
  const p = ctx.proposition || {};
  const amount = Number.isFinite(Number(p.montant)) ? Number(p.montant) : ctx.montant;
  const line = offerLine(ctx);
  const lineEn = offerLineEn(ctx);
  return build({
    subjectFr: 'Proposition déclinée : ' + money(amount),
    subjectEn: 'Proposal declined: ' + moneyEn(amount),
    preheaderFr: 'L’offre reste ouverte au prix du client.',
    preheaderEn: 'The offer stays open at the client’s price.',
    fr: {
      heading: 'Le client a décliné votre proposition',
      lead: 'Votre proposition de ' + money(amount) + ' pour le ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) + ' n’a pas été acceptée.',
      bodyHtml:
        callout(line) +
        para('L’offre reste en ligne au prix du client. Vous pouvez toujours la retenir telle quelle depuis votre console.'),
      textLines: [line, 'L’offre reste en ligne au prix du client.'],
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'The client declined your proposal',
      lead: 'Your proposal of ' + moneyEn(amount) + ' for the ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) + ' was declined.',
      bodyHtml:
        callout(lineEn) +
        para('The offer stays live at the client’s price. You can still take it as is from your console.'),
      textLines: [lineEn, 'The offer stays live at the client’s price.'],
      ctaLabel: 'Open my console',
    },
    ctaUrl: linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// RETAINED-ACT CONVERSATION (chat) — the dossier thread between the client and
// the notary who holds the act. Each side is alerted when the other writes; the
// excerpt rides in a callout and the CTA opens the thread where it lives.
// =============================================================================

// A bounded excerpt of a chat message for the callout — the mail teases the
// thread, it never replaces it. esc() is applied by callout()/para().
const CHAT_EXCERPT_MAX = 300;
function chatExcerpt(texte) {
  const t = String(texte == null ? '' : texte).trim();
  return t.length > CHAT_EXCERPT_MAX ? t.slice(0, CHAT_EXCERPT_MAX - 1) + '…' : t;
}

// To the CLIENT: their notary wrote in the dossier thread. Context: the bid
// fields + `etude` (the study's name, when known) + `message` (the text).
// Un document déposé dans le fil d'un acte retenu (ADR 0032). C'est un avis
// TRANSACTIONNEL : une pièce arrivée dans un dossier en cours est un fait que
// son destinataire doit connaître pour avancer — le taire serait une publicité
// « incomplète » au sens de l'art. 68. Le nom du fichier voyage ; jamais son
// contenu, jamais un lien direct : le document se lit derrière l'authentification,
// par une autorisation brève que le serveur émet (Nota est dépositaire, jamais
// destinataire — art. 35 à 37).
function documentDuNotaire(ctx) {
  const etude = ctx.etude || null;
  // Raw: callout()/para() escape once at insertion, the text alternative wants
  // the name as typed.
  const nom = String(ctx.document || 'un document');
  return build({
    subjectFr: 'Un document de votre notaire',
    subjectEn: 'A document from your notary',
    preheaderFr: 'Il vous attend dans votre espace, avec votre dossier.',
    preheaderEn: 'It is waiting in your space, with your file.',
    fr: {
      heading: 'Votre notaire vous a transmis un document',
      lead:
        (etude ? etude + ' a joint un document' : 'Votre notaire a joint un document') +
        ' à votre ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) + '.',
      bodyHtml: callout(nom) + para('Ouvrez-le depuis votre espace : le document reste attaché à votre dossier, et il n’est accessible qu’à vous et à votre notaire.'),
      textLines: [nom, offerLine(ctx)].filter(Boolean),
      ctaLabel: 'Ouvrir mon dossier',
    },
    en: {
      heading: 'Your notary sent you a document',
      lead:
        (etude ? etude + ' attached a document' : 'Your notary attached a document') +
        ' to your ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) + '.',
      bodyHtml: callout(nom) + para('Open it from your space: the document stays attached to your file, and only you and your notary can reach it.'),
      textLines: [nom, offerLineEn(ctx)].filter(Boolean),
      ctaLabel: 'Open my file',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

function documentDuClient(ctx) {
  const nom = String(ctx.document || 'un document');
  return build({
    subjectFr: 'Un document de votre client — ' + money(ctx.montant),
    subjectEn: 'A document from your client — ' + moneyEn(ctx.montant),
    preheaderFr: 'Il est dans le fil de l’acte, avec le reste du dossier.',
    preheaderEn: 'It is in the act thread, with the rest of the file.',
    fr: {
      heading: 'Votre client a transmis un document',
      lead: 'Une pièce a été jointe à votre ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) + '.',
      bodyHtml: callout(nom) + para('Ouvrez-le depuis votre console, dans le fil de l’acte retenu.'),
      textLines: [nom, offerLine(ctx)].filter(Boolean),
      ctaLabel: 'Ouvrir la console',
    },
    en: {
      heading: 'Your client sent a document',
      lead: 'A file was attached to your ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) + '.',
      bodyHtml: callout(nom) + para('Open it from your console, in the retained act thread.'),
      textLines: [nom, offerLineEn(ctx)].filter(Boolean),
      ctaLabel: 'Open the console',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

function messageDuNotaire(ctx) {
  const etude = ctx.etude || null;
  const excerpt = chatExcerpt(ctx.message);
  return build({
    subjectFr: 'Message de votre notaire',
    subjectEn: 'A message from your notary',
    preheaderFr: 'Répondez depuis votre espace — la conversation reste au dossier.',
    preheaderEn: 'Reply from your space — the conversation stays with your file.',
    fr: {
      heading: 'Votre notaire vous a écrit',
      lead:
        (etude ? etude + ' vous a écrit' : 'Votre notaire vous a écrit') +
        ' au sujet de votre ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) + '.',
      bodyHtml:
        (excerpt ? callout('« ' + excerpt + ' »') : '') +
        para('Répondez directement depuis votre espace : la conversation reste attachée à votre dossier, avec vos documents et votre rendez-vous.'),
      textLines: [excerpt ? '« ' + excerpt + ' »' : '', offerLine(ctx)].filter(Boolean),
      ctaLabel: 'Répondre à mon notaire',
    },
    en: {
      heading: 'Your notary wrote to you',
      lead:
        (etude ? etude + ' wrote to you' : 'Your notary wrote to you') +
        ' about your ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) + '.',
      bodyHtml:
        (excerpt ? callout('“' + excerpt + '”') : '') +
        para('Reply directly from your space: the conversation stays attached to your file, with your documents and your appointment.'),
      textLines: [excerpt ? '“' + excerpt + '”' : '', offerLineEn(ctx)].filter(Boolean),
      ctaLabel: 'Reply to my notary',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// To the NOTARY: the client replied in the thread of the act they hold.
// Context: the bid fields + `message` (the text).
function messageDuClient(ctx) {
  const excerpt = chatExcerpt(ctx.message);
  return build({
    subjectFr: 'Réponse de votre client — ' + money(ctx.montant),
    subjectEn: 'Your client replied — ' + moneyEn(ctx.montant),
    preheaderFr: 'Un message est arrivé dans la conversation de l’acte.',
    preheaderEn: 'A message just landed in the act’s conversation.',
    fr: {
      heading: 'Votre client vous a répondu',
      lead:
        'Un message vient d’arriver dans la conversation de l’acte que vous avez retenu — ' +
        svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + '.',
      bodyHtml:
        (excerpt ? callout('« ' + excerpt + ' »') : '') +
        para('Répondez depuis votre console : le fil complet reste attaché à l’acte, à côté du dossier du client.'),
      textLines: [excerpt ? '« ' + excerpt + ' »' : '', offerLine(ctx)].filter(Boolean),
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'Your client replied',
      lead:
        'A message just arrived in the conversation of the act you hold — ' +
        svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) + '.',
      bodyHtml:
        (excerpt ? callout('“' + excerpt + '”') : '') +
        para('Reply from your console: the whole thread stays attached to the act, next to the client’s file.'),
      textLines: [excerpt ? '“' + excerpt + '”' : '', offerLineEn(ctx)].filter(Boolean),
      ctaLabel: 'Open my console',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// PARTNER REFERRALS (ADR 0011) — the professionals (agent immobilier, courtier
// hypothécaire) who send Nota its demand. Two reward tracks, both flat amounts
// that live in domain.REFERRAL — never a literal here: `client` when a referred
// demand is RETAINED, `notaire` once when a referred notary retains their
// first act. Kept deliberately lean (owner: "only relevant information").
// =============================================================================

// The partner-type labels come from the domain's own partner list.
function partnerTypeNom(id) {
  const p = domain.REFERRAL.partners.find((x) => x.id === id);
  return p ? p.nom : '';
}
function partnerTypeNomEn(id) {
  const p = domain.REFERRAL.partners.find((x) => x.id === id);
  return p ? p.nomEn : '';
}
// The shareable attribution link a partner puts in front of clients.
function refLink(baseUrl, code) {
  return linksFor(baseUrl).carnet + '?ref=' + String(code || '');
}

// Context: { code, type } — right after POST /partenaires. The whole pitch in
// one screen: the link to share, and what each track pays, when.
function partnerWelcome(ctx) {
  const code = ctx.code || '—';
  const link = refLink(ctx.baseUrl, ctx.code);
  const rewards =
    money(domain.REFERRAL.client) + ' par demande référée retenue par un notaire · ' +
    money(domain.REFERRAL.notaire) + ' quand un notaire référé retient son premier acte';
  const rewardsEn =
    moneyEn(domain.REFERRAL.client) + ' per referred request taken by a notary · ' +
    moneyEn(domain.REFERRAL.notaire) + ' when a referred notary takes their first act';
  return build({
    subjectFr: 'Votre code partenaire est prêt : ' + code,
    subjectEn: 'Your partner code is ready: ' + code,
    preheaderFr: 'Partagez votre lien — chaque référence retenue vous est créditée.',
    preheaderEn: 'Share your link — every retained referral is credited to you.',
    fr: {
      heading: 'Bienvenue parmi les partenaires Nota',
      lead:
        'Votre code ' + code +
        (partnerTypeNom(ctx.type) ? ' (' + partnerTypeNom(ctx.type) + ')' : '') +
        ' est enregistré. Partagez ce lien avec vos clients :',
      bodyHtml:
        callout(link) +
        para(rewards + '. Le montant du client et les honoraires du notaire ne changent jamais — la récompense vient de Nota.'),
      textLines: [link, rewards],
      ctaLabel: 'Ouvrir mon lien',
    },
    en: {
      heading: 'Welcome to the Nota partner program',
      lead:
        'Your code ' + code +
        (partnerTypeNomEn(ctx.type) ? ' (' + partnerTypeNomEn(ctx.type) + ')' : '') +
        ' is registered. Share this link with your clients:',
      bodyHtml:
        callout(link) +
        para(rewardsEn + '. The client’s amount and the notary’s fee never change — the reward comes from Nota.'),
      textLines: [link, rewardsEn],
      ctaLabel: 'Open my link',
    },
    ctaUrl: link,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Context: { code, link, ttlMinutes } — right after POST /partenaires. Claiming
// a code is now email-verified: the claim is only PENDING until the recipient
// opens this single-use link, so the code cannot be squatted by someone who does
// not control the address. Single CTA per language = the confirmation link.
function partnerClaimLink(ctx) {
  const code = ctx.code || '—';
  const ttl = ctx.ttlMinutes || 30;
  return build({
    subjectFr: 'Confirmez votre code partenaire : ' + code,
    subjectEn: 'Confirm your partner code: ' + code,
    preheaderFr: 'Lien à usage unique, valide ' + ttl + ' minutes.',
    preheaderEn: 'Single-use link, valid for ' + ttl + ' minutes.',
    fr: {
      heading: 'Confirmez votre code partenaire',
      lead:
        'Une réservation du code ' + code +
        ' a été faite avec ce courriel. Confirmez-la pour l’activer :',
      bodyHtml: para(
        'Ce lien est valide ' +
          ttl +
          ' minutes et à usage unique. Votre code reste inactif tant qu’il n’est pas confirmé. Si vous n’avez pas fait cette réclamation, ignorez ce courriel — personne ne peut activer le code sans ce lien.'
      ),
      textLines: ['Confirmez le code ' + code + ' — lien à usage unique, valide ' + ttl + ' minutes.'],
      ctaLabel: 'Confirmer mon code',
    },
    en: {
      heading: 'Confirm your partner code',
      lead:
        'A claim on the code ' + code +
        ' was made with this email. Confirm it to activate the code:',
      bodyHtml: para(
        'This link is valid for ' +
          ttl +
          ' minutes and can be used only once. Your code stays inactive until it is confirmed. If you did not make this claim, ignore this email — no one can activate the code without this link.'
      ),
      textLines: ['Confirm the code ' + code + ' — single-use link, valid for ' + ttl + ' minutes.'],
      ctaLabel: 'Confirm my code',
    },
    ctaUrl: ctx.link || linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Context: the referred bid's fields (+ `code`) — a demand the partner referred
// was just RETAINED, the moment their client reward is earned.
function referralRewardClient(ctx) {
  const amount = domain.REFERRAL.client;
  return build({
    subjectFr: money(amount) + ' gagnés — demande référée retenue',
    subjectEn: moneyEn(amount) + ' earned — referred request taken',
    preheaderFr: 'Une demande envoyée avec votre code vient d’être retenue par un notaire.',
    preheaderEn: 'A request sent with your code was just taken by a notary.',
    fr: {
      heading: 'Votre référence a été retenue',
      lead: 'Une demande envoyée avec votre code' + (ctx.code ? ' ' + ctx.code : '') + ' vient d’être retenue par un notaire.',
      // Acquise à la rétention, VERSÉE à la signature (décision du 2026-09-04) :
      // une demande retenue puis annulée ne se paie pas — sans mécanisme de
      // reprise, seul le moment du versement ferme cette porte.
      bodyHtml:
        callout(money(amount) + ' vous sont acquis — ' + offerLine(ctx)) +
        para('Le montant vous est versé une fois l’acte signé. Une demande annulée avant la signature ne donne lieu à aucun versement.'),
      textLines: [money(amount) + ' acquis · ' + offerLine(ctx), 'Versé une fois l’acte signé — une demande annulée avant la signature ne donne lieu à aucun versement.'],
      ctaLabel: 'Voir le carnet',
    },
    en: {
      heading: 'Your referral was taken',
      lead: 'A request sent with your code' + (ctx.code ? ' ' + ctx.code : '') + ' was just taken by a notary.',
      bodyHtml:
        callout(moneyEn(amount) + ' is earned — ' + offerLineEn(ctx)) +
        para('The amount is paid once the act is signed. A request cancelled before signing pays nothing.'),
      textLines: [moneyEn(amount) + ' earned · ' + offerLineEn(ctx), 'Paid once the act is signed — a request cancelled before signing pays nothing.'],
      ctaLabel: 'View the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Context: { code } — the notary this partner referred just retained their
// FIRST act. Paid once per notary, by ledger design.
function referralRewardNotary(ctx) {
  const amount = domain.REFERRAL.notaire;
  return build({
    subjectFr: money(amount) + ' gagnés — notaire référé actif',
    subjectEn: moneyEn(amount) + ' earned — referred notary active',
    preheaderFr: 'Le notaire que vous avez référé vient de retenir son premier acte.',
    preheaderEn: 'The notary you referred just took their first act.',
    fr: {
      heading: 'Votre notaire référé est actif',
      lead: 'Un notaire inscrit avec votre code' + (ctx.code ? ' ' + ctx.code : '') + ' vient de retenir son premier acte sur Nota.',
      bodyHtml: callout(money(amount) + ' vous sont crédités — une seule fois par notaire référé.'),
      textLines: [money(amount) + ' crédités — une seule fois par notaire référé.'],
      ctaLabel: 'Voir le carnet',
    },
    en: {
      heading: 'Your referred notary is active',
      lead: 'A notary who signed up with your code' + (ctx.code ? ' ' + ctx.code : '') + ' just took their first act on Nota.',
      bodyHtml: callout(moneyEn(amount) + ' is credited to you — once per referred notary.'),
      textLines: [moneyEn(amount) + ' credited — once per referred notary.'],
      ctaLabel: 'View the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Operator alert mirroring operatorNewLead: a partner just claimed a code.
function operatorNewPartner(ctx) {
  const line =
    (ctx.code || '—') +
    (partnerTypeNom(ctx.type) ? ' · ' + partnerTypeNom(ctx.type) : '') +
    ' · ' + (ctx.courriel || '—');
  const lineEn =
    (ctx.code || '—') +
    (partnerTypeNomEn(ctx.type) ? ' · ' + partnerTypeNomEn(ctx.type) : '') +
    ' · ' + (ctx.courriel || '—');
  return build({
    subjectFr: 'Nouveau partenaire : ' + (ctx.code || '—'),
    subjectEn: 'New partner: ' + (ctx.code || '—'),
    preheaderFr: 'Un professionnel vient de réserver son code de référence.',
    preheaderEn: 'A professional just claimed their referral code.',
    fr: {
      heading: 'Nouveau partenaire inscrit',
      lead: 'Un professionnel vient de réserver son code de référence sur Nota.',
      bodyHtml: callout(line),
      textLines: [line],
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'New partner registered',
      lead: 'A professional just claimed their referral code on Nota.',
      bodyHtml: callout(lineEn),
      textLines: [lineEn],
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// Cancellation (a client withdraws their offer)
// =============================================================================

// Acknowledgement to the client — their own withdrawal, so the tone is
// confirmation, not bad news; the CTA invites a fresh date. What the
// cancellation kept is stated plainly (ADR 0023 / ADR 0033): the fee, its
// rate, and that it goes to the notary as compensation — or that it was free.
// Context: bid fields + `annulation` { taux, frais, joursAvant } | null.
function offerCancelled(ctx) {
  const a = ctx.annulation || null;
  const frais = a && Number(a.frais) > 0 ? Number(a.frais) : 0;
  const argent = frais
    ? 'Des frais d’annulation de ' + money(frais) + ' (' + pct(a.taux) + ' du montant) sont retenus sur votre carte et versés au notaire en dédommagement du rendez-vous libéré ; le reste de la réservation est libéré.'
    : 'Votre annulation est sans frais : rien n’est débité, et la réservation sur votre carte est libérée.';
  const argentEn = frais
    ? 'A cancellation fee of ' + moneyEn(frais) + ' (' + pctEn(a.taux) + ' of the amount) is kept on your card and transferred to the notary as compensation for the freed appointment; the rest of the reservation is released.'
    : 'Your cancellation carries no fee: nothing is charged, and the reservation on your card is released.';
  return build({
    subjectFr: 'Offre annulée : ' + money(ctx.montant),
    subjectEn: 'Offer cancelled: ' + moneyEn(ctx.montant),
    preheaderFr: frais ? 'Votre offre est retirée ; ' + money(frais) + ' de frais sont retenus.' : 'Votre offre est retirée du carnet, sans frais.',
    preheaderEn: frais ? 'Your offer is withdrawn; a ' + moneyEn(frais) + ' fee is kept.' : 'Your offer was removed from the carnet, no fee.',
    fr: {
      heading: 'Votre offre est annulée',
      lead: 'Votre offre — ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ' — a été retirée du carnet.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(argent) +
        para('Plus aucun notaire ne peut la retenir et votre dossier n’est plus partagé. Si vous changez d’avis, publiez une nouvelle date en quelques gestes.'),
      textLines: [offerLine(ctx), argent, 'Plus aucun notaire ne peut la retenir.'],
      ctaLabel: 'Choisir une nouvelle date',
    },
    en: {
      heading: 'Your offer is cancelled',
      lead: 'Your offer — ' + svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) + ' — was removed from the carnet.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(argentEn) +
        para('No notary can take it anymore and your file is no longer shared. If you change your mind, publish a new date in a few taps.'),
      textLines: [offerLineEn(ctx), argentEn, 'No notary can take it anymore.'],
      ctaLabel: 'Pick a new date',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// To the notary whose retained demand was just withdrawn — a mise en relation
// is being unwound, so this must land fast and say exactly which one, and
// exactly what they receive (ADR 0033 §money): the fee is THEIR compensation,
// transferred whole to their connected account — or owed to them until their
// Stripe payouts are wired. Never a vague promise that « the team will
// write ». Context: bid fields + `annulation` { taux, frais, dedommagement:
// { notaire, verse, transferId } } | null.
function offerCancelledNotary(ctx) {
  const a = ctx.annulation || null;
  const frais = a && Number(a.frais) > 0 ? Number(a.frais) : 0;
  const verse = !!(a && a.dedommagement && a.dedommagement.verse);
  const argent = !frais
    ? 'Le client a annulé dans la fenêtre gratuite du barème : aucuns frais ne vous sont dus.'
    : verse
      ? 'En dédommagement, ' + money(frais) + ' (' + pct(a.taux) + ' du montant) vous sont versés : le virement vers votre compte Stripe est en route.'
      : money(frais) + ' (' + pct(a.taux) + ' du montant) vous sont dus en dédommagement. Ils vous seront versés dès que vos versements Stripe seront branchés.';
  const argentEn = !frais
    ? 'The client cancelled within the barème’s free window: no fee is due to you.'
    : verse
      ? 'As compensation, ' + moneyEn(frais) + ' (' + pctEn(a.taux) + ' of the amount) is transferred to you: the transfer to your Stripe account is on its way.'
      : moneyEn(frais) + ' (' + pctEn(a.taux) + ' of the amount) is owed to you as compensation. It will be transferred as soon as your Stripe payouts are connected.';
  return build({
    subjectFr: 'Demande annulée par le client : ' + money(ctx.montant),
    subjectEn: 'Client cancelled: ' + moneyEn(ctx.montant),
    preheaderFr: frais ? money(frais) + ' vous reviennent en dédommagement.' : 'La demande que vous aviez retenue vient d’être retirée.',
    preheaderEn: frais ? moneyEn(frais) + ' comes to you as compensation.' : 'The request you had taken was just withdrawn.',
    fr: {
      heading: 'Le client a annulé sa demande',
      lead: 'La demande que vous aviez retenue — ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ' — vient d’être annulée par le client.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(argent) +
        para('Le rendez-vous est libéré dans votre agenda, et la conversation de cet acte est close.'),
      textLines: [offerLine(ctx), argent, 'Le rendez-vous est libéré dans votre agenda.'],
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'The client cancelled their request',
      lead: 'The request you had taken — ' + svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) + ' — was just cancelled by the client.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(argentEn) +
        para('The appointment is freed up in your calendar, and this act’s conversation is closed.'),
      textLines: [offerLineEn(ctx), argentEn, 'The appointment is freed up in your calendar.'],
      ctaLabel: 'Open my console',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Operator alert: a RETAINED demand was withdrawn — money may be in flight
// (hold, capture, payout), so a human checks the ledger.
function operatorOfferCancelled(ctx) {
  const line = offerLine(ctx) + (ctx.etude ? ' · ' + ctx.etude : '');
  const lineEn = offerLineEn(ctx) + (ctx.etude ? ' · ' + ctx.etude : '');
  return build({
    subjectFr: 'Annulation d’une demande retenue : ' + money(ctx.montant),
    subjectEn: 'Retained request cancelled',
    preheaderFr: 'Vérifier le paiement et la mise en relation.',
    preheaderEn: 'Check the payment and the match.',
    fr: {
      heading: 'Demande retenue annulée',
      lead: 'Un client vient d’annuler une demande déjà retenue. Vérifier le paiement (autorisation, capture, virement) et prévenir les parties au besoin.',
      bodyHtml: callout(line),
      textLines: [line],
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'Retained request cancelled',
      lead: 'A client just cancelled a request that was already taken. Check the payment (authorization, capture, transfer) and follow up with the parties as needed.',
      bodyHtml: callout(lineEn),
      textLines: [lineEn],
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// To the client whose retained act was just RELEASED by the notary: their
// offer is untouched and back on the carnet, so the message leads with what
// still stands (the date, the amount) before what changed.
function actReleased(ctx) {
  return build({
    subjectFr: 'Votre demande est de retour au carnet',
    subjectEn: 'Your request is back on the carnet',
    preheaderFr: 'Le notaire s’est désisté — votre offre reste publiée telle quelle.',
    preheaderEn: 'The notary withdrew — your offer stays published as is.',
    fr: {
      heading: 'Le notaire s’est désisté',
      lead: 'Le notaire qui avait retenu votre demande — ' + svcNom(ctx.serviceId) + ' le ' + fmtDate(ctx.dateISO) + ' — s’est désisté. Certains dossiers ne conviennent pas à toutes les études (prêteur inhabituel, conflit d’intérêts).',
      bodyHtml:
        callout(offerLine(ctx)) +
        para('Votre offre est de retour au carnet, telle que vous l’aviez publiée : même date, même montant. Les autres notaires la voient déjà et peuvent la retenir. Vous n’avez rien à refaire.'),
      textLines: [offerLine(ctx), 'Votre offre est de retour au carnet, telle que publiée.'],
      ctaLabel: 'Suivre mon offre',
    },
    en: {
      heading: 'The notary withdrew',
      lead: 'The notary who had taken your request — ' + svcNomEn(ctx.serviceId) + ' on ' + fmtDateEn(ctx.dateISO) + ' — has withdrawn. Some files do not suit every practice (an unusual lender, a conflict of interest).',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para('Your offer is back on the carnet exactly as you published it: same date, same amount. Other notaries can already see and take it. Nothing to redo on your side.'),
      textLines: [offerLineEn(ctx), 'Your offer is back on the carnet as published.'],
      ctaLabel: 'Track my offer',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Operator alert: a notary withdrew from a RETAINED act. Sent when money may
// be in flight (hold, capture, payout) or the notary left a reason a human
// should read — same posture as operatorOfferCancelled.
function operatorActReleased(ctx) {
  const line = offerLine(ctx) + (ctx.etude ? ' · ' + ctx.etude : '') + (ctx.notaireEmail ? ' · ' + ctx.notaireEmail : '');
  const lineEn = offerLineEn(ctx) + (ctx.etude ? ' · ' + ctx.etude : '') + (ctx.notaireEmail ? ' · ' + ctx.notaireEmail : '');
  return build({
    subjectFr: 'Désistement d’un notaire : ' + money(ctx.montant) + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'Notary withdrew',
    preheaderFr: 'Vérifier le paiement et la remise au carnet.',
    preheaderEn: 'Check the payment and the return to the carnet.',
    fr: {
      heading: 'Désistement sur une demande retenue',
      lead: (ctx.paidOrHeld
        ? 'Un paiement peut être engagé (autorisation, capture, virement) — vérifier le registre et régulariser au besoin. '
        : '') + 'La demande est remise au carnet ; le client est prévenu.',
      bodyHtml: callout(line) + (ctx.messageNotaire ? para('Motif du notaire : ' + ctx.messageNotaire) : ''),
      textLines: [line].concat(ctx.messageNotaire ? ['Motif du notaire : ' + ctx.messageNotaire] : []),
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'Withdrawal from a retained request',
      lead: (ctx.paidOrHeld
        ? 'A payment may be in flight (authorization, capture, transfer) — check the ledger and settle as needed. '
        : '') + 'The request is back on the carnet; the client has been notified.',
      bodyHtml: callout(lineEn) + (ctx.messageNotaire ? para('Notary’s reason: ' + ctx.messageNotaire) : ''),
      textLines: [lineEn].concat(ctx.messageNotaire ? ['Notary’s reason: ' + ctx.messageNotaire] : []),
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The act is signed and settled: invite the client to evaluate their notary
// (ADR 0015 — evaluation is the step after payment). CTA lands on « Mes
// offres », where the stars live.
//
// ADR 0031 — la cote sur 100 survit, mais elle ne décide plus d'un dollar. Dire
// au client que son évaluation entre « dans la part que le notaire garde »
// décrirait un partage d'honoraires que l'art. 32 du Code de déontologie
// interdit et que le code ne calcule plus. Le courriel dit donc ce que
// l'évaluation fait vraiment : elle atteint le notaire, elle nourrit sa cote,
// et elle n'est publiée nulle part (art. 70).
function evaluationInvite(ctx) {
  return build({
    subjectFr: 'Acte signé — évaluez votre notaire',
    subjectEn: 'Act signed — rate your notary',
    preheaderFr: 'Deux gestes : une note de 1 à 5, un mot si vous voulez.',
    preheaderEn: 'Two taps: a 1-to-5 rating, a word if you like.',
    fr: {
      heading: 'Votre acte est signé',
      lead: 'Votre ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) + ' est conclu. Merci d’avoir utilisé Nota.',
      bodyHtml: para(
        'Un dernier geste, qui compte : évaluez votre notaire — une note de 1 à 5, et un commentaire si vous le souhaitez. Elle lui est transmise et entre dans sa cote sur 100, qu’il consulte dans sa console. Elle n’est publiée nulle part : le Code de déontologie interdit qu’un témoignage concernant un notaire soit utilisé publiquement.'
      ),
      textLines: [offerLine(ctx), 'Évaluez votre notaire : une note de 1 à 5, un commentaire si vous voulez.'],
      ctaLabel: 'Évaluer mon notaire',
    },
    en: {
      heading: 'Your act is signed',
      lead: 'Your ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) + ' is done. Thank you for using Nota.',
      bodyHtml: para(
        'One last gesture, and it matters: rate your notary — 1 to 5, with a comment if you like. It reaches them and feeds their cote out of 100, which they read in their console. It is published nowhere: the Code de déontologie forbids a testimonial concerning a notary from being used publicly.'
      ),
      textLines: [offerLineEn(ctx), 'Rate your notary: 1 to 5, with a comment if you like.'],
      ctaLabel: 'Rate my notary',
    },
    ctaUrl: clientActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// To the NOTARY: a client just rated them (ADR 0015/0016). Context: the bid
// fields + `note` (1-5) + optional `commentaire`. The note may be absent in
// generic renders; the copy degrades to the fact without the number.
//
// ADR 0030 — cette évaluation n'est PAS publiée auprès des clients : l'art. 70
// du Code de déontologie interdit au notaire de permettre qu'un témoignage
// d'appui le concernant soit utilisé. Elle nourrit sa cote et son propre
// dossier. Le courriel doit le dire tel quel : promettre une « moyenne
// publique » à un notaire, c'est lui promettre un manquement.
//
// ADR 0031 — et la cote ne touche plus à un dollar. L'art. 29.1 interdit au
// notaire toute convention mettant en péril son indépendance ; un revenu indexé
// sur une note attribuée par Nota en était une. Le courriel le dit dans l'autre
// sens, celui qui rassure : le montant offert lui revient en entier.
function evaluationRecueNotaire(ctx) {
  const note = Number.isFinite(Number(ctx.note)) ? Number(ctx.note) : null;
  const comment = ctx.commentaire ? chatExcerpt(ctx.commentaire) : null;
  const line = (note != null ? 'Note : ' + note + '/5 — ' : '') + offerLine(ctx);
  const lineEn = (note != null ? 'Rating: ' + note + '/5 — ' : '') + offerLineEn(ctx);
  return build({
    subjectFr: 'Vous avez reçu une évaluation' + (note != null ? ' : ' + note + '/5' : ''),
    subjectEn: 'You received a rating' + (note != null ? ': ' + note + '/5' : ''),
    preheaderFr: 'Elle nourrit votre cote — et reste entre vous et Nota.',
    preheaderEn: 'It feeds your cote — and stays between you and Nota.',
    fr: {
      heading: 'Un client vous a évalué',
      lead:
        'Le client de votre ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) +
        ' vient de déposer son évaluation.',
      bodyHtml:
        callout(line) +
        (comment ? para('Commentaire du client : « ' + comment + ' »') : '') +
        para('Elle entre dans votre cote sur 100. Cette cote ne touche pas à votre rémunération : le montant offert vous revient en entier, sur cet acte comme sur les suivants. Elle n’est montrée à aucun client : le Code de déontologie interdit qu’un témoignage vous concernant soit utilisé publiquement. Votre moyenne et chaque commentaire restent lisibles dans votre console.'),
      textLines: [line].concat(comment ? ['Commentaire : « ' + comment + ' »'] : []),
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'A client rated you',
      lead:
        'The client of your ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) +
        ' just submitted their evaluation.',
      bodyHtml:
        callout(lineEn) +
        (comment ? para('Client’s comment: “' + comment + '”') : '') +
        para('It feeds your cote out of 100. That cote does not touch your pay: the amount offered comes to you in full, on this act as on the next ones. It is shown to no client: the Code de déontologie forbids a testimonial concerning you from being used publicly. Your average and every comment stay readable in your console.'),
      textLines: [lineEn].concat(comment ? ['Comment: “' + comment + '”'] : []),
      ctaLabel: 'Open my console',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Operator alert: a LOW rating (note <= 2) landed — a churn/moderation signal a
// human should follow up on. Context: the bid fields + `note` + optional
// `commentaire` + `notaireEmail`.
function operatorLowRating(ctx) {
  const note = Number.isFinite(Number(ctx.note)) ? Number(ctx.note) : null;
  const comment = ctx.commentaire ? chatExcerpt(ctx.commentaire) : null;
  const line =
    (note != null ? note + '/5 · ' : '') + offerLine(ctx) + (ctx.notaireEmail ? ' · ' + ctx.notaireEmail : '');
  const lineEn =
    (note != null ? note + '/5 · ' : '') + offerLineEn(ctx) + (ctx.notaireEmail ? ' · ' + ctx.notaireEmail : '');
  return build({
    subjectFr: 'Évaluation faible' + (note != null ? ' : ' + note + '/5' : '') + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'Low rating' + (note != null ? ': ' + note + '/5' : '') + ' · ' + svcNomCourtEn(ctx.serviceId),
    preheaderFr: 'Un suivi humain est recommandé auprès du client et du notaire.',
    preheaderEn: 'A human follow-up with the client and the notary is recommended.',
    fr: {
      heading: 'Une évaluation faible vient d’arriver',
      lead: 'Un client vient de noter son notaire sous la barre — à lire et à suivre (rétention, modération).',
      bodyHtml: callout(line) + (comment ? para('Commentaire du client : « ' + comment + ' »') : ''),
      textLines: [line].concat(comment ? ['Commentaire : « ' + comment + ' »'] : []),
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'A low rating just landed',
      lead: 'A client just rated their notary below the bar — read it and follow up (retention, moderation).',
      bodyHtml: callout(lineEn) + (comment ? para('Client’s comment: “' + comment + '”') : ''),
      textLines: [lineEn].concat(comment ? ['Comment: “' + comment + '”'] : []),
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// Contact form (nous joindre)
// =============================================================================

// Acknowledgement to the sender: their message is in human hands.
function contactRecu(ctx) {
  return build({
    subjectFr: 'Message bien reçu',
    subjectEn: 'Message received',
    preheaderFr: 'Une personne de l’équipe Nota vous répond rapidement.',
    preheaderEn: 'Someone from the Nota team will get back to you shortly.',
    fr: {
      heading: 'Nous avons bien reçu votre message',
      lead: (ctx.nom ? ctx.nom + ', merci' : 'Merci') + ' de nous avoir écrit. Une personne de l’équipe vous répond à cette adresse, normalement le jour même.',
      bodyHtml: ctx.message ? callout(ctx.message) : para('Votre message est entre les mains de l’équipe.'),
      textLines: [ctx.message || 'Votre message est entre les mains de l’équipe.'],
      ctaLabel: 'Retourner sur Nota',
    },
    en: {
      heading: 'We received your message',
      lead: (ctx.nom ? ctx.nom + ', thank you' : 'Thank you') + ' for writing to us. Someone from the team will reply to this address, normally the same day.',
      bodyHtml: ctx.message ? callout(ctx.message) : para('Your message is in the team’s hands.'),
      textLines: [ctx.message || 'Your message is in the team’s hands.'],
      ctaLabel: 'Return to Nota',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The message itself, to the operator — reply-to is in the body on purpose so
// a forward keeps the whole context.
function operatorContactMessage(ctx) {
  const who = (ctx.nom ? ctx.nom + ' · ' : '') + (ctx.email || ctx.courriel || '—');
  const line = who + (ctx.sujet ? ' · ' + ctx.sujet : '');
  const bodyFr =
    callout(line) +
    (ctx.message ? para(ctx.message) : '') +
    (ctx.bidId ? para('Offre liée : ' + ctx.bidId) : '');
  const bodyEn =
    callout(line) +
    (ctx.message ? para(ctx.message) : '') +
    (ctx.bidId ? para('Linked offer: ' + ctx.bidId) : '');
  const textLinesFr = [line, ctx.message || ''].concat(ctx.bidId ? ['Offre liée : ' + ctx.bidId] : []);
  const textLinesEn = [line, ctx.message || ''].concat(ctx.bidId ? ['Linked offer: ' + ctx.bidId] : []);
  return build({
    // The sujet is user-supplied (up to 150 chars): keep it on the FR side,
    // trimmed, and keep the EN side fixed so the combined subject fits an
    // inbox line (15 + 45 + 3 + 12 = 75).
    subjectFr: 'Nous joindre : ' + String(ctx.sujet || 'nouveau message').slice(0, 45),
    subjectEn: 'Contact form',
    preheaderFr: 'Un message vient d’arriver par le formulaire.',
    preheaderEn: 'A message just arrived through the form.',
    fr: {
      heading: 'Nouveau message via le formulaire',
      lead: 'Répondre directement au courriel indiqué ci-dessous.',
      bodyHtml: bodyFr,
      textLines: textLinesFr,
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'New message via the form',
      lead: 'Reply directly to the email address below.',
      bodyHtml: bodyEn,
      textLines: textLinesEn,
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// A visitor's live-chat question, to the operator (ADR 0026). The CTA is the
// signed reply link: one tap from the inbox opens the on-site reply box, and
// the visitor sees the answer live in their widget.
function operatorSupportMessage(ctx) {
  const who = ctx.courriel || 'Visiteur (sans courriel)';
  const bodyFr = callout(who) + (ctx.texte ? para(ctx.texte) : '');
  const bodyEn = callout(who) + (ctx.texte ? para(ctx.texte) : '');
  return build({
    subjectFr: 'Messagerie : nouvelle question',
    subjectEn: 'Live chat: new question',
    preheaderFr: 'Un visiteur vient de vous écrire sur le site.',
    preheaderEn: 'A visitor just wrote to you on the site.',
    fr: {
      heading: 'Nouvelle question sur le site',
      lead: 'Répondez d’un geste — le visiteur voit votre réponse en direct dans la messagerie du site.',
      bodyHtml: bodyFr,
      textLines: [who, ctx.texte || ''],
      ctaLabel: 'Répondre',
    },
    en: {
      heading: 'New question on the site',
      lead: 'Reply in one tap — the visitor sees your answer live in the site’s chat.',
      bodyHtml: bodyEn,
      textLines: [who, ctx.texte || ''],
      ctaLabel: 'Reply',
    },
    ctaUrl: ctx.replyUrl || operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The operator's reply, forwarded to a visitor who left a courriel — the
// widget already shows it live; this is the offline copy (ADR 0026).
function supportReponse(ctx) {
  const bodyFr = ctx.texte ? para(ctx.texte) : '';
  return build({
    subjectFr: 'Nota vous a répondu',
    subjectEn: 'Nota replied to you',
    preheaderFr: 'Votre question a reçu une réponse.',
    preheaderEn: 'Your question got an answer.',
    fr: {
      heading: 'Nota vous a répondu',
      lead: 'Voici la réponse à votre question — la conversation continue dans la messagerie du site.',
      bodyHtml: bodyFr,
      textLines: [ctx.texte || ''],
      ctaLabel: 'Ouvrir la conversation',
    },
    en: {
      heading: 'Nota replied to you',
      lead: 'Here is the answer to your question — the conversation continues in the site’s chat.',
      bodyHtml: bodyFr,
      textLines: [ctx.texte || ''],
      ctaLabel: 'Open the conversation',
    },
    ctaUrl: ctx.chatUrl || linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// ADR 0033 — la mise en relation est complète, et la conversation est le canal
// =============================================================================

// To the RETAINING notary, on the accept path (until now only the client was
// mailed): the act, the client block they may now reach — name, courriel,
// phone (dialable), sector, travel band, lender — whether the file is ready,
// and « ce qui vous engage » : signing on the date, honoraires paid in full at
// the signing (Nota bills its own price to the client, beside), the barème
// whose fee is THEIR compensation if the client cancels late, and the right to
// withdraw (free, but counted on their record). Context: bid fields + `client`
// { nom, courriel, telephone, secteur, deplacement, preteur, preteurNom } +
// `dossier` { ready, missing, requis } + `bareme` [{ maxJours, taux, frais }].
function demandeRetenueNotaire(ctx) {
  const c = ctx.client || {};
  const d = ctx.dossier || {};
  const rows = [
    { label: 'Client', value: c.nom },
    { label: 'Courriel', value: c.courriel, href: c.courriel ? 'mailto:' + c.courriel : null },
    { label: 'Téléphone', value: c.telephone, href: telHref(c.telephone) },
    { label: 'Secteur', value: c.secteur },
    { label: 'Déplacement', value: deplacementNom(c.deplacement) },
    { label: 'Prêteur', value: lenderNom(c) },
  ];
  const rowsEn = [
    { label: 'Client', value: c.nom },
    { label: 'Email', value: c.courriel, href: c.courriel ? 'mailto:' + c.courriel : null },
    { label: 'Phone', value: c.telephone, href: telHref(c.telephone) },
    { label: 'Sector', value: c.secteur },
    { label: 'Travel', value: deplacementNom(c.deplacement) },
    { label: 'Lender', value: lenderNom(c) },
  ];
  const manque = [].concat(Array.isArray(d.requis) ? d.requis : [], Array.isArray(d.missing) ? d.missing : []);
  const dossier = d.ready
    ? 'Dossier prêt : les pièces et le consentement de partage sont réunis.'
    : 'Dossier incomplet — il manque : ' + (manque.length ? manque.join(', ') : 'des éléments') + '. Demandez-les au client dans la conversation.';
  const dossierEn = d.ready
    ? 'File ready: the documents and the sharing consent are in.'
    : 'File incomplete — missing: ' + (manque.length ? manque.join(', ') : 'some items') + '. Ask the client for them in the conversation.';
  const engage = [
    'Signer le ' + fmtDate(ctx.dateISO) + ' — le rendez-vous est dans votre agenda Nota.',
    'Vos honoraires : ' + money(ctx.montant) + ', versés en entier à la signature. Nota facture son propre prix au client, à côté.',
    'Si le client annule, une part du montant vous est versée en dédommagement : ' + baremeLines(ctx.bareme, 'fr').join(' ; ') + '.',
    'Vous pouvez vous désister — c’est gratuit, mais compté à votre dossier ; le client garde sa date et son offre.',
  ];
  const engageEn = [
    'Sign on ' + fmtDateEn(ctx.dateISO) + ' — the appointment is in your Nota calendar.',
    'Your fees: ' + moneyEn(ctx.montant) + ', paid in full at the signing. Nota bills the client its own price, beside.',
    'If the client cancels, a share of the amount is transferred to you as compensation: ' + baremeLines(ctx.bareme, 'en').join('; ') + '.',
    'You may withdraw — it is free, but counted on your record; the client keeps their date and their offer.',
  ];
  const contactIntro = 'Le client reçoit votre nom, votre téléphone, votre adresse et votre courriel ; voici les siens. Vous vous parlez dans la conversation de l’acte, sur Nota.';
  const contactIntroEn = 'The client receives your name, phone, address and email; here are theirs. You talk in the act’s conversation, on Nota.';
  return build({
    subjectFr: 'Demande retenue : ' + money(ctx.montant) + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'Request taken: ' + moneyEn(ctx.montant),
    preheaderFr: 'Voici votre client, et ce qui vous engage.',
    preheaderEn: 'Here is your client, and what binds you.',
    fr: {
      heading: 'Vous avez retenu une demande',
      lead: 'Le ' + svcNom(ctx.serviceId) + ' du ' + fmtDate(ctx.dateISO) + ' est à vous.',
      bodyHtml:
        callout(offerLine(ctx)) +
        para(contactIntro) +
        detailRows(rows) +
        para(dossier) +
        para('Ce qui vous engage :') +
        bullets(engage),
      textLines: [offerLine(ctx), contactIntro].concat(detailText(rows), [dossier, 'Ce qui vous engage :'], engage.map((l) => '- ' + l)),
      ctaLabel: 'Ouvrir le dossier',
    },
    en: {
      heading: 'You took a request',
      lead: 'The ' + svcNomEn(ctx.serviceId) + ' of ' + fmtDateEn(ctx.dateISO) + ' is yours.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        para(contactIntroEn) +
        detailRows(rowsEn) +
        para(dossierEn) +
        para('What binds you:') +
        bullets(engageEn),
      textLines: [offerLineEn(ctx), contactIntroEn].concat(detailText(rowsEn, 'en'), [dossierEn, 'What binds you:'], engageEn.map((l) => '- ' + l)),
      ctaLabel: 'Open the file',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The instant lead alert (ADR 0033 §7) — to a notary who asked to hear of
// every demand as it lands (`alertes.pace === 'instant'`) and can serve it:
// the act, its sector, the measured distance when both sectors are known, the
// travel band and the lender. CTA opens the console on that demand. Context:
// bid fields + `secteur`, `deplacement`, `preteur`, `preteurNom`, `distanceKm`.
function nouvelleDemande(ctx) {
  const dist = Number.isFinite(Number(ctx.distanceKm)) && ctx.distanceKm != null ? '≈ ' + Math.round(Number(ctx.distanceKm)) + ' km' : null;
  const rows = [
    { label: 'Secteur', value: ctx.secteur },
    { label: 'Distance', value: dist },
    { label: 'Déplacement', value: deplacementNom(ctx.deplacement) },
    { label: 'Prêteur', value: lenderNom(ctx) },
    { label: 'Palier', value: tierNom(ctx.tier) || null },
  ];
  const rowsEn = [
    { label: 'Sector', value: ctx.secteur },
    { label: 'Distance', value: dist },
    { label: 'Travel', value: deplacementNom(ctx.deplacement) },
    { label: 'Lender', value: lenderNom(ctx) },
    { label: 'Tier', value: tierNomEn(ctx.tier) || null },
  ];
  return build({
    subjectFr: 'Nouvelle demande : ' + money(ctx.montant) + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'New request: ' + moneyEn(ctx.montant) + ' · ' + svcNomCourtEn(ctx.serviceId),
    preheaderFr: 'Une demande que vous pouvez retenir vient d’être publiée.',
    preheaderEn: 'A request you can take was just posted.',
    fr: {
      heading: 'Une nouvelle demande vous attend',
      lead: 'Vous avez demandé à être prévenu dès qu’une demande vous correspond : la voici.',
      bodyHtml:
        callout(offerLine(ctx)) +
        detailRows(rows) +
        para('Ouvrez-la dans votre console pour la retenir telle quelle, ou proposer un autre prix. Le premier notaire qui la retient l’emporte.'),
      textLines: [offerLine(ctx)].concat(detailText(rows), ['Retenez-la depuis votre console, ou proposez un autre prix.']),
      ctaLabel: 'Voir la demande',
    },
    en: {
      heading: 'A new request is waiting for you',
      lead: 'You asked to be told as soon as a request matches you: here it is.',
      bodyHtml:
        callout(offerLineEn(ctx)) +
        detailRows(rowsEn) +
        para('Open it in your console to take it as is, or propose another price. The first notary to take it wins it.'),
      textLines: [offerLineEn(ctx)].concat(detailText(rowsEn, 'en'), ['Take it from your console, or propose another price.']),
      ctaLabel: 'See the request',
    },
    ctaUrl: notaryActeUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// Operator alert on a retention — a revenue event, kept small. Context: bid
// fields + `etude`.
function operatorDemandeRetenue(ctx) {
  const line = offerLine(ctx) + (ctx.etude ? ' · ' + ctx.etude : '');
  const lineEn = offerLineEn(ctx) + (ctx.etude ? ' · ' + ctx.etude : '');
  return build({
    subjectFr: 'Demande retenue : ' + money(ctx.montant) + ' · ' + svcNomCourt(ctx.serviceId),
    subjectEn: 'Request taken',
    preheaderFr: 'Une mise en relation vient de se faire.',
    preheaderEn: 'A match was just made.',
    fr: {
      heading: 'Une demande vient d’être retenue',
      lead: 'Un notaire vient de retenir une demande — la mise en relation est faite, les deux parties sont prévenues.',
      bodyHtml: callout(line),
      textLines: [line],
      ctaLabel: 'Ouvrir Nota',
    },
    en: {
      heading: 'A request was just taken',
      lead: 'A notary just took a request — the match is made, both parties are notified.',
      bodyHtml: callout(lineEn),
      textLines: [lineEn],
      ctaLabel: 'Open Nota',
    },
    ctaUrl: operatorUrl(ctx),
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// =============================================================================
// Free signup + operator vetting (2026-09-02)
// =============================================================================
// The notary's front door no longer goes through Stripe: they sign up with a
// professional email, the operator checks the Tableau de l'Ordre and activates
// from the admin console, and only THEN does the console open. Three
// messages, and not one of them mentions a payout account — that comes later,
// from inside the console, before a first act is marked signed.

// The signup landed; the file waits for the operator's check. An
// acknowledgement of a step the notary took (transactional).
function notaryPendingReview(ctx) {
  const who = ctx.email || '—';
  return build({
    subjectFr: 'Inscription reçue — en vérification',
    subjectEn: 'Registration received — under review',
    preheaderFr: 'Nous vérifions votre inscription au Tableau de l’Ordre ; votre accès arrive sous un jour ouvrable.',
    preheaderEn: 'We are checking your entry in the Order’s roll; your access arrives within one business day.',
    fr: {
      heading: 'Inscription reçue',
      lead: 'Merci. Nous vérifions votre inscription au Tableau de l’Ordre et vous ouvrons l’accès sous un jour ouvrable.',
      bodyHtml:
        callout('Courriel professionnel : ' + who) +
        para(
          'Dès que votre accès est ouvert, vous recevez un courriel avec votre lien de connexion. Vous verrez alors les demandes du carnet et retiendrez celles qui vous conviennent. L’inscription est gratuite et sans engagement.'
        ),
      textLines: [
        'Courriel professionnel : ' + who,
        'Nous vérifions votre inscription au Tableau de l’Ordre et vous ouvrons l’accès sous un jour ouvrable. Inscription gratuite, sans engagement.',
      ],
      ctaLabel: 'Voir le carnet',
    },
    en: {
      heading: 'Registration received',
      lead: 'Thank you. We are checking your entry in the Order’s roll and will open your access within one business day.',
      bodyHtml:
        callout('Professional email: ' + who) +
        para(
          'As soon as your access is open, you receive an email with your sign-in link. You will then see the carnet’s requests and take on those that suit you. Registration is free, with no commitment.'
        ),
      textLines: [
        'Professional email: ' + who,
        'We are checking your entry in the Order’s roll and will open your access within one business day. Free registration, no commitment.',
      ],
      ctaLabel: 'See the carnet',
    },
    ctaUrl: linksFor(ctx.baseUrl).carnet,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The operator's cue to vet: who signed up, their fiche if they gave one, and
// a CTA straight onto the admin console's Notaires screen.
function operatorNotarySignedUp(ctx) {
  const who = ctx.notaryEmail || ctx.email || '—';
  const fiche = ctx.lienCNQ || null;
  const admin = ctx.adminUrl ? String(ctx.adminUrl).replace(/\/+$/, '') + '/#/notaires' : operatorUrl(ctx);
  return build({
    subjectFr: 'Nouvelle inscription notaire : ' + who,
    subjectEn: 'Notary signup',
    preheaderFr: 'À vérifier au Tableau de l’Ordre, puis à activer depuis la console.',
    preheaderEn: 'Check the Order’s roll, then activate from the console.',
    fr: {
      heading: 'Un notaire vient de s’inscrire',
      lead: 'Vérifiez son inscription au Tableau de l’Ordre, puis activez son accès depuis la console — il attend sous un jour ouvrable.',
      bodyHtml:
        callout('Courriel : ' + who) +
        para(fiche ? 'Fiche au Tableau de l’Ordre : ' + fiche : 'Aucune fiche au Tableau de l’Ordre fournie — à retrouver dans l’annuaire de la Chambre.'),
      textLines: ['Courriel : ' + who, fiche ? 'Fiche : ' + fiche : 'Aucune fiche fournie.'],
      ctaLabel: 'Ouvrir la console',
    },
    en: {
      heading: 'A notary just signed up',
      lead: 'Check their entry in the Order’s roll, then activate their access from the console — they are waiting, within one business day.',
      bodyHtml:
        callout('Email: ' + who) +
        para(fiche ? 'Profile in the Order’s roll: ' + fiche : 'No profile in the Order’s roll provided — look them up in the Chambre’s directory.'),
      textLines: ['Email: ' + who, fiche ? 'Profile: ' + fiche : 'No profile provided.'],
      ctaLabel: 'Open the console',
    },
    ctaUrl: admin,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
}

// The operator activated the account: the console is open. The CTA is the
// console itself; sign-in is the professional email (magic link).
function notaryApproved(ctx) {
  return build({
    subjectFr: 'Votre accès Nota est ouvert',
    subjectEn: 'Your Nota access is open',
    preheaderFr: 'Connectez-vous avec votre courriel professionnel — les demandes vous attendent.',
    preheaderEn: 'Sign in with your professional email — the requests are waiting.',
    fr: {
      heading: 'Bienvenue — votre accès est ouvert',
      lead: 'Votre inscription au Tableau de l’Ordre est vérifiée. Votre console est ouverte.',
      bodyHtml:
        callout('Connectez-vous avec votre courriel professionnel' + (ctx.email ? ' : ' + ctx.email : '')) +
        para(
          'Sans mot de passe : un lien de connexion vous est envoyé à chaque visite. Vous voyez les demandes du carnet et retenez celles qui vous conviennent. Vos versements se branchent plus tard, depuis la console, seulement avant votre premier acte signé.'
        ),
      textLines: [
        'Connectez-vous avec votre courriel professionnel' + (ctx.email ? ' : ' + ctx.email : ''),
        'Sans mot de passe — un lien de connexion à chaque visite. Vos versements se branchent plus tard, avant votre premier acte signé.',
      ],
      ctaLabel: 'Ouvrir ma console',
    },
    en: {
      heading: 'Welcome — your access is open',
      lead: 'Your entry in the Order’s roll is verified. Your console is open.',
      bodyHtml:
        callout('Sign in with your professional email' + (ctx.email ? ': ' + ctx.email : '')) +
        para(
          'No password: a sign-in link is emailed to you on every visit. You see the carnet’s requests and take on those that suit you. Your payouts connect later, from the console, only before your first signed act.'
        ),
      textLines: [
        'Sign in with your professional email' + (ctx.email ? ': ' + ctx.email : ''),
        'No password — a sign-in link on every visit. Payouts connect later, before your first signed act.',
      ],
      ctaLabel: 'Open my console',
    },
    ctaUrl: ctx.consoleUrl || linksFor(ctx.baseUrl).notaires,
    unsubscribeUrl: ctx.unsubscribeUrl,
  }, ctx);
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
  offerCancelled,
  evaluationInvite,
  actReleased,
  // client — pay-on-accept lifecycle
  offerAuthorized,
  offerAuthorizationVoided,
  // client — notary actions on an open offer
  propositionRecue,
  documentsDemandes,
  // retained-act conversation (chat)
  documentDuNotaire,
  documentDuClient,
  messageDuNotaire,
  messageDuClient,
  // notary — answers to their proposition
  propositionAcceptee,
  propositionRefusee,
  offerCancelledNotary,
  // ADR 0033 — la mise en relation est complète
  demandeRetenueNotaire,
  nouvelleDemande,
  // evaluation feedback loop (ADR 0015/0016)
  evaluationRecueNotaire,
  // contact form (nous joindre)
  contactRecu,
  // notary — marketplace lifecycle
  newMatchingBids,
  notaryMagicLink,
  notaryOnboardingStarted,
  notaryActive,
  actPaidNotary,
  notaryDisconnectedWinback,
  // admin console
  adminMagicLink,
  // partner referrals (ADR 0011)
  partnerClaimLink,
  partnerWelcome,
  referralRewardClient,
  referralRewardNotary,
  // operator alerts
  operatorNotaryActive,
  operatorNewLead,
  operatorActCompleted,
  operatorNewPartner,
  operatorOfferCancelled,
  operatorActReleased,
  operatorContactMessage,
  operatorLowRating,
  operatorDemandeRetenue,
  // live support messaging (ADR 0026)
  operatorSupportMessage,
  supportReponse,
  // free signup + operator vetting (2026-09-02)
  notaryPendingReview,
  operatorNotarySignedUp,
  notaryApproved,
};

// =============================================================================
// Admin-parametrizable templates (consumption side)
// =============================================================================
// The admin console can store, per template key, an override record:
//   { key, actif, subjectFr/En, preheaderFr/En, corpsFr/En, ctaFr/En, updatedAt }
// (`enabled` is the older name of `actif`; both are honoured on read.)
// TEMPLATE_META describes every registry key for that console: who receives it,
// a human label per language, the DEFAULT subject shown with {{token}}
// placeholders, exactly which tokens that template's ctx can interpolate, and
// whether it is TRANSACTIONNEL.
//
// `transactionnel: true` means the message is the only notice of a fact its
// recipient must act on or has a right to know — an acknowledgement of a step
// they took, money authorized, released or paid, an act that changed hands, a
// sign-in link. Art. 68 du Code de déontologie interdit la publicité
// incomplète : éteindre un de ces courriels laisserait la personne sans le
// fait, alors elle ne s'éteint pas (`validateOverride` refuse, et le notifieur
// ignore un enregistrement qui l'aurait contourné).
//
// `transactionnel: false` — relances, digests, invitations, bienvenue,
// reconquête, et toute alerte interne adressée à Nota elle-même. L'art. 56 1°
// tient l'autre bout : inciter « de façon pressante ou répétée » est
// dérogatoire, donc ces envois-là doivent pouvoir être coupés.
//
// The token vocabulary (nothing else interpolates):
//   montant  — the bid amount, via domain money() (FR) / moneyEn() (EN)
//   service  — the service name, via nom (FR) / nomEn (EN)
//   date     — the signing date, via the fr-CA / en-CA long formatters
//   code     — a partner referral code
//   n        — a count (e.g. bids in a digest)
//   note     — an evaluation note (1-5)
//   etude    — the notary study's display name
//   email    — the relevant email address
const TEMPLATE_META = {
  // --- client — offer lifecycle ---------------------------------------------
  clientWelcome: {
    audience: 'client', transactionnel: false,
    labelFr: 'Bienvenue client', labelEn: 'Client welcome',
    defaultSubjectFr: 'Bienvenue sur Nota', defaultSubjectEn: 'Welcome to Nota',
    placeholders: ['email'],
  },
  offerPublished: {
    audience: 'client', transactionnel: true,
    labelFr: 'Offre publiée', labelEn: 'Offer posted',
    defaultSubjectFr: 'Votre offre est en ligne : {{montant}}', defaultSubjectEn: 'Your offer is live: {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  dossierIncomplete: {
    audience: 'client', transactionnel: false,
    labelFr: 'Dossier incomplet (rappel)', labelEn: 'File incomplete (reminder)',
    defaultSubjectFr: 'Il reste une étape à votre dossier', defaultSubjectEn: 'One step left in your file',
    placeholders: ['montant', 'service', 'date'],
  },
  dateApproaching: {
    audience: 'client', transactionnel: false,
    labelFr: 'Date qui approche (J-7/3/1)', labelEn: 'Date approaching (J-7/3/1)',
    defaultSubjectFr: 'Votre signature approche', defaultSubjectEn: 'Your signing is coming up',
    placeholders: ['montant', 'service', 'date'],
  },
  offerRetained: {
    audience: 'client', transactionnel: true,
    labelFr: 'Demande retenue', labelEn: 'Request taken',
    defaultSubjectFr: 'Un notaire a retenu votre demande', defaultSubjectEn: 'A notary has taken your request',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  dateMissedNoUptake: {
    audience: 'client', transactionnel: true,
    labelFr: 'Date proche sans preneur (J-0)', labelEn: 'Date near, no uptake (J-0)',
    defaultSubjectFr: 'Votre date approche, aucune offre retenue', defaultSubjectEn: 'Your date is near, no offer taken',
    placeholders: ['montant', 'service', 'date'],
  },
  offerCancelled: {
    audience: 'client', transactionnel: true,
    labelFr: 'Offre annulée (accusé)', labelEn: 'Offer cancelled (ack)',
    defaultSubjectFr: 'Offre annulée : {{montant}}', defaultSubjectEn: 'Offer cancelled: {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  evaluationInvite: {
    audience: 'client', transactionnel: false,
    labelFr: 'Invitation à évaluer', labelEn: 'Evaluation invite',
    defaultSubjectFr: 'Acte signé — évaluez votre notaire', defaultSubjectEn: 'Act signed — rate your notary',
    placeholders: ['montant', 'service', 'date'],
  },
  actReleased: {
    audience: 'client', transactionnel: true,
    labelFr: 'Désistement du notaire', labelEn: 'Notary withdrew',
    defaultSubjectFr: 'Votre demande est de retour au carnet', defaultSubjectEn: 'Your request is back on the carnet',
    placeholders: ['montant', 'service', 'date'],
  },
  // --- client — pay-on-accept lifecycle -------------------------------------
  offerAuthorized: {
    audience: 'client', transactionnel: true,
    labelFr: 'Paiement autorisé', labelEn: 'Payment authorized',
    defaultSubjectFr: 'Paiement autorisé — offre visible', defaultSubjectEn: 'Payment authorized — offer visible',
    placeholders: ['montant', 'service', 'date'],
  },
  offerAuthorizationVoided: {
    audience: 'client', transactionnel: true,
    labelFr: 'Autorisation expirée', labelEn: 'Authorization lapsed',
    defaultSubjectFr: 'Votre offre n’est plus visible', defaultSubjectEn: 'Your offer is no longer visible',
    placeholders: ['montant', 'service', 'date'],
  },
  // --- client — notary actions on an open offer -----------------------------
  propositionRecue: {
    audience: 'client', transactionnel: true,
    labelFr: 'Proposition reçue', labelEn: 'Proposal received',
    defaultSubjectFr: 'Un notaire vous propose {{montant}}', defaultSubjectEn: 'A notary proposes {{montant}}',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  documentsDemandes: {
    audience: 'client', transactionnel: true,
    labelFr: 'Documents demandés', labelEn: 'Documents requested',
    defaultSubjectFr: 'Un notaire vous demande des documents', defaultSubjectEn: 'A notary is asking you for documents',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  // --- retained-act conversation (chat) --------------------------------------
  documentDuNotaire: {
    audience: 'client', transactionnel: true,
    labelFr: 'Document du notaire (fil du dossier)', labelEn: 'Document from the notary (file thread)',
    defaultSubjectFr: 'Un document de votre notaire', defaultSubjectEn: 'A document from your notary',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  documentDuClient: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Document du client (fil du dossier)', labelEn: 'Document from the client (file thread)',
    defaultSubjectFr: 'Un document de votre client — {{montant}}', defaultSubjectEn: 'A document from your client — {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  messageDuNotaire: {
    audience: 'client', transactionnel: true,
    labelFr: 'Message du notaire (fil du dossier)', labelEn: 'Message from the notary (file thread)',
    defaultSubjectFr: 'Message de votre notaire', defaultSubjectEn: 'A message from your notary',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  messageDuClient: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Réponse du client (fil du dossier)', labelEn: 'Client reply (file thread)',
    defaultSubjectFr: 'Réponse de votre client — {{montant}}', defaultSubjectEn: 'Your client replied — {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  // --- notary — answers to their proposition --------------------------------
  propositionAcceptee: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Proposition acceptée', labelEn: 'Proposal accepted',
    defaultSubjectFr: 'Proposition acceptée : {{montant}}', defaultSubjectEn: 'Proposal accepted: {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  propositionRefusee: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Proposition déclinée', labelEn: 'Proposal declined',
    defaultSubjectFr: 'Proposition déclinée : {{montant}}', defaultSubjectEn: 'Proposal declined: {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  offerCancelledNotary: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Demande retenue annulée par le client', labelEn: 'Retained request cancelled by the client',
    defaultSubjectFr: 'Demande annulée par le client : {{montant}}', defaultSubjectEn: 'Client cancelled: {{montant}}',
    placeholders: ['montant', 'service', 'date'],
  },
  // --- ADR 0033 — la mise en relation est complète ---------------------------
  demandeRetenueNotaire: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Demande retenue (au notaire)', labelEn: 'Request taken (to the notary)',
    defaultSubjectFr: 'Demande retenue : {{montant}} · {{service}}', defaultSubjectEn: 'Request taken: {{montant}}',
    placeholders: ['montant', 'service', 'date', 'email'],
  },
  nouvelleDemande: {
    // An alert the notary asked for (alertes.pace = instant) — relationnel:
    // it can be silenced, the daily digest and the carnet still carry the demand.
    audience: 'notaire', transactionnel: false,
    labelFr: 'Nouvelle demande (alerte instantanée)', labelEn: 'New request (instant alert)',
    defaultSubjectFr: 'Nouvelle demande : {{montant}} · {{service}}', defaultSubjectEn: 'New request: {{montant}} · {{service}}',
    placeholders: ['montant', 'service', 'date'],
  },
  // --- evaluation feedback loop (ADR 0015/0016) ------------------------------
  evaluationRecueNotaire: {
    audience: 'notaire', transactionnel: false,
    labelFr: 'Évaluation reçue', labelEn: 'Rating received',
    defaultSubjectFr: 'Vous avez reçu une évaluation : {{note}}/5', defaultSubjectEn: 'You received a rating: {{note}}/5',
    placeholders: ['note', 'montant', 'service', 'date', 'etude'],
  },
  // --- contact form (nous joindre) -------------------------------------------
  contactRecu: {
    audience: 'client', transactionnel: true,
    labelFr: 'Message bien reçu (accusé)', labelEn: 'Message received (ack)',
    defaultSubjectFr: 'Message bien reçu', defaultSubjectEn: 'Message received',
    placeholders: [],
  },
  // --- notary — marketplace lifecycle ----------------------------------------
  newMatchingBids: {
    audience: 'notaire', transactionnel: false,
    labelFr: 'Digest des demandes ouvertes', labelEn: 'Open-requests digest',
    defaultSubjectFr: '{{n}} nouvelles demandes sur le carnet', defaultSubjectEn: '{{n}} new requests on the carnet',
    placeholders: ['n'],
  },
  notaryMagicLink: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Lien de connexion (espace notaire)', labelEn: 'Sign-in link (notary console)',
    defaultSubjectFr: 'Votre lien de connexion — Espace notaire', defaultSubjectEn: 'Your sign-in link — Notary console',
    placeholders: [],
  },
  notaryOnboardingStarted: {
    audience: 'notaire', transactionnel: false,
    labelFr: 'Inscription à terminer', labelEn: 'Registration to finish',
    defaultSubjectFr: 'Terminez votre inscription à Nota', defaultSubjectEn: 'Finish your Nota registration',
    placeholders: ['email'],
  },
  notaryActive: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Compte notaire actif', labelEn: 'Notary account active',
    defaultSubjectFr: 'Votre compte notaire est actif', defaultSubjectEn: 'Your notary account is active',
    placeholders: ['email'],
  },
  actPaidNotary: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Acte payé (relevé)', labelEn: 'Act paid (statement)',
    defaultSubjectFr: 'Acte payé — versement en route', defaultSubjectEn: 'Payout on the way',
    placeholders: ['montant', 'service', 'date'],
  },
  notaryDisconnectedWinback: {
    audience: 'notaire', transactionnel: false,
    labelFr: 'Compte déconnecté (relance)', labelEn: 'Account disconnected (win-back)',
    defaultSubjectFr: 'Votre place sur Nota vous attend', defaultSubjectEn: 'Your spot on Nota is waiting',
    placeholders: ['email'],
  },
  // --- admin console ----------------------------------------------------------
  adminMagicLink: {
    audience: 'admin', transactionnel: true,
    labelFr: 'Lien de connexion (console admin)', labelEn: 'Sign-in link (admin console)',
    defaultSubjectFr: 'Votre lien de connexion — Nota Admin', defaultSubjectEn: 'Your sign-in link — Nota Admin',
    placeholders: [],
  },
  // --- partner referrals (ADR 0011) ------------------------------------------
  partnerClaimLink: {
    audience: 'partenaire', transactionnel: true,
    labelFr: 'Confirmation du code (lien)', labelEn: 'Code confirmation (link)',
    defaultSubjectFr: 'Confirmez votre code partenaire : {{code}}', defaultSubjectEn: 'Confirm your partner code: {{code}}',
    placeholders: ['code'],
  },
  partnerWelcome: {
    audience: 'partenaire', transactionnel: true,
    labelFr: 'Bienvenue partenaire', labelEn: 'Partner welcome',
    defaultSubjectFr: 'Votre code partenaire est prêt : {{code}}', defaultSubjectEn: 'Your partner code is ready: {{code}}',
    placeholders: ['code'],
  },
  referralRewardClient: {
    audience: 'partenaire', transactionnel: true,
    labelFr: 'Prime — demande référée retenue', labelEn: 'Reward — referred request taken',
    defaultSubjectFr: 'Prime gagnée — demande référée retenue', defaultSubjectEn: 'Reward earned — referred request taken',
    // No {{montant}} here on purpose: the token is the ACT's amount, and an
    // admin reaching for it would publish the wrong number as the reward
    // (audit des affirmations, 2026-09-01). The reward is domain.REFERRAL.
    placeholders: ['code', 'service', 'date'],
  },
  referralRewardNotary: {
    audience: 'partenaire', transactionnel: true,
    labelFr: 'Prime — notaire référé actif', labelEn: 'Reward — referred notary active',
    defaultSubjectFr: 'Prime gagnée — notaire référé actif', defaultSubjectEn: 'Reward earned — referred notary active',
    placeholders: ['code'],
  },
  // --- operator alerts --------------------------------------------------------
  operatorNotaryActive: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Nouveau notaire actif', labelEn: 'New active notary',
    defaultSubjectFr: 'Nouveau notaire actif : {{email}}', defaultSubjectEn: 'New active notary',
    placeholders: ['email'],
  },
  operatorNewLead: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Nouvelle offre publiée', labelEn: 'New offer posted',
    defaultSubjectFr: 'Nouvelle offre : {{montant}} · {{service}}', defaultSubjectEn: 'New offer: {{montant}} · {{service}}',
    placeholders: ['montant', 'service', 'date'],
  },
  operatorActCompleted: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Acte complété', labelEn: 'Act completed',
    defaultSubjectFr: 'Acte complété : {{montant}} · {{service}}', defaultSubjectEn: 'Act completed: {{montant}} · {{service}}',
    placeholders: ['montant', 'service', 'date'],
  },
  operatorNewPartner: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Nouveau partenaire', labelEn: 'New partner',
    defaultSubjectFr: 'Nouveau partenaire : {{code}}', defaultSubjectEn: 'New partner: {{code}}',
    placeholders: ['code', 'email'],
  },
  operatorOfferCancelled: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Demande retenue annulée', labelEn: 'Retained request cancelled',
    defaultSubjectFr: 'Annulation d’une demande retenue : {{montant}}', defaultSubjectEn: 'Retained request cancelled',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  operatorActReleased: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Désistement d’un notaire', labelEn: 'Notary withdrawal',
    defaultSubjectFr: 'Désistement d’un notaire : {{montant}} · {{service}}', defaultSubjectEn: 'Notary withdrew',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  operatorContactMessage: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Message du formulaire', labelEn: 'Contact-form message',
    defaultSubjectFr: 'Nous joindre : nouveau message', defaultSubjectEn: 'Contact form',
    placeholders: ['email'],
  },
  operatorSupportMessage: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Messagerie : question d’un visiteur', labelEn: 'Live chat: visitor question',
    defaultSubjectFr: 'Messagerie : nouvelle question', defaultSubjectEn: 'Live chat: new question',
    placeholders: ['email'],
  },
  supportReponse: {
    audience: 'client', transactionnel: true,
    labelFr: 'Messagerie : réponse de Nota', labelEn: 'Live chat: Nota replied',
    defaultSubjectFr: 'Nota vous a répondu', defaultSubjectEn: 'Nota replied to you',
    placeholders: [],
  },
  operatorLowRating: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Évaluation faible (alerte)', labelEn: 'Low rating (alert)',
    defaultSubjectFr: 'Évaluation faible : {{note}}/5 · {{service}}', defaultSubjectEn: 'Low rating: {{note}}/5 · {{service}}',
    placeholders: ['note', 'montant', 'service', 'date', 'etude'],
  },
  operatorDemandeRetenue: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Demande retenue (alerte)', labelEn: 'Request taken (alert)',
    defaultSubjectFr: 'Demande retenue : {{montant}} · {{service}}', defaultSubjectEn: 'Request taken',
    placeholders: ['montant', 'service', 'date', 'etude'],
  },
  // --- free signup + operator vetting (2026-09-02) ----------------------------
  notaryPendingReview: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Inscription reçue (en vérification)', labelEn: 'Registration received (under review)',
    defaultSubjectFr: 'Inscription reçue — en vérification',
    defaultSubjectEn: 'Registration received — under review',
    placeholders: ['email'],
  },
  operatorNotarySignedUp: {
    audience: 'operateur', transactionnel: false,
    labelFr: 'Nouvelle inscription notaire', labelEn: 'New notary signup',
    defaultSubjectFr: 'Nouvelle inscription notaire : {{email}}', defaultSubjectEn: 'Notary signup',
    placeholders: ['email'],
  },
  notaryApproved: {
    audience: 'notaire', transactionnel: true,
    labelFr: 'Accès ouvert (compte activé)', labelEn: 'Access open (account activated)',
    defaultSubjectFr: 'Votre accès Nota est ouvert', defaultSubjectEn: 'Your Nota access is open',
    placeholders: ['email'],
  },
};

// Interpolate one override side. Unknown or missing tokens render as '' —
// nothing is escaped here because nothing is inserted here: the subject is a
// plain-text header and every other field goes on to para(), button() or
// preheaderHtml(), which all escape. Newlines are stripped (a header must stay
// a single line, and an overridden body is ONE paragraph).
function interpolateTokens(raw, ctx, lang) {
  const en = lang === 'en';
  const tokens = {
    montant: () => (ctx.montant == null ? '' : en ? moneyEn(ctx.montant) : money(ctx.montant)),
    service: () => (ctx.serviceId ? (en ? svcNomEn(ctx.serviceId) : svcNom(ctx.serviceId)) : ''),
    date: () => (ctx.dateISO ? (en ? fmtDateEn(ctx.dateISO) : fmtDate(ctx.dateISO)) : ''),
    code: () => (ctx.code == null ? '' : String(ctx.code)),
    n: () => (ctx.n != null ? String(ctx.n) : Array.isArray(ctx.bids) ? String(ctx.bids.length) : ''),
    note: () => (ctx.note == null ? '' : String(ctx.note)),
    etude: () => (ctx.etude == null ? '' : String(ctx.etude)),
    email: () => (ctx.email == null ? '' : String(ctx.email)),
  };
  return String(raw)
    .replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, name) => (tokens[name] ? tokens[name]() : ''))
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

// Turn a stored override into the final bilingual subject, or null when the
// built-in subject should stand. DELIBERATELY all-or-nothing: BOTH subjectFr
// and subjectEn must be non-empty strings, otherwise null is returned and the
// caller keeps the template's built subject — a half-translated override would
// break the 'FR / EN' bilingual contract, so it is treated as not configured.
function renderSubjectOverride(override, ctx) {
  return overrideCopy(override, ctx || {}).subject || null;
}

// --- La surcharge, champ par champ -------------------------------------------
//
// Quatre paires bilingues. Chacune est TOUT-OU-RIEN, comme le sujet l'est
// depuis l'ADR 0018 : un gabarit porte toujours FR et EN, et une paire à moitié
// remplie est traitée comme absente plutôt que d'expédier un courriel dont un
// bloc a été réécrit et pas l'autre.
//
// Les maxima ne sont pas décoratifs :
//   sujet 200 — les boîtes coupent l'entête vers 60-80 caractères ; 200 par
//     côté laisse la place aux jetons interpolés (une date longue en fait 35)
//     tout en gardant l'entête « FR / EN » loin des 998 octets du RFC 5322 ;
//   preheader 200 — l'aperçu affiché fait 90-140 caractères ; même marge ;
//   corps 1200 — UN paragraphe dans une carte de 600 px. Le plus long du
//     registre en fait ~370 ; 1200 donne trois fois la marge sans laisser la
//     carte devenir une infolettre ;
//   cta 60 — un bouton doit tenir sur une ligne à 320 px (~30 caractères) ;
//     au-delà il se casse en pavé illisible. Les libellés du registre font ≤ 25.
const OVERRIDE_LIMITS = { sujet: 200, preheader: 200, corps: 1200, cta: 60 };

// La déclaration de chaque paire : les deux champs, la borne, et les codes
// d'erreur que la console admin affiche.
const OVERRIDE_FIELDS = [
  { fr: 'subjectFr', en: 'subjectEn', max: OVERRIDE_LIMITS.sujet, tropLong: 'sujet_trop_long', bilingue: 'sujet_bilingue' },
  { fr: 'preheaderFr', en: 'preheaderEn', max: OVERRIDE_LIMITS.preheader, tropLong: 'preheader_trop_long', bilingue: 'preheader_bilingue' },
  { fr: 'corpsFr', en: 'corpsEn', max: OVERRIDE_LIMITS.corps, tropLong: 'corps_trop_long', bilingue: 'corps_bilingue' },
  { fr: 'ctaFr', en: 'ctaEn', max: OVERRIDE_LIMITS.cta, tropLong: 'cta_trop_long', bilingue: 'cta_bilingue' },
];
// Reçus sans être de la copie : la clé et l'horodatage appartiennent au dépôt,
// `enabled` est l'ancien nom de `actif`.
const OVERRIDE_PASSTHROUGH = ['key', 'updatedAt', 'enabled', 'actif'];

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

// Le commutateur, quel que soit le nom sous lequel il a été écrit.
function overrideOff(override) {
  return !!override && (override.actif === false || override.enabled === false);
}

// Un enregistrement qui éteindrait un gabarit transactionnel est sans effet :
// art. 68, la personne garde le fait. `validateOverride` refuse déjà d'en
// écrire un — ceci tient la porte pour ceux écrits avant qu'il existe, ou
// directement dans la table.
function isOverrideDisabled(key, override) {
  if (!overrideOff(override)) return false;
  const meta = TEMPLATE_META[key];
  return !(meta && meta.transactionnel);
}

// Ce que la surcharge donne à `build` : les côtés rendus, ou '' quand le
// gabarit garde le sien. Une paire incomplète ne rend rien.
function overrideCopy(override, ctx) {
  const out = { subject: '', preheaderFr: '', preheaderEn: '', corpsFr: '', corpsEn: '', ctaFr: '', ctaEn: '' };
  if (!override) return out;
  const rendu = (champ) => {
    const fr = trimmed(override[champ.fr]);
    const en = trimmed(override[champ.en]);
    if (!fr || !en) return null;
    return [interpolateTokens(fr, ctx, 'fr'), interpolateTokens(en, ctx, 'en')];
  };
  const sujet = rendu(OVERRIDE_FIELDS[0]);
  if (sujet) out.subject = sujet[0] + ' / ' + sujet[1];
  for (const champ of OVERRIDE_FIELDS.slice(1)) {
    const paire = rendu(champ);
    if (paire) {
      out[champ.fr] = paire[0];
      out[champ.en] = paire[1];
    }
  }
  return out;
}

// Le validateur pur de la console admin : `{ ok, errors, override }`, errors
// en français sous la forme `{ code, message }`. `override` est
// l'enregistrement normalisé prêt pour `repo.putEmailOverride` (vide = null,
// jamais une chaîne vide), ou null dès qu'une erreur est relevée.
//
// Le HTML est REFUSÉ ici, et échappé de toute façon à l'insertion (para(),
// button(), preheaderHtml() passent tous par esc()). L'échappement est la
// garantie de sécurité — il couvre ce qui n'est jamais passé par cette porte ;
// le refus est une politesse : un `<b>` accepté puis échappé partirait tel quel
// dans la boîte du client, ce qui est un bogue, pas une protection.
// Les tournures qui décrivent un partage des honoraires du notaire. Écrites une
// fois, ici, et lues par la validation de CHAQUE champ surchargeable. La liste
// est courte et vise une opération précise — pas un champ lexical.
const PARTAGE_INTERDIT = [
  /commission/i,
  // Une part rattachée aux honoraires DU NOTAIRE. Le possessif est
  // indispensable : « fees » seul désigne aussi les frais d'annulation, qui
  // sont un prélèvement de Nota sur le client — pas un partage d'honoraires.
  /(\d+\s*%|\bpart\b|\bshare\b)[^.]{0,60}(honoraires\s+(du|de|des)\s+notaire|(vos|ses|leurs)\s+honoraires|notary[\u2019']?s?\s+fees|(your|their)\s+fees)/i,
  /(honoraires\s+(du|de|des)\s+notaire|(vos|ses|leurs)\s+honoraires|notary[\u2019']?s?\s+fees|(your|their)\s+fees)[^.]{0,60}(\d+\s*%|\bpart\b|\bshare\b)/i,
  // « le notaire garde 85 % », « the notary keeps 85% » — la formule exacte que
  // la console affichait avant l'ADR 0031.
  /(notaire|notary)[^.]{0,40}(garde|gardez|keeps?)\s+\d+\s*%/i,
  /(garde|gardez|keeps?)\s+\d+\s*%[^.]{0,40}(client|notaire|notary)/i,
];

function validateOverride(key, payload) {
  const errors = [];
  const meta = TEMPLATE_META[key];
  if (!meta) {
    return {
      ok: false,
      errors: [{ code: 'modele_inconnu', message: `Modèle de courriel inconnu : ${key}.` }],
      override: null,
    };
  }
  const b = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const connus = new Set(OVERRIDE_PASSTHROUGH);
  OVERRIDE_FIELDS.forEach((c) => {
    connus.add(c.fr);
    connus.add(c.en);
  });
  for (const nom of Object.keys(b)) {
    if (!connus.has(nom)) {
      errors.push({ code: 'champ_inconnu', message: `Champ inconnu : ${nom}.` });
    }
  }

  const brut = b.actif !== undefined ? b.actif : b.enabled;
  if (brut !== undefined && typeof brut !== 'boolean') {
    errors.push({ code: 'champ_invalide', message: 'actif doit être un booléen.' });
  }
  const actif = brut !== false;

  // Art. 68 — la publicité incomplète. Un accusé, un mouvement d'argent, un
  // acte qui change de mains : le taire prive la personne d'un fait.
  if (!actif && meta.transactionnel) {
    errors.push({
      code: 'desactivation_interdite',
      message:
        `« ${meta.labelFr} » est un courriel transactionnel : il annonce un fait ` +
        'que son destinataire doit connaître, et ne peut pas être désactivé. ' +
        'La reformulation, elle, reste permise.',
    });
  }

  const permis = meta.placeholders || [];
  const valeurs = {};
  for (const champ of OVERRIDE_FIELDS) {
    for (const nom of [champ.fr, champ.en]) {
      const brutChamp = b[nom];
      if (brutChamp === undefined || brutChamp === null) {
        valeurs[nom] = null;
        continue;
      }
      if (typeof brutChamp !== 'string') {
        errors.push({ code: 'champ_invalide', message: `${nom} doit être une chaîne de caractères.` });
        valeurs[nom] = null;
        continue;
      }
      const v = brutChamp.trim();
      valeurs[nom] = v || null;
      if (!v) continue;
      if (v.length > champ.max) {
        errors.push({ code: champ.tropLong, message: `${nom} dépasse ${champ.max} caractères.` });
      }
      if (/[<>]/.test(v)) {
        errors.push({
          code: 'html_interdit',
          message: `${nom} : le HTML n’est pas permis — écrivez du texte, la mise en forme vient du gabarit.`,
        });
      }
      // Ce que la surcharge ne peut PAS réécrire : le partage d'honoraires.
      //
      // L'art. 32 du Code de déontologie interdit au notaire de partager ses
      // honoraires avec une personne qui n'est pas membre d'un ordre, et
      // l'art. 32.1 2° de la Loi sur le notariat frappe l'intermédiaire qui
      // l'obtient. Depuis l'ADR 0031, Nota ne prélève plus rien : une phrase
      // qui l'affirmerait serait à la fois FAUSSE et une pièce écrite par Nota
      // contre elle-même. Les gardes du dépôt vérifiaient la copie native ; la
      // copie admin passe par ici, et elle est publiée tout autant.
      //
      // Le motif est étroit à dessein — il vise le PARTAGE, jamais le
      // vocabulaire de l'argent. Un courriel doit pouvoir parler de prix, de
      // paiement, de montants, et même d'un pourcentage (les frais
      // d'annulation en sont un), pourvu qu'il ne le rattache pas aux
      // honoraires du notaire.
      const partage = PARTAGE_INTERDIT.find((re) => re.test(v));
      if (partage) {
        errors.push({
          code: 'partage_interdit',
          message:
            `${nom} : Nota ne prélève aucune part des honoraires du notaire, et un courriel ne peut pas ` +
            'l’affirmer (art. 32 du Code de déontologie, art. 32.1 2° de la Loi sur le notariat). ' +
            'Écrivez plutôt les deux lignes : les honoraires du notaire, et le prix du service de Nota.',
        });
      }
      for (const [, jeton] of v.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) {
        if (!permis.includes(jeton)) {
          errors.push({
            code: 'jeton_inconnu',
            message:
              `${nom} : le jeton {{${jeton}}} n’existe pas pour ce modèle. ` +
              (permis.length
                ? `Jetons permis : ${permis.map((p) => `{{${p}}}`).join(', ')}.`
                : 'Ce modèle n’accepte aucun jeton.'),
          });
        }
      }
    }
    // Tout-ou-rien : un gabarit porte toujours les deux langues.
    const fr = valeurs[champ.fr];
    const en = valeurs[champ.en];
    if ((fr && !en) || (!fr && en)) {
      errors.push({
        code: champ.bilingue,
        message: `${champ.fr} et ${champ.en} vont ensemble : fournissez les deux langues, ou aucune.`,
      });
    }
  }

  if (errors.length) return { ok: false, errors, override: null };
  return {
    ok: true,
    errors: [],
    // `enabled` reste écrit à l'identique tant que les adaptateurs de dépôt ne
    // normalisent que ce nom-là.
    override: { key, actif, enabled: actif, ...valeurs },
  };
}

module.exports = {
  PLACEHOLDER_ADDRESS,
  SENDER,
  PALETTE,
  TEMPLATES,
  TEMPLATE_META,
  OVERRIDE_LIMITS,
  renderSubjectOverride,
  validateOverride,
  isOverrideDisabled,
  fmtDate,
  fmtDateEn,
  ...TEMPLATES,
};
