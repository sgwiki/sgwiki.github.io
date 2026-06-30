# HolyClaude Environment — Full Variant

You are running inside a **HolyClaude Docker container** (full variant). Everything is pre-installed and ready to use. This file is your global memory — customize it with your own preferences, projects, and context.

---

## Environment Overview

- **OS:** Debian Bookworm (slim) inside Docker
- **User:** `claude` (UID/GID configurable via PUID/PGID)
- **Working directory:** `/workspace` (bind-mounted from host)
- **Home directory:** `/home/claude`
- **Persistent storage:** `~/.claude/` is bind-mounted — settings, credentials, and this file survive container rebuilds
- **Process manager:** s6-overlay v3 (PID 1) — manages all long-running services
- **Display:** Xvfb virtual display at `:99` for headless browser operations

## Running Services

| Service | What it does | Port |
|---------|-------------|------|
| **CloudCLI** | Web UI for Claude Code | `3001` |
| **Xvfb** | Virtual display for headless Chromium | `:99` (internal) |

Both managed by s6-overlay — they auto-restart on failure.

## Node.js & npm (v22 LTS)

### Global packages available:
- **Languages:** typescript, tsx
- **Package managers:** pnpm, npm (built-in)
- **Build tools:** vite, esbuild
- **Code quality:** eslint, prettier
- **Utilities:** concurrently, dotenv-cli
- **Databases:** prisma, drizzle-kit
- **Process management:** pm2
- **Performance:** lighthouse, @lhci/cli
- **Mock APIs:** json-server

### Installing additional packages:
```bash
npm i -g <package>        # Global install
npm i <package>           # Project-local install
```

## Python 3

use uv env. e.g. uv pip, uv add, uv run, uv python 

### Installed packages:
- **HTTP:** requests, httpx, httpie
- **Scraping:** beautifulsoup4, lxml
- **Images:** Pillow
- **Data:** pandas, numpy, matplotlib, seaborn
- **PDF:** reportlab, weasyprint, cairosvg, fpdf2, PyMuPDF, pdfkit, img2pdf
- **Excel:** openpyxl, xlsxwriter, xlrd
- **Documents:** python-docx, python-pptx, markdown, jinja2
- **Config:** pyyaml, python-dotenv
- **CLI:** rich, click, tqdm
- **Browser:** playwright
- **Web framework:** fastapi, uvicorn

### Installing additional packages:
```bash
uv pip install --break-system-packages <package>
```
The `--break-system-packages` flag is required (no venv in container context).

## AI CLI Providers

| CLI | Command | Notes |
|-----|---------|-------|
| **Claude Code** | `claude` | Primary — you are running inside this |
| **TaskMaster AI** | `task-master` | Task planning and management |

## System Tools

### Command-line utilities:
- **Search:** ripgrep (`rg`), fd (`fdfind`), fzf
- **Files:** tree, bat (`batcat` or `bat`), jq, zip/unzip
- **Network:** curl, wget, httpie, openssh-client
- **Process:** htop, lsof, strace, iproute2 (`ip`, `ss`)
- **Terminal:** tmux
- **Version control:** git, gh

### Database CLIs:
- **PostgreSQL:** `psql`
- **Redis:** `redis-cli`
- **SQLite:** `sqlite3`

### Browser:
- **Chromium** at `/usr/bin/chromium` — headless by default
- **Playwright** installed — use for browser automation, screenshots, testing
- Xvfb provides a virtual display so Chromium has a screen to render to
- Flags preset: `--no-sandbox --disable-gpu --disable-dev-shm-usage`

## GitHub CLI (gh)

Pre-installed and ready. Authenticate with:
```bash
gh auth login
```

Common operations:
```bash
gh repo clone owner/repo
gh pr create --title "..." --body "..."
gh issue list
gh pr merge
```

## Notifications (Apprise)

