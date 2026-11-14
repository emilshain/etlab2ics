import assert from 'node:assert/strict';
import { toIcs, icsEscape, foldLine } from '../src/ics.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error('      ' + String(error.message).split('\n').join('\n      '));
    process.exitCode = 1;
  }
}

const NOW = new Date('2026-11-13T10:30:00Z');
const sample = [
  {
    id: 2165,
    title: 'SPOOKATHON',
    description: 'SPOOKATHON',
    date: '2026-11-01',
    type: 'Academic',
    is_holiday: false
  },
  {
    id: 2170,
    title: 'PLACEMENT DRIVE',
    description: 'PLACEMENT DRIVE ',
    date: '2026-11-03',
    type: 'Academic',
    is_holiday: false
  }
];

console.log('\niCalendar output');

test('builds a valid VCALENDAR wrapper', () => {
  const ics = toIcs(sample, { now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 2);
});

test('all-day event with exclusive end date', () => {
  const ics = toIcs(sample, { now: NOW });
  assert.match(ics, /DTSTART;VALUE=DATE:20261101/);
  assert.match(ics, /DTEND;VALUE=DATE:20261102/, 'DTEND is the next day for all-day events');
  assert.match(ics, /SUMMARY:SPOOKATHON/);
  assert.match(ics, /UID:etlab-2165@students\.etlab\.app/);
  assert.match(ics, /DTSTAMP:20261113T103000Z/);
});

test('month rollover works for the last day of a month', () => {
  const ics = toIcs([{ id: 9, title: 'X', date: '2026-11-30', type: 'Academic' }], { now: NOW });
  assert.match(ics, /DTEND;VALUE=DATE:20261201/);
});

test('duplicate events are merged by UID', () => {
  const ics = toIcs([...sample, sample[0]], { now: NOW });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
});

test('special characters are escaped', () => {
  assert.equal(icsEscape('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(icsEscape('line1\nline2'), 'line1\\nline2');
});

test('long lines are folded and stay valid', () => {
  const long = 'SUMMARY:' + 'A'.repeat(200);
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1, 'was folded');
  for (const part of parts) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75, 'line under 76 octets');
  }
  assert.equal(parts.join('').replace(/\s/g, ''), long.replace(/\s/g, ''));
});

test('every line ends with CRLF (no bare LF)', () => {
  const ics = toIcs(sample, { now: NOW });
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF anywhere');
});

test('events without a usable date are skipped', () => {
  const ics = toIcs([{ id: 1, title: 'bad', date: 'not-a-date' }], { now: NOW });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
});

if (process.exitCode) {
  console.error('\nSome tests failed.\n');
} else {
  console.log(`\nAll ${passed} tests passed.\n`);
}
