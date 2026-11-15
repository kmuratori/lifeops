from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m, crud
from api.schemas import ProjectIn, ProjectOut, ProjectBulkIn

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _to_out(db: Session, p: m.Project) -> ProjectOut:
    tasks_total = len(p.tasks)
    tasks_done = sum(1 for t in p.tasks if t.status == m.TaskStatus.done)
    tags = [t for t in (p.tags or "").split(",") if t.strip()]
    return ProjectOut(
        id=p.id,
        title=p.title,
        area_id=p.area_id,
        description=p.description,
        start_date=p.start_date,
        target_date=p.target_date,
        status=p.status.value if hasattr(p.status, "value") else p.status,
        tags=tags,
        notes=p.notes,
        progress=crud.project_progress(db, p),
        tasks_done=tasks_done,
        tasks_total=tasks_total,
        area_color=p.area.color if p.area else None,
        area_title=p.area.title if p.area else None,
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return [_to_out(db, p) for p in db.query(m.Project).all()]


@router.post("/bulk")
def bulk_projects(payload: ProjectBulkIn, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(payload.ids))
    if not ids:
        raise HTTPException(422, "Select at least one project")
    if len(ids) > 500:
        raise HTTPException(422, "A single operation can include at most 500 projects")
    projects = db.query(m.Project).filter(m.Project.id.in_(ids)).all()
    if len(projects) != len(ids):
        raise HTTPException(404, "One or more selected projects no longer exist")
    if payload.action == "pause":
        for project in projects:
            project.status = m.ProjectStatus.paused
    elif payload.action == "delete":
        task_count = db.query(m.Task).filter(m.Task.project_id.in_(ids)).count()
        snapshot_count = db.query(m.Snapshot).filter(m.Snapshot.project_id.in_(ids)).count()
        if task_count or snapshot_count:
            raise HTTPException(
                409,
                f"Selected projects contain {task_count} task(s) and {snapshot_count} snapshot(s). "
                "Move or detach tasks and preserve/export snapshots before deleting projects.",
            )
        for project in projects:
            db.delete(project)
    else:
        raise HTTPException(422, "Unsupported project action")
    db.commit()
    return {"ok": True, "affected": len(projects), "action": payload.action}


@router.post("", response_model=ProjectOut)
def create_project(payload: ProjectIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    data["tags"] = ",".join(data.pop("tags", []) or []) or None
    project = m.Project(**data)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_out(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(m.Project).get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return _to_out(db, project)


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, payload: ProjectIn, db: Session = Depends(get_db)):
    project = db.query(m.Project).get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    data = payload.model_dump()
    data["tags"] = ",".join(data.pop("tags", []) or []) or None
    for k, v in data.items():
        setattr(project, k, v)
    db.commit()
    db.refresh(project)
    return _to_out(db, project)


@router.delete("/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(m.Project).get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    task_count = db.query(m.Task).filter(m.Task.project_id == project_id).count()
    snapshot_count = db.query(m.Snapshot).filter(m.Snapshot.project_id == project_id).count()
    if task_count or snapshot_count:
        raise HTTPException(
            409,
            f"Project has {task_count} associated task(s) and {snapshot_count} progress snapshot(s). "
            "Move or detach tasks and preserve/export snapshots before deleting it.",
        )
    db.delete(project)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/sparkline")
def project_sparkline(project_id: str, db: Session = Depends(get_db)):
    """Last-30-days progress trend, from the project's own Snapshot rows."""
    project = db.query(m.Project).get(project_id)
    if not project:
        return []
    snaps = (
        db.query(m.Snapshot)
        .filter(m.Snapshot.project_id == project_id)
        .order_by(m.Snapshot.date)
        .limit(30)
        .all()
    )
    return [{"date": s.date.isoformat(), "progress": s.progress} for s in snaps]
