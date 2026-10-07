// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRenderQueue, renderPdf, FullbleedError, version, engineVersion } from 'fullbleed';

const input = { html: '<h1>Invoice BURST-1042</h1><p>Design services: USD 1,200.00</p>', previewDpi: 96 };
const longInput = { html: '<div>Long document</div>'.repeat(1000), css: 'div {break-after:page}', previewDpi: 96 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const code = expected => error => error instanceof FullbleedError && error.code === expected;

function workers(t, onCreate = () => {}) {
  const active = new Set();
  let count = 0, peak = 0;
  const observe = worker => {
    count++;
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
  return { get active() { return active.size; }, get count() { return count; }, get peak() { return peak; } };
}

test('six queued PDFs retain their bytes while using at most two actual workers', async t => {
  const baseline = await renderPdf(input);
  const observed = workers(t);
  const queue = createRenderQueue({ concurrency: 2, maxQueue: 4 });
  t.after(() => queue.close());
  const jobs = Array.from({ length: 6 }, () => queue.renderPdf(input));
  assert.equal(queue.activeCount, 2);
  assert.equal(queue.pendingCount, 4);
  const results = await Promise.all(jobs);
  assert.equal(observed.count, 6);
  assert.equal(observed.peak, 2);
  assert.equal(observed.active, 0);
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.pendingCount, 0);
  for (const result of results) {
    assert.equal(hash(result.pdf), hash(baseline.pdf));
    assert.equal(hash(result.previews[0]), hash(baseline.previews[0]));
    assert.equal(result.pages, 1);
  }
  if (process.env.FULLBLEED_QUEUE_EVIDENCE) {
    const out = process.env.FULLBLEED_QUEUE_EVIDENCE;
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'queued.pdf'), results[0].pdf);
    await writeFile(join(out, 'queued.png'), results[0].previews[0]);
    await writeFile(join(out, 'burst.json'), JSON.stringify({
      ok: true, packageVersion: version, engineVersion, node: process.version, platform: process.platform,
      submitted: 6, concurrency: 2, maxQueue: 4, workersCreated: observed.count,
      peakWorkers: observed.peak, remainingWorkers: observed.active,
      pdfSha256: hash(results[0].pdf), pngSha256: hash(results[0].previews[0]),
      matchesStandalone: true,
    }, null, 2) + '\n');
  }
});

test('a full queue rejects excess work and reuses slots after accepted jobs finish', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  const observed = workers(t);
  const order = [];
  const first = queue.renderPdf({ html: 'First invoice' }).then(result => { order.push('first'); return result; });
  const second = queue.renderPdf({ html: 'Second invoice' }).then(result => { order.push('second'); return result; });
  await assert.rejects(queue.renderPdf({ html: 'Excess invoice' }), code('QUEUE_FULL'));
  const [a, b] = await Promise.all([first, second]);
  assert.notEqual(hash(a.pdf), hash(b.pdf));
  assert.deepEqual(order, ['first', 'second']);
  assert.equal((await queue.renderPdf(input)).pages, 1);
  assert.equal(observed.count, 3);
  assert.equal(observed.peak, 1);
  assert.equal(observed.active, 0);
});

test('maxQueue zero accepts available slots and rejects buffering', async t => {
  const queue = createRenderQueue({ maxQueue: 0 });
  t.after(() => queue.close());
  const first = queue.renderPdf(input);
  await assert.rejects(queue.renderPdf(input), code('QUEUE_FULL'));
  await first;
  assert.equal((await queue.renderPdf(input)).pages, 1);
});

test('aborting a waiting request frees its slot without starting a worker', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  const observed = workers(t);
  const controller = new AbortController();
  const first = queue.renderPdf(input);
  const rejected = assert.rejects(queue.renderPdf({ ...input, signal: controller.signal }), code('ABORTED'));
  controller.abort();
  assert.equal(queue.pendingCount, 0);
  const replacement = queue.renderPdf(input);
  await Promise.all([first, rejected, replacement]);
  assert.equal(observed.count, 2);
  assert.equal(observed.peak, 1);
});

test('a deadline includes time spent waiting and a timed-out request starts no worker', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  let online;
  const started = new Promise(resolve => { online = resolve; });
  const observed = workers(t, worker => worker.once('online', online));
  const controller = new AbortController();
  const first = assert.rejects(queue.renderPdf({ ...longInput, signal: controller.signal }), code('ABORTED'));
  await started;
  await assert.rejects(queue.renderPdf({ ...input, timeoutMs: 20 }), code('TIMEOUT'));
  assert.equal(queue.pendingCount, 0);
  assert.equal(observed.count, 1);
  controller.abort();
  await first;
  assert.equal(observed.active, 0);
  assert.equal((await queue.renderPdf(input)).pages, 1);
});

test('aborting an active render releases its worker before the next starts', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  const controller = new AbortController();
  let count = 0;
  const observed = workers(t, worker => {
    if (++count === 1) worker.once('online', () => controller.abort());
  });
  const first = assert.rejects(queue.renderPdf({ ...longInput, signal: controller.signal }), code('ABORTED'));
  const second = queue.renderPdf(input);
  await first;
  assert.equal((await second).pages, 1);
  assert.equal(observed.peak, 1);
  assert.equal(observed.active, 0);
});

test('starting a waiting job does not reset its original deadline', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  const observed = workers(t, worker => worker.once('online', () => { now += 2000; }));
  const first = queue.renderPdf({ html: 'First invoice', timeoutMs: 1000 });
  const expired = assert.rejects(queue.renderPdf({ html: 'Expired while waiting', timeoutMs: 1000 }), code('TIMEOUT'));
  await Promise.all([first, expired]);
  assert.equal(observed.count, 1, 'Expired queued work must not start another worker.');
  assert.equal(observed.active, 0);
});

