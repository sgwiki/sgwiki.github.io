#!/usr/bin/env python3
"""
Steins;Gate 세계선 인터랙티브 맵 — 데이터 생성 스크립트 (Phase 0)

온톨로지 TTL을 SPARQL로 질의하여 React 앱이 사용할 정적 JSON 6종을 생성한다.
GitHub Pages(정적 호스팅)에서 런타임 MCP 쿼리가 불가능하므로 빌드 타임에 평탄화한다.

출력 (기본: ../sg-worldline-map/src/data/):
  worldlines.json     — WorldLine + 계산된 y 좌표 + attractorField 평탄화
  events.json         — Event + worldLineId(2홉 평탄화) + variationId + macroEventId
  shifts.json         — WorldLineShift + fromY/toY 조인
  variations.json     — EventVariation + worldLineId + macroEventId
  macro_events.json   — MacroEvent
  convergence.json    — ConvergencePattern + onTimeline 플래그 + attractorField

사용:
  python scripts/generate-data.py
  python scripts/generate-data.py --ttl <path> --out <dir>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from rdflib import Graph

# ---------------------------------------------------------------------------
# 경로 해석
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TTL = REPO_ROOT / "docker/holyclaude/ontology/src/슈타인즈게이트_온톨로지.ttl"
DEFAULT_OUT = REPO_ROOT / "sg-worldline-map/src/data"
WIKI_WORLDLINE_DIR = REPO_ROOT / "wiki/세계선"

PREFIXES = """
PREFIX sg: <http://example.org/steinsgate#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
"""


def local(node) -> str:
    """URIRef의 마지막 # 뒤 부분(mnemonic id)을 반환. Literal은 str()."""
    s = str(node)
    return s.split("#")[-1] if "#" in s else s


# ---------------------------------------------------------------------------
# Y 좌표 계산 — 어트랙터 필드별 밴드 + 밴드 내 divergence 순 정렬
# ---------------------------------------------------------------------------
# 시각적 서사(오카베의 경험 순서 + 다이버전스 사다리)를 반영한 밴드 배치.
# 위에서 아래로: Ω(부정 다이버전스) → α 밴드 → Steins;Gate(탈출) → β 밴드.
BAND_LAYOUT = {
    # attractorFieldId: (bandTop, bandBottom)
    "AF_Omega": (60, 100),       # 단일 세계선, 여유 밴드
    "AF_Alpha": (150, 470),      # 10개 세계선
    "AF_SteinsGate": (510, 550), # 단일, α와 β 사이 강조
    "AF_Beta": (600, 900),       # 8개 세계선
}


def compute_y(af_id: str, divergence: float, siblings_sorted: list[float]) -> int:
    """
    해당 AF 밴드 내에서 divergence 순서에 따른 Y 좌표.
    α는 divergence 오름차순(작을수록 위), β도 오름차순.
    밴드 내를 균등 분할(deterministic, 클러스터링 문제 회피).
    """
    top, bottom = BAND_LAYOUT[af_id]
    n = len(siblings_sorted)
    if n == 1:
        return (top + bottom) // 2
    rank = siblings_sorted.index(divergence)
    # 밴드 양끝에 패딩을 두고 n개를 균등 배치
    span = bottom - top
    step = span / (n - 1) if n > 1 else 0
    return int(round(top + rank * step))


def build_wiki_slug_map(wiki_dir: Path) -> dict[str, str]:
    """wiki/세계선/*.md 파일명에서 발산률 prefix → slug 매핑 생성.
    파일명 형식: {divergence}-세계선*.md (예: 1.048596-세계선-슈타인즈게이트.md).
    발산률을 6자리 소수로 정규화해 키로 사용.
    """
    result: dict[str, str] = {}
    if not wiki_dir.exists():
        return result
    for p in wiki_dir.glob("*.md"):
        stem = p.stem  # e.g. "1.048596-세계선-슈타인즈게이트"
        first = stem.split("-")[0]
        if not first or not (first[0].isdigit()):
            continue
        try:
            div_val = float(first)
            key = f"{div_val:.6f}"
            result[key] = stem
        except ValueError:
            continue
    return result


