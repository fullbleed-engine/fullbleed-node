// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderQueue, renderPdf, renderPdfBatch, FullbleedError } from 'fullbleed';

const base = { html: '<p>{{account}}</p>', records: [{ account: '1042' }] };
const invalid = error => error instanceof FullbleedError && error.code === 'INVALID_INPUT';
const cases = [
  ['no records', { ...base, records: undefined }],
  ['zero records', { ...base, records: [] }],
  ['too many records', { ...base, records: Array(10_001).fill({ account: '' }) }],
  ['sparse records', { ...base, records: Array(1) }],
  ['invalid proxy length', { ...base, records: new Proxy([{ account: '1042' }], { get(target, key, receiver) {
    return key === 'length' ? NaN : Reflect.get(target, key, receiver);
  } }) }],
  ['non-object record', { ...base, records: [null] }],
  ['array record', { ...base, records: [['1042']] }],
  ['numeric value', { ...base, records: [{ account: 1042 }] }],
  ['object value', { ...base, records: [{ account: { toString: () => '1042' } }] }],
  ['no fields', { ...base, records: [{}] }],
  ['inherited field', { ...base, records: [Object.create({ account: '1042' })] }],
  ['empty field', { ...base, records: [{ '': '1042' }] }],
  ['extra field in later row', { ...base, records: [{ account: '1042' }, { account: '1043', extra: '' }] }],
  ['different fields', { ...base, records: [{ account: '1042' }, { client: '1043' }] }],
  ['symbol field', { ...base, records: [{ account: '1042', [Symbol('extra')]: '' }] }],
  ['unpaired surrogate', { ...base, records: [{ account: '\ud800' }] }],
  ['invalid layout', { ...base, layout: 'auto' }],
  ['unknown option', { ...base, rowCount: 1 }],
  ['UTF-8 data over budget', { ...base, records: [{ account: 'é'.repeat(2_000_000) }] }],
  ['combined source/data over budget', { ...base, html: '<p>{{account}}</p>' + ' '.repeat(2_000_000), records: [{ account: 'x'.repeat(2_000_000) }] }],
];

test('invalid batch data is rejected before starting any rendering worker', async () => {
  let workers = 0;
  const observe = () => workers++;
  process.on('worker', observe);
  try {
    for (const [label, options] of cases) await assert.rejects(renderPdfBatch(options), invalid, label);
    assert.equal(workers, 0);
  } finally { process.off('worker', observe); }
});

test('ordinary renders still reject batch-only options', async () => {
  await assert.rejects(renderPdf(base), invalid);
  await assert.rejects(renderPdf({ html: 'Invoice', layout: 'fixed' }), invalid);
});

test('invalid batch admission does not occupy a queue slot', async () => {
  const queue = createRenderQueue({ maxQueue: 0 });
  try {
    for (const [label, options] of cases.slice(0, -2)) {
      await assert.rejects(queue.renderPdfBatch(options), invalid, label);
      assert.equal(queue.activeCount, 0);
      assert.equal(queue.pendingCount, 0);
    }
  } finally { await queue.close(); }
  await assert.rejects(queue.renderPdfBatch(base), error => error.code === 'QUEUE_CLOSED');
});
