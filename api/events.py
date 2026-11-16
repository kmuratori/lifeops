"""Calendar event CRUD endpoints."""
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from api.schemas import EventIn, EventOut, EventUpdate
from db import models as m
from db.session import get_db

router = APIRouter(prefix="/api/events", tags=["events"])


def _utc_aware(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _event_response(event: m.Event):
    return EventOut(
        id=event.id,
        title=event.title,
        description=event.description,
        is_all_day=event.is_all_day,
        start_at=_utc_aware(event.start_at),
        end_at=_utc_aware(event.end_at),
        start_date=event.start_date,
        end_date=event.end_date,
        location=event.location,
        category=event.category,
        color=event.color,
        created_at=_utc_aware(event.created_at),
        updated_at=_utc_aware(event.updated_at),
    )


def _storage_values(payload: EventIn):
    data = payload.model_dump()
    for field in ("start_at", "end_at"):
        value = data[field]
        if value is not None:
            data[field] = value.astimezone(timezone.utc).replace(tzinfo=None)
    return data


@router.get("", response_model=list[EventOut])
def list_events(db: Session = Depends(get_db)):
    events = db.query(m.Event).order_by(m.Event.is_all_day.desc(), m.Event.start_date, m.Event.start_at, m.Event.title).all()
    return [_event_response(event) for event in events]


@router.post("", response_model=EventOut, status_code=201)
def create_event(payload: EventIn, db: Session = Depends(get_db)):
    event = m.Event(**_storage_values(payload))
    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_response(event)


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: str, db: Session = Depends(get_db)):
    event = db.get(m.Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return _event_response(event)


@router.put("/{event_id}", response_model=EventOut)
def update_event(event_id: str, payload: EventUpdate, db: Session = Depends(get_db)):
    event = db.get(m.Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    current = {
        "title": event.title,
        "description": event.description,
        "is_all_day": event.is_all_day,
        "start_at": _utc_aware(event.start_at),
        "end_at": _utc_aware(event.end_at),
        "start_date": event.start_date,
        "end_date": event.end_date,
        "location": event.location,
        "category": event.category,
        "color": event.color,
    }
    current.update(payload.model_dump(exclude_unset=True))
    try:
        validated = EventIn.model_validate(current)
    except ValidationError as error:
        messages = "; ".join(issue["msg"] for issue in error.errors())
        raise HTTPException(422, messages) from error
    for field, value in _storage_values(validated).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return _event_response(event)


@router.delete("/{event_id}")
def delete_event(event_id: str, db: Session = Depends(get_db)):
    event = db.get(m.Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    db.delete(event)
    db.commit()
    return {"ok": True}
