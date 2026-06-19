#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const SDK_PATH =
  '/usr/local/lib/node_modules/@siteboon/claude-code-ui/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';

const DEFAULT_CWD = '/workspace';
const DEFAULT_MODEL = 'sonnet';

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
    throw new Error('Usage: run_holyclaude_pipeline.mjs p1 --run-id <id> [--dry-run]');
  }
  if (args.command !== 'p1') {
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

목표:
1. /workspace/wiki/ 현황과 qaset 근거를 비교해 아직 작성되지 않은 주제를 선정하세요.
2. wiki-planner, wiki-writer, source-sanitizer 에이전트를 사용해 최대 1개 문서를 완성하세요.
3. source-sanitizer 통과 전에는 commit/push하지 마세요.
4. 통과한 경우에만 git add, commit, push까지 수행하세요.
5. 막히면 무엇이 막혔는지 명확히 보고하고, 검증되지 않은 초안은 commit하지 마세요.

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
  const prompt = buildP1Prompt(args.runId);
  const mcpServers = await loadMcpServers(DEFAULT_CWD);
  const mcpNames = Object.keys(mcpServers);
  const missingServers = missingConfiguredMcpServers(mcpServers);

  console.log(`[p1:${args.runId}] starting holyclaude pipeline`);
  console.log(`[p1:${args.runId}] cwd=${DEFAULT_CWD}`);
  console.log(`[p1:${args.runId}] mcpServers=${mcpNames.length ? mcpNames.join(',') : '(none configured)'}`);

  if (args.dryRun) {
    console.log(`[p1:${args.runId}] dry-run prompt:`);
    console.log(prompt);
    return;
  }

  if (missingServers.length > 0) {
    console.error(`[p1:${args.runId}] missing required MCP server config: ${missingServers.join(', ')}`);
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
  const coverage = createMcpCoverageTracker();
  const stream = query({ prompt, options });
  for await (const message of stream) {
    emitMessage(message, coverage);
    if (message.type === 'result' && message.subtype && message.subtype !== 'success') {
      exitCode = 1;
    }
  }

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

  if (exitCode === 0) {
    console.log(`[p1:${args.runId}] completed`);
  } else {
    console.log(`[p1:${args.runId}] finished with non-success result`);
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`[p1] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
