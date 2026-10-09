// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEngineRegressionFixtures } from '../test/engine-regressions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
let packageRoot = values['package-root'], packed;
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
const out = resolve(values.out ?? join(root, 'output/engine-regressions'));
await mkdir(join(out, '..'), { recursive: true });
await mkdir(out);
const report = { schema: 'fullbleed.javascript.engine-regressions.renders.v1', ok: false,
  packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  wasmSha256: build.files['dist/engine.wasm'].sha256, installedTarballSha256: packed?.tarballSha256 ?? null, cases: [] };
try {
  const fixtures = await loadEngineRegressionFixtures();
  for (const isolation of ['worker', 'process']) {
    for (const { name, pages, ...input } of fixtures) {
      const directory = isolation + '-' + name;
      const folder = join(out, directory);
      await mkdir(folder);
      await writeFile(join(folder, 'input.html'), input.html);
      await writeFile(join(folder, 'style.css'), input.css);
      const result = await renderPdf({ ...input, isolation });
      assert.equal(result.missingGlyphs, 0, name);
      assert.equal(result.previews.length, result.pages, name);
      assert.deepEqual((await renderPdf({ ...input, isolation })).pdf, result.pdf, name + ' repeated PDF');
      await writeFile(join(folder, 'document.pdf'), result.pdf);
      for (const [index, png] of result.previews.entries()) await writeFile(join(folder, `preview-${index + 1}.png`), png);
      const entry = { name, isolation, directory, pages: result.pages, expectedPages: pages, pdfSha256: hash(result.pdf),
        previewsSha256: result.previews.map(hash), repeatPdfBytesIdentical: true };
      if (isolation === 'process') {
        const worker = report.cases.find(row => row.name === name && row.isolation === 'worker');
        assert.equal(entry.pdfSha256, worker.pdfSha256, name + ' worker/process PDF');
        assert.deepEqual(entry.previewsSha256, worker.previewsSha256, name + ' worker/process previews');
      }
      report.cases.push(entry);
    }
  }
  report.ok = true;
} finally {
  await writeFile(join(out, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, packageVersion: version, engineVersion, cases: report.cases.length }));
