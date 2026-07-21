from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m, crud
from api.schemas import AreaIn, AreaOut

router = APIRouter(prefix="/api/areas", tags=["areas"])

DAYS_THRIVING = 3
DAYS_ACTIVE = 7
DAYS_SLOWING = 14


def _health(db: Session, a: m.Area) -> tuple[str, str, int | None, int]:
    """Compute (health_status, health_label, last_activity_days, stalled_projects)."""
    today = date.today()
    cutoff_stall = today - timedelta(days=14)

    active_projects = [p for p in a.projects if p.status == m.ProjectStatus.active]
    stalled = 0
    last_completion: date | None = None

    for p in active_projects:
        project_recent = False
        for t in p.tasks:
            if t.completed_at:
                if last_completion is None or t.completed_at > last_completion:
                    last_completion = t.completed_at
                if t.completed_at >= cutoff_stall:
                    project_recent = True
        if p.tasks and not project_recent:
            stalled += 1

    if last_completion is None:
        days_ago = None
    else:
        days_ago = (today - last_completion).days

    # Derive status
    has_active_with_tasks = any(p.tasks for p in active_projects)
    if days_ago is None or not has_active_with_tasks:
        status = "neglected"
    elif days_ago <= DAYS_THRIVING and stalled == 0:
        status = "thriving"
    elif days_ago <= DAYS_ACTIVE:
        status = "active"
    elif days_ago <= DAYS_SLOWING or stalled > 0:
        status = "slowing"
    else:
        status = "neglected"

    if days_ago is None:
        label = "No activity recorded"
    elif days_ago == 0:
        label = "Active today"
    elif days_ago == 1:
        label = "Active yesterday"
    elif days_ago <= DAYS_SLOWING:
        label = f"Active {days_ago} days ago"
    else:
        label = f"No activity in {days_ago} days"

    if stalled > 0 and status in ("slowing", "neglected"):
        label = f"{stalled} project{'s' if stalled > 1 else ''} stalling"

    return status, label, days_ago, stalled


def _to_out(db: Session, a: m.Area) -> AreaOut:
    out = AreaOut.model_validate(a)
    out.progress = crud.area_progress(db, a)
    out.active_project_count = sum(1 for p in a.projects if p.status == m.ProjectStatus.active)
    out.health_status, out.health_label, out.last_activity_days, out.stalled_projects = _health(db, a)
    return out


@router.get("", response_model=list[AreaOut])
def list_areas(db: Session = Depends(get_db)):
    return [_to_out(db, a) for a in db.query(m.Area).all()]


@router.post("", response_model=AreaOut)
def create_area(payload: AreaIn, db: Session = Depends(get_db)):
    area = m.Area(**payload.model_dump())
    db.add(area)
    db.commit()
    db.refresh(area)
    return _to_out(db, area)


@router.get("/{area_id}", response_model=AreaOut)
def get_area(area_id: str, db: Session = Depends(get_db)):
    area = db.query(m.Area).get(area_id)
    if not area:
        raise HTTPException(404, "Area not found")
    return _to_out(db, area)


@router.put("/{area_id}", response_model=AreaOut)
def update_area(area_id: str, payload: AreaIn, db: Session = Depends(get_db)):
    area = db.query(m.Area).get(area_id)
    if not area:
        raise HTTPException(404, "Area not found")
    for k, v in payload.model_dump().items():
        setattr(area, k, v)
    db.commit()
    db.refresh(area)
    return _to_out(db, area)


@router.delete("/{area_id}")
def delete_area(area_id: str, db: Session = Depends(get_db)):
    area = db.query(m.Area).get(area_id)
    if not area:
        raise HTTPException(404, "Area not found")
    db.delete(area)
    db.commit()
    return {"ok": True}
