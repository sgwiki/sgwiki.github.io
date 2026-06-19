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
- **Dev servers:** serve, nodemon, http-server
- **Utilities:** concurrently, dotenv-cli
- **Deployment:** wrangler (Cloudflare), vercel, netlify-cli, @cloudflare/next-on-pages, az (Azure)
- **Databases:** prisma, drizzle-kit
- **Process management:** pm2
- **Mobile:** eas-cli (Expo)
- **Performance:** lighthouse, @lhci/cli
- **Media:** sharp-cli, @marp-team/marp-cli
- **Mock APIs:** json-server

### Installing additional packages:
```bash
npm i -g <package>        # Global install
npm i <package>           # Project-local install
```

## Python 3

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
pip install --break-system-packages <package>
```
The `--break-system-packages` flag is required (no venv in container context).

## AI CLI Providers

| CLI | Command | Notes |
|-----|---------|-------|
| **Claude Code** | `claude` | Primary — you are running inside this |
| **Gemini CLI** | `gemini` | Requires `GEMINI_API_KEY` env var. Config persists across rebuilds. Notifications via Apprise. |
| **OpenAI Codex** | `codex` | `OPENAI_API_KEY` or ChatGPT subscription (`codex login --device-auth`). Pre-configured with on-request approval. Auth persists across rebuilds. Notifications via Apprise. |
| **Cursor** | `cursor` | Requires `CURSOR_API_KEY` env var. Config persists across rebuilds. |
| **TaskMaster AI** | `task-master` | Task planning and management |
| **Junie** | `junie` | JetBrains AI coding agent (requires JetBrains account) |
| **OpenCode** | `opencode` | Open source AI agent (supports multiple providers) |

## System Tools

### Command-line utilities:
- **Search:** ripgrep (`rg`), fd (`fdfind`), fzf, grep
- **Files:** tree, bat (`batcat` or `bat`), jq, zip/unzip
- **Network:** curl, wget, httpie, openssh-client
- **Process:** htop, lsof, strace, iproute2 (`ip`, `ss`)
- **Terminal:** tmux
- **Version control:** git, gh (GitHub CLI)

### Database CLIs:
- **PostgreSQL:** `psql`
- **Redis:** `redis-cli`
- **SQLite:** `sqlite3`

### Media & document processing:
- **Images:** imagemagick (`convert`, `identify`, `mogrify`)
- **Video/Audio:** ffmpeg
- **Documents:** pandoc (convert between formats)
- **Image processing:** libvips (via `vips` command or sharp)

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
3. `sg_game_sge` 내용은 어떤 형태로도 위키에 포함 금지 (완전 배제).
4. `sg_game_sg0_en` 원문 직접 인용 금지 — 산문 요약만 허용.

### 기획서 승인 기준

- dataforge MCP(`qaset-with-rag`)에서 주제 QA **5건 이상**
- `/workspace/wiki/`에 동일 주제 문서 **없음**

### 페이지 승인 기준

- 공식/팬 논문 인용 블록에 출처 표시
- 문서 상단 스포일러 배지 (`!!! warning "스포일러"`)
- source-sanitizer 통과 (chunk ID·source_filter·내부 경로 미노출)

### 파이프라인 1 — 콘텐츠 생성

```
① /workspace/wiki/ 스캔 → qaset 카테고리 비교 → 미작성 주제 목록
② Agent(wiki-planner, 주제) 병렬 스폰 → 기획서 수신
③ 팀장 기획서 검토 → 승인/반려
④ Agent(wiki-writer, 기획서) 병렬 스폰 (다른 파일 대상만 — 동일 파일 동시 쓰기 금지)
⑤ Agent(source-sanitizer, 초안) → 위반 시 재작성 최대 2회, 초과 시 폐기
⑥ 팀장 내용 검토
⑦ git add <file> && git commit -m "wiki: <제목>" && git push
```

### 파이프라인 2 — 제안 처리

```
① python3 /workspace/scripts/poll_suggestions.py
② Agent(wiki-classifier) → Type A/B 분류
③ Agent(suggestion-judge) → 승인/거부/partial 판정
④ 판정 처리 → suggestions/decisions/{id}.json 저장 → git commit
```

### MCP 연결

| MCP | 방식 | 용도 |
|---|---|---|
| `dataforge` | HTTP :8081 | qaset 18,604건 semantic search |
| `sg-ontology` | HTTP :8093 | 세계선·인과관계 SPARQL |
| `namuwiki` | stdio | 나무위키 스크래핑 |

### 소스 정책 요약

| 소스 | 위키 표시 |
|---|---|
| `reference/official/` | `[공식]` 태그 + 출처명 |
| `sg_paper` | `[팬 분석]` 태그 + 논문 제목 |
| `sg_game_sg0_en` | 산문 요약만 (원문 인용 금지) |
| qaset / namuwiki / sg-ontology | 산문 처리, 출처 미표시 |
| `sg_game_sge` | **완전 배제** |
