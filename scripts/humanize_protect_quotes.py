#!/usr/bin/env python3
"""Restore protected Markdown blockquote lines after Humanize KR edits.

Humanize may improve prose in normal paragraphs, but sg-wiki treats Markdown
blockquote lines as protected evidence/quote blocks. This tool restores every
line that starts with ">" from the pre-humanize snapshot into the post-humanize
file when the quote-line count and order are still compatible.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def quote_line_indexes(lines: list[str]) -> list[int]:
    return [idx for idx, line in enumerate(lines) if line.startswith(">")]


def restore_quote_lines(before_text: str, after_text: str) -> tuple[str, dict]:
    before_lines = before_text.splitlines(keepends=True)
    after_lines = after_text.splitlines(keepends=True)
    before_indexes = quote_line_indexes(before_lines)
    after_indexes = quote_line_indexes(after_lines)

    result = {
        "status": "pass",
        "changed": False,
        "restored": [],
        "before_quote_lines": len(before_indexes),
        "after_quote_lines": len(after_indexes),
    }

    if len(before_indexes) != len(after_indexes):
        result["status"] = "fail"
        result["reason"] = "blockquote line count changed"
        return after_text, result

    for ordinal, (before_idx, after_idx) in enumerate(zip(before_indexes, after_indexes), start=1):
        before_line = before_lines[before_idx]
        after_line = after_lines[after_idx]
        if before_line != after_line:
            after_lines[after_idx] = before_line
            result["changed"] = True
            result["restored"].append(
                {
                    "quote": ordinal,
                    "before_line": before_idx + 1,
                    "after_line": after_idx + 1,
                    "from": after_line.rstrip("\n\r"),
                    "to": before_line.rstrip("\n\r"),
                }
            )

    return "".join(after_lines), result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Restore protected blockquote lines after humanize")
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--after", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="write restored quote lines back to --after")
    args = parser.parse_args(argv)

    before_text = args.before.read_text(encoding="utf-8")
    after_text = args.after.read_text(encoding="utf-8")
    restored_text, result = restore_quote_lines(before_text, after_text)

    if args.apply and result["status"] == "pass" and result["changed"]:
        args.after.write_text(restored_text, encoding="utf-8")
        result["applied"] = True
    else:
        result["applied"] = False

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
