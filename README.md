# ETLab2ICS

Publishes your **ETLab student calendar** as a standard iCalendar feed that
Thunderbird (or Apple Calendar, Google Calendar, GNOME Calendar) can subscribe
to and refresh on its own.

ETLab has no feed: the calendar is a JSON endpoint behind your login, and its
own JavaScript bundles contain no `.ics`, `webcal` link or `VCALENDAR` output
anywhere. So this runs a small server on **your** machine, calls the portal with
your session, and re-serves the events at a local URL:

```
http://127.0.0.1:8787/etlab.ics
```

No account, no cloud service, no dependency. One file of logic plus a local
server, ~350 lines.

---

## Requirements

- **Node.js 18 or newer** (`node -v`). No npm packages are needed — not even for
  the tests.
- Any calendar client that can subscribe to a URL (Thunderbird, Apple Calendar,
  Google Calendar, GNOME Calendar, KDE KOrganizer…).
- Windows only for the optional autostart step. Everything else is
  cross-platform.

---

## Quick start

```bash
git clone <your-repo-url> ETLab2ICS
cd ETLab2ICS
npm start
```

Then:

1. Open **http://127.0.0.1:8787/setup**
2. Log in to `students.etlab.app`, press **F12 → Console**, and run:
   ```js
   copy(localStorage.access_token)
   copy(JSON.parse(localStorage.user_data).institute_id)
   ```
3. Paste both values into the form and press **Save and fetch calendar**.

You should land on the status page showing `Events: 125` (or however many your
college has).

### Add it to Thunderbird

**New Calendar → On the Network →**

```
http://127.0.0.1:8787/etlab.ics
```

Right-click the new calendar → **Properties** → refresh interval **30 minutes**.

The feed asks clients to refresh every 30 minutes on its own, but Thunderbird's
per-calendar setting wins, so set it explicitly.

---

## Autostart (Windows, optional)

```bash
npm run install:autostart
```

Installs a hidden supervisor to
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ETLab Calendar Bridge.vbs`.
It starts the bridge at every logon with no console window and restarts it if it
exits (verified: killing the process brings it back in ~15 s).

The launcher records your current folder and Node path — **re-run it if you move
this folder.** Remove it with:

```bash
npm run install:autostart -- --remove
```

On macOS/Linux, start `node calendar-bridge.mjs` from your session autostart
(systemd user unit, launchd agent, or your desktop environment's startup apps).

---

## How often it talks to the portal

- **Nothing polls.** Events are re-fetched only when a client requests the feed
  and the cached data is older than 30 minutes — roughly two requests per hour.
- One refresh = 8 small requests (last month through 6 months ahead), issued in
  parallel, each with a 15-second timeout, so a stalled connection can't hang a
  Thunderbird refresh.
- If the session expires or the portal errors, the **last good calendar keeps
  being served** and the status page reports the error.

---

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /etlab.ics` | The feed (`text/calendar`), with `X-Event-Count` |
| `GET /` | Human-readable status page |
| `GET /setup` | Form to paste a session token |
| `POST /api/session` | Accepts `token` + `instituteId` as JSON or form-encoded |
| `GET /api/status` | `{connected, events, lastRefresh, lastError}` |

Upstream, this app calls:

```
GET https://api.students.etlab.app/api/v1/calendar?month=<0-11>&year=<yyyy>
Authorization: Bearer <access_token>
X-Institute-ID: <institute_id>
```

returning `[{id, title, description, date, type, is_holiday}]`.

---

## Security & privacy

- The server binds to **127.0.0.1 only** — unreachable from your network.
- Your token and fetched events live in `.etlab-session.json` and
  `.etlab-cache.json` in this folder. Both are **git-ignored** and never sent
  anywhere except your college's own API.
- The feed URL contains no credentials; anyone with local access to your machine
  could read the calendar by opening that URL.
- Nothing is uploaded, no telemetry, no accounts.

**Before pushing to GitHub:** `git status` must not show `.etlab-session.json`,
`.etlab-cache.json` or `.bridge.log`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Status page says not connected | No session yet | Open `/setup` and paste a fresh token |
| `session expired` in the log | The portal rotated the token | Redo `/setup` with a token from a fresh login |
| `http://127.0.0.1:8787` refuses to connect | Bridge not running | `npm start` |
| `Port 8787 is already in use` | A second copy was started | Nothing to do — the extra copy exits cleanly, one keeps serving |
| Thunderbird shows nothing | Calendar added but never refreshed | Right-click → Synchronise, and set the refresh interval |
| Feed is valid but empty | No events in those months | Normal for a quiet period |
| Autostart does nothing | Folder moved | `npm run install:autostart` again |

---

## What is verified

- The upstream endpoint returns real events; the bridge served **125 events**
  as `text/calendar` with balanced `BEGIN;/END:VEVENT`, unique UIDs, all-day
  `DATE` values, CRLF line endings and RFC 5545 folding at 75 octets.
- The supervisor restarts the process after a kill; a duplicate instance exits
  cleanly.
- 8 unit tests (`npm test`) cover ICS generation and escaping.

**Not verified:** importing the feed into a real Thunderbird profile, and the
`/setup` form path end-to-end (added when the calendar code was split out of the
companion extension; it uses the same `POST /api/session` route the extension
used).

---

## Limitations

- Unofficial, unaffiliated with ETLab / Etuwa Concepts. Use on your own account.
- If ETLab changes its API or header names, the bridge reports the error on its
  status page rather than guessing.
- Event descriptions are imported as plain text; attachments and recurrence rules
  aren't emitted because the portal doesn't provide them.
