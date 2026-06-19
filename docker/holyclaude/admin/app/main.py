import asyncio
import hashlib
import json
import os
import re
import shlex
import subprocess
import threading
import time
import uuid
from collections import deque
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
PIPELINE_SCRIPT = os.getenv("PIPELINE_SCRIPT", os.getenv("P1_SCRIPT", "/workspace/scripts/run_holyclaude_pipeline.mjs"))
MAX_CONCURRENT_RUNS = int(os.getenv("ADMIN_MAX_CONCURRENT_RUNS", "10"))
RUN_OUTPUT_LIMIT = int(os.getenv("ADMIN_RUN_OUTPUT_LIMIT", "30000"))
SUGGESTION_LOG_LIMIT = int(os.getenv("ADMIN_SUGGESTION_LOG_LIMIT", "5"))
SUGGESTION_LOG_OUTPUT_LIMIT = int(os.getenv("ADMIN_SUGGESTION_LOG_OUTPUT_LIMIT", "1200"))
P2_POLL_MATCH_WINDOW_SECONDS = int(os.getenv("ADMIN_P2_POLL_MATCH_WINDOW_SECONDS", "10"))
ADMIN_CACHE_TTL_SECONDS = float(os.getenv("ADMIN_CACHE_TTL_SECONDS", "5"))
ADMIN_SUGGESTION_CACHE_TTL_SECONDS = float(os.getenv("ADMIN_SUGGESTION_CACHE_TTL_SECONDS", "10"))
ADMIN_STATUS_CACHE_TTL_SECONDS = float(os.getenv("ADMIN_STATUS_CACHE_TTL_SECONDS", "2"))

active_jobs: dict[str, dict] = {}
active_jobs_lock = threading.RLock()
run_queue: deque[str] = deque()
response_cache: dict[str, tuple[float, object]] = {}
response_cache_lock = threading.RLock()


def _cached(key: str, ttl_seconds: float, loader):
    now = time.monotonic()
    with response_cache_lock:
        item = response_cache.get(key)
        if item and item[0] > now:
            return item[1]

    value = loader()
    expires_at = time.monotonic() + ttl_seconds
    with response_cache_lock:
        response_cache[key] = (expires_at, value)
    return value


