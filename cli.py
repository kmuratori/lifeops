"""LifeOps CLI — terminal-native interaction (spec section 9)."""
import json
from datetime import date, datetime

import typer

from db.session import init_db, SessionLocal, DB_PATH
from db import models as m, crud
import config

app = typer.Typer(help="LifeOps — a life command center for people who live in the terminal.")
task_app = typer.Typer(help="Manage tasks")
project_app = typer.Typer(help="Manage projects")
area_app = typer.Typer(help="Manage areas")
app.add_typer(task_app, name="task")
app.add_typer(project_app, name="project")
app.add_typer(area_app, name="area")


@app.command()
def serve():
    """Start the web server at http://localhost:<port>"""
    import uvicorn
    from scheduler import start_scheduler
    init_db()
    start_scheduler()
    typer.echo(f"LifeOps running at http://{config.HOST}:{config.PORT}")
    uvicorn.run("main:app", host=config.HOST, port=config.PORT)


@app.command()
def status():
    """Print current life score + active projects summary."""
    init_db()
    db = SessionLocal()
    try:
        score = crud.life_score(db) * 100
        active = db.query(m.Project).filter(m.Project.status == m.ProjectStatus.active).all()
        typer.echo(f"Life score: {score:.1f}%")
        typer.echo(f"Active projects: {len(active)}")
        for p in active:
            pct = crud.project_progress(db, p) * 100
            typer.echo(f"  - {p.title}: {pct:.0f}%")
    finally:
        db.close()


@task_app.command("add")
def task_add(
    title: str = typer.Option(..., prompt=True),
    project_id: str = typer.Option(..., prompt=True),
    priority: str = typer.Option("medium", prompt=True),
):
    """Interactive task creation."""
    init_db()
    db = SessionLocal()
    try:
        project = db.query(m.Project).get(project_id)
        if not project:
            typer.echo(f"No project with id {project_id}", err=True)
            raise typer.Exit(1)
        task = m.Task(project_id=project_id, title=title, priority=priority)
        db.add(task)
        db.commit()
        typer.echo(f"Added task '{title}' to {project.title}")
    finally:
        db.close()


@task_app.command("done")
def task_done(task_id: str):
    """Mark task complete."""
    init_db()
    db = SessionLocal()
    try:
        task = db.query(m.Task).get(task_id)
        if not task:
            typer.echo(f"No task with id {task_id}", err=True)
            raise typer.Exit(1)
        task.status = m.TaskStatus.done
        task.completed_at = date.today()
        db.commit()
        typer.echo(f"Marked '{task.title}' done")
    finally:
        db.close()


@project_app.command("list")
def project_list():
    """List all active projects."""
    init_db()
    db = SessionLocal()
    try:
        for p in db.query(m.Project).filter(m.Project.status == m.ProjectStatus.active).all():
            pct = crud.project_progress(db, p) * 100
            typer.echo(f"{p.id}  {p.title}  {pct:.0f}%")
    finally:
        db.close()


@area_app.command("list")
def area_list():
    """List all areas with their current progress."""
    init_db()
    db = SessionLocal()
    try:
        for a in db.query(m.Area).all():
            pct = crud.area_progress(db, a) * 100
            typer.echo(f"{a.id}  {a.icon or ''} {a.title}  {pct:.0f}%  [{a.status.value}]")
    finally:
        db.close()


@app.command()
def backup():
    """Export a full JSON snapshot to ~/lifeops_backup_YYYY-MM-DD.json"""
    init_db()
    db = SessionLocal()
    try:
        def dump(rows):
            out = []
            for r in rows:
                d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
                for k, v in d.items():
                    if isinstance(v, (date, datetime)):
                        d[k] = v.isoformat()
                    elif hasattr(v, "value"):
                        d[k] = v.value
                out.append(d)
            return out

        data = {
            "areas": dump(db.query(m.Area).all()),
            "dreams": dump(db.query(m.Dream).all()),
            "dream_areas": dump(db.query(m.DreamArea).all()),
            "projects": dump(db.query(m.Project).all()),
            "tasks": dump(db.query(m.Task).all()),
            "snapshots": dump(db.query(m.Snapshot).all()),
        }
        path = f"{__import__('pathlib').Path.home()}/lifeops_backup_{date.today().isoformat()}.json"
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        typer.echo(f"Backup written to {path}")
    finally:
        db.close()


@app.command(name="import")
def import_backup(path: str):
    """Restore from a JSON snapshot produced by `lifeops backup`."""
    init_db()
    with open(path) as f:
        data = json.load(f)
    db = SessionLocal()
    try:
        for row in data.get("areas", []):
            if row.get("created_at"):
                row["created_at"] = date.fromisoformat(row["created_at"])
            db.merge(m.Area(**row))
        for row in data.get("dreams", []):
            row["created_at"] = date.fromisoformat(row["created_at"]) if row.get("created_at") else date.today()
            db.merge(m.Dream(**row))
        for row in data.get("dream_areas", []):
            db.merge(m.DreamArea(**row))
        for row in data.get("projects", []):
            for k in ("start_date", "target_date"):
                if row.get(k):
                    row[k] = date.fromisoformat(row[k])
            db.merge(m.Project(**row))
        for row in data.get("tasks", []):
            for k in ("due_date", "completed_at"):
                if row.get(k):
                    row[k] = date.fromisoformat(row[k])
            row.pop("created_at", None)
            db.merge(m.Task(**row))
        db.commit()
        typer.echo(f"Restored from {path}")
    finally:
        db.close()


@app.command(name="export")
def export_csv(kind: str = typer.Argument("csv")):
    """Export all tasks/projects to CSV for external analysis."""
    import csv as csv_mod
    init_db()
    db = SessionLocal()
    try:
        path = f"{__import__('pathlib').Path.home()}/lifeops_export_{date.today().isoformat()}.csv"
        with open(path, "w", newline="") as f:
            writer = csv_mod.writer(f)
            writer.writerow(["type", "id", "title", "status", "project", "due_date", "progress"])
            for p in db.query(m.Project).all():
                writer.writerow(["project", p.id, p.title, p.status.value,
                                  p.area.title if p.area else "", p.target_date or "",
                                  f"{crud.project_progress(db, p)*100:.0f}%"])
            for t in db.query(m.Task).all():
                writer.writerow(["task", t.id, t.title, t.status.value,
                                  t.project.title if t.project else "", t.due_date or "", ""])
        typer.echo(f"Exported to {path}")
    finally:
        db.close()


if __name__ == "__main__":
    app()
