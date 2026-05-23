# QA 위키 정제 파이프라인

이 문서는 `data/2025-05-04_질문목록_수동필터링.csv`를 LangChain 기반 SLM 추출로 구조화하고, 결과를 검증한 뒤 개념 문서 중심의 위키 초안으로 묶는 절차를 설명한다.

## 1. uv 환경 준비

```bash
uv sync
cp .env.example .env
```

기본 설정은 로컬 OpenAI-compatible completions 서버를 사용한다.

```text
QA_WIKI_BASE_URL=http://localhost:8000/v1
QA_WIKI_MODEL=leon-se/gemma-4-E4B-it-FP8-Dynamic
QA_WIKI_API_KEY=local
```

서버가 떠 있는지 확인한다.

```bash
bash request_test.sh
```

## 2. 샘플 추출로 프롬프트 엔지니어링

샘플 추출은 기본 20개 랜덤 게시글을 1개 배치로 처리한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv data/2025-05-04_질문목록_수동필터링.csv
```

더 작은 단위로 프롬프트를 점검하려면 다음처럼 실행한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv data/2025-05-04_질문목록_수동필터링.csv \
  --sample-size 1 \
  --batch-size 1
```

프롬프트만 생성하고 모델 호출을 하지 않으려면 `--prepare-only`를 붙인다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --prepare-only
```

프롬프트 수정 위치:

- `prompts/wiki_qa_extraction_system.md`: 역할, 스키마, 분류 기준
- `prompts/wiki_qa_extraction_user_template.md`: 배치 입력 지시
- `prompts/local_completion_wrapper.md`: 로컬 completion 모델용 turn wrapper

## 3. 전체 추출

권장 전체 실행은 `run_makewiki.sh`이다. 전체 CSV를 처리하고, `gall_num` 기준으로 성공한 게시글은 재호출하지 않으며, 실패한 게시글만 다음 attempt에서 다시 처리한 뒤 검증과 위키 생성을 이어서 수행한다.

```bash
bash run_makewiki.sh
```

직접 실행하려면 `auto-full`을 사용한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py auto-full \
  --csv data/2025-05-04_질문목록_수동필터링.csv \
  --batch-size 4 \
  --retry-batch-size 2 \
  --final-batch-size 1 \
  --max-attempts 4 \
  --max-tokens 2048
```

자동 재시도 기본 흐름:

```text
attempt 1: 전체 gall_num 처리
attempt 2..N: 직전까지 실패한 gall_num만 처리
final attempt: 기본 1개 단위로 격리 처리
```

기존 배치 단위 실행이 필요하면 `full`과 `--only-batches`를 사용할 수 있다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py full \
  --only-batches 1,3,8-10
```

기존 배치 단위 run에서 실패하거나 미완료된 배치는 같은 run directory에서 재개한다.

```bash
uv run python scripts/qa_wiki_extract_langchain.py resume \
  --run-dir artifacts/qa-wiki/runs/{run_id}
