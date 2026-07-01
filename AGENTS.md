# AGENTS.md

이 파일은 (자동화된) 코딩 에이전트가 sg-wiki 저장소에서 작업할 때 알아야 할 핵심 컨텍스트를 제공합니다. 일반 개발자 온보딩 문서와 겹치는 부분은 [`README.md`](README.md)를, 위키 집필 규칙은 [`wiki/README.md`](wiki/README.md)를 참고하세요.

## 프로젝트 개요

슈타인즈 게이트 **한국어 설정 해설 위키**. 위키 본문은 `wiki/` 아래 마크다운으로 관리되고, MkDocs Material로 빌드해 [GitHub Pages](https://sgwiki.github.io/)에 배포. 위키 페이지는 Claude Code 에이전트 팀이 자동 작성·검수·커밋하며, 운영자는 관리 UI로 실행·검토·승인.

## 핵심 디렉터리

| 경로 | 역할 | 추적 여부 |
|---|---|---|
| `wiki/` | 위키 마크다운 본문 (배포 대상) | tracked |
| `docs/` | 설계·계획·저작권 검토 문서 | tracked |
| `scripts/run_holyclaude_pipeline.mjs` | P1/P2/P3/P4/P5/P6/P7/P8/P9 파이프라인 실행 래퍼 | tracked |
| `scripts/wiki_work_registry.mjs` | 병렬 실행 중복 주제 방지 registry | tracked |
| `scripts/wiki_link_lint.py` | 내부 링크 결정적 검사·자동 교정 funnel(wiki-linker 강제 사용). `--file`/`--scan`, `--apply`, `--json`. ok/autofix/broken/suspicious/external 분류 | tracked |
| `scripts/humanize_protect_quotes.py` | legacy humanize 산출물 검증용 Markdown 인용 블록(`>`) 라인 복원. quote-line 개수/순서 변경 시 exit 1 | tracked |
| `scripts/humanize_fact_guard.py` | legacy humanize 전/후 숫자·인용 블록·frontmatter `spoiler` 불변식 검사. 위반 시 exit 1 | tracked |
| `scripts/humanize_coverage.mjs` | legacy humanize 백필 표식(`.admin/humanize-coverage.json`) 관리. `list`/`mark`/`unmark`/`stats` | tracked |
| `scripts/p6_demand_queue.mjs` | P6 커뮤니티 큐레이션 후보 소비 큐 (`add-candidates`로 외부 후보 병합 지원) | tracked |
| `scripts/p6_cluster_miner.mjs` | P6 클러스터 원천 마이닝 상태 큐 (`data/dc_gallery/segmentation/all_clusters_summary.csv` 소비, pending 후보 소진 시 fallback) | tracked |
| `scripts/poll_suggestions.py` | R2 → `suggestions/inbox/` 제안 폴링 | tracked |
| `scripts/fetch_fandom_episodes.mjs` | Fandom `Category:Episodes` → `data/fandom_episodes/` 마크다운 수집·변환 (영문 원문+한국어 번역용 원문) | tracked |
| `scripts/gen_episodes_readme.mjs` | `data/fandom_episodes/README.md` 인덱스 자동 생성 | tracked |
| `sg-worldline-map/` | `/maps/`로 배포되는 세계선 인터랙티브 맵 React/Vite SPA | tracked |
| `worker/` | "제안하기" 폼 Cloudflare Worker | tracked |
| `docker/holyclaude/` | 에이전트 팀 + 관리 UI 컨테이너 정의 | tracked |
| `docker/holyclaude/AGENTS.md` | holyclaude 컨테이너 작업 시 추가 주의사항 | tracked |
| `mkdocs.yml` / `Makefile` | 위키 빌드 설정 · 명령 래퍼 | tracked |
| `data/qaset_with_rag/`, `data/공식 자료집/`, `data/dc_gallery/`, `data/fandom_episodes/` | RAG 소스·공식 자료·P6 커뮤니티 큐레이션 입력·Fandom 에피소드 데이터 (대용량) | **gitignored** |
| `suggestions/` | 수신 제안 + 처리 상태 (런타임) | **gitignored** |
| `.admin/` | 실행 로그 · 위키 검토 · registry · locks (런타임) | **gitignored** |
| `docker/holyclaude/data/cloudcli/` | GitHub 토큰 DB (`auth.db`) — **절대 커밋 금지** | **gitignored** |
| `docker/holyclaude/data/claude/sessions/` 등 | Claude Code 런타임 산출물 | **gitignored** |
| `.env` | ZAI/GLM 자격증명 · R2 설정 | **gitignored** |

> `.gitignore`는 **라인 끝 인라인 주석을 지원하지 않습니다** (`pattern # comment` 형태 금지). 주석은 항상 별도 라인에.

## 자주 쓰는 명령

```bash
make up       # 에이전트 팀 + 관리 UI 빌드 & 시작
make build    # Docker 이미지만 빌드 (컨테이너 시작 안 함)
make wiki-serve          # 위키 로컬 미리보기 (localhost:8000)
make wiki-build          # 정적 사이트 빌드 (site/)
make wiki-deploy         # 빌드 후 Cloudflare Pages 배포
make worker-dev          # 제안 폼 Worker 로컬 개발
```

파이프라인 스크립트 단독 점검:

```bash
node --check scripts/run_holyclaude_pipeline.mjs
node --check scripts/wiki_work_registry.mjs
node --check scripts/p6_demand_queue.mjs
node --check scripts/p6_cluster_miner.mjs
node --check scripts/humanize_coverage.mjs
python3 scripts/test_humanize_fact_guard.py
python3 scripts/test_humanize_protect_quotes.py
node scripts/run_holyclaude_pipeline.mjs p1 --run-id <id> --dry-run   # 부작용 없는 dry-run
node scripts/run_holyclaude_pipeline.mjs p1 --run-id <id> --instruction "..." --dry-run   # 선택 사용자 지시(--instruction) 주입
node scripts/run_holyclaude_pipeline.mjs p7 --run-id <id> --dry-run   # claude-mem 규칙 승격 제안 dry-run
node scripts/run_holyclaude_pipeline.mjs p9 --run-id <id> --dry-run   # 위키 심층 조사(사실 정정 권한) dry-run
make test                                             # scripts 단위 테스트 (wiki_link_lint, humanize_fact_guard, humanize_protect_quotes)
make wiki-lint                                        # 내부 링크 결정적 스캔 (전체 wiki/)
python3 scripts/wiki_link_lint.py --file wiki/<cat>/<slug>.md --json   # 단일 파일 분류(교정 제안)
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

### 위키 테마

- MkDocs Material 기본 테마 위에 `wiki/assets/stylesheets/sg-theme.css`를 `extra_css`로 로드한다. `mkdocs.yml`의 `theme.font: false`는 Material의 Roboto 자동 로드를 끄고, CSS에서 Pretendard/JetBrains Mono를 직접 로드하기 위한 설정이다.
- `wiki/javascripts/sg-enhance.js`는 본문 렌더 후 `**[공식]**`, `**[팬 분석]**`, `**[심층]**` 강조 텍스트를 `.sg-tag` 칩으로 장식한다. Material instant navigation 대응을 위해 `document$` 구독 경로를 유지한다.
- 테마나 JS를 바꾸면 `make wiki-build`로 MkDocs 빌드와 asset 경로를 확인한다.

### 파이프라인 1 (콘텐츠 생성)

`sg-wiki-admin`이 Docker socket으로 `holyclaude` 컨테이너 안에서 `run_holyclaude_pipeline.mjs p1`을 실행. 팀장(wiki-team-lead)이 하위 에이전트를 조율:

```
팀장: 주제 선정 → wiki-planner(기획서) → APPROVED 판정 → wiki-writer(초안) → source-sanitizer → wiki-linker → wiki-quality-lead(gate) → commit/push
```

- **MCP 커버리지 게이트**: 커밋 전 7개 항목이 각각 별도 성공 호출로 확인되어야 함. 하나라도 빠지면 실패 처리, commit/push 금지. 단, `fandom_episodes`는 호출 시도만으로 pass(결과 무관).
  - dataforge `qaset_with_rag`, `sg_game_sg0_en`, `sg_paper`, `sg_game_sge`, `namuwiki`, `sg-ontology`, `fandom_episodes`
- **자율 push**: `holyclaude` 컨테이너가 `data/cloudcli/auth.db`의 GitHub 토큰을 읽는 credential helper(`docker/holyclaude/scripts/git-credential-cloudcli-github`)로 P1 결과를 직접 commit/push.
- **위키 집필 규칙** (모든 에이전트 필수 준수): `sg_game_sge`·`sg_game_sg0_en` 원문 직접 인용 금지(파라프레이즈·풀어쓰기·내용 재료로 간접 사용만) / 소스명·파일명·chunk ID·source_filter 이름 공개 위키 노출 금지.
- **fandom_episodes (dataforge 소스)**: Fandom 위키 애니메이션 에피소드(본편·0·극장판) 줄거리. **P1 러너 강제 커버리지 7번째 항목**이며, P6에서는 analyst가 조회하는 **공통 권장 소스**(러너 강제는 아님 — `P6_REQUIRED_COVERAGE`는 qaset·namuwiki·dc_gallery 3개). 메타데이터 필터는 `series`만 유효(`Steins;Gate`·`Steins;Gate 0`·`Steins;Gate: The Movie - Load Region of Déjà Vu`), `lang`(전부 bilingual)·`ep`(사후 필터)은 무효. qaset·namuwiki 동일 취급 — 산문 가공·출처 미표시, 직접 인용/Fandom URL/식별자(`doc_id`·`source_type=fandom_wiki`) 노출 금지. **커버리지는 호출 시도만으로 pass(결과 무관)**.

### 파이프라인 2 (제안 처리)

`suggestions/inbox/` 제안 → wiki-classifier(분류) → suggestion-judge(판정) → `approved`만 writer/sanitizer/wiki-linker 경유 commit. `rejected`/`partial`은 위키 파일 미수정.

- **push 승인 게이트 (P2 전용)**: P2는 **commit까지만** 수행하고 `git push`는 하지 않는다(`buildP2Prompt` 프롬프트 지침). 미push 커밋은 admin UI "제안 자동 처리 → push 대기"에 표시되고, 운영자가 **"승인 후 push"**(`POST /suggestions/push/approve`, holyclaude 컨테이너에서 실행)를 눌러야 원격에 반영된다. P1/3/5/6/8/9는 기존대로 자동 push를 유지한다.
- **확인 아카이브**: admin "제안 자동 처리" 항목은 헤더 클릭으로 접고/펼치며(기본 접힘), **"확인"** 버튼으로 "과거 제한 사항" 섹션(`.admin/suggestion_ack.json`)으로 이동, "복원"으로 되돌린다. `suggestions/decisions/`와 분리된 admin 전용 상태다.

### 파이프라인 4 (위키 품질 검사)

전체 감사(audit) 전용. wiki-quality-lead가 조율:

```
wiki/*.md 전체 → wiki-format-inspector(형식) → wiki-completeness-checker(완성도) → wiki-consistency-checker(일관성) → .admin/quality-audit-{날짜}.json
```

- **읽기 전용**: 파일 수정·commit 없음. 감사 리포트만 생성.
- **gate 모드도 지원**: 파이프라인 1에서 wiki-linker 통과 후 단일 파일 대상으로 자동 실행됨 (consistency-checker 제외).

### 파이프라인 5 (위키 정비)

전체 `wiki/*.md` 대상 구조·용어·링크 정비 전용. wiki-maintenance-lead가 조율:

```
wiki/*.md 전체 스캔 + registry active 제외
→ wiki-restructurer(섹션·헤더)
→ wiki-rewriter(위키 고유 교정: VOCAB_GUIDE 용어·한자/영한 혼동 정리·내부 식별자 스크럽)
→ source-sanitizer
→ wiki-linker(내부·외부 링크 검사·자동 교정·게이트)
→ commit/push
```

- **읽기+쓰기**: 정비 결과는 commit/push됨. 대규모 수정이므로 관리 UI에서 검토 후 승인 권장.
- **P5 runaway 방지**: 1회 실행은 기본 최대 5개 파일(`ADMIN_P5_MAX_FILES_PER_RUN`)만 처리한다. admin watchdog은 registry 처리 파일 수가 예산을 초과하면 `p5_file_budget_exceeded`로 프로세스 그룹을 종료한다. `/running` 응답은 `p5_files_processed`/`p5_files_active`/`p5_files_total`/`p5_file_budget`을 노출한다.
- **AI 문체 제거 분리**: P5는 `wiki-humanizer`, `/humanize`, `humanize_coverage`, `humanize_fact_guard`, `humanize_protect_quotes`를 호출하지 않는다. AI 문체 제거는 파이프라인 8에서 detector→fact-auditor→style-editor 구조로만 처리한다.
- **한자/영한 혼동 정리**: P5 `wiki-rewriter`는 `제0` → `제로` 같은 작품명 표기, 한자 혼입, 번역 누락형 영어/한글 혼동을 검사·교정한다. 작품명·고유 명사·세계관 로어에서 정착한 영어/약어와 한국어 혼용은 유지하되, 한자 자체는 공개 본문에 남기지 않는다.

### 파이프라인 6 (커뮤니티 큐레이션)

DCinside 슈타게 갤러리 유저 게시글을 커뮤니티 세그먼테이션으로 분석해 만든 소제(subtopic) 후보 큐를 소비해, 커뮤니티 질문·오해·토론 수요를 바탕으로 위키 문서를 생성하거나(근거 합리 시에만) 기존 문서를 보강한다. 신규 문서의 기본 경로는 `wiki/커뮤니티-큐레이션/`이며, **양식 제한 없이** 마이닝 결과에 맞는 최적 양식을 자율 선택한다. admin UI의 `/trigger/p6`가 `run_holyclaude_pipeline.mjs p6`를 실행하고, 커뮤니티 큐레이션 팀장(`wiki-demand-lead`)은 `wiki-demand-analyst` 보고서를 근거로 판정한다.

- **장르(genre, 후보당 1개·`type`과 직교)**: `faq`/`simple_q`/`complex_q`/`debate`(토론 중개)/`deep_dive`(유저 통찰 기반 심층연구)/`editorial`(사설).
- **근거 등급(evidence_grade)**: `corroborated`(사실검증 소스가 뒷받침)면 fact 페이지, `community_only`(수요만, 미검증)면 **`editorial`로 강등**(사실 단정·정전 페이지 업데이트 금지).

```
all_wiki_candidates.csv → p6_demand_queue normalize/next
  (pending 없으면 fallback: p6_cluster_miner normalize/next → wiki-demand-miner → p6_demand_queue add-candidates → 같은 run에서 next 재소비)
→ wiki-demand-analyst(genre·evidence_grade 판정)
→ 팀장 APPROVED 판정 → p6_demand_queue reserve + wiki_work_registry reserve
→ create(fact): wiki-planner→wiki-writer / editorial: wiki-writer 사설 브리프
  / content-update: wiki-writer 섹션 병합(rewriter 아님) / style-only: P8 후보로 보류
→ source-sanitizer → wiki-linker → wiki-quality-lead(gate)
→ .admin/runs/p6-{run_id}-report.json 검증 → wiki/*.md commit/push
```

- **2계층 동시성**: `scripts/p6_demand_queue.mjs`는 후보 소비 상태(`.admin/p6-demand-queue.json`)를, `scripts/wiki_work_registry.mjs`는 대상 wiki 파일 락을 담당한다. 둘 중 하나라도 예약 실패하면 writer/rewriter를 호출하지 않는다.
- **클러스터 마이닝 fallback**: pending 후보가 없으면 `scripts/p6_cluster_miner.mjs`(상태: `.admin/p6-cluster-mining-state.json`)가 `data/dc_gallery/segmentation/all_clusters_summary.csv`를 `total_score` 내림차순으로 소비해 미마이닝 클러스터 1개를 선점하고, `wiki-demand-miner`가 그 `cluster_<id>/report.md`·`eda.csv`에서 후보 JSON을 **최대 3개** 생성한다. 팀장이 `p6_demand_queue.mjs add-candidates`로 큐에 병합(후보 단위 중복 차단: 동일 `candidate_id` 또는 터미널 상태 동일 `normalized_title` skip)한 뒤 **cluster complete보다 먼저 실행**하는 순서를 지킨다. 새 후보 1개를 같은 run에서 즉시 소비하며, 마이닝 후 새 후보가 0개면 종료한다. `wiki-demand-miner`는 후보 JSON만 생성하고 글 작성·검증·commit을 하지 않는다.
- **업데이트 게이트**: `decision=update`는 `evidence_grade=corroborated`이고 새 사실 출처가 합리적일 때만 허용한다. 내용 보강은 문체 전용인 `wiki-rewriter`가 아니라 `wiki-writer`(섹션 병합)로 라우팅한다.
- **러너 강제 게이트**: P6 러너 강제 MCP 커버리지(`P6_REQUIRED_COVERAGE`)는 `qaset_with_rag`, `namuwiki`, `dc_gallery` 3개다. `fandom_episodes`는 analyst가 조회하는 공통 권장 소스이나 러너 강제 항목은 아니다. 러너는 구조화 리포트의 `supporting_count>0`, `sanitizer=pass`, `quality!=fail`을 검증한다(`genre`·`evidence_grade`는 선택 관측 필드로 미검증). `editorial`은 `decision=create`로 게이트를 통과한다.
- **commit 범위**: 통과한 `wiki/*.md`만 commit한다. `data/dc_gallery/`, `.admin/`(`p6-cluster-mining-state.json` 포함), 큐/리포트 파일은 절대 commit하지 않는다.
- **dc_gallery 위생 규칙**: 유저 게시글 근거는 산문 가공 전용이다. 각주, 원문 직접 인용, gall_num, chunk ID, source 이름, 내부 경로를 위키 본문에 노출하지 않는다.

### 파이프라인 7 (규칙 승격 제안)

claude-mem 관측에서 반복되는 운영 결정·표기 판단·quality/sanitizer 경고를 찾아 규칙 파일로 승격할 **제안만** 생성한다. admin UI의 `/trigger/p7`가 `run_holyclaude_pipeline.mjs p7`를 실행한다.

```
claude-mem mem-search(search→timeline→get_observations)
→ 반복성 있는 후보 선별
→ .admin/rule-promotions/{run_id}/manifest.json
→ .admin/rule-promotions/{run_id}/proposed/{proposal_id}.md
→ admin UI에서 파일별 diff/수정/승인
→ 승인된 proposal만 실제 규칙 파일에 적용
```

- **직접 적용 금지**: P7 실행 에이전트는 `AGENTS.md`, `README.md`, `wiki/README.md`, `docker/holyclaude/data/claude/CLAUDE.md`, `docker/holyclaude/data/claude/agents/*.md`를 직접 수정하지 않고 proposed 파일만 생성한다. git add/commit/push도 금지.
- **사용자 승인 필수**: admin UI의 “규칙 승격 검토”에서 사용자가 파일별 전후 diff를 보고, 필요 시 proposed 내용을 수정한 뒤 승인해야 실제 파일에 적용된다.
- **stale guard**: proposal의 `before_sha256`과 현재 대상 파일 hash가 다르면 승인 적용을 409로 막는다. 파일이 바뀐 경우 P7을 다시 실행하거나 proposed 내용을 재검토한다.
- **공개 금지 정보 유지**: source_filter 이름, chunk ID, 내부 RAG 경로, 원문 직접 인용은 proposal에도 넣지 않는다.

### 파이프라인 8 (AI 문체 제거)

기존 위키 페이지의 AI스러운 문장 리듬만 제한적으로 다루는 격리 파이프라인. admin UI의 `/trigger/p8`가 `run_holyclaude_pipeline.mjs p8`을 실행하고, wiki-style-lead가 조율한다.

```
wiki/*.md 전체 스캔 + registry active 제외
→ wiki-style-detector(읽기 전용 후보 range 탐지)
→ wiki-fact-auditor(읽기 전용 사실 민감도 감사, 불확실하면 거부)
→ wiki-style-editor(승인된 작은 range만 문체 완화)
→ source-sanitizer
→ wiki-linker
→ wiki-quality-lead(gate)
→ 팀장 diff 검토
→ commit/push
```

- **fail closed**: 출신·특징·관계·날짜·세계선 수치·표·frontmatter·인용·각주·링크 target 등 사실 민감 구역은 편집하지 않는다. 감사가 불충분하면 파일을 수정하지 않는다.
- **Humanize 금지**: P8도 `/humanize`나 `wiki-humanizer`를 호출하지 않는다. 자동 플러그인 rewrite 대신 line range 승인 기반 제한 편집만 허용한다.

### 파이프라인 9 (위키 심층 조사)

9개 파이프라인 중 **유일하게 `wiki/*.md`에 이미 적힌 사실을 근거 기반으로 직접 정정(correction)**할 수 있는 파이프라인(다른 파이프라인은 사실 변경 절대 금지). admin UI의 `/trigger/p9`가 `run_holyclaude_pipeline.mjs p9`을 실행하고, wiki-research-lead가 조율한다.

```
대상 선정(① user_instruction 지정 → ② 최신 .admin/quality-audit-*.json warn/fail → ③ .admin/p9-research-log.json 최오래 순회)
+ registry reserve
→ wiki-deep-researcher(읽기 전용, dataforge 6종+namuwiki+sg-ontology+wiki/근거자료/ 로컬 자료 전수 조사)
→ wiki-research-auditor(읽기 전용, addition/correction 이원 근거 게이트, fail-closed)
→ 분기: addition/correction → wiki-research-editor(승인 위치만 편집) / new_page_recommendation → wiki-planner→wiki-writer(P1 경로 재사용) / 둘 다 없음 → release
→ source-sanitizer → wiki-linker → wiki-quality-lead(gate)
→ 팀장(wiki-research-lead) diff 검토(correction 근거 재확인 필수) → commit/push
```

- **이원 근거 게이트**: `addition`(누락 보강)은 근거자료 단일 근거·dataforge 2개 이상 일치·MCP(dataforge/namuwiki/sg-ontology) 1개 이상 중 하나로 충분하다. `correction`(기존 서술 정정)은 이보다 엄격해 **공식 자료 직접 근거** 또는 **서로 다른 소스 유형 2개 이상 일치**를 요구하며, `addition` 기준(MCP 1개)만으로는 승인 불가.
- **P9 runaway 방지**: 1회 실행은 기본 최대 1개 파일(`ADMIN_P9_MAX_FILES_PER_RUN`)만 처리한다. admin watchdog은 registry 처리 파일 수가 예산을 초과하면 `p9_file_budget_exceeded`로 프로세스 그룹을 종료한다. `/running` 응답은 `p9_files_processed`/`p9_files_active`/`p9_files_total`/`p9_file_budget`을 노출한다(P5와 동일 패턴).
- **러너 강제 게이트**: `P9_REQUIRED_COVERAGE`는 `qaset_with_rag`·`namuwiki`·`sg-ontology` 3개뿐이다(대상 성격과 무관하게 항상 적용 가능한 항목만 하드 게이트). `sg_game_sg0_en`·`sg_paper`·`sg_game_sge`·`fandom_episodes`·`dc_gallery`는 시도만 확인하며 결과 유무는 게이트에 영향 없다. `dc_gallery`는 다른 파이프라인과 동일하게 수요/화제 신호 참고용일 뿐 사실 근거·각주로 사용하지 않는다.
- **`verifyP9Report`의 한계**: 러너가 `.admin/runs/p9-{run_id}-report.json`(top-level 배열 키는 `items`)을 읽어 `correction` 항목의 `evidence_sources.length >= 2` 또는 `evidence_grade === "official_direct"`를 검증하지만, 이는 팀장이 스스로 작성한 리포트를 신뢰하는 자체보고(self-attested) 기반 보조 게이트다. `correction`의 실질 1급 안전 통제는 팀장의 commit 전 diff 검토와 관리자의 `/wiki-review/reject`를 통한 commit 후 사후 롤백이다.

### 동시 실행과 중복 주제 방지

- **전역 풀 동시 실행 cap 10** (`ADMIN_MAX_CONCURRENT_RUNS`). p1/p2 혼합 가능. 초과분은 단일 전역 FIFO 대기열에 적재, 슬롯 해제 시 자동 시작.
- **per-pipeline 하드 락은 의도적 제거됨**. 대신 `scripts/wiki_work_registry.mjs`가 중복 주제를 막음:
  - 팀장이 주제 선정 전 `list`로 `active`를 읽어 진행 중 topic/file 회피
  - writer 호출 전 `reserve`로 atomic 점유 (파일 락 `p1-work-registry.lock`)
  - 완료/거부 시 `complete`/`release`로 `active`에서 프로그램적 제거
  - 12시간 미갱신 엔트리는 stale 자동 정리
- **결론**: 파이프라인 동시성을 다룰 때 `acquirePipelineLock` 같은 전체 직렬화 락을 다시 넣지 말 것. 중복 방지는 registry 계층에서만.
- P6는 registry 외에 별도 후보 소비 큐를 사용한다. `p6_demand_queue.mjs`는 후보 중복 소비를 막고, registry는 파일 충돌만 막는다.

## 위키 집필 규칙 (변경 시 주의)

- 모든 문서 상단에 스포일러 배지(`none`/`early_story`/`main_story`/`zero_story`/`endgame`)와 근거 태그(`[공식]`/`[팬 분석]`) 필수.
- 근거 체계·문서 구조 템플릿은 `wiki/README.md`와 `wiki/_template/`.
- `wiki/캐릭터/`와 `wiki/lore/` 파일명은 한국어 독자를 기준으로 한 실제 작품 통용 명칭을 사용한다. 단, `SERN`, `D-RINE`, `D메일`, `IBN 5100`처럼 한국어 팬덤에서 원문·약어 표기가 통용되는 항목은 그 표기를 유지한다.
- 위키 파일명을 바꿀 때는 먼저 기존 내부 링크를 조사하고, 파일 이동과 동시에 모든 Markdown 상대 링크를 새 경로로 갱신한다. 변경 후 템플릿을 제외한 실사용 내부 링크가 깨지지 않는지 확인하고 `make wiki-build`를 통과시킨다.
- `The Mechanics of Steins;Gate v1.0.3` 인용은 GitHub PDF URL로 되돌리지 말고 `wiki/근거자료/비공식/mechanics-of-steins-gate/`의 로컬 번역본에 연결한다. 절 번호의 첫 자리로 `ch1.md`~`ch4.md`를 고르고, 로컬 번역본에 대응 장이 없는 부록성 인용만 `index.md`에 연결한다.
- **직접 인용·식별자 노출 위반은 가장 흔한 reject 원인**. `sg_game_sge`·`sg_game_sg0_en` 모두 간접 사용(파라프레이즈)만 허용되며, 원문 블록 직접 인용·소스명·파일명·chunk ID 노출 시 reject.

## 코드 변경 시 주의

- **볼륨 마운트 vs 베이크**: `scripts/`, `docker/holyclaude/data/claude/`(에이전트 정의·CLAUDE.md·settings.json)는 컨테이너에 마운트되어 **재빌드 없이 즉시 반영**. 반면 `docker/holyclaude/Dockerfile`이나 `docker/holyclaude/admin/`(admin 서버 코드)은 이미지에 베이크되어 **재빌드 + 컨테이너 재생성 필요**.
- **Makefile Docker 타깃**: `restart`/`logs`/`shell`은 Compose 서비스명 `holyclaude`를 대상으로 한다. Docker API, `HOLYCLAUDE_CONTAINER`, 직접 `docker logs` 명령은 컨테이너명 `sg-wiki-holyclaude`를 사용한다.
- **admin 서버**(FastAPI, `docker/holyclaude/admin/app/main.py`): 동시성/큐 로직은 `active_jobs_lock`(threading.RLock)로 보호. `_pop_active_job` 완료 시 stale registry 예약 회수를 비동기로 트리거하고 `_dispatch_next_job`가 FIFO에서 다음 job을 승격한다. 실행 중 작업은 `setsid` 프로세스 그룹으로 격리하고 `/tmp/sg-wiki-runs/{run_id}.pgid` marker를 기록한다. `/run/{run_id}` DELETE는 queued뿐 아니라 running도 `terminating`으로 바꾸고 프로세스 그룹에 TERM→KILL을 보낸다. 기본 watchdog은 P1/P3/P5/P6/P8 wall 4h·idle 30m, P2/P4 wall 2h·idle 20m, P7 wall 45m·idle 15m, P9 wall 5h·idle 40m이며 `ADMIN_P{N}_WALL_TIMEOUT_SECONDS`/`ADMIN_P{N}_IDLE_TIMEOUT_SECONDS`로 조정한다. P5는 추가로 `ADMIN_P5_MAX_FILES_PER_RUN`(기본 5), P9는 `ADMIN_P9_MAX_FILES_PER_RUN`(기본 1)을 registry 기준으로 강제한다. active run 상태는 `.admin/active-runs.json`에 저장되고 admin 재시작 시 이전 active run을 실패 처리·정리한다.
- **사용자 지시(user instruction)**: 관리 UI 수동 실행은 팀 버튼 선택 → 사용자 지시 확인·수정 → `실행` 버튼 순서다. 팀별 기본 지시 프리셋은 `docker/holyclaude/admin/presets.json`에서 `/presets` API로 로드되며, `ADMIN_PRESETS_FILE`로 경로를 바꿀 수 있다. `(선택) 사용자 지시` 칸은 `POST /trigger/pN` 본문 `user_instruction` → `active_jobs[run_id]`에 저장(큐 대기→승격 경로도 보존, `_get_job_instruction`으로 회수) → `run_holyclaude_pipeline.mjs --instruction` → 팀장 프롬프트에 "추가 사용자 지시"로 주입. `_sanitize_instruction`(제어문자 제거·4000자 제한)과 `shlex.quote`로 안전 처리. **코드 강제 게이트(MCP 커버리지·source-sanitizer·검증)는 사용자 지시보다 우선**하며 프롬프트 텍스트로는 우회 불가.
- **테스트**: FastAPI TestClient는 요청 사이에 `asyncio.create_task`로 만든 백그라운드 작업을 취소하므로, 동시성 로직 테스트 시 실제 실행 대신 task를 기록하는 방식으로 격리해야 함.
- **동시 commit 경합**: cap 10 병렬 실행 시 `.git/index.lock` 충돌 가능. 드물게 발생하면 registry `committing` 상태 기반 직렬화 추가를 고려.
- **세계선 맵 SPA**: `sg-worldline-map/src/data/*.json`은 tracked 배포 입력이고 `dist/`, `node_modules/`, `*.tsbuildinfo`는 로컬 산출물이다. 맵 경로는 `/maps/` 전제이므로 `vite.config.ts`의 `base`, `index.html`의 favicon 경로, SPA fallback route를 함께 확인한다.
- **claude-mem 메모리 계층**: 에이전트 세션(도구 호출·편집·명령)을 자동 캡처·요약해 다음 세션에 맥락으로 주입. 뷰어 `http://localhost:37700`. 배치 파이프라인 P1~P6/P8/P9는 기본적으로 `settingSources: ['project','local']`만 로드해 user plugin hook 자동 발화를 차단하고, P7 또는 `HOLYCLAUDE_PIPELINE_ENABLE_AUTO_HOOKS_FOR_BATCH=1`일 때만 user settings까지 로드한다. 능동 검색(`mem-search`)은 프롬프트 지시 시에만. 데이터는 named volume `sg-wiki-claude-mem`(`/home/claude/.claude-mem`, SQLite+Chroma) — drvfs bind mount가 아니라 재빌드에 보존·SQLite 락 안전. worker/install은 `claude-mem@13.9.1`로 고정하고 s6 longrun(`scripts/s6/claude-mem-worker`)이 `worker-service.cjs --daemon` 프로세스를 감시한다(daemon이 없을 때만 `npx -y claude-mem@${CLAUDE_MEM_VERSION:-13.9.1} start --daemon` 실행). 자동 context는 observation/session 수를 좁게 제한하고 `CLAUDE_MEM_SEMANTIC_INJECT=false`, `CLAUDE_MEM_SKIP_TOOLS=Read,LS,Grep,Glob,...`로 noisy 캡처를 줄인다. `Dockerfile`·s6 스크립트·`docker-compose.yaml`은 이미지 베이크(재빌드 필요); `enabledPlugins`(`data/claude/settings.json`)는 마운트돼 즉시 반영. claude-mem 워커는 컨테이너 env가 아닌 `~/.claude-mem/.env`에서 SDK 인증을 읽으므로 `scripts/claude-mem-bootstrap.sh`가 매 기동마다 `$ZAI_API_KEY`로 이 파일을 생성 — 없으면 OAuth 폴백으로 관측·요약 생성이 "Not logged in" 루프로 전부 실패(0건). 529 과부하 오류를 방지하기 위해 LLM 요청은 `claude-mem-llm-proxy`가 가로채며, admin UI 진행 중/대기 중 작업 수(`running`+`queued`)가 임계값(`CLAUDE_MEM_PROXY_N`, 기본값 3) 이하일 때만 Z.AI 엔드포인트로 전송된다. proxy의 admin URL/timeout/fail-open/queue 제한은 `CLAUDE_MEM_ADMIN_URL`, `CLAUDE_MEM_PROXY_ADMIN_TIMEOUT_MS`, `CLAUDE_MEM_PROXY_FAIL_OPEN_AFTER_MS`, `CLAUDE_MEM_PROXY_MAX_QUEUE`, `CLAUDE_MEM_PROXY_MAX_QUEUED_AGE_MS`로 조정하며 `/health`를 제공한다.

## 컨테이너 상태 확인

```bash
curl -s http://127.0.0.1:3002/running    # 동시 실행 현황 (jobs/limit/running/queued)
curl -s http://127.0.0.1:3002/diagnostics/runtime # active run/process/proxy 진단
curl -s http://127.0.0.1:3002/status     # 최근 실행 결과
curl -s http://127.0.0.1:3002/rule-promotions # P7 규칙 승격 제안 목록
docker logs --tail 50 sg-wiki-admin      # admin 서버 로그
docker logs --tail 50 sg-wiki-holyclaude # 에이전트 팀 로그
curl -s http://127.0.0.1:37700/api/health # claude-mem worker 헬스
```

## 추가 문서

- [holyclaude 위키 에이전트 팀 설계](docs/holyclaude-wiki-agent-팀-설계.md)
- [holyclaude 컨테이너 작업 안내](docker/holyclaude/AGENTS.md)
- [제안 처리 팀 설계](docs/제안%20처리%20팀%20설계.md)
- [SG 위키 유지 관리 계획](docs/sg%20위키%20유지%20관리%20계획.md)
- [RAG 소스 저작권 검토](docs/rag-소스-저작권-검토.md)
- [세계선 인터랙티브 맵 개발 안내](sg-worldline-map/README.md)
