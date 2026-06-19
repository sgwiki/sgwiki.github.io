import asyncio
import json
import os
import re
import shlex
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.scheduler import add_p2_job, get_jobs, remove_p2_job, scheduler

RUNS_DIR = Path(os.getenv("ADMIN_RUNS_DIR", ".admin/runs"))
WORKSPACE = Path(os.getenv("WORKSPACE", "/workspace"))
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
HOLYCLAUDE_CONTAINER = os.getenv("HOLYCLAUDE_CONTAINER", "holyclaude")
P1_SCRIPT = os.getenv("P1_SCRIPT", "/workspace/scripts/run_holyclaude_pipeline.mjs")
RUN_OUTPUT_LIMIT = int(os.getenv("ADMIN_RUN_OUTPUT_LIMIT", "30000"))

active_jobs: dict[str, dict] = {}


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
    return templates.TemplateResponse(request, "index.html")


@app.post("/trigger/p1")
async def trigger_p1():
    run_id = str(uuid.uuid4())[:8]
    asyncio.create_task(_run_p1(run_id))
    return {"status": "started", "pipeline": "p1", "run_id": run_id}


@app.post("/trigger/p2")
async def trigger_p2():
    run_id = str(uuid.uuid4())[:8]
    asyncio.create_task(_run_p2(run_id))
    return {"status": "started", "pipeline": "p2", "run_id": run_id}


@app.get("/running")
async def get_running():
    return {"jobs": list(active_jobs.values())}


_ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]')


