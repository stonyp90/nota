'use strict';

/**
 * iCalendar (RFC 5545) feed builder for the notary console. Ports the all-day
 * VEVENT shape the web app already uses for a single bid (apps/web/public/app.js)
 * into a multi-event VCALENDAR a notary can subscribe to over webcal. Pure: it
 * takes plain event rows and returns a string, no I/O and no clock.
 *
 * The feeds are bilingual without breaking calendar UIs: each VEVENT keeps its
 * French SUMMARY and carries the English equivalent in DESCRIPTION, and the
 * X-WR-CALNAME reads 'FR / EN'. Service names come from @nota/domain (nom for
 * French, nomEn for English) so both sides match the public carnet; amounts go
 * through domain.money() / domain.moneyEn().
 *
 * Every physical line is folded at 75 octets (RFC 5545 §3.1) on a UTF-8
 * character boundary, so strict clients (Outlook desktop, older CalDAV
 * servers) parse the feed as well as Google and Apple do.
 */
const domain = require('@nota/domain');

function compact(dateISO) {
  return String(dateISO).replace(/-/g, '');
}

// RFC 5545 §3.3.11: escape backslash, comma, semicolon and newlines in TEXT
// values, so a comma in a service name or an en-CA "$1,500" never truncates
// the SUMMARY/DESCRIPTION or breaks the parse.
function escText(s) {
  return String(s).replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1: fold a content line into physical lines of at most 75 octets;
// each continuation starts with a single space. The cut lands on a character
// boundary (never inside a UTF-8 sequence), counting octets, not code points.
function fold(line) {
  const out = [];
  let cur = '';
  let curBytes = 0;
  // The continuation lead (' ') costs one octet on every folded line.
  let budget = 75;
  for (const ch of line) {
    const w = Buffer.byteLength(ch, 'utf8');
    if (curBytes + w > budget) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
      budget = 75;
    }
    cur += ch;
    curBytes += w;
  }
  out.push(cur);
  return out;
}

function render(lines) {
  return lines.flatMap(fold).join('\r\n');
}

// The déplacement band in the NOTARY register — the same six compositions as
// the console card pill (ncDeplacementPill): who hosts the signature, then the
// radius. `d` is { qui, km, urgence }.
function deplacementFr(d) {
  if (d.urgence) return 'Urgence · 100 % en ligne';
  const qui = d.qui === 'notaire' ? 'Chez le client' : 'À l’étude';
  return qui + ' · ' + (d.km < 25 ? 'moins de ' + d.km + ' km' : '≤ ' + d.km + ' km');
}
function deplacementEn(d) {
  if (d.urgence) return 'Urgency · 100 % online';
  const qui = d.qui === 'notaire' ? 'At the client’s' : 'At the office';
  return qui + ' · ' + (d.km < 25 ? 'under ' + d.km + ' km' : '≤ ' + d.km + ' km');
}

// A retained event is `{ id, dateISO, serviceId }` plus, when the handler could
// hydrate the bid, the decision details: montant, preteur { nom, virtuel },
// deplacement { qui, km, urgence }, ready, clientNom, prefixe. Each becomes an
// all-day event: French SUMMARY (service + amount), the déplacement band as
// LOCATION, and a DESCRIPTION of one fact per line, FR — EN. Details are all
// optional so a pointer written before the hydration still renders.
// L'origine publique, normalisée : sans barre oblique finale, ou `null` si elle
// n'est pas configurée. Un événement sans lien vaut mieux qu'un lien faux.
function origine(baseUrl) {
  const u = String(baseUrl == null ? '' : baseUrl).trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(u) ? u : null;
}

// RFC 5545 §3.8.4.6 — URL porte un URI, pas du TEXT : il ne passe donc pas par
// `escText`, qui échapperait les deux-points et casserait le lien.
function urlLine(base, suffixe) {
  return base ? ['URL:' + base + '/' + (suffixe || '')] : [];
}

function buildNotaryFeed(events = [], stamp, baseUrl) {
  const lien = urlLine(origine(baseUrl), '#notaires');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nota//Console notaire//FR-CA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escText('Nota — signatures retenues / retained signings'),
  ];
  for (const e of events) {
    const svc = domain.serviceById(e.serviceId);
    const name = svc ? svc.nom : e.serviceId;
    const nameEn = svc ? svc.nomEn : e.serviceId;
    const hasMontant = typeof e.montant === 'number';
    const desc = [
      'Notarized signing — ' + nameEn + (hasMontant ? ' — ' + domain.moneyEn(e.montant) : ''),
    ];
    if (e.deplacement) desc.push('Déplacement : ' + deplacementFr(e.deplacement) + ' — Travel: ' + deplacementEn(e.deplacement));
    if (e.preteur && e.preteur.nom) {
      const flagFr = e.preteur.virtuel ? ' (virtuel)' : '';
      const flagEn = e.preteur.virtuel ? ' (virtual)' : '';
      desc.push('Prêteur : ' + e.preteur.nom + flagFr + ' — Lender: ' + e.preteur.nom + flagEn);
    }
    if (typeof e.ready === 'boolean') {
      desc.push(e.ready ? 'Dossier prêt — File ready' : 'Dossier en préparation — File in preparation');
    }
    if (e.clientNom) desc.push('Client : ' + e.clientNom);
    if (e.prefixe) desc.push('Réf. : ' + e.prefixe);
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + e.id + '@nota',
      ...(stamp ? ['DTSTAMP:' + stamp] : []),
      'DTSTART;VALUE=DATE:' + compact(e.dateISO),
      'DTEND;VALUE=DATE:' + compact(domain.addDays(e.dateISO, 1)),
      'SUMMARY:' + escText('Signature notariée — ' + name + (hasMontant ? ' — ' + domain.money(e.montant) : '')),
      ...(e.deplacement ? ['LOCATION:' + escText(deplacementFr(e.deplacement))] : []),
      'DESCRIPTION:' + escText(desc.join('\n')),
      ...lien,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return render(lines);
}

// The PUBLIC carnet feed: every open/retained offer as an all-day event, so a
// customer (or anyone) can subscribe to the whole carnet in Google / Outlook /
// Apple over webcal. Each `bid` is the SAME public projection GET /bids exposes
// — id, dateISO, serviceId, montant — so this can never leak courriel/dossier.
// French SUMMARY, English DESCRIPTION, same event either way.
function buildCarnetFeed(bids = [], stamp, baseUrl) {
  const lien = urlLine(origine(baseUrl), '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nota//Carnet public//FR-CA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escText('Nota — carnet public / public carnet (Québec)'),
  ];
  for (const b of bids) {
    const svc = domain.serviceById(b.serviceId);
    const name = svc ? svc.nom : b.serviceId;
    const nameEn = svc ? svc.nomEn : b.serviceId;
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + b.id + '@nota',
      ...(stamp ? ['DTSTAMP:' + stamp] : []),
      'DTSTART;VALUE=DATE:' + compact(b.dateISO),
      'DTEND;VALUE=DATE:' + compact(domain.addDays(b.dateISO, 1)),
      'SUMMARY:' + escText(name + ' — ' + domain.money(b.montant)),
      'DESCRIPTION:' + escText(nameEn + ' — ' + domain.moneyEn(b.montant)),
      ...lien,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return render(lines);
}

module.exports = { buildNotaryFeed, buildCarnetFeed };
