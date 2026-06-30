# claude-mem 적용 연구 보고서 — sg-wiki

> 검토일: 2026-06-30 11:47 KST
> 적용 갱신: 2026-06-30 12:30 KST
> 대상: `sg-wiki-holyclaude` 컨테이너의 claude-mem 통합 상태와 운영 전략
> 기준 버전: npm 최신 `claude-mem@13.9.1`, 현재 worker `/api/health` 응답도 `13.9.1`

---

## 1. 결론

claude-mem은 이 프로젝트에서 **조건부로 효율적**이다. 다만 "모든 에이전트의 모든 도구 호출을 자동 기억하고 매 세션에 많이 주입"하는 방식은 비효율적이다. 효율이 나는 형태는 다음 하나다.

> **claude-mem = 팀장/기획/품질 에이전트가 과거 운영 결정을 검색하고, 반복되는 결정을 `CLAUDE.md`/에이전트 규칙으로 승격시키는 보조 기억 계층**

따라서 현재 통합은 유지하되, 운영 모드는 축소해야 한다.

- **유지할 것**: worker, 영속 DB, `mem-search`, 팀장·기획·품질 단계의 표적 검색.
- **줄일 것**: SessionStart의 최근 관측 자동 주입량, writer/linker/restructurer 같은 routine agent의 저가치 관측.
- **금지/주의할 것**: RAG/MCP 원문 응답, 내부 source id, chunk id, 파일명, 저작권상 직접 인용 위험이 있는 내용의 영구 기억.
- **적용 완료**: `uvx` 복구, `claude-mem@13.9.1` 고정, 자동 주입량 축소, noisy tool skip, P7 규칙 승격 제안 파이프라인을 반영했다.

## 2. 공식 아키텍처 요약

공식 저장소와 문서 기준으로 claude-mem의 핵심은 다음이다.

- Claude Code plugin으로 설치되며, `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd` 훅을 사용한다.
- `PostToolUse`가 도구 호출을 worker로 보내고, worker가 LLM으로 observation을 압축해 SQLite에 저장한다.
- Chroma vector DB를 함께 사용해 검색 품질을 높인다. 검색은 `search -> timeline -> get_observations`의 점진 공개 방식이다.
- 기본 context 주입량은 `CLAUDE_MEM_CONTEXT_OBSERVATIONS=50`이고, `CLAUDE_MEM_SKIP_TOOLS`는 exact tool name 목록이다. wildcard가 아니다.
- `<private>...</private>`는 hook 계층에서 저장 전 제거되지만, 자동 도구 응답 전체를 안전하게 만드는 만능 장치는 아니다.
- 텔레메트리는 기본 opt-out 구조다. 익명/화이트리스트 기반이라고 해도, 이 프로젝트는 자동 에이전트와 소스 위생 규칙이 강하므로 운영 환경에서는 꺼두는 편이 낫다.

참고:

- 공식 저장소: https://github.com/thedotmack/claude-mem
- Hooks architecture: https://docs.claude-mem.ai/hooks-architecture
- Configuration: https://docs.claude-mem.ai/configuration
- Private tags: https://docs.claude-mem.ai/usage/private-tags
- Telemetry: https://docs.claude-mem.ai/telemetry

## 3. sg-wiki와의 적합성

### 3.1 맞는 부분

sg-wiki는 반복 운영 결정이 많다. 예를 들어 용어 표기, 스포일러 등급, 내부 링크 구조, source-sanitizer 판정 기준, P1/P6의 중복 주제 회피 같은 지식은 한 번 결정하고 나면 다음 run에서 재사용할 가치가 있다.

claude-mem은 이런 "왜 이렇게 했는가"를 팀장·planner·quality-lead가 검색하는 데 유효하다. 특히 다음 단계에서 가치가 있다.

