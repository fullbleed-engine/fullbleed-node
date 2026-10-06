import test from 'node:test';
import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderPdf, FullbleedError } from 'fullbleed';

const input = { html: '<h1>Isolated invoice</h1><p>Invoice NS-1042</p>', previewDpi: 96, isolation: 'process' };
const expectCode = code => error => error instanceof FullbleedError && error.code === code;

function observe(t, configure = () => {}, rewrite = options => options) {
  const original = ChildProcess.prototype.spawn;
  const active = new Set();
  const children = [];
  ChildProcess.prototype.spawn = function(options) {
    if (!options.args.some(arg => String(arg).endsWith('process-worker.cjs'))) return original.call(this, options);
    children.push(this);
    active.add(this);
    this.once('exit', () => active.delete(this));
    this.once('close', () => active.delete(this));
    const result = original.call(this, rewrite(options));
    configure(this, children.length);
    return result;
  };
  t.after(() => {
    ChildProcess.prototype.spawn = original;
    for (const child of active) child.kill('SIGKILL');
  });
  return {
    children,
    stopped(count) {
      assert.equal(children.length, count, 'The check must start real child processes.');
      assert.equal(active.size, 0, 'The render promise must wait for process exit or spawn failure.');
      assert(children.every(child => !child.connected), 'IPC must be disconnected before settlement.');
    },
  };
}

// Substitute a controlled child only in the fault-injection tests. The public
// API never accepts an executable or arbitrary child module.
const fixture = mode => options => ({ ...options,
  args: options.args.map(arg => String(arg).endsWith('process-worker.cjs')
    ? fileURLToPath(new URL('fixtures/process-driver.cjs', import.meta.url)) : arg).concat(mode),
});

test('a separate process matches worker PDF and preview bytes, including custom assets', async t => {
  const font = await readFile(new URL('fonts/NotoSansMath-Regular.ttf', import.meta.url));
  const options = { ...input, html: '<h1>Isolated invoice</h1><p class="math">∑ ∈ ∩</p><img src="assets/brand/logo.svg">',
    css: '.math {font-family:"Noto Sans Math"} img{width:30pt}', fonts: [font],
    assets: { 'brand/logo.svg': Buffer.from('<svg width="30" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="30" height="30" fill="#175c52"/></svg>') } };
  const expected = await renderPdf({ ...options, isolation: 'worker' });
  const processes = observe(t);
  const pending = renderPdf(options);
  font.fill(0);
  options.assets['brand/logo.svg'].fill(0);
  const actual = await pending;
  processes.stopped(1);
  assert.deepEqual(actual, expected);
  assert(Buffer.isBuffer(actual.pdf) && actual.previews.every(Buffer.isBuffer));
});

test('a terminated render process rejects and the next request succeeds', async t => {
  const processes = observe(t, (child, count) => {
    if (count === 1) child.once('spawn', () => child.kill('SIGKILL'));
  });
  await assert.rejects(renderPdf(input), error => {
    assert(expectCode('PROCESS_FAILED')(error));
    assert(error.exitCode !== undefined && error.signal !== undefined);
    return true;
  });
  processes.stopped(1);
  assert.equal((await renderPdf(input)).pages, 1);
  processes.stopped(2);
});

test('receiving a PDF does not hide a crash before child shutdown', async t => {
  let received = false;
  const processes = observe(t, child => child.once('message', message => {
    assert.equal(message.result.pdf.subarray(0, 5).toString(), '%PDF-');
    received = true;
  }), fixture('fail-after-result'));
  await assert.rejects(renderPdf(input), error => expectCode('PROCESS_FAILED')(error) && error.exitCode === 23);
  assert(received, 'A real PDF must arrive before the deliberate shutdown failure.');
  processes.stopped(1);
});

test('invalid responses and missing responses reject without leaking children', async t => {
  let mode = 'invalid-result';
  const processes = observe(t, () => {}, options => fixture(mode)(options));
  for (mode of ['invalid-result', 'duplicate-result', 'no-result']) {
    await assert.rejects(renderPdf(input), expectCode('PROCESS_FAILED'));
  }
  processes.stopped(3);
});

test('an unavailable executable produces a structured spawn failure', async t => {
  const processes = observe(t, () => {}, options => ({ ...options,
    file: fileURLToPath(new URL('fixtures/no-such-node-executable', import.meta.url)),
  }));
  await assert.rejects(renderPdf(input), expectCode('PROCESS_FAILED'));
  processes.stopped(1);
});

test('loss of the parent IPC channel ends the rendering process', async t => {
  const processes = observe(t, child => {
    const send = child.send;
    child.send = function(message, callback) {
      return send.call(this, message, error => {
        callback(error);
        if (this.connected) this.disconnect();
      });
    };
  });
  await assert.rejects(renderPdf({ ...input, html: '<p>Long document</p>'.repeat(10000) }), expectCode('PROCESS_FAILED'));
  processes.stopped(1);
});

test('abort during process construction waits for the real process to exit', async t => {
  const controller = new AbortController();
  const processes = observe(t, () => controller.abort());
  await assert.rejects(renderPdf({ ...input, signal: controller.signal }), expectCode('ABORTED'));
  processes.stopped(1);
});

test('an active deadline stops the process before rejecting', async t => {
  const processes = observe(t);
  await assert.rejects(renderPdf({ ...input, html: '<p>Long document</p>'.repeat(10000), timeoutMs: 100 }), expectCode('TIMEOUT'));
  processes.stopped(1);
});

test('cancelling one concurrent process leaves the other request intact', async t => {
  const controller = new AbortController();
  const processes = observe(t, (child, count) => {
    if (count === 1) child.once('spawn', () => controller.abort());
  });
  const results = await Promise.allSettled([
    renderPdf({ ...input, signal: controller.signal }), renderPdf(input),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert(expectCode('ABORTED')(results[0].reason));
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[1].value.pages, 1);
  processes.stopped(2);
});

test('document failures preserve their error code and allow recovery', async t => {
  const processes = observe(t);
  await assert.rejects(renderPdf({ ...input, html: '<p>Unmapped \u{10ffff}</p>' }), expectCode('MISSING_GLYPHS'));
  processes.stopped(1);
  await assert.rejects(renderPdf({ ...input, html: '<div>One</div><div>Two</div>', css: 'div{break-after:page}', maxPages: 1 }), expectCode('PAGE_LIMIT'));
  processes.stopped(2);
  assert.equal((await renderPdf(input)).pages, 1);
  processes.stopped(3);
});

test('pre-aborted and invalid requests do not create processes', async t => {
  const processes = observe(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderPdf({ ...input, signal: controller.signal }), expectCode('ABORTED'));
  await assert.rejects(renderPdf({ ...input, isolation: 'browser' }), expectCode('INVALID_INPUT'));
  processes.stopped(0);
});
