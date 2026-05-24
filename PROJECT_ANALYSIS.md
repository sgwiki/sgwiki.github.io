# fg-lab-kr 프로젝트 분석서

> 작성일: 2026-05-23

---

## 1. 프로젝트 개요

**fg-lab-kr**은 슈타인즈 게이트(Steins;Gate) 한국어 커뮤니티의 게시판 Q&A 데이터를 구조화된 JSON으로 추출하고, 이를 개념 문서 중심의 **FAQ 위키 초안**으로 자동 생성하는 데이터 정제 파이프라인 프로젝트다.

핵심 흐름은 다음과 같다:

```
원본 CSV (게시판 질문/댓글)
  → LangChain 기반 로컬 SLM 호출로 구조화 JSON 추출
  → 스키마 검증 + 품질 검증
  → 개념(concept)별 위키 Markdown 초안 생성
```

---

## 2. 기술 스택

| 구분 | 기술 |
| --- | --- |
| 언어 | Python 3.12 |
| 패키지 매니저 | uv |
| LLM 프레임워크 | LangChain, langchain-openai |
| 데이터 모델링 | Pydantic v2 |
| 데이터 포맷 | CSV, JSONL, Markdown |
| LLM 서버 | 로컬 OpenAI-compatible SLM (`leon-se/gemma-4-E4B-it-FP8-Dynamic`) |
| CLI UI | Rich (진행률 표시) |

---

## 3. 디렉터리 구조

```
fg-lab-kr/
├── data/                          # 원본 데이터
│   ├── 2025-05-04_질문목록_수동필터링.csv  # 게시판 Q&A 원본 (1,605건)
│   ├── QA 탬플릿.md
│   ├── qa_마로니.md
│   ├── 어트랙터 필드 이론과 그 외 등등.md
│   ├── 어트랙터 필드 이론과 그 외 등등_요약.md
│   └── 타임리프머신_사용_나에_어디로.md
├── 공식/                          # 공식 자료 (번역/정리)
│   ├── 『STEINS;GATE RE-BOOT』 일본 매체 인터뷰 전문 번역.md
│   ├── 슈타게 WePlay Expo 2025 개발자 토크 전문.md
│   └── 슈타게_공식_QA자료집.md
├── 유저/                          # 유저 작성 해설 자료
│   └── The Mechanics of Steins Gate v1.0.3/
│       ├── 0. Prologue.md ~ 5. Acknowledgements.md
│       └── LICENSE.txt
├── prompts/                       # LLM 프롬프트 정의
│   ├── wiki_qa_extraction_system.md       # 시스템 프롬프트 (역할, 스키마, 분류 기준)
│   ├── wiki_qa_extraction_user_template.md # 유저 템플릿 (배치 입력 지시)
│   └── local_completion_wrapper.md        # 로컬 모델 turn wrapper
├── scripts/                       # 핵심 실행 스크립트 (총 3,079줄)
│   ├── qa_wiki_extract_langchain.py  # LangChain LLM 실행기 (1,709줄)
│   └── qa_wiki_pipeline.py           # CSV 파싱/검증/위키 생성 (1,370줄)
├── docs/                          # 문서
│   ├── plan.md                    # 검토 결과 및 수정 권장안
│   └── qa_wiki_pipeline.md        # 파이프라인 상세 설명
├── artifacts/                     # 실행 산출물 (gitignore)
│   └── qa-wiki/
│       ├── runs/                  # 실행별 산출물 (run_id 단위)
│       └── wiki/                  # 통합 위키 산출물
├── pyproject.toml
├── .env.example
├── run_makewiki.sh                # 전체 파이프라인 실행 스크립트
├── makewiki_all_runs.sh           # 모든 run 통합 위키 생성
├── makewiki_sample.sh             # 샘플 실행
├── request_test.sh                # 로컬 SLM 서버 smoke test
└── README.md / RUN_STEPS.md
```

---

## 4. 핵심 스크립트 분석

### 4.1 `scripts/qa_wiki_extract_langchain.py` (1,709줄)

LangChain을 통해 로컬 SLM에 배치 단위로 요청을 보내고, 응답을 파싱/검증/저장하는 **LLM 실행기**다.

