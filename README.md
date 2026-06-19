# fg-lab-kr

슈타인즈 게이트 관련 게시판 Q&A, 공식/유저 자료, SLM 정제 프롬프트, LangChain 기반 추출 실행기를 모아둔 작업 저장소입니다. 핵심 흐름은 원본 CSV 질문/댓글 데이터를 구조화 JSON으로 추출하고, 이를 개념 문서 중심의 FAQ 위키 초안으로 묶는 것입니다.

## 기술 스택

- Python 3.12
- uv
- LangChain / langchain-openai
- Pydantic
- CSV, JSONL, Markdown

## 디렉터리 구조

```text
.
├── data/
│   ├── 2025-05-04_질문목록_수동필터링.csv
│   └── QA 탬플릿.md
├── reference/
│   ├── official/          공식 인터뷰, 공식 Q&A 자료 번역/정리
│   └── user/              유저 작성 해설 자료
├── wiki/
│   ├── README.md          위키 안내 및 근거 체계
│   ├── _template/         문서 템플릿 (main, depth)
│   └── lore/              핵심 설정 해설 문서
├── prompts/
│   ├── wiki_qa_extraction_system.md
│   ├── wiki_qa_extraction_user_template.md
│   ├── wiki_writing_system.md
│   ├── wiki_writing_user_template.md
│   └── local_completion_wrapper.md
├── scripts/
│   ├── qa_wiki_extract_langchain.py
│   └── qa_wiki_pipeline.py
├── docs/
│   ├── qa_wiki_pipeline.md
│   ├── plan.md
│   └── project-status.md
├── artifacts/
│   └── qa-wiki/
├── pyproject.toml
├── .env.example
└── request_test.sh
```

## 주요 구성

- `scripts/qa_wiki_extract_langchain.py`: LangChain으로 로컬 OpenAI-compatible SLM을 호출하고, 배치별 중간 산출물을 저장하는 실행기입니다.
- `scripts/qa_wiki_pipeline.py`: CSV 파싱, 수동 프롬프트 생성, SLM 출력 검증, 위키 초안 그룹핑을 담당하는 후처리 도구입니다.
- `prompts/`: 시스템 프롬프트, 유저 템플릿, 로컬 completion wrapper를 분리해 프롬프트 수정이 쉽도록 구성했습니다.
- `data/2025-05-04_질문목록_수동필터링.csv`: 게시판 질문/댓글 원본 데이터입니다.
- `reference/`: 위키 집필 근거 자료(공식 + 팬 해설)를 정리한 디렉터리입니다.
- `wiki/`: SLM으로 생성한 한국어 슈타인즈 게이트 설정 해설 위키입니다.
- `prompts/wiki_writing_*.md`: 위키 집필용 시스템 프롬프트와 유저 템플릿입니다.
- `artifacts/qa-wiki/runs/`: LangChain 추출 실행 결과가 실행 단위로 저장됩니다.
- `request_test.sh`: `http://localhost:8000/v1/completions` 로컬 SLM 서버 smoke test 스크립트입니다.

## 환경 설정

uv 환경 생성:

```bash
uv sync
```

로컬 설정 파일 생성:

```bash
cp .env.example .env
```

기본 `.env.example`은 `request_test.sh`와 같은 로컬 completions 엔드포인트를 가리킵니다.

```text
QA_WIKI_BASE_URL=http://localhost:8000/v1
QA_WIKI_MODEL=leon-se/gemma-4-E4B-it-FP8-Dynamic
QA_WIKI_API_KEY=local
```

로컬 SLM 서버 확인:

```bash
bash request_test.sh
```

## 빠른 시작

CLI 도움말 확인:

```bash
uv run python scripts/qa_wiki_extract_langchain.py --help
uv run python scripts/qa_wiki_pipeline.py --help
```

프롬프트 엔지니어링용 샘플 실행:

```bash
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv data/2025-05-04_질문목록_수동필터링.csv
```

