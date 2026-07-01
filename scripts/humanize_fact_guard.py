#!/usr/bin/env python3
"""Deterministic guard for Humanize KR edits.

Checks invariants that the humanize step must not change:
- numeric tokens
- Markdown blockquote text
- frontmatter spoiler value
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path


NUMBER_RE = re.compile(r"(?<![\w])[-+]?\d+(?:[.,:]\d+)*(?:%|퍼센트|년|월|일|화|회|명|개|권|시간|분|초)?")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.DOTALL)
SPOILER_RE = re.compile(r"(?m)^\s*spoiler\s*:\s*(.*?)\s*$")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def normalize_yaml_scalar(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def spoiler_value(text: str) -> str | None:
    match = FRONTMATTER_RE.search(text)
    if not match:
        return None
    spoiler = SPOILER_RE.search(match.group(1))
    if not spoiler:
        return None
    return normalize_yaml_scalar(spoiler.group(1))


def number_counter(text: str) -> Counter[str]:
    return Counter(match.group(0) for match in NUMBER_RE.finditer(text))


def quote_lines(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        if line.startswith(">"):
            # Preserve content while ignoring trailing whitespace only.
            lines.append(line.rstrip())
    return lines


def counter_delta(before: Counter[str], after: Counter[str]) -> dict[str, dict[str, int]]:
    keys = sorted(set(before) | set(after))
    return {
        key: {"before": before[key], "after": after[key]}
        for key in keys
        if before[key] != after[key]
    }


def check(before_text: str, after_text: str) -> list[dict]:
    violations: list[dict] = []

    before_numbers = number_counter(before_text)
    after_numbers = number_counter(after_text)
    number_diff = counter_delta(before_numbers, after_numbers)
    if number_diff:
        violations.append({"type": "number_tokens_changed", "diff": number_diff})

    before_quotes = quote_lines(before_text)
    after_quotes = quote_lines(after_text)
    if before_quotes != after_quotes:
        violations.append(
            {
                "type": "blockquote_text_changed",
                "before": before_quotes,
                "after": after_quotes,
            }
        )

    before_spoiler = spoiler_value(before_text)
    after_spoiler = spoiler_value(after_text)
    if before_spoiler != after_spoiler:
        violations.append(
            {
                "type": "spoiler_changed",
                "before": before_spoiler,
                "after": after_spoiler,
            }
        )

    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check humanize invariants")
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--after", required=True, type=Path)
    args = parser.parse_args(argv)

    violations = check(read_text(args.before), read_text(args.after))
    result = {
        "status": "fail" if violations else "pass",
        "violations": violations,
        "summary": {"violations": len(violations)},
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
