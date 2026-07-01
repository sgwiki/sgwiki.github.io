#!/usr/bin/env node

// 파이프라인 6 — 커뮤니티 큐레이션 콘텐츠 생성/업데이트 후보 큐.
//
// wiki_work_registry.mjs(파일 단위 동시성 락)와 별개로, 후보 "소비 큐"를 추적한다.
// - normalize: all_wiki_candidates.csv(BOM·다중 cluster_id·중복 제목) → 정규화 큐
// - list / next: pending 후보 조회·원자적 선점
// - reserve: create는 대상 파일 부재를, update는 파일 존재를 요구(상호 반대 조건)
//   → wiki_work_registry.reserve가 기존 파일에서 항상 throw하던 P0 문제를 해결한다.
// - complete / reject: 터미널 상태 기록
// - reclaim-stale: 죽은 run이 점유한 in_progress 후보를 회수
//
// 출력은 항상 JSON 한 덩어리(stdout). 실패 시 stderr + exit 1.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const ADMIN_DIR = path.join(WORKSPACE, '.admin');
const QUEUE_PATH = path.join(ADMIN_DIR, 'p6-demand-queue.json');
const LOCK_PATH = path.join(ADMIN_DIR, 'p6-demand-queue.lock');
const DEFAULT_CSV = path.join(
  WORKSPACE,
  'data/dc_gallery/wiki_candidates/all_wiki_candidates.csv',
);
const LOCK_TTL_MS = 2 * 60 * 1000;
const IN_PROGRESS_TTL_MS = 30 * 60 * 1000;

const TERMINAL = new Set(['created', 'updated', 'rejected', 'skipped', 'abandoned']);
const VALID_MODES = new Set(['create', 'update']);

function nowIso() {
  return new Date().toISOString();
}

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

function requireOption(options, key) {
  if (!options[key]) {
    throw new Error(`Missing required --${key}`);
  }
  return options[key];
}

// ── 락 (wiki_work_registry.mjs와 동일 패턴) ────────────────────────────────
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
  throw new Error(`Timed out acquiring queue lock: ${LOCK_PATH}`);
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

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) {
    return { candidates: {}, history: [], normalized_at: null, source_csv: null };
  }
  const queue = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
  queue.candidates ||= {};
  queue.history ||= [];
  return queue;
}

