"""Feature 7: Data Export and Backup UI endpoints."""
import csv
import io
import json
import os
import zipfile
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from db.session import get_db, DB_PATH
from db import models as m

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _serialize(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _dump_all(db: Session) -> dict:
    """Dump all tables as lists of dicts."""
    data = {}

    def rows(model, fields):
        results = []
        for row in db.query(model).all():
            results.append({f: getattr(row, f) for f in fields})
        return results

    data["areas"] = rows(m.Area, ["id", "title", "description", "icon", "color", "created_at", "status"])
    data["dreams"] = rows(m.Dream, ["id", "title", "description", "icon", "created_at", "status"])
    data["dream_areas"] = rows(m.DreamArea, ["id", "dream_id", "area_id"])
    data["projects"] = rows(m.Project, ["id", "title", "area_id", "description", "start_date",
                                        "target_date", "status", "tags", "progress_override", "notes"])
    data["tasks"] = rows(m.Task, ["id", "project_id", "title", "status", "priority",
                                   "due_date", "completed_at", "effort", "notes", "created_at"])
    data["snapshots"] = rows(m.Snapshot, ["id", "date", "project_id", "progress", "tasks_done", "tasks_total"])
    data["habits"] = rows(m.Habit, ["id", "title", "area_id", "description", "frequency",
                                     "target_days", "color", "created_at", "status"])
    data["habit_logs"] = rows(m.HabitLog, ["id", "habit_id", "date", "done", "note"])
    data["weekly_reviews"] = rows(m.WeeklyReview, ["id", "week_start", "completed_at", "wins",
                                                    "struggles", "next_week_focus",
                                                    "focus_task_ids", "mood", "raw_stats"])
    return data


@router.get("/backup")
def download_backup(db: Session = Depends(get_db)):
    data = _dump_all(db)
    today = date.today().isoformat()
    payload = json.dumps(data, default=_serialize, indent=2)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=lifeops_backup_{today}.json"},
    )


@router.get("/export/csv")
def export_csv(db: Session = Depends(get_db)):
    data = _dump_all(db)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for table_name, rows in data.items():
            if not rows:
                continue
            csv_buf = io.StringIO()
            writer = csv.DictWriter(csv_buf, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            for row in rows:
                writer.writerow({k: str(v) if v is not None else "" for k, v in row.items()})
            zf.writestr(f"{table_name}.csv", csv_buf.getvalue())
    buf.seek(0)
    today = date.today().isoformat()
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=lifeops_export_{today}.zip"},
    )


