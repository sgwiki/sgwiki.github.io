#!/usr/bin/env node

// p6_cluster_miner.mjs + p6_demand_queue.mjs add-candidates 통합 테스트.
// 격리된 임시 WORKSPACE와 픽스처 CSV로 스크립트를 실제 실행해 JSON 출력을 검증한다.
// 실행: node scripts/test_p6_cluster_miner.mjs  (실패 시 exit 1)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MINER = path.join(SCRIPT_DIR, 'p6_cluster_miner.mjs');
const QUEUE = path.join(SCRIPT_DIR, 'p6_demand_queue.mjs');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function run(script, args, workspace) {
  const out = execFileSync('node', [script, ...args], {
    env: { ...process.env, WORKSPACE: workspace },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function setupWorkspace() {
  const ws = mkdtempSync(path.join(tmpdir(), 'p6-mine-'));
  const segDir = path.join(ws, 'data/dc_gallery/segmentation');
  mkdirSync(segDir, { recursive: true });
  // theme 열에 쉼표+인용 필드 포함 → parseCsv(인용 처리) 검증.
  const csv = [
    'cluster_id,post_count,total_score,avg_score,top_keywords,theme,agent',
    '2,916,573934.0,626.57,"만화, 슈타게, 크리스","굿즈, 피규어 중심 인기 클러스터",1',
    '59,361,173778.0,481.38,"슈타게, 스포, 제로","스포·후기 클러스터",1',
    '7,120,50000.0,416.6,"타임머신, 이론","타임머신 이론 토론",1',
  ].join('\n');
  writeFileSync(path.join(segDir, 'all_clusters_summary.csv'), csv, 'utf8');
  return ws;
}

console.log('p6_cluster_miner tests:');

// (a) normalize → 3 클러스터, counts.unmined=3
const ws1 = setupWorkspace();
try {
  const norm = run(MINER, ['normalize'], ws1);
  check('normalize maps CSV rows to unmined clusters', () => {
    assert.equal(norm.action, 'normalized');
    assert.equal(norm.total, 3);
    assert.equal(norm.counts.unmined, 3);
  });

  // (b) next → total_score 최대(cluster 2) 선점, 재호출 시 다음(59)
  check('next picks max total_score cluster, then the next', () => {
    const first = run(MINER, ['next', '--run-id', 'R1'], ws1);
    assert.equal(first.cluster.cluster_id, '2');
    assert.equal(first.cluster.status, 'in_progress');
    assert.equal(first.cluster.run_id, 'R1');
    const second = run(MINER, ['next', '--run-id', 'R1'], ws1);
    assert.equal(second.cluster.cluster_id, '59');
  });

  // (d) complete → mined terminal + generated_candidate_ids
  check('complete transitions cluster to mined terminal', () => {
    const done = run(MINER, ['complete', '--cluster-id', '2', '--run-id', 'R1', '--candidate-ids', 'a,b'], ws1);
    assert.equal(done.cluster.status, 'mined');
    assert.deepEqual(done.cluster.generated_candidate_ids, ['a', 'b']);
  });

  // (c) unmined 소진 → null 계약 (남은 7을 소비한 뒤 next는 null)
  check('next returns null contract when no unmined clusters', () => {
    run(MINER, ['next', '--run-id', 'R1'], ws1); // consume cluster 7
    const empty = run(MINER, ['next', '--run-id', 'R1'], ws1);
    assert.equal(empty.cluster, null);
    assert.equal(empty.note, 'no unmined clusters');
  });
} finally {
  rmSync(ws1, { recursive: true, force: true });
}

// (e) reclaim-stale → 죽은 run의 in_progress 회수
const ws2 = setupWorkspace();
try {
  run(MINER, ['normalize'], ws2);
  run(MINER, ['next', '--run-id', 'DEAD'], ws2); // cluster 2 in_progress by DEAD run
  check('reclaim-stale returns dead-run in_progress to unmined', () => {
    const reclaimed = run(
      MINER,
      ['reclaim-stale', '--active-run-ids', 'OTHER', '--ttl-ms', '0', '--now', '2999-01-01T00:00:00Z'],
      ws2,
    );
    assert.equal(reclaimed.reclaimed.length, 1);
    assert.equal(reclaimed.reclaimed[0].cluster_id, '2');
    assert.equal(reclaimed.counts.unmined, 3);
  });
} finally {
  rmSync(ws2, { recursive: true, force: true });
}

console.log('p6_demand_queue add-candidates tests:');

// add-candidates: 신규 후보 추가 / 중복 skip / 6필드 / next 선점
const ws3 = setupWorkspace();
try {
  const candFile = path.join(ws3, 'cands.json');
  writeFileSync(
    candFile,
    JSON.stringify([
      {
        wiki_title: '타임머신 이론 정리',
        content_to_include: '커뮤니티에서 반복된 타임머신 원리 질문 정리',
        cluster_ids: [7],
        cluster_theme: '타임머신 이론 토론',
        rationale: '반복 질문 다수',
        supporting_gall_ids: ['g1', 'g2'],
        priority: 'high',
        source_cluster_ids: [7],
        mined_from: 'data/dc_gallery/segmentation/cluster_7',
        mining_reason: 'total_score priority',
        dedupe_key: '타임머신 이론 정리',
      },
    ]),
    'utf8',
  );

  check('add-candidates injects one pending candidate with mining fields', () => {
    const res = run(QUEUE, ['add-candidates', '--file', candFile, '--run-id', 'R9'], ws3);
    assert.equal(res.added, 1);
    assert.equal(res.skipped_duplicate, 0);
    // (h) 신규 6필드 확인
    const list = run(QUEUE, ['list'], ws3);
    const cand = list.candidates.find((c) => c.wiki_title === '타임머신 이론 정리');
    assert.ok(cand, 'candidate present');
    assert.equal(cand.status, 'pending');
    assert.equal(cand.source_kind, 'segmentation_cluster');
    assert.deepEqual(cand.source_cluster_ids, [7]);
    assert.equal(cand.mined_from, 'data/dc_gallery/segmentation/cluster_7');
    assert.equal(cand.mining_run_id, 'R9');
    assert.equal(cand.mining_reason, 'total_score priority');
    assert.equal(cand.dedupe_key, '타임머신 이론 정리');
    // 기존 스키마 필드 유지
    assert.deepEqual(cand.cluster_ids, [7]);
    assert.deepEqual(cand.supporting_gall_ids, ['g1', 'g2']);
    assert.equal(cand.priority, 'high');
  });

  // (g) 중복 title skip
  check('add-candidates skips duplicate title', () => {
    const res = run(QUEUE, ['add-candidates', '--file', candFile, '--run-id', 'R9'], ws3);
    assert.equal(res.added, 0);
    assert.equal(res.skipped_duplicate, 1);
  });

  // (i) 추가 후보를 next가 선점
  check('next reserves the added candidate', () => {
    const picked = run(QUEUE, ['next', '--run-id', 'R9'], ws3);
    assert.equal(picked.candidate.wiki_title, '타임머신 이론 정리');
    assert.equal(picked.candidate.status, 'in_progress');
  });
} finally {
  rmSync(ws3, { recursive: true, force: true });
}

console.log(`\nAll ${passed} checks passed.`);
