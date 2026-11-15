"""Pydantic schemas for request/response validation.

Hard rule: every field that is nullable in the DB is Optional[X] = None here.
Never default a nullable text field to "" — that masks real NULLs.
"""
from datetime import date, datetime
from typing import Optional, List, Any, Dict

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Area
# ---------------------------------------------------------------------------

class AreaIn(BaseModel):
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    status: str = "active"


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    created_at: date
    status: str
    progress: float = 0.0
    active_project_count: int = 0
    # Feature 6: Health indicator
    health_status: str = "neglected"   # thriving / active / slowing / neglected
    health_label: str = "No activity"
    last_activity_days: Optional[int] = None
    stalled_projects: int = 0


# ---------------------------------------------------------------------------
# Dream
# ---------------------------------------------------------------------------

class AreaTag(BaseModel):
    id: str
    title: str
    icon: Optional[str] = None
    color: Optional[str] = None
    progress: float = 0.0


class DreamIn(BaseModel):
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    status: str = "active"
    area_ids: List[str] = []


class DreamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    created_at: date
    status: str
    areas: List[AreaTag] = []


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

class ProjectIn(BaseModel):
    title: str
    area_id: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    target_date: Optional[date] = None
    status: str = "active"
    tags: List[str] = []
    progress_override: Optional[float] = None
    notes: Optional[str] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    area_id: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    target_date: Optional[date] = None
    status: str
    tags: List[str] = []
    notes: Optional[str] = None
    progress: float = 0.0
    tasks_done: int = 0
    tasks_total: int = 0
    area_color: Optional[str] = None
    area_title: Optional[str] = None


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------

class TaskIn(BaseModel):
    project_id: Optional[str] = None
    title: str
    status: str = "todo"
    priority: str = "medium"
    due_date: Optional[date] = None
    effort: Optional[int] = None
    notes: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[date] = None
    effort: Optional[int] = None
    notes: Optional[str] = None
    project_id: Optional[str] = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: Optional[str] = None
    title: str
    status: str
    priority: str
    due_date: Optional[date] = None
    completed_at: Optional[date] = None
    effort: Optional[int] = None
    notes: Optional[str] = None
    project_title: Optional[str] = None
    area_color: Optional[str] = None


class QuickAddIn(BaseModel):
    text: str
    selection_kind: Optional[str] = None
    selection_id: Optional[str] = None


class TaskBulkIn(BaseModel):
    ids: List[str]
    action: str
    project_id: Optional[str] = None


class ProjectBulkIn(BaseModel):
    ids: List[str]
    action: str


# ---------------------------------------------------------------------------
# Feature 1: Habits
# ---------------------------------------------------------------------------

class HabitIn(BaseModel):
    title: str
    area_id: Optional[str] = None
    description: Optional[str] = None
    frequency: str = "daily"
    target_days: Optional[str] = None
    frequency_count: Optional[int] = None   # X for "at least X per week/month"
    habit_type: str = "yes_no"              # yes_no / measurable
    target_value: Optional[float] = None    # measurable: goal per session
    unit: Optional[str] = None             # measurable: display unit (km, pages, min…)
    color: Optional[str] = None
    status: str = "active"


class HabitDayStatus(BaseModel):
    date: str
    scheduled: bool
    done: bool
    value: Optional[float] = None   # measurable habits: logged value for that day


class HabitOut(BaseModel):
    id: str
    title: str
    area_id: Optional[str] = None
    description: Optional[str] = None
    frequency: str
    target_days: Optional[str] = None
    frequency_count: Optional[int] = None
    habit_type: str = "yes_no"
    target_value: Optional[float] = None
    unit: Optional[str] = None
    color: Optional[str] = None
    created_at: date
    status: str
    area_title: Optional[str] = None
    area_color: Optional[str] = None
    # Computed
    current_streak: int = 0
    longest_streak: int = 0
    completion_rate: float = 0.0
    done_today: bool = False
    value_today: Optional[float] = None    # measurable: today's logged value
    last7: List[HabitDayStatus] = []


class HabitLogIn(BaseModel):
    done: bool = True
    note: Optional[str] = None
    date: Optional[str] = None    # ISO date string; defaults to today if omitted
    value: Optional[float] = None # measurable habits: the numeric value to log


# ---------------------------------------------------------------------------
# Feature 3: Weekly Reviews
# ---------------------------------------------------------------------------

class ReviewIn(BaseModel):
    wins: Optional[str] = None
    struggles: Optional[str] = None
    next_week_focus: Optional[str] = None
    focus_task_ids: Optional[str] = None
    mood: Optional[int] = None


class ReviewSummary(BaseModel):
    id: str
    week_start: date
    mood: Optional[int] = None
    completed_at: Optional[datetime] = None
    wins_snippet: Optional[str] = None


class ReviewOut(BaseModel):
    id: str
    week_start: date
    completed_at: Optional[datetime] = None
    wins: Optional[str] = None
    struggles: Optional[str] = None
    next_week_focus: Optional[str] = None
    focus_task_ids: Optional[str] = None
    mood: Optional[int] = None
    raw_stats: Optional[str] = None