Optional push notifications via [Apprise](https://github.com/caronc/apprise) — supports 100+ services (Discord, Telegram, Slack, Email, Pushover, Gotify, and more). Disabled by default.

**To enable:**
1. Set one or more `NOTIFY_*` environment variables (e.g. `NOTIFY_DISCORD`, `NOTIFY_TELEGRAM`, `NOTIFY_PUSHOVER`)
2. Create the flag file: `touch ~/.claude/notify-on`

**To disable:** `rm ~/.claude/notify-on`

**Events:**
- `stop` — Claude finishes a task
- `error` — A tool use failure occurs

## Workspace

- All projects go in `/workspace` (bind-mounted from host)
- Git is pre-configured with `safe.directory /workspace`
- Git identity is set via `GIT_USER_NAME` and `GIT_USER_EMAIL` env vars
- Create repos, clone projects, build — everything persists on the host

## Permissions

Claude Code runs in `allowEdits` mode by default:
- File edits: allowed without confirmation
- Shell commands: asks for confirmation
- To enable full bypass: change `allowEdits` to `bypassPermissions` in `~/.claude/settings.json`

## Container Lifecycle

- **First boot:** Bootstrap runs once — copies settings, memory, configures git
- **Subsequent boots:** Bootstrap skipped (sentinel file exists)
- **Re-trigger bootstrap:** Delete `~/.claude/.holyclaude-bootstrapped`
- **Credentials survive rebuilds:** `~/.claude/` is bind-mounted
- **CloudCLI account:** NOT persistent (SQLite can't live on network mounts) — re-create after rebuild (~10 seconds)

## Tips

- Use the **Web Terminal** plugin in CloudCLI instead of "Continue in Shell" (known CloudCLI bug)
- Chromium needs `shm_size: 2g` or higher in docker-compose to avoid crashes
- If on SMB/CIFS mounts, enable `CHOKIDAR_USEPOLLING=1` and `WATCHFILES_FORCE_POLLING=true`
- SQLite databases should NOT be stored on network mounts (file locking fails on CIFS)

---

## Your Preferences

Add your personal preferences below. This section persists across container rebuilds.

---

## sg-wiki 위키 팀장 지침

이 컨테이너는 `/workspace` → `/mnt/f/github/sg-wiki` 마운트 기반 위키 작성 에이전트 팀 환경입니다.

### 절대 규칙

1. **git commit / git push는 팀장(이 세션)만 수행.** 하위 에이전트에게 절대 위임 금지.
2. **source-sanitizer 통과 없이 commit 금지.**
3. `sg_game_sge`·`sg_game_sg0_en` 원문 직접 인용 블록 금지 — 파라프레이즈·풀어쓰기·내용 재료로 간접 사용만 허용.
4. `sg_game_sge`·`sg_game_sg0_en` 소스명·파일명·청크ID를 위키 본문에 노출 금지.
5. 파이프라인 1은 MCP 커버리지 게이트 7개 항목이 모두 성공하기 전에는 commit 금지.
6. 파이프라인 1 팀장은 `/workspace/.admin/p1-work-registry.json`을 작업 현황 memory로 사용한다.
7. planner 기획서 승인 전 `node /workspace/scripts/wiki_work_registry.mjs reserve ...`로 출력 파일을 예약한다.
8. registry 예약 실패, 기존 문서 존재, 동일 주제 감지 시 writer를 호출하지 않는다.

### 기획서 승인 기준

- dataforge MCP(`qaset_with_rag`)에서 주제 QA **5건 이상**
- `/workspace/wiki/`에 동일 주제 문서 **없음**
- `/workspace/.admin/p1-work-registry.json`에 동일 출력 파일이 active 상태로 예약되어 있지 않음
- planner 기획서의 출력 파일 예약 명령이 성공함

### 팀장 승인/거부/피드백 판정

planner가 기획서를 반환하면 팀장은 반드시 아래 중 하나를 로그에 남긴다.

- `APPROVED PLAN`: 승인 사유, 주제, 출력 파일, registry 예약 결과를 함께 기록하고 writer를 호출한다.
- `REJECTED PLAN`: 동일 주제/동일 파일 존재, qaset 근거 부족, MCP 실패, registry 예약 실패 등 거부 사유를 기록하고 writer를 호출하지 않는다.
- `REVISION REQUESTED`: 기획서는 유효하지만 범위·스포일러·출력 경로·근거 요약 보완이 필요할 때 피드백을 명시해 planner에게 재작성 요청한다.

팀장은 writer 호출 전:

```bash
node /workspace/scripts/wiki_work_registry.mjs reserve --run-id <run_id> --file wiki/{category}/{slug}.md --topic "{주제명}"
```

단계 전환 시:

```bash
node /workspace/scripts/wiki_work_registry.mjs status --run-id <run_id> --file wiki/{category}/{slug}.md --status writing
node /workspace/scripts/wiki_work_registry.mjs status --run-id <run_id> --file wiki/{category}/{slug}.md --status sanitizing
node /workspace/scripts/wiki_work_registry.mjs status --run-id <run_id> --file wiki/{category}/{slug}.md --status committing
```

완료 시 `complete`, 거부/폐기/중단 시 `release`를 호출한다.

### 파이프라인 1 MCP 커버리지 게이트

팀장은 하위 에이전트 보고와 실행 로그를 대조해 아래 7개 항목이 각각 별도 MCP 호출로 1회 이상 성공했는지 확인한다. 하나라도 누락되거나 실패하면 작업을 중단하고 commit/push하지 않는다. 단, `fandom_episodes`는 **호출 시도(1회)만으로 pass**이며 결과(빈 결과·실패)는 게이트에 영향을 주지 않는다.

| # | 필수 성공 항목 | 사용 목적 |
|---|---|---|
| 1 | dataforge `qaset_with_rag` | 주제 선정·QA 근거 |
| 2 | dataforge `sg_game_sg0_en` | 영어 원문 기반 교차 확인, 직접 인용 금지 |
| 3 | dataforge `sg_paper` | 팬 분석 근거 확인 |
| 4 | dataforge `sg_game_sge` | 내용 간접 활용 허용, 직접 인용 블록·소스명·청크ID 노출 금지 |
| 5 | `namuwiki` MCP | 외부 요약 교차 확인, 산문 가공 |
| 6 | `sg-ontology` MCP | 세계선·인과관계 검증 |
| 7 | dataforge `fandom_episodes` | 애니메이션 에피소드(본편·0·극장판) 줄거리 교차 확인. 산문 가공·출처 미표시·직접 인용/Fandom URL/식별자(`doc_id`·`source_type=fandom_wiki`) 노출 금지. 메타데이터 필터는 `series`만 유효. **커버리지는 호출 시도만으로 pass(결과 무관)** |

하위 에이전트는 완료 보고에 MCP 커버리지 체크리스트를 포함해야 한다.

### 페이지 승인 기준

- 공식/팬 논문 인용 블록에 출처 표시
- 문서 상단 스포일러 배지 (`!!! warning "스포일러"`)
- source-sanitizer 통과 (chunk ID·source_filter·내부 경로 미노출)
- wiki-linker 통과 (내부 링크 정합성·외부 URL 유효성 확인)

### 파이프라인 1 — 콘텐츠 생성

```
① wiki-team-lead가 /workspace/wiki/와 registry memory를 스캔 → 미작성 주제 후보 목록
② Agent(wiki-planner, 주제) 스폰 → 기획서 + MCP 커버리지 보고 수신
③ 팀장 기획서 검토 → APPROVED PLAN / REJECTED PLAN / REVISION REQUESTED 판정
④ APPROVED PLAN인 경우에만 registry reserve 성공 후 Agent(wiki-writer, 기획서) 스폰
⑤ Agent(source-sanitizer, 초안) → 위반 시 팀장이 writer에게 피드백 재작성 요청 최대 2회, 초과 시 release 후 폐기
⑤-b Agent(wiki-linker, 초안) → broken link fail 시 writer에게 링크 수정 요청 최대 1회
⑥ 팀장 내용 검토 + orphan_warning 검토 + MCP 커버리지 최종 확인 + registry status committing
⑦ git add <file> && git commit -m "wiki: <제목>" && git push
⑧ registry complete 또는 release
```

### 파이프라인 2 — 제안 처리

```
① python3 /workspace/scripts/poll_suggestions.py
② suggestions/inbox/*.json 전체 확인. 수동 승인/거부 기록은 자동 처리 여부를 막지 않음
③ Agent(wiki-classifier) → Type A/B 분류
④ Agent(suggestion-judge) → 승인/거부/partial 판정
⑤ 판정 처리 → suggestions/decisions/{id}.json 저장(automated=true, 런타임 산출물)
⑥ approved 판정만 wiki-planner/wiki-writer/source-sanitizer/wiki-linker 경로로 자동 반영
⑦ sanitizer·linker pass인 wiki 변경만 git add/commit/push. suggestions/는 commit 금지
```

### 파이프라인 6 — 커뮤니티 큐레이션 생성/업데이트

DCinside 슈타게 갤러리 유저 게시글 세그먼트 분석으로 도출된 위키 후보 큐를 소비해, 커뮤니티에서 실제로 반복되는 질문·오해·토론을 바탕으로 페이지를 **생성하거나 업데이트**한다. FAQ·토론 정리 성격의 새 문서는 `wiki/커뮤니티-큐레이션/`을 우선 대상으로 삼는다. 커뮤니티 큐레이션 팀장(`wiki-demand-lead`)은 자율 라우팅하며 사용자에게 묻지 않는다.

```
① node /workspace/scripts/p6_demand_queue.mjs normalize → next --run-id <id> --priority high (후보 선점)
② Agent(wiki-demand-analyst) → 커뮤니티 수요 분석 + 타입 판정 + 생성/업데이트 권고
③ 팀장 판정(APPROVED/REJECTED/REVISION) + 2계층 예약
   - p6_demand_queue.mjs reserve --mode create(파일 부재)|update(파일 존재)  ← 큐 소비
   - wiki_work_registry.mjs reserve                                          ← 파일 단위 락
④ create=Agent(wiki-planner→wiki-writer) / update=Agent(wiki-rewriter 타깃 보강, 사실·스포일러 등급 불변)
⑤ source-sanitizer → wiki-linker → wiki-quality-lead(gate)
⑥ 팀장 검토 + 구조화 리포트 저장 (.admin/runs/p6-<run_id>-report.json)
⑦ 통과한 wiki/*.md만 git add/commit/push. data/dc_gallery/·.admin/·큐/리포트는 commit 금지
⑧ p6_demand_queue.mjs complete + wiki_work_registry.mjs complete
```

- **공통 하드 커버리지(러너 강제)**: `qaset_with_rag`·`namuwiki`·`fandom_episodes`(에피소드 줄거리, 산문 가공·`series` 필터만 유효·**호출 시도만 pass**)·`dc_gallery`(커뮤니티 수요). lore/mechanics 타입은 `sg_paper`·`sg-ontology`·`sg_game_sg0_en` 추가(팀장 보고 확인).
- 1회 실행 최대 3개 후보 순차. 큐(소비 추적)와 registry(파일 락)를 **모두** 사용한다.
- `dc_gallery`(dcinside) 근거는 산문 전용·각주 금지·식별자(gall_num·chunk ID·source 이름·내부 경로) 노출 금지.

### MCP 연결 및 소스 정책

| MCP | 방식 | 용도 |
|---|---|---|
| `dataforge` | HTTP :8081 | qaset 18,604건 semantic search |
| `sg-ontology` | HTTP :8093 | 세계선·인과관계 SPARQL |
| `namuwiki` | stdio | 나무위키 스크래핑 |

**dataforge** — P1 커버리지 5개 소스 각각 별도 호출 (`top_k` ≤ 30 필수):

```
mcp__dataforge__search_with_filters(query="<주제>", source_names=["qaset_with_rag"],  top_k=30)
mcp__dataforge__search_with_filters(query="<주제>", source_names=["sg_game_sg0_en"], top_k=30)
mcp__dataforge__search_with_filters(query="<주제>", source_names=["sg_paper"],        top_k=30)
mcp__dataforge__search_with_filters(query="<주제>", source_names=["sg_game_sge"],     top_k=30)
mcp__dataforge__search_with_filters(query="<주제>", source_names=["fandom_episodes"], top_k=30)  # series 필터만 유효(Steins;Gate / Steins;Gate 0 / 극장판)
```

**dataforge `dc_gallery`** — DCinside 유저 게시글(post/query/answer) 소스. 파이프라인 6 커뮤니티 수요 근거 전용 (산문 가공·각주 금지·식별자 노출 금지):

```
mcp__dataforge__search_with_filters(query="<주제>", source_names=["dc_gallery"], top_k=30)
```

**namuwiki** — 검색 후 본문 조회 (모든 도구에 `page`, `page_size` 지원):

```
mcp__namuwiki__search_namu_wiki(keyword="<주제>", page=1, page_size=10)
mcp__namuwiki__get_namu_wiki_markdown(link="<doc_link>", page=1, page_size=5)  # 섹션 단위 분할, 초과 시 page 증가
mcp__namuwiki__get_related_docs(doc_link="<doc_link>", page=1, page_size=20)
```
