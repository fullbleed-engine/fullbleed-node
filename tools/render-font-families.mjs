// SPDX-License-Identifier: MIT
// Exercise custom family selection through the actual installed npm package.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const build = JSON.parse(await readFile(join(packageRoot, 'dist/build.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(build.packageVersion, version);
assert.equal(build.engineVersion, engineVersion);
assert.equal(hash(await readFile(join(packageRoot, 'dist/engine.wasm'))), build.files['dist/engine.wasm'].sha256);
const output = resolve(values.out ?? join(root, 'output/font-families'));
await mkdir(join(output, '..'), { recursive: true });
await mkdir(output); // Preserve prior evidence rather than overwriting it.
await mkdir(join(output, 'fonts'));
const source = join(root, 'test/fonts/family');
for (const name of await readdir(source)) await copyFile(join(source, name), join(output, 'fonts', name));
const fonts = {
  normal: { file: 'LibreCaslonText[wght].ttf', face: 'LibreCaslonText-Regular' },
  italic: { file: 'LibreCaslonText-Italic[wght].ttf', face: 'LibreCaslonText-Italic' },
};
for (const font of Object.values(fonts)) font.data = await readFile(join(source, font.file));
const report = { schema: 'fullbleed.binding_font_families.v1', ok: false, packageVersion: version, engineVersion,
  node: process.version, platform: process.platform, wasmSha256: build.files['dist/engine.wasm'].sha256,
  fonts: Object.values(fonts).map(font => ({ path: 'fonts/' + font.file, face: font.face, sha256: hash(font.data) })), cases: [] };
const html = '<p>Type Alpha with care.</p>';
async function render(name, style, family, ordered, prefix = '', control = null) {
  const css = prefix + `@page {size:440pt 140pt;margin:20pt} p {font-family:"${family}";font-size:22pt;font-style:${style};margin:0}`;
  const folder = join(output, name);
  await mkdir(folder);
  await writeFile(join(folder, 'input.html'), html);
  await writeFile(join(folder, 'style.css'), css);
  const input = { html, css, fonts: ordered.map(key => fonts[key].data), previewDpi: 96 };
  const result = await renderPdf(input);
  assert.equal(result.pages, 1);
  assert.equal(result.missingGlyphs, 0);
  assert.deepEqual((await renderPdf(input)).pdf, result.pdf, name + ' repeated PDF');
  await writeFile(join(folder, 'document.pdf'), result.pdf);
  await writeFile(join(folder, 'preview-1.png'), result.previews[0]);
  report.cases.push({ name, mode: 'pdf', style, control, expectedFace: fonts[style].face,
    expectedText: ['Type Alpha with care.'], htmlSha256: hash(html), cssSha256: hash(css),
    pdfSha256: hash(result.pdf), previewFiles: ['preview-1.png'], previewsSha256: result.previews.map(hash), repeatPdfBytesIdentical: true });
}
try {
  for (const style of ['normal', 'italic']) await render(`control-${style}-pdf`, style, fonts[style].face, [style]);
  const mapped = '@font-face {font-family:"Customer Serif";src:local("LibreCaslonText-Regular");font-style:normal}'
    + '@font-face {font-family:"Customer Serif";src:local("LibreCaslonText-Italic");font-style:italic}';
  for (const order of [['italic', 'normal'], ['normal', 'italic']]) {
    for (const style of ['normal', 'italic']) {
      const control = `control-${style}-pdf`;
      await render(`${order[0]}-first-${style}`, style, 'Libre Caslon Text', order, '', control);
      await render(`${order[0]}-first-mapped-${style}`, style, 'Customer Serif', order, mapped, control);
    }
  }
  report.ok = true;
} finally {
  await writeFile(join(output, 'renders.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, packageVersion: version, engineVersion, cases: report.cases.length }));