test('accepted waiting documents snapshot source strings and asset bytes', async t => {
  const asset = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#175c52"/></svg>');
  const options = { html: '<h1>Snapshot invoice</h1><img src="assets/icon.svg">', css: 'h1 { color: #175c52 }', assets: { 'icon.svg': asset }, previewDpi: 96 };
  const expected = await renderPdf(options);
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  const first = queue.renderPdf(input);
  const second = queue.renderPdf(options);
  options.html = 'Changed by caller';
  options.css = 'body {color:red}';
  asset.fill(0);
  options.assets['icon.svg'] = Buffer.from('invalid image');
  const [, actual] = await Promise.all([first, second]);
  assert.equal(hash(actual.pdf), hash(expected.pdf));
  assert.equal(hash(actual.previews[0]), hash(expected.previews[0]));
});

test('a render error releases capacity and does not poison later jobs', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  t.after(() => queue.close());
  const observed = workers(t);
  const rejected = assert.rejects(queue.renderPdf({ html: '<p>Missing: ⨌</p>' }), code('MISSING_GLYPHS'));
  const valid = queue.renderPdf(input);
  await rejected;
  assert.equal((await valid).pages, 1);
  assert.equal(observed.count, 2);
  assert.equal(observed.peak, 1);
  assert.equal(observed.active, 0);
});

test('close cancels active and waiting work, rejects new jobs and awaits cleanup', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 2 });
  let online;
  const started = new Promise(resolve => { online = resolve; });
  const observed = workers(t, worker => worker.once('online', online));
  const jobs = [queue.renderPdf(longInput), queue.renderPdf(input), queue.renderPdf(input)];
  const rejected = Promise.all(jobs.map(job => assert.rejects(job, code('QUEUE_CLOSED'))));
  await started;
  const closing = queue.close();
  assert.equal(queue.closed, true);
  assert.equal(queue.pendingCount, 0);
  assert.strictEqual(queue.close(), closing);
  await assert.rejects(queue.renderPdf(input), code('QUEUE_CLOSED'));
  await closing;
  await rejected;
  assert.equal(queue.activeCount, 0);
  assert.equal(observed.active, 0);
  assert.equal(observed.count, 1);
});

test('closing before startup creates no render worker', async t => {
  const observed = workers(t);
  const queue = createRenderQueue();
  const rejected = assert.rejects(queue.renderPdf(input), code('QUEUE_CLOSED'));
  await queue.close();
  await rejected;
  assert.equal(observed.count, 0);
});

test('process isolation stays bounded and recovers after a child is terminated', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  const spawn = ChildProcess.prototype.spawn;
  const children = new Set();
  let count = 0, peak = 0;
  ChildProcess.prototype.spawn = function (options) {
    count++;
    children.add(this);
    peak = Math.max(peak, children.size);
    this.once('exit', () => children.delete(this));
    this.once('close', () => children.delete(this));
    const result = spawn.call(this, options);
    if (count === 1) this.once('spawn', () => this.kill('SIGKILL'));
    return result;
  };
  t.after(async () => {
    await queue.close();
    ChildProcess.prototype.spawn = spawn;
    for (const child of children) child.kill('SIGKILL');
  });
  const failed = assert.rejects(queue.renderPdf({ ...input, isolation: 'process' }), code('PROCESS_FAILED'));
  const recovered = queue.renderPdf({ ...input, isolation: 'process' });
  await failed;
  const result = await recovered;
  assert.equal(hash(result.pdf), hash((await renderPdf(input)).pdf));
  assert.equal(count, 2);
  assert.equal(peak, 1);
  assert.equal(children.size, 0);
});

test('queue configuration and malformed jobs fail without consuming capacity', async t => {
  for (const options of [null, [], { concurrency: 0 }, { concurrency: 1.5 }, { maxQueue: -1 }, { maxQueue: Infinity }, { typo: 1 }]) {
    assert.throws(() => createRenderQueue(options), code('INVALID_INPUT'));
  }
  const queue = createRenderQueue();
  t.after(() => queue.close());
  assert.equal(queue.concurrency, 1);
  assert.equal(queue.maxQueue, 16);
  await assert.rejects(queue.renderPdf({ html: '' }), code('INVALID_INPUT'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(queue.renderPdf({ ...input, signal: controller.signal }), code('ABORTED'));
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.pendingCount, 0);
});

test('close waits for an active process to exit and disconnect', async t => {
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  const spawn = ChildProcess.prototype.spawn;
  const children = [];
  let didClose;
  const stopped = new Promise(resolve => { didClose = resolve; });
  ChildProcess.prototype.spawn = function (options) {
    children.push(this);
    const result = spawn.call(this, options);
    this.once('spawn', () => didClose(queue.close()));
    return result;
  };
  t.after(async () => {
    await queue.close();
    ChildProcess.prototype.spawn = spawn;
  });
  const first = assert.rejects(queue.renderPdf({ ...longInput, isolation: 'process' }), code('QUEUE_CLOSED'));
  const second = assert.rejects(queue.renderPdf({ ...input, isolation: 'process' }), code('QUEUE_CLOSED'));
  await stopped;
  await Promise.all([first, second]);
  assert.equal(children.length, 1);
  assert(children.every(child => !child.connected && (child.exitCode !== null || child.signalCode !== null)));
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.pendingCount, 0);
});
