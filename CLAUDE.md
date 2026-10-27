# daymark

Self-hosted tasks + habits + reminders app (Google-Tasks style). Node 22.13+ with built-in `node:sqlite`, vanilla JS frontend in `web/` (no build step), only dep is `web-push`. Tests: `npm test` (run on remote).

## Execution environment
- Code lives and is edited on this machine (home server). Secrets (.env, API keys, git tokens) never leave it.
- Heavy work (builds, test suites, data processing, CPU-bound jobs) runs on `college-dev` (the college server, as user `nakuldev`: no sudo, no docker)
  (Ryzen 5 8500G, 12 threads, 14 GB RAM, NO GPU/CUDA) via the `remote-run` command (`~/bin/remote-run`):
  - `remote-run run <name> "<command>"` syncs code and starts the job in tmux
  - `remote-run log <name>` checks progress; the log ends with `[exit N]` when finished
  - `remote-run status`, `remote-run stop <name>`, `remote-run pull [dir]`
  - `remote-run sh "<cmd>"` for quick one-off commands in the remote project dir
- Jobs should write results to `outputs/`, then use `remote-run pull` to bring them back.
- Remote tools: Node 24 + npm (`~/work/tools/bin`, on PATH via remote-run), Python 3.14 (`python3 -m venv .venv`), git. `node_modules`/`.venv` stay remote: install + run + test there. `sh` does not sync; use `run` for long commands.
- On the college server, never change Dokploy: read only, and only if needed. `college-dev` cannot run sudo or docker by design. Write only inside `~/work/<project>` (what remote-run syncs to). Do not use the `college-server` (deploy) login; it is for the user's admin work only.
- Do not copy secrets to the remote or write them into remote files. Other people have root there.
  If a job needs a key, ask me first. Extra files to keep off the remote go in `.remoteignore`.
- Quick things (formatting, small scripts, git) run locally. Don't use the remote for trivial tasks.
- Large datasets should be downloaded directly on the remote, not rsynced through the tunnel.
- If ssh to college-dev hangs, run `ssh -O exit college-dev` (drops the shared connection) and retry.
