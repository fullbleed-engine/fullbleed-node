// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
let packagePath = values['package-root'], tarballSha256 = null;
if (!packagePath) {
  const packed = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
  assert(packed.ok);
  packagePath = join('output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
  tarballSha256 = packed.tarballSha256;
}
const packageRoot = resolve(packagePath), out = resolve(values.out ?? 'output/preformatted-whitespace');
const bytes = await readFile(new URL('../test/fixtures/preformatted-whitespace-2.5.41.json', import.meta.url));
const inputs = JSON.parse(bytes), hash = data => createHash('sha256').update(data).digest('hex');
const font = await readFile(new URL('../test/fonts/NotoSans-Regular.ttf', import.meta.url));
assert.equal(hash(font), inputs.fontSha256);
assert.equal(inputs.cases.length, 17);
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
await mkdir(out);
await writeFile(join(out, 'inputs.json'), bytes);
const report = { packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  inputSha256: hash(bytes), fontSha256: hash(font), tarballSha256, wasmSha256: build.files['dist/engine.wasm'].sha256, cases: [] };
for (const isolation of ['worker', 'process']) {
  for (const fixture of inputs.cases) {
    const directory = isolation + '-' + fixture.name, folder = join(out, directory);
    await mkdir(folder);
    await writeFile(join(folder, 'input.html'), fixture.html);
    await writeFile(join(folder, 'style.css'), fixture.css);
    const options = { html: fixture.html, css: fixture.css, fonts: [font], defaultStyles: false,
      previewDpi: 144, timeoutMs: 60000, isolation };
    const actual = await renderPdf(options), again = await renderPdf(options);
    assert.equal(actual.missingGlyphs, 0);
    assert.equal(actual.engineVersion, engineVersion);
    assert.equal(actual.previews.length, actual.pages);
    assert.deepEqual(actual.pdf, again.pdf);
    assert.deepEqual(actual.previews, again.previews);
    await writeFile(join(folder, 'document.pdf'), actual.pdf);
    const previewFiles = actual.previews.map((_, i) => `native-${i + 1}.png`);
    for (let i = 0; i < actual.previews.length; i++) await writeFile(join(folder, previewFiles[i]), actual.previews[i]);
    const entry = { name: fixture.name, mode: isolation, directory, pages: actual.pages,
      pdfSha256: hash(actual.pdf), previewFiles, previewSha256: actual.previews.map(hash), repeatPdfBytesMatch: true };
    if (isolation === 'process') {
      const control = report.cases.find(row => row.name === fixture.name && row.mode === 'worker');
      assert.equal(entry.pdfSha256, control.pdfSha256);
      assert.deepEqual(entry.previewSha256, control.previewSha256);
    }
    report.cases.push(entry);
    await writeFile(join(out, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ isolation, cases: inputs.cases.length, version, engineVersion }));
}