@app.get("/logs/stream")
async def stream_logs(tail: int = 200, container: str = "holyclaude"):
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    def _read():
        try:
            import docker as docker_sdk
            client = docker_sdk.from_env()
            c = client.containers.get(container)
            for chunk in c.logs(stream=True, follow=True, tail=tail):
                line = _ANSI.sub("", chunk.decode("utf-8", errors="replace")).rstrip()
                if line.strip():
                    asyncio.run_coroutine_threadsafe(queue.put(line), loop)
        except Exception as e:
            asyncio.run_coroutine_threadsafe(queue.put(f"[error] {e}"), loop)
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)

    threading.Thread(target=_read, daemon=True).start()

    async def generate():
        while True:
            try:
                line = await asyncio.wait_for(queue.get(), timeout=25)
                if line is None:
                    break
                yield f"data: {json.dumps(line)}\n\n"
            except asyncio.TimeoutError:
                yield "data: \"\"\n\n"  # keepalive

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/wiki-status")
async def wiki_status():
    wiki_dir = WORKSPACE / "wiki"
    by_dir: dict[str, list[str]] = {}
    if wiki_dir.exists():
        for f in sorted(wiki_dir.rglob("*.md")):
            rel = f.relative_to(wiki_dir)
            section = str(rel.parent) if str(rel.parent) != "." else "(루트)"
            by_dir.setdefault(section, []).append(f.stem)

    inbox = list((WORKSPACE / "suggestions" / "inbox").glob("*.json")) if (WORKSPACE / "suggestions" / "inbox").exists() else []
    processed = list((WORKSPACE / "suggestions" / "processed").iterdir()) if (WORKSPACE / "suggestions" / "processed").exists() else []
    processed = [p for p in processed if not p.name.startswith(".")]

    total = sum(len(v) for v in by_dir.values())
    return {
        "total": total,
        "sections": by_dir,
        "suggestions": {
            "inbox": len(inbox),
            "processed": len(processed),
        },
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


async def _run_p1(run_id: str) -> None:
    started_at = datetime.now().isoformat()
    active_jobs[run_id] = {
        "run_id": run_id,
        "pipeline": "p1",
        "started_at": started_at,
        "status": "running",
        "last_line": "holyclaude 컨테이너 실행 준비 중",
    }
    try:
        log = await asyncio.to_thread(_run_holyclaude_p1, run_id, started_at)
        _save_run(log)
    finally:
        active_jobs.pop(run_id, None)


def _run_holyclaude_p1(run_id: str, started_at: str) -> dict:
    try:
        import docker as docker_sdk
    except Exception as exc:
        return _run_error_log(run_id, started_at, f"Docker SDK import failed: {exc}")

    client = docker_sdk.from_env()
    try:
        container = client.containers.get(HOLYCLAUDE_CONTAINER)
    except Exception as exc:
        return _run_error_log(
            run_id,
            started_at,
            f"컨테이너를 찾을 수 없습니다: {HOLYCLAUDE_CONTAINER} ({exc})",
        )

    inner = f"cd /workspace && node {shlex.quote(P1_SCRIPT)} p1 --run-id {shlex.quote(run_id)}"
    command = [
        "bash",
        "-lc",
        f"set -o pipefail; su claude -s /bin/sh -c {shlex.quote(inner)} 2>&1 | tee /proc/1/fd/1",
    ]

    active_jobs[run_id]["last_line"] = f"docker exec {HOLYCLAUDE_CONTAINER}"
    output: list[str] = []
    try:
        exec_id = client.api.exec_create(
            container.id,
            command,
            user="root",
            workdir="/workspace",
            stdout=True,
            stderr=True,
        )["Id"]
        stream = client.api.exec_start(exec_id, stream=True, demux=False)
        for chunk in stream:
            text = _ANSI.sub("", chunk.decode("utf-8", errors="replace"))
            output.append(text)
            for line in text.splitlines():
                if line.strip():
                    active_jobs[run_id]["last_line"] = line[-300:]
                    active_jobs[run_id]["updated_at"] = datetime.now().isoformat()

        inspect = client.api.exec_inspect(exec_id)
        exit_code = inspect.get("ExitCode")
    except Exception as exc:
        return _run_error_log(run_id, started_at, f"holyclaude 실행 실패: {exc}", "".join(output))

    stdout_tail = _tail_text("".join(output), RUN_OUTPUT_LIMIT)
    completed_at = datetime.now().isoformat()
    ok = exit_code == 0
    return {
        "run_id": run_id,
        "pipeline": "p1",
        "timestamp": completed_at,
        "started_at": started_at,
        "completed_at": completed_at,
        "status": "completed" if ok else "failed",
        "message": "파이프라인 1 실행 완료" if ok else "파이프라인 1 실행 실패",
        "container": HOLYCLAUDE_CONTAINER,
        "exit_code": exit_code,
        "processed": 1 if ok else 0,
        "skipped": 0,
        "errors": [] if ok else [f"holyclaude exit_code={exit_code}"],
        "stdout_tail": stdout_tail,
    }


def _run_error_log(run_id: str, started_at: str, message: str, stdout: str = "") -> dict:
    completed_at = datetime.now().isoformat()
    return {
        "run_id": run_id,
        "pipeline": "p1",
        "timestamp": completed_at,
        "started_at": started_at,
        "completed_at": completed_at,
        "status": "failed",
        "message": message,
        "container": HOLYCLAUDE_CONTAINER,
        "exit_code": None,
        "processed": 0,
        "skipped": 0,
        "errors": [message],
        "stdout_tail": _tail_text(stdout, RUN_OUTPUT_LIMIT),
    }


def _tail_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[-limit:]


async def _run_p2(run_id: str) -> None:
    active_jobs[run_id] = {
        "run_id": run_id,
        "pipeline": "p2",
        "started_at": datetime.now().isoformat(),
        "status": "running",
    }
    script = WORKSPACE / "scripts" / "poll_suggestions.py"
    proc = await asyncio.create_subprocess_exec(
        sys.executable, str(script),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ},
    )
    stdout, stderr = await proc.communicate()
    active_jobs.pop(run_id, None)


def _save_run(data: dict) -> None:
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    path = RUNS_DIR / f"{ts}-{data.get('run_id', 'run')}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
