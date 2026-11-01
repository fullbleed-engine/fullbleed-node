// SPDX-License-Identifier: MIT
// Render explicit Base-14 witnesses through the installed npm tarball.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  'package-root': { type: 'string' }, out: { type: 'string' },
} });
let packageRoot = values['package-root'];
if (!packageRoot) {
  const packed = JSON.parse(await readFile(join(root, 'output/pack-verification/verification.json'), 'utf8'));
  assert(packed.ok);
  packageRoot = join(root, 'output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
}
packageRoot = resolve(packageRoot);
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
const bytes = await readFile(join(root, 'test/fixtures/font-cascade-2.5.51.json'));
const fixture = JSON.parse(bytes);
assert.equal(fixture.cases.length, 13);
const output = resolve(values.out ?? join(root, 'output/font-cascade'));
await mkdir(join(output, '..'), { recursive: true });
await mkdir(output);
await writeFile(join(output, 'inputs.json'), bytes);
const report = { status: 'rendering', packageVersion: version, engineVersion, node: process.version,
  platform: process.platform, wasmSha256: build.files['dist/engine.wasm'].sha256,
  fixtureSha256: hash(bytes), isolation: 'process', defaultStyles: false, cases: [] };
try {
  for (const specimen of fixture.cases) {
    const result = await renderPdf({ html: specimen.html, css: specimen.css,
      defaultStyles: false, isolation: 'process', previewDpi: 96 });
    assert.equal(result.engineVersion, engineVersion);
    assert.equal(result.pages, specimen.pages);
    assert.equal(result.missingGlyphs, 0);
    const filename = specimen.name + '.pdf';
    await writeFile(join(output, filename), result.pdf);
    const previews = [];
    for (const [index, preview] of result.previews.entries()) {
      const name = specimen.name + '-' + (index + 1) + '.png';
      await writeFile(join(output, name), preview);
      previews.push({ filename: name, sha256: hash(preview) });
    }
    report.cases.push({ name: specimen.name, filename, pdfSha256: hash(result.pdf),
      pages: result.pages, missingGlyphs: result.missingGlyphs, previews });
  }
  report.status = 'rendered-awaiting-independent-readback';
} finally {
  await writeFile(join(output, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, version, engineVersion, cases: report.cases.length }));
