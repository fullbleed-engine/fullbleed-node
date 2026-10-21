// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases, invalidCases } from './fixtures.mjs';

export async function checkWorker(base, output) {
  // These checks submit synthetic data only. Explicitly disallow remote targets.
  const url = new URL(base);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use a local test Worker.');
  assert.equal(url.protocol, 'http:');
  await mkdir(output, { recursive: true });
  const post = (body, contentType = 'application/json') => fetch(new URL('/invoice', url), {
    method: 'POST', headers: { 'Content-Type': contentType }, body, signal: AbortSignal.timeout(60000),
  });
  const records = [];
  async function success(item, name = item.name) {
    const response = await post(JSON.stringify(item.data));
    assert.equal(response.status, 200, name + ': ' + (response.status === 200 ? '' : await response.text()));
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="invoice-${item.data.number}.pdf"`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    await writeFile(resolve(output, `${name}.pdf`), pdf);
    records.push({ name, pdf: createHash('sha256').update(pdf).digest('hex'), bytes: pdf.length,
      minPages: item.minPages, maxPages: item.maxPages, text: item.text,
      trackedText: [item.data.number] });
  }
  assert.equal((await fetch(new URL('/health', url))).status, 200);
  const get = await fetch(new URL('/invoice', url));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST');
  assert.equal((await fetch(new URL('/missing', url))).status, 404);
  for (const item of cases) await success(item);
  for (const item of invalidCases) {
    const response = await post(item.body ?? JSON.stringify(item.data), item.contentType);
    assert.equal(response.status, item.status, item.name);
    assert.equal((await response.json()).error, item.code, item.name);
  }
  await success(cases[0], 'after-errors');
  assert.equal(records[0].pdf, records.at(-1).pdf, 'Failure recovery must preserve output.');
  const result = { ok: true, records, errors: invalidCases.map(({ name, status, code }) => ({ name, status, code })), recovery: true };
  await writeFile(resolve(output, 'http-verification.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = resolve('output');
  const result = await checkWorker(process.env.FULLBLEED_WORKER_URL ?? 'http://127.0.0.1:8787', output);
  console.log(JSON.stringify({ ok: result.ok, invoices: result.records.length, errors: result.errors.length, output }));
}
