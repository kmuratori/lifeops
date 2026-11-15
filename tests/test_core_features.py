import asyncio
import os
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from db import models as m, crud
from api.tasks import quick_add, bulk_tasks, update_task, task_suggestions
from api.schemas import QuickAddIn, TaskBulkIn, TaskUpdate
from api.habits import is_scheduled, compute_streaks
from api.insights import dashboard as insights_dashboard
from api.settings import (
    _IMPORT_PREVIEWS,
    _import_conflict_state,
    _validate_import,
    commit_import,
    export_csv,
    selective_export,
)
from fastapi import HTTPException


class CoreFeatureTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        m.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_standalone_task_does_not_change_project_progress(self):
        project = m.Project(id="p1", title="Project")
        project.tasks.append(m.Task(id="t1", title="Owned", status=m.TaskStatus.done))
        self.db.add(project)
        self.db.add(m.Task(id="t2", title="Personal", project_id=None, status=m.TaskStatus.todo))
        self.db.commit()

        self.assertEqual(crud.project_progress(self.db, project), 1.0)
        self.assertIsNone(self.db.get(m.Task, "t2").project_id)

    def test_standalone_task_appears_in_home_dashboard_deadlines(self):
        self.db.add(m.Task(
            id="t-home",
            title="Pay bill",
            project_id=None,
            status=m.TaskStatus.todo,
            priority=m.TaskPriority.high,
            due_date=date.today(),
        ))
        self.db.commit()
        result = insights_dashboard(self.db)
        self.assertEqual(result["tasks_due_today"], 1)
        self.assertEqual(result["upcoming_deadlines"][0]["project_title"], "Standalone")

    def test_quick_add_creates_standalone_task_with_natural_language_date(self):
        result = quick_add(QuickAddIn(text='add task "Prepare report" due tomorrow'), self.db)
        self.assertTrue(result["ok"])
        task = self.db.query(m.Task).filter_by(title="Prepare report").one()
        self.assertIsNone(task.project_id)
        self.assertEqual(task.due_date, date.today() + timedelta(days=1))

    def test_task_bulk_detach_and_complete(self):
        project = m.Project(id="p1", title="Project")
        task = m.Task(id="t1", title="Task", project=project)
        self.db.add_all([project, task])
        self.db.commit()
        bulk_tasks(TaskBulkIn(ids=["t1"], action="detach"), self.db)
        bulk_tasks(TaskBulkIn(ids=["t1"], action="complete"), self.db)
        self.db.refresh(task)
        self.assertIsNone(task.project_id)
        self.assertEqual(task.status, m.TaskStatus.done)
        self.assertEqual(task.completed_at, date.today())

    def test_quick_add_reports_duplicate_project_matches(self):
        self.db.add_all([
            m.Area(id="a1", title="Work"),
            m.Area(id="a2", title="Learning"),
            m.Project(id="p1", title="Research", area_id="a1"),
            m.Project(id="p2", title="Research", area_id="a2"),
        ])
        self.db.commit()
        result = quick_add(QuickAddIn(text='add task "Read" to Research'), self.db)
        self.assertFalse(result["ok"])
        self.assertIn("More than one project", result["message"])
        self.assertEqual(self.db.query(m.Task).count(), 0)

    def test_quick_add_selection_uses_project_id_when_titles_match(self):
        self.db.add_all([
            m.Area(id="a1", title="Work"),
            m.Area(id="a2", title="Learning"),
            m.Project(id="p1", title="Research", area_id="a1"),
            m.Project(id="p2", title="Research", area_id="a2"),
        ])
        self.db.commit()
        result = quick_add(
            QuickAddIn(
                text='add task "Read" to "Research"',
                selection_kind="project",
                selection_id="p2",
            ),
            self.db,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.db.query(m.Task).one().project_id, "p2")

    def test_quick_add_selection_can_attach_task_without_textual_project_target(self):
        project = m.Project(id="p1", title="Research")
        self.db.add(project)
        self.db.commit()
        result = quick_add(
            QuickAddIn(
                text='add task "Read"',
                selection_kind="project",
                selection_id="p1",
            ),
            self.db,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.db.query(m.Task).one().project_id, "p1")

    def test_quick_add_rejects_a_stale_selected_task_id(self):
        task = m.Task(id="t1", title="Pay rent")
        self.db.add(task)
        self.db.commit()
        result = quick_add(
            QuickAddIn(
                text='done task "Book flight"',
                selection_kind="task",
                selection_id="t1",
            ),
            self.db,
        )
        self.assertFalse(result["ok"])
        self.assertNotEqual(self.db.get(m.Task, "t1").status, m.TaskStatus.done)

    def test_empty_quick_add_suggestions_include_supported_commands(self):
        result = task_suggestions("", self.db)
        titles = [item["title"] for item in result["suggestions"]]
        self.assertIn('add task "title"', titles)
        self.assertIn('add habit "title" daily', titles)
        self.assertIn('done habit "title"', titles)

    def test_task_update_rejects_a_missing_project_without_mutating_task(self):
        task = m.Task(id="t1", title="Standalone")
        self.db.add(task)
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            update_task("t1", TaskUpdate(project_id="missing"), self.db)
        self.assertEqual(error.exception.status_code, 404)
        self.assertIsNone(self.db.get(m.Task, "t1").project_id)

    def test_import_validation_explains_missing_parent_and_rejects_duplicate_ids(self):
        payload = {
            "format": "lifeops",
            "schema_version": 1,
            "tasks": [
                {"id": "same", "title": "One", "project_id": "missing"},
                {"id": "same", "title": "Two", "project_id": None},
            ],
        }
        _, issues = _validate_import(payload, self.db)
        self.assertTrue(any("duplicate id" in issue for issue in issues))
        self.assertTrue(any("missing project" in issue for issue in issues))

    def test_complete_backup_must_contain_its_own_relationship_parents(self):
        self.db.add(m.Area(id="a1", title="Existing locally"))
        self.db.commit()
        payload = {
            "format": "lifeops",
            "schema_version": 1,
            "areas": [],
            "projects": [{
                "id": "p1", "title": "Imported", "area_id": "a1", "status": "active",
            }],
        }
        _, issues = _validate_import(payload, self.db, allow_database_relationships=False)
        self.assertTrue(any("missing area" in issue for issue in issues))

    def test_import_conflict_created_after_preview_is_rejected(self):
        incoming = {
            "areas": [], "dreams": [], "dream_areas": [], "projects": [],
            "tasks": [{
                "id": "t-new", "project_id": None, "title": "Incoming", "status": "todo",
                "priority": "medium", "due_date": None, "completed_at": None,
                "effort": None, "notes": None, "created_at": datetime.now().isoformat(),
            }],
            "snapshots": [], "habits": [], "habit_logs": [], "weekly_reviews": [],
        }
        counts, conflicts = _import_conflict_state(incoming, self.db)
        token = "stale-import-preview"
        _IMPORT_PREVIEWS[token] = {
            "data": incoming,
            "issues": [],
            "complete_backup": False,
            "counts": counts,
            "conflicts": conflicts,
            "created": datetime.now().timestamp(),
        }
        self.db.add(m.Task(id="t-new", title="Created while preview was open"))
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            commit_import({"token": token, "conflict_policy": "replace"}, self.db)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.db.get(m.Task, "t-new").title, "Created while preview was open")
        _IMPORT_PREVIEWS.pop(token, None)

    def test_partial_import_cannot_replace_all_and_preserves_existing_data(self):
        area = m.Area(id="keep", title="Keep me")
        self.db.add(area)
        self.db.commit()
        token = "partial-import-test"
        _IMPORT_PREVIEWS[token] = {
            "data": {key: [] for key in (
                "areas", "dreams", "dream_areas", "projects", "tasks",
                "snapshots", "habits", "habit_logs", "weekly_reviews",
            )},
            "issues": [],
            "complete_backup": False,
            "created": datetime.now().timestamp(),
        }
        with self.assertRaises(HTTPException) as error:
            commit_import({"token": token, "conflict_policy": "replace_all"}, self.db)
        self.assertEqual(error.exception.status_code, 422)
        self.assertIsNotNone(self.db.get(m.Area, "keep"))
        _IMPORT_PREVIEWS.pop(token, None)

    def test_complete_backup_import_restores_standalone_task_and_habit_logs(self):
        token = "complete-import-test"
        data = {
            "areas": [{"id": "a1", "title": "Health", "created_at": "2026-10-01", "status": "active"}],
            "dreams": [], "dream_areas": [],
            "projects": [{"id": "p1", "title": "Project", "area_id": "a1", "status": "active"}],
            "tasks": [{
                "id": "t1", "project_id": None, "title": "Standalone", "status": "todo",
                "priority": "medium", "due_date": None, "completed_at": None,
                "effort": None, "notes": None, "created_at": "2026-10-01T12:00:00",
            }],
            "snapshots": [],
            "habits": [{
                "id": "h1", "title": "Walk", "area_id": "a1", "description": None,
                "frequency": "daily", "target_days": None, "frequency_count": None,
                "habit_type": "yes_no", "target_value": None, "unit": None,
                "color": None, "created_at": "2026-10-01", "status": "active",
            }],
            "habit_logs": [{
                "id": "l1", "habit_id": "h1", "date": "2026-10-22",
                "done": True, "value": None, "note": None,
            }],
            "weekly_reviews": [],
        }
        _IMPORT_PREVIEWS[token] = {
            "data": data, "issues": [], "complete_backup": True, "created": datetime.now().timestamp(),
        }
        result = commit_import({"token": token, "conflict_policy": "replace_all"}, self.db)
        self.assertTrue(result["ok"])
        self.assertIsNone(self.db.get(m.Task, "t1").project_id)
        self.assertEqual(self.db.query(m.HabitLog).one().habit_id, "h1")

    def test_custom_habit_schedule_does_not_count_unscheduled_days(self):
        habit = m.Habit(title="Monday practice", frequency="custom", target_days="0")
        monday = date(2026, 10, 19)
        tuesday = date(2026, 10, 20)
        self.assertTrue(is_scheduled(habit, monday))
        self.assertFalse(is_scheduled(habit, tuesday))
        streak, longest = compute_streaks(habit, {monday: 1})
        self.assertGreaterEqual(longest, 1)
        self.assertGreaterEqual(streak, 0)

    def test_selective_export_keeps_project_scope_and_relationship_rules_explicit(self):
        active = m.Project(id="p-active", title="Active", status="active")
        paused = m.Project(id="p-paused", title="Paused", status="paused")
        self.db.add_all([
            active,
            paused,
            m.Task(id="t-active", title="Active task", project=active),
            m.Task(id="t-paused", title="Paused task", project=paused),
            m.Task(id="t-standalone", title="Standalone task", project_id=None),
            m.Snapshot(id="s-active", project_id="p-active", date=date.today(), progress=0.5),
            m.Snapshot(id="s-paused", project_id="p-paused", date=date.today(), progress=0.2),
            m.Habit(id="h1", title="Walk", frequency="daily"),
            m.HabitLog(id="l1", habit_id="h1", date=date.today(), done=True),
        ])
        self.db.commit()

        response = selective_export(
            entities="projects,tasks,habits",
            project_mode="active",
            include_project_snapshots=True,
            db=self.db,
        )
        payload = json.loads(response.body)
        self.assertEqual([item["id"] for item in payload["projects"]], ["p-active"])
        self.assertEqual(
            {item["id"] for item in payload["tasks"]},
            {"t-active", "t-standalone"},
        )
        self.assertEqual([item["id"] for item in payload["snapshots"]], ["s-active"])
        self.assertEqual([item["id"] for item in payload["habit_logs"]], ["l1"])

        standalone_payload = json.loads(selective_export(
            entities="tasks",
            project_mode="selected",
            db=self.db,
        ).body)
        self.assertEqual(
            [item["id"] for item in standalone_payload["tasks"]],
            ["t-standalone"],
        )

    def test_project_export_does_not_silently_include_linked_tasks(self):
        project = m.Project(id="p1", title="Project")
        self.db.add_all([project, m.Task(id="t1", title="Project task", project=project)])
        self.db.commit()
        payload = json.loads(selective_export(entities="projects", db=self.db).body)
        self.assertEqual([item["id"] for item in payload["projects"]], ["p1"])
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["snapshots"], [])

    def test_csv_export_serializes_enum_values_without_python_type_names(self):
        self.db.add(m.Task(id="t1", title="CSV task", status=m.TaskStatus.todo))
        self.db.commit()
        response = export_csv(self.db)
        async def collect():
            return b"".join([chunk async for chunk in response.body_iterator])
        archive = zipfile.ZipFile(BytesIO(asyncio.run(collect())))
        tasks_csv = archive.read("tasks.csv").decode("utf-8")
        self.assertIn(",todo,", tasks_csv)
        self.assertNotIn("TaskStatus.todo", tasks_csv)

    def test_existing_database_migration_preserves_task_relationship_and_backup(self):
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
                INSERT INTO tasks (id, project_id, title, status, priority)
                    VALUES ('t1', 'p1', 'Preserve me', 'todo', 'high');
            """)
            conn.commit()
            conn.close()

            script = """
from db.session import init_db, SessionLocal
from db.models import Task
from sqlalchemy import inspect
init_db()
db = SessionLocal()
task = db.get(Task, 't1')
assert task is not None and task.title == 'Preserve me' and task.project_id == 'p1'
db.close()
columns = inspect(__import__('db.session', fromlist=['engine']).engine).get_columns('tasks')
assert next(column for column in columns if column['name'] == 'project_id')['nullable'] is True
"""
            env = os.environ.copy()
            env["LIFEOPS_DB_PATH"] = str(db_path)
            env["PYTHONPATH"] = str(source_dir)
            subprocess.run([sys.executable, "-c", script], cwd=source_dir, env=env, check=True)
            self.assertTrue(db_path.with_name("legacy.sqlite.pre-standalone-tasks.bak").exists())


if __name__ == "__main__":
    unittest.main()
