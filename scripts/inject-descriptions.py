#!/usr/bin/env python3
"""각 위키 문서의 첫 산문 문장에서 meta description를 추출해 front matter에 주입한다.

- 멱등성: 이미 `description:`가 있으면 건너뛴다.
- 기존 front matter 키(spoiler/category/tags/title 등) 보존.
- admonition 블록(`!!! ...`), 헤딩(`#`), 인용/표/코드펜스를 건너뛰고 첫 산문 문단을 사용.
- `## 개요` 섹션이 있으면 그 직후 첫 문단을 우선한다.

사용:
  python scripts/inject-descriptions.py --dry-run            # 미리보기(변경 없음)
  python scripts/inject-descriptions.py --dry-run --limit 10 # 표본 10개
  python scripts/inject-descriptions.py                      # 실제 주입
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

WIKI_DIR = Path(__file__).resolve().parent.parent / "wiki"
MAX_LEN = 160  # description 권장 상한(자)

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def split_front_matter(text: str) -> tuple[str | None, str]:
    """(front_matter_inner, body) 반환. front matter 없으면 (None, text)."""
    m = FM_RE.match(text)
    if not m:
        return None, text
    return m.group(1), text[m.end():]


def strip_markdown(s: str) -> str:
    s = re.sub(r"\[\^[^\]]+\]", "", s)              # 각주 참조 [^1]
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)        # 이미지
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)     # 링크 → 텍스트
    s = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", s)  # 위키링크
    s = re.sub(r"[*_`]{1,3}", "", s)                  # 강조/코드 마커
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_skippable(line: str) -> bool:
    if line.startswith(("    ", "\t")):                 # 들여쓰기(admonition 본문 등)
        return True
    t = line.strip()
    if not t:
        return True
    if t.startswith(("#", "!!!", "???", ">", "|", "```", "---", "- ", "* ", "+ ")):
        return True
    if re.match(r"^\d+\.\s", t):                        # 번호 목록
        return True
    # 스포일러 경고문은 admonition이 아닌 일반 산문으로 적힌 경우가 많다 → 설명에서 제외
    if "스포일러" in t and re.search(r"(포함|주의|노출|다룹|다룬)", t):
        return True
    return False


def first_prose(body: str) -> str | None:
    lines = body.splitlines()
    # `## 개요` 섹션 우선
    start = 0
    for i, ln in enumerate(lines):
        if re.match(r"^#{1,6}\s+개요\b", ln.strip()):
            start = i + 1
            break
    for ln in lines[start:]:
        if is_skippable(ln):
            continue
        text = strip_markdown(ln)
        if len(text) >= 10:
            return text
    # 폴백: 문서 전체에서 첫 산문
    if start != 0:
        for ln in lines:
            if is_skippable(ln):
                continue
            text = strip_markdown(ln)
            if len(text) >= 10:
                return text
    return None


def truncate(s: str) -> str:
    if len(s) <= MAX_LEN:
        return s
    cut = s[:MAX_LEN]
    # 문장 끝(마침표) 우선, 없으면 공백 경계
    for sep in (". ", "다. ", "다 ", " "):
        idx = cut.rfind(sep)
        if idx > MAX_LEN * 0.5:
            return cut[: idx + (len(sep) - 1 if sep != " " else 0)].strip()
    return cut.strip()


def yaml_quote(s: str) -> str:
    """description 값을 안전한 YAML 더블쿼트 스칼라로 직렬화."""
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def process(path: Path, dry_run: bool) -> str:
    raw = path.read_text(encoding="utf-8")
    fm, body = split_front_matter(raw)

    if fm is not None and re.search(r"^description:", fm, re.MULTILINE):
        return "skip-exists"

    desc = first_prose(body)
    if not desc:
        return "skip-no-prose"
    desc = truncate(desc)
    line = f"description: {yaml_quote(desc)}"

    if fm is None:
        new = f"---\n{line}\n---\n\n{body.lstrip(chr(10))}"
    else:
        new_fm = fm.rstrip("\n") + "\n" + line
        new = f"---\n{new_fm}\n---\n{body}"

    if dry_run:
        print(f"[DRY] {path.relative_to(WIKI_DIR.parent)}\n      → {desc}")
    else:
        path.write_text(new, encoding="utf-8")
    return "injected"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    files = sorted(
        p for p in WIKI_DIR.rglob("*.md")
        if "_template" not in p.parts
    )
    if args.limit:
        files = files[: args.limit]

    stats: dict[str, int] = {}
    for p in files:
        r = process(p, args.dry_run)
        stats[r] = stats.get(r, 0) + 1

    print("\n--- 요약 ---")
    for k in ("injected", "skip-exists", "skip-no-prose"):
        if k in stats:
            print(f"  {k}: {stats[k]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