전체 추출부터 재시도, 검증, 위키 생성까지 한 번에 실행:

```bash
bash run_makewiki.sh
```

`run_makewiki.sh`는 `gall_num` 기준으로 성공한 게시글을 잠그고, 실패한 게시글만 다음 attempt에서 다시 처리합니다. 새로 실행해도 이전 `auto-full` run의 성공 record를 재사용하므로 이미 성공한 `gall_num`은 다시 LLM에 보내지 않습니다. bash 기본값은 `BATCH_SIZE=4`, `RETRY_BATCH_SIZE=2`, `FINAL_BATCH_SIZE=1`, `MAX_ATTEMPTS=4`이며 환경 변수로 조정할 수 있습니다. LLM 동작 설정(`QA_WIKI_MAX_TOKENS`, `QA_WIKI_MAX_CONCURRENCY`, `QA_WIKI_TEMPERATURE` 등)은 `.env`로 제어합니다. `QA_WIKI_MAX_CONCURRENCY`를 2 이상으로 올리면 LLM 호출이 병렬로 전송되므로 서버 동시 처리 한도와 일치시켜야 합니다.

진행 결과는 가장 최근 `*-auto-full` run의 `summary.json`에서 확인합니다.

```bash
RUN_DIR="$(ls -td artifacts/qa-wiki/runs/*-auto-full | head -n 1)"
jq '{complete, total_record_count, completed_record_count, failed_record_count, attempt_count}' "$RUN_DIR/summary.json"
```

`failed_record_count`가 남아 있으면 `failures/failed_posts.jsonl`에서 마지막 실패 `gall_num`과 원인을 확인합니다.

기존 성공분까지 무시하고 완전히 새로 추출하려면 직접 실행 시 `--ignore-existing`을 붙입니다.

전체 추출만 직접 실행:

```bash
uv run python scripts/qa_wiki_extract_langchain.py auto-full \
  --csv data/2025-05-04_질문목록_수동필터링.csv \
  --batch-size 4 \
  --retry-batch-size 2 \
  --final-batch-size 1 \
  --max-attempts 4 \
  --max-tokens 2048
```

실패/미완료 배치 재개:

```bash
uv run python scripts/qa_wiki_extract_langchain.py resume \
  --run-dir artifacts/qa-wiki/runs/{run_id}
```

`resume`은 기존 배치 단위 run용입니다. 게시글 ID 단위 자동 재시도는 `auto-full` 또는 `run_makewiki.sh`를 사용합니다.

실행 결과 검증:

```bash
uv run python scripts/qa_wiki_pipeline.py validate \
  artifacts/qa-wiki/runs/{run_id}/jsonl/extractions.jsonl \
  --source-csv data/2025-05-04_질문목록_수동필터링.csv \
  --report artifacts/qa-wiki/runs/{run_id}/validation_report.json
```

위키 초안 생성:

```bash
uv run python scripts/qa_wiki_pipeline.py group \
  artifacts/qa-wiki/runs/{run_id}/jsonl/extractions.jsonl \
  --out-dir artifacts/qa-wiki/runs/{run_id}/wiki \
  --validate \
  --clean
```

모든 run을 통합한 위키 초안 생성:

```bash
bash makewiki_all_runs.sh
```

직접 실행하려면 다음 명령을 사용합니다.

```bash
uv run python scripts/qa_wiki_pipeline.py group-runs \
  --runs-root artifacts/qa-wiki/runs \
  --out-dir artifacts/qa-wiki/wiki \
  --validate \
  --clean
```

통합 명령은 `artifacts/qa-wiki/runs/*/jsonl/extractions.jsonl`을 모두 읽고, 같은 `gall_num`은 최신 run 결과를 사용해 `artifacts/qa-wiki/wiki/`에 위키를 만듭니다. 주요 산출물은 `index.md`, `extractions.merged.jsonl`, `merge_report.json`, `validation_report.json`입니다.

## 실행 산출물

