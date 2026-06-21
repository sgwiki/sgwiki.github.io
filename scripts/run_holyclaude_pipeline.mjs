#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

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

function parseArgs(argv) {
  const args = {
    command: null,
    runId: `manual-${Date.now()}`,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!args.command && !value.startsWith('--')) {
      args.command = value;
    } else if (value === '--run-id') {
      args.runId = argv[index + 1];
      index += 1;
    } else if (value === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.command) {
    throw new Error('Usage: run_holyclaude_pipeline.mjs <p1|p2> --run-id <id> [--dry-run]');
  }
  if (!['p1', 'p2'].includes(args.command)) {
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
10. sanitizer pass인 approved 반영분만 git add/commit/push 하세요. suggestions/ 디렉토리는 로컬 런타임 큐이므로 git add하지 마세요.

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

function buildPrompt(command, runId) {
  if (command === 'p1') {
    return buildP1Prompt(runId);
  }
  if (command === 'p3') {
    return buildP3Prompt(runId);
  }
  return buildP2Prompt(runId);
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

function createMcpCoverageTracker() {
  return {
    items: Object.fromEntries(
      REQUIRED_MCP_COVERAGE.map((item) => [
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

function labelsForToolUse(block) {
  const name = String(block.name ?? '').toLowerCase();
  const inputText = stringifyToolInput(block.input);
  const labels = [];

  if (name.startsWith('mcp__dataforge__')) {
    for (const item of REQUIRED_MCP_COVERAGE) {
      if (item.type === 'dataforge-source' && inputText.includes(item.source)) {
        labels.push(item.key);
      }
    }
  }

  if (name.startsWith('mcp__namuwiki__')) {
    labels.push('namuwiki');
  }

  if (
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

  const labels = labelsForToolUse(block);
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
  return REQUIRED_MCP_COVERAGE.filter((item) => coverage.items[item.key].succeeded < 1);
}

function emitMcpCoverage(runId, coverage) {
  console.log(`[p1:${runId}] mcp coverage:`);
  for (const item of REQUIRED_MCP_COVERAGE) {
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
  const prompt = buildPrompt(args.command, args.runId);
  const mcpServers = await loadMcpServers(DEFAULT_CWD);
  const mcpNames = Object.keys(mcpServers);
  const missingServers = missingConfiguredMcpServers(mcpServers);

  console.log(`[${args.command}:${args.runId}] starting holyclaude pipeline`);
  console.log(`[${args.command}:${args.runId}] cwd=${DEFAULT_CWD}`);
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
    settingSources: ['project', 'user', 'local'],
    tools: {
      type: 'preset',
      preset: 'claude_code',
    },
  };

  if (mcpNames.length > 0) {
    options.mcpServers = mcpServers;
  }

  let exitCode = 0;
  const coverage = args.command === 'p1' ? createMcpCoverageTracker() : null;
  const stream = query({ prompt, options });
  for await (const message of stream) {
    emitMessage(message, coverage);
    if (message.type === 'result' && message.subtype && message.subtype !== 'success') {
      exitCode = 1;
    }
  }

  if (args.command === 'p1') {
    emitMcpCoverage(args.runId, coverage);

    const missingCoverage = missingMcpCoverage(coverage);
    if (missingCoverage.length > 0) {
      console.log(
        `[p1:${args.runId}] missing required MCP coverage: ${missingCoverage
          .map((item) => item.label)
          .join(', ')}`,
      );
      exitCode = 1;
    }

    if (coverage.successfulCoverageToolIds.size < REQUIRED_MCP_COVERAGE.length) {
      console.log(
        `[p1:${args.runId}] insufficient distinct MCP coverage calls: ${coverage.successfulCoverageToolIds.size}/${REQUIRED_MCP_COVERAGE.length}`,
      );
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
