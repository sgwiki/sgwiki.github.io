#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const SDK_PATH =
  '/usr/local/lib/node_modules/@siteboon/claude-code-ui/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';

const DEFAULT_CWD = '/workspace';
const DEFAULT_MODEL = 'sonnet';

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

운영 제약:
- 사용자에게 진행 여부를 묻지 말고, 안전한 다음 단계는 직접 수행하세요.
- 동일 파일을 동시에 수정하지 마세요.
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

function emitMessage(message) {
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
        console.log(`[tool] ${block.name}`);
      }
    }
    return;
  }

  if (message.type === 'user' && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'tool_result') {
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

  console.log(`[p1:${args.runId}] starting holyclaude pipeline`);
  console.log(`[p1:${args.runId}] cwd=${DEFAULT_CWD}`);
  console.log(`[p1:${args.runId}] mcpServers=${mcpNames.length ? mcpNames.join(',') : '(none configured)'}`);

  if (args.dryRun) {
    console.log(`[p1:${args.runId}] dry-run prompt:`);
    console.log(prompt);
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
  const stream = query({ prompt, options });
  for await (const message of stream) {
    emitMessage(message);
    if (message.type === 'result' && message.subtype && message.subtype !== 'success') {
      exitCode = 1;
    }
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
