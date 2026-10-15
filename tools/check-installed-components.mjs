// SPDX-License-Identifier: MIT
// Copied into a fresh consumer by verify-pack.mjs; every import uses that install.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { renderPdf, createRenderQueue, FullbleedError, version, engineVersion } from 'fullbleed';
import { renderDocument, toHtml, Document, Paragraph } from 'fullbleed/ui';
import { jsx } from 'fullbleed/ui/jsx-runtime';
import { jsxDEV } from 'fullbleed/ui/jsx-dev-runtime';
import { Invoice } from './components/document.mjs';
import { Invoice as TsxInvoice } from './components/invoice-tsx.mjs';
import { componentCases } from './components/cases.mjs';

const out = resolve(process.argv[2]), hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(out, { recursive: true });
const data = JSON.parse(await readFile(new URL('./components/data.json', import.meta.url), 'utf8'));
const cases = componentCases(data, Invoice), tsxCases = componentCases(data, TsxInvoice), records = [];
const queue = createRenderQueue({ concurrency: 2, maxQueue: 4 });
try {
  for (const [index, { name, node, pages, text }] of cases.entries()) {
    const result = await node.renderPdf(renderPdf, { defaultStyles: false, previewDpi: 96 });
    const repeated = await renderDocument(tsxCases[index].node, queue, { defaultStyles: false, previewDpi: 96 });
    assert.equal(result.pages, pages, name); assert.equal(result.missingGlyphs, 0, name);
    assert.equal(result.previews.length, pages, name);
    assert.equal(toHtml(node), toHtml(tsxCases[index].node), name + ': JSX HTML');
    assert.equal(node.toCss(), tsxCases[index].node.toCss(), name + ': JSX CSS');
    assert.deepEqual(result.pdf, repeated.pdf, name + ': function/JSX repeated PDF');
    assert.deepEqual(result.previews, repeated.previews, name + ': function/JSX previews');
    await writeFile(join(out, name + '.html'), node.toHtml());
    await writeFile(join(out, name + '.css'), node.toCss());
    await writeFile(join(out, name + '.pdf'), result.pdf);
    for (const [i, png] of result.previews.entries()) await writeFile(join(out, `${name}-${i + 1}.png`), png);
    records.push({ name, pages, missingGlyphs: result.missingGlyphs, pdf: hash(result.pdf),
      previews: result.previews.map(hash), text, jsxHtmlCssEqual: true, repeatedPdfPreviewsEqual: true });
  }
  const cjs = createRequire(import.meta.url)('fullbleed/ui');
  const baseline = await renderDocument(jsx(Document, { children: jsxDEV(Paragraph, { children: 'Installed JSX' }) }), renderPdf);
  const common = await cjs.Document(cjs.Paragraph('Installed JSX')).renderPdf(createRequire(import.meta.url)('fullbleed').renderPdf);
  assert.deepEqual(common.pdf, baseline.pdf);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(renderDocument(cases[0].node, queue, { signal: abort.signal }), e => e instanceof FullbleedError && e.code === 'ABORTED');
  await assert.rejects(cases[0].node.renderPdf(renderPdf, { timeoutMs: 1 }), e => e instanceof FullbleedError && e.code === 'TIMEOUT');
  await assert.rejects(cases[0].node.renderPdf(renderPdf, { previewDpi: 1 }), e => e instanceof FullbleedError && e.code === 'INVALID_INPUT');
  const recovered = await cases[0].node.renderPdf(queue, { defaultStyles: false });
  assert.equal(hash(recovered.pdf), records[0].pdf);
  const receipt = { ok: true, packageVersion: version, engineVersion, platform: process.platform,
    records, cjsJsxEqual: true, cancellationTimeoutInvalidOptionsRecovered: true, explicitQueue: true };
  await writeFile(join(out, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, package: version, documents: records.length, pages: records.reduce((n, r) => n + r.pages, 0) }));
} finally { await queue.close(); }
