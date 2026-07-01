import asyncio
import difflib
import hashlib
import json
import os
import queue
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
# 파이프라인별 '사용자 지시' 프리셋. /workspace 마운트본을 우선 읽어 재빌드 없이 수정이
# 반영되게 하고, 없으면 이미지에 번들된 사본(BUILD 시 COPY)으로 폴백한다.
PRESETS_FILE = Path(
    os.getenv("ADMIN_PRESETS_FILE", str(WORKSPACE / "docker/holyclaude/admin/presets.json"))
)
PRESETS_FALLBACK = Path(__file__).parent.parent / "presets.json"
WIKI_REVIEW_STATE = Path(os.getenv("ADMIN_WIKI_REVIEW_STATE", WORKSPACE / ".admin/wiki_reviews.json"))
ADMIN_SETTINGS_STATE = Path(os.getenv("ADMIN_SETTINGS_STATE", WORKSPACE / ".admin/admin_settings.json"))
SUGGESTION_ACK_STATE = Path(os.getenv("ADMIN_SUGGESTION_ACK_STATE", WORKSPACE / ".admin/suggestion_ack.json"))
HOLYCLAUDE_GIT_WORKDIR = "/workspace"
RULE_PROMOTION_ROOT = Path(os.getenv("ADMIN_RULE_PROMOTION_ROOT", WORKSPACE / ".admin/rule-promotions"))
TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
HOLYCLAUDE_CONTAINER = os.getenv("HOLYCLAUDE_CONTAINER", "sg-wiki-holyclaude")
PIPELINE_SCRIPT = os.getenv("PIPELINE_SCRIPT", os.getenv("P1_SCRIPT", "/workspace/scripts/run_holyclaude_pipeline.mjs"))
MAX_CONCURRENT_RUNS = int(os.getenv("ADMIN_MAX_CONCURRENT_RUNS", "10"))
RUN_OUTPUT_LIMIT = int(os.getenv("ADMIN_RUN_OUTPUT_LIMIT", "30000"))
SUGGESTION_LOG_LIMIT = int(os.getenv("ADMIN_SUGGESTION_LOG_LIMIT", "5"))
SUGGESTION_LOG_OUTPUT_LIMIT = int(os.getenv("ADMIN_SUGGESTION_LOG_OUTPUT_LIMIT", "1200"))
P2_POLL_MATCH_WINDOW_SECONDS = int(os.getenv("ADMIN_P2_POLL_MATCH_WINDOW_SECONDS", "10"))
ADMIN_CACHE_TTL_SECONDS = float(os.getenv("ADMIN_CACHE_TTL_SECONDS", "5"))
ADMIN_SUGGESTION_CACHE_TTL_SECONDS = float(os.getenv("ADMIN_SUGGESTION_CACHE_TTL_SECONDS", "10"))
ADMIN_STATUS_CACHE_TTL_SECONDS = float(os.getenv("ADMIN_STATUS_CACHE_TTL_SECONDS", "2"))
ACTIVE_RUNS_STATE = Path(os.getenv("ADMIN_ACTIVE_RUNS_STATE", WORKSPACE / ".admin/active-runs.json"))
RUN_MARKER_DIR = os.getenv("ADMIN_RUN_MARKER_DIR", "/tmp/sg-wiki-runs")
ADMIN_TERMINATE_GRACE_SECONDS = int(os.getenv("ADMIN_TERMINATE_GRACE_SECONDS", "20"))
ADMIN_REAPER_INTERVAL_SECONDS = int(os.getenv("ADMIN_REAPER_INTERVAL_SECONDS", "60"))
P5_MAX_FILES_PER_RUN = int(os.getenv("ADMIN_P5_MAX_FILES_PER_RUN", "5"))

PIPELINE_TIMEOUT_DEFAULTS = {
    "p1": (4 * 60 * 60, 30 * 60),
    "p2": (2 * 60 * 60, 20 * 60),
    "p3": (4 * 60 * 60, 30 * 60),
    "p4": (2 * 60 * 60, 20 * 60),
    "p5": (4 * 60 * 60, 30 * 60),
    "p6": (4 * 60 * 60, 30 * 60),
    "p7": (45 * 60, 15 * 60),
}
ACTIVE_RUN_STATUSES = {"running", "terminating"}
TERMINAL_REGISTRY_STATUSES = {
    "completed",
    "released",
    "rejected",
    "stale_released",
    "cancelled",
}

active_jobs: dict[str, dict] = {}
active_jobs_lock = threading.RLock()
run_queue: deque[str] = deque()
response_cache: dict[str, tuple[float, object]] = {}
response_cache_lock = threading.RLock()

RULE_PROMOTION_ALLOWED_FILES = {
    "AGENTS.md",
    "README.md",
    "wiki/README.md",
    "docker/holyclaude/data/claude/CLAUDE.md",
    "docker/holyclaude/data/claude/agents/VOCAB_GUIDE.md",
}
RULE_PROMOTION_AGENT_PREFIX = "docker/holyclaude/data/claude/agents/"


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
    SUGGESTION_ACK_STATE.parent.mkdir(parents=True, exist_ok=True)
    RULE_PROMOTION_ROOT.mkdir(parents=True, exist_ok=True)
    ACTIVE_RUNS_STATE.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(_reconcile_persisted_active_runs)
    reaper_task = asyncio.create_task(_runtime_reaper_loop())
    scheduler.start()
    try:
        yield
    finally:
        reaper_task.cancel()
        try:
            await reaper_task
        except asyncio.CancelledError:
            pass
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


def _load_presets() -> dict[str, str]:
    """파이프라인별 사용자 지시 프리셋을 읽는다. 마운트본 → 번들 사본 순서로 시도하고
    모두 실패하면 빈 dict를 반환한다(프리셋 없이 빈 칸으로 동작)."""
    for path in (PRESETS_FILE, PRESETS_FALLBACK):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict):
            return {
                key: value
                for key, value in data.items()
                if key.isdigit() and isinstance(value, str)
            }
    return {}


@app.get("/presets")
async def get_presets():
    return {"presets": _load_presets()}


class TriggerBody(BaseModel):
    """수동 트리거 본문. user_instruction은 팀장 에이전트 프롬프트에 추가로 전달되는 선택 지시.
    제안 decision JSON의 instruction 필드와는 별개 기능이다.
    """

    user_instruction: str | None = None


