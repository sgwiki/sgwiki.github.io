# sg-wiki

슈타인즈 게이트 공식·팬 분석 자료를 바탕으로 한 **한국어 설정 해설 위키** 저장소입니다. 위키 본문은 `wiki/` 아래 마크다운으로 관리되고, MkDocs Material로 빌드해 [GitHub Pages](https://sgwiki.github.io/)에 배포합니다.

세계선 분기와 사건 흐름을 탐색하는 인터랙티브 맵은 `sg-worldline-map/`의 React/Vite SPA로 관리하며, 배포 시 정적 산출물을 `site/maps/`에 병합합니다.

위키 페이지는 Claude Code 에이전트 팀이 자동으로 작성·검수·커밋하며, 운영자는 관리 UI에서 실행·검토·승인합니다.

## 위키 구조

```text
wiki/
├── README.md          위키 안내 · 근거 체계 · 스포일러 배지 기준
├── _template/         문서 템플릿 (main, depth)
├── 캐릭터/            캐릭터 문서
├── lore/              핵심 설정·사건 해설
├── organization/      조직·단체
├── setting/           세계관·배경
├── 세계관/  세계선/  용어/   (한글 분류)
└── ...
```

각 문서 상단에는 스포일러 수준(`none` / `early_story` / `main_story` / `zero_story` / `endgame`)과 근거 태그(`[공식]` / `[팬 분석]`)가 표시됩니다. 자세한 체계는 [`wiki/README.md`](wiki/README.md)를 참고하세요.

### 위키 파일명과 내부 링크

- `wiki/캐릭터/`와 `wiki/lore/`의 문서 파일명은 한국어 독자를 기준으로 한 실제 작품 통용 명칭을 사용합니다.
- `SERN`, `D-RINE`, `D메일`, `IBN 5100`처럼 한국어 팬덤에서 원문·약어 표기가 통용되는 항목은 파일명에도 해당 표기를 유지합니다.
- 문서 이름을 바꿀 때는 변경 전에 기존 내부 링크를 확인하고, 파일 이동과 함께 모든 Markdown 상대 링크를 새 경로로 갱신해야 합니다.
- `The Mechanics of Steins;Gate v1.0.3` 인용은 GitHub PDF 원문 대신 로컬 번역본 `wiki/근거자료/비공식/mechanics-of-steins-gate/`의 구체적인 장 파일로 연결합니다. 절 번호가 `§3.1`이면 `ch3.md`, `§2.6.1`이면 `ch2.md`처럼 첫 자리 장 번호를 기준으로 매핑하고, 로컬 번역본에 대응 장이 없는 부록성 인용만 `index.md`를 사용합니다.
- 링크 정리 후에는 `make wiki-build`로 MkDocs strict 빌드를 통과시켜야 합니다.

## 디렉터리 구조

```text
.
├── wiki/                 위키 마크다운 본문 (배포 대상)
├── docs/                 설계 문서 · 저작권 검토 · 계획
├── mkdocs.yml            MkDocs Material 설정
├── scripts/
│   ├── run_holyclaude_pipeline.mjs   P1~P5 파이프라인 실행 래퍼
│   ├── wiki_work_registry.mjs        병렬 실행 중복 주제 방지용 작업 현황 registry
│   └── poll_suggestions.py           R2에서 제안 수신 → suggestions/inbox/
├── sg-worldline-map/    세계선 인터랙티브 맵 React/Vite SPA (`/maps/`)
├── worker/               "제안하기" 폼을 받는 Cloudflare Worker (R2 + KV)
├── docker/holyclaude/    Claude Code 에이전트 팀 + 관리 UI 컨테이너
├── data/
│   ├── qaset_with_rag/   P1 근거용 RAG 소스 (gitignored)
│   ├── 공식 자료집/      공식 자료 (gitignored)
│   └── mock-r2/          로컬 개발용 R2 모의 제안 데이터
├── suggestions/          수신 제안 + 처리 상태 (gitignored)
├── .admin/               런타임 상태 (실행 로그 · 위키 검토 · registry · locks) (gitignored)
├── Makefile              자주 쓰는 명령 래퍼
└── .env                  ZAI/GLM 자격증명 · R2 설정 (gitignored)
```

## 위키 로컬 미리보기 / 빌드

```bash
make wiki-serve        # 로컬 미리보기 (localhost:8000)
make wiki-build        # 정적 사이트 빌드 → site/
make wiki-deploy       # 빌드 후 Cloudflare Pages 배포
```

> 배포는 GitHub Pages(현재 기본 경로)로도 연동됩니다. MkDocs 설정은 `mkdocs.yml`을 참고하세요.

## 세계선 인터랙티브 맵

`sg-worldline-map/`은 슈타인즈 게이트 세계선, 사건, 세계선 이동, 수속 패턴을 시각화하는 정적 SPA입니다. 빌드 결과는 `/maps/` 하위 경로에서 동작하도록 `vite.config.ts`의 `base`가 `/maps/`로 고정되어 있습니다.

```bash
cd sg-worldline-map
npm ci
npm run dev          # Vite 개발 서버
npm run typecheck    # TypeScript 검사
npm run build        # tsc + Vite build + SPA route fallback 생성
```

맵 데이터는 `scripts/generate-data.py`가 온톨로지 TTL을 읽어 생성한 `sg-worldline-map/src/data/*.json`을 빌드 타임에 정적으로 import합니다. 이 JSON 파일들은 배포 입력이므로 git에 포함하고, `dist/`, `node_modules/`, TypeScript 빌드 캐시는 `.gitignore`로 제외합니다.

```bash
python scripts/generate-data.py --out sg-worldline-map/src/data
```

GitHub Pages 배포 워크플로는 SPA를 먼저 빌드하고, 성공 시 산출물을 MkDocs 결과물의 `site/maps/`에 복사합니다. SPA 빌드가 실패해도 위키 본문 배포는 계속 진행되며, 맵만 누락됩니다.

## Docker — sg-wiki-holyclaude 에이전트 팀

Claude Code 에이전트 팀과 관리 UI를 Docker로 실행합니다.

```bash
make up              # 빌드 & 시작
make down            # 중지
make logs            # 로그 스트리밍
make shell           # 컨테이너 bash 접속
```

> `docker compose`는 `--env-file .env`로 `.env`의 환경변수를 컨테이너에 전달합니다.

| 서비스 | 포트 | 역할 |
|---|---|---|
| `sg-wiki-holyclaude` | 3001 | Claude Code 에이전트 팀 (위키 집필 · 제안 처리) |
| `sg-wiki-admin` | 3002 | 관리 UI — cron 스케줄 · 수동 트리거 · 실행 현황 · 검토 |
| `sg-wiki-ontology-http` | 8093 | P1 커버리지용 sg-ontology HTTP MCP bridge |

### 관리 UI (`http://localhost:3002`)

- 파이프라인 1 (콘텐츠 생성) / 파이프라인 2 (제안 처리) / 파이프라인 3 (온톨로지 저작) / 파이프라인 4 (품질 검사) / 파이프라인 5 (위키 정비) 수동 실행
- Cron 스케줄 설정 (APScheduler, 기본값 `0 * * * *`)
- 최근 실행 로그 자동 갱신
- **진행 중 / 대기 중 작업** 패널: 동시 실행 현황(실행 N/cap · 대기 M), 대기 작업 순번·취소
- 새로 작성되거나 변경된 `wiki/*.md` 페이지 검토: 보기 · 승인 · 거부
- 제안 자동 처리: `suggestions/inbox/` 수신 제안과 파이프라인 2 자동 판정·작성 로그 (`GET /suggestions`)

## 파이프라인

파이프라인 1과 파이프라인 2는 `sg-wiki-admin`이 Docker socket을 통해 `sg-wiki-holyclaude` 컨테이너 안에서 `/workspace/scripts/run_holyclaude_pipeline.mjs`를 실행합니다. 실행 중 상태는 관리 UI와 `sg-wiki-holyclaude` 로그 스트림에서, 결과 요약은 `.admin/runs/*.json`에서 확인합니다.

### 동시 실행과 중복 주제 방지

- 파이프라인은 **전역 풀로 최대 10개까지 병렬 실행**(`ADMIN_MAX_CONCURRENT_RUNS`). p1/p2가 섞여 실행될 수 있습니다.
- 초과 트리거는 **단일 전역 FIFO 대기열**에 들어가, 실행 슬롯이 비면 자동으로 시작됩니다. 관리 UI에서 순번 확인 및 취소(`DELETE /run/{run_id}`) 가능합니다.
- 동일 주제·동일 파일 중복 작성은 `scripts/wiki_work_registry.mjs`가 막습니다. 팀장 에이전트는 주제 선정 전 registry를 읽어 진행 중인 주제/파일을 회피하고, writer 호출 전 `reserve`로 최종 점유합니다. 완료/거부 시 `complete`/`release`로 registry에서 제거합니다.

### 파이프라인 1 — 콘텐츠 생성

위키작성 팀장(wiki-team-lead)이 planner → writer → source-sanitizer → commit/push 흐름을 총괄합니다. 팀장은 기획서를 `APPROVED PLAN` / `REJECTED PLAN` / `REVISION REQUESTED`로 판정하고, 승인된 경우에만 writer를 호출합니다.

커밋 전에 아래 6개 항목이 각각 별도 성공 MCP 호출로 확인되어야 하며, 하나라도 빠지면 P1은 실패 처리되고 commit/push하지 않습니다: dataforge `qaset_with_rag`, `sg_game_sg0_en`, `sg_paper`, `sg_game_sge`, `namuwiki`, `sg-ontology`.

> 자율 push 경로: `sg-wiki-holyclaude` 컨테이너는 `data/cloudcli/auth.db`에서 GitHub 토큰을 읽는 git credential helper(`docker/holyclaude/scripts/git-credential-cloudcli-github`)로 P1이 생성한 위키 변경을 직접 commit/push합니다.

### 파이프라인 2 — 제안 처리

P2 실행 래퍼는 R2/mock R2 폴링 후 제안을 자동 분류·판정합니다. `approved` 판정은 위키 작성 에이전트와 sanitizer로 전달되어 통과한 위키 변경만 commit/push하고, `rejected`/`partial` 판정은 위키 파일을 수정하지 않습니다. `suggestions/decisions/` 파일은 `automated=true` 상태 표시용 런타임 산출물이며 git에 포함하지 않습니다.

### 위키 페이지 검토

검토 패널은 upstream 이후 변경된 `wiki/*.md`와 아직 커밋되지 않은 `wiki/*.md`를 표시합니다. 승인하면 현재 파일 해시가 `.admin/wiki_reviews.json`에 기록되고, 거부하면 해당 파일을 upstream 기준으로 되돌리거나 새 파일을 제거합니다.

### 환경 변수

- `HOLYCLAUDE_CONTAINER`: 실행 대상 컨테이너 이름, 기본값 `sg-wiki-holyclaude`
- `PIPELINE_SCRIPT`: 컨테이너 내부 P1/P2 실행 스크립트, 기본값 `/workspace/scripts/run_holyclaude_pipeline.mjs`
- `P1_SCRIPT`: 이전 설정과의 호환용 실행 스크립트 별칭. `PIPELINE_SCRIPT`가 우선합니다.
- `ADMIN_MAX_CONCURRENT_RUNS`: 파이프라인 동시 실행 상한(전역 풀, p1/p2 혼합), 기본값 `10`. 초과 트리거는 FIFO 대기열에 들어가 슬롯이 비면 자동 실행된다.
- `ADMIN_RUN_OUTPUT_LIMIT`: 실행 로그 저장 tail 길이, 기본값 `30000`
- `ADMIN_CACHE_TTL_SECONDS`: 위키 현황/위키 검토 목록 API 응답 캐시 TTL, 기본값 `5`
- `ADMIN_SUGGESTION_CACHE_TTL_SECONDS`: 제안 목록과 파이프라인 로그 API 응답 캐시 TTL, 기본값 `10`
- `ADMIN_STATUS_CACHE_TTL_SECONDS`: 최근 실행 현황 API 응답 캐시 TTL, 기본값 `2`
- `HOLYCLAUDE_PIPELINE_MODEL`: 파이프라인 실행 모델, 기본값 `glm-5.2`
- `R2_MOCK`: `0`이면 실제 Cloudflare R2에서 제안 폴링, `1`이면 `data/mock-r2/suggestions/` 사용 (기본값 `1`)
- `R2_ENDPOINT`: R2 S3-compatible 엔드포인트 (`https://<account_id>.r2.cloudflarestorage.com`)
- `R2_ACCESS_KEY` / `R2_SECRET_KEY`: R2 API 토큰 자격증명

## 제안하기 폼 (Cloudflare Worker)

`worker/suggest.ts`는 hCaptcha 검증과 IP당 rate-limit을 거쳐 제안을 R2에 저장합니다. 수신된 제안은 `suggestions/inbox/`로 폴링되어 P2가 처리합니다.

```bash
make worker-dev         # Worker 로컬 개발 서버
make worker-deploy      # Worker 배포
make suggestions-poll   # R2 → suggestions/inbox/ 수동 폴링
```

멱등성 보장: `suggestions/processed/{id}` 파일이 존재하면 재처리 안 함.

## 문서

- [위키 안내 및 근거 체계](wiki/README.md)
- [세계선 인터랙티브 맵 개발 안내](sg-worldline-map/README.md)
- [holyclaude 위키 에이전트 팀 설계](docs/holyclaude-wiki-agent-팀-설계.md)
- [제안 처리 팀 설계](docs/제안%20처리%20팀%20설계.md)
- [RAG 소스 저작권 검토](docs/rag-소스-저작권-검토.md)
- [SG 위키 유지 관리 계획](docs/sg%20위키%20유지%20관리%20계획.md)
