"""DB engine/session setup. Uses ~/.local/share/lifeops/data.db by default,
overridable via LIFEOPS_DB_PATH env var (handy for local dev / demo)."""
import os
import sqlite3
import shutil
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from db.models import Base

DEFAULT_DB_PATH = Path.home() / ".local" / "share" / "lifeops" / "data.db"
DB_PATH = Path(os.environ.get("LIFEOPS_DB_PATH", DEFAULT_DB_PATH))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_task_planning_date()
    _migrate_standalone_tasks()
    # Schema migrations — each ALTER TABLE is wrapped so existing DBs are safe
    _migrations = [
        "ALTER TABLE habits ADD COLUMN frequency_count INTEGER",
        "ALTER TABLE habits ADD COLUMN habit_type TEXT NOT NULL DEFAULT 'yes_no'",
        "ALTER TABLE habits ADD COLUMN target_value REAL",
        "ALTER TABLE habits ADD COLUMN unit TEXT",
        "ALTER TABLE habit_logs ADD COLUMN value REAL",
    ]
    with engine.connect() as conn:
        for sql in _migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # Column already exists — safe to ignore


def _migrate_task_planning_date():
    """Add the nullable planning date without rebuilding or replacing tasks."""
    with engine.begin() as conn:
        columns = {column["name"] for column in inspect(conn).get_columns("tasks")}
        if "planning_date" not in columns:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN planning_date DATE"))


def _migrate_standalone_tasks():
    """Safely make tasks.project_id nullable in existing SQLite databases."""
    if engine.dialect.name != "sqlite":
        return
    with engine.connect() as conn:
        columns = conn.exec_driver_sql("PRAGMA table_info(tasks)").all()
    project_column = next((column for column in columns if column[1] == "project_id"), None)
    if not project_column or not project_column[3]:
        return

    backup_path = DB_PATH.with_name(f"{DB_PATH.name}.pre-standalone-tasks.bak")
    if DB_PATH.exists() and not backup_path.exists():
        shutil.copy2(DB_PATH, backup_path)

    raw = sqlite3.connect(DB_PATH)
    try:
        raw.execute("PRAGMA foreign_keys=OFF")
        raw.execute("BEGIN IMMEDIATE")
        raw.execute("""
            CREATE TABLE tasks_new (
                id VARCHAR PRIMARY KEY,
                project_id VARCHAR REFERENCES projects(id),
                title VARCHAR NOT NULL,
                status VARCHAR NOT NULL,
                priority VARCHAR NOT NULL,
                due_date DATE,
                planning_date DATE,
                completed_at DATE,
                effort INTEGER,
                notes TEXT,
                created_at DATETIME
            )
        """)
        raw.execute("""
            INSERT INTO tasks_new
                (id, project_id, title, status, priority, due_date, planning_date, completed_at,
                 effort, notes, created_at)
            SELECT id, project_id, title, status, priority, due_date, planning_date, completed_at,
                   effort, notes, created_at
            FROM tasks
        """)
        raw.execute("DROP TABLE tasks")
        raw.execute("ALTER TABLE tasks_new RENAME TO tasks")
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