def build_band_meta() -> list[dict]:
    """AF 밴드의 시각적 영역(음영/라벨용)."""
    af_order = ["AF_Omega", "AF_Alpha", "AF_SteinsGate", "AF_Beta"]
    af_label = {
        "AF_Omega": "Ω 오메가",
        "AF_Alpha": "α 알파",
        "AF_SteinsGate": "Steins;Gate",
        "AF_Beta": "β 베타",
    }
    af_color = {
        "AF_Omega": "#6b7280",      # 회색
        "AF_Alpha": "#ef4444",      # 빨강 (SERN 디스토피아)
        "AF_SteinsGate": "#f59e0b", # 금색 (희망)
        "AF_Beta": "#6366f1",       # 보라 (WW3)
    }
    meta = []
    for af in af_order:
        top, bottom = BAND_LAYOUT[af]
        meta.append({
            "id": af,
            "labelKo": af_label[af],
            "color": af_color[af],
            "yTop": top,
            "yBottom": bottom,
        })
    return meta


# ---------------------------------------------------------------------------
# SPARQL 쿼리들
# ---------------------------------------------------------------------------
Q_WORLDLINES = """
SELECT ?wl ?id ?labelKo ?div ?active ?af WHERE {
  ?wl a sg:WorldLine ;
      sg:id ?id ; sg:labelKo ?labelKo ;
      sg:divergenceValue ?div ; sg:isActive ?active ;
      sg:belongsToAttractorField ?af .
  OPTIONAL { ?wl sg:note ?note }
}
"""

Q_EVENTS = """
SELECT ?e ?id ?labelKo ?summary ?eventType ?mechanismType
       ?localDateTime ?timePrecision ?place ?actor ?target
       ?variation ?wl ?macroEvent WHERE {
  ?e a sg:Event ;
     sg:id ?id ; sg:labelKo ?labelKo ; sg:summary ?summary ;
     sg:eventType ?eventType ; sg:mechanismType ?mechanismType ;
     sg:localDateTime ?localDateTime ; sg:timePrecision ?timePrecision ;
     sg:partOfVariation ?variation .
  OPTIONAL { ?e sg:place ?place }
  OPTIONAL { ?e sg:actor ?actor }
  OPTIONAL { ?e sg:target ?target }
  OPTIONAL { ?e sg:note ?note }
  ?variation sg:belongsToWorldLine ?wl ;
             sg:partOfMacroEvent ?macroEvent .
}
"""

Q_SHIFTS = """
SELECT ?s ?id ?shiftType ?shiftMoment ?summary
       ?fromWl ?toWl ?triggerEvent WHERE {
  ?s a sg:WorldLineShift ;
     sg:id ?id ; sg:shiftType ?shiftType ; sg:shiftMoment ?shiftMoment ;
     sg:summary ?summary ;
     sg:fromWorldLine ?fromWl ; sg:toWorldLine ?toWl ;
     sg:triggeredByEvent ?triggerEvent .
}
"""

Q_VARIATIONS = """
SELECT ?ev ?id ?variationIdentity ?branchCondition ?wl ?macroEvent WHERE {
  ?ev a sg:EventVariation ;
      sg:id ?id ; sg:variationIdentity ?variationIdentity ;
      sg:belongsToWorldLine ?wl ; sg:partOfMacroEvent ?macroEvent .
  OPTIONAL { ?ev sg:branchCondition ?branchCondition }
  OPTIONAL { ?ev sg:note ?note }
}
"""

Q_MACRO_EVENTS = """
SELECT ?me ?id ?labelKo WHERE {
  ?me a sg:MacroEvent ; sg:id ?id ; sg:labelKo ?labelKo .
  OPTIONAL { ?me sg:note ?note }
}
"""

