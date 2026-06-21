# sg-wiki 아키텍처 전체 문서

> 작성 기준: 2026-06-20

---

## 1. 시스템 개요

슈타인즈 게이트 한국어 위키를 자동으로 집필·검수·배포하는 **AI 에이전트 파이프라인**과 그 운영 인프라 전체를 기술한다.

```
[사용자 제안폼] ──POST──▶ [Cloudflare Worker] ──R2──▶ [suggestions/inbox/]
                                                               │
                                                    [파이프라인 2: 제안 처리]
                                                               │
[관리자] ──브라우저──▶ [sg-wiki-admin :3002]                    │
                          │  Docker socket                     │
                          ▼                                    ▼
                   [holyclaude :3001] ◀─────────────── [파이프라인 1: 콘텐츠 생성]
                   (Claude Code 에이전트 팀)
                          │
                    git commit/push
                          │
                          ▼
                   [wiki/ 마크다운] ──MkDocs──▶ [Cloudflare Pages / GitHub Pages]
```

---

## 2. 디렉터리 구조

| 경로 | 역할 | Git 추적 |
|---|---|---|
| `wiki/` | 위키 마크다운 본문 (배포 대상) | ✅ |
| `docs/` | 설계·계획·저작권 검토 문서 | ✅ |
| `scripts/run_holyclaude_pipeline.mjs` | P1/P2 파이프라인 실행 래퍼 (Claude Agent SDK 호출) | ✅ |
| `scripts/wiki_work_registry.mjs` | 병렬 실행 중복 주제 방지 레지스트리 CLI | ✅ |
| `scripts/poll_suggestions.py` | R2 → `suggestions/inbox/` 제안 폴링 | ✅ |
| `worker/suggest.ts` | 제안 수신 Cloudflare Worker | ✅ |
| `docker/holyclaude/` | 에이전트 컨테이너 + 관리 UI 정의 | ✅ |
| `mkdocs.yml` | MkDocs Material 빌드 설정 | ✅ |
| `data/qaset_with_rag/` | RAG 소스 (대용량, 민감) | ❌ gitignored |
| `suggestions/` | 수신 제안 + 처리 상태 (런타임) | ❌ gitignored |
| `.admin/` | 실행 로그·위키 검토·레지스트리·락 (런타임) | ❌ gitignored |
| `.env` | ZAI/GLM 자격증명·R2 설정 | ❌ gitignored |

---

## 3. 서빙 구조

### 3-1. 정적 위키 사이트

```
wiki/*.md  ──mkdocs build──▶  site/  ──wrangler pages deploy──▶  Cloudflare Pages
                                                                  (sgwiki.github.io)
```

- **빌드 도구**: MkDocs Material (`mkdocs.yml`)
  - 테마: `material`, 언어 `ko`, 다크 슬레이트 팔레트
  - 플러그인: `search` (ja 형태소 — 한국어 최근사)
  - 확장: `admonition`, `superfences`, `pymdownx.details`
- **배포**: Cloudflare Pages (`make wiki-deploy`) 또는 GitHub Pages 자동 연동

### 3-2. Docker 서비스 스택

`docker/holyclaude/docker-compose.yaml` 로 정의된 세 컨테이너:

| 서비스 | 포트 | 이미지/빌드 | 역할 |
|---|---|---|---|
| `holyclaude` | `127.0.0.1:3001` | `./Dockerfile` | Claude Code 에이전트 팀 실행 환경 |
| `sg-wiki-admin` | `127.0.0.1:3002` | `./admin/` | 관리 UI (FastAPI) |
| `sg-ontology-http` | `8093` | `steinsgate-mcp:latest` | sg-ontology HTTP MCP 브릿지 |

#### holyclaude 컨테이너 상세

- **기반 이미지**: Debian Bookworm slim + s6-overlay v3 (PID 1)
- **프로세스**: CloudCLI (포트 3001) + Xvfb (`:99`) — s6-overlay가 자동 재시작
- **AI 라우팅**: `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` → ZAI GLM-5.2
- **볼륨 마운트**:
  - `./data/claude:/home/claude/.claude` — 설정·에이전트 정의·CLAUDE.md (재빌드 없이 즉시 반영)
  - `../../:/workspace` — 프로젝트 루트
- **권한**: `SYS_ADMIN` + `SYS_PTRACE` + `seccomp=unconfined` (Chromium sandboxing 필요)
- **Git 인증**: `docker/holyclaude/scripts/git-credential-cloudcli-github` credential helper → `data/cloudcli/auth.db` (GitHub 토큰)

