// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { hiddenTextSource } from '../test/hidden-text.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  'package-root': { type: 'string' }, out: { type: 'string' },
  'negative-control': { type: 'boolean', default: false },
} });
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
if (values['negative-control']) {
  assert.equal(version, '0.5.0');
  assert.equal(engineVersion, '2.5.22');
} else {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(engineVersion, pkg.fullbleed.engineVersion);
  assert.equal(hiddenTextSource.engineVersion, '2.5.43', 'Preserve the historical hidden-text baseline.');
}
const out = resolve(values.out ?? join(root, 'output/hidden-text'));
await mkdir(join(out, '..'), { recursive: true });
await mkdir(out);
const report = { schema: 'fullbleed.javascript.hidden-text.renders.v1', ok: false,
  packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  negativeControl: values['negative-control'], sourceCommit: hiddenTextSource.sourceCommit,
  baselineEngineVersion: hiddenTextSource.engineVersion,
  fixtureSha256: hash(await readFile(join(root, 'test/fixtures/hidden-text-2.5.24.json'))),
  wasmSha256: build.files['dist/engine.wasm'].sha256,
  installedTarballSha256: packed?.tarballSha256 ?? null, cases: [], failures: [] };
try {
  for (const isolation of ['worker', 'process']) {
    for (const fixture of hiddenTextSource.cases) {
      const folder = join(out, isolation + '-' + fixture.name);
      await mkdir(folder);
      await writeFile(join(folder, 'input.css'), fixture.css);
      const row = { name: fixture.name, isolation, directory: isolation + '-' + fixture.name,
        affectedInPreviousCore: fixture.affectedInPreviousCore, variants: {} };
      for (const [variant, html] of [['source', fixture.sourceHtml], ['control', fixture.controlHtml]]) {
        await writeFile(join(folder, variant + '.html'), html);
        const options = { html, css: fixture.css, previewDpi: fixture.previewDpi, defaultStyles: false, isolation };
        const result = await renderPdf(options);
        assert.equal(result.engineVersion, engineVersion);
        assert.equal(result.pages, fixture.pages);
        assert.equal(result.missingGlyphs, 0);
        assert.equal(result.previews.length, fixture.pages);
        const repeated = await renderPdf(options);
        assert.deepEqual(repeated.pdf, result.pdf, fixture.name + ': repeated PDF');
        assert.deepEqual(repeated.previews, result.previews, fixture.name + ': repeated previews');
        await writeFile(join(folder, variant + '.pdf'), result.pdf);
        await writeFile(join(folder, variant + '.png'), result.previews[0]);
        row.variants[variant] = { pdf: hash(result.pdf), png: hash(result.previews[0]),
          pages: result.pages, repeatPdfAndPreviewBytesIdentical: true };
      }
      row.controlMatchesCore = row.variants.control.pdf === fixture.expected.pdf
        && row.variants.control.png === fixture.expected.png;
      row.sourceMatchesControl = row.variants.source.pdf === row.variants.control.pdf
        && row.variants.source.png === row.variants.control.png;
      row.ok = row.controlMatchesCore && (values['negative-control']
        ? row.sourceMatchesControl === !fixture.affectedInPreviousCore : row.sourceMatchesControl);
      if (isolation === 'process') {
        const worker = report.cases.find(item => item.name === row.name && item.isolation === 'worker');
        assert.deepEqual(row.variants, worker.variants, row.name + ': worker/process output');
      }
      report.cases.push(row);
      if (!row.ok) report.failures.push({ name: row.name, isolation,
        controlMatchesCore: row.controlMatchesCore, sourceMatchesControl: row.sourceMatchesControl });
      if (report.cases.length % 20 === 0) {
        console.log(JSON.stringify({ completed: report.cases.length, isolation, lastCase: row.name }));
      }
    }
  }
  assert.equal(report.cases.length, hiddenTextSource.cases.length * 2);
  report.ok = report.failures.length === 0;
} finally {
  await writeFile(join(out, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, packageVersion: version, engineVersion,
  negativeControl: report.negativeControl, cases: report.cases.length, failures: report.failures }));
assert(report.ok, 'Hidden-text output differs from the independently retained controls');