- `wiki-team-lead`: 새 주제 선정 전, 과거 reject/quality warning/중복 주제 이력 확인.
- `wiki-demand-lead`: P6 후보가 기존 정비/작성 결정과 충돌하는지 확인.
- `wiki-maintenance-lead`: 표기·문체 정비 기준의 반복 이슈 확인.
- `wiki-planner`: 신규 문서 기획 전에 관련 과거 결정과 금지 패턴 확인.
- `wiki-quality-lead`: gate 판정 전 비슷한 fail/warn 사례 확인.

### 3.2 맞지 않는 부분

현재 파이프라인은 대화형 단일 세션이 아니라 에이전트 함대 구조다. P1 한 번만 해도 팀장, planner, writer, source-sanitizer, wiki-linker, quality-lead가 연쇄 실행된다. 현재 compose의 `ADMIN_MAX_CONCURRENT_RUNS`는 6이고, 프로젝트 문서에는 과거 cap 10 설계도 남아 있다. 어느 쪽이든 여러 sub-session이 동시에 `PostToolUse`를 발생시키는 구조다.

이 구조에서 광역 자동 캡처를 그대로 두면 문제가 생긴다.

- `Read`, `Bash`, `Agent`가 관측 큐를 빠르게 늘린다.
- writer 계열 도구 출력은 과거 결정이라기보다 작업 중간 산출물인 경우가 많다.
- source/RAG 응답이 tool response에 들어가면 영구 observation 또는 pending queue에 source 위생 리스크가 생긴다.
- 기본 50개 최근 관측 주입은 전문 에이전트에게 불필요한 맥락을 밀어 넣어 오히려 판단을 흐릴 수 있다.

## 4. 현재 통합 상태

현재 프로젝트는 claude-mem을 이미 통합했다. 신규 도입 검토가 아니라 **운영 방식 조정 검토**가 정확하다.

확인된 파일:

- `docker/holyclaude/Dockerfile`: Bun 설치, bootstrap/entrypoint/s6 worker 등록.
- `docker/holyclaude/docker-compose.yaml`: `127.0.0.1:37700:37700`, named volume `sg-wiki-claude-mem`, ZAI/worker env.
- `docker/holyclaude/scripts/claude-mem-bootstrap.sh`: `~/.claude-mem/.env`에 ZAI 기반 `ANTHROPIC_*` 인증 주입.
- `docker/holyclaude/scripts/s6/claude-mem-worker/run`: `npx -y claude-mem@13.9.1 start --daemon`을 s6 longrun으로 실행.
- `docker/holyclaude/data/claude/settings.json`: `enabledPlugins: { "claude-mem@thedotmack": true }`.

2026-06-30 12:30 KST 적용 후 확인 결과:

| 항목 | 상태 |
|---|---|
| `sg-wiki-holyclaude` | running, healthy |
| viewer `http://127.0.0.1:37700/` | HTTP 200 |
| `/api/health` | HTTP 200, `version=13.9.1`, `mcpReady=true` |
| 인증 | `API key (from ~/.claude-mem/.env)` |
| degraded 항목 | 없음 |

이전 인증 장애는 이미 해결되어 있다. 핵심 함정은 claude-mem worker가 컨테이너 process env가 아니라 `~/.claude-mem/.env`에서 Claude SDK 인증을 읽는다는 점이었다. 현재 bootstrap이 이 파일을 매 기동마다 생성하므로 ZAI 키 회전도 반영된다.

## 5. 효율성 판정

| 사용처 | 판정 | 이유 |
|---|---|---|
| 대화형 운영자 세션 | ON | 설계 목적과 잘 맞고 세션 수가 적어 비용/노이즈가 낮다. |
| 팀장·planner·quality-lead의 `mem-search` | ON | 과거 결정, reject 사유, 정합성 경고를 재사용할 수 있다. |
| writer/restructurer/rewriter의 광역 자동 캡처 | 축소 | 중간 산출물과 파일 읽기가 많아 signal/noise가 낮다. |
| source-sanitizer/linker의 광역 자동 캡처 | 제한적 | fail/warn 결정은 가치가 있지만 tool output 원문 저장 리스크가 있다. |
| RAG/MCP 원문 응답 캡처 | OFF 권장 | 직접 인용 금지, source id 비노출 규칙과 충돌할 수 있다. |
| 기본 50개 관측 자동 주입 | OFF 또는 대폭 축소 | 전문 에이전트에게 stale/noisy context가 들어간다. |

