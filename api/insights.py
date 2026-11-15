from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m, crud

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    today = date.today()
    week_end = today + timedelta(days=7)

    all_tasks = db.query(m.Task).all()
    due_today = [t for t in all_tasks if t.due_date == today and t.status != m.TaskStatus.done]
    due_week = [
        t for t in all_tasks
        if t.due_date and today <= t.due_date <= week_end and t.status != m.TaskStatus.done
    ]
    active_projects = db.query(m.Project).filter(m.Project.status == m.ProjectStatus.active).count()

    completed_dates = {t.completed_at for t in all_tasks if t.completed_at}
    streak = 0
    cursor = today
    while cursor in completed_dates:
        streak += 1
        cursor -= timedelta(days=1)

    recent_done = sorted(
        [t for t in all_tasks if t.completed_at and t.completed_at >= today - timedelta(days=7)],
        key=lambda t: t.completed_at, reverse=True,
    )
    upcoming = sorted(
        [t for t in all_tasks if t.due_date and today <= t.due_date <= today + timedelta(days=14)
         and t.status != m.TaskStatus.done],
        key=lambda t: t.due_date,
    )

    priority_rank = {"critical": 3, "high": 2, "medium": 1, "low": 0}
    candidates = [t for t in all_tasks if t.status == m.TaskStatus.blocked
                  or (t.due_date and t.due_date < today and t.status != m.TaskStatus.done)]
    focus = max(candidates, key=lambda t: priority_rank.get(
        t.priority.value if hasattr(t.priority, "value") else t.priority, 0
    ), default=None)

    # radar: one axis per Area (spec — replaces the old per-Dream axis)
    areas = db.query(m.Area).all()
    radar = [{"label": f"{(a.icon or '').strip()} {a.title}".strip(),
              "value": round(crud.area_progress(db, a) * 100, 1),
              "color": a.color} for a in areas]

    def task_out(t):
        return {"id": t.id, "title": t.title,
                "project_title": t.project.title if t.project else "Standalone",
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "priority": t.priority.value if hasattr(t.priority, "value") else t.priority}

    return {
        "life_score": round(crud.life_score(db) * 100, 1),
        "tasks_due_today": len(due_today),
        "tasks_due_week": len(due_week),
        "active_projects": active_projects,
        "streak": streak,
        "radar": radar,
        "recent_completed": [task_out(t) for t in recent_done[:8]],
        "upcoming_deadlines": [task_out(t) for t in upcoming[:8]],
        "focus_suggestion": task_out(focus) if focus else None,
    }


@router.get("/progress-over-time")
def progress_over_time(db: Session = Depends(get_db)):
    """One line per Project, last 90 days, from Snapshot table."""
    cutoff = date.today() - timedelta(days=90)
    snaps = db.query(m.Snapshot).filter(m.Snapshot.date >= cutoff).order_by(m.Snapshot.date).all()
    by_project = defaultdict(list)
    for s in snaps:
        by_project[s.project_id].append({"date": s.date.isoformat(), "progress": round(s.progress * 100, 1)})
    projects = {p.id: p.title for p in db.query(m.Project).all()}
    return [{"project_id": pid, "project_title": projects.get(pid, "?"), "points": pts}
            for pid, pts in by_project.items()]


@router.get("/effort-distribution")
def effort_distribution(db: Session = Depends(get_db)):
    """Tasks completed grouped by Area (donut chart) — replaces the old by-Dream grouping."""
    areas = db.query(m.Area).all()
    counts = []
    for a in areas:
        n = sum(
            1 for p in a.projects for t in p.tasks if t.status == m.TaskStatus.done
        )
        if n > 0:
            counts.append({"label": a.title, "value": n, "color": a.color or "#5e9cf5"})
    return counts


@router.get("/completion-rate")
def completion_rate(db: Session = Depends(get_db)):
    """Tasks planned vs done per week, last 8 weeks."""
    today = date.today()
    weeks = []
    all_tasks = db.query(m.Task).all()
    for i in range(7, -1, -1):
        week_start = today - timedelta(days=today.weekday() + i * 7)
        week_end = week_start + timedelta(days=6)
        planned = sum(1 for t in all_tasks if t.due_date and week_start <= t.due_date <= week_end)
        done = sum(1 for t in all_tasks if t.completed_at and week_start <= t.completed_at <= week_end)
        weeks.append({"week_start": week_start.isoformat(), "planned": planned, "done": done})
    return weeks


@router.get("/area-roi")
def area_roi(db: Session = Depends(get_db)):
    """For each Area: tasks completed, estimated hours invested, current progress.
    Replaces the old Dream ROI table — Areas are the structural layer now."""
    rows = []
    for a in db.query(m.Area).all():
        tasks_done = 0
        hours = 0
        for p in a.projects:
            for t in p.tasks:
                if t.status == m.TaskStatus.done:
                    tasks_done += 1
                    hours += t.effort or 0
        rows.append({
            "area": a.title, "icon": a.icon, "color": a.color,
            "tasks_done": tasks_done, "hours_invested": hours,
            "progress": round(crud.area_progress(db, a) * 100, 1),
        })
    return rows


@router.get("/bottlenecks")
def bottlenecks(db: Session = Depends(get_db)):
    """Dead Weight detector (spec 5.6.6)."""
    projects = crud.bottleneck_projects(db)
    out = []
    for p in projects:
        stuck = sum(1 for t in p.tasks if t.status == m.TaskStatus.blocked
                    or t.priority == m.TaskPriority.critical)
        out.append({
            "id": p.id, "title": p.title,
            "stuck_pct": round(100 * stuck / len(p.tasks), 1) if p.tasks else 0,
            "tasks_total": len(p.tasks),
        })
    return out


@router.post("/snapshot")
def trigger_snapshot(db: Session = Depends(get_db)):
    """Manually trigger a snapshot (normally run daily by the scheduler)."""
    crud.take_daily_snapshot(db)
    return {"ok": True}
