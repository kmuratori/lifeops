import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api.calendar import get_calendar_items
from api.events import create_event, delete_event, get_event, list_events, update_event
from api.schemas import EventIn, EventUpdate, TaskUpdate
from api.settings import _dump_all
from api.tasks import update_task
from db import models as m


class CalendarPhaseOneTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        m.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_event_crud_and_utc_normalization(self):
        created = create_event(EventIn(
            title="Planning",
            is_all_day=False,
            start_at="2026-05-10T10:00:00+02:00",
            end_at="2026-05-10T11:00:00+02:00",
            location="Room 4",
            category="work",
            color="#123456",
        ), self.db)
        self.assertEqual(created.start_at, datetime(2026, 5, 10, 8, tzinfo=timezone.utc))
        self.assertEqual(created.end_at, datetime(2026, 5, 10, 9, tzinfo=timezone.utc))
        self.assertEqual(get_event(created.id, self.db).title, "Planning")
        self.assertEqual(list_events(self.db)[0].id, created.id)

        updated = update_event(created.id, EventUpdate(title="Updated planning"), self.db)
        self.assertEqual(updated.title, "Updated planning")
        self.assertEqual(updated.start_at, created.start_at)
        with self.assertRaises(HTTPException) as invalid_update:
            update_event(
                created.id,
                EventUpdate(end_at="2026-05-10T06:00:00Z"),
                self.db,
            )
        self.assertEqual(invalid_update.exception.status_code, 422)
        self.assertEqual(get_event(created.id, self.db).end_at, created.end_at)
        self.assertEqual(delete_event(created.id, self.db), {"ok": True})
        with self.assertRaises(HTTPException) as missing:
            get_event(created.id, self.db)
        self.assertEqual(missing.exception.status_code, 404)

    def test_all_day_event_uses_exclusive_end_date(self):
        event = create_event(EventIn(
            title="Conference",
            is_all_day=True,
            start_date="2026-05-10",
            end_date="2026-05-12",
        ), self.db)
        self.assertEqual(event.start_date, date(2026, 5, 10))
        self.assertEqual(event.end_date, date(2026, 5, 12))
        self.assertIsNone(event.start_at)

    def test_invalid_event_dates_and_missing_offset_are_rejected(self):
        for payload in (
            {"title": "Bad range", "is_all_day": True,
             "start_date": "2026-05-12", "end_date": "2026-05-12"},
            {"title": "Missing end", "is_all_day": True, "start_date": "2026-05-10"},
            {"title": "Bad timed range", "is_all_day": False,
             "start_at": "2026-05-10T11:00:00Z", "end_at": "2026-05-10T10:00:00Z"},
            {"title": "No offset", "is_all_day": False,
             "start_at": "2026-05-10T10:00:00", "end_at": "2026-05-10T11:00:00Z"},
            {"title": "Malformed", "is_all_day": False,
             "start_at": "not-a-date", "end_at": "2026-05-10T11:00:00Z"},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    EventIn.model_validate(payload)

    def test_task_planning_date_is_independent_of_due_date(self):
        task = m.Task(
            id="task-1",
            title="Write report",
            due_date=date(2026, 5, 20),
            planning_date=date(2026, 5, 18),
        )
        self.db.add(task)
        self.db.commit()

        updated = update_task(
            "task-1",
            TaskUpdate(planning_date=date(2026, 5, 19)),
            self.db,
        )
        self.assertEqual(updated.planning_date, date(2026, 5, 19))
        self.assertEqual(updated.due_date, date(2026, 5, 20))

        updated = update_task(
            "task-1",
            TaskUpdate(due_date=date(2026, 5, 22)),
            self.db,
        )
        self.assertEqual(updated.planning_date, date(2026, 5, 19))
        self.assertEqual(updated.due_date, date(2026, 5, 22))
        self.assertEqual(_dump_all(self.db)["tasks"][0]["planning_date"], date(2026, 5, 19))

    def test_calendar_date_range_types_tasks_events_and_project_periods(self):
        area = m.Area(id="area-1", title="Work", color="#aa5500")
        project = m.Project(
            id="project-overlap",
            title="Quarter plan",
            area=area,
            start_date=date(2026, 5, 31),
            target_date=date(2026, 6, 3),
        )
        task_same = m.Task(
            id="task-same", title="Review", project=project,
            planning_date=date(2026, 6, 2), due_date=date(2026, 6, 2),
        )
        task_split = m.Task(
            id="task-split", title="Draft", project=project,
            planning_date=date(2026, 6, 1), due_date=date(2026, 6, 9),
        )
        all_day = m.Event(
            id="event-all-day", title="Offsite", is_all_day=True,
            start_date=date(2026, 5, 31), end_date=date(2026, 6, 2),
        )
        timed = m.Event(
            id="event-timed", title="Late call", is_all_day=False,
            start_at=datetime(2026, 6, 7, 23, 30),
            end_at=datetime(2026, 6, 8, 0, 30),
        )
        outside = m.Event(
            id="event-outside", title="Outside", is_all_day=True,
            start_date=date(2026, 6, 8), end_date=date(2026, 6, 9),
        )
        self.db.add_all([area, project, task_same, task_split, all_day, timed, outside])
        self.db.commit()

        result = get_calendar_items(
            start=date(2026, 6, 1), end=date(2026, 6, 7),
            types="event,task,project", db=self.db,
        )
        items = result["items"]
        self.assertEqual({item["type"] for item in items}, {"event", "task", "project"})
        self.assertNotIn("event-outside", {item["id"] for item in items})
        same = [item for item in items if item["id"] == "task-same"]
        self.assertEqual(len(same), 1)
        self.assertEqual(same[0]["occurrence"], "planning_and_due")
        self.assertEqual(same[0]["project_title"], "Quarter plan")
        split = [item for item in items if item["id"] == "task-split"]
        self.assertEqual(len(split), 1)
        self.assertEqual(split[0]["occurrence"], "planning")
        project_item = next(item for item in items if item["id"] == "project-overlap")
        self.assertEqual(project_item["type"], "project")
        self.assertEqual(project_item["start_date"], "2026-05-31")
        self.assertEqual(project_item["target_date"], "2026-06-03")
        self.assertEqual(project_item["area_title"], "Work")
        timed_item = next(item for item in items if item["id"] == "event-timed")
        self.assertEqual(timed_item["start_at"], "2026-06-07T23:30:00+00:00")

        tasks_only = get_calendar_items(
            start=date(2026, 6, 1), end=date(2026, 6, 7), types="task", db=self.db
        )
        self.assertTrue(tasks_only["items"])
        self.assertEqual({item["type"] for item in tasks_only["items"]}, {"task"})

    def test_calendar_rejects_invalid_range_or_type(self):
        with self.assertRaises(HTTPException) as invalid_range:
            get_calendar_items(date(2026, 6, 2), date(2026, 6, 1), "task", self.db)
        self.assertEqual(invalid_range.exception.status_code, 422)
        with self.assertRaises(HTTPException) as invalid_type:
            get_calendar_items(date(2026, 6, 1), date(2026, 6, 2), "habit", self.db)
        self.assertEqual(invalid_type.exception.status_code, 422)

    def test_migration_adds_planning_date_and_event_table_without_losing_data(self):
        source_dir = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "legacy.sqlite"
            conn = sqlite3.connect(db_path)
            conn.executescript("""
                CREATE TABLE projects (
                    id VARCHAR PRIMARY KEY, title VARCHAR NOT NULL, area_id VARCHAR,
                    description TEXT, start_date DATE, target_date DATE, status VARCHAR NOT NULL,
                    tags VARCHAR, progress_override FLOAT, notes TEXT
                );
                CREATE TABLE tasks (
                    id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL REFERENCES projects(id),
                    title VARCHAR NOT NULL, status VARCHAR NOT NULL, priority VARCHAR NOT NULL,
                    due_date DATE, completed_at DATE, effort INTEGER, notes TEXT, created_at DATETIME
                );
                INSERT INTO projects (id, title, status) VALUES ('p1', 'Legacy project', 'active');
                INSERT INTO tasks (id, project_id, title, status, priority, due_date)
                    VALUES ('t1', 'p1', 'Preserve me', 'todo', 'high', '2026-06-01');
            """)
            conn.commit()
            conn.close()

            script = """
from datetime import date
from sqlalchemy import inspect
from db.session import init_db, SessionLocal, engine
from db.models import Event, Task
init_db()
db = SessionLocal()
task = db.get(Task, 't1')
assert task is not None and task.title == 'Preserve me' and task.project_id == 'p1'
assert task.due_date.isoformat() == '2026-06-01' and task.planning_date is None
task.planning_date = date(2026, 6, 2)
db.add(Event(id='event-1', title='Migrated event', is_all_day=True,
             start_date=date(2026, 6, 1), end_date=date(2026, 6, 2)))
db.commit()
init_db()
db.refresh(task)
assert task.planning_date.isoformat() == '2026-06-02'
assert db.get(Event, 'event-1').title == 'Migrated event'
db.close()
columns = inspect(engine).get_columns('tasks')
assert 'planning_date' in {column['name'] for column in columns}
assert inspect(engine).has_table('events')
assert next(column for column in columns if column['name'] == 'project_id')['nullable'] is True
"""
            env = os.environ.copy()
            env["LIFEOPS_DB_PATH"] = str(db_path)
            env["PYTHONPATH"] = str(source_dir)
            subprocess.run([sys.executable, "-c", script], cwd=source_dir, env=env, check=True)
            self.assertTrue(db_path.with_name("legacy.sqlite.pre-standalone-tasks.bak").exists())


if __name__ == "__main__":
    unittest.main()
