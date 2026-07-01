# docker/holyclaude

sg-wiki 에이전트 팀이 도는 Docker 컨테이너 구성. Claude Code 에이전트 팀 + 온톨로지 MCP + 파이프라인 관리자 + claude-mem 영속 메모리가 한 컨테이너(holyclaude)에 통합돼 있다.

## 서비스 (`docker-compose.yaml`)

| 서비스 | 컨테이너 | 포트 | 역할 |
|---|---|---|---|
| `holyclaude` | `sg-wiki-holyclaude` | `3001`(UI) · `37700`(claude-mem 뷰어) | Claude Code 에이전트 팀 + claude-mem |
| `ontology` | `sg-wiki-ontology-http` | `8093` | 슈타인즈게이트 온톨로지 MCP (SPARQL) |
| `admin` | `sg-wiki-admin` | `3002` | 파이프라인 런/스케줄 관리 |

## 디렉토리

- `Dockerfile` — `coderluii/holyclaude` 베이스 위에 uv, Bun(claude-mem), git credential 레이어
- `ontology/` · `admin/` — 각 서비스 전용 Dockerfile
- `scripts/` — `claude-mem-bootstrap.sh` · `humanize-bootstrap.sh` · `entrypoint-cmem.sh` · `s6/claude-mem-worker/` · `git-credential-cloudcli-github`
- `data/claude/` · `data/cloudcli/` — bind mount 영속 데이터(자격증명·세션·settings). **삭제 금지.**

## claude-mem (holyclaude 내 통합)

- **워커**: s6 longrun(`scripts/s6/claude-mem-worker/run`)이 `npx claude-mem start --daemon` 감독
- **DB**: named volume `sg-wiki-claude-mem` → `/home/claude/.claude-mem` (SQLite+Chroma). drvfs(`/mnt/f`)가 아닌 Docker 로컬 볼륨이라 SQLite 락 안전, 재빌드 보존.
- **인증 함정**: 워커는 compose env가 **아닌** `~/.claude-mem/.env`에서만 SDK auth를 읽는다. `scripts/claude-mem-bootstrap.sh`가 매 기동마다 `$ZAI_API_KEY`로 이 파일을 생성. 없으면 OAuth 폴백 → "Not logged in" 루프 → observation/summary 0건.
- **트리거**: `data/claude/settings.json`의 `enabledPlugins: { "claude-mem@thedotmack": true }` 훅이 모든 에이전트 세션에서 자동 캡처·주입.

## Humanize KR 플러그인 (holyclaude 내 통합)

P5·P6의 `wiki-humanizer` 에이전트가 쓰는 한국어 AI-문체 제거 플러그인([`epoko77-ai/im-not-ai`](https://github.com/epoko77-ai/im-not-ai), 스킬 `humanize-korean@im-not-ai`, `/humanize --strict`).

- **부트스트랩**: `scripts/humanize-bootstrap.sh`가 `entrypoint-cmem.sh`에서 claude-mem 부트스트랩과 함께 base entrypoint **전에** 순차 실행된다. **매 부팅마다 marketplace update + plugin install로 최신 버전을 refresh**(자동 추종)하고, 실패 시 warn 후 exit 0으로 부팅을 막지 않는다(기존 버전 유지).
- **sentinel/persist**: sentinel(`~/.claude/plugins/.humanize-installed`)은 최초 설치 표식으로만 쓰고 업데이트는 sentinel과 무관하게 실행. 플러그인은 bind-mount된 `~/.claude/plugins/`에 설치되므로 재빌드 후에도 persist(별도 볼륨 불필요).
- **Batch slash command 등록**: P5/P6 batch는 user settings 전체를 로드하지 않는다(`settingSources=project,local`). `scripts/run_holyclaude_pipeline.mjs`가 `HUMANIZE_PLUGIN_DIR`(기본 `~/.claude/plugins/cache/im-not-ai/humanize-korean/1.5.0`)을 SDK local plugin으로 주입해 `/humanize` slash command를 등록한다.
- **버전 pin**: `HUMANIZE_PLUGIN_REF` env를 설정하면 최신 추종 대신 특정 버전으로 고정(upstream 회귀 임시 격리).
- **보이스 프로파일**: `data/claude/author-context.yaml`은 sg-wiki 보이스 계약(합니다체·인용 블록/스포일러 배지/내부 식별자 불변·고유명사 화이트리스트)이다. upstream v1.5 fast path의 자동 로드는 보장하지 않으므로, 에이전트 지침과 결정적 가드를 함께 유지한다.
- **사실 불변 가드**: `/workspace/scripts/humanize_fact_guard.py`가 humanize 전/후 숫자·인용·스포일러 동일성을 결정적으로 검증. 위반 시 파일 되돌림·미커밋. P5 백필 완료 표식은 `/workspace/scripts/humanize_coverage.mjs`가 `.admin/humanize-coverage.json`에 기록한다.
- **롤백**: entrypoint에서 `humanize-bootstrap.sh` 호출 제거 + sentinel·`~/.claude/plugins/marketplaces/im-not-ai` 삭제 후 재기동. 백필은 배치 커밋 `git revert`.

## 실행 (루트 `Makefile`)

- `make up` — 빌드 + 기동(재빌드 포함)
- `make down` · `make restart` · `make logs` · `make shell`
- compose 직접: `docker compose --env-file ../../.env -f docker/holyclaude/docker-compose.yaml ...`

## admin UI 수동 실행

- 수동 실행 버튼은 즉시 트리거하지 않고 먼저 팀을 선택한다.
- 팀 선택 시 사용자 지시 칸은 `docker/holyclaude/admin/presets.json`의 팀별 기본 프리셋으로 채워진다. admin 서버는 `/workspace` 마운트본을 우선 읽고, 없으면 이미지에 번들된 사본으로 폴백한다.
- 프리셋 파일 경로는 `ADMIN_PRESETS_FILE`로 바꿀 수 있다. 마운트본을 수정하면 admin 컨테이너 재빌드 없이 다음 페이지 새로고침부터 반영된다.
- 실제 파이프라인 시작은 별도 `실행` 버튼이 `POST /trigger/pN`에 `user_instruction`을 보내는 시점이다.

## 주의

- 이미지에 **베이크**되는 변경(`Dockerfile` · `docker-compose.yaml` · `scripts/claude-mem-*` · `scripts/humanize-bootstrap.sh` · `scripts/entrypoint-cmem.sh` · s6)은 `make up`(재빌드)으로 반영. `data/claude/settings.json`(enabledPlugins)·`data/claude/author-context.yaml`은 마운트돼 즉시 반영.
- SQLite/Chroma는 drvfs bind mount 금지 → claude-mem DB는 반드시 named volume.
- `shm_size: 2g`, `seccomp=unconfined`, `cap_add: SYS_ADMIN`은 Chromium 실행용 — 제거 금지.
