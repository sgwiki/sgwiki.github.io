# 슈타인즈 게이트 한국어 위키 — 현실 구축 계획

> **상태**: approved (플래너 1차 산출, 4개 핵심 분기 합의 완료)
> **작성일**: 2026-06-18
> **대상 독자**: 본 프로젝트 운영자 + 실행 에이전트(ralph/team)
> **관련 문서**:
> - 초안(연구 에세이): `docs/슈타인즈 게이트 위키 구축 플랜 초안.md` ← 아키텍처 전면 변경으로 대체
> - 유지관리 요구: `docs/sg 위키 유지 관리 계획.md`
> - 1차 산출 검토: `docs/plan.md`
> - 2차 확장(레거시): `.omx/plans/phase2-wiki-expansion.md`

---

## 0. 초안과의 차이 — 왜 아키텍처를 바꿨는가

초안은 MediaWiki + Cargo + SMW + Pywikibot + Wikibase를 제안했다. 실측 결과 이 스택은 현재 자산과 정면 충돌한다.

| 초안 제안 | 실측 현실 | 결론 |
|---|---|---|
| MediaWiki (PHP/MySQL) | 이미 `wiki/*.md`(마크다운) + Git + Python 파이프라인이 가동 중 | **정적 사이트로 전환**. DB/PHP 운영 0 |
| Cargo 인라인 쿼리 | `CONCEPT_CATALOG`(15개) + Python 그룹핑이 이미 동등 기능 수행 (`scripts/qa_wiki_pipeline.py:60`) | **Python 빌드 스크립트로 대체** |
| Pywikibot 봇 자동업로드 | `qa_wiki_extract_langchain.py`가 직접 md 생성 | **파일 직접 쓰기**. API 레이어 불필요 |
| Mermaid/Cargo timeline 시각화 | 마크다운 Mermaid 블록으로 동일 렌더링 가능 | **정적 사이트 Mermaid 플러그인으로 대체** |
| MediaWiki 거버넌스(톡·권한·롤백) | Git이 이미 히스토리·롤백·diff 제공 | **Git + AI PR 리뷰**로 대체 |

**핵심 전환**: 초안의 "위키 엔진이 지식 구조를 담당" → "마크다운이 지식을 담고, **MCP 기반 AI Agent**가 구조·검증·반영 결정을 담당". 위키 엔진은 단순 렌더러로 축소.

---

## 1. 요구사항 요약

### 1.1 확정된 4개 결정 (인터뷰 합의)

| 결정 | 선택 | 근거 |
|---|---|---|
| 서빙 | **정적 사이트**(마크다운 + Git) | "서빙은 가볍게" + 현재 아키텍처 정합 |
| 기여 UX | **웹 폼**(옵션 B) | 나무위키식 저진입, GitHub 계정 불필요 |
| 거버넌스 | **모델 2**(티어별 분기) | [공식]/팩트는 AI 자동머지, [팬 분석]/해석은 AI 제안+리뷰 후 사람 승인 |
| 작성 Agent | **다수 MCP**(A 기능분산 + C 티어별 서브에이전트) | "여러 MCP 바탕" + 티어별 차등 신뢰도 |

### 1.2 기능적 요구사항

- **R1 — 서빙**: `wiki/`를 렌더링하는 정적 사이트. 한국어 검색, Mermaid 인과 다이어그램, 세계선 타임라인, 스포일러 경고 표시. 배포 자동화.
- **R2 — 기여**: 정적 사이트 내 "제안하기" 폼. 누구나 닉네임/익명 제출. GitHub 불필요.
- **R3 — 거버넌스**: 유저 제안 → AI Agent가 티어 분류 → [공식]/팩트 레인은 자동머지, [팬 분석]/해석 레인은 제안+리뷰코멘트 후 사람 승인 큐. 결과를 Git 커밋으로 반영.
- **R4 — 작성 Agent**: 다수 MCP(검색/저장소/검증/출력) + 티어별 서브에이전트 분기. 리뷰 코멘트 생성 및 반영/일부반영/거절 판정까지 수행.
- **R5 — 데이터 전수 처리**: 18,604건 중 현재 1,605건(8.6%)만 처리. 잔여 16,999건 + 카테고리 전수 미분류 해소.

### 1.3 비기능적 요구사항

