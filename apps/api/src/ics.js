'use strict';

/**
 * iCalendar (RFC 5545) feed builder for the notary console. Ports the all-day
 * VEVENT shape the web app already uses for a single bid (apps/web/public/app.js)
 * into a multi-event VCALENDAR a notary can subscribe to over webcal. Pure: it
 * takes plain event rows and returns a string, no I/O and no clock.
 *
 * Service names come from @nota/domain so the summary matches the public carnet.
 */
const domain = require('@nota/domain');

function compact(dateISO) {
  return String(dateISO).replace(/-/g, '');
}

// A retained event is `{ id, dateISO, serviceId }` (extra fields ignored). Each
// becomes an all-day event 'Signature notariée — <service>' spanning one day.
function buildNotaryFeed(events = []) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nota//Console notaire//FR-CA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Nota — signatures retenues',
  ];
  for (const e of events) {
    const svc = domain.serviceById(e.serviceId);
    const name = svc ? svc.nom : e.serviceId;
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + e.id + '@nota',
      'DTSTART;VALUE=DATE:' + compact(e.dateISO),
      'DTEND;VALUE=DATE:' + compact(domain.addDays(e.dateISO, 1)),
      'SUMMARY:Signature notariée — ' + name,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildNotaryFeed };
