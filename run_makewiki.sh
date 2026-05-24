set -uo pipefail

CSV="data/2025-05-04_질문목록_수동필터링.csv"
# RUN_ID에 PID 포함: 동일 초 내 동시 실행 시 충돌 방지
RUN_ID="$(date +%Y%m%d-%H%M%S)-$$-auto-full"
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
EXTRACT_EXIT=$?

# auto-full 비0 exit 여도 부분 산출물이 있으면 validate/group 시도
VALIDATE_EXIT=0
GROUP_EXIT=0
if [ -s "$RUN_DIR/jsonl/extractions.jsonl" ]; then
  uv run python scripts/qa_wiki_pipeline.py validate \
    "$RUN_DIR/jsonl/extractions.jsonl" \
    --source-csv "$CSV" \
    --report "$RUN_DIR/validation_report.json"
  VALIDATE_EXIT=$?

  if [ -f "$RUN_DIR/validation_report.json" ]; then
    uv run python scripts/qa_wiki_pipeline.py group \
      "$RUN_DIR/jsonl/extractions.jsonl" \
      --out-dir "$RUN_DIR/wiki" \
      --validate \
      --clean
    GROUP_EXIT=$?
  fi
fi

echo "RUN_DIR=$RUN_DIR"
echo "EXTRACT_EXIT=$EXTRACT_EXIT VALIDATE_EXIT=$VALIDATE_EXIT GROUP_EXIT=$GROUP_EXIT"
[ -f "$RUN_DIR/summary.json" ] && jq . "$RUN_DIR/summary.json"
[ -f "$RUN_DIR/validation_report.json" ] && jq . "$RUN_DIR/validation_report.json"
[ -f "$RUN_DIR/wiki/index.md" ] && sed -n '1,120p' "$RUN_DIR/wiki/index.md"
[ -d "$RUN_DIR/wiki" ] && find "$RUN_DIR/wiki" -maxdepth 1 -type f -printf '%f\t%s bytes\n' | sort

# 원래 extract 종료 코드를 보존하여 CI/외부 호출자 호환 유지
exit "$EXTRACT_EXIT"
