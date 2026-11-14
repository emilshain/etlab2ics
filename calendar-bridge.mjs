/*
 * ETLab -> iCalendar bridge for Thunderbird
 * -----------------------------------------
 * Your college portal has no calendar feed (no .ics, no webcal) - the calendar
 * lives at https://api.students.etlab.app/api/v1/calendar?month=&year= behind
 * your login. This little local server fetches it and publishes a normal ICS
 * calendar that any client can subscribe to.
 *
 *   node calendar-bridge.mjs
 *
 * Then in Thunderbird: New Calendar -> On the Network ->
 *   http://127.0.0.1:8787/etlab.ics
 *
 * The session token is never hard-coded: press "Connect calendar" in the
 * extension popup, which hands the token from your logged-in tab to this
 * server and stores it locally in .etlab-session.json.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { toIcs } from './src/ics.js';

const PORT = Number(process.env.BRIDGE_PORT || 8787);
const API = 'https://api.students.etlab.app/api/v1';
const SESSION_FILE = '.etlab-session.json';
const CACHE_FILE = '.etlab-cache.json';

// Data is only re-fetched when a client actually asks for the calendar and the
// data is older than this. Nothing runs in the background, so the college API
// sees at most a couple of requests per hour.
const REFRESH_MS = 30 * 60 * 1000;
const LOG_FILE = '.bridge.log';

/* Log to the console and to a file. The file matters because the autostart
 * launcher runs with no console window. */
function log(line, isError) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  if (isError) console.error(msg);
  else console.log(msg);
  try {
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch (e) {
    /* logging must never break the bridge */
  }
}
const MONTHS_BACK = 1;
const MONTHS_AHEAD = 6;

let state = {
  events: [],
  ics: null,
  lastRefresh: null,
  lastError: null,
  session: null
};

/* ---------------------------------------------------------------- *
 * Session
 * ---------------------------------------------------------------- */

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

/* ---------------------------------------------------------------- *
 * Fetching
 * ---------------------------------------------------------------- */

function monthsToFetch(now = new Date()) {
  const list = [];
  const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  for (let offset = -MONTHS_BACK; offset <= MONTHS_AHEAD; offset++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
    list.push({ month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
  }
  return list;
}

async function fetchMonth(session, { month, year }) {
  const headers = { Authorization: 'Bearer ' + session.token, Accept: 'application/json' };
  if (session.instituteId) headers['X-Institute-ID'] = String(session.instituteId);

  // Time out instead of leaving a Thunderbird refresh hanging on a stalled
  // connection; the previous good copy stays served meanwhile.
  const res = await fetch(`${API}/calendar?month=${month}&year=${year}`, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('session-rejected');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${month}/${year}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

async function refresh() {
  const session = state.session || loadSession();
  if (!session || !session.token) {
    state.lastError = 'no session - press "Connect calendar" in the extension';
    return;
  }
  state.session = session;

  try {
    const months = monthsToFetch();
    const results = await Promise.all(
      months.map((m) =>
        fetchMonth(session, m).catch((error) => {
          if (error.message === 'session-rejected') throw error;
          return [];
        })
      )
    );

    const events = results.flat();
    events.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    state.events = events;
    state.ics = toIcs(events, { name: 'ETLab College Calendar' });
    state.lastRefresh = new Date();
    state.lastError = null;

    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ savedAt: state.lastRefresh.toISOString(), count: events.length, events })
    );
    log(`${events.length} events across ${months.length} months`);
  } catch (error) {
    state.lastError =
      error.message === 'session-rejected'
        ? 'your ETLab session expired - press "Connect calendar" in the extension again'
        : error.message;
    log('refresh failed: ' + state.lastError, true);
  }
}

function loadCache() {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(cached.events) && cached.events.length) {
      return { events: cached.events, savedAt: cached.savedAt };
    }
  } catch (e) {
    /* no cache yet */
  }
  return null;
}

