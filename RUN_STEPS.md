# QA Wiki Sample Run Follow-up Steps

아래 절차는 다음 샘플 추출 명령을 이미 실행한 뒤 이어서 수행하는 단계다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv data/2025-05-04_질문목록_수동필터링.csv \
  --batch-size 4
```

샘플 실행은 `artifacts/qa-wiki/runs/{run_id}/` 아래에 배치 입력, 원문 응답, 파싱 결과, 검증 결과, 통합 JSONL을 만든다. 이후 단계는 해당 run directory를 기준으로 진행한다.

## 빠른 실행 흐름

권장 흐름은 먼저 sample 전체 파이프라인을 끝까지 돌린 뒤, `wiki/index.md`와 검증 리포트를 확인하고 문제가 없으면 full 전체 파이프라인을 실행하는 것이다.

```text
sample extraction -> validate -> group -> inspect wiki
full extraction   -> validate -> group -> inspect wiki
```

아래 "한 번에 실행" 섹션의 명령은 `--run-id`를 명시해서 방금 만든 run directory를 안정적으로 다시 참조한다.

## 1. Run Directory 지정

가장 최근 sample run을 대상으로 작업하려면 아래처럼 지정한다.

```bash
RUN_DIR="$(ls -td artifacts/qa-wiki/runs/*-sample | head -n 1)"
echo "$RUN_DIR"
```

특정 run을 고정해서 작업하려면 직접 지정한다.

```bash
RUN_DIR="artifacts/qa-wiki/runs/20260523-113344-sample"
```

## 2. 실행 요약 확인

먼저 전체 배치 수, 성공 배치 수, 실패 배치, 추출 레코드 수를 확인한다.

```bash
jq . "$RUN_DIR/summary.json"
```

진행 이벤트와 배치별 완료 여부를 확인한다.

```bash
tail -n 50 "$RUN_DIR/events.jsonl"
```

배치별 검증 결과를 요약해서 본다.

```bash
for report in "$RUN_DIR"/validation/*.json; do
  echo "== $report =="
  jq '{batch_number, valid, expected_count, actual_count, missing_gall_nums, unexpected_gall_nums, pydantic_error_count, record_error_count}' "$report"
done
```

## 3. 실패 또는 미완료 배치 재개

`summary.json`의 `failed_batch_numbers`가 비어 있지 않거나, `events.jsonl`에 오류가 있으면 같은 run directory에서 재개한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py resume \
  --run-dir "$RUN_DIR"
```

재개 후 다시 요약을 확인한다.

```bash
jq . "$RUN_DIR/summary.json"
```

## 4. 통합 추출물 스키마 검증

`jsonl/extractions.jsonl`이 원본 CSV의 게시글 번호와 맞고, 필수 필드/분류값/중복 문제가 없는지 검증한다.

```bash
uv run python scripts/qa_wiki_pipeline.py validate \
  "$RUN_DIR/jsonl/extractions.jsonl" \
  --source-csv data/2025-05-04_질문목록_수동필터링.csv \
  --report "$RUN_DIR/validation_report.json"
```

검증 리포트를 확인한다.

```bash
jq . "$RUN_DIR/validation_report.json"
```

정상 기준:

- `error_count`가 `0`
- `duplicate_gall_nums`가 빈 배열
- `valid_count`가 `record_count`와 같음

## 5. 필요 시 통합 JSONL 재생성

개별 `parsed/batch_*.json` 파일은 정상인데 `jsonl/extractions.jsonl` 또는 `summary.json`만 다시 만들고 싶을 때 실행한다. 이 명령은 `summary.json`의 `updated_at`을 갱신한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py validate-run \
  --run-dir "$RUN_DIR"
```

## 6. 위키 초안 생성

검증이 통과하면 추출 JSONL을 개념별 위키 초안 Markdown으로 묶는다.

```bash
uv run python scripts/qa_wiki_pipeline.py group \
  "$RUN_DIR/jsonl/extractions.jsonl" \
  --out-dir "$RUN_DIR/wiki" \
  --validate \
  --clean
```

생성물:

- `wiki/index.md`: 개념 문서 인덱스
- `wiki/*.md`: 개념별 FAQ 후보 문서

## 7. 위키 산출물 점검

생성된 문서 목록을 확인한다.

```bash
find "$RUN_DIR/wiki" -maxdepth 1 -type f -printf '%f\t%s bytes\n' | sort
```

인덱스를 확인한다.

```bash
sed -n '1,120p' "$RUN_DIR/wiki/index.md"
```

검토가 필요한 항목 수를 빠르게 확인한다.

```bash
jq -s '{
  total: length,
  needs_review: map(select(.needs_human_review == true)) | length,
  answered: map(select(.answer_candidate.status == "answered")) | length,
  partial: map(select(.answer_candidate.status == "partial")) | length,
  conflicting: map(select(.answer_candidate.status == "conflicting")) | length,
  unanswered: map(select(.answer_candidate.status == "unanswered")) | length
}' "$RUN_DIR/jsonl/extractions.jsonl"
```

## 8. 최종 완료 기준

아래 조건을 만족하면 sample run 후처리는 완료로 본다.

- `summary.json`에서 실패 배치가 없음
- `validation_report.json`에서 `error_count`가 `0`
- `jsonl/extractions.jsonl` 레코드 수가 기대 샘플 수와 일치함
- `wiki/index.md`와 개념별 `wiki/*.md`가 생성됨
- `needs_human_review: true` 항목은 게시 전 별도 검수 대상으로 남김

## 9. 한 번에 실행: 샘플 파이프라인

샘플 추출부터 검증, 위키 초안 생성, 핵심 결과 확인까지 한 번에 실행한다.

```bash
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
```

샘플에서 실패 배치가 생기면 같은 `RUN_DIR`로 재개한 뒤 검증과 group을 다시 실행한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py resume \
  --run-dir "$RUN_DIR"

uv run python scripts/qa_wiki_pipeline.py validate \
  "$RUN_DIR/jsonl/extractions.jsonl" \
  --source-csv "$CSV" \
  --report "$RUN_DIR/validation_report.json"

uv run python scripts/qa_wiki_pipeline.py group \
  "$RUN_DIR/jsonl/extractions.jsonl" \
  --out-dir "$RUN_DIR/wiki" \
  --validate \
  --clean
```

샘플 확인 포인트:

- `validation_report.json`의 `error_count`가 `0`
- `summary.json`의 `failed_batch_numbers`가 빈 배열
- `wiki/index.md`가 생성되고 개념별 문서 링크가 보임
- `needs_human_review` 비율과 답변 품질이 사람이 검수 가능한 수준임

## 10. 한 번에 실행: 전체 파이프라인

샘플 결과가 괜찮으면 `run_makewiki.sh`로 전체 CSV를 처리한다. 이 스크립트는 `gall_num` 기준으로 성공한 게시글을 잠그고, 실패한 게시글만 다음 attempt에서 다시 처리한다. 예를 들어 1차에서 60개 성공/40개 실패, 2차에서 실패 40개 중 35개 성공/5개 실패라면 3차는 남은 5개만 처리한다. 새로 실행해도 이전 `auto-full` run의 성공 record를 먼저 재사용하므로 이미 성공한 `gall_num`은 다시 LLM에 보내지 않는다.

```bash
bash run_makewiki.sh
```

기본값은 다음과 같다.

bash 기본값:

- `BATCH_SIZE=4`: 1차 전체 처리 배치 크기 (1 request에 담는 게시글 수)
- `RETRY_BATCH_SIZE=2`: 중간 재시도 배치 크기
- `FINAL_BATCH_SIZE=1`: 마지막 attempt 격리 처리 크기
- `MAX_ATTEMPTS=4`: 최대 attempt 수

LLM 동작 설정은 `.env`로 제어한다 (Python이 자동 로드). 주요 항목:

- `QA_WIKI_MAX_TOKENS=2048`: LLM 출력 토큰 상한
- `QA_WIKI_MAX_CONCURRENCY=1`: 동시 in-flight LLM request 수 (1=순차, 2 이상=병렬). LLM 서버의 동시 처리 한도와 일치시켜야 한다.
- `QA_WIKI_TEMPERATURE`, `QA_WIKI_TIMEOUT`, `QA_WIKI_MAX_RETRIES`: 생성 파라미터

필요하면 환경 변수로 조정한다.

```bash
BATCH_SIZE=8 RETRY_BATCH_SIZE=2 FINAL_BATCH_SIZE=1 MAX_ATTEMPTS=5 QA_WIKI_MAX_TOKENS=4096 QA_WIKI_MAX_CONCURRENCY=4 bash run_makewiki.sh
```

`MAX_ATTEMPTS` 안에 모든 게시글이 성공하면 검증과 run별 위키 생성까지 자동으로 이어진다. 실패가 남으면 스크립트는 중단되고, 해당 run의 `summary.json`과 `failures/failed_posts.jsonl`에 남은 `gall_num`이 기록된다.

실패가 남은 경우 먼저 마지막 run directory를 잡고 상태를 확인한다.

```bash
RUN_DIR="$(ls -td artifacts/qa-wiki/runs/*-auto-full | head -n 1)"

jq '{complete, total_record_count, completed_record_count, failed_record_count, failed_gall_nums, attempt_count}' "$RUN_DIR/summary.json"
sed -n '1,120p' "$RUN_DIR/failures/failed_posts.jsonl"
```

주의: `run_makewiki.sh`를 다시 실행하면 새 run을 만들지만, 기본적으로 이전 `auto-full` run의 성공 record를 재사용한다. 완전히 새로 추출해야 할 때만 `qa_wiki_extract_langchain.py auto-full --ignore-existing ...`를 직접 사용한다. 실패가 자주 남으면 `MAX_ATTEMPTS`를 늘리거나 `FINAL_BATCH_SIZE=1`을 유지해 격리 시도를 충분히 확보한다.

전체 실행 완료 후 최종 점검:

```bash
RUN_DIR="$(ls -td artifacts/qa-wiki/runs/*-auto-full | head -n 1)"

jq '{complete, total_record_count, completed_record_count, failed_record_count, attempt_count}' "$RUN_DIR/summary.json"

jq -s '{
  total: length,
  needs_review: map(select(.needs_human_review == true)) | length,
  answered: map(select(.answer_candidate.status == "answered")) | length,
  partial: map(select(.answer_candidate.status == "partial")) | length,
  conflicting: map(select(.answer_candidate.status == "conflicting")) | length,
  unanswered: map(select(.answer_candidate.status == "unanswered")) | length
}' "$RUN_DIR/jsonl/extractions.jsonl"
```

## 11. 모든 run 통합 위키 생성

run별 위키가 아니라 지금까지 생성된 모든 run을 합친 전역 위키를 만들려면 다음을 실행한다. 같은 `gall_num`이 여러 run에 있으면 최신 run 결과가 반영된다. 이 스크립트는 통합 위키 생성, 통합 JSONL 검증, 핵심 리포트 출력을 한 번에 수행한다.

```bash
bash makewiki_all_runs.sh
```

직접 실행할 때는 다음 명령을 사용한다.

```bash
uv run python scripts/qa_wiki_pipeline.py group-runs \
  --runs-root artifacts/qa-wiki/runs \
  --out-dir artifacts/qa-wiki/wiki \
  --validate \
  --clean
```

확인 파일:

- `artifacts/qa-wiki/wiki/extractions.merged.jsonl`
- `artifacts/qa-wiki/wiki/merge_report.json`
- `artifacts/qa-wiki/wiki/validation_report.json`
- `artifacts/qa-wiki/wiki/index.md`

통합 결과 요약을 빠르게 확인한다.

```bash
jq '{
  run_count,
  source_record_count,
  record_count,
  duplicate_count: (.duplicate_gall_nums | length),
  invalid_record_count,
  dedupe_policy
}' artifacts/qa-wiki/wiki/merge_report.json
```

통합 JSONL에 중복 `gall_num`이나 스키마 오류가 없는지 확인한다.

```bash
jq . artifacts/qa-wiki/wiki/validation_report.json
```

정상 기준:

- `merge_report.json`의 `invalid_record_count`가 `0`
- `validation_report.json`의 `error_count`가 `0`
- `validation_report.json`의 `duplicate_gall_nums`가 빈 배열
- `artifacts/qa-wiki/wiki/index.md`와 개념별 `*.md` 파일이 생성됨
