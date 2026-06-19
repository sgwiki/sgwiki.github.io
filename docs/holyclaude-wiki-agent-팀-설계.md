# holyclaude 기반 위키 작성 에이전트 팀 설계

> 작성일: 2026-06-19
> 관련 문서: `.omx/plans/sg-wiki-realistic-plan.md`, `docs/rag-소스-저작권-검토.md`

---

## 1. 배경

기존 플랜(sg-wiki-realistic-plan.md)의 Phase 2~3 — Python MCP 서버 5종 + orchestrator.py 직접 구현 — 을
**holyclaude 컨테이너 기반 Claude Code 네이티브 에이전트 팀**으로 대체하는 설계.

---

## 2. 인프라 구조

### 서버 레이어 (GitHub Pages + Cloudflare Worker — 비용 0)

```
GitHub Pages (sgwiki.github.io/)
  └── wiki/ 정적 사이트 (MkDocs Material)
        ├── 한국어 검색, Mermaid 다이어그램
        ├── 스포일러 배지
        └── 제안 히스토리 탭 (suggestions/decisions/ 기반)

Cloudflare Worker (worker/suggest.ts)
  └── "제안하기" 폼 수신
        ├── hCaptcha 검증
        ├── rate-limit (IP당 5건/시간)
        └── 통과 시 → R2에 JSON 저장

Cloudflare R2 (sg-wiki-suggestions 버킷)
  └── suggestions/{id}.json 버퍼
        Worker가 쓰고, 로컬 에이전트가 cron 폴링
```

### 로컬 인스턴스 (운영자 PC)

```
holyclaude 컨테이너 (포트 3001 웹 UI)
  ├── Claude Code CLI
  └── /workspace → /mnt/f/github/sg-wiki

dataforge 스택
  ├── dataforge-mcp-server  :8081  (qaset, 게임 스크립트, 논문)
  ├── dataforge-embedder    :8001
  ├── dataforge-reranker    :8002
  ├── dataforge-pgvector-db :5435
  └── dataforge-redis-cache :6379

sg-ontology-http       :8093  (SPARQL HTTP bridge)
namuwiki MCP           stdio  (나무위키 스크래핑)
```

**트리거:**
- 수동: 운영자가 웹 UI(포트 3001)에서 실행
- 자동: 웹 UI에서 cron 스케줄 설정 및 관리

### holyclaude 파일 구조

```
docker/holyclaude/data/claude/       →  /home/claude/.claude/
├── CLAUDE.md                        ← 팀장 행동 규칙 + 판단 기준 + 소스 정책
├── settings.json                    ← MCP 3종 등록
└── agents/
    ├── wiki-planner.md
    ├── wiki-writer.md
    ├── wiki-classifier.md
    ├── suggestion-judge.md
    └── source-sanitizer.md
```

---

## 3. MCP 구성

모든 에이전트(팀장 + 하위 에이전트 전원)가 동일하게 접근.
[공식]/[팬 분석] 구분은 정보 접근 권한이 아닌 출처 신뢰도 판단용.

| MCP | 접근 방식 | 용도 |
|---|---|---|
| `dataforge` | HTTP :8081 | qaset 18,604건, 게임 스크립트, 팬 논문 semantic search |
| `sg-ontology` | HTTP :8093 | 세계선·어트랙터 필드·인과관계 SPARQL |
| `namuwiki` | stdio | 나무위키 스크래핑 |
| `Bash(rg)` | 직접 | `data/공식 자료집/`, `reference/official/` 탐색 |

### settings.json

```json
{
  "mcpServers": {
    "dataforge": {
      "type": "http",
      "url": "http://host.docker.internal:8081/mcp/"
    },
    "sg-ontology": {
      "type": "http",
      "url": "http://host.docker.internal:8093/mcp"
    },
    "namuwiki": {
      "command": "python",
      "args": ["/mnt/f/agent-hub/agents/WebScraper/namuwiki_mcp_server.py"]
    }
  }
}
```

### dataforge source filter

| source_filter | 내용 |
|---|---|
| `qaset_with_rag` | 18,604건 RAG 답변 semantic search |
| `sg_game_sg0_en` | 슈타인즈 게이트 제로 영어 스크립트 |
| `sg_paper` | 슈타인즈 게이트 논문 (팬 작성) |
| `sg_game_sge` | 배제 감사 전용 조회. 위키 내용 반영 금지 |

> `sg_game_sge` (한글 패치): 저작권 리스크로 내용 사용은 배제. P1에서는 배제 대상 소스가 섞이지 않았는지 확인하는 감사용 MCP 호출만 허용한다. 상세: `docs/rag-소스-저작권-검토.md`