**주요 기능:**
- **`sample`**: 샘플 게시글 추출 (프롬프트 엔지니어링용)
- **`full`**: 전체 게시글 배치 추출
- **`auto-full`**: 자동 재시도 포함 전체 추출 (핵심 모드)
  - `gall_num` 기준으로 성공한 게시글은 재호출하지 않음
  - 이전 `auto-full` run의 성공 record 자동 재사용
  - attempt별 배치 크기 점진 축소 (8→2→1)
  - SIGINT(Ctrl+C) 수신 시 부분 산출물 보존
  - 서킷 브레이커: 연속 rate-limit/auth 에러 3회 시 나머지 배치 스킵
- **`resume`**: 기존 run에서 실패 배치만 재개

**Pydantic 모델:**
- `ExtractionRecord`: 추출 결과 스키마 (gall_num, question_type, concept_candidates, answer_candidate 등)
- `ConceptCandidate`: 개념 후보 (concept_id, label, primary/secondary)
- `AnswerCandidate`: 답변 후보 (status, summary, confidence, evidence)

**JSON 응답 파싱 전략** (10단계 fallback):
1. 전체 텍스트 → JSON
2. 과도 이스케이프 제거 후 재시도
3. Markdown 코드펜스 내부 추출
4. `[`/`]` 슬라이스
5. `{`/`}` 슬라이스
6. 부분 JSON 배열 복구 (truncated 응답 대응)

### 4.2 `scripts/qa_wiki_pipeline.py` (1,370줄)

CSV 파싱, 프롬프트 생성, 검증, 위키 그룹핑을 담당하는 **후처리 도구**다. 표준 라이브러리만 사용한다.

**주요 기능:**
- **`prepare`**: CSV → 배치 프롬프트 Markdown 생성
- **`validate`**: JSONL 스키마 검증 (필수 필드, enum, 중복 gall_num 등)
- **`group`**: 추출 JSONL → 개념별 위키 Markdown 생성
- **`group-runs`**: 여러 run 통합 → 전역 위키 생성 (최신 run 우선)
- **`heuristic`**: SLM 없이 규칙 기반 초안 생성 (드라이런용)

**개념 카탈로그 (CONCEPT_CATALOG):**
15개 표준 개념 정의 — 각 concept_id, 한국어 label, 키워드 목록 포함:

| concept_id | 라벨 | 우선순위 |
| --- | --- | --- |
| `worldline` | 세계선 | 1 |
| `attractor_field` | 어트랙터 필드와 수속 | 1 |
| `reading_steiner` | 리딩 슈타이너 | 1 |
| `dmail` | D메일 | 0 |
| `time_leap` | 타임리프와 타임리프 머신 | 0 |
| `phonewave` | 전화렌지와 시간 이동 장치 | 0 |
| `time_machine` | 타임머신 | 0 |
| `sern_rounder` | SERN과 라운더 | 1 |
| `zero_23b` | 슈타인즈 게이트 제로와 23.5화 | 1 |
| `movie_mail` | 무비메일과 오퍼레이션 스쿨드 | 1 |
| `ibn5100` | IBN5100 | 1 |
| `viewing_order` | 시청 및 플레이 순서 | 2 |
| `platform_patch` | 게임 구매와 한글패치 | 2 |
| `ost_media` | OST와 관련 자료 | 2 |
| `character_events` | 캐릭터와 사건 해석 | 9 |

**ALIAS 매핑:**
LLM이 생성한 비표준 concept_id를 표준 catalog로 흡수하는 alias 체계 운영. 예: `amadeus_system` → `amadeus`, `media_merchandise` → `merchandise` 등.

---

## 5. 데이터 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                    data/*.csv (1,605건)                      │
│            gall_num, title, post, comments, url ...          │
└────────────────────────┬────────────────────────────────────┘
                         │ load_posts()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              PostRecord (Pydantic dataclass)                 │
│         게시글 + 댓글 리스트 + 메타데이터                     │
└────────────────────────┬────────────────────────────────────┘
                         │ render_batch_prompt()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          배치 프롬프트 (Markdown + JSON input)               │
