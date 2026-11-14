/*
 * Feed stability rules.
 *
 * ETLab returns events per month, so an event near a boundary can arrive twice;
 * and the feed is rebuilt on every refresh, so anything time-dependent in the
 * output would produce a new ETag and a full re-download every 30 minutes.
 */

import assert from 'node:assert/strict';
import { toIcs, eventToVevent } from '../src/ics.js';

const EVENTS = [
  { id: 1, title: 'Semester exam', description: '', date: '2026-11-20', type: 'exam' },
  { id: 1, title: 'Semester exam', description: '', date: '2026-11-20', type: 'exam' },
  { id: 2, title: 'Institute holiday', description: '', date: '2026-11-21', type: 'holiday', is_holiday: true }
];

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (error) {
    console.log('  FAIL ' + name + ' -> ' + error.message);
    process.exitCode = 1;
  }
}

test('the same event returned by two months becomes one VEVENT', () => {
  const ics = toIcs(EVENTS);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((ics.match(/UID:etlab-1@/g) || []).length, 1);
});

test('rebuilding later produces byte-identical output', () => {
  const first = toIcs(EVENTS, { now: new Date('2026-11-14T10:00:00Z') });
  const second = toIcs(EVENTS, { now: new Date('2026-11-15T22:30:00Z') });
  assert.equal(first, second, 'feed must not change just because it was refreshed');
});

test('DTSTAMP comes from the event date, not the fetch time', () => {
  const block = eventToVevent(EVENTS[0]).join('\r\n');
  assert.match(block, /DTSTAMP:20261120T000000Z/);
});

test('every event keeps a unique UID', () => {
  const ics = toIcs(EVENTS);
  const uids = (ics.match(/^UID:.*$/gm) || []).map((line) => line.trim());
  assert.equal(new Set(uids).size, uids.length);
});

test('an event without a usable date is skipped', () => {
  const ics = toIcs([{ id: 9, title: 'Broken', date: 'not-a-date' }, EVENTS[0]]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

console.log('\nAll ' + passed + ' ICS stability tests passed.');