Q_CONVERGENCE = """
SELECT ?cp ?id ?labelKo ?description ?timeWindow ?char WHERE {
  ?cp a sg:ConvergencePattern ;
      sg:id ?id ; sg:labelKo ?labelKo ; sg:description ?description .
  OPTIONAL { ?cp sg:timeWindow ?timeWindow }
  OPTIONAL { ?cp sg:appliesToCharacter ?char }
}
"""

# ConvergencePattern이 어느 AF에 속하는지는 이름 규칙 또는 variation 역추적.
# variation 링크가 있는 경우 그 variation의 WL → AF로 역산.
Q_CP_AF = """
SELECT ?cpid ?afid WHERE {
  ?cp sg:id ?cpid ; sg:hasVariantVariation ?ev .
  ?ev sg:belongsToWorldLine ?wl .
  ?wl sg:belongsToAttractorField ?af .
  BIND(STRAFTER(STR(?af), "#") AS ?afid)
}
"""


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
def generate(ttl_path: Path, out_dir: Path) -> dict:
    g = Graph()
    g.parse(str(ttl_path), format="turtle")

    def run(q: str) -> list[dict]:
        rows = []
        for r in g.query(PREFIXES + q):
            rows.append({k: r[k] for k in r.labels})
        return rows

    # --- WorldLines (Y 좌표 계산 포함) ---
    wiki_slug_map = build_wiki_slug_map(WIKI_WORLDLINE_DIR)
    wl_raw = run(Q_WORLDLINES)
    # AF별 divergence 정렬 목록
    by_af: dict[str, list[float]] = {}
    for row in wl_raw:
        af = local(row["af"])
        by_af.setdefault(af, []).append(float(row["div"]))
    for af in by_af:
        by_af[af].sort()

    worldlines = []
    wl_y_map: dict[str, int] = {}   # worldLineId(local) -> y
    unmatched_slugs: list[str] = []
    for row in wl_raw:
        wl_local = local(row["wl"])
        af_local = local(row["af"])
        div = float(row["div"])
        if af_local not in BAND_LAYOUT:
            raise SystemExit(f"Unknown attractor field: {af_local}")
        y = compute_y(af_local, div, by_af[af_local])
        wl_y_map[wl_local] = y
        slug = wiki_slug_map.get(f"{div:.6f}")
        if slug is None:
            unmatched_slugs.append(f"{wl_local} (div={div:.6f})")
        worldlines.append({
            "id": str(row["id"]),
            "uri": wl_local,
            "labelKo": str(row["labelKo"]),
            "divergence": div,
            "isActive": bool(row["active"]),
            "attractorField": af_local,
            "y": y,
            "wikiSlug": slug,
        })
    worldlines.sort(key=lambda w: w["y"])
    if unmatched_slugs:
        print(f"⚠️  wiki slug 미매칭 세계선 {len(unmatched_slugs)}개:", file=sys.stderr)
        for u in unmatched_slugs:
            print(f"   {u}", file=sys.stderr)

    # --- Events (worldLineId 2홉 평탄화) ---
    events = []
    for row in run(Q_EVENTS):
        events.append({
            "id": str(row["id"]),
            "uri": local(row["e"]),
            "labelKo": str(row["labelKo"]),
            "summary": str(row["summary"]).strip(),
            "eventType": str(row["eventType"]),
            "mechanismType": str(row["mechanismType"]),
            "localDateTime": str(row["localDateTime"]),
            "timePrecision": str(row["timePrecision"]),
            "place": str(row["place"]) if "place" in row else None,
            "actor": local(row["actor"]) if "actor" in row else None,
            "target": local(row["target"]) if "target" in row else None,
            "variationId": local(row["variation"]),
            "worldLineId": local(row["wl"]),
            "macroEventId": local(row["macroEvent"]),
        })

    # --- Shifts (fromY/toY 조인) ---
    shifts = []
    for row in run(Q_SHIFTS):
        from_uri = local(row["fromWl"])
        to_uri = local(row["toWl"])
        shifts.append({
            "id": str(row["id"]),
            "uri": local(row["s"]),
            "shiftType": str(row["shiftType"]),
            "shiftMoment": str(row["shiftMoment"]),
            "summary": str(row["summary"]).strip(),
            "fromWorldLineId": from_uri,
            "toWorldLineId": to_uri,
            "fromY": wl_y_map.get(from_uri),
            "toY": wl_y_map.get(to_uri),
            "triggeredByEventId": local(row["triggerEvent"]),
        })

    # --- Variations ---
    variations = []
    for row in run(Q_VARIATIONS):
        variations.append({
            "id": str(row["id"]),
            "uri": local(row["ev"]),
            "variationIdentity": str(row["variationIdentity"]),
            "branchCondition": str(row["branchCondition"]) if "branchCondition" in row else None,
            "worldLineId": local(row["wl"]),
            "macroEventId": local(row["macroEvent"]),
        })

    # --- MacroEvents ---
    macro_events = []
    for row in run(Q_MACRO_EVENTS):
        macro_events.append({
            "id": str(row["id"]),
            "uri": local(row["me"]),
            "labelKo": str(row["labelKo"]),
        })

    # --- Convergence (onTimeline 플래그 + AF 역산) ---
    cp_af_map: dict[str, str] = {}
    for row in run(Q_CP_AF):
        cp_af_map[str(row["cpid"])] = str(row["afid"])

    # CP 이름 규칙 기반 AF 추론 (hasVariantVariation이 없는 경우 fallback)
    cp_name_af = {
        "CP_MayuriDies_Alpha": "AF_Alpha",
        "CP_KurisuDies_Beta": "AF_Beta",
        "CP_SERNTimeMachineCompleted_Alpha": "AF_Alpha",
        "CP_SERNDystopia_Alpha": "AF_Alpha",
        "CP_WW3_Beta": "AF_Beta",
    }

    convergence = []
    for row in run(Q_CONVERGENCE):
        cp_id = str(row["id"])
        tw = str(row["timeWindow"]) if "timeWindow" in row else ""
        af = cp_af_map.get(cp_id) or cp_name_af.get(cp_id, "")
        convergence.append({
            "id": cp_id,
            "uri": local(row["cp"]),
            "labelKo": str(row["labelKo"]),
            "description": str(row["description"]).strip(),
            "timeWindow": tw,
            "appliesToCharacter": local(row["char"]).replace("Char_", "") if "char" in row else None,
            "attractorField": af,
            # 2010년대 날짜/구간이면 타임라인 상 음영 가능, 연도만 있으면 밴드 라벨
            "onTimeline": tw.startswith("2010"),
        })

    band_meta = build_band_meta()

    # --- 출력 ---
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        "worldlines.json": worldlines,
        "events.json": events,
        "shifts.json": shifts,
        "variations.json": variations,
        "macro_events.json": macro_events,
        "convergence.json": convergence,
        "bands.json": band_meta,
    }
    for name, data in outputs.items():
        (out_dir / name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return {name: len(data) for name, data in outputs.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ttl", type=Path, default=DEFAULT_TTL, help="온톨로지 TTL 경로")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="출력 디렉터리")
    args = ap.parse_args()

    if not args.ttl.exists():
        print(f"❌ TTL not found: {args.ttl}", file=sys.stderr)
        return 1

    counts = generate(args.ttl, args.out)
    print(f"✅ Generated JSON in {args.out}")
    for name, n in counts.items():
        print(f"   {name:24} {n:>4}")

    # 카운트 검증 (계획서 기준)
    expected = {
        "worldlines.json": 20,
        "events.json": 68,
        "shifts.json": 18,
        "variations.json": 28,
        "macro_events.json": 8,
        "convergence.json": 5,
    }
    mismatches = [
        f"{k}: expected {v}, got {counts.get(k)}"
        for k, v in expected.items()
        if counts.get(k) != v
    ]
    if mismatches:
        print("⚠️  Count mismatch:", file=sys.stderr)
        for m in mismatches:
            print(f"   {m}", file=sys.stderr)
        return 2
    print("✅ All counts match expected values.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