@router.post("/import")
async def import_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid JSON: {e}")

    # Clear all tables in dependency order
    db.query(m.HabitLog).delete()
    db.query(m.Habit).delete()
    db.query(m.WeeklyReview).delete()
    db.query(m.Snapshot).delete()
    db.query(m.Task).delete()
    db.query(m.Project).delete()
    db.query(m.DreamArea).delete()
    db.query(m.Dream).delete()
    db.query(m.Area).delete()
    db.commit()

    def parse_date(v):
        if not v:
            return None
        try:
            return date.fromisoformat(str(v))
        except Exception:
            return None

    def parse_datetime(v):
        if not v:
            return None
        try:
            return datetime.fromisoformat(str(v))
        except Exception:
            return None

    def parse_int(v):
        if v is None or v == "":
            return None
        try:
            return int(v)
        except Exception:
            return None

    def parse_float(v):
        if v is None or v == "":
            return None
        try:
            return float(v)
        except Exception:
            return None

    try:
        for row in data.get("areas", []):
            db.add(m.Area(id=row["id"], title=row["title"], description=row.get("description"),
                          icon=row.get("icon"), color=row.get("color"),
                          created_at=parse_date(row.get("created_at")) or date.today(),
                          status=row.get("status", "active")))
        for row in data.get("dreams", []):
            db.add(m.Dream(id=row["id"], title=row["title"], description=row.get("description"),
                           icon=row.get("icon"),
                           created_at=parse_date(row.get("created_at")) or date.today(),
                           status=row.get("status", "active")))
        for row in data.get("dream_areas", []):
            db.add(m.DreamArea(id=row["id"], dream_id=row["dream_id"], area_id=row["area_id"]))
        for row in data.get("projects", []):
            db.add(m.Project(id=row["id"], title=row["title"], area_id=row.get("area_id"),
                             description=row.get("description"),
                             start_date=parse_date(row.get("start_date")),
                             target_date=parse_date(row.get("target_date")),
                             status=row.get("status", "active"),
                             tags=row.get("tags"), notes=row.get("notes"),
                             progress_override=parse_float(row.get("progress_override"))))
        for row in data.get("tasks", []):
            db.add(m.Task(id=row["id"], project_id=row["project_id"], title=row["title"],
                          status=row.get("status", "todo"), priority=row.get("priority", "medium"),
                          due_date=parse_date(row.get("due_date")),
                          completed_at=parse_date(row.get("completed_at")),
                          effort=parse_int(row.get("effort")), notes=row.get("notes"),
                          created_at=parse_datetime(row.get("created_at")) or datetime.utcnow()))
        for row in data.get("snapshots", []):
            db.add(m.Snapshot(id=row["id"], date=parse_date(row.get("date")) or date.today(),
                              project_id=row["project_id"],
                              progress=parse_float(row.get("progress")) or 0.0,
                              tasks_done=parse_int(row.get("tasks_done")) or 0,
                              tasks_total=parse_int(row.get("tasks_total")) or 0))
        for row in data.get("habits", []):
            db.add(m.Habit(id=row["id"], title=row["title"], area_id=row.get("area_id"),
                           description=row.get("description"),
                           frequency=row.get("frequency", "daily"),
                           target_days=row.get("target_days"), color=row.get("color"),
                           created_at=parse_date(row.get("created_at")) or date.today(),
                           status=row.get("status", "active")))
        for row in data.get("habit_logs", []):
            db.add(m.HabitLog(id=row["id"], habit_id=row["habit_id"],
                              date=parse_date(row.get("date")) or date.today(),
                              done=parse_int(row.get("done")) or 0, note=row.get("note")))
        for row in data.get("weekly_reviews", []):
            db.add(m.WeeklyReview(id=row["id"],
                                  week_start=parse_date(row.get("week_start")) or date.today(),
                                  completed_at=parse_datetime(row.get("completed_at")),
                                  wins=row.get("wins"), struggles=row.get("struggles"),
                                  next_week_focus=row.get("next_week_focus"),
                                  focus_task_ids=row.get("focus_task_ids"),
                                  mood=parse_int(row.get("mood")), raw_stats=row.get("raw_stats")))
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Import failed: {e}")

    return {"ok": True, "message": "Data imported successfully"}


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    counts = {
        "areas": db.query(m.Area).count(),
        "projects": db.query(m.Project).count(),
        "tasks": db.query(m.Task).count(),
        "habits": db.query(m.Habit).filter(m.Habit.status != "archived").count(),
        "reviews": db.query(m.WeeklyReview).count(),
        "habit_logs": db.query(m.HabitLog).count(),
        "snapshots": db.query(m.Snapshot).count(),
    }

    db_size = None
    db_path = Path(DB_PATH) if DB_PATH else None
    if db_path and db_path.exists():
        size_bytes = db_path.stat().st_size
        db_size = f"{size_bytes / 1024:.1f} KB" if size_bytes < 1_048_576 else f"{size_bytes / 1_048_576:.1f} MB"

    # Oldest and newest entries
    first_task = db.query(m.Task).order_by(m.Task.created_at).first()
    last_task = db.query(m.Task).order_by(m.Task.created_at.desc()).first()

    return {
        "counts": counts,
        "db_size": db_size,
        "first_entry": first_task.created_at.isoformat() if first_task else None,
        "last_activity": last_task.created_at.isoformat() if last_task else None,
    }
