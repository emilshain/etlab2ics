/*
 * Waits for you to log in, then calls the portal's calendar feed from inside the
 * page (so it uses your own session) and reports its shape.
 *
 * The access token is never printed - only its length.
 *
 *   node scripts/capture-calendar.mjs [timeout-seconds]
 */

import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;
const timeoutSeconds = Number(process.argv[2] || 180);
const deadline = Date.now() + timeoutSeconds * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() {
  return (await fetch(BASE + '/json/list')).json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => ws.close() };
}

async function evaluate(target, expression) {
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    const res = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'threw');
    }
    return res.result.value;
  } finally {
    client.close();
  }
}

const CAPTURE = `(async () => {
  const token = localStorage.getItem('access_token') || '';
  let user = {};
  try { user = JSON.parse(localStorage.getItem('user_data') || '{}'); } catch (e) {}
  const headers = { Authorization: 'Bearer ' + token };
  if (user.institute) headers['X-Institute-ID'] = user.institute;

  const endpoint = 'https://api.students.etlab.app/examschedules/calendar-feed';
  const res = await fetch(endpoint, { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return JSON.stringify({
    url: location.href,
    status: res.status,
    contentType: res.headers.get('content-type'),
    tokenLen: token.length,
    institute: user.institute || null,
    userKeys: Object.keys(user).slice(0, 20),
    jsonTopLevelKeys: json && typeof json === 'object' ? Object.keys(json) : null,
    bodySample: text.slice(0, 2000)
  });
})()`;

async function main() {
  for (let i = 0; i < 30; i++) {
    try {
      await list();
      break;
    } catch (e) {
      await sleep(1000);
    }
  }

  let target = null;
  while (Date.now() < deadline) {
    const targets = await list();
    const pages = targets.filter((t) => t.type === 'page' && /etlab/i.test(t.url || ''));
    target = pages[targets.length - 1] || pages[0] || null;

    if (target) {
      const state = await evaluate(
        target,
        `JSON.stringify({ url: location.href, tokenLen: (localStorage.getItem('access_token')||'').length })`
      ).catch(() => null);

      if (state) {
        const parsed = JSON.parse(state);
        if (parsed.tokenLen > 0) {
          console.log('logged in at ' + parsed.url);
          const result = await evaluate(target, CAPTURE);
          fs.writeFileSync('.tmp-cal/capture.json', result);
          console.log(result);
          return;
        }
      }
    }
    await sleep(3000);
  }

  console.log('TIMEOUT: still not logged in after ' + timeoutSeconds + 's');
}

main().catch((error) => {
  console.error('ERROR: ' + error.message);
  process.exit(1);
});