@app.post("/trigger/p1")
async def trigger_p1(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p1", "holyclaude 콘텐츠 생성 파이프라인 실행 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p1(run_id, started_at))
        return {"status": "started", "pipeline": "p1", "run_id": run_id}
    return {"status": "queued", "pipeline": "p1", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p2")
async def trigger_p2(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p2", "holyclaude 제안 처리 파이프라인 실행 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p2(run_id, started_at))
        return {"status": "started", "pipeline": "p2", "run_id": run_id}
    return {"status": "queued", "pipeline": "p2", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p3")
async def trigger_p3(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p3", "holyclaude 온톨로지 저작 파이프라인 실행 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p3(run_id, started_at))
        return {"status": "started", "pipeline": "p3", "run_id": run_id}
    return {"status": "queued", "pipeline": "p3", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p4")
async def trigger_p4(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p4", "holyclaude 위키 품질 검사 파이프라인 실행 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p4(run_id, started_at))
        return {"status": "started", "pipeline": "p4", "run_id": run_id}
    return {"status": "queued", "pipeline": "p4", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p5")
async def trigger_p5(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p5", "holyclaude 위키 정비 파이프라인 실행 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p5(run_id, started_at))
        return {"status": "started", "pipeline": "p5", "run_id": run_id}
    return {"status": "queued", "pipeline": "p5", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p6")
async def trigger_p6(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p6", "holyclaude 커뮤니티 큐레이션 파이프라인 실행 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p6(run_id, started_at))
        return {"status": "started", "pipeline": "p6", "run_id": run_id}
    return {"status": "queued", "pipeline": "p6", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.post("/trigger/p7")
async def trigger_p7(body: TriggerBody | None = None):
    run_id, started_at, status = _start_active_job(
        "p7", "claude-mem 규칙 승격 제안 생성 준비 중", body.user_instruction if body else None
    )
    if status == "running":
        asyncio.create_task(_run_p7(run_id, started_at))
        return {"status": "started", "pipeline": "p7", "run_id": run_id}
    return {"status": "queued", "pipeline": "p7", "run_id": run_id, "queue_position": _queue_position(run_id)}


@app.get("/running")
async def get_running():
    with active_jobs_lock:
        running = [_public_job(j) for j in active_jobs.values() if j.get("status") in ACTIVE_RUN_STATUSES]
        queued = []
        position = 1
        for rid in run_queue:
            job = active_jobs.get(rid)
            if job is None:
                continue  # tombstone (cancelled while queued)
            queued.append(_public_job(job, queue_position=position))
            position += 1
        return {
            "jobs": running + queued,
            "limit": MAX_CONCURRENT_RUNS,
            "running": len(running),
            "queued": len(queued),
        }


@app.delete("/run/{run_id}")
async def cancel_run(run_id: str):
    should_kill = False
    with active_jobs_lock:
        job = active_jobs.get(run_id)
        if job is None:
            raise HTTPException(
                status_code=404,
                detail={"status": "not_found", "run_id": run_id},
            )
        if job.get("status") in ACTIVE_RUN_STATUSES:
            now = datetime.now().isoformat()
            job.update(
                status="terminating",
                cancel_requested=True,
                termination_reason="cancel_requested",
                terminating_at=now,
                updated_at=now,
                last_line="취소 요청됨: 프로세스 그룹 종료 중",
            )
            _persist_active_jobs_locked()
            should_kill = True
        elif job.get("status") == "queued":
            # queued → remove from active_jobs; deque keeps a tombstone that dispatch will skip
            active_jobs.pop(run_id, None)
            _persist_active_jobs_locked()
        else:
            active_jobs.pop(run_id, None)
            _persist_active_jobs_locked()
    if should_kill:
        await asyncio.to_thread(_terminate_run_id_sync, run_id, "cancel_requested")
        return {"status": "terminating", "run_id": run_id}
    return {"status": "cancelled", "run_id": run_id}


_ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]')


@app.get("/logs/stream")
async def stream_logs(tail: int = 200, container: str = "sg-wiki-holyclaude"):
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


class WikiAutoApproveBody(BaseModel):
    enabled: bool


class RulePromotionBody(BaseModel):
    run_id: str
    proposal_id: str
    reason: str | None = None


class RulePromotionSaveBody(RulePromotionBody):
    proposed_content: str


class RulePromotionApproveBody(RulePromotionBody):
    proposed_content: str | None = None


@app.get("/wiki-reviews")
async def wiki_reviews():
    return await asyncio.to_thread(_wiki_reviews_response)


def _wiki_reviews_response() -> dict:
    items = _cached("wiki_reviews", ADMIN_CACHE_TTL_SECONDS, _pending_wiki_review_items)
    return {"items": items, "auto_approve": _wiki_auto_approve_enabled()}


@app.get("/wiki-review/auto-approve")
async def get_wiki_auto_approve():
    return await asyncio.to_thread(lambda: {"enabled": _wiki_auto_approve_enabled()})


@app.post("/wiki-review/auto-approve")
async def set_wiki_auto_approve(body: WikiAutoApproveBody):
    return await asyncio.to_thread(_set_wiki_auto_approve, body)


def _set_wiki_auto_approve(body: WikiAutoApproveBody) -> dict:
    settings = _load_admin_settings()
    settings["wiki_auto_approve"] = bool(body.enabled)
    _save_admin_settings(settings)
    _invalidate_cache("wiki_reviews")
    return {"status": "ok", "enabled": bool(body.enabled)}


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
    if _wiki_path_has_active_reservation(rel):
        raise HTTPException(
            status_code=409,
            detail={
                "status": "active_run_in_progress",
                "path": rel,
                "message": "이 위키 파일은 현재 실행 중인 작업이 점유 중이라 검토 승인할 수 없습니다.",
            },
        )
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
    if _wiki_path_has_active_reservation(rel):
        raise HTTPException(
            status_code=409,
            detail={
                "status": "active_run_in_progress",
                "path": rel,
                "message": "이 위키 파일은 현재 실행 중인 작업이 점유 중이라 검토 거부할 수 없습니다.",
            },
        )
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


@app.get("/rule-promotions")
async def rule_promotions():
    return await asyncio.to_thread(_rule_promotions_response)


def _rule_promotions_response() -> dict:
    return _cached("rule_promotions", ADMIN_CACHE_TTL_SECONDS, _load_rule_promotions)


@app.get("/rule-promotion")
async def rule_promotion_detail(run_id: str, proposal_id: str):
    return await asyncio.to_thread(_rule_promotion_detail_response, run_id, proposal_id)


@app.post("/rule-promotion/save")
async def save_rule_promotion(body: RulePromotionSaveBody):
    return await asyncio.to_thread(_save_rule_promotion, body)


@app.post("/rule-promotion/approve")
async def approve_rule_promotion(body: RulePromotionApproveBody):
    return await asyncio.to_thread(_approve_rule_promotion, body)


@app.post("/rule-promotion/reject")
async def reject_rule_promotion(body: RulePromotionBody):
    return await asyncio.to_thread(_reject_rule_promotion, body)


def _safe_rule_id(value: str, label: str) -> str:
    text = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", text):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {value}")
    return text


def _safe_rule_target(value: str) -> str:
    rel = value.strip().replace("\\", "/")
    if rel.startswith("/") or ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail=f"Invalid target path: {value}")
    allowed_agent_file = (
        rel.startswith(RULE_PROMOTION_AGENT_PREFIX)
        and rel.endswith(".md")
        and "/" not in rel[len(RULE_PROMOTION_AGENT_PREFIX):]
    )
    if rel not in RULE_PROMOTION_ALLOWED_FILES and not allowed_agent_file:
        raise HTTPException(status_code=400, detail=f"Rule promotion target is not allowed: {value}")
    abs_path = (WORKSPACE / rel).resolve()
    if not abs_path.is_relative_to(WORKSPACE.resolve()):
        raise HTTPException(status_code=400, detail=f"Invalid target path: {value}")
    return rel


def _rule_run_dir(run_id: str) -> Path:
    rid = _safe_rule_id(run_id, "run_id")
    path = (RULE_PROMOTION_ROOT / rid).resolve()
    if not path.is_relative_to(RULE_PROMOTION_ROOT.resolve()):
        raise HTTPException(status_code=400, detail=f"Invalid run_id: {run_id}")
    return path


def _rule_manifest_path(run_id: str) -> Path:
    return _rule_run_dir(run_id) / "manifest.json"


def _load_rule_manifest(run_id: str) -> dict:
    path = _rule_manifest_path(run_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="manifest not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"manifest unreadable: {exc}")
    if not isinstance(data.get("proposals"), list):
        data["proposals"] = []
    return data


def _save_rule_manifest(run_id: str, data: dict) -> None:
    path = _rule_manifest_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _invalidate_cache("rule_promotions")


def _find_rule_proposal(data: dict, proposal_id: str) -> dict:
    pid = _safe_rule_id(proposal_id, "proposal_id")
    for proposal in data.get("proposals", []):
        if proposal.get("id") == pid:
            return proposal
    raise HTTPException(status_code=404, detail="proposal not found")


def _rule_proposed_path(run_id: str, proposal: dict) -> Path:
    run_dir = _rule_run_dir(run_id)
    raw = str(proposal.get("proposed_path") or "")
    if not raw:
        raw = f"proposed/{proposal.get('id', 'proposal')}.md"
    rel = raw.strip().replace("\\", "/")
    if rel.startswith("/") or ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail=f"Invalid proposed_path: {raw}")
    path = (run_dir / rel).resolve()
    if not path.is_relative_to(run_dir.resolve()):
        raise HTTPException(status_code=400, detail=f"Invalid proposed_path: {raw}")
    return path


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _read_text_if_exists(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def _rule_promotion_diff(target_path: str, current: str, proposed: str) -> str:
    return "".join(
        difflib.unified_diff(
            current.splitlines(keepends=True),
            proposed.splitlines(keepends=True),
            fromfile=f"before/{target_path}",
            tofile=f"after/{target_path}",
        )
    )


def _rule_proposal_summary(run_id: str, proposal: dict, manifest_mtime: float) -> dict:
    target = _safe_rule_target(str(proposal.get("target_path") or ""))
    target_path = WORKSPACE / target
    current = _read_text_if_exists(target_path)
    current_hash = _sha256_text(current)
    before_hash = str(proposal.get("before_sha256") or "")
    proposed_path = _rule_proposed_path(run_id, proposal)
    return {
        "run_id": run_id,
        "proposal_id": proposal.get("id"),
        "target_path": target,
        "title": proposal.get("title") or target,
        "rationale": proposal.get("rationale") or "",
        "status": proposal.get("status") or "pending",
        "before_sha256": before_hash,
        "current_sha256": current_hash,
        "stale": bool(before_hash and before_hash != current_hash),
        "has_proposed_file": proposed_path.exists(),
        "created_at": proposal.get("created_at"),
        "updated_at": datetime.fromtimestamp(manifest_mtime).isoformat(),
    }


def _load_rule_promotions() -> dict:
    items: list[dict] = []
    if not RULE_PROMOTION_ROOT.exists():
        return {"items": []}
    for manifest_path in sorted(RULE_PROMOTION_ROOT.glob("*/manifest.json"), reverse=True):
        run_id = manifest_path.parent.name
        try:
            data = _load_rule_manifest(run_id)
            for proposal in data.get("proposals", []):
                item = _rule_proposal_summary(run_id, proposal, manifest_path.stat().st_mtime)
                if item["status"] not in {"approved", "rejected"}:
                    items.append(item)
        except Exception:
            continue
    return {"items": items}


def _rule_promotion_detail_response(run_id: str, proposal_id: str) -> dict:
    data = _load_rule_manifest(run_id)
    proposal = _find_rule_proposal(data, proposal_id)
    target = _safe_rule_target(str(proposal.get("target_path") or ""))
    current = _read_text_if_exists(WORKSPACE / target)
    proposed_path = _rule_proposed_path(run_id, proposal)
    proposed = _read_text_if_exists(proposed_path)
    return {
        "status": "ok",
        "manifest": {
            "run_id": data.get("run_id") or run_id,
            "summary": data.get("summary") or "",
            "created_at": data.get("created_at"),
        },
        "proposal": _rule_proposal_summary(run_id, proposal, _rule_manifest_path(run_id).stat().st_mtime),
        "current_content": current,
        "proposed_content": proposed,
        "diff": _rule_promotion_diff(target, current, proposed),
    }


def _save_rule_promotion(body: RulePromotionSaveBody) -> dict:
    data = _load_rule_manifest(body.run_id)
    proposal = _find_rule_proposal(data, body.proposal_id)
    _safe_rule_target(str(proposal.get("target_path") or ""))
    proposed_path = _rule_proposed_path(body.run_id, proposal)
    proposed_path.parent.mkdir(parents=True, exist_ok=True)
    proposed_path.write_text(body.proposed_content, encoding="utf-8")
    if proposal.get("status") == "pending":
        proposal["status"] = "edited"
    proposal["edited_at"] = datetime.now().isoformat()
    proposal["edit_reason"] = body.reason or ""
    _save_rule_manifest(body.run_id, data)
    return {"status": "saved", "run_id": body.run_id, "proposal_id": body.proposal_id}


def _approve_rule_promotion(body: RulePromotionApproveBody) -> dict:
    data = _load_rule_manifest(body.run_id)
    proposal = _find_rule_proposal(data, body.proposal_id)
    target = _safe_rule_target(str(proposal.get("target_path") or ""))
    target_path = WORKSPACE / target
    if not target_path.exists():
        raise HTTPException(status_code=404, detail=f"target file not found: {target}")

    current = target_path.read_text(encoding="utf-8", errors="replace")
    current_hash = _sha256_text(current)
    before_hash = str(proposal.get("before_sha256") or "")
    if before_hash and before_hash != current_hash:
        raise HTTPException(
            status_code=409,
            detail={
                "status": "stale",
                "target_path": target,
                "before_sha256": before_hash,
                "current_sha256": current_hash,
                "message": "대상 파일이 proposal 생성 이후 변경되었습니다. 제안을 다시 생성하거나 내용을 다시 확인하세요.",
            },
        )

    proposed_path = _rule_proposed_path(body.run_id, proposal)
    proposed = body.proposed_content if body.proposed_content is not None else _read_text_if_exists(proposed_path)
    if proposed == "":
        raise HTTPException(status_code=400, detail="proposed content is empty")

    target_path.write_text(proposed, encoding="utf-8")
    proposed_path.parent.mkdir(parents=True, exist_ok=True)
    proposed_path.write_text(proposed, encoding="utf-8")
    proposal["status"] = "approved"
    proposal["approved_at"] = datetime.now().isoformat()
    proposal["approved_reason"] = body.reason or ""
    proposal["applied_sha256"] = _sha256_text(proposed)
    _save_rule_manifest(body.run_id, data)
    _invalidate_cache("rule_promotions", "status")
    return {"status": "approved", "run_id": body.run_id, "proposal_id": body.proposal_id, "target_path": target}


def _reject_rule_promotion(body: RulePromotionBody) -> dict:
    data = _load_rule_manifest(body.run_id)
    proposal = _find_rule_proposal(data, body.proposal_id)
    _safe_rule_target(str(proposal.get("target_path") or ""))
    proposal["status"] = "rejected"
    proposal["rejected_at"] = datetime.now().isoformat()
    proposal["rejected_reason"] = body.reason or ""
    _save_rule_manifest(body.run_id, data)
    return {"status": "rejected", "run_id": body.run_id, "proposal_id": body.proposal_id}


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


def _load_admin_settings() -> dict:
    if not ADMIN_SETTINGS_STATE.exists():
        return {}
    try:
        return json.loads(ADMIN_SETTINGS_STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_admin_settings(state: dict) -> None:
    ADMIN_SETTINGS_STATE.parent.mkdir(parents=True, exist_ok=True)
    ADMIN_SETTINGS_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _wiki_auto_approve_enabled() -> bool:
    """위키 검토 자동 승인 설정. 미설정 시 기본값 True."""
    return bool(_load_admin_settings().get("wiki_auto_approve", True))


def _load_ack_state() -> dict:
    """제안 '확인(과거 제한 사항)' 보관 상태. sid -> {acknowledged_at, ...}.

    suggestions/decisions(에이전트가 재작성)과 분리된 admin 전용 런타임 상태로,
    위키 검토 상태(.admin/wiki_reviews.json)와 동일한 패턴을 따른다.
    """
    if not SUGGESTION_ACK_STATE.exists():
        return {}
    try:
        return json.loads(SUGGESTION_ACK_STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_ack_state(state: dict) -> None:
    SUGGESTION_ACK_STATE.parent.mkdir(parents=True, exist_ok=True)
    SUGGESTION_ACK_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


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
    auto_approve = _wiki_auto_approve_enabled()
    active_registry_files = _active_registry_files()
    candidates = set(committed) | set(working)
    items = []
    auto_dirty = False
    for rel in sorted(candidates):
        if rel in active_registry_files:
            continue
        try:
            item = _wiki_review_item(
                rel,
                working=working,
                committed=committed,
                review_state=review_state,
            )
        except Exception:
            continue
        if not item or item["decision"] == "approved":
            continue
        # 자동 승인이 켜져 있으면 아직 판정되지 않은(pending) 페이지를 자동으로 승인 기록에
        # 남겨 검토 목록에서 제외한다. 운영자가 명시적으로 거부한 항목은 건드리지 않는다.
        if auto_approve and item["decision"] == "pending":
            review_state[_review_key(item["path"], item["hash"])] = {
                "path": item["path"],
                "hash": item["hash"],
                "decision": "approved",
                "reason": "auto-approved",
                "reviewed_at": datetime.now().isoformat(),
            }
            auto_dirty = True
            continue
        items.append(item)
    if auto_dirty:
        _save_review_state(review_state)
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
    ack_state = _load_ack_state()
    items = []
    if inbox_dir.exists():
        for f in sorted(inbox_dir.glob("*.json"), reverse=True):
            try:
                item = json.loads(f.read_text(encoding="utf-8"))
                sid = item.get("id", f.stem)
                item["decision"] = _load_decision(sid)
                item["pipeline_logs"] = logs_by_sid.get(sid, [])
                ack = ack_state.get(sid) or {}
                item["acknowledged"] = bool(ack)
                item["acknowledged_at"] = ack.get("acknowledged_at")
                items.append(item)
            except Exception:
                pass
    return {"items": items}


@app.post("/suggestions/{sid}/acknowledge")
async def acknowledge_suggestion(sid: str):
    return await asyncio.to_thread(_acknowledge_suggestion, sid)


def _acknowledge_suggestion(sid: str) -> dict:
    """제안을 '확인' 처리해 과거 제한 사항 섹션으로 이동.

    inbox 원본은 그대로 두고 .admin/suggestion_ack.json에 보관 표식만 기록한다.
    """
    inbox_path = WORKSPACE / "suggestions" / "inbox" / f"{sid}.json"
    if not inbox_path.exists():
        raise HTTPException(status_code=404, detail={"status": "not_found", "sid": sid})
    state = _load_ack_state()
    state[sid] = {
        "acknowledged_at": datetime.now().isoformat(),
        "sid": sid,
    }
    _save_ack_state(state)
    _invalidate_cache("suggestions")
    return {"status": "acknowledged", "sid": sid}


@app.post("/suggestions/{sid}/unacknowledge")
async def unacknowledge_suggestion(sid: str):
    return await asyncio.to_thread(_unacknowledge_suggestion, sid)


def _unacknowledge_suggestion(sid: str) -> dict:
    """'확인'을 취소해 과거 제한 사항 → 활성 섹션으로 복원."""
    state = _load_ack_state()
    if sid in state:
        state.pop(sid, None)
        _save_ack_state(state)
    _invalidate_cache("suggestions")
    return {"status": "restored", "sid": sid}


# /suggestions/pending-push must be registered BEFORE /suggestions/{sid};
# otherwise the dynamic route captures "pending-push" as a sid and 404s.
@app.get("/suggestions/pending-push")
async def pending_push():
    return await asyncio.to_thread(_pending_push_response)


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
    ack = _load_ack_state().get(sid) or {}
    item["acknowledged"] = bool(ack)
    item["acknowledged_at"] = ack.get("acknowledged_at")
    return item


# ── p2 push 승인 게이트: 미push 커밋 조회 + 승인 push ──────────────────────
def _docker_exec_git(args: list[str], env: dict[str, str] | None = None) -> tuple[int, str]:
    """holyclaude 컨테이너 내에서 git 실행. push 자격증명은 컨테이너가 이미 보유.

    p2의 로컬 커밋도 동일 컨테이너/동일 리포에서 수행되므로, 승인 push 역시
    이 경로로 라우팅한다. 반환: (exit_code, stdout+stderr).
    """
    try:
        import docker as docker_sdk
        client = docker_sdk.from_env()
        container = client.containers.get(HOLYCLAUDE_CONTAINER)
    except Exception as exc:
        return 127, f"컨테이너 접근 실패: {exc}"

    # safe.directory: holyclaude 컨테이너의 git 사용자와 /workspace 소유자 uid가
    # 달라 "dubious ownership"으로 실패할 수 있으므로 호출마다 명시한다.
    command = [
        "git",
        "-c",
        f"safe.directory={HOLYCLAUDE_GIT_WORKDIR}",
        "-C",
        HOLYCLAUDE_GIT_WORKDIR,
        *args,
    ]
    try:
        result = container.exec_run(
            command,
            workdir=HOLYCLAUDE_GIT_WORKDIR,
            environment=env,
            demux=False,
        )
        raw = result.output
        output = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
        return int(result.exit_code if result.exit_code is not None else 0), output
    except Exception as exc:
        return 127, f"git 실행 실패: {exc}"


def _parse_pending_push(output: str) -> list[dict]:
    commits: list[dict] = []
    for line in output.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(" ", 1)
        commits.append({"hash": parts[0], "subject": parts[1] if len(parts) > 1 else ""})
    return commits


def _pending_push_response() -> dict:
    """p2가 커밋했지만 아직 push 되지 않은 커밋(upstream..HEAD) 목록.

    upstream이 미추적이거나 컨테이너 접근이 불가하면 has_pending=False.
    """
    exit_code, out = _docker_exec_git(["log", "--pretty=format:%h %s", "@{u}..HEAD"])
    if exit_code != 0:
        return {"has_pending": False, "ahead_by": 0, "commits": [], "error": out.strip() or None}
    commits = _parse_pending_push(out)
    return {"has_pending": len(commits) > 0, "ahead_by": len(commits), "commits": commits}


@app.post("/suggestions/push/approve")
async def approve_push():
    return await asyncio.to_thread(_approve_push)


def _approve_push() -> dict:
    """관리자 최종 승인 후 미push 커밋을 push.

    p2는 프롬프트 지침에 따라 commit까지만 수행하고 push하지 않는다. 미push 커밋은
    이 엔드포인트를 통해 관리자 승인 시에만 push된다. push 자체는 holyclaude
    컨테이너에서 수행(자격/원격 접근 일관성).
    """
    ahead_exit, ahead_out = _docker_exec_git(["rev-list", "--count", "@{u}..HEAD"])
    ahead_by = 0
    if ahead_exit == 0:
        try:
            ahead_by = int((ahead_out or "0").strip() or "0")
        except ValueError:
            ahead_by = 0
    if ahead_by == 0:
        return {"status": "nothing_to_push", "ahead_by": 0}

    push_exit, push_out = _docker_exec_git(["push"])
    _invalidate_cache("status", "suggestions", "suggestion_logs", "wiki_status", "wiki_reviews")
    if push_exit != 0:
        raise RuntimeError(push_out.strip() or f"git push 실패 (exit {push_exit})")
    return {
        "status": "pushed",
        "ahead_by": ahead_by,
        "output": _tail_text(push_out, 2000),
    }


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


class ConfigBody(BaseModel):
    max_concurrent_runs: int | None = None
    mem_limit_gb: int | None = None
    pids_limit: int | None = None


@app.get("/config")
async def get_config():
    info: dict = {"max_concurrent_runs": MAX_CONCURRENT_RUNS}
    try:
        import docker as docker_sdk
        client = docker_sdk.from_env()
        c = client.containers.get(HOLYCLAUDE_CONTAINER)
        hc = c.attrs.get("HostConfig", {})
        mem = hc.get("Memory", 0)
        pids = hc.get("PidsLimit", 0)
        info["mem_limit_gb"] = round(mem / (1024 ** 3)) if mem else None
        info["pids_limit"] = pids if pids else None
    except Exception:
        pass
    return info


@app.post("/config")
async def set_config(body: ConfigBody):
    global MAX_CONCURRENT_RUNS
    changes: dict = {}

    if body.max_concurrent_runs is not None:
        if not (1 <= body.max_concurrent_runs <= 20):
            raise HTTPException(status_code=422, detail="max_concurrent_runs는 1~20 사이여야 합니다")
        with active_jobs_lock:
            MAX_CONCURRENT_RUNS = body.max_concurrent_runs
        changes["max_concurrent_runs"] = MAX_CONCURRENT_RUNS

    if body.mem_limit_gb is not None or body.pids_limit is not None:
        try:
            import docker as docker_sdk
            client = docker_sdk.from_env()
            c = client.containers.get(HOLYCLAUDE_CONTAINER)
            kwargs: dict = {}
            if body.mem_limit_gb is not None:
                kwargs["mem_limit"] = f"{body.mem_limit_gb}g"
                changes["mem_limit_gb"] = body.mem_limit_gb
            if body.pids_limit is not None:
                kwargs["pids_limit"] = body.pids_limit
                changes["pids_limit"] = body.pids_limit
            c.update(**kwargs)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"컨테이너 업데이트 실패: {exc}")

    return {"status": "ok", **changes}


@app.get("/diagnostics/runtime")
async def diagnostics_runtime():
    active_ids = _active_run_ids()
    snapshot = await asyncio.to_thread(_holyclaude_process_snapshot)
    proxy = await asyncio.to_thread(_claude_mem_proxy_health)
    return {
        "active_run_ids": active_ids,
        "active_count": len(active_ids),
        "processes": snapshot,
        "claude_mem_proxy": proxy,
    }


def _env_int(name: str, fallback: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return fallback
    return value if value >= 0 else fallback


def _pipeline_limits(pipeline: str) -> tuple[int, int]:
    default_wall, default_idle = PIPELINE_TIMEOUT_DEFAULTS.get(pipeline, PIPELINE_TIMEOUT_DEFAULTS["p1"])
    key = pipeline.upper()
    wall = _env_int(f"ADMIN_{key}_WALL_TIMEOUT_SECONDS", _env_int("ADMIN_WALL_TIMEOUT_SECONDS", default_wall))
    idle = _env_int(f"ADMIN_{key}_IDLE_TIMEOUT_SECONDS", _env_int("ADMIN_IDLE_TIMEOUT_SECONDS", default_idle))
    return wall, idle


def _load_work_registry() -> dict:
    path = WORKSPACE / ".admin/p1-work-registry.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"active": {}, "history": []}
    except Exception as exc:
        print(f"[admin] work registry load failed: {exc}", flush=True)
        return {"active": {}, "history": []}


def _registry_progress_for_run(run_id: str) -> dict:
    registry = _load_work_registry()
    active = [
        entry
        for entry in (registry.get("active") or {}).values()
        if isinstance(entry, dict) and entry.get("run_id") == run_id
    ]
    terminal = [
        entry
        for entry in (registry.get("history") or [])
        if (
            isinstance(entry, dict)
            and entry.get("run_id") == run_id
            and entry.get("status") in TERMINAL_REGISTRY_STATUSES
        )
    ]
    return {
        "active": len(active),
        "terminal": len(terminal),
        "total": len(active) + len(terminal),
        "active_files": [entry.get("file") for entry in active if entry.get("file")],
    }


def _active_registry_files() -> set[str]:
    registry = _load_work_registry()
    return {
        str(entry.get("file"))
        for entry in (registry.get("active") or {}).values()
        if isinstance(entry, dict) and entry.get("file")
    }


def _wiki_path_has_active_reservation(rel: str) -> bool:
    return rel in _active_registry_files()


def _future_iso(seconds: int, *, base: float | None = None) -> str:
    return datetime.fromtimestamp((base if base is not None else time.time()) + seconds).isoformat()


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _seconds_since(value) -> int | None:
    dt = _parse_dt(value)
    if dt is None:
        return None
    return max(0, int((datetime.now() - dt).total_seconds()))


def _seconds_until(value) -> int | None:
    dt = _parse_dt(value)
    if dt is None:
        return None
    return int((dt - datetime.now()).total_seconds())


def _running_job_fields(pipeline: str, started_at: str) -> dict:
    wall_timeout, idle_timeout = _pipeline_limits(pipeline)
    now_ts = time.time()
    return {
        "wall_timeout_seconds": wall_timeout,
        "idle_timeout_seconds": idle_timeout,
        "deadline_at": _future_iso(wall_timeout, base=now_ts),
        "idle_deadline_at": _future_iso(idle_timeout, base=now_ts),
        "last_output_at": started_at,
        "cancel_requested": False,
    }


def _public_job(job: dict, queue_position: int | None = None) -> dict:
    item = dict(job)
    if queue_position is not None:
        item["queue_position"] = queue_position
    if item.get("pipeline") == "p5" and item.get("run_id"):
        progress = _registry_progress_for_run(item["run_id"])
        item["p5_file_budget"] = P5_MAX_FILES_PER_RUN
        item["p5_files_processed"] = progress["terminal"]
        item["p5_files_active"] = progress["active"]
        item["p5_files_total"] = progress["total"]
        item["p5_active_files"] = progress["active_files"]
    item["duration_seconds"] = _seconds_since(item.get("started_at"))
    item["queued_seconds"] = _seconds_since(item.get("queued_at"))
    item["last_output_age_seconds"] = _seconds_since(item.get("last_output_at") or item.get("updated_at"))
    item["wall_deadline_in_seconds"] = _seconds_until(item.get("deadline_at"))
    item["idle_deadline_in_seconds"] = _seconds_until(item.get("idle_deadline_at"))
    return item


def _active_status_count_locked() -> int:
    return sum(1 for job in active_jobs.values() if job.get("status") in ACTIVE_RUN_STATUSES)


def _active_run_ids() -> list[str]:
    with active_jobs_lock:
        return [
            run_id
            for run_id, job in active_jobs.items()
            if job.get("status") in ACTIVE_RUN_STATUSES
        ]


def _persist_active_jobs_locked() -> None:
    data = {
        "updated_at": datetime.now().isoformat(),
        "active_jobs": active_jobs,
        "run_queue": list(run_queue),
    }
    try:
        ACTIVE_RUNS_STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = ACTIVE_RUNS_STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(ACTIVE_RUNS_STATE)
    except Exception as exc:
        print(f"[admin] active-runs persist failed: {exc}", flush=True)


def _load_active_jobs_state() -> dict:
    try:
        return json.loads(ACTIVE_RUNS_STATE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception as exc:
        print(f"[admin] active-runs load failed: {exc}", flush=True)
        return {}


def _reconcile_persisted_active_runs() -> None:
    state = _load_active_jobs_state()
    stale_jobs = [
        job
        for job in (state.get("active_jobs") or {}).values()
        if isinstance(job, dict) and job.get("status") in ACTIVE_RUN_STATUSES
    ]
    for job in stale_jobs:
        run_id = job.get("run_id")
        if not run_id:
            continue
        _terminate_run_id_sync(run_id, "admin_startup_reconcile")
        try:
            _save_run(
                _run_error_log(
                    job.get("pipeline") or "p?",
                    run_id,
                    job.get("started_at") or datetime.now().isoformat(),
                    "admin 재시작으로 이전 active run을 실패 처리하고 프로세스 그룹을 정리했습니다",
                )
            )
        except Exception as exc:
            print(f"[admin] failed to save reconciled run {run_id}: {exc}", flush=True)
    with active_jobs_lock:
        active_jobs.clear()
        run_queue.clear()
        _persist_active_jobs_locked()
    _reclaim_stale_reservations([])


async def _runtime_reaper_loop() -> None:
    while True:
        await asyncio.sleep(ADMIN_REAPER_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(_runtime_reaper_once)
        except Exception as exc:
            print(f"[admin] runtime reaper failed: {exc}", flush=True)


def _runtime_reaper_once() -> None:
    active_ids = _active_run_ids()
    for run_id in active_ids:
        reason = _watchdog_reason(run_id)
        if reason and reason != "cancel_requested":
            _mark_terminating(run_id, reason)
            _terminate_run_id_sync(run_id, reason)
    _reclaim_stale_reservations(active_ids)


def _watchdog_reason(run_id: str) -> str | None:
    with active_jobs_lock:
        job = active_jobs.get(run_id)
        if not job or job.get("status") not in ACTIVE_RUN_STATUSES:
            return None
        if job.get("cancel_requested"):
            return "cancel_requested"
        now = datetime.now()
        wall_deadline = _parse_dt(job.get("deadline_at"))
        if wall_deadline and now >= wall_deadline:
            return "wall_timeout"
        idle_deadline = _parse_dt(job.get("idle_deadline_at"))
        if idle_deadline and now >= idle_deadline:
            return "idle_timeout"
        if job.get("pipeline") == "p5":
            progress = _registry_progress_for_run(run_id)
            if progress["total"] > P5_MAX_FILES_PER_RUN:
                return "p5_file_budget_exceeded"
    return None


def _mark_terminating(run_id: str, reason: str) -> None:
    now = datetime.now().isoformat()
    with active_jobs_lock:
        job = active_jobs.get(run_id)
        if not job:
            return
        job.update(
            status="terminating",
            termination_reason=reason,
            terminating_at=job.get("terminating_at") or now,
            updated_at=now,
            last_line=f"{reason}: 프로세스 그룹 종료 중",
        )
        if reason == "cancel_requested":
            job["cancel_requested"] = True
        _persist_active_jobs_locked()


def _get_holyclaude_container():
    import docker as docker_sdk

    client = docker_sdk.from_env()
    return client.containers.get(HOLYCLAUDE_CONTAINER)


def _terminate_run_id_sync(run_id: str, reason: str) -> None:
    try:
        container = _get_holyclaude_container()
        _terminate_run_process_group(container, run_id, reason)
    except Exception as exc:
        print(f"[admin] terminate failed for run {run_id}: {exc}", flush=True)


def _terminate_run_process_group(container, run_id: str, reason: str) -> None:
    marker = f"{RUN_MARKER_DIR}/{run_id}.pgid"
    pattern = f"--run-id {run_id}"
    script = f"""
set +e
marker={shlex.quote(marker)}
reason={shlex.quote(reason)}
pgid="$(cat "$marker" 2>/dev/null || true)"
case "$pgid" in
  ""|*[!0-9]*|1) pgid="" ;;
esac
if [ -n "$pgid" ]; then
  echo "[admin] terminating run {shlex.quote(run_id)} pgid=$pgid reason=$reason" >&2
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep {ADMIN_TERMINATE_GRACE_SECONDS}
  kill -KILL -- "-$pgid" 2>/dev/null || true
  rm -f "$marker"
else
  echo "[admin] no pgid marker for run {shlex.quote(run_id)}, using pkill fallback reason=$reason" >&2
  pkill -TERM -f -- {shlex.quote(pattern)} 2>/dev/null || true
  sleep {ADMIN_TERMINATE_GRACE_SECONDS}
  pkill -KILL -f -- {shlex.quote(pattern)} 2>/dev/null || true
fi
"""
    container.exec_run(["bash", "-lc", script], user="root", workdir="/workspace")


def _reclaim_stale_reservations(active_ids: list[str]) -> None:
    active_csv = ",".join(active_ids)
    command = (
        "cd /workspace && "
        f"node scripts/p6_demand_queue.mjs reclaim-stale --active-run-ids {shlex.quote(active_csv)} >/tmp/p6-reclaim.json 2>/tmp/p6-reclaim.err || true; "
        f"node scripts/wiki_work_registry.mjs reconcile --active-run-ids {shlex.quote(active_csv)} >/tmp/registry-reconcile.json 2>/tmp/registry-reconcile.err || true"
    )
    try:
        container = _get_holyclaude_container()
        container.exec_run(["bash", "-lc", command], user="root", workdir="/workspace")
    except Exception as exc:
        print(f"[admin] stale reservation reclaim failed: {exc}", flush=True)


def _holyclaude_process_snapshot() -> dict:
    try:
        container = _get_holyclaude_container()
        result = container.exec_run(
            ["bash", "-lc", "ps -eo pid,ppid,pgid,stat,etime,cmd | grep -E 'run_holyclaude_pipeline|claude|claude-mem' | grep -v grep | head -80"],
            user="root",
            workdir="/workspace",
        )
        output = result.output.decode("utf-8", errors="replace") if isinstance(result.output, bytes) else str(result.output)
        return {"status": "ok", "exit_code": result.exit_code, "output": output}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def _claude_mem_proxy_health() -> dict:
    import urllib.error
    import urllib.request

    url = os.getenv("CLAUDE_MEM_PROXY_HEALTH_URL", "http://holyclaude:37701/health")
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            data = response.read(16_384).decode("utf-8", errors="replace")
        return json.loads(data)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        return {"status": "error", "url": url, "error": str(exc)}


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
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p1", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


async def _run_p3(run_id: str, started_at: str) -> None:
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p3", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


async def _run_p4(run_id: str, started_at: str) -> None:
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p4", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


async def _run_p5(run_id: str, started_at: str) -> None:
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p5", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


async def _run_p6(run_id: str, started_at: str) -> None:
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p6", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


async def _run_p7(run_id: str, started_at: str) -> None:
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p7", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


def _start_active_job(pipeline: str, last_line: str, user_instruction: str | None = None) -> tuple[str, str, str]:
    """Register a job. Returns (run_id, started_at, status).

    When running slots are available the job is immediately 'running' and a task
    should be scheduled by the caller. Otherwise it is enqueued ('queued').
    Per-pipeline dedup is intentionally removed; the team-lead agent owns that.
    user_instruction is stored on the job so both immediate-run and queued→running
    dispatch paths can forward it to the pipeline (see _get_job_instruction).
    """
    instruction = user_instruction or ""
    now = datetime.now().isoformat()
    run_id = str(uuid.uuid4())[:8]
    with active_jobs_lock:
        running_count = _active_status_count_locked()
        if running_count < MAX_CONCURRENT_RUNS:
            status = "running"
            started_at = now
            active_jobs[run_id] = {
                "run_id": run_id,
                "pipeline": pipeline,
                "started_at": started_at,
                "status": "running",
                "last_line": last_line,
                "user_instruction": instruction,
                "updated_at": started_at,
                **_running_job_fields(pipeline, started_at),
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
                "user_instruction": instruction,
                "updated_at": now,
            }
            run_queue.append(run_id)
        _persist_active_jobs_locked()
        return run_id, started_at, status


def _get_job_instruction(run_id: str) -> str:
    """Return the user_instruction stored on the job (may survive a queue wait)."""
    with active_jobs_lock:
        return (active_jobs.get(run_id) or {}).get("user_instruction") or ""


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
            _persist_active_jobs_locked()


def _pop_active_job(run_id: str) -> None:
    with active_jobs_lock:
        active_jobs.pop(run_id, None)
        _persist_active_jobs_locked()
    active_ids = _active_run_ids()
    threading.Thread(
        target=_reclaim_stale_reservations,
        args=(active_ids,),
        name=f"registry-reclaim-{run_id}",
        daemon=True,
    ).start()
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
                _active_status_count_locked()
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
            job.update(
                status="running",
                started_at=started_at,
                updated_at=started_at,
                **_running_job_fields(pipeline, started_at),
            )
            to_start.append((pipeline, rid, started_at))
        _persist_active_jobs_locked()
    for pipeline, rid, started_at in to_start:
        if pipeline == "p1":
            asyncio.create_task(_run_p1(rid, started_at))
        elif pipeline == "p2":
            asyncio.create_task(_run_p2(rid, started_at))
        elif pipeline == "p3":
            asyncio.create_task(_run_p3(rid, started_at))
        elif pipeline == "p4":
            asyncio.create_task(_run_p4(rid, started_at))
        elif pipeline == "p5":
            asyncio.create_task(_run_p5(rid, started_at))
        elif pipeline == "p6":
            asyncio.create_task(_run_p6(rid, started_at))
        elif pipeline == "p7":
            asyncio.create_task(_run_p7(rid, started_at))


def _sanitize_instruction(value: str, limit: int = 4000) -> str:
    """Strip control chars (keep tabs/newlines) and cap length so the instruction is
    safe for both the shell (shlex.quote handles the rest) and the team-lead prompt.
    Returns "" when empty — callers omit --instruction in that case."""
    text = "".join(ch for ch in (value or "") if ch >= " " or ch in "\t\n")
    return text.strip()[:limit]


def _run_holyclaude_pipeline(pipeline: str, run_id: str, started_at: str, user_instruction: str = "") -> dict:
    instruction = _sanitize_instruction(user_instruction)
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

    # p2(제안 자동 처리) push 승인 게이트:
    #   p2는 프롬프트 지침으로 commit까지만 수행하고 push하지 않는다. 미push 커밋은
    #   관리자 승인 엔드포인트(/suggestions/push/approve)가 별도로 push한다.
    #   p1/3/5/6 은 기존대로 자동 push 한다.
    inner = f"cd /workspace && node {shlex.quote(PIPELINE_SCRIPT)} {shlex.quote(pipeline)} --run-id {shlex.quote(run_id)}"
    if instruction:
        inner += f" --instruction {shlex.quote(instruction)}"
    marker = f"{RUN_MARKER_DIR}/{run_id}.pgid"
    group_script = (
        f"echo $$ > {shlex.quote(marker)}; "
        f"trap 'rm -f {shlex.quote(marker)}' EXIT; "
        f"su claude -s /bin/sh -c {shlex.quote(inner)} 2>&1"
    )
    command = [
        "bash",
        "-lc",
        f"mkdir -p {shlex.quote(RUN_MARKER_DIR)}; bash -lc {shlex.quote(group_script)}",
    ]

    _update_active_job(
        run_id,
        last_line=f"docker exec {HOLYCLAUDE_CONTAINER}",
        process_group_marker=marker,
        updated_at=datetime.now().isoformat(),
    )
    output: list[str] = []
    idle_timeout = _pipeline_limits(pipeline)[1]
    exec_id = None
    termination_reason = None
    termination_started = None
    stream_error = None
    try:
        exec_id = client.api.exec_create(
            container.id,
            command,
            user="root",
            workdir="/workspace",
            stdout=True,
            stderr=True,
        )["Id"]
        _update_active_job(
            run_id,
            exec_id=exec_id,
            last_line=f"exec_id={exec_id}",
            updated_at=datetime.now().isoformat(),
        )
        stream = client.api.exec_start(exec_id, stream=True, demux=False)
        events: queue.Queue[tuple[str, object]] = queue.Queue()

        def read_stream() -> None:
            try:
                for chunk in stream:
                    events.put(("chunk", chunk))
            except Exception as exc:
                events.put(("error", exc))
            finally:
                events.put(("done", None))

        reader = threading.Thread(target=read_stream, name=f"run-stream-{run_id}", daemon=True)
        reader.start()

        while True:
            try:
                kind, payload = events.get(timeout=1)
            except queue.Empty:
                reason = _watchdog_reason(run_id)
                if reason and termination_reason is None:
                    termination_reason = reason
                    termination_started = time.monotonic()
                    _mark_terminating(run_id, reason)
                    _terminate_run_process_group(container, run_id, reason)
                if (
                    termination_reason
                    and termination_started
                    and time.monotonic() - termination_started > ADMIN_TERMINATE_GRACE_SECONDS + 10
                ):
                    output.append(
                        f"\n[admin] terminate grace exceeded for run {run_id} reason={termination_reason}\n"
                    )
                    break
                continue

            if kind == "chunk":
                chunk = payload if isinstance(payload, bytes) else bytes(payload or b"")
                text = _ANSI.sub("", chunk.decode("utf-8", errors="replace"))
                output.append(text)
                last_line = None
                for line in text.splitlines():
                    if line.strip():
                        last_line = line[-300:]
                if last_line is not None:
                    now_iso = datetime.now().isoformat()
                    _update_active_job(
                        run_id,
                        last_line=last_line,
                        updated_at=now_iso,
                        last_output_at=now_iso,
                        idle_deadline_at=_future_iso(idle_timeout),
                    )
                continue

            if kind == "error":
                stream_error = payload
                output.append(f"\n[admin] docker stream error: {payload}\n")
                continue

            if kind == "done":
                break

        if termination_reason is None:
            with active_jobs_lock:
                job = active_jobs.get(run_id) or {}
                termination_reason = job.get("termination_reason")

        inspect = client.api.exec_inspect(exec_id)
        exit_code = inspect.get("ExitCode")
    except Exception as exc:
        return _run_error_log(pipeline, run_id, started_at, f"holyclaude 실행 실패: {exc}", "".join(output))

    stdout_tail = _tail_text("".join(output), RUN_OUTPUT_LIMIT)
    completed_at = datetime.now().isoformat()
    ok = exit_code == 0 and not termination_reason and stream_error is None
    if termination_reason == "cancel_requested":
        status = "cancelled"
        message = "파이프라인 실행 취소됨"
        errors = ["cancel_requested"]
    elif termination_reason:
        status = "failed"
        message = f"파이프라인 실행 실패: {termination_reason}"
        errors = [termination_reason]
    elif stream_error is not None:
        status = "failed"
        message = f"파이프라인 실행 실패: docker stream error ({stream_error})"
        errors = [str(stream_error)]
    else:
        status = "completed" if ok else "failed"
        message = _pipeline_message(pipeline, ok)
        errors = [] if ok else [f"holyclaude exit_code={exit_code}"]
    log = {
        "run_id": run_id,
        "pipeline": pipeline,
        "timestamp": completed_at,
        "started_at": started_at,
        "completed_at": completed_at,
        "status": status,
        "message": message,
        "user_instruction": instruction,
        "container": HOLYCLAUDE_CONTAINER,
        "exec_id": exec_id,
        "termination_reason": termination_reason,
        "exit_code": exit_code,
        "processed": 1 if ok else 0,
        "skipped": 0,
        "errors": errors,
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
    user_instruction = _get_job_instruction(run_id)
    try:
        log = await asyncio.to_thread(_run_holyclaude_pipeline, "p2", run_id, started_at, user_instruction)
        _save_run(log)
    finally:
        _pop_active_job(run_id)


def _save_run(data: dict) -> None:
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    path = RUNS_DIR / f"{ts}-{data.get('run_id', 'run')}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    _invalidate_cache("status", "suggestions", "suggestion_logs", "wiki_status", "wiki_reviews", "rule_promotions")
