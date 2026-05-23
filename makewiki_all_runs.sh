set -euo pipefail

RUNS_ROOT="artifacts/qa-wiki/runs"
OUT_DIR="artifacts/qa-wiki/wiki"

uv run python scripts/qa_wiki_pipeline.py group-runs \
  --runs-root "$RUNS_ROOT" \
  --out-dir "$OUT_DIR" \
  --validate \
  --clean

uv run python scripts/qa_wiki_pipeline.py validate \
  "$OUT_DIR/extractions.merged.jsonl" \
  --source-csv data/2025-05-04_질문목록_수동필터링.csv \
  --report "$OUT_DIR/validation_report.json"

echo "OUT_DIR=$OUT_DIR"
jq . "$OUT_DIR/merge_report.json"
jq . "$OUT_DIR/validation_report.json"
sed -n '1,120p' "$OUT_DIR/index.md"