```

## 4. 중간 결과와 모니터링

각 실행은 `artifacts/qa-wiki/runs/{run_id}/`에 저장된다.

```text
run_config.json
manifest.json
batch_manifest.json
records.jsonl
batches/batch_0001.prompt.md
batches/batch_0001.input.md
raw/batch_0001.response.txt
parsed/batch_0001.json
validation/batch_0001.json
errors/batch_0001.json
jsonl/extractions.jsonl
events.jsonl
summary.json
```

`auto-full` run은 `attempts/attempt_01/`, `attempts/attempt_02/`처럼 시도별 배치 산출물을 나누어 저장한다. 최종 실패 게시글은 `failures/failed_posts.jsonl`에서 `gall_num` 기준으로 확인한다.

확인 우선순위:

1. `summary.json`: 전체 성공/실패 배치와 누적 추출 수
2. `events.jsonl`: 배치별 진행 이벤트와 오류 메시지
3. `raw/*.response.txt`: 모델 원문 응답
4. `validation/*.json`: 스키마, 게시글 번호, 배치 개수 검증 결과
5. `batches/*.prompt.md`: wrapper 전 프롬프트
6. `batches/*.input.md`: 실제 모델 입력

## 5. 실행 결과 검증

LangChain 실행기는 유효한 배치를 `jsonl/extractions.jsonl`로 합친다. 후처리 검증은 기존 파이프라인 스크립트로 수행한다.

```bash
uv run python scripts/qa_wiki_pipeline.py validate \
  artifacts/qa-wiki/runs/{run_id}/jsonl/extractions.jsonl \
  --source-csv data/2025-05-04_질문목록_수동필터링.csv \
  --report artifacts/qa-wiki/runs/{run_id}/validation_report.json
```

run directory의 parsed 결과에서 `extractions.jsonl`과 `summary.json`만 다시 만들려면:

```bash
uv run python scripts/qa_wiki_extract_langchain.py validate-run \
  --run-dir artifacts/qa-wiki/runs/{run_id}
```

## 6. 위키 초안 생성

```bash
uv run python scripts/qa_wiki_pipeline.py group \
  artifacts/qa-wiki/runs/{run_id}/jsonl/extractions.jsonl \
  --out-dir artifacts/qa-wiki/runs/{run_id}/wiki \
  --validate \
  --clean
```

생성물:

- `wiki/index.md`: 개념 문서 인덱스
- `wiki/*.md`: 개념별 FAQ 후보 문서

## 7. 모든 run 통합 위키 생성

여러 run의 추출 결과를 하나로 합쳐 전역 위키를 만들 수 있다. 같은 `gall_num`이 여러 run에 있으면 최신 run 결과를 사용한다.

```bash
bash makewiki_all_runs.sh
```

직접 실행하려면 다음 명령을 사용한다.

```bash
uv run python scripts/qa_wiki_pipeline.py group-runs \
  --runs-root artifacts/qa-wiki/runs \
  --out-dir artifacts/qa-wiki/wiki \
  --validate \
  --clean
```

생성물:

- `artifacts/qa-wiki/wiki/extractions.merged.jsonl`: 중복 제거된 통합 추출물
- `artifacts/qa-wiki/wiki/merge_report.json`: run별 반영 수와 중복 처리 리포트
- `artifacts/qa-wiki/wiki/index.md`, `*.md`: 통합 위키 초안

## 8. 수동 프롬프트 생성과 드라이런

모델 호출 없이 기존 방식의 수동 프롬프트 배치만 만들 수 있다.

```bash
uv run python scripts/qa_wiki_pipeline.py prepare \
  data/2025-05-04_질문목록_수동필터링.csv \
  --out-dir artifacts/qa-wiki/sample20 \
  --sample-size 20 \
  --seed 20260523 \
  --batch-size 20
```

SLM 없이 검증/그룹핑 흐름만 점검하려면 휴리스틱 초안을 만든다. 이 출력은 최종 데이터로 쓰지 않는다.

```bash
uv run python scripts/qa_wiki_pipeline.py heuristic \
  data/2025-05-04_질문목록_수동필터링.csv \
  --out-path artifacts/qa-wiki/heuristic_sample20.jsonl \
  --sample-size 20 \
  --seed 20260523

uv run python scripts/qa_wiki_pipeline.py validate \
  artifacts/qa-wiki/heuristic_sample20.jsonl \
  --source-csv data/2025-05-04_질문목록_수동필터링.csv

uv run python scripts/qa_wiki_pipeline.py group \
  artifacts/qa-wiki/heuristic_sample20.jsonl \
  --out-dir artifacts/qa-wiki/heuristic_wiki \
  --validate \
  --clean
```

## 운영 기준

- 최종 위키는 `개념 문서 + FAQ` 구조를 기본으로 한다.
- 커뮤니티 댓글 기반 답변은 공식 정답이 아니므로 설정 해석은 기본적으로 검토 대상으로 남긴다.
- 샘플 추출에서 프롬프트를 충분히 조정한 뒤 전체 추출을 실행한다.
- `needs_human_review`, `review_reason`, `answer_candidate.confidence`를 사람 검수 우선순위로 사용한다.