/* ---------------------------------------------------------------- *
 * HTTP
 * ---------------------------------------------------------------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Chrome's Private Network Access: lets the extension / portal page talk to
  // this loopback server.
  'Access-Control-Allow-Private-Network': 'true'
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...CORS, ...extra });
  res.end(body);
}

function statusPage() {
  const connected = !!(state.session && state.session.token);
  const rows = [
    ['Connected', connected ? 'yes' : 'no'],
    ['Events', String(state.events.length)],
    ['Last refresh', state.lastRefresh ? state.lastRefresh.toLocaleString() : 'never'],
    ['Last error', state.lastError || 'none']
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>ETLab calendar bridge</title>
<style>body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;margin:32px;color:#1c2430}
code{background:#f4f6f9;padding:2px 5px;border-radius:4px}h1{font-size:18px}
td{padding:3px 14px 3px 0}</style></head><body>
<h1>ETLab calendar bridge</h1>
<table>${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
<p>Add this to Thunderbird (<b>New Calendar &rarr; On the Network</b>):<br>
<code>http://127.0.0.1:${PORT}/etlab.ics</code></p>
<p>${connected ? 'Session connected.' : 'Not connected yet - open <a href="/setup">/setup</a> and paste your session token.'}</p>
</body></html>`;
}

function setupPage(error) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>ETLab2ICS setup</title>
<style>body{font:14px/1.6 "Segoe UI",system-ui,sans-serif;margin:32px;max-width:660px;color:#1c2430}
label{display:block;font-weight:600;margin-top:14px}
textarea,input{width:100%;font:13px ui-monospace,Consolas,monospace;padding:8px;margin-top:4px;
border:1px solid #cfd6e0;border-radius:6px;box-sizing:border-box}
button{font:600 14px system-ui;padding:9px 16px;margin-top:18px;border:0;border-radius:6px;
background:#24405e;color:#fff;cursor:pointer}
code,pre{background:#f4f6f9;border-radius:4px}code{padding:2px 5px}pre{padding:8px;overflow:auto}
.err{color:#a3232b;font-weight:600}li{margin:6px 0}</style></head><body>
<h1>Connect your ETLab calendar</h1>
${error ? `<p class="err">${error}</p>` : ''}
<ol>
<li>Log in at <code>students.etlab.app</code>.</li>
<li>Press <b>F12</b> &rarr; <b>Console</b> and run:<pre>copy(localStorage.access_token)
copy(JSON.parse(localStorage.user_data).institute_id)</pre></li>
<li>Paste the two values below.</li>
</ol>
<form method="post" action="/api/session">
  <label>Session token</label>
  <textarea name="token" rows="3" required></textarea>
  <label>Institute ID</label>
  <input name="instituteId" required>
  <button type="submit">Save and fetch calendar</button>
</form>
<p>Stored only in <code>.etlab-session.json</code> on this machine.</p>
</body></html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    return send(res, 204, '');
  }

  if (url.pathname === '/etlab.ics') {
    const stale =
      !state.lastRefresh || Date.now() - new Date(state.lastRefresh).getTime() > REFRESH_MS;
    if (stale) await refresh();
    if (!state.ics) await refresh();
    if (!state.ics) {
      const cached = loadCache();
      if (cached) {
        state.events = cached.events;
        state.ics = toIcs(cached.events, { name: 'ETLab College Calendar' });
      }
    }
    if (!state.ics) {
      return send(res, 503, `No calendar yet. Open http://127.0.0.1:${PORT}/setup and paste your session token.`);
    }
    return send(res, 200, state.ics, 'text/calendar; charset=utf-8', {
      'Content-Disposition': 'inline; filename="etlab.ics"',
      'X-Event-Count': String(state.events.length)
    });
  }

  if (url.pathname === '/setup') {
    return send(res, 200, setupPage(), 'text/html; charset=utf-8');
  }

  if (url.pathname === '/api/session' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const isForm = (req.headers['content-type'] || '').includes('x-www-form-urlencoded');
    let parsed;
    if (isForm) {
      parsed = Object.fromEntries(new URLSearchParams(body));
    } else {
      try {
        parsed = JSON.parse(body || '{}');
      } catch (e) {
        return send(res, 400, 'invalid JSON');
      }
    }
    const token = String(parsed.token || '').trim();
    if (!token) {
      if (isForm) return send(res, 400, setupPage('Paste the session token first.'), 'text/html; charset=utf-8');
      return send(res, 400, 'missing token');
    }

    const session = {
      token,
      instituteId: parsed.instituteId || null,
      savedAt: new Date().toISOString()
    };
    saveSession(session);
    state.session = session;
    state.ics = null;
    await refresh();

    if (isForm) return send(res, 303, '', 'text/plain', { Location: '/?connected=1' });
    return send(res, 200, JSON.stringify({ ok: true, events: state.events.length, error: state.lastError }), 'application/json');
  }

  if (url.pathname === '/api/status') {
    return send(
      res,
      200,
      JSON.stringify({
        connected: !!(state.session && state.session.token),
        events: state.events.length,
        lastRefresh: state.lastRefresh,
        lastError: state.lastError
      }),
      'application/json'
    );
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, statusPage(), 'text/html; charset=utf-8');
  }

  return send(res, 404, 'not found');
}

/* ---------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------- */

// Keep the log from growing forever across months of restarts.
try {
  if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.truncateSync(LOG_FILE, 0);
} catch (e) {
  /* no log yet */
}

const session = loadSession();
if (session) state.session = session;

const cached = loadCache();
if (cached) {
  state.events = cached.events;
  state.ics = toIcs(cached.events, { name: 'ETLab College Calendar' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('request failed: ' + error.message);
    try {
      send(res, 500, 'bridge error: ' + error.message);
    } catch (e) {
      /* response already sent */
    }
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log(`Port ${PORT} is already in use - another bridge is running, exiting cleanly.`);
    process.exit(0);
  }
  log('server error: ' + error.message, true);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`ETLab calendar bridge on http://127.0.0.1:${PORT}/etlab.ics`);
  log(session ? 'Using saved session.' : `No session yet - open http://127.0.0.1:${PORT}/setup to connect.`);
  refresh(); // one fetch at boot; afterwards only when Thunderbird pulls
});
