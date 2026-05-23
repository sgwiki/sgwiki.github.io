set -euo pipefail

CSV="data/2025-05-04_질문목록_수동필터링.csv"
RUN_ID="$(date +%Y%m%d-%H%M%S)-sample"
RUN_DIR="artifacts/qa-wiki/runs/$RUN_ID"

uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv "$CSV" \
  --batch-size 4 \
  --run-id "$RUN_ID"

uv run python scripts/qa_wiki_pipeline.py validate \
  "$RUN_DIR/jsonl/extractions.jsonl" \
  --source-csv "$CSV" \
  --report "$RUN_DIR/validation_report.json"

uv run python scripts/qa_wiki_pipeline.py group \
  "$RUN_DIR/jsonl/extractions.jsonl" \
  --out-dir "$RUN_DIR/wiki" \
  --validate \
  --clean

echo "RUN_DIR=$RUN_DIR"
jq . "$RUN_DIR/summary.json"
jq . "$RUN_DIR/validation_report.json"
sed -n '1,120p' "$RUN_DIR/wiki/index.md"