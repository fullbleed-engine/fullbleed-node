// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineFixtures, inlineExpected } from '../test/inline-wrapping.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
let packageRoot = values['package-root'];
let packed;
if (!packageRoot) {
  packed = JSON.parse(await readFile(join(root, 'output/pack-verification/verification.json'), 'utf8'));
  assert(packed.ok);
  packageRoot = join(root, 'output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
}
packageRoot = resolve(packageRoot);
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
const out = resolve(values.out ?? join(root, 'output/inline-wrapping'));
await mkdir(join(out, '..'), { recursive: true });
await mkdir(out);
const report = { schema: 'fullbleed.binding_inline_wrapping.v1', ok: false, packageVersion: version, engineVersion,
  node: process.version, platform: process.platform, wasmSha256: build.files['dist/engine.wasm'].sha256,
  installedTarballSha256: packed?.tarballSha256 ?? null, expectedText: inlineExpected, cases: [] };
try {
  for (const isolation of ['worker', 'process']) {
    for (const { name, pages, html, css } of inlineFixtures) {
      const directory = `${isolation}-${name}`;
      const folder = join(out, directory);
      await mkdir(folder);
      await writeFile(join(folder, 'input.html'), html);
      await writeFile(join(folder, 'style.css'), css);
      const input = { html, css, isolation, previewDpi: 96 };
      const result = await renderPdf(input);
      assert.equal(result.pages, pages);
      assert.equal(result.missingGlyphs, 0);
      assert.deepEqual((await renderPdf(input)).pdf, result.pdf, directory + ' repeated PDF');
      await writeFile(join(folder, 'document.pdf'), result.pdf);
      await writeFile(join(folder, 'preview-1.png'), result.previews[0]);
      let controlSha256 = null;
      if (['inline-helvetica', 'inline-times'].includes(name)) {
        const control = await renderPdf({ ...input, html: '<p>Edit print.css to change</p>', previewDpi: 0 });
        await writeFile(join(folder, 'control.pdf'), control.pdf);
        controlSha256 = hash(control.pdf);
      }
      const entry = { name, isolation, directory, pages, pdfSha256: hash(result.pdf),
        previewsSha256: result.previews.map(hash), controlSha256, repeatPdfBytesIdentical: true };
      if (isolation === 'process') {
        const worker = report.cases.find(row => row.name === name && row.isolation === 'worker');
        assert.equal(entry.pdfSha256, worker.pdfSha256);
        assert.deepEqual(entry.previewsSha256, worker.previewsSha256);
      }
      report.cases.push(entry);
    }
  }
  report.ok = true;
} finally {
  await writeFile(join(out, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, packageVersion: version, engineVersion, cases: report.cases.length }));
