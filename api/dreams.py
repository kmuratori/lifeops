from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m, crud
from api.schemas import DreamIn, DreamOut, AreaTag

router = APIRouter(prefix="/api/dreams", tags=["dreams"])


def _to_out(db: Session, d: m.Dream) -> DreamOut:
    out = DreamOut.model_validate(d)
    out.areas = [
        AreaTag(
            id=link.area.id, title=link.area.title, icon=link.area.icon,
            color=link.area.color, progress=crud.area_progress(db, link.area),
        )
        for link in d.area_links
    ]
    return out


@router.get("", response_model=list[DreamOut])
def list_dreams(db: Session = Depends(get_db)):
    return [_to_out(db, d) for d in db.query(m.Dream).all()]


@router.post("", response_model=DreamOut)
def create_dream(payload: DreamIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    area_ids = data.pop("area_ids", [])
    dream = m.Dream(**data)
    db.add(dream)
    db.flush()
    for area_id in area_ids:
        db.add(m.DreamArea(dream_id=dream.id, area_id=area_id))
    db.commit()
    db.refresh(dream)
    return _to_out(db, dream)


@router.get("/{dream_id}", response_model=DreamOut)
def get_dream(dream_id: str, db: Session = Depends(get_db)):
    dream = db.query(m.Dream).get(dream_id)
    if not dream:
        raise HTTPException(404, "Dream not found")
    return _to_out(db, dream)


@router.put("/{dream_id}", response_model=DreamOut)
def update_dream(dream_id: str, payload: DreamIn, db: Session = Depends(get_db)):
    dream = db.query(m.Dream).get(dream_id)
    if not dream:
        raise HTTPException(404, "Dream not found")
    data = payload.model_dump()
    area_ids = data.pop("area_ids", [])
    for k, v in data.items():
        setattr(dream, k, v)
    db.query(m.DreamArea).filter(m.DreamArea.dream_id == dream_id).delete()
    for area_id in area_ids:
        db.add(m.DreamArea(dream_id=dream.id, area_id=area_id))
    db.commit()
    db.refresh(dream)
    return _to_out(db, dream)


@router.delete("/{dream_id}")
def delete_dream(dream_id: str, db: Session = Depends(get_db)):
    dream = db.query(m.Dream).get(dream_id)
    if not dream:
        raise HTTPException(404, "Dream not found")
    db.delete(dream)
    db.commit()
    return {"ok": True}
