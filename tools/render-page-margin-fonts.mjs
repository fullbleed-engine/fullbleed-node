// SPDX-License-Identifier: MIT
// Render the reviewed core page-font fixtures through the installed npm tarball.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { 'package-root': { type: 'string' }, out: { type: 'string' } } });
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
const fixtureBytes = await readFile(join(root, 'test/fixtures/page-margin-fonts-2.5.48.json'));
const fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length, 8);
const fonts = await Promise.all(fixture.fonts.map(async font => {
  const data = await readFile(join(root, font.path));
  assert.equal(hash(data), font.sha256);
  return { name: font.name, data };
}));
const output = resolve(values.out ?? join(root, 'output/page-margin-fonts'));
await mkdir(join(output, '..'), { recursive: true });
await mkdir(output);
await writeFile(join(output, 'fixture.json'), fixtureBytes);
const report = { schema: 'fullbleed.binding_page_margin_fonts.v1', ok: false, packageVersion: version, engineVersion,
  node: process.version, platform: process.platform, isolation: 'process', defaultStyles: false,
  wasmSha256: build.files['dist/engine.wasm'].sha256, fixtureSha256: hash(fixtureBytes), cases: [] };
try {
  for (const specimen of fixture.cases) {
    const pair = { name: specimen.name };
    for (const kind of ['control', 'alias']) {
      const folder = join(output, specimen.name, kind);
      await mkdir(folder, { recursive: true });
      const css = specimen[kind + 'Css'];
      await writeFile(join(folder, 'input.html'), specimen.html);
      await writeFile(join(folder, 'input.css'), css);
      const result = await renderPdf({ html: specimen.html, css, fonts, previewDpi: 96, isolation: 'process', defaultStyles: false });
      assert.equal(result.engineVersion, engineVersion);
      assert.equal(result.pages, specimen.footerFaces.length);
      assert.equal(result.missingGlyphs, 0);
      assert.equal(result.previews.length, result.pages);
      await writeFile(join(folder, 'document.pdf'), result.pdf);
      for (let i = 0; i < result.previews.length; i++) {
        await writeFile(join(folder, `page-${i + 1}.png`), result.previews[i]);
      }
      pair[kind] = { pages: result.pages, missingGlyphs: result.missingGlyphs,
        htmlSha256: hash(specimen.html), cssSha256: hash(css), pdfSha256: hash(result.pdf),
        nativePreviewSha256: result.previews.map(hash) };
    }
    report.cases.push(pair);
  }
  report.ok = true;
} finally {
  await writeFile(join(output, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, packageVersion: version, engineVersion, pairs: report.cases.length }));
