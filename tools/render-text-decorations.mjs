// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, 'tarball-sha256': { type: 'string' }, out: { type: 'string' } } });
let packagePath = values['package-root'], tarballSha256 = values['tarball-sha256'] ?? null;
if (!packagePath) {
  const packed = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
  assert(packed.ok);
  packagePath = join('output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
  tarballSha256 = packed.tarballSha256;
}
if (tarballSha256 !== null) assert.match(tarballSha256, /^[a-f0-9]{64}$/);
const packageRoot = resolve(packagePath), out = resolve(values.out ?? 'output/text-decorations');
const hash = data => createHash('sha256').update(data).digest('hex');
const fixtureBytes = await readFile(new URL('../test/fixtures/text-decorations-2.5.40.json', import.meta.url));
const fixtures = JSON.parse(fixtureBytes);
assert.equal(fixtures.cases.length, 16);
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
assert.equal(hash(await readFile(join(packageRoot, 'assets/fonts/Inter-Variable.ttf'))), fixtures.fontSha256);
await mkdir(out);
await writeFile(join(out, 'inputs.json'), fixtureBytes);
const record = { packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  tarballSha256, sourceSha256: hash(fixtureBytes), fontSha256: fixtures.fontSha256, wasmSha256: build.files['dist/engine.wasm'].sha256, cases: [] };
for (const isolation of ['worker', 'process']) {
  for (const fixture of fixtures.cases) {
    const directory = isolation + '-' + fixture.name, folder = join(out, directory);
    await mkdir(folder);
    await writeFile(join(folder, 'input.html'), fixture.html);
    await writeFile(join(folder, 'style.css'), fixture.css);
    const input = { html: fixture.html, css: fixture.css, defaultStyles: false, previewDpi: 144, timeoutMs: 60000, isolation };
    const result = await renderPdf(input), repeated = await renderPdf(input);
    assert.equal(result.engineVersion, engineVersion);
    assert.equal(result.missingGlyphs, 0);
    assert.equal(result.pages, 1);
    assert.equal(result.previews.length, 1);
    assert.deepEqual(repeated.pdf, result.pdf);
    assert.deepEqual(repeated.previews, result.previews);
    await writeFile(join(folder, 'document.pdf'), result.pdf);
    await writeFile(join(folder, 'preview.png'), result.previews[0]);
    const plain = await renderPdf({ ...input, css: fixture.css + '.dec {text-decoration:none}', previewDpi: 0 });
    assert.equal(plain.missingGlyphs, 0);
    await writeFile(join(folder, 'undecorated.pdf'), plain.pdf);
    const entry = { name: fixture.name, isolation, directory, pages: result.pages,
      pdfSha256: hash(result.pdf), previewSha256: hash(result.previews[0]), deterministic: true };
    if (isolation === 'process') {
      const reference = record.cases.find(c => c.name === fixture.name && c.isolation === 'worker');
      assert.equal(entry.pdfSha256, reference.pdfSha256);
      assert.equal(entry.previewSha256, reference.previewSha256);
    }
    record.cases.push(entry);
    await writeFile(join(out, 'renders.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify({ isolation, cases: 16, package: version, engine: engineVersion }));
}
