"""SQLAlchemy models for LifeOps: Area -> Project -> Task, plus a flat Dream
list that tags Areas, per-project Snapshots, Habits with logs, and WeeklyReviews."""
import uuid
import enum
from datetime import date, datetime

from sqlalchemy import Column, String, Float, Date, DateTime, ForeignKey, Text, Integer, Enum as SAEnum
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


def gen_uuid():
    return str(uuid.uuid4())


class AreaStatus(str, enum.Enum):
    active = "active"
    paused = "paused"


class DreamStatus(str, enum.Enum):
    active = "active"
    achieved = "achieved"
    dropped = "dropped"


class ProjectStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    done = "done"
    dropped = "dropped"


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"
    blocked = "blocked"


class TaskPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Area(Base):
    """A life dimension that exists indefinitely. No finish line."""
    __tablename__ = "areas"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String, nullable=True)
    color = Column(String, nullable=True)
    created_at = Column(Date, default=date.today)
    status = Column(SAEnum(AreaStatus), default=AreaStatus.active, nullable=False)

    projects = relationship("Project", back_populates="area", cascade="all, delete-orphan")
    dream_links = relationship("DreamArea", back_populates="area", cascade="all, delete-orphan")
    habits = relationship("Habit", back_populates="area")


class Dream(Base):
    """Flat inspirational reference list. Not a structural layer — tags Areas."""
    __tablename__ = "dreams"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String, nullable=True)
    created_at = Column(Date, default=date.today)
    status = Column(SAEnum(DreamStatus), default=DreamStatus.active, nullable=False)

    area_links = relationship("DreamArea", back_populates="dream", cascade="all, delete-orphan")


class DreamArea(Base):
    """Junction: which Areas a Dream touches."""
    __tablename__ = "dream_areas"

    id = Column(String, primary_key=True, default=gen_uuid)
    dream_id = Column(String, ForeignKey("dreams.id"), nullable=False)
    area_id = Column(String, ForeignKey("areas.id"), nullable=False)

    dream = relationship("Dream", back_populates="area_links")
    area = relationship("Area", back_populates="dream_links")


class Project(Base):
    """Anything with a finish line. Belongs to one Area."""
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String, nullable=False)
    area_id = Column(String, ForeignKey("areas.id"), nullable=True)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)
    target_date = Column(Date, nullable=True)
    status = Column(SAEnum(ProjectStatus), default=ProjectStatus.active, nullable=False)
    tags = Column(String, nullable=True)  # comma-separated
    progress_override = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)

    area = relationship("Area", back_populates="projects")
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=gen_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=True)
    title = Column(String, nullable=False)
    status = Column(SAEnum(TaskStatus), default=TaskStatus.todo, nullable=False)
    priority = Column(SAEnum(TaskPriority), default=TaskPriority.medium, nullable=False)
    due_date = Column(Date, nullable=True)
    completed_at = Column(Date, nullable=True)
    effort = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="tasks")


class Snapshot(Base):
    """Daily auto-generated progress snapshot, one row per project per day."""
    __tablename__ = "snapshots"

    id = Column(String, primary_key=True, default=gen_uuid)
    date = Column(Date, default=date.today)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    progress = Column(Float, default=0.0)
    tasks_done = Column(Integer, default=0)
    tasks_total = Column(Integer, default=0)


# ---------------------------------------------------------------------------
# Feature 1: Habits
# ---------------------------------------------------------------------------

class Habit(Base):
    """A recurring action tracked by streak and completion rate."""
    __tablename__ = "habits"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String, nullable=False)
    area_id = Column(String, ForeignKey("areas.id"), nullable=True)
    description = Column(Text, nullable=True)
    frequency = Column(String, nullable=False, default="daily")
    # daily / weekly / custom / x_per_week / x_per_month
    target_days = Column(String, nullable=True)    # comma-sep 0-6 (0=Mon) for custom
    frequency_count = Column(Integer, nullable=True)  # X for "at least X per week/month"
    habit_type = Column(String, nullable=False, default="yes_no")  # yes_no / measurable
    target_value = Column(Float, nullable=True)   # measurable: goal per session (e.g. 5 km)
    unit = Column(String, nullable=True)          # measurable: display unit (e.g. "km")
    color = Column(String, nullable=True)
    created_at = Column(Date, default=date.today)
    status = Column(String, nullable=False, default="active")  # active / paused / archived

    area = relationship("Area", back_populates="habits")
    logs = relationship("HabitLog", back_populates="habit", cascade="all, delete-orphan",
                        order_by="HabitLog.date")


class HabitLog(Base):
    """One row per habit per day."""
    __tablename__ = "habit_logs"

    id = Column(String, primary_key=True, default=gen_uuid)
    habit_id = Column(String, ForeignKey("habits.id"), nullable=False)
    date = Column(Date, nullable=False)
    done = Column(Integer, nullable=False, default=0)  # 0 or 1
    value = Column(Float, nullable=True)  # measurable habits: logged numeric value
    note = Column(Text, nullable=True)

    habit = relationship("Habit", back_populates="logs")


# ---------------------------------------------------------------------------
# Feature 3: Weekly Reviews
# ---------------------------------------------------------------------------

class WeeklyReview(Base):
    """A structured weekly review entry."""
    __tablename__ = "weekly_reviews"

    id = Column(String, primary_key=True, default=gen_uuid)
    week_start = Column(Date, nullable=False)  # always a Monday
    completed_at = Column(DateTime, nullable=True)
    wins = Column(Text, nullable=True)
    struggles = Column(Text, nullable=True)
    next_week_focus = Column(Text, nullable=True)
    focus_task_ids = Column(Text, nullable=True)  # comma-separated task IDs
    mood = Column(Integer, nullable=True)  # 1-5
    raw_stats = Column(Text, nullable=True)  # JSON blob
