import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const SCRIPT = path.resolve('scripts/p6_demand_queue.mjs');

async function runQueue(args, workspace) {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, WORKSPACE: workspace },
  });
  return JSON.parse(stdout);
}

test('reclaim-stale returns unreserved stale candidates to pending and abandons reserved candidates', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'p6-queue-'));
  const adminDir = path.join(workspace, '.admin');
  await mkdir(adminDir, { recursive: true });

  const now = '2026-01-01T01:00:00.000Z';
  const old = '2026-01-01T00:00:00.000Z';
  const fresh = '2026-01-01T00:50:00.000Z';
  const queuePath = path.join(adminDir, 'p6-demand-queue.json');
  await writeFile(
    queuePath,
    JSON.stringify(
      {
        candidates: {
          free: {
            candidate_id: 'free',
            wiki_title: 'free',
            status: 'in_progress',
            run_id: 'dead-run',
            decision: null,
            target_file: null,
            created_at: old,
            updated_at: old,
          },
          reserved: {
            candidate_id: 'reserved',
            wiki_title: 'reserved',
            status: 'in_progress',
            run_id: 'dead-run',
            decision: 'create',
            target_file: 'wiki/reserved.md',
            created_at: old,
            updated_at: old,
          },
          active: {
            candidate_id: 'active',
            wiki_title: 'active',
            status: 'in_progress',
            run_id: 'live-run',
            decision: null,
            target_file: null,
            created_at: old,
            updated_at: old,
          },
          fresh: {
            candidate_id: 'fresh',
            wiki_title: 'fresh',
            status: 'in_progress',
            run_id: 'dead-run',
            decision: null,
            target_file: null,
            created_at: fresh,
            updated_at: fresh,
          },
        },
        history: [],
      },
      null,
      2,
    ),
  );

  const result = await runQueue(
    ['reclaim-stale', '--active-run-ids', 'live-run', '--ttl-ms', '1800000', '--now', now],
    workspace,
  );
  const saved = JSON.parse(await readFile(queuePath, 'utf8'));

  assert.equal(result.status, 'ok');
  assert.equal(saved.candidates.free.status, 'pending');
  assert.equal(saved.candidates.free.run_id, null);
  assert.equal(saved.candidates.reserved.status, 'abandoned');
  assert.equal(saved.candidates.active.status, 'in_progress');
  assert.equal(saved.candidates.fresh.status, 'in_progress');
  assert.equal(saved.history.filter((item) => item.status === 'stale_reclaimed').length, 1);
  assert.equal(saved.history.filter((item) => item.status === 'abandoned').length, 1);
});
