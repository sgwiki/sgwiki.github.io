# AGENTS.md

이 파일은 (자동화된) 코딩 에이전트가 sg-wiki 저장소에서 작업할 때 알아야 할 핵심 컨텍스트를 제공합니다. 일반 개발자 온보딩 문서와 겹치는 부분은 [`README.md`](README.md)를, 위키 집필 규칙은 [`wiki/README.md`](wiki/README.md)를 참고하세요.

## 프로젝트 개요

슈타인즈 게이트 **한국어 설정 해설 위키**. 위키 본문은 `wiki/` 아래 마크다운으로 관리되고, MkDocs Material로 빌드해 [GitHub Pages](https://sgwiki.github.io/)에 배포. 위키 페이지는 Claude Code 에이전트 팀이 자동 작성·검수·커밋하며, 운영자는 관리 UI로 실행·검토·승인.

## 핵심 디렉터리

| 경로 | 역할 | 추적 여부 |
|---|---|---|
| `wiki/` | 위키 마크다운 본문 (배포 대상) | tracked |
| `docs/` | 설계·계획·저작권 검토 문서 | tracked |
| `scripts/run_holyclaude_pipeline.mjs` | P1/P2/P3/P4/P5 파이프라인 실행 래퍼 | tracked |
| `scripts/wiki_work_registry.mjs` | 병렬 실행 중복 주제 방지 registry | tracked |
| `scripts/poll_suggestions.py` | R2 → `suggestions/inbox/` 제안 폴링 | tracked |
| `sg-worldline-map/` | `/maps/`로 배포되는 세계선 인터랙티브 맵 React/Vite SPA | tracked |
| `worker/` | "제안하기" 폼 Cloudflare Worker | tracked |
| `docker/holyclaude/` | 에이전트 팀 + 관리 UI 컨테이너 정의 | tracked |
| `mkdocs.yml` / `Makefile` | 위키 빌드 설정 · 명령 래퍼 | tracked |
| `data/qaset_with_rag/`, `data/공식 자료집/` | RAG 소스·공식 자료 (대용량/민감) | **gitignored** |
| `suggestions/` | 수신 제안 + 처리 상태 (런타임) | **gitignored** |
| `.admin/` | 실행 로그 · 위키 검토 · registry · locks (런타임) | **gitignored** |
| `docker/holyclaude/data/cloudcli/` | GitHub 토큰 DB (`auth.db`) — **절대 커밋 금지** | **gitignored** |
| `docker/holyclaude/data/claude/sessions/` 등 | Claude Code 런타임 산출물 | **gitignored** |
| `.env` | ZAI/GLM 자격증명 · R2 설정 | **gitignored** |

> `.gitignore`는 **라인 끝 인라인 주석을 지원하지 않습니다** (`pattern # comment` 형태 금지). 주석은 항상 별도 라인에.

## 자주 쓰는 명령

```bash
make up       # 에이전트 팀 + 관리 UI 빌드 & 시작
make wiki-serve          # 위키 로컬 미리보기 (localhost:8000)
make wiki-build          # 정적 사이트 빌드 (site/)
make wiki-deploy         # 빌드 후 Cloudflare Pages 배포
make worker-dev          # 제안 폼 Worker 로컬 개발
```

파이프라인 스크립트 단독 점검:

```bash
node --check scripts/run_holyclaude_pipeline.mjs
node --check scripts/wiki_work_registry.mjs
node scripts/run_holyclaude_pipeline.mjs p1 --run-id <id> --dry-run   # 부작용 없는 dry-run
```

세계선 맵 SPA 점검:

```bash
cd sg-worldline-map
npm run typecheck
npm run build
```

맵 데이터 재생성:

```bash
python scripts/generate-data.py --out sg-worldline-map/src/data
```

## 아키텍처 — 에이전트 팀과 파이프라인

### 세계선 인터랙티브 맵 (`sg-worldline-map/`)

- React 18 + Vite + TypeScript + Tailwind + D3 + GSAP 기반 정적 SPA. Vite `base`는 `/maps/`로 고정되어 GitHub Pages의 `site/maps/` 병합 배포를 전제로 한다.
- `src/data/*.json`은 `scripts/generate-data.py` 산출물이지만 런타임 fetch 대상이 아니라 tracked 빌드 입력이다. 데이터 구조는 `src/types/ontology.ts`와 맞아야 한다.
- 현재 로더는 `anime` 데이터셋만 활성화한다. 새 시리즈를 추가할 때는 JSON import, `SERIES_ORDER`, `datasets`, 필요 시 `scripts/create-spa-route-fallbacks.mjs`의 route 목록을 함께 갱신한다.
- `/maps/anime/` 같은 SPA 하위 경로는 빌드 후 `scripts/create-spa-route-fallbacks.mjs`가 `dist/<route>/index.html`을 복사해 처리한다.
- GitHub Actions는 SPA 빌드를 먼저 시도하고 성공한 artifact만 MkDocs 결과물의 `site/maps/`로 병합한다. SPA 실패는 위키 배포를 막지 않는다.

### 파이프라인 1 (콘텐츠 생성)

`sg-wiki-admin`이 Docker socket으로 `holyclaude` 컨테이너 안에서 `run_holyclaude_pipeline.mjs p1`을 실행. 팀장(wiki-team-lead)이 하위 에이전트를 조율:

```
팀장: 주제 선정 → wiki-planner(기획서) → APPROVED 판정 → wiki-writer(초안) → source-sanitizer → wiki-linker → wiki-quality-lead(gate) → commit/push
```

- **MCP 커버리지 게이트**: 커밋 전 6개 항목이 각각 별도 성공 호출로 확인되어야 함. 하나라도 빠지면 실패 처리, commit/push 금지.
  - dataforge `qaset_with_rag`, `sg_game_sg0_en`, `sg_paper`, `sg_game_sge`, `namuwiki`, `sg-ontology`
- **자율 push**: `holyclaude` 컨테이너가 `data/cloudcli/auth.db`의 GitHub 토큰을 읽는 credential helper(`docker/holyclaude/scripts/git-credential-cloudcli-github`)로 P1 결과를 직접 commit/push.
- **위키 집필 규칙** (모든 에이전트 필수 준수): `sg_game_sge`·`sg_game_sg0_en` 원문 직접 인용 금지(파라프레이즈·풀어쓰기·내용 재료로 간접 사용만) / 소스명·파일명·chunk ID·source_filter 이름 공개 위키 노출 금지.

### 파이프라인 2 (제안 처리)

`suggestions/inbox/` 제안 → wiki-classifier(분류) → suggestion-judge(판정) → `approved`만 writer/sanitizer/wiki-linker 경유 commit. `rejected`/`partial`은 위키 파일 미수정.

### 파이프라인 4 (위키 품질 검사)

전체 감사(audit) 전용. wiki-quality-lead가 조율:

```
wiki/*.md 전체 → wiki-format-inspector(형식) → wiki-completeness-checker(완성도) → wiki-consistency-checker(일관성) → .admin/quality-audit-{날짜}.json
```

- **읽기 전용**: 파일 수정·commit 없음. 감사 리포트만 생성.
- **gate 모드도 지원**: 파이프라인 1에서 wiki-linker 통과 후 단일 파일 대상으로 자동 실행됨 (consistency-checker 제외).

### 파이프라인 5 (위키 정비)

전체 `wiki/*.md` 대상 구조·문체 일관성 개선 전용. wiki-maintenance-lead가 조율:

```
wiki/*.md 전체 스캔 → wiki-restructurer(섹션·헤더·링크) → wiki-rewriter(문체·표현) → source-sanitizer → commit/push
```

- **읽기+쓰기**: 정비 결과는 commit/push됨. 대규모 수정이므로 관리 UI에서 검토 후 승인 권장.

### 동시 실행과 중복 주제 방지

- **전역 풀 동시 실행 cap 10** (`ADMIN_MAX_CONCURRENT_RUNS`). p1/p2 혼합 가능. 초과분은 단일 전역 FIFO 대기열에 적재, 슬롯 해제 시 자동 시작.
- **per-pipeline 하드 락은 의도적 제거됨**. 대신 `scripts/wiki_work_registry.mjs`가 중복 주제를 막음:
  - 팀장이 주제 선정 전 `list`로 `active`를 읽어 진행 중 topic/file 회피
  - writer 호출 전 `reserve`로 atomic 점유 (파일 락 `p1-work-registry.lock`)
  - 완료/거부 시 `complete`/`release`로 `active`에서 프로그램적 제거
  - 12시간 미갱신 엔트리는 stale 자동 정리
- **결론**: 파이프라인 동시성을 다룰 때 `acquirePipelineLock` 같은 전체 직렬화 락을 다시 넣지 말 것. 중복 방지는 registry 계층에서만.

## 위키 집필 규칙 (변경 시 주의)

- 모든 문서 상단에 스포일러 배지(`none`/`early_story`/`main_story`/`zero_story`/`endgame`)와 근거 태그(`[공식]`/`[팬 분석]`) 필수.
- 근거 체계·문서 구조 템플릿은 `wiki/README.md`와 `wiki/_template/`.
- `wiki/캐릭터/`와 `wiki/lore/` 파일명은 한국어 독자를 기준으로 한 실제 작품 통용 명칭을 사용한다. 단, `SERN`, `D-RINE`, `D메일`, `IBN 5100`처럼 한국어 팬덤에서 원문·약어 표기가 통용되는 항목은 그 표기를 유지한다.
- 위키 파일명을 바꿀 때는 먼저 기존 내부 링크를 조사하고, 파일 이동과 동시에 모든 Markdown 상대 링크를 새 경로로 갱신한다. 변경 후 템플릿을 제외한 실사용 내부 링크가 깨지지 않는지 확인하고 `make wiki-build`를 통과시킨다.
- **직접 인용·식별자 노출 위반은 가장 흔한 reject 원인**. `sg_game_sge`·`sg_game_sg0_en` 모두 간접 사용(파라프레이즈)만 허용되며, 원문 블록 직접 인용·소스명·파일명·chunk ID 노출 시 reject.

## 코드 변경 시 주의

- **볼륨 마운트 vs 베이크**: `scripts/`, `docker/holyclaude/data/claude/`(에이전트 정의·CLAUDE.md·settings.json)는 컨테이너에 마운트되어 **재빌드 없이 즉시 반영**. 반면 `docker/holyclaude/Dockerfile`이나 `docker/holyclaude/admin/`(admin 서버 코드)은 이미지에 베이크되어 **재빌드 + 컨테이너 재생성 필요**.
- **admin 서버**(FastAPI, `docker/holyclaude/admin/app/main.py`): 동시성/큐 로직은 `active_jobs_lock`(threading.RLock)로 보호. `_pop_active_job` 완료 시 `_dispatch_next_job`가 FIFO에서 다음 job 승격.
- **테스트**: FastAPI TestClient는 요청 사이에 `asyncio.create_task`로 만든 백그라운드 작업을 취소하므로, 동시성 로직 테스트 시 실제 실행 대신 task를 기록하는 방식으로 격리해야 함.
- **동시 commit 경합**: cap 10 병렬 실행 시 `.git/index.lock` 충돌 가능. 드물게 발생하면 registry `committing` 상태 기반 직렬화 추가를 고려.
- **세계선 맵 SPA**: `sg-worldline-map/src/data/*.json`은 tracked 배포 입력이고 `dist/`, `node_modules/`, `*.tsbuildinfo`는 로컬 산출물이다. 맵 경로는 `/maps/` 전제이므로 `vite.config.ts`의 `base`, `index.html`의 favicon 경로, SPA fallback route를 함께 확인한다.

## 컨테이너 상태 확인

```bash
curl -s http://127.0.0.1:3002/running    # 동시 실행 현황 (jobs/limit/running/queued)
curl -s http://127.0.0.1:3002/status     # 최근 실행 결과
docker logs --tail 50 sg-wiki-admin      # admin 서버 로그
docker logs --tail 50 sg-wiki-holyclaude # 에이전트 팀 로그
```

## 추가 문서

- [holyclaude 위키 에이전트 팀 설계](docs/holyclaude-wiki-agent-팀-설계.md)
- [제안 처리 팀 설계](docs/제안%20처리%20팀%20설계.md)
- [SG 위키 유지 관리 계획](docs/sg%20위키%20유지%20관리%20계획.md)
- [RAG 소스 저작권 검토](docs/rag-소스-저작권-검토.md)
- [세계선 인터랙티브 맵 개발 안내](sg-worldline-map/README.md)
