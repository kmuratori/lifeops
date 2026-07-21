# LifeOps

A locally-hosted, terminal-aesthetic personal command center. Tracks life
projects, maps them to long-term dreams, and surfaces insights without noise.

> See how today's work feeds tomorrow's life.

## Quickstart

```bash
cd lifeops
pip install -r requirements.txt
python main.py
# or: python cli.py serve
```

Open **http://localhost:7070**. Data lives in `~/.local/share/lifeops/data.db`
(SQLite, created automatically on first run). No internet required — the only
external call is loading Chart.js from a CDN in your browser for the charts;
everything else is fully local.

### LAN access

By default the server binds to localhost only. To reach it from other devices
on your home network:

```bash
LIFEOPS_LAN=true python cli.py serve
```

### Custom port / DB path

```bash
LIFEOPS_PORT=8080 LIFEOPS_DB_PATH=/path/to/data.db python cli.py serve
```

## CLI

```bash
lifeops serve              # start the web server
lifeops status              # print life score + active projects
lifeops area list           # list areas with current progress
lifeops task add            # interactive task creation
lifeops task done <id>      # mark a task complete
lifeops project list        # list active projects
lifeops backup               # export JSON snapshot to ~/lifeops_backup_*.json
lifeops import backup.json  # restore from a snapshot
lifeops export csv          # dump tasks/projects to CSV
```

Since there's no `lifeops` entry point installed yet, run these as:
```bash
python cli.py serve
python cli.py status
python cli.py task add
# etc.
```
To get the real `lifeops` command, add this to `setup.py` / `pyproject.toml`
as a console script, or just alias it:
```bash
alias lifeops="python /path/to/lifeops/cli.py"
```

## Data model

```
AREA -> PROJECT -> TASK

DREAM  (flat list, tags Areas, no structural weight)
```

An **Area** is a life dimension that exists indefinitely — Career, Learning,
Japan, Health & Sport. No finish line. A **Project** is anything with a
finish line, and belongs to one Area. A **Dream** is a flat inspirational
reference: it tags one or more Areas and is displayed with those Areas'
health rather than carrying its own progress value.

Progress rolls up automatically:
```
project.progress = tasks_done / tasks_total   (or progress_override if set)
area.progress    = average progress of its active projects
life_score       = average progress across all active Areas
```
See `db/crud.py` for the exact implementation.

## Quick Add syntax

Press `n` or click `[+] Quick Add` anywhere in the app:

```
add task "write MemSnap README" to MemSnap due friday
add project "CTF Training" under "Career"
done task "push VXLAN lab to GitHub"
```

Dates understood: `today`, `tomorrow`, `next week`, weekday names (`friday`
means the *next* friday), and `month day[, year]` (`july 20`, `jul 20 2027`).
If parsing fails, it falls back to the manual task form.

## Daily snapshots

A background scheduler (`scheduler.py`, APScheduler) writes one progress
snapshot per goal every day at midnight — this is what powers the
"Progress Over Time" chart in Insights. You can also trigger one manually
from the Insights view ("Take snapshot now") or via `POST /api/insights/snapshot`.

## Fonts

The design calls for self-hosted JetBrains Mono + Inter (no Google Fonts
ping). This build ships with system-font fallbacks (`ui-monospace` /
`-apple-system` etc.) so it works out of the box. To get the exact typefaces,
drop `.woff2` files into `frontend/assets/fonts/` and add `@font-face` rules
in `frontend/css/base.css` pointing at them — the CSS variables
(`--font-display`, `--font-body`, `--font-data`) already reference the right
family names, so no other changes are needed.

## What's built vs. what's still open

Implemented (phases 0–4 of the spec):
- Full CRUD for Dreams / Goals / Projects / Tasks
- Progress calculation cascade + Life Score
- Dashboard with radar chart, focus suggestion, streak, upcoming/recent lists
- Dreams / Goals / Projects / Tasks views, incl. slide-in project detail panel
  with sparkline, and drag-and-drop Kanban
- Insights view: progress-over-time, effort distribution, completion rate,
  radar, Dream ROI table, Dead Weight bottleneck detector
- Quick Add with natural-language date/command parsing
- CLI (serve / status / task add / task done / project list / backup /
  import / export csv)
- Daily snapshot scheduler

Reasonable follow-ups if you keep building:
- Alembic migrations (currently `create_all` on boot — fine for a single-user
  local app, but Alembic is worth wiring in before the schema changes much)
- Markdown rendering for project notes/description (currently plain text)
- Per-project-to-goal weighting UI (the model supports it; forms don't expose
  a weight input yet, they default to equal weight)
- Real font files for the fully offline typography experience