## 6. 적용 방식

### 6.1 0단계: 현재 통합 안정화

1. **`uvx` 복구**

   Dockerfile은 `/uv`를 복사한 뒤 `uvx` alias를 만든다. 적용 후 claude-mem health의 `dependencies.degraded`는 비어 있다.

   ```dockerfile
   COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
   RUN ln -sf /usr/local/bin/uv /usr/local/bin/uvx
   ```

   Chroma/vector search를 유지하는 쪽을 선택했다.

2. **버전 고정**

   bootstrap과 s6 worker 실행 모두 검증된 버전으로 고정한다.

   ```bash
   npx -y claude-mem@13.9.1 install
   npx -y claude-mem@13.9.1 start --daemon
   ```

3. **텔레메트리 비활성화**

   ```yaml
   - DO_NOT_TRACK=1
   - CLAUDE_MEM_TELEMETRY=0
   - CLAUDE_MEM_TELEMETRY_ERRORS=0
   ```

### 6.2 1단계: 자동 주입량 축소

`docker/holyclaude/docker-compose.yaml`의 `holyclaude.environment`에 아래를 추가했다.

```yaml
- CLAUDE_MEM_CONTEXT_OBSERVATIONS=8
- CLAUDE_MEM_CONTEXT_SESSION_COUNT=5
- CLAUDE_MEM_CONTEXT_FULL_COUNT=0
- CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY=true
- CLAUDE_MEM_SEMANTIC_INJECT=false
```

`SEMANTIC_INJECT`는 기본값에 의존하지 않고 compose에 명시해 운영 의도를 남긴다.

### 6.3 2단계: 저가치 도구 캡처 축소

`CLAUDE_MEM_SKIP_TOOLS`는 exact match만 지원한다. 먼저 기본값에 read/search 계열을 추가했다.

```yaml
- CLAUDE_MEM_SKIP_TOOLS=ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion,Read,LS,Grep,Glob,NotebookRead
```

초기에는 `Agent`, `Bash`, `Edit`, `Write`는 남긴다. `Agent` 결과는 팀장 의사결정의 핵심 신호일 수 있고, `Edit`/`Write`는 실제 변경 요약 생성에 유용하다. 다만 1주일 관측 후 source 노출이나 큐 지연이 크면 `Agent`와 `Bash`도 skip 후보로 올린다.

MCP/RAG 도구는 exact tool name을 로그에서 확인한 뒤 skip 목록에 추가한다. wildcard가 없으므로 `mcp__dataforge__*` 같은 패턴은 동작하지 않는다.

확인 명령:

```bash
docker exec sg-wiki-holyclaude sh -lc \
  "grep -h 'PostToolUse:' /home/claude/.claude-mem/logs/claude-mem-*.log | sed 's/.*PostToolUse: //' | cut -d'(' -f1 | sort | uniq -c | sort -nr"
```

### 6.4 3단계: `mem-search`를 특정 역할에만 요구

다음 파일에만 짧은 지시를 추가했다.

- `docker/holyclaude/data/claude/agents/wiki-team-lead.md`
- `docker/holyclaude/data/claude/agents/wiki-demand-lead.md`
- `docker/holyclaude/data/claude/agents/wiki-maintenance-lead.md`
- `docker/holyclaude/data/claude/agents/wiki-planner.md`
- `docker/holyclaude/data/claude/agents/wiki-quality-lead.md`

권장 문구:

```md
작업 시작 전 과거 결정이 영향을 줄 수 있는 주제라면 claude-mem `mem-search`를 사용한다.
항상 `search -> timeline -> get_observations` 순서로 좁혀 보고, 관측 내용을 규칙보다 우선하지 않는다.
반복될 결정은 최종 보고에 "CLAUDE.md/에이전트 규칙 승격 후보"로 남긴다.
```

