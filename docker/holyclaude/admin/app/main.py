import json
import os
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.scheduler import add_p2_job, get_jobs, remove_p2_job, scheduler

RUNS_DIR = Path(os.getenv("ADMIN_RUNS_DIR", ".admin/runs"))
WORKSPACE = Path(os.getenv("WORKSPACE", "/workspace"))
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


@asynccontextmanager
async def lifespan(app: FastAPI):
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="sg-wiki Admin", lifespan=lifespan)
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/trigger/p1")
async def trigger_p1():
    run_id = str(uuid.uuid4())[:8]
    log = {
        "run_id": run_id,
        "pipeline": "p1",
        "status": "queued",
        "message": "파이프라인 1 stub 실행 완료 (실제 구현 TODO)",
    }
    _save_run(log)
    return {"status": "ok", "pipeline": "p1", "message": log["message"], "run_id": run_id}


@app.post("/trigger/p2")
async def trigger_p2():
    script = WORKSPACE / "scripts" / "poll_suggestions.py"
    result = subprocess.run(
        [sys.executable, str(script)],
        capture_output=True,
        text=True,
        env={**os.environ},
    )
    return {
        "status": "ok" if result.returncode == 0 else "error",
        "pipeline": "p2",
        "stdout": result.stdout + result.stderr,
        "returncode": result.returncode,
    }


class ScheduleBody(BaseModel):
    cron: str = "0 * * * *"
    enabled: bool = True


@app.get("/schedule")
async def get_schedule():
    return {"jobs": get_jobs()}


@app.post("/schedule")
async def set_schedule(body: ScheduleBody):
    if body.enabled:
        add_p2_job(body.cron)
        return {"status": "enabled", "cron": body.cron, "jobs": get_jobs()}
    else:
        remove_p2_job()
        return {"status": "disabled", "jobs": get_jobs()}


@app.get("/status")
async def get_status():
    runs = []
    if RUNS_DIR.exists():
        files = sorted(RUNS_DIR.glob("*.json"), reverse=True)[:10]
        for f in files:
            try:
                runs.append(json.loads(f.read_text()))
            except Exception:
                pass
    return {"runs": runs}


def _save_run(data: dict) -> None:
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    path = RUNS_DIR / f"{ts}-{data.get('run_id', 'run')}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
