// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { tableWrappingFixtures as fixtures, tableWrappingSource as source } from '../test/table-wrapping.mjs';

const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
let packagePath = values['package-root'], tarballSha256 = null;
if (!packagePath) {
  const packed = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
  assert(packed.ok);
  packagePath = join('output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
  tarballSha256 = packed.tarballSha256;
}
const packageRoot = resolve(packagePath), out = resolve(values.out ?? 'output/table-wrapping');
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
assert.equal(fixtures.length, 35);
const font = await readFile(new URL('../test/fonts/FullbleedCJKTest-Regular.ttf', import.meta.url));
assert.equal(hash(font), source.fontSha256);
await mkdir(out);
await mkdir(join(out, 'assets'));
await writeFile(join(out, 'assets/FullbleedCJKTest-Regular.ttf'), font);
for (const name of ['FullbleedCJKTest-OFL.txt'])
  await copyFile(new URL('../test/fonts/' + name, import.meta.url), join(out, 'assets', name));
await copyFile(new URL('../test/fixtures/table-wrapping-font.json', import.meta.url), join(out, 'assets/font-source.json'));
const fixtureBytes = await readFile(new URL('../test/fixtures/table-wrapping-2.5.37.json', import.meta.url));
await writeFile(join(out, 'inputs.json'), fixtureBytes);
const record = { packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  tarballSha256, sourceSha256: hash(fixtureBytes), fontSha256: hash(font),
  wasmSha256: build.files['dist/engine.wasm'].sha256, cases: [] };
for (const isolation of ['worker', 'process']) {
  for (const fixture of fixtures) {
    const directory = isolation + '-' + fixture.name, folder = join(out, directory);
    await mkdir(folder);
    await writeFile(join(folder, 'input.html'), fixture.html);
    await writeFile(join(folder, 'style.css'), fixture.css);
    const input = { html: fixture.html, css: fixture.css, fonts: fixture.fontFiles.length ? [font] : [],
      defaultStyles: false, previewDpi: 72, timeoutMs: 60000, isolation };
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
  console.log(JSON.stringify({isolation, cases:fixtures.length, package:version, engine:engineVersion}));
}
assert.equal(record.cases.length, 70);
