#!/usr/bin/env python3
"""Prepare board Q&A data for SLM extraction and wiki drafting.

This script intentionally uses only the Python standard library so it can run
inside this lightweight data repository without dependency setup.
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
import random
import re
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SYSTEM_PROMPT = REPO_ROOT / "prompts" / "wiki_qa_extraction_system.md"
DEFAULT_USER_TEMPLATE = REPO_ROOT / "prompts" / "wiki_qa_extraction_user_template.md"

EXPECTED_CSV_FIELDS = [
    "gall_num",
    "title",
    "post",
    "comments",
    "view_count",
    "recommend_count",
    "date_full",
    "url",
]

QUESTION_TYPES = {
    "설정해석",
    "시청순서",
    "작품관계",
    "캐릭터/사건",
    "게임/플랫폼",
    "번역/한글패치",
    "OST/자료",
    "기타",
}
SPOILER_LEVELS = {"none", "early_story", "main_story", "zero_story", "endgame"}
WIKI_ACTIONS = {
    "merge_into_concept_faq",
    "create_new_concept_candidate",
    "discard_low_value",
    "needs_human_review",
}
ANSWER_STATUSES = {"answered", "partial", "unanswered", "conflicting"}
CONFIDENCE_LEVELS = {"low", "medium", "high"}

CONCEPT_CATALOG: dict[str, dict[str, Any]] = {
    "worldline": {
        "label": "세계선",
        "keywords": ["세계선", "다이버전스", "분기", "변동률", "멀티버스", "가능성 세계"],
    },
    "attractor_field": {
        "label": "어트랙터 필드와 수속",
        "keywords": ["어트랙터", "수속", "알파", "베타", "슈타인즈 게이트 세계선"],
    },
    "reading_steiner": {
        "label": "리딩 슈타이너",
        "keywords": ["리딩 슈타이너", "리딩", "기억", "세계선 기억"],
    },
    "dmail": {
        "label": "D메일",
        "keywords": ["D메일", "디메일", "d메일", "문자", "메일", "에슐론"],
    },
    "time_leap": {
        "label": "타임리프와 타임리프 머신",
        "keywords": ["타임리프", "타임리프머신", "타임 리프", "타임리프 머신"],
    },
    "phonewave": {
        "label": "전화렌지와 시간 이동 장치",
        "keywords": ["전화렌지", "전화레인지", "폰웨이브", "120초", "154152"],
    },
    "time_machine": {
        "label": "타임머신",
        "keywords": ["타임머신", "C204", "과거로", "미래에서"],
    },
    "sern_rounder": {
        "label": "SERN과 라운더",
        "keywords": ["SERN", "세른", "라운더", "FB", "모에카", "습격", "에슐론"],
    },
    "zero_23b": {
        "label": "슈타인즈 게이트 제로와 23.5화",
        "keywords": ["제로", "23.5", "23b", "23화", "베타화", "따귀"],
    },
    "movie_mail": {
        "label": "무비메일과 오퍼레이션 스쿨드",
        "keywords": ["무비메일", "영상메일", "동영상", "스쿨드", "2025"],
    },
    "viewing_order": {
        "label": "시청 및 플레이 순서",
        "keywords": ["순서", "먼저", "입문", "재탕", "정주행", "극장판", "OVA", "봐야"],
    },
    "ibn5100": {
        "label": "IBN5100",
        "keywords": ["IBN", "IBN5100", "5100", "신사", "컴퓨터"],
    },
    "platform_patch": {
        "label": "게임 구매와 한글패치",
        "keywords": ["스팀", "PS4", "플스", "안드로이드", "한글패치", "한패", "코드", "게임"],
    },
    "ost_media": {
        "label": "OST와 관련 자료",
        "keywords": ["브금", "OST", "ost", "노래", "음악", "링크"],
    },
    "character_events": {
        "label": "캐릭터와 사건 해석",
        "keywords": [
            "오카베",
            "크리스",
            "마유리",
            "스즈하",
            "루카",
            "페이리스",
            "모에카",
            "카가리",
            "레스키넨",
        ],
    },
}

QUESTION_TYPE_CONCEPTS = {
    "viewing_order": "시청순서",
    "platform_patch": "게임/플랫폼",
    "ost_media": "OST/자료",
}

# concept_id 정규화 후 표준 catalog ID로 흡수하기 위한 alias 매핑.
# 우변(타겟)은 CONCEPT_CATALOG에 존재하는 ID여야만 활성화된다.
# 미존재 타겟은 빌드 시점에 _filter_concept_aliases가 제거하고 경고를 찍는다.
_CONCEPT_ALIASES_RAW: dict[str, str] = {
    "amadeus_system": "amadeus",
    "merch_info": "merchandise",
    "merchandise_buying": "merchandise",
    "media_merchandise": "merchandise",
    "novel_media": "media",
    "media_supplementary": "media",
    "media_relation": "media",
    "media_identification": "media",
    "other_media": "media",
    "other_media_franchise": "media",
    "spin_off_media": "media",
    "franchise_status": "franchise_news",
    "series_production": "franchise_news",
    "sciadv_series": "science_adventure_series",
    "real_world_locations": "real_world_pilgrimage",
    "real_world_physics": "general_physics",
    "robotics_notes_characters": "other_works",
    "noah_eye": "character_events",
    "chaos_head_setting": "other_works",
    "hiyoku_rene": "other_works",
    "occultic_nine": "other_works",
    "media_franchise": "franchise_news",
    "media_industry": "game_industry",
    "media_business": "game_industry",
}


def _filter_concept_aliases(raw: dict[str, str]) -> tuple[dict[str, str], list[tuple[str, str]]]:
    valid: dict[str, str] = {}
    dropped: list[tuple[str, str]] = []
    for alias, target in raw.items():
        if target in CONCEPT_CATALOG:
            valid[alias] = target
        else:
            dropped.append((alias, target))
    return valid, dropped


CONCEPT_ALIASES, _DROPPED_CONCEPT_ALIASES = _filter_concept_aliases(_CONCEPT_ALIASES_RAW)
if _DROPPED_CONCEPT_ALIASES:
    print(
        "warning: dropped concept aliases whose targets are not in CONCEPT_CATALOG: "
        + ", ".join(f"{alias}->{target}" for alias, target in _DROPPED_CONCEPT_ALIASES),
        file=sys.stderr,
    )

CONCEPT_PRIORITY = {
    "dmail": 0,
    "time_leap": 0,
    "phonewave": 0,
    "time_machine": 0,
    "worldline": 1,
    "attractor_field": 1,
    "reading_steiner": 1,
    "zero_23b": 1,
    "movie_mail": 1,
    "sern_rounder": 1,
    "ibn5100": 1,
    "viewing_order": 2,
    "platform_patch": 2,
    "ost_media": 2,
    "character_events": 9,
}


@dataclass(frozen=True)
class PostRecord:
    gall_num: str
    title: str
    post: str
    comments: list[str]
    view_count: str
    recommend_count: str
    date_full: str
    url: str

    def prompt_dict(
        self,
        *,
        max_post_chars: int | None,
        max_comment_chars: int | None,
        max_comments: int | None,
    ) -> dict[str, Any]:
        post, post_truncated = truncate_text(self.post, max_post_chars)
        comments = self.comments
        omitted_comments_count = 0
        if max_comments is not None and len(comments) > max_comments:
            omitted_comments_count = len(comments) - max_comments
            comments = comments[:max_comments]

        prompt_comments = []
        truncated_comment_indexes = []
        for index, comment in enumerate(comments):
            value, truncated = truncate_text(comment, max_comment_chars)
            if truncated:
                truncated_comment_indexes.append(index)
            prompt_comments.append(value)

        return {
            "gall_num": self.gall_num,
            "title": self.title,
            "post": post,
            "comments": prompt_comments,
            "date_full": self.date_full,
            "url": self.url,
            "metadata": {
                "view_count": self.view_count,
                "recommend_count": self.recommend_count,
                "post_truncated": post_truncated,
                "truncated_comment_indexes": truncated_comment_indexes,
                "omitted_comments_count": omitted_comments_count,
            },
        }

    def json_dict(self) -> dict[str, Any]:
        return {
            "gall_num": self.gall_num,
            "title": self.title,
            "post": self.post,
            "comments": self.comments,
            "view_count": self.view_count,
            "recommend_count": self.recommend_count,
            "date_full": self.date_full,
            "url": self.url,
        }


def normalize_space(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def truncate_text(value: str, limit: int | None) -> tuple[str, bool]:
    if limit is None or limit <= 0 or len(value) <= limit:
        return value, False
    suffix = "\n[TRUNCATED]"
    keep = max(0, limit - len(suffix))
    return value[:keep].rstrip() + suffix, True


def parse_comments(value: str, *, gall_num: str) -> list[str]:
    if not value.strip():
        return []
    try:
        parsed = ast.literal_eval(value)
    except Exception as exc:  # pragma: no cover - defensive error message path
        raise ValueError(f"comments parse failed for gall_num={gall_num}: {exc}") from exc
    if not isinstance(parsed, list):
        raise ValueError(f"comments must be a list for gall_num={gall_num}")
    return [normalize_space(item) for item in parsed if normalize_space(item)]


def load_posts(csv_path: Path) -> list[PostRecord]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != EXPECTED_CSV_FIELDS:
            raise ValueError(
                "Unexpected CSV fields: "
                f"{reader.fieldnames!r}; expected {EXPECTED_CSV_FIELDS!r}"
            )
        records = []
        for row in reader:
            gall_num = normalize_space(row["gall_num"])
            records.append(
                PostRecord(
                    gall_num=gall_num,
                    title=normalize_space(row["title"]),
                    post=normalize_space(row["post"]),
                    comments=parse_comments(row["comments"], gall_num=gall_num),
                    view_count=normalize_space(row["view_count"]),
                    recommend_count=normalize_space(row["recommend_count"]),
                    date_full=normalize_space(row["date_full"]),
                    url=normalize_space(row["url"]),
                )
            )
    return records


def select_records(
    records: list[PostRecord],
    *,
    sample_size: int | None,
    seed: int,
    limit: int | None,
) -> list[PostRecord]:
    selected = records
    if sample_size is not None:
        if sample_size > len(records):
            raise ValueError(f"sample_size={sample_size} exceeds row count={len(records)}")
        rng = random.Random(seed)
        selected = rng.sample(records, sample_size)
    if limit is not None:
        selected = selected[:limit]
    return selected


def chunked(items: list[Any], batch_size: int) -> Iterable[list[Any]]:
    for index in range(0, len(items), batch_size):
        yield items[index : index + batch_size]


def read_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def concept_catalog_markdown() -> str:
    lines = []
    for concept_id, item in CONCEPT_CATALOG.items():
        keywords = ", ".join(item["keywords"])
        lines.append(f"- `{concept_id}`: {item['label']} ({keywords})")
    return "\n".join(lines)


def render_batch_prompt(
    *,
    batch_records: list[dict[str, Any]],
    batch_number: int,
    total_batches: int,
    system_prompt_path: Path,
    user_template_path: Path,
) -> str:
    system_prompt = read_prompt(system_prompt_path)
    user_template = read_prompt(user_template_path)
    input_json = json.dumps(batch_records, ensure_ascii=False, indent=2)
    return (
        f"{system_prompt}\n\n"
        "## Concept Catalog\n"
        f"{concept_catalog_markdown()}\n\n"
        f"## Batch\n- batch_number: {batch_number}\n- total_batches: {total_batches}\n"
        f"- input_count: {len(batch_records)}\n\n"
        f"{user_template}\n\n"
        "## INPUT\n"
        "```json\n"
        f"{input_json}\n"
        "```\n"
    )


def command_prepare(args: argparse.Namespace) -> int:
    csv_path = Path(args.csv_path)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    batch_dir = out_dir / "batches"
    batch_dir.mkdir(parents=True, exist_ok=True)

    all_records = load_posts(csv_path)
    selected = select_records(
        all_records,
        sample_size=args.sample_size,
        seed=args.seed,
        limit=args.limit,
    )
    if not selected:
        raise ValueError("No records selected")

    prompt_records = [
        record.prompt_dict(
            max_post_chars=args.max_post_chars,
            max_comment_chars=args.max_comment_chars,
            max_comments=args.max_comments,
        )
        for record in selected
    ]

    records_jsonl = out_dir / "records.jsonl"
    with records_jsonl.open("w", encoding="utf-8") as handle:
        for record in selected:
            handle.write(json.dumps(record.json_dict(), ensure_ascii=False) + "\n")

    batches = list(chunked(prompt_records, args.batch_size))
    for batch_index, batch in enumerate(batches, start=1):
        prompt = render_batch_prompt(
            batch_records=batch,
            batch_number=batch_index,
            total_batches=len(batches),
            system_prompt_path=Path(args.system_prompt),
            user_template_path=Path(args.user_template),
        )
        (batch_dir / f"batch_{batch_index:04d}.md").write_text(prompt, encoding="utf-8")

    manifest = build_manifest(
        csv_path=csv_path,
        records=selected,
        total_records=len(all_records),
        args=args,
        batch_count=len(batches),
    )
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"selected_records={len(selected)}")
    print(f"batch_count={len(batches)}")
    print(f"records_jsonl={records_jsonl}")
    print(f"manifest={manifest_path}")
    print(f"batch_dir={batch_dir}")
    return 0


def build_manifest(
    *,
    csv_path: Path,
    records: list[PostRecord],
    total_records: int,
    args: argparse.Namespace,
    batch_count: int,
) -> dict[str, Any]:
    post_lengths = [len(record.post) for record in records]
    comment_counts = [len(record.comments) for record in records]
    total_comment_lengths = [sum(len(comment) for comment in record.comments) for record in records]
    return {
        "source_csv": str(csv_path),
        "source_total_records": total_records,
        "selected_records": len(records),
        "sample_size": args.sample_size,
        "seed": args.seed,
        "limit": args.limit,
        "batch_size": args.batch_size,
        "batch_count": batch_count,
        "prompt_limits": {
            "max_post_chars": args.max_post_chars,
            "max_comment_chars": args.max_comment_chars,
            "max_comments": args.max_comments,
        },
        "stats": {
            "post_chars": numeric_summary(post_lengths),
            "comments_per_post": numeric_summary(comment_counts),
            "comment_chars_per_post": numeric_summary(total_comment_lengths),
        },
        "concept_catalog": {
            concept_id: {
                "label": item["label"],
                "keywords": item["keywords"],
            }
            for concept_id, item in CONCEPT_CATALOG.items()
        },
    }


def numeric_summary(values: list[int]) -> dict[str, float | int | None]:
    if not values:
        return {"min": None, "p50": None, "mean": None, "p90": None, "max": None}
    sorted_values = sorted(values)
    p90_index = min(len(sorted_values) - 1, int(len(sorted_values) * 0.9))
    return {
        "min": sorted_values[0],
        "p50": statistics.median(sorted_values),
        "mean": round(statistics.mean(sorted_values), 2),
        "p90": sorted_values[p90_index],
        "max": sorted_values[-1],
    }


def parse_json_or_jsonl(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    text = strip_markdown_json_fence(text)
    first = text.lstrip()[:1]
    if first in {"[", "{"}:
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return require_dicts(parsed, path)
        if isinstance(parsed, dict):
            for key in ("records", "items", "extractions", "data"):
                if isinstance(parsed.get(key), list):
                    return require_dicts(parsed[key], path)
            return [parsed]
        if first == "[":
            raise ValueError(f"Invalid JSON array in {path}")

    records = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            item = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSONL at {path}:{line_number}: {exc}") from exc
        if not isinstance(item, dict):
            raise ValueError(f"JSONL item must be an object at {path}:{line_number}")
        records.append(item)
    return records


def strip_markdown_json_fence(text: str) -> str:
    stripped = text.strip()
    fence_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.S)
    if fence_match:
        return fence_match.group(1).strip()
    return stripped


def require_dicts(items: list[Any], path: Path) -> list[dict[str, Any]]:
    records = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"Item {index} in {path} is {type(item).__name__}, not object")
        records.append(item)
    return records


def validate_extraction(record: dict[str, Any]) -> list[str]:
    errors = []
    required = [
        "gall_num",
        "source_url",
        "title_clean",
        "question_intent",
        "question_type",
        "canonical_keywords",
        "raw_keywords",
        "concept_candidates",
        "entities",
        "answer_candidate",
        "spoiler_level",
        "wiki_action",
        "needs_human_review",
    ]
    for field in required:
        if field not in record:
            errors.append(f"missing field: {field}")

    if record.get("question_type") not in QUESTION_TYPES:
        errors.append(f"invalid question_type: {record.get('question_type')!r}")
    if record.get("spoiler_level") not in SPOILER_LEVELS:
        errors.append(f"invalid spoiler_level: {record.get('spoiler_level')!r}")
    if record.get("wiki_action") not in WIKI_ACTIONS:
        errors.append(f"invalid wiki_action: {record.get('wiki_action')!r}")
    if not isinstance(record.get("canonical_keywords"), list):
        errors.append("canonical_keywords must be a list")
    if not isinstance(record.get("raw_keywords"), list):
        errors.append("raw_keywords must be a list")
    if not isinstance(record.get("concept_candidates"), list):
        errors.append("concept_candidates must be a list")
    if not isinstance(record.get("entities"), dict):
        errors.append("entities must be an object")
    if not isinstance(record.get("needs_human_review"), bool):
        errors.append("needs_human_review must be boolean")

    answer = record.get("answer_candidate")
    if not isinstance(answer, dict):
        errors.append("answer_candidate must be an object")
    else:
        if answer.get("status") not in ANSWER_STATUSES:
            errors.append(f"invalid answer_candidate.status: {answer.get('status')!r}")
        if answer.get("confidence") not in CONFIDENCE_LEVELS:
            errors.append(f"invalid answer_candidate.confidence: {answer.get('confidence')!r}")
        if not isinstance(answer.get("evidence_comment_indexes", []), list):
            errors.append("answer_candidate.evidence_comment_indexes must be a list")

    for index, candidate in enumerate(record.get("concept_candidates") or []):
        if not isinstance(candidate, dict):
            errors.append(f"concept_candidates[{index}] must be an object")
            continue
        if not candidate.get("concept_id"):
            errors.append(f"concept_candidates[{index}].concept_id is required")
        if candidate.get("relation") not in {"primary", "secondary"}:
            errors.append(f"concept_candidates[{index}].relation must be primary or secondary")
    return errors


ENTITY_ALLOWED_KEYS = {"characters", "organizations", "media"}


def validate_extraction_warnings(record: dict[str, Any]) -> list[str]:
    """초경량 추가 검증. 기존 valid record 흐름을 깨지 않도록 warning-only.

    검증 항목:
      1) primary_count_invalid: concept_candidates 중 relation=="primary" 개수 != 1
      2) evidence_index_negative: answer_candidate.evidence_comment_indexes 에 음수/비정수
      3) entities_unknown_keys: entities dict 키가 {characters, organizations, media} 부분집합 아님
    """
    warnings: list[str] = []

    candidates = record.get("concept_candidates")
    if isinstance(candidates, list):
        primary_count = sum(
            1 for candidate in candidates
            if isinstance(candidate, dict) and candidate.get("relation") == "primary"
        )
        if primary_count != 1:
            warnings.append(f"primary_count_invalid: {primary_count}")

    answer = record.get("answer_candidate")
    if isinstance(answer, dict):
        evidence = answer.get("evidence_comment_indexes")
        if isinstance(evidence, list):
            for index_position, value in enumerate(evidence):
                if not isinstance(value, int) or isinstance(value, bool):
                    warnings.append(f"evidence_index_not_int[{index_position}]: {value!r}")
                    continue
                if value < 0:
                    warnings.append(f"evidence_index_negative[{index_position}]: {value}")

    entities = record.get("entities")
    if isinstance(entities, dict):
        unknown_keys = sorted(key for key in entities if key not in ENTITY_ALLOWED_KEYS)
        if unknown_keys:
            warnings.append(f"entities_unknown_keys: {unknown_keys}")

    return warnings


def command_validate(args: argparse.Namespace) -> int:
    input_path = Path(args.input_path)
    records = parse_json_or_jsonl(input_path)
    source_ids = set()
    if args.source_csv:
        source_ids = {record.gall_num for record in load_posts(Path(args.source_csv))}

    strict = bool(getattr(args, "strict", False))
    errors_by_id: dict[str, list[str]] = {}
    warnings_by_id: dict[str, list[str]] = {}
    primary_invalid_gall_nums: list[str] = []
    entities_warning_gall_nums: list[str] = []
    evidence_warning_gall_nums: list[str] = []
    duplicate_counter = Counter()
    for index, record in enumerate(records):
        gall_num = str(record.get("gall_num", f"index:{index}"))
        duplicate_counter[gall_num] += 1
        errors = validate_extraction(record)
        if source_ids and gall_num not in source_ids:
            errors.append("gall_num not found in source_csv")
        warnings = validate_extraction_warnings(record)
        if warnings:
            warnings_by_id[gall_num] = warnings
            for warning in warnings:
                if warning.startswith("primary_count_invalid"):
                    primary_invalid_gall_nums.append(gall_num)
                elif warning.startswith("entities_unknown_keys"):
                    entities_warning_gall_nums.append(gall_num)
                elif warning.startswith("evidence_index"):
                    evidence_warning_gall_nums.append(gall_num)
        if strict:
            errors.extend(warnings)
        if errors:
            errors_by_id[gall_num] = errors

    duplicates = sorted([gall_num for gall_num, count in duplicate_counter.items() if count > 1])
    report = {
        "input_path": str(input_path),
        "record_count": len(records),
        "valid_count": len(records) - len(errors_by_id),
        "error_count": len(errors_by_id),
        "warning_count": len(warnings_by_id),
        "strict": strict,
        "duplicate_gall_nums": duplicates,
        "errors_by_gall_num": errors_by_id,
        "warnings_by_gall_num": warnings_by_id,
        "primary_invalid_gall_nums": sorted(set(primary_invalid_gall_nums)),
        "entities_warning_gall_nums": sorted(set(entities_warning_gall_nums)),
        "evidence_warning_gall_nums": sorted(set(evidence_warning_gall_nums)),
    }
    if args.report:
        Path(args.report).write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors_by_id or duplicates else 0


def command_group(args: argparse.Namespace) -> int:
    input_path = Path(args.input_path)
    out_dir = Path(args.out_dir)
    records = parse_json_or_jsonl(input_path)
    if args.validate:
        invalid = invalid_records_by_id(records)
        if invalid:
            raise ValueError(f"Cannot group invalid extractions: {json.dumps(invalid, ensure_ascii=False)}")

    stats = write_grouped_wiki(records, out_dir, clean=args.clean)
    print(f"group_count={stats['group_count']}")
    print(f"record_count={stats['record_count']}")
    print(f"out_dir={out_dir}")
    return 0


def command_group_runs(args: argparse.Namespace) -> int:
    runs_root = Path(args.runs_root)
    out_dir = Path(args.out_dir)
    merged_jsonl = Path(args.merged_jsonl) if args.merged_jsonl else out_dir / "extractions.merged.jsonl"
    report_path = Path(args.report) if args.report else out_dir / "merge_report.json"

    selected_runs = discover_extraction_runs(
        runs_root,
        include_runs=parse_name_filter(args.include_runs),
        exclude_runs=parse_name_filter(args.exclude_runs),
    )
    merged_records, report = merge_run_extractions(selected_runs, validate=args.validate)
    if not merged_records:
        raise ValueError(f"No valid extraction records found under {runs_root}")

    merged_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with merged_jsonl.open("w", encoding="utf-8") as handle:
        for record in merged_records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    stats = write_grouped_wiki(merged_records, out_dir, clean=args.clean)
    report.update(
        {
            "generated_at": now_iso(),
            "runs_root": str(runs_root),
            "out_dir": str(out_dir),
            "merged_jsonl": str(merged_jsonl),
            "report_path": str(report_path),
            "group_count": stats["group_count"],
            "record_count": stats["record_count"],
        }
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"run_count={report['run_count']}")
    print(f"source_record_count={report['source_record_count']}")
    print(f"deduped_record_count={report['record_count']}")
    print(f"duplicate_gall_num_count={len(report['duplicate_gall_nums'])}")
    print(f"group_count={stats['group_count']}")
    print(f"out_dir={out_dir}")
    print(f"merged_jsonl={merged_jsonl}")
    print(f"report={report_path}")
    return 0


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def invalid_records_by_id(records: list[dict[str, Any]]) -> dict[str, list[str]]:
    invalid = {str(record.get("gall_num")): validate_extraction(record) for record in records}
    return {key: value for key, value in invalid.items() if value}


def write_grouped_wiki(records: list[dict[str, Any]], out_dir: Path, *, clean: bool) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    misc_dir = out_dir / "_misc"
    if clean:
        for old_markdown in out_dir.glob("*.md"):
            old_markdown.unlink()
        if misc_dir.exists():
            for old_markdown in misc_dir.glob("*.md"):
                old_markdown.unlink()

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        group_id = primary_concept_id(record)
        groups[group_id].append(record)

    index_rows: list[dict[str, Any]] = []
    misc_count = 0
    for group_id in sorted(groups):
        group_records = sorted(groups[group_id], key=lambda item: str(item.get("gall_num", "")))
        label = concept_label(group_id, group_records)
        is_catalog = group_id in CONCEPT_CATALOG
        slug = safe_slug(group_id)
        if is_catalog:
            filename = f"{slug}.md"
            output_path = out_dir / filename
            link_path = filename
        else:
            misc_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{slug}.md"
            output_path = misc_dir / filename
            link_path = f"_misc/{filename}"
            misc_count += 1
        output_path.write_text(render_wiki_group(label, group_id, group_records), encoding="utf-8")
        index_rows.append(
            {
                "concept_id": group_id,
                "label": label,
                "count": len(group_records),
                "path": link_path,
                "is_catalog": is_catalog,
                "review_count": sum(1 for item in group_records if item.get("needs_human_review")),
            }
        )

    index_markdown = render_index(index_rows)
    (out_dir / "index.md").write_text(index_markdown, encoding="utf-8")
    return {
        "group_count": len(groups),
        "record_count": len(records),
        "catalog_group_count": sum(1 for row in index_rows if row.get("is_catalog")),
        "misc_group_count": misc_count,
    }


def parse_name_filter(value: str | None) -> set[str] | None:
    if not value:
        return None
    names = {item.strip() for item in value.split(",") if item.strip()}
    return names or None


def discover_extraction_runs(
    runs_root: Path,
    *,
    include_runs: set[str] | None,
    exclude_runs: set[str] | None,
) -> list[dict[str, Any]]:
    if not runs_root.exists():
        raise ValueError(f"runs_root does not exist: {runs_root}")
    runs = []
    for run_dir in sorted(path for path in runs_root.iterdir() if path.is_dir()):
        run_id = run_dir.name
        if include_runs is not None and run_id not in include_runs:
            continue
        if exclude_runs is not None and run_id in exclude_runs:
            continue
        extraction_path = run_dir / "jsonl" / "extractions.jsonl"
        if not extraction_path.exists():
            continue
        config = read_optional_json(run_dir / "run_config.json")
        summary = read_optional_json(run_dir / "summary.json")
        runs.append(
            {
                "run_id": run_id,
                "run_dir": run_dir,
                "extraction_path": extraction_path,
                "created_at": str(config.get("created_at") or run_id),
                "summary": summary,
            }
        )
    return sorted(runs, key=lambda item: (item["created_at"], item["run_id"]))


def read_optional_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def merge_run_extractions(
    runs: list[dict[str, Any]],
    *,
    validate: bool,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_gall_num: dict[str, dict[str, Any]] = {}
    history_by_gall_num: dict[str, list[dict[str, Any]]] = defaultdict(list)
    invalid_records: list[dict[str, Any]] = []
    run_reports = []
    source_record_count = 0

    for run in runs:
        records = parse_json_or_jsonl(Path(run["extraction_path"]))
        accepted_count = 0
        invalid_count = 0
        run_id = str(run["run_id"])
        run_dir = Path(run["run_dir"])

        for index, record in enumerate(records):
            source_record_count += 1
            gall_num = normalize_gall_num(record.get("gall_num"))
            errors = validate_extraction(record) if validate else []
            if not gall_num:
                errors.append("missing gall_num")
            if errors:
                invalid_count += 1
                invalid_records.append(
                    {
                        "run_id": run_id,
                        "run_dir": str(run_dir),
                        "index": index,
                        "gall_num": gall_num,
                        "errors": errors,
                    }
                )
                continue

            enriched = dict(record)
            enriched["_source_run_id"] = run_id
            enriched["_source_run_dir"] = str(run_dir)
            by_gall_num[gall_num] = enriched
            history_by_gall_num[gall_num].append(
                {
                    "run_id": run_id,
                    "run_dir": str(run_dir),
                    "index": index,
                }
            )
            accepted_count += 1

        run_reports.append(
            {
                "run_id": run_id,
                "run_dir": str(run_dir),
                "extraction_path": str(run["extraction_path"]),
                "created_at": run["created_at"],
                "source_record_count": len(records),
                "accepted_record_count": accepted_count,
                "invalid_record_count": invalid_count,
            }
        )

    duplicate_details = []
    for gall_num, history in sorted(history_by_gall_num.items(), key=lambda item: item[0]):
        if len(history) <= 1:
            continue
        winner = history[-1]
        duplicate_details.append(
            {
                "gall_num": gall_num,
                "winner_run": winner["run_id"],
                "winner_run_dir": winner["run_dir"],
                "replaced_runs": [item["run_id"] for item in history[:-1]],
                "all_runs": [item["run_id"] for item in history],
            }
        )

    merged_records = sorted(by_gall_num.values(), key=lambda item: str(item.get("gall_num", "")))
    report = {
        "run_count": len(runs),
        "runs": run_reports,
        "source_record_count": source_record_count,
        "accepted_source_record_count": sum(item["accepted_record_count"] for item in run_reports),
        "invalid_record_count": len(invalid_records),
        "invalid_records": invalid_records,
        "duplicate_gall_nums": [item["gall_num"] for item in duplicate_details],
        "duplicates": duplicate_details,
        "dedupe_policy": "latest_run_wins",
    }
    return merged_records, report


def normalize_gall_num(value: Any) -> str:
    return "" if value is None else str(value).strip()


def primary_concept_id(record: dict[str, Any]) -> str:
    candidates = record.get("concept_candidates") or []
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("relation") == "primary":
            return safe_concept_id(str(candidate.get("concept_id") or "uncategorized"))
    for candidate in candidates:
        if isinstance(candidate, dict) and candidate.get("concept_id"):
            return safe_concept_id(str(candidate["concept_id"]))
    keywords = record.get("canonical_keywords") or []
    if keywords:
        return safe_concept_id(str(keywords[0]))
    return "uncategorized"


def safe_concept_id(value: str) -> str:
    lowered = value.strip().lower()
    if lowered in CONCEPT_CATALOG:
        return lowered
    # alias 매핑은 정규화된 ID 기준으로 한 번 더 적용
    if lowered in CONCEPT_ALIASES:
        mapped = CONCEPT_ALIASES[lowered]
        if mapped in CONCEPT_CATALOG:
            return mapped
    slugged = safe_slug(lowered) or "uncategorized"
    if slugged in CONCEPT_ALIASES:
        mapped = CONCEPT_ALIASES[slugged]
        if mapped in CONCEPT_CATALOG:
            return mapped
    return slugged


def safe_slug(value: str) -> str:
    text = value.strip().lower()
    replacements = {
        "세계선": "worldline",
        "리딩 슈타이너": "reading_steiner",
        "d메일": "dmail",
        "디메일": "dmail",
        "시청순서": "viewing_order",
        "시청 순서": "viewing_order",
        "제로": "zero",
        "타임리프": "time_leap",
        "타임머신": "time_machine",
    }
    text = replacements.get(text, text)
    text = re.sub(r"[^0-9a-zA-Z가-힣_-]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "untitled"


def concept_label(group_id: str, records: list[dict[str, Any]]) -> str:
    if group_id in CONCEPT_CATALOG:
        return str(CONCEPT_CATALOG[group_id]["label"])
    labels = []
    for record in records:
        for candidate in record.get("concept_candidates") or []:
            if isinstance(candidate, dict) and safe_concept_id(str(candidate.get("concept_id"))) == group_id:
                label = candidate.get("label")
                if label:
                    labels.append(str(label))
    if labels:
        return Counter(labels).most_common(1)[0][0]
    return group_id


def render_index(rows: list[dict[str, Any]]) -> str:
    catalog_rows = [row for row in rows if row.get("is_catalog", True)]
    misc_rows = [row for row in rows if not row.get("is_catalog", True)]

    lines = [
        "# QA 위키 초안 인덱스",
        "",
        "| 개념 | 문서 | 질문 수 | 검토 필요 |",
        "| --- | --- | ---: | ---: |",
    ]
    for row in sorted(catalog_rows, key=lambda item: (-item["count"], item["label"])):
        lines.append(
            f"| {row['label']} | [{row['path']}](./{row['path']}) | "
            f"{row['count']} | {row['review_count']} |"
        )
    lines.append("")

    if misc_rows:
        lines.extend(
            [
                "## 미분류 (추가 검토)",
                "",
                "표준 CONCEPT_CATALOG 외 임의 슬러그로 분류된 그룹입니다. alias 매핑 또는 catalog 확장이 필요한 후보군.",
                "",
                "| 개념 | 문서 | 질문 수 | 검토 필요 |",
                "| --- | --- | ---: | ---: |",
            ]
        )
        for row in sorted(misc_rows, key=lambda item: (-item["count"], item["label"])):
            lines.append(
                f"| {row['label']} | [{row['path']}](./{row['path']}) | "
                f"{row['count']} | {row['review_count']} |"
            )
        lines.append("")

    return "\n".join(lines)


def render_wiki_group(label: str, group_id: str, records: list[dict[str, Any]]) -> str:
    keyword_counter: Counter[str] = Counter()
    question_type_counter: Counter[str] = Counter()
    review_count = 0
    for record in records:
        keyword_counter.update(str(item) for item in record.get("canonical_keywords") or [])
        question_type_counter[str(record.get("question_type", "기타"))] += 1
        if record.get("needs_human_review"):
            review_count += 1

    lines = [
        f"# {label}",
        "",
        "## 요약",
        "",
        f"- concept_id: `{group_id}`",
        f"- 관련 질문 수: {len(records)}",
        f"- 검토 필요: {review_count}",
        f"- 주요 질문 유형: {', '.join(format_counter(question_type_counter, 5)) or '없음'}",
        f"- 주요 키워드: {', '.join(format_counter(keyword_counter, 12)) or '없음'}",
        "",
        "## FAQ 후보",
        "",
    ]
    for record in records:
        answer = record.get("answer_candidate") or {}
        keywords = ", ".join(str(item) for item in record.get("canonical_keywords") or [])
        source_url = record.get("source_url") or record.get("url") or ""
        lines.extend(
            [
                f"### Q. {record.get('title_clean') or record.get('title') or record.get('gall_num')}",
                "",
                f"- 게시글 번호: `{record.get('gall_num', '')}`",
                f"- 질문 의도: {record.get('question_intent', '')}",
                f"- 유형/스포일러: {record.get('question_type', '')} / {record.get('spoiler_level', '')}",
                f"- 키워드: {keywords or '없음'}",
                f"- 답변 상태: {answer.get('status', '')} ({answer.get('confidence', '')})",
                f"- 답변 후보: {answer.get('summary', '')}",
                f"- 검토 필요: {'예' if record.get('needs_human_review') else '아니오'}",
                f"- 검토 사유: {record.get('review_reason', '')}",
                f"- 출처: {source_url}",
                "",
            ]
        )
    return "\n".join(lines)


def format_counter(counter: Counter[str], limit: int) -> list[str]:
    return [f"{key}({count})" for key, count in counter.most_common(limit) if key]


def command_heuristic(args: argparse.Namespace) -> int:
    csv_path = Path(args.csv_path)
    records = select_records(
        load_posts(csv_path),
        sample_size=args.sample_size,
        seed=args.seed,
        limit=args.limit,
    )
    out_path = Path(args.out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for record in records:
            extraction = heuristic_extract(record)
            handle.write(json.dumps(extraction, ensure_ascii=False) + "\n")
    print(f"wrote={out_path}")
    print(f"record_count={len(records)}")
    print("note=heuristic output is for pipeline dry-runs only; use SLM output for final wiki data")
    return 0


def heuristic_extract(record: PostRecord) -> dict[str, Any]:
    text = " ".join([record.title, record.post, " ".join(record.comments)])
    detected = detect_concepts(text)
    primary_id = detected[0][0] if detected else "uncategorized"
    question_type = infer_question_type(primary_id, text)
    keywords = concept_keywords_for_detected(detected)
    answer_summary, evidence_indexes, status = infer_answer_candidate(record.comments)
    return {
        "gall_num": record.gall_num,
        "source_url": record.url,
        "title_clean": record.title,
        "question_intent": summarize_question_intent(record.title, record.post),
        "question_type": question_type,
        "canonical_keywords": keywords,
        "raw_keywords": matched_raw_keywords(text),
        "concept_candidates": [
            {
                "concept_id": concept_id,
                "label": CONCEPT_CATALOG.get(concept_id, {}).get("label", concept_id),
                "relation": "primary" if index == 0 else "secondary",
            }
            for index, (concept_id, _score) in enumerate(detected[:4])
        ],
        "entities": infer_entities(text),
        "answer_candidate": {
            "status": status,
            "summary": answer_summary,
            "evidence_comment_indexes": evidence_indexes,
            "confidence": "low",
        },
        "spoiler_level": infer_spoiler_level(text),
        "wiki_action": "merge_into_concept_faq" if detected else "needs_human_review",
        "needs_human_review": True,
        "review_reason": "휴리스틱 초안이므로 SLM 또는 사람이 검토해야 함",
    }


def detect_concepts(text: str) -> list[tuple[str, int]]:
    lowered = text.lower()
    scores = []
    for concept_id, item in CONCEPT_CATALOG.items():
        score = 0
        for keyword in item["keywords"]:
            if keyword.lower() in lowered:
                score += 1
        if score:
            scores.append((concept_id, score))
    return sorted(scores, key=concept_sort_key)


def concept_sort_key(item: tuple[str, int]) -> tuple[int, int, str]:
    concept_id, score = item
    adjusted_score = min(score, 1) if concept_id == "character_events" else score
    return (-adjusted_score, CONCEPT_PRIORITY.get(concept_id, 5), concept_id)


def infer_question_type(primary_id: str, text: str) -> str:
    lowered = text.lower()
    if any(keyword in lowered for keyword in ["한글패치", "한패", "스팀", "ps4", "안드로이드"]):
        return "번역/한글패치"
    if primary_id in QUESTION_TYPE_CONCEPTS:
        return QUESTION_TYPE_CONCEPTS[primary_id]
    if any(keyword in text for keyword in ["순서", "먼저", "봐야", "입문"]):
        return "시청순서"
    if any(keyword in lowered for keyword in ["ost", "브금", "노래"]):
        return "OST/자료"
    if any(keyword in text for keyword in ["크리스", "오카베", "마유리", "스즈하", "루카"]):
        return "캐릭터/사건"
    return "설정해석"


def concept_keywords_for_detected(detected: list[tuple[str, int]]) -> list[str]:
    keywords = []
    for concept_id, _score in detected[:5]:
        label = CONCEPT_CATALOG.get(concept_id, {}).get("label")
        if label:
            keywords.append(str(label))
    return keywords


def matched_raw_keywords(text: str) -> list[str]:
    lowered = text.lower()
    matches = []
    for item in CONCEPT_CATALOG.values():
        for keyword in item["keywords"]:
            if keyword.lower() in lowered:
                matches.append(str(keyword))
    return sorted(set(matches), key=matches.index)[:20]


def infer_entities(text: str) -> dict[str, list[str]]:
    character_names = ["오카베", "크리스", "마유리", "스즈하", "루카", "페이리스", "모에카", "카가리", "레스키넨", "다루"]
    organization_names = ["SERN", "세른", "라운더", "FB"]
    media_names = ["본편", "제로", "극장판", "OVA", "23.5화", "23화"]
    return {
        "characters": [name for name in character_names if name in text],
        "organizations": [name for name in organization_names if name in text],
        "media": [name for name in media_names if name in text],
    }


def infer_answer_candidate(comments: list[str]) -> tuple[str, list[int], str]:
    if not comments:
        return "댓글 답변이 없어 자동 요약하지 않음", [], "unanswered"
    scored = sorted(
        enumerate(comments),
        key=lambda item: (len(item[1]), -item[0]),
        reverse=True,
    )
    evidence = [index for index, _comment in scored[:2]]
    summary_parts = [comments[index] for index in evidence]
    summary = " / ".join(summary_parts)
    if len(summary) > 500:
        summary = summary[:497].rstrip() + "..."
    return summary, evidence, "partial"


def summarize_question_intent(title: str, post: str) -> str:
    source = f"{title} {post}".strip()
    source = re.sub(r"\s+", " ", source)
    if len(source) > 180:
        source = source[:177].rstrip() + "..."
    return source


def infer_spoiler_level(text: str) -> str:
    lowered = text.lower()
    if any(keyword in text for keyword in ["엔딩", "24화", "23.5", "오퍼레이션", "스쿨드"]):
        return "endgame"
    if "제로" in text or "23b" in lowered:
        return "zero_story"
    if any(keyword in text for keyword in ["마유리", "크리스", "SERN", "세른", "라운더"]):
        return "main_story"
    if any(keyword in text for keyword in ["8화", "D메일", "전화렌지"]):
        return "early_story"
    return "none"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare SLM prompts, validate extractions, and generate wiki drafts.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="Create SLM prompt batches from CSV")
    prepare.add_argument("csv_path")
    prepare.add_argument("--out-dir", default="artifacts/qa-wiki/prepared")
    prepare.add_argument("--sample-size", type=int, default=None)
    prepare.add_argument("--seed", type=int, default=20260523)
    prepare.add_argument("--limit", type=int, default=None)
    prepare.add_argument("--batch-size", type=int, default=20)
    prepare.add_argument("--max-post-chars", type=int, default=1800)
    prepare.add_argument("--max-comment-chars", type=int, default=900)
    prepare.add_argument("--max-comments", type=int, default=30)
    prepare.add_argument("--system-prompt", default=str(DEFAULT_SYSTEM_PROMPT))
    prepare.add_argument("--user-template", default=str(DEFAULT_USER_TEMPLATE))
    prepare.set_defaults(func=command_prepare)

    validate = subparsers.add_parser("validate", help="Validate SLM JSON/JSONL extraction output")
    validate.add_argument("input_path")
    validate.add_argument("--source-csv", default=None)
    validate.add_argument("--report", default=None)
    validate.add_argument(
        "--strict",
        action="store_true",
        help="warning-level 검증(primary_count/evidence_index/entities_keys)을 error로 승격",
    )
    validate.set_defaults(func=command_validate)

    group = subparsers.add_parser("group", help="Group extraction output into wiki draft markdown")
    group.add_argument("input_path")
    group.add_argument("--out-dir", default="artifacts/qa-wiki/wiki")
    group.add_argument("--validate", action="store_true")
    group.add_argument("--clean", action="store_true", help="Remove existing markdown files in out-dir first")
    group.set_defaults(func=command_group)

    group_runs = subparsers.add_parser("group-runs", help="Group all run extractions into one wiki draft")
    group_runs.add_argument("--runs-root", default="artifacts/qa-wiki/runs")
    group_runs.add_argument("--out-dir", default="artifacts/qa-wiki/wiki")
    group_runs.add_argument("--merged-jsonl", default=None)
    group_runs.add_argument("--report", default=None)
    group_runs.add_argument("--include-runs", default=None, help="Comma-separated run IDs to include")
    group_runs.add_argument("--exclude-runs", default=None, help="Comma-separated run IDs to exclude")
    group_runs.add_argument("--validate", action="store_true")
    group_runs.add_argument("--clean", action="store_true", help="Remove existing markdown files in out-dir first")
    group_runs.set_defaults(func=command_group_runs)

    heuristic = subparsers.add_parser(
        "heuristic",
        help="Create low-confidence heuristic extraction output for dry-runs",
    )
    heuristic.add_argument("csv_path")
    heuristic.add_argument("--out-path", default="artifacts/qa-wiki/heuristic_extractions.jsonl")
    heuristic.add_argument("--sample-size", type=int, default=None)
    heuristic.add_argument("--seed", type=int, default=20260523)
    heuristic.add_argument("--limit", type=int, default=None)
    heuristic.set_defaults(func=command_heuristic)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except BrokenPipeError:
        return 1
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
