// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { generatedQuotesFixtures as fixtures } from '../test/generated-quotes.mjs';

const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
let packagePath = values['package-root'], tarballSha256 = null;
if (!packagePath) {
  const packed = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
  assert(packed.ok);
  packagePath = join('output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
  tarballSha256 = packed.tarballSha256;
}
const packageRoot = resolve(packagePath), out = resolve(values.out ?? 'output/generated-quotes');
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
assert.equal(fixtures.length, 41);
await mkdir(out);
const fixtureBytes = await readFile(new URL('../test/fixtures/generated-quotes-2.5.38.json', import.meta.url));
await writeFile(join(out, 'inputs.json'), fixtureBytes);
const record = { packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  tarballSha256, sourceSha256: hash(fixtureBytes), wasmSha256: build.files['dist/engine.wasm'].sha256, cases: [] };
for (const isolation of ['worker', 'process']) {
  for (const fixture of fixtures) {
    const directory = isolation + '-' + fixture.name, folder = join(out, directory);
    await mkdir(folder);
    await writeFile(join(folder, 'input.html'), fixture.html);
    await writeFile(join(folder, 'style.css'), fixture.css);
    const input = { html: fixture.html, css: fixture.css, defaultStyles: false, previewDpi: 72, timeoutMs: 60000, isolation };
    const result = await renderPdf(input), repeated = await renderPdf(input);
    assert.equal(result.missingGlyphs, 0);
    assert.equal(result.previews.length, result.pages);
    assert.deepEqual(repeated.pdf, result.pdf);
    assert.deepEqual(repeated.previews, result.previews);
    await writeFile(join(folder, 'document.pdf'), result.pdf);
    for (const [index, png] of result.previews.entries()) await writeFile(join(folder, `preview-${index + 1}.png`), png);
    const entry = { name: fixture.name, isolation, directory, pages: result.pages,
      pdfSha256: hash(result.pdf), previewSha256: result.previews.map(hash), deterministic: true };
    if (isolation === 'process') {
      const reference = record.cases.find(c => c.name === fixture.name && c.isolation === 'worker');
      assert.equal(entry.pdfSha256, reference.pdfSha256);
      assert.deepEqual(entry.previewSha256, reference.previewSha256);
    }
    record.cases.push(entry);
    await writeFile(join(out, 'renders.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify({ isolation, cases: fixtures.length, package: version, engine: engineVersion }));
}
