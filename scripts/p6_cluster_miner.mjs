#!/usr/bin/env node

// 파이프라인 6 — 클러스터 원천 기반 소재 발굴(cluster mining) 상태 큐.
//
// p6_demand_queue.mjs(후보 소비 큐)와 별개로, DCinside 세그먼테이션 클러스터
// 원천(all_clusters_summary.csv)의 "마이닝 진척"을 별도 상태 파일로 추적한다.
// pending 후보가 없을 때만 진입하는 fallback: 미마이닝 클러스터 1개를 선점 →
// wiki-demand-miner가 후보 JSON을 생성 → p6_demand_queue add-candidates로 병합.
//
// - normalize: all_clusters_summary.csv → 각 cluster_id를 status:"unmined"로 상태화
// - next: unmined 중 total_score 내림차순 1개를 in_progress로 선점
// - complete/skip/reject: 터미널 상태 기록(mined/skipped/rejected)
// - reclaim-stale: 죽은 run이 점유한 in_progress 클러스터를 unmined로 회수
// - list: 진단용 비변이 조회
//
// 출력은 항상 JSON 한 덩어리(stdout). 실패 시 stderr + exit 1.
// 상태·락 파일은 .admin/ 아래(커밋 금지 런타임 산출물).

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
import path from 'node:path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const ADMIN_DIR = path.join(WORKSPACE, '.admin');
const STATE_PATH = path.join(ADMIN_DIR, 'p6-cluster-mining-state.json');
const LOCK_PATH = path.join(ADMIN_DIR, 'p6-cluster-mining-state.lock');
const DEFAULT_CSV = path.join(
  WORKSPACE,
  'data/dc_gallery/segmentation/all_clusters_summary.csv',
);
const LOCK_TTL_MS = 2 * 60 * 1000;
const IN_PROGRESS_TTL_MS = 30 * 60 * 1000;

const TERMINAL = new Set(['mined', 'skipped', 'rejected']);

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

// ── 락 (p6_demand_queue.mjs와 동일 패턴) ───────────────────────────────────
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
  throw new Error(`Timed out acquiring mining-state lock: ${LOCK_PATH}`);
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

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { clusters: {}, history: [], normalized_at: null, source_csv: null };
  }
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  state.clusters ||= {};
  state.history ||= [];
  return state;
}

