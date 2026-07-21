from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m, crud
from api.schemas import ProjectIn, ProjectOut

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
