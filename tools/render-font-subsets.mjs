// SPDX-License-Identifier: MIT
// Render the real installed npm package; the independent reader runs separately.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const output = resolve(values.out ?? join(root, 'output/font-subsets'));
const { renderPdf, version, engineVersion } = await import(pathToFileURL(join(packageRoot, 'src/index.js')).href);
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
assert.equal(version, build.packageVersion);
assert.equal(engineVersion, build.engineVersion);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
await mkdir(join(output, '..'), { recursive: true });
await mkdir(output); // Never replace retained evidence from an earlier run.
await mkdir(join(output, 'fonts'));
const fonts = [];
for (const name of [...build.fonts, 'NotoSansMath-Regular.ttf']) {
  const source = name === 'NotoSansMath-Regular.ttf' ? join(root, 'test/fonts', name) : join(packageRoot, 'assets/fonts', name);
  const bytes = await readFile(source);
  if (name !== 'NotoSansMath-Regular.ttf') assert.equal(hash(bytes), build.files['assets/fonts/' + name].sha256);
  await copyFile(source, join(output, 'fonts', name));
  fonts.push({ name, path: 'fonts/' + name, bytes: bytes.length, sha256: hash(bytes) });
}
const licenses = [];
for (const name of ['Inter-OFL.txt', 'DMSerifDisplay-OFL.txt', 'BebasNeue-OFL.txt', 'NotoSansMath-OFL.txt']) {
  const source = name === 'NotoSansMath-OFL.txt' ? join(root, 'test/fonts', name) : join(packageRoot, 'assets/fonts', name);
  const bytes = await readFile(source);
  await copyFile(source, join(output, 'fonts', name));
  licenses.push({ path: 'fonts/' + name, bytes: bytes.length, sha256: hash(bytes) });
}
const fixtures = [];
for (const [name, pages] of [['invoice', 1], ['report', 3]]) {
  fixtures.push({ name, pages, html: await readFile(join(root, 'examples', name + '.html'), 'utf8'), css: await readFile(join(root, 'examples', name + '.css'), 'utf8') });
}
for (const [name, family, text, style, expectedFont] of [
  ['inter', 'Inter', 'Invoice 2042 Résumé café Ångström Ω Ж 123.45', 'normal', 'Inter-Variable.ttf'],
  ['dm-serif', 'DM Serif Display', 'Invoice 2042 Résumé café Ångström 123.45', 'normal', 'DMSerifDisplay-Regular.ttf'],
  ['dm-serif-italic', 'DM Serif Display', 'Invoice 2042 Résumé café Ångström 123.45', 'italic', 'DMSerifDisplay-Italic.ttf'],
  ['bebas-neue', 'Bebas Neue', 'DOCUMENT 2042 PACKING LIST 123.45', 'normal', 'BebasNeue-Regular.ttf'],
  ['math', 'Noto Sans Math', 'A 𝒜 ∑ ∫ ≠ → 123.45', 'normal', 'NotoSansMath-Regular.ttf'],
]) {
  fixtures.push({ name, pages: 1, expectedText: text, expectedFont,
    html: `<!doctype html><html lang="en"><body><p>${text}</p></body></html>`,
    css: `@page {size:A4;margin:36pt} body {font-family:"${family}";font-size:18pt;font-style:${style}}`,
    fonts: name === 'math' ? [await readFile(join(output, 'fonts/NotoSansMath-Regular.ttf'))] : undefined,
  });
}
const report = { schema: 'fullbleed.node_font_subsets.v1', ok: false,
  packageVersion: version, engineVersion, node: process.version, platform: process.platform,
  wasmSha256: build.files['dist/engine.wasm'].sha256, fonts, licenses, fixtures: [] };
try {
  for (const fixture of fixtures) {
    const directory = join(output, fixture.name);
    await mkdir(directory);
    await writeFile(join(directory, 'input.html'), fixture.html);
    await writeFile(join(directory, 'style.css'), fixture.css);
    const input = { html: fixture.html, css: fixture.css, fonts: fixture.fonts, previewDpi: 96 };
    const result = await renderPdf(input);
    assert.equal(result.pages, fixture.pages);
    assert.equal(result.missingGlyphs, 0);
    assert.deepEqual((await renderPdf(input)).pdf, result.pdf, fixture.name + ' repeat PDF');
    await writeFile(join(directory, 'document.pdf'), result.pdf);
    for (let i = 0; i < result.previews.length; i++) await writeFile(join(directory, `preview-${i + 1}.png`), result.previews[i]);
    report.fixtures.push({ name: fixture.name, pages: result.pages,
      expectedText: fixture.expectedText ?? null, expectedFont: fixture.expectedFont ?? null,
      htmlSha256: hash(fixture.html), cssSha256: hash(fixture.css),
      pdfBytes: result.pdf.length, pdfSha256: hash(result.pdf), previewsSha256: result.previews.map(hash),
      repeatPdfBytesIdentical: true });
    console.log(JSON.stringify({ fixture: fixture.name, pdfBytes: result.pdf.length, pages: result.pages }));
  }
  report.ok = true;
} finally {
  await writeFile(join(output, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
