#!/usr/bin/env python3
"""Build index.csv for data/qaset_with_rag.

Columns: id, filename, category_l1, category_l2, category_l3
Category columns left empty — filled later by LLM segmentation/clustering.
"""
import csv
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "data" / "qaset_with_rag"
OUT = TARGET / "index.csv"
COLS = ["id", "filename", "category_l1", "category_l2", "category_l3"]


def main() -> int:
    files = sorted(TARGET.glob("qe_*.json"))
    if not files:
        print(f"[ERR] no qe_*.json under {TARGET}", file=sys.stderr)
        return 1

    rows = 0
    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for p in files:
            w.writerow({
                "id": p.stem,
                "filename": p.name,
                "category_l1": "",
                "category_l2": "",
                "category_l3": "",
            })
            rows += 1

    print(f"[OK] wrote {OUT}")
    print(f"     data rows = {rows} (+1 header)")
    print(f"     columns   = {COLS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
