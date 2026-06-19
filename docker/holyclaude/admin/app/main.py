import asyncio
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.scheduler import add_p2_job, get_jobs, remove_p2_job, scheduler

RUNS_DIR = Path(os.getenv("ADMIN_RUNS_DIR", ".admin/runs"))
WORKSPACE = Path(os.getenv("WORKSPACE", "/workspace"))
WIKI_REVIEW_STATE = Path(os.getenv("ADMIN_WIKI_REVIEW_STATE", WORKSPACE / ".admin/wiki_reviews.json"))
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
HOLYCLAUDE_CONTAINER = os.getenv("HOLYCLAUDE_CONTAINER", "holyclaude")
P1_SCRIPT = os.getenv("P1_SCRIPT", "/workspace/scripts/run_holyclaude_pipeline.mjs")
RUN_OUTPUT_LIMIT = int(os.getenv("ADMIN_RUN_OUTPUT_LIMIT", "30000"))

active_jobs: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    WIKI_REVIEW_STATE.parent.mkdir(parents=True, exist_ok=True)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="sg-wiki Admin", lifespan=lifespan)
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.exception_handler(RuntimeError)
async def runtime_error_handler(_request: Request, exc: RuntimeError):
    return JSONResponse(
        status_code=500,
        content={"status": "error", "detail": str(exc)},
    )


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


class WikiReviewBody(BaseModel):
    path: str
    reason: str | None = None


@app.get("/wiki-reviews")
async def wiki_reviews():
    return {"items": _pending_wiki_review_items()}


@app.get("/wiki-review")
async def wiki_review_detail(path: str):
    rel = _safe_wiki_relpath(path)
    abs_path = WORKSPACE / rel
    if not abs_path.exists():
        return {"status": "missing", "path": rel}

    item = _wiki_review_item(rel)
    return {
        "status": "ok",
        "item": item,
        "content": abs_path.read_text(encoding="utf-8", errors="replace"),
        "diff": _wiki_review_diff(rel),
    }


@app.post("/wiki-review/approve")
async def approve_wiki_review(body: WikiReviewBody):
    rel = _safe_wiki_relpath(body.path)
    item = _wiki_review_item(rel)
    if item is None:
        return {"status": "not_found", "path": rel}

    state = _load_review_state()
    key = _review_key(rel, item["hash"])
    state[key] = {
        "path": rel,
        "hash": item["hash"],
        "decision": "approved",
        "reason": body.reason or "",
        "reviewed_at": datetime.now().isoformat(),
    }
    _save_review_state(state)
    return {"status": "approved", "path": rel}


@app.post("/wiki-review/reject")
async def reject_wiki_review(body: WikiReviewBody):
    rel = _safe_wiki_relpath(body.path)
    item = _wiki_review_item(rel)
    if item is None:
        return {"status": "not_found", "path": rel}

    base_ref = _git_base_ref()
    was_committed = item["source"] in {"committed", "committed+working-tree"}
    exists_in_base = _git(["cat-file", "-e", f"{base_ref}:{rel}"], check=False).returncode == 0

    if was_committed:
        if exists_in_base:
            _git(["checkout", base_ref, "--", rel])
            _git(["add", "-A", "--", rel])
        else:
            _git(["rm", "-f", "--", rel])
        if _has_staged_changes(rel):
            _git([
                "commit",
                "-m",
                "Remove wiki output rejected in admin review",
                "-m",
                f"The admin review UI rejected {rel}, so this restores the file to the upstream baseline or removes it when no baseline version exists.",
                "-m",
                "Constraint: Rejection was requested from sg-wiki-admin",
                "-m",
                "Confidence: medium",
                "-m",
                "Scope-risk: narrow",
                "-m",
                "Directive: Do not reintroduce this page without a fresh review",
                "-m",
                "Tested: sg-wiki-admin reject action completed git restore/rm",
                "-m",
                "Not-tested: Cloudflare Pages deploy after rejection",
                "--",
                rel,
            ])
    else:
        if _git(["cat-file", "-e", f"HEAD:{rel}"], check=False).returncode == 0:
            _git(["restore", "--", rel])
        else:
            target = WORKSPACE / rel
            if target.exists():
                target.unlink()

    state = _load_review_state()
    state[_review_key(rel, item["hash"])] = {
        "path": rel,
        "hash": item["hash"],
        "decision": "rejected",
        "reason": body.reason or "",
        "reviewed_at": datetime.now().isoformat(),
    }
    _save_review_state(state)
    return {"status": "rejected", "path": rel, "committed_revert": was_committed}


