# ETLab2ICS

Publishes your **ETLab student calendar** as a standard iCalendar feed, so any
calendar application can show your classes, exams and holidays next to your other
events.

ETLab has no feed: the calendar is a JSON endpoint behind your login, and its own
JavaScript bundles contain no `.ics`, `webcal` link or `VCALENDAR` output
anywhere. So this runs a small server on **your** machine, calls the portal with
your session, and re-serves the events at a local URL:

```
http://127.0.0.1:8787/etlab.ics
```

No account, no cloud service, no dependencies — one file of logic plus Node's
built-in HTTP server.

- **Any calendar app**: Thunderbird, Apple Calendar, Outlook, Evolution, GNOME
  Calendar, KDE KOrganizer, Fantastical, Proton Calendar, Google Calendar…
- **Any OS**: Windows, macOS, Linux
- **Any ETLab institute** on `etlab.app` / `etlab.in` — nothing college-specific
  is hard-coded

> Surveys instead of calendars? That's the companion project
> [`ETLab Survey Skip`](https://github.com/emilshain/etlab-survey-skip). The two
> are independent: install either.

---

## How clients connect — read this first

The feed lives on **this computer** (`127.0.0.1`), which is the whole security
model: nothing is exposed to your network. That gives two ways to use it:

| Route | Who can use it | Updates itself? |
| --- | --- | --- |
| **Subscribe by URL** `http://127.0.0.1:8787/etlab.ics` | Only apps running on **this** machine | ✅ yes, on its own timer |
| **Import the `.ics` file** | Anything, including phones and web calendars | ❌ no — it's a snapshot |

Cloud calendars (Google Calendar's "From URL", Outlook.com) fetch the URL from
*their* servers, so they can never reach your localhost — for those, import the
file. Same for iOS/Android, unless you set up your own tunnel, which is out of
scope here and weakens the security model.

### Calendar clients

| Client | Platform | Subscribe by URL | Import file |
| --- | --- | --- | --- |
| Thunderbird | Win/mac/Linux | ✅ | ✅ |
| Apple Calendar | macOS | ✅ (on that Mac) | ✅ |
| Apple Calendar | iOS / iPadOS | ❌ (phone ≠ this PC) | ✅ |
| Outlook (desktop) | Windows / macOS | ✅ | ✅ |
| Outlook.com / Microsoft 365 | web | ❌ | ✅ |
| Google Calendar | web | ❌ | ✅ |
| GNOME Calendar / Evolution | Linux | ✅ | ✅ |
| KDE KOrganizer | Linux | ✅ | ✅ |
| Fantastical | macOS / iOS | ✅ on macOS | ✅ |
| Proton Calendar | web | ❌ | ✅ |
| Any RFC 5545 client | — | ✅ | ✅ |

**Subscribe (Thunderbird):** *New Calendar → On the Network →*
`http://127.0.0.1:8787/etlab.ics` → set refresh interval to 30 minutes.

**Subscribe (Apple Calendar, macOS):** *File → New Calendar Subscription →* paste
the URL → set "Refresh every" to 30 minutes.

**Import anywhere:** open `http://127.0.0.1:8787/etlab.ics` in a browser, save the
file as `etlab.ics`, then use the app's import (Google Calendar: *Settings →
Import & export*; Outlook: *File → Open & Export → Import an iCalendar*; iOS:
*Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar*).

---

## Requirements

- **Node.js 18 or newer** — `node -v`. Nothing else, no npm packages.

  | OS | Quickest install |
  | --- | --- |
  | Windows | `winget install OpenJS.NodeJS.LTS` |
  | macOS | `brew install node` |
  | Linux | your distro's `nodejs` package, or [nvm](https://github.com/nvm-sh/nvm) |

- Any calendar client from the table above.

---

## Quick start

```bash
git clone https://github.com/emilshain/etlab2ics.git
cd etlab2ics
npm start          # or: node calendar-bridge.mjs
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
college has). The session is stored locally and reused on every restart.

### Changing the port

```bash
BRIDGE_PORT=9000 npm start        # macOS / Linux
set BRIDGE_PORT=9000 && npm start # Windows cmd
$env:BRIDGE_PORT=9000; npm start  # Windows PowerShell
```

Then use `http://127.0.0.1:9000/etlab.ics`.

---

## Autostart

Run the bridge at every logon so your calendar never goes stale.

### Windows

```bash
npm run install:autostart
```

Installs a hidden supervisor to
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ETLab Calendar Bridge.vbs`.
It starts the bridge with no console window and restarts it if it exits
(verified: killing the process brings it back in ~15 s). It records your current
folder and Node path, so **re-run it if you move this folder**. Undo with
`npm run install:autostart -- --remove`.

### macOS (launchd)

`~/Library/LaunchAgents/com.emilshain.etlab2ics.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.emilshain.etlab2ics</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/node</string><string>/ABSOLUTE/PATH/calendar-bridge.mjs</string></array>
  <key>WorkingDirectory</key><string>/ABSOLUTE/PATH</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/com.emilshain.etlab2ics.plist`

### Linux (systemd user unit)

`~/.config/systemd/user/etlab2ics.service`:

```ini
[Unit]
Description=ETLab2ICS calendar bridge

[Service]
WorkingDirectory=%h/etlab2ics
ExecStart=/usr/bin/node calendar-bridge.mjs
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
```

`systemctl --user enable --now etlab2ics`

---

## How often it talks to the portal

- **Nothing polls.** Events are re-fetched only when a client asks for the feed
  and the cached data is older than 30 minutes — roughly two requests per hour.
- One refresh = 8 small requests (last month through 6 months ahead), in
  parallel, each with a 15-second timeout, so a stalled connection can't hang a
  calendar refresh.
- If the session expires or the portal errors, the **last good calendar keeps
  being served** and the status page reports why.
- The feed sends `ETag` + `X-PUBLISHED-TTL: PT30M` + `REFRESH-INTERVAL: PT30M`, so
  clients that honour them re-download only when something changed.

---

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /etlab.ics` | The feed (`text/calendar`), with `X-Event-Count`, `ETag`, `304` on revalidation |
| `GET /` | Human-readable status page |
| `GET /setup` | Form to paste a session token |
| `POST /api/session` | Accepts `token` + `instituteId` as JSON or form-encoded; refuses cross-site posts |
| `GET /api/status` | `{connected, events, lastRefresh, lastError}` |

Upstream, this calls:

```
GET https://api.students.etlab.app/api/v1/calendar?month=<0-11>&year=<yyyy>
Authorization: Bearer <access_token>
X-Institute-ID: <institute_id>
```

returning `[{id, title, description, date, type, is_holiday}]`.

---

## Development

```bash
npm test     # 18 tests: 8 ICS unit + 10 end-to-end HTTP
```

The HTTP suite starts a real server on a spare port in a temporary directory, so
it never touches your session or cache. CI runs the suite on Node 18, 20 and 22
for every push.

| File | Role |
| --- | --- |
| `calendar-bridge.mjs` | Server, session handling, lazy refresh |
| `src/ics.js` | Pure RFC 5545 generation (escaping, folding) — unit tested |
| `test/ics.test.mjs` | 8 tests: escaping, CRLF, folding, all-day dates, UIDs |
| `test/http.test.mjs` | 10 tests: routing, CSRF guard, ETag/304, 503, status JSON |
| `scripts/install-autostart.mjs` | Install/remove the Windows logon entry |

---

## Security & privacy

- Binds to **127.0.0.1 only** — unreachable from your network or the internet.
- The session token and cached events live in `.etlab-session.json` and
  `.etlab-cache.json` here. Both are **git-ignored**, written user-only, and sent
  nowhere except your college's own API.
- `POST /api/session` rejects cross-site requests (`Sec-Fetch-Site` / `Origin`),
  so a hostile page you visit can't overwrite your session.
- The feed URL carries no credentials, but anyone with local access to your
  machine could read your calendar by opening it.
- No telemetry, no accounts, no third-party services.

**Before pushing to a public repo:** `git status` must not show
`.etlab-session.json`, `.etlab-cache.json` or `.bridge.log`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Status page says not connected | No session yet | Open `/setup` and paste a fresh token |
| `session expired` in the log | The portal rotated the token | Redo `/setup` after logging in |
| `127.0.0.1:8787` refuses to connect | Bridge not running | `npm start` |
| `Port 8787 is already in use` | A second copy was started | Nothing to do — the extra copy exits cleanly, one keeps serving |
| Calendar shows nothing | Added but never refreshed | Sync now, and set the refresh interval to 30 min |
| Cloud calendar can't add the URL | Google/Outlook fetch server-side, can't see localhost | Import the `.ics` file instead |
| Feed is valid but empty | No events in those months | Normal for a quiet period |
| Autostart does nothing | Folder moved | Re-run the autostart install |
| Token worked, then stopped | Tokens expire | Paste a fresh one from the portal |

---

## What is verified

- The upstream endpoint returns real events; the bridge served **125 events** as
  `text/calendar` with balanced `BEGIN/END:VEVENT`, unique UIDs, all-day `DATE`
  values, CRLF endings and RFC 5545 folding at 75 octets.
- Live: `ETag` + `304` revalidation, `X-PUBLISHED-TTL`/`REFRESH-INTERVAL`,
  cross-site `POST /api/session` → `403`, same-origin → passes the guard.
- Autostart supervisor restarts after a kill; duplicate instance exits cleanly.
- 18 tests pass (8 ICS + 10 HTTP), and the server runs on Windows.

**Not verified:** importing the feed into each client listed above — the ICS is
validated structurally (RFC 5545) rather than by hand in every app, and neither
the macOS launchd nor Linux systemd snippets have been executed (they are
standard unit files).

---

## Limitations

- Unofficial and unaffiliated with ETLab / Etuwa Concepts. Use on your own account.
- If ETLab changes its API or header names, the bridge reports the error on its
  status page rather than guessing.
- All-day events only; the portal provides no times, recurrence rules or
  attachments.
- Phones and cloud calendars need the imported file, not the live URL.

Licensed under the [MIT License](LICENSE).
