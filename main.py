"""LifeOps — FastAPI entry point.
Run with: python main.py   OR   lifeops serve  (see cli.py)
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from db.session import init_db
from api import areas, dreams, projects, tasks, insights, habits, reviews, settings, calendar

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="LifeOps")

init_db()

app.include_router(areas.router)
app.include_router(dreams.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(insights.router)
app.include_router(habits.router)
app.include_router(reviews.router)
app.include_router(settings.router)
app.include_router(calendar.router)

# static assets (css/js/fonts) — index.html served separately below so that
# hash-based client routing (#/dashboard etc.) always resolves to index.html
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
if (FRONTEND_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    from scheduler import start_scheduler
    start_scheduler()
    import config
    uvicorn.run("main:app", host=config.HOST, port=config.PORT)
