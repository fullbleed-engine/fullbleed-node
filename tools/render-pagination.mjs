// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fixtures } from '../test/pagination-fixtures.mjs';

const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
let packagePath = values['package-root'];
let tarballSha256 = null;
if (!packagePath) {
  const packed = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
  assert(packed.ok);
  packagePath = join('output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
  tarballSha256 = packed.tarballSha256;
}
const packageRoot = resolve(packagePath), out = resolve(values.out ?? 'output/pagination');
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
await mkdir(out);
const record = { packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  tarballSha256, sourceSha256: hash(await readFile(new URL('../test/pagination-fixtures.mjs', import.meta.url))),
  wasmSha256: build.files['dist/engine.wasm'].sha256, source: 'Fullbleed core pagination regression cases at ea1625cf672c02fc396d932e9ca070b0e8302fa4', cases: [] };
for (const isolation of ['worker', 'process']) {
  for (const fixture of fixtures) {
    const folder = join(out, isolation + '-' + fixture.name);
    await mkdir(folder);
    await writeFile(join(folder, 'input.html'), fixture.html);
    await writeFile(join(folder, 'style.css'), fixture.css);
    const input = { html: fixture.html, css: fixture.css, defaultStyles: false, previewDpi: 72, timeoutMs: 60000, isolation };
    const result = await renderPdf(input);
    assert.equal(result.missingGlyphs, 0);
    assert.equal(result.previews.length, result.pages);
    assert.deepEqual((await renderPdf(input)).pdf, result.pdf);
    await writeFile(join(folder, 'document.pdf'), result.pdf);
    for (const [i, png] of result.previews.entries()) await writeFile(join(folder, `preview-${i + 1}.png`), png);
    const entry = { name: fixture.name, kind: fixture.kind, expectedPages: fixture.pages ?? null, isolation,
      directory: isolation + '-' + fixture.name, pages: result.pages, pdfSha256: hash(result.pdf),
      previewSha256: result.previews.map(hash), deterministic: true };
    if (isolation === 'process') {
      const reference = record.cases.find(c => c.name === fixture.name && c.isolation === 'worker');
      assert.equal(entry.pdfSha256, reference.pdfSha256);
      assert.deepEqual(entry.previewSha256, reference.previewSha256);
    }
    record.cases.push(entry);
    await writeFile(join(out, 'renders.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ name: fixture.name, isolation, pages: result.pages }));
  }
}
assert.equal(record.cases.length, 18);