- **NFR1 — 가벼움**: 상시 서버는 정적 호스팅 + 게이트웨이 1개(Cloudflare Worker 무료티어 목표). AI 가공은 로컬 instance.
- **NFR2 — 신뢰도 티어 보존**: `wiki/README.md`의 [공식]/[팬 분석] 체계를 AI 결정 로직에 강제 반영.
- **NFR3 — 롤백 가능**: 모든 AI 반영은 Git 커밋. 오반영 시 `git revert`로 1초 복구.
- **NFR4 — 한국어 품질**: 번역투 금지. `prompts/wiki_writing_system.md` 규칙 준수.

---

## 2. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│  [온라인] Cloudflare Pages(정적 사이트) + Worker(제안 게이트웨이)        │
│                                                                          │
│  유저 ──"제안하기" 폼──▶ Worker ──POST──▶ 로컬 큐(suggestions/inbox/)    │
│   │                          (hCaptcha + rate-limit)                        │
│   │                                                                          │
│   └─ 위키 열람(검색/Mermaid/Timeline/스포일러배지)                          │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ webhook / cron poll
┌──────────────────────────────────▼──────────────────────────────────────┐
│  [로컬 instance] AI 위키 Agent (MCP 기반, A+C 결합)                          │
│                                                                              │
│  제안 수신 ─▶ [분류 서브에이전트] ─ 티어 판정                                   │
│                                                                              │
│        ├─ [공식 레인]   official-verify MCP ─▶ 자동머지 Git 커밋            │
│        ├─ [팩트 레인]   fact-check MCP     ─▶ 자동머지 Git 커밋            │
│        └─ [팬분석 레인] writing MCP + review MCP ─▶ 사람 승인 큐            │
│                                                                              │
│  MCP (기능분산, A):                                                           │
│   • wiki-search   : grep over wiki/ + reference/ (RAG 역할)                  │
│   • wiki-store    : filesystem + git over wiki/                              │
│   • official-verify: reference/official/ 기반 정합성 검증                     │
│   • source-fetch  : Brave/Fetch (나무위키·공식 사이트 교차확인)               │
│   • queue         : filesystem over suggestions/ (상태머신)                  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ git push
                      ┌────────────▼────────────┐
                      │  Git repo → CI 빌드     │
                      │  → Cloudflare Pages 배포 │
                      └─────────────────────────┘
```

### 2.1 디렉토리 구조 (신규/변경)

```
fg-lab-kr/
├── wiki/                         # (기존) 마크다운 위키 — 그대로 서빙 소스
│   ├── README.md, _template/, lore/   # 1차 완성
│   ├── characters/, faq/, game/       # 2차 확장 (phase2-wiki-expansion.md)
│   └── mkdocs.yml                     # [신규] 정적 사이트 설정
├── data/
│   ├── qaset_with_rag/               # (기존) 18,604건 RAG 답변
│   ├── qaset_with_rag_index.csv      # (기존) 카테고리 미분류 → [신규] 분류 채우기
│   └── canonical/                    # [신규] 정제된 정사 데이터 (YAML/JSON)
├── reference/                        # (기존) 공식/팬 근거 — AI 검증 소스
├── suggestions/                      # [신규] 유저 제안 큐 + AI 결정 로그
│   ├── inbox/                        #   신규 제안 (JSON)
│   ├── review/                       #   [팬분석] 사람 승인 대기 (md + AI 리뷰)
│   └── decisions/                    #   결정 이력 (반영/일부반영/거절 + 근거)
├── agent/                            # [신규] MCP 서버 + 오케스트레이터
│   ├── mcp/
│   │   ├── wiki_search.py            #   MCP: 검색
│   │   ├── wiki_store.py             #   MCP: 저장소/git
│   │   ├── official_verify.py        #   MCP: 공식 검증
│   │   ├── source_fetch.py           #   MCP: 외부 교차확인
│   │   └── queue.py                  #   MCP: 제안 큐 상태머신
│   ├── orchestrator.py               #   티어 분기 + 레인 디스패치 (C)
│   ├── classifier.py                 #   [공식]/[팬분석]/[팩트] 분류
│   └── prompts/
│       ├── classifier_system.md      #   티어 분류 프롬프트
│       ├── canon_lane.md             #   공식 레인 (자동머지)
│       ├── fan_lane_writing.md       #   팬분석 레인 작성 (기존 wiki_writing 재사용)
│       └── review_decision.md        #   반영/일부반영/거절 판정
├── worker/                           # [신규] Cloudflare Worker (제안 게이트웨이)
│   └── suggest.ts                    #   폼 수신 → 로컬 큐 포워딩
├── scripts/                          # (기존) + [신규]
│   ├── qa_wiki_extract_langchain.py  #   (기존) 데이터 정제 — 전수 처리에 재사용
│   ├── qa_wiki_pipeline.py           #   (기존) CONCEPT_CATALOG 그룹핑
│   ├── build_qaset_index.py          #   (기존) 인덱스 생성
│   ├── categorize_qaset.py           #   [신규] 18,604건 카테고리 분류 채우기
│   └── build_canonical.py            #   [신규] 정사 데이터 추출 (reference/official → YAML)
└── .github/workflows/
    ├── deploy.yml                    #   [신규] wiki/ 변경 시 Pages 배포
    └── agent-trigger.yml             #   [신규] 제안 도착 시 로컬 Agent 트리거
