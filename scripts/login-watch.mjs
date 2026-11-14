/*
 * Waits for you to log in to the Edge window that was opened for the test,
 * then injects src/engine.js into the real page and reports what it sees.
 *
 *   node scripts/login-watch.mjs [timeout-seconds]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const timeoutSeconds = Number(process.argv[2] || 240);
const deadline = Date.now() + timeoutSeconds * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() {
  const res = await fetch(BASE + '/json/list');
  return res.json();
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

async function evaluateOn(target, expression) {
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluation threw');
    }
    return result.result.value;
  } finally {
    client.close();
  }
}

async function findPage() {
  const targets = await list();
  return targets.find((t) => t.type === 'page' && /etlab/i.test(t.url || '')) || null;
}

const PROBE = `(() => {
  const body = (document.body && document.body.innerText) || '';
  return JSON.stringify({
    url: location.href,
    title: document.title,
    radios: document.querySelectorAll('input[type="radio"]').length,
    forms: document.querySelectorAll('form').length,
    mentionsSurvey: /survey|feedback|evaluat/i.test(body),
    snippet: body.replace(/\\s+/g, ' ').slice(0, 160)
  });
})()`;

async function main() {
  // Wait for the browser to answer.
  for (let i = 0; i < 30; i++) {
    try {
      await list();
      break;
    } catch (e) {
      await sleep(1000);
    }
  }

  const engineSrc = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8');
  let lastState = null;

  while (Date.now() < deadline) {
    const page = await findPage();
    if (!page) {
      console.log('Waiting: no ETLab page is open in the test window yet…');
      await sleep(4000);
      continue;
    }

    let state;
    try {
      state = JSON.parse(await evaluateOn(page, PROBE));
    } catch (e) {
      await sleep(3000);
      continue;
    }
    lastState = state;

    const onLogin = /\/user\/login|\/login|\/newregistration/i.test(state.url);
    if (!onLogin) {
      console.log('LOGGED IN ' + state.url);

      // Inject the real engine into the real page and ask it what it sees.
      await evaluateOn(page, engineSrc);
      const info = await evaluateOn(
        page,
        `JSON.stringify({
           inspect: ETLabEngine.inspect(document),
           links: ETLabEngine.collectSurveyLinks(document)
         })`
      );
      console.log('PROBE ' + info);
      return;
    }

    await sleep(4000);
  }

  console.log('TIMEOUT: still on the login page after ' + timeoutSeconds + 's');
  if (lastState) console.log('LAST ' + JSON.stringify(lastState));
}

main().catch((error) => {
  console.error('ERROR: ' + error.message);
  process.exit(1);
});
