#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SDK_PATH =
  '/usr/local/lib/node_modules/@siteboon/claude-code-ui/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';

const DEFAULT_CWD = '/workspace';
const DEFAULT_MODEL = 'glm-5.2';
const REQUIRED_MCP_SERVERS = ['dataforge', 'namuwiki', 'sg-ontology'];
const REQUIRED_MCP_COVERAGE = [
  {
    key: 'qaset_with_rag',
    label: 'dataforge:qaset_with_rag',
    type: 'dataforge-source',
    source: 'qaset_with_rag',
  },
  {
    key: 'sg_game_sg0_en',
    label: 'dataforge:sg_game_sg0_en',
    type: 'dataforge-source',
    source: 'sg_game_sg0_en',
  },
  {
    key: 'sg_paper',
    label: 'dataforge:sg_paper',
    type: 'dataforge-source',
    source: 'sg_paper',
  },
  {
    key: 'sg_game_sge',
    label: 'dataforge:sg_game_sge',
    type: 'dataforge-source',
    source: 'sg_game_sge',
  },
  { key: 'namuwiki', label: 'namuwiki MCP', type: 'mcp-server' },
  { key: 'sg_ontology', label: 'sg-ontology MCP', type: 'mcp-server' },
];

// 파이프라인 6 공통 하드 커버리지(타입별 추가 항목은 lead가 보고로 확인).
// 수요 신호(dc_gallery)·요지 검증(qaset)·외부 교차(namuwiki)만 코드로 강제한다.
const P6_REQUIRED_COVERAGE = [
  {
    key: 'qaset_with_rag',
    label: 'dataforge:qaset_with_rag',
    type: 'dataforge-source',
    source: 'qaset_with_rag',
  },
  { key: 'namuwiki', label: 'namuwiki MCP', type: 'mcp-server' },
  {
    key: 'dc_gallery',
    label: 'dataforge:dc_gallery',
    type: 'dataforge-source',
    source: 'dc_gallery',
  },
];