function saveState(state) {
  mkdirSync(ADMIN_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ── CSV 파서 (RFC4180 최소 구현, BOM 제거) ────────────────────────────────
// p6_demand_queue.mjs의 parseCsv를 복제(최소 침습: 소비 큐 정규화 회귀 위험 배제).
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

function trimField(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function optionNow(options) {
  if (!options.now) return Date.now();
  const parsed = Date.parse(options.now);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid --now timestamp: ${options.now}`);
  }
  return parsed;
}

function countByStatus(state) {
  const counts = {};
  for (const cluster of Object.values(state.clusters)) {
    counts[cluster.status] = (counts[cluster.status] || 0) + 1;
  }
  return counts;
}

// ── 명령 ─────────────────────────────────────────────────────────────────
function normalize(state, options) {
  const csvPath = options.csv ? path.resolve(WORKSPACE, options.csv) : DEFAULT_CSV;
  if (!existsSync(csvPath)) {
    throw new Error(`Cluster summary CSV not found: ${csvPath}`);
  }
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) {
    throw new Error(`Cluster summary CSV has no data rows: ${csvPath}`);
  }
  const header = rows[0].map((h) => trimField(h).replace(/^﻿/, ''));
  const col = (name) => header.indexOf(name);
  const idxCluster = col('cluster_id');
  const idxPost = col('post_count');
  const idxTotal = col('total_score');
  const idxAvg = col('avg_score');
  const idxTheme = col('theme');
  if (idxCluster < 0) {
    throw new Error(`CSV missing required column 'cluster_id' (header: ${header.join('|')})`);
  }

  let added = 0;
  let merged = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const clusterId = trimField(cells[idxCluster]);
    if (!clusterId) continue;

    const existing = state.clusters[clusterId];
    if (existing) {
      // 병합: 원천 요약 수치는 갱신하되 마이닝 상태(status/run_id/생성후보)는 유지.
      existing.post_count = idxPost >= 0 ? parsePositiveInt(cells[idxPost], existing.post_count) : existing.post_count;
      existing.total_score = idxTotal >= 0 ? parseNumber(cells[idxTotal], existing.total_score) : existing.total_score;
      existing.avg_score = idxAvg >= 0 ? parseNumber(cells[idxAvg], existing.avg_score) : existing.avg_score;
      existing.theme = idxTheme >= 0 ? trimField(cells[idxTheme]) : existing.theme;
      existing.updated_at = nowIso();
      merged += 1;
      continue;
    }

    state.clusters[clusterId] = {
      cluster_id: clusterId,
      post_count: idxPost >= 0 ? parsePositiveInt(cells[idxPost], 0) : 0,
      total_score: idxTotal >= 0 ? parseNumber(cells[idxTotal], 0) : 0,
      avg_score: idxAvg >= 0 ? parseNumber(cells[idxAvg], 0) : 0,
      theme: idxTheme >= 0 ? trimField(cells[idxTheme]) : '',
      status: 'unmined',
      run_id: null,
      generated_candidate_ids: [],
      reason: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    added += 1;
  }

  state.normalized_at = nowIso();
  state.source_csv = path.relative(WORKSPACE, csvPath);
  return {
    status: 'ok',
    action: 'normalized',
    added,
    merged,
    total: Object.keys(state.clusters).length,
    counts: countByStatus(state),
  };
}

function next(state, options) {
  const runId = requireOption(options, 'run-id');
  const unmined = Object.values(state.clusters).filter((c) => c.status === 'unmined');
  unmined.sort((a, b) => {
    const diff = (b.total_score || 0) - (a.total_score || 0);
    if (diff !== 0) return diff;
    // 동점 시 결정적 tie-break: cluster_id 숫자 오름차순.
    return Number(a.cluster_id) - Number(b.cluster_id);
  });
  const picked = unmined[0];
  if (!picked) {
    return { status: 'ok', action: 'next', cluster: null, note: 'no unmined clusters' };
  }
  picked.status = 'in_progress';
  picked.run_id = runId;
  picked.updated_at = nowIso();
  return { status: 'ok', action: 'next', cluster: picked };
}

function getCluster(state, options) {
  const id = requireOption(options, 'cluster-id');
  const cluster = state.clusters[id];
  if (!cluster) {
    throw new Error(`Unknown cluster-id: ${id}`);
  }
  return cluster;
}

function complete(state, options) {
  const runId = requireOption(options, 'run-id');
  const cluster = getCluster(state, options);
  if (cluster.run_id && cluster.run_id !== runId) {
    throw new Error(`Cluster ${cluster.cluster_id} owned by run ${cluster.run_id}, not ${runId}`);
  }
  cluster.status = 'mined';
  cluster.generated_candidate_ids = splitIds(options['candidate-ids']);
  cluster.updated_at = nowIso();
  state.history.push({ ...cluster, finished_at: nowIso() });
  return { status: 'ok', action: 'mined', cluster };
}

function terminate(state, options, status) {
  const runId = requireOption(options, 'run-id');
  const cluster = getCluster(state, options);
  if (cluster.run_id && cluster.run_id !== runId && cluster.status === 'in_progress') {
    throw new Error(`Cluster ${cluster.cluster_id} owned by run ${cluster.run_id}, not ${runId}`);
  }
  cluster.status = status; // skipped | rejected
  cluster.reason = options.reason || null;
  cluster.updated_at = nowIso();
  state.history.push({ ...cluster, finished_at: nowIso() });
  return { status: 'ok', action: status, cluster };
}

function reclaimStale(state, options) {
  const activeRunIds = splitRunIds(options['active-run-ids'] || '');
  const ttlMs = parsePositiveInt(options['ttl-ms'], IN_PROGRESS_TTL_MS);
  const cutoff = optionNow(options) - ttlMs;
  const reclaimed = [];

  for (const cluster of Object.values(state.clusters)) {
    if (cluster.status !== 'in_progress') continue;
    if (cluster.run_id && activeRunIds.has(cluster.run_id)) continue;

    const updated = Date.parse(cluster.updated_at || cluster.created_at || 0);
    if (!Number.isNaN(updated) && updated > cutoff) continue;

    const prior = { ...cluster };
    const reason = `stale in_progress reclaimed from run ${cluster.run_id || '(none)'}`;
    // 마이닝의 부작용은 큐 add로만 남으므로 항상 unmined로 회수(abandoned 분기 불필요).
    cluster.status = 'unmined';
    cluster.run_id = null;
    cluster.reason = reason;
    cluster.updated_at = nowIso();
    reclaimed.push({ cluster_id: cluster.cluster_id, previous_run_id: prior.run_id });
    state.history.push({ ...prior, status: 'stale_reclaimed', reason, finished_at: nowIso() });
  }

  return {
    status: 'ok',
    action: 'reclaim-stale',
    ttl_ms: ttlMs,
    active_run_ids: [...activeRunIds],
    reclaimed,
    counts: countByStatus(state),
  };
}

function list(state, options) {
  let items = Object.values(state.clusters);
  if (options.status) {
    items = items.filter((c) => c.status === options.status);
  }
  items.sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
  const limit = options.limit ? Number.parseInt(options.limit, 10) : items.length;
  return {
    status: 'ok',
    action: 'list',
    counts: countByStatus(state),
    total: items.length,
    clusters: items.slice(0, Number.isFinite(limit) ? limit : items.length),
  };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  let fd = null;
  try {
    fd = acquireLock();
    const state = loadState();

    let result;
    let mutated = true;
    switch (command) {
      case 'normalize':
        result = normalize(state, options);
        break;
      case 'next':
        result = next(state, options);
        break;
      case 'complete':
        result = complete(state, options);
        break;
      case 'skip':
        result = terminate(state, options, 'skipped');
        break;
      case 'reject':
        result = terminate(state, options, 'rejected');
        break;
      case 'reclaim-stale':
        result = reclaimStale(state, options);
        break;
      case 'list':
        result = list(state, options);
        mutated = false;
        break;
      default:
        throw new Error(
          'Usage: p6_cluster_miner.mjs normalize|next|complete|skip|reject|reclaim-stale|list ...',
        );
    }

    if (mutated) {
      saveState(state);
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
