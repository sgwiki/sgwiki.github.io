import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const SCRIPT = path.resolve('scripts/wiki_work_registry.mjs');

async function runRegistry(args, workspace) {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, WORKSPACE: workspace },
  });
  return JSON.parse(stdout);
}

test('reconcile releases stale reservations outside the active run set', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'work-registry-'));
  const adminDir = path.join(workspace, '.admin');
  await mkdir(adminDir, { recursive: true });

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const old = new Date(nowDate.getTime() - 40 * 60 * 1000).toISOString();
  const fresh = new Date(nowDate.getTime() - 10 * 60 * 1000).toISOString();
  const registryPath = path.join(adminDir, 'p1-work-registry.json');
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        active: {
          'wiki/old.md': {
            run_id: 'dead-run',
            topic: 'old',
            file: 'wiki/old.md',
            status: 'reserved',
            started_at: old,
            updated_at: old,
          },
          'wiki/live.md': {
            run_id: 'live-run',
            topic: 'live',
            file: 'wiki/live.md',
            status: 'reserved',
            started_at: old,
            updated_at: old,
          },
          'wiki/fresh.md': {
            run_id: 'dead-run',
            topic: 'fresh',
            file: 'wiki/fresh.md',
            status: 'reserved',
            started_at: fresh,
            updated_at: fresh,
          },
        },
        history: [],
      },
      null,
      2,
    ),
  );

  const result = await runRegistry(
    ['reconcile', '--active-run-ids', 'live-run', '--ttl-ms', '1800000', '--now', now],
    workspace,
  );
  const saved = JSON.parse(await readFile(registryPath, 'utf8'));

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.released, [{ file: 'wiki/old.md', previous_run_id: 'dead-run' }]);
  assert.equal(saved.active['wiki/old.md'], undefined);
  assert.equal(saved.active['wiki/live.md'].run_id, 'live-run');
  assert.equal(saved.active['wiki/fresh.md'].run_id, 'dead-run');
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].status, 'stale_released');
});