writer/restructurer/rewriter에는 이 지시를 넣지 않는다. 작성자는 현재 자료와 명시 규칙에 집중하는 편이 낫다.

### 6.5 4단계: 반복 결정을 규칙으로 승격

P7은 이 단계를 사용자 승인형 파이프라인으로 구현한다.

1. `mem-search`로 최근 `decision`, `gotcha`, `problem-solution` 계열 관측을 `search -> timeline -> get_observations` 순서로 검색한다.
2. 반복되는 표기·구조·sanitizer/quality 판정만 추린다.
3. 직접 규칙 파일을 수정하지 않고 `.admin/rule-promotions/{run_id}/manifest.json`과 `proposed/{proposal_id}.md`를 생성한다.
4. admin UI의 “규칙 승격 검토”에서 사용자가 파일별 전후 diff를 확인하고, 필요하면 proposed 내용을 직접 수정한다.
5. 사용자가 승인한 proposal만 실제 규칙 파일에 적용한다. `before_sha256`이 현재 파일 hash와 다르면 stale proposal로 보고 적용을 막는다.

메모리는 규칙을 대체하지 않는다. 메모리는 **규칙 업데이트 후보를 찾는 입력**이다.

허용 대상은 `AGENTS.md`, `README.md`, `wiki/README.md`, `docker/holyclaude/data/claude/CLAUDE.md`, `docker/holyclaude/data/claude/agents/*.md`로 제한한다.

## 7. 운영 검증 명령

```bash
curl -s http://127.0.0.1:37700/api/health | jq

docker exec sg-wiki-holyclaude sh -lc '
sqlite3 /home/claude/.claude-mem/claude-mem.db "
  SELECT \"observations\", COUNT(*) FROM observations
  UNION ALL SELECT \"summaries\", COUNT(*) FROM session_summaries
  UNION ALL SELECT \"pending\", COUNT(*) FROM pending_messages WHERE status=\"pending\"
  UNION ALL SELECT \"failed\", COUNT(*) FROM pending_messages WHERE status=\"failed\"
  UNION ALL SELECT \"active_sessions\", COUNT(*) FROM sdk_sessions WHERE status=\"active\";
"'

docker exec sg-wiki-holyclaude sh -lc '
grep -h "PostToolUse:" /home/claude/.claude-mem/logs/claude-mem-*.log |
  sed "s/.*PostToolUse: //" |
  cut -d"(" -f1 |
  sort | uniq -c | sort -nr
'
```

건강 기준:

- `/api/health.status == "ok"`
- `dependencies.degraded`가 false이거나, degraded 사유가 의도적으로 문서화되어 있을 것
- `pending_messages pending`이 평시 0~5, 지속적으로 10 초과면 worker 병목 조사
- `failed`가 증가하면 즉시 로그 확인
- `CLAUDE_MEM_CONTEXT_OBSERVATIONS` 변경 후 새 세션 context가 실제로 줄었는지 viewer의 preview로 확인

## 8. 최종 권고

현재 프로젝트에 claude-mem을 **완전히 끄는 것은 아깝고**, **그대로 광역 운영하는 것은 비효율적**이다.

권장 최종 상태:

1. `uvx` 복구로 degraded 제거.
2. context 자동 주입 50 -> 8 수준으로 축소.
3. `Read/LS/Grep/Glob` 및 확인된 MCP source tool을 skip.
4. 팀장·planner·quality-lead만 `mem-search`를 의식적으로 사용.
5. 반복 결정은 메모리에 머물게 하지 말고 규칙 파일로 승격.

이 방식이면 claude-mem은 위키 품질을 자동으로 보장하는 장치가 아니라, **운영자가 놓치기 쉬운 과거 결정과 실패 패턴을 검색하는 저비용 보조 장치**로 작동한다. 이 프로젝트의 자동화 구조에는 그 형태가 가장 효율적이다.
