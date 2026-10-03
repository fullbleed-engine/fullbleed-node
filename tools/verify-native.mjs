// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPdf } from 'fullbleed';
import { gradientFixtures } from '../test/gradients.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = join(root, 'engine');
const output = join(root, 'output/native-verification');
await mkdir(output, { recursive: true });
const build = spawnSync('cargo', ['build', '--release', '--locked'], { cwd: engine, stdio: 'inherit' });
assert.equal(build.status, 0);
const executable = join(engine, 'target/release', process.platform === 'win32' ? 'fullbleed-node-adapter.exe' : 'fullbleed-node-adapter');
const manifest = JSON.parse(await readFile(join(root, 'dist/build.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const records = [];
const fixtures = [];
fixtures.push(...gradientFixtures);
for (const [name, pages] of [['invoice', 1], ['report', 3]]) {
  fixtures.push({ name, pages, html: await readFile(join(root, 'examples', name + '.html'), 'utf8'), css: await readFile(join(root, 'examples', name + '.css'), 'utf8') });
}
fixtures.push({ name: 'custom-font', pages: 1, html: '<h1>Integral: ⨌</h1>', css: "body {font-family:Inter,'Noto Sans Math'}", fonts: [await readFile(join(root, 'test/fonts/NotoSansMath-Regular.ttf'))] });
fixtures.push({ name: 'asset', pages: 1, html: '<h1>Brand asset</h1><img src="assets/brand/logo.svg">', css: '', assets: { 'brand/logo.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#175c52"/></svg>') } });
for (const fixture of fixtures) {
  const directory = await mkdtemp(join(output, fixture.name + '-'));
  await mkdir(join(directory, 'fonts'));
  const names = manifest.fonts.map(n => 'fonts/' + n);
  for (const name of manifest.fonts) await copyFile(join(root, 'assets/fonts', name), join(directory, 'fonts', name));
  for (let i = 0; i < (fixture.fonts?.length ?? 0); i++) {
    const name = `fonts/custom-${i}.ttf`;
    await writeFile(join(directory, name), fixture.fonts[i]);
    names.push(name);
  }
  for (const [name, bytes] of Object.entries(fixture.assets ?? {})) {
    const target = join(directory, 'assets', name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(join(directory, 'input.html'), fixture.html);
  await writeFile(join(directory, 'style.css'), 'body { font-family: Inter; }\n' + fixture.css);
  const native = spawnSync(executable, ['1000', '96', 'reject', ...names], { cwd: directory, encoding: 'utf8', timeout: 60000 });
  assert.equal(native.status, 0, native.stderr);
  const options = { html: fixture.html, css: fixture.css, previewDpi: 96, fonts: fixture.fonts, assets: fixture.assets };
  const wasi = await renderPdf(options);
  assert.equal(wasi.pages, fixture.pages);
  assert.equal(wasi.missingGlyphs, 0);
  const pdf = await readFile(join(directory, 'document.pdf'));
  assert.equal(hash(wasi.pdf), hash(pdf), fixture.name + ' PDF');
  await writeFile(join(directory, 'wasi.pdf'), wasi.pdf);
  const previews = [];
  for (let i = 0; i < wasi.previews.length; i++) {
    const png = await readFile(join(directory, `preview-${i + 1}.png`));
    assert.equal(hash(wasi.previews[i]), hash(png), `${fixture.name} preview ${i + 1}`);
    previews.push(hash(png));
  }
  records.push({ name: fixture.name, pages: wasi.pages, pdfSha256: hash(pdf), previewsSha256: previews, directory: directory.slice(output.length + 1), nativeWasiEqual: true });
}
const report = { ok: true, engine: manifest.engineVersion, node: process.version, platform: process.platform, wasmSha256: manifest.files['dist/engine.wasm'].sha256, fixtures: records, scope: 'Equality for the retained ordinary PDF fixtures and their finalized previews; no general platform or standards certification.' };
await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