#### sg-wiki-admin 컨테이너 상세

- **프레임워크**: FastAPI + Jinja2 + APScheduler
- **Docker socket**: `/var/run/docker.sock:ro` — holyclaude 컨테이너 안에서 파이프라인 스크립트 실행
- **동시성**: `threading.RLock`(`active_jobs_lock`) 보호 + `deque` FIFO 대기열
- **최대 동시 실행**: `ADMIN_MAX_CONCURRENT_RUNS` (기본값 10, p1/p2 혼합)
- **캐시 TTL**: 위키 현황 5s / 제안 목록 10s / 실행 현황 2s

#### sg-ontology-http 컨테이너 상세

- **서버**: Python FastMCP (`streamable-http` transport)
- **엔드포인트**: `http://host.docker.internal:8093/mcp`
- **역할**: 세계선·인과관계 SPARQL 조회 (holyclaude에서 MCP 클라이언트로 연결)

### 3-3. 제안 수신 (Cloudflare Worker)

`worker/suggest.ts`:

```
사용자 POST /suggest
  → hCaptcha 검증
  → IP당 rate-limit (KV, 시간당 5회)
  → content 길이 검사 (≤ 2000자)
  → R2 저장 (suggestions/{uuid}.json)
```

`make suggestions-poll` 또는 P2 시작 시 `poll_suggestions.py`가 R2 → `suggestions/inbox/` 동기화.

---

## 4. 에이전트 구조

### 4-1. 에이전트 정의 위치

```
docker/holyclaude/data/claude/
├── CLAUDE.md              # 팀장 전역 지침 (볼륨 마운트, 재빌드 불필요)
└── agents/
    ├── wiki-team-lead.md      # 파이프라인 1 총괄
    ├── wiki-planner.md        # 기획서 작성
    ├── wiki-writer.md         # 마크다운 초안 작성
    ├── source-sanitizer.md    # 소스 규정 검사
    ├── wiki-classifier.md     # 제안 Type A/B 분류
    └── suggestion-judge.md    # 제안 승인/거부 판정
```

### 4-2. 에이전트 역할 요약