LangChain 실행기는 각 실행을 `artifacts/qa-wiki/runs/{run_id}/` 아래에 저장합니다.

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

`auto-full` run은 같은 run directory 안에 `attempts/attempt_01/`, `attempts/attempt_02/`처럼 시도별 배치 산출물을 나누어 저장하고, 최종 실패 게시글은 `failures/failed_posts.jsonl`에 남깁니다. 최종 성공분만 `jsonl/extractions.jsonl`에 합쳐지므로 같은 `gall_num`이 중복 저장되지 않습니다.

- `*.prompt.md`: wrapper 적용 전 프롬프트입니다.
- `*.input.md`: 로컬 completion wrapper까지 적용된 실제 모델 입력입니다.
- `raw/`: 모델 원문 응답입니다.
- `parsed/`: JSON 파싱 후 Pydantic으로 정규화한 결과입니다.
- `validation/`: 배치별 스키마/개수/게시글 번호 검증 결과입니다.
- `events.jsonl`: 배치 시작, 완료, 실패 이벤트 로그입니다.
- `summary.json`: 전체/성공/실패 게시글 수, attempt 수, 완료 여부 요약입니다.

## 프롬프트 수정 위치

- `prompts/wiki_qa_extraction_system.md`: 역할, 출력 스키마, 분류 기준, 검토 기준을 조정합니다.
- `prompts/wiki_qa_extraction_user_template.md`: 배치 입력 지시와 JSON 출력 규칙을 조정합니다.
- `prompts/local_completion_wrapper.md`: `request_test.sh`와 같은 로컬 completion 모델의 turn wrapper를 조정합니다.

## Docker — holyclaude 에이전트 팀

Claude Code 에이전트 팀과 관리 UI를 Docker로 실행합니다.

```bash
cd docker/holyclaude
docker compose --env-file ../../.env up -d --build
```

| 서비스 | 포트 | 역할 |
|---|---|---|
| `holyclaude` | 3001 | Claude Code 에이전트 팀 (위키 집필 · 제안 처리) |
| `sg-wiki-admin` | 3002 | 관리 UI — cron 스케줄 · 수동 트리거 · 실행 현황 |

**관리 UI** (`http://localhost:3002`):
- 파이프라인 1 (콘텐츠 생성) / 파이프라인 2 (제안 처리) 수동 실행
- Cron 스케줄 설정 (APScheduler, 기본값 `0 * * * *`)
- 최근 실행 로그 자동 갱신

파이프라인 1은 `sg-wiki-admin`이 Docker socket을 통해 `holyclaude`
컨테이너 안에서 `/workspace/scripts/run_holyclaude_pipeline.mjs`를 실행합니다.
실행 중 상태는 관리 UI의 "진행 중인 작업"과 `holyclaude` 로그 스트림에서 확인할 수
있고, 결과 요약은 `.admin/runs/*.json`에 저장됩니다.

관련 환경 변수:

- `HOLYCLAUDE_CONTAINER`: 실행 대상 컨테이너 이름, 기본값 `holyclaude`
- `P1_SCRIPT`: 컨테이너 내부 P1 실행 스크립트, 기본값 `/workspace/scripts/run_holyclaude_pipeline.mjs`
- `ADMIN_RUN_OUTPUT_LIMIT`: 실행 로그 저장 tail 길이, 기본값 `30000`

**제안 처리 파이프라인 로컬 테스트:**

```bash
# mock R2 데이터(data/mock-r2/suggestions/)로 폴링 시뮬레이션
R2_MOCK=1 python scripts/poll_suggestions.py
```

멱등성 보장: `suggestions/processed/{id}` 파일이 존재하면 재처리 안 함.

설계 문서: [holyclaude 위키 에이전트 팀 설계](docs/holyclaude-wiki-agent-팀-설계.md)

## 문서

- [QA 위키 정제 파이프라인](docs/qa_wiki_pipeline.md)
- [프로젝트 현황](docs/project-status.md)
- [위키 안내 및 근거 체계](wiki/README.md)
