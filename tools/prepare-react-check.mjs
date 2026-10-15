// SPDX-License-Identifier: MIT
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const app = path.resolve('examples/react');
const out = path.resolve('output/react-baseline');
await mkdir(out, { recursive: true });
const require = createRequire(path.join(app, 'package.json'));
const { renderPdf } = require('fullbleed');
const { renderDocument } = require('fullbleed/ui');
const records = [];
for (const design of ['invoice', 'report']) {
  const html = (await readFile(path.join(app, 'src', design + '.html'), 'utf8'))
    .replaceAll('{{customer}}', 'Maple &amp; Finch').replaceAll('{{reference}}', 'NS-1042');
  const css = (await readFile(path.join(app, 'src', design + '.css'), 'utf8')).replaceAll('{{ink}}', '#17382e');
  const result = await renderPdf({ html, css, previewDpi: 96, maxPages: 20, timeoutMs: 30_000 });
  await writeFile(path.join(out, design + '.pdf'), result.pdf);
  for (const [index, bytes] of result.previews.entries()) await writeFile(path.join(out, `${design}-${index + 1}.png`), bytes);
  records.push({ design, pages: result.pages, pdfSha256: createHash('sha256').update(result.pdf).digest('hex'),
    previews: result.previews.map(bytes => createHash('sha256').update(bytes).digest('hex')) });
}
// Compile the actual print modules with their per-file JSX runtime. The React UI
// is independently type-checked and built by the project's normal build command.
const compiled = path.join(app, '.document-check');
await mkdir(compiled, { recursive: true });
await writeFile(path.join(compiled, 'tsconfig.json'), JSON.stringify({
  extends: '../tsconfig.json', compilerOptions: {
    noEmit: false, noEmitOnError: true, outDir: '.', rootDir: '../src/documents', types: [],
  }, include: ['../src/documents/**/*.ts', '../src/documents/**/*.tsx'], exclude: [],
}, null, 2));
const compilerPackagePath = require.resolve('typescript/package.json');
const compilerPackage = JSON.parse(await readFile(compilerPackagePath, 'utf8'));
const compile = spawnSync(process.execPath, [path.join(path.dirname(compilerPackagePath), compilerPackage.bin.tsc),
  '--project', path.join(compiled, 'tsconfig.json')], { cwd: app, encoding: 'utf8' });
if (compile.status !== 0) throw new Error(compile.stdout + compile.stderr);
const { Invoice } = await import(pathToFileURL(path.join(compiled, 'Invoice.js')));
const { sample } = await import(pathToFileURL(path.join(compiled, 'data.js')));
const componentCases = [
  ['component-invoice', sample, '#17382e'],
  ['component-paid', { ...sample, paid: true }, '#17382e'],
  ['component-edited', { ...sample, customer: 'Birch & <Briar>', number: 'TSX-2042' }, '#233b79'],
  ['component-empty', { ...sample, items: [] }, '#17382e'],
  ['component-credit', { ...sample, items: [{ name: 'Credit & <revision>', detail: '', quantity: 2, rate_cents: -1255, progress: 100 }] }, '#17382e'],
  ['component-long', { ...sample, items: Array.from({ length: 20 }, (_, index) => ({
    name: `Work ${String(index + 1).padStart(2, '0')}`, detail: '', quantity: 1, rate_cents: 10000, progress: 100,
  })) }, '#17382e'],
];
for (const [design, data, ink] of componentCases) {
  const node = Invoice({ data, ink });
  const result = await renderDocument(node, renderPdf, { previewDpi: 96, maxPages: 20, timeoutMs: 30_000 });
  const repeated = await renderDocument(node, renderPdf, { previewDpi: 96, maxPages: 20, timeoutMs: 30_000 });
  if (!result.pdf.equals(repeated.pdf) || !result.previews.every((bytes, index) => bytes.equals(repeated.previews[index]))) {
    throw new Error(`Non-repeatable component fixture: ${design}`);
  }
  if (result.missingGlyphs !== 0) throw new Error(`Missing glyphs: ${design}`);
  await writeFile(path.join(out, design + '.pdf'), result.pdf);
  for (const [index, bytes] of result.previews.entries()) await writeFile(path.join(out, `${design}-${index + 1}.png`), bytes);
  records.push({ design, pages: result.pages, pdfSha256: createHash('sha256').update(result.pdf).digest('hex'),
    previews: result.previews.map(bytes => createHash('sha256').update(bytes).digest('hex')), repeatedPdfPreviewsEqual: true });
}
const installed = JSON.parse(await readFile(path.join(app, 'node_modules/fullbleed/package.json'), 'utf8'));
await writeFile(path.join(out, 'verification.json'), JSON.stringify({ package: installed.version,
  engine: installed.fullbleed.engineVersion, node: process.version, records }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, out, records }));
