#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const ADMIN_DIR = path.join(WORKSPACE, '.admin');
const REGISTRY_PATH = path.join(ADMIN_DIR, 'p1-work-registry.json');
const LOCK_PATH = path.join(ADMIN_DIR, 'p1-work-registry.lock');
const ACTIVE_TTL_MS = 12 * 60 * 60 * 1000;
const RECONCILE_TTL_MS = 30 * 60 * 1000;
const LOCK_TTL_MS = 2 * 60 * 1000;

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const key = item.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function normalizeWikiFile(value) {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  if (
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid file path: ${value}`);
  }
  // p1/p2: wiki/*.md. p3: 온톨로지 TTL (docker/holyclaude/ontology/...).
  const isWiki = normalized.startsWith('wiki/') && normalized.endsWith('.md');
  const isOntology = normalized.startsWith('docker/holyclaude/ontology/') && normalized.endsWith('.ttl');
  if (!isWiki && !isOntology) {
    throw new Error(`Invalid file path (expected wiki/*.md or docker/holyclaude/ontology/*.ttl): ${value}`);
  }
  return normalized;
}

function nowIso() {
  return new Date().toISOString();
}

function splitIds(value) {
  return String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionNow(options) {
  if (!options.now) return Date.now();
  const parsed = Date.parse(options.now);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid --now timestamp: ${options.now}`);
  }
  return parsed;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return { active: {}, history: [] };
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

function saveRegistry(registry) {
  mkdirSync(ADMIN_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

function acquireLock() {
  mkdirSync(ADMIN_DIR, { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: nowIso() }), 'utf8');
      return fd;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      try {
        const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
        if (age > LOCK_TTL_MS) {
          rmSync(LOCK_PATH, { force: true });
          continue;
        }
      } catch (_innerError) {
        rmSync(LOCK_PATH, { force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  throw new Error(`Timed out acquiring registry lock: ${LOCK_PATH}`);
}

function releaseLock(fd) {
  try {
    if (typeof fd === 'number') {
      closeSync(fd);
      rmSync(LOCK_PATH, { force: true });
    }
  } catch (_error) {
    // Best effort cleanup; the stale lock TTL handles leftovers.
  }
}

function pruneStale(registry) {
  const cutoff = Date.now() - ACTIVE_TTL_MS;
  for (const [file, entry] of Object.entries(registry.active || {})) {
    const updated = Date.parse(entry.updated_at || entry.started_at || 0);
    if (!Number.isNaN(updated) && updated < cutoff) {
      registry.history.push({ ...entry, file, status: 'stale_released', released_at: nowIso() });
      delete registry.active[file];
    }
  }
}

function requireOption(options, key) {
  if (!options[key]) {
    throw new Error(`Missing required --${key}`);
  }
  return options[key];
}

function reserve(registry, options) {
  const runId = requireOption(options, 'run-id');
  const file = normalizeWikiFile(requireOption(options, 'file'));
  const topic = requireOption(options, 'topic');
  const existing = registry.active[file];

  if (existing && existing.run_id !== runId) {
    throw new Error(`Wiki file already reserved by run ${existing.run_id}: ${file}`);
  }
  if (existing && existing.run_id === runId) {
    existing.updated_at = nowIso();
    return { status: 'ok', action: 'already_reserved', entry: existing };
  }

  if (!options['allow-existing']) {
    const absoluteFile = path.join(WORKSPACE, file);
    if (existsSync(absoluteFile)) {
      throw new Error(`Wiki file already exists, reject duplicate topic before writer: ${file}`);
    }
  }

  const entry = {
    run_id: runId,
    topic,
    file,
    status: 'reserved',
    started_at: nowIso(),
    updated_at: nowIso(),
  };
  registry.active[file] = entry;
  return { status: 'ok', action: 'reserved', entry };
}

function updateStatus(registry, options) {
  const runId = requireOption(options, 'run-id');
  const file = normalizeWikiFile(requireOption(options, 'file'));
  const status = requireOption(options, 'status');
  const entry = registry.active[file];
  if (!entry || entry.run_id !== runId) {
    throw new Error(`No active reservation for run ${runId}: ${file}`);
  }
  entry.status = status;
  entry.updated_at = nowIso();
  return { status: 'ok', action: 'updated', entry };
}

function finish(registry, options, status) {
  const runId = requireOption(options, 'run-id');
  const file = normalizeWikiFile(requireOption(options, 'file'));
  const entry = registry.active[file];
  if (!entry || entry.run_id !== runId) {
    throw new Error(`No active reservation for run ${runId}: ${file}`);
  }
  const finished = { ...entry, status, finished_at: nowIso(), updated_at: nowIso() };
  registry.history.push(finished);
  delete registry.active[file];
  return { status: 'ok', action: status, entry: finished };
}

function reconcile(registry, options) {
  const activeRunIds = new Set(splitIds(options['active-run-ids'] || ''));
  const ttlMs = parsePositiveInt(options['ttl-ms'], RECONCILE_TTL_MS);
  const cutoff = optionNow(options) - ttlMs;
  const released = [];

  for (const [file, entry] of Object.entries(registry.active || {})) {
    if (entry.run_id && activeRunIds.has(entry.run_id)) continue;

    const updated = Date.parse(entry.updated_at || entry.started_at || 0);
    if (!Number.isNaN(updated) && updated > cutoff) continue;

    const reason = `stale registry reservation reconciled from run ${entry.run_id || '(none)'}`;
    const finished = {
      ...entry,
      file,
      status: options.status || 'stale_released',
      reason,
      released_at: nowIso(),
      updated_at: nowIso(),
    };
    registry.history.push(finished);
    delete registry.active[file];
    released.push({ file, previous_run_id: entry.run_id || null });
  }

  return {
    status: 'ok',
    action: 'reconcile',
    ttl_ms: ttlMs,
    active_run_ids: [...activeRunIds],
    released,
    active_count: Object.keys(registry.active || {}).length,
  };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  let fd = null;
  try {
    fd = acquireLock();
    const registry = loadRegistry();
    registry.active ||= {};
    registry.history ||= [];
    pruneStale(registry);

    let result;
    if (command === 'reserve') {
      result = reserve(registry, options);
    } else if (command === 'status') {
      result = updateStatus(registry, options);
    } else if (command === 'complete') {
      result = finish(registry, options, 'completed');
    } else if (command === 'release') {
      result = finish(registry, options, options.status || 'released');
    } else if (command === 'reconcile') {
      result = reconcile(registry, options);
    } else if (command === 'list') {
      result = { status: 'ok', registry };
    } else {
      throw new Error('Usage: wiki_work_registry.mjs reserve|status|complete|release|reconcile|list ...');
    }

    saveRegistry(registry);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    releaseLock(fd);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
