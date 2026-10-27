# Daymark

Google-Tasks-style tasks + habits + reminders, self-hosted. Node + one SQLite file. No build step.
The only npm dependency is `web-push` (push notifications).

## Run
```
npm install
npm start                      # http://localhost:3000, no login
PASSWORD=secret npm start      # with login (PowerShell: $env:PASSWORD="secret"; npm start)
npm run dev                    # restart on server changes; frontend edits need only a browser refresh
npm test                       # time/recurrence, reminders, habits, quick-add tests
```
Needs Node 22.13+ (built-in `node:sqlite`).

## What's in it
**Like Google Tasks:** multiple lists, add/edit/complete/delete with Undo, details, date + time, repeat (daily/weekly on chosen days/monthly/yearly, every N), subtasks, star, move between lists, sort (my order / date / starred / title), drag to reorder (or Alt+↑/↓, or ↑↓ in the task dialog), delete all completed, My Day / Upcoming / Starred / All / Completed, search, keyboard shortcuts (`n` new task, `c` quick capture, `/` search), dark mode, mobile layout.
**From the plan:** Quick Capture inbox (→ task / archive / delete), reminders (several per task, relative or custom time) with in-app notification history + Web Push, daily summary, habits (check or measured, weekly goals like 14 h DSA, streaks, history), My Day with habits and importance/list filters, calendar, progress, installable PWA with offline fallback, daily backups + JSON export, login, health endpoint.

Quick-add examples: `Call mom tomorrow 5pm !`, `Submit report friday`.

## Deploy (home server)
Set `PASSWORD` (and optionally `COOKIE_SECURE`, `TZ_DEFAULT`; see `.env.example`). On Dokploy: create a Compose service from this repo, set those in the Environment tab, add a domain for service `daymark` port `3000`, enable Auto Deploy. On the home server with a Cloudflare Tunnel: `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build`, then point the tunnel at `http://127.0.0.1:8080`.
Push notifications and install-to-phone need HTTPS, so use the tunnel hostname. On iPhone, install to the Home Screen first.
**Backups:** `backups/` in the data volume (`data/backups/` when run locally) gets a daily copy (14 kept). Restore = stop the app, replace `daymark.sqlite` in the `daymark-data` volume with a backup. Copy the folder off the server too.

## Where to change things
| I want to...                          | Edit |
|---------------------------------------|------|
| Add/re-filter a sidebar task view     | `web/views.js` |
| Change how a task row / dialog looks  | `web/taskrow.js`, `web/taskdialog.js` |
| Add or change a page                  | `web/pages/*.js`, register in `web/app.js` (`PAGES`) |
| Change colours / layout               | `web/style.css` (variables at top) |
| Change what a user action does        | `web/actions.js` |
| Add a field to tasks                  | append a migration in `features/tasks/index.js`, add to `check()`, show in the dialog |
| Add a backend feature                 | copy a folder in `features/`, import it in `server.js` `FEATURES` |
| Remove a feature                      | delete it from `FEATURES` (data stays in the DB, harmless) |
| Change how habit streaks work         | `web/habitstats.js` (pure functions, tested) |
| Change reminder delivery rules        | `features/reminders/index.js` |

## Design choices
Single user, one password. Dates are plain `YYYY-MM-DD` strings in your timezone (Settings). The browser gets all data and filters locally. Database is SQLite (swap point: `core/db.js` + the SQL in `features/`); the plan chose Postgres, but for one user on a 4 GB box SQLite is lighter and the backup is one file.
