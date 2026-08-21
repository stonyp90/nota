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

// A retained event is `{ id, dateISO, serviceId }` (extra fields ignored). Each
// becomes an all-day event: SUMMARY 'Signature notariée — <service>' (fr) with
// DESCRIPTION 'Notarized signing — <service>' (en), spanning one day.
function buildNotaryFeed(events = [], stamp) {
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
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + e.id + '@nota',
      ...(stamp ? ['DTSTAMP:' + stamp] : []),
      'DTSTART;VALUE=DATE:' + compact(e.dateISO),
      'DTEND;VALUE=DATE:' + compact(domain.addDays(e.dateISO, 1)),
      'SUMMARY:' + escText('Signature notariée — ' + name),
      'DESCRIPTION:' + escText('Notarized signing — ' + nameEn),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// The PUBLIC carnet feed: every open/retained offer as an all-day event, so a
// customer (or anyone) can subscribe to the whole carnet in Google / Outlook /
// Apple over webcal. Each `bid` is the SAME public projection GET /bids exposes
// — id, dateISO, serviceId, montant — so this can never leak courriel/dossier.
// French SUMMARY, English DESCRIPTION, same event either way.
function buildCarnetFeed(bids = [], stamp) {
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
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildNotaryFeed, buildCarnetFeed };
