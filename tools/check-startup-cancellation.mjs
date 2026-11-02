// SPDX-License-Identifier: MIT
// Exercise the installed package through its public API, including real workers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const [consumerArg, outputArg] = process.argv.slice(2);
assert(consumerArg && outputArg, 'Use check-startup-cancellation.mjs CONSUMER OUTPUT');
const output = resolve(outputArg);
mkdirSync(output, { recursive: true });
const require = createRequire(join(resolve(consumerArg), 'package.json'));
const { createRenderQueue, FullbleedError, version, engineVersion } = require('fullbleed');
const input = { html: '<h1>Recovered invoice</h1><p>Services: USD 1,200.00</p>', previewDpi: 96 };
const longInput = { html: '<div>Long document</div>'.repeat(1000), css: 'div {break-after:page}', previewDpi: 96 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const code = expected => error => error instanceof FullbleedError && error.code === expected;
const active = new Set();
let created = 0, peak = 0, online, phase = 'warmup', cycle = -1;
const cycles = [];
const observe = worker => {
  created++;
  active.add(worker);
  peak = Math.max(peak, active.size);
  worker.once('exit', () => active.delete(worker));
  if (online) {
    const resolveOnline = online;
    online = undefined;
    worker.once('online', resolveOnline);
  }
};
process.on('worker', observe);
const record = (ok, extra = {}) => {
  const result = { ok, packageVersion: version, engineVersion, node: process.version,
    platform: process.platform, cycle, phase, cycles, workersCreated: created,
    peakWorkers: peak, remainingWorkers: active.size, ...extra };
  writeFileSync(join(output, 'startup-cancellation.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
};
// A leaked worker must fail this verifier rather than leave the CI child alive.
async function bounded(promise, label) {
  phase = label;
  const timer = setTimeout(() => {
    record(false, { error: `${label} remained pending for 10 seconds` });
    console.error(`Startup cancellation stalled at cycle ${cycle}: ${label}`);
    process.exit(1);
  }, 10000);
  try { return await promise; } finally { clearTimeout(timer); }
}
const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
try {
  const baseline = await bounded(queue.renderPdf(input), 'warmup');
  const expected = { pdf: hash(baseline.pdf), png: hash(baseline.previews[0]) };
  for (cycle = 0; cycle < 64; cycle++) {
    const startedAt = performance.now();
    const started = new Promise(resolve => { online = resolve; });
    const before = created;
    const controller = new AbortController();
    const cancelled = assert.rejects(queue.renderPdf({ ...longInput, signal: controller.signal }), code('ABORTED'));
    await bounded(started, 'worker online');
    // Sweep the startup window, including cancellation after execution begins.
    const waitingTimeoutMs = [8, 16, 20, 24, 32, 48, 64, 96][cycle % 8];
    await bounded(assert.rejects(queue.renderPdf({ ...input, timeoutMs: waitingTimeoutMs }), code('TIMEOUT')), 'queued deadline');
    assert.equal(queue.pendingCount, 0);
    assert.equal(created, before + 1, 'The expired queued job must not create a worker.');
    controller.abort();
    await bounded(cancelled, 'aborted worker exit');
    assert.equal(active.size, 0, 'Cancellation must await the actual worker exit.');
    assert.equal(queue.activeCount, 0);
    const recovered = await bounded(queue.renderPdf(input), 'recovery render');
    assert.equal(recovered.pages, 1);
    assert.equal(recovered.missingGlyphs, 0);
    assert.equal(recovered.previews.length, 1);
    assert.deepEqual({ pdf: hash(recovered.pdf), png: hash(recovered.previews[0]) }, expected);
    assert.equal(active.size, 0);
    assert.equal(created, before + 2);
    cycles.push({ cycle, waitingTimeoutMs, milliseconds: Math.round(performance.now() - startedAt), outputMatchesBaseline: true, remainingWorkers: active.size });
  }
  await bounded(queue.close(), 'queue close');
  assert.equal(peak, 1);
  assert.equal(created, 129);
  writeFileSync(join(output, 'startup-recovery.pdf'), baseline.pdf);
  writeFileSync(join(output, 'startup-recovery.png'), baseline.previews[0]);
  phase = 'complete';
  record(true, { expected, settledQueueActiveCount: queue.activeCount, settledQueuePendingCount: queue.pendingCount });
  console.log(JSON.stringify({ ok: true, cycles: cycles.length, workersCreated: created, peakWorkers: peak, remainingWorkers: active.size, ...expected }));
} catch (error) {
  record(false, { error: error.stack });
  console.error(error);
  process.exit(1);
} finally {
  process.off('worker', observe);
}