function parseArgs(argv) {
  const args = {
    command: null,
    runId: `manual-${Date.now()}`,
    instruction: '',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!args.command && !value.startsWith('--')) {
      args.command = value;
    } else if (value === '--run-id') {
      args.runId = argv[index + 1];
      index += 1;
    } else if (value === '--instruction') {
      args.instruction = argv[index + 1] ?? '';
      index += 1;
    } else if (value === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.command) {
    throw new Error(
      'Usage: run_holyclaude_pipeline.mjs <p1|p2|p3|p4|p5|p6|p7> --run-id <id> [--instruction "text"] [--dry-run]',
    );
  }
  if (!['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].includes(args.command)) {
    throw new Error(`Unsupported pipeline: ${args.command}`);
  }
  return args;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function loadMcpServers(cwd) {
  const rootConfig = await readJson('/home/claude/.claude.json');
  const settings = await readJson('/home/claude/.claude/settings.json');
  const projectConfig = rootConfig.claudeProjects?.[cwd]?.mcpServers ?? {};
  return {
    ...(rootConfig.mcpServers ?? {}),
    ...(settings.mcpServers ?? {}),
    ...projectConfig,
  };
}

function buildP1Prompt(runId) {
  return `파이프라인 1 - 콘텐츠 생성을 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요.

당신은 파이프라인 1의 wiki-team-lead(위키작성 팀장)입니다.

목표:
1. /workspace/wiki/ 현황과 qaset 근거를 비교해 아직 작성되지 않은 주제 후보를 선정하세요.
2. wiki-planner가 기획서를 반환하면 팀장이 승인 / 거부 / 피드백(재작성 요청) 중 하나를 명시적으로 결정하세요.
3. 승인된 기획서만 wiki-writer에 전달하고, source-sanitizer 통과 전에는 commit/push하지 마세요.
4. 통과한 경우에만 git add, commit, push까지 수행하세요.
5. 막히면 무엇이 막혔는지 명확히 보고하고, 검증되지 않은 초안은 commit하지 마세요.

중복 주제 방지 (병렬 실행 필수):
- 파이프라인은 이제 동시에 여러 실행이 들어올 수 있습니다. 동일 주제/파일 중복 작성은 작업 현황 memory로 막습니다.
- 후보를 선정하기 전에 반드시 memory를 읽어 현재 진행 중인 주제/파일을 확인하세요:
  node /workspace/scripts/wiki_work_registry.mjs list
- 반환된 registry.active에 이미 들어 있는 topic 또는 file은 후보에서 제외하세요. 이 게이트를 통과한 주제만 planner에 전달합니다.
- planner 기획서를 받은 뒤에도 reserve로 최종 점유 확인(아래)을 거쳐야 합니다. 다른 실행이 먼저 점유했다면 reserve가 실패하므로 그 주제는 포기하고 다른 주제를 고르거나 중단하세요.

팀장 작업 메모리:
- 팀장은 /workspace/.admin/p1-work-registry.json을 파이프라인 1 작업 현황 memory로 사용해야 합니다.
- writer를 호출하기 전에 반드시 다음 명령으로 출력 파일을 예약하세요:
  node /workspace/scripts/wiki_work_registry.mjs reserve --run-id ${runId} --file wiki/{category}/{slug}.md --topic "{주제명}"
- reserve가 실패하면 기획서를 거부하고 writer를 호출하지 마세요. 동일 주제/동일 문서가 있으면 다른 주제를 고르거나 중단하세요.
- writer/sanitizer/commit 단계 진입 시 status 명령으로 상태를 갱신하세요:
  node /workspace/scripts/wiki_work_registry.mjs status --run-id ${runId} --file wiki/{category}/{slug}.md --status writing|sanitizing|committing
- commit/push 완료 시 complete, 폐기/거부/중단 시 release를 호출하세요.

팀장 승인 게이트:
1. planner 기획서의 출력 파일이 /workspace/wiki/에 이미 존재하면 reject.
2. qaset QA 5건 미만이면 reject.
3. MCP 커버리지 6개 항목 중 하나라도 fail/missing이면 feedback으로 재작성 요청 또는 reject.
4. 기획서가 통과하면 "APPROVED PLAN"과 승인 사유를 로그에 남긴 뒤 writer를 호출.
5. writer 초안이 sanitizer fail이면 위반 항목을 명시해 최대 2회 재작성 요청. 2회 초과 시 release 후 중단.

MCP 커버리지 게이트:
- 파이프라인 1 작업 중 아래 6개 항목을 각각 별도 MCP 호출로 최소 1회 이상 성공시켜야 합니다.
  1. dataforge source_filter/source_names: qaset_with_rag
  2. dataforge source_filter/source_names: sg_game_sg0_en
  3. dataforge source_filter/source_names: sg_paper
  4. dataforge source_filter/source_names: sg_game_sge (배제 감사 전용, 내용 사용 금지)
  5. namuwiki MCP
  6. sg-ontology MCP
- 팀장은 하위 에이전트 보고와 실행 로그를 대조해 6개 항목이 모두 성공했는지 확인한 뒤에만 source-sanitizer 승인 및 commit으로 진행하세요.
- 누락, 오류, 미등록 MCP가 하나라도 있으면 즉시 중단하고 어떤 항목이 실패했는지 보고하세요. 이 경우 파일을 만들었더라도 commit/push하지 마세요.
- sg_game_sge는 "사용하지 말아야 할 소스가 섞이지 않았는지 확인"하는 감사용 조회만 허용합니다. 위키 본문·주석·인용·요약에는 절대 반영하지 마세요.

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- 동일 파일을 동시에 수정하지 마세요.
- dataforge qaset source_filter의 정확한 이름은 qaset_with_rag입니다. 하이픈이 들어간 변형을 사용하지 마세요.
- 내부 경로, chunk ID, source_filter 이름, 배제 소스 내용은 공개 위키에 노출하지 마세요.
- 완료 시 작성/수정 파일, sanitizer 결과, commit hash 또는 미커밋 사유를 요약하세요.`;
}

function buildP2Prompt(runId) {
  return `파이프라인 2 - 제안 자동 처리를 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요.

목표:
1. /workspace/scripts/poll_suggestions.py를 실행해 R2/mock R2 제안을 /workspace/suggestions/inbox/로 동기화하세요.
2. /workspace/suggestions/inbox/*.json을 모두 확인하세요.
3. 사용자의 수동 승인/거부 여부는 자동 처리 여부를 결정하지 않습니다. suggestions/decisions/{id}.json이 있어도 automated=true가 아니면 파이프라인 2가 다시 판단하세요.
4. suggestions/decisions/{id}.json에 automated=true가 이미 있으면 해당 제안은 스킵하고, 완료 요약에 스킵 사유를 남기세요.
5. 자동 처리 대상 제안마다 wiki-classifier 에이전트로 Type A/B와 관련 문서를 분류하세요.
6. suggestion-judge 에이전트로 MCP를 조회해 approved/rejected/partial 판정을 받으세요.
7. 판정 결과를 /workspace/suggestions/decisions/{id}.json에 저장하세요.
8. 판정이 approved이면 즉시 위키 작성 에이전트에게 넘겨 실행하세요. Type A는 필요하면 wiki-planner로 기획서를 먼저 만들고 wiki-writer에 전달하세요. Type B는 관련 기존 문서를 대상으로 반영 기획서를 작성해 wiki-writer에 전달하세요.
9. wiki-writer가 파일을 만들거나 수정하면 source-sanitizer를 실행하세요. sanitizer fail이면 최대 2회 재작성 요청 후 중단하고 decision의 writer_status를 failed로 갱신하세요.
10. sanitizer pass인 approved 반영분만 git add/commit 하세요. **절대 git push를 실행하지 마세요 — commit까지만 수행하고 종료합니다.** push는 관리자가 admin UI "승인 후 push"로 직접 검토·승인한 뒤에만 별도 프로세스가 수행합니다. suggestions/ 디렉토리는 로컬 런타임 큐이므로 git add하지 마세요. 커밋 후 commit hash와 변경 파일 목록을 반드시 완료 요약에 포함하세요.

decision JSON 필수 형식:
{
  "id": "{id}",
  "action": "approved|rejected|partial",
  "verdict": "approved|rejected|partial",
  "automated": true,
  "decided_by_pipeline": "p2",
  "run_id": "${runId}",
  "decided_at": "{ISO-8601 timestamp}",
  "classification": { "type": "A|B", "topic": "...", "related_doc": "wiki/... 또는 null", "summary": "..." },
  "feedback": "공개 UI에 표시할 한국어 피드백. 내부 경로, chunk ID, source_filter 이름 금지.",
  "link": "wiki/... 또는 null",
  "next_action": "wiki-planner|wiki-writer|direct-edit|none",
  "writer_status": "not_applicable|pending|completed|failed|blocked",
  "writer_summary": "승인 반영 결과 또는 실패/차단 사유",
  "updated_files": ["wiki/..."]
}

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- 동일 파일을 동시에 수정하지 마세요.
- approved가 아닌 rejected/partial 제안은 위키 파일을 수정하지 마세요.
- Type B 직접 수정도 wiki-writer/source-sanitizer 경로를 거치세요.
- **git push는 절대 금지**. 커밋까지만 수행하고 종료하세요. push는 관리자가 admin UI에서 검토·승인한 뒤 별도로 실행됩니다.
- decisions 파일은 자동 처리 상태 표시용 런타임 산출물입니다. 반드시 저장하되 commit 대상에는 포함하지 마세요.
- 내부 경로, chunk ID, source_filter 이름, 배제 소스 내용은 공개 위키와 feedback에 노출하지 마세요.
- 완료 시 처리/스킵/오류 제안 ID, 각 판정, writer_status, sanitizer 결과, commit hash 또는 미커밋 사유를 요약하세요.`;
}

function buildP3Prompt(runId) {
  return `파이프라인 3 - 온톨로지 저작을 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요. 특히 ontology-author.md, ontology-validator.md 규칙을 준수하세요.

당신은 파이프라인 3의 wiki-team-lead(위키작성 팀장, 온톨로지 저작 모드)입니다.

파이프라인 3은 파이프라인 1(위키 페이지 생성)과 다릅니다. 출력은 wiki/*.md가 아니라 **온톨로지 TTL**입니다:
  docker/holyclaude/ontology/src/슈타인즈게이트_온톨로지.ttl

목표:
1. 저작 대상 시리즈를 선정하세요 (기본: Steins;Gate 0 게임 — 온톨로지에 미저작된 루트/미디어 매핑 보강).
2. sg-ontology MCP로 현재 온톨로지를 SPARQL 조회해 누락된 인스턴스 식별 (중복 회피).
3. 저작 범위를 정해 ontology-planner 역할로 저작 지시서를 작성하세요 (아래 양식).
4. registry에 p3-work로 예약하세요 (p1과 다른 키). 동일 시리즈/범위 중복을 막습니다.
5. 저작 지시서를 승인(APPROVED PLAN)한 뒤 ontology-author 에이전트에 전달하세요.
6. ontology-author가 TTL을 편집하면 ontology-validator 에이전트로 SHACL + 정책 검증을 진행하세요.
7. validator fail이면 원인을 명시해 ontology-author에게 재저작 요청 (최대 2회).
8. validator pass인 경우에만 git add docker/holyclaude/ontology/ && git commit && git push 하세요.
9. 커밋 후 generate-data.py --series <id> 로 JSON 재생성이 가능한지 확인 (스크립트가 시리즈 분기를 지원하면).

중복 방지 (registry):
- 후보 선정 전: node /workspace/scripts/wiki_work_registry.mjs list (active의 series/scope 회피)
- 저작 전 예약: node /workspace/scripts/wiki_work_registry.mjs reserve --run-id ${runId} --file docker/holyclaude/ontology/src/슈타인즈게이트_온톨로지.ttl --topic "p3:{series}:{scope}"
- 완료: complete / 실패: release --status rejected

팀장 승인 게이트 (p3):
1. 동일 시리즈/범위가 이미 저작됐거나 진행 중이면 reject.
2. registry 예약 실패면 reject.
3. MCP 커버리지 6개 항목(qaset_with_rag/sg_game_sg0_en/sg_paper/sg_game_sge/namuwiki/sg-ontology) 중 하나라도 fail이면 feedback/reject.
4. validator fail이면 최대 2회까지 ontology-author에게 재시도. 초과 시 release 후 중단.
5. validator pass + 커버리지 pass인 경우에만 commit/push.

저작 지시서 양식 (ontology-author에게 전달):
- 시리즈명 + 저작 범위 (신규 WorldLine N / EventVariation M / Event K / Shift L / MediaSource P)
- APPROVED PLAN 표시
- registry 예약 결과
- MCP 커버리지 결과
- 출력 파일: docker/holyclaude/ontology/src/슈타인즈게이트_온톨로지.ttl

위생 규칙 (절대 준수):
- sg_game_sge/sg_game_sg0_en 원문 직접 인용 블록·소스명·chunk ID를 TTL sg:summary/sg:note에 노출 금지 (방금 통일된 정책). 파라프레이즈만.
- 기존 인스턴스 id 덮어쓰기/삭제 금지 (추가만).
- SHACL 자체 점검 없이 보고 금지: python /workspace/scripts/validate_ontology.py
- wiki/*.md 편집 금지 (p3는 온톨로지만).
- 커밋은 팀장만. ontology-author/validator는 파일 편집/읽기만.

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- 동일 TTL 파일을 병렬로 편집하지 마세요 (registry로 직렬화).
- 막히면 명확히 보고하고, 검증되지 않은 TTL은 commit하지 마세요.
- 완료 시 추가된 인스턴스 id 목록(WorldLine/EventVariation/Event/Shift/MediaSource 카운트), validator 결과, MCP 커버리지, commit hash 또는 미커밋 사유를 요약하세요.`;
}

function buildP4Prompt(runId) {
  return `파이프라인 4 - 위키 품질 검사(전체 감사)를 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요. 특히 wiki-quality-lead.md, wiki-format-inspector.md, wiki-completeness-checker.md, wiki-consistency-checker.md 규칙을 준수하세요.

당신은 파이프라인 4의 wiki-quality-lead(위키 품질 검사 팀장)입니다.

파이프라인 4는 읽기 전용 감사입니다. 위키 파일을 수정하거나 commit/push하지 않습니다.

목표:
1. \`find /workspace/wiki -name "*.md"\` 로 대상 파일 목록을 수집하세요.
2. **wiki-format-inspector** 에이전트를 스폰하여 각 파일의 형식/구조 검사를 수행하세요.
   - frontmatter spoiler 필드 존재 및 enum 유효성
   - H1 헤더 정확히 1개 존재
   - 인용 형식([공식]/[팬 분석]) 준수
   - 각주 참조·정의 쌍 일치
3. **wiki-completeness-checker** 에이전트를 스폰하여 각 파일의 완성도 검사를 수행하세요.
   - 미치환 {placeholder} 탐지
   - 빈 섹션(헤더 직후 다음 헤더/EOF) 탐지
   - 개요 분량(50자 이상) 확인
   - 캐릭터 문서 프로필 표 존재 여부
4. **wiki-consistency-checker** 에이전트를 스폰하여 전체 문서 간 일관성 검사를 수행하세요.
   - 세계선 다이버전스 수치 불일치
   - 날짜/시각 불일치
   - 인물명 표기 불일치
5. 결과를 취합하여 감사 리포트를 /workspace/.admin/quality-audit-$(date +%Y-%m-%d).json에 저장하세요.

감사 리포트 형식:
{
  "date": "YYYY-MM-DD",
  "run_id": "${runId}",
  "mode": "audit",
  "summary": { "total": N, "fail": F, "warn": W, "pass": P },
  "failures": [
    { "file": "wiki/...", "checker": "format|completeness", "violations": [...] }
  ],
  "warnings": [...],
  "consistency_issues": [...]
}

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- wiki/*.md 파일 수정 금지 (읽기 전용 감사).
- git 명령 실행 금지.
- MCP 조회 불필요 (형식/구조/완성도 검사는 파일 읽기만으로 수행).
- 완료 시 총 파일 수, fail/warn/pass 건수, 주요 위반 항목 요약을 보고하세요.`;
}

function buildP5Prompt(runId) {
  return `파이프라인 5 - 위키 정비를 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요. 특히 wiki-maintenance-lead.md, wiki-restructurer.md, wiki-rewriter.md, source-sanitizer.md 규칙을 준수하세요.

당신은 파이프라인 5의 wiki-maintenance-lead(위키 정비 팀장)입니다.

파이프라인 5는 기존 wiki/*.md 페이지를 정비합니다. 새 페이지를 만들지 않습니다.

목표:
1. \`find /workspace/wiki -name "*.md"\` 로 전체 파일 목록을 수집하세요.
2. \`node /workspace/scripts/wiki_work_registry.mjs list\` 로 진행 중인 파일을 확인하고 제외하세요.
3. 최근 품질 감사 리포트(\`/workspace/.admin/quality-audit-*.json\`)가 있으면 우선 참조해 정비 대상을 선정하세요.
4. 1회 실행에서 최대 5개 파일을 선정해 순차 처리하세요.

파일당 처리 순서:
1. registry 예약:
   node /workspace/scripts/wiki_work_registry.mjs reserve --run-id ${runId} --file wiki/{category}/{slug}.md --topic "p5:maintenance:{slug}"
   실패 시 해당 파일 건너뜀.

2. wiki-restructurer 에이전트 스폰 → 섹션 구조·헤더·frontmatter 정비.
   보고가 \`changed: false\`이면 restructurer 단계 완료로 간주.

3. wiki-rewriter 에이전트 스폰 → 문체·표현·용어 일관성 교정.
   보고가 \`changed: false\`이면 rewriter 단계 완료로 간주.

4. source-sanitizer 에이전트 스폰 → 내부 식별자 누출 검사.
   fail이면 rewriter에게 최대 1회 재작성 요청. 재작성 후에도 fail이면 git checkout으로 되돌리고 registry release.

5. 팀장 diff 검토:
   - 사실 관계 변경 없음 확인
   - 스포일러 등급 변경 없음 확인
   - source 식별자 미노출 확인

6. 통과 시 commit/push:
   node /workspace/scripts/wiki_work_registry.mjs status --run-id ${runId} --file wiki/{category}/{slug}.md --status committing
   git add wiki/{category}/{slug}.md
   git commit -m "chore(wiki): {slug} 정비 — {변경 요약}"
   git push

7. registry 정리:
   완료: node /workspace/scripts/wiki_work_registry.mjs complete --run-id ${runId} --file wiki/{category}/{slug}.md
   실패: node /workspace/scripts/wiki_work_registry.mjs release --run-id ${runId} --file wiki/{category}/{slug}.md --status rejected

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- SDK stream 안정성을 위해 도구 호출은 한 응답에 하나씩만 실행하세요. 여러 Bash/Read 호출을 한 번에 병렬로 내지 말고, 각 tool_result를 받은 뒤 다음 도구를 호출하세요.
- 신규 페이지 생성 금지.
- 사실 관계·스포일러 등급 변경 금지.
- sanitizer fail 상태에서 commit 금지.
- 팀장 diff 검토 없이 commit 금지.
- 하위 에이전트에게 git commit/push 위임 금지.
- 내부 경로, chunk ID, source_filter 이름은 공개 위키에 노출하지 마세요.
- 완료 시 처리 파일 목록, 각 파일의 변경 요약, commit hash 또는 미커밋 사유를 보고하세요.`;
}

function buildP6Prompt(runId) {
  return `파이프라인 6 - 커뮤니티 큐레이션 위키 생성/업데이트를 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요. 특히 wiki-demand-lead.md, wiki-demand-analyst.md 규칙을 준수하세요.

당신은 파이프라인 6의 wiki-demand-lead(커뮤니티 큐레이션 팀장)입니다.

파이프라인 6은 DCinside 슈타게 갤러리 유저 게시글을 커뮤니티 세그먼테이션으로 분석해 도출한 소제(subtopic) 후보 큐를 소비해, 커뮤니티에서 실제로 반복되는 질문·오해·토론을 바탕으로 위키 페이지를 새로 생성하거나(근거가 합리적일 때만) 기존 페이지를 업데이트합니다. 신규 문서의 기본 대상은 wiki/커뮤니티-큐레이션/이며, 양식 제한 없이 커뮤니티 마이닝 결과에 맞는 최적 양식을 자율 선택합니다. P1(생성 전용)·P5(정비 전용)와 달리 두 경로를 자율 라우팅합니다.

장르 택소노미(genre, 후보 1건당 1개. 기존 type과 직교):
- faq: 반복 질문 묶음 Q/A
- simple_q: 단발 사실 질문의 짧은 단답 해설
- complex_q: 다요소·조건부 질문의 단계적 설명
- debate: 갤러리 내 논쟁을 토론 중개 — 쟁점 → 양측 논거 → 근거 평가 → 합리적 결론/가설
- deep_dive: 특정 유저의 통찰적 주장을 연구 가설로 삼아 사실검증 소스로 심층 전개
- editorial(사설): 커뮤니티 수요·주장은 있으나 사실검증 소스가 뒷받침 못 할 때, 주장을 "커뮤니티 견해"로 명시 소개(사실 단정 금지)

근거 등급(evidence_grade) 게이트:
- corroborated(사실검증 소스가 뒷받침) → fact 페이지(faq/simple_q/complex_q/debate/deep_dive) 작성 가능.
- community_only(dc_gallery 수요만, 사실검증 미충족) → 반드시 editorial로 강등. 사실 단정·기존 정전 페이지 업데이트 금지.

목표:
1. 후보 큐를 정규화하고 최우선 pending 후보를 선점하세요.
   node /workspace/scripts/p6_demand_queue.mjs normalize
   node /workspace/scripts/p6_demand_queue.mjs next --run-id ${runId} --priority high
2. 선점한 후보로 wiki-demand-analyst를 스폰해 커뮤니티 큐레이션 보고서(genre·evidence_grade·생성/업데이트 권고 포함)를 받으세요.
3. 팀장이 APPROVED / REJECTED / REVISION REQUESTED 중 하나를 명시적으로 판정하세요. community_only면 editorial로 강등하고, update는 evidence_grade=corroborated이고 새 사실 출처가 합리적일 때만 승인하세요.
4. APPROVED면 큐와 파일 락을 모두 예약하세요. create(사설 포함)는 mode=create(파일 부재), update는 mode=update(파일 존재)입니다.
   node /workspace/scripts/p6_demand_queue.mjs reserve --candidate-id <id> --run-id ${runId} --mode <create|update> --file wiki/{category}/{slug}.md
   node /workspace/scripts/wiki_work_registry.mjs reserve --run-id ${runId} --file wiki/{category}/{slug}.md --topic "p6:<id>:{slug}"
5. 라우팅(genre별 작성 브리프 전달):
   - create(fact): wiki-planner→wiki-writer.
   - create(editorial): wiki-writer에 사설 브리프("커뮤니티 견해" 배지 + 사실 단정 금지).
   - 내용 업데이트(근거 기반 보강): wiki-writer 섹션 병합 브리프로 대상 파일을 타깃 보강(전체 재정비 아님). 문체 전용인 wiki-rewriter에 내용 보강을 위임하지 마세요(레거시 라우팅 버그 교정).
   - 문체 교정만 필요하면 wiki-rewriter. 어느 경우든 사실 관계·스포일러 등급을 임의로 바꾸지 마세요.
6. source-sanitizer → wiki-linker → wiki-quality-lead(gate) 순으로 검증하세요. sanitizer fail은 최대 2회, linker/quality fail은 최대 1회 재작성 요청.
7. commit 전에 구조화 리포트를 누적 저장하세요: /workspace/.admin/runs/p6-${runId}-report.json
   각 후보 항목에 candidate_id, type, genre, evidence_grade, cluster_ids, supporting_count(>0), decision, target_file, sanitizer("pass"), linker, quality("pass"|"warn"), commit_hash 를 포함하세요. genre·evidence_grade는 관측용 선택 필드로 러너 게이트는 이를 검증하지 않으며, 강제 필드(decision∈{create,update}, supporting_count>0, sanitizer=pass, quality!=fail)는 그대로입니다. editorial은 decision=create로 처리해 게이트를 통과합니다.
8. 통과한 wiki 파일만 git add/commit/push 하세요. 완료 후 큐와 락을 정리하세요(complete/release).
9. 1회 실행에서 최대 3개 후보를 순차 처리하세요. pending이 없으면 "처리할 후보 없음"을 보고하고 종료하세요.

MCP 커버리지 게이트 (공통 하드 + 타입별):
- 공통(전 타입, 러너가 코드로 강제): dataforge qaset_with_rag(가능 시), namuwiki MCP, dataforge dc_gallery(커뮤니티 수요 근거).
- lore/mechanics 타입 추가(팀장이 보고로 확인): dataforge sg_paper, sg-ontology MCP, dataforge sg_game_sg0_en.
- dataforge dc_gallery는 dcinside 유저 게시글 소스입니다. source_names=["dc_gallery"], top_k는 반드시 30 이하로 조회하세요.
- sg_game_sge는 배제 감사 전용입니다. 위키 본문·요약에 반영 금지.

위생 규칙 (절대 준수):
- dc_gallery(dcinside) 근거는 산문 가공 전용. 원문 직접 인용 블록·각주([^N]) 금지, gall_num/chunk ID/source 이름·내부 경로(data/dc_gallery/...)를 위키 본문에 노출 금지.
- sg_game_sge·sg_game_sg0_en은 파라프레이즈만, 소스명·chunk ID 노출 금지.
- data/dc_gallery/, .admin/, 큐/리포트 파일은 절대 git add 금지. 대상 wiki/*.md만 commit.

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- 동일 파일을 동시에 수정하지 마세요(두 계층 락 사용).
- sanitizer fail 또는 quality-lead FAIL 상태에서 commit하지 마세요.
- 하위 에이전트에게 git commit/push를 위임하지 마세요.
- 완료 시 처리/스킵/거부 후보 ID, 각 decision(create/update), commit hash 또는 미커밋 사유, 리포트 경로를 요약하세요.`;
}

function buildP7Prompt(runId) {
  return `파이프라인 7 - claude-mem 반복 결정 규칙 승격 제안 생성을 지금 실행하세요.

실행 ID: ${runId}
작업 디렉토리: /workspace

반드시 /home/claude/.claude/CLAUDE.md 및 /home/claude/.claude/agents/*.md 지침을 따르세요.

당신은 claude-mem 관측을 검토해 반복되는 운영 결정을 규칙 파일로 승격할 "제안"만 생성하는 팀장입니다.

핵심 원칙:
- 이 파이프라인은 규칙 파일을 직접 수정하지 않습니다.
- git add/commit/push를 절대 실행하지 않습니다.
- 실제 적용은 admin UI에서 사용자가 파일별 diff를 보고, 필요하면 제안문을 수정한 뒤 승인해야만 가능합니다.
- 메모리 관측은 규칙보다 우선하지 않습니다. 관측은 규칙 업데이트 후보를 찾는 입력입니다.

작업 목표:
1. claude-mem \`mem-search\`를 사용해 최근 반복된 \`decision\`, \`gotcha\`, \`problem-solution\`, sanitizer/quality warning, 표기·구조·파이프라인 운영 판단을 검색하세요.
   - 반드시 \`search -> timeline -> get_observations\` 순서로 좁혀 보세요.
   - 검색 결과가 없으면 빈 proposals manifest를 생성하고 종료하세요.
2. 아래 허용 대상 파일만 읽고, 필요한 경우 "제안된 전체 파일 내용"을 생성하세요.
   - AGENTS.md
   - README.md
   - wiki/README.md
   - docker/holyclaude/data/claude/CLAUDE.md
   - docker/holyclaude/data/claude/agents/*.md
3. 반복성이 약하거나 일회성 실행 로그인 관측은 제안하지 마세요.
4. 제안은 파일별로 분리하세요. 한 파일에 여러 규칙을 넣어도 되지만, 대상 파일마다 proposal 1개를 만드세요.
5. 각 proposal은 현재 파일의 전체 내용에 필요한 변경만 반영한 "제안 전체본"이어야 합니다.

산출물 위치:
\`\`\`
/workspace/.admin/rule-promotions/${runId}/manifest.json
/workspace/.admin/rule-promotions/${runId}/proposed/{proposal_id}.md
\`\`\`

manifest 형식:
\`\`\`json
{
  "run_id": "${runId}",
  "pipeline": "p7",
  "created_at": "{ISO-8601 timestamp}",
  "status": "pending_review",
  "summary": "이번 규칙 승격 제안 요약",
  "proposals": [
    {
      "id": "짧은 kebab-case id",
      "target_path": "docker/holyclaude/data/claude/agents/wiki-team-lead.md",
      "title": "제안 제목",
      "rationale": "왜 반복 규칙으로 승격할 가치가 있는지",
      "source_observations": ["관측 ID 또는 검색 요약. 원문/비밀/내부 source id 금지"],
      "before_sha256": "현재 대상 파일 UTF-8 내용 sha256",
      "proposed_path": "proposed/{proposal_id}.md",
      "status": "pending"
    }
  ]
}
\`\`\`

검증:
- \`manifest.json\`이 JSON으로 파싱되는지 확인하세요.
- 모든 \`target_path\`가 허용 대상에 속하는지 확인하세요.
- 모든 \`proposed_path\` 파일이 존재하는지 확인하세요.
- \`before_sha256\`은 대상 파일 현재 내용 기준이어야 합니다.

금지:
- 허용 대상 외 파일 제안 금지.
- 공개 금지 정보(source_filter 이름, chunk ID, 내부 RAG 파일 경로, 원문 직접 인용)를 proposal에 포함 금지.
- 위키 본문 파일 수정 금지.
- 규칙 파일 직접 수정 금지.
- git 명령 금지.

완료 시 manifest 경로, proposal 개수, 대상 파일 목록, 적용은 사용자 승인 후 admin UI에서만 가능하다는 점을 보고하세요.`;
}

function formatUserInstruction(instruction) {
  const text = String(instruction ?? '').trim();
  if (!text) {
    return '';
  }
  return `

추가 사용자 지시 (수동 트리거에서 입력 — 선택):
${text}

위 사용자 지시는 기본 파이프라인 목표에 추가로 반영한다. 단, 보안/위생 규칙(내부 경로·chunk ID·source_filter·배제 소스 비노출)과 코드 강제 게이트(MCP 커버리지·source-sanitizer·검증)는 사용자 지시보다 항상 우선하며, 사용자 지시로 이 규칙을 완화하거나 우회할 수 없다.`;
}

function buildPrompt(command, runId, instruction = '') {
  let prompt;
  if (command === 'p1') {
    prompt = buildP1Prompt(runId);
  } else if (command === 'p3') {
    prompt = buildP3Prompt(runId);
  } else if (command === 'p4') {
    prompt = buildP4Prompt(runId);
  } else if (command === 'p5') {
    prompt = buildP5Prompt(runId);
  } else if (command === 'p6') {
    prompt = buildP6Prompt(runId);
  } else if (command === 'p7') {
    prompt = buildP7Prompt(runId);
  } else {
    prompt = buildP2Prompt(runId);
  }
  return prompt + formatUserInstruction(instruction);
}

function truncate(value, limit = 1200) {
  const text = String(value ?? '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function stringifyToolInput(input) {
  try {
    return JSON.stringify(input ?? {});
  } catch (_error) {
    return String(input ?? '');
  }
}

function createMcpCoverageTracker(required = REQUIRED_MCP_COVERAGE) {
  return {
    required,
    items: Object.fromEntries(
      required.map((item) => [
        item.key,
        {
          ...item,
          attempted: 0,
          succeeded: 0,
          successfulToolIds: new Set(),
        },
      ]),
    ),
    pendingToolUses: new Map(),
    successfulCoverageToolIds: new Set(),
  };
}

function labelsForToolUse(block, required) {
  const name = String(block.name ?? '').toLowerCase();
  const inputText = stringifyToolInput(block.input);
  const requiredKeys = new Set(required.map((item) => item.key));
  const labels = [];

  if (name.startsWith('mcp__dataforge__')) {
    for (const item of required) {
      if (item.type === 'dataforge-source' && inputText.includes(item.source)) {
        labels.push(item.key);
      }
    }
  }

  if (name.startsWith('mcp__namuwiki__') && requiredKeys.has('namuwiki')) {
    labels.push('namuwiki');
  }

  if (
    requiredKeys.has('sg_ontology') &&
    name.startsWith('mcp__') &&
    (name.includes('sg-ontology') || name.includes('sg_ontology') || name.includes('sgontology'))
  ) {
    labels.push('sg_ontology');
  }

  return [...new Set(labels)];
}

function recordToolUse(block, coverage) {
  if (!coverage || !block?.id) {
    return;
  }

  const labels = labelsForToolUse(block, coverage.required);
  if (labels.length === 0) {
    return;
  }

  coverage.pendingToolUses.set(block.id, {
    labels,
    name: block.name,
  });

  for (const label of labels) {
    coverage.items[label].attempted += 1;
  }
}

function recordToolResult(block, coverage) {
  if (!coverage || !block?.tool_use_id) {
    return;
  }

  const pending = coverage.pendingToolUses.get(block.tool_use_id);
  if (!pending || block.is_error) {
    return;
  }

  coverage.successfulCoverageToolIds.add(block.tool_use_id);
  for (const label of pending.labels) {
    const item = coverage.items[label];
    item.succeeded += 1;
    item.successfulToolIds.add(block.tool_use_id);
  }
}

function missingMcpCoverage(coverage) {
  return coverage.required.filter((item) => coverage.items[item.key].succeeded < 1);
}

function emitMcpCoverage(runId, coverage) {
  console.log(`[${runId}] mcp coverage:`);
  for (const item of coverage.required) {
    const state = coverage.items[item.key];
    const status = state.succeeded > 0 ? 'ok' : state.attempted > 0 ? 'attempted' : 'missing';
    console.log(
      `[mcp-coverage] ${item.label} status=${status} attempted=${state.attempted} succeeded=${state.succeeded}`,
    );
  }
  console.log(`[mcp-coverage] successful_required_calls=${coverage.successfulCoverageToolIds.size}`);
}

function missingConfiguredMcpServers(mcpServers) {
  return REQUIRED_MCP_SERVERS.filter((name) => !Object.hasOwn(mcpServers, name));
}

// 파이프라인 6 구조화 리포트 검증. 팀장이 commit 전 산출한 후보별 리포트의
// 필수 필드·게이트 결과를 확인한다. 리포트가 없으면(처리 후보 0건 등) 경고만 하고
// 실패시키지 않는다. 리포트가 있으면 각 후보가 게이트를 통과했는지 강제한다.
// 반환: 실패 사유 문자열(있으면) 또는 null(통과).
async function verifyP6Report(runId) {
  const reportPath = path.join(DEFAULT_CWD, '.admin', 'runs', `p6-${runId}-report.json`);
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`[p6:${runId}] no report file (no candidates committed?): ${reportPath}`);
      return null;
    }
    return `report unreadable: ${error.message}`;
  }

  const candidates = Array.isArray(report.candidates) ? report.candidates : null;
  if (!candidates) {
    return 'report missing candidates array';
  }
  if (candidates.length === 0) {
    return null;
  }

  for (const cand of candidates) {
    const id = cand.candidate_id || '(unknown)';
    if (!cand.candidate_id || !cand.decision || !cand.target_file) {
      return `candidate ${id} missing required fields (candidate_id/decision/target_file)`;
    }
    if (!['create', 'update'].includes(cand.decision)) {
      return `candidate ${id} invalid decision: ${cand.decision}`;
    }
    if (!(Number(cand.supporting_count) > 0)) {
      return `candidate ${id} supporting_count not > 0`;
    }
    if (cand.sanitizer !== 'pass') {
      return `candidate ${id} sanitizer != pass (${cand.sanitizer})`;
    }
    if (cand.quality === 'fail') {
      return `candidate ${id} quality == fail`;
    }
  }
  return null;
}

