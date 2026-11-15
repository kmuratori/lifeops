import re
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m
from api.schemas import TaskIn, TaskOut, TaskUpdate, QuickAddIn, TaskBulkIn

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
    """Return tasks belonging to active projects (exclude standalone tasks)."""
    tasks = (
        db.query(m.Task)
        .join(m.Project, m.Task.project_id == m.Project.id)
        .filter(m.Project.status == "active")
        .all()
    )
    return [_to_out(t) for t in tasks]


@router.get("/suggestions")
def task_suggestions(q: str = "", db: Session = Depends(get_db)):
    """Small contextual suggestion list for the keyboard-first Quick Add field."""
    query = q.strip()
    lower = query.lower()
    commands = [
        {"kind": "command", "title": 'add task "title"', "detail": "Create a standalone task", "insert_text": 'add task "'},
        {"kind": "command", "title": 'add task "title" to project', "detail": "Create a task in a project", "insert_text": 'add task "'},
        {"kind": "command", "title": 'add project "title" under area', "detail": "Create a project", "insert_text": 'add project "'},
        {"kind": "command", "title": 'done task "title"', "detail": "Complete a task", "insert_text": 'done task "'},
        {"kind": "command", "title": 'add habit "title" daily', "detail": "Create a daily habit", "insert_text": 'add habit "'},
        {"kind": "command", "title": 'add habit "title" every monday wednesday friday', "detail": "Create a scheduled habit", "insert_text": 'add habit "'},
        {"kind": "command", "title": 'done habit "title"', "detail": "Log a habit", "insert_text": 'done habit "'},
    ]
    if not lower:
        return {"suggestions": commands}
    action_prefix = "add" if lower.startswith("add") else "done" if lower.startswith("done") else None
    command_kind = next((kind for kind in ("task", "project", "habit") if kind in lower), None)
    suggestions = [
        command for command in commands
        if action_prefix
        and command["title"].startswith(action_prefix)
        and (not command_kind or command_kind in command["title"])
    ]

    def matches(model, kind, detail, extra_filter=None):
        statement = db.query(model).filter(model.title.ilike(f"%{query}%"))
        if extra_filter is not None:
            statement = statement.filter(extra_filter)
        rows = statement.limit(8).all()
        for row in rows:
            context = detail(row) if callable(detail) else detail
            suggestions.append({
                "kind": kind,
                "id": row.id,
                "title": row.title,
                "detail": f"{context} | ID {str(row.id)[:8]}",
                "insert_text": row.title,
            })

    entity_context = None
    if re.match(r"done\s+task\b", lower):
        entity_context = {"task"}
    elif re.match(r"done\s+habit\b", lower):
        entity_context = {"habit"}
    elif re.match(r'add\s+task\b.*\bto\s*', lower):
        entity_context = {"project"}
    elif re.match(r'add\s+project\b.*\bunder\s*', lower):
        entity_context = {"area"}
    if entity_context is None or "project" in entity_context:
        matches(m.Project, "project", lambda row: f"Project / {row.area.title if row.area else 'No area'}")
    if entity_context is None or "task" in entity_context:
        matches(m.Task, "task", lambda row: f"Task / {row.project.title if row.project else 'Standalone'} / {row.status.value}")
    if entity_context is None or "area" in entity_context:
        matches(m.Area, "area", "Area")
    if entity_context is None:
        matches(m.Dream, "dream", lambda row: f"Dream / goal / {', '.join(area.title for area in row.areas) or 'No areas'}")
    if entity_context is None or "habit" in entity_context:
        matches(m.Habit, "habit", lambda row: f"Habit / {row.area.title if row.area else 'No area'}",
                m.Habit.status != "archived")
    return {"suggestions": suggestions[:18]}


