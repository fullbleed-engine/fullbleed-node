// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRenderQueue, renderPdf, renderPdfBatch, FullbleedError, version, engineVersion } from 'fullbleed';
import { batchShort as short, batchLong as long, batchFixtures, batchComponentTemplate } from './batch-fixtures.mjs';
const code = wanted => error => error instanceof FullbleedError && error.code === wanted;
const hash = data => createHash('sha256').update(data).digest('hex');

async function save(name, input, result) {
  const out = process.env.FULLBLEED_BATCH_EVIDENCE;
  if (!out) return;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, name + '.pdf'), result.pdf);
  for (let i = 0; i < result.previews.length; i++) await writeFile(join(out, `${name}-${i + 1}.png`), result.previews[i]);
  await writeFile(join(out, name + '.json'), JSON.stringify({
    status: 'rendered-for-independent-review', packageVersion: version, engineVersion, node: process.version,
    input, pages: result.pages, missingGlyphs: result.missingGlyphs, records: result.records,
    pdfSha256: hash(result.pdf), previewSha256: result.previews.map(hash),
  }, null, 2) + '\n');
}

test('fixed batches preserve record order and match worker/process bytes and previews', async () => {
  const options = { ...short, layout: 'fixed', previewDpi: 72 };
  const worker = await renderPdfBatch(options);
  await save('fixed', options, worker);
  assert.equal(worker.pages, 2);
  assert.deepEqual(worker.records, [
    { recordIndex: 0, pageOffset: 0, pageCount: 1, missingGlyphs: [] },
    { recordIndex: 1, pageOffset: 1, pageCount: 1, missingGlyphs: [] },
  ]);
  const child = await renderPdfBatch({ ...options, isolation: 'process' });
  assert.deepEqual(child, worker);
});

test('default reflow returns the actual page range of a longer record', async () => {
  const options = { ...long, previewDpi: 72 };
  const result = await renderPdfBatch(options);
  await save('reflow', options, result);
  assert.deepEqual(result.records[0], { recordIndex: 0, pageOffset: 0, pageCount: 1, missingGlyphs: [] });
  assert.equal(result.records[1].recordIndex, 1);
  assert.equal(result.records[1].pageOffset, 1);
  assert(result.records[1].pageCount > 1);
  assert.equal(result.pages, 1 + result.records[1].pageCount);
  assert.equal(result.previews.length, result.pages);
  const explicit = await renderPdfBatch({ ...options, layout: 'reflow' });
  assert.deepEqual(explicit, result);
});

test('missing-character policy rejects by default and reports distinct characters and per-record occurrences', async () => {
  const missing = String.fromCodePoint(0x10ffff);
  const options = { ...short, records: [{ account: '1042', message: missing }, { account: '1043', message: missing.repeat(3) }] };
  await assert.rejects(renderPdfBatch(options), code('MISSING_GLYPHS'));
  const allowed = await renderPdfBatch({ ...options, allowMissingGlyphs: true });
  await save('missing', { ...options, allowMissingGlyphs: true }, allowed);
  assert.equal(allowed.missingGlyphs, 1);
  assert.deepEqual(allowed.records.map(row => row.missingGlyphs.map(glyph => [glyph.codepoint, glyph.char, glyph.count])),
    [[[0x10ffff, missing, 1]], [[0x10ffff, missing, 3]]]);
  assert(allowed.records.every(row => row.missingGlyphs[0].fontsTried.length > 0));
  assert.equal((await renderPdfBatch(short)).missingGlyphs, 0);
});

test('binding mismatches and the combined page limit fail before returning a PDF and permit recovery', async () => {
  await assert.rejects(renderPdfBatch({ ...short, records: [{ wrong: '1042' }] }), code('INVALID_BINDINGS'));
  await assert.rejects(renderPdfBatch({ ...short, html: '<p>No bindings</p>' }), code('INVALID_BINDINGS'));
  await assert.rejects(renderPdfBatch({ ...short, maxPages: 1 }), code('PAGE_LIMIT'));
  assert.equal((await renderPdfBatch(short)).pages, 2);
});

test('queued batches snapshot nested records and share FIFO slots with ordinary renders', async () => {
  const options = { ...short, records: short.records.map(row => ({ ...row })) };
  const expected = await renderPdfBatch(options);
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  const order = [];
  try {
    const first = queue.renderPdf({ html: '<p>First</p>' }).then(result => { order.push('single'); return result; });
    const second = queue.renderPdfBatch(options).then(result => { order.push('batch'); return result; });
    assert.equal(queue.activeCount, 1);
    assert.equal(queue.pendingCount, 1);
    options.records[0].account = 'CHANGED';
    options.records[1].message = 'Caller changed this after admission.';
    options.records.push({ account: '1044', message: 'Extra' });
    await assert.rejects(queue.renderPdfBatch(short), code('QUEUE_FULL'));
    const [, actual] = await Promise.all([first, second]);
    assert.deepEqual(actual, expected);
    assert.deepEqual(order, ['single', 'batch']);
    assert.equal(queue.activeCount, 0);
    assert.equal(queue.pendingCount, 0);
  } finally { await queue.close(); }
});

