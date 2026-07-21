"""DB engine/session setup. Uses ~/.local/share/lifeops/data.db by default,
overridable via LIFEOPS_DB_PATH env var (handy for local dev / demo)."""
import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from db.models import Base

DEFAULT_DB_PATH = Path.home() / ".local" / "share" / "lifeops" / "data.db"
DB_PATH = Path(os.environ.get("LIFEOPS_DB_PATH", DEFAULT_DB_PATH))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)
    # Schema migrations — each ALTER TABLE is wrapped so existing DBs are safe
    _migrations = [
        "ALTER TABLE habits ADD COLUMN frequency_count INTEGER",
        "ALTER TABLE habits ADD COLUMN habit_type TEXT NOT NULL DEFAULT 'yes_no'",
        "ALTER TABLE habits ADD COLUMN target_value REAL",
        "ALTER TABLE habits ADD COLUMN unit TEXT",
        "ALTER TABLE habit_logs ADD COLUMN value REAL",
    ]
    with engine.connect() as conn:
        for sql in _migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # Column already exists — safe to ignore


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
