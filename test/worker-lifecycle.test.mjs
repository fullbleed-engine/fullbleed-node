// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderPdf, FullbleedError } from 'fullbleed';

const input = { html: '<h1>Worker lifecycle fixture</h1><p>INV-1042</p>' };
const longInput = { html: '<div>Long document</div>'.repeat(1000), css: 'div {break-after:page}', previewDpi: 96 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectCode = code => error => error instanceof FullbleedError && error.code === code;

function observeWorkers(t, onCreate = () => {}) {
  const active = new Set();
  const created = [];
  let peak = 0;
  const observe = worker => {
    created.push(worker);
    active.add(worker);
    peak = Math.max(peak, active.size);
    worker.once('exit', () => active.delete(worker));
    onCreate(worker);
  };
  process.on('worker', observe);
  t.after(async () => {
    process.off('worker', observe);
    await Promise.all([...active].map(worker => worker.terminate()));
  });
  return {
    get peak() { return peak; },
    stopped(expectedCount) {
      assert.equal(created.length, expectedCount, 'The check must exercise actual workers.');
      assert.equal(active.size, 0, 'A settled render must not leave its worker shutting down.');
      assert(created.every(worker => worker.threadId === -1), 'Every observed worker has exited.');
    },
  };
}

test('awaited successful jobs do not overlap worker lifetimes', async t => {
  const workers = observeWorkers(t);
  const hashes = [];
  for (let i = 1; i <= 3; i++) {
    hashes.push(hash((await renderPdf(input)).pdf));
    workers.stopped(i);
  }
  assert.equal(workers.peak, 1);
  assert.equal(new Set(hashes).size, 1);
});

test('a render rejection releases the worker before recovery', async t => {
  const workers = observeWorkers(t);
  await assert.rejects(renderPdf({ html: '<p>Missing: ⨌</p>' }), expectCode('MISSING_GLYPHS'));
  workers.stopped(1);
  assert.equal((await renderPdf(input)).pages, 1);
  workers.stopped(2);
});

test('aborting an active worker waits for its exit', async t => {
  const controller = new AbortController();
  const workers = observeWorkers(t, worker => worker.once('online', () => controller.abort()));
  await assert.rejects(renderPdf({ ...longInput, signal: controller.signal }), expectCode('ABORTED'));
  workers.stopped(1);
});

test('abort during worker construction also releases the newly created worker', async t => {
  const controller = new AbortController();
  const workers = observeWorkers(t, () => controller.abort());
  await assert.rejects(renderPdf({ ...longInput, signal: controller.signal }), expectCode('ABORTED'));
  workers.stopped(1);
});

test('an active deadline failure waits for worker exit', async t => {
  // The preceding tests have warmed the module cache; this cannot pass by
  // timing out before worker creation, which the observer independently checks.
  const workers = observeWorkers(t);
  await assert.rejects(renderPdf({ ...longInput, timeoutMs: 200 }), expectCode('TIMEOUT'));
  workers.stopped(1);
});

test('unexpected worker exit rejects without retaining a worker', async t => {
  const workers = observeWorkers(t, worker => worker.once('online', () => { void worker.terminate(); }));
  await assert.rejects(renderPdf(longInput), expectCode('WORKER_FAILED'));
  workers.stopped(1);
});

test('concurrent calls remain independent and each releases its own worker', async t => {
  const controller = new AbortController();
  let count = 0;
  const workers = observeWorkers(t, worker => {
    if (++count === 1) worker.once('online', () => controller.abort());
  });
  const outcomes = await Promise.allSettled([
    renderPdf({ ...longInput, signal: controller.signal }),
    renderPdf({ html: '<h1>Unaffected invoice A</h1>' }),
    renderPdf({ html: '<h1>Unaffected invoice B</h1>' }),
  ]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(outcomes[0].reason.code, 'ABORTED');
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[2].status, 'fulfilled');
  assert.notEqual(hash(outcomes[1].value.pdf), hash(outcomes[2].value.pdf));
  workers.stopped(3);
  assert(workers.peak >= 2, 'The API still permits separate callers to render concurrently.');
});
