import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db import models as m
from api.schemas import ReviewIn, ReviewOut, ReviewSummary

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def week_monday(d: date) -> date:
    """Return the Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def compute_week_stats(db: Session, week_start: date) -> dict:
    week_end = week_start + timedelta(days=6)

    tasks_completed = (
        db.query(m.Task)
        .filter(m.Task.completed_at >= week_start, m.Task.completed_at <= week_end)
        .count()
    )
    tasks_added = (
        db.query(m.Task)
        .filter(m.Task.created_at >= datetime.combine(week_start, datetime.min.time()),
                m.Task.created_at <= datetime.combine(week_end, datetime.max.time()))
        .count()
    )

    # Habits hit rate
    habits = db.query(m.Habit).filter(m.Habit.status != "archived").all()
    total_scheduled = 0
    total_done = 0
    for habit in habits:
        logs_by_date = {log.date: log.done for log in habit.logs}
        for i in range(7):
            d = week_start + timedelta(days=i)
            from api.habits import is_scheduled
            if is_scheduled(habit, d):
                total_scheduled += 1
                if logs_by_date.get(d, 0):
                    total_done += 1
    habits_hit_rate = round(total_done / total_scheduled, 3) if total_scheduled else 0.0

    # Most active area
    area_counts: dict[str, int] = {}
    completed_tasks = (
        db.query(m.Task)
        .filter(m.Task.completed_at >= week_start, m.Task.completed_at <= week_end)
        .all()
    )
    for task in completed_tasks:
        if task.project and task.project.area:
            area_id = task.project.area_id
            area_title = task.project.area.title
            area_counts[area_title] = area_counts.get(area_title, 0) + 1
    most_active_area = max(area_counts, key=area_counts.get) if area_counts else None

    # Projects moved
    projects_moved = set()
    for task in completed_tasks:
        if task.project_id:
            projects_moved.add(task.project_id)

    return {
        "tasks_completed": tasks_completed,
        "tasks_added": tasks_added,
        "habits_hit_rate": habits_hit_rate,
        "most_active_area": most_active_area,
        "projects_moved": len(projects_moved),
    }


def to_out(r: m.WeeklyReview) -> ReviewOut:
    return ReviewOut(
        id=r.id,
        week_start=r.week_start,
        completed_at=r.completed_at,
        wins=r.wins,
        struggles=r.struggles,
        next_week_focus=r.next_week_focus,
        focus_task_ids=r.focus_task_ids,
        mood=r.mood,
        raw_stats=r.raw_stats,
    )


@router.get("", response_model=list[ReviewSummary])
def list_reviews(db: Session = Depends(get_db)):
    reviews = (
        db.query(m.WeeklyReview)
        .order_by(m.WeeklyReview.week_start.desc())
        .all()
    )
    return [
        ReviewSummary(
            id=r.id,
            week_start=r.week_start,
            mood=r.mood,
            completed_at=r.completed_at,
            wins_snippet=((r.wins or "")[:120] + "…") if r.wins and len(r.wins) > 120 else r.wins,
        )
        for r in reviews
    ]


@router.get("/current", response_model=ReviewOut)
def get_current_review(db: Session = Depends(get_db)):
    today = date.today()
    monday = week_monday(today)
    review = db.query(m.WeeklyReview).filter(m.WeeklyReview.week_start == monday).first()
    if not review:
        review = m.WeeklyReview(week_start=monday)
        db.add(review)
        db.commit()
        db.refresh(review)
    return to_out(review)


@router.post("/{review_id}", response_model=ReviewOut)
def save_review(review_id: str, payload: ReviewIn, db: Session = Depends(get_db)):
    review = db.query(m.WeeklyReview).get(review_id)
    if not review:
        raise HTTPException(404, "Review not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(review, k, v)
    # Mark as completed if mood is set
    if payload.mood is not None and not review.completed_at:
        review.completed_at = datetime.utcnow()
        # Capture stats
        stats = compute_week_stats(db, review.week_start)
        review.raw_stats = json.dumps(stats)
    db.commit()
    db.refresh(review)
    return to_out(review)


@router.get("/{review_id}/stats")
def get_review_stats(review_id: str, db: Session = Depends(get_db)):
    review = db.query(m.WeeklyReview).get(review_id)
    if not review:
        raise HTTPException(404, "Review not found")
    if review.raw_stats:
        return json.loads(review.raw_stats)
    return compute_week_stats(db, review.week_start)
