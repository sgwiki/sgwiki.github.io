#!/usr/bin/env python3
"""Run QA wiki extraction through a LangChain OpenAI-compatible LLM.

The standard-library pipeline in qa_wiki_pipeline.py remains the source of
truth for CSV parsing, prompt rendering, validation, and wiki grouping. This
script adds the model execution layer and persists every intermediate artifact
needed for prompt engineering and monitoring.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import threading
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field
from rich.console import Console
from rich.progress import BarColumn, Progress, TaskProgressColumn, TextColumn, TimeElapsedColumn


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.qa_wiki_pipeline import (  # noqa: E402
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_USER_TEMPLATE,
    load_posts,
    parse_json_or_jsonl,
    render_batch_prompt,
    select_records,
    validate_extraction,
)


DEFAULT_CSV = REPO_ROOT / "data" / "2025-05-04_질문목록_수동필터링.csv"
DEFAULT_WRAPPER_PROMPT = REPO_ROOT / "prompts" / "local_completion_wrapper.md"
DEFAULT_OUT_ROOT = REPO_ROOT / "artifacts" / "qa-wiki" / "runs"
CONSOLE = Console()


class ConceptCandidate(BaseModel):
    model_config = ConfigDict(extra="allow")

    concept_id: str
    label: str
    relation: Literal["primary", "secondary"]


class AnswerCandidate(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: Literal["answered", "partial", "unanswered", "conflicting"]
    summary: str
    evidence_comment_indexes: list[int] = Field(default_factory=list)
    confidence: Literal["low", "medium", "high"]


class ExtractionRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    gall_num: str
    source_url: str
    title_clean: str
    question_intent: str
    question_type: Literal["설정해석", "시청순서", "작품관계", "캐릭터/사건", "게임/플랫폼", "번역/한글패치", "OST/자료", "기타"]
    canonical_keywords: list[str] = Field(default_factory=list)
    raw_keywords: list[str] = Field(default_factory=list)
    concept_candidates: list[ConceptCandidate] = Field(default_factory=list)
    entities: dict[str, list[str]] = Field(default_factory=dict)
    answer_candidate: AnswerCandidate
    spoiler_level: Literal["none", "early_story", "main_story", "zero_story", "endgame"]
    wiki_action: Literal[
        "merge_into_concept_faq",
        "create_new_concept_candidate",
        "discard_low_value",
        "needs_human_review",
    ]
    needs_human_review: bool
    review_reason: str = ""


@dataclass
class LlmConfig:
    base_url: str
    model: str
    api_key: str
    temperature: float
    max_tokens: int
    timeout: float
    max_retries: int


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, data: Any) -> None:
    write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def append_jsonl(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(data, ensure_ascii=False) + "\n")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def timestamp_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def ensure_run_dirs(run_dir: Path) -> None:
    for name in ("batches", "raw", "parsed", "validation", "errors", "jsonl", "wiki"):
        (run_dir / name).mkdir(parents=True, exist_ok=True)


def ensure_auto_run_dirs(run_dir: Path) -> None:
    for name in ("attempts", "failures", "jsonl", "wiki"):
        (run_dir / name).mkdir(parents=True, exist_ok=True)


def env_value(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def build_llm_config(args: argparse.Namespace | dict[str, Any]) -> LlmConfig:
    if isinstance(args, dict):
        llm = args.get("llm", {})
        return LlmConfig(
            base_url=str(llm["base_url"]),
            model=str(llm["model"]),
            api_key=str(llm["api_key"]),
            temperature=float(llm["temperature"]),
            max_tokens=int(llm["max_tokens"]),
            timeout=float(llm["timeout"]),
            max_retries=int(llm["max_retries"]),
        )
    return LlmConfig(
        base_url=args.base_url,
        model=args.model,
        api_key=args.api_key,
        temperature=args.temperature,
        max_tokens=args.max_tokens,
        timeout=args.timeout,
        max_retries=args.max_retries,
    )


def build_llm(config: LlmConfig):
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=config.model,
        openai_api_base=config.base_url,
        openai_api_key=config.api_key,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        timeout=config.timeout,
        max_retries=config.max_retries,
    )


def wrap_prompt(prompt: str, wrapper_path: Path) -> str:
    wrapper = read_text(wrapper_path)
    if "{{PROMPT}}" not in wrapper:
        raise ValueError(f"Wrapper prompt must contain {{PROMPT}} placeholder: {wrapper_path}")
    return wrapper.replace("{{PROMPT}}", prompt.strip())


def parse_llm_response(raw_text: str) -> tuple[list[dict[str, Any]], str]:
    """Parse a model response and report which recovery strategy worked."""
    text = raw_text.strip()
    fenced = strip_first_json_fence(text)
    fence_body = strip_json_fence_body(text)
    array_slice = slice_between(text, "[", "]")
    object_slice = slice_between(text, "{", "}")
    candidates = [
        ("full", text),
        ("full_unescaped", unescape_overescaped_json(text)),
        ("fenced_json", fenced),
        ("fenced_json_unescaped", unescape_overescaped_json(fenced)),
        ("fence_body", fence_body),
        ("fence_body_unescaped", unescape_overescaped_json(fence_body)),
        ("array_slice", array_slice),
        ("array_slice_unescaped", unescape_overescaped_json(array_slice)),
        ("object_slice", object_slice),
        ("object_slice_unescaped", unescape_overescaped_json(object_slice)),
    ]
    last_error: Exception | None = None
    for strategy, candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
            return normalize_parsed_records(parsed), strategy
        except Exception as exc:  # noqa: BLE001 - keep all parse attempts for recovery
            last_error = exc
    for strategy, candidate in candidates:
        if not candidate:
            continue
        try:
            records = parse_partial_json_array(candidate)
        except Exception as exc:  # noqa: BLE001 - keep parse recovery best-effort
            last_error = exc
            continue
        if records:
            return normalize_parsed_records(records), f"{strategy}_partial_array"
    raise ValueError(f"Could not parse JSON response: {last_error}")


def unescape_overescaped_json(text: str | None) -> str | None:
    if not text or '\\"' not in text:
        return None
    return text.replace('\\"', '"')


def strip_first_json_fence(text: str) -> str | None:
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.S)
    return match.group(1).strip() if match else None


def strip_json_fence_body(text: str) -> str | None:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return None
    lines = stripped.splitlines()
    if not lines:
        return None
    body = "\n".join(lines[1:]).strip()
    closing_index = body.find("```")
    if closing_index != -1:
        body = body[:closing_index].strip()
    return body or None


def slice_between(text: str, start: str, end: str) -> str | None:
    start_index = text.find(start)
    end_index = text.rfind(end)
    if start_index == -1 or end_index == -1 or end_index <= start_index:
        return None
    return text[start_index : end_index + 1]


def parse_partial_json_array(text: str) -> list[dict[str, Any]] | None:
    """Recover complete leading objects from a truncated top-level JSON array."""
    candidate = text.strip()
    if not candidate:
        return None
    if '\\"' in candidate:
        candidate = candidate.replace('\\"', '"')
    start_index = candidate.find("[")
    if start_index == -1:
        return None

    decoder = json.JSONDecoder()
    records: list[dict[str, Any]] = []
    index = start_index + 1
    while index < len(candidate):
        while index < len(candidate) and candidate[index] in " \t\r\n,":
            index += 1
        if index >= len(candidate) or candidate[index] == "]":
            break
        try:
            item, index = decoder.raw_decode(candidate, index)
        except json.JSONDecodeError:
            break
        if not isinstance(item, dict):
            return None
        records.append(item)
    return records or None


def normalize_parsed_records(parsed: Any) -> list[dict[str, Any]]:
    if isinstance(parsed, list):
        records = parsed
    elif isinstance(parsed, dict):
        records = None
        for key in ("records", "items", "extractions", "data"):
            if isinstance(parsed.get(key), list):
                records = parsed[key]
                break
        if records is None:
            records = [parsed]
    else:
        raise ValueError(f"JSON root must be object or array, got {type(parsed).__name__}")

    normalized = []
    for index, item in enumerate(records):
        if not isinstance(item, dict):
            raise ValueError(f"Parsed item {index} is {type(item).__name__}, not object")
        normalized.append(item)
    return normalized


def coerce_records_with_pydantic(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    coerced = []
    errors = []
    for index, record in enumerate(records):
        try:
            coerced.append(ExtractionRecord.model_validate(record).model_dump(mode="json"))
        except Exception as exc:  # noqa: BLE001 - report all validation details
            errors.append(f"item {index}: {exc}")
            coerced.append(record)
    return coerced, errors


def validation_report(
    *,
    batch_number: int,
    expected_gall_nums: list[str],
    records: list[dict[str, Any]],
    parse_strategy: str | None,
    pydantic_errors: list[str],
) -> dict[str, Any]:
    record_errors: dict[str, list[str]] = {}
    for index, record in enumerate(records):
        key = str(record.get("gall_num") or f"index:{index}")
        errors = validate_extraction(record)
        if errors:
            record_errors[key] = errors

    actual_gall_nums = [str(record.get("gall_num", "")) for record in records]
    actual_counts: dict[str, int] = defaultdict(int)
    for gall_num in actual_gall_nums:
        actual_counts[gall_num] += 1
    duplicate_gall_nums = sorted(gall_num for gall_num, count in actual_counts.items() if gall_num and count > 1)
    missing = [gall_num for gall_num in expected_gall_nums if gall_num not in actual_gall_nums]
    unexpected = [gall_num for gall_num in actual_gall_nums if gall_num not in expected_gall_nums]
    valid = not record_errors and not pydantic_errors and not missing and not unexpected and not duplicate_gall_nums
    return {
        "batch_number": batch_number,
        "valid": valid,
        "expected_count": len(expected_gall_nums),
        "actual_count": len(records),
        "expected_gall_nums": expected_gall_nums,
        "actual_gall_nums": actual_gall_nums,
        "duplicate_gall_nums": duplicate_gall_nums,
        "missing_gall_nums": missing,
        "unexpected_gall_nums": unexpected,
        "parse_strategy": parse_strategy,
        "pydantic_error_count": len(pydantic_errors),
        "pydantic_errors": pydantic_errors,
        "record_error_count": len(record_errors),
        "record_errors": record_errors,
    }


def create_run(args: argparse.Namespace, mode: Literal["sample", "full"]) -> Path:
    run_id = args.run_id or f"{timestamp_id()}-{mode}"
    run_dir = Path(args.out_root) / run_id
    ensure_run_dirs(run_dir)

    records = select_records(
        load_posts(Path(args.csv)),
        sample_size=args.sample_size if mode == "sample" else None,
        seed=args.seed,
        limit=args.limit,
    )
    if not records:
        raise ValueError("No records selected")

    wrapper_path = Path(args.wrapper_prompt)
    system_prompt = Path(args.system_prompt)
    user_template = Path(args.user_template)
    batch_infos = []
    batch_records = []

    selected_jsonl = run_dir / "records.jsonl"
    with selected_jsonl.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record.json_dict(), ensure_ascii=False) + "\n")

    for batch_number, start in enumerate(range(0, len(records), args.batch_size), start=1):
        batch = records[start : start + args.batch_size]
        prompt_items = [
            record.prompt_dict(
                max_post_chars=args.max_post_chars,
                max_comment_chars=args.max_comment_chars,
                max_comments=args.max_comments,
            )
            for record in batch
        ]
        batch_records.append(prompt_items)
        batch_infos.append(
            {
                "batch_number": batch_number,
                "input_count": len(batch),
                "gall_nums": [record.gall_num for record in batch],
                "prompt_path": f"batches/batch_{batch_number:04d}.prompt.md",
                "input_path": f"batches/batch_{batch_number:04d}.input.md",
                "raw_path": f"raw/batch_{batch_number:04d}.response.txt",
                "parsed_path": f"parsed/batch_{batch_number:04d}.json",
                "validation_path": f"validation/batch_{batch_number:04d}.json",
                "error_path": f"errors/batch_{batch_number:04d}.json",
            }
        )

    total_batches = len(batch_infos)
    for info, prompt_items in zip(batch_infos, batch_records, strict=True):
        prompt = render_batch_prompt(
            batch_records=prompt_items,
            batch_number=info["batch_number"],
            total_batches=total_batches,
            system_prompt_path=system_prompt,
            user_template_path=user_template,
        )
        wrapped = wrap_prompt(prompt, wrapper_path)
        write_text(run_dir / info["prompt_path"], prompt)
        write_text(run_dir / info["input_path"], wrapped)

    llm_config = build_llm_config(args)
    run_config = {
        "created_at": now_iso(),
        "mode": mode,
        "source_csv": str(Path(args.csv)),
        "records_path": "records.jsonl",
        "batch_size": args.batch_size,
        "max_concurrency": args.max_concurrency,
        "sample_size": args.sample_size if mode == "sample" else None,
        "seed": args.seed,
        "limit": args.limit,
        "prompt_limits": {
            "max_post_chars": args.max_post_chars,
            "max_comment_chars": args.max_comment_chars,
            "max_comments": args.max_comments,
        },
        "prompts": {
            "system_prompt": str(system_prompt),
            "user_template": str(user_template),
            "wrapper_prompt": str(wrapper_path),
        },
        "llm": asdict(llm_config),
        "outputs": {
            "extractions_jsonl": "jsonl/extractions.jsonl",
            "summary": "summary.json",
            "events": "events.jsonl",
        },
    }
    write_json(run_dir / "run_config.json", run_config)
    write_json(run_dir / "batch_manifest.json", {"batches": batch_infos})
    write_json(
        run_dir / "manifest.json",
        {
            "source_csv": str(Path(args.csv)),
            "selected_records": len(records),
            "batch_count": total_batches,
            "mode": mode,
            "run_id": run_id,
            "run_dir": str(run_dir),
        },
    )
    append_jsonl(run_dir / "events.jsonl", {"time": now_iso(), "event": "run_created", "run_dir": str(run_dir)})
    return run_dir


def call_llm(llm: Any, prompt: str) -> str:
    response = llm.invoke(prompt)
    if isinstance(response, str):
        return response
    content = getattr(response, "content", None)
    if isinstance(content, str):
        return content
    return str(response)


def load_run(run_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    config = json.loads((run_dir / "run_config.json").read_text(encoding="utf-8"))
    batch_manifest = json.loads((run_dir / "batch_manifest.json").read_text(encoding="utf-8"))
    return config, list(batch_manifest["batches"])


def is_batch_valid(run_dir: Path, info: dict[str, Any]) -> bool:
    validation_path = run_dir / info["validation_path"]
    if not validation_path.exists():
        return False
    try:
        report = json.loads(validation_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return bool(report.get("valid"))


def process_run(run_dir: Path, *, failed_only: bool, batch_numbers: set[int] | None = None) -> int:
    config, batches = load_run(run_dir)
    llm = build_llm(build_llm_config(config))
    events_path = run_dir / "events.jsonl"
    max_concurrency = int(config.get("max_concurrency", 1))
    completed = 0
    failed = 0
    events_lock = threading.Lock()
    counters_lock = threading.Lock()

    selected_batches = []
    for info in batches:
        number = int(info["batch_number"])
        if batch_numbers and number not in batch_numbers:
            continue
        if failed_only and is_batch_valid(run_dir, info):
            continue
        selected_batches.append(info)

    if not selected_batches:
        CONSOLE.print(f"[green]No batches to process:[/] {run_dir}")
        consolidate_run(run_dir)
        return 0

    def _run_one_batch(info: dict[str, Any]) -> None:
        nonlocal completed, failed
        batch_number = int(info["batch_number"])
        with events_lock:
            append_jsonl(events_path, {"time": now_iso(), "event": "batch_started", "batch_number": batch_number})
        started = time.perf_counter()
        try:
            prompt = read_text(run_dir / info["input_path"])
            raw = call_llm(llm, prompt)
            write_text(run_dir / info["raw_path"], raw)
            records, strategy = parse_llm_response(raw)
            records, pydantic_errors = coerce_records_with_pydantic(records)
            write_json(run_dir / info["parsed_path"], records)
            report = validation_report(
                batch_number=batch_number,
                expected_gall_nums=list(info["gall_nums"]),
                records=records,
                parse_strategy=strategy,
                pydantic_errors=pydantic_errors,
            )
            write_json(run_dir / info["validation_path"], report)
            duration = round(time.perf_counter() - started, 3)
            if report["valid"]:
                error_path = run_dir / info["error_path"]
                if error_path.exists():
                    error_path.unlink()
                with counters_lock:
                    completed += 1
                with events_lock:
                    append_jsonl(
                        events_path,
                        {
                            "time": now_iso(),
                            "event": "batch_completed",
                            "batch_number": batch_number,
                            "duration_seconds": duration,
                            "parse_strategy": strategy,
                            "record_count": len(records),
                        },
                    )
            else:
                with counters_lock:
                    failed += 1
                error_payload = {
                    "batch_number": batch_number,
                    "error": "validation_failed",
                    "validation": report,
                }
                write_json(run_dir / info["error_path"], error_payload)
                with events_lock:
                    append_jsonl(
                        events_path,
                        {
                            "time": now_iso(),
                            "event": "batch_validation_failed",
                            "batch_number": batch_number,
                            "duration_seconds": duration,
                            "record_error_count": report["record_error_count"],
                            "pydantic_error_count": report["pydantic_error_count"],
                        },
                    )
        except Exception as exc:  # noqa: BLE001 - persist failure and keep later batches running
            with counters_lock:
                failed += 1
            duration = round(time.perf_counter() - started, 3)
            error_payload = {
                "batch_number": batch_number,
                "error": type(exc).__name__,
                "message": str(exc),
                "duration_seconds": duration,
            }
            write_json(run_dir / info["error_path"], error_payload)
            with events_lock:
                append_jsonl(
                    events_path,
                    {
                        "time": now_iso(),
                        "event": "batch_failed",
                        "batch_number": batch_number,
                        "duration_seconds": duration,
                        "error": type(exc).__name__,
                        "message": str(exc),
                    },
                )

    progress = Progress(
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=CONSOLE,
    )
    with progress:
        task = progress.add_task("extracting", total=len(selected_batches))
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrency) as pool:
            futures = [pool.submit(_run_one_batch, info) for info in selected_batches]
            for fut in concurrent.futures.as_completed(futures):
                fut.result()
                progress.advance(task)

    summary = consolidate_run(run_dir)
    CONSOLE.print(
        f"[bold]run_dir[/]: {run_dir}\n"
        f"[green]valid_batches[/]: {summary['valid_batches']}  "
        f"[red]failed_batches[/]: {len(summary['failed_batch_numbers'])}  "
        f"[cyan]records[/]: {summary['record_count']}"
    )
    return 1 if failed else 0


def consolidate_run(run_dir: Path) -> dict[str, Any]:
    _config, batches = load_run(run_dir)
    all_records: list[dict[str, Any]] = []
    valid_batches = 0
    failed_batch_numbers = []
    validation_reports = []

    output_jsonl = run_dir / "jsonl" / "extractions.jsonl"
    output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with output_jsonl.open("w", encoding="utf-8") as handle:
        for info in batches:
            batch_number = int(info["batch_number"])
            validation_path = run_dir / info["validation_path"]
            parsed_path = run_dir / info["parsed_path"]
            if not validation_path.exists() or not parsed_path.exists():
                failed_batch_numbers.append(batch_number)
                continue
            report = json.loads(validation_path.read_text(encoding="utf-8"))
            validation_reports.append(report)
            if not report.get("valid"):
                failed_batch_numbers.append(batch_number)
                continue
            records = json.loads(parsed_path.read_text(encoding="utf-8"))
            valid_batches += 1
            for record in records:
                all_records.append(record)
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    summary = {
        "run_dir": str(run_dir),
        "updated_at": now_iso(),
        "total_batches": len(batches),
        "valid_batches": valid_batches,
        "failed_batch_numbers": failed_batch_numbers,
        "record_count": len(all_records),
        "extractions_jsonl": str(output_jsonl),
        "validation_report_count": len(validation_reports),
    }
    write_json(run_dir / "summary.json", summary)
    return summary


def command_sample(args: argparse.Namespace) -> int:
    run_dir = create_run(args, "sample")
    CONSOLE.print(f"[bold]run_dir[/]: {run_dir}")
    if args.prepare_only:
        CONSOLE.print(f"[green]Prepared sample run:[/] {run_dir}")
        return 0
    return process_run(run_dir, failed_only=False, batch_numbers=parse_batch_numbers(args.only_batches))


def command_full(args: argparse.Namespace) -> int:
    run_dir = create_run(args, "full")
    CONSOLE.print(f"[bold]run_dir[/]: {run_dir}")
    if args.prepare_only:
        CONSOLE.print(f"[green]Prepared full run:[/] {run_dir}")
        return 0
    return process_run(run_dir, failed_only=False, batch_numbers=parse_batch_numbers(args.only_batches))


def command_auto_full(args: argparse.Namespace) -> int:
    if args.batch_size < 1 or args.retry_batch_size < 1 or args.final_batch_size < 1:
        raise ValueError("batch sizes must be positive integers")
    if args.max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    if args.max_concurrency < 1:
        raise ValueError("max_concurrency must be at least 1")

    run_id = args.run_id or f"{timestamp_id()}-auto-full"
    run_dir = Path(args.out_root) / run_id
    ensure_auto_run_dirs(run_dir)
    CONSOLE.print(f"[bold]run_dir[/]: {run_dir}")

    selected_records = select_records(
        load_posts(Path(args.csv)),
        sample_size=None,
        seed=args.seed,
        limit=args.limit,
    )
    if not selected_records:
        raise ValueError("No records selected")
    ensure_unique_gall_nums(selected_records)

    records_by_id = {record.gall_num: record for record in selected_records}
    source_order = [record.gall_num for record in selected_records]
    completed_records: dict[str, dict[str, Any]] = {}
    if not args.ignore_existing:
        completed_records = load_existing_auto_full_successes(
            out_root=Path(args.out_root),
            current_run_dir=run_dir,
            records_by_id=records_by_id,
        )

    config = build_auto_run_config(args, run_id, run_dir, selected_records)
    write_json(run_dir / "run_config.json", config)
    write_json(
        run_dir / "manifest.json",
        {
            "source_csv": str(Path(args.csv)),
            "selected_records": len(selected_records),
            "mode": "auto-full",
            "run_id": run_id,
            "run_dir": str(run_dir),
            "dedupe_key": "gall_num",
        },
    )
    append_jsonl(
        run_dir / "events.jsonl",
        {
            "time": now_iso(),
            "event": "auto_run_created",
            "run_dir": str(run_dir),
            "record_count": len(selected_records),
        },
    )

    if args.prepare_only:
        attempt_dir = run_dir / "attempts" / "attempt_01"
        prepare_attempt_run(
            attempt_dir=attempt_dir,
            records=selected_records,
            args=args,
            attempt_number=1,
            batch_size=args.batch_size,
        )
        write_auto_outputs(
            run_dir=run_dir,
            source_records=selected_records,
            completed_records=completed_records,
            remaining_ids=[gall_num for gall_num in source_order if gall_num not in completed_records],
            attempt_reports=[],
            last_failures={},
            complete=False,
            reused_record_count=len(completed_records),
        )
        CONSOLE.print(f"[green]Prepared auto-full run:[/] {run_dir}")
        return 0

    llm = build_llm(build_llm_config(args))
    last_failures: dict[str, dict[str, Any]] = {}
    attempt_reports: list[dict[str, Any]] = []
    remaining_ids = [gall_num for gall_num in source_order if gall_num not in completed_records]
    if completed_records:
        append_jsonl(
            run_dir / "events.jsonl",
            {
                "time": now_iso(),
                "event": "existing_successes_reused",
                "record_count": len(completed_records),
            },
        )

    for attempt_number in range(1, args.max_attempts + 1):
        pending_records = [records_by_id[gall_num] for gall_num in remaining_ids if gall_num not in completed_records]
        if not pending_records:
            break

        batch_size = auto_attempt_batch_size(args, attempt_number)
        attempt_dir = run_dir / "attempts" / f"attempt_{attempt_number:02d}"
        append_jsonl(
            run_dir / "events.jsonl",
            {
                "time": now_iso(),
                "event": "attempt_started",
                "attempt_number": attempt_number,
                "pending_count": len(pending_records),
                "batch_size": batch_size,
            },
        )
        batch_infos = prepare_attempt_run(
            attempt_dir=attempt_dir,
            records=pending_records,
            args=args,
            attempt_number=attempt_number,
            batch_size=batch_size,
        )
        result = process_attempt(
            attempt_dir=attempt_dir,
            batch_infos=batch_infos,
            llm=llm,
            events_path=run_dir / "events.jsonl",
            attempt_number=attempt_number,
            max_concurrency=args.max_concurrency,
        )

        for gall_num, record in result["succeeded_records"].items():
            if gall_num not in completed_records:
                record["_auto_attempt"] = attempt_number
                completed_records[gall_num] = record
                last_failures.pop(gall_num, None)
        last_failures.update(result["failed_posts"])
        remaining_ids = [gall_num for gall_num in source_order if gall_num not in completed_records]

        attempt_report = {
            "attempt_number": attempt_number,
            "attempt_dir": str(attempt_dir),
            "batch_size": batch_size,
            "input_count": len(pending_records),
            "succeeded_count": len(result["succeeded_records"]),
            "failed_count": len([gall_num for gall_num in remaining_ids if gall_num in last_failures]),
            "batch_count": len(batch_infos),
        }
        attempt_reports.append(attempt_report)
        append_jsonl(run_dir / "events.jsonl", {"time": now_iso(), "event": "attempt_completed", **attempt_report})
        write_auto_outputs(
            run_dir=run_dir,
            source_records=selected_records,
            completed_records=completed_records,
            remaining_ids=remaining_ids,
            attempt_reports=attempt_reports,
            last_failures=last_failures,
            complete=not remaining_ids,
            reused_record_count=len([record for record in completed_records.values() if record.get("_auto_reused")]),
        )
        CONSOLE.print(
            f"[bold]attempt[/] {attempt_number}: "
            f"[green]succeeded[/]={attempt_report['succeeded_count']} "
            f"[red]remaining[/]={len(remaining_ids)}"
        )

    complete = not remaining_ids
    summary = write_auto_outputs(
        run_dir=run_dir,
        source_records=selected_records,
        completed_records=completed_records,
        remaining_ids=remaining_ids,
        attempt_reports=attempt_reports,
        last_failures=last_failures,
        complete=complete,
        reused_record_count=len([record for record in completed_records.values() if record.get("_auto_reused")]),
    )
    append_jsonl(
        run_dir / "events.jsonl",
        {
            "time": now_iso(),
            "event": "auto_run_completed" if complete else "auto_run_incomplete",
            "completed_record_count": summary["completed_record_count"],
            "failed_record_count": summary["failed_record_count"],
        },
    )
    CONSOLE.print(
        f"[bold]run_dir[/]: {run_dir}\n"
        f"[green]completed[/]: {summary['completed_record_count']}  "
        f"[red]failed[/]: {summary['failed_record_count']}  "
        f"[cyan]attempts[/]: {summary['attempt_count']}"
    )
    return 0 if complete else 1


def ensure_unique_gall_nums(records: list[Any]) -> None:
    counts: dict[str, int] = defaultdict(int)
    for record in records:
        counts[record.gall_num] += 1
    duplicates = sorted(gall_num for gall_num, count in counts.items() if count > 1)
    if duplicates:
        raise ValueError(f"Duplicate gall_num values in selected records: {duplicates[:20]}")


def load_existing_auto_full_successes(
    *,
    out_root: Path,
    current_run_dir: Path,
    records_by_id: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if not out_root.exists():
        return {}
    successes: dict[str, dict[str, Any]] = {}
    for run_dir in sorted(path for path in out_root.iterdir() if path.is_dir()):
        if run_dir.resolve() == current_run_dir.resolve():
            continue
        config = read_run_config(run_dir)
        if config.get("mode") != "auto-full":
            continue
        for gall_num, record in recover_success_records_from_auto_run(run_dir, records_by_id).items():
            enriched = dict(record)
            enriched["_auto_reused"] = True
            enriched["_auto_reused_from_run"] = run_dir.name
            successes[gall_num] = enriched
    return successes


def read_run_config(run_dir: Path) -> dict[str, Any]:
    config_path = run_dir / "run_config.json"
    if not config_path.exists():
        return {}
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def recover_success_records_from_auto_run(
    run_dir: Path,
    records_by_id: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    successes: dict[str, dict[str, Any]] = {}
    for gall_num, record in read_success_jsonl(run_dir / "jsonl" / "extractions.jsonl", records_by_id).items():
        successes[gall_num] = record

    attempts_dir = run_dir / "attempts"
    if not attempts_dir.exists():
        return successes
    for attempt_dir in sorted(path for path in attempts_dir.iterdir() if path.is_dir()):
        manifest_path = attempt_dir / "batch_manifest.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for info in manifest.get("batches", []):
            recovered = recover_success_records_from_attempt_batch(attempt_dir, info)
            for gall_num, record in recovered.items():
                if gall_num in records_by_id:
                    successes[gall_num] = record
    return successes


def read_success_jsonl(path: Path, records_by_id: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    successes = {}
    try:
        records = parse_json_or_jsonl(path)
    except Exception:  # noqa: BLE001 - corrupt partial files should not block reuse
        return {}
    for record in records:
        gall_num = str(record.get("gall_num", "")).strip()
        if gall_num in records_by_id and not validate_extraction(record):
            successes[gall_num] = record
    return successes


def recover_success_records_from_attempt_batch(
    attempt_dir: Path,
    info: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    expected_gall_nums = [str(gall_num) for gall_num in info.get("gall_nums", [])]
    if not expected_gall_nums:
        return {}

    raw_path = attempt_dir / str(info.get("raw_path", ""))
    parsed_path = attempt_dir / str(info.get("parsed_path", ""))
    records: list[dict[str, Any]] | None = None
    pydantic_errors: list[str] = []

    if raw_path.exists():
        try:
            records, _strategy = parse_llm_response(read_text(raw_path))
            records, pydantic_errors = coerce_records_with_pydantic(records)
        except Exception:  # noqa: BLE001 - fall back to parsed artifact if present
            records = None
            pydantic_errors = []

    if records is None and parsed_path.exists():
        try:
            parsed = json.loads(parsed_path.read_text(encoding="utf-8"))
            records = normalize_parsed_records(parsed)
            records, pydantic_errors = coerce_records_with_pydantic(records)
        except Exception:  # noqa: BLE001 - ignore unrecoverable batch
            return {}

    if records is None:
        return {}

    split = split_batch_post_results(
        expected_gall_nums=expected_gall_nums,
        records=records,
        pydantic_errors=pydantic_errors,
        attempt_number=int(info.get("attempt_number", 0) or 0),
        batch_number=int(info.get("batch_number", 0) or 0),
    )
    return dict(split["succeeded_records"])


def build_auto_run_config(
    args: argparse.Namespace,
    run_id: str,
    run_dir: Path,
    records: list[Any],
) -> dict[str, Any]:
    return {
        "created_at": now_iso(),
        "mode": "auto-full",
        "source_csv": str(Path(args.csv)),
        "records_path": "jsonl/extractions.jsonl",
        "batch_size": args.batch_size,
        "max_concurrency": args.max_concurrency,
        "retry_batch_size": args.retry_batch_size,
        "final_batch_size": args.final_batch_size,
        "max_attempts": args.max_attempts,
        "seed": args.seed,
        "limit": args.limit,
        "selected_records": len(records),
        "dedupe_key": "gall_num",
        "run_id": run_id,
        "run_dir": str(run_dir),
        "prompt_limits": {
            "max_post_chars": args.max_post_chars,
            "max_comment_chars": args.max_comment_chars,
            "max_comments": args.max_comments,
        },
        "prompts": {
            "system_prompt": str(Path(args.system_prompt)),
            "user_template": str(Path(args.user_template)),
            "wrapper_prompt": str(Path(args.wrapper_prompt)),
        },
        "llm": asdict(build_llm_config(args)),
        "outputs": {
            "extractions_jsonl": "jsonl/extractions.jsonl",
            "failed_posts": "failures/failed_posts.jsonl",
            "summary": "summary.json",
            "events": "events.jsonl",
        },
    }


def auto_attempt_batch_size(args: argparse.Namespace, attempt_number: int) -> int:
    if attempt_number >= args.max_attempts:
        return args.final_batch_size
    if attempt_number == 1:
        return args.batch_size
    return args.retry_batch_size


def prepare_attempt_run(
    *,
    attempt_dir: Path,
    records: list[Any],
    args: argparse.Namespace,
    attempt_number: int,
    batch_size: int,
) -> list[dict[str, Any]]:
    ensure_run_dirs(attempt_dir)
    batch_infos = []
    batch_records = []

    with (attempt_dir / "records.jsonl").open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record.json_dict(), ensure_ascii=False) + "\n")

    for batch_number, start in enumerate(range(0, len(records), batch_size), start=1):
        batch = records[start : start + batch_size]
        prompt_items = [
            record.prompt_dict(
                max_post_chars=args.max_post_chars,
                max_comment_chars=args.max_comment_chars,
                max_comments=args.max_comments,
            )
            for record in batch
        ]
        batch_records.append(prompt_items)
        batch_infos.append(
            {
                "attempt_number": attempt_number,
                "batch_number": batch_number,
                "input_count": len(batch),
                "gall_nums": [record.gall_num for record in batch],
                "prompt_path": f"batches/batch_{batch_number:04d}.prompt.md",
                "input_path": f"batches/batch_{batch_number:04d}.input.md",
                "raw_path": f"raw/batch_{batch_number:04d}.response.txt",
                "parsed_path": f"parsed/batch_{batch_number:04d}.json",
                "validation_path": f"validation/batch_{batch_number:04d}.json",
                "error_path": f"errors/batch_{batch_number:04d}.json",
            }
        )

    total_batches = len(batch_infos)
    wrapper_path = Path(args.wrapper_prompt)
    for info, prompt_items in zip(batch_infos, batch_records, strict=True):
        prompt = render_batch_prompt(
            batch_records=prompt_items,
            batch_number=info["batch_number"],
            total_batches=total_batches,
            system_prompt_path=Path(args.system_prompt),
            user_template_path=Path(args.user_template),
        )
        write_text(attempt_dir / info["prompt_path"], prompt)
        write_text(attempt_dir / info["input_path"], wrap_prompt(prompt, wrapper_path))

    write_json(
        attempt_dir / "run_config.json",
        {
            "created_at": now_iso(),
            "mode": "auto-full-attempt",
            "attempt_number": attempt_number,
            "batch_size": batch_size,
            "max_concurrency": args.max_concurrency,
            "selected_records": len(records),
            "llm": asdict(build_llm_config(args)),
        },
    )
    write_json(attempt_dir / "batch_manifest.json", {"batches": batch_infos})
    return batch_infos


def process_attempt(
    *,
    attempt_dir: Path,
    batch_infos: list[dict[str, Any]],
    llm: Any,
    events_path: Path,
    attempt_number: int,
    max_concurrency: int = 1,
) -> dict[str, Any]:
    succeeded_records: dict[str, dict[str, Any]] = {}
    failed_posts: dict[str, dict[str, Any]] = {}
    events_lock = threading.Lock()
    results_lock = threading.Lock()

    def _run_one_batch(info: dict[str, Any]) -> None:
        batch_number = int(info["batch_number"])
        expected_gall_nums = list(info["gall_nums"])
        with events_lock:
            append_jsonl(
                events_path,
                {
                    "time": now_iso(),
                    "event": "attempt_batch_started",
                    "attempt_number": attempt_number,
                    "batch_number": batch_number,
                    "gall_nums": expected_gall_nums,
                },
            )
        started = time.perf_counter()
        try:
            raw = call_llm(llm, read_text(attempt_dir / info["input_path"]))
            write_text(attempt_dir / info["raw_path"], raw)
            records, strategy = parse_llm_response(raw)
            records, pydantic_errors = coerce_records_with_pydantic(records)
            write_json(attempt_dir / info["parsed_path"], records)
            report = validation_report(
                batch_number=batch_number,
                expected_gall_nums=expected_gall_nums,
                records=records,
                parse_strategy=strategy,
                pydantic_errors=pydantic_errors,
            )
            write_json(attempt_dir / info["validation_path"], report)
            split = split_batch_post_results(
                expected_gall_nums=expected_gall_nums,
                records=records,
                pydantic_errors=pydantic_errors,
                attempt_number=attempt_number,
                batch_number=batch_number,
            )
            with results_lock:
                succeeded_records.update(split["succeeded_records"])
                failed_posts.update(split["failed_posts"])
            duration = round(time.perf_counter() - started, 3)
            if split["failed_posts"] or split["unexpected_gall_nums"]:
                write_json(
                    attempt_dir / info["error_path"],
                    {
                        "error": "post_validation_failed",
                        "attempt_number": attempt_number,
                        "batch_number": batch_number,
                        "failed_gall_nums": sorted(split["failed_posts"]),
                        "unexpected_gall_nums": split["unexpected_gall_nums"],
                        "validation": report,
                    },
                )
            with events_lock:
                append_jsonl(
                    events_path,
                    {
                        "time": now_iso(),
                        "event": "attempt_batch_completed",
                        "attempt_number": attempt_number,
                        "batch_number": batch_number,
                        "duration_seconds": duration,
                        "succeeded_count": len(split["succeeded_records"]),
                        "failed_count": len(split["failed_posts"]),
                        "unexpected_count": len(split["unexpected_gall_nums"]),
                    },
                )
        except Exception as exc:  # noqa: BLE001 - continue with later batches
            duration = round(time.perf_counter() - started, 3)
            failure_payload = {
                "error": type(exc).__name__,
                "message": str(exc),
                "attempt_number": attempt_number,
                "batch_number": batch_number,
                "duration_seconds": duration,
                "gall_nums": expected_gall_nums,
            }
            write_json(attempt_dir / info["error_path"], failure_payload)
            with results_lock:
                for gall_num in expected_gall_nums:
                    failed_posts[gall_num] = {
                        "gall_num": gall_num,
                        "attempt_number": attempt_number,
                        "batch_number": batch_number,
                        "reason": type(exc).__name__,
                        "message": str(exc),
                    }
            with events_lock:
                append_jsonl(events_path, {"time": now_iso(), "event": "attempt_batch_failed", **failure_payload})

    progress = Progress(
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=CONSOLE,
    )
    with progress:
        task = progress.add_task(f"attempt {attempt_number}", total=len(batch_infos))
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrency) as pool:
            futures = [pool.submit(_run_one_batch, info) for info in batch_infos]
            for fut in concurrent.futures.as_completed(futures):
                fut.result()
                progress.advance(task)

    return {
        "succeeded_records": succeeded_records,
        "failed_posts": failed_posts,
    }


def split_batch_post_results(
    *,
    expected_gall_nums: list[str],
    records: list[dict[str, Any]],
    pydantic_errors: list[str],
    attempt_number: int,
    batch_number: int,
) -> dict[str, Any]:
    by_gall_num: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    unexpected_gall_nums = []
    expected_set = set(expected_gall_nums)
    pydantic_error_indexes = parse_pydantic_error_indexes(pydantic_errors)

    for index, record in enumerate(records):
        gall_num = str(record.get("gall_num", "")).strip()
        if gall_num in expected_set:
            by_gall_num[gall_num].append((index, record))
        else:
            unexpected_gall_nums.append(gall_num or f"index:{index}")

    succeeded_records: dict[str, dict[str, Any]] = {}
    failed_posts: dict[str, dict[str, Any]] = {}
    for gall_num in expected_gall_nums:
        matches = by_gall_num.get(gall_num, [])
        if not matches:
            failed_posts[gall_num] = post_failure(gall_num, attempt_number, batch_number, "missing_from_response")
            continue
        if len(matches) > 1:
            failed_posts[gall_num] = post_failure(gall_num, attempt_number, batch_number, "duplicate_in_response")
            continue

        index, record = matches[0]
        errors = validate_extraction(record)
        if index in pydantic_error_indexes:
            errors.append("pydantic validation failed")
        if errors:
            failed_posts[gall_num] = post_failure(
                gall_num,
                attempt_number,
                batch_number,
                "invalid_record",
                errors=errors,
            )
            continue
        succeeded_records[gall_num] = record

    return {
        "succeeded_records": succeeded_records,
        "failed_posts": failed_posts,
        "unexpected_gall_nums": unexpected_gall_nums,
    }


def parse_pydantic_error_indexes(errors: list[str]) -> set[int]:
    indexes = set()
    for error in errors:
        match = re.match(r"item (\d+):", error)
        if match:
            indexes.add(int(match.group(1)))
    return indexes


def post_failure(
    gall_num: str,
    attempt_number: int,
    batch_number: int,
    reason: str,
    *,
    errors: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "gall_num": gall_num,
        "attempt_number": attempt_number,
        "batch_number": batch_number,
        "reason": reason,
    }
    if errors:
        payload["errors"] = errors
    return payload


def write_auto_outputs(
    *,
    run_dir: Path,
    source_records: list[Any],
    completed_records: dict[str, dict[str, Any]],
    remaining_ids: list[str],
    attempt_reports: list[dict[str, Any]],
    last_failures: dict[str, dict[str, Any]],
    complete: bool,
    reused_record_count: int,
) -> dict[str, Any]:
    output_jsonl = run_dir / "jsonl" / "extractions.jsonl"
    output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with output_jsonl.open("w", encoding="utf-8") as handle:
        for source_record in source_records:
            record = completed_records.get(source_record.gall_num)
            if record:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    failed_path = run_dir / "failures" / "failed_posts.jsonl"
    failed_path.parent.mkdir(parents=True, exist_ok=True)
    with failed_path.open("w", encoding="utf-8") as handle:
        for gall_num in remaining_ids:
            failure = last_failures.get(gall_num) or {"gall_num": gall_num, "reason": "not_attempted"}
            handle.write(json.dumps(failure, ensure_ascii=False) + "\n")

    summary = {
        "run_dir": str(run_dir),
        "updated_at": now_iso(),
        "mode": "auto-full",
        "complete": complete,
        "total_record_count": len(source_records),
        "completed_record_count": len(completed_records),
        "reused_record_count": reused_record_count,
        "newly_completed_record_count": len(completed_records) - reused_record_count,
        "failed_record_count": len(remaining_ids),
        "failed_gall_nums": remaining_ids,
        "attempt_count": len(attempt_reports),
        "attempts": attempt_reports,
        "record_count": len(completed_records),
        "extractions_jsonl": str(output_jsonl),
        "failed_posts_jsonl": str(failed_path),
    }
    write_json(run_dir / "summary.json", summary)
    return summary


def command_resume(args: argparse.Namespace) -> int:
    return process_run(
        Path(args.run_dir),
        failed_only=not args.all_batches,
        batch_numbers=parse_batch_numbers(args.only_batches),
    )


def command_validate_run(args: argparse.Namespace) -> int:
    summary = consolidate_run(Path(args.run_dir))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if summary["failed_batch_numbers"] else 0


def parse_batch_numbers(value: str | None) -> set[int] | None:
    if not value:
        return None
    numbers: set[int] = set()
    for part in value.split(","):
        item = part.strip()
        if not item:
            continue
        if "-" in item:
            start, end = item.split("-", 1)
            numbers.update(range(int(start), int(end) + 1))
        else:
            numbers.add(int(item))
    return numbers


def add_common_run_args(
    parser: argparse.ArgumentParser,
    *,
    sample_default: int | None,
    batch_size_default: int = 20,
    include_sample_size: bool = True,
    include_batch_selector: bool = True,
) -> None:
    parser.add_argument("--csv", default=str(DEFAULT_CSV))
    parser.add_argument("--out-root", default=str(DEFAULT_OUT_ROOT))
    parser.add_argument("--run-id", default=None)
    if include_sample_size:
        parser.add_argument("--sample-size", type=int, default=sample_default)
    parser.add_argument("--seed", type=int, default=20260523)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", dest="batch_size", type=int, default=batch_size_default)
    parser.add_argument("--max-post-chars", type=int, default=1800)
    parser.add_argument("--max-comment-chars", type=int, default=900)
    parser.add_argument("--max-comments", type=int, default=30)
    parser.add_argument("--system-prompt", default=str(DEFAULT_SYSTEM_PROMPT))
    parser.add_argument("--user-template", default=str(DEFAULT_USER_TEMPLATE))
    parser.add_argument("--wrapper-prompt", default=str(DEFAULT_WRAPPER_PROMPT))
    parser.add_argument("--base-url", default=env_value("QA_WIKI_BASE_URL", "http://localhost:8000/v1"))
    parser.add_argument("--model", default=env_value("QA_WIKI_MODEL", "leon-se/gemma-4-E4B-it-FP8-Dynamic"))
    parser.add_argument("--api-key", default=env_value("QA_WIKI_API_KEY", "local"))
    parser.add_argument("--temperature", type=float, default=float(env_value("QA_WIKI_TEMPERATURE", "0.1")))
    parser.add_argument("--max-tokens", type=int, default=int(env_value("QA_WIKI_MAX_TOKENS", "2048")))
    parser.add_argument("--timeout", type=float, default=float(env_value("QA_WIKI_TIMEOUT", "120")))
    parser.add_argument("--max-retries", type=int, default=int(env_value("QA_WIKI_MAX_RETRIES", "1")))
    parser.add_argument(
        "--max-concurrency",
        dest="max_concurrency",
        type=int,
        default=int(env_value("QA_WIKI_MAX_CONCURRENCY", "1")),
        help="Max in-flight LLM requests per batch loop (default 1 = sequential)",
    )
    if include_batch_selector:
        parser.add_argument("--only-batches", default=None, help="Comma/range list, e.g. 1,3,8-10")
    parser.add_argument("--prepare-only", action="store_true", help="Render run artifacts without calling the LLM")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run QA wiki extraction with LangChain.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sample = subparsers.add_parser("sample", help="Run a prompt-engineering sample extraction")
    add_common_run_args(sample, sample_default=20)
    sample.set_defaults(func=command_sample)

    full = subparsers.add_parser("full", help="Run extraction for the full CSV")
    add_common_run_args(full, sample_default=None)
    full.set_defaults(func=command_full)

    auto_full = subparsers.add_parser(
        "auto-full",
        help="Run full extraction with gall_num-level retries and no duplicate reprocessing",
    )
    add_common_run_args(
        auto_full,
        sample_default=None,
        batch_size_default=4,
        include_sample_size=False,
        include_batch_selector=False,
    )
    auto_full.add_argument("--max-attempts", type=int, default=4)
    auto_full.add_argument("--retry-batch-size", type=int, default=2)
    auto_full.add_argument("--final-batch-size", type=int, default=1)
    auto_full.add_argument(
        "--ignore-existing",
        action="store_true",
        help="Do not reuse successful gall_num records from previous auto-full runs",
    )
    auto_full.set_defaults(func=command_auto_full)

    resume = subparsers.add_parser("resume", help="Resume failed or incomplete batches in a run directory")
    resume.add_argument("--run-dir", required=True)
    resume.add_argument("--all-batches", action="store_true", help="Re-run every selected batch, including valid ones")
    resume.add_argument("--only-batches", default=None, help="Comma/range list, e.g. 1,3,8-10")
    resume.set_defaults(func=command_resume)

    validate = subparsers.add_parser("validate-run", help="Rebuild run JSONL and summary from parsed batches")
    validate.add_argument("--run-dir", required=True)
    validate.set_defaults(func=command_validate_run)
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv(REPO_ROOT / ".env")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        CONSOLE.print("[red]Interrupted[/]")
        return 130
    except Exception as exc:  # noqa: BLE001 - CLI top-level error report
        CONSOLE.print(f"[red]error:[/] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
