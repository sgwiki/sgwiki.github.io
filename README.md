# sg-wiki

슈타인즈 게이트 공식·팬 분석 자료를 바탕으로 한 **한국어 설정 해설 위키** 저장소입니다. 위키 본문은 `wiki/` 아래 마크다운으로 관리되고, MkDocs Material로 빌드해 [GitHub Pages](https://sgwiki.github.io/)에 배포합니다.

세계선 분기와 사건 흐름을 탐색하는 인터랙티브 맵은 `sg-worldline-map/`의 React/Vite SPA로 관리하며, 배포 시 정적 산출물을 `site/maps/`에 병합합니다.

위키 페이지는 Claude Code 에이전트 팀이 자동으로 작성·검수·커밋하며, 운영자는 관리 UI에서 실행·검토·승인합니다.

## 위키 구조

```text
wiki/
├── README.md          위키 안내 · 근거 체계 · 스포일러 배지 기준
├── _template/         문서 템플릿 (main, depth)
├── 커뮤니티-큐레이션/  커뮤니티 질문·토론 큐레이션 문서
├── 캐릭터/            캐릭터 문서
├── lore/              핵심 설정·사건 해설
├── organization/      조직·단체
├── setting/           세계관·배경
├── 세계선/  용어/   (한글 분류)
└── ...
```

각 문서 상단에는 스포일러 수준(`none` / `early_story` / `main_story` / `zero_story` / `endgame`)과 근거 태그(`[공식]` / `[팬 분석]`)가 표시됩니다. 자세한 체계는 [`wiki/README.md`](wiki/README.md)를 참고하세요.

### 위키 파일명과 내부 링크

- `wiki/캐릭터/`와 `wiki/lore/`의 문서 파일명은 한국어 독자를 기준으로 한 실제 작품 통용 명칭을 사용합니다.
- `SERN`, `D-RINE`, `D메일`, `IBN 5100`처럼 한국어 팬덤에서 원문·약어 표기가 통용되는 항목은 파일명에도 해당 표기를 유지합니다.
- 문서 이름을 바꿀 때는 변경 전에 기존 내부 링크를 확인하고, 파일 이동과 함께 모든 Markdown 상대 링크를 새 경로로 갱신해야 합니다.
- `The Mechanics of Steins;Gate v1.0.3` 인용은 GitHub PDF 원문 대신 로컬 번역본 `wiki/근거자료/비공식/mechanics-of-steins-gate/`의 구체적인 장 파일로 연결합니다. 절 번호가 `§3.1`이면 `ch3.md`, `§2.6.1`이면 `ch2.md`처럼 첫 자리 장 번호를 기준으로 매핑하고, 로컬 번역본에 대응 장이 없는 부록성 인용만 `index.md`를 사용합니다.
- 내부 링크 점검은 `scripts/wiki_link_lint.py`(결정적 정규식 funnel)로 자동화합니다. `make wiki-lint`로 전체를 스캔하면 깨진 링크 중 동일 파일명이 유일하게 존재하는 경우는 `--apply`로 자동 교정되고, 애매한 케이스(`[[wikilink]]`·링크 잔해 등)는 `suspicious` 목록으로 추려집니다. P1/P2/P5/P6의 `wiki-linker` 에이전트는 이 도구를 **강제로 1회 이상** 실행합니다.
- 링크 정리 후에는 `make wiki-build`로 MkDocs strict 빌드를 통과시켜야 합니다.

## 디렉터리 구조

```text
.
├── wiki/                 위키 마크다운 본문 (배포 대상)
├── docs/                 설계 문서 · 저작권 검토 · 계획
├── mkdocs.yml            MkDocs Material 설정
├── scripts/
│   ├── run_holyclaude_pipeline.mjs   P1~P7 파이프라인 실행 래퍼
│   ├── wiki_work_registry.mjs        병렬 실행 중복 주제 방지용 작업 현황 registry
│   ├── p6_demand_queue.mjs           P6 커뮤니티 큐레이션 후보 소비 큐 (add-candidates 병합 지원)
│   ├── p6_cluster_miner.mjs          P6 클러스터 원천 마이닝 상태 큐 (pending 소진 시 fallback, + test)
│   ├── wiki_link_lint.py             내부 링크 결정적 검사·자동 교정 funnel (+ test)
│   ├── humanize_protect_quotes.py    humanize 후 인용 블록을 전 스냅샷 기준으로 결정적 복원 (+ test)
│   ├── humanize_fact_guard.py        humanize 전/후 사실·수치·인용·스포일러 불변식 결정적 가드 (+ test)
│   ├── humanize_coverage.mjs         P5 humanize 백필 완료 파일 표식 (`.admin/humanize-coverage.json`)
│   └── poll_suggestions.py           R2에서 제안 수신 → suggestions/inbox/
├── sg-worldline-map/    세계선 인터랙티브 맵 React/Vite SPA (`/maps/`)
├── worker/               "제안하기" 폼을 받는 Cloudflare Worker (R2 + KV)
├── docker/holyclaude/    Claude Code 에이전트 팀 + 관리 UI 컨테이너
├── data/
│   ├── qaset_with_rag/   P1 근거용 RAG 소스 (gitignored)
│   ├── dc_gallery/       P6 커뮤니티 큐레이션 분석 입력 (gitignored)
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
make wiki-lint         # 내부 링크 결정적 스캔 (scripts/wiki_link_lint.py)
make test              # scripts 단위 테스트 (wiki_link_lint · humanize_fact_guard · humanize_protect_quotes)
```

> 배포는 GitHub Pages(현재 기본 경로)로도 연동됩니다. MkDocs 설정은 `mkdocs.yml`을 참고하세요.

### 위키 테마

MkDocs Material 기본 구조 위에 `wiki/assets/stylesheets/sg-theme.css`와 `wiki/javascripts/sg-enhance.js`를 로드합니다. 커스텀 CSS는 Pretendard/JetBrains Mono 폰트, 어두운 슈타인즈 게이트 톤, 표·인용·내비게이션 강조를 담당하고, JS는 본문 안의 `**[공식]**`, `**[팬 분석]**`, `**[심층]**` 태그를 칩 스타일로 변환합니다. 테마 변경 후에는 `make wiki-build`로 정적 빌드를 확인하세요.

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
make build           # Docker 이미지만 빌드 (컨테이너 시작 안 함)
make down            # 중지
make restart         # holyclaude 서비스 재시작 (재빌드 없음)
make logs            # 로그 스트리밍
make shell           # 컨테이너 bash 접속
```

> `docker compose`는 `--env-file .env`로 `.env`의 환경변수를 컨테이너에 전달합니다.
> Makefile의 `restart`/`logs`/`shell` 타깃은 Compose 서비스명 `holyclaude`를 대상으로 하며, Docker API와 환경 변수에서는 컨테이너명 `sg-wiki-holyclaude`를 사용합니다.

| Compose 서비스 | 컨테이너 | 포트 | 역할 |
|---|---|---|---|
| `holyclaude` | `sg-wiki-holyclaude` | 3001 · 37700 | Claude Code 에이전트 팀 (위키 집필 · 제안 처리) · [claude-mem 메모리 뷰어](#에이전트-메모리-claude-mem) |
| `admin` | `sg-wiki-admin` | 3002 | 관리 UI — cron 스케줄 · 수동 트리거 · 실행 현황 · 검토 |
| `ontology` | `sg-wiki-ontology-http` | 8093 | P1 커버리지용 sg-ontology HTTP MCP bridge |

### 관리 UI (`http://localhost:3002`)

- 파이프라인 1 (콘텐츠 생성) / 파이프라인 2 (제안 처리) / 파이프라인 3 (온톨로지 저작) / 파이프라인 4 (품질 검사) / 파이프라인 5 (위키 정비) / 파이프라인 6 (커뮤니티 큐레이션) / 파이프라인 7 (규칙 승격 제안) 수동 실행
- 수동 실행은 팀 버튼 선택 → 사용자 지시 확인·수정 → **실행** 버튼 순서로 시작합니다. 팀별 기본 지시 프리셋은 `docker/holyclaude/admin/presets.json`에서 로드되며, 파일을 수정하면 다음 페이지 새로고침부터 반영됩니다.
- **(선택) 사용자 지시** 입력 칸: 텍스트를 넣으면 팀장(team-lead) 에이전트 프롬프트에 추가 지시로 전달 (`POST /trigger/pN` 본문 `user_instruction`). 비워도 되며, 보안·게이트 규칙은 지시보다 우선합니다.
- Cron 스케줄 설정 (APScheduler, 기본값 `0 * * * *`)
- 최근 실행 로그 자동 갱신
- **진행 중 / 대기 중 작업** 패널: 동시 실행 현황(실행 N/cap · 대기 M), 실행 경과·마지막 출력·wall/idle deadline, 실행/대기 작업 취소
- 런타임 진단: `/diagnostics/runtime`에서 active run ID, holyclaude 프로세스 스냅샷, claude-mem proxy health 확인
- 새로 작성되거나 변경된 `wiki/*.md` 페이지 검토: 보기 · 승인 · 거부
- 제안 자동 처리: `suggestions/inbox/` 수신 제안과 파이프라인 2 자동 판정·작성 로그 (`GET /suggestions`)
- 규칙 승격 검토: P7이 생성한 `.admin/rule-promotions/<run_id>/manifest.json` 제안을 파일별 diff로 확인하고, 제안 본문을 직접 수정한 뒤 승인해야 실제 규칙 파일에 적용 (`GET /rule-promotions`)

### 에이전트 메모리 (claude-mem)

`sg-wiki-holyclaude` 컨테이너에 [claude-mem](https://github.com/thedotmack/claude-mem) 영속 메모리가 통합돼 있습니다. 에이전트 세션의 도구 호출·편집·명령이 자동으로 observation으로 캡처·요약되어 다음 세션에 맥락으로 주입됩니다.

- **뷰어**: `http://localhost:37700` — 메모리 스트림·검색 (`mem-search`).
- **데이터**: named volume `sg-wiki-claude-mem` → `/home/claude/.claude-mem` (SQLite + Chroma). drvfs bind mount가 아닌 Docker 로컬 볼륨이라 SQLite 락이 안전하고 컨테이너 재빌드에도 보존됩니다.
- **격리**: sg-wiki 전용 단일 볼륨·단일 worker — 다른 프로젝트 데이터는 섞이지 않습니다.
- **요약 LLM·인증**: Z.AI `glm-4-flash` 사용 (`CLAUDE_MEM_MODEL`). claude-mem 워커는 컨테이너 env가 아닌 `~/.claude-mem/.env`에서 SDK 인증을 읽으므로, `claude-mem-bootstrap.sh`가 매 기동마다 `$ZAI_API_KEY`로 이 파일을 생성합니다(별도 키 불필요). 파일이 없으면 OAuth 키체인으로 폴백 → "Not logged in" 루프로 observation/summary가 0건이 됩니다.
- **동작**: 배치 파이프라인 P1~P6은 기본적으로 `settingSources: ['project','local']`만 로드해 user plugin hook 자동 발화를 차단합니다. P7 또는 `HOLYCLAUDE_PIPELINE_ENABLE_AUTO_HOOKS_FOR_BATCH=1`일 때만 user settings까지 로드합니다. 능동 검색은 에이전트 프롬프트에서 `mem-search` 사용을 지시할 때만 동작합니다.
- **운영 기본값**: worker/install은 `claude-mem@13.9.1`로 고정합니다. s6 longrun은 `worker-service.cjs --daemon`을 감시하고 없을 때만 worker를 다시 시작합니다. 자동 context는 최근 observation/session만 좁게 주입하고 semantic inject는 끄며, `Read`/`LS`/`Grep` 같은 noisy tool은 캡처에서 제외합니다.
- **LLM proxy**: claude-mem LLM 요청은 `claude-mem-llm-proxy`를 거쳐 admin의 실행/대기 작업 수가 임계값 이하일 때만 upstream으로 전달됩니다. proxy는 admin 조회 timeout, fail-open, queue cap, queue TTL, `/health`를 제공합니다.

> 변경(`Dockerfile`·`docker-compose.yaml`·`scripts/claude-mem-*`·s6 서비스)은 이미지에 베이크되므로 `make up`(재빌드)으로 반영합니다.

### Humanize KR 플러그인 (AI-문체 제거)

`sg-wiki-holyclaude` 컨테이너에 [Humanize KR](https://github.com/epoko77-ai/im-not-ai)(`humanize-korean@im-not-ai`, MIT) 플러그인이 설치돼 있습니다. P5·P6의 `wiki-humanizer` 에이전트가 `/humanize --strict`로 한국어 AI 작성 흔적(번역투·헤징·형식명사·기계적 리듬)을 사실 불변으로 제거합니다.

- **부트스트랩(최신 자동 추종)**: `docker/holyclaude/scripts/humanize-bootstrap.sh`가 claude-mem 부트스트랩과 동일하게 entrypoint에 체인되어 **매 부팅마다 marketplace update + plugin install로 최신 버전을 refresh**합니다. sentinel(`~/.claude/plugins/.humanize-installed`)은 최초 설치 표식으로만 쓰고 업데이트는 sentinel과 무관하게 실행합니다. 네트워크/설치 실패 시 warn 후 exit 0으로 부팅을 막지 않으며(기존 버전 유지), 플러그인은 bind-mount된 `~/.claude/plugins/`에 설치되어 재빌드 후에도 persist합니다.
- **Batch slash command 등록**: P1~P6 batch 실행은 user hooks 차단을 위해 기본적으로 `settingSources=project,local`만 사용합니다. 따라서 P5/P6는 `scripts/run_holyclaude_pipeline.mjs`가 `HUMANIZE_PLUGIN_DIR`(기본 `~/.claude/plugins/cache/im-not-ai/humanize-korean/1.5.0`)을 SDK local plugin으로 명시 주입해 `/humanize` slash command를 등록합니다.
- **버전 pin**: `HUMANIZE_PLUGIN_REF` 환경변수를 설정하면 최신 자동 추종 대신 특정 버전으로 고정합니다(upstream 파괴적 변경 임시 격리용). 비워두면 최신을 따릅니다.
- **보이스 프로파일**: `docker/holyclaude/data/claude/author-context.yaml`이 sg-wiki 문체 규칙(합니다체 유지, 인용 블록 `> **[공식]**`/`> **[팬 분석]**`/`> **[심층]**` 불변, 스포일러 배지 불변, 내부 식별자 미삽입, 고유명사 화이트리스트)을 정의합니다. upstream v1.5 fast path에서는 자동 로드가 보장되지 않으므로, deterministic safety는 아래 가드와 팀장 diff가 담당합니다.
- **인용 블록 보호**: humanize 후 `scripts/humanize_protect_quotes.py`가 전 스냅샷의 `>` 인용 블록 라인을 결정적으로 복원한 뒤, `scripts/humanize_fact_guard.py`가 숫자 토큰·인용 블록 텍스트·frontmatter `spoiler` 동일성을 검증합니다. quote-line 개수/순서가 바뀌어 복원할 수 없거나 가드가 위반되면 해당 파일은 되돌려지고 커밋되지 않습니다.
- **백필 표식**: P5는 `scripts/humanize_coverage.mjs list`로 `.admin/humanize-coverage.json`을 읽어 이미 처리된 파일을 우선 제외하고, humanize+가드 통과 후 `mark`로 완료 표식을 남깁니다.

**롤백**:
- *플러그인 제거*: `humanize-bootstrap.sh` 호출을 entrypoint에서 비활성화하고, 컨테이너에서 sentinel(`~/.claude/plugins/.humanize-installed`)과 marketplace clone(`~/.claude/plugins/marketplaces/im-not-ai`)을 삭제한 뒤 재기동합니다. 부트스트랩을 유지한 채 sentinel만 삭제하면 다음 부팅에서 재설치됩니다.
- *백필 되돌림*: P5 백필은 파일당 배치 커밋이므로 문제가 된 배치 커밋을 `git revert`로 원복합니다.
- *버전 격리*: upstream 회귀가 의심되면 `HUMANIZE_PLUGIN_REF`로 직전 정상 버전을 pin해 최신 추종을 임시 중단합니다.

> `humanize-bootstrap.sh`·`Dockerfile`·`entrypoint-cmem.sh` 변경은 이미지에 베이크되므로 `make up`(재빌드)으로 반영합니다. `author-context.yaml`은 bind-mount되어 즉시 반영됩니다.

## 파이프라인

각 파이프라인은 `sg-wiki-admin`이 Docker socket을 통해 `sg-wiki-holyclaude` 컨테이너 안에서 `/workspace/scripts/run_holyclaude_pipeline.mjs`를 실행합니다. admin은 실행을 `setsid` 프로세스 그룹으로 격리하고 wall/idle watchdog과 running cancel을 적용합니다. 실행 중 상태는 관리 UI와 `sg-wiki-holyclaude` 로그 스트림에서, 결과 요약은 `.admin/runs/*.json`에서 확인합니다.

### 동시 실행과 중복 주제 방지

- 파이프라인은 **전역 풀로 최대 10개까지 병렬 실행**(`ADMIN_MAX_CONCURRENT_RUNS`). p1/p2가 섞여 실행될 수 있습니다.
- 초과 트리거는 **단일 전역 FIFO 대기열**에 들어가, 실행 슬롯이 비면 자동으로 시작됩니다. 관리 UI에서 순번 확인 및 실행/대기 작업 취소(`DELETE /run/{run_id}`) 가능합니다.
- 동일 주제·동일 파일 중복 작성은 `scripts/wiki_work_registry.mjs`가 막습니다. 팀장 에이전트는 주제 선정 전 registry를 읽어 진행 중인 주제/파일을 회피하고, writer 호출 전 `reserve`로 최종 점유합니다. 완료/거부 시 `complete`/`release`로 registry에서 제거합니다. admin reaper는 active run 목록 밖의 stale registry 예약을 `reconcile`로 정리합니다.

### 파이프라인 1 — 콘텐츠 생성

위키작성 팀장(wiki-team-lead)이 planner → writer → source-sanitizer → commit/push 흐름을 총괄합니다. 팀장은 기획서를 `APPROVED PLAN` / `REJECTED PLAN` / `REVISION REQUESTED`로 판정하고, 승인된 경우에만 writer를 호출합니다.

커밋 전에 아래 7개 항목이 각각 별도 성공 MCP 호출로 확인되어야 하며, 하나라도 빠지면 P1은 실패 처리되고 commit/push하지 않습니다: dataforge `qaset_with_rag`, `sg_game_sg0_en`, `sg_paper`, `sg_game_sge`, `fandom_episodes`, `namuwiki`, `sg-ontology`. 단, `fandom_episodes`는 호출 시도만으로 pass하며 결과(빈 결과·실패)는 무관합니다.

> 자율 push 경로: `sg-wiki-holyclaude` 컨테이너는 `data/cloudcli/auth.db`에서 GitHub 토큰을 읽는 git credential helper(`docker/holyclaude/scripts/git-credential-cloudcli-github`)로 P1이 생성한 위키 변경을 직접 commit/push합니다.

### 파이프라인 2 — 제안 처리

P2 실행 래퍼는 R2/mock R2 폴링 후 제안을 자동 분류·판정합니다. `approved` 판정은 위키 작성 에이전트와 sanitizer로 전달되어 통과한 위키 변경만 **commit**하고(아래 push 승인 게이트 참고), `rejected`/`partial` 판정은 위키 파일을 수정하지 않습니다. `suggestions/decisions/` 파일은 `automated=true` 상태 표시용 런타임 산출물이며 git에 포함하지 않습니다.

**push 승인 게이트**: P2는 `git push`를 실행하지 않고 **commit까지만** 수행합니다(P2 파이프라인 프롬프트 지침). 미push 커밋은 관리 UI "제안 자동 처리 → push 대기"에 표시되며, 운영자가 **"승인 후 push"** 버튼(`POST /suggestions/push/approve`)을 눌러야 원격에 반영됩니다. P1/3/5/6은 기존대로 자동 push를 유지합니다. 관리 UI의 제안 항목은 접고/펼칠 수 있고, "확인"하면 "과거 제한 사항" 섹션(`.admin/suggestion_ack.json`)으로 이동합니다.

### 파이프라인 5 — 위키 정비 (Humanize KR 통합)

P5는 기존 `wiki/*.md` 페이지를 선정해 파일당 `wiki-restructurer`(구조) → `wiki-rewriter`(위키 고유 교정) → `wiki-humanizer`(AI-문체 제거) → `source-sanitizer` → `humanize_protect_quotes` → `humanize_fact_guard` → `wiki-linker` → 팀장 diff → commit/push 순으로 정비합니다. 역할 분리 원칙에 따라 **`wiki-rewriter`는 VOCAB_GUIDE 용어 통일·한자/영한 혼동 정리·내부 식별자 스크럽·사실/스포일러 보존 검토**만 맡고, **번역투·헤징·형식명사·기계적 리듬 같은 일반 AI-문체 교정은 `wiki-humanizer`가 [Humanize KR](https://github.com/epoko77-ai/im-not-ai) 플러그인(`/humanize --strict`)으로 전담**합니다(이중 편집 방지). 작품명·고유 명사·세계관 로어에서 정착한 영어/약어와 한국어 혼용은 유지하지만, 한자 자체는 본문에 남기지 않습니다.

humanize는 문체만 손보고 사실·수치·인용·스포일러는 바꾸지 않습니다. 플러그인이 인용 블록 안의 문장부호나 볼드를 바꾸면 `scripts/humanize_protect_quotes.py`가 전 스냅샷 기준으로 `>` 라인을 복원하고, 이후 `scripts/humanize_fact_guard.py`가 숫자 토큰·인용 블록 텍스트·frontmatter `spoiler` 동일성을 결정적으로 재검증합니다. quote-line 개수/순서가 바뀌거나 가드가 위반(exit 1)하면 팀장은 해당 파일 변경을 `git checkout`으로 되돌리고 registry release하며 **commit하지 않습니다**. 플러그인이 미설치·실행 실패이면 문체 제거 없이 파이프라인이 진행됩니다(부팅 비블로킹과 동일 원칙).

**기존 문서 백필은 별도 러너 없이 P5에 위임**합니다. humanize 단계가 P5에 배선된 뒤, P5를 반복 실행(admin cron 또는 수동 트리거)해 기존 문서를 1회당 ≤5개씩 registry 예약·게이트 검증·배치 커밋으로 점진 처리합니다. 각 run은 기존 게이트를 그대로 통과해야 커밋되고, 처리 표식으로 재실행 시 중복 없이 재개됩니다.

### 파이프라인 6 — 커뮤니티 큐레이션

P6는 `data/dc_gallery/wiki_candidates/all_wiki_candidates.csv`에서 정규화한 소제(subtopic) 후보 큐를 소비해, DCinside 슈타게 갤러리의 커뮤니티 질문·오해·토론 수요를 바탕으로 위키 문서를 새로 만들거나(근거 합리 시에만) 기존 문서를 보강합니다. 신규 문서의 기본 경로는 `wiki/커뮤니티-큐레이션/`이며, **양식 제한 없이** genre(`faq`/`simple_q`/`complex_q`/`debate` 토론 중개/`deep_dive` 유저 통찰 기반 심층연구/`editorial` 사설)에 맞는 양식을 자율 선택합니다. 후보 소비 상태는 `.admin/p6-demand-queue.json`에 저장되고, 실제 파일 충돌 방지는 기존 `scripts/wiki_work_registry.mjs` 파일 단위 락을 함께 사용합니다.

CSV 후보를 모두 소진해 pending이 없으면 **클러스터 마이닝 fallback**으로 새 후보를 발굴합니다. `scripts/p6_cluster_miner.mjs`가 `data/dc_gallery/segmentation/all_clusters_summary.csv`를 `total_score` 내림차순으로 소비해 아직 마이닝하지 않은 클러스터 1개를 선점하고(상태: `.admin/p6-cluster-mining-state.json`), `wiki-demand-miner` 에이전트가 그 `cluster_<id>/report.md`·`eda.csv`에서 후보를 최대 3개 추출합니다. 팀장은 `p6_demand_queue.mjs add-candidates`로 큐에 병합(제목 기준 후보 단위 중복 차단)한 뒤 같은 run에서 새 후보 1개를 즉시 소비합니다.

```bash
node scripts/p6_demand_queue.mjs normalize
node scripts/p6_demand_queue.mjs next --run-id <id> --priority high
node scripts/run_holyclaude_pipeline.mjs p6 --run-id <id> --dry-run
```

P6 커뮤니티 큐레이션 팀장(`wiki-demand-lead`)은 `wiki-demand-analyst` 보고서의 `genre`·`evidence_grade`를 근거로 네 경로 중 하나로 라우팅합니다 — `create(fact)`는 P1 planner/writer 경로, `editorial`은 wiki-writer 사설 브리프, 근거 기반 `content-update`는 wiki-writer 섹션 병합(문체 전용 rewriter 아님), `style-only`는 wiki-rewriter(위키 고유 교정) → wiki-humanizer(`/humanize --strict` AI-문체 제거). `update`는 `evidence_grade=corroborated`이고 새 사실 출처가 합리적일 때만 허용하며, `community_only`(미검증) 주장은 사설로 처리합니다. humanize를 거친 문서는 P5와 동일하게 `humanize_protect_quotes` 복원 후 `humanize_fact_guard` 불변 가드로 검증합니다. sanitizer/linker/quality gate와 구조화 리포트(`.admin/runs/p6-<run_id>-report.json`)를 통과한 `wiki/*.md`만 commit/push하고, `data/dc_gallery/`, `.admin/`, 큐/리포트 파일은 git에 포함하지 않습니다.

### 파이프라인 7 — 규칙 승격 제안

P7은 claude-mem 관측에서 반복되는 운영 결정·품질 경고·표기 판단을 찾아, 규칙 파일로 승격할 **제안**만 생성합니다. 실행 자체는 규칙 파일을 직접 수정하지 않고 `.admin/rule-promotions/<run_id>/` 아래 manifest와 proposed 파일을 남깁니다.

```bash
node scripts/run_holyclaude_pipeline.mjs p7 --run-id <id> --dry-run
```

적용 대상은 `AGENTS.md`, `README.md`, `wiki/README.md`, `docker/holyclaude/data/claude/CLAUDE.md`, `docker/holyclaude/data/claude/agents/*.md`로 제한됩니다. admin UI의 “규칙 승격 검토”에서 파일별 전후 diff를 확인하고, 필요하면 제안문을 수정한 뒤 승인해야 실제 파일에 적용됩니다. 대상 파일이 제안 생성 후 바뀌면 `before_sha256` 검증으로 승인 적용이 막힙니다.

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
- `ADMIN_ACTIVE_RUNS_STATE`: active/queued run 상태 파일, 기본값 `/workspace/.admin/active-runs.json`
- `ADMIN_RUN_MARKER_DIR`: 프로세스 그룹 PGID marker 디렉터리, 기본값 `/tmp/sg-wiki-runs`
- `ADMIN_TERMINATE_GRACE_SECONDS`: cancel/timeout 시 TERM 후 KILL까지 대기 시간, 기본값 `20`
- `ADMIN_REAPER_INTERVAL_SECONDS`: stale 예약 회수/timeout 점검 주기, 기본값 `60`
- `ADMIN_P5_MAX_FILES_PER_RUN`: P5 한 run에서 허용하는 최대 registry 파일 수, 기본값 `5`. 초과 시 watchdog이 `p5_file_budget_exceeded`로 실행을 종료한다.
- `ADMIN_P{N}_WALL_TIMEOUT_SECONDS`, `ADMIN_P{N}_IDLE_TIMEOUT_SECONDS`: 파이프라인별 watchdog override
- `ADMIN_RULE_PROMOTION_ROOT`: P7 규칙 승격 제안 manifest/proposed 파일 저장 위치, 기본값 `/workspace/.admin/rule-promotions`
- `ADMIN_SUGGESTION_ACK_STATE`: 제안 "확인"(과거 제한 사항) 보관 상태 파일, 기본값 `/workspace/.admin/suggestion_ack.json`
- `ADMIN_PRESETS_FILE`: 관리 UI 수동 실행 팀별 사용자 지시 프리셋 JSON, 기본값 `/workspace/docker/holyclaude/admin/presets.json`
- `HOLYCLAUDE_PIPELINE_MODEL`: 파이프라인 실행 모델, 기본값 `glm-5.2`
- `HOLYCLAUDE_PIPELINE_ENABLE_AUTO_HOOKS_FOR_BATCH`: `1`이면 P1~P6도 user settings hook을 로드, 기본값 `0`
- `HUMANIZE_PLUGIN_REF`: Humanize KR 플러그인 설치 참조(pin). 비워두면 매 부팅 최신 버전을 자동 추종하고, 특정 버전으로 고정하려면 이 값을 설정합니다(upstream 회귀 임시 격리용).
- `CLAUDE_MEM_ADMIN_URL`, `CLAUDE_MEM_PROXY_ADMIN_TIMEOUT_MS`, `CLAUDE_MEM_PROXY_FAIL_OPEN_AFTER_MS`, `CLAUDE_MEM_PROXY_MAX_QUEUE`, `CLAUDE_MEM_PROXY_MAX_QUEUED_AGE_MS`, `CLAUDE_MEM_PROXY_UPSTREAM_TIMEOUT_MS`: claude-mem LLM proxy 안정성/큐 제어
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
- [holyclaude 컨테이너 작업 안내](docker/holyclaude/AGENTS.md)
- [holyclaude 위키 에이전트 팀 설계](docs/holyclaude-wiki-agent-팀-설계.md)
- [제안 처리 팀 설계](docs/제안%20처리%20팀%20설계.md)
- [RAG 소스 저작권 검토](docs/rag-소스-저작권-검토.md)
- [SG 위키 유지 관리 계획](docs/sg%20위키%20유지%20관리%20계획.md)
