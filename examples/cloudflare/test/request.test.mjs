// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { invoiceHandler, validateInvoice } from '../src/handler.mjs';

const sample = JSON.parse(await readFile(new URL('../sample.json', import.meta.url), 'utf8'));
const request = (body, init = {}) => new Request('http://localhost/invoice', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init,
});
test('validates calendar dates, integer money, bounded rows, and safe filenames', () => {
  const valid = validateInvoice(sample);
  assert.equal(valid.issued, '01 October 2026');
  for (const update of [
    { issued: '2026-02-30' }, { due: '2026-09-01' }, { paid: 'false' },
    { number: 'bad\r\nname' }, { number: '../invoice' }, { unknown: true },
    { customer: '' }, { items: [] }, { items: Array(31).fill(sample.items[0]) },
    { items: [{ ...sample.items[0], rate_cents: 1.2 }] },
    { items: [{ ...sample.items[0], quantity: 999, rate_cents: 99999999 }] },
    { items: [{ ...sample.items[0], progress: 101 }] },
  ]) assert.throws(() => validateInvoice({ ...sample, ...update }));
  assert.equal(validateInvoice({ ...sample, items: [{ ...sample.items[0], quantity: 1, rate_cents: 99999999 }] }).items[0].rate_cents, 99999999);
});
test('escapes customer text, forwards CSS, and returns a private attachment', async () => {
  let calls = 0;
  const app = invoiceHandler(async options => {
    calls++;
    assert(options.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert(!options.html.includes('<script>alert'));
    assert(options.css.includes('.total-amount'));
    assert.equal(options.maxPages, 10);
    assert.equal(options.defaultStyles, false);
    return { pdf: new TextEncoder().encode('%PDF-1.7\n'), pages: 1 };
  });
  const response = await app.fetch(request({ ...sample, customer: '<script>alert(1)</script>' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="invoice-NS-1042.pdf"');
  assert.equal(calls, 1);
});
test('bounds streamed bytes even when Content-Length is absent or wrong', async () => {
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(32769)); },
    cancel() { canceled = true; },
  });
  const app = invoiceHandler(() => { throw new Error('Must not render'); });
  const response = await app.fetch(request(null, { body: stream, duplex: 'half',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1' } }));
  assert.equal(response.status, 413);
  assert.equal(canceled, true);
});
test('rejects malformed JSON and media types before rendering', async () => {
  let calls = 0;
  const app = invoiceHandler(() => { calls++; throw new Error('Must not render'); });
  for (const [body, status] of [['{', 400], [new Uint8Array([0xff]), 400]]) {
    assert.equal((await app.fetch(request(null, { body }))).status, status);
  }
  assert.equal((await app.fetch(request(sample, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal(calls, 0);
});
test('routes methods and hides internal failure details', async () => {
  const app = invoiceHandler(() => { throw new Error('private customer and engine internals'); });
  assert.equal((await app.fetch(new Request('http://localhost/missing'))).status, 404);
  assert.equal((await app.fetch(new Request('http://localhost/invoice'))).headers.get('Allow'), 'POST');
  const failure = await app.fetch(request(sample));
  assert.equal(failure.status, 500);
  assert(!JSON.stringify(await failure.json()).includes('private customer'));
  for (const code of ['PAGE_LIMIT', 'MISSING_GLYPHS']) {
    const failing = invoiceHandler(() => { throw Object.assign(new Error('internal'), { code }); });
    const response = await failing.fetch(request(sample));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, code);
  }
});
