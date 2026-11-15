"""Feature 2: Calendar View — GET /api/calendar?month=YYYY-MM"""
import calendar as cal_module
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

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