| 에이전트 | 파이프라인 | 역할 | 쓰기 권한 |
|---|---|---|---|
| `wiki-team-lead` | P1 | 총괄·승인·commit/push | ✅ git만 |
| `wiki-planner` | P1, P2 | MCP 조회 → 기획서 반환 | ❌ 읽기 전용 |
| `wiki-writer` | P1, P2 | 마크다운 초안 → 파일 저장 | ✅ wiki/*.md만 |
| `source-sanitizer` | P1, P2 | 초안 검사 → pass/fail | ❌ 읽기 전용 |
| `wiki-linker` | P1, P2 | 내부 링크 정합성·외부 URL 유효성·고아 페이지 탐지 → pass/fail/warn | ❌ 읽기 전용 |
| `wiki-classifier` | P2 | Type A/B 분류 | ❌ 읽기 전용 |
| `suggestion-judge` | P2 | MCP 조회 → 판정 JSON 반환 | ❌ 읽기 전용 |

### 4-3. MCP 서버 연결

| MCP 서버 | 연결 방식 | 역할 |
|---|---|---|
| `dataforge` | HTTP `:8081` | QA/게임 텍스트 semantic search (18,604건) |
| `sg-ontology` | HTTP `:8093` | 세계선·인과관계 SPARQL 조회 |
| `namuwiki` | stdio | 나무위키 스크래핑 (검색·본문·관련문서) |

**dataforge 소스 분류:**

| 소스 이름 | 용도 | 위키 직접 인용 |
|---|---|---|
| `qaset_with_rag` | 주제 선정·QA 근거 | ❌ 산문 처리 |
| `sg_game_sg0_en` | 영어 원문 교차 확인 | ❌ 파라프레이즈만 |
| `sg_paper` | 팬 분석 논문 근거 | ✅ 각주 인용 허용 |
| `sg_game_sge` | 한글 패치 교차 확인 | ❌ 파라프레이즈만 |

---

## 5. 파이프라인 1 — 콘텐츠 생성

`sg-wiki-admin`이 Docker socket으로 holyclaude 컨테이너 안에서 실행:
```
docker exec holyclaude node /workspace/scripts/run_holyclaude_pipeline.mjs p1 --run-id <id>
```

`run_holyclaude_pipeline.mjs`는 Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`)의 `query()`를 호출해 팀장 에이전트를 구동한다.

### 흐름

```
① wiki-team-lead
   └─ node scripts/wiki_work_registry.mjs list
      → registry.active의 topic/file 확인 → 미작성 후보 선정

② wiki-team-lead → Agent(wiki-planner, 주제)
   └─ planner: 6개 MCP 조회 → 기획서 반환

③ wiki-team-lead 판정 (APPROVED PLAN / REJECTED PLAN / REVISION REQUESTED)
   └─ 승인 조건:
        - wiki/에 동일 주제 문서 없음
        - qaset 근거 5건 이상
        - MCP 커버리지 6개 항목 모두 pass
        - registry reserve 성공

④ registry reserve
   └─ node scripts/wiki_work_registry.mjs reserve --run-id <id> --file wiki/{cat}/{slug}.md

⑤ wiki-team-lead → Agent(wiki-writer, 기획서)
   └─ writer: MCP 재조회 → 마크다운 초안 → wiki/{cat}/{slug}.md 저장

⑥ wiki-team-lead → Agent(source-sanitizer, 파일)
   └─ sanitizer: 9개 항목 검사 → pass/fail
   └─ fail 시 writer 재작성 (최대 2회), 초과 시 registry release + 중단

⑥-b wiki-team-lead → Agent(wiki-linker, 파일)
   └─ linker: 내부 링크 정합성·외부 URL 유효성·고아 페이지 탐지
   └─ fail(broken links) 시 writer 링크 수정 요청 (최대 1회)
   └─ orphan_warning: true 시 팀장 재량으로 수용/관련 문서 업데이트

⑦ wiki-team-lead: MCP 커버리지 최종 확인 (6개 항목 모두 succeeded ≥ 1)
   └─ registry status committing

⑧ git add wiki/{file} && git commit -m "wiki: <제목>" && git push
   └─ credential helper → auth.db GitHub 토큰

⑨ registry complete
```

### MCP 커버리지 게이트

`run_holyclaude_pipeline.mjs`가 SDK 스트림 이벤트를 파싱해 **6개 항목**을 자동 추적:

| # | 항목 | 검출 방식 |
|---|---|---|
| 1 | `dataforge:qaset_with_rag` | tool_use input에 `"qaset_with_rag"` 포함 + tool_result 성공 |
| 2 | `dataforge:sg_game_sg0_en` | tool_use input에 `"sg_game_sg0_en"` 포함 + 성공 |
| 3 | `dataforge:sg_paper` | tool_use input에 `"sg_paper"` 포함 + 성공 |
| 4 | `dataforge:sg_game_sge` | tool_use input에 `"sg_game_sge"` 포함 + 성공 |
| 5 | `namuwiki MCP` | tool_use name이 `mcp__namuwiki__*` + 성공 |
| 6 | `sg-ontology MCP` | tool_use name에 `sg-ontology`/`sg_ontology` 포함 + 성공 |

하나라도 누락/실패 시 exit code 1 → 관리 UI에 실패 기록.

---

## 6. 파이프라인 2 — 제안 처리

```
① python3 scripts/poll_suggestions.py
   └─ R2 (또는 data/mock-r2/) → suggestions/inbox/*.json

② 팀장: inbox 전체 확인
   └─ suggestions/decisions/{id}.json에 automated=true 있으면 스킵

③ Agent(wiki-classifier, inbox/{id}.json)
   └─ Type A (새 주제 요청) 또는 Type B (편집 제안) 분류
   └─ 관련 기존 문서 경로 반환

④ Agent(suggestion-judge, 분류 결과)
   └─ dataforge + sg-ontology + namuwiki MCP 조회
   └─ approved / rejected / partial 판정 → JSON 반환

⑤ suggestions/decisions/{id}.json 저장 (automated=true)

⑥ approved만:
   Type A → Agent(wiki-planner) → Agent(wiki-writer) → Agent(source-sanitizer)
   Type B → Agent(wiki-writer) → Agent(source-sanitizer)

⑦ sanitizer pass 변경분만 git add/commit/push
   (suggestions/ 디렉토리는 commit 대상 제외)
```

---

## 7. 중복 주제 방지 (Work Registry)

`scripts/wiki_work_registry.mjs` — 파일 기반 레지스트리 CLI:

```
.admin/
├── p1-work-registry.json   # 상태 파일 (active: {}, history: [])
└── p1-work-registry.lock   # 파일 락 (TTL 2분, 50회 재시도)
```

| 명령 | 타이밍 | 효과 |
|---|---|---|
| `list` | 후보 선정 전 | `active`의 topic/file 조회 → 이미 진행 중인 주제 제외 |
| `reserve` | APPROVED 직후 | atomic 점유 (락 획득 후 active에 추가) |
| `status writing\|sanitizing\|committing` | 단계 진입 시 | active 엔트리 상태 갱신 |
| `complete` | commit/push 완료 | active에서 제거, history에 추가 |
| `release` | 거부/중단/폐기 | active에서 제거 (history에도 기록) |

- Active 엔트리 TTL: **12시간** (stale 자동 정리)
- **의도적 설계**: per-pipeline 직렬화 락 없음 — 전체 직렬화 대신 topic 단위 registry로 병렬성 유지

---

## 8. 관리 UI 주요 API

`sg-wiki-admin` (포트 3002) FastAPI:

| 엔드포인트 | 역할 |
|---|---|
| `GET /` | 관리 대시보드 HTML |
| `POST /trigger/p1` | P1 수동 실행 (즉시 또는 FIFO 대기열) |
| `POST /trigger/p2` | P2 수동 실행 |
| `GET /running` | 동시 실행 현황 (jobs/limit/running/queued) |
| `GET /status` | 최근 실행 결과 목록 |
| `DELETE /run/{run_id}` | 대기 중인 job 취소 |
| `GET /wiki-review` | 변경된 wiki/*.md 검토 목록 |
| `POST /wiki-review/{hash}/approve` | 파일 해시 승인 기록 |
| `POST /wiki-review/{hash}/reject` | 파일을 upstream 기준으로 되돌리기 |
| `GET /suggestions` | 수신 제안 목록 + P2 자동 처리 로그 |
| `GET /schedule` | APScheduler cron 설정 조회 |
| `POST /schedule` | cron 업데이트 |

---

## 9. 소스 위생 규칙 (source-sanitizer 체크 항목)

| # | 항목 | 패턴 |
|---|---|---|
| 1 | chunk ID 본문 노출 | `qs-`, `sge_`, `sg0_`, `sp_` |
| 2 | source_filter 이름 노출 | `qaset_with_rag`, `sg_game_sg0_en` 등 |
| 3 | 내부 파일 경로 노출 | `data/qaset_with_rag/`, `reference/user/` 등 |
| 4 | sg_game_sg0_en 원문 블록 직접 인용 | 영어 게임 대사 인용 블록 |
| 5 | sg_game_sge 원문 블록 직접 인용 | 한글 패치 텍스트 직접 인용 |
| 6 | 스포일러 배지 누락 | `!!! warning "스포일러"` 없음 |
| 7 | 나무위키 URL 노출 | `namu.wiki`, `[[문서명]]` |
| 8 | dcinside 청크 각주 표시 | `[^n]: dcinside / <uuid>` |
| 9 | 공식자료집 내부 링크 없이 평문 인용 | 링크 없는 `슈타게 공식 QA자료집, Q1` |

---

## 10. 환경 변수 요약

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ZAI_API_KEY` | — | ZAI GLM API 키 |
| `ANTHROPIC_BASE_URL` | `https://api.z.ai/api/anthropic` | Claude Code → ZAI 라우팅 |
| `HOLYCLAUDE_PIPELINE_MODEL` | `glm-5.2` | 파이프라인 실행 모델 |
| `ADMIN_MAX_CONCURRENT_RUNS` | `10` | 전역 동시 실행 상한 |
| `ADMIN_RUN_OUTPUT_LIMIT` | `30000` | 실행 로그 tail 길이 |
| `R2_MOCK` | `1` | `0`: 실제 R2, `1`: `data/mock-r2/` |
| `R2_ENDPOINT` | — | R2 S3-compatible 엔드포인트 |
| `R2_ACCESS_KEY` / `R2_SECRET_KEY` | — | R2 API 토큰 |
| `HOLYCLAUDE_CONTAINER` | `holyclaude` | 파이프라인 실행 대상 컨테이너 |

---

## 관련 문서

- [holyclaude 위키 에이전트 팀 설계](holyclaude-wiki-agent-팀-설계.md)
- [제안 처리 팀 설계](제안%20처리%20팀%20설계.md)
- [RAG 소스 저작권 검토](rag-소스-저작권-검토.md)
- [SG 위키 유지 관리 계획](sg%20위키%20유지%20관리%20계획.md)