```

---

## 3. 구현 단계 (파일 참조 포함)

### Phase 0 — 정적 사이트 서빙 (R1) ⏱ 1~2일

**목표**: 기존 `wiki/` 마크다운을 즉시 온라인으로. 비용 0.

| 단계 | 작업 | 파일 |
|---|---|---|
| 0.1 | SSG 선정: **MkDocs Material** (마크다운 네이티브, Mermaid 플러그인, 한국어 검색 내장, 설정 최소). Astro Starlight는 차선. | — |
| 0.2 | `wiki/mkdocs.yml` 작성: 한국어 `language: ko`, Mermaid 플러그인, `nav` 자동 생성, 스포일러 배지용 커스텀 CSS | `wiki/mkdocs.yml` [신규] |
| 0.3 | 초안의 Mermaid 인과 다이어그램(세계선 분기)을 `wiki/lore/worldline.md`에 블록 추가 — 기존 md 그대로 렌더링 | `wiki/lore/worldline.md` |
| 0.4 | 세계선 타임라인: 초안의 Cargo timeline → `mkdocs-material`의 `timeline` short code 또는 `timelinejs` 임베드. 데이터는 `data/canonical/worldlines.yaml`에서 읽어 md 자동 생성 | `scripts/build_canonical.py` [신규], `wiki/lore/worldline.md` |
| 0.5 | CI 배포: Cloudflare Pages (또는 GitHub Pages). `mkdocs build` → 배포 | `.github/workflows/deploy.yml` [신규] |

**검증**: `mkdocs serve` 로컬에서 Mermaid/Timeline/검색 동작 확인. 배포 후 URL 접속.

### Phase 1 — 제안 게이트웨이 + 큐 (R2) ⏱ 1일

**목표**: 누구나 웹 폼으로 제안. GitHub 불필요.

| 단계 | 작업 | 파일 |
|---|---|---|
| 1.1 | 정적 사이트에 "제안하기" 페이지 (닉네임/익명, 제안 대상 문서, 제안 내용, 출처). HTML 폼 | `wiki/contribute.md` [신규] |
| 1.2 | Cloudflare Worker `worker/suggest.ts`: hCaptcha + rate-limit( IP당 5건/시간) 후 로컬 큐로 POST. 큐는 파일(JSON) 저장 | `worker/suggest.ts` [신규] |
| 1.3 | 제안 큐 상태머신: `inbox` → `review`(AI 리뷰 후) → `decisions`(결정). JSON에 `status`, `tier`, `ai_review`, `human_decision` 필드 | `agent/mcp/queue.py` [신규] |
| 1.4 | 스팸 대응: hCaptcha + 길이 제한 + 중복 제안 감지(유사도 임계) | `worker/suggest.ts` |

**검증**: 폼 제출 → `suggestions/inbox/`에 JSON 생성 확인. 스팸 시도 차단 확인.

> **제안 큐 위치 결정(보류 → 기본값 채택)**: 인터뷰에서 큐 위치(GitHub Issue vs 로컬)를 명시적으로 확정하지 못함. "가공은 로컬 instance" 요구와 "사람 승인 큐" 운영을 고려해 **로컬 파일 큐(`suggestions/`)를 기본**으로 한다. 단, 운영자 토론 편의를 위해 `decisions/` 결정 이력을 선택적으로 GitHub Issue로 미러링하는 옵션을 열어둔다(Phase 4에서 재검토).

### Phase 2 — MCP 서버 (R4, A 구성) ⏱ 2~3일

**목표**: 표준 stdio MCP 서버 5종. Python MCP SDK 기반. Claude/Cursor/pi 어디든 부착 가능.

| MCP | 도구 | 구현 |
|---|---|---|
| **wiki-search** | `search_wiki(query)`, `search_reference(query)`, `get_doc(path)`, `list_concepts()` | `agent/mcp/wiki_search.py`. `ripgrep` 기반. `reference/official/`, `reference/user/`, `wiki/` 인덱스. CONCEPT_CATALOG(15개) 노출 |
| **wiki-store** | `read_doc(path)`, `write_doc(path, content)`, `create_doc(path, content)`, `git_commit(message, files)`, `git_diff()` | `agent/mcp/wiki_store.py`. 위키 md 읽기/쓰기 + git 래퍼. 모든 쓰기는 로그 남김 |
| **official-verify** | `verify_against_official(claim, doc_ids)`, `find_supporting_quote(claim)`, `check_contradiction(claim)` | `agent/mcp/official_verify.py`. `reference/official/` 3문서(QA자료집·RE-BOOT 인터뷰·WePlay 토크) 기반 정합성 검증. 인용구 추출 |
| **source-fetch** | `fetch_url(url)`, `brave_search(query)`, `get_namuwiki(slug)` | `agent/mcp/source_fetch.py`. 외부 교차확인(나무위키·공식). rate-limit 내장 |
| **queue** | `list_inbox()`, `get_proposal(id)`, `move_to_review(id, ai_review)`, `record_decision(id, verdict, rationale)`, `list_decisions()` | `agent/mcp/queue.py`. 제안 상태머신 |

**검증**: 각 MCP를 독립 단위 테스트(`pytest`). MCP inspector로 도구 목록·호출 응답 확인.

### Phase 3 — 오케스트레이터 + 티어 분기 (R3, R4 C 구성) ⏱ 2~3일

**목표**: 제안 → 티어 분류 → 레인 디스패치 → 결정. 핵심 거버넌스 로직.

| 단계 | 작업 | 파일 |
|---|---|---|
| 3.1 | **분류 서브에이전트**: 제안을 `[공식 범위]`(세계선 원리·메커니즘·SERN), `[팩트]`(시청순서·플랫폼·구매·작품관계), `[팬 분석/해석]`(캐릭터 서사·설정 해석·번외)로 분류. `reference/official/` 검색 hit 여부로 1차 판정 | `agent/classifier.py`, `agent/prompts/classifier_system.md` [신규] |
| 3.2 | **공식 레인 (자동머지)**: `official-verify` MCP로 주장 검증. 지지 인용 있으면 머지, 모순 발견 시 거절. `wiki-store.git_commit`으로 반영 | `agent/prompts/canon_lane.md` [신규] |
| 3.3 | **팩트 레인 (자동머지)**: 시청순서·플랫폼 등 사실 확인. `source-fetch`로 교차확인 후 머지 | 동일 |
| 3.4 | **팬분석 레인 (사람 승인)**: `wiki_writing_system.md` 프롬프트 재사용해 제안 초안 작성 → `review_decision` 프롬프트로 반영/일부반영/거절 판정 + 리뷰 코멘트 생성 → `suggestions/review/`에 적재 | `agent/prompts/fan_lane_writing.md`(기존 재사용), `agent/prompts/review_decision.md` [신규] |
| 3.5 | **오케스트레이터**: `inbox` 폴링 → 분류 → 레인 디스패치 → 결정 기록. cron 또는 webhook 트리거 | `agent/orchestrator.py` [신규] |
| 3.6 | **결정 로깅**: 모든 결정(반영/일부반영/거절)에 근거(인용구·검증 결과·참고 출처) 명시. `suggestions/decisions/{id}.json` | `agent/mcp/queue.py` |

**검증**: 3개 티어 샘플 제안 각각 주입 → 올바른 레인으로 라우팅·결정 확인. 거절 시 근거 명시 확인.

### Phase 4 — 데이터 전수 처리 (R5) ⏱ 3~5일 (LLM 비용 회피가 관건)

**목표**: 16,999건 잔여 + 18,604건 카테고리 분류.

| 단계 | 작업 | 파일 |
|---|---|---|
| 4.1 | **카테고리 분류**: 18,604건을 `CONCEPT_CATALOG`(15개) + question_type(설정해석/시청순서/...)으로 분류. `data/qaset_with_rag_index.csv`의 빈 `category` 컬럼 채우기. 기존 `qa_wiki_pipeline.py`의 `heuristic_extract`(`scripts/qa_wiki_pipeline.py:1136`)를 1차 패스로, LLM을 2차 패스로 | `scripts/categorize_qaset.py` [신규] |
| 4.2 | **1,605건 기존 처리 결과 정합**: `artifacts/qa-wiki/runs/20260523-135619-auto-full`의 66개 그룹을 `wiki/`에 정식 반영 (현재는 lore/만). 2차 확장 계획(`phase2-wiki-expansion.md`)의 characters/faq/game 디렉토리 생성 | `scripts/qa_wiki_pipeline.py:712 command_group` 재실행 |
| 4.3 | **needs_human_review 774건(48%) 검수 워크플로**: 이건 AI 자동 처리 불가. `suggestions/review/`와 동일한 사람 승인 큐로 흘려보내 일괄 검수 | `agent/orchestrator.py` 확장 |
| 4.4 | **정사 데이터 추출**: `reference/official/`에서 정사(세계선 다이버전스·어트랙터 필드·생존 여부)를 `data/canonical/*.yaml`로 구조화. Cargo DB 대체 | `scripts/build_canonical.py` [신규] |
| 4.5 | 잔여 16,999건은 카테고리별로 우선순위 큐. 설정해석(49%)은 공식 레인, 캐릭터/사건(25%)은 팬분석 레인으로 라우팅 | `agent/orchestrator.py` |

**검증**: 분류 후 카테고리 분포 합리적(초안 표의 49/25/7/6/5... 패턴). `canonical/worldlines.yaml`이 `reference/official/`과 정합.

### Phase 5 — 운영 하드닝 ⏱ 1~2일

| 단계 | 작업 |
|---|---|
| 5.1 | P1~P3 패치(`docs/plan.md` 권고): 인터럽트 회복성, 비용 누수 방지, validation 강화, singleton 그룹 병합 |
| 5.2 | 봇/스팸 방어 강화, rate-limit 튜닝 |
| 5.3 | 모니터링: 제안 처리량, AI 결정 분포(자동머지 vs 거절 비율), 사람 승인 대기 건수 대시보드 |
| 5.4 | 백업: Git 원격 + `decisions/` 정기 아카이브 |

---

## 4. 승인 기준 (Acceptance Criteria) — 100% 테스트 가능

### 서빙 (R1)
- [ ] AC1.1: 배포된 URL에서 한국어 전문 검색 시 상위 5개 결과가 정확히 매칭 (쿼리 "리딩 슈타이너" → `reading-steiner.md` 노출)
- [ ] AC1.2: `wiki/lore/worldline.md`의 Mermaid 다이어그램이 브라우저에서 그래프로 렌더링 (이미지 깨짐 0)
- [ ] AC1.3: 각 문서 상단 스포일러 배지(none/early_story/main_story/zero_story/endgame)가 정확히 표시
- [ ] AC1.4: `wiki/` 변경 커밋 푸시 후 5분 이내 Pages에 반영 (CI 로그 타임스탬프로 확인)
- [ ] AC1.5: 상시 서버 비용 = 0 (Cloudflare Pages + Worker 무료티어 내)

### 기여 (R2)
- [ ] AC2.1: GitHub 계정 없이 폼 제출 가능. 익명 제출 시 `suggestions/inbox/{id}.json` 생성 (`submitted_by: "anonymous"`)
- [ ] AC2.2: 동일 IP 6번째 제출 시 429 응답 (rate-limit 동작)
- [ ] AC2.3: hCaptcha 미통과 시 제안 거부

### 거버넌스 (R3)
- [ ] AC3.1: [공식 범위] 제안(예: "세계선은 하나만 활성화")이 `official-verify`로 지지 인용 발견 시 10분 이내 자동 Git 커밋
- [ ] AC3.2: [팬 분석] 제안은 자동 머지 없이 `suggestions/review/`에 AI 리뷰코멘트와 함께 적재. 사람 승인 전까지 `wiki/` 미반영
- [ ] AC3.3: 거절 시 `decisions/{id}.json`에 근거(모순 인용 또는 지지 인용 부재)가 1개 이상 명시
- [ ] AC3.4: 오반영 건을 `git revert`로 30초 이내 복구 가능

### 작성 Agent (R4)
- [ ] AC4.1: 5개 MCP가 표준 stdio 프로토콜로 응답 (MCP inspector로 도구 목록 5종 확인)
- [ ] AC4.2: Claude Desktop, Cursor, pi 환경 각각에서 동일 MCP 구성 부착 후 `search_wiki("세계선")` 호출 성공
- [ ] AC4.3: 팬분석 레인이 `wiki_writing_system.md`의 [공식]/[팬 분석] 인용 규칙을 준수한 md를 생성 (루브릭 체크)
- [ ] AC4.4: 분류기가 테스트 셋 30개(티어별 10개)에서 ≥90% 정확도로 분류

### 데이터 (R5)
- [ ] AC5.1: `qaset_with_rag_index.csv`의 `category` 컬럼이 18,604건 모두 채워짐 (빈값 0건)
- [ ] AC5.2: 카테고리 분포가 합리적 범위 (설정해석 40~55%, 캐릭터/사건 20~30% 등)
- [ ] AC5.3: `data/canonical/worldlines.yaml`의 모든 다이버전스 수치가 `reference/official/`에 근거 (출처 필드 100% 채움)

---

## 5. 리스크와 완화

| 리스크 | 확률 | 영향 | 완화 |
|---|---|---|---|
| **공식 근거 부족**(reference/official 단 3문서) → 공식 레인 판정 근거 얇음, 오머지 | 높음 | 높음 | (1) 공식 범위를 좁게 정의(세계선 원리·메커니즘 한정). (2) 지지 인용 1개 + 모순 0개일 때만 머지. (3) 의심 시 항상 팬분석 레인(사람 승인)으로 회피 |
| **AI 오머지/오거절** | 중간 | 높음 | (1) 모든 자동머지는 별도 커밋 + `git revert` 즉시 복구. (2) 자동머지 비율 모니터링, 임계 초과 시 사람 검토로 전환 |
| **팬분석 레인 사람 승인 병목** (기존 needs_review 48% + 유저 제안) | 높음 | 중간 | (1) 주 1회 배치 검수로 흡수. (2) AI 리뷰코멘트로 사람 판단 부담 경감. (3) 동일 주제 제안은 병합 처리 |
| **RAG 자기참조**(청크가 전부 dcinside) → AI 답변이 팬 의견을 정사처럼 서술 | 높음 | 높음 | (1) 기존 18,604건 답변은 기본 [팬 분석] 티어로 강제 분류. (2) `official-verify` MCP가 reference/official 미지원 시 자동으로 팬분석 레인으로 강등 |
| **LLM 비용 폭발**(16,999건 잔여 처리) | 중간 | 중간 | (1) heuristic 1차 패스(비용 0) 후 LLM 2차만. (2) `docs/plan.md` P2 권고(429 circuit breaker, mode 필터) 적용 |
| **스팸/남용**(웹 폼 개방) | 중간 | 중간 | hCaptcha + rate-limit + 중복 감지 + 신규 IP 1일 N건 제한 |
| **MCP 표준 파편화**(환경별 호환) | 낮음 | 중간 | 표준 stdio MCP + Python SDK. 환경별 래퍼만 분리 |
| **정적 사이트 인과 다이어그램 복잡도**(세계선 분기가 너무 많음) | 중간 | 낮음 | Mermaid `graph`로 핵심만, 상세는 클릭 뎁스 문서로 분리(기존 `depth.md` 패턴 재사용) |

---

## 6. 검증 단계 (전체 파이프라인 E2E)

1. **로컬 통합 테스트**: 샘플 제안 3종(티어별 1개)을 `suggestions/inbox/`에 수동 주입 → 오케스트레이터 실행 → 각 레인으로 분기·결정 확인
2. **온라인 E2E**: 실제 폼에서 3개 제안 제출 → 워커→큐→Agent→Git 커밋→Pages 배포까지 end-to-end 확인
3. **품질 게이트**: AI 생성 md를 `wiki_writing_system.md` 규칙(인용 태그·스포일러 배지·한국어 품질)으로 루브릭 평가. 기준 미달 시 사람 승인으로 강등
4. **롤백 드릴**: 의도적 오머지 후 `git revert` → 30초 복구 확인
5. **비용 정산**: 1주일 운영 후 Cloudflare/LLM 비용 측정. 무료티어 내 여부 확인

---

## 7. ADR (Architecture Decision Record)

**Decision**: MediaWiki + Cargo + Pywikibot 스택을 **포기**하고, 마크다운 + Git + 정적 사이트(MkDocs Material) + MCP 기반 AI Agent(A 기능분산 + C 티어별 서브에이전트) + Cloudflare Worker 게이트웨이 아키텍처로 전환.

**Drivers**:
1. "서빙은 가볍게" — 상시 서버/DB 운영 배제
2. 기존 `wiki/*.md` + Python 파이프라인 자산 존중 (1,605건 처리 결과 폐기 방지)
3. "나무위키식 + AI PR 리뷰" 거버넌스 요구
4. "여러 MCP 바탕" 작성 Agent 요구

**Alternatives considered**:
- (A) GitHub 네이티브(Issue/PR): 구현 최소지만 비개발자 팬덤 진입장벽 → 기각
- (B) 웹 폼 + 경량 API: 채택 (진입장벽 최소 + 백엔드는 Git 투명)
- (C) Outline/Wiki.js: 상시 서버로 "가볍게" 위배 → 기각
- 거버넌스 모델 1(완전 자율): 공식 근거 부족으로 오반영 위험 → 기각
- 거버넌스 모델 3(전수 사람 승인): "AI가 결정" 요구 위배 → 기각

**Why chosen**: B + 모델 2 + A+C 결합이 4개 핵심 결정을 모두 만족하면서 기존 자산을 최대 재사용.

**Consequences**:
- (+) 상시 서버 비용 0, 운영 부담 최소
- (+) AI 결정 로직이 Git에 투명하게 기록 (감사 가능)
- (+) MCP 표준으로 Agent 호스트 교체 용이
- (−) 팬분석 레인 사람 승인 큐 유지 필요 (주 1회)
- (−) 초안의 Cargo 인라인 쿼리 기능을 Python 빌드 스크립트로 재구현 필요

**Follow-ups**:
- 제안 큐 위치(로컬 vs GitHub Issue 미러링) Phase 4 재검토
- 공식 `reference/official/` 확장 필요 (공식 QA자료집 보강, 게임 TIPS 추출)
- 정사 데이터(`data/canonical/`) 체계화 후 Cargo 대체 기능 고도화

---

## 8. 실행 핸드오프 (ralph / team)

### 8.1 권장 실행 스타일

| 페이즈 | 독립성 | 병렬성 | 추천 |
|---|---|---|---|
| Phase 0 (서빙) | 높음 | 낮음 | ralph 순차 |
| Phase 1 (게이트웨이) | 높음 | 낮음 | ralph 순차 |
| Phase 2 (MCP 5종) | 높음 | **높음** (5개 독립) | team 병렬 (5 lane) |
| Phase 3 (오케스트레이터) | Phase 2 완료 후 | 중간 | ralph 순차 |
| Phase 4 (데이터) | 부분 (4.1/4.4 병렬) | 중간 | team (분류 lane + canonical lane) |
| Phase 5 (하드닝) | 높음 | 중간 | ralph 순차 |

### 8.2 team 라인 구성 (Phase 2 예시)

- Lane 1: `wiki-search` MCP (reasoning: medium)
- Lane 2: `wiki-store` MCP (reasoning: low)
- Lane 3: `official-verify` MCP (reasoning: high — 검증 정확도 중요)
- Lane 4: `source-fetch` MCP (reasoning: low)
- Lane 5: `queue` MCP (reasoning: low)

### 8.3 team 검증 경로

- team 종료 전: 5개 MCP 각 단위 테스트 통과 + MCP inspector 응답 확인
- ralph 후속 검증: 오케스트레이터 통합 테스트 + E2E (샘플 제안 3종 주입)

### 8.4 실행 명령 힌트

```
# Phase 0+1+3+5 (순차): ralph
$ralph docs/SG 위키 현실 구축 계획.md

# Phase 2 (MCP 5종 병렬): team
omx team --lanes 5 --plan "docs/SG 위키 현실 구축 계획.md#phase-2"
```

---

## 9. 체크리스트 (최종)

- [ ] 승인 기준 100% 테스트 가능 (AC1~AC5 검증 방법 명시)
- [ ] 파일 참조 80%+ (기존 스크립트·프롬프트·reference 모두 경로 명시)
- [ ] 모든 리스크에 완화책 존재 (8개 리스크)
- [ ] 모호어 없음 ("가볍게" → "비용 0 / 상시서버 0", "빠르게" → "5분 이내 배포")
- [ ] 계획 저장: 본 파일 + `.omx/plans/sg-wiki-realistic-plan.md`
