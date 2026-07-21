"""DB operations + progress calculation for the Area x Project x Task model."""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from db import models as m


# ---------------------------------------------------------------------------
# Progress calculation
# ---------------------------------------------------------------------------

def project_progress(db: Session, project: m.Project) -> float:
    """project.progress = tasks_done / tasks_total, or manual override if set."""
    if project.progress_override is not None:
        return project.progress_override
    tasks = project.tasks
    if not tasks:
        return 0.0
    done = sum(1 for t in tasks if t.status == m.TaskStatus.done)
    return done / len(tasks)


def area_progress(db: Session, area: m.Area) -> float:
    """area.progress = average progress of its active projects."""
    active_projects = [p for p in area.projects if p.status == m.ProjectStatus.active]
    if not active_projects:
        return 0.0
    return sum(project_progress(db, p) for p in active_projects) / len(active_projects)


def life_score(db: Session) -> float:
    """life_score = average progress across all active Areas.
    Dreams carry no structural weight, so they don't factor in here."""
    areas = db.query(m.Area).filter(m.Area.status == m.AreaStatus.active).all()
    if not areas:
        areas = db.query(m.Area).all()
    if not areas:
        return 0.0
    return sum(area_progress(db, a) for a in areas) / len(areas)


# ---------------------------------------------------------------------------
# Snapshot / insight helpers
# ---------------------------------------------------------------------------

def take_snapshot_for_date(db: Session, target_date: date):
    """Write one Snapshot row per project for the given date."""
    projects = db.query(m.Project).all()
    for p in projects:
        tasks_total = len(p.tasks)
        tasks_done = sum(1 for t in p.tasks if t.status == m.TaskStatus.done)
        progress = project_progress(db, p)
        existing = (
            db.query(m.Snapshot)
            .filter(m.Snapshot.project_id == p.id, m.Snapshot.date == target_date)
            .first()
        )
        if existing:
            existing.progress = progress
            existing.tasks_done = tasks_done
            existing.tasks_total = tasks_total
        else:
            db.add(m.Snapshot(
                project_id=p.id, date=target_date, progress=progress,
                tasks_done=tasks_done, tasks_total=tasks_total,
            ))
    db.commit()


def take_daily_snapshot(db: Session):
    """Write one Snapshot row per project for today."""
    take_snapshot_for_date(db, date.today())


def get_missing_snapshot_dates(db: Session) -> list[date]:
    """Return dates (up to yesterday) for which no snapshots exist, sorted oldest-first."""
    # Find the earliest snapshot date
    from sqlalchemy import func
    oldest = db.query(func.min(m.Snapshot.date)).scalar()
    if not oldest:
        return []

    yesterday = date.today() - timedelta(days=1)
    if oldest > yesterday:
        return []

    # Collect all dates that have at least one snapshot
    existing_dates = set(
        row[0] for row in db.query(m.Snapshot.date).distinct().all()
    )

    missing = []
    cursor = oldest
    while cursor <= yesterday:
        if cursor not in existing_dates:
            missing.append(cursor)
        cursor += timedelta(days=1)

    return sorted(missing)


def run_catchup_snapshots(db: Session):
    """Catch up on missed daily snapshots.

    Rule: for each contiguous run of missed dates, if the run is longer than 3,
    only take a snapshot for the last date in the run. Otherwise take all.
    """
    missing = get_missing_snapshot_dates(db)
    if not missing:
        return

    # Group into contiguous runs
    runs: list[list[date]] = []
    current_run: list[date] = [missing[0]]
    for d in missing[1:]:
        if d == current_run[-1] + timedelta(days=1):
            current_run.append(d)
        else:
            runs.append(current_run)
            current_run = [d]
    runs.append(current_run)

    for run in runs:
        if len(run) > 2:
            # Only snapshot the last date in the run
            take_snapshot_for_date(db, run[-1])
        else:
            for d in run:
                take_snapshot_for_date(db, d)


def bottleneck_projects(db: Session, days: int = 14):
    """'Dead Weight' detector: >30% blocked/critical tasks and no progress in `days`."""
    cutoff = date.today() - timedelta(days=days)
    results = []
    for p in db.query(m.Project).filter(m.Project.status == m.ProjectStatus.active).all():
        tasks = p.tasks
        if not tasks:
            continue
        stuck = sum(
            1 for t in tasks
            if t.status == m.TaskStatus.blocked or t.priority == m.TaskPriority.critical
        )
        if stuck / len(tasks) <= 0.3:
            continue
        recent_completion = any(t.completed_at and t.completed_at >= cutoff for t in tasks)
        if not recent_completion:
            results.append(p)
    return results
