/*
 * iCalendar (RFC 5545) builder.
 *
 * Pure functions, no I/O, so the bridge and the tests share exactly the same
 * code. ETLab's calendar is a list of all-day entries:
 *
 *   { id, title, description, date: 'YYYY-MM-DD', type, is_holiday }
 */

/** Escape text per RFC 5545 (backslash, semicolons, commas, newlines). */
export function icsEscape(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets, continuing with a leading space. */
export function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const out = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }

  return out.join('\r\n ');
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateOnly(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw.replace(/-/g, '');
}

function nextDay(value) {
  const parts = String(value).slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** One VEVENT block for an all-day entry. */
export function eventToVevent(event, now = new Date()) {
  const start = dateOnly(event.date);
  if (!start || !event.title) return null;

  const uid = `etlab-${event.id != null ? event.id : start + '-' + event.title}` + '@students.etlab.app';
  const lines = [
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${event.endDate ? dateOnly(event.endDate) : nextDay(event.date)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(event.description || event.title)}`,
    `CATEGORIES:${icsEscape(event.type || 'Academic')}`,
    'TRANSP:TRANSPARENT',
    'STATUS:CONFIRMED',
    'END:VEVENT'
  ];
  return lines.map(foldLine);
}

/**
 * Build a complete VCALENDAR document.
 * `events` may contain duplicates (month boundaries overlap) - they are merged
 * by UID, keeping the first occurrence.
 */
export function toIcs(events, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const name = options.name || 'ETLab College Calendar';

  const seen = new Set();
  const blocks = [];

  for (const event of events || []) {
    const block = eventToVevent(event, now);
    if (!block) continue;
    const uidLine = block.find((l) => l.startsWith('UID:'));
    if (!uidLine || seen.has(uidLine)) continue;
    seen.add(uidLine);
    blocks.push(...block);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ETLab Calendar Bridge//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    `X-WR-TIMEZONE:${icsEscape(options.timezone || 'Asia/Kolkata')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
    ...blocks,
    'END:VCALENDAR'
  ];

  return lines.join('\r\n') + '\r\n';
}