@router.post("", response_model=TaskOut)
def create_task(payload: TaskIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if data["project_id"] and not db.query(m.Project).filter_by(id=data["project_id"]).first():
        raise HTTPException(404, "Project not found")
    task = m.Task(**data)
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.post("/bulk")
def bulk_tasks(payload: TaskBulkIn, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(payload.ids))
    if not ids:
        raise HTTPException(422, "Select at least one task")
    if len(ids) > 500:
        raise HTTPException(422, "A single operation can include at most 500 tasks")
    tasks = db.query(m.Task).filter(m.Task.id.in_(ids)).all()
    if len(tasks) != len(ids):
        raise HTTPException(404, "One or more selected tasks no longer exist")
    if payload.action == "move":
        if not payload.project_id or not db.query(m.Project).filter_by(id=payload.project_id).first():
            raise HTTPException(422, "Choose an existing project to move tasks to")
        for task in tasks:
            task.project_id = payload.project_id
    elif payload.action == "detach":
        for task in tasks:
            task.project_id = None
    elif payload.action in ("complete", "reopen"):
        status = m.TaskStatus.done if payload.action == "complete" else m.TaskStatus.todo
        for task in tasks:
            task.status = status
            task.completed_at = date.today() if status == m.TaskStatus.done else None
    elif payload.action == "delete":
        for task in tasks:
            db.delete(task)
    else:
        raise HTTPException(422, "Unsupported task action")
    db.commit()
    return {"ok": True, "affected": len(tasks), "action": payload.action}


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: str, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(m.Task).get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("project_id") and not db.query(m.Project).filter_by(id=changes["project_id"]).first():
        raise HTTPException(404, "Project not found")
    for k, v in changes.items():
        setattr(task, k, v)
    if changes.get("status") == "done" and not task.completed_at:
        task.completed_at = date.today()
    elif "status" in changes and changes["status"] != "done":
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
        if payload.selection_kind == "task" and payload.selection_id:
            task = db.query(m.Task).filter_by(id=payload.selection_id).first()
            if not task or task.title.casefold() != title.casefold():
                return {"parsed": True, "ok": False, "message": "The selected task no longer exists"}
        else:
            matches = db.query(m.Task).filter(m.Task.title.ilike(f"%{title}%")).all()
            task = matches[0] if len(matches) == 1 else None
            if len(matches) > 1:
                contexts = ", ".join(f'{item.title} ({item.project.title if item.project else "Standalone"})' for item in matches[:5])
                return {"parsed": True, "ok": False, "message": f'More than one task matches "{title}": {contexts}'}
        if not task:
            return {"parsed": True, "ok": False, "message": f'No task matching "{title}"'}
        task.status = m.TaskStatus.done
        task.completed_at = date.today()
        db.commit()
        return {"parsed": True, "ok": True, "message": f'Marked "{task.title}" done'}

    # --- add task ---
    m_task = re.match(r'add\s+task\s+"([^"]+)"(?:\s+to\s+(.+?))?(?:\s+due\s+(.+))?$', text, re.IGNORECASE)
    if m_task:
        title, project_name, due_str = m_task.groups()
        project = None
        if payload.selection_kind == "project" and payload.selection_id:
            project = db.query(m.Project).filter_by(id=payload.selection_id).first()
            selected_title = project_name.strip().strip('"') if project_name else None
            if not project or (selected_title and project.title.casefold() != selected_title.casefold()):
                return {"parsed": True, "ok": False, "message": "The selected project no longer matches this command"}
        elif project_name:
            project_name = project_name.strip().strip('"')
            matches = db.query(m.Project).filter(m.Project.title.ilike(f"%{project_name}%")).all()
            if not matches:
                return {"parsed": True, "ok": False, "message": f'No project matching "{project_name}"'}
            if len(matches) > 1:
                choices = ", ".join(f'{p.title} ({p.area.title if p.area else "No area"})' for p in matches[:5])
                return {"parsed": True, "ok": False, "message": f'More than one project matches "{project_name}": {choices}'}
            project = matches[0]
        due = _parse_date(due_str) if due_str else None
        if due_str and due is None:
            return {"parsed": True, "ok": False, "message": f'Could not understand due date "{due_str}"'}
        task = m.Task(project_id=project.id if project else None, title=title, due_date=due)
        db.add(task)
        db.commit()
        target = f" to {project.title}" if project else " as a standalone task"
        return {"parsed": True, "ok": True, "message": f'Added task "{title}"{target}'}

    # --- add project ---
    m_proj = re.match(r'add\s+project\s+"([^"]+)"\s+under\s+"([^"]+)"', text, re.IGNORECASE)
    if m_proj:
        title, area_name = m_proj.groups()
        if payload.selection_kind == "area" and payload.selection_id:
            area = db.query(m.Area).filter_by(id=payload.selection_id).first()
            if not area or area.title.casefold() != area_name.casefold():
                return {"parsed": True, "ok": False, "message": "The selected area no longer matches this command"}
        else:
            matches = db.query(m.Area).filter(m.Area.title.ilike(f"%{area_name}%")).all()
            area = matches[0] if len(matches) == 1 else None
            if len(matches) > 1:
                choices = ", ".join(item.title for item in matches[:5])
                return {"parsed": True, "ok": False, "message": f'More than one area matches "{area_name}": {choices}'}
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
        if payload.selection_kind == "habit" and payload.selection_id:
            habit = db.query(m.Habit).filter(m.Habit.id == payload.selection_id,
                                              m.Habit.status != "archived").first()
            if habit and habit.title.casefold() != title.casefold():
                habit = None
        else:
            matches = db.query(m.Habit).filter(m.Habit.title.ilike(f"%{title}%"),
                                                m.Habit.status != "archived").all()
            habit = matches[0] if len(matches) == 1 else None
            if len(matches) > 1:
                contexts = ", ".join(f'{item.title} ({item.area.title if item.area else "No area"})' for item in matches[:5])
                return {"parsed": True, "ok": False, "message": f'More than one habit matches "{title}": {contexts}'}
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