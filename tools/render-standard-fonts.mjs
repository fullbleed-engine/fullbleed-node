// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { standardFontFixtures, standardFontText } from '../test/standard-fonts.mjs';
import { decodePng } from '../test/png.mjs';

const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' }, 'negative-control': { type: 'boolean' } } });
let packageRoot = values['package-root'];
let packed;
if (!packageRoot) {
  packed = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
  assert(packed.ok);
  packageRoot = join('output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
}
packageRoot = resolve(packageRoot);
const api = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
const out = resolve(values.out ?? 'output/standard-fonts');
await mkdir(join(out, '..'), { recursive: true });
await mkdir(out);
const report = { ok: false, packageVersion: api.version, engineVersion: api.engineVersion,
  wasmSha256: build.files['dist/engine.wasm'].sha256, installedTarballSha256: packed?.tarballSha256 ?? null,
  negativeControl: Boolean(values['negative-control']), expectedText: standardFontText, cases: [] };
try {
  for (const isolation of ['worker', 'process']) {
    for (const { name, font, html, css } of standardFontFixtures) {
      const folder = join(out, isolation + '-' + name);
      await mkdir(folder);
      const result = await api.renderPdf({ html, css, isolation, previewDpi: 72 });
      assert.equal(result.pages, 1);
      assert.equal(result.missingGlyphs, 0);
      assert.equal(result.previews.length, 1);
      const image = decodePng(result.previews[0]);
      let inkPixels = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const [r, g, b, a] = image.pixel(x, y);
        if (a > 0 && Math.min(r, g, b) < 250) inkPixels++;
      }
      const blankExpected = report.negativeControl && font !== 'Inter';
      assert.equal(inkPixels === 0, blankExpected, name + ': unexpected preview ink');
      await writeFile(join(folder, 'input.html'), html);
      await writeFile(join(folder, 'style.css'), css);
      await writeFile(join(folder, 'document.pdf'), result.pdf);
      await writeFile(join(folder, 'preview.png'), result.previews[0]);
      const record = { name, font, isolation, directory: isolation + '-' + name, inkPixels,
        pdfSha256: hash(result.pdf), pngSha256: hash(result.previews[0]) };
      if (isolation === 'process') {
        const worker = report.cases.find(row => row.name === name && row.isolation === 'worker');
        assert.equal(record.pdfSha256, worker.pdfSha256);
        assert.equal(record.pngSha256, worker.pngSha256);
      }
      report.cases.push(record);
    }
  }
  report.ok = true;
} finally {
  await writeFile(join(out, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, version: api.version, engine: api.engineVersion,
  cases: report.cases.length, blank: report.cases.filter(row => !row.inkPixels).length }));