test('reentrant record getters cannot bypass a closed queue', async () => {
  const queue = createRenderQueue();
  let closing;
  const record = { get account() { closing = queue.close(); return '1042'; }, message: 'Active.' };
  await assert.rejects(queue.renderPdfBatch({ ...short, records: [record] }), code('QUEUE_CLOSED'));
  await closing;
  assert.equal(queue.activeCount, 0);
  assert.equal(queue.pendingCount, 0);
});

test('a waiting batch retains its original deadline and starts no expired worker', async t => {
  let now = 1000, workers = 0;
  t.mock.method(Date, 'now', () => now);
  const queue = createRenderQueue({ concurrency: 1, maxQueue: 1 });
  const listener = worker => { workers++; worker.once('online', () => { now += 2000; }); };
  process.on('worker', listener);
  try {
    const first = queue.renderPdf({ html: '<p>First</p>', timeoutMs: 1000 });
    const expired = assert.rejects(queue.renderPdfBatch({ ...short, timeoutMs: 1000 }), code('TIMEOUT'));
    await Promise.all([first, expired]);
    assert.equal(workers, 1);
    assert.equal(queue.activeCount, 0);
    assert.equal(queue.pendingCount, 0);
  } finally { process.off('worker', listener); await queue.close(); }
});

test('component-authored templates pass records through the existing document adapter', async () => {
  const template = batchComponentTemplate;
  const options = { records: short.records, defaultStyles: false, previewDpi: 72 };
  const authored = await template.renderPdf(renderPdfBatch, options);
  const explicit = await renderPdfBatch({ ...options, html: template.toHtml(), css: template.toCss() });
  assert.deepEqual(authored, explicit);
  assert.equal(authored.pages, 2);
  await save('components', { ...options, html: template.toHtml(), css: template.toCss() }, authored);
});

test('record text and prototype-shaped field names remain literal data', async () => {
  const options = batchFixtures.find(fixture => fixture.name === 'batch-literal').options;
  const result = await renderPdfBatch(options);
  assert.equal(result.pages, 1);
  assert.equal(result.missingGlyphs, 0);
  assert.deepEqual(result.records, [{ recordIndex: 0, pageOffset: 0, pageCount: 1, missingGlyphs: [] }]);
  await save('literal', options, result);
});

test('a record array length is captured once at admission', async () => {
  let reads = 0;
  const records = new Proxy([{ account: '1042', message: 'Active.' }], { get(target, key, receiver) {
    if (key === 'length') return ++reads === 1 ? 1 : 0;
    return Reflect.get(target, key, receiver);
  } });
  const result = await renderPdfBatch({ ...short, records });
  assert.equal(reads, 1);
  assert.equal(result.pages, 1);
  assert.equal(result.records.length, 1);
});

test('fixed diagnostics retain selected fonts while reflow selects a registered fallback per record', async () => {
  for (const fixture of batchFixtures.filter(item => item.fontFiles)) {
    const fonts = await Promise.all(fixture.fontFiles.map(name => readFile(new URL('./fonts/' + name, import.meta.url))));
    const result = await renderPdfBatch({ ...fixture.options, fonts });
    await save(fixture.name.slice('batch-'.length), { ...fixture.options, fontFiles: fixture.fontFiles }, result);
    assert.equal(result.pages, fixture.pages);
    assert.equal(result.missingGlyphs, fixture.missingGlyphs);
    assert.deepEqual(result.records.map(row => row.missingGlyphs.map(({ codepoint, count }) => ({ codepoint, count }))), fixture.missingRows);
  }
});

test('aborting an active batch waits for worker shutdown and the queue recovers', async t => {
  const controller = new AbortController();
  const queue = createRenderQueue({ maxQueue: 1 });
  let observed;
  const listener = worker => {
    observed ??= worker;
    if (worker === observed) worker.once('online', () => controller.abort());
  };
  process.on('worker', listener);
  t.after(() => process.off('worker', listener));
  try {
    const cancelled = assert.rejects(queue.renderPdfBatch({ ...long, signal: controller.signal }), code('ABORTED'));
    const next = queue.renderPdfBatch(short);
    await cancelled;
    assert(observed);
    assert.equal(observed.threadId, -1);
    assert.equal((await next).pages, 2);
  } finally { await queue.close(); }
});

test('malformed batch reports from a worker reject and release that worker', async () => {
  const baseline = await renderPdfBatch(short);
  const mutations = [
    result => { result.records[1].recordIndex = 0; },
    result => { result.records[1].pageOffset = 0; },
    result => { result.records[1].pageCount = Number.MAX_SAFE_INTEGER; },
    result => { result.records.pop(); },
    result => { result.missingGlyphs = 1; },
    result => { result.pdf = new Uint8Array([0]); },
    result => { result.records[0].missingGlyphs = [{ codepoint: 0x110000, char: '?', count: 1, fontsTried: ['Inter'] }]; },
  ];
  for (const mutate of mutations) {
    const reply = { ok: true, ...structuredClone(baseline) };
    mutate(reply);
    let worker;
    const listener = created => { worker = created; queueMicrotask(() => created.emit('message', reply)); };
    process.once('worker', listener);
    try {
      await assert.rejects(renderPdfBatch(short), code('WORKER_FAILED'));
      assert(worker);
      assert.equal(worker.threadId, -1);
    } finally { process.off('worker', listener); }
  }
  assert.equal((await renderPdf({ html: '<p>Recovered</p>' })).pages, 1);
});
