// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderPdf } from 'fullbleed';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const data = await readFile(new URL('./fonts/family/LibreCaslonText[wght].ttf', import.meta.url));
const html = '<h1>Named font aliases</h1><p>Café / your document, your brand.</p>';
const styles = family => `@page { size: 400px 240px; margin: 24px } body { font-family: ${family}; font-size: 16px } h1 {font-weight: 400; font-size: 26px}`;

test('named font URL aliases reproduce the actual family across Node entrypoints and isolation', async () => {
  const control = await renderPdf({ html, css: styles('"LibreCaslonText-Regular"'), fonts: [data], defaultStyles: false, previewDpi: 96 });
  const css = '@font-face { font-family: Brand; src: url("assets/Café Brand.ttf") }' + styles('Brand');
  const records = [];
  for (const [entry, api] of [['esm', { renderPdf }], ['cjs', createRequire(import.meta.url)('fullbleed')]]) {
    for (const isolation of ['worker', 'process']) {
      const result = await api.renderPdf({ html, css, fonts: [{ name: 'Café Brand.ttf', data }], defaultStyles: false, previewDpi: 96, isolation });
      assert.equal(result.missingGlyphs, 0);
      assert.equal(hash(result.pdf), hash(control.pdf), entry + '/' + isolation + ': named font PDF');
      assert.deepEqual(result.previews.map(hash), control.previews.map(hash), entry + '/' + isolation + ': named font preview');
      assert.match(result.pdf.toString('latin1'), /LibreCaslonText/);
      records.push({ entry, isolation, pdf: hash(result.pdf), png: hash(result.previews[0]) });
    }
  }
  const legacy = await renderPdf({ html, css, fonts: [data], defaultStyles: false, previewDpi: 96 });
  assert.notDeepEqual(legacy.previews.map(hash), control.previews.map(hash), 'The fixture must detect a lost filename alias.');
  const defaultInput = { html, previewDpi: 96 };
  const bundled = await renderPdf(defaultInput);
  const sameFilename = await renderPdf({ ...defaultInput, fonts: [{ name: 'Inter-Variable.ttf', data }] });
  assert.equal(hash(sameFilename.pdf), hash(bundled.pdf), 'A custom filename must not overwrite bundled font bytes.');
  if (process.env.FULLBLEED_NAMED_FONT_EVIDENCE) {
    const out = process.env.FULLBLEED_NAMED_FONT_EVIDENCE;
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'named-font.pdf'), control.pdf);
    await writeFile(join(out, 'named-font.png'), control.previews[0]);
    await writeFile(join(out, 'unnamed-control.pdf'), legacy.pdf);
    await writeFile(join(out, 'unnamed-control.png'), legacy.previews[0]);
    await writeFile(join(out, 'verification.json'), JSON.stringify({ ok: true, fontSha256: hash(data), records }, null, 2) + '\n');
  }
});
