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
- `scripts/` — `claude-mem-bootstrap.sh` · `entrypoint-cmem.sh` · `s6/claude-mem-worker/` · `git-credential-cloudcli-github`
- `data/claude/` · `data/cloudcli/` — bind mount 영속 데이터(자격증명·세션·settings). **삭제 금지.**

## claude-mem (holyclaude 내 통합)

- **워커**: s6 longrun(`scripts/s6/claude-mem-worker/run`)이 `npx claude-mem start --daemon` 감독
- **DB**: named volume `sg-wiki-claude-mem` → `/home/claude/.claude-mem` (SQLite+Chroma). drvfs(`/mnt/f`)가 아닌 Docker 로컬 볼륨이라 SQLite 락 안전, 재빌드 보존.
- **인증 함정**: 워커는 compose env가 **아닌** `~/.claude-mem/.env`에서만 SDK auth를 읽는다. `scripts/claude-mem-bootstrap.sh`가 매 기동마다 `$ZAI_API_KEY`로 이 파일을 생성. 없으면 OAuth 폴백 → "Not logged in" 루프 → observation/summary 0건.
- **트리거**: `data/claude/settings.json`의 `enabledPlugins: { "claude-mem@thedotmack": true }` 훅이 모든 에이전트 세션에서 자동 캡처·주입.

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

- 이미지에 **베이크**되는 변경(`Dockerfile` · `docker-compose.yaml` · `scripts/claude-mem-*` · s6)은 `make up`(재빌드)으로 반영. `data/claude/settings.json`(enabledPlugins)은 마운트돼 즉시 반영.
- SQLite/Chroma는 drvfs bind mount 금지 → claude-mem DB는 반드시 named volume.
- `shm_size: 2g`, `seccomp=unconfined`, `cap_add: SYS_ADMIN`은 Chromium 실행용 — 제거 금지.
