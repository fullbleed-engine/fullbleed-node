// SPDX-License-Identifier: MIT
// Exercise the installed tarball's direct and compiled batch counter paths.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  'package-root': { type: 'string' }, out: { type: 'string' }, 'direct-only': { type: 'boolean', default: false },
  'new-cases-only': { type: 'boolean', default: false },
} });
let packageRoot = values['package-root'];
if (!packageRoot) {
  const packed = JSON.parse(await readFile(join(root, 'output/pack-verification/verification.json'), 'utf8'));
  assert(packed.ok);
  packageRoot = join(root, 'output/pack-verification', packed.installDirectory, 'node_modules/fullbleed');
}
packageRoot = resolve(packageRoot);
const { renderPdf, renderPdfBatch, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const hash = data => createHash('sha256').update(data).digest('hex');
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
const fixtureBytes = await readFile(join(root, 'test/fixtures/generated-counters-2.5.50.json'));
const fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length, 70);
assert.equal(fixture.newCases.length, 11);
const selected = values['new-cases-only'] ? fixture.cases.filter(row => fixture.newCases.includes(row.name)) : fixture.cases;
assert.equal(selected.length, values['new-cases-only'] ? 11 : 70);
const font = await readFile(join(packageRoot, 'assets/fonts/Inter-Variable.ttf'));
assert.equal(hash(font), fixture.font.sha256);
const output = resolve(values.out ?? join(root, 'output/generated-counters'));
await mkdir(join(output, '..'), { recursive: true });
await mkdir(output);
await writeFile(join(output, 'inputs.json'), fixtureBytes);
const modes = values['direct-only'] ? ['direct'] : ['direct', 'fixed', 'reflow'];
const report = { status: 'rendering', packageVersion: version, engineVersion, node: process.version,
  platform: process.platform, fixtureSha256: hash(fixtureBytes), wasmSha256: build.files['dist/engine.wasm'].sha256,
  isolation: 'process', defaultStyles: false, modes, cases: [] };
try {
  for (const specimen of selected) {
    for (const mode of modes) {
      const names = mode === 'direct' ? ['Ada'] : ['Ada', 'Bea'];
      const html = mode === 'direct' ? specimen.html.replaceAll('{{name}}', 'Ada') : specimen.html;
      const options = { html, css: specimen.css, fonts: [{ name: fixture.font.name, data: font }],
        defaultStyles: false, isolation: 'process' };
      if (['block-after-increment', 'contents-counter-order'].includes(specimen.name) && !values['new-cases-only']) options.previewDpi = 96;
      const result = mode === 'direct' ? await renderPdf(options)
        : await renderPdfBatch({ ...options, records: names.map(name => ({ name })), layout: mode });
      assert.equal(result.engineVersion, engineVersion);
      assert.equal(result.pages, specimen.pagesPerRecord * names.length);
      assert.equal(result.missingGlyphs, 0);
      const filename = specimen.name + '-' + mode + '.pdf';
      await writeFile(join(output, filename), result.pdf);
      const previews = [];
      for (let page = 0; page < result.previews.length; page++) {
        const preview = specimen.name + '-' + mode + '-native-' + (page + 1) + '.png';
        await writeFile(join(output, preview), result.previews[page]);
        previews.push({ filename: preview, sha256: hash(result.previews[page]) });
      }
      report.cases.push({ name: specimen.name, mode, names, filename, pages: result.pages,
        missingGlyphs: result.missingGlyphs, pdfSha256: hash(result.pdf), previews });
    }
  }
  report.status = 'rendered-awaiting-independent-readback';
} finally {
  await writeFile(join(output, 'renders.json'), JSON.stringify(report, null, 2)+'\n');
}
console.log(JSON.stringify({ status: report.status, packageVersion: version, engineVersion, PDFs: report.cases.length }));
