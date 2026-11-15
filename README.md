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
(SQLite, created automatically on first run). The app does not require an
account, hosted backend, or calendar integration. Chart.js and Marked are
loaded from CDNs for charts and notes; the rest of the app and its data run
locally.

### Replit

The app runs as its own web workflow. Its working database is ignored by Git
and stored at `lifeops/data/lifeops.db`; do not point this workflow at a
production or shared database.

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
                     \
                      (optional: standalone task)

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

Press `n` or click `+ Quick Add` anywhere in the app:

```
add task "write MemSnap README" to MemSnap due friday
add task "buy groceries" due tomorrow
add project "CTF Training" under "Career"
done task "push VXLAN lab to GitHub"
add habit "Read" daily
add habit "Run" every monday wednesday friday
done habit "Read"
```

Dates understood: `today`, `tomorrow`, `next week`, weekday names (`friday`
means the *next* friday), and `month day[, year]` (`july 20`, `jul 20 2027`).
Quick Add offers command suggestions even when empty, and entity suggestions
include relationship context and a short ID so duplicate names can be
distinguished. Up/Down navigates suggestions, Enter selects the active
suggestion, and Escape dismisses the list. Unmatched names can still be entered.
If a command is incomplete, Quick Add offers the matching full form.

Keyboard help is available from the **Keyboard** button. In habit tracking,
Tab enters the weekly grid, arrow keys move between scheduled days and habits,
Enter or Space toggles the focused day, and `O` opens habit details. Focus has
its own high-contrast outline; today, completed, missed, and unscheduled days
have distinct visual states. Unscheduled days are never treated as missed.

## Data safety and imports

- Tasks may be standalone (`project_id` is empty) or belong to a project.
  Standalone tasks do not affect project or area progress.
- Existing databases are backed up to a sibling file ending in
  `.pre-standalone-tasks.bak` before the task relationship migration. The
  migration preserves existing task rows and makes only the project link
  optional.
- Selective JSON exports can include chosen entity types and all, active, or
  selected projects. Project-linked tasks are not included with a Projects-only
  export unless requested; progress snapshots have a separate option.
  Standalone tasks are retained whenever Tasks are exported. Habit logs are
  included with Habits, and Dream-Area links are included when both types are
  selected.
- Imports are validated and previewed before commit. Conflicts can be skipped
  or replaced, and the preview changes when the conflict policy changes.
  Relationship and ID conflicts are rechecked at commit. Replace-all is
  available only for a complete, versioned LifeOps backup and requires a
  separate confirmation. Partial exports can refer to parent records that are
  not included; the import preview reports those missing parents.
- Projects with tasks or snapshots and areas with projects cannot be deleted
  until those records are handled. Bulk project deletes follow the same guard.
- The Calendar view uses LifeOps data only; Google Calendar sync is not part of
  this build.

Run the automated core checks with:

```bash
cd lifeops
PYTHONPATH=. python -m unittest discover -s tests -v
node --test tests/habit_keyboard.test.cjs
```

### Migration recovery

Before upgrading an existing local database, stop LifeOps and make a separate
copy of the SQLite file. The standalone-task migration also creates a sibling
`.pre-standalone-tasks.bak` before rebuilding the `tasks` table. If the app
cannot start after the migration, stop it, preserve both files, then restore
the backup over the active database path (by default
`~/.local/share/lifeops/data.db`) and restart. When using `LIFEOPS_DB_PATH`,
restore the backup matching that configured path. Do not restore over a
database that has received new work since the backup was made.

## Future calendar integration

Task due dates remain separate from scheduled event start and end times. The
local calendar reads LifeOps records only; no Google OAuth, credentials, or
sync jobs are included. A future provider integration can map stable internal
task and habit IDs to external identifiers without putting provider tokens in
normal backups.

## Daily snapshots

A background scheduler (`scheduler.py`, APScheduler) writes one progress
snapshot per project every day at 23:59 — this is what powers the
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

## Included features

- Areas, dreams, projects, tasks, and habits with their progress and history
- Standalone task creation, filtering, association, and bulk actions
- Context-aware Quick Add suggestions and natural-language task dates
- Bulk task and project operations, with dependency-aware deletion guards
- Habit tracking with keyboard navigation and undo feedback
- Full backup/restore, selective versioned JSON export, CSV export, and
  validated import preview
- Dark, light, and system themes; responsive navigation; app-styled dialogs
- Local SQLite storage, daily snapshots, and the CLI