function saveQueue(queue) {
  mkdirSync(ADMIN_DIR, { recursive: true });
  writeFileSync(QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

// ── CSV 파서 (RFC4180 최소 구현, BOM 제거) ────────────────────────────────
function parseCsv(text) {
  const clean = text.replace(/^﻿/, ''); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // ignore; handled by \n
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function candidateId(normalizedTitle) {
  const digest = createHash('sha1').update(normalizedTitle, 'utf8').digest('hex').slice(0, 10);
  return `cand-${digest}`;
}

function splitIds(value) {
  return String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function splitRunIds(value) {
  return new Set(splitIds(value));
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

function splitClusterIds(value) {
  return splitIds(value)
    .map((token) => Number.parseInt(token, 10))
    .filter((num) => Number.isFinite(num));
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
function priorityRank(priority) {
  return PRIORITY_RANK[String(priority || '').toLowerCase()] ?? 3;
}

// ── 명령 ─────────────────────────────────────────────────────────────────
function normalize(queue, options) {
  const csvPath = options.csv ? path.resolve(WORKSPACE, options.csv) : DEFAULT_CSV;
  if (!existsSync(csvPath)) {
    throw new Error(`Candidate CSV not found: ${csvPath}`);
  }
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) {
    throw new Error(`Candidate CSV has no data rows: ${csvPath}`);
  }
  const header = rows[0].map((h) => normalizeTitle(h).replace(/^﻿/, ''));
  const col = (name) => header.indexOf(name);
  const idxTitle = col('wiki_title');
  const idxContent = col('content_to_include');
  const idxCluster = col('cluster_id');
  const idxTheme = col('cluster_theme');
  const idxRationale = col('rationale');
  const idxGall = col('supporting_gall_ids');
  const idxPriority = col('priority');
  if (idxTitle < 0) {
    throw new Error(`CSV missing required column 'wiki_title' (header: ${header.join('|')})`);
  }

  let added = 0;
  let merged = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const title = normalizeTitle(cells[idxTitle]);
    if (!title) continue;
    const id = candidateId(title);
    const clusterIds = idxCluster >= 0 ? splitClusterIds(cells[idxCluster]) : [];
    const gallIds = idxGall >= 0 ? splitIds(cells[idxGall]) : [];

    const existing = queue.candidates[id];
    if (existing) {
      // 중복 제목(17종)·다중 row 병합: cluster/gall id 합집합, 텍스트는 기존 유지.
      existing.cluster_ids = [...new Set([...(existing.cluster_ids || []), ...clusterIds])];
      existing.supporting_gall_ids = [
        ...new Set([...(existing.supporting_gall_ids || []), ...gallIds]),
      ];
      existing.updated_at = nowIso();
      merged += 1;
      continue;
    }

    queue.candidates[id] = {
      candidate_id: id,
      wiki_title: title,
      normalized_title: title,
      content_to_include: idxContent >= 0 ? cells[idxContent] : '',
      cluster_ids: clusterIds,
      cluster_theme: idxTheme >= 0 ? cells[idxTheme] : '',
      rationale: idxRationale >= 0 ? cells[idxRationale] : '',
      supporting_gall_ids: gallIds,
      priority: idxPriority >= 0 ? normalizeTitle(cells[idxPriority]) : '',
      status: 'pending',
      decision: null,
      target_file: null,
      commit_hash: null,
      reason: null,
      run_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    added += 1;
  }

  queue.normalized_at = nowIso();
  queue.source_csv = path.relative(WORKSPACE, csvPath);
  const counts = countByStatus(queue);
  return { status: 'ok', action: 'normalized', added, merged, total: Object.keys(queue.candidates).length, counts };
}

function countByStatus(queue) {
  const counts = {};
  for (const cand of Object.values(queue.candidates)) {
    counts[cand.status] = (counts[cand.status] || 0) + 1;
  }
  return counts;
}

function sortCandidates(candidates) {
  return candidates.sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return a.wiki_title.localeCompare(b.wiki_title, 'ko');
  });
}

function list(queue, options) {
  let items = Object.values(queue.candidates);
  if (options.status) {
    items = items.filter((c) => c.status === options.status);
  }
  if (options.priority) {
    items = items.filter((c) => String(c.priority).toLowerCase() === options.priority.toLowerCase());
  }
  items = sortCandidates(items);
  const limit = options.limit ? Number.parseInt(options.limit, 10) : items.length;
  return {
    status: 'ok',
    action: 'list',
    counts: countByStatus(queue),
    total: items.length,
    candidates: items.slice(0, Number.isFinite(limit) ? limit : items.length),
  };
}

function next(queue, options) {
  const runId = requireOption(options, 'run-id');
  let pending = Object.values(queue.candidates).filter((c) => c.status === 'pending');
  if (options.priority) {
    pending = pending.filter((c) => String(c.priority).toLowerCase() === options.priority.toLowerCase());
  }
  pending = sortCandidates(pending);
  const picked = pending[0];
  if (!picked) {
    return { status: 'ok', action: 'next', candidate: null, note: 'no pending candidates' };
  }
  picked.status = 'in_progress';
  picked.run_id = runId;
  picked.updated_at = nowIso();
  return { status: 'ok', action: 'next', candidate: picked };
}

function getCandidate(queue, options) {
  const id = requireOption(options, 'candidate-id');
  const cand = queue.candidates[id];
  if (!cand) {
    throw new Error(`Unknown candidate-id: ${id}`);
  }
  return cand;
}

function normalizeWikiFile(value) {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid file path: ${value}`);
  }
  if (!normalized.startsWith('wiki/') || !normalized.endsWith('.md')) {
    throw new Error(`Invalid file path (expected wiki/*.md): ${value}`);
  }
  return normalized;
}

function reserve(queue, options) {
  const runId = requireOption(options, 'run-id');
  const cand = getCandidate(queue, options);
  const mode = requireOption(options, 'mode');
  const file = normalizeWikiFile(requireOption(options, 'file'));
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid --mode '${mode}' (expected create|update)`);
  }
  if (cand.run_id && cand.run_id !== runId && cand.status === 'in_progress') {
    throw new Error(`Candidate ${cand.candidate_id} already in progress by run ${cand.run_id}`);
  }
  if (TERMINAL.has(cand.status)) {
    throw new Error(`Candidate ${cand.candidate_id} already terminal (${cand.status})`);
  }

  // P0 핵심: create는 파일 부재, update는 파일 존재를 요구 (상호 반대 조건).
  const absoluteFile = path.join(WORKSPACE, file);
  const fileExists = existsSync(absoluteFile);
  if (mode === 'create' && fileExists) {
    throw new Error(`mode=create but file exists, use mode=update instead: ${file}`);
  }
  if (mode === 'update' && !fileExists) {
    throw new Error(`mode=update but file not found, use mode=create instead: ${file}`);
  }

  cand.status = 'in_progress';
  cand.decision = mode;
  cand.target_file = file;
  cand.run_id = runId;
  cand.updated_at = nowIso();
  return { status: 'ok', action: 'reserved', mode, candidate: cand };
}

function complete(queue, options) {
  const runId = requireOption(options, 'run-id');
  const cand = getCandidate(queue, options);
  const status = requireOption(options, 'status'); // created | updated
  if (status !== 'created' && status !== 'updated') {
    throw new Error(`Invalid complete --status '${status}' (expected created|updated)`);
  }
  if (cand.run_id && cand.run_id !== runId) {
    throw new Error(`Candidate ${cand.candidate_id} owned by run ${cand.run_id}, not ${runId}`);
  }
  cand.status = status;
  if (options.commit) cand.commit_hash = options.commit;
  if (options.file) cand.target_file = normalizeWikiFile(options.file);
  cand.updated_at = nowIso();
  queue.history.push({ ...cand, finished_at: nowIso() });
  return { status: 'ok', action: status, candidate: cand };
}

function reject(queue, options, status) {
  const runId = requireOption(options, 'run-id');
  const cand = getCandidate(queue, options);
  if (cand.run_id && cand.run_id !== runId && cand.status === 'in_progress') {
    throw new Error(`Candidate ${cand.candidate_id} owned by run ${cand.run_id}, not ${runId}`);
  }
  cand.status = status; // rejected | skipped
  cand.reason = options.reason || null;
  cand.updated_at = nowIso();
  queue.history.push({ ...cand, finished_at: nowIso() });
  return { status: 'ok', action: status, candidate: cand };
}

function addCandidates(queue, options) {
  const runId = requireOption(options, 'run-id');
  const filePath = path.resolve(WORKSPACE, requireOption(options, 'file'));
  if (!existsSync(filePath)) {
    throw new Error(`Candidate JSON file not found: ${filePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.candidates) ? parsed.candidates : null;
  if (!items) {
    throw new Error('Candidate JSON must be an array (or { candidates: [...] })');
  }

  // 이미 큐에 존재하는 normalized_title(터미널 포함) 집합 — 후보 단위 결정적 중복 차단.
  const terminalTitles = new Set();
  for (const cand of Object.values(queue.candidates)) {
    if (TERMINAL.has(cand.status)) {
      terminalTitles.add(cand.normalized_title);
    }
  }

  const added = [];
  const skippedDuplicate = [];
  for (const item of items) {
    const title = normalizeTitle(item && item.wiki_title);
    if (!title) {
      throw new Error('Each candidate requires a non-empty wiki_title');
    }
    const id = candidateId(title);
    // 중복 차단(수용 기준 8): 동일 candidate_id 존재, 또는 동일 normalized_title이 터미널 상태.
    if (queue.candidates[id] || terminalTitles.has(title)) {
      skippedDuplicate.push({ candidate_id: id, wiki_title: title });
      continue;
    }

    const clusterIds = Array.isArray(item.cluster_ids)
      ? item.cluster_ids
      : splitClusterIds(item.cluster_ids);
    const sourceClusterIds = Array.isArray(item.source_cluster_ids)
      ? item.source_cluster_ids
      : splitClusterIds(item.source_cluster_ids != null ? item.source_cluster_ids : item.cluster_ids);
    const gallIds = Array.isArray(item.supporting_gall_ids)
      ? item.supporting_gall_ids.map((g) => String(g))
      : splitIds(item.supporting_gall_ids);

    queue.candidates[id] = {
      candidate_id: id,
      wiki_title: title,
      normalized_title: title,
      content_to_include: item.content_to_include != null ? String(item.content_to_include) : '',
      cluster_ids: clusterIds,
      cluster_theme: item.cluster_theme != null ? String(item.cluster_theme) : '',
      rationale: item.rationale != null ? String(item.rationale) : '',
      supporting_gall_ids: gallIds,
      priority: item.priority != null ? normalizeTitle(item.priority) : '',
      status: 'pending',
      decision: null,
      target_file: null,
      commit_hash: null,
      reason: null,
      run_id: null,
      // 마이닝 원천 추적 필드(소비 경로는 참조하지 않음 — 관측·감사용).
      source_kind: 'segmentation_cluster',
      source_cluster_ids: sourceClusterIds,
      mined_from: item.mined_from != null ? String(item.mined_from) : null,
      mining_run_id: runId,
      mining_reason: item.mining_reason != null ? String(item.mining_reason) : null,
      dedupe_key: item.dedupe_key != null ? String(item.dedupe_key) : title,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    added.push(id);
    terminalTitles.add(title); // 같은 배치 내 중복도 차단.
  }

  return {
    status: 'ok',
    action: 'add-candidates',
    added: added.length,
    skipped_duplicate: skippedDuplicate.length,
    candidates: added,
    skipped: skippedDuplicate,
    counts: countByStatus(queue),
  };
}

function reclaimStale(queue, options) {
  const activeRunIds = splitRunIds(options['active-run-ids'] || '');
  const ttlMs = parsePositiveInt(options['ttl-ms'], IN_PROGRESS_TTL_MS);
  const cutoff = optionNow(options) - ttlMs;
  const reclaimed = [];
  const abandoned = [];

  for (const cand of Object.values(queue.candidates)) {
    if (cand.status !== 'in_progress') continue;
    if (cand.run_id && activeRunIds.has(cand.run_id)) continue;

    const updated = Date.parse(cand.updated_at || cand.created_at || 0);
    if (!Number.isNaN(updated) && updated > cutoff) continue;

    const prior = { ...cand };
    const reason = `stale in_progress reclaimed from run ${cand.run_id || '(none)'}`;

    if (!cand.target_file && !cand.decision) {
      cand.status = 'pending';
      cand.run_id = null;
      cand.reason = reason;
      cand.updated_at = nowIso();
      reclaimed.push({ candidate_id: cand.candidate_id, previous_run_id: prior.run_id });
      queue.history.push({ ...prior, status: 'stale_reclaimed', reason, finished_at: nowIso() });
    } else {
      cand.status = 'abandoned';
      cand.reason = reason;
      cand.updated_at = nowIso();
      abandoned.push({
        candidate_id: cand.candidate_id,
        previous_run_id: prior.run_id,
        target_file: cand.target_file || null,
      });
      queue.history.push({ ...cand, finished_at: nowIso() });
    }
  }

  return {
    status: 'ok',
    action: 'reclaim-stale',
    ttl_ms: ttlMs,
    active_run_ids: [...activeRunIds],
    reclaimed,
    abandoned,
    counts: countByStatus(queue),
  };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  let fd = null;
  try {
    fd = acquireLock();
    const queue = loadQueue();

    let result;
    let mutated = true;
    switch (command) {
      case 'normalize':
        result = normalize(queue, options);
        break;
      case 'list':
        result = list(queue, options);
        mutated = false;
        break;
      case 'next':
        result = next(queue, options);
        break;
      case 'reserve':
        result = reserve(queue, options);
        break;
      case 'complete':
        result = complete(queue, options);
        break;
      case 'reject':
        result = reject(queue, options, 'rejected');
        break;
      case 'skip':
        result = reject(queue, options, 'skipped');
        break;
      case 'reclaim-stale':
        result = reclaimStale(queue, options);
        break;
      case 'add-candidates':
        result = addCandidates(queue, options);
        break;
      default:
        throw new Error(
          'Usage: p6_demand_queue.mjs normalize|list|next|reserve|complete|reject|skip|reclaim-stale|add-candidates ...',
        );
    }

    if (mutated) {
      saveQueue(queue);
    }
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