### sg-ontology HTTP 전환

`~/amadeus/amadeus/mcp_server.py` main() 수정:

```python
def main() -> None:
    import os
    if os.getenv("MCP_TRANSPORT") == "http":
        app.run(
            transport="streamable-http",
            host="0.0.0.0",
            port=int(os.getenv("MCP_PORT", "8093")),
        )
    else:
        app.run()
```

---

## 4. 에이전트 팀

```
팀장 (CLAUDE.md 규칙)
  ├── git commit 권한 독점 (하위 에이전트는 파일 write만)
  ├── 초안 품질 최종 검토
  └── 콘텐츠 생성 모드 / 제안 처리 모드 전환

하위 에이전트 (Agent 도구로 스폰, 병렬 실행 가능)
  ├── wiki-planner     : qaset 탐색 → 기획서 작성
  ├── wiki-writer      : 기획서 → 페이지 초안 (마크다운)
  ├── wiki-classifier  : 유저 제안 Type A/B 분류 + 주제 파악
  ├── suggestion-judge : 제안 승인/거부/피드백 판정
  └── source-sanitizer : 초안 스캔 (내부 경로·chunk ID 유출 검사)
```

### 팀장 판단 기준 (CLAUDE.md)

**기획서 승인 기준**
- qaset에 해당 주제 QA 5건 이상
- `wiki/`에 동일 주제 문서 없음 (중복 방지)

**페이지 승인 기준**
- 공식/팬 논문 인용 블록에 출처 있음
- 문서 상단 스포일러 배지 있음
- `prompts/wiki_writing_system.md` 규칙 위반 없음
- source-sanitizer 통과 (내부 경로 미노출 확인)

**P1 MCP 커버리지 승인 기준**
- 팀장은 커밋 전 실행 로그와 하위 에이전트 보고를 대조한다.
- 아래 6개 항목이 각각 별도 MCP 호출로 1회 이상 성공해야 한다: dataforge `qaset_with_rag`, dataforge `sg_game_sg0_en`, dataforge `sg_paper`, dataforge `sg_game_sge`(배제 감사 전용), `namuwiki`, `sg-ontology`.
- 하나라도 누락되거나 실패하면 P1은 실패 처리하고 commit/push하지 않는다.

---

## 5. 파이프라인

### 파이프라인 1 — 콘텐츠 생성

```
팀장
  │
  ① wiki/ 현황 vs qaset 카테고리 비교 → 미작성 주제 목록
  │
  ② MCP 커버리지 게이트 지시
       dataforge 4개 source + namuwiki + sg-ontology를 각각 별도 호출로 성공시켜야 함
  │
  ③ Agent(wiki-planner, 주제A) ─┐
     Agent(wiki-planner, 주제B) ─┤ 병렬
     Agent(wiki-planner, 주제C) ─┘
          ↓ 기획서 + MCP 커버리지 보고 수신
  │
  ④ 기획서 검토 (팀장 직접)
       승인 기준: qaset 5건 이상 + wiki/ 미중복 + MCP 커버리지 6개 성공
  │
  ⑤ Agent(wiki-writer, 기획서A) ─┐
     Agent(wiki-writer, 기획서B) ─┘ 병렬 (승인된 것만, 서로 다른 파일 대상만 — 동일 파일 동시 쓰기 금지)
          ↓ 초안 수신
  │
  ⑥ Agent(source-sanitizer, 초안)
       내부 경로·chunk ID 유출 여부 스캔
       위반 시 wiki-writer에게 재작성 요청 (최대 2회 — 초과 시 기획서 폐기 후 팀장 보고)
  │
  ⑦ 팀장 내용 검토 + MCP 커버리지 최종 확인
  │
  ⑧ git commit + push
       → .github/workflows/deploy.yml
       → mkdocs build
       → GitHub Pages 배포 (sgwiki.github.io/)
```

### 파이프라인 2 — 제안 처리

```
cron 또는 수동 트리거
  │
  ① R2 폴링 → 새 제안 JSON 다운로드 → suggestions/inbox/
       (멱등성 보장: `suggestions/processed/{id}` 존재 여부로 중복 처리 방지)
  │
  ② Agent(wiki-classifier, 제안)
       Type A (주제/정보 요청) / Type B (편집 제안) 분류
  │
  ③ Agent(suggestion-judge, 제안 + 분류 결과)
       모든 MCP 조회 후 판정
  │
  ┌─── Type A 승인 ──→ 콘텐츠 생성 파이프라인 ①로 (동일 주제 P1 진행 중이면 큐 보류)
  ├─── Type A 거부 ──→ 기존 문서 링크 + 질문 답변 기록
  ├─── Type B 승인 ──→ 팀장 직접 편집 → source-sanitizer → git commit
  ├─── Type B 부분 ──→ 수정 방향 피드백 기록
  └─── Type B 거부 ──→ 근거 명시 기록
  │
  ④ suggestions/decisions/{id}.json 저장
  │
  ⑤ 히스토리 탭 반영 (GitHub Pages 재배포)
```

