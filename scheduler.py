"""Daily snapshot job — fires at 23:59:59 every night.

On startup, catches up any missed snapshots:
- For each contiguous run of missed dates, if >3 consecutive: only run the last.
- Otherwise run all missed dates in the run.
"""
from apscheduler.schedulers.background import BackgroundScheduler

from db.session import SessionLocal
from db import crud


def _job():
    db = SessionLocal()
    try:
        crud.take_daily_snapshot(db)
    finally:
        db.close()


def _catchup():
    """Run on startup to fill gaps in the snapshot history."""
    db = SessionLocal()
    try:
        crud.run_catchup_snapshots(db)
    finally:
        db.close()


def start_scheduler():
    # Catch up any missed snapshots before starting the regular schedule
    _catchup()

    scheduler = BackgroundScheduler()
    scheduler.add_job(_job, "cron", hour=23, minute=59, second=59, id="daily_snapshot")
    scheduler.start()
    return scheduler
