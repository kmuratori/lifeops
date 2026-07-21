import re
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m
from api.schemas import TaskIn, TaskOut, TaskUpdate, QuickAddIn

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
HABIT_WEEKDAY_MAP = {name: i for i, name in enumerate(WEEKDAYS)}


def _to_out(t: m.Task) -> TaskOut:
    area_color = None
    project_title = None
    if t.project:
        project_title = t.project.title
        if t.project.area:
            area_color = t.project.area.color
    return TaskOut(
        id=t.id,
        project_id=t.project_id,
        title=t.title,
        status=t.status.value if hasattr(t.status, "value") else t.status,
        priority=t.priority.value if hasattr(t.priority, "value") else t.priority,
        due_date=t.due_date,
        completed_at=t.completed_at,
        effort=t.effort,
        notes=t.notes,
        project_title=project_title,
        area_color=area_color,
    )


@router.get("", response_model=list[TaskOut])
def list_tasks(db: Session = Depends(get_db)):
    return [_to_out(t) for t in db.query(m.Task).all()]


@router.post("", response_model=TaskOut)
def create_task(payload: TaskIn, db: Session = Depends(get_db)):
    task = m.Task(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: str, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(m.Task).get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(task, k, v)
    if payload.status == "done" and not task.completed_at:
        task.completed_at = date.today()
    elif payload.status is not None and payload.status != "done":
        task.completed_at = None
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.delete("/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(m.Task).get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Quick Add — natural language command parsing
# ---------------------------------------------------------------------------

def _parse_date(text: str) -> Optional[date]:
    text = text.strip().lower()
    today = date.today()
    if text == "today":
        return today
    if text == "tomorrow":
        return today + timedelta(days=1)
    if text == "next week":
        return today + timedelta(days=7)
    if text in WEEKDAYS:
        target = WEEKDAYS.index(text)
        delta = (target - today.weekday()) % 7
        delta = delta or 7
        return today + timedelta(days=delta)
    m1 = re.match(r"([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?", text)
    if m1 and m1.group(1) in MONTHS:
        month = MONTHS[m1.group(1)]
        day = int(m1.group(2))
        year = int(m1.group(3)) if m1.group(3) else today.year
        try:
            d = date(year, month, day)
            if d < today and not m1.group(3):
                d = date(year + 1, month, day)
            return d
        except ValueError:
            return None
    return None


@router.post("/quick-add")
def quick_add(payload: QuickAddIn, db: Session = Depends(get_db)):
    text = payload.text.strip()

    # --- done task ---
    m_done = re.match(r'done\s+task\s+"([^"]+)"', text, re.IGNORECASE)
    if m_done:
        title = m_done.group(1)
        task = db.query(m.Task).filter(m.Task.title.ilike(f"%{title}%")).first()
        if not task:
            return {"parsed": True, "ok": False, "message": f'No task matching "{title}"'}
        task.status = m.TaskStatus.done
        task.completed_at = date.today()
        db.commit()
        return {"parsed": True, "ok": True, "message": f'Marked "{task.title}" done'}

    # --- add task ---
    m_task = re.match(
        r'add\s+task\s+"([^"]+)"\s+to\s+([^"]+?)(?:\s+due\s+(.+))?$', text, re.IGNORECASE
    )
    if m_task:
        title, project_name, due_str = m_task.groups()
        project = db.query(m.Project).filter(m.Project.title.ilike(f"%{project_name.strip()}%")).first()
        if not project:
            return {"parsed": True, "ok": False, "message": f'No project matching "{project_name.strip()}"'}
        due = _parse_date(due_str) if due_str else None
        task = m.Task(project_id=project.id, title=title, due_date=due)
        db.add(task)
        db.commit()
        return {"parsed": True, "ok": True, "message": f'Added task "{title}" to {project.title}'}

    # --- add project ---
    m_proj = re.match(r'add\s+project\s+"([^"]+)"\s+under\s+"([^"]+)"', text, re.IGNORECASE)
    if m_proj:
        title, area_name = m_proj.groups()
        area = db.query(m.Area).filter(m.Area.title.ilike(f"%{area_name}%")).first()
        if not area:
            return {"parsed": True, "ok": False, "message": f'No area matching "{area_name}"'}
        project = m.Project(title=title, area_id=area.id)
        db.add(project)
        db.commit()
        return {"parsed": True, "ok": True, "message": f'Added project "{title}" under {area.title}'}

    # --- done habit ---
    m_done_habit = re.match(r'done\s+habit\s+"([^"]+)"', text, re.IGNORECASE)
    if m_done_habit:
        title = m_done_habit.group(1)
        habit = db.query(m.Habit).filter(m.Habit.title.ilike(f"%{title}%"),
                                          m.Habit.status != "archived").first()
        if not habit:
            return {"parsed": True, "ok": False, "message": f'No habit matching "{title}"'}
        today = date.today()
        log = db.query(m.HabitLog).filter(m.HabitLog.habit_id == habit.id,
                                           m.HabitLog.date == today).first()
        if log:
            log.done = 1
        else:
            db.add(m.HabitLog(habit_id=habit.id, date=today, done=1))
        db.commit()
        return {"parsed": True, "ok": True, "message": f'Logged "{habit.title}" as done today'}

    # --- add habit "title" daily ---
    m_habit_daily = re.match(r'add\s+habit\s+"([^"]+)"\s+daily', text, re.IGNORECASE)
    if m_habit_daily:
        title = m_habit_daily.group(1)
        habit = m.Habit(title=title, frequency="daily")
        db.add(habit)
        db.commit()
        return {"parsed": True, "ok": True, "message": f'Added daily habit "{title}"'}

    # --- add habit "title" every monday wednesday friday ---
    m_habit_custom = re.match(r'add\s+habit\s+"([^"]+)"\s+every\s+(.+)', text, re.IGNORECASE)
    if m_habit_custom:
        title = m_habit_custom.group(1)
        days_str = m_habit_custom.group(2).lower().strip()
        day_nums = []
        for word in re.split(r'[\s,]+', days_str):
            if word in HABIT_WEEKDAY_MAP:
                day_nums.append(str(HABIT_WEEKDAY_MAP[word]))
        if day_nums:
            target_days = ",".join(day_nums)
            habit = m.Habit(title=title, frequency="custom", target_days=target_days)
            db.add(habit)
            db.commit()
            return {"parsed": True, "ok": True, "message": f'Added habit "{title}" on {days_str}'}

    return {"parsed": False, "ok": False, "message": "Could not parse — use the form below"}