│     system prompt + concept catalog + user template + JSON   │
└────────────────────────┬────────────────────────────────────┘
                         │ wrap_prompt() → call_llm()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              SLM 원문 응답 (raw/*.response.txt)              │
│                JSON (또는 마크다운 코드펜스)                  │
└────────────────────────┬────────────────────────────────────┘
                         │ parse_llm_response() (10단계 fallback)
                         │ coerce_records_with_pydantic()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            ExtractionRecord (구조화된 JSON)                  │
│   gall_num, question_type, concept_candidates, answer, ...  │
└────────────────────────┬────────────────────────────────────┘
                         │ validate_extraction()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          jsonl/extractions.jsonl (성공 record 통합)          │
│           + validation_report.json (스키마 검증)             │
└────────────────────────┬────────────────────────────────────┘
                         │ write_grouped_wiki()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 wiki/ (개념별 Markdown)                      │
│     index.md + {concept_id}.md (FAQ 후보 문서)              │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 실행 모드와 산출물

### 6.1 샘플 실행 (프롬프트 튜닝용)

```bash
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv data/2025-05-04_질문목록_수동필터링.csv
```

기본 20개 랜덤 게시글을 1배치로 처리. 프롬프트 수정→재실행 반복.

### 6.2 전체 자동 실행 (권장)

```bash
bash run_makewiki.sh
```

동작:
1. `auto-full` 모드로 전체 1,605건 처리
2. attempt별 배치 크기: 8→2→1 점진 축소
3. 이전 run 성공 record 재사용 (`gall_num` 기준)
4. 최대 4회 attempt 후 실패 건은 `failures/failed_posts.jsonl`에 기록
5. 성공 시 자동으로 validate → group 실행

### 6.3 통합 위키 생성

```bash
bash makewiki_all_runs.sh
```

모든 run의 추출 결과를 합쳐 전역 위키 생성. 같은 `gall_num`은 최신 run 우선.

### 6.4 산출물 구조

```
artifacts/qa-wiki/runs/{run_id}/
├── run_config.json          # 실행 설정
├── manifest.json            # 실행 메타
├── summary.json             # 성공/실패/record 수 요약
├── events.jsonl             # 배치 진행 이벤트 로그
├── jsonl/extractions.jsonl  # 성공 record 통합
├── validation_report.json   # 스키마 검증 리포트
├── failures/failed_posts.jsonl  # 최종 실패 게시글
├── wiki/                    # 개념별 위키 Markdown
│   ├── index.md
│   └── *.md
└── attempts/                # auto-full 시도별 산출물
    ├── attempt_01/
    │   ├── batches/*.prompt.md / *.input.md
    │   ├── raw/*.response.txt
    │   ├── parsed/*.json
    │   └── validation/*.json
    └── attempt_02/ ...
```

---

## 7. LLM 프롬프트 구성

### 7.1 시스템 프롬프트 (`wiki_qa_extraction_system.md`)
- **역할**: 게시판 Q&A를 위키용 지식 항목으로 정제하는 한국어 데이터 정제기
- **핵심 규칙**: 원문에 없는 사실 금지, 답변 불충분 시 partial/unanswered 사용, 공식 근거 필요시 human_review
- **출력 스키마**: 13개 필드 (gall_num, question_type, concept_candidates, answer_candidate 등)
- **분류 가이드**: 8개 질문 유형 (설정해석, 시청순서, 작품관계, 캐릭터/사건, 게임/플랫폼, 번역/한글패치, OST/자료, 기타)
- **검토 가이드**: confidence/needs_human_review 판단 기준

### 7.2 유저 템플릿 (`wiki_qa_extraction_user_template.md`)
- 입력 배열의 각 게시글을 독립적으로 정제하라는 지시
- 출력 배열 = 입력 배열과 동일 길이/순서
- JSON 외 텍스트 출력 금지

### 7.3 로컬 래퍼 (`local_completion_wrapper.md`)
- 로컬 SLM의 completion 토큰 제한에 맞춘 turn wrapper

---

## 8. 검증 체계

### 8.1 필수 필드 검증
13개 필드 존재 여부 + 타입 검사

### 8.2 Enum 값 검증
- `question_type`: 8개 허용값
- `spoiler_level`: 5단계 (none → endgame)
- `wiki_action`: 4개 액션
- `answer_candidate.status`: 4개 상태
- `answer_candidate.confidence`: 3단계

### 8.3 경고 수준 검증 (warning-only)
- primary concept_candidates 정확히 1개인지
- evidence_comment_indexes 음수/비정수 여부
- entities 키가 허용 집합 부분집합인지

### 8.4 중복 검증
- `gall_num` 중복 감지 (통합 시 최신 run 우선)

---

## 9. 실측 데이터 (최근 실행 기준)

| 항목 | 값 |
| --- | --- |
| 원본 게시글 수 | 1,605건 |
| 성공 추출 (reused 포함) | ~1,605건 (run에 따라 상이) |
| 이전 run 재사용 | 211건 |
| 위키 그룹 수 | 66개 (catalog 16개 + misc 50개) |
| top 16 그룹 점유율 | 98% (1,573건) |
| needs_human_review | 774건 (48%) |
| 답변 상태 분포 | answered 66% / partial 24% / conflicting 6% / unanswered 4% |
| primary 위반 | 21건 (1.3%) |
| single-record 그룹 | 50개 (fragmentation 이슈) |

---

## 10. 알려진 이슈 및 개선 계획

`docs/plan.md`에 정리된 검토 결과 기준:

### P1 — 인터럽트 회복성
- **SIGINT 핸들러**: Ctrl+C 시 부분 산출물 즉시 flush (구현 완료)
- **reused records 즉시 flush**: 첫 attempt 전에 성공 record 기록 (구현 완료)
- **run_makewiki.sh 가드**: `set -uo pipefail` + 파일 존재 확인 (구현 완료)

### P2 — 비용 누수 방지
- **mode 필터 완화**: full/sample run의 record도 재사용 가능 (구현 완료)
- **서킷 브레이커**: 429/credit/auth 에러 3회 연속 시 남은 배치 스킵 (구현 완료)

### P3 — 출력 품질
- **validation 강화**: primary_count, evidence_index, entities_keys 검증 (구현 완료)
- **Singleton 그룹 병합**: 50개 → ≤20개 목표
- **Concept alias 매핑**: 의미 중복 그룹 통합 (구현 완료)

### P4 — 운영 편의
- **내부 마커 분리**: `_auto_*` 필드를 provenance로 분리
- **RUN_ID 충돌 회피**: PID 포함 (구현 완료)
- **wrapper 자동 비활성화**: `--wrapper-prompt=none` 옵션 (구현 완료)

---

## 11. 환경 설정

```bash
# 1. uv 환경 생성
uv sync

# 2. 로컬 설정
cp .env.example .env

# 3. 로컬 SLM 서버 확인
bash request_test.sh
```

**.env 주요 설정:**
| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `QA_WIKI_BASE_URL` | `http://localhost:8000/v1` | SLM 서버 엔드포인트 |
| `QA_WIKI_MODEL` | `leon-se/gemma-4-E4B-it-FP8-Dynamic` | 모델명 |
| `QA_WIKI_API_KEY` | `local` | API 키 |
| `QA_WIKI_TEMPERATURE` | `0.1` | 생성 온도 |
| `QA_WIKI_MAX_TOKENS` | `2048` | 출력 토큰 상한 |
| `QA_WIKI_MAX_CONCURRENCY` | `1` | 동시 요청 수 |
| `QA_WIKI_TIMEOUT` | `120` | 요청 타임아웃 (초) |

---

## 12. 빠른 실행 가이드

```bash
# 샘플 실행 (프롬프트 튜닝)
uv run python scripts/qa_wiki_extract_langchain.py sample \
  --csv data/2025-05-04_질문목록_수동필터링.csv

# 전체 실행 (권장)
bash run_makewiki.sh

# 환경 변수 커스텀 실행
BATCH_SIZE=8 QA_WIKI_MAX_CONCURRENCY=4 bash run_makewiki.sh

# 통합 위키 생성
bash makewiki_all_runs.sh

# 결과 확인
RUN_DIR="$(ls -td artifacts/qa-wiki/runs/*-auto-full | head -n 1)"
jq . "$RUN_DIR/summary.json"
```

---

## 13. 의존성

```
langchain>=1.0.0
langchain-openai>=1.0.0
pydantic>=2.7.0
python-dotenv>=1.0.0
rich>=13.7.0
```

Python ≥ 3.12 필요.
