#!/usr/bin/env python3
"""
온톨로지 TTL SHACL 검증 스크립트.

pySHACL로 TTL 내장 SHACL shapes를 평가하여 구조 무결성을 확인한다.
ontology-author가 저작 후 자체 점검용으로, ontology-validator가 독립 검증용으로 사용.

사용:
  python scripts/validate_ontology.py
  python scripts/validate_ontology.py --ttl <path>

종료 코드:
  0 — 검증 통과 (0 violations)
  1 — SHACL 위반 발견
  2 — pySHACL 미설치 또는 파싱 오류
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TTL = REPO_ROOT / "docker/holyclaude/ontology/src/슈타인즈게이트_온톨로지.ttl"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ttl", type=Path, default=DEFAULT_TTL, help="검증할 TTL 경로")
    args = ap.parse_args()

    if not args.ttl.exists():
        print(f"❌ TTL not found: {args.ttl}", file=sys.stderr)
        return 2

    try:
        from pyshacl import validate
    except ImportError:
        print(
            "❌ pySHACL 미설치. 설치: uv pip install pyshacl",
            file=sys.stderr,
        )
        return 2

    try:
        from rdflib import Graph
    except ImportError:
        print("❌ rdflib 미설치. 설치: uv add rdflib", file=sys.stderr)
        return 2

    print(f"검증 중: {args.ttl}")

    from rdflib import Graph

    data_graph = Graph()
    data_graph.parse(str(args.ttl), format="turtle")

    conforms, results_graph, results_text = validate(
        data_graph,
        inference="rdfs",  # OWL-DL axiom을 rdfs 추론으로 일부 적용
        advanced=True,  # SHACL SPARQL constraints 포함
        meta_shacl=False,
        debug=False,
    )

    if conforms:
        print("✅ SHACL 검증 통과 (0 violations)")
        return 0

    print("❌ SHACL 위반 발견:\n", file=sys.stderr)
    print(results_text, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
