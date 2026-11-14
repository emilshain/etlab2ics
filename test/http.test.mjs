/*
 * End-to-end HTTP tests: starts a real bridge on a spare port inside a
 * throw-away working directory, so the developer's own session file and
 * calendar cache are never read or written.
 *
 *   node test/http.test.mjs
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.resolve(here, '..', 'calendar-bridge.mjs');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etlab2ics-test-'));
const port = Number(process.env.TEST_PORT || 8799);
const base = `http://127.0.0.1:${port}`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (error) {
    failed++;
    console.log('  FAIL ' + name + ' -> ' + error.message);
  }
}

const child = spawn(process.execPath, [bridge], {
  cwd: workDir,
  env: { ...process.env, BRIDGE_PORT: String(port) },
  stdio: 'ignore'
});

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(base + '/api/status');
      if (res.ok) return;
    } catch (e) {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('bridge never started on port ' + port);
}

function shutdown() {
  try {
    child.kill();
  } catch (e) {
    /* already gone */
  }
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch (e) {
    /* best effort */
  }
}

try {
  await waitForServer();

  await test('status page renders as HTML', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
  });

  await test('setup page renders and is never cached', async () => {
    const res = await fetch(base + '/setup');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  await test('cross-site POST to /api/session is refused', async () => {
    const res = await fetch(base + '/api/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example'
      },
      body: 'token=stolen&instituteId=1'
    });
    assert.equal(res.status, 403);
  });

  await test('a foreign Origin alone is refused', async () => {
    const res = await fetch(base + '/api/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example'
      },
      body: 'token=stolen&instituteId=1'
    });
    assert.equal(res.status, 403);
  });

  await test('same-origin POST still reaches the handler', async () => {
    const res = await fetch(base + '/api/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin'
      },
      body: 'instituteId=1'
    });
    assert.equal(res.status, 400); // refused for the missing token, not the origin
  });

  await test('status JSON reports a disconnected bridge', async () => {
    const res = await fetch(base + '/api/status');
    const body = await res.json();
    assert.equal(body.connected, false);
    assert.equal(body.savedAt, null);
    assert.equal(body.events, 0);
  });

  await test('feed returns 503 when there is nothing to serve', async () => {
    const res = await fetch(base + '/etlab.ics');
    assert.equal(res.status, 503);
  });

  await test('a cached calendar is served with an ETag', async () => {
    fs.writeFileSync(
      path.join(workDir, '.etlab-cache.json'),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        events: [
          { id: 1, title: 'Test event', description: '', date: '2026-11-20', type: 'event', is_holiday: false }
        ]
      })
    );

    const res = await fetch(base + '/etlab.ics');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/calendar/);
    assert.equal(res.headers.get('x-event-count'), '1');
    assert.equal(res.headers.get('x-published-ttl'), 'PT30M');
    assert.ok(res.headers.get('etag'), 'expected an ETag header');
    assert.match(await res.text(), /BEGIN:VEVENT/);
  });

  await test('If-None-Match returns 304', async () => {
    const first = await fetch(base + '/etlab.ics');
    const etag = first.headers.get('etag');
    const second = await fetch(base + '/etlab.ics', { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
  });

  await test('?download=1 is served as a file attachment', async () => {
    const res = await fetch(base + '/etlab.ics?download=1');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /attachment/);
  });

  await test('the plain feed stays inline for subscriptions', async () => {
    const res = await fetch(base + '/etlab.ics');
    assert.match(res.headers.get('content-disposition') || '', /inline/);
  });

  await test('unknown routes return 404', async () => {
    const res = await fetch(base + '/nope');
    assert.equal(res.status, 404);
  });
} finally {
  shutdown();
}

console.log(`\nAll ${passed} HTTP tests passed.`);
if (failed) {
  console.log(`${failed} HTTP test(s) failed.`);
  process.exit(1);
}