def _invalidate_cache(*prefixes: str) -> None:
    with response_cache_lock:
        if not prefixes:
            response_cache.clear()
            return
        for key in list(response_cache):
            if any(key.startswith(prefix) for prefix in prefixes):
                response_cache.pop(key, None)


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
    run_id, started_at, status = _start_active_job("p1", "holyclaude 콘텐츠 생성 파이프라인 실행 준비 중")
    if status == "running":
        asyncio.create_task(_run_p1(run_id, started_at))
        return {"status": "started", "pipeline": "p1", "run_id": run_id}
    return {"status": "queued", "pipeline": "p1", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p2")
async def trigger_p2():
    run_id, started_at, status = _start_active_job("p2", "holyclaude 제안 처리 파이프라인 실행 준비 중")
    if status == "running":
        asyncio.create_task(_run_p2(run_id, started_at))
        return {"status": "started", "pipeline": "p2", "run_id": run_id}
    return {"status": "queued", "pipeline": "p2", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.get("/running")
async def get_running():
    with active_jobs_lock:
        running = [dict(j) for j in active_jobs.values() if j.get("status") == "running"]
        queued = []
        position = 1
        for rid in run_queue:
            job = active_jobs.get(rid)
            if job is None:
                continue  # tombstone (cancelled while queued)
            item = dict(job)
            item["queue_position"] = position
            queued.append(item)
            position += 1
        return {
            "jobs": running + queued,
            "limit": MAX_CONCURRENT_RUNS,
            "running": len(running),
            "queued": len(queued),
        }


@app.delete("/run/{run_id}")
async def cancel_run(run_id: str):
    with active_jobs_lock:
        job = active_jobs.get(run_id)
        if job is None:
            raise HTTPException(
                status_code=404,
                detail={"status": "not_found", "run_id": run_id},
            )
        if job.get("status") == "running":
            raise HTTPException(
                status_code=409,
                detail={
                    "status": "running",
                    "run_id": run_id,
                    "message": "실행 중인 작업은 취소할 수 없습니다",
                },
            )
        # queued → remove from active_jobs; deque keeps a tombstone that dispatch will skip
        active_jobs.pop(run_id, None)
    return {"status": "cancelled", "run_id": run_id}


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
    return await asyncio.to_thread(_wiki_status_response)


def _wiki_status_response() -> dict:
    return _cached("wiki_status", ADMIN_CACHE_TTL_SECONDS, _load_wiki_status)


def _load_wiki_status() -> dict:
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
    return await asyncio.to_thread(_wiki_reviews_response)


def _wiki_reviews_response() -> dict:
    items = _cached("wiki_reviews", ADMIN_CACHE_TTL_SECONDS, _pending_wiki_review_items)
    return {"items": items}


@app.get("/wiki-review")
async def wiki_review_detail(path: str):
    return await asyncio.to_thread(_wiki_review_detail_response, path)


def _wiki_review_detail_response(path: str) -> dict:
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
    return await asyncio.to_thread(_approve_wiki_review, body)


def _approve_wiki_review(body: WikiReviewBody) -> dict:
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
    _invalidate_cache("wiki_reviews")
    return {"status": "approved", "path": rel}


@app.post("/wiki-review/reject")
async def reject_wiki_review(body: WikiReviewBody):
    return await asyncio.to_thread(_reject_wiki_review, body)


def _reject_wiki_review(body: WikiReviewBody) -> dict:
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
    _invalidate_cache("wiki_reviews", "wiki_status", "status")
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


def _wiki_review_item(
    rel: str,
    working: dict[str, str] | None = None,
    committed: dict[str, str] | None = None,
    review_state: dict | None = None,
) -> dict | None:
    rel = _safe_wiki_relpath(rel)
    path = WORKSPACE / rel
    if not path.exists() or not path.is_file():
        return None

    if working is None:
        working = _working_tree_wiki_changes()
    if committed is None:
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
    if review_state is None:
        review_state = _load_review_state()
    state = review_state.get(_review_key(rel, digest), {})
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
    working = _working_tree_wiki_changes()
    committed = _committed_wiki_changes()
    review_state = _load_review_state()
    candidates = set(committed) | set(working)
    items = []
    for rel in sorted(candidates):
        try:
            item = _wiki_review_item(
                rel,
                working=working,
                committed=committed,
                review_state=review_state,
            )
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


def _inbox_suggestion_ids() -> list[str]:
    inbox_dir = WORKSPACE / "suggestions" / "inbox"
    if not inbox_dir.exists():
        return []
    return sorted(path.stem for path in inbox_dir.glob("*.json"))


def _automated_decision_snapshot() -> dict[str, dict]:
    if not DECISIONS_DIR.exists():
        return {}

    snapshot: dict[str, dict] = {}
    for path in DECISIONS_DIR.glob("*.json"):
        try:
            raw = path.read_bytes()
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            continue
        if data.get("automated") is not True:
            continue
        action = data.get("verdict") or data.get("action") or "unknown"
        snapshot[path.stem] = {
            "hash": hashlib.sha256(raw).hexdigest(),
            "action": action,
            "writer_status": data.get("writer_status"),
        }
    return snapshot


def _p2_decision_run_summary(before: dict[str, dict]) -> dict:
    after = _automated_decision_snapshot()
    processed = sorted(
        sid for sid, state in after.items()
        if before.get(sid, {}).get("hash") != state.get("hash")
    )
    skipped = sorted(
        sid for sid in _inbox_suggestion_ids()
        if sid in before and sid not in processed
    )

    decision_counts: dict[str, int] = {}
    writer_counts: dict[str, int] = {}
    for state in after.values():
        action = str(state.get("action") or "unknown")
        writer_status = str(state.get("writer_status") or "unknown")
        decision_counts[action] = decision_counts.get(action, 0) + 1
        writer_counts[writer_status] = writer_counts.get(writer_status, 0) + 1

    return {
        "processed": processed,
        "skipped": skipped,
        "decision_counts": decision_counts,
        "writer_counts": writer_counts,
    }


def _read_run_file(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _ids_from_run_field(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        sid = value.get("id")
        return [sid] if isinstance(sid, str) and sid else []
    if not isinstance(value, list):
        return []

    ids: list[str] = []
    for item in value:
        if isinstance(item, str) and item:
            ids.append(item)
        elif isinstance(item, dict):
            sid = item.get("id")
            if isinstance(sid, str) and sid:
                ids.append(sid)
    return ids


def _has_suggestion_result_lists(data: dict) -> bool:
    return bool(
        _ids_from_run_field(data.get("processed"))
        or _ids_from_run_field(data.get("skipped"))
        or _ids_from_run_field(data.get("errors"))
    )


def _timestamp_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _matching_p2_run(poll: dict, p2_runs: list[dict]) -> dict | None:
    poll_ts = _timestamp_seconds(poll.get("timestamp"))
    if poll_ts is None:
        return None

    best: tuple[float, dict] | None = None
    for run in p2_runs:
        run_ts = _timestamp_seconds(run["data"].get("timestamp") or run["data"].get("completed_at"))
        if run_ts is None:
            continue
        delta = abs(run_ts - poll_ts)
        if delta <= P2_POLL_MATCH_WINDOW_SECONDS and (best is None or delta < best[0]):
            best = (delta, run)
    return best[1] if best else None


def _poll_summary(data: dict) -> str:
    processed = _ids_from_run_field(data.get("processed"))
    skipped = _ids_from_run_field(data.get("skipped"))
    errors = data.get("errors") if isinstance(data.get("errors"), list) else []
    return f"processed={len(processed)} skipped={len(skipped)} errors={len(errors)}"


def _append_suggestion_log(
    logs: dict[str, list[dict]],
    seen: set[tuple[str, str, str, str]],
    sid: str,
    result: str,
    run_entry: dict,
    poll_entry: dict,
) -> None:
    run_data = run_entry["data"]
    poll_data = poll_entry["data"]
    timestamp = run_data.get("timestamp") or run_data.get("completed_at") or poll_data.get("timestamp")
    run_id = run_data.get("run_id") or run_entry["path"].stem
    key = (sid, str(run_id), result, str(timestamp))
    if key in seen:
        return
    seen.add(key)

    errors = poll_data.get("errors") if isinstance(poll_data.get("errors"), list) else []
    stdout_tail = run_data.get("stdout_tail") or _poll_summary(poll_data)
    logs.setdefault(sid, []).append({
        "pipeline": "p2",
        "run_id": run_id,
        "result": result,
        "timestamp": timestamp,
        "started_at": run_data.get("started_at"),
        "completed_at": run_data.get("completed_at") or poll_data.get("timestamp"),
        "status": run_data.get("status") or ("failed" if errors else "completed"),
        "message": run_data.get("message") or ("제안 폴링 실패" if errors else "제안 폴링 완료"),
        "processed_count": len(_ids_from_run_field(poll_data.get("processed"))),
        "skipped_count": len(_ids_from_run_field(poll_data.get("skipped"))),
        "error_count": len(errors),
        "stdout_tail": _tail_text(str(stdout_tail), SUGGESTION_LOG_OUTPUT_LIMIT),
        "source_file": run_entry["path"].name,
        "poll_file": poll_entry["path"].name,
    })


def _index_suggestion_result_logs(
    logs: dict[str, list[dict]],
    seen: set[tuple[str, str, str, str]],
    run_entry: dict,
    poll_entry: dict,
) -> None:
    data = poll_entry["data"]
    for sid in _ids_from_run_field(data.get("processed")):
        _append_suggestion_log(logs, seen, sid, "processed", run_entry, poll_entry)
    for sid in _ids_from_run_field(data.get("skipped")):
        _append_suggestion_log(logs, seen, sid, "skipped", run_entry, poll_entry)
    for sid in _ids_from_run_field(data.get("errors")):
        _append_suggestion_log(logs, seen, sid, "error", run_entry, poll_entry)


def _suggestion_pipeline_logs() -> dict[str, list[dict]]:
    logs: dict[str, list[dict]] = {}
    if not RUNS_DIR.exists():
        return logs

    p2_runs: list[dict] = []
    poll_runs: list[dict] = []
    for path in sorted(RUNS_DIR.glob("*.json"), reverse=True):
        data = _read_run_file(path)
        if not isinstance(data, dict):
            continue
        entry = {"path": path, "data": data}
        if data.get("pipeline") == "p2":
            p2_runs.append(entry)
        elif path.name.endswith("-poll.json") and _has_suggestion_result_lists(data):
            poll_runs.append(entry)

    seen: set[tuple[str, str, str, str]] = set()
    for poll_entry in poll_runs:
        run_entry = _matching_p2_run(poll_entry["data"], p2_runs) or poll_entry
        _index_suggestion_result_logs(logs, seen, run_entry, poll_entry)

    for run_entry in p2_runs:
        if _has_suggestion_result_lists(run_entry["data"]):
            _index_suggestion_result_logs(logs, seen, run_entry, run_entry)

    for sid, sid_logs in list(logs.items()):
        sid_logs.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
        logs[sid] = sid_logs[:SUGGESTION_LOG_LIMIT]
    return logs


@app.get("/suggestions")
async def get_suggestions():
    return await asyncio.to_thread(_suggestions_response)


def _suggestions_response() -> dict:
    return _cached("suggestions", ADMIN_SUGGESTION_CACHE_TTL_SECONDS, _load_suggestions_response)


def _load_suggestions_response() -> dict:
    inbox_dir = WORKSPACE / "suggestions" / "inbox"
    logs_by_sid = _cached(
        "suggestion_logs",
        ADMIN_SUGGESTION_CACHE_TTL_SECONDS,
        _suggestion_pipeline_logs,
    )
    items = []
    if inbox_dir.exists():
        for f in sorted(inbox_dir.glob("*.json"), reverse=True):
            try:
                item = json.loads(f.read_text(encoding="utf-8"))
                sid = item.get("id", f.stem)
                item["decision"] = _load_decision(sid)
                item["pipeline_logs"] = logs_by_sid.get(sid, [])
                items.append(item)
            except Exception:
                pass
    return {"items": items}


@app.get("/suggestions/{sid}")
async def get_suggestion(sid: str):
    return await asyncio.to_thread(_suggestion_detail_response, sid)


def _suggestion_detail_response(sid: str) -> dict:
    path = WORKSPACE / "suggestions" / "inbox" / f"{sid}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    item = json.loads(path.read_text(encoding="utf-8"))
    item["decision"] = _load_decision(sid)
    logs_by_sid = _cached(
        "suggestion_logs",
        ADMIN_SUGGESTION_CACHE_TTL_SECONDS,
        _suggestion_pipeline_logs,
    )
    item["pipeline_logs"] = logs_by_sid.get(sid, [])
    return item


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
    return await asyncio.to_thread(_status_response)


def _status_response() -> dict:
    return _cached("status", ADMIN_STATUS_CACHE_TTL_SECONDS, _load_status_response)


def _load_status_response() -> dict:
    runs = []
    if RUNS_DIR.exists():
        files = sorted(RUNS_DIR.glob("*.json"), reverse=True)[:10]
        for f in files:
            try:
                runs.append(json.loads(f.read_text()))
            except Exception:
                pass
    return {"runs": runs}


async def _run_p1(run_id: str, started_at: str) -> None:
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p1", run_id, started_at)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


def _start_active_job(pipeline: str, last_line: str) -> tuple[str, str, str]:
    """Register a job. Returns (run_id, started_at, status).

    When running slots are available the job is immediately 'running' and a task
    should be scheduled by the caller. Otherwise it is enqueued ('queued').
    Per-pipeline dedup is intentionally removed; the team-lead agent owns that.
    """
    now = datetime.now().isoformat()
    run_id = str(uuid.uuid4())[:8]
    with active_jobs_lock:
        running_count = sum(1 for j in active_jobs.values() if j.get("status") == "running")
        if running_count < MAX_CONCURRENT_RUNS:
            status = "running"
            started_at = now
            active_jobs[run_id] = {
                "run_id": run_id,
                "pipeline": pipeline,
                "started_at": started_at,
                "status": "running",
                "last_line": last_line,
                "updated_at": started_at,
            }
        else:
            status = "queued"
            started_at = now
            active_jobs[run_id] = {
                "run_id": run_id,
                "pipeline": pipeline,
                "started_at": None,
                "queued_at": now,
                "status": "queued",
                "last_line": last_line,
                "updated_at": now,
            }
            run_queue.append(run_id)
        return run_id, started_at, status


def _queue_position(run_id: str):
    with active_jobs_lock:
        position = 1
        for rid in run_queue:
            if active_jobs.get(rid) is None:
                continue  # tombstone (cancelled while queued)
            if rid == run_id:
                return position
            position += 1
    return None


def _update_active_job(run_id: str, **values) -> None:
    with active_jobs_lock:
        if run_id in active_jobs:
            active_jobs[run_id].update(values)


def _pop_active_job(run_id: str) -> None:
    with active_jobs_lock:
        active_jobs.pop(run_id, None)
    _dispatch_next_job()


def _dispatch_next_job() -> None:
    """Promote queued jobs to running when capacity frees.

    Called from the event-loop thread (async _run_p* finally blocks), so
    asyncio.create_task is safe. A single lock acquisition batches promotions;
    task scheduling happens after the lock is released.
    """
    to_start: list[tuple[str, str, str]] = []
    with active_jobs_lock:
        while run_queue:
            running_count = (
                sum(1 for j in active_jobs.values() if j.get("status") == "running")
                + len(to_start)
            )
            if running_count >= MAX_CONCURRENT_RUNS:
                break
            rid = run_queue.popleft()
            job = active_jobs.get(rid)
            if job is None or job.get("status") != "queued":
                continue  # tombstone / unexpected state
            pipeline = job.get("pipeline")
            started_at = datetime.now().isoformat()
            job.update(status="running", started_at=started_at, updated_at=started_at)
            to_start.append((pipeline, rid, started_at))
    for pipeline, rid, started_at in to_start:
        if pipeline == "p1":
            asyncio.create_task(_run_p1(rid, started_at))
        elif pipeline == "p2":
            asyncio.create_task(_run_p2(rid, started_at))


def _run_holyclaude_pipeline(pipeline: str, run_id: str, started_at: str) -> dict:
    before_decisions = _automated_decision_snapshot() if pipeline == "p2" else {}
    try:
        import docker as docker_sdk
    except Exception as exc:
        return _run_error_log(pipeline, run_id, started_at, f"Docker SDK import failed: {exc}")

    client = docker_sdk.from_env()
    try:
        container = client.containers.get(HOLYCLAUDE_CONTAINER)
    except Exception as exc:
        return _run_error_log(
            pipeline,
            run_id,
            started_at,
            f"컨테이너를 찾을 수 없습니다: {HOLYCLAUDE_CONTAINER} ({exc})",
        )

    inner = f"cd /workspace && node {shlex.quote(PIPELINE_SCRIPT)} {shlex.quote(pipeline)} --run-id {shlex.quote(run_id)}"
    command = [
        "bash",
        "-lc",
        f"set -o pipefail; su claude -s /bin/sh -c {shlex.quote(inner)} 2>&1 | tee /proc/1/fd/1",
    ]

    _update_active_job(run_id, last_line=f"docker exec {HOLYCLAUDE_CONTAINER}")
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
                    _update_active_job(
                        run_id,
                        last_line=line[-300:],
                        updated_at=datetime.now().isoformat(),
                    )

        inspect = client.api.exec_inspect(exec_id)
        exit_code = inspect.get("ExitCode")
    except Exception as exc:
        return _run_error_log(pipeline, run_id, started_at, f"holyclaude 실행 실패: {exc}", "".join(output))

    stdout_tail = _tail_text("".join(output), RUN_OUTPUT_LIMIT)
    completed_at = datetime.now().isoformat()
    ok = exit_code == 0
    log = {
        "run_id": run_id,
        "pipeline": pipeline,
        "timestamp": completed_at,
        "started_at": started_at,
        "completed_at": completed_at,
        "status": "completed" if ok else "failed",
        "message": _pipeline_message(pipeline, ok),
        "container": HOLYCLAUDE_CONTAINER,
        "exit_code": exit_code,
        "processed": 1 if ok else 0,
        "skipped": 0,
        "errors": [] if ok else [f"holyclaude exit_code={exit_code}"],
        "stdout_tail": stdout_tail,
    }
    if pipeline == "p2":
        log.update(_p2_decision_run_summary(before_decisions))
    return log


def _pipeline_message(pipeline: str, ok: bool) -> str:
    number = pipeline.replace("p", "")
    return f"파이프라인 {number} 실행 완료" if ok else f"파이프라인 {number} 실행 실패"


def _run_error_log(pipeline: str, run_id: str, started_at: str, message: str, stdout: str = "") -> dict:
    completed_at = datetime.now().isoformat()
    return {
        "run_id": run_id,
        "pipeline": pipeline,
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


async def _run_p2(run_id: str, started_at: str) -> None:
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p2", run_id, started_at)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


def _save_run(data: dict) -> None:
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    path = RUNS_DIR / f"{ts}-{data.get('run_id', 'run')}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    _invalidate_cache("status", "suggestions", "suggestion_logs", "wiki_status", "wiki_reviews")