def _git(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=WORKSPACE,
        text=True,
        capture_output=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"git {' '.join(args)} failed")
    return result


def _git_base_ref() -> str:
    upstream = _git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], check=False)
    if upstream.returncode == 0 and upstream.stdout.strip():
        return upstream.stdout.strip()
    previous = _git(["rev-parse", "--verify", "HEAD~1"], check=False)
    if previous.returncode == 0 and previous.stdout.strip():
        return previous.stdout.strip()
    return "HEAD"


def _safe_wiki_relpath(value: str) -> str:
    rel = value.strip().replace("\\", "/")
    if rel.startswith("/"):
        rel = rel[1:]
    if not rel.startswith("wiki/") or not rel.endswith(".md") or ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail=f"Invalid wiki path: {value}")
    abs_path = (WORKSPACE / rel).resolve()
    wiki_root = (WORKSPACE / "wiki").resolve()
    if not abs_path.is_relative_to(wiki_root):
        raise HTTPException(status_code=400, detail=f"Invalid wiki path: {value}")
    return rel


def _load_review_state() -> dict:
    if not WIKI_REVIEW_STATE.exists():
        return {}
    try:
        return json.loads(WIKI_REVIEW_STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_review_state(state: dict) -> None:
    WIKI_REVIEW_STATE.parent.mkdir(parents=True, exist_ok=True)
    WIKI_REVIEW_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _review_key(rel: str, digest: str) -> str:
    return f"{rel}:{digest}"


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _page_title(path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except Exception:
        pass
    return path.stem


def _parse_name_status_z(output: str) -> dict[str, str]:
    items: dict[str, str] = {}
    parts = output.split("\0")
    index = 0
    while index + 1 < len(parts):
        status = parts[index]
        index += 1
        if not status:
            continue
        path = parts[index]
        index += 1
        if status.startswith(("R", "C")) and index < len(parts):
            path = parts[index]
            index += 1
        if path.startswith("wiki/") and path.endswith(".md"):
            items[path] = status[:1]
    return items


def _working_tree_wiki_changes() -> dict[str, str]:
    result = _git(["status", "--porcelain=v1", "-z", "--", "wiki"], check=False)
    if result.returncode != 0:
        return {}

    items: dict[str, str] = {}
    parts = result.stdout.split("\0")
    index = 0
    while index < len(parts):
        record = parts[index]
        index += 1
        if not record:
            continue
        status = record[:2]
        path = record[3:]
        if status.strip().startswith(("R", "C")) and index < len(parts):
            path = parts[index]
            index += 1
        if path.startswith("wiki/") and path.endswith(".md"):
            items[path] = status.strip() or "M"
    return items


def _committed_wiki_changes() -> dict[str, str]:
    base_ref = _git_base_ref()
    result = _git(["diff", "--name-status", "-z", f"{base_ref}..HEAD", "--", "wiki"], check=False)
    if result.returncode != 0:
        return {}
    return _parse_name_status_z(result.stdout)


def _wiki_review_item(rel: str) -> dict | None:
    rel = _safe_wiki_relpath(rel)
    path = WORKSPACE / rel
    if not path.exists() or not path.is_file():
        return None

    working = _working_tree_wiki_changes()
    committed = _committed_wiki_changes()
    source = None
    status = working.get(rel) or committed.get(rel) or "M"
    if rel in committed and rel in working:
        source = "committed+working-tree"
    elif rel in committed:
        source = "committed"
    elif rel in working:
        source = "working-tree"

    digest = _file_hash(path)
    state = _load_review_state().get(_review_key(rel, digest), {})
    return {
        "path": rel,
        "title": _page_title(path),
        "status": status,
        "source": source or "current",
        "hash": digest,
        "decision": state.get("decision", "pending"),
        "reviewed_at": state.get("reviewed_at"),
        "updated_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        "size": path.stat().st_size,
    }


def _pending_wiki_review_items() -> list[dict]:
    candidates = set(_committed_wiki_changes()) | set(_working_tree_wiki_changes())
    items = []
    for rel in sorted(candidates):
        try:
            item = _wiki_review_item(rel)
        except Exception:
            continue
        if item and item["decision"] != "approved":
            items.append(item)
    return items


def _wiki_review_diff(rel: str) -> str:
    rel = _safe_wiki_relpath(rel)
    base_ref = _git_base_ref()
    chunks = []
    committed = _git(["diff", f"{base_ref}..HEAD", "--", rel], check=False)
    if committed.returncode == 0 and committed.stdout.strip():
        chunks.append(committed.stdout)
    working = _git(["diff", "--", rel], check=False)
    if working.returncode == 0 and working.stdout.strip():
        chunks.append(working.stdout)
    return "\n".join(chunks)


def _has_staged_changes(rel: str) -> bool:
    result = _git(["diff", "--cached", "--quiet", "--", rel], check=False)
    return result.returncode == 1


class ScheduleBody(BaseModel):
    cron: str = "0 * * * *"
    enabled: bool = True


DECISIONS_DIR = WORKSPACE / "suggestions" / "decisions"


def _load_decision(sid: str) -> dict | None:
    path = DECISIONS_DIR / f"{sid}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def _save_decision(sid: str, data: dict) -> None:
    DECISIONS_DIR.mkdir(parents=True, exist_ok=True)
    (DECISIONS_DIR / f"{sid}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class SuggestionActionBody(BaseModel):
    instruction: str | None = None


@app.get("/suggestions")
async def get_suggestions():
    inbox_dir = WORKSPACE / "suggestions" / "inbox"
    items = []
    if inbox_dir.exists():
        for f in sorted(inbox_dir.glob("*.json"), reverse=True):
            try:
                item = json.loads(f.read_text(encoding="utf-8"))
                item["decision"] = _load_decision(item.get("id", f.stem))
                items.append(item)
            except Exception:
                pass
    return {"items": items}


@app.get("/suggestions/{sid}")
async def get_suggestion(sid: str):
    path = WORKSPACE / "suggestions" / "inbox" / f"{sid}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    item = json.loads(path.read_text(encoding="utf-8"))
    item["decision"] = _load_decision(sid)
    return item


@app.post("/suggestions/{sid}/approve")
async def approve_suggestion(sid: str, body: SuggestionActionBody):
    if not (WORKSPACE / "suggestions" / "inbox" / f"{sid}.json").exists():
        raise HTTPException(status_code=404, detail="not found")
    _save_decision(sid, {
        "id": sid, "action": "approved",
        "instruction": body.instruction or "",
        "decided_at": datetime.now().isoformat(),
    })
    return {"status": "approved", "id": sid}


@app.post("/suggestions/{sid}/reject")
async def reject_suggestion(sid: str, body: SuggestionActionBody):
    if not (WORKSPACE / "suggestions" / "inbox" / f"{sid}.json").exists():
        raise HTTPException(status_code=404, detail="not found")
    _save_decision(sid, {
        "id": sid, "action": "rejected",
        "reason": body.instruction or "",
        "decided_at": datetime.now().isoformat(),
    })
    return {"status": "rejected", "id": sid}


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
    started_at = datetime.now().isoformat()
    active_jobs[run_id] = {
        "run_id": run_id,
        "pipeline": "p2",
        "started_at": started_at,
        "status": "running",
        "last_line": "poll_suggestions.py 실행 중",
    }
    script = WORKSPACE / "scripts" / "poll_suggestions.py"
    log: dict = {}
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(script),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ},
        )
        stdout, stderr = await proc.communicate()
        exit_code = proc.returncode
        output = stdout.decode("utf-8", errors="replace") + stderr.decode("utf-8", errors="replace")
        completed_at = datetime.now().isoformat()
        ok = exit_code == 0
        log = {
            "run_id": run_id,
            "pipeline": "p2",
            "timestamp": completed_at,
            "started_at": started_at,
            "completed_at": completed_at,
            "status": "completed" if ok else "failed",
            "message": "제안 폴링 완료" if ok else "제안 폴링 실패",
            "exit_code": exit_code,
            "errors": [] if ok else [f"exit_code={exit_code}"],
            "stdout_tail": _tail_text(output, RUN_OUTPUT_LIMIT),
        }
    except Exception as exc:
        completed_at = datetime.now().isoformat()
        log = {
            "run_id": run_id,
            "pipeline": "p2",
            "timestamp": completed_at,
            "started_at": started_at,
            "completed_at": completed_at,
            "status": "failed",
            "message": str(exc),
            "exit_code": None,
            "errors": [str(exc)],
            "stdout_tail": "",
        }
    finally:
        active_jobs.pop(run_id, None)
        if log:
            _save_run(log)


def _save_run(data: dict) -> None:
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    path = RUNS_DIR / f"{ts}-{data.get('run_id', 'run')}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