function emitMessage(message, coverage) {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'system') {
    console.log(`[system] ${message.subtype ?? 'event'} session=${message.session_id ?? '-'}`);
    return;
  }

  if (message.type === 'assistant' && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'text') {
        console.log(truncate(block.text, 4000));
      } else if (block.type === 'tool_use') {
        recordToolUse(block, coverage);
        console.log(`[tool] ${block.name}`);
      }
    }
    return;
  }

  if (message.type === 'user' && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'tool_result') {
        recordToolResult(block, coverage);
        const status = block.is_error ? 'error' : 'ok';
        console.log(`[tool-result:${status}] ${truncate(block.content, 1200)}`);
      }
    }
    return;
  }

  if (message.type === 'result') {
    const subtype = message.subtype ?? 'complete';
    const duration = message.duration_ms ? ` duration_ms=${message.duration_ms}` : '';
    console.log(`[result] ${subtype}${duration}`);
    return;
  }

  console.log(`[event] ${message.type ?? 'unknown'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prompt = buildPrompt(args.command, args.runId, args.instruction);
  const mcpServers = await loadMcpServers(DEFAULT_CWD);
  const mcpNames = Object.keys(mcpServers);
  const missingServers = missingConfiguredMcpServers(mcpServers);
  const enableBatchAutoHooks =
    process.env.HOLYCLAUDE_PIPELINE_ENABLE_AUTO_HOOKS_FOR_BATCH === '1' || args.command === 'p7';
  const settingSources = enableBatchAutoHooks
    ? ['project', 'user', 'local']
    : ['project', 'local'];

  console.log(`[${args.command}:${args.runId}] starting holyclaude pipeline`);
  console.log(`[${args.command}:${args.runId}] cwd=${DEFAULT_CWD}`);
  console.log(`[${args.command}:${args.runId}] settingSources=${settingSources.join(',')}`);
  console.log(
    `[${args.command}:${args.runId}] mcpServers=${mcpNames.length ? mcpNames.join(',') : '(none configured)'}`,
  );

  if (args.dryRun) {
    console.log(`[${args.command}:${args.runId}] dry-run prompt:`);
    console.log(prompt);
    return;
  }

  if (missingServers.length > 0) {
    console.error(`[${args.command}:${args.runId}] missing required MCP server config: ${missingServers.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const { query } = await import(SDK_PATH);
  const options = {
    cwd: DEFAULT_CWD,
    model: process.env.HOLYCLAUDE_PIPELINE_MODEL || DEFAULT_MODEL,
    permissionMode: 'bypassPermissions',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
    },
    settingSources,
    tools: {
      type: 'preset',
      preset: 'claude_code',
    },
  };

  if (mcpNames.length > 0) {
    options.mcpServers = mcpServers;
  }

  let exitCode = 0;
  const coverageRequired =
    args.command === 'p1'
      ? REQUIRED_MCP_COVERAGE
      : args.command === 'p6'
        ? P6_REQUIRED_COVERAGE
        : null;
  const coverage = coverageRequired ? createMcpCoverageTracker(coverageRequired) : null;
  const stream = query({ prompt, options });
  let sawResult = false;
  for await (const message of stream) {
    emitMessage(message, coverage);
    if (message.type === 'result' && message.subtype && message.subtype !== 'success') {
      exitCode = 1;
    }
    if (message.type === 'result') {
      sawResult = true;
    }
  }

  if (!sawResult) {
    console.log(
      `[${args.command}:${args.runId}] stream ended before result event; treating run as failed`,
    );
    exitCode = 1;
  }

  if (coverage) {
    emitMcpCoverage(args.runId, coverage);

    const missingCoverage = missingMcpCoverage(coverage);
    if (missingCoverage.length > 0) {
      console.log(
        `[${args.command}:${args.runId}] missing required MCP coverage: ${missingCoverage
          .map((item) => item.label)
          .join(', ')}`,
      );
      exitCode = 1;
    }

    if (coverage.successfulCoverageToolIds.size < coverage.required.length) {
      console.log(
        `[${args.command}:${args.runId}] insufficient distinct MCP coverage calls: ${coverage.successfulCoverageToolIds.size}/${coverage.required.length}`,
      );
      exitCode = 1;
    }
  }

  if (args.command === 'p6') {
    const reportFailure = await verifyP6Report(args.runId);
    if (reportFailure) {
      console.log(`[p6:${args.runId}] report verification failed: ${reportFailure}`);
      exitCode = 1;
    }
  }

  if (exitCode === 0) {
    console.log(`[${args.command}:${args.runId}] completed`);
  } else {
    console.log(`[${args.command}:${args.runId}] finished with non-success result`);
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`[pipeline] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
