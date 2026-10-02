// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renderPdf, FullbleedError, engineVersion } from 'fullbleed';

const hash = value => createHash('sha256').update(value).digest('hex');
const html = '<h1>Invoice NS-1042</h1><p>Consulting: USD 1,200.00</p>';
const css = '@page {size:A4; margin:20mm} h1 {color:#175c52}';
const expectCode = code => error => error instanceof FullbleedError && error.code === code;
let baseline;

test('renders an embedded-font PDF and previews the finalized PDF', async () => {
  baseline = await renderPdf({ html, css, previewDpi: 96 });
  assert(Buffer.isBuffer(baseline.pdf));
  assert.equal(baseline.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(baseline.pdf.toString('latin1'), /\/FontFile2/);
  assert.equal(baseline.pages, 1);
  assert.equal(baseline.missingGlyphs, 0);
  assert.equal(baseline.engineVersion, engineVersion);
  assert.equal(baseline.previews.length, 1);
  assert.equal(baseline.previews[0].subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('repeats exactly and source edits change output', async () => {
  const repeated = await renderPdf({ html, css, previewDpi: 96 });
  assert.equal(hash(repeated.pdf), hash(baseline.pdf));
  assert.equal(hash(repeated.previews[0]), hash(baseline.previews[0]));
  const edited = await renderPdf({ html: html.replace('NS-1042', 'NS-1043'), css });
  assert.notEqual(hash(edited.pdf), hash(baseline.pdf));
  assert.deepEqual(edited.previews, []);
});

test('renders a designed three-page report', async () => {
  const report = await renderPdf({ html: await readFile(new URL('../examples/report.html', import.meta.url), 'utf8'), css: await readFile(new URL('../examples/report.css', import.meta.url), 'utf8') });
  assert.equal(report.pages, 3);
  assert.equal(report.missingGlyphs, 0);
});

test('supports seven pages and rejects the caller-selected page limit', async () => {
  const input = { html: Array.from({ length: 7 }, (_, i) => `<section><h1>Record ${i + 1}</h1></section>`).join(''), css: 'section {break-after:page} section:last-child {break-after:auto}' };
  const result = await renderPdf(input);
  assert.equal(result.pages, 7);
  await assert.rejects(renderPdf({ ...input, maxPages: 6 }), expectCode('PAGE_LIMIT'));
  assert.equal(hash((await renderPdf({ html, css })).pdf), hash(baseline.pdf));
});

test('custom fonts resolve characters missing from the bundled fonts', async () => {
  const input = { html: '<p>Integral: ⨌</p>', css: "body {font-family:Inter,'Noto Sans Math'}" };
  await assert.rejects(renderPdf(input), expectCode('MISSING_GLYPHS'));
  const allowed = await renderPdf({ ...input, allowMissingGlyphs: true });
  assert(allowed.missingGlyphs > 0);
  const result = await renderPdf({ ...input, fonts: [await readFile(new URL('./fonts/NotoSansMath-Regular.ttf', import.meta.url))] });
  assert.equal(result.missingGlyphs, 0);
  assert.notEqual(hash(result.pdf), hash(allowed.pdf));
  assert.match(result.pdf.toString('latin1'), /NotoSansMath/);
});

test('nested virtual assets affect PDF and preview bytes', async () => {
  const svg = color => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="${color}"/></svg>`);
  const input = { html: '<h1>Asset test</h1><img src="assets/brand/logo.svg" width="80" height="40">', previewDpi: 96 };
  const green = await renderPdf({ ...input, assets: { 'brand/logo.svg': svg('#175c52') } });
  const red = await renderPdf({ ...input, assets: { 'brand/logo.svg': svg('#ff0000') } });
  assert.notEqual(hash(green.pdf), hash(red.pdf));
  assert.notEqual(hash(green.previews[0]), hash(red.previews[0]));
});

test('concurrent documents stay isolated', async () => {
  const inputs = ['Alice', 'Bob', 'Charlie'].map(name => ({ html: `<h1>Statement for ${name}</h1>` }));
  const concurrent = await Promise.all(inputs.map(renderPdf));
  assert.equal(new Set(concurrent.map(r => hash(r.pdf))).size, 3);
  for (let i = 0; i < inputs.length; i++) assert.equal(hash(concurrent[i].pdf), hash((await renderPdf(inputs[i])).pdf));
});

test('deadline and abort failures recover without contaminating the next job', async () => {
  const already = new AbortController();
  already.abort();
  await assert.rejects(renderPdf({ html, signal: already.signal }), expectCode('ABORTED'));
  await assert.rejects(renderPdf({ html, timeoutMs: 1 }), expectCode('TIMEOUT'));
  const active = new AbortController();
  const pending = assert.rejects(renderPdf({ html: '<div>Page</div>'.repeat(1000), css: 'div {break-after:page}', previewDpi: 96, signal: active.signal }), expectCode('ABORTED'));
  setTimeout(() => active.abort(), 50);
  await pending;
  assert.equal(hash((await renderPdf({ html, css })).pdf), hash(baseline.pdf));
});

test('invalid options and paths fail explicitly', async () => {
  for (const options of [null, { html: '' }, { html, css: 3 }, { html, profile: 'pdfua1' }, { html, maxPages: 0 }, { html, previewDpi: 500 },
    { html, assets: { '../secret': Buffer.from('x') } }, { html, assets: { a: Buffer.from('x'), 'a/b': Buffer.from('x') } },
    { html, fonts: ['not bytes'] }, { html: '€'.repeat(1333334) }]) {
    await assert.rejects(renderPdf(options), expectCode('INVALID_INPUT'));
  }
  await assert.rejects(renderPdf({ html, fonts: [Buffer.from('not a font')] }), expectCode('RENDER_FAILED'));
});

test('CommonJS shares the API and error type', async () => {
  const api = createRequire(import.meta.url)('fullbleed');
  assert.equal(api.FullbleedError, FullbleedError);
  assert.equal(hash((await api.renderPdf({ html, css })).pdf), hash(baseline.pdf));
});
