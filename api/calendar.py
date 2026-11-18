"""Calendar endpoints: the legacy month view and unified items API."""
import calendar as cal_module
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from db.session import get_db
from db import models as m
from api.habits import is_scheduled

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("")
def get_calendar(month: str = Query(..., description="YYYY-MM"), db: Session = Depends(get_db)):
    try:
        year, mon = int(month[:4]), int(month[5:7])
    except Exception:
        return {}

    # Build list of days in the month
    _, days_in_month = cal_module.monthrange(year, mon)
    month_start = date(year, mon, 1)
    month_end = date(year, mon, days_in_month)

    result: dict[str, dict] = {}
    for i in range(days_in_month):
        d = month_start + timedelta(days=i)
        result[d.isoformat()] = {"tasks": [], "projects": [], "habits": []}

    # Tasks with due_date in this month
    tasks = (
        db.query(m.Task)
        .filter(m.Task.due_date >= month_start, m.Task.due_date <= month_end)
        .all()
    )
    for t in tasks:
        key = t.due_date.isoformat()
        if key in result:
            area_color = None
            if t.project and t.project.area:
                area_color = t.project.area.color
            result[key]["tasks"].append({
                "id": t.id,
                "title": t.title,
                "status": t.status.value if hasattr(t.status, "value") else t.status,
                "priority": t.priority.value if hasattr(t.priority, "value") else t.priority,
                "project_title": t.project.title if t.project else "Standalone",
                "area_color": area_color,
            })

    # Projects with target_date in this month
    projects = (
        db.query(m.Project)
        .filter(m.Project.target_date >= month_start, m.Project.target_date <= month_end)
        .all()
    )
    for p in projects:
        key = p.target_date.isoformat()
        if key in result:
            result[key]["projects"].append({
                "id": p.id,
                "title": p.title,
                "status": p.status.value if hasattr(p.status, "value") else p.status,
                "area_color": p.area.color if p.area else None,
            })

    # Habits — scheduled days in this month
    habits = db.query(m.Habit).filter(m.Habit.status != "archived").all()
    # Fetch logs for this month (and one extra month forward per spec)
    next_month_end = (date(year if mon < 12 else year + 1, (mon % 12) + 1, 1) + timedelta(days=31))
    for habit in habits:
        logs_by_date = {
            log.date: log.done
            for log in habit.logs
            if month_start <= log.date <= next_month_end
        }
        color = habit.color or (habit.area.color if habit.area else None)
        for i in range(days_in_month):
            d = month_start + timedelta(days=i)
            if is_scheduled(habit, d):
                key = d.isoformat()
                result[key]["habits"].append({
                    "id": habit.id,
                    "title": habit.title,
                    "color": color,
                    "done": bool(logs_by_date.get(d, 0)),
                })

    return result


@router.get("/items")
def get_calendar_items(
    start: date = Query(..., description="Inclusive range start, YYYY-MM-DD"),
    end: date = Query(..., description="Inclusive range end, YYYY-MM-DD"),
    types: str = Query("event,task,project", description="Comma-separated event,task,project filters"),
    db: Session = Depends(get_db),
):
    """Return unified event, task-occurrence, and project-period calendar items."""
    if end < start:
        raise HTTPException(422, "end must be on or after start")
    selected_types = {value.strip() for value in types.split(",") if value.strip()}
    allowed_types = {"event", "task", "project"}
    if not selected_types or selected_types - allowed_types:
        raise HTTPException(422, "types must contain event, task, and/or project")

    items = []
    if "event" in selected_types:
        lower_utc = datetime.combine(start, time.min, tzinfo=timezone.utc).replace(tzinfo=None)
        upper_utc = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc).replace(tzinfo=None)
        events = (
            db.query(m.Event)
            .filter(or_(
                and_(m.Event.is_all_day.is_(True),
                     m.Event.start_date <= end, m.Event.end_date > start),
                and_(m.Event.is_all_day.is_(False),
                     m.Event.start_at < upper_utc, m.Event.end_at > lower_utc),
            ))
            .order_by(m.Event.is_all_day.desc(), m.Event.start_date, m.Event.start_at, m.Event.title)
            .all()
        )
        for event in events:
            items.append({
                "type": "event",
                "id": event.id,
                "title": event.title,
                "description": event.description,
                "is_all_day": event.is_all_day,
                "start_at": _utc_iso(event.start_at),
                "end_at": _utc_iso(event.end_at),
                "start_date": event.start_date.isoformat() if event.start_date else None,
                "end_date": event.end_date.isoformat() if event.end_date else None,
                "location": event.location,
                "category": event.category,
                "color": event.color,
            })

    if "task" in selected_types:
        tasks = (
            db.query(m.Task)
            .options(joinedload(m.Task.project).joinedload(m.Project.area))
            .filter(or_(
                m.Task.planning_date.between(start, end),
                m.Task.due_date.between(start, end),
            ))
            .all()
        )
        for task in tasks:
            planning = task.planning_date
            due = task.due_date
            occurrences = []
            if planning == due and planning is not None:
                if start <= planning <= end:
                    occurrences.append((planning, "planning_and_due"))
            else:
                if planning is not None and start <= planning <= end:
                    occurrences.append((planning, "planning"))
                if due is not None and start <= due <= end:
                    occurrences.append((due, "due"))
            for occurrence_date, occurrence in occurrences:
                items.append({
                    "type": "task",
                    "id": task.id,
                    "title": task.title,
                    "status": task.status.value if hasattr(task.status, "value") else task.status,
                    "date": occurrence_date.isoformat(),
                    "occurrence": occurrence,
                    "project_id": task.project_id,
                    "project_title": task.project.title if task.project else None,
                    "area_color": task.project.area.color if task.project and task.project.area else None,
                    "planning_date": planning.isoformat() if planning else None,
                    "due_date": due.isoformat() if due else None,
                })

    if "project" in selected_types:
        project_filter = or_(
            and_(m.Project.start_date.is_not(None), m.Project.target_date.is_not(None),
                 m.Project.start_date <= end, m.Project.target_date >= start),
            and_(m.Project.start_date.is_not(None), m.Project.target_date.is_(None),
                 m.Project.start_date.between(start, end)),
            and_(m.Project.start_date.is_(None), m.Project.target_date.is_not(None),
                 m.Project.target_date.between(start, end)),
        )
        projects = (
            db.query(m.Project)
            .options(joinedload(m.Project.area))
            .filter(project_filter)
            .order_by(m.Project.start_date, m.Project.target_date, m.Project.title)
            .all()
        )
        for project in projects:
            items.append({
                "type": "project",
                "id": project.id,
                "title": project.title,
                "status": project.status.value if hasattr(project.status, "value") else project.status,
                "start_date": project.start_date.isoformat() if project.start_date else None,
                "target_date": project.target_date.isoformat() if project.target_date else None,
                "area_id": project.area_id,
                "area_title": project.area.title if project.area else None,
                "area_color": project.area.color if project.area else None,
            })

    items.sort(key=lambda item: (
        item.get("date") or item.get("start_date") or
        (item.get("start_at", "")[:10] if item.get("start_at") else ""),
        {"event": 0, "task": 1, "project": 2}.get(item["type"], 3),
        item["title"].casefold(),
        item["id"],
    ))
    return {"items": items}


def _utc_iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()
