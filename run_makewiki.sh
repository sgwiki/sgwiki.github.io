set -euo pipefail

CSV="data/2025-05-04_질문목록_수동필터링.csv"
RUN_ID="$(date +%Y%m%d-%H%M%S)-auto-full"
RUN_DIR="artifacts/qa-wiki/runs/$RUN_ID"
BATCH_SIZE="${BATCH_SIZE:-8}"
RETRY_BATCH_SIZE="${RETRY_BATCH_SIZE:-2}"
FINAL_BATCH_SIZE="${FINAL_BATCH_SIZE:-1}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"

uv run python scripts/qa_wiki_extract_langchain.py auto-full \
  --csv "$CSV" \
  --batch-size "$BATCH_SIZE" \
  --retry-batch-size "$RETRY_BATCH_SIZE" \
  --final-batch-size "$FINAL_BATCH_SIZE" \
  --max-attempts "$MAX_ATTEMPTS" \
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
find "$RUN_DIR/wiki" -maxdepth 1 -type f -printf '%f\t%s bytes\n' | sort
