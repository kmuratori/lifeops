from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from db.session import get_db
from db import models as m
from api.schemas import HabitIn, HabitOut, HabitLogIn, HabitDayStatus

from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/habits", tags=["habits"])

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def is_scheduled(habit: m.Habit, d: date) -> bool:
    freq = habit.frequency
    if freq == "daily":
        return True
    if freq == "weekly":
        return d.weekday() == 0  # Monday
    if freq == "custom" and habit.target_days:
        days = [int(x.strip()) for x in habit.target_days.split(",") if x.strip()]
        return d.weekday() in days
    # x_per_week / x_per_month: any day is valid — caller evaluates period completion
    if freq in ("x_per_week", "x_per_month"):
        return True
    return True


def _week_start(d: date) -> date:
    """Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def _month_start(d: date) -> date:
    return d.replace(day=1)


def compute_streaks(habit: m.Habit, logs_by_date: dict) -> tuple[int, int]:
    today = date.today()
    freq = habit.frequency
    target = habit.frequency_count or 1

    if freq == "x_per_week":
        def week_done(week_mon: date) -> bool:
            count = sum(
                1 for i in range(7)
                if logs_by_date.get(week_mon + timedelta(days=i), 0)
            )
            return count >= target

        current = 0
        w = _week_start(today)
        for _ in range(52):
            if week_done(w):
                current += 1
            else:
                break
            w -= timedelta(weeks=1)

        best = current
        if logs_by_date:
            earliest = min(logs_by_date.keys())
            w = _week_start(earliest)
            run = 0
            while w <= _week_start(today):
                if week_done(w):
                    run += 1
                    best = max(best, run)
                else:
                    run = 0
                w += timedelta(weeks=1)
        return current, best

    if freq == "x_per_month":
        def month_done(first: date) -> bool:
            count = sum(
                1 for dt, done in logs_by_date.items()
                if done and dt.year == first.year and dt.month == first.month
            )
            return count >= target

        current = 0
        m_start = _month_start(today)
        for _ in range(24):
            if month_done(m_start):
                current += 1
            else:
                break
            if m_start.month == 1:
                m_start = m_start.replace(year=m_start.year - 1, month=12)
            else:
                m_start = m_start.replace(month=m_start.month - 1)

        best = current
        if logs_by_date:
            earliest = min(logs_by_date.keys())
            ms = _month_start(earliest)
            run = 0
            while ms <= _month_start(today):
                if month_done(ms):
                    run += 1
                    best = max(best, run)
                else:
                    run = 0
                if ms.month == 12:
                    ms = ms.replace(year=ms.year + 1, month=1)
                else:
                    ms = ms.replace(month=ms.month + 1)
        return current, best

    # Day-level streak (daily / weekly / custom)
    current = 0
    d = today
    for _ in range(366):
        if is_scheduled(habit, d):
            if logs_by_date.get(d, 0):
                current += 1
            else:
                break
        d -= timedelta(days=1)

    if not logs_by_date:
        return current, current

    all_dates = sorted(logs_by_date.keys())
    start = all_dates[0]
    end = max(all_dates[-1], today)

    best = 0
    run = 0
    d = start
    while d <= end:
        if is_scheduled(habit, d):
            if logs_by_date.get(d, 0):
                run += 1
                best = max(best, run)
            else:
                run = 0
        d += timedelta(days=1)

    return current, max(best, current)


def compute_completion_rate(habit: m.Habit, logs_by_date: dict) -> float:
    today = date.today()
    freq = habit.frequency
    target = habit.frequency_count or 1

    if freq == "x_per_week":
        weeks_met = 0
        total_weeks = 4
        for i in range(total_weeks):
            w = _week_start(today) - timedelta(weeks=i)
            count = sum(
                1 for j in range(7)
                if logs_by_date.get(w + timedelta(days=j), 0)
            )
            if count >= target:
                weeks_met += 1
        return round(weeks_met / total_weeks, 3)

    if freq == "x_per_month":
        months_met = 0
        total_months = 3
        ms = _month_start(today)
        for _ in range(total_months):
            count = sum(
                1 for dt, done in logs_by_date.items()
                if done and dt.year == ms.year and dt.month == ms.month
            )
            if count >= target:
                months_met += 1
            if ms.month == 1:
                ms = ms.replace(year=ms.year - 1, month=12)
            else:
                ms = ms.replace(month=ms.month - 1)
        return round(months_met / total_months, 3)

    scheduled = 0
    done = 0
    for i in range(30):
        d = today - timedelta(days=i)
        if is_scheduled(habit, d):
            scheduled += 1
            if logs_by_date.get(d, 0):
                done += 1
    return round(done / scheduled, 3) if scheduled else 0.0


def to_out(habit: m.Habit) -> HabitOut:
    logs_by_date   = {log.date: log.done for log in habit.logs}
    values_by_date = {log.date: log.value for log in habit.logs if log.value is not None}
    today = date.today()
    current_streak, longest_streak = compute_streaks(habit, logs_by_date)
    completion_rate = compute_completion_rate(habit, logs_by_date)
    done_today  = bool(logs_by_date.get(today, 0))
    value_today = values_by_date.get(today)

    last7 = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        last7.append(HabitDayStatus(
            date=d.isoformat(),
            scheduled=is_scheduled(habit, d),
            done=bool(logs_by_date.get(d, 0)),
            value=values_by_date.get(d),
        ))

    color = habit.color or (habit.area.color if habit.area else None)

    return HabitOut(
        id=habit.id,
        title=habit.title,
        area_id=habit.area_id,
        description=habit.description,
        frequency=habit.frequency,
        target_days=habit.target_days,
        frequency_count=habit.frequency_count,
        habit_type=habit.habit_type or 'yes_no',
        target_value=habit.target_value,
        unit=habit.unit,
        color=color,
        created_at=habit.created_at,
        status=habit.status,
        area_title=habit.area.title if habit.area else None,
        area_color=habit.area.color if habit.area else None,
        current_streak=current_streak,
        longest_streak=longest_streak,
        completion_rate=completion_rate,
        done_today=done_today,
        value_today=value_today,
        last7=last7,
    )


@router.get("", response_model=list[HabitOut])
def list_habits(db: Session = Depends(get_db)):
    habits = db.query(m.Habit).filter(m.Habit.status != "archived").all()
    return [to_out(h) for h in habits]


@router.post("", response_model=HabitOut)
def create_habit(payload: HabitIn, db: Session = Depends(get_db)):
    habit = m.Habit(**payload.model_dump())
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return to_out(habit)


@router.put("/{habit_id}", response_model=HabitOut)
def update_habit(habit_id: str, payload: HabitIn, db: Session = Depends(get_db)):
    habit = db.query(m.Habit).get(habit_id)
    if not habit:
        raise HTTPException(404, "Habit not found")
    for k, v in payload.model_dump().items():
        setattr(habit, k, v)
    db.commit()
    db.refresh(habit)
    return to_out(habit)


@router.delete("/{habit_id}")
def archive_habit(habit_id: str, db: Session = Depends(get_db)):
    habit = db.query(m.Habit).get(habit_id)
    if not habit:
        raise HTTPException(404, "Habit not found")
    habit.status = "archived"
    db.commit()
    return {"ok": True}


@router.post("/{habit_id}/log", response_model=HabitOut)
def log_habit(habit_id: str, payload: HabitLogIn, db: Session = Depends(get_db)):
    habit = db.query(m.Habit).get(habit_id)
    if not habit:
        raise HTTPException(404, "Habit not found")
    target_date = date.fromisoformat(payload.date) if payload.date else date.today()

    is_measurable = (habit.habit_type or "yes_no") == "measurable"
    if is_measurable and payload.value is not None:
        logged_value = payload.value
        done = 1 if (habit.target_value is None or logged_value >= habit.target_value) else 0
    else:
        logged_value = None
        done = 1 if payload.done else 0

    log = (
        db.query(m.HabitLog)
        .filter(m.HabitLog.habit_id == habit_id, m.HabitLog.date == target_date)
        .first()
    )
    if log:
        log.done = done
        log.note = payload.note
        if is_measurable:
            log.value = logged_value
    else:
        log = m.HabitLog(
            habit_id=habit_id, date=target_date,
            done=done, note=payload.note,
            value=logged_value,
        )
        db.add(log)
    db.commit()
    db.refresh(habit)
    return to_out(habit)


@router.get("/{habit_id}/logs")
def get_habit_logs(
    habit_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    habit = db.query(m.Habit).get(habit_id)
    if not habit:
        raise HTTPException(404, "Habit not found")
    q = db.query(m.HabitLog).filter(m.HabitLog.habit_id == habit_id)
    if from_date:
        q = q.filter(m.HabitLog.date >= date.fromisoformat(from_date))
    if to_date:
        q = q.filter(m.HabitLog.date <= date.fromisoformat(to_date))
    logs = q.order_by(m.HabitLog.date).all()
    return [
        {
            "date": log.date.isoformat(),
            "done": bool(log.done),
            "note": log.note,
            "value": log.value,
        }
        for log in logs
    ]