### suggestion-judge 출력 형식

```json
{
  "id": "abc-123",
  "type": "A|B",
  "verdict": "approved|rejected|partial",
  "feedback": "기존 wiki/lore/reading-steiner.md에서 다루고 있습니다.",
  "link": "wiki/lore/reading-steiner.md",
  "next_action": "wiki-planner|direct-edit|none"
}
```

공개 히스토리 탭: `feedback` + `link`만 노출. 내부 판정 근거(MCP 조회 결과 등) 미노출.

---

## 6. 출처 표시 정책

### 공개 위키 페이지 인용 형식

```markdown
> **[공식]** "D메일을 보낼 때 리딩 슈타이너가 발동합니다."
> — 슈타게 공식 QA자료집, Q26

> **[팬 분석]** "물리적 시간 여행의 경우, 기억은 보존됩니다."
> — The Mechanics of Steins;Gate v1.0.3[^1]
```

일반 산문에는 태그 없음. 인용 블록에만 `[공식]` / `[팬 분석]` 표시.

### 소스별 공개 표시 방침

| 소스 | 공개 표시 | 표시 형식 |
|---|---|---|
| `reference/official/` (QA자료집·인터뷰·WePlay) | ✅ | 출처명 그대로 |
| 팬 논문 (`sg_paper`) | ✅ | 논문 제목 그대로 |
| `sg_game_sg0_en` | ⚠️ 검열 | `슈타인즈 게이트 제로` (원문 직접 인용 금지 — 산문 요약만 허용) |
| `qaset_with_rag` | ❌ | 산문 처리, 출처 미표시 |
| `namuwiki` | ❌ | 산문 처리, 출처 미표시 (CC BY-NC-SA 2.0 KR — 저작자 표시 의무는 `sources/` YAML로 이행) |
| `sg-ontology` | ❌ | 산문 처리, 출처 미표시 |

**원칙**: chunk ID, source_filter 이름, 내부 파일 경로는 어떤 형태로도 공개 미노출.

### source-sanitizer 체크 항목

- chunk ID 패턴 (`qs-`, `sge_`, `sg0_` 등) 본문 노출 여부
- source_filter 이름 노출 여부
- 내부 파일 경로(`data/qaset_with_rag/`, `reference/user/` 등) 노출 여부
- 게임 스크립트(`sg_game_sg0_en`) 원문 직접 인용 여부 (산문 요약만 허용)
- 배제 소스(`sg_game_sge`) 내용 유출 여부
- 스포일러 배지 누락 여부
- 위반 발견 시 팀장에게 보고, 커밋 보류

---

## 7. 남은 작업

| # | 항목 | 위치 |
|---|---|---|
| 1 | sg-ontology HTTP bridge 유지 | `docker/holyclaude/docker-compose.yaml` |
| 2 | namuwiki 경로 마운트 | `docker/holyclaude/docker-compose.yaml` |
| 3 | settings.json 작성 | `docker/holyclaude/data/claude/settings.json` |
| 4 | CLAUDE.md 작성 | `docker/holyclaude/data/claude/CLAUDE.md` |
| 5 | 하위 에이전트 정의 (5종) | `docker/holyclaude/data/claude/agents/` |
| 6 | Cloudflare Worker 작성 | `worker/suggest.ts` |
| 7 | R2 버킷 생성 + wrangler.toml 설정 | `worker/wrangler.toml` |
| 8 | R2 폴링 스크립트 (멱등성 포함) | `scripts/poll_suggestions.py` |
| 9 | 기획서 양식 정의 | `docker/holyclaude/data/claude/CLAUDE.md` |
| 10 | mkdocs.yml 작성 | 프로젝트 루트 |
| 11 | `sources/` CC 귀속 YAML 작성 | `sources/namuwiki.yaml` 등 |
| 12 | `.github/workflows/deploy.yml` 작성 | `.github/workflows/` |
| 13 | 면책 문구 및 라이선스 명시 | `wiki/README.md` |
| 14 | 히스토리 탭 렌더링 구현 | `worker/history.ts` |
| 15 | git 권한 분리 구현 (팀장 commit 독점 강제) | `docker/holyclaude/data/claude/CLAUDE.md` |
