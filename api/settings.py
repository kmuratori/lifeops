"""Feature 7: Data Export and Backup UI endpoints."""
import csv
import io
import json
import os
import time
import zipfile
import uuid
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
                                      "target_days", "frequency_count", "habit_type", "target_value",
                                      "unit", "color", "created_at", "status"])
    data["habit_logs"] = rows(m.HabitLog, ["id", "habit_id", "date", "done", "value", "note"])
    data["weekly_reviews"] = rows(m.WeeklyReview, ["id", "week_start", "completed_at", "wins",
                                                    "struggles", "next_week_focus",
                                                    "focus_task_ids", "mood", "raw_stats"])
    return data


@router.get("/backup")
def download_backup(db: Session = Depends(get_db)):
    data = _dump_all(db)
    data = {"format": "lifeops", "schema_version": 1, **data}
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

    def csv_value(value):
        if value is None:
            return ""
        if hasattr(value, "value"):
            return value.value
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return str(value)

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for table_name, rows in data.items():
            if not rows:
                continue
            csv_buf = io.StringIO()
            writer = csv.DictWriter(csv_buf, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            for row in rows:
                writer.writerow({k: csv_value(v) for k, v in row.items()})
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
    preview = await preview_import(file, db)
    if not preview["valid"]:
        raise HTTPException(422, {"message": "Backup validation failed", "issues": preview["issues"]})
    return commit_import({"token": preview["token"], "conflict_policy": "replace"}, db)


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


_IMPORT_PREVIEWS: dict[str, dict] = {}
_ENTITY_MODELS = {
    "areas": m.Area, "dreams": m.Dream, "dream_areas": m.DreamArea,
    "projects": m.Project, "tasks": m.Task, "snapshots": m.Snapshot,
    "habits": m.Habit, "habit_logs": m.HabitLog, "weekly_reviews": m.WeeklyReview,
}
_DATE_FIELDS = {"created_at", "start_date", "target_date", "due_date", "completed_at", "date", "week_start"}
_DATETIME_FIELDS = {"completed_at"}


def _validate_import(
    data: dict,
    db: Session,
    allow_database_relationships: bool = True,
) -> tuple[dict, list[str]]:
    if not isinstance(data, dict):
        raise HTTPException(400, "Backup must contain a JSON object")
    if data.get("format") not in (None, "lifeops"):
        raise HTTPException(400, "This file is not a LifeOps backup")
    version = data.get("schema_version", 0)
    if version not in (0, 1):
        raise HTTPException(400, f"Unsupported backup schema version: {version}")
    normalized = {key: data.get(key, []) for key in _ENTITY_MODELS}
    issues = []
    ids_by_type = {}
    for entity, rows in normalized.items():
        if not isinstance(rows, list):
            issues.append(f"{entity} must be a list")
            normalized[entity] = []
            continue
        seen = set()
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
                issues.append(f"{entity}[{index}] is missing an id")
                continue
            if row["id"] in seen:
                issues.append(f"{entity} contains duplicate id {row['id']}")
            seen.add(row["id"])
            if entity in ("areas", "dreams", "projects", "tasks", "habits") and not str(row.get("title", "")).strip():
                issues.append(f"{entity}[{index}] is missing a title")
            required_fields = {
                "dream_areas": ("dream_id", "area_id"),
                "snapshots": ("project_id",),
                "habit_logs": ("habit_id", "date"),
                "weekly_reviews": ("week_start",),
            }.get(entity, ())
            for field in required_fields:
                if row.get(field) in (None, ""):
                    issues.append(f"{entity}[{index}] is missing {field}")
        normalized[entity] = [row for row in rows if isinstance(row, dict)]
        ids_by_type[entity] = seen

    allowed_statuses = {
        "areas": {"active", "paused"},
        "dreams": {"active", "achieved", "dropped"},
        "projects": {"active", "paused", "done", "dropped"},
        "tasks": {"todo", "in_progress", "done", "blocked"},
        "habits": {"active", "archived"},
    }
    date_fields = {
        "areas": {"created_at"},
        "dreams": {"created_at"},
        "projects": {"start_date", "target_date"},
        "tasks": {"due_date", "completed_at", "created_at"},
        "snapshots": {"date"},
        "habits": {"created_at"},
        "habit_logs": {"date"},
        "weekly_reviews": {"week_start", "completed_at"},
    }
    for entity, statuses in allowed_statuses.items():
        for row in normalized[entity]:
            if not isinstance(row.get("status"), str) or row.get("status") not in statuses:
                issues.append(f'{entity} record {row.get("id")} has an invalid status')
    for row in normalized["tasks"]:
        if not isinstance(row.get("priority"), str) or row.get("priority") not in {"low", "medium", "high", "critical"}:
            issues.append(f'Task {row.get("id")} has an invalid priority')
    for entity, fields in date_fields.items():
        for row in normalized[entity]:
            for field in fields:
                value = row.get(field)
                if value in (None, ""):
                    continue
                try:
                    if (entity == "tasks" and field == "created_at") or (entity == "weekly_reviews" and field == "completed_at"):
                        datetime.fromisoformat(str(value))
                    else:
                        date.fromisoformat(str(value)[:10])
                except (TypeError, ValueError):
                    issues.append(f'{entity} record {row.get("id")} has an invalid {field} date')

    def exists(entity, identifier):
        if not isinstance(identifier, str) or not identifier:
            return False
        if identifier in ids_by_type.get(entity, set()):
            return True
        return allow_database_relationships and db.query(_ENTITY_MODELS[entity].id).filter_by(id=identifier).first() is not None

    for row in normalized.get("projects", []):
        if row.get("area_id") and not exists("areas", row["area_id"]):
            issues.append(f'Project "{row.get("title", row.get("id"))}" references missing area {row["area_id"]}')
    for row in normalized.get("dream_areas", []):
        if not exists("dreams", row.get("dream_id")) or not exists("areas", row.get("area_id")):
            issues.append(f'Dream-area link {row.get("id")} references a missing dream or area')
    for row in normalized.get("tasks", []):
        if row.get("project_id") and not exists("projects", row["project_id"]):
            issues.append(f'Task "{row.get("title", row.get("id"))}" references missing project {row["project_id"]}')
    for row in normalized.get("snapshots", []):
        if not exists("projects", row.get("project_id")):
            issues.append(f'Snapshot {row.get("id")} references a missing project')
    for row in normalized.get("habits", []):
        if row.get("area_id") and not exists("areas", row["area_id"]):
            issues.append(f'Habit "{row.get("title", row.get("id"))}" references a missing area')
        if not isinstance(row.get("frequency"), str) or row.get("frequency") not in {"daily", "weekly", "custom", "x_per_week", "x_per_month"}:
            issues.append(f'Habit {row.get("id")} has an invalid frequency')
    for row in normalized.get("habit_logs", []):
        if not exists("habits", row.get("habit_id")):
            issues.append(f'Habit log {row.get("id")} references a missing habit')
        if row.get("done") not in (True, False, 0, 1):
            issues.append(f'Habit log {row.get("id")} has an invalid done value')
    for entity, rows in (("snapshots", normalized["snapshots"]),):
        for row in rows:
            progress = row.get("progress")
            if progress is not None and (
                isinstance(progress, bool) or not isinstance(progress, (int, float)) or not 0 <= progress <= 1
            ):
                issues.append(f'Snapshot {row.get("id")} has an invalid progress value')
    for row in normalized["projects"]:
        override = row.get("progress_override")
        if override is not None and (
            isinstance(override, bool) or not isinstance(override, (int, float)) or not 0 <= override <= 1
        ):
            issues.append(f'Project {row.get("id")} has an invalid progress override')
    return normalized, issues


def _import_conflict_state(data: dict, db: Session) -> tuple[dict, dict]:
    """Return create/update counts and the IDs already present at preview time."""
    counts = {}
    conflicts = {}
    for entity, rows in data.items():
        model = _ENTITY_MODELS[entity]
        incoming_ids = {row["id"] for row in rows if isinstance(row.get("id"), str)}
        existing_ids = {identifier for (identifier,) in db.query(model.id).all()}
        matching_ids = incoming_ids & existing_ids
        counts[entity] = {
            "create": len(incoming_ids - matching_ids),
            "update": len(matching_ids),
        }
        conflicts[entity] = sorted(matching_ids)
    return counts, conflicts


@router.get("/export")
def selective_export(
    entities: str = "areas,dreams,projects,tasks,habits",
    project_mode: str = "all",
    project_ids: str = "",
    include_project_tasks: bool = False,
    include_project_snapshots: bool = False,
    db: Session = Depends(get_db),
):
    selected = {name.strip() for name in entities.split(",") if name.strip()}
    supported = {"areas", "dreams", "projects", "tasks", "habits"}
    if not selected or selected - supported:
        raise HTTPException(422, "Choose one or more supported entity types")
    data = _dump_all(db)
    available_projects = data["projects"]
    available_project_ids = {project["id"] for project in available_projects}
    project_id_set = set(available_project_ids)
    project_filter_applies = "projects" in selected or "tasks" in selected or include_project_tasks
    if project_filter_applies:
        if project_mode == "active":
            project_id_set = {p["id"] for p in available_projects if p["status"] == "active"}
        elif project_mode == "selected":
            project_id_set = {item for item in project_ids.split(",") if item}
            standalone_tasks_only = (
                "tasks" in selected
                and "projects" not in selected
                and not include_project_tasks
            )
            if not project_id_set and not standalone_tasks_only:
                raise HTTPException(422, "Select at least one project")
            if not project_id_set.issubset(available_project_ids):
                raise HTTPException(422, "One or more selected projects no longer exist")
        elif project_mode != "all":
            raise HTTPException(422, "Project scope must be all, active, or selected")
    if "projects" in selected:
        data["projects"] = [p for p in available_projects if p["id"] in project_id_set]
    else:
        data["projects"] = []
    if "tasks" in selected:
        if project_mode in ("active", "selected"):
            data["tasks"] = [
                task for task in data["tasks"]
                if task["project_id"] is None or task["project_id"] in project_id_set
            ]
    elif include_project_tasks and "projects" in selected:
        data["tasks"] = [
            task for task in data["tasks"]
            if task["project_id"] in project_id_set
        ]
    else:
        data["tasks"] = []
    for name in ("areas", "dreams", "habits"):
        if name not in selected:
            data[name] = []
    if "habits" not in selected:
        data["habit_logs"] = []
    if "dreams" not in selected or "areas" not in selected:
        data["dream_areas"] = []
    if "projects" not in selected or not include_project_snapshots:
        data["snapshots"] = []
    else:
        data["snapshots"] = [s for s in data["snapshots"] if s["project_id"] in project_id_set]
    if not ({"areas", "dreams", "projects", "tasks", "habits"} <= selected):
        data["weekly_reviews"] = []
    payload = {"format": "lifeops", "schema_version": 1, "entities": sorted(selected), **data}
    today = date.today().isoformat()
    return Response(json.dumps(payload, default=_serialize, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename=lifeops_export_{today}.json"})


@router.post("/import/preview")
async def preview_import(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Backup files must be 10 MB or smaller")
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise HTTPException(400, f"Invalid JSON: {error}")
    complete_backup = (
        isinstance(data, dict)
        and data.get("format") == "lifeops"
        and type(data.get("schema_version")) is int
        and data.get("schema_version") == 1
        and not data.get("entities")
        and set(_ENTITY_MODELS).issubset(data.keys())
    )
    normalized, issues = _validate_import(
        data,
        db,
        allow_database_relationships=not complete_backup,
    )
    counts, conflicts = _import_conflict_state(normalized, db)
    token = str(uuid.uuid4())
    _IMPORT_PREVIEWS[token] = {
        "data": normalized,
        "issues": issues,
        "complete_backup": complete_backup,
        "counts": counts,
        "conflicts": conflicts,
        "created": time.time(),
    }
    return {"token": token, "schema_version": data.get("schema_version", 0), "valid": not issues,
            "issues": issues, "counts": counts, "complete_backup": complete_backup}


@router.post("/import/commit")
def commit_import(payload: dict, db: Session = Depends(get_db)):
    token = payload.get("token")
    preview = _IMPORT_PREVIEWS.get(token)
    if not preview:
        raise HTTPException(404, "Import preview expired. Upload the file again.")
    if time.time() - preview["created"] > 900:
        _IMPORT_PREVIEWS.pop(token, None)
        raise HTTPException(410, "Import preview expired. Upload the file again.")
    if preview["issues"]:
        raise HTTPException(422, "Resolve the validation issues before importing")
    policy = payload.get("conflict_policy", "skip")
    if policy not in ("skip", "replace", "replace_all"):
        raise HTTPException(422, "Choose skip, replace, or replace_all")
    if policy == "replace_all" and not preview["complete_backup"]:
        raise HTTPException(422, "Replace all is only allowed for a complete LifeOps backup")
    data = preview["data"]
    _, current_issues = _validate_import(
        {"format": "lifeops", "schema_version": 1, **data},
        db,
        allow_database_relationships=policy != "replace_all",
    )
    if current_issues:
        raise HTTPException(409, {"message": "Database relationships changed after preview", "issues": current_issues})
    current_counts, current_conflicts = _import_conflict_state(data, db)
    if policy != "replace_all" and current_conflicts != preview["conflicts"]:
        raise HTTPException(409, "Records changed after preview. Upload the file again to refresh the import plan.")
    applied = {}
    try:
        if policy == "replace_all":
            for model in (m.HabitLog, m.Habit, m.WeeklyReview, m.Snapshot, m.Task, m.Project, m.DreamArea, m.Dream, m.Area):
                db.query(model).delete(synchronize_session=False)
        for entity, entity_counts in current_counts.items():
            if policy == "replace_all":
                applied[entity] = {"restore": len(data[entity])}
            elif policy == "skip":
                applied[entity] = {
                    "create": entity_counts["create"],
                    "update": 0,
                    "skip": entity_counts["update"],
                }
            else:
                applied[entity] = {
                    "create": entity_counts["create"],
                    "update": entity_counts["update"],
                    "skip": 0,
                }
        order = ("areas", "dreams", "projects", "habits", "tasks", "snapshots", "habit_logs", "weekly_reviews", "dream_areas")
        for entity in order:
            model = _ENTITY_MODELS[entity]
            for row in data[entity]:
                existing = db.query(model).filter_by(id=row["id"]).first()
                if existing and policy == "skip":
                    continue
                values = {key: value for key, value in row.items() if key in model.__table__.columns.keys()}
                for key in _DATE_FIELDS & values.keys():
                    if values[key]:
                        if (key == "completed_at" and entity == "weekly_reviews") or (key == "created_at" and entity == "tasks"):
                            values[key] = datetime.fromisoformat(str(values[key]))
                        else:
                            values[key] = date.fromisoformat(str(values[key])[:10])
                obj = model(**values)
                if existing:
                    db.merge(obj)
                else:
                    db.add(obj)
        db.commit()
    except Exception as error:
        db.rollback()
        raise HTTPException(422, f"Import was rolled back: {error}")
    _IMPORT_PREVIEWS.pop(token, None)
    return {"ok": True, "message": "Import completed", "conflict_policy": policy, "applied": applied}
